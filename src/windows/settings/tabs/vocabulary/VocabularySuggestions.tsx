import { type ReactElement, useState } from "react";
import {
  parseVocabularyError,
  type VocabularyClient,
  type VocabularyState,
  type VocabularySuggestion,
} from "../../../../lib/vocabulary";
import { Button } from "../../../../ui/Button";
import { FormRow } from "../../../../ui/FormRow";
import { FormSection } from "../../../../ui/FormSection";
import { SegmentedControl } from "../../../../ui/SegmentedControl";
import { TextField } from "../../../../ui/TextField";
import { Toggle } from "../../../../ui/Toggle";

function SuggestionReview({
  suggestion,
  state,
  client,
}: {
  suggestion: VocabularySuggestion;
  state: VocabularyState;
  client: VocabularyClient;
}): ReactElement {
  const [canonical, setCanonical] = useState(suggestion.canonical);
  const [domain, setDomain] = useState(suggestion.scope.domain ?? "");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [contexts, setContexts] = useState(
    suggestion.variants.map((v) => v.contextWords.join(", ")),
  );
  const [cases, setCases] = useState(suggestion.variants.map((v) => v.caseSensitive));
  const [revision, setRevision] = useState(state.revision);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [stale, setStale] = useState(false);
  const act = async (action: "accept" | "reject" | "restore"): Promise<void> => {
    setSaving(true);
    setError("");
    try {
      await client.reviewSuggestion(revision, {
        suggestionId: suggestion.id,
        action,
        canonical,
        category: suggestion.category,
        scope: domain.trim() ? { domain: domain.trim() } : { global: true },
        variants: suggestion.variants.flatMap((variant, index) =>
          selected.has(index)
            ? [
                {
                  source: variant.source,
                  enabled: true,
                  caseSensitive: cases[index],
                  contextWords: contexts[index]
                    .split(",")
                    .map((word) => word.trim())
                    .filter(Boolean),
                },
              ]
            : [],
        ),
      });
    } catch (failure) {
      const parsed = parseVocabularyError(failure);
      setError(parsed.message);
      setStale(parsed.code === "conflict");
    } finally {
      setSaving(false);
    }
  };
  const quotes = state.evidence.filter((e) => e.suggestionId === suggestion.id).slice(0, 3);
  const status = {
    collecting: "Собирает примеры",
    ready: "Готово к проверке",
    approved: "Утверждено",
    rejected: "Отклонено",
  }[suggestion.status];
  const origin = {
    "human-correction": "Ваше исправление",
    "cleanup-diff": "Изменение при очистке",
    "stt-hypothesis": "Гипотеза распознавания",
  }[suggestion.origin];
  return (
    <FormSection title={suggestion.canonical}>
      <p>
        {status} · {origin} · записей: {suggestion.sourceCount}
      </p>
      {quotes.map((e) => (
        <blockquote
          key={e.id}
          style={{ margin: "8px 0", color: "var(--text-secondary)", whiteSpace: "pre-wrap" }}
        >
          {e.quote}
        </blockquote>
      ))}
      <FormRow
        label="Правильное написание"
        control={
          <TextField
            value={canonical}
            onChange={(event) => setCanonical(event.target.value)}
            disabled={saving}
          />
        }
      />
      <FormRow
        label="Область"
        description="Пустая — общая. Активная область словаря не изменится."
        control={
          <TextField
            value={domain}
            onChange={(event) => setDomain(event.target.value)}
            disabled={saving}
          />
        }
      />
      {suggestion.variants.map((variant, index) => (
        <div key={variant.source}>
          <FormRow
            label={variant.source}
            description="Отдельно разрешить замену этого варианта"
            control={
              <Toggle
                checked={selected.has(index)}
                disabled={saving}
                onChange={(value) =>
                  setSelected((previous) => {
                    const next = new Set(previous);
                    if (value) next.add(index);
                    else next.delete(index);
                    return next;
                  })
                }
              />
            }
          />
          {selected.has(index) && (
            <>
              <FormRow
                label="Контекст через запятую"
                control={
                  <TextField
                    value={contexts[index]}
                    onChange={(event) =>
                      setContexts((old) =>
                        old.map((word, i) => (i === index ? event.target.value : word)),
                      )
                    }
                  />
                }
              />
              <FormRow
                label="Учитывать регистр"
                control={
                  <Toggle
                    checked={cases[index]}
                    onChange={(value) =>
                      setCases((old) => old.map((item, i) => (i === index ? value : item)))
                    }
                  />
                }
              />
            </>
          )}
        </div>
      ))}
      {error && (
        <p role="alert" className="ui-form-feedback ui-form-feedback--error">
          {error}
        </p>
      )}
      {stale && (
        <Button
          onClick={() => {
            setRevision(state.revision);
            setStale(false);
            setError("");
          }}
        >
          Обновить версию и проверить заново
        </Button>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        {suggestion.status === "ready" && (
          <Button disabled={saving || stale} onClick={() => void act("accept")}>
            {selected.size ? "Утвердить выбранные замены" : "Утвердить только термин"}
          </Button>
        )}
        {suggestion.status !== "approved" && (
          <Button
            disabled={saving || stale}
            onClick={() => void act(suggestion.status === "rejected" ? "restore" : "reject")}
          >
            {suggestion.status === "rejected" ? "Вернуть на проверку" : "Отклонить"}
          </Button>
        )}
      </div>
    </FormSection>
  );
}

export function VocabularySuggestions({
  state,
  client,
}: {
  state: VocabularyState;
  client: VocabularyClient;
}): ReactElement {
  const [filter, setFilter] = useState<"ready" | "collecting" | "rejected" | "approved">("ready");
  const suggestions = state.suggestions
    .filter((s) => s.status === filter)
    .sort((a, b) => {
      const rank = { "human-correction": 0, "cleanup-diff": 1, "stt-hypothesis": 2 };
      return rank[a.origin] - rank[b.origin] || b.sourceCount - a.sourceCount;
    });
  return (
    <div>
      <SegmentedControl
        value={filter}
        options={[
          { value: "ready", label: "На проверку" },
          { value: "collecting", label: "Собирают примеры" },
          { value: "rejected", label: "Отклонённые" },
          { value: "approved", label: "Утверждённые" },
        ]}
        onChange={setFilter}
      />
      {!suggestions.length && (
        <p className="ui-empty-state__hint">Предложений в этом списке пока нет</p>
      )}
      {suggestions.map((suggestion) => (
        <SuggestionReview
          key={suggestion.id}
          suggestion={suggestion}
          state={state}
          client={client}
        />
      ))}
    </div>
  );
}
