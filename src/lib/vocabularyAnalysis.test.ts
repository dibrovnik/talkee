import { expect, test } from "bun:test";
import type { HistoryEntry } from "./store";
import { createEmptyVocabularyState } from "./vocabulary";
import {
  analysisSources,
  EXTRACTION_INSTRUCTION,
  parseAnalysisResponse,
  planAnalysis,
} from "./vocabularyAnalysis";

function entry(id: string, raw = "Открой пи ай эм"): HistoryEntry {
  return {
    id,
    timestamp: "2026-10-06T10:00:00Z",
    raw,
    cleaned: raw,
    source: "voice",
    status: "completed",
  } as HistoryEntry;
}
test("only completed original dictation is eligible and compact legacy raw is restored", async () => {
  const history = [
    entry("voice"),
    { ...entry("compact"), raw: "" },
    { ...entry("file"), source: "file" },
    { ...entry("error"), errorMessage: "failed" },
    { ...entry("processing"), status: "processing" },
    { ...entry("personal"), cleaned: "PIM", personalization: {} },
    { ...entry("cleanup"), cleaned: "Открой PIM" },
  ];
  const sources = await analysisSources(history as HistoryEntry[]);
  expect(sources.map((s) => s.id)).toEqual(["voice", "compact", "personal", "cleanup"]);
  expect(sources[1].raw).toBe("Открой пи ай эм");
  expect(sources[2].before).toBe("");
  expect(sources[3].before).toBe("Открой PIM");
});
test("Unicode escaped JSON budgets retain the last tail and coverage only skips same fingerprint", async () => {
  const sources = await analysisSources([entry("long", 'кириллица " 😀 '.repeat(600) + "КОНЕЦ")]);
  const state = createEmptyVocabularyState();
  for (const local of [true, false]) {
    state.coverage = [];
    const batches = planAnalysis(sources, state, "full", local);
    expect(batches[batches.length - 1]?.slice(-1)[0]?.text.endsWith("КОНЕЦ")).toBe(true);
    for (const fragments of batches) {
      expect(
        new TextEncoder().encode(EXTRACTION_INSTRUCTION + JSON.stringify({ fragments })).length,
      ).toBeLessThanOrEqual(local ? 2700 : 12288);
      expect(fragments.length).toBeLessThanOrEqual(local ? 8 : 20);
    }
    state.coverage = [
      {
        sourceId: "long",
        fingerprint: sources[0].fingerprint,
        ranges: [[0, [...sources[0].raw].length]],
      },
    ];
    expect(planAnalysis(sources, state, "new", local)).toEqual([]);
    state.coverage[0].fingerprint = "old";
    expect(planAnalysis(sources, state, "new", local).length).toBeGreaterThan(0);
  }
});
test("strict extraction rejects invented quotes, unknown fields, non-JSON and overflow", async () => {
  const fragments = planAnalysis(
    await analysisSources([entry("1")]),
    createEmptyVocabularyState(),
    "full",
    false,
  )[0];
  const candidate = {
    canonical: "PIM",
    variant: "пи ай эм",
    language: "any",
    category: "service",
    scope: { global: true },
    caseSensitive: false,
    contextWords: [],
    citations: [{ fragmentId: fragments[0].id, quote: "Открой пи ай эм" }],
  };
  expect(
    parseAnalysisResponse(JSON.stringify({ candidates: [candidate] }), fragments),
  ).toHaveLength(1);
  for (const data of [
    { candidates: [{ ...candidate, instruction: "execute" }] },
    { candidates: [{ ...candidate, citations: [{ fragmentId: "unknown", quote: "пи ай эм" }] }] },
    {
      candidates: [
        { ...candidate, citations: [{ fragmentId: fragments[0].id, quote: "ложная пи ай эм" }] },
      ],
    },
    { candidates: Array(6).fill(candidate) },
  ]) {
    expect(() => parseAnalysisResponse(JSON.stringify(data), fragments)).toThrow();
  }
  expect(() => parseAnalysisResponse("not json", fragments)).toThrow();
  expect(() => parseAnalysisResponse("x".repeat(65537), fragments)).toThrow();
});
