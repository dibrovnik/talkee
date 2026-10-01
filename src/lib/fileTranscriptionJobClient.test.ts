import { expect, test } from "bun:test";
import { mergeFileJobSnapshots } from "./fileTranscriptionJobClient";
import type { FileJobSnapshot } from "./fileTranscriptionJobs";

test("late snapshot does not revert live progress or terminal state", () => {
  const job: FileJobSnapshot = {
    request: { jobId: "a", filePath: "/tmp/a.mp4", mode: "plain" },
    state: "completed",
    createdAt: 1,
    revision: 4,
  };
  const queued = { ...job, state: "queued" as const, revision: 1 };
  expect(mergeFileJobSnapshots([job], [queued, queued])).toEqual([job]);
  expect(mergeFileJobSnapshots([], [queued, job])).toEqual([job]);
});
