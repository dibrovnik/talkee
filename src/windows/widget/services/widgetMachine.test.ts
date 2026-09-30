import { expect, test } from "bun:test";
import { initialWidgetMachineState, widgetReducer } from "./widgetMachine";

test("hold mode starts on press and arms stop on release", () => {
  const started = widgetReducer(initialWidgetMachineState, {
    type: "HOTKEY_PRESSED",
    mode: "hold",
    cleanup: false,
  });
  expect(started.state.widgetState).toBe("recording");
  expect(started.state.lockedRecording).toBe(false);
  expect(started.effects).toContainEqual({ type: "start_recording", cleanup: false });

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
