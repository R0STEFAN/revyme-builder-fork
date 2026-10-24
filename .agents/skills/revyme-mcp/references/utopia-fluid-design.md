# Utopia Typography in Revyme

Use Utopia only to choose fluid **font-size** values for a complete typography
preset. The Builder supports `clamp()` in that preset field; it does not support
`clamp()` for raw element styles or for padding, margin, radius, or other size
presets. Keep spacing and radius values in pixels.

## Responsive typography presets

The `typography.set` MCP v2 operation creates a complete preset. Its `size` value
may use a Utopia `clamp()` expression; other font properties live in the same
preset. If the design calls for discrete breakpoint values instead, use the
preset's responsive tiers with pixel sizes.

```json
{
  "name": "display",
  "tag": "h1",
  "targetFile": "app/globals.css",
  "values": {
    "font": "'Inter', sans-serif",
    "weight": "700",
    "size": "clamp(2.25rem, 1.75rem + 2.133vw, 3.625rem)",
    "line-height": "1.0",
    "spacing": "-0.04em"
  },
  "responsiveTiers": {
    "md": { "size": "48px" },
    "sm": { "size": "36px" }
  }
}
```

Use the live `meta.tools` schema for the exact current operation arguments. A
typography preset represents the whole text style (font, weight, size, line-height,
tracking, color, and supported effects), not separate one-property presets.

## Responsive spacing and radius

For Padding, Margin, and Radius presets, use their responsive preset editors and
set explicit pixel values for Desktop, Tablet, and Mobile. Example scale:

| Preset value | Desktop | Tablet | Mobile |
|---|---:|---:|---:|
| Section padding | 112px | 80px | 48px |
| Container gutter | 32px | 24px | 16px |
| Card radius | 20px | 16px | 12px |

The current `presets.set` MCP v2 schema does not expose responsive tiers for these
dimension presets. Do not invent tier fields or encode CSS functions in preset
values; use the Builder preset editor. For page-element overrides, use
`viewports.setOverride` with explicit pixel strings, for example
`{"paddingTop":"80px","marginBottom":"24px","borderRadius":"12px"}`.

## Rules

- `clamp()` is permitted only in the `size` field of a typography preset.
- Never put `clamp()` in inline styles, raw JSX/CSS, spacing tokens, or
  Padding/Margin/Radius presets.
- Spacing and radius values are pixels; use responsive preset tiers or explicit
  viewport overrides rather than fluid interpolation.
- Verify any operation's current fields through `meta.tools` before calling it.
