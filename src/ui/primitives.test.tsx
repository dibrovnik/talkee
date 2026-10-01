import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SegmentedControl } from "./SegmentedControl";
import { SelectMenu } from "./SelectMenu";
import { Toggle } from "./Toggle";

test("controlled primitives preserve names, values and disabled semantics", () => {
  const toggle = renderToStaticMarkup(
    <Toggle checked disabled ariaLabel="Запись" onChange={() => {}} />,
  );
  expect(toggle).toContain('role="switch"');
  expect(toggle).toContain('aria-checked="true"');
  expect(toggle).toContain('aria-label="Запись"');
  expect(toggle).toContain('disabled=""');
  const segments = renderToStaticMarkup(
    <SegmentedControl
      value="local"
      options={[
        { value: "api", label: "API" },
        { value: "local", label: "Локально" },
      ]}
      onChange={() => {}}
      ariaLabel="Режим"
    />,
  );
  expect(segments).toContain('role="radiogroup"');
  expect(segments).toContain('role="radio"');
  expect(segments).toContain('aria-checked="true"');
  const select = renderToStaticMarkup(
    <SelectMenu
      value=""
      options={[{ value: "", label: "Автоматически" }]}
      onChange={() => {}}
      ariaLabel="Модель"
      disabled
    />,
  );
  expect(select).toContain('role="combobox"');
  expect(select).toContain('aria-label="Модель"');
  expect(select).toContain("Автоматически");
  expect(select).toContain('disabled=""');
});
