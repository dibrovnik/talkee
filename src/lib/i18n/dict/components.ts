// i18n strings for src/components: PermissionScreen, TranscriptionStatsPanel.
export const components = {
  // ── PermissionScreen ──────────────────────────────────────
  // PermissionRow status badges (not granted yet)
  "permission.badge.check": { ru: "Проверьте", en: "Check" },
  "permission.badge.actionNeeded": {
    ru: "Нужно действие",
    en: "Action needed",
  },
  "permission.badge.notGranted": { ru: "Не выдано", en: "Not granted" },

  // PermissionRow action button
  "permission.action.check": { ru: "Проверить", en: "Check" },
  "permission.action.retry": { ru: "Повторить", en: "Retry" },
  "permission.action.allow": { ru: "Разрешить", en: "Allow" },

  // Microphone help text
  "permission.micHelp.macos": {
    ru: "Если микрофон был отклонен, откройте Системные настройки -> Конфиденциальность -> Микрофон и включите Talkee.",
    en: "If the microphone was denied, open System Settings -> Privacy -> Microphone and enable Talkee.",
  },

  // Paste / accessibility permission row
  "permission.paste.titleAccessibility": {
    ru: "Универсальный доступ",
    en: "Accessibility",
  },
  "permission.paste.descAccessibility": {
    ru: "Нужен для глобальной горячей клавиши и вставки текста.",
    en: "Required for the global hotkey and text insertion.",
  },
  "permission.paste.helpNotInApplications": {
    ru: "Приложение запущено не из Applications: {path}",
    en: "The app is not running from Applications: {path}",
  },

  // Header
  "permission.header.title": {
    ru: "Доступы для Talkee",
    en: "Permissions for Talkee",
  },
  "permission.header.subtitle": {
    ru: "Осталось выдать системные разрешения для записи голоса, звука созвона и работы горячей клавиши.",
    en: "Just grant the system permissions for recording your voice, call audio and the hotkey.",
  },

  // Install warning
  "permission.installWarning.title": {
    ru: "Переместите приложение в Applications",
    en: "Move the app to Applications",
  },
  "permission.installWarning.desc": {
    ru: "Текущая сборка запущена из временного места. Переместите Talkee в Applications и откройте оттуда.",
    en: "The current build is running from a temporary location. Move Talkee to Applications and open it from there.",
  },

  // Microphone permission row
  "permission.mic.title": { ru: "Микрофон", en: "Microphone" },
  "permission.mic.desc": {
    ru: "Нужен для записи голоса перед отправкой на распознавание.",
    en: "Needed to record your voice before sending it for recognition.",
  },

  // System audio permission row
  "permission.systemAudio.title": { ru: "Звук системы", en: "System audio" },
  "permission.systemAudio.desc": {
    ru: "Нужен, чтобы слушать звук созвона вместе с микрофоном.",
    en: "Needed to capture call audio together with the microphone.",
  },
  "permission.systemAudio.help": {
    ru: "Кнопка запускает короткую проверку захвата. Если доступа ещё нет, macOS предложит разрешить Talkee запись системного аудио.",
    en: "The button runs a short capture check. If access is missing, macOS will ask you to allow Talkee to record system audio.",
  },

  // Hint block
  "permission.hint.systemAudioDenied": {
    ru: "Если доступ был отклонен, откройте Системные настройки -> Конфиденциальность и безопасность -> Запись экрана и системного аудио и включите Talkee.",
    en: "If access was denied, open System Settings -> Privacy & security -> Screen & System Audio Recording and enable Talkee.",
  },
  "permission.hint.reopenAfterMove": {
    ru: "После перемещения приложения в Applications откройте его заново.",
    en: "After moving the app to Applications, open it again.",
  },
  "permission.hint.macosDelay": {
    ru: "macOS применяет доступ не мгновенно. После изменения настройки вернитесь в приложение.",
    en: "macOS does not apply access instantly. After changing the setting, return to the app.",
  },
  "permission.hint.restartAccessibility": {
    ru: "Talkee пока не видит выданный Универсальный доступ. Перезапустите приложение: после запуска проверка продолжится автоматически с этого шага.",
    en: "Talkee still cannot see the Accessibility permission. Restart the app; after launch, the check will automatically continue from this step.",
  },
  "permission.hint.restartFailed": {
    ru: "Не удалось перезапустить Talkee автоматически. Закройте и снова откройте приложение вручную.",
    en: "Talkee could not restart automatically. Close and reopen the app manually.",
  },

  // Footer status line
  "permission.footer.launchFromApplications": {
    ru: "Сначала запустите из Applications.",
    en: "Launch from Applications first.",
  },
  "permission.footer.allGranted": {
    ru: "Все доступы выданы.",
    en: "All permissions granted.",
  },
  "permission.footer.grantToContinue": {
    ru: "Выдайте разрешения для продолжения.",
    en: "Grant the permissions to continue.",
  },
  "permission.footer.grantBothToContinue": {
    ru: "Выдайте оба разрешения для продолжения.",
    en: "Grant both permissions to continue.",
  },
  "permission.footer.grantMicToContinue": {
    ru: "Разрешите микрофон для продолжения.",
    en: "Allow the microphone to continue.",
  },

  // Footer button
  "permission.button.continue": { ru: "Продолжить", en: "Continue" },
  "permission.button.check": { ru: "Проверить", en: "Check" },
  "permission.button.restartAndCheck": {
    ru: "Перезапустить и проверить",
    en: "Restart and check",
  },
  "permission.button.restarting": {
    ru: "Перезапуск…",
    en: "Restarting…",
  },

  // ── TranscriptionStatsPanel ───────────────────────────────
  "stats.suffix.thousand": { ru: "к", en: "k" },
  "stats.suffix.million": { ru: "М", en: "M" },
  "stats.wordsToday": { ru: "Слов за сегодня", en: "Words today" },
  "stats.wordsThisMonth": { ru: "Слов за месяц", en: "Words this month" },
  "stats.wordsPerMinute": { ru: "Слов в минуту", en: "Words per minute" },
  // A recording made before the model was captured at completion time.
  "stats.model.unknown": { ru: "Неизвестно", en: "Unknown" },

  // ── TypingSpeedTest ───────────────────────────────────────
  "stats.typing.title": { ru: "Тест скорости печати", en: "Typing speed test" },
  "stats.typing.description": {
    ru: "Наберите текст ниже в течение {seconds} секунд. Считаются только правильно набранные слова, вставка из буфера не учитывается.",
    en: "Type the text below for {seconds} seconds. Only correctly typed words count and pasted text is ignored.",
  },
  "stats.typing.start": { ru: "Начать тест", en: "Start test" },
  "stats.typing.manualHint": {
    ru: "Ориентир: {wpm} слов/мин, значение можно задать вручную.",
    en: "Reference: {wpm} wpm — the value can also be set manually.",
  },
  "stats.typing.retry": { ru: "Пройти заново", en: "Try again" },
  "stats.typing.timeLeft": { ru: "Осталось: {seconds} с", en: "Time left: {seconds} s" },
  "stats.typing.timeUp": { ru: "Время вышло", en: "Time is up" },
  "stats.typing.placeholder": { ru: "Начните печатать здесь…", en: "Start typing here…" },
  "stats.typing.pasteBlocked": {
    ru: "Вставка из буфера не считается за печать",
    en: "Pasted text does not count as typing",
  },
  "stats.typing.correct": { ru: "Верно: {count}", en: "Correct: {count}" },
  "stats.typing.mistakes": { ru: "Ошибок: {count}", en: "Mistakes: {count}" },
  "stats.typing.wordsTyped": { ru: "Набрано слов: {count}", en: "Words typed: {count}" },
  "stats.typing.result": { ru: "Ваша скорость: {wpm} слов/мин", en: "Your speed: {wpm} wpm" },
  "stats.typing.resultHint": {
    ru: "Проверьте результат и подтвердите сохранение. Если закрыть тест, скорость не сохранится.",
    en: "Check the result and confirm the save. Closing the test saves nothing.",
  },
  "stats.typing.tooFewWords": {
    ru: "Слишком мало набранного текста для честного измерения. Попробуйте ещё раз.",
    en: "Not enough typed text for an honest measurement. Please try again.",
  },
  "stats.typing.save": { ru: "Сохранить", en: "Save" },
  "stats.typing.cancel": { ru: "Отмена", en: "Cancel" },
  "stats.typing.saved": { ru: "Сохранено: {wpm} слов/мин", en: "Saved: {wpm} wpm" },
  "stats.typing.saveFailed": {
    ru: "Не удалось сохранить скорость печати",
    en: "Could not save the typing speed",
  },
} as const;
