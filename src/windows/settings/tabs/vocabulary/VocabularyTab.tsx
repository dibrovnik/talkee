import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../../../lib/i18n";
import { IconBook, IconPencil, IconPlus, IconTrash } from "../../../../lib/icons";
import { logError } from "../../../../lib/logger";
import {
  parseVocabularyError,
  type TermCategory,
  type TermInput,
  type VocabularyClient,
  type VocabularyConfigPatch,
  type VocabularyState,
  type VocabularyTerm,
  type VocabularyView,
  vocabularyClient,
} from "../../../../lib/vocabulary";
import { Badge } from "../../../../ui/Badge";
import { Button } from "../../../../ui/Button";
import { FormRow } from "../../../../ui/FormRow";
import { FormSection } from "../../../../ui/FormSection";
import { SegmentedControl } from "../../../../ui/SegmentedControl";
import { SelectMenu } from "../../../../ui/SelectMenu";
import { TextField } from "../../../../ui/TextField";
import { Toggle } from "../../../../ui/Toggle";
import { VocabularyEditor } from "./VocabularyEditor";
import {
  activeRuleCount,
  filterTerms,
  listDomains,
  readySuggestionCount,
  TERM_CATEGORIES,
} from "./vocabularyView";

type VocabularyPane = "terms" | "suggestions" | "analysis";

interface EditorTarget {
  termId: string | null;
  /** Term as it was when the editor opened; later updates never reset the draft. */
  initial: VocabularyTerm | null;
}

export interface VocabularyTabProps {
  client?: VocabularyClient;
  initialView?: VocabularyView | null;
}

export function VocabularyTab({
  client = vocabularyClient(),
  initialView = null,
}: VocabularyTabProps): ReactElement {
  const { t } = useI18n();
  const [view, setView] = useState<VocabularyView | null>(initialView);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [pane, setPane] = useState<VocabularyPane>("terms");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<TermCategory | "all">("all");
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let alive = true;
    client
      .getView()
      .then((next) => {
        if (alive) setView(next);
      })
      .catch((error) => {
        if (!alive) return;
        const message = parseVocabularyError(error).message;
        setLoadError(message);
        logError("VOCABULARY", `load failed: ${parseVocabularyError(error).code}`);
      });
    const unsubscribe = client.subscribe((next) => {
      if (alive) setView(next);
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [client]);

  const state: VocabularyState | null = view?.status === "ready" ? view.state : null;
  const revision = state?.revision ?? 0;
  const pending = state ? readySuggestionCount(state) : 0;
  const domains = useMemo(
    () => (state ? listDomains(state.terms, [state.config.activeDomain]) : []),
    [state],
  );
  const visibleTerms = useMemo(
    () => (state ? filterTerms(state.terms, query, category) : []),
    [state, query, category],
  );

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setView(await client.getView({ refresh: true }));
    } catch (error) {
      setLoadError(parseVocabularyError(error).message);
    }
  }, [client]);

  const reportAction = async (error: unknown, operation: string): Promise<void> => {
    const parsed = parseVocabularyError(error);
    logError("VOCABULARY", `${operation} failed: ${parsed.code}`);
    if (parsed.code === "conflict" || parsed.code === "not_found") {
      setActionError(t("vocabulary.editor.conflict"));
      await refresh();
      return;
    }
    setActionError(t("vocabulary.saveError", { error: parsed.message }));
  };

  const updateConfig = async (patch: VocabularyConfigPatch): Promise<void> => {
    if (!state) return;
    setActionError("");
    try {
      setView(await client.updateConfig(state.revision, patch));
    } catch (error) {
      await reportAction(error, "update config");
    }
  };

  const openEditor = (term: VocabularyTerm | null): void => {
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    setPendingDelete(null);
    setActionError("");
    setEditor({ termId: term?.id ?? null, initial: term });
  };

  const closeEditor = (): void => {
    setEditor(null);
    const target = returnFocusRef.current;
    requestAnimationFrame(() => {
      if (target?.isConnected) target.focus();
    });
  };

  const saveTerm = async (expectedRevision: number, input: TermInput): Promise<void> => {
    setView(await client.saveTerm(expectedRevision, input));
  };

  const confirmDelete = async (term: VocabularyTerm): Promise<void> => {
    if (!state) return;
    setActionError("");
    try {
      setView(await client.deleteTerm(state.revision, term.id));
      setPendingDelete(null);
    } catch (error) {
      await reportAction(error, "delete term");
    }
  };

  const editedTermExists = Boolean(
    editor?.termId && state?.terms.some((term) => term.id === editor.termId),
  );

  return (
    <div className="ui-tab">
      <div className="ui-page-header">
        <h2 className="ui-page-header__title">{t("vocabulary.page.title")}</h2>
        <div className="ui-page-header__desc">{t("vocabulary.page.desc")}</div>
      </div>

      {loadError && (
        <div className="ui-callout ui-callout--error" role="alert">
          {t("vocabulary.loadError", { error: loadError })}
        </div>
      )}

      {view?.status === "corrupt" && (
        <div className="ui-callout ui-callout--error" role="alert">
          <div className="ui-callout__title">{t("vocabulary.corrupt.title")}</div>
          {t("vocabulary.corrupt.desc", { reason: view.reason })}
        </div>
      )}

      {state && (
        <>
          <SegmentedControl
            ariaLabel={t("vocabulary.view.aria")}
            value={pane}
            options={[
              { value: "terms", label: t("vocabulary.view.terms") },
              {
                value: "suggestions",
                label:
                  pending > 0
                    ? t("vocabulary.view.suggestionsCount", { count: pending })
                    : t("vocabulary.view.suggestions"),
                needsAttention: pending > 0,
              },
              { value: "analysis", label: t("vocabulary.view.analysis") },
            ]}
            onChange={setPane}
          />

          <FormSection title={t("vocabulary.apply.section")}>
            <FormRow
              label={t("vocabulary.apply.toggle")}
              description={t("vocabulary.apply.toggleDesc")}
              control={
                <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                  <Badge variant={state.config.enabled ? "success" : "neutral"}>
                    {t(
                      state.config.enabled
                        ? "vocabulary.apply.status.on"
                        : "vocabulary.apply.status.off",
                    )}
                  </Badge>
                  <Toggle
                    checked={state.config.enabled}
                    ariaLabel={t("vocabulary.apply.toggle")}
                    onChange={(enabled) => void updateConfig({ enabled })}
                  />
                </span>
              }
            />
            <FormRow
              label={t("vocabulary.apply.domain")}
              description={t("vocabulary.apply.domainDesc")}
              control={
                <SelectMenu
                  ariaLabel={t("vocabulary.apply.domain")}
                  value={state.config.activeDomain ?? ""}
                  options={[
                    { value: "", label: t("vocabulary.apply.globalOnly") },
                    ...domains.map((domain) => ({ value: domain, label: domain })),
                  ]}
                  onChange={(value) => void updateConfig({ activeDomain: value || null })}
                />
              }
            />
            <FormRow
              label={t("vocabulary.capability.label")}
              description={t("vocabulary.capability.desc")}
              control={<Badge>{t("vocabulary.capability.replacementsOnly")}</Badge>}
            />
            {pending > 0 && (
              <FormRow
                label={t("vocabulary.view.suggestions")}
                control={<Badge>{t("vocabulary.apply.pending", { count: pending })}</Badge>}
              />
            )}
          </FormSection>

          {actionError && (
            <div className="ui-callout ui-callout--error" role="alert">
              {actionError}
            </div>
          )}

          {pane === "terms" &&
            (editor ? (
              <VocabularyEditor
                key={editor.termId ?? "new"}
                term={editor.initial}
                activeDomain={state.config.activeDomain}
                currentRevision={revision}
                removedElsewhere={Boolean(editor.termId) && !editedTermExists}
                save={saveTerm}
                close={closeEditor}
              />
            ) : state.terms.length === 0 ? (
              <div className="ui-empty-state">
                <div className="ui-empty-state__badge" aria-hidden="true">
                  <IconBook size={20} />
                </div>
                <div className="ui-empty-state__title">{t("vocabulary.empty.title")}</div>
                <p className="ui-empty-state__hint">{t("vocabulary.empty.desc")}</p>
                <div
                  style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}
                >
                  <Button variant="primary" onClick={() => openEditor(null)}>
                    {t("vocabulary.action.add")}
                  </Button>
                  <Button onClick={() => setPane("analysis")}>
                    {t("vocabulary.action.analyze")}
                  </Button>
                </div>
              </div>
            ) : (
              <FormSection
                title={t("vocabulary.list.section")}
                action={
                  <Button onClick={() => openEditor(null)}>
                    <IconPlus size={14} aria-hidden="true" /> {t("vocabulary.action.add")}
                  </Button>
                }
              >
                <div style={{ display: "flex", gap: 8, padding: "8px 0" }}>
                  <TextField
                    type="search"
                    aria-label={t("vocabulary.list.search")}
                    placeholder={t("vocabulary.list.search")}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    style={{ flex: 1 }}
                  />
                  <SelectMenu
                    ariaLabel={t("vocabulary.editor.category")}
                    value={category}
                    options={[
                      { value: "all", label: t("vocabulary.list.allCategories") },
                      ...TERM_CATEGORIES.map((value) => ({
                        value,
                        label: t(`vocabulary.category.${value}`),
                      })),
                    ]}
                    onChange={(value) => setCategory(value as TermCategory | "all")}
                  />
                </div>
                {visibleTerms.length === 0 ? (
                  <p style={{ color: "var(--text-mid)" }}>{t("vocabulary.list.noMatches")}</p>
                ) : (
                  <ul
                    aria-label={t("vocabulary.list.section")}
                    style={{ listStyle: "none", margin: 0, padding: 0 }}
                  >
                    {visibleTerms.map((term) => (
                      <TermRow
                        key={term.id}
                        term={term}
                        confirming={pendingDelete === term.id}
                        onEdit={() => openEditor(term)}
                        onAskDelete={() => setPendingDelete(term.id)}
                        onCancelDelete={() => setPendingDelete(null)}
                        onConfirmDelete={() => void confirmDelete(term)}
                      />
                    ))}
                  </ul>
                )}
              </FormSection>
            ))}

          {pane === "suggestions" && (
            <div className="ui-empty-state ui-empty-state--compact">
              <p className="ui-empty-state__hint">{t("vocabulary.suggestions.empty")}</p>
            </div>
          )}

          {pane === "analysis" && (
            <div className="ui-empty-state ui-empty-state--compact">
              <p className="ui-empty-state__hint">{t("vocabulary.analysis.unavailable")}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

interface TermRowProps {
  term: VocabularyTerm;
  confirming: boolean;
  onEdit: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}

function TermRow({
  term,
  confirming,
  onEdit,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
}: TermRowProps): ReactElement {
  const { t } = useI18n();
  const rules = activeRuleCount(term);
  const scope = term.scope.domain
    ? t("vocabulary.scope.domain", { domain: term.scope.domain })
    : t("vocabulary.scope.global");

  return (
    <li style={{ padding: "10px 0", borderBottom: "1px solid var(--separator)" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: "var(--text-hi)", fontWeight: 500 }}>{term.canonical}</div>
          <div style={{ color: "var(--text-mid)", display: "flex", gap: 6, flexWrap: "wrap" }}>
            <span>{t(`vocabulary.category.${term.category}`)}</span>
            <span aria-hidden="true">·</span>
            <span>{scope}</span>
            <span aria-hidden="true">·</span>
            <span>
              {rules > 0
                ? t("vocabulary.list.rules", { count: rules })
                : t("vocabulary.list.noRules")}
            </span>
          </div>
        </div>
        {!term.enabled && <Badge>{t("vocabulary.list.disabled")}</Badge>}
        {term.enabled && term.useAsHint && <Badge>{t("vocabulary.list.hint")}</Badge>}
        <Button aria-label={`${t("vocabulary.action.edit")}: ${term.canonical}`} onClick={onEdit}>
          <IconPencil size={14} aria-hidden="true" />
        </Button>
        <Button
          aria-label={`${t("vocabulary.action.delete")}: ${term.canonical}`}
          onClick={onAskDelete}
        >
          <IconTrash size={14} aria-hidden="true" />
        </Button>
      </div>
      {confirming && (
        <div
          role="alertdialog"
          aria-label={t("vocabulary.action.delete")}
          style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}
        >
          <span style={{ flex: 1 }}>
            {t("vocabulary.delete.confirm", { term: term.canonical, count: term.variants.length })}
          </span>
          <Button onClick={onCancelDelete}>{t("vocabulary.action.cancel")}</Button>
          <Button variant="destructive" onClick={onConfirmDelete}>
            {t("vocabulary.action.delete")}
          </Button>
        </div>
      )}
    </li>
  );
}
