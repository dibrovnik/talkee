import { expect, test } from "bun:test";
import { applyDictationCleanupChoice } from "../../../lib/dictationCleanup";
import type { AppSettings } from "../../../lib/store";
import { resolveRecordingHotkeyCleanup } from "../hooks/useWidgetHotkey";
import { initialWidgetMachineState, widgetReducer } from "./widgetMachine";

test("hold mode starts on press and arms stop on release", () => {
  const started = widgetReducer(initialWidgetMachineState, {
    type: "HOTKEY_PRESSED",
    mode: "hold",
    cleanup: null,
  });
  expect(started.state.widgetState).toBe("recording");
  expect(started.state.lockedRecording).toBe(false);
  expect(started.effects).toContainEqual({ type: "start_recording", cleanup: null });

  const released = widgetReducer(started.state, { type: "HOTKEY_RELEASED" });
  expect(released.effects).toContainEqual({ type: "schedule_release_stop_timer" });
});

test("toggle mode starts on the first press and stops on the next", () => {
  const started = widgetReducer(initialWidgetMachineState, {
    type: "HOTKEY_PRESSED",
    mode: "toggle",
    cleanup: true,
  });
  expect(started.state.lockedRecording).toBe(true);
  expect(started.effects).toContainEqual({ type: "start_recording", cleanup: true });

  const released = widgetReducer(started.state, { type: "HOTKEY_RELEASED" });
  expect(released.effects).toEqual([]);
  expect(released.state.widgetState).toBe("recording");

  const stopped = widgetReducer(released.state, {
    type: "HOTKEY_PRESSED",
    mode: "toggle",
    cleanup: true,
  });
  expect(stopped.effects).toContainEqual({ type: "stop_and_process" });
});

test("a widget click still follows the global cleanup switch", () => {
  const started = widgetReducer(initialWidgetMachineState, { type: "MANUAL_RECORDING_START" });
  expect(started.effects).toContainEqual({ type: "start_recording", cleanup: null });
});

test("both modes and all recording triggers respect global/forced cleanup", () => {
  for (const mode of ["hold", "toggle"] as const)
    for (const cleanupEnabled of [true, false])
      for (const trigger of ["voice", "voice-cleanup", "widget"] as const) {
        const global = { cleanupEnabled } as AppSettings;
        const cleanup = trigger === "widget" ? null : resolveRecordingHotkeyCleanup(trigger);
        const started = widgetReducer(
          initialWidgetMachineState,
          trigger === "widget"
            ? { type: "MANUAL_RECORDING_START" }
            : { type: "HOTKEY_PRESSED", mode, cleanup },
        );
        expect(started.effects).toContainEqual({ type: "start_recording", cleanup });
        expect(applyDictationCleanupChoice(global, cleanup).cleanupEnabled).toBe(
          trigger === "voice-cleanup" || cleanupEnabled,
        );
        expect(global.cleanupEnabled).toBe(cleanupEnabled);
      }
});
