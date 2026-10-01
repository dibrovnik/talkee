# Talkee Product UI Style Rule

Use this rule whenever you create or edit Talkee UI: the settings window, onboarding, modals,
the widget overlays, and shared components. Talkee is a macOS utility, so its UI follows the
Apple Human Interface Guidelines for system integration. The main workspace takes its
layout and comfortable density from the ChatGPT web interface, without copying its brand.

This file is the single source of truth for the product style. `src/index.css` implements it,
and `src/ui/` holds the primitives. `skills/talkee-product-ui-style/` only links here.

## Principles (Apple HIG for macOS)

- **Native first.** Use system fonts, system colors, the system accent color, and native window
  chrome. The UI must follow the system light/dark appearance and accent without a restart.
- **Clarity over decoration.** Hierarchy comes from type size, weight, and grouping, not from
  color, shadows, or ornament.
- **Deference.** Content and controls come first. Materials (vibrancy) appear only where macOS
  uses them: the sidebar and the HUD overlays.
- **Consistency.** Build every screen from the primitives below. The same control looks and
  behaves the same everywhere.
- **Comfortable workspace.** Use 14–15 px body text, captions of at least 12 px, 36 px controls
  and 40 px primary actions. Group settings by purpose; avoid marketing layouts and nested
  cards. Keep the widget, notch island and HUD overlays compact and unchanged.
- **Accessibility.** Every control is keyboard-reachable with a visible focus ring. Respect
  Reduce Motion and Reduce Transparency, and keep text contrast at system levels.
- **Language.** UI text is Russian, sentence case, and ends with an ellipsis («Настройки…») when
  a command opens a window or needs more input.

## Tokens

Tokens live in the `:root` block of `src/index.css`. Theme switching sets `color-scheme`
(`light`, `dark`, or `light dark`) through `src/lib/theme.ts`; there are no hand-made palettes.

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

- Comfortable typography is scoped through `html[data-window="settings"]`, including portal
  content. Root tokens keep widget/HUD sizes. Workspace spacing uses 4/8/12/16/24/32 px,
  a 240 px sidebar and a readable content column up to 900 px.
- New markup uses these semantic tokens only. Legacy names in `src/index.css` (`--text-hi`,
  `--border`, `--surface`, ...) are aliases kept for older markup; do not use them in new code.
- Status colors: `--danger` and `--success` (system red and green). Use them for state only,
  never as decoration.
- If a `-apple-system-*` keyword is unsupported, fall back to the nearest CSS Color 4 system
  color (`Canvas`, `CanvasText`, `AccentColor`, `AccentColorText`, `GrayText`).
- Radii: controls `--radius-control`, grouped sections `--radius-group`, and HUD overlays 12 px
  (matching the native material radius).

## Primitives

Import from `src/ui` (`src/ui/index.ts`). A dev-only gallery (`src/ui/Gallery.tsx`, behind
`import.meta.env.DEV`) shows every primitive for visual checks.

| Primitive | Use for | Notes |
|---|---|---|
| `Button` | Commands | `variant`: `default`, `primary` (accent), `destructive`; `size`: `regular` (22 px), `large` (28 px). No hover lift |
| `Toggle` | On/off settings | NSSwitch look; `size` regular or large; accent when on |
| `PopUpButton` | Choosing one of several text options | Native `<select>`; WKWebView renders it as NSPopUpButton |
| `SelectMenu` | Choices that need icons or descriptions | Custom list with full keyboard support |
| `SegmentedControl` | Switching views or modes (2–5 options) | `radiogroup`; optional `needsAttention` marker |
| `Slider` | Continuous values | NSSlider look; `onCommit` for saving on release |
| `TextField`, `SecureField` | Text and secret input | 36 px workspace / 22 px HUD, accent focus ring |
| `FormSection` | Grouping settings | Title above, rounded `--control-bg` group, optional footer below |
| `FormRow` | One setting in a group | Label left, control right, separators between rows |
| `SidebarItem` | Settings sidebar navigation | 40 px in the workspace, 16 px icon, `--selected-bg` when active |
| `Badge` | Short status labels | `variant`: `neutral`, `success`, `danger` |
| `ProgressBar` | Determinate progress | `value` from 0 to 1 |
| `Spinner` | Indeterminate progress | 12-stroke NSProgressIndicator look |

Shared CSS classes in `src/index.css` cover layouts that are not components: `ui-page-header`,
`ui-form-group`, `ui-choice` (radio-card lists), `ui-modal`, `ui-slide-over`, `ui-menu`,
`ui-icon-button`, `ui-callout`, `ui-disclosure-link`. Reuse them before adding a new class.

## Windows, Menus, and Materials

- Settings window: native decorations with an overlay title bar and system traffic lights. The
  `Sidebar` vibrancy fills the window beneath a restrained system-Canvas tint, and the
  reading area paints opaque `Canvas`. This keeps explicit light/dark themes readable even
  when native material and WebKit color-scheme do not switch together.
- Widget overlays (`widget-notice`, `widget-text`): the native `HudWindow` material with a
  12 px radius. Their components draw no background of their own and use `--label` text in the
  dark color scheme.
- App menu and tray menu: native `tauri::menu` with Russian labels, standard grouping with
  separators, and standard shortcuts (⌘, for settings, ⌘Q to quit).
- Icons: Phosphor through `src/lib/icons.ts`, `regular` weight, 16 px. SF Symbols cannot be
  embedded in a WebView.

## Motion and Accessibility

- Motion is short and functional: state changes, reveals, progress. No decorative animation.
- Every animation or transition must be turned off under `@media (prefers-reduced-motion:
  reduce)`.
- Reduce Transparency: the sidebar switches to `--window-bg` through
  `@media (prefers-reduced-transparency: reduce)` and the `reduce-transparency` class on
  `<html>`, which `src/lib/reduceTransparency.ts` mirrors from macOS. Native materials become
  opaque on their own.

## Implementation Rules

- React components use inline styles with CSS variables, or the shared classes in
  `src/index.css`. No CSS modules or styled-components.
- Check both the light and dark appearance for every UI change.
- Do not change layout systems that are unrelated to the screen you are editing.

## Prohibited

- Web fonts (Inter, Manrope, or any other bundled font).
- `text-transform: uppercase` and all-caps labels, headers, or buttons.
- Custom or drawn traffic lights and custom title bars.
- CSS `backdrop-filter` and blur; use native window materials instead.
- One-off cards: glass panels, gradients, grid textures, decorative shadows, nested cards.
- Hard-coded colors for text, backgrounds, or borders where a system token exists.
- Custom-drawn replacements for controls that exist as primitives.

Accessible Switch/RadioGroup/Select/Dialog/Tooltip behavior comes from focused Radix
primitives behind `src/ui` wrappers. Radix is unstyled: Talkee tokens remain the visual
source of truth. Keep native selects and simple button/input elements where sufficient.
