import type { ReactElement, ReactNode } from "react";

import { useI18n } from "../../lib/i18n";

const ONBOARDING_STEP_COUNT = 3;

export function OnboardingProgress({ currentStep }: { currentStep: number }): ReactElement {
  const { t } = useI18n();
  const currentValue = Math.min(currentStep + 1, ONBOARDING_STEP_COUNT);

  return (
    <div
      role="progressbar"
      aria-label={t("onboarding.progressLabel")}
      aria-valuemin={1}
      aria-valuemax={ONBOARDING_STEP_COUNT}
      aria-valuenow={currentValue}
      className="ui-onboarding__progress"
    >
      <span
        aria-hidden="true"
        className="ui-onboarding__progress-bar"
        style={{ width: `${(currentValue / ONBOARDING_STEP_COUNT) * 100}%` }}
      ></span>
    </div>
  );
}

export function OnboardingShell({
  currentStep,
  title,
  subtitle,
  showProgress = true,
  children,
  footer,
}: {
  currentStep: number;
  title?: string;
  subtitle?: string;
  showProgress?: boolean;
  children: ReactNode;
  footer: ReactNode;
}): ReactElement {
  const titleId = `onboarding-step-${currentStep}-title`;

  return (
    <div className="ui-onboarding">
      <div data-tauri-drag-region className="ui-onboarding__drag" />
      <main aria-labelledby={title ? titleId : undefined} className="ui-onboarding__main">
        <div className="ui-onboarding__panel">
          {(title || subtitle) && (
            <header className="ui-onboarding__header">
              {title && (
                <h1 id={titleId} className="ui-onboarding__title">
                  {title}
                </h1>
              )}
              {subtitle && <p className="ui-onboarding__subtitle">{subtitle}</p>}
            </header>
          )}
          {children}
          <footer className="ui-onboarding__footer">{footer}</footer>
          {showProgress && <OnboardingProgress currentStep={currentStep} />}
        </div>
      </main>
    </div>
  );
}
