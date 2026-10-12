import { type ReactElement, useEffect, useState } from "react";
import {
  getHistory,
  type HistoryEntry,
  normalizeHistoryEntryFromStorage,
} from "../../../../lib/store";
import {
  parseVocabularyError,
  type VocabularyClient,
  type VocabularyState,
  vocabularySourceFingerprint,
} from "../../../../lib/vocabulary";
import { Button, FormRow, FormSection, TextField, Toggle } from "../../../../ui";
import type { CorrectionCapture } from "../../../widget/services/vocabularyCorrection";

export interface CorrectionDialogProps {
  capture: CorrectionCapture;
  client: VocabularyClient;
  state: VocabularyState;
  close: () => void;
}

export function CorrectionDialog({
  capture,
  client,
  state,
  close,
}: CorrectionDialogProps): ReactElement {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [sourceId, setSourceId] = useState(capture.sourceId ?? "");
  const [variant, setVariant] = useState("");
  const [canonical, setCanonical] = useState("");
  const [domain, setDomain] = useState(state.config.activeDomain ?? "");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [context, setContext] = useState("");
  const [approve, setApprove] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let alive = true;
    void getHistory()
      .then((entries) => {
        if (alive)
          setHistory(
            entries
              .map(normalizeHistoryEntryFromStorage)
              .filter(
                (e) =>
                  (e.source ?? "voice") === "voice" &&
                  (!e.status || e.status === "completed") &&
                  !e.dictationTranslation &&
                  !e.errorMessage &&
                  e.raw.trim(),
              ),
          );
      })
      .catch(() => {
        if (alive) setError("Не удалось прочитать историю");
      });
    return () => {
      alive = false;
    };
  }, []);
  const source = history.find((e) => e.id === sourceId);
  const before =
    source?.preVocabularyText ??
    (!source?.personalization && source?.cleaned !== source?.raw ? source?.cleaned : "") ??
    "";
  const save = async (addRule: boolean): Promise<void> => {
    if (!source || !variant.trim() || !canonical.trim()) {
      setError("Выберите исходную запись и подтвердите конкретную пару");
      return;
    }
    if (!source.raw.includes(variant) && !before.includes(variant)) {
      setError("Ошибочный фрагмент отсутствует в исходнике. Уточните пару вручную.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await client.saveCorrection(state.revision, {
        sourceId,
        sourceFingerprint: await vocabularySourceFingerprint(source.raw, before),
        sourceVariant: variant,
        canonical,
        language: "any",
        category: "other",
        scope: domain.trim() ? { domain: domain.trim() } : { global: true },
        caseSensitive,
        contextWords: context
          .split(",")
          .map((word) => word.trim())
          .filter(Boolean),
        addRule,
      });
      close();
    } catch (raw) {
      setError(parseVocabularyError(raw).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <form
      aria-label="Запомнить исправление"
      onSubmit={(e) => {
        e.preventDefault();
        void save(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          close();
        }
      }}
    >
      <FormSection
        title="Запомнить исправление"
        footer="Недавняя вставка — только подсказка. Подтвердите, что исправление относится к выбранной диктовке."
      >
        {capture.text && (
          <p style={{ whiteSpace: "pre-wrap" }}>Выделенная исправленная фраза: {capture.text}</p>
        )}
        <label>
          Исходная диктовка{" "}
          <select
            value={sourceId}
            onChange={(e) => {
              setSourceId(e.target.value);
              setApprove(false);
            }}
          >
            <option value="">Выберите запись…</option>
            {history.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {new Date(entry.timestamp).toLocaleString()} · {entry.raw.slice(0, 80)}
              </option>
            ))}
          </select>
        </label>
        {source && (
          <p style={{ whiteSpace: "pre-wrap" }}>
            {source.raw}
            {before && "\nДо словаря: " + before}
          </p>
        )}
        <FormRow
          label="Ошибочный фрагмент"
          control={
            <TextField
              aria-label="Ошибочный фрагмент"
              value={variant}
              maxLength={64}
              onChange={(e) => {
                setVariant(e.target.value);
                setApprove(false);
              }}
            />
          }
        />
        <FormRow
          label="Правильное написание"
          control={
            <TextField
              aria-label="Правильное написание"
              value={canonical}
              maxLength={64}
              onChange={(e) => {
                setCanonical(e.target.value);
                setApprove(false);
              }}
            />
          }
        />
        <FormRow
          label="Область (пусто — общий словарь)"
          control={
            <TextField
              aria-label="Область исправления"
              value={domain}
              maxLength={64}
              onChange={(e) => {
                setDomain(e.target.value);
                setApprove(false);
              }}
            />
          }
        />
        <FormRow
          label="Слова контекста через запятую"
          control={
            <TextField
              aria-label="Контекст исправления"
              value={context}
              onChange={(e) => {
                setContext(e.target.value);
                setApprove(false);
              }}
            />
          }
        />
        <FormRow
          label="Учитывать регистр"
          control={
            <Toggle
              ariaLabel="Учитывать регистр исправления"
              checked={caseSensitive}
              onChange={(next) => {
                setCaseSensitive(next);
                setApprove(false);
              }}
            />
          }
        />
        <FormRow
          label="Разрешить эту замену в указанной области"
          control={
            <Toggle
              ariaLabel="Разрешить замену исправления"
              checked={approve}
              onChange={setApprove}
            />
          }
        />
      </FormSection>
      {error && <p role="alert">{error}</p>}
      <div style={{ display: "flex", gap: 8 }}>
        <Button onClick={close}>Отмена</Button>
        <Button type="submit" disabled={saving}>
          Сохранить пример
        </Button>
        <Button disabled={saving || !approve} onClick={() => void save(true)}>
          Сохранить и добавить правило
        </Button>
      </div>
    </form>
  );
}
