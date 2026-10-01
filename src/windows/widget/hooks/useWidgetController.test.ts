import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("window-dependent effects keep the same Tauri Window across renders", () => {
  const source = readFileSync(new URL("./useWidgetController.ts", import.meta.url), "utf8");

  // A render-time call re-applies island mode, whose anchor event triggers another render.
  expect(source).toContain("const [widgetWindow] = useState(getCurrentWindow)");
  expect(source).not.toContain("getCurrentWindow()");
});
