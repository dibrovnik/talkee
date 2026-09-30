#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(SCRIPT_DIR, "..");
const DEFAULT_DOC = "AGENTS.md";

// Extensions that make a backticked token look like a repository path.
const KNOWN_EXTENSIONS = new Set([
  ".md",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".rs",
  ".css",
  ".html",
  ".sh",
  ".lock",
]);

// Tokens with these characters are templates/globs, not concrete paths.
const TEMPLATE_RE = /[<*~]/;

const BACKTICK_RE = /`([^`]+)`/g;

export function extractBackticked(content) {
  const withoutFences = content.replace(/```[\s\S]*?```/g, "");
  const tokens = new Set();
  let match = BACKTICK_RE.exec(withoutFences);
  while (match !== null) {
    const token = match[1].trim();
    if (token.length > 0) tokens.add(token);
    match = BACKTICK_RE.exec(withoutFences);
  }
  return [...tokens];
}

export function looksLikePath(token) {
  if (TEMPLATE_RE.test(token)) return false;
  if (token.startsWith("/")) return false; // slash commands such as /opsx:propose
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(token)) return false; // URLs
  if (token.includes("/")) return true;
  const dot = token.lastIndexOf(".");
  return dot > 0 && KNOWN_EXTENSIONS.has(token.slice(dot));
}

/**
 * Return the path-like backticked tokens from `docPath` that do not exist
 * relative to `rootDir`.
 */
export function findMissingPaths({
  rootDir = DEFAULT_ROOT,
  docPath = DEFAULT_DOC,
  exists = existsSync,
} = {}) {
  const content = readFileSync(resolve(rootDir, docPath), "utf8");
  return extractBackticked(content)
    .filter(looksLikePath)
    .filter((token) => !exists(resolve(rootDir, token)));
}

export function run({
  rootDir = DEFAULT_ROOT,
  docPath = DEFAULT_DOC,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  const missing = findMissingPaths({ rootDir, docPath });

  if (missing.length > 0) {
    stderr.write(`Found ${missing.length} path(s) in ${docPath} that do not exist:\n`);
    for (const token of missing) {
      stderr.write(`  ${token}\n`);
    }
    return 1;
  }

  stdout.write(`check:agents-docs OK — every path in ${docPath} exists.\n`);
  return 0;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
const isDirectRun = import.meta.main === true || invokedPath === fileURLToPath(import.meta.url);

if (isDirectRun) {
  process.exit(run({ rootDir: process.cwd() }));
}
