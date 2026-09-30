import { invoke } from "@tauri-apps/api/core";
import { type ReactElement, useEffect, useState } from "react";
import { useI18n } from "../../../lib/i18n";
import type { AppSettings } from "../../../lib/store";
import { FormRow } from "../../../ui/FormRow";
import { FormSection } from "../../../ui/FormSection";
import { PopUpButton } from "../../../ui/PopUpButton";
import { SegmentedControl } from "../../../ui/SegmentedControl";

interface IslandAvailability {
  hasNotchScreen: boolean;
}

export function RecordingIndicatorSection({
  presentation,
  fallback,
  textDisplay,
  onPresentationChange,
  onFallbackChange,
  onTextDisplayChange,
}: {
  presentation: AppSettings["widgetPresentation"];
  fallback: AppSettings["islandFallback"];
  textDisplay: AppSettings["textDisplay"];
  onPresentationChange: (value: AppSettings["widgetPresentation"]) => void;
  onFallbackChange: (value: AppSettings["islandFallback"]) => void;
  onTextDisplayChange: (value: AppSettings["textDisplay"]) => void;
}): ReactElement {
  const { t } = useI18n();
  const [hasNotchScreen, setHasNotchScreen] = useState(true);

  useEffect(() => {
    let disposed = false;
    void invoke<IslandAvailability>("get_island_availability", { fallback })
      .then((availability) => {
        if (!disposed) setHasNotchScreen(availability.hasNotchScreen);
      })
      .catch(() => {
        if (!disposed) setHasNotchScreen(true);
      });
    return () => {
      disposed = true;
    };
  }, [fallback]);

  return (
    <FormSection title={t("settings.indicator.title")}>
      <FormRow
        label={t("settings.indicator.title")}
        control={
          <SegmentedControl
            ariaLabel={t("settings.indicator.title")}
            value={presentation}
            onChange={onPresentationChange}
            options={[
              { value: "pill", label: t("settings.indicator.pill") },
              { value: "island", label: t("settings.indicator.island") },
            ]}
          />
        }
      />
      <div style={{ display: "flex", gap: 12, padding: "0 0 8px" }}>
        <IndicatorPreview kind="pill" label={t("settings.indicator.pill")} />
        <IndicatorPreview kind="island" label={t("settings.indicator.island")} />
      </div>
      {!hasNotchScreen && (
        <div style={{ fontSize: "var(--fs-caption)", color: "var(--label-2)", paddingBottom: 8 }}>
          {t("settings.indicator.noNotch")}
        </div>
      )}
      <FormRow
        label={t("settings.indicator.text")}
        description={t("settings.indicator.textHint")}
        control={
          <SegmentedControl
            ariaLabel={t("settings.indicator.text")}
            value={textDisplay}
            onChange={onTextDisplayChange}
            options={[
              { value: "window", label: t("settings.indicator.textWindow") },
              { value: "ticker", label: t("settings.indicator.textTicker") },
            ]}
          />
        }
      />
      <FormRow
        label={t("settings.indicator.fallback")}
        control={
          <PopUpButton
            ariaLabel={t("settings.indicator.fallback")}
            value={fallback}
            onChange={(value) => onFallbackChange(value === "pill" ? "pill" : "island")}
            options={[
              { value: "island", label: t("settings.indicator.fallbackIsland") },
              { value: "pill", label: t("settings.indicator.fallbackPill") },
            ]}
          />
        }
      />
    </FormSection>
  );
}

function IndicatorPreview({
  kind,
  label,
}: {
  kind: "pill" | "island";
  label: string;
}): ReactElement {
  return (
    <svg width="88" height="36" viewBox="0 0 88 36" role="img" aria-label={label}>
      <title>{label}</title>
      {kind === "pill" ? (
        <rect x="18" y="10" width="52" height="16" rx="8" fill="currentColor" opacity="0.85" />
      ) : (
        <>
          <path d="M28 4h32v14H28z" fill="#000" />
          <path d="M28 4a6 6 0 0 0-6 6v2h6z" fill="#000" />
          <path d="M60 4a6 6 0 0 1 6 6v2h-6z" fill="#000" />
          <rect x="24" y="8" width="4" height="4" rx="2" fill="#ff3b30" />
          <rect x="58" y="7" width="2" height="8" rx="1" fill="#fff" />
          <rect x="62" y="9" width="2" height="6" rx="1" fill="#fff" />
          <rect x="66" y="6" width="2" height="9" rx="1" fill="#fff" />
        </>
      )}
    </svg>
  );
}
