import { type ReactElement, useEffect, useId, useState } from "react";
import { type MsgKey, useI18n } from "../../../../lib/i18n";
import { IconPlus, IconTrash } from "../../../../lib/icons";
import { logError } from "../../../../lib/logger";
import {
  parseVocabularyError,
  type TermInput,
  type VocabularyTerm,
} from "../../../../lib/vocabulary";
import { Button } from "../../../../ui/Button";
import { FormRow } from "../../../../ui/FormRow";
import { FormSection } from "../../../../ui/FormSection";
import { SegmentedControl } from "../../../../ui/SegmentedControl";
import { SelectMenu } from "../../../../ui/SelectMenu";
import { TextField } from "../../../../ui/TextField";
import { Toggle } from "../../../../ui/Toggle";
import {
  type DraftProblem,
  draftFromTerm,
  draftToInput,
  newVariantDraft,
  TERM_CATEGORIES,
  type TermDraft,
  updateVariantDraft,
  type VariantDraft,
  validateDraft,
  variantRuleChanged,
} from "./vocabularyView";

const LANGUAGES = ["any", "ru", "en"] as const;

const PROBLEM_KEYS: Record<DraftProblem, MsgKey> = {
  canonical: "vocabulary.editor.required",
  domain: "vocabulary.editor.domainRequired",
  variantEmpty: "vocabulary.editor.variantEmpty",
};

export interface VocabularyEditorProps {
  term: VocabularyTerm | null;
  activeDomain: string | null;
  /** Latest known revision; used only after the user re-confirms a conflicted save. */
  currentRevision: number;
  /** True when the edited term no longer exists in the latest state. */
  removedElsewhere: boolean;
  save: (expectedRevision: number, input: TermInput) => Promise<void>;
  close: () => void;
}

export function VocabularyEditor({
  term,
  activeDomain,
  currentRevision,
  removedElsewhere,
  save,
  close,
}: VocabularyEditorProps): ReactElement {
  const { t } = useI18n();
  const canonicalId = useId();
  const domainId = useId();
  const [draft, setDraft] = useState<TermDraft>(() => draftFromTerm(term, activeDomain));
  const [baseRevision, setBaseRevision] = useState(currentRevision);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    document.getElementById(canonicalId)?.focus();
  }, [canonicalId]);

  const patch = (next: Partial<TermDraft>): void => setDraft((prev) => ({ ...prev, ...next }));
  const patchVariant = (key: string, change: Parameters<typeof updateVariantDraft>[1]): void =>
    setDraft((prev) => ({
      ...prev,
      variants: prev.variants.map((v) => (v.key === key ? updateVariantDraft(v, change) : v)),
    }));

  const submit = async (expectedRevision: number): Promise<void> => {
    const problem = validateDraft(draft);
    if (problem) {
      setError(t(PROBLEM_KEYS[problem]));
      return;
    }
    setSaving(true);
    setError("");
    try {
      await save(expectedRevision, draftToInput(draft));
      close();
    } catch (raw) {
      const parsed = parseVocabularyError(raw);
      if (parsed.code === "conflict") {
        setConflict(true);
      } else {
        setError(t("vocabulary.saveError", { error: parsed.message }));
      }
      logError("VOCABULARY", `save term failed: ${parsed.code}`);
    } finally {
      setSaving(false);
    }
  };

  const confirmOnFresh = (): void => {
    setBaseRevision(currentRevision);
    setConflict(false);
    void submit(currentRevision);
  };

  const target = draft.canonical.trim() || "…";

  return (
    <form
      aria-label={t(term ? "vocabulary.editor.editTitle" : "vocabulary.editor.newTitle")}
      onSubmit={(event) => {
        event.preventDefault();
        if (conflict) confirmOnFresh();
        else void submit(baseRevision);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          close();
        }
      }}
    >
      <FormSection title={t(term ? "vocabulary.editor.editTitle" : "vocabulary.editor.newTitle")}>
        <FormRow
          label={<label htmlFor={canonicalId}>{t("vocabulary.editor.canonical")}</label>}
          description={t("vocabulary.editor.canonicalDesc")}
          control={
            <TextField
              id={canonicalId}
              value={draft.canonical}
              maxLength={64}
              onChange={(event) => patch({ canonical: event.target.value })}
            />
          }
        />
        <FormRow
          label={t("vocabulary.editor.language")}
          control={
            <SelectMenu
              ariaLabel={t("vocabulary.editor.language")}
              value={draft.language}
              options={LANGUAGES.map((value) => ({
                value,
                label: value === "any" ? t("vocabulary.editor.anyLanguage") : value.toUpperCase(),
              }))}
              onChange={(language) => patch({ language })}
            />
          }
        />
        <FormRow
          label={t("vocabulary.editor.category")}
          control={
            <SelectMenu
              ariaLabel={t("vocabulary.editor.category")}
              value={draft.category}
              options={TERM_CATEGORIES.map((value) => ({
                value,
                label: t(`vocabulary.category.${value}`),
              }))}
              onChange={(category) => patch({ category: category as TermDraft["category"] })}
            />
          }
        />
        <FormRow
          label={t("vocabulary.editor.scope")}
          control={
            <SegmentedControl
              ariaLabel={t("vocabulary.editor.scope")}
              value={draft.scopeKind}
              options={[
                { value: "global", label: t("vocabulary.editor.scopeGlobal") },
                { value: "domain", label: t("vocabulary.editor.scopeDomain") },
              ]}
              onChange={(scopeKind) => patch({ scopeKind })}
            />
          }
        />
        {draft.scopeKind === "domain" && (
          <FormRow
            label={<label htmlFor={domainId}>{t("vocabulary.editor.domainName")}</label>}
            control={
              <TextField
                id={domainId}
                value={draft.domain}
                maxLength={64}
                onChange={(event) => patch({ domain: event.target.value })}
              />
            }
          />
        )}
        <FormRow
          label={t("vocabulary.editor.enabled")}
          control={
            <Toggle
              checked={draft.enabled}
              ariaLabel={t("vocabulary.editor.enabled")}
              onChange={(enabled) => patch({ enabled })}
            />
          }
        />
        <FormRow
          label={t("vocabulary.editor.useAsHint")}
          description={t("vocabulary.editor.useAsHintDesc")}
          control={
            <Toggle
              checked={draft.useAsHint}
              ariaLabel={t("vocabulary.editor.useAsHint")}
              onChange={(useAsHint) => patch({ useAsHint })}
            />
          }
        />
      </FormSection>

      <FormSection
        title={t("vocabulary.editor.variants")}
        footer={t("vocabulary.editor.variantsDesc")}
        action={
          <Button
            onClick={() => patch({ variants: [...draft.variants, newVariantDraft()] })}
            disabled={draft.variants.length >= 20}
          >
            <IconPlus size={14} aria-hidden="true" /> {t("vocabulary.editor.addVariant")}
          </Button>
        }
      >
        {draft.variants.map((variant) => (
          <VariantRow
            key={variant.key}
            variant={variant}
            target={target}
            onChange={(change) => patchVariant(variant.key, change)}
            onRemove={() =>
              patch({ variants: draft.variants.filter((v) => v.key !== variant.key) })
            }
          />
        ))}
      </FormSection>

      {removedElsewhere && term && (
        <div className="ui-callout" role="status">
          {t("vocabulary.editor.removedElsewhere")}
        </div>
      )}
      {conflict && (
        <div className="ui-callout ui-callout--error" role="alert">
          {t("vocabulary.editor.conflict")}
        </div>
      )}
      {error && (
        <div className="ui-callout ui-callout--error" role="alert">
          {error}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <Button onClick={close}>{t("vocabulary.action.cancel")}</Button>
        <Button type="submit" variant="primary" disabled={saving}>
          {t(conflict ? "vocabulary.action.retryOnFresh" : "vocabulary.action.save")}
        </Button>
      </div>
    </form>
  );
}

interface VariantRowProps {
  variant: VariantDraft;
  target: string;
  onChange: (change: Parameters<typeof updateVariantDraft>[1]) => void;
  onRemove: () => void;
}

function VariantRow({ variant, target, onChange, onRemove }: VariantRowProps): ReactElement {
  const { t } = useI18n();
  const sourceId = useId();
  const contextId = useId();
  const source = variant.source.trim() || "…";
  const needsApproval = variantRuleChanged(variant) && !variant.approved;

  return (
    <div
      style={{
        display: "grid",
        gap: 8,
        padding: "10px 0",
        borderBottom: "1px solid var(--separator)",
      }}
    >
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <label htmlFor={sourceId} style={{ minWidth: 140, color: "var(--text-mid)" }}>
          {t("vocabulary.editor.variantSource")}
        </label>
        <TextField
          id={sourceId}
          value={variant.source}
          maxLength={64}
          onChange={(event) => onChange({ source: event.target.value })}
          style={{ flex: 1 }}
        />
        <Button aria-label={t("vocabulary.editor.variantRemove")} onClick={onRemove}>
          <IconTrash size={14} aria-hidden="true" />
        </Button>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <label htmlFor={contextId} style={{ minWidth: 140, color: "var(--text-mid)" }}>
          {t("vocabulary.editor.variantContext")}
        </label>
        <TextField
          id={contextId}
          value={variant.contextText}
          onChange={(event) => onChange({ contextText: event.target.value })}
          style={{ flex: 1 }}
        />
      </div>
      <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          <Toggle
            checked={variant.caseSensitive}
            ariaLabel={t("vocabulary.editor.variantCase")}
            onChange={(caseSensitive) => onChange({ caseSensitive })}
          />
          {t("vocabulary.editor.variantCase")}
        </span>
        <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          <Toggle
            checked={variant.approved}
            ariaLabel={t("vocabulary.editor.variantApprove", { source, target })}
            onChange={(approved) => onChange({ approved })}
          />
          {t("vocabulary.editor.variantApprove", { source, target })}
        </span>
        {needsApproval && variant.original && (
          <span style={{ color: "var(--text-mid)" }}>
            {t("vocabulary.editor.variantNeedsApproval")}
          </span>
        )}
      </div>
    </div>
  );
}
