import type { FileTranscriptionProgress } from "./fileTranscription";

export interface FileTranscriptionEstimate {
  /** null means there is not enough measured work yet. */
  remainingSeconds: number | null;
  completedFraction: number | null;
}

/** Estimate only measured transcription work, not conversion or unknown assembly time. */
export function estimateFileTranscription(
  progress: FileTranscriptionProgress | null,
): FileTranscriptionEstimate {
  const unknown = { remainingSeconds: null, completedFraction: null };
  if (!progress) return unknown;
  if (progress.status === "done") return { remainingSeconds: 0, completedFraction: 1 };
  if (progress.status !== "transcribing") return unknown;
  const completed = progress.completedAudioSeconds;
  const total = progress.totalAudioSeconds;
  const elapsed = progress.transcriptionElapsedSeconds;
  if (
    completed === undefined ||
    total === undefined ||
    !Number.isFinite(completed) ||
    !Number.isFinite(total) ||
    total <= 0 ||
    completed < 0 ||
    completed > total
  )
    return unknown;
  const completedFraction = completed / total;
  // First completion includes cold startup; wait for two actual chunks before extrapolating.
  if (
    (progress.completedChunks || 0) < 2 ||
    completed <= 0 ||
    completed >= total ||
    elapsed === undefined ||
    !Number.isFinite(elapsed) ||
    elapsed <= 0
  )
    return { remainingSeconds: null, completedFraction };
  return {
    remainingSeconds: Math.ceil(((total - completed) * elapsed) / completed),
    completedFraction,
  };
}
