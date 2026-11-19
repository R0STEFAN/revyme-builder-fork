---
name: revyme-motion
description: "Configure Framer Motion animations (motion.*), split-text reveals (textEffects.*), interactive overlays (overlays.*), site-wide smooth scroll / cursor / glide effects (siteEffects.*), and page interactions (pageInteractions.*) via Revyme MCP v2."
---

# Revyme Motion & Interactive Effects

Use this skill whenever adding animations, scroll reveals, hover/tap motion states, split-text choreography, overlays/drawers/modals, or site-wide kinetic effects.

---

## Core Invariant: Never Hand-Write CSS `transition*` in JSX
Revyme renders interactive animations via **Framer Motion** and `@revyme/runtime`. CSS `transition` / `transitionDuration` strings on canvas JSX nodes are stripped during ingestion because they conflict with visual motion tooling and FLIP projections. Always use the motion MCP tools below.

---

## 1. Node Motion (`motion.*`)
- Inspect existing animation config: `motion.get`.
- Apply a built-in motion preset: `motion.preset.apply`.
- Author appear, loop, gesture (`hover` / `tap`), or scroll-linked motion props: `motion.set`.
- Clear animation from a node: `motion.remove`.

## 2. Split-Text & Vector Sketch Effects (`textEffects.*`, `drawing.*`)
- Apply word/character/line staggered typography effects: `textEffects.set`, `textEffects.get`, `textEffects.remove`.
- Configure vector path drawing animations on SVGs/shapes: `drawing.sketchAnim.set`, `drawing.sketchAnim.get`, `drawing.sketchAnim.list`, `drawing.sketchAnim.remove`.

## 3. Overlays & Interactions (`overlays.*`, `connections.*`, `pageInteractions.*`)
- Create and manage modals, drawers, and tooltips attached to triggers: `overlays.create`, `overlays.update`, `overlays.close`, `overlays.remove`.
- Wire component variant connections on triggers: `connections.list`, `connections.create`, `connections.remove`.
- Attach interactive page variable mutations (notice empty string resets vs string literals): `pageInteractions.list`, `pageInteractions.add`, `pageInteractions.remove`.
- Manage stateful expressions/variables: `variables.list`, `variables.create`, `variables.bind`, `expressions.bind`.

## 4. Site-Wide Effects & Verification (`siteEffects.*`, `verify.effect`)
- Smooth scroll: `siteEffects.smoothScroll.set` / `.get` / `.remove`.
- Custom cursor: `siteEffects.cursor.set` / `.remove`.
- Momentum glide container: `siteEffects.glide.set` / `.get` / `.remove`.
- Page transitions: `siteEffects.pageTransition.set` / `.get` / `.remove`.
- Always confirm generated runtime bindings with `verify.effect`.
