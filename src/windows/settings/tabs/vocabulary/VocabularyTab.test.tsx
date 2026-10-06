import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import fixture from "../../../../../src-tauri/src/vocabulary/fixtures/state-v1.json";
import {
  createDevelopmentStarter,
  createEmptyVocabularyState,
  createVocabularyClient,
  type ImportPreview,
  type VocabularyState,
  type VocabularyView,
} from "../../../../lib/vocabulary";
import { HistoryTextVariantControl } from "../HistoryTextVariantControl";
import { VocabularyEditor } from "./VocabularyEditor";
import { VocabularyImportReview } from "./VocabularyImportReview";
import { VocabularyTab } from "./VocabularyTab";

function recordingClient(): { calls: string[]; client: ReturnType<typeof createVocabularyClient> } {
  const calls: string[] = [];
  const client = createVocabularyClient({
    invoke: async <T,>(command: string): Promise<T> => {
      calls.push(command);
      return { status: "ready", state: createEmptyVocabularyState() } as T;
    },
    listen: async () => () => {},
  });
  return { calls, client };
}

const ready = (state: VocabularyState): VocabularyView => ({ status: "ready", state });

describe("vocabulary tab", () => {
  test("empty state explains the section and rendering writes nothing", () => {
    const { calls, client } = recordingClient();
    const html = renderToStaticMarkup(
      <VocabularyTab client={client} initialView={ready(createEmptyVocabularyState())} />,
    );
    expect(html).toContain("Словарь пока пуст");
    expect(html).toContain("Добавить термин…");
    expect(html).toContain("Проанализировать историю…");
    expect(html).toContain("Начать с примеров…");
    expect(html).toContain("Импортировать…");
    expect(html).toContain("Словарь выключен");
    expect(html).toContain("Только общий словарь");
    expect(html).toContain("Только замены после распознавания");
    expect(calls).toEqual([]);
  });

  test("terms list shows spelling, scope, rule count, pending suggestions and labelled actions", () => {
    const base = fixture as unknown as VocabularyState;
    const html = renderToStaticMarkup(
      <VocabularyTab client={recordingClient().client} initialView={ready(base)} />,
    );
    expect(html).not.toContain("Предложения · ");
    expect(html).toContain("PIM");
    expect(html).toContain("Область: Разработка");
    expect(html).toContain("Prod");
    expect(html).toContain('aria-label="Изменить: PIM"');
    expect(html).toContain('aria-label="Удалить: PIM"');
    const withReady: VocabularyState = {
      ...base,
      suggestions: base.suggestions.map((suggestion) => ({ ...suggestion, status: "ready" })),
    };
    const readyHtml = renderToStaticMarkup(
      <VocabularyTab client={recordingClient().client} initialView={ready(withReady)} />,
    );
    expect(readyHtml).toContain("Предложения · 1");
    expect(readyHtml).toContain("Ожидают проверки: 1");
  });

  test("a corrupt store is reported without editing controls", () => {
    const html = renderToStaticMarkup(
      <VocabularyTab
        client={recordingClient().client}
        initialView={{ status: "corrupt", reason: "unsupported schemaVersion 2" }}
      />,
    );
    expect(html).toContain("Словарь не прочитан");
    expect(html).toContain("unsupported schemaVersion 2");
    expect(html).not.toContain("Добавить термин…");
  });
});

describe("vocabulary editor", () => {
  test("each variant has its own approval switch reflecting stored permission", () => {
    const state = fixture as unknown as VocabularyState;
    const pim = state.terms.find((term) => term.canonical === "PIM");
    if (!pim) throw new Error("fixture lacks PIM");
    const html = renderToStaticMarkup(
      <VocabularyEditor
        term={pim}
        activeDomain={null}
        currentRevision={state.revision}
        removedElsewhere={false}
        save={async () => {}}
        close={() => {}}
      />,
    );
    for (const variant of pim.variants) {
      const label = `Разрешить замену «${variant.source}» → «PIM»`;
      const start = html.indexOf(`aria-label="${label}"`);
      expect(start).toBeGreaterThan(-1);
      const tag = html.slice(html.lastIndexOf("<button", start), html.indexOf(">", start));
      expect(tag).toContain(`aria-checked="${variant.enabled}"`);
    }
  });

  test("a term deleted elsewhere is announced instead of silently overwritten", () => {
    const state = fixture as unknown as VocabularyState;
    const html = renderToStaticMarkup(
      <VocabularyEditor
        term={state.terms[0]}
        activeDomain={null}
        currentRevision={state.revision + 1}
        removedElsewhere
        save={async () => {}}
        close={() => {}}
      />,
    );
    expect(html).toContain("удалён в другом окне");
  });
});

describe("starter review", () => {
  test("nothing is preselected, application stays off and rendering writes nothing", () => {
    const starter = createDevelopmentStarter();
    const preview: ImportPreview = {
      revision: 0,
      terms: starter.terms.map((term, index) => ({
        index,
        canonical: term.canonical,
        language: term.language,
        category: term.category,
        scope: term.scope,
        status: "new",
        variants: term.variants.map((variant, variantIndex) => ({
          ...variant,
          index: variantIndex,
          status: "new",
        })),
      })),
    };
    const { calls, client } = recordingClient();
    const html = renderToStaticMarkup(
      <VocabularyImportReview
        client={client}
        source="starter"
        text={JSON.stringify(starter)}
        preview={preview}
        onDone={() => {}}
      />,
    );
    expect(calls).toEqual([]);
    for (const label of [
      "Добавить термин «PIM»",
      "Разрешить замену «пи ай эм» → «PIM»",
      "Разрешить замену «пим» → «PIM»",
      "Разрешить замену «дев» → «Dev»",
      "Разрешить замену «прод» → «Prod»",
      "Включить применение словаря после сохранения",
    ]) {
      const start = html.indexOf(`aria-label="${label}"`);
      expect(start).toBeGreaterThan(-1);
      const tag = html.slice(html.lastIndexOf("<button", start), html.indexOf(">", start));
      expect(tag).toContain('aria-checked="false"');
    }
    expect(html).toContain('value="деплой, окружение, среда"');
    expect(html).toContain("Сохранить выбранное (0)");
  });
});

describe("history provenance control", () => {
  const personalization = {
    lexiconRevision: 1,
    activeDomain: null,
    hintMode: "none" as const,
    hintTermIds: [],
    ruleIds: ["rule"],
    termIds: ["term"],
    replacements: 1,
    status: "applied" as const,
  };
  const entry = {
    id: "e",
    timestamp: "2026-10-06T10:00:00.000Z",
    duration: 1,
    source: "voice" as const,
  };

  test("a vocabulary-only change is labelled as the vocabulary, not AI cleanup", () => {
    const html = renderToStaticMarkup(
      <HistoryTextVariantControl
        entry={{ ...entry, raw: "пим", cleaned: "PIM", cleanupApplied: false, personalization }}
        value="cleaned"
        onChange={() => {}}
      />,
    );
    expect(html).toContain("Изменено словарём: замен 1");
    expect(html).toContain(">Итог<");
    expect(html).toContain(">Исходный<");
    expect(html).not.toContain("ИИ-очисткой");
  });

  test("cleanup with vocabulary offers the text before the vocabulary", () => {
    const html = renderToStaticMarkup(
      <HistoryTextVariantControl
        entry={{
          ...entry,
          raw: "пим",
          cleaned: "PIM.",
          preVocabularyText: "Пим.",
          cleanupApplied: true,
          personalization,
        }}
        value="cleaned"
        onChange={() => {}}
      />,
    );
    expect(html).toContain(">До словаря<");
    expect(html).toContain("Изменено ИИ-очисткой и словарём: замен 1");
  });

  test("legacy cleanup entries keep the existing labels", () => {
    const html = renderToStaticMarkup(
      <HistoryTextVariantControl
        entry={{ ...entry, raw: "raw", cleaned: "Raw." }}
        value="cleaned"
        onChange={() => {}}
      />,
    );
    expect(html).toContain("ИИ-очистка текста");
    expect(html).toContain(">Очищенный<");
    expect(html).toContain("Изменено ИИ-очисткой");
  });
});
