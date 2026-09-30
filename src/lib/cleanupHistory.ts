import type { HistoryEntry } from "./store";
export function hasOriginalCleanupText(
  entry: Pick<HistoryEntry, "cleaned"> & Partial<Pick<HistoryEntry, "raw">>,
): boolean {
  return !!entry.raw && entry.raw !== entry.cleaned;
}
export function cleanupHistoryText(
  entry: Pick<HistoryEntry, "cleaned"> & Partial<Pick<HistoryEntry, "raw">>,
  original: boolean,
): string {
  return original && entry.raw ? entry.raw : entry.cleaned;
}
