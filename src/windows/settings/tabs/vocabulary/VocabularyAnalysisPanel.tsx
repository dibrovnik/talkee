import { emit, listen } from "@tauri-apps/api/event";
import { type ReactElement, useEffect, useState } from "react";
import type { AppSettings } from "../../../../lib/store";
import { resolveSummaryBackend } from "../../../../lib/summarize";
import {
  parseVocabularyError,
  type VocabularyClient,
  type VocabularyState,
} from "../../../../lib/vocabulary";
import { Button } from "../../../../ui/Button";
import { FormRow } from "../../../../ui/FormRow";
import { FormSection } from "../../../../ui/FormSection";
import { SelectMenu } from "../../../../ui/SelectMenu";
import { Toggle } from "../../../../ui/Toggle";
import {
  ANALYSIS_CANCEL_EVENT,
  ANALYSIS_PROGRESS_EVENT,
  ANALYSIS_REQUEST_EVENT,
  type AnalysisIdentity,
  type AnalysisProgress,
  analysisIdentity,
} from "../../../widget/services/vocabularyAnalysisCoordinator";

export function VocabularyAnalysisPanel({
  state,
  client,
  settings,
}: {
  state: VocabularyState;
  client: VocabularyClient;
  settings: AppSettings | null;
}): ReactElement {
  const [identity, setIdentity] = useState<AnalysisIdentity | null>(null);
  const [progress, setProgress] = useState<AnalysisProgress | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [confirmation, setConfirmation] = useState<"learning" | "full" | null>(null);
  useEffect(() => {
    let alive = true;
    if (settings)
      void analysisIdentity(settings)
        .then((next) => {
          if (alive) setIdentity(next);
        })
        .catch(() => {
          if (alive) setIdentity(null);
        });
    return () => {
      alive = false;
    };
  }, [settings]);
  useEffect(() => {
    const watching = listen<AnalysisProgress>(ANALYSIS_PROGRESS_EVENT, ({ payload }) => {
      setProgress(payload);
      if (payload.error) setError(payload.error);
    });
    return () => {
      void watching.then((stop) => stop());
    };
  }, []);
  const available = !!settings && !!resolveSummaryBackend(settings);
  const manualConsent =
    !identity?.remote || state.config.manualApiConsent?.fingerprint === identity.fingerprint;
  const periodicConsent =
    !identity?.remote || state.config.periodicApiConsent?.fingerprint === identity.fingerprint;
  const periodicAvailable =
    available && !!identity && (identity.remote || identity.managed) && periodicConsent;
  const active =
    progress?.status === "preparing" ||
    progress?.status === "running" ||
    state.lastJob?.status === "running";
  const mutate = async (action: () => Promise<unknown>): Promise<void> => {
    setPending(true);
    setError("");
    try {
      await action();
    } catch (failure) {
      setError(parseVocabularyError(failure).message);
    } finally {
      setPending(false);
    }
  };
  const consent = (periodic: boolean, granted: boolean): void => {
    if (!identity) return;
    void mutate(() =>
      client.setConsent(
        state.revision,
        periodic,
        granted
          ? {
              fingerprint: identity.fingerprint,
              endpointLabel: identity.endpointLabel,
              model: identity.model,
              grantedAt: Date.now(),
            }
          : null,
      ),
    );
  };
  const request = (mode: "full" | "new" | "resume"): void => {
    setError("");
    setProgress({ status: "preparing", requests: 0, processed: 0, remaining: 0 });
    void emit(ANALYSIS_REQUEST_EVENT, { mode }).catch(() =>
      setError("Не удалось запустить анализ"),
    );
  };
  const labels = {
    idle: "ожидание",
    preparing: "подготовка",
    running: "анализ",
    completed: "завершён",
    paused: "можно продолжить",
    cancelled: "отменён",
    failed: "ошибка",
    "needs-attention": "нужна проверка",
  };
  return (
    <div>
      <FormSection title="Анализ истории">
        <p>Предложения требуют вашей проверки. Обычная диктовка всегда имеет приоритет.</p>
        <FormRow
          label="Текстовая модель"
          control={
            <span>
              {available && identity
                ? identity.model + " · " + identity.endpointLabel
                : "Не выбрана. Ручной словарь доступен."}
            </span>
          }
        />
        {identity?.remote && available && (
          <>
            <p className="ui-callout">
              Выбранному API будут переданы исходные расшифровки и текст до словаря из завершённой
              обычной диктовки. Провайдер может взимать плату. До 20 запросов за ручной проход, до 3
              за периодический.
            </p>
            <FormRow
              label="Разрешить ручной анализ через этот API"
              description={identity.endpointLabel + " · " + identity.model}
              control={
                <Toggle
                  checked={manualConsent}
                  disabled={pending}
                  onChange={(value) => consent(false, value)}
                />
              }
            />
            <FormRow
              label="Разрешить периодический анализ через этот API"
              description="Отдельное разрешение. Смена endpoint или модели требует нового согласия."
              control={
                <Toggle
                  checked={periodicConsent}
                  disabled={pending}
                  onChange={(value) => consent(true, value)}
                />
              }
            />
          </>
        )}
        {available && identity && !identity.remote && !identity.managed && (
          <p className="ui-callout">
            Адресная отмена этого локального сервера не подтверждена. Доступен только ручной анализ;
            после остановки сервер может продолжать вычисление.
          </p>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button
            disabled={!available || !manualConsent || active || pending}
            onClick={() => request("full")}
          >
            Вся история
          </Button>
          <Button
            disabled={!available || !manualConsent || active || pending}
            onClick={() => request("new")}
          >
            Новые записи
          </Button>
          <Button
            disabled={!available || !manualConsent || active || pending}
            onClick={() => request("resume")}
          >
            Продолжить
          </Button>
          {active && <Button onClick={() => void emit(ANALYSIS_CANCEL_EVENT)}>Остановить</Button>}
        </div>
        <FormRow
          label="Периодический анализ"
          description="При 10 новых записях или оставшемся пакете, после 30 секунд простоя."
          control={
            <SelectMenu
              value={state.config.analysisSchedule}
              disabled={pending || (!periodicAvailable && state.config.analysisSchedule === "off")}
              options={[
                { value: "off", label: "Выключен" },
                ...(periodicAvailable
                  ? [
                      { value: "daily", label: "Раз в сутки" },
                      { value: "weekly", label: "Раз в неделю" },
                    ]
                  : []),
              ]}
              onChange={(value) =>
                void mutate(() =>
                  client.updateConfig(state.revision, {
                    analysisSchedule: value as "off" | "daily" | "weekly",
                  }),
                )
              }
            />
          }
        />
        <p aria-live="polite">
          {progress
            ? "Состояние: " +
              labels[progress.status] +
              " · запросов: " +
              progress.requests +
              " · обработано: " +
              progress.processed +
              " · осталось пакетов: " +
              progress.remaining
            : state.lastJob
              ? "Последний проход: " +
                state.lastJob.requests +
                " запросов, осталось пакетов: " +
                state.lastJob.remainingSources
              : "Анализ ещё не запускался"}
        </p>
        {error && (
          <p role="alert" className="ui-form-feedback ui-form-feedback--error">
            {error}
          </p>
        )}
      </FormSection>
      <FormSection title="Данные обучения">
        <p>
          Очистка удалит примеры, предложения, отклонения и прогресс. Утверждённый словарь
          останется. Старую историю можно выбрать через «Вся история».
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <Button disabled={pending} onClick={() => setConfirmation("learning")}>
            Очистить обучение…
          </Button>
          <Button disabled={pending} onClick={() => setConfirmation("full")}>
            Сбросить весь словарь…
          </Button>
        </div>
        {confirmation && (
          <div className="ui-callout" role="alert">
            <p>
              {confirmation === "full"
                ? "Удалить все термины, замены, примеры и согласия? Применение и расписание выключатся. История и статистика сохранятся."
                : "Удалить данные обучения? Утверждённые термины и замены сохранятся."}
            </p>
            <Button
              disabled={pending}
              onClick={() =>
                void mutate(async () => {
                  await client.clearLearning(state.revision, confirmation === "full");
                  setConfirmation(null);
                })
              }
            >
              Подтвердить удаление
            </Button>
            <Button disabled={pending} onClick={() => setConfirmation(null)}>
              Отмена
            </Button>
          </div>
        )}
      </FormSection>
    </div>
  );
}
