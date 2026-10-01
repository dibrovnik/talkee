export const SETTINGS_UPDATED_EVENT = "settings-updated";
export const HISTORY_UPDATED_EVENT = "history-updated";
export const HISTORY_DELETED_EVENT = "history-deleted";
export const HISTORY_CLEARED_EVENT = "history-cleared";
export const HOTKEY_CHANGE_REQUEST_EVENT = "hotkey-change-request";
export const HOTKEY_REGISTRATION_RESULT_EVENT = "hotkey-registration-result";
export const NATIVE_HOTKEY_CAPTURE_EVENT = "native-hotkey-capture";
export const HOTKEY_CAPTURE_STATE_EVENT = "hotkey-capture-state";
export const HANDY_HOTKEY_EVENT = "handy-hotkey-event";
export const SETTINGS_NAVIGATE_EVENT = "settings-navigate";
export const DEV_ONBOARDING_REQUEST_EVENT = "dev-onboarding-request";
export const DOCK_VISIBILITY_CHANGED_EVENT = "dock-visibility-changed";
export const TRAY_CALL_ACTION_EVENT = "tray-call-action";
export const CALL_CAPTURE_STOP_REQUEST_EVENT = "call-capture-stop-request";
export const WIDGET_RETRY_PROCESSING_EVENT = "widget-retry-processing";
export const PROCESSING_CANCEL_REQUEST_EVENT = "processing-cancel-request";
export const SELECTION_TEXT_REQUEST_EVENT = "selection-text-request";
export const SELECTION_TEXT_RESPONSE_EVENT = "selection-text-response";
export const DICTATION_STREAM_UPDATE_EVENT = "dictation-stream:update";
export const APP_DATA_MIGRATION_ERROR_EVENT = "app-data-migration-error";
export const NATIVE_VOICE_LEVEL_EVENT = "native-voice-level";

export type HotkeyTarget = "dictation" | "selection" | "cleanup" | "dictationCleanup";

export interface HotkeyChangeRequestPayload {
  requestId: string;
  target: HotkeyTarget;
  hotkey: string;
}

export interface HotkeyRegistrationResultPayload {
  requestId: string;
  target: HotkeyTarget;
  success: boolean;
  requestedHotkey: string;
  activeHotkey: string;
  message?: string;
}

export interface NativeHotkeyCapturePayload {
  requestId: string;
  target: HotkeyTarget;
  status: "listening" | "preview" | "completed" | "cancelled" | "stopped";
  hotkey?: string | null;
  message?: string | null;
}

export interface HotkeyCaptureStatePayload {
  requestId: string;
  target: HotkeyTarget;
  active: boolean;
}

export interface HandyHotkeyEventPayload {
  hotkey: string;
  state: "Pressed" | "Released";
}

export interface SettingsNavigatePayload {
  tab: "main" | "file" | "interpreter" | "chat" | "settings" | "model" | "style";
  resultId?: string | null;
}

export interface WidgetRetryProcessingPayload {
  active: boolean;
  source: "voice" | "call";
  entryId?: string;
}

export interface ProcessingCancelRequestPayload {
  entryId: string;
}

export interface CallCaptureStopRequestPayload {
  entryId: string;
}

export interface SelectionTextRequestPayload {
  requestId: string;
}

export interface SelectionTextResponsePayload {
  requestId: string;
  text: string;
  sourceWindow: string;
}

export interface DictationStreamUpdatePayload {
  requestId: string;
  status: "started" | "partial" | "final" | "error";
  text: string;
  message?: string;
}

export const FILE_JOB_START_EVENT = "file-job:start";
export const FILE_JOB_CANCEL_EVENT = "file-job:cancel";
export const FILE_JOB_SNAPSHOT_REQUEST_EVENT = "file-job:snapshot-request";
export const FILE_JOB_SNAPSHOT_EVENT = "file-job:snapshot";
export const FILE_JOB_UPDATE_EVENT = "file-job:update";

export interface FileJobSnapshotRequest {
  requestId: string;
}

export interface FileJobSnapshotResponse {
  requestId: string;
  jobs: import("./fileTranscriptionJobs").FileJobSnapshot[];
}
