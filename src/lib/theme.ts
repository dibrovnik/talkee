import { getCurrentWindow } from "@tauri-apps/api/window";
import { getSettings, type ThemePreference } from "./store";

export type EffectiveTheme = "light" | "dark";

const THEME_MEDIA_QUERY = "(prefers-color-scheme: dark)";

function getSystemTheme(): EffectiveTheme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "light";
  }

  return window.matchMedia(THEME_MEDIA_QUERY).matches ? "dark" : "light";
}

export function resolveEffectiveTheme(preference: ThemePreference): EffectiveTheme {
  return preference === "system" ? getSystemTheme() : preference;
}

function applyNativeWindowTheme(preference: ThemePreference): void {
  // The native window theme drives the vibrancy material and the traffic
  // lights. "system" maps to null so the window keeps following the OS.
  try {
    void getCurrentWindow().setTheme(preference === "system" ? null : preference);
  } catch {
    // Not running inside Tauri (tests or a plain browser preview): ignore.
  }
}

export function applyThemePreference(preference: ThemePreference): EffectiveTheme {
  const effectiveTheme = resolveEffectiveTheme(preference);

  if (typeof document !== "undefined") {
    // `light dark` lets the `-apple-system-*` colors follow the OS when the
    // preference is "system"; an explicit preference pins the color scheme.
    document.documentElement.style.colorScheme =
      preference === "system" ? "light dark" : preference;
  }

  applyNativeWindowTheme(preference);

  return effectiveTheme;
}

export function watchThemePreference(
  preference: ThemePreference,
  onChange?: (theme: EffectiveTheme) => void,
): () => void {
  const apply = (): void => {
    onChange?.(applyThemePreference(preference));
  };

  apply();

  if (
    preference !== "system" ||
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return () => {};
  }

  const mediaQuery = window.matchMedia(THEME_MEDIA_QUERY);
  mediaQuery.addEventListener("change", apply);

  return () => {
    mediaQuery.removeEventListener("change", apply);
  };
}

export async function applySavedTheme(): Promise<EffectiveTheme> {
  try {
    const settings = await getSettings({ reload: true });
    return applyThemePreference(settings.theme);
  } catch {
    return applyThemePreference("system");
  }
}
