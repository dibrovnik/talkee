import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import {
  disable as disableAutostart,
  enable as enableAutostart,
  isEnabled as isAutostartEnabled,
} from "@tauri-apps/plugin-autostart";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useRef, useState } from "react";
import { DictationHotkeyControl } from "../../../components/DictationHotkeyControl";
import { LANGUAGES } from "../../../config/languages";
import { DOCK_VISIBILITY_CHANGED_EVENT, SETTINGS_UPDATED_EVENT } from "../../../lib/hotkeyEvents";
import { useI18n } from "../../../lib/i18n";
import { IconCheck, IconChevronDown, IconMail, IconSearch } from "../../../lib/icons";
import { logError, logInfo } from "../../../lib/logger";
import { checkMicrophonePermission } from "../../../lib/permissions";
import {
  type AppSettings,
  type AppSettingsPatch,
  getSettings,
  mergeAppSettingsPatch,
  saveSettings,
} from "../../../lib/store";
import { applyThemePreference } from "../../../lib/theme";
import {
  formatWidgetScalePercent,
  normalizeWidgetScale,
  WIDGET_SCALE_MAX,
  WIDGET_SCALE_MIN,
  WIDGET_SCALE_STEP,
} from "../../../lib/widgetScale";
import { Button } from "../../../ui/Button";
import { FormRow } from "../../../ui/FormRow";
import { FormSection } from "../../../ui/FormSection";
import { SegmentedControl } from "../../../ui/SegmentedControl";
import { Slider } from "../../../ui/Slider";
import { TextField } from "../../../ui/TextField";
import { Toggle } from "../../../ui/Toggle";
import { RecordingIndicatorSection } from "./RecordingIndicatorSection";

const SUPPORT_EMAIL = "david.perov60@gmail.com";

type MicAvailabilityState = "ready" | "missing-selected" | "permission-needed" | "empty";

const THEME_OPTIONS = [
  { value: "system", labelKey: "settings.theme.system" },
  { value: "light", labelKey: "settings.theme.light" },
  { value: "dark", labelKey: "settings.theme.dark" },
] as const;

export function SettingsTab() {
  const { lang, t } = useI18n();
  const [settings, setSettings] = useState<AppSettings | null>(null);

  // Language picker state
  const [langSearch, setLangSearch] = useState("");
  const [langOpen, setLangOpen] = useState(false);
  const langRef = useRef<HTMLDivElement>(null);

  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [micOpen, setMicOpen] = useState(false);
  const [micStatus, setMicStatus] = useState<MicAvailabilityState>("empty");
  const [, setMicMessage] = useState(t("settingsGeneralExtra.mic.checking"));
  const micRef = useRef<HTMLDivElement>(null);

  const settingsRef = useRef<AppSettings | null>(null);
  const widgetScaleSaveRequestRef = useRef(0);
  const [autostartEnabled, setAutostartEnabled] = useState(false);
  const [autostartLoaded, setAutostartLoaded] = useState(false);
  const [autostartPending, setAutostartPending] = useState(false);
  const [appDataDir, setAppDataDir] = useState("");
  const [supportFeedback, setSupportFeedback] = useState("");

  useEffect(() => {
    getSettings({ reload: true }).then((s) => {
      setSettings(s);
      settingsRef.current = s;
    });
  }, []);

  // The tray can toggle the Dock icon while this tab is open; Rust saves it.
  useEffect(() => {
    const unlistenPromise = listen<boolean>(DOCK_VISIBILITY_CHANGED_EVENT, ({ payload }) => {
      if (!settingsRef.current) return;
      const next = { ...settingsRef.current, showInDock: payload };
      settingsRef.current = next;
      setSettings(next);
    });
    return () => {
      void unlistenPromise.then((dispose) => dispose());
    };
  }, []);

  const updateShowInDock = async (show: boolean): Promise<void> => {
    await update({ showInDock: show });
    try {
      await invoke("set_dock_visibility", { show });
    } catch (error) {
      void logError(
        "SETTINGS",
        `Failed to apply Dock icon visibility: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  useEffect(() => {
    invoke<string>("get_default_transcription_storage_dir")
      .then(setAppDataDir)
      .catch((error) => {
        void logError(
          "SETTINGS",
          `Failed to load app data directory: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }, []);

  useEffect(() => {
    let mounted = true;

    const loadAutostartState = async (): Promise<void> => {
      try {
        const enabled = await isAutostartEnabled();
        if (!mounted) return;
        setAutostartEnabled(enabled);
        setAutostartLoaded(true);
      } catch (error) {
        if (!mounted) return;
        setAutostartLoaded(true);
        void logError(
          "SETTINGS",
          `Failed to load autostart state: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    };

    void loadAutostartState();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!settings) return;

    const fetchMics = async () => {
      try {
        if (!navigator.mediaDevices?.enumerateDevices) {
          void logInfo("SETTINGS", "Media devices API not available");
          setMicStatus("empty");
          setMicMessage(t("settingsGeneralExtra.mic.unavailableEnv"));
          return;
        }

        // Never open a capture stream just to label devices. On macOS that
        // starts an audio session and ducks other apps — a call in Telemost
        // gets about twice as quiet for as long as Talkee is running.
        const devices = await navigator.mediaDevices.enumerateDevices();
        const mics = devices.filter((d) => d.kind === "audioinput" && d.deviceId);
        if (mics.length === 0) {
          const permission = await checkMicrophonePermission();
          if (permission !== "granted") {
            setMicrophones([]);
            setMicStatus("permission-needed");
            setMicMessage(t("settingsGeneralExtra.mic.permissionNeeded"));
            return;
          }
        }

        const uniqueMics: MediaDeviceInfo[] = [];
        const seenIds = new Set<string>();
        for (const m of mics) {
          if (m.deviceId && !seenIds.has(m.deviceId)) {
            uniqueMics.push(m);
            seenIds.add(m.deviceId);
          }
        }

        setMicrophones(uniqueMics);

        const selectedMic = settings.micId
          ? uniqueMics.find((m) => m.deviceId === settings.micId)
          : null;
        if (settings.micId && !selectedMic) {
          setMicStatus("missing-selected");
          setMicMessage(t("settingsGeneralExtra.mic.missingSelected"));
          return;
        }

        if (uniqueMics.length === 0) {
          setMicStatus("empty");
          setMicMessage(t("settingsGeneralExtra.mic.noneFound"));
          return;
        }

        const activeLabel = selectedMic
          ? getMicrophoneLabel(selectedMic, uniqueMics.indexOf(selectedMic))
          : t("settings.mic.systemDefault");
        setMicStatus("ready");
        setMicMessage(t("settingsGeneralExtra.mic.inUse", { label: activeLabel }));
      } catch (err) {
        void logError(
          "SETTINGS",
          `IconMicrophone enumeration error: ${err instanceof Error ? err.message : String(err)}`,
        );
        setMicStatus("empty");
        setMicMessage(t("settingsGeneralExtra.mic.enumFailed"));
      }
    };

    fetchMics();

    navigator.mediaDevices?.addEventListener?.("devicechange", fetchMics);
    return () => {
      navigator.mediaDevices?.removeEventListener?.("devicechange", fetchMics);
    };
  }, [settings?.micId]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (langRef.current && !langRef.current.contains(e.target as Node)) setLangOpen(false);
      if (micRef.current && !micRef.current.contains(e.target as Node)) setMicOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const update = async (patch: AppSettingsPatch): Promise<AppSettings | null> => {
    if (!settingsRef.current) return null;
    const s = mergeAppSettingsPatch(settingsRef.current, patch);
    settingsRef.current = s;
    setSettings(s);
    const scaleRequestId =
      patch.widgetScale === undefined ? null : ++widgetScaleSaveRequestRef.current;
    if (scaleRequestId !== null) {
      void logInfo(
        "WIDGET_SCALE",
        `requestId=${scaleRequestId} stage=queued scale=${normalizeWidgetScale(patch.widgetScale)}`,
      );
    }
    await saveSettings(patch);
    if (scaleRequestId !== null) {
      void logInfo(
        "WIDGET_SCALE",
        `requestId=${scaleRequestId} stage=saved scale=${normalizeWidgetScale(patch.widgetScale)}`,
      );
    }
    emit(SETTINGS_UPDATED_EVENT).catch((e) => {
      void logError(
        "SETTINGS",
        `Failed to emit settings update event: ${e instanceof Error ? e.message : String(e)}`,
      );
    });
    return s;
  };

  const contactSupport = async (): Promise<void> => {
    const subject = encodeURIComponent(t("settingsGeneralExtra.support.mailSubject"));
    const body = encodeURIComponent(t("settingsGeneralExtra.support.mailBody"));
    const mailto = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;

    try {
      await openUrl(mailto);
      setSupportFeedback("");
    } catch (error) {
      void logError(
        "SETTINGS",
        `Failed to open support mail: ${error instanceof Error ? error.message : String(error)}`,
      );
      // Fallback: put the address on the clipboard so support is still reachable.
      try {
        await navigator.clipboard.writeText(SUPPORT_EMAIL);
        setSupportFeedback(
          t("settingsGeneralExtra.support.mailCopied", {
            email: SUPPORT_EMAIL,
          }),
        );
      } catch {
        setSupportFeedback(t("settingsGeneralExtra.support.writeUs", { email: SUPPORT_EMAIL }));
      }
    }
  };

  const toggleAutostart = async (): Promise<void> => {
    if (autostartPending) {
      return;
    }

    const nextEnabled = !autostartEnabled;
    setAutostartPending(true);

    try {
      if (nextEnabled) {
        await enableAutostart();
      } else {
        await disableAutostart();
      }

      const confirmedEnabled = await isAutostartEnabled();
      setAutostartEnabled(confirmedEnabled);
      setAutostartLoaded(true);
      void logInfo("SETTINGS", `Autostart ${confirmedEnabled ? "enabled" : "disabled"}`);
    } catch (error) {
      void logError(
        "SETTINGS",
        `Failed to update autostart: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setAutostartPending(false);
    }
  };

  const openAppDataDir = async (): Promise<void> => {
    try {
      const dir = appDataDir || (await invoke<string>("get_default_transcription_storage_dir"));
      setAppDataDir(dir);
      await openPath(dir);
      void logInfo("SETTINGS", `Opened app data directory: ${dir}`);
    } catch (error) {
      void logError(
        "SETTINGS",
        `Failed to open app data directory: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const getMicrophoneLabel = (mic: MediaDeviceInfo, index: number): string => {
    const label = mic.label?.trim();
    return label ? label : t("settingsGeneralExtra.mic.fallbackName", { index: index + 1 });
  };

  if (!settings) return null;

  const filteredLangs = LANGUAGES.filter(
    (l) =>
      l.name.toLowerCase().includes(langSearch.toLowerCase()) ||
      l.native.toLowerCase().includes(langSearch.toLowerCase()) ||
      l.code.toLowerCase().includes(langSearch.toLowerCase()),
  );
  const currentLang = LANGUAGES.find((l) => l.code === settings.language);
  const selectedMicrophone = microphones.find((m) => m.deviceId === settings.micId) || null;
  const visibleMicrophoneLabel = selectedMicrophone
    ? getMicrophoneLabel(selectedMicrophone, microphones.indexOf(selectedMicrophone))
    : t("settings.mic.systemDefault");
  const autostartDisabled = !autostartLoaded || autostartPending;
  const widgetScale = normalizeWidgetScale(settings.widgetScale);
  const realtimeTranscriptionActive = settings.realtimeTranscriptionEnabled;
  const micSelectDisabled = microphones.length === 0 || micStatus === "permission-needed";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <FormSection title={t("settings.uiLanguage.title")}>
        <FormRow
          label={t("settings.uiLanguage.title")}
          description={t("settings.uiLanguage.desc")}
          control={
            <SegmentedControl
              value={lang}
              onChange={(value) => {
                void update({ uiLanguage: value as "ru" | "en" });
              }}
              options={[
                { value: "ru", label: t("settings.uiLanguage.ru") },
                { value: "en", label: t("settings.uiLanguage.en") },
              ]}
              ariaLabel={t("settings.uiLanguage.title")}
            />
          }
        />
        <FormRow
          label={t("settings.theme.title")}
          control={
            <SegmentedControl
              value={settings.theme}
              onChange={(value) => {
                const theme = value as AppSettings["theme"];
                applyThemePreference(theme);
                void update({ theme });
              }}
              options={THEME_OPTIONS.map(({ value, labelKey }) => ({
                value,
                label: t(labelKey),
              }))}
              ariaLabel={t("settings.theme.title")}
            />
          }
        />
      </FormSection>

      <FormSection title={t("settings.recognitionLang.title")}>
        <FormRow
          label={t("settings.recognitionLang.title")}
          control={
            <div ref={langRef} style={{ position: "relative", width: "100%" }}>
              <Button
                onClick={() => setLangOpen((o) => !o)}
                style={{
                  width: "100%",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {currentLang ? `${currentLang.native} (${currentLang.name})` : settings.language}
                </span>
                <IconChevronDown
                  size={11}
                  stroke={2}
                  style={{
                    flexShrink: 0,
                    transform: langOpen ? "rotate(180deg)" : "none",
                    transition: "transform 0.15s",
                  }}
                />
              </Button>
              {langOpen && (
                <div
                  style={{
                    position: "absolute",
                    top: "calc(100% + 6px)",
                    right: 0,
                    width: 320,
                    maxHeight: 320,
                    background: "var(--control-bg)",
                    border: "1px solid var(--separator)",
                    borderRadius: "var(--radius-group)",
                    boxShadow: "var(--shadow-panel)",
                    zIndex: 100,
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      padding: 8,
                      borderBottom: "1px solid var(--separator)",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <IconSearch size={11} style={{ color: "var(--label-3)", flexShrink: 0 }} />
                    <input
                      ref={(el) => {
                        el?.focus();
                      }}
                      value={langSearch}
                      onChange={(e) => setLangSearch(e.target.value)}
                      placeholder={t("settings.recognitionLang.searchPlaceholder")}
                      style={{
                        border: "none",
                        outline: "none",
                        background: "transparent",
                        font: "inherit",
                        fontSize: "var(--fs-callout)",
                        color: "var(--label)",
                        flex: 1,
                      }}
                    />
                  </div>
                  <div style={{ overflow: "auto", flex: 1 }}>
                    {filteredLangs.length === 0 ? (
                      <div
                        style={{
                          padding: "10px 12px",
                          fontSize: "var(--fs-callout)",
                          color: "var(--label-3)",
                        }}
                      >
                        {t("common.notFound")}
                      </div>
                    ) : (
                      filteredLangs.map((language) => {
                        const active = settings.language === language.code;

                        return (
                          <button
                            key={language.code}
                            type="button"
                            onClick={() => {
                              void update({ language: language.code });
                              setLangOpen(false);
                              setLangSearch("");
                            }}
                            className={["ui-menu-item", active ? "ui-menu-item--active" : ""]
                              .filter(Boolean)
                              .join(" ")}
                          >
                            <span className="ui-menu-item__hint">{language.code}</span>
                            <span style={{ flex: 1 }}>{language.native}</span>
                            <span className="ui-menu-item__hint">{language.name}</span>
                            {active && (
                              <IconCheck
                                size={11}
                                stroke={2.5}
                                style={{ color: "var(--label)", flexShrink: 0 }}
                              />
                            )}
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          }
        />
        <FormRow
          label={t("settings.mic.title")}
          control={
            <div ref={micRef} style={{ position: "relative", width: "100%" }}>
              <Button
                disabled={micSelectDisabled}
                onClick={() => {
                  if (micSelectDisabled) return;
                  setMicOpen((o) => !o);
                }}
                style={{
                  width: "100%",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {microphones.length === 0
                    ? t("settings.mic.systemDefault")
                    : visibleMicrophoneLabel}
                </span>
                <IconChevronDown
                  size={11}
                  stroke={2}
                  style={{
                    flexShrink: 0,
                    transform: micOpen ? "rotate(180deg)" : "none",
                    transition: "transform 0.15s",
                  }}
                />
              </Button>

              {micOpen && microphones.length > 0 && (
                <div
                  style={{
                    position: "absolute",
                    top: "calc(100% + 6px)",
                    right: 0,
                    width: "100%",
                    maxHeight: 240,
                    background: "var(--control-bg)",
                    border: "1px solid var(--separator)",
                    borderRadius: "var(--radius-group)",
                    boxShadow: "var(--shadow-panel)",
                    zIndex: 100,
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                  }}
                >
                  <div style={{ overflow: "auto", flex: 1, padding: "4px 0" }}>
                    <button
                      type="button"
                      onClick={() => {
                        void update({ micId: "" });
                        setMicOpen(false);
                      }}
                      className={[
                        "ui-menu-item",
                        settings.micId === "" ? "ui-menu-item--active" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      <span
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {t("settings.mic.systemDefault")}
                      </span>
                      {settings.micId === "" && (
                        <IconCheck
                          size={11}
                          stroke={2.5}
                          style={{ color: "var(--label)", flexShrink: 0 }}
                        />
                      )}
                    </button>
                    {microphones.map((m, i) => {
                      const active = settings.micId === m.deviceId;

                      return (
                        <button
                          key={m.deviceId}
                          type="button"
                          onClick={() => {
                            void update({ micId: m.deviceId });
                            setMicOpen(false);
                          }}
                          className={["ui-menu-item", active ? "ui-menu-item--active" : ""]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          <span
                            style={{
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {getMicrophoneLabel(m, i)}
                          </span>
                          {active && (
                            <IconCheck
                              size={11}
                              stroke={2.5}
                              style={{ color: "var(--label)", flexShrink: 0 }}
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          }
        />
      </FormSection>

      <FormSection title={t("settings.hotkey.title")}>
        <FormRow
          label={t("settings.hotkey.plain")}
          description={t("settings.hotkey.plainDesc")}
          control={
            <DictationHotkeyControl
              settings={settings}
              onSettingsChange={(latestSettings) => {
                settingsRef.current = latestSettings;
                setSettings(latestSettings);
              }}
            />
          }
        />
        <FormRow
          label={t("settings.hotkey.cleanup")}
          description={t("settings.hotkey.cleanupDesc")}
          control={
            <DictationHotkeyControl
              target="dictationCleanup"
              settings={settings}
              onSettingsChange={(latestSettings) => {
                settingsRef.current = latestSettings;
                setSettings(latestSettings);
              }}
            />
          }
        />
        <FormRow
          label={t("settings.hotkey.mode")}
          description={t("settings.hotkey.modeDesc")}
          control={
            <SegmentedControl
              ariaLabel={t("settings.hotkey.mode")}
              value={settings.recordingHotkeyMode}
              onChange={(recordingHotkeyMode) => {
                void update({ recordingHotkeyMode });
              }}
              options={[
                { value: "hold", label: t("settings.hotkey.modeHold") },
                { value: "toggle", label: t("settings.hotkey.modeToggle") },
              ]}
            />
          }
        />
      </FormSection>

      <RecordingIndicatorSection
        presentation={settings.widgetPresentation}
        fallback={settings.islandFallback}
        textDisplay={settings.textDisplay}
        onPresentationChange={(widgetPresentation) => {
          void update({ widgetPresentation });
        }}
        onFallbackChange={(islandFallback) => {
          void update({ islandFallback });
        }}
        onTextDisplayChange={(textDisplay) => {
          void update({ textDisplay });
        }}
      />

      <FormSection title={t("settings.widgetSize.title")}>
        <FormRow
          label={t("settings.widgetSize.title")}
          description={
            settings.widgetPresentation === "island"
              ? t("settings.widgetSize.islandDisabled")
              : undefined
          }
          control={
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) 48px",
                alignItems: "center",
                gap: 10,
                width: "100%",
              }}
            >
              <Slider
                min={WIDGET_SCALE_MIN}
                max={WIDGET_SCALE_MAX}
                step={WIDGET_SCALE_STEP}
                value={widgetScale}
                disabled={settings.widgetPresentation === "island"}
                onChange={(value) => {
                  void update({ widgetScale: normalizeWidgetScale(value) });
                }}
                ariaLabel={t("settings.widgetSize.aria")}
              />
              <div
                style={{
                  height: 22,
                  borderRadius: 5,
                  background: "var(--control-track)",
                  color: "var(--label)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "var(--fs-subhead)",
                  fontWeight: 600,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {formatWidgetScalePercent(widgetScale)}
              </div>
            </div>
          }
        />
      </FormSection>

      <FormSection title={t("settings.autostart.title")}>
        <FormRow
          label={t("settings.autostart.title")}
          description={t("settings.autostart.desc")}
          control={
            <Toggle
              checked={autostartEnabled}
              disabled={autostartDisabled}
              onChange={() => {
                void toggleAutostart();
              }}
              ariaLabel={t("settings.autostart.title")}
            />
          }
        />
        <FormRow
          label={t("settings.dock.title")}
          description={t("settings.dock.desc")}
          control={
            <Toggle
              checked={settings.showInDock}
              onChange={(checked) => {
                void updateShowInDock(checked);
              }}
              ariaLabel={t("settings.dock.title")}
            />
          }
        />
        <FormRow
          label={t("settings.realtimeTranscription.title")}
          description={t("settings.realtimeTranscription.desc")}
          control={
            <Toggle
              checked={realtimeTranscriptionActive}
              onChange={() => {
                void update({
                  realtimeTranscriptionEnabled: !settings.realtimeTranscriptionEnabled,
                });
              }}
              ariaLabel={t("settings.realtimeTranscription.title")}
            />
          }
        />
        <FormRow
          label={t("settings.recordingAudio.title")}
          control={
            <Toggle
              checked={settings.saveRecordingAudio}
              onChange={() => {
                void update({
                  saveRecordingAudio: !settings.saveRecordingAudio,
                });
              }}
              ariaLabel={t("settings.recordingAudio.title")}
            />
          }
        />
      </FormSection>

      <FormSection title={t("settings.appDataDir.title")}>
        <FormRow
          label={t("settings.appDataDir.title")}
          control={
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                width: "100%",
              }}
            >
              <Button
                onClick={() => {
                  void openAppDataDir();
                }}
                style={{ width: "100%", justifyContent: "center" }}
              >
                {t("common.open")}
              </Button>
              <TextField
                value={appDataDir}
                readOnly
                placeholder={t("settings.modelsDir.placeholder")}
                style={{
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                  fontSize: "var(--fs-subhead)",
                }}
              />
            </div>
          }
        />
      </FormSection>

      <FormSection title={t("settings.support.title")}>
        <FormRow
          label={t("settings.support.title")}
          description={supportFeedback || undefined}
          control={
            <Button
              onClick={() => {
                void contactSupport();
              }}
              style={{ gap: 6 }}
            >
              <IconMail size={12} stroke={2} />
              {t("settings.support.button")}
            </Button>
          }
        />
      </FormSection>
    </div>
  );
}
