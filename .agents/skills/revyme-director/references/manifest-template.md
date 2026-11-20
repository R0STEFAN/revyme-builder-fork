# DESIGN_MANIFEST.md Template

> Generated during Phase 1 as the design contract for the build. Keep it concise and opinionated.

---

## 1. Project Context & Aesthetic Thesis

- **Purpose & Audience**: [One sentence: what is being built and for whom]
- **Register**: [Brand | Product | Editorial | Portfolio]
- **Aesthetic Direction**: [e.g. Editorial Brutalism | Luxury Minimal | Tactile Industrial | Retro-futuristic]
- **The One Signature Moment**: [The single memorable visual/interactive anchor, e.g., 3D Iridescent WebGL Orb, Velocity Scroll Marquee, Kinetic Masked Split-Text]
- **Reference Signals**: [Key takeaways extracted from user-provided reference screenshots]

---

## 2. Color System (OKLCH Tokens via `tokens.set`)

*Rule: Tint neutrals toward the brand hue (chroma 0.005–0.01). Avoid pure `#000` or `#fff`.*

| Token Name | Light Value | Dark Value | Semantic Role |
| :--- | :--- | :--- | :--- |
| `--bg` | `oklch(...)` | `oklch(...)` | Base page background |
| `--surface` | `oklch(...)` | `oklch(...)` | Cards, panels, elevated sheets |
| `--surface-raised` | `oklch(...)` | `oklch(...)` | Tooltips, dropdowns, modal layers |
| `--ink` | `oklch(...)` | `oklch(...)` | Primary text and headings |
| `--muted` | `oklch(...)` | `oklch(...)` | Secondary body text, captions |
| `--accent` | `oklch(...)` | `oklch(...)` | Signature brand punch, primary CTA |
| `--accent-hover` | `oklch(...)` | `oklch(...)` | Interactive hover state for accent |
| `--border-subtle` | `oklch(...)` | `oklch(...)` | Dividers, card boundaries (1px) |

---

## 3. Typography Strategy

- **Display Font**: `[Font Family Name]` (connected via `fonts.import` + `fonts.transformNextFont` $\to$ `var(--font-display)`)
- **Body Font**: `[Font Family Name]` (connected via `fonts.import` + `fonts.transformNextFont` $\to$ `var(--font-body)`)
- **Mode**:
  - **Expressive Inline (Default for bespoke single/landing pages)**: Author font sizes, weights, tracking, and fluid `clamp()` directly in Phase 1 inline JSX — `fragments.insert` preserves explicit custom typography cleanly.
  - **Shared Compound Presets (Recommended for multi-page systems)**: Define reusable tiers (`display-hero`, `heading-section`, `heading-card`, `body-lead`, `body`, `caption`) via `typography.set` and bind via `preset="..."` or `typography.apply`.

---

## 4. Design System & Component Inventory (Phase 2 Extraction)

*Author the full page layout first; extract repeated structures AFTER ingestion via `components.extract`.*

### A. Design Components (`components.extract` + `variants.create`)
- **`Button`** (if repeated): Variants for `Hover` / `Pressed` / `Secondary`.
- **`Navbar`**: Desktop horizontal bar vs Mobile hamburger state (`Mobile-Closed` / `Mobile-Open`).
- **`Card` / `BentoItem`** (if repeated): Shared surface styling and hover elevation.

### B. Code Components (`codeComponents.create` with `/** @controls */`)
- **`[SignatureComponent]`** *(only if WebGL / Three.js / Canvas / custom stateful widget is needed)*:
  - Path: `components/[Name].tsx`
  - Exposed Controls: `{ speed, color, intensity }`

---

## 5. Page Structure & Spacing Rhythm

*Rule: Section padding-top $\ge 1.5\times$ padding-bottom. Inter-block gap $\ge 2\times$ intra-item gap.*

- **Header / Nav**: Sticky or fixed top-level bar, height 64–72px.
- **Hero Section**: Asymmetric or editorial composition, immediate value clarity above the fold.
- **Core Content Sections**: Varied layout rhythm (avoid repeating identical 3-card rows), responsive `minmax(0, 1fr)` grids.
- **Footer**: Clean semantic links, copyright, minimal brand mark.

---

## 6. Motion Lens & Choreography (Phase 2 Native Motion)

*Remember: Phase 1 CSS `transition*` properties are stripped on ingestion — wire intentional animations natively in Phase 2.*

- **Chosen Lens**: `[Restraint | Polish | Play]` (Commit to ONE)
- **Global Smooth Scroll**: `siteEffects.smoothScroll.set` (if appropriate for the genre)
- **Page Transitions**: `siteEffects.pageTransition.set` (`crossfade` or `slide-left`, `0.4s`)
- **Text Reveal**: Word or character stagger via `textEffects.set`
- **Micro-interactions**: Spring hover/tap/in-view reveals via `motion.set` / `motion.preset.apply`

---

## 7. Acceptance Checklist (Review Gate)

- [ ] No pure `#000`/`#fff` defaults or AI-slop tells (see `draft-guards-and-gotchas.md`).
- [ ] All imagery uses verified `https://...` URLs or uploaded `/api/uploads/...` assets.
- [ ] Intended interactions and reveals upgraded to `motion.*`, `textEffects.*`, `siteEffects.*`, or `variants.create`.
- [ ] Desktop (`1200px`), Tablet (`810px`), and Mobile (`390px`) verified via `observe.screenshot` + `observe.audit` (zero horizontal overflow, touch targets $\ge 44\text{px}$).
- [ ] `diagnostics.projectCheck` passes with zero Tier-3 errors or unresolved imports/assets.
- [ ] Any Code Components cleanly unmount without WebGL leaks and implement `useStaticCanvas()`.
