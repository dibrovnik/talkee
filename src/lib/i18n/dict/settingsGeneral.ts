// Strings for the General settings tab (windows/settings/tabs/SettingsTab.tsx).
export const settingsGeneral = {
  "settings.section.system": { ru: "Системные", en: "System" },
  "settings.section.translator": { ru: "Переводчик", en: "Translator" },

  // Interface language selector (the new feature)
  "settings.uiLanguage.title": {
    ru: "Язык интерфейса",
    en: "Interface language",
  },
  "settings.uiLanguage.desc": {
    ru: "Язык меню, кнопок и подписей приложения.",
    en: "Language of the app's menus, buttons and labels.",
  },
  "settings.uiLanguage.ru": { ru: "Русский", en: "Russian" },
  "settings.uiLanguage.en": { ru: "Английский", en: "English" },

  // Theme
  "settings.theme.title": { ru: "Тема", en: "Theme" },
  "settings.theme.system": { ru: "Системная", en: "System" },
  "settings.theme.light": { ru: "Светлая", en: "Light" },
  "settings.theme.dark": { ru: "Темная", en: "Dark" },
  "settings.theme.desc": {
    ru: "Системная тема следует настройке macOS.",
    en: "The system theme follows your macOS setting.",
  },

  // Recognition (speech) language
  "settings.recognitionLang.title": {
    ru: "Язык распознавания",
    en: "Recognition language",
  },
  "settings.recognitionLang.desc": {
    ru: "Язык, на котором вы говорите.",
    en: "The language you speak.",
  },
  "settings.recognitionLang.searchPlaceholder": {
    ru: "Поиск языка...",
    en: "Search language...",
  },

  // Microphone
  "settings.mic.title": { ru: "Микрофон", en: "Microphone" },
  "settings.mic.desc": {
    ru: "Устройство для записи голоса.",
    en: "Device used to record your voice.",
  },
  "settings.mic.systemDefault": {
    ru: "Системный микрофон по умолчанию",
    en: "System default microphone",
  },

  // Hotkey
  "settings.hotkey.title": { ru: "Горячая клавиша", en: "Hotkey" },
  "settings.hotkey.desc": {
    ru: "Нажмите на поле справа и введите новую комбинацию. Если сочетание занято, оставим предыдущую клавишу.",
    en: "Click the field on the right and press a new combination. If it's taken, the previous one is kept.",
  },
  "settings.hotkey.change": { ru: "Изменить", en: "Change" },
  "settings.hotkey.recording": { ru: "Запись", en: "Recording" },
  "settings.hotkey.checking": { ru: "Проверка", en: "Checking" },
  "settings.hotkey.press": {
    ru: "Нажмите сочетание",
    en: "Press a combination",
  },
  "settings.hotkey.current": {
    ru: "Текущая: {hotkey}",
    en: "Current: {hotkey}",
  },

  "settings.indicator.title": { ru: "Индикатор записи", en: "Recording indicator" },
  "settings.indicator.pill": { ru: "Плавающая пилюля", en: "Floating pill" },
  "settings.indicator.island": { ru: "Остров у выреза", en: "Notch island" },
  "settings.indicator.fallback": {
    ru: "На экранах без выреза",
    en: "On screens without a notch",
  },
  "settings.indicator.fallbackIsland": {
    ru: "Показывать остров",
    en: "Show the island",
  },
  "settings.indicator.fallbackPill": {
    ru: "Использовать пилюлю",
    en: "Use the pill",
  },
  "settings.indicator.noNotch": {
    ru: "На этом Mac нет выреза — остров будет сверху экрана",
    en: "This Mac has no notch — the island sits at the top of the screen",
  },
  "settings.indicator.text": { ru: "Текст", en: "Text" },
  "settings.indicator.textWindow": { ru: "Окно", en: "Window" },
  "settings.indicator.textTicker": { ru: "Бегущая строка", en: "Ticker" },
  "settings.indicator.textHint": {
    ru: "Бегущая строка идёт внутри индикатора, без отдельного окна",
    en: "The ticker runs inside the indicator, without a separate window",
  },
  "settings.widgetSize.islandDisabled": {
    ru: "Доступно в режиме пилюли",
    en: "Available in pill mode",
  },

  // Widget size
  "settings.widgetSize.title": { ru: "Размер виджета", en: "Widget size" },
  "settings.widgetSize.desc": {
    ru: "Масштаб плавающего виджета.",
    en: "Scale of the floating widget.",
  },
  "settings.widgetSize.aria": { ru: "Размер виджета", en: "Widget size" },

  // Autostart
  "settings.autostart.title": {
    ru: "Автозапуск приложения",
    en: "App autostart",
  },
  "settings.autostart.on": { ru: "Включен", en: "On" },
  "settings.autostart.off": { ru: "Выключен", en: "Off" },
  "settings.autostart.desc": {
    ru: "Запускать Talkee автоматически при входе в систему.",
    en: "Launch Talkee automatically when you log in.",
  },

  // Dock
  "settings.dock.title": {
    ru: "Показывать значок в Dock",
    en: "Show icon in Dock",
  },
  "settings.dock.desc": {
    ru: "Когда выключено, Talkee работает только в строке меню.",
    en: "When off, Talkee runs from the menu bar only.",
  },

  // Models directory
  "settings.modelsDir.title": {
    ru: "Директория моделей",
    en: "Models directory",
  },
  "settings.modelsDir.desc": {
    ru: "Папка для скачанных локальных моделей. Оставьте поле пустым, чтобы использовать директорию по умолчанию.",
    en: "Folder for downloaded local models. Leave empty to use the default directory.",
  },
  "settings.modelsDir.placeholder": {
    ru: "Директория по умолчанию",
    en: "Default directory",
  },

  // App data directory
  "settings.appDataDir.title": {
    ru: "Каталог данных приложения",
    en: "App data directory",
  },
  "settings.appDataDir.desc": {
    ru: "Здесь хранятся модели, история, аудио записей и созвонов.",
    en: "Models, history, recording audio and call audio are stored here.",
  },

  // History storage
  "settings.storage.title": { ru: "Хранение истории", en: "History storage" },
  "settings.storage.desc": {
    ru: "Папка для истории диктовки и записей звонков. Оставьте пустым, чтобы использовать директорию по умолчанию.",
    en: "Folder for dictation history and call recordings. Leave empty to use the default directory.",
  },

  // Realtime transcription
  "settings.realtimeTranscription.title": {
    ru: "Транскрибация в реальном времени",
    en: "Realtime transcription",
  },
  "settings.realtimeTranscription.on": { ru: "Включена", en: "On" },
  "settings.realtimeTranscription.off": { ru: "Выключена", en: "Off" },
  "settings.realtimeTranscription.unavailable": {
    ru: "Недоступна",
    en: "Unavailable",
  },
  "settings.realtimeTranscription.desc": {
    ru: "Использовать streaming автоматически для всех моделей, которые его поддерживают.",
    en: "Automatically use streaming for every model that supports it.",
  },

  // Recording audio
  "settings.recordingAudio.title": {
    ru: "Сохранять аудио записей",
    en: "Save recording audio",
  },
  "settings.recordingAudio.on": { ru: "Включено", en: "On" },
  "settings.recordingAudio.off": { ru: "Выключено", en: "Off" },
  "settings.recordingAudio.desc": {
    ru: "Аудио диктовки хранится локально отдельными файлами только для последних 100 записей.",
    en: "Dictation audio is stored locally as separate files for the latest 100 recordings only.",
  },

  // Support
  "settings.support.title": {
    ru: "Есть вопрос или нашли баг?",
    en: "Question or found a bug?",
  },
  "settings.support.button": {
    ru: "Написать в поддержку",
    en: "Contact support",
  },
  "settings.support.desc": {
    ru: "Откроется почтовый клиент с письмом на {email}. Опишите проблему или вопрос – мы поможем.",
    en: "Your email client will open a message to {email}. Describe the problem or question – we'll help.",
  },
} as const;
