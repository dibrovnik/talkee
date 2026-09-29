import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  classifyHost,
  extractHosts,
  parseAllowlist,
  run,
} from "./check-network-hosts.mjs";

const tempDirs = [];

function makeFixture(files) {
  const root = mkdtempSync(join(tmpdir(), "talkee-net-hosts-"));
  tempDirs.push(root);

  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }

  return root;
}

function writeAllowlist(raw) {
  const path = join(makeFixture({}), "allowlist.json");
  writeFileSync(path, JSON.stringify(raw));
  return path;
}

function capture() {
  let text = "";
  return {
    stream: { write: (chunk) => (text += chunk) },
    text: () => text,
  };
}

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("classifyHost", () => {
  const allowlist = parseAllowlist({
    hosts: [{ host: "api.openai.com", reason: "test" }],
    hostSuffixes: [{ suffix: "corp.example", reason: "test" }],
    pendingRemoval: [{ host: "talkis.ru", reason: "test" }],
  });

  test("classifies allowlisted host as allowed", () => {
    expect(classifyHost("api.openai.com", allowlist)).toBe("allowed");
  });

  test("classifies localhost and loopback as always allowed", () => {
    expect(classifyHost("localhost", allowlist)).toBe("allowed");
    expect(classifyHost("127.0.0.1", allowlist)).toBe("allowed");
    expect(classifyHost("0.0.0.0", allowlist)).toBe("allowed");
  });

  test("classifies host suffix as allowed", () => {
    expect(classifyHost("sub.corp.example", allowlist)).toBe("allowed");
  });

  test("classifies pending removal host", () => {
    expect(classifyHost("talkis.ru", allowlist)).toBe("pending");
  });

  test("classifies unknown host as blocked", () => {
    expect(classifyHost("evil.example.com", allowlist)).toBe("blocked");
  });
});

describe("extractHosts", () => {
  test("extracts host with line numbers", () => {
    const hosts = extractHosts(
      ['const a = "https://api.openai.com/v1";', 'const b = "http://localhost:8000";'].join(
        "\n",
      ),
    );

    expect(hosts).toEqual([
      { line: 1, host: "api.openai.com", url: "https://api.openai.com/v1" },
      { line: 2, host: "localhost", url: "http://localhost:8000" },
    ]);
  });

  test("ignores dynamic placeholder hosts", () => {
    expect(extractHosts('let url = format!("http://{}", port);')).toEqual([]);
  });
});

describe("run", () => {
  test("passes with an allowlisted host", () => {
    const root = makeFixture({
      "src/a.ts": 'const endpoint = "https://api.openai.com/v1";\n',
    });
    const allowlistPath = writeAllowlist({
      hosts: [{ host: "api.openai.com", reason: "test" }],
    });
    const stdout = capture();
    const stderr = capture();

    const code = run({ rootDir: root, allowlistPath, stdout: stdout.stream, stderr: stderr.stream });

    expect(code).toBe(0);
    expect(stderr.text()).toBe("");
  });

  test("passes with a loopback host that is not in the allowlist", () => {
    const root = makeFixture({
      "src/a.ts": 'const endpoint = "http://localhost:8000/v1";\n',
    });
    const allowlistPath = writeAllowlist({ hosts: [] });
    const stdout = capture();
    const stderr = capture();

    const code = run({ rootDir: root, allowlistPath, stdout: stdout.stream, stderr: stderr.stream });

    expect(code).toBe(0);
  });

  test("fails and prints file:line host for a blocked host", () => {
    const root = makeFixture({
      "src/nested/b.ts": '\nconst analytics = "https://evil.example.com/collect";\n',
    });
    const allowlistPath = writeAllowlist({ hosts: [] });
    const stdout = capture();
    const stderr = capture();

    const code = run({ rootDir: root, allowlistPath, stdout: stdout.stream, stderr: stderr.stream });

    expect(code).toBe(1);
    expect(stderr.text()).toContain("src/nested/b.ts:2 evil.example.com");
  });

  test("warns about pending removal hosts without failing", () => {
    const root = makeFixture({
      "src/c.ts": 'const cloud = "https://talkis.ru/api";\n',
    });
    const allowlistPath = writeAllowlist({
      hosts: [],
      pendingRemoval: [{ host: "talkis.ru", reason: "remove-talkis-cloud" }],
    });
    const stdout = capture();
    const stderr = capture();

    const code = run({ rootDir: root, allowlistPath, stdout: stdout.stream, stderr: stderr.stream });

    expect(code).toBe(0);
    expect(stderr.text()).toContain("src/c.ts:1 talkis.ru is pending removal");
  });

  test("skips test files", () => {
    const root = makeFixture({
      "src/a.test.ts": 'const endpoint = "https://evil.example.com/v1";\n',
    });
    const allowlistPath = writeAllowlist({ hosts: [] });
    const stdout = capture();
    const stderr = capture();

    const code = run({ rootDir: root, allowlistPath, stdout: stdout.stream, stderr: stderr.stream });

    expect(code).toBe(0);
  });
});
