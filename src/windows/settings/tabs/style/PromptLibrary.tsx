import { type CSSProperties, useEffect, useRef, useState } from "react";

import { useI18n } from "../../../../lib/i18n";
import { IconMessage, IconPencil, IconPlus, IconTrash } from "../../../../lib/icons";
import {
  type AppSettings,
  deletePrompt,
  listPromptsByKind,
  upsertPrompt,
} from "../../../../lib/store";
import { generatePromptText, isSummaryAvailable } from "../../../../lib/summarize";
import { CollapsibleCardText, OptionCard } from "../OptionCard";

interface PromptEditorState {
  id?: string;
  name: string;
  prompt: string;
  temperature?: number;
}

const PROMPT_FIELD_STYLE: CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--control-bg)",
  color: "var(--text-hi)",
  fontSize: 13,
  fontFamily: "var(--font-main)",
  lineHeight: 1.6,
  boxSizing: "border-box",
};

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
}) {
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
    return (
      <div className="card" style={{ padding: 16, display: "grid", gap: 12 }}>
        <div style={{ display: "grid", gap: 6 }}>
          <div className="label">{t("models.prompt.nameLabel")}</div>
          <input
            value={editor.name}
            onChange={(e) => setEditor({ ...editor, name: e.target.value })}
            placeholder={t("models.prompt.namePlaceholder")}
            maxLength={80}
            style={PROMPT_FIELD_STYLE}
          />
        </div>
        <div style={{ display: "grid", gap: 6 }}>
          <div className="label">{t("models.prompt.promptLabel")}</div>
          <textarea
            ref={promptFieldRef}
            value={editor.prompt}
            onChange={(e) => {
              setEditor({ ...editor, prompt: e.target.value });
              autoSizePromptField(e.target);
            }}
            placeholder={t("models.prompt.promptPlaceholder")}
            style={{
              ...PROMPT_FIELD_STYLE,
              resize: "none",
              minHeight: 120,
              overflowY: "hidden",
            }}
          />
        </div>
        {error && (
          <div style={{ fontSize: 12, color: "var(--danger)", lineHeight: 1.5 }}>{error}</div>
        )}
        <div
          style={{
            display: "flex",
            gap: 8,
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          {canGenerate ? (
            <button
              type="button"
              onClick={() => void handleGenerate()}
              disabled={generating || (!editor.prompt.trim() && !editor.name.trim())}
              style={{
                padding: "9px 16px",
                borderRadius: 10,
                border: "1px solid var(--border)",
                background: "transparent",
                color: "var(--text-hi)",
                fontSize: 13,
                fontWeight: 600,
                cursor:
                  generating || (!editor.prompt.trim() && !editor.name.trim())
                    ? "default"
                    : "pointer",
                opacity: generating || (!editor.prompt.trim() && !editor.name.trim()) ? 0.6 : 1,
                fontFamily: "var(--font-main)",
              }}
            >
              {generating ? t("models.prompt.improving") : t("models.prompt.improve")}
            </button>
          ) : (
            <div
              style={{
                fontSize: 12,
                color: "var(--text-mid)",
                lineHeight: 1.45,
                maxWidth: 360,
              }}
            >
              {t("models.prompt.noModelHint")}
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => {
                setEditor(null);
                setError(null);
              }}
              disabled={saving}
              style={{
                padding: "9px 16px",
                borderRadius: 10,
                border: "1px solid var(--border)",
                background: "transparent",
                color: "var(--text-mid)",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "var(--font-main)",
              }}
            >
              {t("models.common.cancel")}
            </button>
            <button
              onClick={() => void handleSave()}
              disabled={saving}
              style={{
                padding: "9px 18px",
                borderRadius: 10,
                border: "none",
                background: "var(--accent)",
                color: "var(--accent-contrast)",
                fontSize: 13,
                fontWeight: 700,
                cursor: saving ? "default" : "pointer",
                opacity: saving ? 0.6 : 1,
                fontFamily: "var(--font-main)",
              }}
            >
              {saving ? t("models.prompt.saving") : t("models.prompt.save")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 13, color: "var(--text-mid)", lineHeight: 1.6 }}>
        {t("models.prompt.libraryHint")}
      </div>

      {summaryPrompts.map((preset) => {
        const active = preset.id === defaultId;

        return (
          <OptionCard
            key={preset.id}
            active={active}
            icon={<IconMessage size={20} stroke={active ? 2.4 : 1.8} />}
            title={preset.name}
            description={<CollapsibleCardText text={preset.prompt} />}
            onClick={() => update({ defaultSummaryPromptId: preset.id })}
          />
        );
      })}

      {error && (
        <div style={{ fontSize: 12, color: "var(--danger)", lineHeight: 1.5 }}>{error}</div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          onClick={startNew}
          style={{
            flex: 1,
            minWidth: 160,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 7,
            padding: "11px 0",
            borderRadius: 10,
            border: "1px dashed var(--border-strong)",
            background: "transparent",
            color: "var(--text-hi)",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "var(--font-main)",
          }}
        >
          <IconPlus size={16} stroke={2} />
          {t("models.prompt.create")}
        </button>

        {selectedIsCustom && (
          <>
            <button
              onClick={startEditSelected}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                padding: "11px 16px",
                borderRadius: 10,
                border: "1px solid var(--border)",
                background: "var(--control-bg)",
                color: "var(--text-hi)",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "var(--font-main)",
              }}
            >
              <IconPencil size={15} stroke={2} />
              {t("models.common.edit")}
            </button>
            <button
              onClick={() => void handleDeleteSelected()}
              disabled={busyId === selectedPreset?.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                padding: "11px 16px",
                borderRadius: 10,
                border: "1px solid var(--border)",
                background: "var(--control-bg)",
                color: "var(--danger)",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "var(--font-main)",
              }}
            >
              <IconTrash size={15} stroke={2} />
              {t("models.common.delete")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export { PromptLibrary };
