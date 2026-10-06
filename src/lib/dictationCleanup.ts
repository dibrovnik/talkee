import type { AppSettings } from "./store";

let pendingTrigger: "main-hotkey" | "widget" = "main-hotkey";
let pendingForceCleanup: boolean | null = null;

/** Remember whether the hotkey that started this take forces cleanup on or off. */
export function setPendingDictationCleanup(
  forceCleanup: boolean | null,
  trigger: "main-hotkey" | "widget" = "main-hotkey",
): void {
  pendingForceCleanup = forceCleanup;
  pendingTrigger = trigger;
}

/** Read and clear the override captured when recording started. */
export function takePendingDictationCleanup(): boolean | null {
  const forceCleanup = pendingForceCleanup;
  pendingForceCleanup = null;
  return forceCleanup;
}

/**
 * `null` keeps the global cleanup switch. `true` / `false` apply only to this take,
 * so the plain hotkey and the cleanup hotkey do not flip the saved setting.
 */
export function applyDictationCleanupChoice(
  settings: AppSettings,
  forceCleanup: boolean | null,
): AppSettings {
  if (forceCleanup === null || settings.cleanupEnabled === forceCleanup) {
    return settings;
  }
  return { ...settings, cleanupEnabled: forceCleanup };
}

export function takePendingDictationTrigger(): "main-hotkey" | "widget" {
  const trigger = pendingTrigger;
  pendingTrigger = "main-hotkey";
  return trigger;
}
