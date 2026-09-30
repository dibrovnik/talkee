import { describe, expect, test } from "bun:test";

import { parseArgs, runGate } from "./gate.mjs";

function sink() {
  return { write: () => {} };
}

function capture() {
  let output = "";
  return {
    stream: { write: (chunk) => (output += chunk) },
    text: () => output,
  };
}

// Commands are substituted with `true`/`false` so the runner is exercised
// without touching the real toolchain.
function sampleGroups() {
  return [
    {
      name: "static",
      commands: [
        { name: "one", cmd: ["true"] },
        { name: "two", cmd: ["true"] },
      ],
    },
    {
      name: "format",
      commands: [{ name: "three", cmd: ["false"] }],
    },
    {
      name: "tests",
      commands: [{ name: "four", cmd: ["true"] }],
    },
  ];
}

function recordingExec(calls) {
  return async (cmd) => {
    calls.push(cmd[0]);
    return cmd[0] === "false" ? 1 : 0;
  };
}

describe("gate runner", () => {
  test("runs commands in group order and stops at the first failure", async () => {
    const calls = [];
    const { code, results } = await runGate({
      groups: sampleGroups(),
      exec: recordingExec(calls),
      stdout: sink(),
      stderr: sink(),
    });

    expect(code).toBe(1);
    expect(calls).toEqual(["true", "true", "false"]);
    expect(results.map((result) => [result.name, result.status])).toEqual([
      ["one", "pass"],
      ["two", "pass"],
      ["three", "fail"],
      ["four", "skipped"],
    ]);
  });

  test("--keep-going runs every command even after a failure", async () => {
    const calls = [];
    const { code, results } = await runGate({
      groups: sampleGroups(),
      keepGoing: true,
      exec: recordingExec(calls),
      stdout: sink(),
      stderr: sink(),
    });

    expect(code).toBe(1);
    expect(calls).toEqual(["true", "true", "false", "true"]);
    expect(results.map((result) => result.status)).toEqual(["pass", "pass", "fail", "pass"]);
  });

  test("returns 0 when every command passes", async () => {
    const groups = [
      { name: "static", commands: [{ name: "one", cmd: ["true"] }] },
      { name: "tests", commands: [{ name: "two", cmd: ["true"] }] },
    ];
    const calls = [];
    const { code } = await runGate({
      groups,
      exec: recordingExec(calls),
      stdout: sink(),
      stderr: sink(),
    });

    expect(code).toBe(0);
    expect(calls).toEqual(["true", "true"]);
  });

  test("--only restricts the run to a single group", async () => {
    const calls = [];
    const { code } = await runGate({
      groups: sampleGroups(),
      only: "tests",
      exec: recordingExec(calls),
      stdout: sink(),
      stderr: sink(),
    });

    expect(code).toBe(0);
    expect(calls).toEqual(["true"]);
  });

  test("rejects an unknown group", async () => {
    const stderr = capture();
    const { code } = await runGate({
      groups: sampleGroups(),
      only: "nope",
      exec: recordingExec([]),
      stdout: sink(),
      stderr: stderr.stream,
    });

    expect(code).toBe(1);
    expect(stderr.text()).toContain("unknown group");
  });

  test("prints a summary line per command", async () => {
    const stdout = capture();
    await runGate({
      groups: sampleGroups(),
      exec: recordingExec([]),
      stdout: stdout.stream,
      stderr: sink(),
    });

    const output = stdout.text();
    expect(output).toContain("✓ one");
    expect(output).toContain("✗ three");
    expect(output).toContain("· four");
  });
});

describe("gate args", () => {
  test("defaults to a full run", () => {
    expect(parseArgs([])).toEqual({ keepGoing: false, only: null, help: false });
  });

  test("parses --keep-going and --only", () => {
    expect(parseArgs(["--keep-going", "--only", "tests"])).toEqual({
      keepGoing: true,
      only: "tests",
      help: false,
    });
  });

  test("rejects --only without a value", () => {
    expect(() => parseArgs(["--only"])).toThrow();
  });

  test("rejects unknown arguments", () => {
    expect(() => parseArgs(["--nope"])).toThrow();
  });
});
