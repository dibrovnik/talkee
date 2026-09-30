# Talkee Product UI Reference

This reference captures the portable Talkee product UI language. Use it for Talkee screens and
for other products that should feel inspired by Talkee without copying brand content.

## Style Thesis

- Pure Thought: calm, precise, premium, and low-noise.
- Warm paper-like surfaces with black-and-white clarity.
- Product-first composition: useful controls, readable data, clear states, and restrained polish.
- Visual restraint over decoration. The interface should feel fast to scan and easy to operate.

## Typography

Font families and tracking values are defined in `rules/style.rule.md`; use them from there
rather than copying numbers. In short: a neutral UI sans for product text, a bold neutral sans
for brand and headings.

- Wordmark: uppercase, heavy weight, controlled tight tracking.
- Product headings: compact line-height, bold sans.
- Avoid serif display faces, script faces, and decorative headline styles as the identity base.

## Core Tokens

Token and color values are defined once in `rules/style.rule.md` (source of truth; the
desktop app also exposes them as CSS variables in `src/index.css`). Do not duplicate them
here — read that rule and map its values to the target project's local variable names.

## Components

Buttons:

- Primary: black pill or rounded button, white text, high contrast.
- Secondary: transparent/light surface, thin black border, black text.
- Product app buttons can use light surfaces by default and reserve black for primary actions.
- Hover: small translate, slightly stronger border or fill. Avoid bouncy or showy motion.

Navigation:

- Sticky web nav: cappuccino translucent background, `backdrop-filter: blur(20px)`, thin bottom border.
- Product/sidebar nav: light active state `rgba(0, 0, 0, 0.04)`, 10px radius, no inverted black active item.
- Icons: line icons, 18px default, modest stroke-weight difference between inactive and active.

Cards and panels:

- Use light translucent or solid warm surfaces with thin borders.
- Prefer no shadow or a very soft one. Border and spacing should carry most separation.
- Avoid cards inside cards. Use cards for repeated items, settings groups, modals, summaries, and tables.
- Subscription CTA blocks are light cards with a black CTA, not black promotional blocks.

Forms and tables:

- Inputs are quiet and utilitarian: transparent or white-tinted controls, thin borders, clear focus.
- Settings forms should show saved/default values clearly and keep actions close to the setting.
- Tables use small uppercase headers, thin row borders, hover tint, and mobile horizontal scroll.

## Layout Patterns

Desktop app:

- Keep a warm app frame, subtle texture/grid, blurred surfaces, compact controls, and clear side nav.
- Settings screens should be dense but calm: stacked groups, inline status, explicit errors, clear defaults.
- Preserve local app chrome and sizing constraints.

Dashboard:

- Sticky header, fixed sidebar on desktop, focused main column, table-first workflows.
- Use summaries and cards to support actions, not as decoration.
- Mobile collapses to one column with reachable actions and no text overflow.

Landing/product pages:

- First viewport should reveal the product or a concrete product state.
- Prefer screenshots, real UI states, voice/widget visuals, or product-specific motion.
- Keep hero copy direct. Do not replace the product with generic abstract decoration.

## Motion

- Motion supports comprehension: reveal, voice pulse, cleanup flow, loading/progress, hover feedback.
- Use short timings and standard easing such as `cubic-bezier(0.22, 1, 0.36, 1)`.
- Avoid animation that competes with reading or makes work surfaces feel unstable.

## Anti-Patterns

- Purple/blue neon AI palettes, heavy gradients, decorative blobs, and generic glass dashboards.
- Heavy drop shadows, deep card stacks, and page sections styled as floating cards.
- Random font mixing or decorative display typography as the core style.
- Inverted black sidebars/nav active states for ordinary product navigation.
- Marketing-only composition when the requested artifact is an app, dashboard, tool, or settings view.
