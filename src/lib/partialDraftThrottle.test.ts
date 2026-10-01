import { describe, expect, it } from "bun:test";

import {
  createDraftThrottleState,
  PARTIAL_DRAFT_THROTTLE_MS,
  planDraftUpdate,
} from "./partialDraftThrottle";

describe("streaming draft throttling", () => {
  it("forwards the first draft immediately", () => {
    const state = createDraftThrottleState();
    expect(planDraftUpdate(state, 1_000, true)).toEqual({
      emitNow: true,
      scheduleAt: null,
      cancelPending: false,
    });
    expect(PARTIAL_DRAFT_THROTTLE_MS).toBeGreaterThanOrEqual(250);
    expect(PARTIAL_DRAFT_THROTTLE_MS).toBeLessThanOrEqual(500);
  });

  it("schedules one trailing update for a token burst and drops the rest", () => {
    const state = createDraftThrottleState();
    state.lastEmitAt = 10_000;

    const first = planDraftUpdate(state, 10_050, true);
    expect(first.emitNow).toBe(false);
    expect(first.scheduleAt).toBe(10_000 + PARTIAL_DRAFT_THROTTLE_MS);
    state.pendingAt = first.scheduleAt;

    // Every further token within the window is superseded by that one emit.
    const second = planDraftUpdate(state, 10_100, true);
    expect(second.emitNow).toBe(false);
    expect(second.scheduleAt).toBeNull();
    expect(second.cancelPending).toBe(false);
  });

  it("forwards again once the throttle window has passed", () => {
    const state = createDraftThrottleState();
    state.lastEmitAt = 10_000;
    expect(planDraftUpdate(state, 10_000 + PARTIAL_DRAFT_THROTTLE_MS, true).emitNow).toBe(true);
  });

  it("always clears the draft immediately and cancels a trailing emit", () => {
    const state = createDraftThrottleState();
    state.lastEmitAt = 10_000;
    state.pendingAt = 10_300;

    const terminal = planDraftUpdate(state, 10_100, false);
    expect(terminal.emitNow).toBe(true);
    expect(terminal.cancelPending).toBe(true);
    expect(terminal.scheduleAt).toBeNull();
  });

  it("does not report a cancellation when nothing was pending", () => {
    const state = createDraftThrottleState();
    expect(planDraftUpdate(state, 5, false).cancelPending).toBe(false);
  });
});
