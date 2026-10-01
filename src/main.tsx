import { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import { I18nProvider } from "./lib/i18n";
import { applySavedTheme, applyThemePreference } from "./lib/theme";
import { SettingsApp } from "./windows/settings/SettingsApp";
import { Widget } from "./windows/widget/Widget";
import { WidgetNoticeOverlay } from "./windows/widget/WidgetNoticeOverlay";
import { WidgetTextOverlay } from "./windows/widget/WidgetTextOverlay";

const DevGallery = import.meta.env.DEV
  ? lazy(() => import("./ui/Gallery").then((module) => ({ default: module.Gallery })))
  : null;
const isDevGallery =
  import.meta.env.DEV && new URLSearchParams(window.location.search).has("ui-gallery");

// Route based on Tauri window label passed via URL hash or query
// Widget window opens at "/" — Settings window opens at "/settings"
const isSettings =
  window.location.pathname.includes("settings") ||
  new URLSearchParams(window.location.search).get("window") === "settings";
const isWidgetNotice =
  new URLSearchParams(window.location.search).get("window") === "widget-notice";
const isWidgetText = new URLSearchParams(window.location.search).get("window") === "widget-text";
// Scope comfortable workspace controls to this window, including portals.
document.documentElement.dataset.window = isSettings ? "settings" : "widget";

const isWidgetShell = !isSettings && !isWidgetNotice && !isWidgetText;

// The notch is outside the safe area. viewport-fit=cover lets the island paint
// into it; the default viewport starts the page below the menu bar.
if (isWidgetShell) {
  document
    .querySelector('meta[name="viewport"]')
    ?.setAttribute("content", "width=device-width, initial-scale=1, viewport-fit=cover");
  document.documentElement.style.height = "100%";
  document.documentElement.style.overflow = "hidden";
  document.body.style.height = "100%";
  document.body.style.overflow = "hidden";
  document.body.style.overscrollBehavior = "none";
}

applyThemePreference("system");
void applySavedTheme();

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}

if (isDevGallery && DevGallery) {
  document.documentElement.dataset.window = "settings";
  ReactDOM.createRoot(rootElement).render(
    <div style={{ height: "100%", overflow: "auto", background: "var(--window-bg)", padding: 24 }}>
      <Suspense fallback={null}>
        <DevGallery />
      </Suspense>
    </div>,
  );
} else {
  ReactDOM.createRoot(rootElement).render(
    <I18nProvider>
      {isSettings ? (
        <SettingsApp />
      ) : isWidgetNotice ? (
        <WidgetNoticeOverlay />
      ) : isWidgetText ? (
        <WidgetTextOverlay />
      ) : (
        <Widget />
      )}
    </I18nProvider>,
  );
}
