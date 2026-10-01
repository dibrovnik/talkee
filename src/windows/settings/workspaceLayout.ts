/**
 * Geometry for the main settings window shell (ChatGPT-like workspace).
 *
 * Decision 1 of `polish-daily-workflow`: calm ~240 px sidebar, one working
 * column up to 900 px, padded spacing scale (4/8/12/16/24/32). When the window
 * is narrow the padding shrinks — never the fonts and never the hit targets.
 * There is no new window chrome: the native macOS traffic lights float over the
 * overlay title bar, so the sidebar reserves room for them.
 */

/** Native traffic lights sit at (20, 20) with a 28 px hit area; 12 px below. */
export const SIDEBAR_TRAFFIC_LIGHT_CLEARANCE = 52;

/** Top drag strip on the content side (no visible chrome over the content). */
export const CONTENT_DRAG_REGION_HEIGHT = 52;

export function sidebarWidth(viewportWidth: number): number {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return 240;
  if (viewportWidth < 900) return 208;
  if (viewportWidth < 1100) return 224;
  return 240;
}

export function workspaceGutter(viewportWidth: number): number {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return 16;
  if (viewportWidth < 820) return 16;
  if (viewportWidth < 1024) return 24;
  return 32;
}

export function workspaceBottomGutter(viewportWidth: number): number {
  return Math.max(workspaceGutter(viewportWidth), 24);
}

/** Reads the live window width; falls back to the desktop viewport in previews. */
export function readViewportWidth(): number {
  if (typeof window === "undefined") return 1024;
  return window.innerWidth || document.documentElement.clientWidth || 1024;
}
