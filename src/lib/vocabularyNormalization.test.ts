import { describe, expect, test } from "bun:test";
import {
  createEmptyVocabularyState,
  type TermScope,
  type VocabularyState,
  type VocabularyTerm,
  type VocabularyVariant,
} from "./vocabulary";
import {
  compileVocabularySnapshot,
  findProtectedSpans,
  normalizeWithVocabulary,
  type VocabularySnapshot,
} from "./vocabularyNormalization";

let nextId = 0;

function variant(source: string, extra: Partial<VocabularyVariant> = {}): VocabularyVariant {
  nextId += 1;
  return {
    id: `v${nextId}`,
    source,
    enabled: true,
    caseSensitive: false,
    contextWords: [],
    provenance: "manual",
    ...extra,
  };
}

function term(
  canonical: string,
  variants: VocabularyVariant[],
  extra: Partial<VocabularyTerm> = {},
): VocabularyTerm {
  nextId += 1;
  return {
    id: `t${nextId}`,
    canonical,
    language: "any",
    category: "service",
    scope: { global: true } as TermScope,
    enabled: true,
    useAsHint: true,
    provenance: "manual",
    variants,
    createdAt: 0,
    updatedAt: 0,
    ...extra,
  };
}

function stateWith(
  terms: VocabularyTerm[],
  config: Partial<VocabularyState["config"]> = {},
): VocabularyState {
  const empty = createEmptyVocabularyState();
  return {
    ...empty,
    lexiconRevision: 1,
    config: { ...empty.config, enabled: true, ...config },
    terms,
  };
}

function snapshotOf(terms: VocabularyTerm[], language = "ru"): VocabularySnapshot {
  return compileVocabularySnapshot(stateWith(terms), language);
}

const developer = [
  term("PIM", [variant("пи ай эм"), variant("пи")]),
  term("Prod", [variant("прод", { contextWords: ["деплой", "окружение"] })], {
    category: "environment",
  }),
  term("Dev", [variant("дев")], { category: "environment" }),
];

describe("vocabulary normalization", () => {
  test.each([
    [
      "longest variant wins over a shorter overlap",
      "настроить пи ай эм сегодня",
      "настроить PIM сегодня",
    ],
    [
      "whole Cyrillic word only",
      "прод деплой, продажа и продукт",
      "Prod деплой, продажа и продукт",
    ],
    ["context in the same sentence", "деплой в прод", "деплой в Prod"],
    ["no context, no replacement", "интересный прод", "интересный прод"],
    [
      "context in another sentence is ignored",
      "Был деплой. Интересный прод",
      "Был деплой. Интересный прод",
    ],
    ["multi-word variant stops at a line break", "пи\nай эм", "PIM\nай эм"],
    ["case-insensitive source keeps punctuation", "Пи Ай Эм, готово!", "PIM, готово!"],
    ["emoji and diacritics stay untouched", "🚀 дев — café 👍", "🚀 Dev — café 👍"],
  ])("%s", (_name, input, expected) => {
    expect(normalizeWithVocabulary(input, snapshotOf(developer)).text).toBe(expected);
  });

  test("technical spans are preserved byte for byte", () => {
    const input =
      "ветка feature/dev, PIMService, файл src/pim.ts, почта dev@pim.ru, `дев` и ```\nпи ай эм\n``` и деплой в прод";
    const result = normalizeWithVocabulary(input, snapshotOf(developer));
    expect(result.text).toBe(
      "ветка feature/dev, PIMService, файл src/pim.ts, почта dev@pim.ru, `дев` и ```\nпи ай эм\n``` и деплой в Prod",
    );
    expect(result.replacements).toBe(1);
  });

  test("canonical spellings alone never turn ASCII dev/prod into rules", () => {
    const result = normalizeWithVocabulary("deploy dev and prod", snapshotOf(developer));
    expect(result.status).toBe("unchanged");
    expect(result.text).toBe("deploy dev and prod");
  });

  test("a term without variants does not replace look-alikes", () => {
    const snapshot = snapshotOf([term("PIM", [])]);
    expect(normalizeWithVocabulary("пин и ним", snapshot).text).toBe("пин и ним");
  });

  test("case-sensitive rule only matches its exact casing and is idempotent", () => {
    const snapshot = snapshotOf([term("PIM", [variant("pim", { caseSensitive: true })])]);
    const once = normalizeWithVocabulary("pim Pim PIM", snapshot);
    expect(once.text).toBe("PIM Pim PIM");
    expect(normalizeWithVocabulary(once.text, snapshot).text).toBe(once.text);
  });

  test("output is never re-scanned within one pass", () => {
    const snapshot = snapshotOf([term("ай эм", [variant("пи")])]);
    expect(normalizeWithVocabulary("пи пи", snapshot).text).toBe("ай эм ай эм");
  });

  test("normalization is idempotent for the developer starter rules", () => {
    const snapshot = snapshotOf(developer);
    const once = normalizeWithVocabulary("пи ай эм и дев, деплой в прод", snapshot);
    expect(normalizeWithVocabulary(once.text, snapshot).text).toBe(once.text);
  });

  test("reports counts and rule ids without text", () => {
    const result = normalizeWithVocabulary("пи ай эм и дев", snapshotOf(developer));
    expect(result.status).toBe("applied");
    expect(result.replacements).toBe(2);
    expect(result.termIds).toHaveLength(2);
    expect(Object.keys(result).sort()).toEqual([
      "replacements",
      "ruleIds",
      "status",
      "termIds",
      "text",
    ]);
  });
});

describe("vocabulary snapshots", () => {
  test("disabled vocabulary changes nothing", () => {
    const state = stateWith(developer, { enabled: false });
    const result = normalizeWithVocabulary("деплой в прод", compileVocabularySnapshot(state, "ru"));
    expect(result).toEqual({
      text: "деплой в прод",
      status: "disabled",
      replacements: 0,
      ruleIds: [],
      termIds: [],
    });
  });

  test("only global plus the selected domain apply", () => {
    const terms = [
      term("PIM", [variant("пим")], { scope: { domain: "Разработка" } }),
      term("ПИМ-мед", [variant("пим")], { scope: { domain: "Медицина" } }),
      term("Dev", [variant("дев")]),
    ];
    const dev = compileVocabularySnapshot(stateWith(terms, { activeDomain: "разработка" }), "ru");
    expect(normalizeWithVocabulary("пим и дев", dev).text).toBe("PIM и Dev");
    const none = compileVocabularySnapshot(stateWith(terms, { activeDomain: null }), "ru");
    expect(normalizeWithVocabulary("пим и дев", none).text).toBe("пим и Dev");
  });

  test("language filter keeps any-language rules and all rules under auto", () => {
    const terms = [
      term("Prod", [variant("прод")], { language: "ru" }),
      term("Deploy", [variant("деплоить")], { language: "en" }),
    ];
    expect(normalizeWithVocabulary("прод деплоить", snapshotOf(terms, "ru")).text).toBe(
      "Prod деплоить",
    );
    expect(normalizeWithVocabulary("прод деплоить", snapshotOf(terms, "auto")).text).toBe(
      "Prod Deploy",
    );
  });

  test("disabled terms and variants are excluded", () => {
    const terms = [
      term("PIM", [variant("пим", { enabled: false })]),
      term("Dev", [variant("дев")], { enabled: false }),
    ];
    expect(normalizeWithVocabulary("пим дев", snapshotOf(terms)).text).toBe("пим дев");
  });

  test("a captured snapshot ignores later store edits", () => {
    const state = stateWith([term("PIM", [variant("пим")])]);
    const snapshot = compileVocabularySnapshot(state, "ru");
    state.terms[0].canonical = "Changed";
    state.terms[0].variants.push(variant("дев"));
    state.config.enabled = false;
    expect(normalizeWithVocabulary("пим дев", snapshot).text).toBe("PIM дев");
  });
});

describe("normalization safety limits", () => {
  test("time budget exhaustion returns the whole input without partial changes", () => {
    let calls = 0;
    const clock = () => {
      calls += 1;
      return calls > 3 ? 1000 : 0;
    };
    const input = "пи ай эм и дев и деплой в прод".repeat(3);
    const result = normalizeWithVocabulary(input, snapshotOf(developer), { now: clock });
    expect(result).toMatchObject({
      text: input,
      status: "error",
      reason: "time_budget",
      replacements: 0,
    });
  });

  test("oversized text and too many matches fall back whole", () => {
    const snapshot = snapshotOf(developer);
    expect(normalizeWithVocabulary("дев ".repeat(13_000), snapshot).reason).toBe("text_too_long");
    const many = "дев ".repeat(1001);
    const result = normalizeWithVocabulary(many, snapshot);
    expect(result).toMatchObject({ text: many, status: "error", reason: "too_many_matches" });
  });

  test("protected span detector covers code, URLs, mail and paths", () => {
    const text = "см. https://pim.dev/x и a@b.ru, путь ~/dev/pim, код `x`";
    const covered = findProtectedSpans(text).map((span) => text.slice(span.start, span.end));
    expect(covered).toEqual(
      expect.arrayContaining(["https://pim.dev/x", "a@b.ru", "~/dev/pim,", "`x`"]),
    );
  });
});

// Opt-in local timing: `VOCABULARY_BENCH=1 bun test src/lib/vocabularyNormalization.test.ts`.
// The acceptance p95 is measured separately by `bun run evaluate:vocabulary --benchmark`.
test.if(process.env.VOCABULARY_BENCH === "1")("benchmark: 1000 terms, 2000 chars", () => {
  const terms = Array.from({ length: 1000 }, (_, index) =>
    term(`Term${index}`, [variant(`слово${index} хвост`), variant(`альт${index}`)]),
  );
  const snapshot = snapshotOf(terms);
  const text = "деплой в прод слово42 хвост и альт7, обычный текст без терминов "
    .repeat(32)
    .slice(0, 2000);
  for (let i = 0; i < 10; i += 1) normalizeWithVocabulary(text, snapshot);
  const samples: number[] = [];
  for (let i = 0; i < 100; i += 1) {
    const start = performance.now();
    normalizeWithVocabulary(text, snapshot);
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  const p50 = samples[Math.floor(samples.length * 0.5)];
  const p95 = samples[Math.floor(samples.length * 0.95)];
  console.log(
    `vocabulary normalizer: rules=${snapshot.ruleCount} p50=${p50.toFixed(3)}ms p95=${p95.toFixed(3)}ms`,
  );
  expect(p95).toBeLessThan(10);
});
