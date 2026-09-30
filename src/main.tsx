import ReactDOM from "react-dom/client";
import "./index.css";
import { I18nProvider } from "./lib/i18n";
import { applySavedTheme, applyThemePreference } from "./lib/theme";
import { SettingsApp } from "./windows/settings/SettingsApp";
import { Widget } from "./windows/widget/Widget";
import { WidgetNoticeOverlay } from "./windows/widget/WidgetNoticeOverlay";
import { WidgetTextOverlay } from "./windows/widget/WidgetTextOverlay";

// Route based on Tauri window label passed via URL hash or query
// Widget window opens at "/" — Settings window opens at "/settings"
const isSettings =
  window.location.pathname.includes("settings") ||
  new URLSearchParams(window.location.search).get("window") === "settings";
const isWidgetNotice =
  new URLSearchParams(window.location.search).get("window") === "widget-notice";
const isWidgetText = new URLSearchParams(window.location.search).get("window") === "widget-text";

applyThemePreference("system");
void applySavedTheme();

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}

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
