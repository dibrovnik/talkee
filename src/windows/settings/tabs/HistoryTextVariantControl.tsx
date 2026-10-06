import type { ReactElement } from "react";
import {
  type HistoryTextVariant,
  historyChangeSummary,
  historyTextVariants,
} from "../../../lib/cleanupHistory";
import { type MsgKey, useI18n } from "../../../lib/i18n";
import type { HistoryEntry } from "../../../lib/store";
import { SegmentedControl } from "../../../ui/SegmentedControl";

const VARIANT_LABELS: Record<HistoryTextVariant, MsgKey> = {
  cleaned: "cleanup.cleaned",
  preVocabulary: "cleanup.preVocabulary",
  raw: "cleanup.raw",
};

export interface HistoryTextVariantControlProps {
  entry: HistoryEntry;
  value: HistoryTextVariant;
  onChange: (value: HistoryTextVariant) => void;
}

/** Switches between result, text before the vocabulary and the real STT, and names who changed it. */
export function HistoryTextVariantControl({
  entry,
  value,
  onChange,
}: HistoryTextVariantControlProps): ReactElement {
  const { t } = useI18n();
  const variants = historyTextVariants(entry);
  const { cleanup, vocabularyReplacements } = historyChangeSummary(entry);
  const vocabulary = vocabularyReplacements > 0;
  const title = vocabulary ? t("cleanup.textProcessing") : t("cleanup.title");
  const caption = vocabulary
    ? t(cleanup ? "cleanup.changedByBoth" : "cleanup.changedByVocabulary", {
        count: vocabularyReplacements,
      })
    : cleanup
      ? t("cleanup.changedByCleanup")
      : null;

  return (
    <div className="ui-history__variant">
      <span className="ui-history__variant-label">{title}</span>
      <SegmentedControl
        value={variants.includes(value) ? value : "cleaned"}
        options={variants.map((variant) => ({
          value: variant,
          label:
            variant === "cleaned" && vocabulary ? t("cleanup.final") : t(VARIANT_LABELS[variant]),
        }))}
        ariaLabel={title}
        onChange={onChange}
      />
      {caption && <span className="ui-history__variant-label">{caption}</span>}
    </div>
  );
}
