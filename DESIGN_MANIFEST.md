# DESIGN_MANIFEST.md

> Single Source of Truth for the Monochrome Editorial Architectural System on Revyme.
> Target Project: `proj-1793542942247-5lkzxf`

---

## 1. Project Context & Aesthetic Thesis

- **Purpose & Audience**: High-end editorial studio manifesto & portfolio championing accessibility, precision craftsmanship, and unyielding typographic hierarchy.
- **Register**: Editorial / Architecture / Design Studio Manifesto
- **Aesthetic Extremity**: Monochrome Swiss-Editorial with continuous ruled spine, pure geometric contrast, and EB Garamond / Source Serif 4 / IBM Plex Mono pairing.
- **The One Signature Moment**: The continuous vertical architectural spine with asymmetrical rail (1/5 rail, 4/5 content column), inverted black comparison plate with white featured element, and absolute stillness.
- **Reference Signals**: Pure black and white contrast (`#000` / `#fff`), ruled divisions, small-cap buttons, zero ornamentation, strict WCAG AAA contrast, keyboard accessibility with visible solid outlines.

---

## 2. Color System (Authoritative Monochrome Tokens)

| Token Name | Light Value | Dark Value | Semantic Role |
| :--- | :--- | :--- | :--- |
| `--dp-color-ink` | `#000000` | `#000000` | Pure primary ink / text / solid black fills |
| `--dp-color-paper` | `#ffffff` | `#ffffff` | Pure paper white background |
| `--dp-color-secondary` | `#4d4d4d` | `#4d4d4d` | Secondary supporting text on paper |
| `--dp-color-quiet` | `#cfcfcf` | `#cfcfcf` | Subtle division rules on white, secondary text on black |
| `--dp-color-quiet-inverted`| `#3d3d3d` | `#3d3d3d` | Subtle division rules on black fields |

---

## 3. Typography Presets (Compound Presets)

- **Display Font**: `EB Garamond` (Monochrome Display)
- **Text Font**: `Source Serif 4` / `Iowan Old Style` (Monochrome Text)
- **Mono Font**: `IBM Plex Mono` (Monochrome Mono)

### Presets Specification:
1. **`display-hero`** (H1)
   - `tag`: `h1`
   - `font`: `var(--dp-typography-display)`
   - `weight`: `500`
   - `size`: `clamp(52px, 8cqw, 110px)`
   - `line-height`: `1.0`
   - `spacing`: `-0.03em`
   - `color`: `var(--dp-color-ink)`

2. **`heading-section`** (H2)
   - `tag`: `h2`
   - `font`: `var(--dp-typography-display)`
   - `weight`: `500`
   - `size`: `clamp(24px, 3cqw, 36px)`
   - `line-height`: `1.15`
   - `spacing`: `-0.02em`
   - `color`: `var(--dp-color-ink)`

3. **`heading-card`** (H3)
   - `tag`: `h3`
   - `font`: `var(--dp-typography-display)`
   - `weight`: `500`
   - `size`: `20px`
   - `line-height`: `1.25`
   - `color`: `var(--dp-color-ink)`

4. **`body-lead`**
   - `tag`: `p`
   - `font`: `var(--dp-typography-text)`
   - `weight`: `400`
   - `size`: `18px`
   - `line-height`: `1.55`
   - `color`: `var(--dp-color-ink)`

5. **`body-regular`**
   - `tag`: `p`
   - `font`: `var(--dp-typography-text)`
   - `weight`: `400`
   - `size`: `16px`
   - `line-height`: `1.55`
   - `color`: `var(--dp-color-secondary)`

6. **`mono-meta`**
   - `tag`: `span`
   - `font`: `var(--dp-typography-mono)`
   - `weight`: `400`
   - `size`: `12px`
   - `spacing`: `0.08em`
   - `color`: `var(--dp-color-secondary)`

7. **`label-action`**
   - `tag`: `span`
   - `font`: `var(--dp-typography-text)`
   - `weight`: `500`
   - `size`: `13px`
   - `spacing`: `0.12em`
   - `transform`: `uppercase`

---

## 4. Design Presets

| Category | Preset Name | Value / Group Definition |
| :--- | :--- | :--- |
| **`radius`** | `square` | `0px` (Strictly flat, zero rounded corners) |
| **`border`** | `rule-thin` | `{ width: "1px", style: "solid", color: "var(--dp-color-quiet)" }` |
| **`border`** | `rule-heavy` | `{ width: "3px", style: "solid", color: "var(--dp-color-ink)" }` |
| **`shadow`** | `none` | `none` (No drop shadows or glows) |

---

## 5. Component Inventory

1. **`MonochromeButton`**:
   - Primary: Solid `#000` background, `#fff` text, 52px min-height, uppercase small-caps, 1px solid `#000`.
   - Secondary: `#fff` background, `#000` text, 1px solid `#000`, 52px min-height.
   - Focus: 2px solid outline with 2px offset.
2. **`ArchitecturalSpine`**:
   - Left Rail: ~22% width, containing section titles & metadata.
   - Spine Rule: 1px continuous vertical line in `#cfcfcf`.
   - Content Column: 78% width, containing articles, sequences, comparison grid.
3. **`InvertedComparison`**:
   - Dark field (`#000000`) with subtle `#3d3d3d` divider rules and white text.
   - White featured card projecting out with pure contrast.

---

## 6. Motion & Accessibility

- **Motion**: Complete stillness (`transition: none`). No parallax, no hover transforms, immediate state swaps.
- **Accessibility**: Full keyboard navigation, visible focus ring (`outline: 2px solid currentColor`), semantic H1-H3 hierarchy, skip link, ARIA landmarks.
