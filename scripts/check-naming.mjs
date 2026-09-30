#!/usr/bin/env bun
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const NEEDLE = "talkis"; // legacy product name, compared case-insensitively
const ALLOWLIST_PATH = ["scripts", "naming-allowlist.json"];

// Directory names that never contain shipped source (build output, VCS, deps).
const IGNORED_SEGMENTS = new Set([
  "node_modules",
  ".git",
  "target",
  "dist",
  "dist-ssr",
]);

// Paths that are excluded outright: sidecar build artifacts, the regenerated
// lockfile, and the OpenSpec planning workspace (each active change is renamed
// by its own change, including this one).
const IGNORED_PREFIXES = [
  "src-tauri/binaries",
  "src-tauri/Cargo.lock",
  "openspec/changes",
];

export function normalizeRelative(path) {
  return path.split(sep).join("/");
}

export function loadAllowlist(baseDir = rootDir) {
  const parsed = JSON.parse(
    readFileSync(join(baseDir, ...ALLOWLIST_PATH), "utf8"),
  );
  return new Set(
    [...(parsed.allow ?? []), ...(parsed.temporaryAllow ?? [])].map(
      normalizeRelative,
    ),
  );
}

function isIgnored(relPath) {
  const segments = relPath.split("/");
  if (segments.some((segment) => IGNORED_SEGMENTS.has(segment))) {
    return true;
  }
  return IGNORED_PREFIXES.some(
    (prefix) => relPath === prefix || relPath.startsWith(`${prefix}/`),
  );
}

function looksBinary(buffer) {
  const sample = buffer.subarray(0, 8000);
  return sample.includes(0);
}

function collectFiles(baseDir, current, files) {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const absolute = join(current, entry.name);
    const relPath = normalizeRelative(relative(baseDir, absolute));
    if (isIgnored(relPath)) continue;

    if (entry.isDirectory()) {
      collectFiles(baseDir, absolute, files);
    } else if (entry.isFile()) {
      files.push({ absolute, relPath });
    }
  }
}

/**
 * Scan a directory tree for the legacy product name. Returns one match per
 * line that contains it, skipping binary files and allowlisted paths.
 */
export function scanForLegacyName(baseDir = rootDir, allowlist = loadAllowlist(baseDir)) {
  const files = [];
  collectFiles(baseDir, baseDir, files);

  const matches = [];
  for (const { absolute, relPath } of files) {
    if (allowlist.has(relPath)) continue;

    let buffer;
    try {
      buffer = readFileSync(absolute);
    } catch {
      continue;
    }
    if (looksBinary(buffer)) continue;

    const lines = buffer.toString("utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      if (line.toLowerCase().includes(NEEDLE)) {
        matches.push({ file: relPath, line: index + 1, text: line.trim() });
      }
    });
  }
  return matches;
}

function main() {
  const matches = scanForLegacyName();
  if (matches.length === 0) {
    console.log(
      "check:naming OK — no legacy name found outside scripts/naming-allowlist.json",
    );
    return;
  }

  console.error(
    `Found the legacy name "${NEEDLE}" in ${matches.length} place(s):`,
  );
  for (const match of matches) {
    console.error(`  ${match.file}:${match.line}: ${match.text}`);
  }
  process.exit(1);
}

if (import.meta.main) {
  main();
}
