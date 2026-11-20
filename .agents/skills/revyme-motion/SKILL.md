---
name: revyme-motion
description: "Configure Framer Motion animations (motion.*), split-text reveals (textEffects.*), interactive overlays (overlays.*), site-wide smooth scroll / cursor / glide effects (siteEffects.*), and page interactions (pageInteractions.*) via Revyme MCP v2."
---

# Revyme Motion & Interactive Effects

Use this skill whenever adding animations, scroll reveals, hover/tap motion states, split-text choreography, overlays/drawers/modals, or site-wide kinetic effects.

---

## Core Invariant & Hover/States Routing Matrix
Revyme renders interactive physics via **Framer Motion** and `@revyme/runtime`, and renders node-scoped CSS pseudo-states via `<style>` rules (`styles.set({ pseudo })`). Inline JSX `transition*` strings are stripped during `fragments.insert` so they never fight Framer Motion or FLIP projections.

| Need | Tooling & Target | Visual Editor Support |
| :--- | :--- | :--- |
| **Single-element CSS state** (`:hover`, `:active`, `:focus`, `:focus-visible`, `:focus-within`, `:disabled`, `:checked`, `::before`, `::after`, `::placeholder`, or validated node-scoped custom states like `[aria-expanded="true"]`, `:nth-child(odd)`) | `styles.set({ nodeId, pseudo, styles })` (put `transition` in the pseudo rule or pair with `motion.set`) | Fully editable in **StylesTool → States & Pseudo** (`Transition` + live `Preview on canvas`) |
| **Spring / gesture physics on a single element** (`whileHover`, `whileTap`, `whileInView`) | `motion.set({ targetFile, nodeId, prop, values })` | Editable in **AnimationTool** (`whileInView` auto-wires `viewport={{ once: true }}`; pass `viewportOnce: false` only when intentionally repeating) |
| **Parent-hover driving child elements** (hovering a card to zoom a nested image, reveal an overlay, or rotate a child icon) | `components.extract` + `variants.create` (`hover`) + `connections.create` (`whileHover`) | Full multi-element variant state machine. *If the user explicitly requests no Design Components, warn upfront that CSS-only single-node states cannot drive child elements in the visual builder without a component variant.* |

---

## 1. Node Motion (`motion.*`)
- Inspect existing animation config: `motion.get`.
- Apply a built-in motion preset: `motion.preset.apply`.
- Author appear, loop, gesture (`hover` / `tap`), or scroll-linked motion props: `motion.set` (`prop: 'whileInView'` automatically injects `viewport={{ once: true }}`).
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
