import { emit, listen } from "@tauri-apps/api/event";
import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import { SETTINGS_NAVIGATE_EVENT, SETTINGS_UPDATED_EVENT } from "../lib/hotkeyEvents";
import { useI18n } from "../lib/i18n";
import { logError } from "../lib/logger";
import { getTranscriptionStats, STATS_UPDATED_EVENT } from "../lib/stats";
import { getSettings } from "../lib/store";
import { transcriptionStatsView } from "./transcriptionStatsView";

type TranslateFn = ReturnType<typeof useI18n>["t"];

function compact(scaled: number, suffix: string): string {
  // One decimal below 100 (12,5к), whole numbers above (123к); comma decimal.
  const rounded = scaled >= 100 ? Math.round(scaled) : Math.round(scaled * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1).replace(".", ",");
  return `${text}${suffix}`;
}

/** Full number up to 10k, then abbreviated: 200000 → "200к", 1 200 000 → "1,2М". */
function formatStatValue(value: number, t: TranslateFn): string {
  if (value < 10_000) {
    return String(value);
  }
  if (value < 1_000_000) {
    return compact(value / 1000, t("stats.suffix.thousand"));
  }
  return compact(value / 1_000_000, t("stats.suffix.million"));
}

interface StatItem {
  key: string;
  label: string;
  value: string;
}

export function TranscriptionStatsPanel(): ReactElement {
  const { t, lang } = useI18n();
  const [view, setView] = useState<ReturnType<typeof transcriptionStatsView> | null>(null);

  useEffect(() => {
    let active = true;
    const reportError = (error: unknown): void => {
      void logError("STATS", `Failed to load home stats: ${String(error)}`);
    };
    const loadStats = async (): Promise<void> => {
      try {
        const [stats, settings] = await Promise.all([
          getTranscriptionStats(),
          getSettings({ reload: true }).catch((error) => {
            reportError(error);
            return null;
          }),
        ]);
        if (active) setView(transcriptionStatsView(stats, settings?.typingWpm));
      } catch (error) {
        reportError(error);
      }
    };
    void loadStats();
    const listeners = [STATS_UPDATED_EVENT, SETTINGS_UPDATED_EVENT].map((event) =>
      listen(event, () => void loadStats()),
    );
    window.addEventListener("focus", loadStats);
    return () => {
      active = false;
      window.removeEventListener("focus", loadStats);
      for (const listener of listeners)
        void listener.then((dispose) => dispose()).catch(reportError);
    };
  }, []);

  const number = new Intl.NumberFormat(lang, { maximumFractionDigits: 1 });
  const hasComparison = view?.savings.status === "ok" || view?.savings.status === "incomplete";
  const seconds = view?.savings.savingsSec ?? 0;
  const savedTime =
    seconds >= 3600
      ? `${number.format(seconds / 3600)} ${t("stats.home.hours")}`
      : seconds >= 60
        ? `${number.format(seconds / 60)} ${t("stats.home.minutes")}`
        : `${number.format(seconds)} ${t("stats.home.seconds")}`;
  const stats: StatItem[] = [
    {
      key: "today",
      label: t("stats.wordsToday"),
      value: view ? formatStatValue(view.todayWords, t) : "—",
    },
    {
      key: "month",
      label: t("stats.wordsThisMonth"),
      value: view ? formatStatValue(view.monthWords, t) : "—",
    },
    {
      key: "speed",
      label: t("stats.wordsPerMinute"),
      value: view?.hasSpeed ? formatStatValue(view.averageWpm, t) : "—",
    },
    { key: "saved", label: t("stats.home.timeSaved"), value: hasComparison ? savedTime : "—" },
    {
      key: "ratio",
      label: t("stats.home.speedRatio"),
      value: view?.speedRatio !== undefined ? `${number.format(view.speedRatio)}×` : "—",
    },
    {
      key: "days",
      label: t("stats.home.activeDays"),
      value: view ? `${view.activeDays} / 7` : "—",
    },
  ];
  const openStats = (): void => {
    void emit(SETTINGS_NAVIGATE_EVENT, { tab: "stats" }).catch((error) => {
      void logError("STATS", `Failed to open statistics: ${String(error)}`);
    });
  };

  return (
    <section className="ui-stats-panel" aria-label={t("stats.home.summary")}>
      <div className="ui-stats-panel__metrics">
        {stats.map(({ key, label, value }) => (
          <div key={key} className="ui-stats-metric">
            <span className="ui-stats-metric__value">{value}</span>
            <span className="ui-stats-metric__label">{label}</span>
          </div>
        ))}
      </div>
      <div className="ui-stats-panel__footer">
        <span style={{ flex: "1 1 240px" }}>
          {view?.savings.status === "no-speed"
            ? t("stats.home.noSpeed")
            : hasComparison
              ? t("stats.home.estimate", { wpm: view?.savings.typingWpm ?? 0 })
              : t("stats.home.noData")}
          {view?.savings.status === "incomplete" && (
            <> {t("stats.home.incomplete", { count: view.savings.incompleteCount })}</>
          )}
        </span>
        <button type="button" className="ui-link-button" onClick={openStats}>
          {view?.savings.status === "no-speed"
            ? t("stats.home.measureTyping")
            : t("stats.home.details")}
        </button>
      </div>
    </section>
  );
}
