import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const fixturesDir = join(rootDir, "src-tauri", "tests", "fixtures", "media");

const FIXTURES = [
  "tone.wav",
  "tone.m4a",
  "tone.mp3",
  "tone.ogg",
  "tone.webm",
  "tone.flac",
  "tone.mp4",
];

function readTargetTriple() {
  if (process.env.TAURI_FFMPEG_TARGET_TRIPLE) {
    return process.env.TAURI_FFMPEG_TARGET_TRIPLE.trim();
  }

  return execFileSync("rustc", ["--print", "host-tuple"], { encoding: "utf8" }).trim();
}

function resolveFfmpeg() {
  if (process.env.TALKEE_FFMPEG_BINARY?.trim()) {
    return process.env.TALKEE_FFMPEG_BINARY.trim();
  }

  const bundled = join(rootDir, "src-tauri", "binaries", `talkee-ffmpeg-${readTargetTriple()}`);

  if (existsSync(bundled)) {
    return bundled;
  }

  throw new Error(
    `Bundled ffmpeg sidecar not found at ${bundled}. Run bun run prepare:ffmpeg-sidecar.`,
  );
}

function convertToWav(ffmpeg, input, output) {
  execFileSync(
    ffmpeg,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      input,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-acodec",
      "pcm_s16le",
      output,
    ],
    { stdio: "inherit" },
  );
}

function encodeMp3(ffmpeg, input, output) {
  execFileSync(
    ffmpeg,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      input,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-b:a",
      "32k",
      output,
    ],
    { stdio: "inherit" },
  );
}

function segmentToWav(ffmpeg, input, outputPattern) {
  execFileSync(
    ffmpeg,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      input,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-acodec",
      "pcm_s16le",
      "-f",
      "segment",
      "-segment_time",
      "1",
      "-reset_timestamps",
      "1",
      outputPattern,
    ],
    { stdio: "inherit" },
  );
}

function assertLocalSttWav(path) {
  const bytes = readFileSync(path);
  if (bytes.length < 44) {
    throw new Error(`${path}: output is too small to be a WAV file`);
  }
  if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`${path}: output is not a RIFF/WAVE file`);
  }

  const channels = bytes.readUInt16LE(22);
  const sampleRate = bytes.readUInt32LE(24);
  const bitsPerSample = bytes.readUInt16LE(34);

  if (channels !== 1 || sampleRate !== 16000 || bitsPerSample !== 16) {
    throw new Error(
      `${path}: expected 16 kHz mono PCM16, got channels=${channels}, sampleRate=${sampleRate}, bits=${bitsPerSample}`,
    );
  }
}

const ffmpeg = resolveFfmpeg();
console.log(`Smoke-testing bundled ffmpeg: ${ffmpeg}`);

const workDir = mkdtempSync(join(tmpdir(), "talkee-smoke-ffmpeg-"));
let failures = 0;

try {
  for (const fixture of FIXTURES) {
    const input = join(fixturesDir, fixture);
    if (!existsSync(input)) {
      throw new Error(`Missing fixture: ${input}`);
    }

    const wavOut = join(workDir, `${fixture}.wav`);
    const mp3Out = join(workDir, `${fixture}.mp3`);

    try {
      convertToWav(ffmpeg, input, wavOut);
      assertLocalSttWav(wavOut);
      encodeMp3(ffmpeg, input, mp3Out);
      if (statSync(mp3Out).size === 0) {
        throw new Error("mp3 output is empty");
      }
      console.log(`✓ ${fixture}: wav + mp3`);
    } catch (error) {
      failures += 1;
      console.error(`✗ ${fixture}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  try {
    const chunkPattern = join(workDir, "chunk-%05d.wav");
    segmentToWav(ffmpeg, join(fixturesDir, "tone.wav"), chunkPattern);
    assertLocalSttWav(join(workDir, "chunk-00000.wav"));
    console.log("✓ segment muxer: chunk-00000.wav");
  } catch (error) {
    failures += 1;
    console.error(`✗ segment muxer: ${error instanceof Error ? error.message : String(error)}`);
  }
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`Smoke test failed: ${failures} case(s)`);
  process.exit(1);
}

console.log("Smoke test passed");
