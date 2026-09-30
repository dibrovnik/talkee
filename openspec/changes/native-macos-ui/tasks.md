# Tasks

## 1. Окно и тема

- [x] 1.1 `src-tauri/src/commands/settings_window.rs`: параметры окна и vibrancy (design.md, решение 1)
- [x] 1.2 Удалить `src/components/TitleBar.tsx` и его использование; удалить `clip-path`/скругления `.app-root` в `src/index.css`; добавить drag-region и отступ под светофоры в `SettingsApp.tsx`
- [x] 1.3 `src/index.css`: заменить токены (design.md, решение 2); удалить палитру «капучино», градиенты, сетку, `.label` uppercase, `.btn` с подъёмом, стеклянные карточки
- [x] 1.4 `src/lib/theme.ts`: `color-scheme` + `setTheme` (design.md, решение 2)
- [x] 1.5 Проверка: `bun run tauri dev` — системные светофоры, vibrancy боковой панели, смена системной темы и акцентного цвета применяется сразу

## 2. Примитивы

- [ ] 2.1 Создать `src/ui/` с компонентами из design.md, решение 3 (по одному файлу, экспорт через `src/ui/index.ts`)
- [ ] 2.2 Unit-тесты логики примитивов, где она есть (клавиатура в кастомном списке, `SegmentedControl` стрелками)
- [ ] 2.3 `src/ui/Gallery.tsx` + скрытая dev-вкладка
- [ ] 2.4 Проверка: `bun test src/ui`; визуально в Gallery в светлой и тёмной теме, с Tab-навигацией

## 3. Разбиение SettingsTabs.tsx (без изменения поведения)

- [ ] 3.1 Вынести вкладку `model` в `src/windows/settings/tabs/model/ModelsTab.tsx` + подкомпоненты по смыслу (провайдеры STT, LLM, локальные модели)
- [ ] 3.2 Вынести вкладку `style` в `src/windows/settings/tabs/style/StyleTab.tsx` + `PromptLibrary.tsx`
- [ ] 3.3 Удалить `SettingsTabs.tsx` (или оставить тонкий роутер), обновить импорты в `SettingsApp.tsx`
- [ ] 3.4 Проверка: `bunx tsc --noEmit && bun test`; ручная проверка обеих вкладок — поведение не изменилось

## 4. Миграция вкладок (каждая — отдельный коммит, проверка в двух темах)

- [ ] 4.1 Боковая панель: `SidebarItem`, группы, без логотипа (design.md, решение 5)
- [ ] 4.2 `SettingsTab.tsx` (Основные) + настройка «Показывать значок в Dock»
- [ ] 4.3 `TranslationTab.tsx` и `RealtimeTranslationModels.tsx`
- [ ] 4.4 `MainTab.tsx` (история, статистика)
- [ ] 4.5 `FileTranscriptionTab.tsx`
- [ ] 4.6 `DevChatTab.tsx`
- [ ] 4.7 `model/ModelsTab.tsx` и компоненты `LocalSttModelCard.tsx`, `LocalLlmModels.tsx`, `ModelCardDisclosureButton.tsx`
- [ ] 4.8 `style/StyleTab.tsx`, `SummaryModal.tsx`, `SlideOverModal.tsx`, `RowActionsMenu.tsx`
- [ ] 4.9 Онбординг `src/components/onboarding/*` и `PermissionScreen.tsx`
- [ ] 4.10 Удалить `src/components/Dropdown.tsx` после замены всех использований на `PopUpButton`
- [ ] 4.11 Проверка: `grep -rn "uppercase\|backdrop-filter\|Manrope\|Inter\b" src` пуст (кроме пилюли виджета, если там нужно); `bunx tsc --noEmit && bun test`

## 5. Меню, Dock, запуск

- [ ] 5.1 Меню приложения (design.md, решение 6); `Info.plist`: `CFBundleDevelopmentRegion`/`CFBundleLocalizations`
- [ ] 5.2 Меню трея: разделители, многоточия, `CheckMenuItem` для Dock (design.md, решение 7)
- [ ] 5.3 `showInDock` в `src/lib/store.ts` + команда `set_dock_visibility` (design.md, решение 8)
- [ ] 5.4 Поведение запуска: `--autostart`, `RunEvent::Reopen` (design.md, решение 9)
- [ ] 5.5 Проверка вручную: ⌘C/⌘V в поле ввода, ⌘W, ⌘, ; выключить Dock → значок пропал, настройки из трея открываются; перезагрузка с автозагрузкой → окно не открылось

## 6. Оверлеи и доступность

- [ ] 6.1 `src-tauri/src/commands/widget.rs`: HUD-материал у `widget-notice` и `widget-text` (design.md, решение 10); убрать CSS-размытие в их компонентах
- [ ] 6.2 Reduce motion / transparency (design.md, решение 11)
- [ ] 6.3 Проверка: включить в Системных настройках «Уменьшить движение» и «Уменьшить прозрачность» → анимации и прозрачность отключаются

## 7. Документация

- [ ] 7.1 Переписать `rules/style.rule.md`, сократить `skills/talkee-product-ui-style/`, обновить `AGENTS.md` (design.md, решение 12)
- [ ] 7.2 README: новые скриншоты
- [ ] 7.3 Проверка: `bun run gate`; `openspec validate native-macos-ui --strict`
