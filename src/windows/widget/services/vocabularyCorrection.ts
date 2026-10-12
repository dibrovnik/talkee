import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";

export const CORRECTION_CAPTURE_EVENT = "vocabulary:correction-capture";
export const CORRECTION_PENDING_REQUEST_EVENT = "vocabulary:correction-pending";
export const CORRECTION_DISMISS_EVENT = "vocabulary:correction-dismiss";
export interface CorrectionCapture {
  id: string;
  text: string;
  sourceId: string | null;
}
let pending: CorrectionCapture | null = null;
let lastPaste: { sourceId: string; at: number } | null = null;

export function noteSuccessfulDictationPaste(sourceId: string, at = Date.now()): void {
  lastPaste = { sourceId, at };
}

export async function captureVocabularyCorrection(
  deps = {
    copy: () => invoke<string>("copy_selected_text"),
    show: () => invoke<void>("open_settings_tab", { tab: "vocabulary", resultId: null }),
    publish: (capture: CorrectionCapture) => emit(CORRECTION_CAPTURE_EVENT, capture),
    now: Date.now,
  },
): Promise<void> {
  pending = null;
  const text = await deps.copy();
  if (!text.trim()) throw new Error("Нет выделенной исправленной фразы");
  if ([...text].length > 50000) throw new Error("Выделение слишком длинное");
  const capture: CorrectionCapture = {
    id: crypto.randomUUID(),
    text,
    sourceId: lastPaste && deps.now() - lastPaste.at <= 10 * 60 * 1000 ? lastPaste.sourceId : null,
  };
  pending = capture;
  try {
    await deps.show();
    await deps.publish(capture);
  } catch (error) {
    pending = null;
    throw error;
  }
}

export function installCorrectionCaptureBridge(): () => void {
  const reads = listen(CORRECTION_PENDING_REQUEST_EVENT, () => {
    if (pending) void emit(CORRECTION_CAPTURE_EVENT, pending);
  });
  const dismisses = listen<{ id: string }>(CORRECTION_DISMISS_EVENT, ({ payload }) => {
    if (pending?.id === payload.id) pending = null;
  });
  return () => {
    pending = null;
    void reads.then((stop) => stop());
    void dismisses.then((stop) => stop());
  };
}
