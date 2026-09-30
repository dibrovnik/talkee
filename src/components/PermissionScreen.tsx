import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import { type ReactElement, type ReactNode, useCallback, useEffect, useState } from "react";
import { useI18n } from "../lib/i18n";
import { IconAlertCircle, IconCheck, IconKeyboard, IconMicrophone, IconVolume } from "../lib/icons";
import { logError, logInfo } from "../lib/logger";
import {
  checkAccessibilityPermission,
  checkMicrophonePermission,
  checkSystemAudioPermission,
  type PermissionStatus,
  requestMicrophonePermission,
  requestSystemAudioPermission,
} from "../lib/permissions";
import { getSettings } from "../lib/store";
import { scaleWidgetDimension } from "../lib/widgetScale";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { widgetStackHeight, widgetStackWidth } from "../windows/widget/widgetConstants";
import { OnboardingShell } from "./onboarding/OnboardingShell";

interface PermissionRowProps {
  icon: ReactNode;
  title: string;
  description: string;
  status: PermissionStatus;
  onAction: () => void;
  actionLabel?: string;
  actionDisabled?: boolean;
  helpText?: string;
}

function PermissionRow({
  icon,
  title,
  description,
  status,
  onAction,
  actionLabel,
  actionDisabled = false,
  helpText,
}: PermissionRowProps): ReactElement {
  const { t } = useI18n();
  const isGranted = status === "granted";
  const isDenied = status === "denied";
  const isPrompting = status === "prompting";

  return (
    <div className="ui-permission-row">
      <div
        className={`ui-permission-row__icon${isGranted ? " ui-permission-row__icon--granted" : ""}`}
      >
        {isGranted ? <IconCheck size={14} stroke={2.5} /> : icon}
      </div>

      <div className="ui-permission-row__main">
        <div className="ui-permission-row__head">
          <div className="ui-permission-row__title">
            <span>{title}</span>
            {!isGranted && (
              <Badge variant={isDenied ? "danger" : "neutral"}>
                {isPrompting
                  ? t("permission.badge.check")
                  : isDenied
                    ? t("permission.badge.actionNeeded")
                    : t("permission.badge.notGranted")}
              </Badge>
            )}
          </div>

          {!isGranted && (
            <Button
              variant={isPrompting ? "default" : "primary"}
              onClick={onAction}
              disabled={actionDisabled}
            >
              {actionLabel ??
                (isPrompting
                  ? t("permission.action.check")
                  : isDenied
                    ? t("permission.action.retry")
                    : t("permission.action.allow"))}
            </Button>
          )}
        </div>

        <div className="ui-permission-row__desc">{description}</div>
        {helpText && <div className="ui-form-hint">{helpText}</div>}
      </div>
    </div>
  );
}

interface PermissionScreenProps {
  onComplete: () => void;
  onboardingStep?: number;
}

interface AppRuntimeInfo {
  platform: "macos";
  executablePath: string;
  bundlePath: string;
  launchedViaTranslocation: boolean;
  launchedFromMountedVolume: boolean;
  shouldMoveToApplications: boolean;
}

type TranslateFn = ReturnType<typeof useI18n>["t"];

function microphoneHelpText(t: TranslateFn): string {
  return t("permission.micHelp.macos");
}

export function PermissionScreen({
  onComplete,
  onboardingStep,
}: PermissionScreenProps): ReactElement {
  const { t } = useI18n();
  const [micStatus, setMicStatus] = useState<PermissionStatus>("unknown");
  const [accStatus, setAccStatus] = useState<PermissionStatus>("unknown");
  const [systemAudioStatus, setSystemAudioStatus] = useState<PermissionStatus>("unknown");
  const [runtimeInfo, setRuntimeInfo] = useState<AppRuntimeInfo | null>(null);
  const [accessibilityRestartSuggested, setAccessibilityRestartSuggested] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [restartError, setRestartError] = useState<string | null>(null);

  const refreshAccessibilityStatus = useCallback(async () => {
    const nextStatus = await checkAccessibilityPermission();

    if (nextStatus === "granted") {
      setAccessibilityRestartSuggested(false);
      setRestartError(null);
    }

    setAccStatus((current) => {
      if (nextStatus === "granted") {
        return "granted";
      }

      return current === "prompting" ? "prompting" : nextStatus;
    });

    return nextStatus;
  }, []);

  const refreshAllPermissions = useCallback(async () => {
    const [nextMicStatus, nextAccStatus, nextSystemAudioStatus] = await Promise.all([
      checkMicrophonePermission(),
      refreshAccessibilityStatus(),
      checkSystemAudioPermission(),
    ]);

    setMicStatus(nextMicStatus);
    setSystemAudioStatus((current) => (current === "granted" ? "granted" : nextSystemAudioStatus));
    return { nextMicStatus, nextAccStatus, nextSystemAudioStatus };
  }, [refreshAccessibilityStatus]);

  useEffect(() => {
    void refreshAllPermissions();
  }, [refreshAllPermissions]);

  useEffect(() => {
    invoke<AppRuntimeInfo>("get_app_runtime_info")
      .then(setRuntimeInfo)
      .catch((error) => {
        void logError(
          "PERMISSIONS",
          `Failed to load runtime info: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }, []);

  useEffect(() => {
    if (accStatus !== "prompting") {
      return;
    }

    const refreshOnReturn = () => {
      if (document.visibilityState !== "visible") {
        return;
      }

      void refreshAccessibilityStatus();
    };

    const intervalId = window.setInterval(() => {
      void refreshAccessibilityStatus();
    }, 1000);

    window.addEventListener("focus", refreshOnReturn);
    document.addEventListener("visibilitychange", refreshOnReturn);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshOnReturn);
      document.removeEventListener("visibilitychange", refreshOnReturn);
    };
  }, [accStatus, refreshAccessibilityStatus]);

  const handleMicRequest = async () => {
    setMicStatus("prompting");
    const granted = await requestMicrophonePermission();
    setMicStatus(granted ? "granted" : "denied");
  };

  const handleAccessibilityRequest = async () => {
    if (accStatus === "prompting") {
      const nextStatus = await refreshAccessibilityStatus();
      if (nextStatus !== "granted" && requiresAccessibility) {
        setAccessibilityRestartSuggested(true);
      }
      return;
    }

    if (!requiresAccessibility) {
      setAccStatus("granted");
      return;
    }

    try {
      await invoke("open_accessibility_settings");
      setAccStatus("prompting");
    } catch (e) {
      void logError(
        "PERMISSIONS",
        `Failed to open accessibility settings: ${e instanceof Error ? e.message : String(e)}`,
      );
      setAccStatus("denied");
    }
  };

  const handleRestartAndCheck = async (): Promise<void> => {
    if (restarting) return;

    setRestarting(true);
    setRestartError(null);
    void logInfo("PERMISSIONS", "Restarting Talkee to refresh Accessibility permission");

    try {
      await relaunch();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void logError("PERMISSIONS", `Failed to restart Talkee: ${message}`);
      setRestartError(t("permission.hint.restartFailed"));
      setRestarting(false);
    }
  };

  const handleSystemAudioRequest = async () => {
    if (!requiresSystemAudio) {
      setSystemAudioStatus("granted");
      return;
    }

    setSystemAudioStatus("prompting");
    try {
      await requestSystemAudioPermission();
      setSystemAudioStatus("granted");
    } catch {
      setSystemAudioStatus("denied");
    }
  };

  const handleContinue = async () => {
    if (shouldShowInstallWarning) {
      await openPath("/Applications");
      return;
    }

    if (accessibilityRestartSuggested) {
      await handleRestartAndCheck();
      return;
    }

    const { nextMicStatus, nextAccStatus, nextSystemAudioStatus } = await refreshAllPermissions();

    if (
      nextMicStatus !== "granted" ||
      (requiresAccessibility && nextAccStatus !== "granted") ||
      (requiresSystemAudio && nextSystemAudioStatus !== "granted")
    ) {
      if (requiresAccessibility && accStatus === "prompting" && nextAccStatus !== "granted") {
        setAccessibilityRestartSuggested(true);
      }
      return;
    }

    const settings = await getSettings({ reload: true }).catch(() => null);
    const widgetScale = settings?.widgetScale ?? 1;
    await invoke("widget_resize", {
      width: scaleWidgetDimension(widgetStackWidth(false), widgetScale),
      height: scaleWidgetDimension(widgetStackHeight(false), widgetScale),
      growthOffsetRatio: 0,
    });
    onComplete();
  };

  const requiresAccessibility = true;
  const requiresSystemAudio = true;
  // In dev mode the binary lives in the build target dir (e.g. /Volumes/...),
  // which is not /Applications - but that's expected, so skip the warning.
  const shouldShowInstallWarning = import.meta.env.DEV
    ? false
    : Boolean(runtimeInfo?.shouldMoveToApplications);
  const pastePermissionTitle = t("permission.paste.titleAccessibility");
  const pastePermissionDescription = t("permission.paste.descAccessibility");
  const pastePermissionHelpText = shouldShowInstallWarning
    ? t("permission.paste.helpNotInApplications", {
        path: runtimeInfo?.bundlePath ?? "-",
      })
    : undefined;
  const canContinue =
    micStatus === "granted" &&
    (!requiresAccessibility || accStatus === "granted") &&
    (!requiresSystemAudio || systemAudioStatus === "granted");
  const canCompleteOnboarding = canContinue && !shouldShowInstallWarning;

  return (
    <OnboardingShell
      currentStep={onboardingStep ?? 0}
      showProgress={onboardingStep !== undefined}
      title={t("permission.header.title")}
      subtitle={t("permission.header.subtitle")}
      footer={
        <>
          <div
            className="ui-form-hint"
            style={{ color: canContinue ? "var(--success)" : undefined }}
          >
            {shouldShowInstallWarning
              ? t("permission.footer.launchFromApplications")
              : canContinue
                ? t("permission.footer.allGranted")
                : requiresSystemAudio
                  ? t("permission.footer.grantToContinue")
                  : requiresAccessibility
                    ? t("permission.footer.grantBothToContinue")
                    : t("permission.footer.grantMicToContinue")}
          </div>
          <Button
            variant={canCompleteOnboarding ? "primary" : "default"}
            size="large"
            onClick={handleContinue}
            disabled={restarting}
          >
            {accessibilityRestartSuggested
              ? restarting
                ? t("permission.button.restarting")
                : t("permission.button.restartAndCheck")
              : canCompleteOnboarding
                ? t("permission.button.continue")
                : shouldShowInstallWarning
                  ? "Applications"
                  : t("permission.button.check")}
          </Button>
        </>
      }
    >
      {shouldShowInstallWarning && (
        <div className="ui-callout ui-callout--error">
          <IconAlertCircle size={14} />
          <div>
            <div className="ui-callout__title">{t("permission.installWarning.title")}</div>
            <div>{t("permission.installWarning.desc")}</div>
          </div>
        </div>
      )}

      <div className="ui-form-group">
        <PermissionRow
          icon={<IconMicrophone size={16} />}
          title={t("permission.mic.title")}
          description={t("permission.mic.desc")}
          status={micStatus}
          onAction={handleMicRequest}
        />

        {requiresSystemAudio && (
          <PermissionRow
            icon={<IconVolume size={16} />}
            title={t("permission.systemAudio.title")}
            description={t("permission.systemAudio.desc")}
            status={systemAudioStatus}
            onAction={handleSystemAudioRequest}
            actionLabel={t("permission.action.check")}
            helpText={t("permission.systemAudio.help")}
          />
        )}

        <PermissionRow
          icon={<IconKeyboard size={16} />}
          title={pastePermissionTitle}
          description={pastePermissionDescription}
          status={
            requiresAccessibility && shouldShowInstallWarning
              ? "denied"
              : requiresAccessibility
                ? accStatus
                : "granted"
          }
          onAction={() => {
            if (shouldShowInstallWarning) {
              void openPath("/Applications");
              return;
            }

            if (accessibilityRestartSuggested) {
              void handleRestartAndCheck();
              return;
            }

            void handleAccessibilityRequest();
          }}
          actionLabel={
            accessibilityRestartSuggested
              ? restarting
                ? t("permission.button.restarting")
                : t("permission.button.restartAndCheck")
              : undefined
          }
          actionDisabled={restarting}
          helpText={pastePermissionHelpText}
        />
      </div>

      {(accStatus === "prompting" ||
        accessibilityRestartSuggested ||
        micStatus === "denied" ||
        systemAudioStatus === "denied") && (
        <div className="ui-callout">
          <IconAlertCircle size={14} />
          <div>
            {restartError ??
              (micStatus === "denied"
                ? microphoneHelpText(t)
                : systemAudioStatus === "denied"
                  ? t("permission.hint.systemAudioDenied")
                  : accessibilityRestartSuggested
                    ? t("permission.hint.restartAccessibility")
                    : shouldShowInstallWarning
                      ? t("permission.hint.reopenAfterMove")
                      : t("permission.hint.macosDelay"))}
          </div>
        </div>
      )}
    </OnboardingShell>
  );
}
