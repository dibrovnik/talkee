import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const staticMsvcRuntimeArg = "-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded";

function appendUniqueArgument(value, argument) {
  const current = value?.trim() || "";
  if (current.split(/\s+/).includes(argument)) return current;
  return [current, argument].filter(Boolean).join(" ");
}

function detectPlatform() {
  if (process.platform === "darwin") return "macos";
  if (process.platform === "win32") return "windows";
  if (process.platform === "linux") return "linux";
  throw new Error(`Unsupported release platform: ${process.platform}`);
}

const platform =
  process.argv[2] || process.env.TALKEE_RELEASE_PLATFORM || detectPlatform();
const bundleTargets = {
  macos: ["app"],
  windows: ["nsis"],
  linux: ["appimage", "deb"],
};
const releaseOutputs = {
  macos: ["app", "dmg"],
  windows: bundleTargets.windows,
  linux: bundleTargets.linux,
};

if (!Object.hasOwn(bundleTargets, platform)) {
  throw new Error(`Unsupported release platform: ${platform}`);
}

const env = {
  ...process.env,
  TALKEE_STT_RELEASE: process.env.TALKEE_STT_RELEASE || "1",
  TALKEE_SKIP_BEFORE_BUILD: "1",
};

if (platform === "windows" && !(env.RUSTFLAGS || "").includes("+crt-static")) {
  env.RUSTFLAGS = [env.RUSTFLAGS, "-C target-feature=+crt-static"]
    .filter(Boolean)
    .join(" ");
}

if (platform === "windows") {
  env.TRANSCRIBE_CMAKE_ARGS = appendUniqueArgument(
    env.TRANSCRIBE_CMAKE_ARGS,
    staticMsvcRuntimeArg,
  );
}

if (platform === "macos") {
  env.MACOSX_DEPLOYMENT_TARGET = process.env.MACOSX_DEPLOYMENT_TARGET || "11.0";
}

function run(command, args) {
  execFileSync(command, args, {
    cwd: rootDir,
    env,
    stdio: "inherit",
  });
}

run("bun", ["run", "prepare:sidecars"]);
run("bun", ["run", "build"]);
run("bun", [
  "run",
  "tauri",
  "build",
  "--bundles",
  bundleTargets[platform].join(","),
]);

if (platform === "windows") {
  run("bun", ["run", "verify:windows-release"]);
}

if (
  platform === "macos" &&
  process.env.TALKEE_POSTPROCESS_MACOS_RELEASE !== "0"
) {
  run("bun", ["run", "postprocess:macos-release"]);
}

console.log(
  `Built ${platform} release bundles: ${releaseOutputs[platform].join(", ")}`,
);
