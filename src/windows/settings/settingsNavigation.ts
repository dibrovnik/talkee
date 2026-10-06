export type SettingsTab =
  | "main"
  | "stats"
  | "file"
  | "interpreter"
  | "chat"
  | "settings"
  | "model"
  | "style"
  | "ui";

const SETTINGS_TABS = new Set<SettingsTab>([
  "main",
  "stats",
  "file",
  "interpreter",
  "chat",
  "settings",
  "model",
  "style",
  "ui",
]);

export function isSettingsTab(value: unknown): value is SettingsTab {
  return typeof value === "string" && SETTINGS_TABS.has(value as SettingsTab);
}

export function resolveInitialSettingsTab(search: string): SettingsTab {
  const requestedTab = new URLSearchParams(search).get("tab");
  return isSettingsTab(requestedTab) ? requestedTab : "main";
}
