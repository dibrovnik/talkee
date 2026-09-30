#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(SCRIPT_DIR, "..");

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * True when `changelog` contains a `## [<version>]` section heading.
 */
export function hasVersionSection(changelog, version) {
  return new RegExp(`^## \\[${escapeRegExp(version)}\\]`, "m").test(changelog);
}

export function run({
  rootDir = DEFAULT_ROOT,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  const version = JSON.parse(
    readFileSync(resolve(rootDir, "package.json"), "utf8"),
  ).version;

  let changelog;
  try {
    changelog = readFileSync(resolve(rootDir, "CHANGELOG.md"), "utf8");
  } catch {
    stderr.write("CHANGELOG.md not found.\n");
    return 1;
  }

  if (!hasVersionSection(changelog, version)) {
    stderr.write(
      `CHANGELOG.md is missing a "## [${version}]" section.\n` +
        `Rename "## [Unreleased]" to "## [${version}] - YYYY-MM-DD" ` +
        `and add a new empty "## [Unreleased]" above it.\n`,
    );
    return 1;
  }

  stdout.write(
    `check:changelog OK — CHANGELOG.md has a section for ${version}.\n`,
  );
  return 0;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
const isDirectRun =
  import.meta.main === true || invokedPath === fileURLToPath(import.meta.url);

if (isDirectRun) {
  process.exit(run({ rootDir: process.cwd() }));
}
