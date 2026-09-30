import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const appPath = join(rootDir, "src-tauri", "target", "release", "bundle", "macos", "Talkee.app");

// Budgets from the `performance` spec.
const APP_BUDGET_BYTES = 40 * 1024 * 1024;
const FFMPEG_BUDGET_BYTES = 8 * 1024 * 1024;

function directorySize(path) {
  let total = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const absolute = join(path, entry.name);
    if (entry.isDirectory()) {
      total += directorySize(absolute);
    } else if (entry.isFile()) {
      total += statSync(absolute).size;
    }
  }
  return total;
}

function formatMb(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

if (!existsSync(appPath)) {
  console.error(`App bundle not found at ${appPath}. Run bun run build:release:macos first.`);
  process.exit(1);
}

const appSize = directorySize(appPath);
console.log(`Bundle sizes (${appPath}):`);
console.log(`  Talkee.app: ${formatMb(appSize)} (budget ${formatMb(APP_BUDGET_BYTES)})`);

const failures = [];
if (appSize > APP_BUDGET_BYTES) {
  failures.push(
    `Talkee.app is ${formatMb(appSize)}, over the ${formatMb(APP_BUDGET_BYTES)} budget`,
  );
}

const macosDir = join(appPath, "Contents", "MacOS");
for (const sidecar of ["talkee", "talkee-stt", "talkee-diarize", "talkee-llm", "talkee-ffmpeg"]) {
  const path = join(macosDir, sidecar);
  if (!existsSync(path)) {
    continue;
  }

  const size = statSync(path).size;
  console.log(`  ${sidecar}: ${formatMb(size)}`);

  if (sidecar === "talkee-ffmpeg" && size > FFMPEG_BUDGET_BYTES) {
    failures.push(
      `talkee-ffmpeg is ${formatMb(size)}, over the ${formatMb(FFMPEG_BUDGET_BYTES)} budget`,
    );
  }
}

if (failures.length > 0) {
  console.error("Bundle size budget exceeded:");
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}

console.log("Bundle size budgets OK");
