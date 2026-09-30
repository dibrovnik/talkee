import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { hasVersionSection, run } from "./check-changelog.mjs";

const created = [];

function makeRoot(packageVersion, changelog) {
  const root = mkdtempSync(join(tmpdir(), "talkee-check-changelog-"));
  created.push(root);
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify({ name: "talkee", version: packageVersion }, null, 2)}\n`,
  );
  writeFileSync(join(root, "CHANGELOG.md"), changelog);
  return root;
}

function capture() {
  let out = "";
  let err = "";
  return {
    stdout: { write: (chunk) => (out += chunk) },
    stderr: { write: (chunk) => (err += chunk) },
    get out() {
      return out;
    },
    get err() {
      return err;
    },
  };
}

afterEach(() => {
  while (created.length > 0) {
    rmSync(created.pop(), { recursive: true, force: true });
  }
});

describe("hasVersionSection", () => {
  test("detects a section for the exact version", () => {
    const changelog = "# Changelog\n\n## [Unreleased]\n\n## [0.4.8] - 2026-08-19\n";
    expect(hasVersionSection(changelog, "0.4.8")).toBe(true);
  });

  test("does not match an unrelated version", () => {
    const changelog = "# Changelog\n\n## [Unreleased]\n\n## [0.4.7] - 2026-08-18\n";
    expect(hasVersionSection(changelog, "0.4.8")).toBe(false);
  });

  test("does not match a longer version with the same prefix", () => {
    const changelog = "## [0.4.80] - 2026-08-19\n";
    expect(hasVersionSection(changelog, "0.4.8")).toBe(false);
  });
});

describe("run", () => {
  test("succeeds when the changelog has the section", () => {
    const root = makeRoot("0.4.9", "## [Unreleased]\n\n## [0.4.9] - 2026-09-30\n");
    const io = capture();

    expect(run({ rootDir: root, ...io })).toBe(0);
    expect(io.err).toBe("");
    expect(io.out).toContain("0.4.9");
  });

  test("fails with a hint when the section is missing", () => {
    const root = makeRoot("0.4.9", "## [Unreleased]\n\n## [0.4.8] - 2026-08-19\n");
    const io = capture();

    expect(run({ rootDir: root, ...io })).toBe(1);
    expect(io.err).toContain('"## [0.4.9]"');
    expect(io.err).toContain("Unreleased");
  });
});
