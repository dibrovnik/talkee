import { describe, expect, test } from "bun:test";
import starterFixture from "../../src-tauri/src/vocabulary/fixtures/starter-development.json";
import fixture from "../../src-tauri/src/vocabulary/fixtures/state-v1.json";
import { needsHotkeySettingsMigration, normalizeSavedSettings } from "./store";
import {
  buildImportSelection,
  createDevelopmentStarter,
  createEmptyVocabularyState,
  createVocabularyClient,
  type ImportChoice,
  type ImportPreview,
  parseVocabularyError,
  parseVocabularyView,
  VOCABULARY_UPDATED_EVENT,
  type VocabularyClientDeps,
  type VocabularyState,
  type VocabularyUpdated,
} from "./vocabulary";

function readyView(state: VocabularyState): { status: "ready"; state: VocabularyState } {
  return { status: "ready", state };
}

function stateAt(revision: number): VocabularyState {
  return { ...createEmptyVocabularyState(), revision, lexiconRevision: revision };
}

describe("vocabulary contract", () => {
  test("shared Rust fixture round-trips through the TypeScript parser unchanged", () => {
    const view = parseVocabularyView({ status: "ready", state: fixture });
    expect(view.status).toBe("ready");
    expect(JSON.parse(JSON.stringify(view.status === "ready" ? view.state : null))).toEqual(
      fixture,
    );
  });

  test("empty state keeps application and schedule off with no active domain", () => {
    const state = createEmptyVocabularyState();
    expect(state.config.enabled).toBe(false);
    expect(state.config.analysisSchedule).toBe("off");
    expect(state.config.activeDomain).toBeNull();
    expect(Object.keys(state).sort()).toEqual(Object.keys(fixture).sort());
    expect(Object.keys(state.config).sort()).toEqual(Object.keys(fixture.config).sort());
  });

  test("corrupt and malformed snapshots are distinguished", () => {
    expect(parseVocabularyView({ status: "corrupt", reason: "версия 2" })).toEqual({
      status: "corrupt",
      reason: "версия 2",
    });
    expect(() => parseVocabularyView({ status: "ready", state: { schemaVersion: 2 } })).toThrow();
  });

  test("native error codes are split from the user message", () => {
    expect(parseVocabularyError("[vocabulary:conflict] Словарь изменён")).toEqual({
      code: "conflict",
      message: "Словарь изменён",
    });
    expect(parseVocabularyError(new Error("boom")).code).toBe("unknown");
  });
});

describe("correction hotkey setting", () => {
  const legacy = { hotkey: "Alt+Space", cleanupEnabled: true };

  test("legacy settings get no correction hotkey and need no rewrite", () => {
    const normalized = normalizeSavedSettings(legacy);
    expect(normalized.vocabularyCorrectionHotkey).toBeUndefined();
    expect(
      needsHotkeySettingsMigration(legacy, { ...normalized, vocabularyCorrectionHotkey: "" }),
    ).toBe(false);
  });

  test("a saved correction hotkey is normalized", () => {
    expect(
      normalizeSavedSettings({ ...legacy, vocabularyCorrectionHotkey: "shift+ctrl+v" })
        .vocabularyCorrectionHotkey,
    ).toBe("Control+Shift+V");
  });
});

describe("vocabulary client cache", () => {
  function harness(initial: VocabularyState) {
    let current = initial;
    const calls: string[] = [];
    let emit: ((payload: VocabularyUpdated) => void) | null = null;
    const deps: VocabularyClientDeps = {
      invoke: async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
        calls.push(command);
        if (command === "vocabulary_update_config") {
          if (args?.expectedRevision !== current.revision) {
            throw new Error("[vocabulary:conflict] stale");
          }
          current = stateAt(current.revision + 1);
        }
        return readyView(current) as T;
      },
      listen: async <T>(event: string, handler: (event: { payload: T }) => void) => {
        expect(event).toBe(VOCABULARY_UPDATED_EVENT);
        emit = (payload) => handler({ payload: payload as T });
        return () => {};
      },
    };
    return {
      client: createVocabularyClient(deps),
      calls,
      setRemote(state: VocabularyState) {
        current = state;
      },
      emit(payload: VocabularyUpdated) {
        emit?.(payload);
      },
    };
  }

  test("reuses the warm snapshot until a newer revision is announced", async () => {
    const h = harness(stateAt(1));
    await h.client.getView();
    await h.client.getView();
    expect(h.calls).toEqual(["vocabulary_get_state"]);

    h.setRemote(stateAt(2));
    h.emit({ revision: 1, lexiconRevision: 1 });
    await Promise.resolve();
    expect(h.calls).toHaveLength(1);

    const seen: number[] = [];
    h.client.subscribe((view) => {
      if (view.status === "ready") seen.push(view.state.revision);
    });
    h.emit({ revision: 2, lexiconRevision: 2 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen).toEqual([2]);
    const view = await h.client.getView();
    expect(view.status === "ready" && view.state.revision).toBe(2);
  });

  test("a stale expected revision surfaces a conflict and keeps the cached snapshot", async () => {
    const h = harness(stateAt(3));
    await h.client.getView();
    h.setRemote(stateAt(4));
    await expect(h.client.updateConfig(3, { enabled: true })).rejects.toThrow("conflict");
    const cached = await h.client.getView();
    expect(cached.status === "ready" && cached.state.revision).toBe(3);
    const fresh = await h.client.getView({ refresh: true });
    expect(fresh.status === "ready" && fresh.state.revision).toBe(4);
    const saved = await h.client.updateConfig(4, { enabled: true });
    expect(saved.status === "ready" && saved.state.revision).toBe(5);
  });

  test("an older response never replaces a newer cached snapshot", async () => {
    const h = harness(stateAt(5));
    await h.client.updateConfig(5, {});
    h.setRemote(stateAt(4));
    const view = await h.client.getView({ refresh: true });
    expect(view.status === "ready" && view.state.revision).toBe(6);
  });
});

describe("starter and portable import", () => {
  test("the starter matches the fixture Rust validates", () => {
    expect(createDevelopmentStarter()).toEqual(starterFixture as never);
  });

  test("starter and portable documents carry no evidence, consent, history or key fields", () => {
    const allowed = new Set([
      "format",
      "version",
      "terms",
      "canonical",
      "language",
      "category",
      "scope",
      "domain",
      "global",
      "enabled",
      "useAsHint",
      "variants",
      "source",
      "caseSensitive",
      "contextWords",
    ]);
    const keys = new Set<string>();
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") {
        for (const [key, inner] of Object.entries(value)) {
          keys.add(key);
          walk(inner);
        }
      }
    };
    walk(createDevelopmentStarter());
    expect([...keys].filter((key) => !allowed.has(key))).toEqual([]);
  });

  test("dev and prod rules are limited to environment context, never bare ASCII", () => {
    const starter = createDevelopmentStarter();
    const rules = starter.terms.flatMap((term) =>
      term.variants.map((variant) => [term.canonical, variant.source, variant.contextWords]),
    );
    expect(rules).toContainEqual(["Dev", "дев", ["деплой", "окружение", "среда"]]);
    expect(rules).toContainEqual(["Prod", "прод", ["деплой", "окружение", "среда"]]);
    expect(rules.some(([, source]) => /^[a-z]+$/i.test(String(source)))).toBe(false);
  });

  const preview: ImportPreview = {
    revision: 7,
    terms: [
      {
        index: 0,
        canonical: "PIM",
        language: "any",
        category: "service",
        scope: { domain: "Разработка" },
        existingTermId: "term-pim",
        status: "same",
        variants: [
          {
            index: 0,
            source: "пим",
            caseSensitive: false,
            contextWords: [],
            enabled: true,
            status: "same",
          },
          {
            index: 1,
            source: "пи ай эм",
            caseSensitive: false,
            contextWords: [],
            enabled: true,
            status: "new",
          },
        ],
      },
      {
        index: 1,
        canonical: "Dev",
        language: "any",
        category: "environment",
        scope: { domain: "Разработка" },
        status: "new",
        variants: [
          {
            index: 0,
            source: "дев",
            caseSensitive: false,
            contextWords: [],
            enabled: true,
            status: "new",
          },
          {
            index: 1,
            source: "девка",
            caseSensitive: false,
            contextWords: [],
            enabled: true,
            status: "conflict",
            conflict: "Конфликт",
          },
        ],
      },
    ],
  };
  const choose = (entries: Array<[number, ImportChoice]>) => new Map(entries);

  test("nothing is imported unless explicitly chosen", () => {
    expect(buildImportSelection(preview, choose([]))).toEqual([]);
  });

  test("selection drops no-op and conflicting rows and needs the new term itself", () => {
    const selection = buildImportSelection(
      preview,
      choose([
        [0, { includeTerm: true, variants: new Set([0, 1]) }],
        [1, { includeTerm: false, variants: new Set([0]) }],
      ]),
    );
    expect(selection).toEqual([{ termIndex: 0, includeTerm: false, variantIndexes: [1] }]);
    const withTerm = buildImportSelection(
      preview,
      choose([[1, { includeTerm: true, variants: new Set([0, 1]) }]]),
    );
    expect(withTerm).toEqual([{ termIndex: 1, includeTerm: true, variantIndexes: [0] }]);
  });

  test("previews never touch the cache; apply sends the reviewed text and publishes", async () => {
    const calls: Array<[string, Record<string, unknown> | undefined]> = [];
    const client = createVocabularyClient({
      invoke: async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
        calls.push([command, args]);
        if (command === "vocabulary_preview_import") return preview as T;
        return readyView(stateAt(8)) as T;
      },
      listen: async () => () => {},
    });
    const seen: number[] = [];
    client.subscribe((view) => {
      if (view.status === "ready") seen.push(view.state.revision);
    });
    await client.previewImport("{}");
    expect(seen).toEqual([]);
    const selection = [{ termIndex: 1, includeTerm: true, variantIndexes: [0] }];
    await client.applyImport(7, "{}", selection, "starter", false);
    expect(calls[1]).toEqual([
      "vocabulary_apply_import",
      { expectedRevision: 7, text: "{}", selection, source: "starter", enableApplication: false },
    ]);
    expect(seen).toEqual([8]);
  });
});
