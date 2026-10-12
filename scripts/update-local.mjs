#!/usr/bin/env bun
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const destination = "/Applications/Talkee.app";
const executables = ["talkee", "talkee-stt", "talkee-diarize", "talkee-llm", "talkee-ffmpeg"];

/** Only the installed bundle: never touch dev builds, shells or unrelated apps. */
export function installedAppPids(output, appPath = destination) {
  const paths = executables.map((name) => join(appPath, "Contents", "MacOS", name));
  return output.split("\n").flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(.+)$/);
    if (!match || !paths.some((path) => match[2] === path || match[2].startsWith(`${path} `)))
      return [];
    return [Number(match[1])];
  });
}

function run(command, args, capture = false) {
  return execFileSync(command, args, {
    cwd: rootDir,
    stdio: capture ? "pipe" : "inherit",
    encoding: "utf8",
  });
}

function installedPids() {
  return installedAppPids(run("/bin/ps", ["-ax", "-o", "pid=,command="], true));
}

async function stopInstalledApp() {
  // Ask LaunchServices to quit normally first; separately stop leftover sidecars.
  if (installedPids().length) {
    try {
      run("/usr/bin/osascript", ["-e", `tell application "${destination}" to quit`], true);
    } catch {}
  }
  for (const pid of installedPids()) {
    try {
      process.kill(pid, "SIGTERM");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
  for (let attempt = 0; attempt < 40; attempt++) {
    if (!installedPids().length) return;
    await setTimeout(200);
  }
  throw new Error("Talkee did not stop. The installed app was not replaced; quit it and retry.");
}

export async function updateLocal() {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    throw new Error("Local installation is supported on Apple Silicon macOS only.");
  }
  run("bun", ["run", "gate"]);
  run("bun", ["run", "build:release:macos"]);
  const source = join(rootDir, "src-tauri", "target", "release", "bundle", "macos", "Talkee.app");
  const stage = mkdtempSync("/Applications/.talkee-update-");
  const stagedApp = join(stage, "Talkee.app");
  const backup = `/Applications/.Talkee.previous-${Date.now()}.app`;
  let backedUp = false;
  let installed = false;
  try {
    run("/usr/bin/ditto", [source, stagedApp]);
    run("/usr/bin/codesign", ["--verify", "--deep", "--strict", stagedApp]);
    for (const app of [stagedApp, ...(existsSync(destination) ? [destination] : [])]) {
      const id = run(
        "/usr/bin/plutil",
        ["-extract", "CFBundleIdentifier", "raw", "-o", "-", join(app, "Contents", "Info.plist")],
        true,
      ).trim();
      if (id !== "com.talkee.app") throw new Error(`Unexpected app identifier: ${id}`);
    }
    await stopInstalledApp();
    if (existsSync(destination)) {
      renameSync(destination, backup);
      backedUp = true;
    }
    renameSync(stagedApp, destination);
    installed = true;
    run("/usr/bin/open", [destination]);
    console.log(`Updated ${destination}${backedUp ? `\nPrevious version: ${backup}` : ""}`);
  } catch (error) {
    if (installed) renameSync(destination, join(stage, "failed.app"));
    if (backedUp) {
      renameSync(backup, destination);
      run("/usr/bin/open", [destination]);
    }
    throw error;
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  await updateLocal();
}
