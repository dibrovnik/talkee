#!/usr/bin/env bun
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(SCRIPT_DIR, "..");
const MANIFEST_PATH = "src-tauri/Cargo.toml";
const BINARIES_DIR = resolve(ROOT_DIR, "src-tauri", "binaries");
const SIDECAR_NAMES = ["talkee-ffmpeg", "talkee-stt", "talkee-diarize", "talkee-llm"];
const FALLBACK_TRIPLE = "aarch64-apple-darwin";

// Ordered from cheapest to most expensive so a failure surfaces as early as
// possible. `--keep-going` keeps running the remaining commands after a failure.
export const GATE_GROUPS = [
  {
    name: "static",
    commands: [
      { name: "version:check", cmd: ["bun", "run", "version:check"] },
      { name: "check:changelog", cmd: ["bun", "run", "check:changelog"] },
      { name: "check:network", cmd: ["bun", "run", "check:network"] },
      { name: "check:naming", cmd: ["bun", "run", "check:naming"] },
      { name: "check:agents-docs", cmd: ["bun", "run", "check:agents-docs"] },
      { name: "check:repo", cmd: ["bun", "run", "check:repo"] },
      { name: "openspec validate", cmd: ["openspec", "validate", "--all", "--strict"] },
    ],
  },
  {
    name: "format",
    commands: [
      { name: "biome ci", cmd: ["bunx", "biome", "ci", "."] },
      {
        name: "cargo fmt",
        cmd: ["cargo", "fmt", "--all", "--check", "--manifest-path", MANIFEST_PATH],
      },
    ],
  },
  {
    name: "types-lint",
    commands: [
      { name: "tsc (app)", cmd: ["bunx", "tsc", "--noEmit", "-p", "tsconfig.json"] },
      { name: "tsc (tests)", cmd: ["bunx", "tsc", "--noEmit", "-p", "tsconfig.test.json"] },
      {
        name: "cargo clippy",
        cmd: [
          "cargo",
          "clippy",
          "--workspace",
          "--all-targets",
          "--manifest-path",
          MANIFEST_PATH,
          "--",
          "-D",
          "warnings",
        ],
      },
    ],
  },
  {
    name: "tests",
    commands: [
      { name: "bun test", cmd: ["bun", "test"] },
      {
        name: "cargo test",
        cmd: ["cargo", "test", "--workspace", "--manifest-path", MANIFEST_PATH],
      },
    ],
  },
];

export function parseArgs(argv) {
  const options = { keepGoing: false, only: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--keep-going") {
      options.keepGoing = true;
    } else if (arg === "--only") {
      const value = argv[index + 1];
      if (!value) throw new Error("--only requires a group name");
      options.only = value;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

export function detectHostTriple(spawnSync = (cmd) => Bun.spawnSync(cmd, { stdout: "pipe" })) {
  try {
    const result = spawnSync(["rustc", "-vV"]);
    const text = result?.stdout?.toString?.() ?? "";
    const match = text.match(/^host:\s*(.+)$/m);
    if (match) return match[1].trim();
  } catch {
    // Fall through to the Apple Silicon default below.
  }
  return FALLBACK_TRIPLE;
}

// `tauri-build` resolves externalBin entries and hard-errors when a
// `binaries/<name>-<target-triple>` file is missing. Empty placeholders are
// enough for `cargo clippy`/`cargo test`; the real sidecars are not built here.
export function ensureSidecarPlaceholders({
  binariesDir = BINARIES_DIR,
  triple = detectHostTriple(),
  names = SIDECAR_NAMES,
  stdout = process.stdout,
  fs = { existsSync, mkdirSync, writeFileSync },
} = {}) {
  fs.mkdirSync(binariesDir, { recursive: true });
  const created = [];
  for (const name of names) {
    const file = join(binariesDir, `${name}-${triple}`);
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, "");
      created.push(file);
    }
  }
  if (created.length > 0) {
    stdout.write(
      `gate: created ${created.length} empty sidecar placeholder(s) for ${triple} (tauri-build requires them).\n`,
    );
  }
  return created;
}

function formatDuration(ms) {
  return `${(ms / 1000).toFixed(2)}s`;
}

function printSummary(results, stdout) {
  stdout.write("\ngate summary\n");
  const width = results.reduce((max, result) => Math.max(max, result.name.length), 0);
  for (const result of results) {
    const icon = result.status === "pass" ? "✓" : result.status === "fail" ? "✗" : "·";
    stdout.write(
      `  ${icon} ${result.name.padEnd(width)}  ${result.group}  ${formatDuration(result.ms)}\n`,
    );
  }
}

async function defaultExec(cmd, { cwd }) {
  const proc = Bun.spawn(cmd, { cwd, stdout: "inherit", stderr: "inherit" });
  return await proc.exited;
}

export async function runGate({
  groups = GATE_GROUPS,
  keepGoing = false,
  only = null,
  exec = defaultExec,
  stdout = process.stdout,
  stderr = process.stderr,
  now = () => performance.now(),
} = {}) {
  const selected = only ? groups.filter((group) => group.name === only) : groups;
  if (only && selected.length === 0) {
    stderr.write(
      `gate: unknown group "${only}". Known groups: ${groups.map((group) => group.name).join(", ")}\n`,
    );
    return { code: 1, results: [] };
  }

  const results = [];
  let aborted = false;

  for (const group of selected) {
    for (const command of group.commands) {
      if (aborted) {
        results.push({ group: group.name, name: command.name, status: "skipped", ms: 0 });
        continue;
      }

      stdout.write(`\n▶ ${group.name} · ${command.name}\n`);
      const start = now();
      let code;
      try {
        code = await exec(command.cmd, { cwd: ROOT_DIR, stdout, stderr });
      } catch (error) {
        code = 1;
        stderr.write(`gate: failed to run ${command.name}: ${error}\n`);
      }
      const ms = now() - start;
      const status = code === 0 ? "pass" : "fail";
      results.push({ group: group.name, name: command.name, status, ms });
      if (code !== 0) aborted = !keepGoing;
    }
  }

  printSummary(results, stdout);
  const failed = results.some((result) => result.status === "fail");
  return { code: failed ? 1 : 0, results };
}

const USAGE = `Usage: bun run gate [--keep-going] [--only <group>]

Groups (in order): ${GATE_GROUPS.map((group) => group.name).join(", ")}
`;

async function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  ensureSidecarPlaceholders();
  const { code } = await runGate({ keepGoing: options.keepGoing, only: options.only });
  return code;
}

if (import.meta.main) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error) => {
      process.stderr.write(`gate: ${error.message}\n`);
      process.exit(1);
    });
}
