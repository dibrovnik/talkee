---
name: talkee-product-ui-style
description: Apply the Talkee Pure Thought product UI language to apps, dashboards, settings screens, auth flows, landing sections, and components. Use when a user asks to make an interface in Talkee style, says сделать интерфейс в стиле Talkee, применить Pure Thought UI, перенести этот стиль в другое приложение, port the Talkee visual system to another product, or align typography, colors, cards, navigation, CTAs, motion, and responsive behavior with Talkee.
---

# Talkee Product UI Style

## Overview

Use this skill to translate the Talkee product style into practical UI decisions. Treat Talkee as
the reference product, but adapt the visual language to the target app instead of copying brand
content blindly.

## Required Reference

Before changing UI, read `references/talkee-product-ui.md`. It contains the portable component
rules, layout patterns, motion guidance, and anti-patterns that define the style. Token and
color values are not duplicated there — they live in `rules/style.rule.md`.

## Workflow

1. Identify the target surface: desktop app, settings screen, dashboard, auth flow, landing
   section, or component.
2. Inspect existing tokens, components, and layout conventions in the target codebase.
3. Map the Talkee reference values to local variables/classes first. Add new styling only when
   the target app has no suitable primitive.
4. Apply the style narrowly to the requested surface. Preserve existing behavior, data flow,
   routing, accessibility affordances, and framework conventions.
5. Verify responsive fit, text overflow, hover/focus states, and that the result reads as a
   product UI rather than a generic marketing page.

## Talkee Repo Usage

In this repository, treat `rules/style.rule.md` as the product style source of truth and
`src/index.css` as its implementation. For React UI, prefer existing CSS variables and local
inline-style conventions.

Keep `rules/style.rule.md`, this skill, and any installed copy in sync when changing the style
language.

## Porting Outside Talkee

Use the Talkee language as a style archetype: warm cappuccino surfaces, black-and-white contrast,
bold neutral typography, light cards, sticky blur nav, pill CTAs, quiet dashboard density, and
restrained motion. Do not introduce Talkee brand copy, logos, or product claims unless the user
explicitly wants a Talkee-branded artifact.

## Output Expectations

When delivering work, state which Talkee style primitives were applied and call out any local
deviations. For implementation tasks, include verification results for responsive layout and visual
states when feasible.
