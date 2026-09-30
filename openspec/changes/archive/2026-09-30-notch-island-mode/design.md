# Design

## Context

Как устроен виджет (аудит, строки приблизительные):

- **Окно `widget`** объявлено в `tauri.conf.json:14-31`: 129×54, без рамки, прозрачное, `alwaysOnTop`, `skipTaskbar`, `acceptFirstMouse`, без тени; включён `macOSPrivateApi`.
- **Вид выбирается** в `src/main.tsx:12-24` по параметру `?window=`.
- **Rust** (`src-tauri/src/commands/widget.rs`):
  - `WIDGET_WIDTH/HEIGHT` 129/54 (`:28-29`);
  - `configure_main_widget_window` (`:42-69`);
  - `keep_widget_on_available_monitor` (`:94-126`);
  - `restore_widget_window` (`:129-166`);
  - `start_widget_watchdog` — раз в 5 с (`:168-198`);
  - `ensure_widget_notice_window` / `ensure_widget_text_window` (`:278-348`);
  - `position_widget_notice_window` / `position_widget_text_window` — растут вверх от виджета (`:354-427`);
  - `order_widget_window_front` — `CanJoinAllSpaces | FullScreenAuxiliary | Stationary` + `orderFrontRegardless` (`:441-476`);
  - `resize_widget_window` — `setFrame_display`, центрирование, смещение вверх (`:478-530`);
  - `widget_resize` (`:764-775`).

  NSPanel и нестандартный уровень окна не используются. Определения выреза, safe area и `NSScreen` нет, у `objc2-app-kit` не включена фича `NSScreen`.
- **Frontend:**
  - `Widget.tsx` (2842 строки):
    - дерево рендера (`:1980-2100`);
    - pill-компоненты `IdlePill`, `RecordingPill`, `ProcessingPill`, `FileDropPill`, `CallBubble`, `LiveTranslationBubble`;
    - drag (`:1690-1718`), hover (`:2382-2440`), волна (`:2591-2702`).
  - `widgetConstants.ts` — размеры пилюли; `widgetScale.ts` — масштаб через CSS `zoom`.
  - Позиция сохраняется в `useWidgetController.ts:209-290`, `widgetPositioning.ts`.
  - Автомат `widgetMachine.ts` отдаёт эффекты `resize_widget`/`set_stream`.
- **Предпосылки из предыдущих изменений:**
  - реальный уровень звука — событие `native-voice-level` (`optimize-apple-silicon`);
  - minimum macOS 14 (`optimize-apple-silicon`);
  - индикатор очистки (`quick-ai-cleanup-toggle`);
  - примитивы UI и HUD-материалы оверлеев (`native-macos-ui`).

Визуальный эталон состояний (формы, плечи, раскладка слотов): `reference/island-states.svg`, превью `reference/preview-island-states.png`.

## Goals / Non-Goals

**Goals:**
- Второй режим представления в том же окне `widget`.
- Точная геометрия выреза.
- Click-through.
- Корректное поведение при смене экранов.

**Non-Goals:**
- Интерактивный остров с медиа-контролами или файлами, как в NotchNook.
- Раскрытие по наведению мыши.
- Живой перевод в острове: `LiveTranslationBubble` в режиме острова скрыт, перевод остаётся в своём оверлее.
- Сброс файлов на остров.

## Decisions

1. **То же окно `widget`, другое представление.** Вся логика (горячие клавиши, запись, автомат, пайплайн) живёт в окне `widget`. Второе окно потребовало бы переносить её или синхронизировать два окна. Поэтому:
   - `Widget.tsx` выбирает между `<PillPresentation/>` (текущее дерево без изменений, вынесенное в компонент) и `<IslandPresentation/>` по `settings.widgetPresentation` и доступности острова;
   - Rust переключает параметры окна командой `set_widget_presentation(mode)`.
2. **Геометрия выреза** (`src-tauri/src/notch.rs`, `objc2-app-kit` + фича `NSScreen`):
   ```rust
   pub struct ScreenInfo { id: u32, frame: Rect, visible_frame: Rect, scale: f64, safe_top: f64, aux_left: Option<Rect>, aux_right: Option<Rect>, is_builtin: bool, has_menu_bar: bool }
   pub struct IslandAnchor { screen_id: u32, center_x: f64, top_y: f64, notch_width: f64, notch_height: f64, is_real_notch: bool }
   pub fn compute_anchor(screens: &[ScreenInfo], fallback: IslandFallback) -> Option<IslandAnchor> // чистая функция, тестируется
   pub fn read_screens() -> Vec<ScreenInfo> // AppKit
   ```
   - Для каждого `NSScreen.screens()` читаются:
     - `frame` и `visibleFrame`;
     - `backingScaleFactor`;
     - `safeAreaInsets().top` — больше 0 у экрана с вырезом;
     - `auxiliaryTopLeftArea()` и `auxiliaryTopRightArea()` — прямоугольники по бокам выреза, macOS 12+;
     - `deviceDescription["NSScreenNumber"]` → `CGDisplayIsBuiltin`, чтобы определить встроенный экран;
     - признак экрана со строкой меню: `NSScreen.screens()[0]`.
   - Ширина выреза = `frame.width - aux_left.width - aux_right.width`, центр = `aux_left.maxX + notch_width/2`, высота = `safe_top`.
   - Выбор экрана:
     1. есть экран с `safe_top > 0` → он;
     2. иначе, если `fallback == Island` → экран со строкой меню, псевдо-вырез шириной 180 pt, высота `frame.maxY - visibleFrame.maxY` (высота строки меню, минимум 24);
     3. иначе `None`, и Rust сообщает frontend'у «остров недоступен → пилюля».
   - Координаты AppKit (начало отсчёта снизу слева, глобальные) перевести в координаты окна Tauri через тот же механизм, что в `resize_widget_window` (`setFrame_display` в координатах AppKit — проще позиционировать напрямую через objc).
   - Unit-тесты `compute_anchor`:
     - MacBook с вырезом;
     - MacBook + внешний монитор;
     - только внешний монитор (крышка закрыта);
     - Mac без выреза с fallback `Island` и с fallback `Pill`.
3. **Окно в режиме острова** (`set_widget_presentation("island")`):
   - **Кадр окна** фиксированный: ширина `max(notch_width + 2*140, 440)`, высота `notch_height + 120` (запас под раскрытое уведомление), по центру `center_x`, верх = верх экрана. Размер кадра меняется только при смене экрана или режима, не при смене состояния: анимация идёт в CSS внутри фиксированного прозрачного окна, native resize на каждом кадре не нужен.
   - **Уровень окна** — `NSWindow.setLevel(NSMainMenuWindowLevel + 1)` (над строкой меню). `collectionBehavior` = `CanJoinAllSpaces | Stationary | FullScreenAuxiliary | IgnoresCycle`. `hasShadow = false`.
   - **Фокус.** Окно не должно становиться key. Если WKWebView всё же забирает фокус, переопределять `canBecomeKeyWindow` нельзя без подкласса. Проверить на практике; при проблеме заменить класс окна на неактивирующую панель (`NSWindowStyleMaskNonactivatingPanel` через `object_setClass` на `NSPanel`) — это задача 7.3.
   - **Click-through** — `window.set_ignore_cursor_events(true)` во всех состояниях, кроме `notice-expanded` с кнопкой: там `false`, после сворачивания снова `true`. Переключает frontend через `set_island_interactive(bool)`.
   - **Отключается:** `keep_widget_on_available_monitor`, сохранение позиции (`onMoved` в `useWidgetController`), drag, `widget_resize` (no-op с логом), `widgetScale`. Watchdog в режиме острова вместо восстановления позиции пилюли вызывает повторное позиционирование острова.
   - **Возврат** `set_widget_presentation("pill")` восстанавливает прежние параметры: размер из `widgetStackWidth/Height`, сохранённую позицию, обычный уровень, `ignore_cursor_events(false)`.
4. **Смена экранов.**
   - Наблюдатель `NSApplicationDidChangeScreenParametersNotification` через `NSNotificationCenter.defaultCenter().addObserverForName_object_queue_usingBlock` (объект держать в состоянии приложения).
   - Обработчик пересчитывает якорь, переставляет окно и эмитит `island-anchor-changed { anchor | null }`.
   - Дополнительная страховка — пересчёт в начале каждой записи.
5. **Frontend** (`src/windows/widget/island/`):
   - `islandLayout.ts` — чистая функция `computeIslandLayout(state, anchor, opts) -> { width, height, leftSlot, rightSlot, expanded }` для состояний:

     | Состояние | Ширина | Высота |
     |---|---|---|
     | `idle` | `notch_width` | `notch_height` |
     | `recording` | `notch_width + 2*72` | `notch_height` |
     | `processing` | `notch_width + 2*44` | `notch_height` |
     | `done` | как `processing` | `notch_height` |
     | `notice` | `max(notch_width + 2*110, 360)` | `notch_height + min(88, по тексту)` |
     | `call` | как `recording` | `notch_height` |

     Тесты — на каждое состояние и на `notch_width` 180 и 200.
   - `IslandPresentation.tsx`:
     - абсолютно позиционированная чёрная фигура по центру окна, `top: 0`;
     - размеры через CSS-переменные, переход `width`/`height`/`border-radius` с `transition-timing-function: linear(...)` (пружина из ~20 точек с лёгким перелётом) и длительностью 380 мс;
     - при `prefers-reduced-motion` — `opacity` 120 мс.
   - Форма:
     - нижние углы `border-bottom-left/right-radius: 14px` (в раскрытом виде 22px);
     - «плечи» — два псевдоэлемента 8×8 px слева и справа сверху с `radial-gradient(circle at 0 100%, transparent 8px, #000 8.5px)` (зеркально для правого).
   - Слоты:
     - `left` — `RecordingDot` + `Timer` (`tabular-nums`, 12 px, белый);
     - `right` — `LevelBars` из 5 полос по `native-voice-level`, ≤ 30 fps.
     Слоты занимают боковые «уши» шириной `(width - notch_width)/2`; центральная зона под вырезом пустая.
   - `notice` — текст (13 px, белый, до 2 строк) и `Button` (примитив из `src/ui`, вариант на тёмном фоне) под зоной выреза.
   - Состояние берётся из существующего `widgetMachine`/overlay-состояний; маппинг «состояние виджета → состояние острова» — чистая функция в `islandState.ts` с тестами.
6. **Оверлеи.**
   - `position_widget_notice_window` и `position_widget_text_window` получают ветку для острова. Кадр в координатах AppKit (начало снизу слева): `x = center_x - w/2`, нижний край окна на `gap` pt ниже выреза, то есть `y = top_y - notch_height - gap - height`, `gap = 8`. `top_y` — это верх экрана (`frame.maxY`), поэтому прибавлять высоту к нему нельзя: оверлей ушёл бы за верхний край.
   - В режиме острова короткие уведомления (включение очистки и т. п.) показываются в самом острове (`notice`), отдельное окно `widget-notice` не нужно. Длинный текст остаётся в `widget-text`.
7. **Настройки** (`store.ts`):
   - `widgetPresentation: "pill" | "island"` (по умолчанию `"pill"`);
   - `islandFallback: "island" | "pill"` (по умолчанию `"island"`).

   Вкладка «Основные», `FormSection` «Индикатор записи»:
   - `SegmentedControl` с двумя вариантами и маленьким статическим превью (SVG) под каждым;
   - `FormRow` «На экранах без выреза» → `PopUpButton`;
   - слайдер масштаба неактивен в режиме острова.

   Команда `get_island_availability()` → `{ hasNotchScreen, activeAnchor }`, чтобы показать подпись «На этом Mac нет выреза — остров будет сверху экрана».

## Risks / Trade-offs

- **Фокус WKWebView.** Прозрачное always-on-top окно может забирать key-статус. Задача 7.3 — ручная проверка и fallback на NSPanel через `object_setClass`. Этот приём известен, но хрупок: оформить отдельной функцией с подробным комментарием.
- **CSS-анимация внутри фиксированного окна.** Прозрачная часть окна (≈ 440×150 pt) всегда над строкой меню, но при `ignore_cursor_events(true)` она не мешает кликам. Во время раскрытого уведомления с кнопкой клики в прозрачной части окна перехватываются — это небольшая зона, и уведомление живёт 4 с. Приемлемо.
- **Разные модели MacBook** — геометрия берётся из системы, констант выреза нет.
- **Уровень `NSMainMenuWindowLevel + 1`** может перекрывать системные меню строки меню, если они раскрыты под островом. В покое остров совпадает с вырезом, где пунктов меню не бывает.
