import { describe, expect, it } from "bun:test";

import { isSettingsTab, resolveInitialSettingsTab } from "./settingsNavigation";

describe("settings navigation", () => {
  it("exposes chat as a product settings tab", () => {
    expect(isSettingsTab("chat")).toBe(true);
    expect(resolveInitialSettingsTab("?tab=chat")).toBe("chat");
  });

  it("exposes usage statistics as a settings tab", () => {
    expect(isSettingsTab("stats")).toBe(true);
    expect(resolveInitialSettingsTab("?tab=stats")).toBe("stats");
  });

  it("opens the vocabulary tab by deep link instead of falling back to main", () => {
    expect(isSettingsTab("vocabulary")).toBe(true);
    expect(resolveInitialSettingsTab("?tab=vocabulary")).toBe("vocabulary");
  });

  it("falls back to the main tab for unknown destinations", () => {
    expect(isSettingsTab("developer-tools")).toBe(false);
    expect(resolveInitialSettingsTab("?tab=developer-tools")).toBe("main");
  });
});
