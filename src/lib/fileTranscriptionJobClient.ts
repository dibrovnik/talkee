import { emitTo, listen } from "@tauri-apps/api/event";
import type { FileJobRequest, FileJobSnapshot } from "./fileTranscriptionJobs";
import {
  FILE_JOB_CANCEL_EVENT,
  FILE_JOB_SNAPSHOT_EVENT,
  FILE_JOB_SNAPSHOT_REQUEST_EVENT,
  FILE_JOB_START_EVENT,
  FILE_JOB_UPDATE_EVENT,
  type FileJobSnapshotResponse,
} from "./hotkeyEvents";

/** A delayed initial snapshot must not overwrite a newer live update. */
export function mergeFileJobSnapshots(
  current: FileJobSnapshot[],
  incoming: FileJobSnapshot[],
): FileJobSnapshot[] {
  const jobs = new Map(current.map((job) => [job.request.jobId, job]));
  for (const job of incoming) {
    const previous = jobs.get(job.request.jobId);
    if (!previous || job.revision > previous.revision) jobs.set(job.request.jobId, job);
  }
  return [...jobs.values()].sort((a, b) => a.createdAt - b.createdAt);
}

export async function subscribeFileJobs(
  onJobs: (jobs: FileJobSnapshot[]) => void,
): Promise<() => void> {
  const requestId = crypto.randomUUID();
  let active = true;
  let jobs: FileJobSnapshot[] = [];
  const receive = (incoming: FileJobSnapshot[]): void => {
    if (!active) return;
    jobs = mergeFileJobSnapshots(jobs, incoming);
    onJobs(jobs);
  };
  const dispose: (() => void)[] = [];
  try {
    dispose.push(
      await listen<FileJobSnapshot>(FILE_JOB_UPDATE_EVENT, ({ payload }) => receive([payload])),
    );
    dispose.push(
      await listen<FileJobSnapshotResponse>(FILE_JOB_SNAPSHOT_EVENT, ({ payload }) => {
        if (payload.requestId === requestId) receive(payload.jobs);
      }),
    );
    await emitTo("widget", FILE_JOB_SNAPSHOT_REQUEST_EVENT, { requestId });
    return () => {
      active = false;
      for (const unlisten of dispose) unlisten();
    };
  } catch (error) {
    active = false;
    for (const unlisten of dispose) unlisten();
    throw error;
  }
}

export async function startFileJob(request: FileJobRequest): Promise<void> {
  await emitTo("widget", FILE_JOB_START_EVENT, request);
}

export async function cancelFileJob(jobId: string): Promise<void> {
  await emitTo("widget", FILE_JOB_CANCEL_EVENT, { jobId });
}
