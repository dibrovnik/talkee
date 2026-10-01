import { expect, test } from "bun:test";
import type { FileTranscriptionResult } from "./fileTranscription";
import {
  createFileJobOwner,
  type FileJobExecution,
  type FileJobSnapshot,
} from "./fileTranscriptionJobs";

const result: FileTranscriptionResult = {
  text: "Проверка",
  converted: false,
  uploadedFileName: "test.wav",
  uploadedSizeBytes: 1,
  mode: "plain",
};
const request = (jobId: string) => ({
  jobId,
  filePath: `/tmp/${jobId}.wav`,
  mode: "plain" as const,
});
const settle = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

test("single owner deduplicates IDs, queues, exposes detached snapshots and survives failure", async () => {
  const updates: FileJobSnapshot[] = [];
  const started: string[] = [];
  let resolve!: (value: FileTranscriptionResult) => void;
  const owner = createFileJobOwner(
    async (job) => {
      started.push(job.jobId);
      if (job.jobId === "a")
        return new Promise((done) => {
          resolve = done;
        });
      if (job.jobId === "b") throw new Error("Ошибка распознавания");
      return result;
    },
    (job) => updates.push(job),
  );
  owner.start(request("a"));
  owner.start(request("a"));
  owner.start(request("b"));
  owner.start(request("c"));
  await settle();
  expect(started).toEqual(["a"]);
  const snapshot = owner.snapshot();
  expect(snapshot.map((job) => job.state)).toEqual(["running", "queued", "queued"]);
  snapshot[0].request.filePath = "tampered";
  expect(owner.snapshot()[0].request.filePath).toBe("/tmp/a.wav");
  resolve(result);
  await settle();
  expect(started).toEqual(["a", "b", "c"]);
  expect(owner.snapshot().map((job) => job.state)).toEqual(["completed", "failed", "completed"]);
  owner.start(request("a"));
  expect(started).toEqual(["a", "b", "c"]);
  expect(
    updates.filter((job) => job.state === "completed" && job.request.jobId === "a"),
  ).toHaveLength(1);
});

test("cancel ignores late progress/success and does not overlap native processing", async () => {
  let resolve!: (value: FileTranscriptionResult) => void;
  let execution!: FileJobExecution;
  const started: string[] = [];
  const owner = createFileJobOwner(
    async (job, context) => {
      started.push(job.jobId);
      if (job.jobId === "a") {
        execution = context;
        return new Promise((done) => {
          resolve = done;
        });
      }
      return result;
    },
    () => {},
  );
  owner.start(request("a"));
  owner.start(request("b"));
  owner.start(request("c"));
  await settle();
  expect(owner.cancel("a")).toBe(true);
  expect(owner.cancel("b")).toBe(true);
  expect(execution.signal.aborted).toBe(true);
  execution.progress({ status: "done", currentChunk: 1, totalChunks: 1, message: "late" });
  await settle();
  expect(started).toEqual(["a"]);
  resolve(result);
  await settle();
  expect(started).toEqual(["a", "c"]);
  expect(owner.snapshot().map((job) => job.state)).toEqual([
    "interrupted",
    "interrupted",
    "completed",
  ]);
  expect(owner.snapshot()[0].result).toBeUndefined();
  expect(owner.snapshot()[0].progress).toBeUndefined();
  expect(owner.cancel("c")).toBe(false);
  expect(() => owner.start(request(" "))).toThrow();
});

test("request boundary rejects malformed paths and never snapshots extra credentials", () => {
  const owner = createFileJobOwner(
    async () => result,
    () => {},
  );
  expect(() => owner.start({ ...request("bad"), filePath: "x\0y" })).toThrow();
  const input = { ...request("safe"), apiKey: "secret" };
  expect(owner.start(input).request).not.toHaveProperty("apiKey");
});

test("file dialog, widget drop and retry route to owner; owner retains history before inference", async () => {
  const tab = await Bun.file(
    new URL("../windows/settings/tabs/FileTranscriptionTab.tsx", import.meta.url),
  ).text();
  const retry = await Bun.file(new URL("./fileTranscription.ts", import.meta.url)).text();
  const owner = await Bun.file(new URL("./fileTranscriptionJobs.ts", import.meta.url)).text();
  expect(tab).toContain("await startFileJob(");
  expect(tab).toContain("subscribeFileJobs(");
  expect(tab).not.toContain("transcribeFileOnly");
  expect(tab).not.toContain("transcribeFilePathOnly");
  expect(retry.slice(retry.indexOf("export async function retryFileHistoryEntry"))).toContain(
    "await startFileJob(",
  );
  expect(owner.indexOf("await beginProcessing(base")).toBeLessThan(
    owner.indexOf("await transcribeFilePathOnly("),
  );
  expect(owner).toContain("filePath: request.filePath");
});
