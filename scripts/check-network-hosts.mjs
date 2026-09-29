#!/usr/bin/env bun
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, relative, resolve } from "node:path";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(SCRIPT_DIR, "..");
const DEFAULT_ALLOWLIST_PATH = join(SCRIPT_DIR, "network-allowlist.json");

const SCAN_TARGETS = [
  "src",
  "src-tauri/src",
  "src-tauri/sidecars",
  "index.html",
  "src/index.css",
];

const SCAN_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".rs",
  ".css",
  ".html",
  ".json",
]);

const SKIP_DIRS = new Set(["node_modules", "target", "dist", ".git"]);

const TEST_FILE_RE = /\.(test|spec)\.(ts|tsx|js|mjs|cjs)$/;

const ALWAYS_ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

const URL_RE = /https?:\/\/[^\s"'`)<>,]+/g;

const HOSTNAME_RE = /^[a-z0-9._:-]+$/i;

function isValidHostname(hostname) {
  return HOSTNAME_RE.test(hostname);
}

function normalizeHost(hostname) {
  return hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
}

export function parseAllowlist(raw) {
  const hosts = new Set();
  const pending = new Set();
  const suffixes = [];

  for (const entry of raw?.hosts ?? []) {
    if (entry?.host) hosts.add(normalizeHost(entry.host));
  }
  for (const entry of raw?.pendingRemoval ?? []) {
    if (entry?.host) pending.add(normalizeHost(entry.host));
  }
  for (const entry of raw?.hostSuffixes ?? []) {
    if (entry?.suffix) suffixes.push(normalizeHost(entry.suffix));
  }

  return { hosts, pending, suffixes };
}

export function isAlwaysAllowedHost(hostname) {
  return ALWAYS_ALLOWED_HOSTS.has(normalizeHost(hostname));
}

export function classifyHost(hostname, allowlist) {
  const host = normalizeHost(hostname);

  if (isAlwaysAllowedHost(host)) return "allowed";
  if (allowlist.hosts.has(host)) return "allowed";
  if (allowlist.suffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) {
    return "allowed";
  }
  if (allowlist.pending.has(host)) return "pending";

  return "blocked";
}

export function extractHosts(content) {
  const results = [];

  content.split(/\r?\n/).forEach((line, index) => {
    const re = new RegExp(URL_RE.source, "g");
    let match;
    while ((match = re.exec(line)) !== null) {
      let hostname;
      try {
        hostname = new URL(match[0]).hostname;
      } catch {
        continue;
      }
      if (!hostname || !isValidHostname(hostname)) continue;
      results.push({
        line: index + 1,
        host: normalizeHost(hostname),
        url: match[0],
      });
    }
  });

  return results;
}

export function scanContent(relPath, content, allowlist) {
  return extractHosts(content).map((entry) => ({
    file: relPath,
    line: entry.line,
    host: entry.host,
    status: classifyHost(entry.host, allowlist),
  }));
}

function walkFiles(absDir, out) {
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    const abs = join(absDir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walkFiles(abs, out);
    } else if (entry.isFile()) {
      if (!SCAN_EXTENSIONS.has(extname(entry.name))) continue;
      if (TEST_FILE_RE.test(entry.name)) continue;
      out.push(abs);
    }
  }
}

export function collectFiles(rootDir, targets = SCAN_TARGETS) {
  const found = new Set();

  for (const target of targets) {
    const abs = resolve(rootDir, target);
    let stats;
    try {
      stats = statSync(abs);
    } catch {
      continue;
    }

    if (stats.isFile()) {
      if (SCAN_EXTENSIONS.has(extname(abs)) && !TEST_FILE_RE.test(abs)) {
        found.add(abs);
      }
    } else if (stats.isDirectory()) {
      const out = [];
      walkFiles(abs, out);
      out.forEach((file) => found.add(file));
    }
  }

  return [...found].sort();
}

export function scanRepository(rootDir, allowlist, targets = SCAN_TARGETS) {
  const findings = [];

  for (const abs of collectFiles(rootDir, targets)) {
    const content = readFileSync(abs, "utf8");
    findings.push(...scanContent(relative(rootDir, abs), content, allowlist));
  }

  return findings;
}

export function formatFindings(findings) {
  return findings.map((finding) => `${finding.file}:${finding.line} ${finding.host}`).join("\n");
}

export function run({
  rootDir = DEFAULT_ROOT,
  allowlistPath = DEFAULT_ALLOWLIST_PATH,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  const allowlist = parseAllowlist(JSON.parse(readFileSync(allowlistPath, "utf8")));
  const findings = scanRepository(rootDir, allowlist);

  const pending = findings.filter((finding) => finding.status === "pending");
  const blocked = findings.filter((finding) => finding.status === "blocked");

  for (const finding of pending) {
    stderr.write(`warning: ${finding.file}:${finding.line} ${finding.host} is pending removal\n`);
  }

  if (blocked.length > 0) {
    stderr.write(
      "Blocked network hosts found. Add each host to scripts/network-allowlist.json with a reason, or remove the URL.\n",
    );
    stderr.write(`${formatFindings(blocked)}\n`);
    return 1;
  }

  stdout.write(
    `Network host check passed (${findings.length - pending.length} allowlisted, ${pending.length} pending removal).\n`,
  );
  return 0;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
const isDirectRun =
  import.meta.main === true ||
  invokedPath === fileURLToPath(import.meta.url);

if (isDirectRun) {
  process.exit(run({ rootDir: process.cwd() }));
}
