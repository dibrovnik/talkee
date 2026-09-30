# Design

## Context

Текущее состояние:

- **Окно `settings`** создаётся в `commands/settings_window.rs:31-68`: 920×680, минимум 820×560. На macOS `decorations(false)` + `transparent(true)`. Отдельный `TitleBar.tsx` высотой 48 px с нарисованными «светофорами» (`:5-26`, `:63-65`). Скругления сделаны через `clip-path` 16 px (`index.css:165-205`).
- **Автооткрытие:** настройки открываются через 500 мс после запуска (`lib.rs:128-131`).
- **Раскладка** (`SettingsApp.tsx`):
  - боковая панель 254 px (`:588-615`);
  - `SidebarLogo` — анимированные полосы и надпись «Talkis» шрифтом Manrope (`:138-180`);
  - вкладки заданы в `TABS` (`:67-110`): main, file, chat, model, interpreter, style, settings;
  - стили `.nav-item` — `index.css:437-466`.
- **Стили:** inline-объекты `style={{}}` и глобальные классы в `src/index.css` (940 строк). Tailwind 4 подключён, но почти не используется.
- **Токены:** `index.css:4-73` (светлая тема), `:75+` (тёмная). Тема управляется через `src/lib/theme.ts` (`data-theme`).
- **Не нативно:**
  - `.label` в uppercase (`:247-253`);
  - `.btn` высотой 40 px, 11 px/700, с подъёмом при наведении (`:291-322`);
  - стеклянные карточки;
  - радиальный градиент и сетка (`:207-219`);
  - `Dropdown.tsx`, самописные переключатели и сегменты.
- **Иконки:** Phosphor через `src/lib/icons.ts`.
- **Размер вкладок:**

  | Файл | Строк |
  |---|---|
  | `SettingsTabs.tsx` (model + style) | 5713 |
  | `FileTranscriptionTab.tsx` | 1906 |
  | `MainTab.tsx` | 1797 |
  | `TranslationTab.tsx` | 1594 |
  | `SettingsTab.tsx` | 1533 |
  | `DevChatTab.tsx` | 1415 |

- **Меню приложения** в коде не задано, используется стандартное меню Tauri.

## Goals / Non-Goals

**Goals:**
- Нативные окно, меню, типографика, цвета и элементы управления.
- Библиотека примитивов, на которой строятся все экраны.
- Разбиение `SettingsTabs.tsx`.

**Non-Goals:**
- Переписывание на SwiftUI.
- Изменение логики и данных вкладок.
- Пилюля виджета (остаётся как есть; альтернатива — изменение `notch-island-mode`).
- Смена набора иконок на SF Symbols: шрифт SF Symbols нельзя встраивать в WebView по лицензии. Остаётся Phosphor, начертание `regular`, 16 px — визуально близко к SF Symbols.

## Decisions

1. **Окно** (`settings_window.rs`, API Tauri v2 `WebviewWindowBuilder`):
   - `.decorations(true)`;
   - `.title_bar_style(TitleBarStyle::Overlay)`, `.hidden_title(true)`;
   - `.traffic_light_position(LogicalPosition::new(20.0, 20.0))`;
   - `.transparent(true)`;
   - `.effects(EffectsBuilder::new().effect(Effect::Sidebar).state(EffectState::FollowsWindowActiveState).build())`;
   - размер 900×640, минимум 760×520.

   Vibrancy на всё окно, а фон контентной области рисуется непрозрачным (`-apple-system-window-background`). Так эффект виден только в боковой панели — это стандартный приём.

   Удалить `TitleBar.tsx`, `clip-path` и `.app-root` border-radius. Вверху контента оставить `data-tauri-drag-region` высотой 52 px, в боковой панели — отступ под «светофоры».
2. **Токены** (`src/index.css`, полная замена раздела `:root`):
   ```css
   :root {
     color-scheme: light dark;
     --font: -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif;
     --font-display: -apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif;
     --fs-large-title: 26px; --fs-title1: 22px; --fs-title2: 17px; --fs-title3: 15px;
     --fs-body: 13px; --fs-callout: 12px; --fs-subhead: 11px; --fs-caption: 10px;
     --label: -apple-system-label;
     --label-2: -apple-system-secondary-label;
     --label-3: -apple-system-tertiary-label;
     --separator: -apple-system-separator;
     --control-bg: -apple-system-control-background;
     --window-bg: -apple-system-window-background;
     --accent: -apple-system-control-accent;
     --selected-bg: -apple-system-selected-content-background;
     --radius-control: 6px; --radius-group: 10px; --radius-window: 10px;
   }
   ```
   - Все названия `-apple-system-*` проверить в Safari/WKWebView на macOS 14+. Если значение не поддерживается, взять ближайшее из CSS Color Module 4 (`Canvas`, `CanvasText`, `AccentColor`, `AccentColorText`, `GrayText`) с fallback-значением.
   - Тему задавать через `color-scheme` (`light` / `dark` / `light dark`), а не через ручные палитры.
   - `src/lib/theme.ts`: вместо `data-theme` с палитрами выставлять `document.documentElement.style.colorScheme` и вызывать `getCurrentWindow().setTheme(...)`, чтобы vibrancy и светофоры совпадали с выбранной темой. Для «Системной» — `setTheme(null)`.
   - Удалить палитру «капучино», градиенты, сетку, стеклянные карточки, `.label` uppercase, `.btn` с подъёмом.
3. **Примитивы в `src/ui/`** (по файлу на компонент, у каждого экспорт функции с явным типом props и `JSX.Element`):

   | Компонент | Как выглядит и ведёт себя |
   |---|---|
   | `Button` | варианты `default` (серый фон `--control-bg`, 1 px граница, высота 22 px, 13 px), `primary` (фон `--accent`, белый текст), `destructive`; `size: "regular" \| "large"` (28 px) |
   | `Toggle` | как NSSwitch: 26×15 (regular), 38×22 (large); включённый — `--accent`; анимация 150 мс, отключается при `prefers-reduced-motion` |
   | `PopUpButton` | обёртка над нативным `<select>`: WKWebView рисует его как NSPopUpButton с системным меню — нативно и бесплатно доступно. Кастомный список только там, где нужны иконки или описания; тогда клавиатура обязательна по спеке |
   | `SegmentedControl` | радиогруппа с ролью `radiogroup`, выделенный сегмент — белая «плашка» с тенью (светлая тема) |
   | `Slider` | `<input type="range">` со стилями, близкими к NSSlider |
   | `TextField`, `SecureField` | высота 22 px, радиус 5 px, кольцо фокуса `--accent` 3 px с прозрачностью 50% |
   | `FormSection` | заголовок 13 pt semibold над группой, группа с фоном `--control-bg`, радиус 10 px, пояснение `--fs-callout` `--label-2` под группой |
   | `FormRow` | `label` слева, `control` справа, минимальная высота 36 px, разделители между строками (`--separator`, с отступом слева 12 px) |
   | `SidebarItem` | высота 28 px, иконка 16 px, радиус 6 px; выделение — `--selected-bg` (неактивное окно — `-apple-system-unemphasized-selected-content-background`) |
   | `Badge`, `ProgressBar`, `Spinner` | системный вид (спиннер — 12 штрихов как NSProgressIndicator) |

   Витрина примитивов — `src/ui/Gallery.tsx`, только в dev-сборке (`import.meta.env.DEV`). Открывается скрытой вкладкой настроек, нужна для визуальной проверки.
4. **Миграция вкладок** — по одной, в порядке от простой к сложной: settings (общие) → interpreter → main → file → chat → model → style. Для каждой вкладки:
   - заменить разметку на `FormSection`/`FormRow` и примитивы;
   - удалить inline-стили, дублирующие примитивы;
   - логику не трогать;
   - ручная проверка в светлой и тёмной теме.

   Разбиение `SettingsTabs.tsx` на `tabs/model/ModelsTab.tsx` и `tabs/style/StyleTab.tsx` (плюс подкомпоненты) — отдельной задачей **до** рестайлинга этих вкладок. Это чистое перемещение кода без изменения поведения, `tsc` и тесты должны оставаться зелёными.
5. **Боковая панель:**
   - ширина 220 px;
   - вместо `SidebarLogo` — небольшой значок приложения (`assets/brand/app-icon.svg`, 20 px) и «Talkee» 13 pt semibold, или совсем без логотипа, как в «Системных настройках». Решение: без логотипа, чтобы было ближе к системе;
   - пункты разбиты на группы с разделителем: «История, Файлы, Чат» / «Модели, Стиль, Перевод» / «Основные».
6. **Меню приложения** (`lib.rs`, `tauri::menu`):
   - `Submenu "Talkee"`: About, separator, «Настройки…» (⌘,) → открыть настройки, separator, Services, Hide, HideOthers, ShowAll, separator, Quit;
   - `Submenu "Правка"`: предопределённые `PredefinedMenuItem::undo/redo/cut/copy/paste/select_all`;
   - `Submenu "Окно"`: minimize, close_window.

   Подписи русские. Предопределённые пункты AppKit локализуются системой, если в `Info.plist` указан `CFBundleDevelopmentRegion = ru` и/или `CFBundleLocalizations` включает `ru` — добавить.
7. **Меню трея:**
   - группы разделены `PredefinedMenuItem::separator`;
   - у пунктов, открывающих окно, в конце многоточие («Настройки…»);
   - «Показывать значок в Dock» — `CheckMenuItem`.

   Пункты «ИИ-очистка» появятся в `quick-ai-cleanup-toggle`.
8. **Dock** (`store.ts`: `showInDock: boolean`, по умолчанию `true`):
   - Rust-команда `set_dock_visibility(show)` → `app.set_activation_policy(ActivationPolicy::Regular | Accessory)`;
   - при показе окна настроек в режиме Accessory вызвать `app.show()`, затем `window.set_focus()`;
   - применять при старте и при изменении настройки;
   - после закрытия окна настроек вернуть Accessory, если `showInDock=false`.
9. **Запуск:**
   - убрать безусловный показ через 500 мс в `lib.rs:128-131`;
   - показывать, если (а) онбординг не завершён или (б) процесс запущен не автозагрузкой;
   - признак автозагрузки — аргумент `--autostart`: добавить его в `tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--autostart"]))` и проверять `std::env::args()`;
   - обработчик `RunEvent::Reopen` (клик по значку в Dock) открывает настройки.
10. **Оверлеи виджета** (`widget-notice`, `widget-text`):
    - `.effects(Effect::HudWindow)` с радиусом 12 (`EffectsBuilder::radius`);
    - удалить CSS `backdrop-filter` и полупрозрачные фоны в соответствующих компонентах;
    - текст — `--label` на тёмном HUD-материале.
11. **Reduce motion / transparency:**
    - CSS `@media (prefers-reduced-motion: reduce)` отключает анимации в примитивах и оверлеях;
    - `@media (prefers-reduced-transparency: reduce)` задаёт фон `--window-bg` у боковой панели. Проверить поддержку в WKWebView; если медиа-запрос не поддерживается, сделать Rust-команду, которая читает `NSWorkspace.accessibilityDisplayShouldReduceTransparency` и передаёт класс на `<html>`.
12. **Документация:**
    - `rules/style.rule.md` переписать: принципы HIG, токены из решения 2, таблица примитивов, запреты (веб-шрифты, uppercase, кастомные светофоры, `backdrop-filter`, одноразовые карточки);
    - скилл `skills/talkee-product-ui-style/` сократить до ссылки на правило и чеклиста;
    - в `AGENTS.md` оставить одну ссылку.

## Risks / Trade-offs

- **Имена `-apple-system-*` цветов** — нестандартные ключевые слова WebKit. Нужны fallback-значения и проверка на целевой macOS.
- **Нативный `<select>`** ограничен в оформлении пунктов (нет иконок и описаний). Там, где они нужны (выбор модели), делается кастомный список с полной поддержкой клавиатуры.
- **Объём.** Миграция вкладок — 15k строк. Разбиение по вкладкам и коммит на каждую ограничивают риск.
- **`transparent(true)`** требует `macOSPrivateApi` — уже включён.
