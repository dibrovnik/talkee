import { expect, test } from "bun:test";
import { buildCleanupMenuModel, selectCleanupPreset, toggleCleanup } from "./cleanupToggle";
import type { AppSettings, AppSettingsPatch } from "./store";

test("all cleanup entry points share persisted state and model availability", async () => {
  let settings = {
    cleanupEnabled: false,
    llmModel: "test",
    llmApiKey: "key",
    apiKey: "",
    llmEndpoint: "https://example.test/v1",
    llmLocalModelId: "",
    prompts: [],
    style: "classic",
    selectedCleanupPromptId: "classic",
  } as unknown as AppSettings;
  const notices: string[] = [];
  let published = 0;
  let warmed = 0;
  const deps = {
    load: async () => settings,
    save: async (patch: AppSettingsPatch) => {
      settings = { ...settings, ...patch } as AppSettings;
    },
    publish: async () => {
      published++;
    },
    notice: async (message: string) => {
      notices.push(message);
    },
    downloaded: async () => false,
    warm: async () => {
      warmed++;
    },
  };
  expect(await toggleCleanup(deps)).toBe(true);
  await selectCleanupPreset("business", deps);
  expect(buildCleanupMenuModel(settings)).toMatchObject({ enabled: true, selectedId: "business" });
  expect(settings.style).toBe("business");
  expect(await toggleCleanup(deps)).toBe(false);
  settings = { ...settings, llmModel: "none" };
  expect(await toggleCleanup(deps)).toBe(false);
  expect(settings.cleanupEnabled).toBe(false);
  settings = {
    ...settings,
    llmModel: "test",
    llmLocalModelId: "qwen3-1.7b-instruct-q4",
    llmEndpoint: "http://127.0.0.1:8011/v1",
  };
  expect(await toggleCleanup(deps)).toBe(false);
  expect(await toggleCleanup({ ...deps, downloaded: async () => true })).toBe(true);
  expect(warmed).toBe(1);
  expect(published).toBe(4);
  expect(notices.length).toBe(5);
  await expect(selectCleanupPreset("summary-short", deps)).rejects.toThrow();
  await selectCleanupPreset("tech", deps);
  expect(settings.style).toBe("tech");
});
