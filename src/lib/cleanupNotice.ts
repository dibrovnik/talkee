import { invoke } from "@tauri-apps/api/core";
import { logError } from "./logger";

let timer: ReturnType<typeof setTimeout> | undefined;
export async function showCleanupNotice(message: string, actionLabel?: string): Promise<void> {
  if (timer) clearTimeout(timer);
  try {
    await invoke("show_widget_notice", {
      message,
      tone: "info",
      anchorState: "idle",
      actionLabel: actionLabel ?? null,
      actionTab: actionLabel ? "model" : null,
    });
    timer = setTimeout(
      () => {
        void invoke("hide_widget_notice").catch((error) => logError("CLEANUP", String(error)));
      },
      actionLabel ? 8000 : 1500,
    );
  } catch (error) {
    logError("CLEANUP", String(error));
  }
}
