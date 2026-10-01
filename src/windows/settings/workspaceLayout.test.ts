import { describe, expect, it } from "bun:test";

import {
  CONTENT_DRAG_REGION_HEIGHT,
  readViewportWidth,
  SIDEBAR_TRAFFIC_LIGHT_CLEARANCE,
  sidebarWidth,
  workspaceBottomGutter,
  workspaceGutter,
} from "./workspaceLayout";

describe("settings workspace geometry", () => {
  it("keeps the sidebar between 208 and 240 px", () => {
    expect(sidebarWidth(760)).toBe(208);
    expect(sidebarWidth(899)).toBe(208);
    expect(sidebarWidth(900)).toBe(224);
    expect(sidebarWidth(1099)).toBe(224);
    expect(sidebarWidth(1100)).toBe(240);
    expect(sidebarWidth(1600)).toBe(240);
  });

  it("shrinks padding instead of the sidebar when the window narrows", () => {
    expect(workspaceGutter(760)).toBe(16);
    expect(workspaceGutter(819)).toBe(16);
    expect(workspaceGutter(820)).toBe(24);
    expect(workspaceGutter(1023)).toBe(24);
    expect(workspaceGutter(1024)).toBe(32);
  });

  it("never drops the bottom gutter below 24 px", () => {
    expect(workspaceBottomGutter(760)).toBe(24);
    expect(workspaceBottomGutter(1024)).toBe(32);
  });

  it("keeps the traffic-light clearance above the native control height", () => {
    // Traffic lights are placed at y=20 with a 28 px hit area.
    expect(SIDEBAR_TRAFFIC_LIGHT_CLEARANCE).toBeGreaterThan(20 + 28);
    expect(CONTENT_DRAG_REGION_HEIGHT).toBe(SIDEBAR_TRAFFIC_LIGHT_CLEARANCE);
  });

  it("falls back to a stable width for unknown viewports", () => {
    expect(sidebarWidth(Number.NaN)).toBe(240);
    expect(sidebarWidth(0)).toBe(240);
    expect(workspaceGutter(Number.NaN)).toBe(16);
  });

  it("reads a usable viewport width outside a browser", () => {
    expect(readViewportWidth()).toBeGreaterThan(0);
  });
});
