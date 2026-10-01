import type { FileTranscriptionProgress, FileTranscriptionResult } from "./fileTranscription";
import { logError } from "./logger";
import { createSerialTaskQueue } from "./serialTaskQueue";

/** Only paths and user options cross webviews; credentials stay with the owner. */
export interface FileJobRequest {
  jobId: string;
  filePath: string;
  mode: "plain" | "speakers";
  identifyFirstSpeakerAsUser?: boolean;
  retryEntryId?: string;
}

export type FileJobState = "queued" | "running" | "completed" | "failed" | "interrupted";

export interface FileJobSnapshot {
  request: FileJobRequest;
  state: FileJobState;
  createdAt: number;
  revision: number;
  startedAt?: number;
  finishedAt?: number;
  progress?: FileTranscriptionProgress;
  result?: FileTranscriptionResult;
  error?: string;
}

export interface FileJobExecution {
  signal: AbortSignal;
  progress: (progress: FileTranscriptionProgress) => void;
}

export interface FileJobOwner {
  start: (request: FileJobRequest) => FileJobSnapshot;
  cancel: (jobId: string) => boolean;
  snapshot: () => FileJobSnapshot[];
}

/** Widget-owned lifetime. Cancellation does not start a second native inference. */
export function createFileJobOwner(
  execute: (
    request: FileJobRequest,
    execution: FileJobExecution,
  ) => Promise<FileTranscriptionResult>,
  publish: (snapshot: FileJobSnapshot) => void,
): FileJobOwner {
  const queue = createSerialTaskQueue();
  const jobs = new Map<string, FileJobSnapshot>();
  const controllers = new Map<string, AbortController>();
  const notify = (job: FileJobSnapshot): void => {
    job.revision += 1;
    try {
      publish(structuredClone(job));
    } catch (error) {
      logError("FILE_JOBS", `Failed to publish job update: ${String(error)}`);
    }
  };

  return {
    snapshot: () => structuredClone([...jobs.values()]),
    start(request) {
      if (
        typeof request.jobId !== "string" ||
        !request.jobId.trim() ||
        request.jobId.length > 128 ||
        typeof request.filePath !== "string" ||
        !request.filePath.trim() ||
        request.filePath.length > 16384 ||
        request.filePath.includes("\0") ||
        (request.mode !== "plain" && request.mode !== "speakers")
      ) {
        throw new Error("Для обработки нужен путь к файлу и ID задачи.");
      }
      const existing = jobs.get(request.jobId);
      if (existing) return structuredClone(existing);
      const job: FileJobSnapshot = {
        request: {
          jobId: request.jobId,
          filePath: request.filePath,
          mode: request.mode,
          identifyFirstSpeakerAsUser: request.identifyFirstSpeakerAsUser === true,
          retryEntryId:
            typeof request.retryEntryId === "string" && request.retryEntryId.length <= 128
              ? request.retryEntryId
              : undefined,
        },
        state: "queued",
        createdAt: Date.now(),
        revision: 0,
      };
      const controller = new AbortController();
      jobs.set(request.jobId, job);
      controllers.set(request.jobId, controller);
      notify(job);
      void queue
        .enqueue(async () => {
          if (controller.signal.aborted) return;
          job.state = "running";
          job.startedAt = Date.now();
          notify(job);
          try {
            const result = await execute(job.request, {
              signal: controller.signal,
              progress(progress) {
                if (controller.signal.aborted) return;
                job.progress = structuredClone(progress);
                notify(job);
              },
            });
            if (controller.signal.aborted) return;
            job.result = structuredClone(result);
            job.state = "completed";
          } catch (error) {
            if (controller.signal.aborted) return;
            job.state = "failed";
            job.error = error instanceof Error ? error.message : String(error);
          } finally {
            job.finishedAt ??= Date.now();
            controllers.delete(request.jobId);
            notify(job);
          }
        })
        .catch((error) => logError("FILE_JOBS", `Job queue failed: ${String(error)}`));
      return structuredClone(job);
    },
    cancel(jobId) {
      const job = jobs.get(jobId);
      const controller = controllers.get(jobId);
      if (!job || !controller || (job.state !== "queued" && job.state !== "running")) return false;
      controller.abort();
      job.state = "interrupted";
      job.finishedAt = Date.now();
      if (!job.startedAt) controllers.delete(jobId);
      notify(job);
      return true;
    },
  };
}

/** Owner-only execution: load settings here, persist before inference, retain source path. */
export async function executeFileJob(
  request: FileJobRequest,
  execution: FileJobExecution,
): Promise<FileTranscriptionResult> {
  const { beginProcessing, cancelProcessing, finishProcessing } = await import(
    "./processingControl"
  );
  const { getSettings, getHistoryEntry } = await import("./store");
  const { fileNameFromPath, transcribeFilePathOnly, toFileTranscriptionErrorMessage } =
    await import("./fileTranscription");
  const previous = request.retryEntryId ? await getHistoryEntry(request.retryEntryId) : null;
  const base: import("./store").HistoryEntry = {
    ...previous,
    id: request.retryEntryId || request.jobId,
    timestamp: previous?.timestamp || new Date().toISOString(),
    duration: previous?.duration || 0,
    raw: previous?.raw || "",
    cleaned: previous?.cleaned || "",
    source: "file",
    fileName: fileNameFromPath(request.filePath),
    filePath: request.filePath,
    status: "processing",
  };
  const handle = await beginProcessing(base, previous ? "update" : "add");
  const cancel = (): void => {
    void cancelProcessing(base.id).catch((error) =>
      logError("FILE_JOBS", `Cancellation failed: ${String(error)}`),
    );
  };
  execution.signal.addEventListener("abort", cancel, { once: true });
  const started = Date.now();
  const aborted = (): boolean => execution.signal.aborted || handle.isCancelled();
  try {
    if (aborted()) throw new DOMException("Обработка прервана", "AbortError");
    const settings = await getSettings({ reload: true });
    if (aborted()) throw new DOMException("Обработка прервана", "AbortError");
    const result = await transcribeFilePathOnly({
      filePath: request.filePath,
      settings,
      speakerDiarization: request.mode === "speakers",
      identifyFirstSpeakerAsUser: request.identifyFirstSpeakerAsUser,
      onProgress: execution.progress,
    });
    if (aborted()) throw new DOMException("Обработка прервана", "AbortError");
    await finishProcessing({
      ...base,
      raw: result.text,
      cleaned: result.text,
      status: "completed",
      errorMessage: undefined,
      processingTime: Date.now() - started,
      mode: result.mode,
      speakers: result.speakers,
      segments: result.segments,
    });
    if (aborted()) throw new DOMException("Обработка прервана", "AbortError");
    return result;
  } catch (error) {
    await finishProcessing({
      ...base,
      status: aborted() ? "interrupted" : "failed",
      errorMessage: aborted() ? "Обработка прервана" : toFileTranscriptionErrorMessage(error),
      processingTime: Date.now() - started,
    });
    throw error;
  } finally {
    execution.signal.removeEventListener("abort", cancel);
    handle.finish();
  }
}
