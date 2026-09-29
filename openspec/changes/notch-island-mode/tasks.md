# Tasks

## 1. Геометрия выреза (Rust, без UI)

- [ ] 1.1 `src-tauri/Cargo.toml`: добавить фичу `NSScreen` (и нужные зависимые, например `NSGraphics`) в `objc2-app-kit`
- [ ] 1.2 Создать `src-tauri/src/notch.rs`: структуры и чистая `compute_anchor` (design.md, решение 2) + unit-тесты на 5 конфигураций
- [ ] 1.3 `read_screens()` через AppKit; команда `get_island_availability`; регистрация в `lib.rs`
- [ ] 1.4 Проверка: `cargo test notch`; в dev-сборке вызвать `get_island_availability` из консоли WebView и сверить `notch_width`/`notch_height` с реальным вырезом (скриншот)

## 2. Разделение представлений (без изменения поведения пилюли)

- [ ] 2.1 `src/windows/widget/Widget.tsx`: вынести текущее дерево рендера пилюли в `src/windows/widget/pill/PillPresentation.tsx` (props — то, что сейчас берётся из замыкания); логику оставить в `Widget.tsx`
- [ ] 2.2 Проверка: `bunx tsc --noEmit && bun test`; ручная проверка пилюли (запись, обработка, ошибка, drag, drop файла) — без изменений

## 3. Окно в режиме острова (Rust)

- [ ] 3.1 `src/lib/store.ts`: `widgetPresentation`, `islandFallback` + нормализация + тесты (design.md, решение 7)
- [ ] 3.2 `src-tauri/src/commands/widget.rs`: команда `set_widget_presentation(mode)` — кадр, уровень, collectionBehavior, ignore cursor events (design.md, решение 3); обратный переход в pill
- [ ] 3.3 Отключить в режиме острова: `keep_widget_on_available_monitor`, восстановление позиции в watchdog (заменить на репозиционирование острова), `widget_resize`
- [ ] 3.4 Команда `set_island_interactive(bool)`
- [ ] 3.5 Ручная проверка фокуса: при записи в режиме острова текст вставляется в активное приложение, окно острова не становится key; при проблеме — fallback на NSPanel (design.md, риски) отдельной функцией
- [ ] 3.6 Наблюдатель смены экранов + событие `island-anchor-changed` (design.md, решение 4)
- [ ] 3.7 Проверка: `cargo check && cargo test`; закрыть крышку с внешним монитором → окно переехало ≤ 1 с

## 4. Вид острова (frontend)

- [ ] 4.1 `src/windows/widget/island/islandLayout.ts` + тесты (design.md, решение 5)
- [ ] 4.2 `src/windows/widget/island/islandState.ts` (маппинг состояний виджета) + тесты
- [ ] 4.3 `IslandPresentation.tsx`: форма с «плечами», пружинные переходы, reduced motion
- [ ] 4.4 Слоты: `RecordingDot`, `Timer`, `LevelBars` (по `native-voice-level`, ≤ 30 fps), спиннер обработки, галочка «готово», индикатор ИИ-очистки
- [ ] 4.5 Состояние `notice` с кнопкой: `set_island_interactive(true)` на время раскрытия
- [ ] 4.6 `Widget.tsx`: выбор представления по настройке и доступности; вызов `set_widget_presentation` при старте и при изменении настройки; drag, позиция и масштаб выключены в режиме острова
- [ ] 4.7 Проверка: `bun test src/windows/widget/island`; `bunx tsc --noEmit`

## 5. Оверлеи и настройки

- [ ] 5.1 `commands/widget.rs`: позиционирование `widget-notice`/`widget-text` под островом (design.md, решение 6); короткие уведомления — внутри острова
- [ ] 5.2 Вкладка «Основные»: секция «Индикатор записи» с превью, fallback, неактивный слайдер масштаба (design.md, решение 7); i18n
- [ ] 5.3 Проверка вручную по всем сценариям спеки: диктовка, ошибка (выключить сеть в режиме API), созвон, полноэкранное приложение, клик по строке меню рядом с островом, «Уменьшить движение», внешний монитор без выреза в обоих вариантах fallback, переключение режима во время записи

## 6. Финал

- [ ] 6.1 `docs/architecture/overview.md` и `AGENTS.md` (раздел про окна): описать режимы представления виджета
- [ ] 6.2 README: короткое видео/GIF режима острова загрузить в Release (не в репозиторий) и сослаться
- [ ] 6.3 Проверка: `bun run gate`; `openspec validate notch-island-mode --strict`
