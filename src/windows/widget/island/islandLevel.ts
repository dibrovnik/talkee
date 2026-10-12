/** Keep the existing visual gain; invalid audio samples must never reach CSS. */
export function islandVoiceLevel(rms: number, peak: number): number {
  return Math.min(
    1,
    Math.max(0, Number.isFinite(rms) ? rms * 15 : 0, Number.isFinite(peak) ? peak * 9 : 0),
  );
}

/** The five familiar bars, expressed as transforms of a fixed 14 px surface. */
export function islandBarScale(level: number, index: number): number {
  const threshold = (index + 1) / 5;
  return Math.min(14, 4 + Math.max(0, level - threshold + 0.2) * 18) / 14;
}
