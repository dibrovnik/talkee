---
name: talkee-product-ui-style
description: Apply the Talkee native macOS UI style (Apple HIG, system fonts and colors, src/ui primitives) to Talkee screens and components. Use when a user asks to make an interface in Talkee style, says сделать интерфейс в стиле Talkee, restyle a settings screen, onboarding, modal or widget overlay, or align typography, colors, controls, menus and motion with Talkee.
---

# Talkee Product UI Style

The style is defined in one place: [`rules/style.rule.md`](../../rules/style.rule.md). Read it
before changing UI. This skill does not repeat its tokens or colors.

## Checklist

- [ ] Read `rules/style.rule.md` and the existing screen before editing.
- [ ] Build from `src/ui` primitives and the shared `ui-*` classes in `src/index.css`; add a new
      class only when nothing fits.
- [ ] Use only semantic tokens from the rule for fonts, colors, and radii; no hard-coded colors.
- [ ] No web fonts, no uppercase, no `backdrop-filter`, no custom traffic lights, no one-off cards.
- [ ] UI text is Russian, sentence case, with an ellipsis on commands that open a window.
- [ ] Every control is keyboard-reachable with a visible focus ring.
- [ ] New animations and transitions are disabled under `prefers-reduced-motion: reduce`.
- [ ] Checked in both the light and dark appearance.
- [ ] Run `bun run gate` before finishing.
