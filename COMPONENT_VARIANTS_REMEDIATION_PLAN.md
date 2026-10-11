# Component & Variant Remediation Plan: Style Inheritance & Framer Motion Integration

This document outlines a modular, step-by-step engineering plan to resolve known and edge-case bugs in Revyme's component system, variant style inheritance, code generation, and Framer Motion integration.

Each task is self-contained and formatted so that it can be assigned directly to an autonomous subagent.

---

## Architecture Summary & Critical Invariants

1. **Source of Truth**: React/Next.js `.tsx` source code is the only source of truth. The Canvas re-renders from the file; it never retains proprietary state.
2. **Three-Channel Variant Styling**:
   - **Motion Variant Objects (`xxxVariants`)**: Used for visual properties (colors, opacity, transforms, SVG paths). Evaluated via `animate={['default', variant]}`.
   - **Inline JSX Style Ternaries**: Used for layout and sizing (`flexDirection`, `alignItems`, `justifyContent`, `gap`, `order`, `width`, `height`). Evaluated by React before Framer Motion's FLIP measurement.
   - **`<AnimatePresence>` Conditionals**: Used for element visibility (`variant !== 'variant-1' && <motion.div ... />`).
3. **Sparse Variant Model**: Variants only store values that differ from the primary (`default`) variant.
4. **Empty String Convention**: In all style update paths, passing `''` signifies *delete this property / reset override*.

---

## Subagent Task Directory

| Phase | Title | Primary Files | Difficulty |
|---|---|---|---|
| [Task 1](#task-1-fix-regex-value-parsing-in-variant-object-generators) | Fix Regex Value Parsing in Variant Generators | `src/code/generation/generator-styles.ts` | Medium |
| [Task 2](#task-2-add-dimension-defaults-for-conditional-layout-ternaries) | Dimension Defaults for Layout Ternaries | `src/shared/constants.ts`, `src/code/generation/generator-styles.ts` | Low |
| [Task 3](#task-3-guarantee-canvas-dom-sync-on-variant-override-resets) | Guarantee Canvas DOM Sync on Variant Override Resets | `src/canvas/node-ops.ts`, `src/editor/controls/ControlProvider.tsx` | Medium |
| [Task 4](#task-4-eliminate-1-frame-sync-lag-in-interactive-variants) | Eliminate 1-Frame Lag in Interactive Variants | `src/code/variants/connection-config.ts` | Medium |
| [Task 5](#task-5-normalize-shorthand-vs-longhand-layering-in-variants) | Normalize Shorthand vs Longhand Variant Layering | `src/code/generation/generator-styles.ts`, `src/canvas/Renderer.ts` | High |
| [Task 6](#task-6-safeguard-framer-motion-transforms-against-css-conflicts) | Safeguard Transforms Against CSS Conflicts | `src/shared/motion-transform.ts`, `src/code/oracle/checks/variant-dialect.ts` | Medium |

---

## Task 1: Fix Regex Value Parsing in Variant Object Generators

### Target Files
- [`src/code/generation/generator-styles.ts`](file:///home/rost/Документи/revyme/revyme-builder-fork/src/code/generation/generator-styles.ts)
- Test suite: [`src/code/generation/generator-styles.test.ts`](file:///home/rost/Документи/revyme/revyme-builder-fork/src/code/generation/generator-styles.test.ts)

### Context & Root Cause
In `generator-styles.ts`:
1. `deleteRegex` (line 3176) and `propRegex` (line 3186) in `updateVariantStyleInCodeInner` assume style values in variant objects are only single/double-quoted strings or numbers (`(?:'[^']*'|"[^"]*"|-?\\d+(?:\\.\\d+)?)`).
2. If a variant property is bound to a component variable or identifier (e.g. `'variant-1': { color: brandColor }` via `motionVariantVariables`), or a boolean/keyword:
   - `deleteRegex` fails to match: resetting an override does **not** delete the property.
   - `propRegex` fails to match: updating the property appends a duplicate key (`color: brandColor, color: '#ffffff'`).
3. `defaultEntryValue` (line 3052) has the same regex restriction and fails to read bound variables or identifier defaults.
4. Lines 3234–3235 and 3269–3270 contain duplicate sequential calls to `ensureTransformNeutralOnAllVariants(result, setProps)`.

### Specification
1. Define a shared helper pattern for object property values that supports:
   - Quoted strings: `'...'`, `"..."`, `` `...` ``
   - Numbers: integers, decimals, negatives
   - Identifiers: JS variables / props (`[A-Za-z_$][\\w$]*`)
   - Function calls: `rgba(...)`, `var(...)`, `calc(...)`
   - Keywords / Booleans: `true`, `false`, `null`, `undefined`, `auto`
2. Update `deleteRegex`, `propRegex`, and `defaultEntryValue` to use this broadened pattern.
3. Remove the redundant second calls to `ensureTransformNeutralOnAllVariants` at lines 3235 and 3270.

### Verification
```bash
npx vitest run src/code/generation/generator-styles.test.ts
npx vitest run src/code/variants/variant-ops.test.ts
```
Ensure test coverage includes:
- Overwriting an identifier value in a variant entry with a literal.
- Deleting (`''`) an identifier value in a variant entry (resetting override).
- Ensuring duplicate keys are not produced.

---

## Task 2: Add Dimension Defaults for Conditional Layout Ternaries

### Target Files
- [`src/shared/constants.ts`](file:///home/rost/Документи/revyme/revyme-builder-fork/src/shared/constants.ts)
- [`src/code/generation/generator-styles.ts`](file:///home/rost/Документи/revyme/revyme-builder-fork/src/code/generation/generator-styles.ts)
- Test suite: [`src/code/generation/generator-styles.test.ts`](file:///home/rost/Документи/revyme/revyme-builder-fork/src/code/generation/generator-styles.test.ts)

### Context & Root Cause
1. `width` and `height` are included in `CONDITIONAL_LAYOUT_PROPS` in `constants.ts` (lines 359–360), meaning variant size edits on HTML elements are written as inline JSX ternaries (`width: variant === 'v1' ? '300px' : '...'`).
2. However, `CSS_LAYOUT_DEFAULTS` in `constants.ts` (lines 387–405) does **not** define `width` or `height`.
3. In `setConditionalStyleInCode` (lines 3828–3836), if an element had no explicit inline width on `default`, `cssDef` evaluates to `''`.
4. As a result, setting a variant width outputs:
   ```tsx
   style={{ width: variant === 'v1' ? '300px' : '' }}
   ```
   When the component is on the `default` variant, `style.width` is set to `''`, wiping any intrinsic, class-based, or natural content sizing.

### Specification
1. In `src/shared/constants.ts`, add layout dimensions to `CSS_LAYOUT_DEFAULTS`:
   ```ts
   export const CSS_LAYOUT_DEFAULTS: Readonly<Record<string, string>> = {
     // ...existing properties...
     width: 'auto',
     height: 'auto',
     minWidth: 'auto',
     minHeight: 'auto',
     maxWidth: 'none',
     maxHeight: 'none',
   };
   ```
2. In `setConditionalStyleInCode`, ensure that if the element's existing computed/inline style for `width` or `height` can be read from the node's base style, that concrete value is prioritized over the fallback.

### Verification
```bash
npx vitest run src/code/generation/generator-styles.test.ts
npx vitest run src/editor/tools/layout-removal.test.tsx
```
Verify that setting width on a non-default variant preserves the base variant's expected size and does not generate empty trailing alternates (`: ''`).

---

## Task 3: Guarantee Canvas DOM Sync on Variant Override Resets

### Target Files
- [`src/canvas/node-ops.ts`](file:///home/rost/Документи/revyme/revyme-builder-fork/src/canvas/node-ops.ts)
- [`src/editor/controls/ControlProvider.tsx`](file:///home/rost/Документи/revyme/revyme-builder-fork/src/editor/controls/ControlProvider.tsx)
- Test suite: [`src/editor/controls/reset-override-canvas-sync.test.ts`](file:///home/rost/Документи/revyme/revyme-builder-fork/src/editor/controls/reset-override-canvas-sync.test.ts)

### Context & Root Cause
1. In `src/canvas/node-ops.ts` (line 2663), `updateNodeInCache` is skipped when `variantName` is present to avoid polluting base styles with variant-specific values.
2. In `applyStylesToEl` (line 2439), passing an empty string (`value === ''`) imperatively executes `el.style[key] = ''`.
3. When resetting an override, the inherited value lives in `variants.default` or in a CSS rule, **not** in the inline `style` attribute.
4. Setting `el.style[key] = ''` leaves the element unstyled on the canvas until an explicit full re-render cycle executes.
5. While menu actions call `forceRenderAfterExternalEdit`, programmatic resets or direct tool interactions can leave the canvas DOM blank or detached.

### Specification
1. In `updateNodeStyles` in `node-ops.ts`:
   - Detect when an update on an active variant contains property deletions (`Object.values(styles).some(v => v === '')`).
   - Trigger `forceRenderAfterExternalEdit('variant-reset-override', { id, styles })` immediately following the queued mutation, ensuring the iframe re-renders with `resolveVariantStyles` and restores the inherited default value.
2. Ensure `ControlProvider.tsx`'s `updateStyle` respects this flow when invoked with empty strings on variant viewports.

### Verification
```bash
npx vitest run src/editor/controls/reset-override-canvas-sync.test.ts
npx vitest run src/canvas/node-ops.variant*
```

---

## Task 4: Eliminate 1-Frame Sync Lag in Interactive Variants

### Target Files
- [`src/code/variants/connection-config.ts`](file:///home/rost/Документи/revyme/revyme-builder-fork/src/code/variants/connection-config.ts)
- Test suite: [`src/code/variants/connection-config.test.ts`](file:///home/rost/Документи/revyme/revyme-builder-fork/src/code/variants/connection-config.test.ts)
- Test suite: [`src/canvas/runtime-variant-copies.hydrate.test.tsx`](file:///home/rost/Документи/revyme/revyme-builder-fork/src/canvas/runtime-variant-copies.hydrate.test.tsx)

### Context & Root Cause
When interactive variant connections are added, `connection-config.ts` (lines 524–525) emits:
```tsx
const [variant, setVariant] = useState(initialVariant);
useEffect(() => { setVariant(initialVariant); }, [initialVariant]);
```
1. `useState(initialVariant)` only reads `initialVariant` during initial mounting.
2. When a component instance on a page changes its variant prop (e.g. crossing responsive breakpoints or dynamic prop updates), React re-renders with the previous `variant` state first.
3. `useEffect` runs asynchronously after paint, triggering a second render with the updated variant.
4. This results in a visible 1-frame flash/flicker where the old variant paints before switching.

### Specification
Adopt the standard React pattern for adjusting state based on prop changes during rendering:
```tsx
const [variant, setVariant] = useState(initialVariant);
const [prevInitial, setPrevInitial] = useState(initialVariant);
if (initialVariant !== prevInitial) {
  setPrevInitial(initialVariant);
  setVariant(initialVariant);
}
```
1. Update `generateConnectionCode` in `connection-config.ts` to output this pattern instead of the trailing `useEffect([initialVariant])`.
2. Update `removeConnectionsForVariantInCode` teardown regexes to cleanly match and remove both lines during connection cleanup.

### Verification
```bash
npx vitest run src/code/variants/connection-config.test.ts
npx vitest run src/code/variants/variant-ops.test.ts
```

---

## Task 5: Normalize Shorthand vs Longhand Layering in Variants

### Target Files
- [`src/code/generation/generator-styles.ts`](file:///home/rost/Документи/revyme/revyme-builder-fork/src/code/generation/generator-styles.ts)
- [`src/canvas/Renderer.ts`](file:///home/rost/Документи/revyme/revyme-builder-fork/src/canvas/Renderer.ts)
- Test suite: [`src/canvas/node-ops.variant-shorthand-mirror.test.ts`](file:///home/rost/Документи/revyme/revyme-builder-fork/src/canvas/node-ops.variant-shorthand-mirror.test.ts)

### Context & Root Cause
1. In Framer Motion, variant properties are merged by key name.
2. If `default` defines longhands (e.g. `{ paddingTop: '20px', paddingBottom: '20px' }`) and `variant-1` defines a shorthand (e.g. `{ padding: '50px' }`), Framer Motion applies:
   `padding: 50px; padding-top: 20px; padding-bottom: 20px;`
   The longhands from `default` take precedence in CSS, breaking the variant override.
3. `Renderer.ts` uses `mergeStyleLayers` to mitigate this on the canvas, but the deployed runtime (`@revyme/runtime`) runs verbatim JSX, causing a discrepancy between editor canvas and production build.

### Specification
1. In `updateVariantStyleInCodeInner` in `generator-styles.ts`:
   - When writing a shorthand property to a non-default variant (`padding`, `margin`, `borderRadius`, `border`), inspect whether `default` or the target variant already contains constituent longhands.
   - If longhands exist in the target variant, remove them so the shorthand takes effect without internal conflicts.
   - If constituents exist in `default`, ensure the variant either explicitly covers all axes or the code generation prunes redundant conflicting defaults.
2. Keep `healStrandedVariantShorthands` synchronized with the write path.

### Verification
```bash
npx vitest run src/canvas/node-ops.variant-shorthand-mirror.test.ts
npx vitest run src/code/generation/generator-styles.test.ts
```

---

## Task 6: Safeguard Framer Motion Transforms Against CSS Conflicts

### Target Files
- [`src/shared/motion-transform.ts`](file:///home/rost/Документи/revyme/revyme-builder-fork/src/shared/motion-transform.ts)
- [`src/canvas/Renderer.ts`](file:///home/rost/Документи/revyme/revyme-builder-fork/src/canvas/Renderer.ts)
- [`src/code/oracle/checks/variant-dialect.ts`](file:///home/rost/Документи/revyme/revyme-builder-fork/src/code/oracle/checks/variant-dialect.ts)
- Test suite: [`src/shared/motion-transform.test.ts`](file:///home/rost/Документи/revyme/revyme-builder-fork/src/shared/motion-transform.test.ts)
- Test suite: [`src/code/oracle/variant-dialect.test.ts`](file:///home/rost/Документи/revyme/revyme-builder-fork/src/code/oracle/variant-dialect.test.ts)

### Context & Root Cause
1. Framer Motion manages transform channels independently (`x`, `y`, `rotate`, `scale`, `skew`).
2. If CSS defines a string transform (such as centering pins: `transform: translate(-50%, -50%)`), Framer Motion replaces the entire `transform` attribute on mount with its internal matrix/transform values.
3. Canvas `foldMotionTransforms` concatenates strings:
   `out.transform = existing ? '${existing} ${motionCss}' : motionCss;`
   which can cause drift if both `x`/`y` motion props and CSS `translate` coexist.
4. CSS `transition` rules conflict directly with Framer Motion's rAF tweens.

### Specification
1. In `src/shared/motion-transform.ts`:
   - In `motionPropsToCSSTransform` and `foldMotionTransforms`, ensure that if `translate` is present in the CSS string, any duplicate `x`/`y` motion values supersede the axis translation rather than stacking additively.
2. In `src/code/oracle/checks/variant-dialect.ts`:
   - Add a check warning when an element with motion variants also defines raw CSS `transform` strings containing non-pin transforms (`rotate`, `scale`, `skew`).
   - Validate that elements using `layout={true}` avoid inline `transform` strings that conflict with FLIP projections.

### Verification
```bash
npx vitest run src/shared/motion-transform.test.ts
npx vitest run src/code/oracle/variant-dialect.test.ts
```

---

## Execution & Rollout Checklist

- [x] **Run Baseline Tests**: Run `npx vitest run` and `npx tsc --noEmit` before initiating changes.
- [x] **Task 1 Execution**: Apply regex fixes and remove duplicate calls in `generator-styles.ts`.
- [x] **Task 2 Execution**: Update `CSS_LAYOUT_DEFAULTS` in `constants.ts` and verify layout dimension generation.
- [x] **Task 3 Execution**: Verify canvas DOM re-render triggers in `node-ops.ts` for variant resets.
- [x] **Task 4 Execution**: Refactor `useState` + `useEffect` to the render-phase adjustment pattern in `connection-config.ts`.
- [x] **Task 5 Execution**: Verify shorthand/longhand normalization across variants.
- [x] **Task 6 Execution**: Verify transform folding and oracle rules.
- [x] **Full Regression Suite**: Run `npx vitest run` across the entire project and verify zero type errors with `npx tsc --noEmit`.
