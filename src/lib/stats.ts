import { emit } from "@tauri-apps/api/event";
import { load } from "@tauri-apps/plugin-store";

import { logError } from "./logger";
import { createSerialTaskQueue } from "./serialTaskQueue";
import {
  applyTranscriptionToStats,
  getEmptyView,
  isUnknownStatModel,
  normalizeStats,
  type StatInput,
  statsToView,
  type TranscriptionStats,
  type TranscriptionStatsView,
} from "./statsCore";
import type { HistoryEntry } from "./store";

export type { TranscriptionStats, TranscriptionStatsView } from "./statsCore";

/** Broadcast after stats change so open windows (e.g. the homepage) refresh. */
export const STATS_UPDATED_EVENT = "stats-updated";

// Stored under its own key in the shared store, separate from `settings` and
// `history`, so it survives history pruning and "clear history". Exported so a
// test can prove that separation instead of merely describing it.
export const STATS_STORE_FILE = "talkee.json";
export const STATS_KEY = "stats";

/**
 * Field the writer stamps on a history entry once its words have reached the
 * aggregates. It is the durable half of the de-duplication: the in-memory ring
 * of counted ids only remembers the last `COUNTED_IDS_LIMIT` transcriptions, so
 * without a receipt a re-finalized entry would be counted again as soon as its
 * id fell out of the window.
 */
export const STATS_RECEIPT_FIELD = "statsReceipt";

export interface StatsReceipt {
  /** Only successful completions are accumulated, so this is always "completed". */
  status: "completed";
  /** ISO timestamp of the accumulation. */
  countedAt: string;
}

/**
 * Bookkeeping the stats layer keeps on a history entry: the counted receipt and
 * the STT model captured at completion time (never resolved from today's
 * settings later, which would mislabel an old recording).
 */
export interface StatsEntryMetadata {
  statsReceipt?: StatsReceipt;
  /** STT model used for this transcription, captured when it completed. */
  sttModel?: string;
}

/** Options for {@link recordTranscriptionStats}. */
export interface RecordTranscriptionStatsOptions {
  /**
   * Terminal status of the entry that was stored BEFORE this write. A previous
   * "completed" means the words were already accumulated, so a later write of
   * the same entry (summary added, retry of the UI flow, ...) is a no-op even
   * when the id is no longer in the counted-ids ring.
   */
  previousStatus?: HistoryEntry["status"];
}

function metadataOf(entry: HistoryEntry | null | undefined): StatsEntryMetadata {
  return (entry ?? {}) as StatsEntryMetadata;
}

/** Read the counted receipt attached to an entry, if any. */
export function readStatsReceipt(entry: HistoryEntry | null | undefined): StatsReceipt | null {
  const raw = metadataOf(entry)[STATS_RECEIPT_FIELD];
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const receipt = raw as Partial<StatsReceipt>;
  if (receipt.status !== "completed" || typeof receipt.countedAt !== "string") {
    return null;
  }

  return { status: "completed", countedAt: receipt.countedAt };
}

export function hasStatsReceipt(entry: HistoryEntry | null | undefined): boolean {
  return readStatsReceipt(entry) !== null;
}

/**
 * Attach a counted receipt to an entry. Mutates in place on purpose: callers
 * that keep the same object (widget runtime, retry flows) are then protected
 * even before the receipt is persisted, and the returned reference can be
 * written back to history to make it durable.
 */
export function attachStatsReceipt<T extends HistoryEntry>(entry: T, receipt: StatsReceipt): T {
  metadataOf(entry)[STATS_RECEIPT_FIELD] = receipt;
  return entry;
}

/** STT model captured on the entry at completion time, if the runner set one. */
export function entrySttModel(entry: HistoryEntry | null | undefined): string | undefined {
  const metadata = metadataOf(entry) as StatsEntryMetadata & { model?: unknown };
  const candidates = [metadata.sttModel, metadata.model];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return undefined;
}

/**
 * i18n key a model bucket should be labelled with, or `null` when the key is a
 * real model name that the UI shows as-is.
 */
export function statModelLabelKey(model: string): "stats.model.unknown" | null {
  return isUnknownStatModel(model) ? "stats.model.unknown" : null;
}

/**
 * Stamp completion-time metrics on an entry before it is persisted.
 *
 * The widget / file / call runners must call this with the model that actually
 * ran: reading `settings.whisperModel` later (when the stats are read) would
 * attribute an old transcription to whatever model is configured today.
 */
export function withStatsCompletionMetadata<T extends HistoryEntry>(
  entry: T,
  completion: { sttModel?: string; processingTime?: number },
): T {
  const metadata = metadataOf(entry);
  if (typeof completion.sttModel === "string" && completion.sttModel.trim()) {
    metadata.sttModel = completion.sttModel.trim();
  }
  if (
    typeof completion.processingTime === "number" &&
    Number.isFinite(completion.processingTime) &&
    completion.processingTime > 0
  ) {
    entry.processingTime = completion.processingTime;
  }
  return entry;
}

/**
 * Measured processing time in seconds, or `undefined` when the runner never
 * measured it. Statistics must not turn a missing measurement into a zero.
 */
export function processingSecondsOf(entry: HistoryEntry | null | undefined): number | undefined {
  const ms = entry?.processingTime;
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) {
    return undefined;
  }
  return ms / 1000;
}

/** Map a history entry onto the pure stats input. */
export function toStatInput(entry: HistoryEntry): StatInput {
  return {
    id: entry.id,
    text: entry.cleaned ?? "",
    source: entry.source,
    durationSec: typeof entry.duration === "number" && entry.duration > 0 ? entry.duration : 0,
    timestamp: entry.timestamp,
    status: entry.status,
    model: entrySttModel(entry),
    processingSec: processingSecondsOf(entry),
  };
}

/**
 * Whether this entry still has to reach the aggregates. Exported so the writer,
 * the tests and any runner share exactly one rule.
 */
export function shouldCountEntry(
  entry: HistoryEntry | null | undefined,
  options: RecordTranscriptionStatsOptions = {},
): boolean {
  if (!entry) {
    return false;
  }
  // Only finished, successful transcriptions count.
  if (entry.status !== undefined && entry.status !== "completed") {
    return false;
  }
  if (!entry.cleaned?.trim()) {
    return false;
  }
  if (hasStatsReceipt(entry)) {
    return false;
  }
  if (options.previousStatus === "completed") {
    return false;
  }
  return true;
}

/** Storage seams of the stats writer, injectable so tests need no Tauri store. */
export interface StatsWriterDeps {
  read(): Promise<TranscriptionStats>;
  write(next: TranscriptionStats): Promise<void>;
}

export type StatsWriter = (
  entry: HistoryEntry,
  options?: RecordTranscriptionStatsOptions,
) => Promise<HistoryEntry>;

/**
 * Build the single serialized stats writer.
 *
 * Every read-modify-write runs inside one queue, so concurrent record calls
 * (voice + file + call finishing at the same moment) can never lose an update
 * by reading the same snapshot twice. The queue also keeps going after a failed
 * task, which is what makes statistics unable to break the history pipeline.
 */
export function createStatsWriter(deps: StatsWriterDeps): StatsWriter {
  const queue = createSerialTaskQueue();

  return (entry, options = {}) =>
    queue.enqueue(async () => {
      if (!shouldCountEntry(entry, options)) {
        return entry;
      }

      const current = await deps.read();
      const alreadyCounted = current.countedIds.includes(entry.id);
      const next = applyTranscriptionToStats(current, toStatInput(entry));

      if (next === current) {
        // Not accumulated now: either it was already inside the counted-ids
        // ring (receipt it so the guarantee survives the window) or the entry
        // carried no countable words at all (leave it alone).
        return alreadyCounted
          ? attachStatsReceipt(entry, { status: "completed", countedAt: current.updatedAt })
          : entry;
      }

      await deps.write(next);
      return attachStatsReceipt(entry, { status: "completed", countedAt: next.updatedAt });
    });
}

let _store: Awaited<ReturnType<typeof load>> | null = null;

async function statsStore() {
  if (!_store) {
    _store = await load(STATS_STORE_FILE);
  }
  return _store;
}

export async function getTranscriptionStats(): Promise<TranscriptionStats> {
  try {
    const store = await statsStore();
    const raw = await store.get<Partial<TranscriptionStats>>(STATS_KEY);
    return normalizeStats(raw);
  } catch (error) {
    void logError(
      "STATS",
      `Failed to read stats: ${error instanceof Error ? error.message : String(error)}`,
    );
    return normalizeStats(null);
  }
}

export async function getTranscriptionStatsView(): Promise<TranscriptionStatsView> {
  return statsToView(await getTranscriptionStats());
}

/** View shown before stats have loaded (all zeros, no speed yet). */
export { getEmptyView };

async function persistStats(next: TranscriptionStats): Promise<void> {
  const store = await statsStore();
  await store.set(STATS_KEY, next);
  await store.save();
  await emit(STATS_UPDATED_EVENT);
}

// One writer for the whole app: all stats mutations funnel through this queue.
const writeStats = createStatsWriter({
  read: getTranscriptionStats,
  write: persistStats,
});

/**
 * Record a completed transcription into the running totals.
 *
 * De-duplicates by receipt (durable), previous terminal status and the counted
 * ids ring; ignores failed/empty entries; never throws — statistics must not be
 * able to break the transcription or history pipeline.
 *
 * Returns the entry it was given, with a counted receipt attached when the
 * words reached the aggregates. Callers that persist history should store the
 * returned entry so the receipt survives the in-memory id window.
 */
export async function recordTranscriptionStats(
  entry: HistoryEntry,
  options: RecordTranscriptionStatsOptions = {},
): Promise<HistoryEntry> {
  try {
    return await writeStats(entry, options);
  } catch (error) {
    void logError(
      "STATS",
      `Failed to record stats: ${error instanceof Error ? error.message : String(error)}`,
    );
    return entry;
  }
}
