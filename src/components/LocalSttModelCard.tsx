import type { ReactElement, ReactNode } from "react";

import {
  IconBroadcast,
  IconCheck,
  IconDownload,
  IconGauge,
  IconGlobe,
  IconTargetArrow,
} from "../lib/icons";
import { Badge } from "../ui/Badge";
import { ProgressBar } from "../ui/ProgressBar";
import { ModelCardDisclosureButton } from "./ModelCardDisclosureButton";

export interface LocalSttModelCardStats {
  storageLabel: string;
  storageTitle: string;
  languageLabel: string;
  languageTitle: string;
  speedLabel: string;
  speedTitle: string;
  accuracyLabel: string;
  accuracyTitle: string;
  streamingLabel?: string;
}

export interface LocalSttModelCardProgress {
  message: string;
  percent?: number;
  valueLabel?: string;
  downloadedLabel?: string;
  totalLabel?: string;
  totalTemplate?: string;
}

export interface LocalSttModelCardNotice {
  message: string;
  tone: "neutral" | "error";
}

export function LocalSttModelCard({
  name,
  description,
  recommendedLabel,
  statusLabel,
  statusColor,
  expanded,
  onToggle,
  disclosureLabel,
  stats,
  notice,
  progress,
  connectionLabel,
  connectionColor,
  showConnectionCheck,
  actions,
}: {
  name: string;
  description: string;
  recommendedLabel?: string;
  statusLabel: string;
  statusColor: string;
  expanded: boolean;
  onToggle: () => void;
  disclosureLabel: string;
  stats: LocalSttModelCardStats;
  notice?: LocalSttModelCardNotice;
  progress?: LocalSttModelCardProgress;
  connectionLabel?: string;
  connectionColor?: string;
  showConnectionCheck?: boolean;
  actions: ReactNode;
}): ReactElement {
  return (
    <div className="ui-model-card">
      <div className="ui-model-card__head">
        <div className="ui-model-card__main">
          <div className="ui-model-card__titlebar">
            <div className="ui-model-card__title">
              <span>{name}</span>
              {recommendedLabel && <Badge>{recommendedLabel}</Badge>}
            </div>
            <Badge className="ui-model-card__state" style={{ color: statusColor }}>
              {statusLabel}
            </Badge>
          </div>
          <div className="ui-model-card__body">
            <div className="ui-model-card__desc">{description}</div>
            <ModelStats stats={stats} />
          </div>
          <ModelCardDisclosureButton
            expanded={expanded}
            onToggle={onToggle}
            label={disclosureLabel}
          />
        </div>
      </div>

      {expanded && (
        <div className="ui-model-card__detail">
          {notice && (
            <div
              role={notice.tone === "error" ? "alert" : undefined}
              className={[
                "ui-model-card__notice",
                notice.tone === "error" ? "ui-model-card__notice--error" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {notice.message}
            </div>
          )}

          {progress && <ModelProgress progress={progress} />}

          <div className="ui-model-card__actions">
            {connectionLabel && (
              <div
                className="ui-model-card__actions-leading ui-model-card__status-note"
                style={{ color: connectionColor || "var(--label-2)" }}
              >
                {showConnectionCheck && <IconCheck size={14} stroke={2.5} />}
                {connectionLabel}
              </div>
            )}
            {actions}
          </div>
        </div>
      )}
    </div>
  );
}

function ModelStats({ stats }: { stats: LocalSttModelCardStats }): ReactElement {
  const items = [
    {
      key: "storage",
      title: stats.storageTitle,
      value: stats.storageLabel,
      Icon: IconDownload,
    },
    {
      key: "language",
      title: stats.languageTitle,
      value: stats.languageLabel,
      Icon: IconGlobe,
    },
    {
      key: "speed",
      title: stats.speedTitle,
      value: stats.speedLabel,
      Icon: IconGauge,
    },
    {
      key: "accuracy",
      title: stats.accuracyTitle,
      value: stats.accuracyLabel,
      Icon: IconTargetArrow,
    },
  ];

  return (
    <div className="ui-model-stats">
      {items.map(({ key, title, value, Icon }) => (
        <div key={key} role="img" title={title} aria-label={title} className="ui-model-stat">
          <Icon size={14} stroke={1.9} />
          <span>{value}</span>
        </div>
      ))}
      {stats.streamingLabel && (
        <div
          role="img"
          title={stats.streamingLabel}
          aria-label={stats.streamingLabel}
          className="ui-model-stat"
        >
          <IconBroadcast size={14} stroke={1.9} />
          <span>{stats.streamingLabel}</span>
        </div>
      )}
    </div>
  );
}

function ModelProgress({ progress }: { progress: LocalSttModelCardProgress }): ReactElement {
  return (
    <div role="status" className="ui-model-progress">
      <div className="ui-model-progress__head">
        <span>{progress.message}</span>
        <span className="ui-model-progress__value">
          {progress.percent !== undefined
            ? `${progress.percent}%`
            : progress.valueLabel || progress.downloadedLabel}
        </span>
      </div>
      <ProgressBar value={(progress.percent ?? 2) / 100} />
      {(progress.downloadedLabel || progress.totalLabel) && (
        <div className="ui-model-progress__meta">
          {progress.downloadedLabel}
          {progress.totalLabel ? ` ${progress.totalTemplate || progress.totalLabel}` : ""}
        </div>
      )}
    </div>
  );
}
