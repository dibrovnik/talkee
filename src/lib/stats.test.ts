import { describe, expect, it } from "bun:test";

import {
  attachStatsReceipt,
  createStatsWriter,
  entrySttModel,
  processingSecondsOf,
  readStatsReceipt,
  recordTranscriptionStats,
  shouldCountEntry,
  statModelLabelKey,
  toStatInput,
  withStatsCompletionMetadata,
} from "./stats";
import {
  applyTranscriptionToStats,
  COUNTED_IDS_LIMIT,
  createEmptyStats,
  type TranscriptionStats,
  UNKNOWN_MODEL_KEY,
} from "./statsCore";
import type { HistoryEntry } from "./store";

function entry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: "id-1",
    timestamp: "2026-06-21T10:00:00.000Z",
    duration: 30,
    raw: "one two three",
    cleaned: "one two three",
    source: "voice",
    status: "completed",
    ...overrides,
  };
}

/** Writer wired to an in-memory stats blob instead of the Tauri store. */
function memoryWriter(): {
  write: ReturnType<typeof createStatsWriter>;
  read: () => TranscriptionStats;
  reads: () => number;
} {
  let state = createEmptyStats();
  let reads = 0;
  const write = createStatsWriter({
    read: async () => {
      reads += 1;
      await Promise.resolve();
      return state;
    },
    write: async (next) => {
      await Promise.resolve();
      state = next;
    },
  });

  return { write, read: () => state, reads: () => reads };
}

describe("toStatInput", () => {
  it("captures the model and the processing time from the entry", () => {
    const input = toStatInput(
      withStatsCompletionMetadata(entry({ id: "a", processingTime: undefined }), {
        sttModel: "whisper-large-v3",
        processingTime: 5200,
      }),
    );

    expect(input.model).toBe("whisper-large-v3");
    expect(input.processingSec).toBeCloseTo(5.2, 5);
    expect(input.status).toBe("completed");
    expect(input.source).toBe("voice");
  });

  it("leaves a missing measurement missing instead of inventing a zero", () => {
    expect(processingSecondsOf(entry({ processingTime: undefined }))).toBeUndefined();
    expect(processingSecondsOf(entry({ processingTime: 0 }))).toBeUndefined();
    expect(processingSecondsOf(entry({ processingTime: Number.NaN }))).toBeUndefined();
    expect(toStatInput(entry({ id: "b" })).processingSec).toBeUndefined();
    expect(toStatInput(entry({ id: "b" })).model).toBeUndefined();
    expect(entrySttModel(entry({ id: "b" }))).toBeUndefined();
  });

  it("keeps a non-positive duration out of the audio measurement", () => {
    expect(toStatInput(entry({ id: "c", duration: 0 })).durationSec).toBe(0);
    expect(toStatInput(entry({ id: "c", duration: 30 })).durationSec).toBe(30);
  });
});

describe("shouldCountEntry", () => {
  it("only accepts successful, non-empty entries", () => {
    expect(shouldCountEntry(entry())).toBe(true);
    expect(shouldCountEntry(entry({ status: "processing" }))).toBe(false);
    expect(shouldCountEntry(entry({ status: "failed" }))).toBe(false);
    expect(shouldCountEntry(entry({ status: "interrupted" }))).toBe(false);
    expect(shouldCountEntry(entry({ cleaned: "   " }))).toBe(false);
    expect(shouldCountEntry(null)).toBe(false);
  });

  it("skips entries that already carry a receipt", () => {
    const counted = attachStatsReceipt(entry(), { status: "completed", countedAt: "2026-06-21" });
    expect(readStatsReceipt(counted)?.countedAt).toBe("2026-06-21");
    expect(shouldCountEntry(counted)).toBe(false);
  });

  it("skips a repeat finalization of a previously completed entry", () => {
    expect(shouldCountEntry(entry({ id: "retry" }), { previousStatus: "completed" })).toBe(false);
    expect(shouldCountEntry(entry({ id: "retry" }), { previousStatus: "failed" })).toBe(true);
    expect(shouldCountEntry(entry({ id: "retry" }), { previousStatus: "processing" })).toBe(true);
    expect(shouldCountEntry(entry({ id: "retry" }), { previousStatus: undefined })).toBe(true);
  });
});

describe("createStatsWriter", () => {
  it("serializes concurrent updates without losing any of them", async () => {
    const { write, read, reads } = memoryWriter();
    const entries = Array.from({ length: 40 }, (_, index) =>
      entry({ id: `concurrent-${index}`, cleaned: "one two" }),
    );

    await Promise.all(entries.map((item) => write(item)));

    expect(read().allTimeWords).toBe(80);
    expect(read().breakdown["2026-06-21"]?.voice?.unknown?.completedCount).toBe(40);
    // Every call re-read the blob inside the queue: no stale snapshot reused.
    expect(reads()).toBe(40);
  });

  it("counts a concurrent duplicate finalization only once", async () => {
    const { write, read } = memoryWriter();
    const completed = entry({ id: "duplicate", cleaned: "one two" });

    await Promise.all([write(completed), write({ ...completed }), write({ ...completed })]);

    expect(read().allTimeWords).toBe(2);
    expect(read().breakdown["2026-06-21"]?.voice?.unknown?.completedCount).toBe(1);
    expect(readStatsReceipt(completed)).not.toBeNull();
  });

  it("does not count a re-finalized entry after its id left the 600-id window", async () => {
    const { write, read } = memoryWriter();
    const completed = entry({ id: "completed-entry", cleaned: "alpha beta" });

    await write(completed);
    expect(read().allTimeWords).toBe(2);
    expect(readStatsReceipt(completed)).not.toBeNull();

    for (let index = 0; index < COUNTED_IDS_LIMIT + 25; index += 1) {
      await write(entry({ id: `filler-${index}`, cleaned: "x" }));
    }
    const fillerWords = COUNTED_IDS_LIMIT + 25;
    expect(read().countedIds).not.toContain("completed-entry");

    // 1) the same object the widget still holds (receipt attached in place)
    await write(completed);
    // 2) a fresh object rebuilt from persisted history (receipt survived)
    await write({ ...completed });
    // 3) no receipt, but the previous stored status was already "completed"
    await write(entry({ id: "completed-entry", cleaned: "alpha beta" }), {
      previousStatus: "completed",
    });

    expect(read().allTimeWords).toBe(fillerWords + 2);
    expect(read().breakdown["2026-06-21"]?.voice?.unknown?.completedCount).toBe(fillerWords + 1);
  });

  it("would recount without a receipt once the id window is exceeded", async () => {
    const { write, read } = memoryWriter();
    await write(entry({ id: "window-only", cleaned: "alpha beta" }));

    for (let index = 0; index < COUNTED_IDS_LIMIT + 5; index += 1) {
      await write(entry({ id: `filler-${index}`, cleaned: "x" }));
    }

    // Documents why the receipt exists: the ring alone forgets.
    await write(entry({ id: "window-only", cleaned: "alpha beta" }));
    // 2 initial words + one filler word each + the recounted 2 words.
    expect(read().allTimeWords).toBe(2 + (COUNTED_IDS_LIMIT + 5) + 2);
  });

  it("keeps working after a failed write", async () => {
    let state = createEmptyStats();
    let failWrites = true;
    const write = createStatsWriter({
      read: async () => state,
      write: async (next) => {
        if (failWrites) {
          throw new Error("store unavailable");
        }
        state = next;
      },
    });

    await expect(write(entry({ id: "boom" }))).rejects.toThrow("store unavailable");

    failWrites = false;
    const recorded = await write(entry({ id: "after-failure" }));
    expect(readStatsReceipt(recorded)).not.toBeNull();
    expect(state.allTimeWords).toBe(3);
  });

  it("ignores failed and empty entries", async () => {
    const { write, read } = memoryWriter();
    await write(entry({ id: "failed", status: "failed" }));
    await write(entry({ id: "empty", cleaned: "" }));
    expect(read().allTimeWords).toBe(0);
    expect(read().breakdown).toEqual({});
  });
});

describe("stats storage separation", () => {
  it("lives in its own key, so clearing history cannot delete the aggregates", async () => {
    const { STATS_KEY, STATS_STORE_FILE } = await import("./stats");
    expect(STATS_KEY).toBe("stats");
    expect(STATS_STORE_FILE).toBe("talkee.json");

    // Clearing history goes through `write_history_file`, i.e. only the history
    // key/file. The stats key is therefore untouched by design, and the test
    // pins that: if someone ever writes the aggregates into the history payload,
    // the key check below fails.
    const storeSource = await Bun.file(new URL("./store.ts", import.meta.url)).text();
    const clearHistoryBody = storeSource.slice(
      storeSource.indexOf("export async function clearHistory"),
    );
    expect(clearHistoryBody.slice(0, 400)).not.toContain(STATS_KEY);
    expect(clearHistoryBody.slice(0, 400)).toContain("writeHistory([])");
  });
});

describe("recordTranscriptionStats", () => {
  it("never throws when the store is unavailable", async () => {
    const completed = entry({ id: "no-store", cleaned: "one two three" });
    const result = await recordTranscriptionStats(completed);
    // Statistics failures must not break the history pipeline.
    expect(result).toBe(completed);
  });
});

describe("stats receipts", () => {
  it("ignores malformed receipts", () => {
    // Deliberately malformed on-disk data: the reader must reject it, so the
    // test bypasses the typed field on purpose.
    const broken = entry() as unknown as Record<string, unknown>;
    broken.statsReceipt = { status: "failed", countedAt: "2026-06-21" };
    expect(readStatsReceipt(broken as unknown as HistoryEntry)).toBeNull();
    broken.statsReceipt = "counted";
    expect(readStatsReceipt(broken as unknown as HistoryEntry)).toBeNull();
  });

  it("keeps the model captured at completion time", () => {
    const completed = withStatsCompletionMetadata(entry({ id: "d" }), {
      sttModel: "  whisper-small  ",
    });
    expect(entrySttModel(completed)).toBe("whisper-small");
    expect(entrySttModel(entry({ id: "d" }))).toBeUndefined();
  });

  it("labels the unknown model bucket through an i18n key", () => {
    expect(statModelLabelKey(UNKNOWN_MODEL_KEY)).toBe("stats.model.unknown");
    expect(statModelLabelKey("whisper-large-v3")).toBeNull();
  });

  it("feeds completed voice rows into the aggregate buckets", () => {
    const input = toStatInput(
      withStatsCompletionMetadata(entry({ id: "e", duration: 30 }), {
        sttModel: "whisper-1",
        processingTime: 5000,
      }),
    );
    const next = applyTranscriptionToStats(createEmptyStats(), input);
    expect(next.breakdown["2026-06-21"]?.voice?.["whisper-1"]?.processingSec).toBe(5);
    expect(next.voiceCost.voiceWords).toBe(3);
  });
});
