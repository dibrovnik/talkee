#!/usr/bin/env bun
import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(SCRIPT_DIR, "..");

const MAX_BYTES = 5 * 1024 * 1024;

// The only file allowed inside the sidecar output directory.
const ALLOWED_BINARY_FILE = "src-tauri/binaries/.gitkeep";

export function listTrackedFiles(rootDir = DEFAULT_ROOT, exec = execFileSync) {
  const out = exec("git", ["ls-files", "-z"], {
    cwd: rootDir,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split("\0").filter((entry) => entry.length > 0);
}

export function isForbiddenPath(relPath) {
  const segments = relPath.split("/");
  if (segments.includes(".DS_Store")) return true;
  if (relPath === ALLOWED_BINARY_FILE) return false;
  if (relPath.startsWith("src-tauri/binaries/")) return true;
  if (segments.includes("target")) return true;
  if (segments.includes("dist")) return true;
  return false;
}

export function findForbiddenPaths(files) {
  return files.filter(isForbiddenPath);
}

export function findLargeFiles(rootDir, files, { maxBytes = MAX_BYTES, stat = statSync } = {}) {
  const large = [];
  for (const relPath of files) {
    let size;
    try {
      size = stat(join(rootDir, relPath)).size;
    } catch {
      continue;
    }
    if (size > maxBytes) large.push({ file: relPath, size });
  }
  return large;
}

export function run({
  rootDir = DEFAULT_ROOT,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  const files = listTrackedFiles(rootDir);
  const forbidden = findForbiddenPaths(files);
  const large = findLargeFiles(rootDir, files);

  if (forbidden.length > 0 || large.length > 0) {
    if (forbidden.length > 0) {
      stderr.write("Forbidden build/system files are tracked in git:\n");
      for (const relPath of forbidden) stderr.write(`  ${relPath}\n`);
    }
    if (large.length > 0) {
      stderr.write(`Files larger than ${MAX_BYTES / (1024 * 1024)} MB are tracked in git:\n`);
      for (const { file, size } of large) {
        stderr.write(`  ${file} (${(size / (1024 * 1024)).toFixed(1)} MB)\n`);
      }
    }
    return 1;
  }

  stdout.write(`check:repo OK — ${files.length} tracked files, none forbidden or oversized.\n`);
  return 0;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
const isDirectRun = import.meta.main === true || invokedPath === fileURLToPath(import.meta.url);

if (isDirectRun) {
  process.exit(run({ rootDir: process.cwd() }));
}
