import { expect, test } from "bun:test";
import { applyTranscriptionToStats, createEmptyStats, type StatInput } from "../lib/statsCore";
import { transcriptionStatsView } from "./transcriptionStatsView";

const now = new Date(2026, 9, 5, 12);
const voice: StatInput = {
  id: "voice",
  text: Array(120).fill("word").join(" "),
  source: "voice",
  durationSec: 30,
  processingSec: 10,
  timestamp: now.toISOString(),
  status: "completed",
};

test("home compares measured dictation including processing, never files or missing data", () => {
  let stats = applyTranscriptionToStats(createEmptyStats(), voice);
  stats = applyTranscriptionToStats(stats, { ...voice, id: "file", source: "file" });
  const view = transcriptionStatsView(stats, 60, now);
  expect(view.todayWords).toBe(240);
  expect(view.savings.savingsSec).toBe(80);
  expect(view.speedRatio).toBe(3);
  expect(view.activeDays).toBe(1);
  expect(transcriptionStatsView(stats, undefined, now).speedRatio).toBeUndefined();
  expect(transcriptionStatsView(createEmptyStats(), 60, now).savings.status).toBe("no-data");
  const incomplete = applyTranscriptionToStats(stats, {
    ...voice,
    id: "incomplete",
    processingSec: undefined,
  });
  expect(transcriptionStatsView(incomplete, 60, now).savings.status).toBe("incomplete");
  expect(transcriptionStatsView(incomplete, 60, now).speedRatio).toBe(3);
  expect(transcriptionStatsView(stats, 250, now).speedRatio).toBeLessThan(1);
});

test("active days use the last seven local calendar days, not an all-time streak", () => {
  const stats = createEmptyStats();
  stats.dailyWords = {
    "2026-09-28": 10,
    "2026-09-29": 10,
    "2026-10-01": 0,
    "2026-10-04": 15,
    "2026-10-05": 20,
    "2026-10-06": 30,
  };
  expect(transcriptionStatsView(stats, undefined, now).activeDays).toBe(3);
});
