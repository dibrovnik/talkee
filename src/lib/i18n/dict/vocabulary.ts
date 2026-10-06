// Personal vocabulary settings section.
export const vocabulary = {
  "settingsApp.tab.vocabulary": { ru: "Словарь", en: "Vocabulary" },
  "vocabulary.page.title": { ru: "Словарь", en: "Vocabulary" },
  "vocabulary.page.desc": {
    ru: "Правильное написание ваших терминов и разрешённые замены. Работает без ИИ-очистки.",
    en: "Correct spelling of your terms and approved replacements. Works without AI cleanup.",
  },
  "vocabulary.view.terms": { ru: "Термины", en: "Terms" },
  "vocabulary.view.suggestions": { ru: "Предложения", en: "Suggestions" },
  "vocabulary.view.suggestionsCount": { ru: "Предложения · {count}", en: "Suggestions · {count}" },
  "vocabulary.view.analysis": { ru: "Анализ", en: "Analysis" },
  "vocabulary.view.aria": { ru: "Разделы словаря", en: "Vocabulary sections" },

  "vocabulary.apply.section": { ru: "Применение", en: "Application" },
  "vocabulary.apply.toggle": {
    ru: "Применять словарь к диктовке",
    en: "Apply vocabulary to dictation",
  },
  "vocabulary.apply.toggleDesc": {
    ru: "Утверждённые замены работают и при выключенной ИИ-очистке. Текущая запись заканчивается с прежними правилами.",
    en: "Approved replacements work even with AI cleanup off. The current recording finishes with its earlier rules.",
  },
  "vocabulary.apply.domain": { ru: "Предметная область", en: "Domain" },
  "vocabulary.apply.domainDesc": {
    ru: "Применяются общие термины и термины одной выбранной области.",
    en: "Global terms and terms of one selected domain apply.",
  },
  "vocabulary.apply.globalOnly": { ru: "Только общий словарь", en: "Global vocabulary only" },
  "vocabulary.apply.status.on": { ru: "Словарь включён", en: "Vocabulary on" },
  "vocabulary.apply.status.off": { ru: "Словарь выключен", en: "Vocabulary off" },
  "vocabulary.apply.pending": {
    ru: "Ожидают проверки: {count}",
    en: "Awaiting review: {count}",
  },

  "vocabulary.capability.label": { ru: "Распознавание", en: "Recognition" },
  "vocabulary.capability.desc": {
    ru: "Подсказки передаются только моделям, которые их действительно поддерживают.",
    en: "Hints go only to models that actually support them.",
  },
  "vocabulary.capability.replacementsOnly": {
    ru: "Только замены после распознавания",
    en: "Replacements after recognition only",
  },
  "vocabulary.capability.hints": {
    ru: "Подсказки распознавателю и замены",
    en: "Recognizer hints and replacements",
  },

  "vocabulary.empty.title": { ru: "Словарь пока пуст", en: "The vocabulary is empty" },
  "vocabulary.empty.desc": {
    ru: "Добавьте рабочие термины — например, PIM, Dev, Prod — и разрешите конкретные варианты замены. Без вашего подтверждения ничего не меняется.",
    en: "Add work terms such as PIM, Dev, Prod and approve specific replacements. Nothing changes without your confirmation.",
  },
  "vocabulary.action.add": { ru: "Добавить термин…", en: "Add term…" },
  "vocabulary.action.starter": { ru: "Начать с примеров…", en: "Start from examples…" },
  "vocabulary.action.import": { ru: "Импортировать…", en: "Import…" },
  "vocabulary.action.export": { ru: "Экспортировать…", en: "Export…" },
  "vocabulary.action.analyze": {
    ru: "Проанализировать историю…",
    en: "Analyze history…",
  },
  "vocabulary.action.edit": { ru: "Изменить", en: "Edit" },
  "vocabulary.action.delete": { ru: "Удалить", en: "Delete" },
  "vocabulary.action.cancel": { ru: "Отмена", en: "Cancel" },
  "vocabulary.action.save": { ru: "Сохранить", en: "Save" },
  "vocabulary.action.refresh": { ru: "Обновить данные", en: "Reload data" },
  "vocabulary.action.retryOnFresh": {
    ru: "Сохранить поверх новой версии",
    en: "Save over the new version",
  },

  "vocabulary.list.section": { ru: "Термины", en: "Terms" },
  "vocabulary.list.search": { ru: "Поиск по словарю", en: "Search vocabulary" },
  "vocabulary.list.allCategories": { ru: "Все категории", en: "All categories" },
  "vocabulary.list.noMatches": { ru: "Ничего не найдено", en: "Nothing found" },
  "vocabulary.list.rules": { ru: "Замен: {count}", en: "Replacements: {count}" },
  "vocabulary.list.noRules": { ru: "Без замен", en: "No replacements" },
  "vocabulary.list.disabled": { ru: "Отключён", en: "Disabled" },
  "vocabulary.list.hint": { ru: "Подсказка", en: "Hint" },
  "vocabulary.scope.global": { ru: "Общий", en: "Global" },
  "vocabulary.scope.domain": { ru: "Область: {domain}", en: "Domain: {domain}" },
  "vocabulary.delete.confirm": {
    ru: "Удалить «{term}» и его правила ({count})? Уже вставленный текст и история не изменятся.",
    en: "Delete “{term}” and its rules ({count})? Pasted text and history stay unchanged.",
  },

  "vocabulary.category.acronym": { ru: "Аббревиатура", en: "Acronym" },
  "vocabulary.category.service": { ru: "Сервис", en: "Service" },
  "vocabulary.category.environment": { ru: "Окружение", en: "Environment" },
  "vocabulary.category.tool": { ru: "Инструмент", en: "Tool" },
  "vocabulary.category.product": { ru: "Продукт", en: "Product" },
  "vocabulary.category.person": { ru: "Человек", en: "Person" },
  "vocabulary.category.other": { ru: "Другое", en: "Other" },

  "vocabulary.editor.newTitle": { ru: "Новый термин", en: "New term" },
  "vocabulary.editor.editTitle": { ru: "Изменить термин", en: "Edit term" },
  "vocabulary.editor.canonical": { ru: "Правильное написание", en: "Correct spelling" },
  "vocabulary.editor.canonicalDesc": {
    ru: "Ровно так термин будет вставляться.",
    en: "The term is inserted exactly like this.",
  },
  "vocabulary.editor.language": { ru: "Язык", en: "Language" },
  "vocabulary.editor.anyLanguage": { ru: "Любой", en: "Any" },
  "vocabulary.editor.category": { ru: "Категория", en: "Category" },
  "vocabulary.editor.scope": { ru: "Где применять", en: "Where it applies" },
  "vocabulary.editor.scopeGlobal": { ru: "Общий словарь", en: "Global" },
  "vocabulary.editor.scopeDomain": { ru: "Область", en: "Domain" },
  "vocabulary.editor.domainName": { ru: "Название области", en: "Domain name" },
  "vocabulary.editor.enabled": { ru: "Термин включён", en: "Term enabled" },
  "vocabulary.editor.useAsHint": {
    ru: "Подсказывать распознавателю",
    en: "Hint to the recognizer",
  },
  "vocabulary.editor.useAsHintDesc": {
    ru: "Только для моделей, которые поддерживают подсказки.",
    en: "Only for models that support hints.",
  },
  "vocabulary.editor.variants": { ru: "Варианты замены", en: "Replacement variants" },
  "vocabulary.editor.variantsDesc": {
    ru: "Как распознаватель ошибается в этом слове. Каждый вариант разрешается отдельно; похожие слова сами не заменяются.",
    en: "How the recognizer misspells this term. Each variant is approved separately; look-alikes are never replaced automatically.",
  },
  "vocabulary.editor.variantSource": { ru: "Распознаётся как", en: "Recognized as" },
  "vocabulary.editor.variantContext": {
    ru: "Только рядом со словами (через запятую)",
    en: "Only near these words (comma-separated)",
  },
  "vocabulary.editor.variantCase": { ru: "Учитывать регистр", en: "Match case" },
  "vocabulary.editor.variantApprove": {
    ru: "Разрешить замену «{source}» → «{target}»",
    en: "Allow replacing “{source}” → “{target}”",
  },
  "vocabulary.editor.variantNeedsApproval": {
    ru: "Изменённый вариант нужно разрешить заново",
    en: "A changed variant needs approval again",
  },
  "vocabulary.editor.variantRemove": { ru: "Убрать вариант", en: "Remove variant" },
  "vocabulary.editor.addVariant": { ru: "Добавить вариант", en: "Add variant" },
  "vocabulary.editor.required": {
    ru: "Укажите правильное написание",
    en: "Enter the correct spelling",
  },
  "vocabulary.editor.domainRequired": { ru: "Укажите название области", en: "Enter a domain name" },
  "vocabulary.editor.variantEmpty": {
    ru: "Заполните или уберите пустой вариант",
    en: "Fill in or remove the empty variant",
  },
  "vocabulary.editor.conflict": {
    ru: "Словарь изменился в другом окне. Ваш ввод сохранён — проверьте и подтвердите ещё раз.",
    en: "The vocabulary changed in another window. Your input is kept — review and confirm again.",
  },
  "vocabulary.editor.removedElsewhere": {
    ru: "Этот термин удалён в другом окне. Сохранение создаст его заново.",
    en: "This term was deleted in another window. Saving will create it again.",
  },

  "vocabulary.corrupt.title": { ru: "Словарь не прочитан", en: "Vocabulary could not be read" },
  "vocabulary.corrupt.desc": {
    ru: "Данные сохранены без изменений, словарь временно не применяется. Обычная диктовка работает. Причина: {reason}",
    en: "The data is kept unchanged and the vocabulary is not applied. Ordinary dictation works. Reason: {reason}",
  },
  "vocabulary.loadError": {
    ru: "Не удалось загрузить словарь: {error}",
    en: "Failed to load the vocabulary: {error}",
  },
  "vocabulary.saveError": { ru: "Не сохранено: {error}", en: "Not saved: {error}" },
  "vocabulary.saved": { ru: "Сохранено", en: "Saved" },

  "vocabulary.suggestions.empty": {
    ru: "Предложений пока нет. Они появятся после «Запомнить исправление» или анализа истории.",
    en: "No suggestions yet. They appear after “Remember correction” or history analysis.",
  },
  "vocabulary.analysis.unavailable": {
    ru: "Анализ истории использует выбранную текстовую модель и запускается только по вашему действию.",
    en: "History analysis uses the selected text model and runs only when you start it.",
  },
} as const;
