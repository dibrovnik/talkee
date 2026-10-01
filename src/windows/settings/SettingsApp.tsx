import { emit, listen } from "@tauri-apps/api/event";
import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { OnboardingFlow } from "../../components/onboarding/OnboardingFlow";
import {
  DEV_ONBOARDING_REQUEST_EVENT,
  SELECTION_TEXT_REQUEST_EVENT,
  SELECTION_TEXT_RESPONSE_EVENT,
  SETTINGS_NAVIGATE_EVENT,
  SETTINGS_UPDATED_EVENT,
  type SelectionTextRequestPayload,
  type SettingsNavigatePayload,
} from "../../lib/hotkeyEvents";
import { type MsgKey, useI18n } from "../../lib/i18n";
import {
  type Icon,
  IconAdjustmentsHorizontal,
  IconCpu,
  IconDeviceDesktopCog,
  IconFileMusic,
  IconHome,
  IconLanguage,
  IconMessage,
  IconSparkles,
} from "../../lib/icons";
import { logError } from "../../lib/logger";
import { checkAllPermissions } from "../../lib/permissions";
import { watchReduceTransparency } from "../../lib/reduceTransparency";
import {
  getHistoryIndex,
  getPermissionsPassed,
  getSettings,
  setPermissionsPassed,
  type ThemePreference,
} from "../../lib/store";
import { watchThemePreference } from "../../lib/theme";
import { Gallery } from "../../ui/Gallery";
import { SidebarItem } from "../../ui/SidebarItem";
import {
  isSettingsTab,
  resolveInitialSettingsTab,
  type SettingsTab as Tab,
} from "./settingsNavigation";
import { DevChatTab } from "./tabs/DevChatTab";
import { FileTranscriptionTab } from "./tabs/FileTranscriptionTab";
import { MainTab } from "./tabs/MainTab";
import { SettingsTab } from "./tabs/SettingsTab";
import { SettingsTabs } from "./tabs/SettingsTabs";
import { TranslationTab } from "./tabs/TranslationTab";
import {
  CONTENT_DRAG_REGION_HEIGHT,
  readViewportWidth,
  SIDEBAR_TRAFFIC_LIGHT_CLEARANCE,
  sidebarWidth,
  workspaceBottomGutter,
  workspaceGutter,
} from "./workspaceLayout";

function resolveInitialTab(): Tab {
  return resolveInitialSettingsTab(window.location.search);
}

/**
 * Tracks the live window width so the shell can trade padding for room instead
 * of shrinking fonts or hit targets (design decision 1).
 */
function useViewportWidth(): number {
  const [width, setWidth] = useState<number>(readViewportWidth);

  useEffect(() => {
    const handleResize = (): void => setWidth(readViewportWidth());
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return width;
}

interface SidebarTab {
  id: Tab;
  labelKey: MsgKey;
  icon: Icon;
  note: string;
}

// Group the reading workspace first, then processing configuration,
// then configuration pages, then the app-level settings page.
const SIDEBAR_GROUPS: SidebarTab[][] = [
  [
    {
      id: "main",
      labelKey: "settingsApp.tab.main",
      icon: IconHome,
      note: "История записей",
    },
    {
      id: "file",
      labelKey: "settingsApp.tab.file",
      icon: IconFileMusic,
      note: "Транскрибация",
    },
    {
      id: "chat",
      labelKey: "settingsApp.tab.chat",
      icon: IconMessage,
      note: "Чат с записями и текстом",
    },
  ],
  [
    {
      id: "model",
      labelKey: "settingsApp.tab.model",
      icon: IconCpu,
      note: "Ключи и подключение модели",
    },
    {
      id: "style",
      labelKey: "settingsApp.tab.style",
      icon: IconSparkles,
      note: "Стиль обработки и Промпты для саммари",
    },
    {
      id: "interpreter",
      labelKey: "settingsApp.tab.interpreter",
      icon: IconLanguage,
      note: "Перевод диктовки, выделения и живой речи",
    },
  ],
  [
    {
      id: "settings",
      labelKey: "settingsApp.tab.settings",
      icon: IconAdjustmentsHorizontal,
      note: "Язык, микрофон и горячая клавиша",
    },
    ...(import.meta.env.DEV
      ? [
          {
            id: "ui" as Tab,
            labelKey: "settingsApp.tab.ui" as MsgKey,
            icon: IconDeviceDesktopCog,
            note: "Витрина примитивов",
          },
        ]
      : []),
  ],
];

function getTextControlSelection(element: Element | null): string {
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    const start = element.selectionStart ?? 0;
    const end = element.selectionEnd ?? 0;
    if (end > start) {
      return element.value.slice(start, end);
    }
  }

  return "";
}

function getCurrentDomSelectionText(): string {
  if (!document.hasFocus()) {
    return "";
  }

  const activeElementSelection = getTextControlSelection(document.activeElement);
  if (activeElementSelection.trim()) {
    return activeElementSelection;
  }

  return window.getSelection()?.toString() ?? "";
}

export function SettingsApp() {
  const { t } = useI18n();
  const initialQuery = new URLSearchParams(window.location.search);
  const [devOnboardingRequestId, setDevOnboardingRequestId] = useState(
    import.meta.env.DEV && initialQuery.get("onboarding") === "1" ? 1 : 0,
  );
  const [activeTab, setActiveTab] = useState<Tab>(resolveInitialTab);
  const [focusedFileResultId, setFocusedFileResultId] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get("resultId"),
  );
  const [focusedHistoryEntryId, setFocusedHistoryEntryId] = useState<string | null>(null);
  const [focusedHistoryEntryNonce, setFocusedHistoryEntryNonce] = useState(0);
  const [themePreference, setThemePreference] = useState<ThemePreference>("system");
  const [navigationNonce, setNavigationNonce] = useState(0);
  const [showPermissions, setShowPermissions] = useState<boolean | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const syncTheme = async (reload = false): Promise<void> => {
      const settings = await getSettings({ reload });
      setThemePreference(settings.theme);
    };

    void syncTheme(true);

    const unlistenPromise = listen(SETTINGS_UPDATED_EVENT, () => {
      void syncTheme(true);
    });

    return () => {
      unlistenPromise.then((dispose) => dispose());
    };
  }, []);

  useEffect(() => {
    return watchThemePreference(themePreference);
  }, [themePreference]);

  useEffect(() => {
    return watchReduceTransparency();
  }, []);

  useEffect(() => {
    Promise.all([getPermissionsPassed(), checkAllPermissions()])
      .then(async ([passed, permissions]) => {
        const hasRequiredStartupPermissions =
          permissions.microphone !== "denied" && permissions.accessibility === "granted";
        const shouldRecoverExistingInstall =
          !passed &&
          hasRequiredStartupPermissions &&
          (await getHistoryIndex()
            .then((history) => history.length > 0)
            .catch(() => false));

        if (shouldRecoverExistingInstall) {
          await setPermissionsPassed(true);
        }

        setShowPermissions(
          !((passed || shouldRecoverExistingInstall) && hasRequiredStartupPermissions),
        );
        setLoadError(null);
      })
      .catch((error) => {
        void logError(
          "SETTINGS_APP",
          `Failed to load initial state: ${error instanceof Error ? error.message : String(error)}`,
        );
        setShowPermissions(false);
        setLoadError(t("settingsApp.loadError"));
      });
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV) return;

    const unlistenPromise = listen(DEV_ONBOARDING_REQUEST_EVENT, () => {
      setDevOnboardingRequestId((current) => current + 1);
    });

    return () => {
      unlistenPromise.then((dispose) => dispose());
    };
  }, []);

  useEffect(() => {
    const unlisten = listen<SettingsNavigatePayload>(SETTINGS_NAVIGATE_EVENT, ({ payload }) => {
      const nextTab = isSettingsTab(payload.tab) ? payload.tab : "main";
      setActiveTab(nextTab);
      setFocusedFileResultId(nextTab === "file" ? payload.resultId || null : null);
      setNavigationNonce((current) => current + 1);

      requestAnimationFrame(() => {
        document.querySelector("main")?.scrollTo({ top: 0, left: 0, behavior: "auto" });
      });
    });

    return () => {
      unlisten.then((dispose) => dispose());
    };
  }, []);

  useEffect(() => {
    const unlisten = listen<SelectionTextRequestPayload>(
      SELECTION_TEXT_REQUEST_EVENT,
      ({ payload }) => {
        void emit(SELECTION_TEXT_RESPONSE_EVENT, {
          requestId: payload.requestId,
          text: getCurrentDomSelectionText(),
          sourceWindow: "settings",
        });
      },
    );

    return () => {
      unlisten.then((dispose) => dispose());
    };
  }, []);

  const handlePermissionsComplete = async () => {
    await setPermissionsPassed(true);
    setShowPermissions(false);
    setDevOnboardingRequestId(0);
    await emit(SETTINGS_UPDATED_EVENT);
  };

  const openHistoryEntryFromChat = (entryId: string): void => {
    setFocusedHistoryEntryId(entryId);
    setFocusedHistoryEntryNonce((current) => current + 1);
    setActiveTab("main");
  };

  // Tracked unconditionally: the shell renders before permissions resolve too.
  const viewportWidth = useViewportWidth();

  if (showPermissions === null) {
    return (
      <div
        className="app-root"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          className="card"
          style={{ width: "min(420px, calc(100vw - var(--space-8)))", textAlign: "center" }}
        >
          <div style={{ fontSize: 14, color: "var(--text-mid)" }}>{t("settingsApp.loading")}</div>
        </div>
      </div>
    );
  }

  const isChatActive = activeTab === "chat";
  const mainGutter = workspaceGutter(viewportWidth);

  return (
    <div className="app-root">
      <div
        style={
          {
            "--summary-modal-top-offset": "48px",
            display: "flex",
            flexDirection: "column",
            height: "100vh",
            position: "relative",
            zIndex: 1,
          } as CSSProperties
        }
      >
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          <aside
            className="app-sidebar"
            style={{
              width: sidebarWidth(viewportWidth),
              // Leave room for the native macOS traffic lights, which float over
              // the overlay title bar at the top-left of the window.
              padding: `${SIDEBAR_TRAFFIC_LIGHT_CLEARANCE}px var(--space-3) var(--space-6)`,
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-4)",
              overflowY: "auto",
              flexShrink: 0,
            }}
          >
            {SIDEBAR_GROUPS.map((group, groupIndex) => (
              <nav
                key={group[0]?.id ?? `group-${groupIndex}`}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                  paddingTop: groupIndex === 0 ? 0 : "var(--space-2)",
                  marginTop: groupIndex === 0 ? 0 : 2,
                  borderTop: groupIndex === 0 ? "none" : "1px solid var(--separator)",
                }}
              >
                {group.map((tab) => (
                  <SidebarItem
                    key={tab.id}
                    icon={tab.icon}
                    label={t(tab.labelKey)}
                    active={activeTab === tab.id}
                    onClick={() => setActiveTab(tab.id)}
                  />
                ))}
              </nav>
            ))}
          </aside>

          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              minWidth: 0,
              minHeight: 0,
              background: "var(--main-bg)",
            }}
          >
            {/* The overlay title bar has no visible chrome in the content area,
                so the top strip is an explicit window drag region. */}
            <div
              data-tauri-drag-region
              style={{ height: CONTENT_DRAG_REGION_HEIGHT, flexShrink: 0 }}
            />
            <main
              style={{
                flex: 1,
                // Narrow windows trade padding for room; fonts and hit targets
                // keep their size.
                padding: `0 ${mainGutter}px ${workspaceBottomGutter(viewportWidth)}px`,
                minHeight: 0,
                overflowY: isChatActive ? "hidden" : "auto",
                overflowX: "hidden",
                position: "relative",
              }}
            >
              <div
                style={{
                  maxWidth: "var(--workspace-width)",
                  margin: "0 auto",
                  minWidth: 0,
                  minHeight: 0,
                  height: isChatActive ? "100%" : undefined,
                  display: isChatActive ? "flex" : "block",
                  flexDirection: isChatActive ? "column" : undefined,
                  overflowX: "hidden",
                }}
              >
                {loadError && (
                  <div
                    className="card"
                    style={{
                      marginBottom: 14,
                      padding: "12px 14px",
                      background: "var(--danger-soft)",
                      border: "1px solid var(--danger-border)",
                      color: "var(--danger)",
                    }}
                  >
                    {loadError}
                  </div>
                )}
                <div
                  key={navigationNonce}
                  style={{
                    animation: "slide-down 0.18s ease",
                    flex: isChatActive ? "1 1 auto" : undefined,
                    minHeight: isChatActive ? 0 : undefined,
                  }}
                >
                  <div style={{ display: activeTab === "main" ? "block" : "none" }}>
                    <MainTab
                      focusedEntryId={focusedHistoryEntryId}
                      focusedEntryNonce={focusedHistoryEntryNonce}
                    />
                  </div>
                  <div style={{ display: activeTab === "file" ? "block" : "none" }}>
                    <FileTranscriptionTab focusedEntryId={focusedFileResultId} />
                  </div>
                  <div
                    style={{
                      display: activeTab === "chat" ? "block" : "none",
                      height: "100%",
                      minHeight: 0,
                      overflow: "hidden",
                    }}
                  >
                    <DevChatTab
                      isActive={activeTab === "chat"}
                      onOpenHistoryEntry={openHistoryEntryFromChat}
                    />
                  </div>
                  <div
                    style={{
                      display: activeTab === "settings" ? "block" : "none",
                    }}
                  >
                    <SettingsTab />
                  </div>
                  {activeTab === "model" && <SettingsTabs type="model" />}
                  {activeTab === "style" && <SettingsTabs type="style" />}
                  {activeTab === "interpreter" && <TranslationTab />}
                  {import.meta.env.DEV && activeTab === "ui" && <Gallery />}
                </div>
              </div>
            </main>
          </div>
        </div>
      </div>

      {(showPermissions || devOnboardingRequestId > 0) && (
        <OnboardingFlow
          key={`onboarding-${devOnboardingRequestId}`}
          onComplete={handlePermissionsComplete}
        />
      )}
    </div>
  );
}
