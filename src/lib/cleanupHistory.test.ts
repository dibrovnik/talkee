import { expect, test } from "bun:test";
import { cleanupHistoryText, hasOriginalCleanupText } from "./cleanupHistory";

test("history keeps legacy entries unchanged and exposes original text only when different", () => {
  expect(cleanupHistoryText({ cleaned: "Legacy" }, true)).toBe("Legacy");
  expect(hasOriginalCleanupText({ cleaned: "Legacy" })).toBe(false);
  expect(hasOriginalCleanupText({ raw: "Same", cleaned: "Same" })).toBe(false);
  expect(hasOriginalCleanupText({ raw: "Raw", cleaned: "Cleaned" })).toBe(true);
  expect(cleanupHistoryText({ raw: "Raw", cleaned: "Cleaned" }, true)).toBe("Raw");
  expect(cleanupHistoryText({ raw: "Raw", cleaned: "Cleaned" }, false)).toBe("Cleaned");
});
