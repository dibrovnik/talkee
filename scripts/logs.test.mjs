import { expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scripts = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).scripts;

test("CLI clear deletes only the four log files in isolated HOME", async () => {
  const home = mkdtempSync(join(tmpdir(), "talkee-log-clear-"));
  const dir = join(home, ".talkee");
  mkdirSync(dir);
  try {
    for (const suffix of ["", ".1", ".2", ".3", ".neighbor"])
      writeFileSync(join(dir, `talkee.log${suffix}`), "keep");
    const child = Bun.spawn(["sh", "-c", scripts["logs:clear"]], {
      env: { ...process.env, HOME: home },
    });
    expect(await child.exited).toBe(0);
    for (const suffix of ["", ".1", ".2", ".3"])
      expect(existsSync(join(dir, `talkee.log${suffix}`))).toBe(false);
    expect(existsSync(join(dir, "talkee.log.neighbor"))).toBe(true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("CLI tail follows the new active file after rotation", async () => {
  const home = mkdtempSync(join(tmpdir(), "talkee-log-follow-"));
  const dir = join(home, ".talkee");
  mkdirSync(dir);
  const path = join(dir, "talkee.log");
  writeFileSync(path, "before-rotation\n");
  const child = Bun.spawn(["sh", "-c", `exec ${scripts.logs}`], {
    env: { ...process.env, HOME: home },
    stdout: "pipe",
    stderr: "ignore",
  });
  const reader = child.stdout.getReader();
  let output = "";
  const readUntil = async (needle) => {
    while (!output.includes(needle)) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error("tail exited before new record");
      output += new TextDecoder().decode(chunk.value);
    }
  };
  let timer;
  try {
    await readUntil("before-rotation");
    renameSync(path, `${path}.1`);
    writeFileSync(path, "after-rotation\n");
    await Promise.race([
      readUntil("after-rotation"),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("tail did not follow replacement")), 6000);
      }),
    ]);
    expect(output).toContain("after-rotation");
  } finally {
    clearTimeout(timer);
    child.kill();
    await child.exited;
    await reader.cancel();
    rmSync(home, { recursive: true, force: true });
  }
}, 10000);
