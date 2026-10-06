import { type ReactElement, useEffect, useId, useState } from "react";
import { useI18n } from "../../../../lib/i18n";
import { logError } from "../../../../lib/logger";
import {
  buildImportSelection,
  type ImportChoice,
  type ImportItemStatus,
  type ImportPreview,
  type ImportSource,
  isSelectable,
  type PortableDocument,
  parseVocabularyError,
  type VocabularyClient,
  type VocabularyView,
} from "../../../../lib/vocabulary";
import { Badge } from "../../../../ui/Badge";
import { Button } from "../../../../ui/Button";
import { FormRow } from "../../../../ui/FormRow";
import { FormSection } from "../../../../ui/FormSection";
import { TextField } from "../../../../ui/TextField";
import { Toggle } from "../../../../ui/Toggle";
import { parseContextWords } from "./vocabularyView";

export interface VocabularyImportReviewProps {
  client: VocabularyClient;
  source: ImportSource;
  /** Exact document text the first preview was computed from. */
  text: string;
  preview: ImportPreview;
  onDone: (view: VocabularyView | null) => void;
}

const STATUS_KEYS = {
  new: "vocabulary.import.status.new",
  same: "vocabulary.import.status.same",
  conflict: "vocabulary.import.status.conflict",
} as const;

function StatusBadge({ status }: { status: ImportItemStatus }): ReactElement {
  const { t } = useI18n();
  return (
    <Badge variant={status === "conflict" ? "danger" : "neutral"}>{t(STATUS_KEYS[status])}</Badge>
  );
}

export function VocabularyImportReview({
  client,
  source,
  text: initialText,
  preview: initialPreview,
  onDone,
}: VocabularyImportReviewProps): ReactElement {
  const { t } = useI18n();
  const headingId = useId();
  const editable = source === "starter";
  const [text, setText] = useState(initialText);
  const [previewText, setPreviewText] = useState(initialText);
  const [preview, setPreview] = useState(initialPreview);
  const [choices, setChoices] = useState<Map<number, ImportChoice>>(() => new Map());
  const [enableApplication, setEnableApplication] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.getElementById(headingId)?.focus();
  }, [headingId]);

  const document_ = JSON.parse(text) as PortableDocument;
  const selection = buildImportSelection(preview, choices);

  const choiceOf = (index: number): ImportChoice =>
    choices.get(index) ?? { includeTerm: false, variants: new Set() };

  const setChoice = (index: number, next: ImportChoice): void =>
    setChoices((prev) => new Map(prev).set(index, next));

  const refreshPreview = async (nextText: string): Promise<boolean> => {
    try {
      setPreview(await client.previewImport(nextText));
      setPreviewText(nextText);
      setError("");
      return true;
    } catch (raw) {
      setError(parseVocabularyError(raw).message);
      return false;
    }
  };

  const editDocument = (change: (doc: PortableDocument) => void): void => {
    const next = JSON.parse(text) as PortableDocument;
    change(next);
    setText(JSON.stringify(next));
  };

  const apply = async (): Promise<void> => {
    setNotice("");
    if (text !== previewText) {
      if (await refreshPreview(text)) setNotice(t("vocabulary.import.refreshed"));
      return;
    }
    setBusy(true);
    try {
      const view = await client.applyImport(
        preview.revision,
        text,
        selection,
        source,
        enableApplication,
      );
      onDone(view);
    } catch (raw) {
      const parsed = parseVocabularyError(raw);
      logError("VOCABULARY", `apply import failed: ${parsed.code}`);
      if (parsed.code === "conflict") {
        if (await refreshPreview(text)) setNotice(t("vocabulary.import.changedElsewhere"));
      } else {
        setError(t("vocabulary.saveError", { error: parsed.message }));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-labelledby={headingId}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onDone(null);
        }
      }}
    >
      <h3 id={headingId} tabIndex={-1} className="ui-form-section__title">
        {t(editable ? "vocabulary.starter.title" : "vocabulary.import.title")}
      </h3>
      <p style={{ color: "var(--text-mid)", margin: "0 0 12px" }}>
        {t(editable ? "vocabulary.starter.desc" : "vocabulary.import.desc")}
      </p>

      {preview.terms.map((row) => {
        const choice = choiceOf(row.index);
        const termDoc = document_.terms[row.index];
        const termSelectable = row.status === "new";
        const variantsSelectable =
          row.status === "new" ? choice.includeTerm : row.status === "same";
        return (
          <FormSection
            key={row.index}
            title={
              <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                {row.canonical}
                <StatusBadge status={row.status} />
              </span>
            }
            footer={row.conflict}
          >
            {editable && row.status !== "same" && (
              <FormRow
                label={t("vocabulary.editor.canonical")}
                control={
                  <TextField
                    aria-label={`${t("vocabulary.editor.canonical")}: ${row.canonical}`}
                    value={termDoc.canonical}
                    maxLength={64}
                    onChange={(event) =>
                      editDocument((doc) => {
                        doc.terms[row.index].canonical = event.target.value;
                      })
                    }
                    onBlur={() => void refreshPreview(text)}
                  />
                }
              />
            )}
            {termSelectable && (
              <FormRow
                label={t("vocabulary.import.addTerm", { term: row.canonical })}
                description={
                  row.scope.domain
                    ? t("vocabulary.scope.domain", { domain: row.scope.domain })
                    : t("vocabulary.scope.global")
                }
                control={
                  <Toggle
                    checked={choice.includeTerm}
                    ariaLabel={t("vocabulary.import.addTerm", { term: row.canonical })}
                    onChange={(includeTerm) => setChoice(row.index, { ...choice, includeTerm })}
                  />
                }
              />
            )}
            {row.variants.map((variant) => {
              const variantDoc = termDoc.variants[variant.index];
              const label = t("vocabulary.editor.variantApprove", {
                source: variant.source,
                target: row.canonical,
              });
              return (
                <FormRow
                  key={variant.index}
                  label={
                    <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                      {label}
                      <StatusBadge status={variant.status} />
                    </span>
                  }
                  description={
                    variant.conflict ??
                    (editable ? undefined : variant.contextWords.join(", ") || undefined)
                  }
                  control={
                    <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                      {editable && variant.status === "new" && (
                        <TextField
                          aria-label={`${t("vocabulary.editor.variantContext")}: ${variant.source}`}
                          placeholder={t("vocabulary.editor.variantContext")}
                          value={variantDoc.contextWords.join(", ")}
                          onChange={(event) =>
                            editDocument((doc) => {
                              doc.terms[row.index].variants[variant.index].contextWords =
                                parseContextWords(event.target.value);
                            })
                          }
                          onBlur={() => void refreshPreview(text)}
                        />
                      )}
                      {isSelectable(variant.status) && (
                        <Toggle
                          checked={choice.variants.has(variant.index)}
                          disabled={!variantsSelectable}
                          ariaLabel={label}
                          onChange={(on) => {
                            const variants = new Set(choice.variants);
                            if (on) variants.add(variant.index);
                            else variants.delete(variant.index);
                            setChoice(row.index, { ...choice, variants });
                          }}
                        />
                      )}
                    </span>
                  }
                />
              );
            })}
          </FormSection>
        );
      })}

      {editable && (
        <FormSection>
          <FormRow
            label={t("vocabulary.starter.enable")}
            description={t("vocabulary.apply.toggleDesc")}
            control={
              <Toggle
                checked={enableApplication}
                ariaLabel={t("vocabulary.starter.enable")}
                onChange={setEnableApplication}
              />
            }
          />
        </FormSection>
      )}

      {notice && (
        <div className="ui-callout" role="status">
          {notice}
        </div>
      )}
      {error && (
        <div className="ui-callout ui-callout--error" role="alert">
          {error}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <Button onClick={() => onDone(null)}>{t("vocabulary.action.cancel")}</Button>
        <Button
          variant="primary"
          disabled={busy || Boolean(error) || (selection.length === 0 && !enableApplication)}
          onClick={() => void apply()}
        >
          {t("vocabulary.import.apply", { count: selection.length })}
        </Button>
      </div>
    </section>
  );
}
