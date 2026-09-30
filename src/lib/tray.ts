import { invoke } from "@tauri-apps/api/core";
import { logError } from "./logger";

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
