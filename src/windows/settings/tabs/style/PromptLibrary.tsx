import { type ReactElement, useEffect, useRef, useState } from "react";

import { useI18n } from "../../../../lib/i18n";
import { IconMessage, IconPencil, IconPlus, IconTrash } from "../../../../lib/icons";
import {
  type AppSettings,
  deletePrompt,
  listPromptsByKind,
  upsertPrompt,
} from "../../../../lib/store";
import { generatePromptText, isSummaryAvailable } from "../../../../lib/summarize";
import { Button } from "../../../../ui/Button";
import { TextField } from "../../../../ui/TextField";
import { CollapsibleCardText, OptionCard, OptionList } from "../OptionCard";

interface PromptEditorState {
  id?: string;
  name: string;
  prompt: string;
  temperature?: number;
}

/**
 * Constructor for the summary prompt library: list built-in + user presets,
 * create / edit / duplicate / delete user prompts, and pick the default one.
 */
function PromptLibrary({
  settings,
  onReload,
  update,
}: {
  settings: AppSettings;
  onReload: () => Promise<unknown>;
  update: (patch: Partial<AppSettings>) => void;
}): ReactElement {
  const { t } = useI18n();
  const [editor, setEditor] = useState<PromptEditorState | null>(null);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const promptFieldRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow the prompt textarea to fit its content up to a cap, then scroll.
  const autoSizePromptField = (el: HTMLTextAreaElement | null): void => {
    if (!el) return;
    const MAX_HEIGHT = 440;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT ? "auto" : "hidden";
  };
  useEffect(() => {
    autoSizePromptField(promptFieldRef.current);
  }, [editor?.id, editor?.prompt]);

  const canGenerate = isSummaryAvailable(settings);
  const handleGenerate = async (): Promise<void> => {
    if (!editor || generating || (!editor.prompt.trim() && !editor.name.trim())) return;
    setGenerating(true);
    setError(null);
    try {
      // The title participates in forming the prompt (it states the goal).
      const generated = await generatePromptText(settings, {
        title: editor.name,
        draft: editor.prompt,
      });
      setEditor((cur) => (cur ? { ...cur, prompt: generated } : cur));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  };

  const summaryPrompts = listPromptsByKind(settings, "summary");
  const defaultId = settings.defaultSummaryPromptId;
  const selectedPreset = summaryPrompts.find((preset) => preset.id === defaultId);
  const selectedIsCustom = selectedPreset ? !selectedPreset.builtin : false;

  const startNew = () => {
    setError(null);
    setEditor({ name: "", prompt: "" });
  };
  const startEditSelected = () => {
    if (!selectedPreset) return;
    setError(null);
    setEditor({
      id: selectedPreset.id,
      name: selectedPreset.name,
      prompt: selectedPreset.prompt,
      temperature: selectedPreset.temperature,
    });
  };

  const handleSave = async () => {
    if (!editor) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await upsertPrompt({
        id: editor.id,
        name: editor.name,
        kind: "summary",
        prompt: editor.prompt,
        temperature: editor.temperature,
      });
      await onReload();
      update({ defaultSummaryPromptId: saved.id });
      setEditor(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSelected = async () => {
    if (!selectedPreset || selectedPreset.builtin) return;
    setBusyId(selectedPreset.id);
    setError(null);
    try {
      await deletePrompt(selectedPreset.id);
      await onReload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  if (editor) {
    const cannotGenerate = generating || (!editor.prompt.trim() && !editor.name.trim());
    return (
      <div className="ui-form-group ui-form-panel">
        <div className="ui-form-stack">
          <label className="ui-form-field__label" htmlFor="prompt-editor-name">
            {t("models.prompt.nameLabel")}
          </label>
          <TextField
            id="prompt-editor-name"
            value={editor.name}
            onChange={(e) => setEditor({ ...editor, name: e.target.value })}
            placeholder={t("models.prompt.namePlaceholder")}
            maxLength={80}
          />
        </div>
        <div className="ui-form-stack">
          <label className="ui-form-field__label" htmlFor="prompt-editor-text">
            {t("models.prompt.promptLabel")}
          </label>
          <textarea
            id="prompt-editor-text"
            ref={promptFieldRef}
            className="ui-textfield ui-textarea"
            value={editor.prompt}
            onChange={(e) => {
              setEditor({ ...editor, prompt: e.target.value });
              autoSizePromptField(e.target);
            }}
            placeholder={t("models.prompt.promptPlaceholder")}
            style={{ minHeight: 120, overflowY: "hidden" }}
          />
        </div>
        {error && <div className="ui-form-feedback ui-form-feedback--error">{error}</div>}
        <div className="ui-form-actions">
          {canGenerate ? (
            <Button
              className="ui-form-actions__leading"
              onClick={() => void handleGenerate()}
              disabled={cannotGenerate}
            >
              {generating ? t("models.prompt.improving") : t("models.prompt.improve")}
            </Button>
          ) : (
            <div className="ui-form-actions__leading ui-form-hint">
              {t("models.prompt.noModelHint")}
            </div>
          )}
          <Button
            onClick={() => {
              setEditor(null);
              setError(null);
            }}
            disabled={saving}
          >
            {t("models.common.cancel")}
          </Button>
          <Button variant="primary" onClick={() => void handleSave()} disabled={saving}>
            {saving ? t("models.prompt.saving") : t("models.prompt.save")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="ui-tab">
      <div className="ui-tab-hint">{t("models.prompt.libraryHint")}</div>

      <OptionList ariaLabel={t("models.styleTab.prompts")}>
        {summaryPrompts.map((preset) => {
          const active = preset.id === defaultId;

          return (
            <OptionCard
              key={preset.id}
              active={active}
              icon={<IconMessage size={16} />}
              title={preset.name}
              description={<CollapsibleCardText text={preset.prompt} />}
              onClick={() => update({ defaultSummaryPromptId: preset.id })}
            />
          );
        })}
      </OptionList>

      {error && <div className="ui-form-feedback ui-form-feedback--error">{error}</div>}

      <div className="ui-form-actions">
        {selectedIsCustom && (
          <>
            <Button onClick={startEditSelected}>
              <IconPencil size={14} />
              {t("models.common.edit")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleDeleteSelected()}
              disabled={busyId === selectedPreset?.id}
            >
              <IconTrash size={14} />
              {t("models.common.delete")}
            </Button>
          </>
        )}
        <Button onClick={startNew}>
          <IconPlus size={14} />
          {t("models.prompt.create")}
        </Button>
      </div>
    </div>
  );
}

export { PromptLibrary };
