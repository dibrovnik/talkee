import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

const env = {
  ...process.env,
  TALKEE_STT_RELEASE: process.env.TALKEE_STT_RELEASE || "1",
  TALKEE_SKIP_BEFORE_BUILD: "1",
  MACOSX_DEPLOYMENT_TARGET: process.env.MACOSX_DEPLOYMENT_TARGET || "11.0",
};

function run(command, args) {
  execFileSync(command, args, {
    cwd: rootDir,
    env,
    stdio: "inherit",
  });
}

run("bun", ["run", "prepare:sidecars"]);
run("bun", ["run", "build"]);
run("bun", ["run", "tauri", "build", "--bundles", "app"]);

if (process.env.TALKEE_POSTPROCESS_MACOS_RELEASE !== "0") {
  run("bun", ["run", "postprocess:macos-release"]);
}

console.log("Built macOS release bundles: app, dmg");
