export const cleanup = {
  "cleanup.title": { ru: "ИИ-очистка текста", en: "AI text cleanup" },
  "cleanup.on": { ru: "ИИ-очистка включена · {style}", en: "AI cleanup enabled · {style}" },
  "cleanup.off": { ru: "ИИ-очистка выключена", en: "AI cleanup disabled" },
  "cleanup.noModel": { ru: "Нет модели для очистки", en: "No cleanup model configured" },
  "cleanup.chooseModel": { ru: "Выбрать модель", en: "Choose model" },
  "cleanup.failed": {
    ru: "Очистка не удалась — вставлен исходный текст",
    en: "Cleanup failed — original text inserted",
  },
  "cleanup.styles": { ru: "Стиль очистки", en: "Cleanup style" },
  "cleanup.hotkey": { ru: "Горячая клавиша", en: "Hotkey" },
  "cleanup.hint": {
    ru: "Включённая очистка пропускает текст через выбранный стиль. Основная клавиша учитывает переключатель, а клавиша ввода с очисткой всегда включает её для записи.",
    en: "Enabled cleanup runs the text through the selected style. The main hotkey follows this switch; the cleanup hotkey always enables it for the current recording.",
  },
  "cleanup.clear": { ru: "Отключить клавишу", en: "Disable hotkey" },
  "cleanup.indicator": { ru: "ИИ-очистка включена", en: "AI cleanup enabled" },
  "cleanup.cleaned": { ru: "Очищенный", en: "Cleaned" },
  "cleanup.raw": { ru: "Исходный", en: "Original" },
  "cleanup.localHint": {
    ru: "Для быстрой локальной очистки: Qwen3 1.7B или Qwen2.5 3B.",
    en: "For fast local cleanup: Qwen3 1.7B or Qwen2.5 3B.",
  },
} as const;
