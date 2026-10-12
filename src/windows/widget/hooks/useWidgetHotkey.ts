import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { useCallback, useEffect, useRef } from "react";
import { toggleCleanup } from "../../../lib/cleanupToggle";
import {
  HANDY_HOTKEY_EVENT,
  type HandyHotkeyEventPayload,
  HOTKEY_CAPTURE_STATE_EVENT,
  HOTKEY_CHANGE_REQUEST_EVENT,
  HOTKEY_REGISTRATION_RESULT_EVENT,
  type HotkeyCaptureStatePayload,
  type HotkeyChangeRequestPayload,
  type HotkeyTarget,
  SETTINGS_UPDATED_EVENT,
} from "../../../lib/hotkeyEvents";
import { useI18n } from "../../../lib/i18n";
import { logError, logInfo } from "../../../lib/logger";
import {
  type AppSettings,
  DEFAULT_HOTKEY,
  DEFAULT_SELECTION_TRANSLATION_HOTKEY,
  getSettings,
  isUnsafeMacGlobalHotkey,
  normalizeHotkey,
  saveSettings,
} from "../../../lib/store";
import { applyHotkeyTransaction } from "../services/hotkeyTransaction";
import {
  captureVocabularyCorrection,
  installCorrectionCaptureBridge,
} from "../services/vocabularyCorrection";
import type { WidgetAction, WidgetMachineState } from "../services/widgetMachine";

interface UseWidgetHotkeyParams {
  settingsLoaded: boolean;
  settings: AppSettings | null;
  setSettings: Dispatch<SetStateAction<AppSettings | null>>;
  settingsRef: MutableRefObject<AppSettings | null>;
  machineRef: MutableRefObject<WidgetMachineState>;
  dispatch: (action: WidgetAction) => void;
  registeredHotkeyRef: MutableRefObject<string | null>;
  showError: (message: string) => void;
  onSelectionTranslationHotkey: () => void;
}

type HandyHotkeyIntent = "selection" | "voice" | "voice-cleanup" | "ignore";
type SelectionHotkeyAction = "arm" | "trigger" | "consume";
interface RegistrationAttemptResult {
  success: boolean;
  requestedHotkey: string;
  activeHotkey: string;
  message?: string;
}
export function resolveHandyHotkeyIntent({
  eventHotkey,
  voiceHotkey,
  selectionHotkey,
  selectionEnabled,
  cleanupRecordingHotkey = null,
}: {
  eventHotkey: string | null;
  voiceHotkey: string | null;
  selectionHotkey: string | null;
  selectionEnabled: boolean;
  cleanupRecordingHotkey?: string | null;
}): HandyHotkeyIntent {
  if (
    cleanupRecordingHotkey &&
    eventHotkey &&
    eventHotkey === cleanupRecordingHotkey &&
    eventHotkey !== voiceHotkey &&
    eventHotkey !== selectionHotkey
  ) {
    return "voice-cleanup";
  }

  if (
    selectionEnabled &&
    eventHotkey &&
    eventHotkey === selectionHotkey &&
    selectionHotkey !== voiceHotkey
  ) {
    return "selection";
  }

  if (eventHotkey && eventHotkey === voiceHotkey) {
    return "voice";
  }

  if (selectionEnabled && eventHotkey && eventHotkey === selectionHotkey) {
    return "ignore";
  }

  return "ignore";
}

export function resolveRecordingHotkeyCleanup(intent: "voice" | "voice-cleanup"): true | null {
  return intent === "voice-cleanup" ? true : null;
}

export function resolveSelectionHotkeyAction(
  state: HandyHotkeyEventPayload["state"],
  armed: boolean,
): SelectionHotkeyAction {
  if (state === "Pressed") {
    return "arm";
  }

  if (state === "Released" && armed) {
    return "trigger";
  }

  return "consume";
}

export function useWidgetHotkey({
  settingsLoaded,
  settings,
  setSettings,
  settingsRef,
  machineRef,
  dispatch,
  registeredHotkeyRef,
  showError,
  onSelectionTranslationHotkey,
}: UseWidgetHotkeyParams): void {
  const { t } = useI18n();
  const isHotkeyCaptureActiveRef = useRef(false);
  const activeCaptureRequestIdRef = useRef<string | null>(null);
  const correctionRegisteredHotkeyRef = useRef<string | null>(null);
  const correctionArmedRef = useRef(false);
  const cleanupRegisteredHotkeyRef = useRef<string | null>(null);
  const cleanupRecordingRegisteredHotkeyRef = useRef<string | null>(null);
  const cleanupHotkeyArmedRef = useRef(false);
  const selectionRegisteredHotkeyRef = useRef<string | null>(null);
  const latestRequestIdsRef = useRef<Record<HotkeyTarget, string | null>>({
    dictation: null,
    selection: null,
    cleanup: null,
    dictationCleanup: null,
    vocabularyCorrection: null,
  });
  const transactionQueueRef = useRef<Promise<void>>(Promise.resolve());
  const selectionHotkeyArmedRef = useRef(false);
  const handleHotkeyPressRef = useRef<(event: HandyHotkeyEventPayload) => void>(() => {});
  const retryRegistrationsRef = useRef<() => Promise<void>>(async () => {});

  const hotkeyForComparison = useCallback((hotkey: string | null | undefined): string | null => {
    if (!hotkey) return null;
    return normalizeHotkey(hotkey).normalized ?? hotkey;
  }, []);

  const unregisterHotkeyRef = useCallback(async (hotkeyRef: MutableRefObject<string | null>) => {
    const currentHotkey = hotkeyRef.current;
    if (!currentHotkey) return;

    logInfo("HOTKEY", `Unregistering: ${currentHotkey}`);
    await invoke("unregister_handy_hotkey", { hotkey: currentHotkey }).catch(() => {});
    hotkeyRef.current = null;
  }, []);

  const activateWidgetForHotkey = useCallback(() => {
    invoke("activate_widget_for_hotkey").catch((error) => {
      logError("HOTKEY", `Failed to activate widget for hotkey: ${error}`);
    });
  }, []);

  const handleHotkeyPress = useCallback(
    (event: HandyHotkeyEventPayload) => {
      if (isHotkeyCaptureActiveRef.current) {
        correctionArmedRef.current = false;
        cleanupHotkeyArmedRef.current = false;
        selectionHotkeyArmedRef.current = false;
        dispatch({ type: "RESET_HOTKEY_STATE" });
        return;
      }

      const machine = machineRef.current;
      logInfo("HOTKEY", `Triggered! state=${machine.widgetState}, shortcutState=${event.state}`);

      if (event.state !== "Pressed" && event.state !== "Released") {
        return;
      }

      const eventHotkey = hotkeyForComparison(event.hotkey);
      if (isUnsafeMacGlobalHotkey(eventHotkey)) {
        selectionHotkeyArmedRef.current = false;
        dispatch({ type: "RESET_HOTKEY_STATE" });
        logError("HOTKEY", `Ignored unsafe macOS system hotkey event: ${event.hotkey}`);
        return;
      }

      if (eventHotkey && eventHotkey === correctionRegisteredHotkeyRef.current) {
        const action = resolveSelectionHotkeyAction(event.state, correctionArmedRef.current);
        correctionArmedRef.current = action === "arm";
        if (action === "trigger")
          void captureVocabularyCorrection().catch(() =>
            showError(
              "Не удалось прочитать выделение. Выделите исправленную фразу и проверьте разрешение управления компьютером.",
            ),
          );
        return;
      }

      if (eventHotkey && eventHotkey === cleanupRegisteredHotkeyRef.current) {
        if (event.state === "Pressed" && !cleanupHotkeyArmedRef.current) {
          cleanupHotkeyArmedRef.current = true;
          void toggleCleanup().catch((error) => showError(String(error)));
        } else if (event.state === "Released") cleanupHotkeyArmedRef.current = false;
        return;
      }

      const voiceHotkey = hotkeyForComparison(
        registeredHotkeyRef.current ?? settingsRef.current?.hotkey ?? DEFAULT_HOTKEY,
      );
      const selectionHotkey = hotkeyForComparison(
        selectionRegisteredHotkeyRef.current ??
          settingsRef.current?.translation.selectionHotkey ??
          DEFAULT_SELECTION_TRANSLATION_HOTKEY,
      );

      const cleanupRecordingHotkey = hotkeyForComparison(
        settingsRef.current?.cleanupRecordingHotkey,
      );
      const intent = resolveHandyHotkeyIntent({
        eventHotkey,
        voiceHotkey,
        selectionHotkey,
        selectionEnabled: !!settingsRef.current?.translation.selectionEnabled,
        cleanupRecordingHotkey,
      });

      if (intent === "selection") {
        if (machine.widgetState !== "recording") {
          dispatch({ type: "RESET_HOTKEY_STATE" });
        }

        const action = resolveSelectionHotkeyAction(event.state, selectionHotkeyArmedRef.current);

        if (action === "arm") {
          selectionHotkeyArmedRef.current = true;
          logInfo("HOTKEY", `Selection translation hotkey armed: ${event.hotkey}`);
        } else if (action === "trigger") {
          selectionHotkeyArmedRef.current = false;
          logInfo("HOTKEY", `Selection translation hotkey released: ${event.hotkey}`);
          onSelectionTranslationHotkey();
        }
        return;
      }

      if (event.state === "Released" && selectionHotkeyArmedRef.current) {
        selectionHotkeyArmedRef.current = false;
        if (machine.widgetState !== "recording") {
          dispatch({ type: "RESET_HOTKEY_STATE" });
        }
        return;
      }

      if (intent !== "voice" && intent !== "voice-cleanup") {
        return;
      }

      const mode = settingsRef.current?.recordingHotkeyMode === "toggle" ? "toggle" : "hold";
      if (event.state === "Pressed") {
        activateWidgetForHotkey();
        dispatch({ type: "HOTKEY_PRESSED", mode, cleanup: resolveRecordingHotkeyCleanup(intent) });
      } else {
        dispatch({ type: "HOTKEY_RELEASED" });
      }
    },
    [
      activateWidgetForHotkey,
      dispatch,
      hotkeyForComparison,
      machineRef,
      onSelectionTranslationHotkey,
      registeredHotkeyRef,
      settingsRef,
    ],
  );

  useEffect(() => {
    handleHotkeyPressRef.current = handleHotkeyPress;
  }, [handleHotkeyPress]);

  const attemptHotkeyRegistration = useCallback(
    async (
      rawHotkey: string,
      activeHotkeyRef: MutableRefObject<string | null> = registeredHotkeyRef,
      fallbackHotkey: string = DEFAULT_HOTKEY,
    ): Promise<RegistrationAttemptResult> => {
      const normalized = normalizeHotkey(rawHotkey);
      if (!normalized.valid || !normalized.normalized) {
        return {
          success: false,
          requestedHotkey: rawHotkey,
          activeHotkey: activeHotkeyRef.current ?? fallbackHotkey,
          message: normalized.error || t("widget.hotkey.invalidFormat"),
        };
      }

      const nextHotkey = normalized.normalized;
      const currentHotkey = activeHotkeyRef.current;
      if (currentHotkey === nextHotkey) {
        return {
          success: true,
          requestedHotkey: nextHotkey,
          activeHotkey: nextHotkey,
        };
      }

      logInfo("HOTKEY", `Attempting to register: ${nextHotkey}`);

      try {
        await invoke("register_handy_hotkey", { hotkey: nextHotkey });

        activeHotkeyRef.current = nextHotkey;
        if (currentHotkey && currentHotkey !== nextHotkey) {
          const stillUsed = [
            registeredHotkeyRef,
            selectionRegisteredHotkeyRef,
            cleanupRegisteredHotkeyRef,
            cleanupRecordingRegisteredHotkeyRef,
            correctionRegisteredHotkeyRef,
          ].some((ref) => ref !== activeHotkeyRef && ref.current === currentHotkey);
          if (!stillUsed) {
            await invoke("unregister_handy_hotkey", {
              hotkey: currentHotkey,
            }).catch(() => {});
          }
        }
        logInfo("HOTKEY", `Registered successfully via handy-keys: ${nextHotkey}`);

        return {
          success: true,
          requestedHotkey: nextHotkey,
          activeHotkey: nextHotkey,
        };
      } catch (error) {
        logError("HOTKEY", `Failed to register ${nextHotkey}: ${error}`);
        return {
          success: false,
          requestedHotkey: nextHotkey,
          activeHotkey: currentHotkey ?? fallbackHotkey,
          message: t("widget.hotkey.registerFailed", { hotkey: nextHotkey }),
        };
      }
    },
    [registeredHotkeyRef, t],
  );

  const registerCurrentHotkey = useCallback(async () => {
    const activeSettings = settingsRef.current;
    if (!settingsLoaded || !activeSettings) {
      logInfo(
        "HOTKEY",
        `Skipping registration: loaded=${settingsLoaded}, settings=${!!activeSettings}`,
      );
      return;
    }

    const result = await attemptHotkeyRegistration(activeSettings.hotkey || DEFAULT_HOTKEY);
    if (!result.success) {
      showError(result.message || t("widget.hotkey.registerFailedGeneric"));
    }
  }, [attemptHotkeyRegistration, settingsLoaded, settingsRef, showError, t]);

  const registerSelectionHotkey = useCallback(async () => {
    const activeSettings = settingsRef.current;
    if (!settingsLoaded || !activeSettings) {
      return;
    }

    if (!activeSettings.translation.selectionEnabled) {
      await unregisterHotkeyRef(selectionRegisteredHotkeyRef);
      return;
    }

    const selectionHotkey =
      normalizeHotkey(
        activeSettings.translation.selectionHotkey || DEFAULT_SELECTION_TRANSLATION_HOTKEY,
      ).normalized || DEFAULT_SELECTION_TRANSLATION_HOTKEY;
    const voiceHotkey =
      normalizeHotkey(activeSettings.hotkey || DEFAULT_HOTKEY).normalized || DEFAULT_HOTKEY;

    if (selectionHotkey === voiceHotkey) {
      await unregisterHotkeyRef(selectionRegisteredHotkeyRef);
      logInfo(
        "HOTKEY",
        "Selection translation hotkey shares the voice hotkey; voice hotkey keeps ownership",
      );
      return;
    }

    const result = await attemptHotkeyRegistration(
      selectionHotkey,
      selectionRegisteredHotkeyRef,
      DEFAULT_SELECTION_TRANSLATION_HOTKEY,
    );
    if (!result.success) {
      showError(result.message || t("widget.hotkey.registerFailedGeneric"));
    }
  }, [attemptHotkeyRegistration, settingsLoaded, settingsRef, showError, t, unregisterHotkeyRef]);

  const registerCleanupRecordingHotkey = useCallback(async () => {
    if (!settingsLoaded) return;
    const hotkey = settingsRef.current?.cleanupRecordingHotkey || "";
    if (!hotkey) {
      await unregisterHotkeyRef(cleanupRecordingRegisteredHotkeyRef);
      return;
    }
    const result = await attemptHotkeyRegistration(
      hotkey,
      cleanupRecordingRegisteredHotkeyRef,
      hotkey,
    );
    if (!result.success) showError(result.message || t("widget.hotkey.registerFailedGeneric"));
  }, [attemptHotkeyRegistration, settingsLoaded, settingsRef, showError, t, unregisterHotkeyRef]);

  const registerCorrectionHotkey = useCallback(async () => {
    const hotkey = settingsRef.current?.vocabularyCorrectionHotkey || "";
    if (!hotkey) {
      await unregisterHotkeyRef(correctionRegisteredHotkeyRef);
      return;
    }
    const others = [
      settingsRef.current?.hotkey,
      settingsRef.current?.cleanupToggleHotkey,
      settingsRef.current?.cleanupRecordingHotkey,
      settingsRef.current?.translation.selectionHotkey,
    ];
    if (others.some((other) => hotkeyForComparison(other) === hotkeyForComparison(hotkey))) {
      showError(t("widget.hotkey.conflict"));
      return;
    }
    const result = await attemptHotkeyRegistration(hotkey, correctionRegisteredHotkeyRef);
    if (!result.success) showError(result.message || t("widget.hotkey.registerFailedGeneric"));
  }, [
    settingsRef,
    unregisterHotkeyRef,
    hotkeyForComparison,
    attemptHotkeyRegistration,
    showError,
    t,
  ]);

  useEffect(() => {
    if (settingsLoaded) void registerCorrectionHotkey();
  }, [registerCorrectionHotkey, settingsLoaded, settings?.vocabularyCorrectionHotkey]);
  useEffect(() => installCorrectionCaptureBridge(), []);

  const registerCleanupHotkey = useCallback(async () => {
    if (!settingsLoaded) return;
    const hotkey = settingsRef.current?.cleanupToggleHotkey || "";
    if (!hotkey) {
      await unregisterHotkeyRef(cleanupRegisteredHotkeyRef);
      return;
    }
    const result = await attemptHotkeyRegistration(hotkey, cleanupRegisteredHotkeyRef);
    if (!result.success) showError(result.message || t("widget.hotkey.registerFailedGeneric"));
  }, [attemptHotkeyRegistration, settingsLoaded, settingsRef, showError, t, unregisterHotkeyRef]);
  useEffect(() => {
    void registerCleanupHotkey();
  }, [registerCleanupHotkey, settings?.cleanupToggleHotkey]);

  useEffect(() => {
    void registerCleanupRecordingHotkey();
  }, [registerCleanupRecordingHotkey, settings?.cleanupRecordingHotkey]);

  useEffect(() => {
    void registerCurrentHotkey();
  }, [registerCurrentHotkey, settings?.hotkey]);

  useEffect(() => {
    void registerSelectionHotkey();
  }, [
    registerSelectionHotkey,
    settings?.hotkey,
    settings?.translation.selectionEnabled,
    settings?.translation.selectionHotkey,
  ]);

  useEffect(() => {
    retryRegistrationsRef.current = async () => {
      await registerCurrentHotkey();
      await registerSelectionHotkey();
      await registerCleanupHotkey();
      await registerCleanupRecordingHotkey();
      await registerCorrectionHotkey();
    };
  }, [
    registerCurrentHotkey,
    registerSelectionHotkey,
    registerCleanupHotkey,
    registerCleanupRecordingHotkey,
    registerCorrectionHotkey,
  ]);

  useEffect(() => {
    const unlistenSettings = listen(SETTINGS_UPDATED_EVENT, async () => {
      const latestSettings = await getSettings({ reload: true });
      setSettings(latestSettings);
      settingsRef.current = latestSettings;
      logInfo(
        "SETTINGS",
        `Applied settings update: mic=${latestSettings.micId || "[default]"}, hotkey=${latestSettings.hotkey}`,
      );
      await retryRegistrationsRef.current();
    });

    const unlistenCaptureState = listen<HotkeyCaptureStatePayload>(
      HOTKEY_CAPTURE_STATE_EVENT,
      ({ payload }) => {
        if (payload.active) {
          activeCaptureRequestIdRef.current = payload.requestId;
        } else if (activeCaptureRequestIdRef.current !== payload.requestId) {
          logInfo(
            "HOTKEY_CAPTURE",
            `Ignored stale capture state requestId=${payload.requestId} target=${payload.target}`,
          );
          return;
        } else {
          activeCaptureRequestIdRef.current = null;
        }
        isHotkeyCaptureActiveRef.current = payload.active;

        if (!payload.active) return;

        dispatch({ type: "RESET_HOTKEY_STATE" });
      },
    );

    const unlistenHandyHotkey = listen<HandyHotkeyEventPayload>(
      HANDY_HOTKEY_EVENT,
      ({ payload }) => {
        handleHotkeyPressRef.current(payload);
      },
    );

    const unlistenHotkeyRequests = listen<HotkeyChangeRequestPayload>(
      HOTKEY_CHANGE_REQUEST_EVENT,
      ({ payload }) => {
        latestRequestIdsRef.current[payload.target] = payload.requestId;

        const runTransaction = async (): Promise<void> => {
          let result: Awaited<ReturnType<typeof applyHotkeyTransaction>>;
          try {
            result = await applyHotkeyTransaction(payload, {
              loadSettings: () => getSettings({ reload: true }),
              saveSettings,
              registerHotkey: (hotkey) => invoke("register_handy_hotkey", { hotkey }),
              unregisterHotkey: (hotkey) => invoke("unregister_handy_hotkey", { hotkey }),
              getActiveHotkey: (target) => {
                switch (target) {
                  case "vocabularyCorrection":
                    return correctionRegisteredHotkeyRef.current;
                  case "dictation":
                    return registeredHotkeyRef.current;
                  case "cleanup":
                    return cleanupRegisteredHotkeyRef.current;
                  case "dictationCleanup":
                    return cleanupRecordingRegisteredHotkeyRef.current;
                  case "selection":
                    return selectionRegisteredHotkeyRef.current;
                }
              },
              setActiveHotkey: (target, hotkey) => {
                switch (target) {
                  case "vocabularyCorrection":
                    correctionRegisteredHotkeyRef.current = hotkey;
                    break;
                  case "dictation":
                    registeredHotkeyRef.current = hotkey;
                    break;
                  case "cleanup":
                    cleanupRegisteredHotkeyRef.current = hotkey;
                    break;
                  case "dictationCleanup":
                    cleanupRecordingRegisteredHotkeyRef.current = hotkey;
                    break;
                  case "selection":
                    selectionRegisteredHotkeyRef.current = hotkey;
                    break;
                }
              },
              isCurrentRequest: (target, requestId) =>
                latestRequestIdsRef.current[target] === requestId,
              log: (stage, request, message) => {
                const details = `requestId=${request.requestId} target=${request.target} stage=${stage} ${message}`;
                if (stage === "rollback" || stage === "conflict") {
                  logError("HOTKEY_TRANSACTION", details);
                } else {
                  logInfo("HOTKEY_TRANSACTION", details);
                }
              },
              messages: {
                conflict: t("widget.hotkey.conflict"),
                registerFailed: (hotkey) => t("widget.hotkey.registerFailed", { hotkey }),
                saveFailed: t("settingsGeneralExtra.hotkey.applyFailed"),
                stale: t("settingsGeneralExtra.hotkey.applyFailed"),
              },
            });
          } catch (error) {
            logError(
              "HOTKEY_TRANSACTION",
              `requestId=${payload.requestId} target=${payload.target} stage=load failed=${error}`,
            );
            result = {
              requestId: payload.requestId,
              target: payload.target,
              success: false,
              requestedHotkey: payload.hotkey,
              activeHotkey:
                (payload.target === "vocabularyCorrection"
                  ? correctionRegisteredHotkeyRef.current
                  : payload.target === "dictation"
                    ? registeredHotkeyRef.current
                    : payload.target === "cleanup"
                      ? cleanupRegisteredHotkeyRef.current
                      : payload.target === "dictationCleanup"
                        ? cleanupRecordingRegisteredHotkeyRef.current
                        : selectionRegisteredHotkeyRef.current) ?? payload.hotkey,
              message: t("settingsGeneralExtra.hotkey.applyFailed"),
            };
          }

          if (result.success) {
            const latestSettings = await getSettings({ reload: true });
            settingsRef.current = latestSettings;
            setSettings(latestSettings);
            emit(SETTINGS_UPDATED_EVENT).catch((error) => {
              logError(
                "HOTKEY_TRANSACTION",
                `requestId=${payload.requestId} target=${payload.target} stage=notify failed=${error}`,
              );
            });
          }

          emit(HOTKEY_REGISTRATION_RESULT_EVENT, result).catch((error) => {
            logError(
              "HOTKEY_TRANSACTION",
              `requestId=${payload.requestId} target=${payload.target} stage=result failed=${error}`,
            );
          });
        };

        transactionQueueRef.current = transactionQueueRef.current.then(
          runTransaction,
          runTransaction,
        );
      },
    );

    return () => {
      cleanupHotkeyArmedRef.current = false;
      selectionHotkeyArmedRef.current = false;
      unlistenSettings.then((unlisten) => unlisten());
      unlistenCaptureState.then((unlisten) => unlisten());
      unlistenHandyHotkey.then((unlisten) => unlisten());
      unlistenHotkeyRequests.then((unlisten) => unlisten());
      // The native manager owns registrations for the process lifetime and
      // drops them on shutdown. Unregistering here breaks shortcuts during
      // React Fast Refresh, because effect cleanup is also run for HMR.
    };
  }, []);
}
