import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const binariesDir = join(rootDir, "src-tauri", "binaries");
const buildDir = join(rootDir, "src-tauri", "target", "ffmpeg-build");
const buildEnv = {
  ...process.env,
  MACOSX_DEPLOYMENT_TARGET: process.env.MACOSX_DEPLOYMENT_TARGET || "14.0",
};

// Pinned sources. Update SHA256 together with the version.
const FFMPEG = {
  version: "7.1.5",
  url: "https://ffmpeg.org/releases/ffmpeg-7.1.5.tar.xz",
  sha256: "de668509caf9e35e3cd162473441fdb29538c6d96ed080292b3cf9e6fc5d558f",
};
// libmp3lame is required: the app encodes MP3 chunks for API file transcription.
const LAME = {
  version: "3.100",
  url: "https://downloads.sourceforge.net/project/lame/lame/3.100/lame-3.100.tar.gz",
  sha256: "ddfe36cab873794038ae2c1210557ad34857a4b6bdc515785d1da9e175b1da1e",
};

function readTargetTriple() {
  if (process.env.TAURI_FFMPEG_TARGET_TRIPLE) {
    return process.env.TAURI_FFMPEG_TARGET_TRIPLE.trim();
  }

  try {
    return execFileSync("rustc", ["--print", "host-tuple"], {
      encoding: "utf8",
      env: process.env,
    }).trim();
  } catch {
    const versionOutput = execFileSync("rustc", ["-Vv"], {
      encoding: "utf8",
      env: process.env,
    });
    const hostLine = versionOutput.split("\n").find((line) => line.startsWith("host:"));

    if (!hostLine) {
      throw new Error("Failed to determine Rust target triple");
    }

    return hostLine.replace("host:", "").trim();
  }
}

function fileHash(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: "inherit", ...options });
}

function download(url, destination, sha256) {
  if (existsSync(destination) && fileHash(destination) === sha256) {
    return;
  }

  rmSync(destination, { force: true });
  run("curl", ["-fSL", "--retry", "3", "--retry-delay", "2", "-o", destination, url]);

  const actual = fileHash(destination);
  if (actual !== sha256) {
    rmSync(destination, { force: true });
    throw new Error(`Checksum mismatch for ${url}: expected ${sha256}, got ${actual}`);
  }
}

function extract(archive, destination) {
  mkdirSync(destination, { recursive: true });
  run("tar", ["-xf", archive, "-C", destination]);
}

function buildLame() {
  const prefix = join(buildDir, `lame-${LAME.version}-install`);
  const staticLib = join(prefix, "lib", "libmp3lame.a");
  if (existsSync(staticLib)) {
    return prefix;
  }

  const sourceDir = join(buildDir, `lame-${LAME.version}`);
  rmSync(prefix, { recursive: true, force: true });

  run(
    "./configure",
    [
      `--prefix=${prefix}`,
      "--disable-shared",
      "--enable-static",
      "--disable-frontend",
      "--disable-gtktest",
      "--disable-analyzer-hooks",
    ],
    { cwd: sourceDir, env: buildEnv },
  );
  run("make", ["-j"], { cwd: sourceDir, env: buildEnv });
  run("make", ["install"], { cwd: sourceDir, env: buildEnv });

  return prefix;
}

function ffmpegConfigureArgs(lamePrefix) {
  return [
    "--disable-everything",
    "--disable-autodetect",
    "--disable-network",
    "--disable-doc",
    "--disable-programs",
    "--disable-ffplay",
    "--disable-ffprobe",
    "--enable-ffmpeg",
    "--enable-small",
    "--disable-gpl",
    "--disable-nonfree",
    "--cc=clang",
    `--extra-cflags=-mmacosx-version-min=14.0 -I${join(lamePrefix, "include")}`,
    `--extra-ldflags=-mmacosx-version-min=14.0 -L${join(lamePrefix, "lib")}`,
    "--enable-protocol=file,pipe",
    // Demuxers cover every extension the file picker accepts.
    "--enable-demuxer=aac,aiff,avi,caf,flac,matroska,mov,mp3,mpegps,mpegts,ogg,wav",
    // Audio-only decoders; `-vn` drops video streams without decoding them.
    "--enable-decoder=aac,aac_latm,ac3,alac,eac3,flac,mp1,mp2,mp3,mp3float,opus,vorbis,pcm_s8,pcm_u8,pcm_s16le,pcm_s16be,pcm_s24le,pcm_s24be,pcm_s32le,pcm_s32be,pcm_f32le,pcm_f32be,pcm_f64le,pcm_mulaw,pcm_alaw,amrnb,amrwb",
    "--enable-parser=aac,aac_latm,ac3,dca,flac,mpegaudio,opus,vorbis",
    // pcm_s16le produces the local STT WAV; libmp3lame produces upload chunks.
    "--enable-encoder=pcm_s16le,libmp3lame",
    "--enable-libmp3lame",
    "--enable-muxer=mp3,segment,wav",
    "--enable-filter=aresample,aformat,anull,atrim,pan,volume,null,asetpts",
  ];
}

function buildFfmpeg(lamePrefix) {
  const sourceDir = join(buildDir, `ffmpeg-${FFMPEG.version}`);
  const buildTree = join(buildDir, `ffmpeg-${FFMPEG.version}-build`);
  const binary = join(buildTree, "ffmpeg");

  if (existsSync(binary)) {
    return binary;
  }

  rmSync(buildTree, { recursive: true, force: true });
  mkdirSync(buildTree, { recursive: true });

  run(join(sourceDir, "configure"), ffmpegConfigureArgs(lamePrefix), {
    cwd: buildTree,
    env: buildEnv,
  });
  run("make", ["-j"], { cwd: buildTree, env: buildEnv });

  return binary;
}

function copyFileIfChanged(source, destination) {
  if (existsSync(destination)) {
    const sourceStat = statSync(source);
    const destinationStat = statSync(destination);

    if (sourceStat.size === destinationStat.size && fileHash(source) === fileHash(destination)) {
      return false;
    }
  }

  copyFileSync(source, destination);
  return true;
}

const targetTriple = readTargetTriple();
const destinationBinary = join(binariesDir, `talkee-ffmpeg-${targetTriple}`);

mkdirSync(binariesDir, { recursive: true });
mkdirSync(buildDir, { recursive: true });

let sourceBinary;

if (process.env.TALKEE_FFMPEG_BINARY?.trim()) {
  sourceBinary = process.env.TALKEE_FFMPEG_BINARY.trim();
} else {
  download(FFMPEG.url, join(buildDir, `ffmpeg-${FFMPEG.version}.tar.xz`), FFMPEG.sha256);
  download(LAME.url, join(buildDir, `lame-${LAME.version}.tar.gz`), LAME.sha256);

  if (!existsSync(join(buildDir, `ffmpeg-${FFMPEG.version}`))) {
    extract(join(buildDir, `ffmpeg-${FFMPEG.version}.tar.xz`), buildDir);
  }
  if (!existsSync(join(buildDir, `lame-${LAME.version}`))) {
    extract(join(buildDir, `lame-${LAME.version}.tar.gz`), buildDir);
  }

  const lamePrefix = buildLame();
  sourceBinary = buildFfmpeg(lamePrefix);
  run("strip", ["-x", sourceBinary]);
}

if (!sourceBinary || !existsSync(sourceBinary)) {
  throw new Error(`ffmpeg binary was not found: ${sourceBinary || "(empty)"}`);
}

if (!statSync(sourceBinary).isFile()) {
  throw new Error(`ffmpeg path is not a file: ${sourceBinary}`);
}

copyFileIfChanged(sourceBinary, destinationBinary);
chmodSync(destinationBinary, 0o755);

console.log(`Prepared ffmpeg sidecar: ${destinationBinary}`);
