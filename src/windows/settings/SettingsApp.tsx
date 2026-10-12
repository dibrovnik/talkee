import { getVersion } from "@tauri-apps/api/app";
import { emit, listen } from "@tauri-apps/api/event";
import type { CSSProperties, ReactElement } from "react";
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
  IconBook,
  IconChartBar,
  IconCpu,
  IconDeviceDesktopCog,
  IconFileMusic,
  IconHome,
  IconLanguage,
  IconMessage,
  IconMicrophone,
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
import { Spinner } from "../../ui/Spinner";
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
import { StatsTab } from "./tabs/StatsTab";
import { TranslationTab } from "./tabs/TranslationTab";
import { VocabularyTab } from "./tabs/vocabulary/VocabularyTab";
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
}

// Group the reading workspace first, then processing configuration,
// then configuration pages, then the app-level settings page.
const SIDEBAR_GROUPS: SidebarTab[][] = [
  [
    {
      id: "main",
      labelKey: "settingsApp.tab.main",
      icon: IconHome,
    },
    {
      id: "file",
      labelKey: "settingsApp.tab.file",
      icon: IconFileMusic,
    },
    {
      id: "chat",
      labelKey: "settingsApp.tab.chat",
      icon: IconMessage,
    },
    {
      id: "stats",
      labelKey: "settingsApp.tab.stats",
      icon: IconChartBar,
    },
  ],
  [
    {
      id: "model",
      labelKey: "settingsApp.tab.model",
      icon: IconCpu,
    },
    {
      id: "style",
      labelKey: "settingsApp.tab.style",
      icon: IconSparkles,
    },
    {
      id: "vocabulary",
      labelKey: "settingsApp.tab.vocabulary",
      icon: IconBook,
    },
    {
      id: "interpreter",
      labelKey: "settingsApp.tab.interpreter",
      icon: IconLanguage,
    },
  ],
  [
    {
      id: "settings",
      labelKey: "settingsApp.tab.settings",
      icon: IconAdjustmentsHorizontal,
    },
    ...(import.meta.env.DEV
      ? [
          {
            id: "ui" as Tab,
            labelKey: "settingsApp.tab.ui" as MsgKey,
            icon: IconDeviceDesktopCog,
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

export function SettingsApp(): ReactElement {
  const { t } = useI18n();
  const initialQuery = new URLSearchParams(window.location.search);
  const [devOnboardingRequestId, setDevOnboardingRequestId] = useState(
    import.meta.env.DEV && initialQuery.get("onboarding") === "1" ? 1 : 0,
  );
  const [activeTab, setActiveTab] = useState<Tab>(resolveInitialTab);
  const [correctionSourceId, setCorrectionSourceId] = useState<string | null>(
    new URLSearchParams(window.location.search).get("tab") === "vocabulary"
      ? new URLSearchParams(window.location.search).get("resultId")
      : null,
  );
  const [focusedFileResultId, setFocusedFileResultId] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get("resultId"),
  );
  const [focusedHistoryEntryId, setFocusedHistoryEntryId] = useState<string | null>(null);
  const [focusedHistoryEntryNonce, setFocusedHistoryEntryNonce] = useState(0);
  const [themePreference, setThemePreference] = useState<ThemePreference>("system");
  const [navigationNonce, setNavigationNonce] = useState(0);
  const [showPermissions, setShowPermissions] = useState<boolean | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);

  useEffect(() => {
    void getVersion()
      .then(setAppVersion)
      .catch((error) => {
        void logError("SETTINGS_APP", `Failed to read app version: ${String(error)}`);
      });
  }, []);

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
      setCorrectionSourceId(nextTab === "vocabulary" ? payload.resultId || null : null);
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

  useEffect(() => {
    document.querySelector("main")?.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [activeTab]);

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
          role="status"
          style={{ display: "flex", alignItems: "center", gap: 12, color: "var(--label-2)" }}
        >
          <Spinner />
          <span>{t("settingsApp.loading")}</span>
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
            <div data-tauri-drag-region className="ui-sidebar-brand">
              <IconMicrophone size={20} weight="regular" aria-hidden="true" />
              <span data-tauri-drag-region>Talkee</span>
            </div>
            {SIDEBAR_GROUPS.map((group, groupIndex) => (
              <nav
                key={group[0]?.id ?? `group-${groupIndex}`}
                aria-label={t(
                  groupIndex === 0
                    ? "settingsApp.group.workspace"
                    : groupIndex === 1
                      ? "settingsApp.group.processing"
                      : "settingsApp.tab.settings",
                )}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  paddingTop: groupIndex === 0 ? 0 : "var(--space-3)",
                  marginTop: groupIndex === 2 ? "auto" : 0,
                  borderTop: groupIndex === 2 ? "1px solid var(--separator)" : "none",
                }}
              >
                {groupIndex < 2 && (
                  <div className="ui-sidebar-group-label" aria-hidden="true">
                    {t(
                      groupIndex === 0
                        ? "settingsApp.group.workspace"
                        : "settingsApp.group.processing",
                    )}
                  </div>
                )}
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
            {appVersion && (
              <div
                title={t("settingsApp.version", { version: appVersion })}
                style={{
                  padding: "0 12px",
                  color: "var(--label-2)",
                  fontSize: "var(--fs-caption)",
                  flexShrink: 0,
                }}
              >
                {t("settingsApp.version", { version: appVersion })}
              </div>
            )}
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
                    flex: isChatActive ? "1 1 auto" : undefined,
                    minHeight: isChatActive ? 0 : undefined,
                  }}
                >
                  <div
                    className="ui-workspace-page"
                    style={{ display: activeTab === "main" ? "block" : "none" }}
                  >
                    <MainTab
                      focusedEntryId={focusedHistoryEntryId}
                      focusedEntryNonce={focusedHistoryEntryNonce}
                    />
                  </div>
                  <div
                    className="ui-workspace-page"
                    style={{ display: activeTab === "file" ? "block" : "none" }}
                  >
                    <FileTranscriptionTab focusedEntryId={focusedFileResultId} />
                  </div>
                  <div
                    className="ui-workspace-page"
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
                    className="ui-workspace-page"
                    style={{
                      display: activeTab === "settings" ? "block" : "none",
                    }}
                  >
                    <SettingsTab />
                  </div>
                  {activeTab === "model" && (
                    <div className="ui-workspace-page">
                      <SettingsTabs type="model" />
                    </div>
                  )}
                  {activeTab === "style" && (
                    <div className="ui-workspace-page">
                      <SettingsTabs type="style" />
                    </div>
                  )}
                  {activeTab === "vocabulary" && (
                    <div className="ui-workspace-page">
                      <VocabularyTab
                        correctionSourceId={correctionSourceId}
                        onCorrectionClosed={() => setCorrectionSourceId(null)}
                      />
                    </div>
                  )}
                  {activeTab === "stats" && (
                    <div className="ui-workspace-page">
                      <StatsTab />
                    </div>
                  )}
                  {activeTab === "interpreter" && (
                    <div className="ui-workspace-page">
                      <TranslationTab />
                    </div>
                  )}
                  {import.meta.env.DEV && activeTab === "ui" && (
                    <div className="ui-workspace-page">
                      <Gallery />
                    </div>
                  )}
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
