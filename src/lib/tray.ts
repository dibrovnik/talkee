import { invoke } from "@tauri-apps/api/core";
import { logError } from "./logger";
import { createSerialTaskQueue } from "./serialTaskQueue";

/**
 * Switches the macOS menu-bar icon between the idle and recording variants.
 *
 * The tray is decorative, so a failed invoke is logged and swallowed: it must
 * never break the recording pipeline.
 */
export function setTrayRecording(recording: boolean): void {
  void invoke("set_tray_recording", { recording }).catch((error) => {
    logError("TRAY", `Failed to set tray recording state: ${String(error)}`);
  });
}

const callMenuUpdates = createSerialTaskQueue();

export function updateCallMenu(phase: string, available: boolean): void {
  void callMenuUpdates
    .enqueue(() => invoke("update_call_menu", { phase, available }))
    .catch((error) => {
      logError("TRAY", `Failed to update call menu: ${String(error)}`);
    });
}
