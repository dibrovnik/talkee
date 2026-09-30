#!/usr/bin/env bun
/**
 * Regenerates every raster icon of the app from the SVG sources in
 * `assets/brand/`. See openspec/changes/new-app-icons/design.md, decision 2.
 *
 * Outputs (all committed, needed for the build):
 *   - src-tauri/icons/*        app icon PNGs + icon.icns
 *   - src-tauri/icons/tray/*   menu-bar template images (normal + recording)
 *   - public/favicon.png       WebView favicon
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, "..");
const BRAND_DIR = join(ROOT, "assets", "brand");
const ICONS_DIR = join(ROOT, "src-tauri", "icons");
const TRAY_DIR = join(ICONS_DIR, "tray");
const PUBLIC_DIR = join(ROOT, "public");

const APP_ICON_SVG = join(BRAND_DIR, "app-icon.svg");
const TRAY_ICON_SVG = join(BRAND_DIR, "tray-icon.svg");
const TRAY_RECORDING_SVG = join(BRAND_DIR, "tray-icon-recording.svg");

// Files `tauri icon` emits that a macOS-only bundle never uses.
const UNUSED_ICON_FILES = [/^icon\.ico$/, /^Square.*\.png$/, /^StoreLogo\.png$/];
const UNUSED_ICON_DIRS = ["android", "ios"];

/** Rasterize an SVG to PNG bytes at the requested pixel width. */
function renderPng(svgPath, width) {
  const resvg = new Resvg(readFileSync(svgPath), {
    fitTo: { mode: "width", value: width },
  });
  return resvg.render().asPng();
}

function renderTo(svgPath, width, outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, renderPng(svgPath, width));
}

async function runTauriIcon(input) {
  const proc = Bun.spawn(["bunx", "tauri", "icon", input, "-o", ICONS_DIR], {
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`\`bunx tauri icon\` failed with exit code ${code}`);
  }
}

/**
 * `tauri icon` writes the `.icns` container with its elements in a
 * non-deterministic order, so two runs over identical input differ byte for
 * byte. Re-serialize the elements sorted by type to keep the output
 * reproducible (the spec requires `bun run icons` to be idempotent).
 */
function normalizeIcns(filePath) {
  const buffer = readFileSync(filePath);
  if (buffer.subarray(0, 4).toString("ascii") !== "icns") {
    throw new Error("icon.icns: unexpected header");
  }

  const elements = [];
  let offset = 8;
  while (offset < buffer.length) {
    if (offset + 8 > buffer.length) {
      throw new Error(`icon.icns: truncated element header at ${offset}`);
    }
    const type = buffer.subarray(offset, offset + 4).toString("ascii");
    const size = buffer.readUInt32BE(offset + 4);
    if (size < 8 || offset + size > buffer.length) {
      throw new Error(`icon.icns: malformed element "${type}" at ${offset}`);
    }
    elements.push(buffer.subarray(offset, offset + size));
    offset += size;
  }

  elements.sort((left, right) => left.compare(right));

  const header = Buffer.alloc(8);
  header.write("icns", 0, "ascii");
  header.writeUInt32BE(8 + elements.reduce((sum, element) => sum + element.length, 0), 4);
  writeFileSync(filePath, Buffer.concat([header, ...elements]));
}

function pruneUnusedIcons() {
  for (const entry of readdirSync(ICONS_DIR)) {
    if (UNUSED_ICON_FILES.some((pattern) => pattern.test(entry))) {
      rmSync(join(ICONS_DIR, entry), { recursive: true, force: true });
    }
  }
  for (const dir of UNUSED_ICON_DIRS) {
    rmSync(join(ICONS_DIR, dir), { recursive: true, force: true });
  }
}

function generateTrayIcons() {
  renderTo(TRAY_ICON_SVG, 18, join(TRAY_DIR, "tray.png"));
  renderTo(TRAY_ICON_SVG, 36, join(TRAY_DIR, "tray@2x.png"));
  renderTo(TRAY_RECORDING_SVG, 18, join(TRAY_DIR, "tray-recording.png"));
  renderTo(TRAY_RECORDING_SVG, 36, join(TRAY_DIR, "tray-recording@2x.png"));
}

function generateFavicon() {
  renderTo(APP_ICON_SVG, 64, join(PUBLIC_DIR, "favicon.png"));
}

async function main() {
  for (const svg of [APP_ICON_SVG, TRAY_ICON_SVG, TRAY_RECORDING_SVG]) {
    if (!existsSync(svg)) {
      throw new Error(`Missing icon source: ${svg}`);
    }
  }

  // The generator owns the directory: wipe it so stale files cannot linger.
  rmSync(ICONS_DIR, { recursive: true, force: true });
  mkdirSync(ICONS_DIR, { recursive: true });

  const appPng = join(tmpdir(), "talkee-app-icon-1024.png");
  renderTo(APP_ICON_SVG, 1024, appPng);
  await runTauriIcon(appPng);
  rmSync(appPng, { force: true });
  normalizeIcns(join(ICONS_DIR, "icon.icns"));
  pruneUnusedIcons();

  generateTrayIcons();
  generateFavicon();

  console.log("generate-icons: wrote app, tray and favicon icons.");
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`generate-icons: ${error.message}`);
    process.exit(1);
  });
}
