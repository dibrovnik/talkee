import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { scanForLegacyName } from "./check-naming.mjs";

const created = [];

function makeTree() {
  const root = mkdtempSync(join(tmpdir(), "talkee-check-naming-"));
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

describe("check-naming", () => {
  test("finds the legacy name and reports file and line", () => {
    const root = makeTree();
    write(root, "src/app.ts", "const a = 1;\nconst name = \"Talkis\";\n");

    const matches = scanForLegacyName(root, new Set());

    expect(matches).toHaveLength(1);
    expect(matches[0].file).toBe("src/app.ts");
    expect(matches[0].line).toBe(2);
  });

  test("matches case-insensitively", () => {
    const root = makeTree();
    write(root, "a.ts", "TALKIS\n");

    expect(scanForLegacyName(root, new Set())).toHaveLength(1);
  });

  test("skips allowlisted files", () => {
    const root = makeTree();
    write(root, "allowed.md", "Talkis\n");

    expect(scanForLegacyName(root, new Set(["allowed.md"]))).toHaveLength(0);
  });

  test("skips ignored directories", () => {
    const root = makeTree();
    write(root, "node_modules/pkg/index.js", "Talkis\n");
    write(root, "target/debug/x", "Talkis\n");

    expect(scanForLegacyName(root, new Set())).toHaveLength(0);
  });

  test("skips binary files", () => {
    const root = makeTree();
    writeFileSync(join(root, "blob.bin"), Buffer.from([0, 1, 2, 0, 84, 97]));

    expect(scanForLegacyName(root, new Set())).toHaveLength(0);
  });

  test("returns nothing for a clean tree", () => {
    const root = makeTree();
    write(root, "src/app.ts", "const name = \"Talkee\";\n");

    expect(scanForLegacyName(root, new Set())).toHaveLength(0);
  });

  test("the repository is clean outside the allowlist", () => {
    expect(scanForLegacyName()).toHaveLength(0);
  });
});
