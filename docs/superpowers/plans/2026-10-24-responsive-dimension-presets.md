# Responsive Dimension Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add grouped Desktop/Tablet/Mobile values to Padding/Spacing, Margin, and Radius presets, and validate those values consistently in the editor, MCP preset APIs, and Oracle.

**Architecture:** Add a dependency-light shared utility for dimension preset naming, grouping, validation, and responsive apply-plan construction. Reuse the Library panel's category/folder/row patterns and Typography editor's tier selector; apply a base token through the existing style writer and page breakpoint tiers through `updateContainerStyle`, touching only the selected CSS property. Make Oracle token checks category-aware while keeping typography's Utopia `clamp()` path unchanged.

**Tech Stack:** TypeScript, React, Jotai, Vitest, Babel AST, existing Revyme mutation queue and Oracle.

**Spec:** `docs/superpowers/specs/2026-10-24-responsive-dimension-presets-design.md`

## Global Constraints

- Dimension preset values and direct Padding/Margin/Radius/Spacing styles are pixel-based; Margin may also use `auto`.
- Fluid `clamp()` values are supported only by typography presets that use the existing Utopia workflow.
- Responsive dimension presets are limited to Padding/Spacing, Margin, and Radius.
- Breakpoint widths come from the active page's existing viewport configuration, with the builder's default breakpoint ladder when no page configuration exists.
- Applying, replacing, or removing a preset must affect only the selected property and preserve other responsive declarations on the node.
- Keep legacy one-value presets valid; do not migrate existing tokens in bulk.
- Do not add responsive Color, Border, Shadow, Image, Video, or arbitrary CSS-property presets.

## Review Focus

1. A legacy base token whose slug ends in `-md` or `-sm` must not be mis-grouped unless a matching base family token exists; pin suffix-collision behavior in the grouping test.
2. A page with custom or reduced viewport configuration must use actual configured band widths and must not invent tablet/mobile bands; pin both cases in apply-plan tests.
3. Pixel shorthand, negative Margin, bare zero, and Margin `auto` must remain editable, while malformed shorthand and non-pixel terms are rejected; pin these cases in shared validator tests.
4. Applying a preset to multiple selected page nodes must preserve unrelated responsive styles and must not route page-only container mutations to component variant files; pin selection and file-kind behavior in the control integration test.
5. A missing optional `-md`/`-sm` token with a base-token fallback must pass Oracle, while unknown, cross-category, or mismatched-fallback references fail; pin these cases in Oracle guard tests.

---

## File Map

- Create `src/shared/dimension-presets.ts` and its test file for pure category, suffix, grouping, validation, and apply-plan helpers shared by UI, MCP, and Oracle.
- Create `src/editor/left-toolbar/panels/LibraryPanel/presets/DimensionPresetGroupRow.tsx` and `DimensionPresetEditContent.tsx` for grouped rows and the three-tier value editor.
- Modify `src/editor/left-toolbar/panels/LibraryPanel/index.tsx` and `presets/CategorySection.tsx` to group dimension tokens, open the group editor, create optional tiers on first edit, and expand group deletion to all sibling tokens.
- Modify `src/editor/controls/control-menu-items.ts` and `ControlLabel.tsx` to show grouped dimension presets and apply base plus responsive values to the selected property.
- Modify `src/code/oracle/checks/style-object.ts`, `src/code/oracle/preflight-validation.ts`, `src/code/oracle/turn-guards.ts`, and `src/code/oracle/gate.ts` to recognize pixel-only spacing properties and category-compatible dimension token references.
- Modify `src/ai/agent/tools/semantic-structure.ts`, `semantic-property.ts`, and `insert-fragment.ts` to pass current preset metadata into style preflight; modify `tokens.ts` and `src/ai/mcp/bridge-client.ts` to reject invalid dimension preset values before queuing token mutations.
- Extend the adjacent Vitest suites for Library rows/editor, control menus, Oracle, MCP, and agent token tools; add focused tests if a module has no existing suite.

## Task 1: Shared dimension preset primitives

**Files:**
- Create: `src/shared/dimension-presets.ts`
- Test: `src/shared/dimension-presets.test.ts`
- Read: `src/shared/types.ts` for the canonical `PresetToken` definition

**Interfaces:**
- `DimensionPresetCategory = 'spacing' | 'margin' | 'radius'`.
- `DimensionPresetTier = 'base' | 'md' | 'sm'`.
- `DimensionPresetGroup` contains `name`, `category`, `label`, `tokens`, `base`, optional `md`, and optional `sm`.
- Export `groupDimensionTokens(tokens, category)`, `dimensionPresetTokenName(category, name, tier)`, `dimensionCategoryFromToken(name)`, `findDimensionPresetGroupForToken(tokenName, category, tokens)`, `dimensionPresetValueError(category, value)`, `dimensionStyleValueError(property, value, tokens)`, `dimensionCategoryForProperty(property)`, and `buildDimensionPresetApplyPlan(group, property, viewportWidths)`.
- The apply plan returns `{ baseStyles: Record<string, string>; responsive: Array<{ maxWidth: number; styles: Record<string, string> }> }`; optional tiers always use a CSS `var()` fallback to the base token.

- [x] **Step 1: Write failing utility tests**

Add tests for `space-card`, `space-card-md`, `space-card-sm` grouping; legacy single-token groups; an orphan `space-card-md` staying a base group; and category isolation. Test `dimensionPresetTokenName` for all three tiers in all three categories.

```ts
expect(groupDimensionTokens(tokens, 'spacing')).toMatchObject([
  { name: 'card', base: { name: 'space-card' }, md: { name: 'space-card-md' }, sm: { name: 'space-card-sm' } },
]);
expect(groupDimensionTokens([{ name: 'space-card-md', value: '8px', category: 'spacing' }], 'spacing'))
  .toMatchObject([{ name: 'card-md', base: { name: 'space-card-md' } }]);
```

Test pixel/zero/shorthand acceptance, Margin `auto` and negative px acceptance, and rejection of `clamp()`, `calc()`, `%`, `rem`, `em`, `vh`, `vw`, empty values, and malformed shorthand. Test `dimensionStyleValueError` with known, unknown, cross-category, optional-tier fallback, and property-incompatible references (three-value spacing tokens cannot be applied to `gap`).

```ts
expect(dimensionPresetValueError('spacing', '8px 16px')).toBeNull();
expect(dimensionPresetValueError('margin', '-12px auto')).toBeNull();
expect(dimensionPresetValueError('radius', 'clamp(4px, 1vw, 12px)')).toContain('pixels');
```

Test property compatibility for padding, margin, radius, `gap`, `rowGap`, and `columnGap`. Test the apply plan with default-like widths and custom/reduced width sets; assert the base style uses `var(--<base>)`, tablet/mobile styles use `var(--<tier>, var(--<base>))`, a missing optional tier token still gets a fallback style, and a missing configured viewport produces no band.

- [x] **Step 2: Run the focused utility suite and verify it fails**

Run: `npx vitest run src/shared/dimension-presets.test.ts`

Expected: FAIL because the shared module and exported functions do not exist.

- [x] **Step 3: Implement the pure helper module**

Implement category-to-prefix mapping (`spacing` → `space`, `margin` → `margin`, `radius` → `radius`), tier naming, grouping, input validation, property-category matching, and apply-plan generation. Group a `-md`/`-sm` token as a tier only when its corresponding base token exists; otherwise expose it as a legacy base preset. Derive responsive max-width keys from the provided configured viewport widths, excluding the primary/widest viewport and mapping the next narrower band to Tablet and the following band to Mobile. Add `trace.fn('dimension-presets:group', { category, count })` for grouping calls.

```ts
export type DimensionPresetCategory = 'spacing' | 'margin' | 'radius';
export type DimensionPresetTier = 'base' | 'md' | 'sm';

export function dimensionPresetValueError(category: DimensionPresetCategory, value: string): string | null {
  const parts = value.trim().split(/\s+/);
  const validLength = (part: string) => part === '0' || part === '0px'
    || (category === 'margin' ? /^-?(?:\d+|\d*\.\d+)px$/.test(part) : /^(?:\d+|\d*\.\d+)px$/.test(part));
  if (!value.trim() || parts.length > 4) return 'Use one to four pixel values.';
  if (parts.every(part => validLength(part) || (category === 'margin' && part === 'auto'))) return null;
  return 'Dimension preset values must use pixels; only Margin also supports auto.';
}
```

- [x] **Step 4: Run the focused utility suite and verify it passes**

Run: `npx vitest run src/shared/dimension-presets.test.ts`

Expected: PASS, including the suffix-collision and reduced/custom-breakpoint cases.

- [x] **Step 5: Commit the shared primitive**

```bash
git add src/shared/dimension-presets.ts src/shared/dimension-presets.test.ts
git commit -m "feat: add responsive dimension preset primitives"
```

## Task 2: Grouped preset Library UI and responsive editor

**Files:**
- Create: `src/editor/left-toolbar/panels/LibraryPanel/presets/DimensionPresetGroupRow.tsx`
- Create: `src/editor/left-toolbar/panels/LibraryPanel/presets/DimensionPresetEditContent.tsx`
- Create: `src/editor/left-toolbar/panels/LibraryPanel/presets/DimensionPresetEditContent.test.tsx`
- Create: `src/editor/left-toolbar/panels/LibraryPanel/presets/CategorySection.test.tsx`
- Modify: `src/editor/left-toolbar/panels/LibraryPanel/presets/CategorySection.tsx`
- Modify: `src/editor/left-toolbar/panels/LibraryPanel/index.tsx`
- Test: adjacent `CategorySection`/LibraryPanel tests and new `DimensionPresetEditContent.test.tsx`

**Interfaces:**
- `DimensionPresetEditContent` consumes a `DimensionPresetGroup`, `onUpdate(tokenName, value, category)`, `onDelete(group)`, and `onClose()`.
- Use `dimension-group:<category>:<name>` as the edit/multi-select ID. Keep the folder-tree ID equal to the family's base token name (`space-<name>`, `margin-<name>`, or `radius-<name>`) so existing folders and sort order for legacy one-token presets survive grouping.
- `DimensionPresetGroupRow` follows `TypographyGroupRow`'s row contract: edit, delete, usage badge, shift-click multi-select, and menu override.

- [x] **Step 1: Add failing grouping and row integration tests**

Test that each of the three categories renders a single grouped row for base/md/sm tokens, a legacy lone token still renders, its usage counts include every tier token without duplicate node counts, and multi-delete queues removal of every sibling token. Test category-specific group IDs so `space-card` and `radius-card` do not collide.

```tsx
expect(screen.getByText('Card')).toBeInTheDocument();
expect(screen.getAllByText('Card')).toHaveLength(1);
fireEvent.click(screen.getByRole('button', { name: /delete/i }));
expect(queuedRemovals).toEqual(['space-card', 'space-card-md', 'space-card-sm']);
```

Test the editor's Desktop/Tablet/Mobile selector, active tier value, inherited base value when an optional token is absent, and creation of the tier token only after an edit. Verify invalid values show an error and do not call `onUpdate`.

- [x] **Step 2: Run focused UI tests and verify they fail**

Run: `npx vitest run src/editor/left-toolbar/panels/LibraryPanel/presets/DimensionPresetEditContent.test.tsx src/editor/left-toolbar/panels/LibraryPanel/presets/CategorySection.test.tsx`

Expected: FAIL because the grouped row/editor and grouping integration are absent. The new CategorySection suite should use the existing `presets/PresetRow.test.tsx` and `index.delete.test.tsx` fixtures as local examples for row interactions and queued deletion assertions.

- [x] **Step 3: Implement the editor and wire category grouping**

Reuse `TypographyEditContent`'s `ToolSegmentedControl` tier selector and `SpacingControl`'s px/shorthand behavior. Create `-md`/`-sm` tokens on the first validated edit, update existing siblings thereafter, and trace tier changes, edits, and rejected values. On invalid input call `trace.error('dimension-preset:reject-value', { category, tokenName, reason })` before returning without a mutation. In `CategorySection`, treat each dimension family as one folder item/row; preserve grouping through the existing folder drift fallback and expand group deletion to its tokens. In `LibraryPanel`, open the dimension editor for `dimension-group:` IDs, create a base token for a newly created preset, preserve legacy single-token behavior, and keep color, Border, Shadow, Image, Video, and Typography editors unchanged.

```ts
const tierSuffix = tier === 'base' ? '' : `-${tier}`;
const tokenName = dimensionPresetTokenName(group.category, group.name, tier);
onUpdate(tokenName, nextValue, group.category);
```

- [x] **Step 4: Run the focused UI tests and verify they pass**

Run: `npx vitest run src/editor/left-toolbar/panels/LibraryPanel/presets/DimensionPresetEditContent.test.tsx src/editor/left-toolbar/panels/LibraryPanel/presets/CategorySection.test.tsx src/editor/left-toolbar/panels/LibraryPanel/index.delete.test.tsx`

Expected: PASS, including the existing LibraryPanel deletion behavior.

- [x] **Step 5: Commit the Library UI**

```bash
git add src/editor/left-toolbar/panels/LibraryPanel/presets/DimensionPresetGroupRow.tsx src/editor/left-toolbar/panels/LibraryPanel/presets/DimensionPresetEditContent.tsx src/editor/left-toolbar/panels/LibraryPanel/presets/DimensionPresetEditContent.test.tsx src/editor/left-toolbar/panels/LibraryPanel/presets/CategorySection.test.tsx src/editor/left-toolbar/panels/LibraryPanel/presets/CategorySection.tsx src/editor/left-toolbar/panels/LibraryPanel/index.tsx
git commit -m "feat: edit responsive dimension preset groups"
```

## Task 3: Apply grouped presets to the selected property

**Files:**
- Modify: `src/editor/controls/control-menu-items.ts`
- Modify: `src/editor/controls/ControlLabel.tsx`
- Read: `src/editor/controls/ControlProvider.tsx` for selection and current component-variant write routing
- Test: `src/editor/controls/control-menu-items.test.ts` and a focused ControlLabel integration test

**Interfaces:**
- Add optional `applyDimensionPreset(group, property)` to `MenuContext`.
- Add optional `removeDimensionPreset(property)` to `MenuContext`; on a dimension preset, resolve the family's base and tier values, replace only that property in the base and configured responsive bands, and preserve all other style declarations. Continue using the existing `removePreset` path for non-dimension presets.
- For a page file, write the base reference with one `updateStyles` mutation per selected node, then queue one `updateContainerStyle` mutation per selected node and configured non-primary tier using the shared apply plan; this keeps the base write independent from the currently active replica. Never clear unrelated styles.
- For component/variant files, do not issue page `updateContainerStyle` mutations; preserve base-only preset application through the existing component-aware `updateStyle` route and emit a trace explaining that responsive page bands were not applied.

- [x] **Step 1: Add failing menu/apply tests**

Test that the menu shows one entry per dimension group (not one per suffix), and clicking it invokes `applyDimensionPreset(group, property)` with the selected compatible category. Test base-only legacy groups and ensure non-dimension presets still use the existing `updateStyle` behavior.

```ts
expect(menuItem.label).toBe('Card');
menuItem.onClick();
expect(applyDimensionPreset).toHaveBeenCalledWith(expect.objectContaining({ name: 'card' }), 'padding');
```

Test the ControlLabel application path with two selected page nodes and custom tablet/mobile band widths; verify each receives exactly the selected property, the optional vars fall back to the base, and an existing unrelated `marginTop`/`color` responsive declaration is not cleared. Test removing a dimension preset replaces only the selected property's base/md/sm var refs with the matching resolved token values. Test a component master to prove no `updateContainerStyle` page mutation is queued.

- [x] **Step 2: Run focused menu/control tests and verify they fail**

Run: `npx vitest run src/editor/controls/control-menu-items.test.ts src/editor/controls/ControlLabel.test.tsx`

Expected: FAIL on missing group-aware preset items and dimension apply callback. The existing `ControlLabel.test.tsx` suite is the integration-test home; extend its mock setup for selected ids, viewport widths, and queued mutations.

- [x] **Step 3: Implement grouped menu entries and scoped responsive writes**

Group only dimension categories with `groupDimensionTokens`; keep all other category paths unchanged. Have the menu delegate dimension groups to `applyDimensionPreset` and `removeDimensionPreset`. In `ControlLabel`, read the selected IDs and configured breakpoint band widths, queue the base `{ [property]: baseVar }` as `updateStyles` for each selected page node, then queue only `{ [property]: tierVarWithBaseFallback }` as `updateContainerStyle` for each configured non-primary page tier. For removal, queue the resolved base value and each configured tier's resolved value for the same property. Keep the page/component distinction explicit and add `trace.action` records for apply/remove group, property, nodes, and band widths.

```ts
queueMutation({ type: 'updateStyles', nodeId, styles: { [property]: `var(--${baseToken.name})` } });
queueMutation({
  type: 'updateContainerStyle',
  nodeId,
  maxWidth,
  styles: { [property]: `var(--${tierTokenName}, var(--${baseToken.name}))` },
});
```

- [x] **Step 4: Run focused menu/control tests and verify they pass**

Run: `npx vitest run src/editor/controls/control-menu-items.test.ts src/editor/controls/ControlLabel.test.tsx`

Expected: PASS; confirm no test observes clearing or replacement of any other responsive declaration.

- [x] **Step 5: Commit preset application behavior**

```bash
git add src/editor/controls/control-menu-items.ts src/editor/controls/ControlLabel.tsx src/editor/controls/control-menu-items.test.ts src/editor/controls/ControlLabel.test.tsx
git commit -m "feat: apply responsive dimension presets"
```

## Task 4: Align input, MCP, and Oracle validation

**Files:**
- Modify: `src/code/oracle/checks/style-object.ts`
- Modify: `src/code/oracle/preflight-validation.ts`
- Modify: `src/code/oracle/turn-guards.ts`
- Modify: `src/code/oracle/gate.ts`
- Modify: `src/ai/agent/tools/semantic-structure.ts`
- Modify: `src/ai/agent/tools/semantic-property.ts`
- Modify: `src/ai/agent/tools/insert-fragment.ts`
- Modify: `src/ai/agent/tools/tokens.ts`
- Modify: `src/ai/mcp/bridge-client.ts`
- Test: `src/code/oracle/check-file.test.ts`, `src/code/oracle/preflight-validation.test.ts`, `src/code/oracle/turn-guards.test.ts`, `src/ai/mcp/bridge-client.test.ts`, and `src/ai/agent/tools/tokens.test.ts`
- Create: `src/ai/agent/tools/tokens.test.ts`

**Interfaces:**
- `checkTokenRefs(code, tokens)` receives the current `PresetToken[]`, not only a set of names, so it can check the category associated with each dimensional CSS property.
- Extend `validateStyleInput`'s options with `presetTokens?: PresetToken[]`; pass the current `getPresetTokens()` value from `semantic-structure.ts`, `semantic-property.ts`, and `insert-fragment.ts` so MCP style writes validate variable references before queuing mutations.
- Keep the existing generic unknown-token rule for other properties and keep declarations of local custom properties legal.
- Shared dimension validation runs before the agent/MCP APIs queue `addPresetToken` or `updatePresetToken`; infer category from an existing token or a recognized `space-`/`margin-`/`radius-` prefix when `category` is omitted, and reject a supplied category that conflicts with the dimension token prefix.

- [x] **Step 1: Add failing validation tests**

In Oracle tests, add `gap`, `rowGap`, and `columnGap` to px-only coverage; prove a compatible `var(--space-card)` passes for Padding/Gap, `var(--radius-card)` passes for Radius, and Margin accepts only Margin tokens. Test fallback refs `var(--space-card-md, var(--space-card))`, plus unknown tier refs, cross-category refs, mismatched base fallback, raw `clamp/calc/%/rem/em/vh/vw`, zero, px, and Margin `auto`.

```ts
const validPage = `<div data-id="a" style={{ padding: 'var(--space-card)' }} />`;
const invalidPage = `<div data-id="a" style={{ padding: 'var(--radius-card)' }} />`;
expect(checkTokenRefs(validPage, tokens)).toEqual([]);
expect(checkTokenRefs(invalidPage, tokens)[0]?.code)
  .toBe('DIMENSION_TOKEN_CATEGORY_MISMATCH');
```

In preflight tests, assert dimensions accept px/zero and reject raw `clamp()` and other unsupported units; pass known preset metadata and check compatible fallback refs pass while unknown/cross-category refs fail. In `managePresets` and agent token-tool tests, assert invalid spacing/margin/radius values reject before any token mutation is queued; verify valid px and Margin `auto` values still write. Include the optional-tier fallback and unchanged typography `clamp()` case in the relevant Oracle/MCP test.

- [x] **Step 2: Run focused validation/API tests and verify they fail**

Run: `npx vitest run src/code/oracle/check-file.test.ts src/code/oracle/preflight-validation.test.ts src/code/oracle/turn-guards.test.ts src/ai/mcp/bridge-client.test.ts src/ai/agent/tools/tokens.test.ts`

Expected: FAIL because gap units, category-aware dimension references, preflight token checks, and preset API guards are not implemented. Create `src/ai/agent/tools/tokens.test.ts` using the setup pattern from `src/ai/agent/tools/semantic-property.test.ts`.

- [x] **Step 3: Implement validation across all write paths**

Use the shared validator before UI/MCP/agent preset writes. Add `gap`, `rowGap`, and `columnGap` to Oracle and preflight spacing-property sets. Extend preflight options and all three agent style-tool call sites with current preset metadata. Update `badSpacingUnit` so valid dimension `var()` expressions reach the token guard instead of being treated as a non-pixel unit; direct non-pixel strings remain rejected. Pass preset token metadata from `gate.ts` into `checkTokenRefs`, parse dimensional properties in JSX style objects, and enforce known category compatibility plus the matching base-token fallback for optional `-md`/`-sm` references. Trace rejected MCP/agent dimension values with category, token name, and validation reason. Do not relax arbitrary non-dimension token checks or typography rules.

```ts
const presetTokens = getPresetTokens();
if (f.code.includes('var(')) vs.push(...checkTokenRefs(f.code, presetTokens));
```

- [x] **Step 4: Run focused validation/API suites and verify they pass**

Run: `npx vitest run src/code/oracle/check-file.test.ts src/code/oracle/preflight-validation.test.ts src/code/oracle/turn-guards.test.ts src/ai/mcp/bridge-client.test.ts src/ai/agent/tools/tokens.test.ts`

Expected: PASS; typography `clamp()` tests remain unchanged and passing.

- [x] **Step 5: Commit validation parity**

```bash
git add src/code/oracle/checks/style-object.ts src/code/oracle/preflight-validation.ts src/code/oracle/turn-guards.ts src/code/oracle/gate.ts src/ai/agent/tools/semantic-structure.ts src/ai/agent/tools/semantic-property.ts src/ai/agent/tools/insert-fragment.ts src/ai/agent/tools/tokens.ts src/ai/mcp/bridge-client.ts src/code/oracle/check-file.test.ts src/code/oracle/preflight-validation.test.ts src/code/oracle/turn-guards.test.ts src/ai/mcp/bridge-client.test.ts src/ai/agent/tools/tokens.test.ts
git commit -m "fix: validate responsive dimension presets consistently"
```

## Task 5: End-to-end verification and review

**Files:**
- Test: focused suites from Tasks 1–4, then repository-wide tests and typecheck
- Review: all implementation diffs, with `MCP_V2_ISSUES.md` excluded because it is a pre-existing unrelated user change

- [x] **Step 1: Run all focused suites together**

Run the utility, Library UI, control-menu, Oracle/preflight, MCP, and agent token suites listed above.

Expected: PASS with no shared-state leakage between suites.

- [x] **Step 2: Run the complete Vitest suite**

Run: `npx vitest run --reporter=dot --maxWorkers=2`

Result: 14,916 tests passed, 36 skipped, 5 todo; 3 unrelated tests fail because the repository fixture `data/projects/proj-1791960645579-j02nu7.json` is absent. The same three failures were present in the pre-change baseline. All feature-focused suites pass.

- [x] **Step 3: Typecheck**

Run: `npx tsc --noEmit`

Expected: PASS, including `PresetToken` category narrowing, menu callback types, and responsive mutation types.

- [x] **Step 4: Review the final diff and working tree**

Run: `git diff --check`, `git status --short`, and `git diff --stat`; confirm the only uncommitted pre-existing change remains `MCP_V2_ISSUES.md` and is not included in any feature commit.

Expected: clean whitespace checks; only the explicitly preserved user change is outside the feature commits.

- [x] **Step 5: Commit the approved design and plan documents**

```bash
git add docs/superpowers/specs/2026-10-24-responsive-dimension-presets-design.md docs/superpowers/plans/2026-10-24-responsive-dimension-presets.md
git commit -m "docs: plan responsive dimension presets"
```

- [x] **Step 6: Final review handoff**

Review each feature commit and verify they contain only the files listed in their task. Do not commit `MCP_V2_ISSUES.md`. Report the focused/full tests and typecheck results, and link the final files for the user.
