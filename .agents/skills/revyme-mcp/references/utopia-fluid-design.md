# Utopia Fluid Responsive Design in Revyme

This guide explains how to apply the **Utopia fluid responsive methodology** (from [utopia.fyi](https://utopia.fyi)) in the Revyme Website Builder.

---

## 1. Why Utopia Fluid Design?

Traditional web design relies on rigid breakpoints:
- At 1200px: Font is 56px, Padding is 100px.
- Screen narrows to 1199px: **Snap!** Font abruptly drops to 40px, padding jumps to 60px.
- On intermediate screens (e.g. tablet 810px–1024px or large phones), layouts often look either too large or awkwardly cramped.

**Utopia solves this with smooth, continuous interpolation via CSS `clamp()`:**
$$\text{clamp}(\text{minSize}, \text{yIntersection} + \text{slope} \times 100\text{vw}, \text{maxSize})$$

Between **Mobile (375px)** and **Desktop (1200px)**:
1. Typography and spacing scale smoothly with viewport width — no jarring snaps.
2. Zero media query bloat: one CSS rule handles all screens from mobile to 4K displays.
3. Perfect visual balance at every viewport width (375px, 414px, 768px, 810px, 1024px, 1200px, 1440px+).

---

## 2. Standard Utopia Token Scales

Add these tokens to `app/globals.css` via `revyme_manage_presets` or direct definition.
*Parameters: Min Viewport = 375px, Max Viewport = 1200px, Base = 16px.*

### A. Fluid Typography Scale (`--font-step-*`)

| Token | Semantic Role | Mobile (375px) | Desktop (1200px) | CSS `clamp()` Value |
|---|---|---|---|---|
| `--font-step--2` | Legal / Tiny Label | 11px | 12px | `clamp(0.6875rem, 0.6591rem + 0.121vw, 0.75rem)` |
| `--font-step--1` | Subtext / Caption | 13px | 14px | `clamp(0.8125rem, 0.7841rem + 0.121vw, 0.875rem)` |
| `--font-step-0` | Body Text / Base | 15px | 17px | `clamp(0.9375rem, 0.892rem + 0.194vw, 1.0625rem)` |
| `--font-step-1` | Large Body / Subhead | 17px | 21px | `clamp(1.0625rem, 0.9716rem + 0.388vw, 1.3125rem)` |
| `--font-step-2` | H4 / Small Card Title | 20px | 26px | `clamp(1.25rem, 1.1136rem + 0.582vw, 1.625rem)` |
| `--font-step-3` | H3 / Card Title | 24px | 34px | `clamp(1.5rem, 1.2727rem + 0.97vw, 2.125rem)` |
| `--font-step-4` | H2 / Section Title | 28px | 44px | `clamp(1.75rem, 1.3864rem + 1.552vw, 2.75rem)` |
| `--font-step-5` | H1 / Page Headline | 36px | 58px | `clamp(2.25rem, 1.75rem + 2.133vw, 3.625rem)` |
| `--font-step-6` | Hero Display Title | 44px | 76px | `clamp(2.75rem, 2.0227rem + 3.103vw, 4.75rem)` |
| `--font-step-7` | Mega Editorial / Accent | 56px | 96px | `clamp(3.5rem, 2.5909rem + 3.879vw, 6rem)` |

---

### B. Fluid Spacing Scale (`--space-*`)

| Token | Semantic Role | Mobile (375px) | Desktop (1200px) | CSS `clamp()` Value |
|---|---|---|---|---|
| `--space-3xs` | Micro Gap | 4px | 6px | `clamp(0.25rem, 0.2045rem + 0.194vw, 0.375rem)` |
| `--space-2xs` | Tag / Badge Padding | 6px | 10px | `clamp(0.375rem, 0.2841rem + 0.388vw, 0.625rem)` |
| `--space-xs` | Button Y / Small Gap | 10px | 16px | `clamp(0.625rem, 0.4886rem + 0.582vw, 1rem)` |
| `--space-s` | Element Margin | 14px | 24px | `clamp(0.875rem, 0.6477rem + 0.97vw, 1.5rem)` |
| `--space-m` | Card Inner Padding | 20px | 36px | `clamp(1.25rem, 0.8864rem + 1.552vw, 2.25rem)` |
| `--space-l` | Grid Gap / Sub-block | 28px | 48px | `clamp(1.75rem, 1.2955rem + 1.939vw, 3rem)` |
| `--space-xl` | Group Spacing | 40px | 72px | `clamp(2.5rem, 1.7727rem + 3.103vw, 4.5rem)` |
| `--space-2xl` | Section Gap | 56px | 96px | `clamp(3.5rem, 2.5909rem + 3.879vw, 6rem)` |
| `--space-3xl` | Monumental Spacing | 72px | 128px | `clamp(4.5rem, 3.2273rem + 5.43vw, 8rem)` |

---

### C. Fluid Section & Container Tokens

| Token | Purpose | Mobile (375px) | Desktop (1200px) | Value |
|---|---|---|---|---|
| `--space-section-y` | Section Vertical Padding | 56px | 110px | `clamp(3.5rem, 2.2727rem + 5.236vw, 6.875rem)` |
| `--space-gutter` | Container Side Margins | 16px | 32px | `clamp(1rem, 0.6364rem + 1.552vw, 2rem)` |
| `--container-max-width` | Max Content Width | 1200px | 1200px | `1200px` |

---

## 3. How to Apply in `globals.css` via MCP

Use `revyme_manage_presets` to register these tokens:

```json
{
  "action": "set",
  "tokens": [
    { "name": "font-step-5", "value": "clamp(2.25rem, 1.75rem + 2.133vw, 3.625rem)", "category": "typography" },
    { "name": "font-step-4", "value": "clamp(1.75rem, 1.3864rem + 1.552vw, 2.75rem)", "category": "typography" },
    { "name": "font-step-0", "value": "clamp(0.9375rem, 0.892rem + 0.194vw, 1.0625rem)", "category": "typography" },
    { "name": "space-section-y", "value": "clamp(3.5rem, 2.2727rem + 5.236vw, 6.875rem)", "category": "spacing" },
    { "name": "space-gutter", "value": "clamp(1rem, 0.6364rem + 1.552vw, 2rem)", "category": "spacing" },
    { "name": "space-card", "value": "clamp(1.25rem, 0.8864rem + 1.552vw, 2.25rem)", "category": "spacing" }
  ]
}
```

---

## 4. Applying Utopia in `revyme_insert_fragment`

When assembling sections, apply fluid tokens or raw `clamp()` values directly in `styles`:

```json
{
  "parent_id": "root",
  "fragment": {
    "tag": "section",
    "name": "Hero Section",
    "styles": {
      "width": "100%",
      "backgroundColor": "var(--color-bg)",
      "paddingTop": "clamp(56px, 6vw + 24px, 110px)",
      "paddingBottom": "clamp(56px, 6vw + 24px, 110px)",
      "display": "flex",
      "flexDirection": "column",
      "alignItems": "center"
    },
    "children": [
      {
        "tag": "div",
        "name": "Container",
        "styles": {
          "width": "100%",
          "maxWidth": "1200px",
          "margin": "0 auto",
          "paddingLeft": "clamp(16px, 2vw + 8px, 32px)",
          "paddingRight": "clamp(16px, 2vw + 8px, 32px)",
          "display": "flex",
          "flexDirection": "column",
          "alignItems": "center",
          "textAlign": "center"
        },
        "children": [
          {
            "tag": "h1",
            "name": "Hero Headline",
            "text": "Radical Form. Fluid Motion.",
            "styles": {
              "fontSize": "clamp(2.25rem, 1.75rem + 2.133vw, 3.625rem)",
              "lineHeight": "1.1",
              "fontWeight": "800",
              "color": "var(--color-text)",
              "marginBottom": "clamp(16px, 2vw, 24px)"
            }
          },
          {
            "tag": "p",
            "name": "Hero Subtitle",
            "text": "Sub-millisecond visual website builder powered by Next.js and real React source code.",
            "styles": {
              "fontSize": "clamp(1rem, 0.92rem + 0.35vw, 1.25rem)",
              "lineHeight": "1.6",
              "color": "var(--color-text-secondary)",
              "maxWidth": "620px",
              "marginBottom": "clamp(28px, 3.5vw, 44px)"
            }
          }
        ]
      }
    ]
  }
}
```

---

## 5. Summary of Best Practices
1. **Never use fixed px font sizes for H1/H2/Hero**: Always use `clamp()` or `var(--font-step-*)`. A fixed `72px` headline will break and cause horizontal overflow on mobile screens.
2. **Fluid Section Padding**: Use `paddingTop: 'clamp(48px, 6vw, 110px)'` so mobile screens aren't swallowed by giant 140px margins while desktop screens maintain generous white space.
3. **Fluid Grid Gaps**: Use `gap: 'clamp(16px, 2.5vw, 32px)'` inside grid containers for natural proportionality.
