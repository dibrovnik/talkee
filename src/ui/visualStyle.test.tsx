import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { IconHome } from "../lib/icons";
import { SidebarItem } from "./SidebarItem";

const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");

test("neutral workspace selection keeps readable text and regular icons", () => {
  const activeRule = css.match(
    /html\[data-window="settings"\] \.ui-sidebar-item--active\s*\{([^}]+)\}/,
  )?.[1];
  expect(activeRule).toContain("color: var(--label)");
  const active = renderToStaticMarkup(<SidebarItem label="Главная" icon={IconHome} active />);
  const idle = renderToStaticMarkup(<SidebarItem label="Главная" icon={IconHome} />);
  expect(active).toContain('aria-current="page"');
  expect(active.match(/<svg[\s\S]+<\/svg>/)?.[0]).toBe(idle.match(/<svg[\s\S]+<\/svg>/)?.[0]);
});

test("workspace and island motion have an explicit reduced-motion fallback", () => {
  const reducedRules = [
    ...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g),
  ]
    .map((match) => match[1])
    .join("\n");
  for (const selector of [".ui-workspace-page", ".island-level-bar", ".island-slot-content"]) {
    expect(reducedRules).toContain(selector);
  }
});

test("workspace icon buttons do not squeeze glyphs with text-button padding", () => {
  const iconRule = css.match(/html\[data-window="settings"\] \.ui-icon-button\s*\{([^}]+)\}/)?.[1];
  expect(iconRule).toContain("padding: 0");
  expect(iconRule).toContain("min-height: 32px");
});

test("status colors support explicit appearance", () => {
  expect(css).toContain("@supports (color: light-dark(white, black))");
  expect(css).toContain("--success: light-dark(#248a3d, #30d158)");
});

test("home removes the support carousel and displays six productivity metrics", () => {
  const home = readFileSync(
    new URL("../windows/settings/tabs/MainTab.tsx", import.meta.url),
    "utf8",
  );
  const panel = readFileSync(
    new URL("../components/TranscriptionStatsPanel.tsx", import.meta.url),
    "utf8",
  );
  expect(home).not.toContain("contactSupport");
  expect(home).not.toContain("MAIN_HERO_SLIDES");
  expect(panel.match(/key: "/g)).toHaveLength(6);
  expect(panel).toContain("SETTINGS_UPDATED_EVENT");
});
