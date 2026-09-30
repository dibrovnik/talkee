export function clampIndex(index: number, count: number): number {
  if (count <= 0) {
    return -1;
  }
  if (index < 0) {
    return 0;
  }
  if (index >= count) {
    return count - 1;
  }
  return index;
}

/** Moves a list highlight up or down, wrapping around the ends. */
export function moveListIndex(current: number, delta: number, count: number): number {
  if (count <= 0) {
    return -1;
  }
  const start = current < 0 ? 0 : current;
  return (start + delta + count) % count;
}

/** Arrow/Home/End behaviour for a segmented control. */
export function segmentIndexForKey(current: number, key: string, count: number): number | null {
  if (count <= 0) {
    return null;
  }
  if (key === "ArrowRight" || key === "ArrowDown") {
    return (current + 1) % count;
  }
  if (key === "ArrowLeft" || key === "ArrowUp") {
    return (current - 1 + count) % count;
  }
  if (key === "Home") {
    return 0;
  }
  if (key === "End") {
    return count - 1;
  }
  return null;
}

/** First index whose label starts with the typed query, searching forward from `from`. */
export function firstMatchingIndex(labels: readonly string[], query: string, from = 0): number {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle || labels.length === 0) {
    return -1;
  }
  const start = clampIndex(from, labels.length);
  for (let offset = 0; offset < labels.length; offset += 1) {
    const index = (start + offset) % labels.length;
    if (labels[index]?.toLocaleLowerCase().startsWith(needle)) {
      return index;
    }
  }
  return -1;
}
