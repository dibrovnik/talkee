import { describe, expect, test } from "bun:test";

import { clampIndex, firstMatchingIndex, moveListIndex, segmentIndexForKey } from "./keyboard";

describe("moveListIndex", () => {
  test("steps down and wraps past the last item", () => {
    expect(moveListIndex(0, 1, 3)).toBe(1);
    expect(moveListIndex(2, 1, 3)).toBe(0);
  });

  test("steps up and wraps before the first item", () => {
    expect(moveListIndex(1, -1, 3)).toBe(0);
    expect(moveListIndex(0, -1, 3)).toBe(2);
  });

  test("returns -1 for an empty list", () => {
    expect(moveListIndex(0, 1, 0)).toBe(-1);
  });
});

describe("segmentIndexForKey", () => {
  test("moves right and left with wrapping", () => {
    expect(segmentIndexForKey(0, "ArrowRight", 3)).toBe(1);
    expect(segmentIndexForKey(2, "ArrowRight", 3)).toBe(0);
    expect(segmentIndexForKey(0, "ArrowLeft", 3)).toBe(2);
  });

  test("supports Home and End", () => {
    expect(segmentIndexForKey(1, "Home", 4)).toBe(0);
    expect(segmentIndexForKey(1, "End", 4)).toBe(3);
  });

  test("ignores unrelated keys", () => {
    expect(segmentIndexForKey(1, "a", 4)).toBeNull();
  });
});

describe("firstMatchingIndex", () => {
  const labels = ["Системная", "Светлая", "Тёмная"];

  test("matches by the first letter", () => {
    expect(firstMatchingIndex(labels, "С")).toBe(0);
    expect(firstMatchingIndex(labels, "Т")).toBe(2);
  });

  test("searches forward and wraps", () => {
    expect(firstMatchingIndex(labels, "Св")).toBe(1);
    expect(firstMatchingIndex(labels, "Си", 1)).toBe(0);
  });

  test("returns -1 when nothing matches", () => {
    expect(firstMatchingIndex(labels, "z")).toBe(-1);
    expect(firstMatchingIndex(labels, "")).toBe(-1);
  });
});

describe("clampIndex", () => {
  test("clamps into range", () => {
    expect(clampIndex(-2, 3)).toBe(0);
    expect(clampIndex(5, 3)).toBe(2);
    expect(clampIndex(1, 3)).toBe(1);
    expect(clampIndex(0, 0)).toBe(-1);
  });
});
