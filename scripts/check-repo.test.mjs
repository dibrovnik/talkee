import { describe, expect, test } from "bun:test";

import {
  findForbiddenPaths,
  findLargeFiles,
  isForbiddenPath,
  listTrackedFiles,
} from "./check-repo.mjs";

describe("isForbiddenPath", () => {
  test("rejects system junk and build output", () => {
    expect(isForbiddenPath(".DS_Store")).toBe(true);
    expect(isForbiddenPath("src/.DS_Store")).toBe(true);
    expect(isForbiddenPath("src-tauri/target/debug/app")).toBe(true);
    expect(isForbiddenPath("dist/index.html")).toBe(true);
  });

  test("rejects sidecar binaries but keeps the placeholder", () => {
    expect(isForbiddenPath("src-tauri/binaries/talkee-stt-aarch64-apple-darwin")).toBe(true);
    expect(isForbiddenPath("src-tauri/binaries/.gitkeep")).toBe(false);
  });

  test("accepts ordinary source files", () => {
    expect(isForbiddenPath("src/lib/store.ts")).toBe(false);
    expect(isForbiddenPath("AGENTS.md")).toBe(false);
    expect(isForbiddenPath("docs/testing/manual-style-test-plan.md")).toBe(false);
  });
});

describe("findForbiddenPaths", () => {
  test("returns only the forbidden entries", () => {
    const files = ["a.ts", ".DS_Store", "src-tauri/binaries/.gitkeep", "dist/x.js"];
    expect(findForbiddenPaths(files)).toEqual([".DS_Store", "dist/x.js"]);
  });
});

describe("findLargeFiles", () => {
  test("flags files above the threshold", () => {
    const sizes = { "big.bin": 6 * 1024 * 1024, "small.bin": 1024 };
    const stat = (path) => {
      const name = path.split("/").pop();
      if (!(name in sizes)) throw new Error("missing");
      return { size: sizes[name] };
    };

    expect(findLargeFiles("/root", ["big.bin", "small.bin", "gone.bin"], { stat })).toEqual([
      { file: "big.bin", size: 6 * 1024 * 1024 },
    ]);
  });
});

describe("check-repo on the repository", () => {
  test("the repository has no forbidden or oversized tracked files", () => {
    const files = listTrackedFiles();
    expect(findForbiddenPaths(files)).toEqual([]);
    expect(findLargeFiles(process.cwd(), files)).toEqual([]);
  });
});
