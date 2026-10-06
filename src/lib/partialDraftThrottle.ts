// Throttling rule for streaming draft updates.
//
// The managed Nemotron runtime emits partial text per token. Forwarding every
// partial into the job snapshot and the settings webview would be a
// high-frequency stream of cross-webview events, so the design allows roughly
// 250–500 ms between draft updates. This module holds that rule as a pure state
// machine: it decides *when* to emit, never what the text is.

/** Minimum gap between two forwarded partial drafts. */
export const PARTIAL_DRAFT_THROTTLE_MS = 300;

export interface DraftThrottleState {
  /** Timestamp of the last forwarded draft; 0 means "nothing sent yet". */
  lastEmitAt: number;
  /** Pending trailing emit, or null when none is scheduled. */
  pendingAt: number | null;
}

export function createDraftThrottleState(): DraftThrottleState {
  return { lastEmitAt: 0, pendingAt: null };
}

export interface DraftThrottleDecision {
  /** Forward the draft right now. */
  emitNow: boolean;
  /**
   * When to schedule the trailing emit, or null for "nothing to schedule".
   * A terminal update (draft cleared) always returns null and cancels.
   */
  scheduleAt: number | null;
  /** True when a previously scheduled trailing emit must be cancelled. */
  cancelPending: boolean;
}

/**
 * Decide what to do with one incoming update.
 *
 * `hasDraft === false` means the update is terminal (the chunk finished or the
 * request failed): it must reach the UI immediately so finished text is never
 * shown as a stale draft, and any trailing emit is dropped.
 */
export function planDraftUpdate(
  state: DraftThrottleState,
  now: number,
  hasDraft: boolean,
): DraftThrottleDecision {
  if (!hasDraft) {
    return { emitNow: true, scheduleAt: null, cancelPending: state.pendingAt !== null };
  }

  // A trailing emit is already queued: this update is superseded by it, but the
  // queued one will carry the newest text once it fires.
  if (state.pendingAt !== null) {
    return { emitNow: false, scheduleAt: null, cancelPending: false };
  }

  if (state.lastEmitAt === 0 || now - state.lastEmitAt >= PARTIAL_DRAFT_THROTTLE_MS) {
    return { emitNow: true, scheduleAt: null, cancelPending: false };
  }

  return {
    emitNow: false,
    scheduleAt: state.lastEmitAt + PARTIAL_DRAFT_THROTTLE_MS,
    cancelPending: false,
  };
}
