import { emit } from "@tauri-apps/api/event";
export const FOREGROUND_ACTIVITY_EVENT = "processing:foreground-activity";
export interface ForegroundActivity {
  id: string;
  active: boolean;
}
const observers = new Set<(activity: ForegroundActivity) => void>();
export function observeForegroundActivity(
  observer: (activity: ForegroundActivity) => void,
): () => void {
  observers.add(observer);
  return () => {
    observers.delete(observer);
  };
}
export function notifyForegroundActivity(id: string, active: boolean): void {
  const activity = { id, active };
  for (const observer of observers) observer(activity);
  void emit(FOREGROUND_ACTIVITY_EVENT, activity).catch(() => {});
}
