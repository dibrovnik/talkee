import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { extractBackticked, findMissingPaths, looksLikePath } from "./check-agents-docs.mjs";

const created = [];

function makeTree() {
  const root = mkdtempSync(join(tmpdir(), "talkee-check-agents-docs-"));
  created.push(root);
  return root;
}

function write(root, relPath, contents) {
  const absolute = join(root, relPath);
  mkdirSync(join(absolute, ".."), { recursive: true });
  writeFileSync(absolute, contents);
}

afterEach(() => {
  while (created.length > 0) {
    rmSync(created.pop(), { recursive: true, force: true });
  }
});

describe("extractBackticked", () => {
  test("returns unique backticked tokens", () => {
    const tokens = extractBackticked("see `a.md` and `a.md` plus `b/c.ts`");
    expect(tokens.sort()).toEqual(["a.md", "b/c.ts"]);
  });

  test("ignores fenced code blocks", () => {
    const content = "before `real.md`\n```bash\nnot/a/path --flag\n```\nafter\n";
    expect(extractBackticked(content)).toEqual(["real.md"]);
  });
});

describe("looksLikePath", () => {
  test("accepts paths with a slash", () => {
    expect(looksLikePath("docs/architecture/overview.md")).toBe(true);
    expect(looksLikePath("src-tauri/src")).toBe(true);
  });

  test("accepts known file extensions", () => {
    expect(looksLikePath("package.json")).toBe(true);
    expect(looksLikePath("Cargo.toml")).toBe(true);
  });

  test("rejects slash commands and templates", () => {
    expect(looksLikePath("/opsx:propose")).toBe(false);
    expect(looksLikePath("src-tauri/binaries/*")).toBe(false);
    expect(looksLikePath("~/.talkee/talkee.log")).toBe(false);
    expect(looksLikePath("Result<T, String>")).toBe(false);
  });

  test("rejects commands and identifiers", () => {
    expect(looksLikePath("bun run tauri dev")).toBe(false);
    expect(looksLikePath("import.meta.env.DEV")).toBe(false);
    expect(looksLikePath("getSettings()")).toBe(false);
  });
});

describe("findMissingPaths", () => {
  test("reports paths that do not exist", () => {
    const root = makeTree();
    write(root, "AGENTS.md", "Read `docs/start.md` and `docs/missing.md`.\n");
    write(root, "docs/start.md", "# Start\n");

    expect(findMissingPaths({ rootDir: root })).toEqual(["docs/missing.md"]);
  });

  test("returns nothing when every path exists", () => {
    const root = makeTree();
    write(root, "AGENTS.md", "Read `docs/start.md`.\n");
    write(root, "docs/start.md", "# Start\n");

    expect(findMissingPaths({ rootDir: root })).toEqual([]);
  });

  test("the repository AGENTS.md references existing paths", () => {
    expect(findMissingPaths()).toEqual([]);
  });
});
