import { expect, test } from "bun:test";
import type { WidgetTextOverlayState } from "../widgetConstants";
import {
  stackWidthWithTicker,
  TICKER_PILL_WIDTH,
  tickerFollowsTail,
  tickerLine,
} from "./tickerText";

function overlay(
  patch: Partial<WidgetTextOverlayState> & Pick<WidgetTextOverlayState, "status">,
): WidgetTextOverlayState {
  return {
    sourceText: "",
    translatedText: "",
    targetLanguage: "",
    ...patch,
  };
}

test("ticker line collapses breaks and prefers live translation", () => {
  expect(tickerLine(null)).toBe("");
  expect(tickerLine(overlay({ status: "dictating", translatedText: "  " }))).toBe("");
  expect(tickerLine(overlay({ status: "done", translatedText: "one\n\ntwo" }))).toBe("one two");
  expect(
    tickerLine(
      overlay({
        status: "liveTranslation",
        translatedText: "ignored",
        liveSegments: [
          {
            sessionId: "s",
            channel: "mic",
            startedAtMs: 0,
            original: "a",
            translated: "Hello",
            state: "final",
          },
          {
            sessionId: "s",
            channel: "mic",
            startedAtMs: 1,
            original: "b",
            translated: "  world ",
            state: "final",
          },
        ],
      }),
    ),
  ).toBe("Hello world");
});

test("an error with no transcript uses the message", () => {
  expect(tickerLine(overlay({ status: "error", message: "Речь не распознана." }))).toBe(
    "Речь не распознана.",
  );
});

test("live speech follows the tail and a finished line does not", () => {
  expect(tickerFollowsTail("dictating")).toBe(true);
  expect(tickerFollowsTail("liveTranslation")).toBe(true);
  expect(tickerFollowsTail("translating")).toBe(true);
  expect(tickerFollowsTail("done")).toBe(false);
  expect(tickerFollowsTail("copying")).toBe(false);
});

test("ticker widens the pill and leaves other widths alone", () => {
  expect(stackWidthWithTicker(200, false)).toBe(200);
  expect(stackWidthWithTicker(200, true)).toBeGreaterThan(200);
  expect(stackWidthWithTicker(TICKER_PILL_WIDTH, true)).toBeGreaterThanOrEqual(TICKER_PILL_WIDTH);
});
