import { listen } from "@tauri-apps/api/event";
import { type ReactElement, useEffect, useMemo, useRef, useState } from "react";
import { SETTINGS_UPDATED_EVENT } from "../lib/hotkeyEvents";
import { useI18n } from "../lib/i18n";
import { IconCheck, IconClipboard, IconPencil, IconTrash } from "../lib/icons";
import {
  type AppSettings,
  addSummaryToEntry,
  deleteSummaryFromEntry,
  getSettings,
  HISTORY_MAX_SUMMARIES_PER_ENTRY,
  type HistoryEntry,
  listPromptsByKind,
  type SummaryEntry,
  updateSummaryInEntry,
} from "../lib/store";
import {
  resolveSummaryBackend,
  type SummarizeProgress,
  summarizeTranscript,
  transcriptToText,
} from "../lib/summarize";
import { formatDurationMs, formatErrorMessage } from "../lib/utils";
import { Button } from "../ui/Button";
import { PopUpButton } from "../ui/PopUpButton";
import { ProgressBar } from "../ui/ProgressBar";
import { type RowActionItem, RowActionsMenu } from "./RowActionsMenu";
import { SlideOverModal } from "./SlideOverModal";

const PREFERRED_DEFAULT_PROMPT = "summary-short";
const TEXT_PREVIEW_LIMIT = 250;

export function SummaryModal({
  entry,
  onClose,
  onEntryChange,
}: {
  entry: HistoryEntry;
  onClose: () => void;
  onEntryChange?: (entry: HistoryEntry) => void;
}): ReactElement {
  const { lang, t } = useI18n();
  const text = useMemo(() => transcriptToText(entry).trim(), [entry]);

  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [promptId, setPromptId] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<SummarizeProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<SummaryEntry[]>(entry.summaries ?? []);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const summaryRunRef = useRef<{ id: number; cancelled: boolean } | null>(null);
  const nextRunIdRef = useRef(0);

  useEffect(() => {
    setSummaries(entry.summaries ?? []);
  }, [entry.summaries]);

  useEffect(() => {
    let cancelled = false;
    getSettings({ reload: true })
      .then((next) => {
        if (cancelled) return;
        setSettings(next);
        setPromptId((current) => {
          if (current) return current;
          const list = listPromptsByKind(next, "summary");
          const preferred = list.find((p) => p.id === PREFERRED_DEFAULT_PROMPT);
          return preferred?.id || next.defaultSummaryPromptId || list[0]?.id || "";
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Live-refresh when prompts/settings change elsewhere (e.g. a new summary prompt
  // is created in the «Стиль и промпты» tab) so the dropdown updates immediately.
  useEffect(() => {
    const unlistenPromise = listen(SETTINGS_UPDATED_EVENT, () => {
      getSettings({ reload: true })
        .then(setSettings)
        .catch(() => {});
    });
    return () => {
      void unlistenPromise.then((dispose) => dispose());
    };
  }, []);

  const prompts = settings ? listPromptsByKind(settings, "summary") : [];
  const selected = prompts.find((p) => p.id === promptId) ?? prompts[0];
  const backend = settings ? resolveSummaryBackend(settings) : null;
  const canRun = Boolean(settings && selected && text && backend && !running);

  const formatTime = (iso: string): string => {
    try {
      return new Date(iso).toLocaleString(lang === "en" ? "en-US" : "ru-RU", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return iso;
    }
  };

  const progressLabel = (): string => {
    if (!progress) return t("summary.progress.preparing");
    if (progress.phase === "map") {
      return t("summary.progress.map", { current: progress.current, total: progress.total });
    }
    if (progress.phase === "reduce") return t("summary.progress.reduce");
    return t("summary.progress.preparing");
  };

  const progressPercent = (): number => {
    if (!progress) return 8;
    if (progress.phase === "map" && progress.total > 0) {
      return Math.max(8, Math.min(90, Math.round((progress.current / progress.total) * 90)));
    }
    if (progress.phase === "reduce") return 95;
    return 8;
  };

  const generate = async (): Promise<void> => {
    if (!settings || !selected || !text) {
      if (!text) setError(t("summary.empty.noText"));
      return;
    }
    const runState = { id: nextRunIdRef.current + 1, cancelled: false };
    nextRunIdRef.current = runState.id;
    summaryRunRef.current = runState;
    setRunning(true);
    setError(null);
    setProgress(null);
    const startedAt = Date.now();
    try {
      const result = await summarizeTranscript({
        text,
        prompt: selected,
        settings,
        onProgress: setProgress,
        shouldCancel: () => summaryRunRef.current !== runState || runState.cancelled,
      });
      if (summaryRunRef.current !== runState || runState.cancelled) return;
      const summary: SummaryEntry = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        promptId: selected.id,
        promptName: selected.name,
        text: result.trim(),
      };
      const updated = await addSummaryToEntry(entry.id, summary);
      setSummaries(
        updated?.summaries ?? [summary, ...summaries].slice(0, HISTORY_MAX_SUMMARIES_PER_ENTRY),
      );
      if (updated) onEntryChange?.(updated);
      setExpandedId(summary.id);
    } catch (e) {
      if (summaryRunRef.current === runState && !runState.cancelled) {
        setError(formatErrorMessage(e));
      }
    } finally {
      if (summaryRunRef.current === runState) {
        summaryRunRef.current = null;
        setRunning(false);
        setProgress(null);
      }
    }
  };

  const stopSummary = (): void => {
    if (summaryRunRef.current) {
      summaryRunRef.current.cancelled = true;
    }
    setRunning(false);
    setProgress(null);
  };

  useEffect(() => {
    return () => {
      if (summaryRunRef.current) {
        summaryRunRef.current.cancelled = true;
      }
    };
  }, []);

  const copy = async (item: SummaryEntry): Promise<void> => {
    try {
      await navigator.clipboard.writeText(item.text);
      setCopiedId(item.id);
      window.setTimeout(() => setCopiedId((id) => (id === item.id ? null : id)), 1500);
    } catch {
      /* clipboard may be unavailable */
    }
  };

  const startEdit = (item: SummaryEntry): void => {
    setEditingId(item.id);
    setEditText(item.text);
    setExpandedId(item.id);
  };

  const saveEdit = async (item: SummaryEntry): Promise<void> => {
    const updated = await updateSummaryInEntry(entry.id, item.id, editText);
    setSummaries(
      updated?.summaries ?? summaries.map((s) => (s.id === item.id ? { ...s, text: editText } : s)),
    );
    if (updated) onEntryChange?.(updated);
    setEditingId(null);
  };

  const remove = async (item: SummaryEntry): Promise<void> => {
    const updated = await deleteSummaryFromEntry(entry.id, item.id);
    setSummaries(updated?.summaries ?? summaries.filter((s) => s.id !== item.id));
    if (updated) onEntryChange?.(updated);
  };

  const promptOptions = prompts.map((p) => ({ value: p.id, label: p.name }));

  return (
    <SlideOverModal
      onClose={onClose}
      title={t("summary.title")}
      width="100vw"
      topOffset="var(--summary-modal-top-offset, 0px)"
    >
      <div className="ui-tab">
        {/* Generate controls */}
        <div className="ui-form-stack">
          <label className="ui-form-field__label" htmlFor="summary-prompt">
            {t("summary.type")}
          </label>
          <div className="ui-summary__controls">
            <PopUpButton
              id="summary-prompt"
              className="ui-summary__prompt"
              value={selected?.id ?? ""}
              options={promptOptions}
              onChange={setPromptId}
              disabled={running || prompts.length === 0}
            />
            <Button
              variant={running ? "default" : "primary"}
              onClick={running ? stopSummary : () => void generate()}
              disabled={!running && !canRun}
            >
              {running
                ? t("summary.stop")
                : summaries.length
                  ? t("summary.regenerate")
                  : t("summary.generate")}
            </Button>
          </div>

          {!backend && <div className="ui-form-hint">{t("summary.noModel")}</div>}

          {running && (
            <div className="ui-form-stack">
              <div className="ui-form-feedback">{progressLabel()}</div>
              <ProgressBar value={progressPercent() / 100} ariaLabel={progressLabel()} />
            </div>
          )}

          {error && <div className="ui-form-feedback ui-form-feedback--error">{error}</div>}
        </div>

        {/* Summary history — same table as the main history list */}
        <div className="ui-form-stack">
          <div className="ui-form-section__title">{t("summary.history.title")}</div>
          {summaries.length === 0 ? (
            <div className="ui-form-hint">{t("summary.history.empty")}</div>
          ) : (
            <table className="b-table">
              <thead>
                <tr>
                  <th style={{ width: 124 }}>{t("mainTab.colTime")}</th>
                  <th className="ui-history__text-cell">{t("mainTab.colText")}</th>
                </tr>
              </thead>
              <tbody>
                {summaries.map((item) => {
                  const expanded = expandedId === item.id;
                  const isEditing = editingId === item.id;
                  const tooLong = item.text.length > TEXT_PREVIEW_LIMIT;
                  const visible =
                    tooLong && !expanded
                      ? `${item.text.slice(0, TEXT_PREVIEW_LIMIT).trimEnd()}...`
                      : item.text;
                  return (
                    <tr key={item.id}>
                      <td className="ui-history__time-cell">
                        <div className="ui-history__time">
                          <span>{formatTime(item.createdAt)}</span>
                          <span className="ui-history__time-meta">
                            {formatDurationMs(item.durationMs, lang)}
                          </span>
                          <span className="ui-history__source">{item.promptName}</span>
                        </div>
                      </td>
                      <td className="ui-history__text-cell">
                        <div className="ui-history__row">
                          <div className="ui-history__content">
                            {isEditing ? (
                              <>
                                <textarea
                                  value={editText}
                                  onChange={(e) => setEditText(e.target.value)}
                                  aria-label={t("summary.edit")}
                                  className="ui-textfield ui-textarea"
                                  style={{ minHeight: 320, resize: "vertical" }}
                                />
                                <div className="ui-form-actions">
                                  <Button onClick={() => setEditingId(null)}>
                                    {t("summary.cancel")}
                                  </Button>
                                  <Button variant="primary" onClick={() => void saveEdit(item)}>
                                    {t("summary.save")}
                                  </Button>
                                </div>
                              </>
                            ) : (
                              <div className="ui-expandable-text">
                                <span style={{ whiteSpace: "pre-wrap" }}>{visible}</span>
                                {tooLong && (
                                  <button
                                    type="button"
                                    className="ui-disclosure-link"
                                    onClick={() => setExpandedId(expanded ? null : item.id)}
                                  >
                                    {expanded ? t("mainTab.collapse") : t("mainTab.expand")}
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                          <RowActionsMenu
                            label={t("summary.actions")}
                            items={
                              [
                                {
                                  key: "copy",
                                  label:
                                    copiedId === item.id ? t("summary.copied") : t("summary.copy"),
                                  icon:
                                    copiedId === item.id ? (
                                      <IconCheck size={14} stroke={2.5} />
                                    ) : (
                                      <IconClipboard size={14} stroke={2} />
                                    ),
                                  onSelect: () => void copy(item),
                                },
                                {
                                  key: "edit",
                                  label: t("summary.edit"),
                                  icon: <IconPencil size={14} stroke={2} />,
                                  onSelect: () => startEdit(item),
                                },
                                {
                                  key: "delete",
                                  label: t("summary.delete"),
                                  icon: <IconTrash size={14} stroke={2} />,
                                  danger: true,
                                  onSelect: () => void remove(item),
                                },
                              ] as RowActionItem[]
                            }
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </SlideOverModal>
  );
}
