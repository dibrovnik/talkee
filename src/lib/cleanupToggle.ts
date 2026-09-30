import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { showCleanupNotice } from "./cleanupNotice";
import { SETTINGS_UPDATED_EVENT } from "./hotkeyEvents";
import { tn } from "./i18n";
import { logError } from "./logger";
import { createSerialTaskQueue } from "./serialTaskQueue";
import {
  type AppSettings,
  type AppSettingsPatch,
  findPrompt,
  getSettings,
  listPromptsByKind,
  saveSettings,
} from "./store";
import { isCleanupAvailable } from "./textCleanup";
export interface CleanupMenuModel {
  enabled: boolean;
  presets: { id: string; name: string }[];
  selectedId: string;
}
export function buildCleanupMenuModel(settings: AppSettings): CleanupMenuModel {
  return {
    enabled: settings.cleanupEnabled,
    presets: listPromptsByKind(settings, "cleanup").map(({ id, name }) => ({ id, name })),
    selectedId: settings.selectedCleanupPromptId,
  };
}
interface CleanupDependencies {
  load: () => Promise<AppSettings>;
  save: (patch: AppSettingsPatch) => Promise<void>;
  publish: () => Promise<void>;
  notice: typeof showCleanupNotice;
  downloaded: (id: string) => Promise<boolean>;
  warm: (id: string) => Promise<unknown>;
}
const defaults: CleanupDependencies = {
  load: () => getSettings({ reload: true }),
  save: saveSettings,
  publish: () => emit(SETTINGS_UPDATED_EVENT),
  notice: showCleanupNotice,
  downloaded: async (id) =>
    (await invoke<{ id: string; downloaded: boolean }[]>("list_local_llm_models")).some(
      (model) => model.id === id && model.downloaded,
    ),
  warm: (id) => invoke("start_local_llm", { modelId: id }),
};
const queue = createSerialTaskQueue();
export function toggleCleanup(deps: Partial<CleanupDependencies> = {}): Promise<boolean> {
  return queue.enqueue(async () => {
    const d = { ...defaults, ...deps };
    const settings = await d.load();
    const enabled = !settings.cleanupEnabled;
    if (
      enabled &&
      (!isCleanupAvailable(settings) ||
        (settings.llmLocalModelId && !(await d.downloaded(settings.llmLocalModelId))))
    ) {
      await d.notice(tn("cleanup.noModel"), tn("cleanup.chooseModel"));
      return false;
    }
    await d.save({ cleanupEnabled: enabled });
    await d.publish();
    await d.notice(
      enabled
        ? tn("cleanup.on", {
            style: findPrompt(settings, settings.selectedCleanupPromptId)?.name ?? settings.style,
          })
        : tn("cleanup.off"),
    );
    if (enabled && settings.llmLocalModelId)
      void d
        .warm(settings.llmLocalModelId)
        .catch((error) => logError("CLEANUP", `Warm-up failed: ${String(error)}`));
    return enabled;
  });
}
export function selectCleanupPreset(
  id: string,
  deps: Partial<CleanupDependencies> = {},
): Promise<void> {
  return queue.enqueue(async () => {
    const d = { ...defaults, ...deps };
    const settings = await d.load();
    const preset = findPrompt(settings, id);
    if (preset?.kind !== "cleanup") throw new Error("Неизвестный стиль очистки");
    const patch: AppSettingsPatch = { selectedCleanupPromptId: id };
    if (id === "classic" || id === "business" || id === "tech") patch.style = id;
    await d.save(patch);
    await d.publish();
  });
}
