# Responsive Dimension Presets — Design

**Status:** approved by the user in conversation on 2026-10-24
**Date:** 2026-10-24

## Intent

Add breakpoint-specific values to dimension presets in the Revyme builder, using the existing typography-preset editor as the UX reference. The supported preset families are Padding/Spacing, Margin, and Radius. Color presets and compound Border presets are out of scope.

All spacing and radius lengths remain pixel-based. Fluid `clamp()` values are supported only by typography presets that use the existing Utopia workflow; dimension presets and direct element styles must not gain `clamp()` support.

## User experience

- Edit a dimension preset in one grouped editor, with the existing Desktop / Tablet / Mobile tier selector.
- Use the typography editor's Desktop / Tablet / Mobile tier selector. Breakpoint widths come from the active page's existing viewport configuration (and the builder's default breakpoint ladder when no page configuration exists); they are not duplicated as per-preset thresholds. Each tier edits one pixel-based value; shorthand values such as `8px 16px` remain supported where the property supports them.
- Editing a tier that has no stored value starts from the base value. The tier remains inherited until the user changes it.
- Preserve the current Margin `auto` centering exception; every numeric length remains `px` (including bare zero normalization where applicable).
- Existing one-value presets remain valid and appear as groups with a base value. No bulk token migration is required.
- Preserve the current Spacing category's supported property mappings, including `gap`, where the builder already offers that preset category.

## Token model

Keep design tokens in `app/globals.css` and represent responsive tiers as sibling tokens, grouped by the existing category prefix:

| Family | Base | Tablet | Mobile |
|---|---|---|---|
| Padding/Spacing | `space-<name>` | `space-<name>-md` | `space-<name>-sm` |
| Margin | `margin-<name>` | `margin-<name>-md` | `margin-<name>-sm` |
| Radius | `radius-<name>` | `radius-<name>-md` | `radius-<name>-sm` |

The editor groups these tokens into one preset row and edits the selected tier. Optional tier values inherit the base value. Existing presets are read without rewriting their tokens; their responsive values are added only when edited. Breakpoint thresholds remain page configuration, not design-token values.

## Applying a preset

Applying a dimension preset writes the base `var(--token)` reference to the selected property. It also writes scoped responsive rules for the same property at the preset's tablet/mobile thresholds, using a CSS variable fallback from the optional tier token to the base token. This means existing consumers respond if a tier value is added later.

Responsive changes must use the existing `updateContainerStyle` mutation/generator path and affect only the selected property. They must not clear other responsive declarations on the node. Removing/replacing a preset must likewise remove or replace only that property's responsive values, preserving unrelated layout and typography overrides.

## Validation and Oracle

There are currently separate style-input and Oracle checks. The implementation must align them:

- Direct padding, margin, radius, and supported spacing values accept pixel lengths and zero; Margin also accepts `auto`. Direct `clamp()`, `calc()`, `%`, `rem`, `em`, and viewport units remain rejected.
- Add `gap`, `rowGap`, and `columnGap` to the pixel-only Oracle/preflight coverage when they use the existing Spacing preset category.
- A `var()` reference in a dimension property is valid only when it refers to an existing compatible dimension preset. An optional `-md`/`-sm` reference is valid when its fallback is the matching existing base token. Unknown or cross-category references remain invalid.
- Preset values written through the builder and MCP preset APIs must be validated by category before a token mutation is queued. Responsive spacing/radius tokens accept only pixel values (and the existing Margin `auto` exception). Typography preset values retain their current Utopia behavior.

## Implementation boundaries

- Reuse the typography editor's tier selector and responsive mutation conventions where appropriate; create a focused dimension-preset grouping/editor rather than changing color, Border, Shadow, or asset preset editors.
- Keep mutation and CSS generation in the existing source-code write path. Do not mutate the canvas DOM as the durable source of truth.
- Preserve the existing project format and single-token presets; do not introduce a JSON token format or require page migration.
- Add debug traces for preset grouping, tier edits, application, and rejected values.

## Verification

Tests must cover:

1. Grouping base/`-md`/`-sm` dimension tokens and keeping legacy single-token presets visible.
2. Responsive editor writes and pixel validation for Padding/Spacing, Margin, and Radius.
3. Applying/replacing/removing a preset writes only its property at each tier and preserves other responsive styles; missing tier tokens fall back to base.
4. Oracle/preflight accept valid pixel values and compatible existing preset references, and reject raw non-pixel values, `clamp()` in dimension styles/presets, unknown references, and incompatible token families.
5. Typography Utopia `clamp()` behavior remains unchanged.

Run focused Vitest suites, then `npx vitest run` and `npx tsc --noEmit` before claiming completion.

## Non-goals

- Responsive Color, Border, Shadow, Image, or Video presets.
- New responsive behavior for arbitrary CSS properties.
- Allowing fluid units in dimension presets or direct element styles.
- Publishing or modifying the user's website project as part of this builder feature.
