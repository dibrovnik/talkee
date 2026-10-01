import { listen } from "@tauri-apps/api/event";
import type { ReactElement } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { TypingSpeedTest } from "../../../components/TypingSpeedTest";
import { SETTINGS_UPDATED_EVENT } from "../../../lib/hotkeyEvents";
import { useI18n } from "../../../lib/i18n";
import { logError } from "../../../lib/logger";
import { getTranscriptionStats, STATS_UPDATED_EVENT } from "../../../lib/stats";
import {
  collectDailySeries,
  collectTotals,
  listStatsModels,
  normalizeStats,
  type StatSourceKey,
  type StatsDailyPoint,
  type StatsTotals,
  type TranscriptionStats,
} from "../../../lib/statsCore";
import { type AppSettings, getSettings } from "../../../lib/store";
import {
  computeTypingSavings,
  MAX_TYPING_WPM,
  MIN_TYPING_WPM,
  normalizeTypingWpm,
  type TypingSavings,
} from "../../../lib/typingSpeed";
import { formatDurationMs } from "../../../lib/utils";
import { Button } from "../../../ui/Button";
import { FormSection } from "../../../ui/FormSection";
import { SegmentedControl } from "../../../ui/SegmentedControl";
import { SelectMenu } from "../../../ui/SelectMenu";
import {
  chartMaximum,
  chartSlotWidth,
  STATS_PERIOD_DAYS,
  STATS_SOURCE_KEYS,
  type StatsPeriodValue,
  sourceLabelKey,
  statModelLabel,
} from "./statsTabView";

/** Height of the chart plot area; bar widths are derived from the sample count. */
const CHART_HEIGHT = 120;
const CHART_GAP = 2;

interface StatsTabState {
  stats: TranscriptionStats;
  loaded: boolean;
}

function formatSeconds(seconds: number): string {
  return formatDurationMs(Math.round(Math.max(0, seconds) * 1000), "ru");
}

/**
 * Renders a bar chart as plain SVG: no chart library, no third-party requests.
 * The same numbers are always available as text through the caller's summary.
 */
function SvgBarChart({
  points,
  primary,
  secondary,
  ariaLabel,
}: {
  points: StatsDailyPoint[];
  primary: (point: StatsDailyPoint) => number;
  secondary: (point: StatsDailyPoint) => number;
  ariaLabel: string;
}): ReactElement {
  const width = 100;
  const plotHeight = CHART_HEIGHT;
  const max = chartMaximum(points.flatMap((point) => [primary(point), secondary(point)]));
  const slot = chartSlotWidth(points.length, width);
  const barWidth = Math.max(0.5, slot - CHART_GAP);

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      viewBox={`0 0 ${width} ${plotHeight}`}
      preserveAspectRatio="none"
      style={{ width: "100%", height: CHART_HEIGHT, display: "block" }}
    >
      {max <= 0 ? (
        <line
          x1={0}
          y1={plotHeight - 1}
          x2={width}
          y2={plotHeight - 1}
          stroke="var(--separator)"
          strokeWidth={0.5}
        />
      ) : (
        points.map((point, index) => {
          const x = index * slot;
          const primaryValue = primary(point);
          const secondaryValue = secondary(point);
          const primaryHeight = (primaryValue / max) * (plotHeight - 2);
          const secondaryHeight = (secondaryValue / max) * (plotHeight - 2);
          return (
            <g key={point.day}>
              <rect
                x={x}
                y={plotHeight - primaryHeight}
                width={barWidth}
                height={primaryHeight}
                fill="var(--accent)"
              />
              <rect
                x={x + barWidth / 2}
                y={plotHeight - secondaryHeight}
                width={barWidth / 2}
                height={secondaryHeight}
                fill="var(--success)"
                opacity={0.7}
              />
            </g>
          );
        })
      )}
    </svg>
  );
}

function MetricTile({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="ui-metric" style={{ display: "grid", gap: 2 }}>
      <div className="ui-form-field__label">{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

function SavingsBlock({
  savings,
  onOpenTest,
}: {
  savings: TypingSavings;
  onOpenTest: () => void;
}): ReactElement {
  const { t } = useI18n();

  return (
    <div className="ui-form-stack" style={{ display: "grid", gap: 8 }}>
      {savings.status === "no-speed" ? (
        <div className="ui-inline-note">{t("statsTab.savings.noSpeed")}</div>
      ) : savings.status === "no-data" ? (
        <div className="ui-inline-note">{t("statsTab.savings.noData")}</div>
      ) : (
        <>
          <div style={{ fontSize: 20, fontWeight: 600 }}>
            {t("statsTab.savings.value", { time: formatSeconds(savings.savingsSec) })}
          </div>
          <div className="ui-form-field__label">
            {t("statsTab.savings.costNote", {
              audio: formatSeconds(savings.audioSec),
              processing: formatSeconds(savings.processingSec),
            })}
          </div>
        </>
      )}

      {savings.status === "incomplete" ? (
        <div className="ui-inline-note">
          {t("statsTab.savings.incomplete", { count: String(savings.incompleteCount) })}
        </div>
      ) : null}

      {savings.typingWpm !== undefined ? (
        <div className="ui-form-section__footer">
          {t("statsTab.savings.formula", { wpm: String(savings.typingWpm) })}
        </div>
      ) : null}
      <div className="ui-form-section__footer">{t("statsTab.savings.manualNote")}</div>

      <div className="ui-form-actions" style={{ display: "flex", gap: 8 }}>
        <Button onClick={onOpenTest}>{t("statsTab.typing.openTest")}</Button>
      </div>
    </div>
  );
}

export function StatsTab(): ReactElement {
  const { t } = useI18n();
  const [period, setPeriod] = useState<StatsPeriodValue>("30");
  const [source, setSource] = useState<StatSourceKey | "">("");
  const [model, setModel] = useState<string>("");
  const [state, setState] = useState<StatsTabState>({
    stats: normalizeStats(null),
    loaded: false,
  });
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [typingDraft, setTypingDraft] = useState("");
  const [typingError, setTypingError] = useState("");
  const [testOpen, setTestOpen] = useState(false);

  const reload = useCallback(async (): Promise<void> => {
    const [stats, loadedSettings] = await Promise.all([
      getTranscriptionStats().catch((error) => {
        void logError("STATS_TAB", `Failed to read stats: ${String(error)}`);
        return normalizeStats(null);
      }),
      getSettings({ reload: true }).catch(() => null),
    ]);
    setState({ stats, loaded: true });
    setSettings(loadedSettings);
  }, []);

  useEffect(() => {
    void reload();
    const unlistenStats = listen(STATS_UPDATED_EVENT, () => {
      void reload();
    });
    const unlistenSettings = listen(SETTINGS_UPDATED_EVENT, () => {
      void reload();
    });
    return () => {
      void unlistenStats.then((dispose) => dispose());
      void unlistenSettings.then((dispose) => dispose());
    };
  }, [reload]);

  const days = STATS_PERIOD_DAYS[period];
  const filter = useMemo(
    () => ({
      days,
      source: source === "" ? undefined : source,
      model: model === "" ? undefined : model,
    }),
    [days, source, model],
  );

  const totals: StatsTotals = useMemo(
    () => collectTotals(state.stats, filter),
    [state.stats, filter],
  );
  const series: StatsDailyPoint[] = useMemo(
    () => collectDailySeries(state.stats, filter),
    [state.stats, filter],
  );

  const modelOptions = useMemo(() => {
    const models = listStatsModels(state.stats);
    return [
      { value: "", label: t("statsTab.filter.allModels") },
      ...models.map((key) => ({ value: key, label: statModelLabel(key, t) })),
    ];
    // `t` changes with the language; the labels must follow it.
  }, [state.stats, t]);

  const sourceOptions = useMemo(
    () => [
      { value: "", label: t("statsTab.filter.allSources") },
      ...STATS_SOURCE_KEYS.map((key) => ({ value: key, label: t(sourceLabelKey(key)) })),
    ],
    [t],
  );

  const savings = useMemo(
    () => computeTypingSavings(state.stats, settings?.typingWpm),
    [state.stats, settings?.typingWpm],
  );

  const hasData = totals.completedCount > 0 || totals.words > 0;
  const filtered = source !== "" || model !== "";
  const wordsSummary = series
    .filter((point) => point.words > 0)
    .map((point) => `${point.day}: ${point.words}`)
    .join("; ");

  const saveTypingWpm = (): void => {
    const parsed = Number(typingDraft.replace(",", "."));
    const normalized = normalizeTypingWpm(parsed);
    if (normalized === undefined) {
      setTypingError(
        t("statsTab.typing.invalid", {
          min: String(MIN_TYPING_WPM),
          max: String(MAX_TYPING_WPM),
        }),
      );
      return;
    }
    setTypingError("");
    void (async () => {
      try {
        const { saveSettings } = await import("../../../lib/store");
        await saveSettings({ typingWpm: normalized });
        setSettings((current) => (current ? { ...current, typingWpm: normalized } : current));
        setTypingDraft("");
      } catch (error) {
        void logError("STATS_TAB", `Failed to save typing speed: ${String(error)}`);
        setTypingError(t("stats.typing.saveFailed"));
      }
    })();
  };

  return (
    <div className="ui-tab">
      <div className="ui-page-header">
        <h2 className="ui-page-header__title">{t("statsTab.page.title")}</h2>
        <div className="ui-page-header__desc">{t("statsTab.page.desc")}</div>
      </div>

      <FormSection title={t("statsTab.period.label")}>
        <div className="ui-form-stack" style={{ display: "grid", gap: 12 }}>
          <SegmentedControl<StatsPeriodValue>
            value={period}
            ariaLabel={t("statsTab.period.label")}
            options={[
              { value: "7", label: t("statsTab.period.7") },
              { value: "30", label: t("statsTab.period.30") },
              { value: "90", label: t("statsTab.period.90") },
              { value: "all", label: t("statsTab.period.all") },
            ]}
            onChange={setPeriod}
          />
          <div
            style={{
              display: "grid",
              gap: 12,
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            }}
          >
            {/* Radix renders a button, not a form control, so the visible text
                is a plain caption and the accessible name comes from ariaLabel. */}
            <div className="ui-form-stack" style={{ display: "grid", gap: 4 }}>
              <span className="ui-form-field__label">{t("statsTab.filter.source")}</span>
              <SelectMenu
                value={source}
                ariaLabel={t("statsTab.filter.source")}
                options={sourceOptions}
                onChange={(value) => setSource(value as StatSourceKey | "")}
              />
            </div>
            <div className="ui-form-stack" style={{ display: "grid", gap: 4 }}>
              <span className="ui-form-field__label">{t("statsTab.filter.model")}</span>
              <SelectMenu
                value={model}
                ariaLabel={t("statsTab.filter.model")}
                options={modelOptions}
                onChange={setModel}
              />
            </div>
          </div>
        </div>
      </FormSection>

      {!hasData ? (
        <div className="ui-empty-state">
          <div className="ui-empty-state__title">
            {filtered ? t("statsTab.filterEmpty") : t("statsTab.empty")}
          </div>
        </div>
      ) : (
        <>
          <FormSection title={t("statsTab.chart.words")}>
            <div style={{ display: "grid", gap: 12 }}>
              <div
                style={{
                  display: "grid",
                  gap: 16,
                  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                }}
              >
                <MetricTile label={t("statsTab.metric.words")} value={String(totals.words)} />
                <MetricTile
                  label={t("statsTab.metric.completed")}
                  value={String(totals.completedCount)}
                />
                <MetricTile
                  label={t("statsTab.metric.audio")}
                  value={formatSeconds(totals.audioSec)}
                />
                <MetricTile
                  label={t("statsTab.metric.processing")}
                  value={formatSeconds(totals.processingSec)}
                />
              </div>

              <SvgBarChart
                points={series}
                primary={(point) => point.words}
                secondary={() => 0}
                ariaLabel={t("statsTab.chart.words")}
              />

              {totals.missingAudioCount > 0 ? (
                <div className="ui-form-section__footer">
                  {t("statsTab.missing.audio", { count: String(totals.missingAudioCount) })}
                </div>
              ) : null}
              {totals.missingProcessingCount > 0 ? (
                <div className="ui-form-section__footer">
                  {t("statsTab.missing.processing", {
                    count: String(totals.missingProcessingCount),
                  })}
                </div>
              ) : null}

              <details className="ui-disclosure-panel">
                <summary className="ui-disclosure-panel__summary">
                  {t("statsTab.chart.summaryTitle")}
                </summary>
                <div className="ui-disclosure-panel__body">
                  <table className="b-table">
                    <caption className="ui-form-field__label">{t("statsTab.chart.words")}</caption>
                    <thead>
                      <tr>
                        <th>{t("statsTab.table.day")}</th>
                        <th>{t("statsTab.metric.words")}</th>
                        <th>{t("statsTab.metric.audio")}</th>
                        <th>{t("statsTab.metric.processing")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {series.map((point) => (
                        <tr key={point.day}>
                          <td>{point.day}</td>
                          <td>{point.words}</td>
                          <td>{formatSeconds(point.audioSec)}</td>
                          <td>{formatSeconds(point.processingSec)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </div>
          </FormSection>

          <FormSection title={t("statsTab.chart.time")}>
            <SvgBarChart
              points={series}
              primary={(point) => point.audioSec}
              secondary={(point) => point.processingSec}
              ariaLabel={`${t("statsTab.chart.time")}. ${
                wordsSummary ? `${t("statsTab.chart.words")}: ${wordsSummary}` : ""
              }`}
            />
          </FormSection>
        </>
      )}

      <FormSection title={t("statsTab.savings.title")} footer={t("statsTab.legacyNote")}>
        <SavingsBlock savings={savings} onOpenTest={() => setTestOpen(true)} />
      </FormSection>

      <FormSection title={t("statsTab.typing.manual")}>
        <div style={{ display: "grid", gap: 8 }}>
          <div className="ui-form-field__label">
            {savings.typingWpm === undefined
              ? t("statsTab.typing.notSet")
              : t("statsTab.typing.current", { wpm: String(savings.typingWpm) })}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input
              className="ui-textfield"
              inputMode="numeric"
              aria-label={t("statsTab.typing.manual")}
              placeholder={String(MIN_TYPING_WPM)}
              value={typingDraft}
              onChange={(event) => setTypingDraft(event.target.value)}
              style={{ width: 120 }}
            />
            <Button onClick={saveTypingWpm} disabled={typingDraft.trim() === ""}>
              {t("statsTab.typing.save")}
            </Button>
          </div>
          {typingError ? <div className="ui-inline-error">{typingError}</div> : null}
        </div>
      </FormSection>

      {testOpen ? (
        <TypingSpeedTest
          onClose={() => setTestOpen(false)}
          onSaved={(wpm) => {
            setTestOpen(false);
            setTypingDraft("");
            setSettings((current) => (current ? { ...current, typingWpm: wpm } : current));
          }}
        />
      ) : null}
    </div>
  );
}
