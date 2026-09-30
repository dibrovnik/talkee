import { execFileSync } from "node:child_process";

if (process.env.TALKEE_SKIP_BEFORE_BUILD === "1") {
  console.log("Skipping Tauri beforeBuildCommand because TALKEE_SKIP_BEFORE_BUILD=1");
  process.exit(0);
}

execFileSync("bun", ["run", "prepare:sidecars"], { stdio: "inherit" });
execFileSync("bun", ["run", "build"], { stdio: "inherit" });
