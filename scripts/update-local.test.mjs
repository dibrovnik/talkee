import { expect, test } from "bun:test";
import { installedAppPids } from "./update-local.mjs";

test("local updates only stop processes whose executable belongs to the installed bundle", () => {
  expect(
    installedAppPids(`
    10 /Applications/Talkee.app/Contents/MacOS/talkee --autostart
    11 /Applications/Talkee.app/Contents/MacOS/talkee-stt --port 8000
    12 /tmp/bundle/Talkee.app/Contents/MacOS/talkee
    13 /bin/zsh -c open /Applications/Talkee.app/Contents/MacOS/talkee
    14 /Applications/Talkee.app/Contents/MacOS/talkee-helper
    15 /Applications/Other.app/Contents/MacOS/talkee
    16 /Applications/Talkee.app/Contents/MacOS/talkee-llm
  `),
  ).toEqual([10, 11, 16]);
  expect(installedAppPids("")).toEqual([]);
});
