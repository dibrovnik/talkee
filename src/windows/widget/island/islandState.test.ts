import { expect, test } from "bun:test";
import {
  ISLAND_COPY_VISIBLE_MS,
  islandNoticeIsInteractive,
  islandShowsCopyButton,
  mapIslandState,
} from "./islandState";

const base = {
  widgetState: "idle" as const,
  callActive: false,
  notice: null,
  done: false,
};

test("island state prefers a notice, then dictation, then a call", () => {
  expect(mapIslandState(base)).toBe("idle");
  expect(mapIslandState({ ...base, done: true })).toBe("done");
  expect(mapIslandState({ ...base, callActive: true })).toBe("call");
  expect(mapIslandState({ ...base, widgetState: "recording", callActive: true })).toBe("recording");
  expect(mapIslandState({ ...base, widgetState: "processing" })).toBe("processing");
  expect(
    mapIslandState({
      ...base,
      widgetState: "recording",
      notice: { message: "Сеть", tone: "error", actionLabel: "Открыть" },
    }),
  ).toBe("notice");
});

test("the copy button stays for three seconds after processing", () => {
  expect(ISLAND_COPY_VISIBLE_MS).toBe(3000);
  expect(islandShowsCopyButton("done", "Привет")).toBe(true);
  expect(islandShowsCopyButton("done", "  ")).toBe(false);
  expect(islandShowsCopyButton("idle", "Привет")).toBe(false);
});

test("only a notice with an action accepts clicks", () => {
  expect(islandNoticeIsInteractive(null)).toBe(false);
  expect(islandNoticeIsInteractive({ message: "Готово", tone: "info" })).toBe(false);
  expect(
    islandNoticeIsInteractive({ message: "Модель", tone: "info", actionLabel: "Настройки" }),
  ).toBe(true);
});
