import { emit, listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import type {
  ReactElement,
  FocusEvent as ReactFocusEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  HistoryAudioTrack,
  HistoryAudioTrackPlaceholder,
} from "../../../components/HistoryAudioTrack";
import { type RowActionItem, RowActionsMenu } from "../../../components/RowActionsMenu";
import { SpeakerNameInput } from "../../../components/SpeakerNameInput";
import { TranscriptionStatsPanel } from "../../../components/TranscriptionStatsPanel";
import { retryCallCaptureHistoryEntry } from "../../../lib/callCapture";
import { cleanupHistoryText, hasOriginalCleanupText } from "../../../lib/cleanupHistory";
import { retryFileHistoryEntry } from "../../../lib/fileTranscription";
import {
  HISTORY_CLEARED_EVENT,
  HISTORY_DELETED_EVENT,
  HISTORY_UPDATED_EVENT,
  PROCESSING_CANCEL_REQUEST_EVENT,
  type ProcessingCancelRequestPayload,
  SETTINGS_UPDATED_EVENT,
  WIDGET_RETRY_PROCESSING_EVENT,
  type WidgetRetryProcessingPayload,
} from "../../../lib/hotkeyEvents";
import { type MsgKey, type TFunc, type UiLanguage, useI18n } from "../../../lib/i18n";
import {
  IconAlertCircle,
  IconCheck,
  IconCopy,
  IconHelpCircle,
  IconListCheck,
  IconPencil,
  IconRotate2,
  IconSquare,
  IconTrash,
} from "../../../lib/icons";
import { logError, logInfo } from "../../../lib/logger";
import { cancelProcessing } from "../../../lib/processingControl";
import {
  clearHistory,
  DEFAULT_HOTKEY,
  deleteHistoryEntry,
  formatHotkeyLabel,
  getHistoryEntry,
  getHistoryIndex,
  getSettings,
  type HistoryEntry,
  type HistoryListEntry,
  type Speaker,
  type SpeakerTranscriptSegment,
  toHistoryListEntry,
  updateHistoryEntry,
} from "../../../lib/store";
import { isSummaryAvailable } from "../../../lib/summarize";
import { formatDurationMs } from "../../../lib/utils";
import { Button } from "../../../ui/Button";
import { SegmentedControl } from "../../../ui/SegmentedControl";
import { Spinner } from "../../../ui/Spinner";
import { retryHistoryEntry } from "../../widget/services/transcriptionPipeline";

const LazySummaryModal = lazy(() =>
  import("../../../components/SummaryModal").then((module) => ({
    default: module.SummaryModal,
  })),
);

interface MainTabProps {
  initialHistory?: Array<HistoryListEntry | HistoryEntry>;
  focusedEntryId?: string | null;
  focusedEntryNonce?: number;
}

interface HistoryGroup {
  id: string;
  label: string;
  items: HistoryListEntry[];
}

type HistorySource = "voice" | "file" | "call" | "liveTranslation";
type HistoryFilter = "all" | HistorySource;

const HISTORY_TEXT_PREVIEW_LIMIT = 250;
const HISTORY_INITIAL_RENDER_LIMIT = 80;
const HISTORY_RENDER_INCREMENT = 80;
const FULL_ENTRY_CACHE_LIMIT = 25;
const SUPPORT_EMAIL = "david.perov60@gmail.com";
const MAIN_HERO_FIRST_SLIDE_DELAY_MS = 30_000;
const MAIN_HERO_SLIDE_DELAY_MS = 30_000;
const HISTORY_FILTER_OPTIONS: { id: HistoryFilter; labelKey: MsgKey }[] = [
  { id: "all", labelKey: "mainTab.filter.all" },
  { id: "voice", labelKey: "mainTab.filter.voice" },
  { id: "file", labelKey: "mainTab.filter.file" },
  { id: "call", labelKey: "mainTab.filter.call" },
  { id: "liveTranslation", labelKey: "mainTab.filter.liveTranslation" },
];
const MAIN_HERO_SLIDES = [
  {
    id: "record",
    titleKey: "mainTab.howToStart",
    actionKey: "mainTab.howItWorks",
  },
  {
    id: "support",
    titleKey: "mainTab.hero.supportTitle",
    actionKey: "mainTab.hero.supportAction",
  },
] as const satisfies readonly {
  id: "record" | "support";
  titleKey: MsgKey;
  actionKey: MsgKey;
}[];

function getHistorySource(entry: { source?: HistoryEntry["source"] }): HistorySource {
  if (entry.source === "file" || entry.source === "call" || entry.source === "liveTranslation") {
    return entry.source;
  }

  return "voice";
}

function isHistoryListEntry(entry: HistoryListEntry | HistoryEntry): entry is HistoryListEntry {
  return "textPreview" in entry;
}

function toInitialHistoryListEntry(entry: HistoryListEntry | HistoryEntry): HistoryListEntry {
  return isHistoryListEntry(entry) ? entry : toHistoryListEntry(entry);
}

function addFullEntryToCache(
  cache: Map<string, HistoryEntry>,
  entry: HistoryEntry,
): Map<string, HistoryEntry> {
  const next = new Map(cache);
  next.delete(entry.id);
  next.set(entry.id, entry);

  while (next.size > FULL_ENTRY_CACHE_LIMIT) {
    const oldestId = next.keys().next().value;
    if (!oldestId) break;
    next.delete(oldestId);
  }

  return next;
}

function sourceLabelKey(source: HistorySource): MsgKey {
  if (source === "file") return "mainTab.source.file";
  if (source === "call") return "mainTab.source.call";
  if (source === "liveTranslation") return "mainTab.source.liveTranslation";
  return "mainTab.source.voice";
}

function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function formatSpeakerTranscript(segments: SpeakerTranscriptSegment[]): string {
  return segments
    .map(
      (segment) =>
        `[${formatTimestamp(segment.start)}] ${segment.speakerLabel}: ${segment.text.trim()}`,
    )
    .join("\n");
}

function SpeakerHistoryTranscript({
  segments,
}: {
  segments: SpeakerTranscriptSegment[];
}): ReactElement {
  return (
    <div className="ui-transcript">
      {segments.map((segment, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: segments can share a start time; the index keeps the key unique.
          key={`${segment.start}-${index}`}
          className="ui-transcript__segment"
        >
          <div className="ui-transcript__time">{formatTimestamp(segment.start)}</div>
          <div className="ui-transcript__body">
            <div className="ui-transcript__speaker">{segment.speakerLabel}</div>
            <div className="ui-transcript__text">{segment.text}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ExpandableHistoryText({
  text,
  textLength,
  hasSpeakerTranscript,
  speakers,
  segments,
  expanded,
  editing,
  loading,
  onSpeakerRename,
  onToggle,
}: {
  text: string;
  textLength?: number;
  hasSpeakerTranscript?: boolean;
  speakers?: Speaker[];
  segments?: SpeakerTranscriptSegment[];
  expanded: boolean;
  editing: boolean;
  loading?: boolean;
  onSpeakerRename: (speakerId: string, label: string) => Promise<void> | void;
  onToggle: () => void;
}): ReactElement {
  const { t } = useI18n();
  const speakerSegments = segments?.length ? segments : null;
  const textTooLong = (textLength ?? text.length) > HISTORY_TEXT_PREVIEW_LIMIT;
  const shouldCollapse = textTooLong || Boolean(speakerSegments) || Boolean(hasSpeakerTranscript);
  const visibleText =
    textTooLong && !expanded ? `${text.slice(0, HISTORY_TEXT_PREVIEW_LIMIT).trimEnd()}...` : text;

  return (
    <div className="ui-expandable-text">
      {expanded && speakerSegments ? (
        <>
          {editing && speakers?.length ? (
            <div className="ui-speaker-list">
              {speakers.map((speaker) => (
                <SpeakerNameInput
                  key={speaker.id}
                  value={speaker.label}
                  ariaLabel={t("mainTab.speakerNameAria", {
                    name: speaker.label,
                  })}
                  onCommit={(label) => onSpeakerRename(speaker.id, label)}
                />
              ))}
            </div>
          ) : null}
          <SpeakerHistoryTranscript segments={speakerSegments} />
        </>
      ) : (
        <span>{visibleText}</span>
      )}
      {loading && <Spinner size={13} label={t("mainTab.processing")} />}
      {shouldCollapse && (
        <button type="button" className="ui-disclosure-link" onClick={onToggle}>
          {expanded ? t("mainTab.collapse") : t("mainTab.expand")}
        </button>
      )}
    </div>
  );
}

function formatDayLabel(timestamp: string, t: TFunc, lang: UiLanguage): string {
  const entryDate = new Date(timestamp);
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startOfEntryDay = new Date(
    entryDate.getFullYear(),
    entryDate.getMonth(),
    entryDate.getDate(),
  );
  const diffDays = Math.round((startOfToday.getTime() - startOfEntryDay.getTime()) / 86400000);

  if (diffDays === 0) return t("mainTab.day.today");
  if (diffDays === 1) return t("mainTab.day.yesterday");

  return entryDate.toLocaleDateString(lang === "en" ? "en-US" : "ru-RU", {
    day: "numeric",
    month: "long",
    weekday: "long",
  });
}
export function MainTab({
  initialHistory = [],
  focusedEntryId = null,
  focusedEntryNonce = 0,
}: MainTabProps) {
  const { t, lang } = useI18n();
  const [history, setHistory] = useState<HistoryListEntry[]>(() =>
    initialHistory.map(toInitialHistoryListEntry),
  );
  const [originalIds, setOriginalIds] = useState<Set<string>>(() => new Set());
  const [copied, setCopied] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [retrySucceededId, setRetrySucceededId] = useState<string | null>(null);
  const [hotkeyLabel, setHotkeyLabel] = useState(formatHotkeyLabel(DEFAULT_HOTKEY));
  const [isClearArmed, setIsClearArmed] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("all");
  const [visibleHistoryLimit, setVisibleHistoryLimit] = useState(HISTORY_INITIAL_RENDER_LIMIT);
  const [hintHelpOpen, setHintHelpOpen] = useState(false);
  const [heroSlideIndex, setHeroSlideIndex] = useState(0);
  const [heroHasAdvanced, setHeroHasAdvanced] = useState(false);
  const [heroPaused, setHeroPaused] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [editingSpeakerEntryId, setEditingSpeakerEntryId] = useState<string | null>(null);
  const [summaryEntry, setSummaryEntry] = useState<HistoryEntry | null>(null);
  const [summaryAvailable, setSummaryAvailable] = useState(false);
  const [activeAudioId, setActiveAudioId] = useState<string | null>(null);
  const [fullEntryCache, setFullEntryCache] = useState<Map<string, HistoryEntry>>(() => new Map());
  const [loadingFullEntryIds, setLoadingFullEntryIds] = useState<Set<string>>(() => new Set());
  const heroPointerStartX = useRef<number | null>(null);
  const focusedRowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());
  const expandedIdsRef = useRef(expandedIds);
  const summaryEntryRef = useRef(summaryEntry);
  const activeAudioIdRef = useRef(activeAudioId);

  const rememberFullEntry = useCallback((entry: HistoryEntry): void => {
    setFullEntryCache((current) => addFullEntryToCache(current, entry));
  }, []);

  const loadFullEntry = useCallback(
    async (id: string): Promise<HistoryEntry | null> => {
      const cached = fullEntryCache.get(id);
      if (cached) {
        rememberFullEntry(cached);
        return cached;
      }

      setLoadingFullEntryIds((current) => {
        const next = new Set(current);
        next.add(id);
        return next;
      });

      try {
        const entry = await getHistoryEntry(id);
        if (entry) {
          rememberFullEntry(entry);
        }
        return entry;
      } catch (error) {
        void logError(
          "HISTORY",
          `Failed to load history entry ${id}: ${error instanceof Error ? error.message : String(error)}`,
        );
        return null;
      } finally {
        setLoadingFullEntryIds((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      }
    },
    [fullEntryCache, rememberFullEntry],
  );

  useEffect(() => {
    expandedIdsRef.current = expandedIds;
  }, [expandedIds]);

  useEffect(() => {
    summaryEntryRef.current = summaryEntry;
  }, [summaryEntry]);

  useEffect(() => {
    activeAudioIdRef.current = activeAudioId;
  }, [activeAudioId]);

  useEffect(() => {
    if (fullEntryCache.size > 0) {
      void logInfo("HISTORY", `Full entry cache size=${fullEntryCache.size}`);
    }
  }, [fullEntryCache.size]);

  useEffect(() => {
    const syncHotkeyLabel = async (reload = false) => {
      const settings = await getSettings({ reload });
      setHotkeyLabel(formatHotkeyLabel(settings.hotkey || DEFAULT_HOTKEY));
      setSummaryAvailable(isSummaryAvailable(settings));
    };

    const loadHistoryIndex = async (): Promise<void> => {
      try {
        setHistory(await getHistoryIndex());
      } catch (error) {
        void logError(
          "HISTORY",
          `Failed to load history: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    };

    void loadHistoryIndex();
    void syncHotkeyLabel();

    const unlistenHistory = listen<HistoryEntry>(HISTORY_UPDATED_EVENT, ({ payload }) => {
      if (!payload?.id) {
        void loadHistoryIndex();
        return;
      }

      const listEntry = toHistoryListEntry(payload);
      setHistory((current) => {
        const existingIndex = current.findIndex((entry) => entry.id === listEntry.id);
        if (existingIndex === -1) {
          return [listEntry, ...current];
        }

        const next = [...current];
        next[existingIndex] = listEntry;
        return next;
      });

      const shouldKeepFullEntry =
        expandedIdsRef.current.has(payload.id) ||
        summaryEntryRef.current?.id === payload.id ||
        Boolean(activeAudioIdRef.current?.startsWith(`${payload.id}:`));
      if (shouldKeepFullEntry) {
        setFullEntryCache((current) => addFullEntryToCache(current, payload));
      }
      setSummaryEntry((current) => (current?.id === payload.id ? payload : current));
    });

    const unlistenDeleted = listen<{ id: string }>(HISTORY_DELETED_EVENT, ({ payload }) => {
      if (!payload?.id) {
        void loadHistoryIndex();
        return;
      }

      setHistory((current) => current.filter((entry) => entry.id !== payload.id));
      setFullEntryCache((current) => {
        if (!current.has(payload.id)) return current;
        const next = new Map(current);
        next.delete(payload.id);
        return next;
      });
      setActiveAudioId((current) => (current?.startsWith(`${payload.id}:`) ? null : current));
      setEditingSpeakerEntryId((current) => (current === payload.id ? null : current));
      setSummaryEntry((current) => (current?.id === payload.id ? null : current));
    });

    const unlistenCleared = listen(HISTORY_CLEARED_EVENT, () => {
      setHistory([]);
      setFullEntryCache(new Map());
      setActiveAudioId(null);
      setEditingSpeakerEntryId(null);
      setSummaryEntry(null);
    });

    const unlistenSettings = listen(SETTINGS_UPDATED_EVENT, () => {
      void syncHotkeyLabel(true);
    });

    // Cancel a retry that is running in this (Settings) window.
    const unlistenCancel = listen<ProcessingCancelRequestPayload>(
      PROCESSING_CANCEL_REQUEST_EVENT,
      ({ payload }) => {
        if (payload?.entryId) {
          void cancelProcessing(payload.entryId);
        }
      },
    );

    return () => {
      unlistenHistory.then((unlisten) => unlisten());
      unlistenDeleted.then((unlisten) => unlisten());
      unlistenCleared.then((unlisten) => unlisten());
      unlistenSettings.then((unlisten) => unlisten());
      unlistenCancel.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    if (heroPaused || MAIN_HERO_SLIDES.length <= 1) {
      return;
    }

    const timeout = window.setTimeout(
      () => {
        setHeroSlideIndex((current) => (current + 1) % MAIN_HERO_SLIDES.length);
        setHeroHasAdvanced(true);
      },
      heroHasAdvanced ? MAIN_HERO_SLIDE_DELAY_MS : MAIN_HERO_FIRST_SLIDE_DELAY_MS,
    );

    return () => window.clearTimeout(timeout);
  }, [heroHasAdvanced, heroPaused, heroSlideIndex]);

  useEffect(() => {
    if (!focusedEntryId) return;

    if (historyFilter !== "all") {
      setHistoryFilter("all");
      return;
    }

    const focusedIndex = history.findIndex((entry) => entry.id === focusedEntryId);
    if (focusedIndex >= visibleHistoryLimit) {
      setVisibleHistoryLimit(focusedIndex + 1);
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      focusedRowRefs.current.get(focusedEntryId)?.scrollIntoView({
        block: "center",
        behavior: "smooth",
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [focusedEntryId, focusedEntryNonce, history, historyFilter, visibleHistoryLimit]);

  useEffect(() => {
    setVisibleHistoryLimit(HISTORY_INITIAL_RENDER_LIMIT);
  }, [historyFilter]);

  const deleteEntry = async (id: string) => {
    await deleteHistoryEntry(id);
    setHistory((h) => h.filter((x) => x.id !== id));
    setFullEntryCache((current) => {
      if (!current.has(id)) return current;
      const next = new Map(current);
      next.delete(id);
      return next;
    });
    setActiveAudioId((current) => (current?.startsWith(`${id}:`) ? null : current));
    setEditingSpeakerEntryId((current) => (current === id ? null : current));
    setSummaryEntry((current) => (current?.id === id ? null : current));
    await emit(HISTORY_DELETED_EVENT, { id });
  };

  const clearAllHistory = async () => {
    if (!isClearArmed) {
      setIsClearArmed(true);
      setTimeout(() => {
        setIsClearArmed((current) => (current ? false : current));
      }, 2500);
      return;
    }

    await clearHistory();
    setHistory([]);
    setFullEntryCache(new Map());
    setActiveAudioId(null);
    setSummaryEntry(null);
    setIsClearArmed(false);
    await emit(HISTORY_CLEARED_EVENT);
  };

  const copyText = async (id: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied((current) => (current === id ? null : current)), 1500);
  };

  const copyEntryText = async (id: string): Promise<void> => {
    const entry = await loadFullEntry(id);
    const text = entry ? cleanupHistoryText(entry, originalIds.has(id)) : "";
    if (!text) return;
    await copyText(id, text);
  };

  const contactSupport = async (): Promise<void> => {
    const subject = encodeURIComponent(t("settingsGeneralExtra.support.mailSubject"));
    const body = encodeURIComponent(t("settingsGeneralExtra.support.mailBody"));
    const mailto = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;

    try {
      await openUrl(mailto);
    } catch (error) {
      void logError(
        "MAIN",
        `Failed to open support mail: ${error instanceof Error ? error.message : String(error)}`,
      );
      try {
        await navigator.clipboard.writeText(SUPPORT_EMAIL);
      } catch (clipboardError) {
        void logError(
          "MAIN",
          `Failed to copy support mail: ${clipboardError instanceof Error ? clipboardError.message : String(clipboardError)}`,
        );
      }
    }
  };

  const editEntry = async (id: string): Promise<void> => {
    const entry = await loadFullEntry(id);
    if (!entry) return;

    if (!entry.segments?.length || !entry.speakers?.length) {
      toggleExpanded(entry.id);
      return;
    }

    setExpandedIds((current) => {
      const next = new Set(current);
      next.add(entry.id);
      return next;
    });
    setEditingSpeakerEntryId((current) => (current === entry.id ? null : entry.id));
  };

  const toggleExpanded = (id: string): void => {
    const shouldCloseEditing = expandedIds.has(id);
    const shouldOpen = !shouldCloseEditing;

    setExpandedIds((current) => {
      const next = new Set(current);

      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });

    if (shouldOpen) {
      void loadFullEntry(id);
    }

    if (shouldCloseEditing) {
      setEditingSpeakerEntryId((current) => (current === id ? null : current));
    }
  };

  const renameSpeaker = async (
    entry: HistoryEntry,
    speakerId: string,
    label: string,
  ): Promise<void> => {
    if (!entry.segments?.length || !entry.speakers?.length) return;

    const currentSpeaker = entry.speakers.find((speaker) => speaker.id === speakerId);
    const nextLabel = label.trim() || currentSpeaker?.label || "";
    const nextSpeakers = entry.speakers.map((speaker) =>
      speaker.id === speakerId ? { ...speaker, label: nextLabel } : speaker,
    );
    const nextSegments = entry.segments.map((segment) =>
      segment.speakerId === speakerId ? { ...segment, speakerLabel: nextLabel } : segment,
    );
    const nextText = formatSpeakerTranscript(nextSegments);
    const nextEntry: HistoryEntry = {
      ...entry,
      raw: nextText,
      cleaned: nextText,
      speakers: nextSpeakers,
      segments: nextSegments,
      mode: "speakers",
    };

    setHistory((current) =>
      current.map((item) => (item.id === entry.id ? toHistoryListEntry(nextEntry) : item)),
    );
    rememberFullEntry(nextEntry);
    setSummaryEntry((current) => (current?.id === nextEntry.id ? nextEntry : current));
    await updateHistoryEntry(nextEntry);
    await emit(HISTORY_UPDATED_EVENT, nextEntry);
  };

  const retryEntry = async (id: string) => {
    const entry = await loadFullEntry(id);
    if (!entry) return;

    const source = getHistorySource(entry);
    setRetryingId(entry.id);
    if (source === "voice" || source === "call") {
      await emit<WidgetRetryProcessingPayload>(WIDGET_RETRY_PROCESSING_EVENT, {
        active: true,
        source,
        entryId: entry.id,
      });
    }

    try {
      const settings = await getSettings();
      if (source === "call") {
        await retryCallCaptureHistoryEntry(entry, settings);
      } else if (source === "file") {
        await retryFileHistoryEntry(entry, settings);
      } else {
        await retryHistoryEntry(entry, settings, { shouldPaste: false });
      }
      setRetrySucceededId(entry.id);
      setTimeout(() => {
        setRetrySucceededId((current) => (current === entry.id ? null : current));
      }, 1800);
    } catch (error) {
      const message = error instanceof Error ? error.message : t("mainTab.retryFailed");

      setHistory((current) =>
        current.map((item) =>
          item.id === entry.id
            ? {
                ...item,
                status: "failed",
                errorMessage: message,
              }
            : item,
        ),
      );
      setFullEntryCache((current) => {
        const cached = current.get(entry.id);
        if (!cached) return current;
        return addFullEntryToCache(current, {
          ...cached,
          status: "failed",
          errorMessage: message,
        });
      });
    } finally {
      if (source === "voice" || source === "call") {
        await emit<WidgetRetryProcessingPayload>(WIDGET_RETRY_PROCESSING_EVENT, {
          active: false,
          source,
          entryId: entry.id,
        });
      }
      setRetryingId((current) => (current === entry.id ? null : current));
    }
  };

  const cancelEntry = async (id: string): Promise<void> => {
    // Flip the row instantly so the stop button changes on the first click — the
    // authoritative interrupted state is persisted by cancelProcessing.
    setHistory((current) =>
      current.map((item) =>
        item.id === id && item.status === "processing"
          ? {
              ...item,
              status: "interrupted",
              errorMessage: t("mainTab.processingStopped"),
            }
          : item,
      ),
    );
    setFullEntryCache((current) => {
      const cached = current.get(id);
      if (cached?.status !== "processing") return current;
      return addFullEntryToCache(current, {
        ...cached,
        status: "interrupted",
        errorMessage: t("mainTab.processingStopped"),
      });
    });

    // Broadcast a stop request: the widget cancels fresh recordings, this window
    // cancels in-window retries. Whichever process owns the job aborts it.
    await emit<ProcessingCancelRequestPayload>(PROCESSING_CANCEL_REQUEST_EVENT, {
      entryId: id,
    });
  };

  const filteredHistory = useMemo<HistoryListEntry[]>(() => {
    if (historyFilter === "all") {
      return history;
    }

    return history.filter((item) => getHistorySource(item) === historyFilter);
  }, [history, historyFilter]);

  const visibleHistory = useMemo<HistoryListEntry[]>(
    () => filteredHistory.slice(0, visibleHistoryLimit),
    [filteredHistory, visibleHistoryLimit],
  );

  const groupedHistory = useMemo<HistoryGroup[]>(() => {
    const groups: HistoryGroup[] = [];

    for (const item of visibleHistory) {
      const label = formatDayLabel(item.timestamp, t, lang);
      const existing = groups[groups.length - 1];

      if (!existing || existing.label !== label) {
        groups.push({
          id: `${new Date(item.timestamp).toISOString().slice(0, 10)}-${groups.length}`,
          label,
          items: [item],
        });
        continue;
      }

      existing.items.push(item);
    }

    return groups;
  }, [visibleHistory, t, lang]);

  const hiddenHistoryCount = filteredHistory.length - visibleHistory.length;

  const activeHeroSlide = MAIN_HERO_SLIDES[heroSlideIndex] ?? MAIN_HERO_SLIDES[0];
  const isSupportHeroSlide = activeHeroSlide.id === "support";

  const showAdjacentHeroSlide = (direction: 1 | -1): void => {
    setHeroSlideIndex(
      (current) => (current + direction + MAIN_HERO_SLIDES.length) % MAIN_HERO_SLIDES.length,
    );
    setHeroHasAdvanced(true);
  };

  const handleHeroAction = (): void => {
    if (isSupportHeroSlide) {
      void contactSupport();
      return;
    }

    setHintHelpOpen((value) => !value);
  };

  const handleHeroPointerDown = (event: ReactPointerEvent<HTMLElement>): void => {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    heroPointerStartX.current = event.clientX;
  };

  const handleHeroPointerUp = (event: ReactPointerEvent<HTMLElement>): void => {
    const startX = heroPointerStartX.current;
    heroPointerStartX.current = null;

    if (startX === null) {
      return;
    }

    const deltaX = event.clientX - startX;
    if (Math.abs(deltaX) < 48) {
      return;
    }

    showAdjacentHeroSlide(deltaX < 0 ? 1 : -1);
  };

  const handleHeroBlur = (event: ReactFocusEvent<HTMLElement>): void => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setHeroPaused(false);
    }
  };

  const heroHintFooter = (
    // biome-ignore lint/a11y/noStaticElementInteractions: the handlers only pause/resume the hero carousel on hover, focus and pointer drag.
    <div
      className="ui-hero"
      onMouseEnter={() => setHeroPaused(true)}
      onMouseLeave={() => setHeroPaused(false)}
      onFocus={() => setHeroPaused(true)}
      onBlur={handleHeroBlur}
      onPointerDown={handleHeroPointerDown}
      onPointerUp={handleHeroPointerUp}
      onPointerCancel={() => {
        heroPointerStartX.current = null;
      }}
    >
      <div key={activeHeroSlide.id} className="ui-hero__slide main-hero-slide">
        <div className="ui-hero__lead">
          <span className="ui-hero__title">{t(activeHeroSlide.titleKey)}</span>
          {!isSupportHeroSlide && (
            <button
              type="button"
              className="ui-icon-button"
              onClick={handleHeroAction}
              aria-expanded={hintHelpOpen}
              aria-label={t(activeHeroSlide.actionKey)}
              title={t(activeHeroSlide.actionKey)}
            >
              <IconHelpCircle size={16} stroke={2} />
            </button>
          )}
        </div>

        <div className="ui-hero__meta">
          {isSupportHeroSlide && (
            <button
              type="button"
              className="ui-link-button"
              onClick={handleHeroAction}
              aria-label={t(activeHeroSlide.actionKey)}
              title={t(activeHeroSlide.actionKey)}
            >
              {t(activeHeroSlide.actionKey)}
            </button>
          )}

          {!isSupportHeroSlide && (
            <span className="ui-hero__hotkey">
              <span>{t("mainTab.combination")}</span>
              <span>{hotkeyLabel}</span>
            </span>
          )}
        </div>
      </div>

      {!isSupportHeroSlide && hintHelpOpen && (
        <div className="ui-hero__hint">{t("mainTab.howToStartHint")}</div>
      )}
    </div>
  );

  return (
    <div className="ui-tab">
      <TranscriptionStatsPanel footer={heroHintFooter} />

      <section className="ui-history">
        <div className="ui-history__header">
          <div>
            <h2 className="ui-history__title">{t("mainTab.historyTitle")}</h2>
            <div className="ui-history__desc">
              {history.length > 0
                ? t("mainTab.historyDescFilled")
                : t("mainTab.historyDescEmpty", { hotkey: hotkeyLabel })}
            </div>
          </div>

          {history.length > 0 && (
            <Button
              variant={isClearArmed ? "destructive" : "default"}
              title={isClearArmed ? t("mainTab.clearAllConfirmTitle") : t("mainTab.clearAllTitle")}
              onClick={() => {
                void clearAllHistory();
              }}
            >
              <IconTrash size={12} stroke={2} />
              {isClearArmed ? t("mainTab.confirm") : t("mainTab.clear")}
            </Button>
          )}
        </div>

        {history.length > 0 && (
          <div className="ui-history__filters">
            <SegmentedControl
              value={historyFilter}
              ariaLabel={t("mainTab.historyTitle")}
              options={HISTORY_FILTER_OPTIONS.map((option) => ({
                value: option.id,
                label: t(option.labelKey),
              }))}
              onChange={setHistoryFilter}
            />
          </div>
        )}

        <div className="ui-history__body">
          {history.length === 0 ? (
            <div className="ui-empty-state">
              <div className="ui-empty-state__badge">
                <span className="headline-accent" style={{ fontSize: 24 }}>
                  ◎
                </span>
              </div>
              <div className="ui-empty-state__title">{t("mainTab.emptyTitle")}</div>
              <p className="ui-empty-state__hint">
                {t("mainTab.emptyHintBefore")} <b>{hotkeyLabel}</b> {t("mainTab.emptyHintAfter")}
              </p>
            </div>
          ) : filteredHistory.length === 0 ? (
            <div className="ui-empty-state ui-empty-state--compact">{t("mainTab.filterEmpty")}</div>
          ) : (
            <div className="ui-history__groups">
              {groupedHistory.map((group, groupIndex) => (
                <div
                  key={group.id}
                  className="ui-history__group"
                  style={
                    groupIndex > 0
                      ? {
                          contentVisibility: "auto",
                          containIntrinsicSize: "auto 220px",
                        }
                      : undefined
                  }
                >
                  <div className="ui-history__day">{group.label}</div>
                  <table className="b-table">
                    <thead>
                      <tr>
                        <th style={{ width: 108 }}>{t("mainTab.colTime")}</th>
                        <th style={{ paddingLeft: 8 }}>{t("mainTab.colText")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.items.map((item, index) => {
                        const source = getHistorySource(item);
                        const fullEntry = fullEntryCache.get(item.id);
                        const isExpanded = expandedIds.has(item.id);
                        const isLoadingFullEntry = loadingFullEntryIds.has(item.id);
                        const displayText =
                          isExpanded && fullEntry
                            ? cleanupHistoryText(fullEntry, originalIds.has(item.id))
                            : item.textPreview;
                        const displayTextLength =
                          isExpanded && fullEntry
                            ? cleanupHistoryText(fullEntry, originalIds.has(item.id)).length
                            : item.textLength;

                        return (
                          <tr
                            key={item.id}
                            ref={(element) => {
                              if (element) {
                                focusedRowRefs.current.set(item.id, element);
                              } else {
                                focusedRowRefs.current.delete(item.id);
                              }
                            }}
                            className={
                              focusedEntryId === item.id ? "b-table__row--focused" : undefined
                            }
                            style={{
                              borderBottom:
                                index < group.items.length - 1
                                  ? "1px solid var(--table-row-border)"
                                  : "none",
                            }}
                            onDoubleClick={() => {
                              void copyEntryText(item.id);
                            }}
                          >
                            <td className="ui-history__time-cell">
                              <div className="ui-history__time">
                                <span>
                                  {new Date(item.timestamp).toLocaleTimeString("ru-RU", {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                </span>
                                {item.processingTime != null && (
                                  <span className="ui-history__time-meta">
                                    {formatDurationMs(item.processingTime, lang)}
                                  </span>
                                )}
                                {historyFilter === "all" && (
                                  <span className="ui-history__source">
                                    {t(sourceLabelKey(source))}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="ui-history__text-cell">
                              <div className="ui-history__row">
                                <div className="ui-history__content">
                                  {item.status === "recording" || item.status === "processing" ? (
                                    <>
                                      {displayText ? (
                                        <ExpandableHistoryText
                                          text={displayText}
                                          textLength={displayTextLength}
                                          hasSpeakerTranscript={false}
                                          expanded={isExpanded}
                                          editing={false}
                                          loading={false}
                                          onSpeakerRename={() => {}}
                                          onToggle={() => toggleExpanded(item.id)}
                                        />
                                      ) : null}
                                      {item.errorMessage ? (
                                        <div className="ui-history__error-text">
                                          {item.errorMessage}
                                        </div>
                                      ) : null}
                                    </>
                                  ) : item.status === "failed" || item.status === "interrupted" ? (
                                    <>
                                      <div className="ui-status-pill">
                                        <IconAlertCircle size={13} stroke={2} />
                                        <span>
                                          {item.status === "interrupted"
                                            ? t("mainTab.statusInterrupted")
                                            : t("mainTab.statusFailed")}
                                        </span>
                                      </div>
                                      <div className="ui-history__error-text">
                                        {item.errorMessage || t("mainTab.audioSavedLocally")}
                                      </div>
                                    </>
                                  ) : (
                                    <ExpandableHistoryText
                                      text={displayText}
                                      textLength={displayTextLength}
                                      hasSpeakerTranscript={item.mode === "speakers"}
                                      speakers={fullEntry?.speakers}
                                      segments={isExpanded ? fullEntry?.segments : undefined}
                                      expanded={isExpanded}
                                      editing={editingSpeakerEntryId === item.id}
                                      loading={isExpanded && isLoadingFullEntry && !fullEntry}
                                      onSpeakerRename={(speakerId, label) => {
                                        if (fullEntry) {
                                          return renameSpeaker(fullEntry, speakerId, label);
                                        }
                                      }}
                                      onToggle={() => toggleExpanded(item.id)}
                                    />
                                  )}
                                  {isExpanded &&
                                    fullEntry &&
                                    source === "voice" &&
                                    hasOriginalCleanupText(fullEntry) && (
                                      <SegmentedControl
                                        value={originalIds.has(item.id) ? "raw" : "cleaned"}
                                        options={[
                                          { value: "cleaned", label: t("cleanup.cleaned") },
                                          { value: "raw", label: t("cleanup.raw") },
                                        ]}
                                        ariaLabel={t("cleanup.title")}
                                        onChange={(value) =>
                                          setOriginalIds((current) => {
                                            const next = new Set(current);
                                            if (value === "raw") next.add(item.id);
                                            else next.delete(item.id);
                                            return next;
                                          })
                                        }
                                      />
                                    )}
                                  {item.hasAudio || item.hasCallTracks ? (
                                    <div className="ui-history__audio">
                                      {fullEntry ? (
                                        <HistoryAudioTrack
                                          entry={fullEntry}
                                          activeAudioId={activeAudioId}
                                          onActiveAudioChange={setActiveAudioId}
                                        />
                                      ) : (
                                        <HistoryAudioTrackPlaceholder
                                          loading={isLoadingFullEntry}
                                          onLoadRequested={() => {
                                            void loadFullEntry(item.id);
                                          }}
                                        />
                                      )}
                                    </div>
                                  ) : null}
                                </div>
                                <div className="ui-history__actions">
                                  {item.status === "recording" ? (
                                    <span aria-hidden="true" style={{ width: 24, height: 24 }} />
                                  ) : item.status === "processing" ? (
                                    <Button
                                      variant="destructive"
                                      title={t("mainTab.stopProcessing")}
                                      onClick={() => cancelEntry(item.id)}
                                    >
                                      <IconSquare size={11} stroke={2} fill="currentColor" />
                                    </Button>
                                  ) : (item.status === "failed" || item.status === "interrupted") &&
                                    ((source === "voice" && item.hasAudio) ||
                                      (source === "call" && item.hasCallTracks) ||
                                      (source === "file" && item.hasFilePath)) ? (
                                    <Button
                                      disabled={retryingId === item.id}
                                      title={t("mainTab.retryProcess")}
                                      onClick={() => {
                                        void retryEntry(item.id);
                                      }}
                                    >
                                      {retryingId === item.id ? (
                                        <Spinner size={12} label={t("mainTab.retryProcess")} />
                                      ) : (
                                        <IconRotate2 size={12} stroke={2} />
                                      )}
                                    </Button>
                                  ) : (
                                    <RowActionsMenu
                                      label={t("rowMenu.actions")}
                                      items={
                                        [
                                          (source === "file" || source === "call") && {
                                            key: "edit",
                                            label: t("rowMenu.edit"),
                                            icon: <IconPencil size={14} stroke={2} />,
                                            onSelect: () => {
                                              void editEntry(item.id);
                                            },
                                          },
                                          {
                                            key: "copy",
                                            label:
                                              copied === item.id || retrySucceededId === item.id
                                                ? t("mainTab.success")
                                                : t("rowMenu.copy"),
                                            icon:
                                              copied === item.id || retrySucceededId === item.id ? (
                                                <IconCheck size={14} stroke={2.5} />
                                              ) : (
                                                <IconCopy size={14} stroke={2} />
                                              ),
                                            onSelect: () => {
                                              void copyEntryText(item.id);
                                            },
                                          },
                                          {
                                            key: "summarize",
                                            label: t("rowMenu.summarize"),
                                            icon: <IconListCheck size={14} stroke={2} />,
                                            disabled: !summaryAvailable,
                                            hint: t("summary.unavailable.tooltip"),
                                            onSelect: () => {
                                              void loadFullEntry(item.id).then((entry) => {
                                                if (entry) {
                                                  setSummaryEntry(entry);
                                                }
                                              });
                                            },
                                          },
                                        ].filter(Boolean) as RowActionItem[]
                                      }
                                    />
                                  )}
                                  {item.status !== "processing" && item.status !== "recording" && (
                                    <Button
                                      variant="destructive"
                                      title={t("mainTab.delete")}
                                      onClick={() => deleteEntry(item.id)}
                                    >
                                      <IconTrash size={12} stroke={2} />
                                    </Button>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ))}
              {hiddenHistoryCount > 0 && (
                <Button
                  className="ui-history__more"
                  onClick={() =>
                    setVisibleHistoryLimit((current) =>
                      Math.min(current + HISTORY_RENDER_INCREMENT, filteredHistory.length),
                    )
                  }
                >
                  {t("mainTab.showMoreHistory", {
                    count: Math.min(HISTORY_RENDER_INCREMENT, hiddenHistoryCount),
                  })}
                </Button>
              )}
            </div>
          )}
        </div>
      </section>

      {summaryEntry && (
        <Suspense fallback={null}>
          <LazySummaryModal
            entry={summaryEntry}
            onClose={() => setSummaryEntry(null)}
            onEntryChange={(updated) => {
              setSummaryEntry(updated);
              rememberFullEntry(updated);
              setHistory((current) =>
                current.map((item) =>
                  item.id === updated.id ? toHistoryListEntry(updated) : item,
                ),
              );
              void emit(HISTORY_UPDATED_EVENT, updated);
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
