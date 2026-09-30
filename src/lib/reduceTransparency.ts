import { invoke } from "@tauri-apps/api/core";
import { logError } from "./logger";

export const REDUCE_TRANSPARENCY_CLASS = "reduce-transparency";

export function applyReduceTransparency(reduce: boolean): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle(REDUCE_TRANSPARENCY_CLASS, reduce);
}

async function syncReduceTransparency(): Promise<void> {
  try {
    applyReduceTransparency(await invoke<boolean>("check_reduce_transparency"));
  } catch (error) {
    void logError("theme", `Failed to read Reduce Transparency: ${String(error)}`);
  }
}

/**
 * Mirrors the macOS Reduce Transparency setting onto `<html>`. The setting is
 * re-read whenever the window regains focus, which covers returning from
 * System Settings after toggling it.
 */
export function watchReduceTransparency(): () => void {
  if (typeof window === "undefined") return () => {};

  const handleFocus = (): void => {
    void syncReduceTransparency();
  };

  void syncReduceTransparency();
  window.addEventListener("focus", handleFocus);

  return () => {
    window.removeEventListener("focus", handleFocus);
  };
}
