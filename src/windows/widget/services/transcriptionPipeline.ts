import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { LANGUAGES } from "../../../config/languages";
import { showCleanupNotice } from "../../../lib/cleanupNotice";
import {
  DICTATION_STREAM_UPDATE_EVENT,
  type DictationStreamUpdatePayload,
  HISTORY_DELETED_EVENT,
} from "../../../lib/hotkeyEvents";
import { tn } from "../../../lib/i18n";
import { diagnosticId, logError, logInfo, processingErrorCode } from "../../../lib/logger";
import { beginProcessing, finishProcessing, isAbortError } from "../../../lib/processingControl";
import { withStatsCompletionMetadata } from "../../../lib/stats";
import {
  type AppSettings,
  deleteHistoryAudio,
  deleteHistoryEntry,
  type HistoryEntry,
  readHistoryAudio,
  saveHistoryAudio,
} from "../../../lib/store";
import { resolveSummaryBackend } from "../../../lib/summarize";
import { cleanupDictation, type DictationCleanupContext } from "../../../lib/textCleanup";
import { formatErrorMessage } from "../../../lib/utils";
import type { LiveTranscriptionResult } from "./dictationStreamOverlay";
import {
  createDictationOverlayState,
  dictationOverlayStateFromStreamUpdate,
  isSttStreamingEnabled,
  shouldApplyDictationStreamUpdate,
} from "./dictationStreamOverlay";
import {
  applyVocabularyStage,
  captureDictationVocabulary,
  type DictationVocabularyCapture,
  NO_VOCABULARY,
} from "./dictationVocabulary";
import {
  type AudioSignalStats,
  guardTranscriptionResult,
  isClearlySilentAudio,
} from "./transcriptionGuard";
import { resolveBatchTranscriptionModel } from "./transcriptionModel";
import {
  resolveLiveTranscriptionReconciliationMode,
  shouldAcceptLiveTranscription,
} from "./transcriptionReconciliation";

export interface ProcessRecordingBlobParams {
  blob: Blob;
  settings: AppSettings;
  recordingStartTimestamp: number;
  liveTranscription?: LiveTranscriptionResult | null;
  dictationStream?: DictationStreamOverlaySession | null;
  audioStats?: AudioSignalStats | null;
  cleanupContext?: DictationCleanupContext;
  /** Captured at record start; batch, streaming final and reconciliation all use it. */
  vocabulary?: Promise<DictationVocabularyCapture> | DictationVocabularyCapture;
}

export interface ProcessRecordingBlobResult {
  durationSeconds: number;
  hasTranscription: boolean;
}

export interface RetryHistoryEntryResult {
  hasTranscription: boolean;
  updatedEntry: HistoryEntry;
}

interface RecordingAudioSource {
  audioBase64: string;
  audioMimeType: string;
  audioFileName: string;
}

type TranscriptionResult = Pick<HistoryEntry, "raw" | "cleaned" | "dictationTranslation">;

/** Final dictation text plus how cleanup and the vocabulary produced it. */
export type DictationTextResult = TranscriptionResult &
  Pick<HistoryEntry, "cleanupApplied" | "preVocabularyText" | "personalization">;

export interface DictationStreamOverlaySession {
  requestId: string;
  latestText: () => string;
  showInserting: (text: string) => Promise<void>;
  showError: (text: string, message: string) => Promise<void>;
  hide: () => Promise<void>;
  dispose: () => void;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

async function saveCompletedRecordingAudio({
  entryId,
  audioBase64,
  audioMimeType,
  audioFileName,
  settings,
}: RecordingAudioSource & {
  entryId: string;
  settings: AppSettings;
}): Promise<Pick<HistoryEntry, "audioPath" | "audioMimeType" | "audioFileName">> {
  if (!settings.saveRecordingAudio) {
    return {
      audioPath: undefined,
      audioMimeType: undefined,
      audioFileName: undefined,
    };
  }

  try {
    const saved = await saveHistoryAudio({
      storageDir: settings.transcriptionStorageDir,
      entryId,
      audioBase64,
      mimeType: audioMimeType,
    });

    return {
      audioPath: saved.path,
      audioMimeType: saved.mimeType || audioMimeType,
      audioFileName: saved.fileName || audioFileName,
    };
  } catch (error) {
    logError("HISTORY", `Failed to save recording audio: ${processingErrorCode(error)}`);
    return {
      audioPath: undefined,
      audioMimeType: undefined,
      audioFileName: undefined,
    };
  }
}

async function loadRecordingAudioSource(entry: HistoryEntry): Promise<RecordingAudioSource> {
  if (entry.audioPath) {
    const audio = await readHistoryAudio(entry.audioPath);
    return {
      audioBase64: audio.audioBase64,
      audioMimeType: audio.mimeType || entry.audioMimeType || "audio/webm",
      audioFileName:
        entry.audioFileName ||
        (audio.mimeType?.includes("wav") ? "recording.wav" : "recording.webm"),
    };
  }

  if (entry.audioBase64) {
    return {
      audioBase64: entry.audioBase64,
      audioMimeType: entry.audioMimeType || "audio/webm",
      audioFileName: entry.audioFileName || "recording.webm",
    };
  }

  throw new Error(tn("widget.error.noSavedAudio"));
}

function isLocalSttSettings(settings: AppSettings): boolean {
  return /127\.0\.0\.1|localhost/i.test(settings.whisperEndpoint || "");
}

function createRequestId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

async function showWidgetTextOverlay(
  payload: Parameters<typeof createDictationOverlayState>[0],
): Promise<void> {
  await invoke("show_widget_text_overlay", {
    payload: createDictationOverlayState(payload),
  });
}

export async function startDictationStreamOverlaySession(
  settings: AppSettings,
): Promise<DictationStreamOverlaySession | null> {
  if (!isSttStreamingEnabled(settings)) {
    return null;
  }

  const requestId = createRequestId();
  let latestText = "";
  let disposed = false;

  let unlisten: () => void;
  try {
    unlisten = await listen<DictationStreamUpdatePayload>(
      DICTATION_STREAM_UPDATE_EVENT,
      ({ payload }) => {
        if (disposed || !shouldApplyDictationStreamUpdate(requestId, payload)) {
          return;
        }

        const nextText = payload.text.trim() || latestText;
        if (nextText) {
          latestText = nextText;
        }

        // The empty listening state is shown once when the session starts.
        // Ignore empty interim updates so they cannot replace recognized text.
        if (!nextText && payload.status !== "error") {
          return;
        }

        void invoke("show_widget_text_overlay", {
          payload: dictationOverlayStateFromStreamUpdate({
            ...payload,
            text: nextText,
          }),
        }).catch((error) => {
          logError(
            "DICTATION_STREAM",
            `Failed to update text overlay: ${processingErrorCode(error)}`,
          );
        });
      },
    );
  } catch (error) {
    await invoke("hide_widget_text_overlay").catch(() => {});
    throw error;
  }

  await showWidgetTextOverlay({
    requestId,
    status: "dictating",
    text: "",
  });

  return {
    requestId,
    latestText: () => latestText,
    showInserting: async (text: string) => {
      latestText = text.trim() || latestText;
      await showWidgetTextOverlay({
        requestId,
        status: "inserting",
        text,
      });
    },
    showError: async (text: string, message: string) => {
      latestText = text.trim() || latestText;
      await showWidgetTextOverlay({
        requestId,
        status: "error",
        text: text.trim() || latestText,
        message,
      });
    },
    hide: async () => {
      await invoke("hide_widget_text_overlay");
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      unlisten();
    },
  };
}

function languageLabel(code: string): string {
  const language = LANGUAGES.find((item) => item.code === code);
  if (!language) return code;
  return `${language.name} (${language.native})`;
}

function isAuthFailureLike(normalized: string): boolean {
  return (
    normalized.includes("401") ||
    normalized.includes("unauthorized") ||
    normalized.includes("invalid api key") ||
    normalized.includes("api-ключ") ||
    normalized.includes("ключ доступа") ||
    (normalized.includes("авторизоваться") && normalized.includes("api"))
  );
}

function toUserFacingErrorMessage(error: unknown, settings: AppSettings): string {
  const raw = formatErrorMessage(error);
  const normalized = raw.toLowerCase();
  const isLocalStt = isLocalSttSettings(settings);

  const missingModelMatch = raw.match(/Model ['"]([^'"]+)['"] is not installed locally/i);
  if (missingModelMatch) {
    const model = missingModelMatch[1];
    return tn("widget.error.modelNotDownloaded", { model });
  }

  if (
    normalized.includes("connection refused") ||
    normalized.includes("tcp connect error") ||
    normalized.includes("error trying to connect") ||
    normalized.includes("failed to connect") ||
    normalized.includes("os error 61") ||
    normalized.includes("os error 111")
  ) {
    return tn("widget.error.localRuntimeStartFailed");
  }

  if (
    normalized.includes("unsupported_country_region_territory") ||
    normalized.includes("country, region, or territory not supported")
  ) {
    return tn("widget.error.regionUnsupported");
  }

  if (normalized.includes("403") || normalized.includes("forbidden")) {
    if (isLocalStt) {
      return tn("widget.error.localRuntimeRejected");
    }

    return tn("widget.error.requestRejected");
  }

  if (normalized.includes("translation text model unavailable")) {
    return tn("widget.error.translationModelUnavailable");
  }

  if (isAuthFailureLike(normalized)) {
    if (isLocalStt) {
      return tn("widget.error.localRuntimeRejected");
    }

    return tn("widget.error.authFailed");
  }

  if (
    normalized.includes("429") ||
    normalized.includes("rate limit") ||
    normalized.includes("quota")
  ) {
    return tn("widget.error.rateLimited");
  }

  if (
    normalized.includes("network") ||
    normalized.includes("fetch") ||
    normalized.includes("failed to fetch") ||
    normalized.includes("timed out")
  ) {
    return tn("widget.error.networkFailed");
  }

  if (
    normalized.includes("500") ||
    normalized.includes("502") ||
    normalized.includes("503") ||
    normalized.includes("504") ||
    normalized.includes("server")
  ) {
    return tn("widget.error.serverUnavailable");
  }

  return tn("widget.error.processingFailed");
}

async function transcribeViaBackend({
  audioBase64,
  audioMimeType,
  audioFileName,
  settings,
  streamingRequestId,
}: {
  audioBase64: string;
  audioMimeType: string;
  audioFileName: string;
  settings: AppSettings;
  streamingRequestId?: string | null;
}): Promise<TranscriptionResult> {
  const whisperModel = resolveBatchTranscriptionModel(settings);
  logInfo("API", `Sending to backend, audio_size: ${audioBase64.length} chars`);

  const result = await invoke<{ raw: string; cleaned: string }>("transcribe_and_clean", {
    req: {
      audio_base64: audioBase64,
      language: settings.language,
      api_key: settings.apiKey,
      whisper_api_key: settings.whisperApiKey || null,
      style: settings.style || "classic",
      whisper_endpoint: settings.whisperEndpoint || null,
      local_models_dir: settings.localModelsDir || null,
      whisper_model: whisperModel || null,
      file_name: audioFileName,
      mime_type: audioMimeType,
      streaming_enabled: isSttStreamingEnabled(settings),
      streaming_request_id: streamingRequestId ?? null,
    },
  });

  return result;
}

async function transcribeAudio({
  audioBase64,
  audioMimeType,
  audioFileName,
  settings,
  streamingRequestId,
}: {
  audioBase64: string;
  audioMimeType: string;
  audioFileName: string;
  settings: AppSettings;
  signal?: AbortSignal;
  streamingRequestId?: string | null;
}): Promise<TranscriptionResult> {
  return transcribeViaBackend({
    audioBase64,
    audioMimeType,
    audioFileName,
    settings,
    streamingRequestId,
  });
}

async function resolveFinalTranscription({
  liveTranscription,
  audioBase64,
  audioMimeType,
  audioFileName,
  settings,
  signal,
}: {
  liveTranscription: LiveTranscriptionResult | null;
  audioBase64: string;
  audioMimeType: string;
  audioFileName: string;
  settings: AppSettings;
  signal: AbortSignal;
}): Promise<TranscriptionResult> {
  const liveResult =
    liveTranscription && shouldAcceptLiveTranscription(settings, true)
      ? { raw: liveTranscription.text, cleaned: liveTranscription.text }
      : null;
  const reconciliationMode = resolveLiveTranscriptionReconciliationMode(
    settings,
    Boolean(liveResult),
  );

  if (!reconciliationMode || !liveResult) {
    return (
      liveResult ||
      transcribeAudio({
        audioBase64,
        audioMimeType,
        audioFileName,
        settings,
        signal,
      })
    );
  }

  try {
    const sourceLabel = "OpenAI";
    logInfo(
      "DICTATION_STREAM",
      `Reconciling ${sourceLabel} realtime text with full-audio batch result: realtime_chars=${liveResult.cleaned.length}`,
    );
    const batchResult = await transcribeAudio({
      audioBase64,
      audioMimeType,
      audioFileName,
      settings,
      signal,
    });
    const guardedBatch = guardTranscriptionResult(batchResult, settings.language);
    if (!guardedBatch.transcription) {
      logInfo(
        "DICTATION_STREAM",
        `Batch reconciliation rejected text: reason=${guardedBatch.rejectionReason}; keeping ${sourceLabel} realtime text`,
      );
      return liveResult;
    }
    if (guardedBatch.cleanedFallbackReason) {
      logInfo(
        "DICTATION_STREAM",
        `Batch cleanup rejected, using raw transcription: reason=${guardedBatch.cleanedFallbackReason}`,
      );
    }
    logInfo(
      "DICTATION_STREAM",
      `Batch reconciliation selected final text: source=${reconciliationMode}, batch_chars=${guardedBatch.transcription.cleaned.length}`,
    );
    return guardedBatch.transcription;
  } catch (error) {
    logError(
      "DICTATION_STREAM",
      `Batch reconciliation failed, keeping ${reconciliationMode} realtime text: ${processingErrorCode(error)}`,
    );
    return liveResult;
  }
}

/** Optional cleanup, then exactly one vocabulary pass; notices reflect both outcomes. */
export async function processDictationText(
  result: TranscriptionResult,
  settings: AppSettings,
  context: DictationCleanupContext,
  notice: typeof showCleanupNotice = showCleanupNotice,
  vocabulary: DictationVocabularyCapture = NO_VOCABULARY,
  clean: typeof cleanupDictation = cleanupDictation,
): Promise<DictationTextResult> {
  const outcome = await clean(result.raw, settings, { context });
  const cleanupApplied = outcome.applied && outcome.text !== result.raw;
  const stage = applyVocabularyStage(outcome.text, vocabulary);
  logInfo(
    "VOCABULARY",
    `event=normalize request_id=${diagnosticId(context.requestId)} status=${stage.personalization?.status ?? "disabled"} replacements=${stage.replacements} lexicon_revision=${vocabulary.snapshot.lexiconRevision} reason=${stage.failure ?? "none"}`,
  );
  if (outcome.reason === "no-backend") {
    void notice(tn("cleanup.noModel"), tn("cleanup.chooseModel"));
  }
  if (outcome.reason === "timeout" || outcome.reason === "error" || outcome.reason === "rejected") {
    void notice(tn(stage.replacements > 0 ? "cleanup.failedVocabulary" : "cleanup.failed"));
  }
  const preVocabularyText =
    outcome.text !== result.raw && outcome.text !== stage.text ? outcome.text : undefined;
  return {
    ...result,
    cleaned: stage.text,
    cleanupApplied,
    preVocabularyText,
    personalization: stage.personalization,
  };
}

/** Translates the already-normalized source; vocabulary rules never touch the translation. */
export async function applyDictationTranslation(
  result: DictationTextResult,
  settings: AppSettings,
  resolveBackend: typeof resolveSummaryBackend = resolveSummaryBackend,
): Promise<DictationTextResult> {
  if (!settings.translation.active) {
    return result;
  }

  const sourceText = result.cleaned.trim();
  if (!sourceText) {
    return result;
  }

  const backend = resolveBackend(settings);
  if (!backend) {
    throw new Error("translation text model unavailable");
  }

  const sourceLanguage = settings.language || "auto";
  const targetLanguage = settings.translation.targetLanguage;
  const prompt =
    `Переведи текст с языка "${languageLabel(sourceLanguage)}" на язык "${languageLabel(targetLanguage)}". ` +
    "Верни только перевод, без комментариев, пояснений, markdown-оберток и новых фактов. " +
    "Сохрани смысл, тон, структуру, переносы строк и форматирование исходного текста. " +
    "Если в тексте есть списки, числа, имена, ссылки или технические термины, сохрани их точно, переводя только естественный язык.";

  logInfo(
    "TRANSLATION",
    `Translating dictation via ${backend.kind}: ${sourceLanguage} -> ${targetLanguage}, chars=${sourceText.length}`,
  );

  const translatedText = (
    await backend.run({
      text: sourceText,
      prompt,
      temperature: 0.1,
    })
  ).trim();

  if (!translatedText) {
    throw new Error("translation returned empty text");
  }

  return {
    ...result,
    cleaned: translatedText,
    dictationTranslation: {
      provider: backend.kind,
      sourceLanguage,
      targetLanguage,
      sourceText,
      translatedText,
    },
  };
}

export async function runDictationStage<T>(
  context: DictationCleanupContext,
  stage: "stt" | "paste",
  work: () => Promise<T>,
  log: (message: string) => void = (message) => {
    void logInfo(stage.toUpperCase(), message);
  },
): Promise<T> {
  const started = Date.now();
  const ids = `request_id=${diagnosticId(context.requestId)} entry_id=${diagnosticId(context.entryId ?? context.requestId)}`;
  log(`event=start ${ids} stage=${stage}`);
  let outcome = "success";
  let errorCode = "none";
  try {
    return await work();
  } catch (error) {
    outcome = "error";
    errorCode = processingErrorCode(error);
    throw error;
  } finally {
    log(
      `event=end ${ids} stage=${stage} outcome=${outcome} error_code=${errorCode} ${stage}_ms=${Date.now() - started}`,
    );
  }
}

async function pasteCleanedText(text: string, context: DictationCleanupContext): Promise<void> {
  await runDictationStage(context, "paste", () => invoke<void>("paste_text", { text }));
  logInfo(
    "PASTE",
    `request_id=${diagnosticId(context.requestId)} command_completed=true target_insertion=unverified`,
  );
}

/** Final text must survive a successful paste even without a live STT session. */
export async function pasteWithDictationOverlay(
  text: string,
  context: DictationCleanupContext,
  ticker: boolean,
  stream: DictationStreamOverlaySession | null,
  paste: () => Promise<void>,
  show: typeof showWidgetTextOverlay = showWidgetTextOverlay,
): Promise<boolean> {
  const requestId = stream?.requestId ?? context.requestId;
  const safeOverlay = async (work: () => Promise<void>): Promise<void> => {
    await work().catch((error) => {
      logError(
        "DICTATION_STREAM",
        `Failed to update result overlay: ${processingErrorCode(error)}`,
      );
    });
  };
  // Late interim events must not overwrite the final result or its dismiss timer.
  stream?.dispose();
  if (ticker) {
    // Opening status admits a batch request when native state still holds an older one.
    await safeOverlay(() => show({ requestId, status: "dictating", text }));
    await safeOverlay(() => show({ requestId, status: "inserting", text }));
  } else if (stream) {
    await safeOverlay(() => stream.showInserting(text));
  }
  try {
    await paste();
    if (ticker) await safeOverlay(() => show({ requestId, status: "done", text }));
    else if (stream) await safeOverlay(() => stream.hide());
    return false;
  } catch (error) {
    logError("PASTE", `Paste failed after successful transcription: ${processingErrorCode(error)}`);
    const message = `Не удалось вставить текст автоматически: ${formatErrorMessage(error)}`;
    if (ticker) await safeOverlay(() => show({ requestId, status: "error", text, message }));
    else if (stream) await safeOverlay(() => stream.showError(text, message));
    return true;
  }
}

export async function processRecordingBlob({
  blob,
  settings,
  recordingStartTimestamp,
  liveTranscription = null,
  dictationStream = null,
  audioStats = null,
  cleanupContext,
  vocabulary = NO_VOCABULARY,
}: ProcessRecordingBlobParams): Promise<ProcessRecordingBlobResult> {
  const context: DictationCleanupContext = cleanupContext ?? {
    requestId: crypto.randomUUID(),
    trigger: "pipeline",
    globalEnabled: settings.cleanupEnabled,
    override: null,
  };
  const pipelineStarted = Date.now();
  const durationSeconds = Math.floor((Date.now() - recordingStartTimestamp) / 1000);
  if (isClearlySilentAudio(audioStats)) {
    const peak = audioStats?.peak ?? 0;
    const rms = audioStats?.rms ?? 0;
    logInfo(
      "API",
      `Skipping STT for silent recording: peak=${peak.toFixed(6)}, rms=${rms.toFixed(6)}`,
    );
    await dictationStream?.hide().catch(() => {});
    dictationStream?.dispose();
    return { durationSeconds, hasTranscription: false };
  }

  const buffer = await blob.arrayBuffer();
  const base64Audio = arrayBufferToBase64(buffer);
  const audioMimeType = blob.type || "audio/webm";
  const audioFileName = audioMimeType.includes("wav") ? "recording.wav" : "recording.webm";

  // Persist a lightweight "processing" entry up front so the recording shows as
  // a live row without keeping the audio payload in history/UI memory.
  const baseEntry: HistoryEntry = {
    id: context.requestId,
    timestamp: new Date().toISOString(),
    duration: durationSeconds,
    raw: "",
    cleaned: "",
    source: "voice",
    status: "processing",
    audioMimeType,
    audioFileName,
    language: settings.language,
    style: settings.style || "classic",
  };

  const handle = await beginProcessing(baseEntry, "add");
  const savedAudio = await saveCompletedRecordingAudio({
    entryId: baseEntry.id,
    audioBase64: base64Audio,
    audioMimeType,
    audioFileName,
    settings,
  });
  const entryWithSavedAudio: HistoryEntry = {
    ...baseEntry,
    audioPath: savedAudio.audioPath,
    audioBase64: undefined,
    audioMimeType: savedAudio.audioMimeType,
    audioFileName: savedAudio.audioFileName,
  };

  try {
    const apiStart = Date.now();
    const transcriptionCandidate = await runDictationStage(context, "stt", () =>
      resolveFinalTranscription({
        liveTranscription,
        audioBase64: base64Audio,
        audioMimeType,
        audioFileName,
        settings,
        signal: handle.signal,
      }),
    );
    if (handle.isCancelled()) {
      await dictationStream?.hide().catch(() => {});
      await finishProcessing(buildInterruptedEntry(entryWithSavedAudio));
      return { durationSeconds, hasTranscription: false };
    }

    logInfo(
      "API",
      `Pipeline result received: raw_type=${typeof transcriptionCandidate.raw}, cleaned_type=${typeof transcriptionCandidate.cleaned}`,
    );

    const guardedTranscription = guardTranscriptionResult(
      transcriptionCandidate,
      settings.language,
    );
    const transcription = guardedTranscription.transcription;
    if (!transcription) {
      logInfo(
        "API",
        `Transcription rejected, removing placeholder entry and skipping paste: reason=${guardedTranscription.rejectionReason}`,
      );
      await deleteHistoryEntry(baseEntry.id);
      if (savedAudio.audioPath) {
        await deleteHistoryAudio(savedAudio.audioPath).catch((error) => {
          logError(
            "HISTORY",
            `Failed to delete unused recording audio: ${processingErrorCode(error)}`,
          );
        });
      }
      await emit(HISTORY_DELETED_EVENT, { id: baseEntry.id });
      await dictationStream?.hide().catch(() => {});
      return { durationSeconds, hasTranscription: false };
    }
    if (guardedTranscription.cleanedFallbackReason) {
      logInfo(
        "API",
        `Cleanup output rejected, using raw transcription: reason=${guardedTranscription.cleanedFallbackReason}`,
      );
    }

    const result = await applyDictationTranslation(
      await processDictationText(
        transcription,
        settings,
        context,
        showCleanupNotice,
        await vocabulary,
      ),
      settings,
    );
    const processingTime = Date.now() - apiStart;

    if (handle.isCancelled()) {
      await dictationStream?.hide().catch(() => {});
      await finishProcessing(buildInterruptedEntry(entryWithSavedAudio));
      return { durationSeconds, hasTranscription: false };
    }

    logInfo(
      "API",
      `Transcription complete request_id=${context.requestId} processing_ms=${processingTime} chars=${result.cleaned.length}`,
    );
    await finishProcessing(
      withStatsCompletionMetadata(
        {
          ...entryWithSavedAudio,
          raw: result.raw,
          cleaned: result.cleaned,
          dictationTranslation: result.dictationTranslation,
          cleanupApplied: result.cleanupApplied,
          preVocabularyText: result.preVocabularyText,
          personalization: result.personalization,
          status: "completed",
          errorMessage: undefined,
          processingTime,
        },
        { sttModel: resolveBatchTranscriptionModel(settings), processingTime },
      ),
    );

    const pasteFailed = await pasteWithDictationOverlay(
      result.cleaned,
      context,
      settings.textDisplay === "ticker",
      dictationStream,
      () => pasteCleanedText(result.cleaned, context),
    );

    logInfo(
      "PASTE",
      pasteFailed
        ? "Automatic paste command failed; latest text remains copyable from the idle widget"
        : "Automatic paste command completed without OS-level errors",
    );
    return { durationSeconds, hasTranscription: true };
  } catch (error) {
    if (handle.isCancelled() || isAbortError(error)) {
      logInfo("API", "Processing cancelled by user; marking entry interrupted");
      await dictationStream?.hide().catch(() => {});
      await finishProcessing(buildInterruptedEntry(entryWithSavedAudio));
      return { durationSeconds, hasTranscription: false };
    }

    logError(
      "API",
      `event=error request_id=${context.requestId} error_code=${processingErrorCode(error)}`,
    );

    const userFacingErrorMessage = toUserFacingErrorMessage(error, settings);
    await dictationStream
      ?.showError(dictationStream.latestText(), userFacingErrorMessage)
      .catch((overlayError) => {
        logError(
          "DICTATION_STREAM",
          `Failed to show stream error overlay: ${processingErrorCode(overlayError)}`,
        );
      });
    await finishProcessing({
      ...entryWithSavedAudio,
      status: "failed",
      errorMessage: userFacingErrorMessage,
    });
    throw new Error(userFacingErrorMessage);
  } finally {
    logInfo(
      "API",
      `event=end request_id=${context.requestId} pipeline_total_ms=${Date.now() - pipelineStarted}`,
    );
    dictationStream?.dispose();
    handle.finish();
  }
}

function buildInterruptedEntry(entry: HistoryEntry): HistoryEntry {
  return {
    ...entry,
    status: "interrupted",
    errorMessage: tn("widget.processing.interrupted"),
  };
}

export async function retryHistoryEntry(
  entry: HistoryEntry,
  settings: AppSettings,
  options?: { shouldPaste?: boolean },
): Promise<RetryHistoryEntryResult> {
  const audioSource = await loadRecordingAudioSource(entry);

  const retrySettings: AppSettings = {
    ...settings,
    language: entry.language || settings.language,
    style: entry.style || settings.style,
  };
  const shouldPaste = options?.shouldPaste ?? false;

  // Re-runs go through the same lifecycle: shown as "processing" again and
  // cancellable from the table.
  const handle = await beginProcessing(entry, "update");
  const retryStarted = Date.now();
  // A retry is a new attempt and applies the vocabulary as it is now.
  const vocabulary = captureDictationVocabulary(retrySettings.language);
  const context: DictationCleanupContext = {
    requestId: crypto.randomUUID(),
    entryId: entry.id,
    trigger: "retry",
    globalEnabled: retrySettings.cleanupEnabled,
    override: null,
  };

  try {
    const transcriptionCandidate = await runDictationStage(context, "stt", () =>
      transcribeAudio({
        audioBase64: audioSource.audioBase64,
        audioMimeType: audioSource.audioMimeType,
        audioFileName: audioSource.audioFileName,
        settings: retrySettings,
        signal: handle.signal,
      }),
    );
    if (handle.isCancelled()) {
      const interrupted = buildInterruptedEntry(entry);
      await finishProcessing(interrupted);
      return { hasTranscription: false, updatedEntry: interrupted };
    }

    const guardedTranscription = guardTranscriptionResult(
      transcriptionCandidate,
      retrySettings.language,
    );
    const transcription = guardedTranscription.transcription;
    if (!transcription) {
      logInfo(
        "API",
        `Retry transcription rejected: reason=${guardedTranscription.rejectionReason}`,
      );
      throw new Error(tn("widget.error.speechNotRecognized"));
    }
    if (guardedTranscription.cleanedFallbackReason) {
      logInfo(
        "API",
        `Retry cleanup output rejected, using raw transcription: reason=${guardedTranscription.cleanedFallbackReason}`,
      );
    }

    const result = await applyDictationTranslation(
      await processDictationText(
        transcription,
        retrySettings,
        context,
        showCleanupNotice,
        await vocabulary,
      ),
      retrySettings,
    );
    const processingTime = Date.now() - retryStarted;

    if (handle.isCancelled()) {
      const interrupted = buildInterruptedEntry(entry);
      await finishProcessing(interrupted);
      return { hasTranscription: false, updatedEntry: interrupted };
    }

    const savedAudio =
      entry.audioPath && settings.saveRecordingAudio
        ? {
            audioPath: entry.audioPath,
            audioMimeType: entry.audioMimeType || audioSource.audioMimeType,
            audioFileName: entry.audioFileName || audioSource.audioFileName,
          }
        : await saveCompletedRecordingAudio({
            entryId: entry.id,
            ...audioSource,
            settings,
          });

    const updatedEntry: HistoryEntry = withStatsCompletionMetadata(
      {
        ...entry,
        raw: result.raw,
        cleaned: result.cleaned,
        dictationTranslation: result.dictationTranslation,
        cleanupApplied: result.cleanupApplied,
        preVocabularyText: result.preVocabularyText,
        personalization: result.personalization,
        status: "completed",
        errorMessage: undefined,
        audioPath: savedAudio.audioPath,
        audioBase64: undefined,
        audioMimeType: savedAudio.audioMimeType,
        audioFileName: savedAudio.audioFileName,
      },
      { sttModel: resolveBatchTranscriptionModel(retrySettings), processingTime },
    );

    await finishProcessing(updatedEntry);
    if (!settings.saveRecordingAudio && entry.audioPath) {
      await deleteHistoryAudio(entry.audioPath).catch((error) => {
        logError(
          "HISTORY",
          `Failed to delete disabled recording audio: ${processingErrorCode(error)}`,
        );
      });
    }

    if (shouldPaste) {
      try {
        await pasteCleanedText(result.cleaned, context);
      } catch (pasteError) {
        logError("PASTE", `Retry paste failed: ${processingErrorCode(pasteError)}`);
      }
    }

    return {
      hasTranscription: true,
      updatedEntry,
    };
  } catch (error) {
    if (handle.isCancelled() || isAbortError(error)) {
      const interrupted = buildInterruptedEntry(entry);
      await finishProcessing(interrupted);
      return { hasTranscription: false, updatedEntry: interrupted };
    }

    const userFacingErrorMessage = toUserFacingErrorMessage(error, retrySettings);
    const failedEntry: HistoryEntry = {
      ...entry,
      status: "failed",
      errorMessage: userFacingErrorMessage,
    };

    await finishProcessing(failedEntry);
    throw new Error(userFacingErrorMessage);
  } finally {
    logInfo(
      "API",
      `event=end request_id=${context.requestId} entry_id=${entry.id} pipeline_total_ms=${Date.now() - retryStarted}`,
    );
    handle.finish();
  }
}
