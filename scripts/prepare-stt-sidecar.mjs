import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const tauriDir = join(rootDir, "src-tauri");
const llmManifest = join(tauriDir, "sidecars", "talkee-llm", "Cargo.toml");
const binariesDir = join(tauriDir, "binaries");
const toolchainEnv = process.env;
const placeholderContents = "#!/usr/bin/env sh\nexit 1\n";

function readTargetTriple() {
  if (toolchainEnv.TAURI_STT_TARGET_TRIPLE) {
    return toolchainEnv.TAURI_STT_TARGET_TRIPLE.trim();
  }

  try {
    return execFileSync("rustc", ["--print", "host-tuple"], {
      encoding: "utf8",
      env: toolchainEnv,
    }).trim();
  } catch {
    const versionOutput = execFileSync("rustc", ["-Vv"], {
      encoding: "utf8",
      env: toolchainEnv,
    });
    const hostLine = versionOutput
      .split("\n")
      .find((line) => line.startsWith("host:"));

    if (!hostLine) {
      throw new Error("Failed to determine Rust target triple");
    }

    return hostLine.replace("host:", "").trim();
  }
}

function markExecutable(path) {
  chmodSync(path, 0o755);
}

function fileHash(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function copyFileIfChanged(source, destination) {
  if (existsSync(destination)) {
    const sourceStat = statSync(source);
    const destinationStat = statSync(destination);

    if (
      sourceStat.size === destinationStat.size &&
      fileHash(source) === fileHash(destination)
    ) {
      return false;
    }
  }

  copyFileSync(source, destination);
  return true;
}

function removePlaceholder(path) {
  if (!existsSync(path)) return;

  try {
    const contents = readFileSync(path, "utf8");
    if (contents === placeholderContents) {
      unlinkSync(path);
    }
  } catch {
    // A real binary or an already removed placeholder must remain untouched.
  }
}

const targetTriple = readTargetTriple();

const profile = process.env.TALKEE_STT_RELEASE === "1" ? "release" : "debug";
const sidecars = ["talkee-stt", "talkee-diarize", "talkee-llm"];
const baseCargoArgs = [
  "build",
  "--manifest-path",
  join(tauriDir, "Cargo.toml"),
];
const sttCargoArgs = [
  ...baseCargoArgs,
  "--bin",
  "talkee-stt",
  "--bin",
  "talkee-diarize",
];
const llmCargoArgs = [
  "build",
  "--manifest-path",
  llmManifest,
  "--bin",
  "talkee-llm",
];

if (profile === "release") {
  sttCargoArgs.push("--release");
  llmCargoArgs.push("--release");
}

mkdirSync(binariesDir, { recursive: true });

for (const sidecar of sidecars) {
  const destinationBinary = join(
    binariesDir,
    `${sidecar}-${targetTriple}`,
  );
  if (!existsSync(destinationBinary)) {
    writeFileSync(destinationBinary, placeholderContents);
    markExecutable(destinationBinary);
  }
}

try {
  execFileSync("cargo", sttCargoArgs, {
    env: toolchainEnv,
    stdio: "inherit",
  });
  execFileSync("cargo", llmCargoArgs, {
    env: toolchainEnv,
    stdio: "inherit",
  });
} catch (error) {
  for (const sidecar of sidecars) {
    removePlaceholder(join(binariesDir, `${sidecar}-${targetTriple}`));
  }
  throw error;
}

for (const sidecar of sidecars) {
  const sourceBinary = join(tauriDir, "target", profile, sidecar);
  const destinationBinary = join(
    binariesDir,
    `${sidecar}-${targetTriple}`,
  );

  if (!existsSync(sourceBinary)) {
    throw new Error(`${sidecar} binary was not built: ${sourceBinary}`);
  }

  if (!statSync(sourceBinary).isFile()) {
    throw new Error(`${sidecar} path is not a file: ${sourceBinary}`);
  }

  markExecutable(sourceBinary);
  copyFileIfChanged(sourceBinary, destinationBinary);
  markExecutable(destinationBinary);

  console.log(`Prepared ${sidecar} sidecar: ${destinationBinary}`);
}
