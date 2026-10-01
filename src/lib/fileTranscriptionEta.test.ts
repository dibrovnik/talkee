import { expect, test } from "bun:test";
import type { FileTranscriptionProgress } from "./fileTranscription";
import { estimateFileTranscription } from "./fileTranscriptionEta";

const progress: FileTranscriptionProgress = {
  status: "transcribing",
  currentChunk: 3,
  totalChunks: 4,
  message: "",
  completedChunks: 2,
  completedAudioSeconds: 40,
  totalAudioSeconds: 100,
  transcriptionElapsedSeconds: 20,
};

test("ETA uses completed audio duration, not the started chunk index", () => {
  expect(estimateFileTranscription(progress)).toEqual({
    remainingSeconds: 30,
    completedFraction: 0.4,
  });
  expect(estimateFileTranscription({ ...progress, currentChunk: 4 })).toEqual(
    estimateFileTranscription(progress),
  );
  // Unequal final chunks are weighted by actual duration.
  expect(estimateFileTranscription({ ...progress, completedAudioSeconds: 75 })).toEqual({
    remainingSeconds: 7,
    completedFraction: 0.75,
  });
});

test("cold startup, zeros and unavailable measurements do not invent an ETA", () => {
  expect(
    estimateFileTranscription({ ...progress, completedChunks: 1 }).remainingSeconds,
  ).toBeNull();
  for (const total of [0, NaN, Infinity])
    expect(
      estimateFileTranscription({ ...progress, totalAudioSeconds: total }).remainingSeconds,
    ).toBeNull();
  expect(
    estimateFileTranscription({ ...progress, completedAudioSeconds: 0 }).remainingSeconds,
  ).toBeNull();
  expect(
    estimateFileTranscription({ ...progress, transcriptionElapsedSeconds: -1 }).remainingSeconds,
  ).toBeNull();
  expect(
    estimateFileTranscription({ ...progress, totalAudioSeconds: undefined }).completedFraction,
  ).toBeNull();
  expect(estimateFileTranscription(null).remainingSeconds).toBeNull();
});

test("assembly remains unknown and only terminal done gives zero ETA", () => {
  expect(
    estimateFileTranscription({ ...progress, completedAudioSeconds: 100 }).remainingSeconds,
  ).toBeNull();
  expect(
    estimateFileTranscription({ ...progress, status: "assembling" }).remainingSeconds,
  ).toBeNull();
  expect(
    estimateFileTranscription({ ...progress, status: "converting" }).remainingSeconds,
  ).toBeNull();
  expect(estimateFileTranscription({ ...progress, status: "done" })).toEqual({
    remainingSeconds: 0,
    completedFraction: 1,
  });
});
