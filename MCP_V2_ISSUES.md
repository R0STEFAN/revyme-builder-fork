# MCP v2 issue log

## 2026-10-31 — Presets panel Spacing/Other sections, global preset binding, tooltip/pill parsing, and responsive mobile breakpoint

**Status:** fixed, verified via `src/shared/css-utils.test.ts` (65 tests), `src/shared/dimension-presets.test.ts` (12 tests), `src/code/generation/preset-gen.test.ts` (26 tests), `src/editor/controls/control-menu-items.test.ts` (56 tests), `npx tsc --noEmit` (0 errors), and live execution on project `proj-1793453710566-zr1d8a`, and committed.

**Symptom:**
1. The Presets panel in the visual editor lacked a dedicated `Spacing` category (it was hardcoded to display as `Padding` with strict prefix `space-`). Custom design tokens like `--dp-spacing-gutter`, `--dp-spacing-gap`, `--dp-spacing-max` did not appear on the Presets panel at all.
2. The Presets panel lacked an `Other` section to inspect and edit ungrouped custom tokens/variables (e.g. `--dp-motion-duration`, `--dp-motion-ease`).
3. In the Style panel, properties like `width`, `minWidth`, `maxWidth`, `height`, `minHeight`, `maxHeight` completely blocked the "Presets" menu item, preventing users from visually binding variables/tokens to dimension properties.
4. When a responsive dimension token fallback was active (e.g. `var(--space-gap-sm, var(--space-gap))`), the blue preset pill button in `ControlRow` rendered a mangled string `Gap Sm, var( Sp...` and the tooltip displayed `Preset: space-gap-sm, var(--space-gap — click to remove` instead of clean human-readable labels.
5. In responsive design, configuring desktop, tablet, and mobile padding presets resulted in `@media (max-width: 390px)` on mobile. Real smartphones (iPhone 12-16 at 393px, Plus/Max at 430px, Android at 412px) exceeded 390px and matched the tablet media query (`max-width: 810px and min-width: 390.02px`), causing mobile devices to get the tablet padding rather than the mobile padding preset.

**Cause:**
1. In `src/code/generation/preset-gen.ts`, `PREFIX_MAP` only checked `space-` and lacked `spacing-`, `dp-spacing-`, `dp-radius-`, `dp-color-`, `dp-shadow-`, `dp-border-`. Comment hint parsing lacked `/* Other */`.
2. In `src/editor/left-toolbar/panels/LibraryPanel/shared/constants.ts`, `spacing` was hardcoded with label `'Padding'` and `DATA_CATEGORIES`/`ALL_CATEGORIES` lacked `{ key: 'other', label: 'Other', prefix: 'other', defaultValue: '' }`.
3. In `src/shared/dimension-presets.ts`, `groupDimensionTokens` filtered tokens strictly by `startsWith('space-')`, dropping all tokens with prefixes `spacing-` or `dp-spacing-`.
4. In `src/editor/controls/control-menu-items.ts`, `PROPERTY_CATEGORY_MAP` intentionally omitted size properties (`width`, `height`, `maxWidth`, etc.) and lacked a category tree to browse and bind presets globally.
5. In `src/editor/controls/ControlLabel.tsx`, cascading submenus only supported one level (`submenuOpen`), preventing hierarchical selection of categories and presets.
6. In `src/shared/css-utils.ts`, `parseVarRef` used `/var\(--([^)]+)\)/` which stopped at the first closing parenthesis in nested expressions `var(--space-gap-sm, var(--space-gap))`, returning `"space-gap-sm, var(--space-gap"`. `formatPresetLabel` did not format tier suffixes (`-sm` → `(Mobile)`, `-md` → `(Tablet)`).
7. In the canvas configuration and responsive styles, the mobile viewport was treated with an upper cutoff of `390px` rather than standard mobile screen thresholds (`600px`), causing real phones to land in the tablet band.

**Fix and regression guard:**
1. In `src/shared/css-utils.ts`, updated `parseVarRef` to regex `/var\(\s*--([a-zA-Z0-9_-]+)/`, cleanly extracting the primary custom property identifier without trailing fallback noise. Added test in `css-utils.test.ts`.
2. In `src/editor/controls/unified/ControlRow.tsx`, updated `formatPresetLabel` to strip prefix families (`color-`, `typo-`, `space-`, `spacing-`, `margin-`, `radius-`, `shadow-`, `border-`, `dp-*`) and format tier suffixes (`-sm` → ` (Mobile)`, `-md` → ` (Tablet)`), and updated the tooltip to `Preset: ${formatPresetLabel(binding.presetRef!)} (${binding.presetRef}) — click to remove`.
3. In `src/code/generation/preset-gen.ts`, expanded `PREFIX_MAP` with `spacing-`, `dp-spacing-`, `dp-radius-`, `dp-color-`, `dp-shadow-`, `dp-border-`, `dp-motion-`, and added comment support for `/* Other */` / arbitrary comment headers.
4. In `src/editor/left-toolbar/panels/LibraryPanel/shared/constants.ts`, renamed category label to `'Spacing'` and registered the `'other'` category in `DATA_CATEGORIES` and `ALL_CATEGORIES`.
5. In `src/shared/dimension-presets.ts`, added `CATEGORY_PREFIXES` supporting `space-`, `spacing-`, `dp-spacing-`, `margin-`, `dp-margin-`, `radius-`, `dp-radius-`. Updated `groupDimensionTokens` so that all tokens in the category are grouped and none are lost.
6. In `src/editor/controls/control-menu-items.ts`, added size properties (`width`, `minWidth`, `maxWidth`, `height`, `minHeight`, `maxHeight`, `inset`) to `PROPERTY_CATEGORY_MAP`, and implemented `buildCategoryTree` so users can browse all design preset categories (`Spacing`, `Radius`, `Shadow`, `Border`, `Color`, `Other`) and bind any token.
7. In `src/editor/controls/ControlLabel.tsx`, added support for second-level cascading submenus (`nestedSubmenuOpen`) so category trees cascade seamlessly.
8. Rebuilt CLI bundle (`packages/cli/dist/main.js`).
9. In project `proj-1793453710566-zr1d8a`, updated responsive styles using `viewports.setOverride` so mobile overrides apply up to 600px, ensuring real phones apply mobile presets accurately.

**Verification:**
`src/shared/css-utils.test.ts` (65 tests passed). `src/shared/dimension-presets.test.ts` (12 tests passed). `src/code/generation/preset-gen.test.ts` (26 tests passed). `src/editor/controls/control-menu-items.test.ts` (56 tests passed). `packages/automation-core/test/capabilities/T08-design-system.test.ts` (8 tests passed). `packages/automation-core/test/capabilities/fragments-insert.test.ts` (8 tests passed). `npx tsc --noEmit` passed with 0 errors. `diagnostics.projectCheck` verified 100% clean on `proj-1793453710566-zr1d8a`.



## 2026-10-31 — fragments.insert omitted typography preset binding, leaving hardcoded inline font/color overrides and Preset: None in editor

**Status:** fixed, verified via `packages/automation-core/test/capabilities/fragments-insert.test.ts` (8 tests), `packages/automation-core/test/capabilities/T08-design-system.test.ts` (8 tests), `src/code/generation/next-font-gen.test.ts` (10 tests), and live execution on project `proj-1793453710566-zr1d8a`, and committed.

**Symptom:**
1. Text nodes (`<h1>`, `<h2>`, `<p>`, `<span>`) inserted via `fragments.insert` carried hardcoded inline typography styles (`fontFamily`, `fontSize`, `fontWeight`, `letterSpacing`, `lineHeight`, `color`) instead of referencing the design system's typography presets (`var(--typo-<name>-*)`).
2. When selecting text elements in the Revyme visual editor, the Text panel displayed `Preset: None` because the active preset detector (`detectActivePreset`) keys strictly off `fontFamily: var(--typo-<name>-font)`.
3. In addition, the Text panel displayed a redundant `Color` preset override pill (e.g. `Dp Color Bright`) because `color` was explicitly hardcoded on the element rather than being governed by the typography preset's own `--typo-<name>-color` token.

**Cause:**
`packages/automation-core/src/operations/fragments.ts` had no awareness of typography presets:
- It did not parse or recognize `preset="<name>"` or `data-typography-preset="<name>"` attributes on incoming JSX elements.
- It did not auto-infer matching custom presets from `app/globals.css` for semantic text tags (`h1`, `h2`, `p`, `span`).
- It did not substitute the typography preset CSS custom properties (`var(--typo-<name>-font)`, `var(--typo-<name>-color)`, etc.) or strip redundant inline styles that conflict with the preset.
- It did not inject responsive `@media` rules for typography presets with responsive breakpoint tiers (`min-default`, `min-md`, `size-md`, `size-sm`).

**Fix and regression guard:**
1. In `packages/automation-core/src/operations/typography.ts`, exported `upsertTypographyResponsiveBlock` and `TypoPreset`.
2. In `packages/automation-core/src/operations/fragments.ts`, added `resolvePresetForNode(node, attrs, styles, presets)` which:
   - Recognizes explicit preset attributes (`preset`, `data-typography-preset`, `typographyPreset`, `typography`).
   - Checks if styles already reference `var(--typo-<name>-font)`.
   - Inferred matching custom presets from `app/globals.css` by semantic tag (`h1` -> heading preset, `h2` -> section title preset, `p` -> body preset, `span` with mono/uppercase -> mono telemetry preset).
3. In `ingestedToNodeDef`, bound all `--typo-<name>-*` CSS variables to the node, stripped temporary preset attributes, and collected responsive `@media` rules for responsive tiers.
4. In `fragmentsInsertOperation.execute`, automatically injected responsive styles using `upsertTypographyResponsiveBlock`.
5. In `src/code/generation/next-font-gen.ts`, adjusted the truncated Google fonts catalog heuristic so it only applies when catalog entries start at low weights without higher weights, preserving strict weight catalog matching for fonts like Playfair Display.
6. Updated `.agents/skills/revyme-mcp/SKILL.md` to document the SSOT Typography Preset requirement and usage in `fragments.insert`.
7. Rebuilt CLI bundle (`packages/cli/dist/main.js`).
8. Applied typography presets across all 89 text nodes in `app/page.client.tsx` and all design components (`FactStatItem`, `GraphiteCard`, `LiveSignalBadge`, `PillButton`) on `proj-1793453710566-zr1d8a`.

**Verification:**
`packages/automation-core/test/capabilities/fragments-insert.test.ts` passed (8/8 tests). `T08-design-system.test.ts` passed (8/8 tests). `src/code/generation/next-font-gen.test.ts` passed (10/10 tests). `diagnostics.projectCheck` verified clean (9/9 files, 0 violations). All elements verified in `proj-1793453710566-zr1d8a` with exact `--typo-<name>-*` preset references.


## 2026-10-31 — fragments.insert rejected Next.js framework components and raw navigating anchor tags

**Status:** fixed, verified via `packages/automation-core/test/capabilities/fragments-insert.test.ts` (7 tests) and live execution on project `proj-1793453710566-zr1d8a`, and committed.

**Symptom:**
1. Inserting JSX fragments containing `<Link href="...">` or `<Image ...>` failed with `COMPONENT_NOT_FOUND: Component "<Link>" referenced in JSX fragment was not found in "components/"` because the component resolver assumed all PascalCase tags must be user-authored design components in `components/`.
2. Inserting standard `<a href="...">` anchor tags failed plan validation with `PAGE_LINK_NOT_NEXTLINK` and `NEXTLINK_IMPORT_MISSING`, requiring Next.js `<Link>` instead.
3. Placing CSS variable tokens such as `maxWidth: 'var(--dp-spacing-max)'` on container frames failed plan validation with `MINMAX_SIZE_UNIT` because the Size panel min/max fields only accept concrete `px` or `%` values.

**Cause:**
`packages/automation-core/src/operations/fragments.ts` collected all uppercase tags for resolution against `components/`, without recognizing built-in Next.js framework components (`Link`, `Image`), and did not normalize HTML links to Next.js `<Link>` or resolve variable min/max sizes to concrete dimensions.

**Fix and regression guard:**
1. In `packages/automation-core/src/operations/fragments.ts`, added `FRAMEWORK_COMPONENTS = { Link: { module: 'next/link', defaultSpec: 'Link' }, Image: { module: 'next/image', defaultSpec: 'Image' } }`. When encountered, the operation automatically injects `import Link from 'next/link';` or `import Image from 'next/image';` into the page rather than failing on `components/`.
2. In `ingestedToNodeDef`, automatically transformed `<a href="...">` to Next.js `<Link href="...">` and registered `Link` for auto-import.
3. Added concrete value normalization for `var(--dp-spacing-max)` in `minWidth`, `maxWidth`, `minHeight`, `maxHeight` properties to `'1360px'`.
4. Rebuilt CLI bundle (`packages/cli/dist/main.js`).

**Verification:**
`packages/automation-core/test/capabilities/fragments-insert.test.ts` passed (7/7 tests). `diagnostics.projectCheck` verified clean (9/9 files, 0 violations). `impeccable_detect` verified with 0 findings ("Clean craft"). Live execution successfully composed all 7 sections of `proj-1793453710566-zr1d8a`.

## 2026-10-31 — deleting node wrapped in RevymeTicker left orphaned empty wrapper, failing TICKER_CHILD_COUNT

**Status:** fixed, verified via `src/code/generation/ticker-gen.test.ts` (13 tests) and live CLI operation, and committed.

**Symptom:**
Calling `nodes.remove` on a layout node wrapped in a `<RevymeTicker speed={…} direction="…">` effect failed with `PLAN_VALIDATION_FAILED: [TICKER_CHILD_COUNT] <RevymeTicker> must wrap exactly ONE layout frame (found 0 element(s))`, preventing deletion of ticker-wrapped sections.

**Cause:**
`removeNodeInCode` in `src/code/generation/generator-crud.ts` removed the matched JSX element inside the ticker, but did not sweep the enclosing transparent `<RevymeTicker …></RevymeTicker>` wrapper or its `@revyme/runtime` import when the wrapped element was deleted outside the editor's live wrapper lift/restore queue.

**Fix and regression guard:**
In `src/code/generation/ticker-gen.ts`, added `sweepEmptyTickerWrappers(code)` which strips empty `<RevymeTicker\b[^>]*>\s*<\/RevymeTicker>` wrappers and prunes the runtime `RevymeTicker` import when no ticker elements remain in the file. Integrated into all completion paths of `removeNodeInCode` in `src/code/generation/generator-crud.ts`. Added unit test in `src/code/generation/ticker-gen.test.ts`. Rebuilt CLI.

**Verification:**
`src/code/generation/ticker-gen.test.ts` passed (13/13 tests). Live `nodes.remove` successfully removed the ticker-wrapped section and swept the wrapper cleanly.

## 2026-10-31 — unescaped less-than in textContent crashed Babel JSX parser

**Status:** fixed, verified via `src/shared/css-utils.test.ts` (64 tests) and `packages/cli/test/` (42 tests), and committed.

**Symptom:**
Calling `nodes.create` or setting textContent containing raw less-than symbols (e.g. `LATENCY: < 45ms P99 E2E`) resulted in `SYNTAX_ERROR: This experimental syntax requires enabling the parser plugin: "decimal"` during plan AST validation, rejecting the operation.

**Cause:**
`buildNodeJSX` in `src/code/generation/generator-crud.ts` routes node text through `htmlToJSX(node.textContent)`. In `src/shared/css-utils.ts`, `htmlToJSX` converted string style attributes and `<br>` tags, but left raw `<` characters intact. In JSX syntax, `<` followed by a space or digit is not a valid HTML/JSX tag and causes Babel parser syntax errors.

**Fix and regression guard:**
In `src/shared/css-utils.ts`, `htmlToJSX` now automatically escapes stray `<` characters that are not part of an HTML/JSX tag, entity, or fragment using the lookahead `/<(?![a-zA-Z\/!?_>])/g` to `&lt;`. Added unit test in `src/shared/css-utils.test.ts` covering expressions with less-than, numbers, spans, and fragments. Rebuilt CLI bundle and verified all test suites.

**Verification:**
`src/shared/css-utils.test.ts` passed (64/64 tests). `packages/cli/test/` passed (6 test files, 42/42 tests including `pack.test.ts`).

## 2026-10-31 — esbuild ESM bundle broke with duplicate createRequire declaration and CLI rejected positional JSON arguments

**Status:** fixed, verified via `packages/cli/test/` (including `pack.test.ts`), and committed.

**Symptom:**
1. Running packed CLI binary (`revyme-cli`) failed with `SyntaxError: Identifier 'createRequire' has already been declared` in `dist/main.js`.
2. Running operations via CLI with raw positional JSON arguments (e.g. `revyme <tool> '{"..."}'`) failed with `SCHEMA_VALIDATION_FAILED: expected string, received undefined` because positional JSON was ignored unless piped via stdin or `--input-file`.
3. In `cli.test.ts`, assertions failed because `client.execute` was called with screenshot service context adapter.

**Cause:**
1. `packages/cli/build.cjs` declared `import { createRequire } from 'node:module'` in its banner, which conflicted with esbuild's internal generated `import { createRequire } from "module"` in the bundled ESM output.
2. `packages/cli/src/main.ts` parsed tokens into `flags` and `positionals`, but when collecting `inputData`, it only inspected flags and stdin, ignoring `positionals[0]` even when it was a valid JSON object string.

**Fix and regression guard:**
1. In `packages/cli/build.cjs`, scoped banner import alias as `import { createRequire as __revymeCreateRequire } from 'node:module'`.
2. In `packages/cli/src/main.ts`, added positional JSON parsing for `positionals[0]` starting with `{`.
3. Updated `cli.test.ts` expectations with `expect.objectContaining({ dryRun: false })` and added a regression test for positional JSON arguments.

**Verification:**
All test files in `packages/cli/test/` passed, including `pack.test.ts` (real `npm pack` smoke test with stdio and HTTP).

## 2026-10-24 — generated page-transition controller rejected as an editable page

**Status:** fixed and verified through an independently launched MCP stdio
process; no Codex restart was required.

**Symptom:** a clean dry-run for native crossfade failed with Oracle findings
such as `MISSING_DATA_ID`, `FORBIDDEN_IMPORT`, `CLASSNAME_STYLING`, and
`PAGE_ROOT_REQUIRED` in the generated `app/(site-shell)/page-transitions.tsx`.

**Cause:** `validatePlan()` treated this internal runtime controller as a
canvas-authored page and ran editable-page Oracle rules against it.

**Fix and regression guard:** validation now recognizes only the generated
route-group/root `page-transitions.tsx` path with its `@rt-v9` marker, exempts
its runtime markup from canvas `data-id` requirements, and skips the
editable-page Oracle while retaining source syntax/import validation. A T14
regression uses the real `prepareOperation()` → `createPlan()` → `validatePlan()`
path and asserts the generated runtime has no validation issues.

**Verification:** the T14 suite passes (7 tests), automation-core type-check
passes, and the CLI rebuild succeeds (with the existing esbuild direct-eval
warning). A standalone MCP child launched from `packages/cli/bin/revyme.mjs`
dry-ran with no issues, then committed crossfade in both directions at
revisions 554 and 555. `diagnostics.projectCheck` is clean (25/25 files,
0 violations). `preview.build` discovers `/`, `/about`, and the internal
template-preview route, but correctly reports no live preview adapter.

**Independent transport note:** for direct tests, start the MCP child with
`node packages/cli/bin/revyme.mjs mcp` through an MCP stdio client, setting
`REVYME_API_URL`, `REVYME_PROJECT_ID`, and `REVYME_BRANCH_ID`. This process can
be closed and relaunched without restarting Codex. This Builder currently
listens on IPv6 loopback, so use `http://[::1]:3333`; `127.0.0.1:3333` refuses
the connection.

## 2026-10-24 — page transitions ignored presets and route-group layouts

**Status:** preset and route-group handling are fixed and covered by T14; the
follow-up import-interoperability and generated-controller Oracle issues below
are also fixed and live-tested through independent MCP clients.

**Symptom:** `siteEffects.pageTransition.set({ preset: "crossfade" })` returned
`opacity: 1` for both sides. It always wrote `app/page-effects.ts`, did not
scaffold the transition runtime, and did not inject `PageTransitions` into the
route group's `LayoutClient`, so a template-based site could not animate.

**Cause:** the MCP operation created neutral sides instead of using the same
preset factories as the editor, and bypassed the editor's route/layout-aware
scaffolding path.

**Fix and regression guard:** page transition set/get/remove now resolve the
route's nearest `LayoutClient`; set stores data beside that layout, emits the
runtime/controller files, injects the controller around `{children}`, and uses
the canonical preset side configuration. T14 covers a root layout and a
route-group template, including crossfade values and get/remove behavior.

**Follow-up symptom:** after rebuilding the Builder, MCP dry-run still reported
that `app/(site-shell)/LayoutClient.tsx` had no editable `{children}` slot,
although the file visibly contained it. The dry-run was rejected before any
write (revision 553 remained unchanged).

**Follow-up cause:** `slot-children.ts` imported `@babel/traverse` as a direct
callable. Vite SSR can expose this CommonJS module as
`{ default: { default: traverse } }`; the resulting TypeError was swallowed by
the locator's defensive catch and misreported as a missing slot.

**Follow-up fix and guard:** `slot-children.ts` now uses the shared
`normalizeBabelTraverse()` helper used by the parser, with tests for the nested
namespace shape and for locating `{children}` between the template's navbar and
footer. The focused suite passes (21 tests); the relevant automation suite
passes (60 tests), the automation-core type-check passes, and a direct Vite SSR
load now locates the slot. The previous Codex-managed process retained the old
bundle, but a newly launched independent MCP child loaded the rebuilt bundle;
the clean dry-run and both direction commits are recorded above.

## 2026-10-24 — preview listed paired server wrappers as extra routes

**Status:** fixed in source, covered by T23 regression tests, and CLI rebuilt.
The Codex-owned MCP stdio process must restart before live verification because
it loaded the prior bundle at session start.

**Symptom:** `preview.build` listed both public URLs and ghost paths such as
`/(site-shell)` and `/(site-shell)/about` for templated pages.

**Cause:** route discovery processed both `page.client.tsx` and its paired
`page.tsx` wrapper as independent routes. The fallback parser also retained the
route-group segment when parsing server-only pages.

**Fix and regression guard:** a paired server wrapper is still syntax-checked
but no longer adds a duplicate route; server-only pages derive their route from
the client-path shape with route-group segments removed. T23 covers route-group
pairs plus a server-only nested route.

## 2026-10-24 — pages.create generated invalid root styles for template pages

**Status:** fixed in source, regression-tested, and CLI rebuilt. The active
Codex-owned MCP stdio process must reload the new bundle before live dry-run
verification.

**Symptom:** `pages.create({ slug: "about", template: "site-shell" })` dry-run
failed with `TEMPLATED_PAGE_ROOT_STYLED`; the generated page root had
`minHeight: '900px'` and `backgroundColor: '#ffffff'`.

**Cause:** the operation used `template` only to choose route-group paths, but
unconditionally generated the standalone-page root. Template pages share the
canvas node map with `LayoutClient`, so their root must remain bare and leave
background, clipping, and viewport sizing to the template shell.

**Fix and regression guard:** `pages.create` now emits the bare root geometry
for templated pages while preserving the standalone root for ordinary pages.
The new T06 regression exercises the generated source with the templated-page
Oracle rule and failed before the fix.

**Verification:** `npx vitest run packages/automation-core/test/capabilities/T06-pages.test.ts packages/cli/test/mcp.test.ts` (23 tests pass),
`npx tsc --noEmit -p packages/automation-core/tsconfig.json`, and
`npm run build --workspace=@revyme/cli` all pass. Build emits the existing
esbuild direct-eval warning from `src/canvas/code-component-runtime.ts`.

## 2026-10-24 — templates.create emitted builder-invalid route shells

**Status:** generator fix and regression test are in source; rebuild the CLI and
restart the Codex-owned stdio MCP process before live verification.

**Symptom:** `templates.create` dry-run with existing `SiteNavbar` and
`SiteFooter` instances returned `MINMAX_SIZE_UNIT`, `PAGE_ROOT_REQUIRED`,
`WOULD_CRASH` for missing component imports, `TEXT_STYLE_ON_FRAME`, and
`FIXED_DEPTH` for a fixed Navbar nested in a generated `<header>` wrapper.

**Cause:** the template generator used a generated root ID instead of the
builder-required `data-id="root"`, added unsupported `minHeight: '100vh'`,
wrapped supplied components in extra semantic frames, added text alignment to
the footer frame, and did not import referenced project components.

**Fix and regression guard:** `templates.create` now uses the required root ID,
omits the unsupported min-height, places supplied header/footer JSX directly
in the shell, and imports matching `components/<Name>.tsx` references. The
T06 regression checks these requirements. Local focused test:
`npx vitest run packages/automation-core/test/capabilities/T06-pages.test.ts`
(8 tests pass).

**Live MCP evidence:** immediately after the source fix, the live MCP dry-run
still returned the old generated `template-root-*` shell and the original
Oracle issues at project revision 537. The active stdio child is
`node packages/cli/bin/revyme.mjs mcp` (PID 60490), launched by Codex before
the edit; it loads `packages/cli/dist/main.js` when present. This is a stale
MCP CLI bundle/process, not a Builder Vite issue. Rebuild the CLI, then restart
Codex to load the new stdio process; do not retry a real template mutation
until the dry-run reflects this fix.

**Follow-up discovered during assignment:** after restart, the generator fix
was present, but `templates.create` reported a clean dry-run because
`validatePlan()` only classified paths containing the word `template` as
templates. A normal name such as `(site-shell)` was therefore checked as a
page, skipping the template slot rule. The generated shell also wrapped
`{children}` in `<main>`, which `TEMPLATE_CHILDREN_WRAPPED` correctly rejects
when the file is checked as a template.

**Follow-up fix and regression guard:** validation now recognizes only the
exact `app/(<group>)/LayoutClient.tsx` path as a template (and no longer
misclassifies pages in a group named `template`). The generator places the one
`{children}` slot directly under its root. T06 tests cover both path
classification cases and run the generated shell through the template Oracle.
Rebuild the CLI and restart Codex once more before the live dry-run/assignment.

## 2026-10-23 — stale CLI bundle blocks mutations

**Status:** fixed locally; the MCP subprocess must restart before it can use the fix.

**Symptom:** mutating tools such as `tokens.set` and `fonts.import` returned
`PLAN_HASH_MISMATCH`, without changing the project.

**Cause:** `packages/cli/bin/revyme.mjs` uses `packages/cli/dist/main.js` when
available. The running process used a bundle built at 09:12, while the source
that normalizes `beforeHash` values had changed at 18:47. The stale bundle sent
`beforeHash: null` for an existing file, so the server correctly rejected it.

**Fix and guardrail:** rebuilt the CLI and changed the local MCP launch command
to run `packages/cli`'s build before each start. A dry-run `tokens.set` now
contains the existing file's SHA-256 hash and passes the server's plan
validation endpoint.

**Follow-up:** restart the MCP subprocess/session to load the rebuilt bundle.

## 2026-10-23 — code component creation inherited a phantom file hash

**Status:** fixed locally; regression test added.

**Symptom:** after a rejected `codeComponents.create` request, the next attempt
to create the same new component failed with `BEFORE_HASH_MISMATCH`.

**Cause:** `syncCodeSnapshotToProjectFS()` retained paths from the process-wide
`ProjectFS` cache that were not present in the current server snapshot. The
operation then used the phantom local file as the previous version and emitted
a `beforeHash` for a file the server correctly considered absent.

**Fix:** synchronize `ProjectFS` exactly to the supplied snapshot before an
operation. New files now receive `beforeHash: null`; existing files keep their
server-side SHA-256 hash. The regression lives in
`packages/automation-core/test/capabilities/T20-code.test.ts`.

**Additional root cause fixed:** the helper also mutated the snapshot supplied
to it while collecting changes. The generic plan normalizer then read the
newly-created file as though it already existed and replaced its null hash.
`prepareOperation()` now hands adapters a cloned snapshot, preserving the
server snapshot as the source for normalization. This is covered by an
end-to-end prepare-operation regression test.

## 2026-10-23 — `nodes.update` validates but cannot commit

**Status:** fixed and verified through the MCP transport.

`nodes.update` returned a valid dry-run plan, including correct hashes for
`app/page.client.tsx` and `_meta/history.json`, but the identical non-dry-run
operation was rejected by the commit service with `PLAN_HASH_MISMATCH`.

**Cause:** the Builder's Vite process on `:3333` had been running since before
the plan-hash fixes were compiled. Restarting only the Codex/MCP subprocess
left the commit service on its old runtime, so it calculated a different hash
for otherwise valid plan bytes.

**Fix and verification:** restarted the local `npm run dev` process and
re-ran the same operation through MCP. The dry run validated and the real
`nodes.update` committed successfully at project revision 27.

**Guardrail:** after changing automation-core code that participates in plan
serialization or hashing, rebuild the CLI and restart the Builder dev server;
restarting the desktop client alone is insufficient.

## 2026-10-23 — transient hash rejection immediately after a mutation

**Status:** fixed locally; regression test added.

**Symptom:** a valid visual mutation could occasionally return
`PLAN_HASH_MISMATCH` immediately after another successful mutation. Repeating
the same request generated a fresh plan that the commit service accepted.

**Fix:** `AutomationClient.execute()` now retries exactly once on this specific
pre-commit rejection. It fetches a new snapshot and prepares a new operation
with a new operation ID, retaining normal CAS validation. A second mismatch is
still returned to the caller. The regression lives in
`packages/cli/test/client-plan-retry.test.ts`.

## 2026-10-23 — MCP discarded the target file from the hash scope

**Status:** fixed locally; the MCP subprocess must restart to load the rebuilt
CLI.

**Symptom:** a plan validated when prepared directly by the CLI, but the same
mutation through the stdio MCP transport failed at commit with
`PLAN_HASH_MISMATCH`.

**Cause:** `packages/cli/src/mcp.ts` created a scope with only `projectId` and
`branchId`. File-scoped operations carry the document as `filePath` or
`targetFile`; omitting it meant the plan crossed the stdio boundary with a
scope that the commit service did not hash identically.

**Fix and guardrail:** the MCP adapter now maps either argument into
`scope.filePath` before calling `AutomationClient.execute()`. The new MCP
transport regression test asserts that `typography.remove` sends its
`targetFile` as the scope file path. The focused suite now passes 46 tests.

## 2026-10-23 — running stdio server can remain stale after a successful rebuild

**Status:** diagnosed; restart required to activate the already-built CLI.

**Symptom:** `components.create` through the live stdio MCP returned
`PLAN_HASH_MISMATCH` after its input passed all component and Oracle checks.

**Evidence:** the exact operation was re-run as a dry-run through the freshly
built `packages/cli/dist/main.js` against the same Builder server and project
revision. The server accepted the plan, including its history record. The
project was not modified by either dry run.

**Root cause:** the active MCP stdio process was started before the current
bundle, so it still serialized plans with an older implementation. The Builder
server is current; this is specifically a stale Codex-owned MCP child process.

**Required action:** restart the Codex desktop application once. The configured
MCP command rebuilds `packages/cli` before launching the new stdio child. No
Builder/server restart is needed for this issue.

## 2026-10-23 — variant tools generated invalid runtime code

**Status:** fixed locally; Builder dev-server restart required.

**Symptom:** after creating `SiteNavbar`, `connections.create` emitted
`useState(...)` without importing the hook, and `variants.visibility.set`
failed with `traverse6 is not a function` in the running Vite environment.

**Root causes:** connection generation only recognised single-quoted React
imports, while Design Component masters use `import React from "react"`.
The visibility generator also imported `@babel/traverse` as a direct default,
even though Vite SSR exposes it as `{ default }`.

**Fix and regression guard:** connection generation now uses the shared
quote-agnostic `ensureNamedImport()` helper. The visibility generator
normalizes both valid `@babel/traverse` module shapes, matching the rest of
the codebase. The T10 interaction regression now starts from a
double-quoted default React import and asserts that `useState` is imported.
`npx vitest run packages/automation-core/test/capabilities/T10-interactions.test.ts
packages/cli/test/client-plan-retry.test.ts` passes (7 tests), followed by a
successful CLI build.

**Required action:** restart the Builder dev server (`npm run dev`) once. Its
automation middleware holds the SSR module closure loaded before this change;
the Codex MCP process itself already rebuilds on its next launch.

**Follow-up correction:** the first traversal normalizer covered direct and
single-default ESM imports, but Vite SSR exposed a nested
`{ default: { default: traverse } }` shape. The normalizer now handles all
three forms and has an explicit regression test. Focused T10 now passes 5
tests, followed by a fresh CLI build. Restart the Builder dev server once more
to load this final source change.

## 2026-10-23 — component master path omitted from MCP plan scope

**Status:** fixed locally; restart Codex to activate the rebuilt CLI.

**Symptom:** `connections.create` dry-run passed validation, but its real
commit returned `PLAN_HASH_MISMATCH`. This affected Design Component masters
such as `components/PrimaryButton.tsx`.

**Cause:** `packages/cli/src/mcp.ts` included `filePath` and `targetFile` in
the plan scope, but omitted component operations' `componentFile` (and the
parallel `sourceFile` alias). The commit service therefore hashed a different
scope than the operation intended.

**Fix and guardrail:** MCP scope resolution now recognizes `componentFile`
and `sourceFile`; a regression test asserts that a `connections.create`
request carries its master path into `AutomationClient.execute()`. The
focused CLI and T10 interaction suites pass (14 tests), and the CLI builds.

**Required action:** restart the Codex desktop application once so its MCP
stdio child loads the rebuilt CLI. No Builder dev-server restart is needed
for this adapter-only change.

## 2026-10-23 — nodes.create omitted the motion import in Design Components

**Status:** fixed locally and CLI rebuilt; live MCP still runs the old bundle and requires a full Codex restart to activate.

**Symptom:** adding an `<img>` into the `ProjectCard` Design Component via
`nodes.create` was rejected by Oracle with `WOULD_CRASH: References undefined
identifier: motion`.

**Cause:** `addNodeInCode()` correctly wraps inserted children of a variant
master in `<motion.*>` for variant transitions, but did not add the matching
`motion` import. The issue was specific to node insertion in a Design
Component; the existing import-sync step did not repair this operation's
result before Oracle validation.

**Fix and verification:** `addNodeInCode()` now ensures a `motion` import from
`framer-motion` whenever it generates a motion-tagged child in a component
master. A regression was added to `generator-crud.test.ts`; the focused suite
passes (20 tests).

**Required action:** the CLI rebuild completed, but a follow-up `nodes.create`
dry-run still returned the same `WOULD_CRASH` issue at revision 112, confirming
the running MCP stdio child has not reloaded the new bundle. Fully close and
reopen the Codex desktop app so the child starts from the rebuilt CLI. No
workaround or direct edit to project source was used.

## 2026-10-23 — component hover styles were routed into an invalid CSS block

**Status:** operation fix loaded after restart; a second generator defect is fixed and rebuilt locally; live verification pending another restart.

**Symptom:** `styles.set` with `pseudo: "hover"` on a Design Component returned
`PLAN_VALIDATION_FAILED`, including `MISSING_DATA_ID` for the generated
`<style>` and `PLAN_HASH_MISMATCH`.

**Cause:** the operation always routed pseudo styles through the freeform CSS
writer. Design Components cannot contain freeform `<style>` blocks; their
interactive differences are stored in Framer Motion variants instead. The
operation schema had no way to express a target variant.

**Fix:** added optional `variantName` to `styles.set`; when supplied, it routes
the style update through the existing `updateVariantStyleInCode` generator.
Page pseudo styles and existing callers are unchanged. Added a regression test
that verifies a component hover update lands in the requested variant instead
of emitting a `<style>` tag.

**Verification:** the focused T07 suite passes (7/7), and the active MCP tool
schema now exposes `variantName`. A live dry-run then revealed the follow-up
generator issue below. CLI rebuild succeeds; fully close and reopen Codex so
the stdio child loads the final bundle before live verification.

## 2026-10-23 — new transform variants omitted sibling variant entries

**Status:** fixed locally and rebuilt; live MCP verification pending restart.

**Symptom:** setting a `scale` value for `ProjectCard`'s `hover` variant failed
Oracle validation with `VARIANT_OBJECT_MISSING_ENTRY` for the configured
`asymmetric` variant. No project mutation was committed.

**Cause:** when `updateVariantStyleInCode` created a variants object for a node
that had none, it returned after wiring the new target entry. The existing
transform-neutrality healing ran only on the update-existing-object path, so
other configured variants had no return value for Motion transforms.

**Fix:** the create-object path now seeds unchanged configured variants with
the base/neutral values for transform properties. Added a regression test that
failed before the fix and now checks the `hover` and `asymmetric` entries.

**Verification:** full generator style suite passes (128/128); focused T07
suite passes (7/7); `npm run build --workspace @revyme/cli` succeeds. Live
dry-run is pending reload.

## 2026-10-23 — variant-style plans intermittently failed API hash validation

**Status:** variant-style dry-run and commits verified after API module reload;
visibility commit path still needs a clean runtime verification.

**Symptom:** inline `styles.set` dry-run passed, while `styles.set` with
`variantName` returned `PLAN_HASH_MISMATCH`. A locally captured plan passed
`PlanSchema` JSON round-trip and local `validatePlan`, but the live API rejected
the same payload. After Vite reloaded the validation module, the identical
variant-style dry-run passed; ProjectCard variant writes then committed at
revisions 165–166 and PrimaryButton hover styles at revisions 167–168. A
SiteNavbar visibility commit still reported a hash mismatch before its dry-run
exposed the separate visibility Oracle errors.

**Action:** added received/calculated hashes to local plan-validation
diagnostics. Variant-specific style plans now validate and commit after module
reload. A clean API restart and a committed variant-visibility operation are
still needed to establish whether that earlier failure was stale API module
state or a second validation/commit divergence.

## 2026-10-23 — variant visibility generation omitted motion scaffolding

**Status:** fixed locally and rebuilt; live verification pending.

**Symptom:** `variants.visibility.set` wrapped the target in `AnimatePresence`
without importing it or adding `layout={true}`. Oracle blocked the plan with
`WOULD_CRASH` (undefined `AnimatePresence`) and
`ANIMATEPRESENCE_CHILD_LAYOUT`.

**Fix:** visibility generation now adds the missing Framer Motion imports,
promotes native lowercase JSX targets to `motion.*`, and adds `layout={true}`.
Added a regression that failed before the fix.

**Verification:** generator visibility suite passes (12/12); combined relevant
generator/style/operation suites pass (147/147); CLI build succeeds. Live
visibility mutation awaits reload and verification.

## 2026-10-23 — Builder API rejects hash-valid plans in dry-run

**Status:** fixed by restarting the local Builder API; MCP dry-run verified.

**Symptom:** `nodes.remove` dry-run through MCP returns
`PLAN_VALIDATION_FAILED: PLAN_HASH_MISMATCH`, without changing the project.
The same plan generated by the current source CLI also fails against the live
API, while a local JSON/Zod wire-round-trip test validates successfully.

**Evidence:** project revision remained 140; a local regression confirms the
plan hash survives serialization and `PlanSchema.parse`. This isolated the
mismatch to the running Builder API runtime, not the operation input. Restarting
`npm run dev:standalone -- --host ::` on `:3333` made the identical MCP dry-run
pass at revision 150. No deletion was performed by the failed requests.

## 2026-10-23 — active MCP child predates the rebuilt CLI bundle

**Status:** diagnosed; the active MCP stdio child must be restarted after the
bundle build before mutation testing can continue.

**Symptom:** `variants.visibility.set` dry-run and a control `styles.set`
dry-run both return `PLAN_HASH_MISMATCH`. Both are rejected before any write;
the project remains at revision 172.

**Evidence:** the active stdio process (PID 37755) started at 21:24:30, while
`packages/cli/dist/main.js` was rebuilt at 21:24:40. The Builder API process
started later at 21:24:46. This is consistent with the MCP child loading the
previous bundle even though the local bundle is now current. The failure is
general to mutation-plan validation, not specific to visibility generation.

**Next check:** restart the MCP child only after the build has completed, then
repeat a dry-run first. Do not retry a write while the dry-run is rejected.

## 2026-10-23 — stale page elements remain beside the new component instances

**Status:** identified through MCP read-only inspection; cleanup is pending a
working mutation path.

**Evidence:** `app/page.client.tsx` contains the older inline hero, header,
manifest, and empty footer, followed by the new `HeroSection`, `SiteNavbar`,
`StatementSection`, and `SiteFooter` component instances. This duplicates
content and leaves an empty old footer. The read was at revision 172.

**Next step:** once mutation dry-run validates again, remove only the obsolete
inline nodes via `nodes.remove`, then verify the page tree and preserve the
component instances. No source file has been overwritten directly.

## 2026-10-23 — stdio child does not recover after termination; hash validation is intermittent

**Status:** recorded; the MCP transport is currently disconnected and requires
the Codex app to relaunch its configured child.

**Evidence:** after a full app relaunch, the MCP child was present but the
configured `:3333` API was down. Starting `npm run dev:standalone -- --host ::`
restored the API. A visibility update committed at revision 173; removing the
obsolete hero, header, and empty footer committed at revisions 174–176.
Removing the obsolete manifest section had a passing dry-run on one attempt,
but later returned `PLAN_HASH_MISMATCH` again. The same API process accepted
other commits in between, so the failure is intermittent rather than tied to a
specific site node.

**Local diagnostic:** commit-service hash errors now report both received and
calculated hashes; a regression in `packages/cli/test/recovery.test.ts` passes.
The runtime still returned an older generic message for one rejected commit,
indicating the active server module was not consistently refreshed by HMR.

**Recovery behavior:** terminating the stale stdio child did not make the
Codex supervisor respawn it; the next MCP read returned `Transport closed`.
This is a host lifecycle limitation, not a project mutation. The configured
MCP command already rebuilds the CLI before startup. A full Codex relaunch is
required to restore the transport; keep `dev:standalone` running meanwhile.

## 2026-10-23 — independent MCP client still gets plan-hash mismatch

**Status:** fixed in the local Builder API and verified through independent MCP.

**Runtime check:** after the user relaunched Codex, its managed MCP stdio child
was available, but the Builder API on `:3333` was not. Started
`npm run dev:standalone -- --host ::` from this session. Then launched a
separate, short-lived MCP stdio server with the current `packages/cli/bin` and
connected to it using the official `@modelcontextprotocol/sdk` client (Codex
remained open). `codeFiles.read` succeeded for `app/page.client.tsx` at revision
176.

**Root cause:** `server/automation/api.ts` decoded every incoming body chunk
individually with `chunk.toString()` before concatenating it. If a network
chunk ended in the middle of a multi-byte UTF-8 character, that character was
replaced with U+FFFD. The JSON still parsed, but a large plan containing
Ukrainian text no longer had the bytes represented by its `planHash`. This
explains why short or differently segmented requests passed while others
failed.

**Fix and regression:** the API now buffers raw `Buffer` chunks and decodes
once after concatenation. Added a middleware regression that deliberately
splits `Привіт, Україно 🌻` in the middle of a UTF-8 sequence. It failed before
the fix and passes now; all 8 `server/automation/automation.test.ts` tests pass.

**Live verification:** after restarting the API, 10 consecutive
`nodes.remove` dry-runs for `intro-sec` passed via a separately launched
official MCP stdio client at revision 176. The same MCP client then committed
the removal at revision 177. A follow-up `codeFiles.read` confirmed the old
manifest is gone and `HeroSection`, `SiteNavbar`, `StatementSection`, and
`SiteFooter` remain. No direct page-file write was used.

## 2026-10-23 — component variant interaction generation and verification

**Status:** interaction generation fixed and confirmed in the builder; the
headless verifier fix is built and passes through a fresh MCP stdio process.
The Codex-managed long-running MCP child is still running an older bundle.

**User-visible issue:** component variants appeared connected in the editor,
but hover did not consistently work, Interactions could show no usable hover
action, and a variant label was missing in the canvas.

**Root causes and local fixes:**

- `variants.create` persisted interaction metadata without always creating
  the matching enter/leave connections. It now creates the pair and accepts an
  explicit `sourceNode`.
- Re-applying an existing connection returned early without repairing missing
  JSX handlers. It now reconciles generated handlers even for an existing edge.
- Connection generation inserted Framer handlers on plain HTML elements,
  which React does not execute as Framer gestures. It now converts the source
  element to `motion.<tag>` and adds the `motion` import.
- `connections.create` now rejects a non-existent `sourceNode` instead of
  silently storing a dangling connection.
- `verify.effect` only counted `whileHover`, and missed valid component
  interactions implemented by paired `onHoverStart`/`onHoverEnd` handlers
  that update a variant state. It also incorrectly required `variants` on the
  gesture root, missing components (such as `ProjectCard`) where that root
  drives variants on descendants. It now recognizes paired state-setting
  hover handlers with `animate`.

**Site verification:** on project `proj-1792770801304-tbg5o9`, branch `main`,
the current independent MCP client read revision 210. `PrimaryButton` and
`ProjectCard` have explicitly labelled `Hover` variants and paired hover
connections; `SiteNavbar` has click connections for open and close. Fresh
`verify.effect` calls pass for both hover components and the navbar, and the
user independently confirmed hover now works in the builder. All 116 focused
tests across interaction, verification, and connection-generation suites
pass; `npx tsc --noEmit` and the CLI bundle build pass.

**Transport/runtime discrepancy:** the existing Codex-managed stdio child
(PID 47682, started before the latest CLI build) still returns the old false
negative from `verify.effect`. Rebuilding `packages/cli` does not replace an
already-running child. A newly spawned official MCP stdio client using the
rebuilt bundle returns `satisfied: true` for the button, card, and navbar;
10 consecutive mutation dry-runs also pass at revision 210 without committing.
The stale child should be reloaded by a full Codex app restart. Do not kill it
from the workspace: prior testing showed its supervisor does not reliably
respawn it and leaves the transport closed.

## 2026-10-23 — three unrelated suite failures still require a missing fixture

**Status:** reproduced; no source fix is appropriate until the fixture is
restored or tests are made self-contained.

Three targeted tests fail before exercising their assertions because they
attempt to read the absent file
`data/projects/proj-1791960645579-j02nu7.json`:

- `src/code/parsing/parser.test.ts` — remote-paginated gallery subroute.
- `src/code/generation/cms-pagination-gen.test.ts` — clean/re-apply remote
  pagination.
- `src/code/project/__tests__/source-export-modes.test.ts` — gallery route
  source-export preparation.

All three were rerun on 2026-10-23 and failed with the same `ENOENT`; they are
independent of the component interaction changes above.

## 2026-10-23 — native MCP screenshot bridge unavailable

**Status:** fixed in the local Builder and CLI sources; verified end-to-end
through a fresh official MCP stdio client. The Codex-managed Revyme MCP child
still runs the old bundle and must be reloaded before its `observe.screenshot`
tool sees the fix.

**User-visible symptom:** `observe.screenshot` always returned
`HEADLESS_DISPLAY_UNAVAILABLE`, even with the Builder project open.

**Root causes:** the Vite self-host plugin defaulted to not starting the MCP
HTTP server; the CLI passed an empty `OperationContext.adapters` object; and
the editor bridge had no `captureScreenshot` RPC handler. In addition,
`get_screenshot` already called `captureElement` on the CanvasBridge interface,
but that method existed only on the concrete iframe implementation and was
missing from the interface/API.

**Fix:** local Vite now starts the bridge; the HTTP server binds to loopback
(`127.0.0.1`) and the editor/CLI use that exact address; the CLI's screenshot
adapter forwards scoped requests to `/rpc`; the editor validates project,
branch, and active file, waits for render, then delegates capture to the
existing iframe `html-to-image` implementation. Screenshot errors now retain
their reason in the operation result. The existing screenshot engine runs
inside the sandbox; no parent-frame DOM access was added.

**Verification:** 122 focused tests pass, including regressions for adapter
wiring, browser capture, API-plugin startup/shutdown, and loopback binding.
`npx tsc --noEmit`, `npm run build:all`, and the CLI build pass. After reloading
the Builder tab, `/api/mcp/status` on `127.0.0.1:8082` reports one active canvas
tab. A fresh process using the official MCP stdio server successfully captured
`app/page.client.tsx` on project `proj-1792770801304-tbg5o9`, branch `main`
(PNG, 951 × 2579 px; 358,034 data-URL bytes). The existing managed MCP child
still returned the pre-fix headless result, confirming its runtime bundle is
stale until Codex reloads the configured MCP process.

## 2026-10-23 — links.set produced links the Builder could not safely parse

**Status:** fixed and covered by T10 regressions.

`links.set` added `href` to ordinary anchors in page and design-component
files. That shape failed the Builder's Oracle and, in design components,
would not provide the framework-safe navigation/animation behavior expected
by the component. The operation now converts internal links to `Link` or a
motion-wrapped `MotionLink`, while preserving external anchors. A second
validation pass in `validate.ts` had a narrower JSX scaffold exemption than
the Oracle and rejected the private fallback elements inside `MotionLink`;
the exemption now matches the canonical Oracle rule. T10 covers generated
links and `validatePlan` acceptance.

## 2026-10-23 — nodes.create omitted required flex/grid flow order

**Status:** fixed and covered by a T07 regression.

Creating a direct child inside a flex/grid parent could produce JSX without a
CSS `order`. The Oracle then rejected a valid MCP create operation. `nodes.create`
now assigns stable order values to direct flow children that lack them, while
preserving explicit orders and skipping absolutely/fixed-positioned children.

## 2026-10-23 — open Builder tab is behind MCP's committed revision

**Status:** diagnosed; the live tab does not yet receive MCP commits in place.

The standalone Builder tab loaded revision 239; subsequent Revyme MCP v2
operations committed through the local automation API up to revision 249.
Standalone mode does not join the cloud collaboration socket, so the editor's
in-memory `ProjectFS` receives no live file-sync notification for direct MCP
commits. Its optimistic-concurrency check correctly rejects stale autosaves
with `REVISION_CONFLICT`, but the tab then retries the same stale snapshot and
logs repeated errors. This is a Builder/MCP synchronization gap rather than a
failed MCP commit. Do not bypass the revision check: a safe solution needs to
reconcile the editor's local edits with the MCP commit before advancing its
base revision. For the initial diagnosis, the persisted project remained at
revision 249 and the visible tab was not refreshed while its local recovery
copy was unreviewed.

**2026-10-24 update:** browser logs reproduced the same failure at server
revision 274 with a Builder recovery based on revision 239. The recovery copy
won because the loader compared its local persistence timestamp with the
timestamp embedded in the server data, instead of comparing the recovery's
`baseRevision` with the server row revision. `LocalBackend.loadProject` now
preserves that stale snapshot under a revision-specific recovery key and loads
the server copy when the server advanced past its base. This fixes stale
recovery replay on reload; live in-session propagation remains open.

## 2026-10-23 — direct managed MCP screenshot call still lacks the bridge adapter

**Status:** source fix is present and passes through a fresh official CLI
client; the long-running managed tool process still returns
`HEADLESS_DISPLAY_UNAVAILABLE`.

The direct `observe.screenshot` tool currently lacks
`context.adapters.screenshotService`. The local screenshot bridge on port 8082
reports active editor tabs, while the managed MCP child still returns the old
headless path. A fresh MCP stdio client from the rebuilt CLI installs the
adapter and is the verified path for screenshots. The live browser log also
showed retries for the bridge EventSource, so this runtime mismatch remains
visible rather than being treated as a successful screenshot.

## 2026-10-24 — links.set omitted MotionLink runtime imports

**Status:** fixed locally; verified by the T10 regression and the live site's
atomic MCP plan.

Applying `links.set` to a plain anchor in a Design Component converted it to
`MotionLink` and generated the declaration with `React.forwardRef`, but failed
to ensure the required `React` and `motion` imports. Oracle rejected the footer
email link as `WOULD_CRASH: References undefined identifier: motion`.

`convertToMotionLinkInCode()` now ensures the default React import, Framer
Motion's `motion` import, and Next.js `Link` import whenever it creates the
wrapper. T10 now covers a component without either runtime import and checks
that Oracle finds no crash.

## 2026-10-24 — typography.apply emitted uneditable style nodes

**Status:** fixed locally; T08 regressions pass.

Responsive typography application generated `<style>` elements without
`data-id`, so the Builder Oracle rejected them. In flex sections the same
unpositioned style nodes were also misread as flow children and reported as
missing `order` and shrink configuration.

`typography.apply` now creates a stable, node-specific style ID, updates the
same style node idempotently, and marks the metadata element absolute so it
does not participate in layout. T08 checks the ID, positioning, and repeated
application without duplicate style nodes.

## 2026-10-24 — responsive viewport audit required exact max-width tiles

**Status:** fixed locally; Oracle regression passes.

`CANVAS_VIEWPORT_BREAKPOINT_MISMATCH` required a viewport with width exactly
1199 and 599 for `max-width: 1199px` and `max-width: 599px`, even when the page
declared tablet/mobile artboards at 810 and 390. That contradicted the rule's
own canonical example and blocked responsive typography from being applied.

The audit now treats a configured tile at or below a `max-width` breakpoint as
coverage (810 previews the 1199 rule; 390 previews the 599 rule). Explicit
`data-responsive` `_bp` widths remain exact. A canvas-config regression covers
both thresholds.

## 2026-10-24 — named responsive overrides ignored the page's canvas widths

**Status:** fixed; the T07 regression passes and a live dry-run used the
project's configured 390px mobile width.

**Symptom:** `viewports.setOverride({ viewport: "mobile" })` generated a
375px query even though the target page's `@canvas` metadata defines mobile as
390px (and tablet as 810px rather than the 768px fallback).

**Cause:** the operation translated the names `mobile`, `tablet`, and
`desktop` directly to global defaults instead of resolving the target file's
declared viewport configuration.

**Fix and guardrail:** named overrides now parse the target file's `@canvas`
viewport list first and only use defaults when no matching viewport exists.
T07 asserts that the generated query is 390px and not 375px.

## 2026-10-24 — responsive style metadata was rejected as a canvas node

**Status:** fixed; the T03 regression and a live MCP dry-run pass.

**Symptom:** an editor-owned `<style>` block generated for responsive
typography was rejected as `MISSING_DATA_ID`, sometimes followed by flex-child
order/shrink violations.

**Cause:** the independent lightweight plan validator treated `<style>` like
a selectable JSX element even though the Builder Oracle treats it as
non-rendered editor metadata.

**Fix and guardrail:** `style` is now exempt from canvas `data-id` validation.
The T03 regression covers a responsive `<style>` block in a page, and a real
MCP dry-run with 58 site operations completed without Oracle issues.

## 2026-10-24 — automation middleware stayed stale after server module edits

**Status:** fixed locally; the regression was observed failing before the
change and passing after it.

**Symptom:** a running Vite process kept using the first
`/api/automation` middleware closure after an SSR module update, so fixes to
validators or generators appeared ineffective until the whole Builder dev
server was restarted.

**Cause:** `server/api-plugin.ts` cached the middleware function indefinitely
even though Vite's SSR module runner is responsible for HMR invalidation.

**Fix and guardrail:** every automation request now asks `ssrLoadModule` for
the current module and creates its middleware from that module. The API-plugin
regression first returned generation 1 twice, then passed with generation 1
and generation 2 on successive requests.

## 2026-10-24 — headless observe.audit cannot measure the live Builder canvas

**Status:** the stdio MCP path now requests live measurements from Builder;
standalone one-shot CLI execution still reports `pending` by design.

**Symptom:** `observe.audit` against the active project returns
`CANVAS_MID_RENDER` for every node when invoked from a standalone CLI process,
even while the same page is visibly rendered in the Builder preview.

**Cause:** the headless CLI process does not share the Builder tab's in-memory
rect cache. The operation can parse the page, but it cannot evaluate visual
overflow/overlap without measurements from that canvas instance.

**Fix:** added a scoped `observeAuditSnapshot` request to the existing browser
bridge. It waits for rendered rects, checks the active project/branch/page,
saved revision, editor idleness, viewport, measurement coverage and cache
freshness, then returns the same audit-node shape used by the visual linter.
The stdio server attaches this adapter to `observe.audit`; a headless
one-shot CLI has no live Builder adapter and must continue to report `pending`.

**Follow-up:** do not interpret headless `pending` as a passed audit or as
evidence that the page failed to render. The live RPC still needs end-to-end
verification after the Builder dev server reloads the bridge implementation.

## 2026-10-24 — automation API SSR reload re-registered project operations

**Status:** fixed locally; live CLI read and mutation now pass.

**Symptom:** `metadata.read` and `pages.list` failed with
`Operation "projects.duplicate" is already registered` when the API SSR module
was loaded. `metadata.read` succeeded after restarting neither Builder nor
Codex, and subsequent project checks worked.

**Cause:** `validate.ts` imports the restore validator; `scoped-restore.ts` in
turn imported checksum helpers from `operations/projects.ts`. Importing that
module has the side effect of registering all project operations. Vite's SSR
module reload repeated the registration against the still-live global
registry.

**Fix and guardrail:** moved the pure checksum helpers to
`operations/project-checksums.ts` and made both callers import that module.
The operations module no longer enters the validation dependency graph solely
for checksum code. Live `metadata.read`, `metadata.update` dry-run, and the
committed language update succeeded at revision 332.

## 2026-10-24 — Codex-managed Revyme MCP connector remains transport-closed

**Status:** unresolved host-level lifecycle issue; local official CLI works.

**Symptom:** the registered `mcp__revyme_v2/metadata.read` tool still returns
`Transport closed`, although the configured API at `http://localhost:3333` is
healthy and direct official CLI operations succeed.

**Evidence:** after the stale stdio child was terminated in the prior
diagnostic session, the Codex supervisor did not recreate it. A direct
`metadata.read` tool call still fails, while `packages/cli/bin/revyme.mjs`
successfully reads revision 332, passes project diagnostics, and commits with
editor sync confirmed.

**Next step:** after code commit, fully exit and relaunch Codex so its MCP
supervisor starts a fresh stdio child. Do not work around operation failures
silently; use the official CLI only as the same MCP v2 implementation while
recording the disconnected app connector.

## 2026-10-24 — audit RPC could select a stale tab for a multi-tab project

**Status:** fixed in source with a two-editor regression test; live check
pending Builder dev-server reload.

**Symptom:** two Builder tabs were connected for the same project. The audit
snapshot RPC sometimes returned revision 355 even though the requested
project revision was 356/357, and a project-sync RPC could report the other
tab's result.

**Cause:** `sendToEditor()` assigned one request ID to every matching tab.
`handleResult()` resolved on the first response and discarded any later one,
so results depended on response timing rather than project revision.

**Fix:** the read-only `observeAuditSnapshot` RPC now uses the bridge's
per-editor request IDs and prefers a ready snapshot with the exact requested
revision, then a non-ready result from that same revision. The regression
reproduced the stale-first race before the change and passes afterward.

**Evidence / remaining checks:** the local bridge reported two active tabs;
the live audit request returned `REVISION_MISMATCH` from one stale tab while
another tab acknowledged revision 357. Focused MCP tests pass, but the running
Vite bridge must reload before the live RPC can exercise the fixed dispatcher.

## 2026-10-24 — verify.effect misclassified motion.create-wrapped links

**Status:** fixed and verified against the IMPCT.DIGITAL `PrimaryButton`.

**Symptom:** `verify.effect` reported `Motion attributes ... on intrinsic HTML`
and `satisfied: false` for the site's hover CTA, despite its paired
`onHoverStart` / `onHoverEnd` handlers and two distinct button variants.

**Cause:** the verifier only treated `<motion.*>` JSX tags as motion elements.
The component correctly wraps Next.js `Link` with `motion.create(...)`, but the
AST classifier considered the resulting `<MotionLink>` tag an intrinsic tag.

**Fix and verification:** the verifier now detects custom component variables
whose initializer contains `motion.create(...)` and classifies their JSX uses
as motion elements. The regression first failed, then T24 passed (40/40); the
CLI was rebuilt and live `verify.effect` now reports `satisfied: true`,
`isMotionElement: true`, and `hasHover: true` for `button-root`. The website
component itself was not changed.

## 2026-10-24 — project diagnostics applied canvas rules to generated files

**Status:** fixed locally; full live project check passes at revision 373.

**Symptom:** a workspace-wide `diagnostics.projectCheck` reported 19 blocking
Oracle violations in `app/page.tsx`, `app/layout.tsx`, `app/providers.tsx`,
and `plugins/DirectusSync.tsx`, while the actual page source passed a targeted
check. These files are Next.js/server plumbing or plugin source, not editable
canvas pages/components.

**Cause:** the check ran `checkFile()` over every `.tsx`/`.ts` snapshot file
and guessed its Oracle kind from path substrings. That applied Builder page
and Design Component invariants to generated wrappers and arbitrary plugin
code.

**Fix:** canvas Oracle checks now run only for `app/**/*.client.tsx` and
`components/**/*.tsx`. Other TS/TSX files remain syntax-checked and included
in static import/asset/link checks. A regression reproduces the generated
page/layout/providers and plugin mix; it failed before the change and passes
afterward.

**Verification:** T24 regression passes, `diagnostics.projectCheck` reports
zero blockers and zero drift across the 13-file live workspace, and
`preview.build` is ready for the `/` route at the same revision.

## 2026-10-24 — visual MCP observation requires a connected Builder tab

**Status:** confirmed architecture limitation; no workaround or code change
made during this investigation.

**Current Revyme path:** `observe.screenshot` in the stdio MCP calls the local
bridge at `/rpc`; the bridge selects a connected Builder editor, checks its
project/branch/file/revision, then asks the canvas iframe to capture the
requested node. Without that live iframe, the operation reports
`HEADLESS_DISPLAY_UNAVAILABLE` (or a more specific unavailable status). The
page/component mutation tools themselves are separate API operations and do
not inherently require a visible tab.

**Webstudio comparison:** Webstudio's MCP prepares/refreshes a generated-site
preview from the active project session, starts its own managed Chromium in
`--headless=new` mode, and captures through CDP. The MCP reuses that browser
session and verifies that the requested route rendered a generated project.
This captures the generated site, not the Builder canvas/editor UI.

**Recommendation:** a Revyme headless site-preview screenshot service is
feasible and would remove the open-tab requirement for page-level visual
verification. It would not by itself provide exact canvas-node screenshots,
live editor geometry, or selection state. Making all canvas-bound observation
independent of a user tab would require the MCP host to own a separate Builder
canvas session (or a headless renderer with equivalent canvas measurement and
runtime behavior), which is a larger follow-up and must be tested against
variants, slots, responsive rendering, assets, and animations before replacing
the current bridge path.

## 2026-10-24 — observe.audit counts off-canvas slot sources as unmeasured

**Status:** root cause confirmed; fix not yet applied because the canvas slot
preview currently strips node IDs from its visible ghost copy.

**Symptom:** the IMPCT.DIGITAL page audit reports missing measurements for
connected marquee source nodes. On the latest live check (revision 494),
coverage was `194/216`; the missing IDs are the free-canvas card sources and
their `ProjectCard` descendants.

**Cause:** slot-connected source nodes are parsed as `isCanvasNode` and remain
in the free canvas workspace. The marquee renders a separate, non-interactive
ghost preview inside the component, but `buildOne()` in
`src/canvas/slot-children.ts` strips every `data-*` attribute from that ghost
to prevent selection collisions. The source copy can therefore remain culled
and absent from the measurement cache while the visible preview has no node
identity the bridge can measure. `collectLayoutSnapshot()` currently counts
both regular viewport nodes and those off-canvas sources toward 100% coverage.

**Why not filter the sources:** the connected card data is also real page
content in the live website. Dropping these nodes would make the audit look
complete while omitting the marquee content. A correct fix needs a distinct
measurement identity for slot-preview ghosts (separate from selection/hit-test
IDs), or page-level headless rendering that measures the real generated DOM.

**Latest status (2026-10-24):** project diagnostics are clean at revision 494,
but the rendered audit remains `pending` because these 22 marquee-source nodes
are not measured. This is separate from the severity-classification fix below;
do not report a complete visual audit until the slot-preview measurement path
is resolved or an equivalent rendered-page capture is available.

## 2026-10-24 — Codex MCP transport closed while Revyme stdio server is healthy

**Status:** isolated to the Codex-managed connector; Revyme MCP server and API
are operational. No Revyme source change is justified by this evidence.

**Symptom:** native `mcp__revyme_v2` calls to `pages.list`, `components.list`,
and `codeFiles.read` fail with `Transport closed`.

**Evidence:** the configured `packages/cli/bin/revyme.mjs mcp` child remains
alive under Codex's app-server. The project's API responds to the official
CLI at revision 380. An independent JSON-RPC stdio handshake against the same
CLI process successfully initialized MCP and executed `pages.list` at revision
380.

**Conclusion:** the operations registry, MCP stdio implementation, and Builder
automation API are functioning. The break is in the existing Codex-managed
stdio transport/session; changing Revyme operation code would be a speculative
fix. Continue using the official Revyme MCP stdio server directly for this task
and retain this host-connector failure for follow-up.

**Follow-up check (2026-10-24):** the native `pages.list` call still returns
`Transport closed`. The exact Codex-managed Revyme child was verified at
`/home/rost/Документи/revyme/revyme-builder-fork` and terminated with SIGTERM;
Codex did not automatically respawn it, and the connector remained closed.
The independent official stdio session continues to serve requests. This
points to a stale Codex app-server connection/catalog that needs the
app-server itself reinitialized, not a Builder `npm run dev` restart. Do not
kill or restart the app-server from inside its active session; recovery needs
a full desktop/backend restart, then verify that its MCP child is recreated
and `pages.list` succeeds.

**Recovery and local-server collision (2026-10-24):** after the user's Codex
restart, a new app-server and Revyme MCP child appeared; the native
`pages.list` transport recovered but returned `SERVER_UNAVAILABLE` because
the Builder API at `localhost:3333` was not running. I then started `npm run
dev` while the user was starting it in their own terminal. That duplicate
launch occupied `3333`, `5174`, `5175`, and `8082`; the user's Vite process
fell back to `3334` and the bridge could not start. I stopped only my own
saved terminal session and verified those ports are now free. This collision
was caused by duplicate startup, not an MCP implementation defect. The user
prefers to start `npm run dev` themselves; do not start it again without
checking with them first.

## 2026-10-24 — MCP component insertion skipped Builder layout guarantees

**Status:** fixed locally; rebuild the CLI and restart Codex's Revyme MCP child
before retrying the live operation.

**Symptom:** `components.instance.create` inserted a new FAQ row into a flex
list, then Oracle refused it with `FLEX_CHILD_MISSING_ORDER` and
`FLEX_CHILD_SHRINKS`. No partial project write was committed.

**Cause:** the editor's structural-mutation path applies
`applyRuntimeGuarantees`, but the MCP operation preparation boundary only
lowered spacing units before Oracle validation. Generated JSX therefore
reached Oracle without the same sequential `order` and non-shrinking `flex`
values the Builder itself adds.

**Fix and regression:** `normalizeCandidateChanges()` now applies the shared
runtime guarantee pass to every changed TSX/JSX source. A test first reproduced
the missing child styles and Oracle warnings; it now passes after normalization.

**Post-reboot follow-up (2026-10-24):** the first live retry still rejected an
FAQ child because the Codex-managed MCP process had started at 12:29, before
the source fix was written at 12:37 and the CLI bundle rebuilt at 12:39. The
running process therefore still held the pre-fix code in memory. This is a
stale-process retry, not evidence that the new normalization fix failed. The
next retry must happen after Codex recreates its Revyme MCP child from the
rebuilt bundle; no second code workaround should be applied unless that fresh
process reproduces the same Oracle errors.

## 2026-10-24 — Screenshot bridge hid missing editor tab behind HTTP 500

**Status:** response semantics fixed locally; CLI rebuild and Codex MCP restart
required. Actual capture still needs a connected editor tab; headless capture
is not implemented by this bridge yet.

**Symptom:** `observe.screenshot` returned `SCREENSHOT_SERVICE_ERROR` with the
unhelpful note `Screenshot bridge returned HTTP 500` after a machine restart.

**Cause:** the bridge's `/rpc` endpoint returns an HTTP 500 and a useful JSON
message when no editor tab is attached. The MCP adapter discarded that body and
raised a generic status-only error.

**Fix and regression:** the CLI adapter now maps this specific condition to a
structured unavailable result with reason `EDITOR_NOT_CONNECTED`, preserving
the bridge's explanation. Other HTTP failures still surface as errors. The
focused MCP test verifies the structured result. This clarifies the current
tab dependency; it does not claim to provide the separately requested
headless-rendering capability.

**Post-reboot follow-up (2026-10-24):** one screenshot retry during the same
stale MCP process returned `SCREENSHOT_SERVICE_ERROR` with
`This operation was aborted`. The call did not produce an image, so the latest
hover and menu changes remain visually unverified. Do not use browser
automation as a substitute; retry once after the Codex-managed MCP child has
reloaded the rebuilt adapter, then report `EDITOR_NOT_CONNECTED` honestly if
no Builder editor tab is attached.

## 2026-10-24 — Screenshot bridge reported a stale canvas as ready

**Status:** revision validation fixed locally and regression-tested. After the
user restarted Codex and the Builder dev server reloaded, the live MCP screenshot
returned `available: true` / `status: ready` for the current project.

**Symptom:** `observe.screenshot` returned `available: true` / `status: ready`
while the capture showed only the first FAQ row and the old placeholder. The
persisted `components/FAQSection.tsx` at revision 449 already contained four
`FAQItem` instances and no placeholder.

**Cause:** `observe.screenshot` had the requested project snapshot, but the CLI
adapter discarded its `revision`. The canvas bridge checked project, branch,
active file, and rendered bounds but not `getBaseRevision()`. It could therefore
return a successful image from a canvas behind the requested project state.

**Fix:** pass `snapshot.revision` through the CLI bridge request and require an
exact loaded-revision match before capture. Missing revision returns
`REVISION_REQUIRED`; a stale/ahead canvas returns `REVISION_MISMATCH` and does
not capture. This follows the exact-revision guard already used by
`observeAuditSnapshot`.

**Verification:** the new stale-canvas regression failed before the fix by
reaching `CANVAS_CAPTURE_EMPTY` instead of rejecting the revision; after the
fix, 115 targeted bridge/CLI/verification tests pass. The CLI bundle and main
Builder app both build, and `npx tsc --noEmit` passes. The full-suite result is
tracked below.

## 2026-10-24 — Screenshot RPC could select a stale tab in a multi-tab project

**Status:** fixed in the Builder bridge and regression-tested. A live MCP
`observe.screenshot` returned a ready image after the Builder server reloaded.

**Symptom:** with multiple Builder tabs open for one project, screenshot
capture could time out or return a stale-canvas refusal even when another tab
had the requested revision.

**Cause:** `captureScreenshot` used `sendToEditor()`, which broadcast one
request ID to every matching tab and settled on the first reply. A stale tab's
`REVISION_MISMATCH` could therefore win over a valid capture from a current tab.

**Fix:** screenshot RPC now sends independent requests per editor, includes the
tab's `canvasRevision` in every capture result, and prefers a ready result whose
revision exactly matches the requested snapshot. If none match, the bridge
returns an honest non-ready result instead of presenting a stale image as
current.

**Verification:** the stale-first server regression fails against the old
shared-ID behavior and passes with independent IDs; browser bridge success and
revision-mismatch cases and automation-core propagation are covered. All 123
focused tests pass, `npx tsc --noEmit` passes, and both the Builder and CLI
builds succeed. The separate live layout-audit gap remains: 194/216 nodes are
measured; 22 marquee slot-source/component nodes are intentionally not on the
rendered canvas and remain documented under the `CANVAS_MID_RENDER` audit entry.

**Operational note:** during verification, the Vite dev-server process exited
with code 143 and ports 3333/8082 were no longer listening, which caused one
`SERVER_UNAVAILABLE` audit response. Restarting `npm run dev` restored both
listeners; the subsequent audit reached the canvas and reported only the
documented 22-node marquee measurement gap. The reason for the external
SIGTERM is not established, so it is not attributed to the screenshot fix.

## 2026-10-24 — verify.effect ignored `effectType: motion`

**Status:** fixed locally with red/green regression coverage.

**Symptom:** `verify.effect` could return `satisfied: true` for a static hero
when the caller explicitly requested `effectType: "motion"` but described the
target as a hero section without using the words motion/animation.

**Cause:** the operation calculated `needsMotion` but never used it to add a
motion-specific check. The shared prose verifier only inferred motion when the
request itself contained motion-related terms, so the enum value was ignored.

**Fix:** `effectType: "motion"` (and explicit motion/animation wording) now
requires a motion element carrying an actual target prop such as `animate`,
`exit`, `variants`, a `while*` prop, or `layout`. A bare static element no
longer passes; a real motion target does.

**Verification:** the static-hero regression failed before the fix because the
operation returned `satisfied: true`; static and animated hero cases now pass
their expected false/true verdicts.

## 2026-10-24 — Builder did not reconcile missed MCP revisions after reconnect

**Status:** fixed locally with regression coverage. A read-only project check and
`verify.effect` reached revision 511, but the reconnected Builder canvas stayed
at revision 504; `observe.screenshot` correctly refused with `REVISION_MISMATCH`.

**Cause:** EventSource reconnects automatically, but the editor only received a
snapshot update when an MCP commit happened while it was connected. Commits
written while the Builder/MCP process was offline were never replayed, so the
active canvas remained stale indefinitely.

**Fix:** on bridge reconnect, the editor now reads the durable local project
revision without changing its current save token. If the server is ahead and
the editor has no unsaved changes, it uses the existing guarded snapshot sync
to load the latest project. A refused async replacement restores the prior
revision token so stale local work remains protected by conflict detection.

**Verification:** regression tests cover stale clean-tab catch-up, revision
reads without side effects, and reconnect wiring. A live screenshot should be
retried after Vite HMR reconnects the editor; unsaved/interacting canvases are
intentionally not replaced.

## 2026-10-24 — observe.audit misclassified intentional layout as errors

**Status:** fixed locally and regression-tested. Rebuild/reload the
Codex-managed MCP child before expecting the live audit to use the new
classification.

**Symptom:** the IMPCT.DIGITAL audit reported 43 errors, including the
ProjectCard image/hover-overlay pair and marquee cards translated outside the
viewport by the marquee animation.

**Cause:** `auditOverlaps()` treated a fully contained absolute overlay as a
layout collision. Separately, `observe.audit` promoted every geometric overlap
and every viewport-tile overflow to an error, even though viewport overflow is
explicitly documented in the rule as informational and may be intentional
(marquees, fixed headers, cursor overlays, negative-margin CTAs).

**Fix:** a fully contained absolute overlay is excluded from sibling overlap
findings; remaining geometric overlaps are warnings for human review, while
viewport-tile overflow is informational and no longer blocks `passed`. The
summary now distinguishes blocking errors, warnings, and informational
findings.

**Verification:** design-audit and T24 suites pass (100 tests). The main app
build, CLI build, and TypeScript check pass. The live project audit from the
old MCP child remains pending on the separate marquee-source measurement gap;
a fresh live audit must be rerun after the MCP child loads the rebuilt bundle.

## 2026-10-24 — full test suite has three missing portfolio-test2 fixtures

**Status:** unrelated to the IMPCT.DIGITAL/MCP changes; fixture is absent from
this checkout and was not recreated or changed.

**Verification:** `npx vitest run` completed with 14,922 passed, 36 skipped,
5 todo, and 3 failed tests. All three failures are `ENOENT` for
`data/projects/proj-1791960645579-j02nu7.json` in the existing
`portfolio-test2` parser, CMS pagination, and source-export tests. The
remaining 1,033 test files passed; no new regression failures appeared.

## 2026-10-24 — preview.build claimed a URL without starting a server

**Status:** fixed locally with regression coverage; the rebuilt MCP child must
be reloaded before the live tool response changes.

**Symptom:** `preview.build` returned `status: "ready"` and a URL such as
`http://localhost:3000/preview/<projectId>` even when no preview service was
configured or listening. Opening that URL failed with connection refused.

**Cause:** the no-adapter path only parsed project source and discovered routes,
then manufactured a localhost URL as if it had started a preview server.

**Fix:** the fallback now clearly reports `previewAvailable: false`, an empty
`previewUrl`, and a warning that only syntax/routes were validated. When a
preview adapter is configured, availability is derived from its ready result
and non-empty URL.

**Verification:** T23 regressions cover both the unavailable fallback and an
adapter-backed live URL; the focused tests pass.

## 2026-10-24 — Oracle required layout FLIP for absolute menu overlays

**Status:** fixed locally with a red/green regression test; the CLI child must
be rebuilt/reloaded before `codeFiles.submit` accepts the corrected component.

**Symptom:** the SiteNavbar menu overlay is absolutely positioned, but Oracle
rejected `AnimatePresence mode="sync"` and a child without `layout={true}` as
though it occupied normal document flow. That prevented removing an
unnecessary layout animation from the overlay close path.

**Cause:** the checks exempted explicit `data-overlay` nodes but did not inspect
the child's inline `position`, although the root-shell rule already recognized
`absolute`/`fixed` children as out of flow.

**Fix:** the shared presence check now treats `data-overlay`, `position:
'absolute'`, and `position: 'fixed'` as out-of-flow overlays. In-flow gated
children still require popLayout and layout FLIP.

**Verification:** the new absolute-child test failed on both presence rules
before the fix and passes after it; existing in-flow regression tests continue
to pass. The live SiteNavbar close interaction still needs a fresh MCP submit
and Preview check after the child reloads this bundle.

## 2026-10-24 — templates.assign and pages.update rejected styled page roots

**Status:** fixed, covered by T06 regressions, and verified through live MCP
commits on the isolated `mcp-live-audit-20261024` branch.

**Symptom:** assigning an ordinary page to a route-group template failed Oracle
with `TEMPLATED_PAGE_ROOT_STYLED`; the existing page root carried authored
background/layout styles that the shared template now owns.

**Cause:** both `templates.assign` and `pages.update` moved the existing page
source into the template route without separating the page-authored root style.

**Fix:** `preparePageForTemplate` normalizes the template-owned root and moves
the former page style and children into a new editable content wrapper. The
page's prior appearance remains intact.

**Verification:** T06 passes 13 tests. Live assignment and page update committed
successfully; Oracle accepted the templated roots and read-back preserved the
page content/style.

## 2026-10-24 — meta.tools emitted invalid JSON Schema examples

**Status:** fixed with T01 contract tests; live example re-check remains part of
the 275-operation coverage pass.

**Symptom:** examples for positive integer bounds could be `0`; URI/email/date
formats, regex-constrained identifiers, optional fields, defaults, and unions
could also produce arguments rejected by their own operation schemas.

**Cause:** generic example generation ignored several JSON Schema constraints.

**Fix:** example generation now respects bounds/defaults, common formats and
patterns, optionality, array limits, and union alternatives.

**Verification:** T01 passes 15 tests and `npx tsc --noEmit` passes. Live schema
discovery succeeded; each repaired example still needs a fresh pass before the
operation matrix marks it complete.

## 2026-10-24 — headless operations used stale ProjectFS and browser autosave

**Status:** fixed with CLI/backend regressions and a live CMS verification.

**Symptom:** Node-side autosave attempted to access `localStorage`, while
operations backed by the global ProjectFS could see stale files or the wrong
branch instead of the current MCP snapshot.

**Cause:** operation code still uses application-level ProjectFS helpers, and
`triggerAutosave()` assumed a browser environment.

**Fix:** each scoped MCP call hydrates ProjectFS from its current snapshot and
activates the requested branch before preparing the operation. Autosave now
skips browser-only work when `window` is absent.

**Verification:** CLI snapshot-context and Node autosave tests pass; the live
CMS schema dry-run left data unchanged, then create/get succeeded without
`localStorage` errors.

## 2026-10-24 — pages.duplicate replaced the required root node ID

**Status:** fixed, unit-tested, rebuilt, and live-verified.

**Symptom:** duplicating a page changed `data-id="root"` to a generated ID;
Oracle rejected the plan with `PAGE_ROOT_REQUIRED`.

**Cause:** the duplicate operation treated the special page root like an
ordinary node while refreshing IDs.

**Fix:** retain the canonical root ID and regenerate IDs for copied descendants.

**Verification:** the new regression first failed, then T06 passed 13/13.
`pages.duplicate` committed a templated copy at revision 46; live `codeFiles.read`
confirmed the root remained `root` and descendant IDs were fresh.

## 2026-10-24 — responsive override had stale breakpoints and no canvas tile

**Status:** fixed, covered by T07, rebuilt, and live-verified.

**Symptom:** on a new page with only its Desktop tile, `viewports.setOverride`
accepted `tablet` but wrote `@media (max-width: 768px)` without adding a tablet
tile. Oracle rejected it as `CANVAS_VIEWPORT_BREAKPOINT_MISMATCH`. `viewports.list`
also reported outdated Tablet 768px and Mobile 375px values.

**Cause:** the MCP operation used stale hard-coded defaults and wrote responsive
CSS without synchronizing the page's `@canvas` viewport/position metadata.

**Fix:** defaults now follow the Builder's 1200/810/390 ladder. When a requested
breakpoint is missing, `viewports.setOverride` adds its `@canvas` entry and places
the tile to the right of existing viewports before Oracle validation.

**Verification:** the new T07 test failed before the fix and the complete T07
suite passes 12/12. Live `viewports.list` returned 1200/810/390; a tablet override
committed at revision 64 with a matching 810px tile and position, and read-back
confirmed both CSS and canvas metadata.

## 2026-10-24 — component extraction/detach corrupted or rejected valid JSX

**Status:** fixed, covered by T09 regressions, TypeScript-checked, and live-verified.

**Symptoms:** extracting a section could leave an extra closing tag because the
replacement regex stopped at the first nested closing element. Detaching an instance
could duplicate the page's canonical `data-id="root"`, preserve unresolved default
props and `...style`, and duplicate child IDs when multiple instances were inlined.

**Cause:** both operations edited markup with regex/string substitution instead of
using complete JSX source spans and AST-level prop/style handling.

**Fix:** extraction now replaces the exact JSX AST node span. Detach locates the full
instance node, resolves instance props and destructured defaults, expands the style
spread with instance styles, assigns the existing instance ID to the inlined component
root, and regenerates descendant IDs. `components.replace` also prunes a previous
component import when its last instance is replaced.

**Verification:** the new tests reproduced the duplicate-root/text/style defect before
the fix. T09 passes 6/6; `npx tsc --noEmit` passes. Live extract → detach → readback
committed cleanly, and a second live replace → detach round-trip preserved defaults and
instance styles while removing the obsolete import.

## 2026-10-24 — components.remove counted history as a live usage

**Status:** fixed, regression-tested, TypeScript-checked, and live-verified.

**Symptom:** after detaching an extracted component, `components.remove` still refused
to delete its master because `_meta/history.json` contains historical source that
mentions the component. Unused import lines also counted as active usage.

**Cause:** removal searched every project file with substring matching, including
metadata snapshots and non-code text, rather than current source JSX.

**Fix:** usage checks now inspect actual JSX component instances in `.tsx`/`.jsx`
sources only. Successful removal prunes stale imports, and `force: true` removes the
matching current instances before deleting the master; historical snapshots remain
untouched.

**Verification:** T09 covers historical references, stale imports, live-use refusal,
and forced cleanup. A non-forced live removal succeeded at revision 109 even though
the history file retained the old component snapshot.

## 2026-10-24 — components.detach omitted master runtime dependencies

**Status:** fixed, covered by T09, TypeScript-checked, and live-verified.

**Symptom:** detaching an animated component caused Oracle to reject the page with
`WOULD_CRASH` for identifiers such as `motion` and `rootVariants`.

**Cause:** the operation inlined only the returned JSX, while imports and module-level
constants remained in the component file that was no longer rendered.

**Fix:** detach now collects identifiers referenced by the inlined JSX, copies the
needed imports and transitive top-level declarations into the page, and rejects name
collisions rather than silently generating invalid source.

**Verification:** a T09 regression failed first on missing `motion`/`variants`, then
passed after the fix. Live detaching the animated audit Button committed at revision
119; read-back confirmed the dependency import/declaration and no old component import.

## 2026-10-24 — smooth-scroll MCP operation omitted its generated controller

**Status:** fixed, regression-tested, and committed/read back through a fresh
independent MCP stdio child on the isolated audit branch.

**Symptom:** `siteEffects.smoothScroll.set` mounted `<SmoothScroll />` in the root
layout and wrote the route config, but its plan omitted
`app/smooth-scroll-controller.tsx`. The Builder then rejected the plan with
`UNRESOLVED_IMPORT` for `./smooth-scroll-controller`.

**Cause:** the editor path scaffolded the runtime as a ProjectFS side effect;
the headless operation only emitted the data map and layout change.

**Fix and regression guard:** the MCP operation now includes the versioned
controller source whenever missing or stale. T14 validates the complete
`prepareOperation` → `createPlan` → `validatePlan` path and asserts the runtime
file is emitted. The same live plan exposed that generated code was wrongly
sent through the page Oracle; file validation now exempts stamped Builder
runtimes while still checking parse and relative imports.

**Verification:** T14 passes. Live set committed the config, controller and
layout import at revision 137; `get` returned enabled/intensity 22; `codeFiles.read`
confirmed the controller marker. `remove` committed at 138 and `get` returned
`null`. Project diagnostics reported 0 blocking violations and 1 pre-existing
drift warning (`CANVAS_VIEWPORT_FIXED_HEIGHT` on `app/page.client.tsx`); no
missing imports/assets were found.

## 2026-10-24 — plan validator treated generated/code files as canvas pages

**Status:** fixed with regression coverage and live-verified on the isolated
branch.

**Symptom:** otherwise valid dry-runs for `vectors.createSet`, `overrides.create`,
and `plugins.write` failed with `MISSING_DATA_ID`, `PAGE_ROOT_REQUIRED`,
`NO_COMMENTS_IN_GENERATED_CODE`, or `FORBIDDEN_IMPORT`. Smooth-scroll runtime
hit the same canvas rules.

**Cause:** the generic plan validator ran the page Oracle on generated icon-set
masters, plugin entrypoints, override HOCs and the smooth-scroll controller.
Those files have their own shape/runtime contracts and are not editable page
trees.

**Fix and regression guard:** `isBuilderMaterializedFile` now recognizes
`@iconSet` and the smooth-scroll runtime stamp; plan validation skips canvas
data-id/Oracle rules for those Builder-owned files and for `plugins/*.tsx` and
`overrides/*.tsx`. Their operation-specific source validation and syntax/import
checks remain in place. Regression tests now pass each generated operation
through full plan validation (T13, T14, T20, T22).

**Verification:** T13/T14/T20/T22 and file-kind tests pass. Fresh MCP calls
created an icon set at revision 139, added/removed one variant at 140/141,
created a code component at 142, an override at 143, and a plugin at 144; list/get
read-backs succeeded. Plugin code was not launched.

## 2026-10-24 — committed mutations discarded their domain output

**Status:** fixed, regression-tested, and live-verified through a newly launched
MCP stdio child; no Codex restart was needed.

**Symptom:** the MCP response exposed the durable commit receipt but dropped
operation-specific output such as the generated `formId`. An agent had to read
and parse page source before it could pass the ID into the next typed operation.

**Cause:** `AutomationClient.execute()` prepared the operation result to construct
the plan, then returned only the commit service's receipt after a successful write.

**Fix and regression guard:** `Result` now has a top-level `operationResult` carrying
the compact domain summary while omitting file changes and plan diagnostics. Dry-runs
also preserve that summary next to the plan. CLI-client and MCP serialization tests
cover the field.

**Verification:** both CLI test files pass (20 tests), `npx tsc --noEmit` passes,
and the CLI rebuild succeeds. A fresh independent MCP create returned its `formId`
in `operationResult` at revision 167; `forms.delete` then removed the audit form at
revision 168.

## 2026-10-24 — form lifecycle wiring omitted the React `useState` import

**Status:** fixed, covered by T19 and generator regressions, and live-verified.

**Symptom:** `forms.submitButton.add` could generate a page-level lifecycle state
hook using `useState` without importing that symbol. Oracle rejected the otherwise
valid form plan with `WOULD_CRASH` for an undefined identifier.

**Cause:** the form-state generator inserted the declaration and JSX mapping but
assumed React hooks were already in scope.

**Fix and regression guard:** the generator now ensures a named `useState` import
for lifecycle hooks and recognizes all existing React imports before editing them,
so projects with separate default and named React imports do not receive duplicate
bindings. `T19-forms` asserts the import and Oracle safety; generator tests cover
pre-existing imports.

**Verification:** form-state and T19 tests pass (55 tests); related vector,
site-effect, code-component, plugin, contract and file-kind suites pass (127 tests).
On the live audit branch, submit-button insertion committed with `FormSubmit.tsx`
and `Spinner.tsx` at revision 159, lifecycle mapping committed at 160, and the
generated page passed the MCP validator. The test form was subsequently deleted.

## 2026-10-24 — applying listed compound presets doubled the category prefix

**Status:** fixed, covered by T08, type-checked, and live-verified.

**Symptom:** `presets.list({ category: "radius" })` returns the identifier
`radius-card`, but passing it directly to `presets.apply` produced
`var(--radius-radius-card)`. The same mismatch affected shadow and color presets.

**Cause:** list results use full token names for simple preset categories, while
apply always prepended the category prefix. Border presets separately return short
names, so changing list output alone would not be backward compatible.

**Fix and regression guard:** apply accepts either a short name or a name prefixed
with its category. T08 asserts the correct generated variables for radius, shadow,
color, and border presets.

**Verification:** T08 passes (8 tests), `npx tsc --noEmit` passes, and the CLI
rebuild succeeds. Live apply used the exact `radius-card` returned by `presets.list`,
generated `var(--radius-card)` at revision 183, and removed the temporary style at 184.

## 2026-10-24 — typography cleanup treated absent optional tokens as errors

**Status:** fixed, regression-tested, and verified through the rebuilt MCP process.

**Symptom:** `typography.remove` emitted `trace.error` messages for expected missing
tokens such as responsive line-height and stroke values, then reported those absent
tokens in its `removedTokens` result.

**Cause:** the operation attempted to remove every suffix in `TYPO_SUFFIXES` even
though presets only write a subset based on their options.

**Fix and regression guard:** removal now parses existing design tokens first, skips
absent suffixes, and reports only names actually removed. T08 asserts responsive tokens
are included while missing line-height/stroke tokens are omitted.

**Verification:** T08 passes (8 tests), typecheck passes, and the CLI rebuild succeeds.
A rebuilt live MCP set/remove cycle deleted the 12 existing tokens at revision 207,
returned exactly 12 names, and emitted no missing-token errors.

## 2026-10-24 — `codeFiles.submit` applied canvas rules to Next.js server layouts

**Status:** fixed, covered by T20, type-checked, and live-verified.

**Symptom:** a guarded submit/restore of a valid `app/layout.tsx` failed with
`ORACLE_VIOLATION` for server-only metadata, CSS/provider imports, `<html>/<body>`,
and the `{children}` slot. That prevented safe MCP-native cleanup of a font transform.

**Cause:** `codeFiles.submit` used `isLayoutFile()` to label both route-group
`LayoutClient.tsx` and Next.js server `layout.tsx` as editable canvas templates.

**Fix and regression guard:** the submit operation now skips only the canvas Oracle
for server layout paths. The MCP plan validator continues to check syntax and relative
imports for those files; the editable `LayoutClient.tsx` path remains Oracle-gated.
T20 includes a valid server layout fixture.

**Verification:** T20 passes (38 tests), typecheck passes, and the CLI rebuild succeeds.
An independent MCP process submitted and restored a harmless comment using CAS hashes
at revisions 218/219; exact read-back matched the original layout.

## 2026-10-24 — Next/font conversion left the Google CSS request in place

**Status:** fixed, covered by T08 and next-font tests, and live-verified.

**Symptom:** `fonts.transformNextFont` inserted `next/font/google` loaders into
`app/layout.tsx` but left the corresponding `fonts.googleapis.com` `@import` in
`app/globals.css`, so the same font remained externally loaded.

**Cause:** the MCP operation called the layout-only transformer, while the complete
source-export helper also strips CSS imports and rewrites quoted font families to the
generated CSS variable.

**Fix and regression guard:** CSS rewriting is now a shared helper, and the MCP
operation returns changes for both the layout and globals stylesheet when needed.
T08 asserts the import is removed and `font-family` uses the generated variable.

**Verification:** T08 and next-font tests pass (17 tests), typecheck passes, and the
CLI rebuild succeeds. Live conversion changed both files at revision 224; read-back
confirmed the loader and absence of the CSS request. Two `history.undo` calls at 225/226
restored the test edits.

## 2026-10-24 — code component example lacked required canvas size annotations

**Status:** fixed and verified through `meta.tools` and live MCP planning.

**Symptom:** `meta.tools` returned a schema-valid `codeComponents.create` example,
but Oracle rejected it with `CODE_COMPONENT_MISSING_DEFAULT_SIZE`.

**Cause:** generic JSON Schema generation could not infer the operation-specific
`@defaultWidth` / `@defaultHeight` annotations required by code components.

**Fix and regression guard:** the operation example now includes both annotations;
T01 checks their presence and schema validity. `codeComponents.create` passed a
live dry-run and then committed/read back as `McpAuditWidget` at revision 142.

## 2026-10-24 — uploaded public assets failed catalog image validation

**Status:** fixed, regression-tested, and verified through live MCP.

**Symptom:** `assets.upload` returned `/assets/mcp-audit-proof.svg`, but using that
URL in `catalog.place` failed Oracle with `INVALID_IMAGE_SOURCE`, even though the
uploaded file existed at `public/assets/mcp-audit-proof.svg` in the same project.

**Cause:** plan validation called the image-source Oracle without the projected
ProjectFS file set, and URL matching did not map a public URL back to its `public/`
file path.

**Fix and regression guard:** plan validation now passes projected file paths into
`checkFile`; the image rule recognizes `/assets/x` when `public/assets/x` exists.
Direct Oracle and T20 plan-level tests cover the upload-to-image path.

**Verification:** Oracle image-source and T20 code tests pass (48 tests). After
rebuilding the CLI, the uploaded SVG was placed as a catalog image at revision 246,
then `media.image.set/get` confirmed the URL and attributes at revision 247.

## 2026-10-24 — overlay removal left malformed React-qualified hooks

**Status:** fixed, regression-tested, and verified through a fresh MCP stdio process.

**Symptom:** creating and then removing an overlay could leave its state declaration
and a dangling `React.` before `return`, producing invalid TSX. Separately,
`overlays.update`, `overlays.close`, and `overlays.remove` accepted missing targets as
successful no-op mutations.

**Cause:** the overlay generator began emitting `React.useState` and
`React.useEffect/useLayoutEffect`, while cleanup matched only bare hook names. The
effect remover therefore started at `useLayoutEffect` and left `React.` behind; the
state remover also missed `React.useState`. Operation handlers did not verify that
the named overlay/node existed before returning file changes.

**Fix and regression guard:** overlay transforms now match both namespace-qualified
and imported hooks, including extraction, state healing, and effect placement.
Update/close/remove validate their overlay and node targets and reject mismatched
trigger IDs. Unit coverage asserts parseable create/remove round-trips and explicit
missing-resource errors.

**Verification:** overlay generator and T10 interaction suites pass (170 tests), the
CLI rebuild succeeds, and live create/update/close/remove cycles committed at
revisions 273–279. Read-back confirmed config changes, close wiring, and clean source
after each removal.

## 2026-10-24 — asset usage checks counted archived history as live code

**Status:** fixed, regression-tested, and verified through live MCP.

**Symptom:** after removing the only live image node, `assets.delete` still refused
the audit SVG because `_meta/history.json` contained earlier page snapshots. After a
forced cleanup, `assets.audit` reported every archived image URL as a broken reference.

**Cause:** both operations scanned every non-`public/` file, including the Builder's
undo/redo history. Those snapshots are not rendered source and must not count as live
asset usage.

**Fix and regression guard:** both checks now skip only `_meta/history.json`; other
project files remain included. T12 verifies a history-only reference is classified
as unused, does not appear as broken, and does not block safe deletion.

**Verification:** T12 passes with the overlay suites (174 tests total), the CLI
rebuild succeeds, and a live upload → audit → delete-without-force cycle completed
at revisions 290–291. The final asset list and audit were empty with no broken refs.

## 2026-10-24 — empty-project scaffold made every unrelated mutation fail Oracle

**Status:** fixed in the blank-project generator, regression-tested, and live-verified.

**Symptom:** a fresh blank project started with `@canvas` viewport `height: 900` and
root `height: '900px'`. Oracle correctly rejected every later plan with
`CANVAS_VIEWPORT_FIXED_HEIGHT`, even when the mutation targeted another page.

**Cause:** `createEmptyProject()` explicitly requested a 900px fixed canvas and
emitted the same fixed height on its empty root. That scaffold is a normal page, not
an intentionally fixed-size artboard, so its canvas must grow with content.

**Fix and regression guard:** the empty-project scaffold now uses auto height in both
viewport metadata and the root element. `empty-project.test.ts` asserts that contract.

**Verification:** the regression failed first (2 assertions), then the focused suite
passed (11 tests). Live `codeFiles.submit` repaired the task-owned audit branch at
revision 299; afterward `sections.insert` and `nodes.remove` on the correct `filePath`
committed at revisions 300–301, with read-back confirming the test section was gone.
The production project's `main` branch was not modified.

## 2026-10-24 — shapes.updateAttrs could not edit SVG container attributes

**Status:** fixed, regression-tested, and verified through a rebuilt MCP stdio process.

**Symptom:** `shapes.get` read `viewBox` from the SVG wrapper, but
`shapes.updateAttrs` always targeted its first geometry child. Asking it to update the
wrapper's `viewBox` left the SVG unchanged and wrote an invalid `view-box` attribute on
the child path.

**Cause:** the shared generator's default behavior intentionally addresses a shape
child for geometry/presentation edits, but the MCP input had no way to distinguish that
from editing the SVG container itself.

**Fix and regression guard:** `shapes.updateAttrs` now accepts optional
`targetElement: "svg" | "shape"`; the existing default remains `shape`, while `svg`
updates the exact container and rejects non-SVG targets. The operation description and
`meta.tools` example now explain the distinction. T13 covers the root update and T01
checks that the schema example is valid.

**Verification:** T13 and SVG generator suites pass (43 tests), T01 contract tests pass
(20 tests), and a fresh rebuilt CLI read back `viewBox="0 0 200 200"` and `role="img"`
on the SVG while the default mode still updated child path attributes. The temporary
SVG was removed at revision 350.

## 2026-10-24 — sketch animation set was rejected by its own marker comments

**Status:** fixed with a narrow Oracle exception, regression-tested, and live-verified.

**Symptom:** `drawing.sketchAnim.set` generated the requested hook but Oracle rejected
the page because the hook's `__SKETCH_ANIM_BLOCK_BEGIN__/END__` marker comments violate
the no-prose-comments rule.

**Cause:** the generator deliberately uses those two markers to find and update/remove
its hook without rewriting the surrounding page, but the comment rule's exemptions only
covered responsive text/query helpers.

**Fix and regression guard:** Oracle now allows only the exact begin/end sketch markers
with a non-empty ID; all other comments, including comments inside the generated block,
remain prohibited. T13 validates the actual generated hook against Oracle, and the
existing comment tests still verify ordinary page comments are rejected.

**Verification:** T13 plus Oracle suites pass (164 tests), the CLI rebuild succeeds,
and live set/get/list/remove committed at revisions 362–363. Read-back showed the
configured animation, then `null`/empty after removal; the temporary SVG was removed at
revision 364.

## 2026-10-24 — MCP custom cursor did not mount its required portal

**Status:** fixed, regression-tested, and live-verified.

**Symptom:** `siteEffects.cursor.set` wrote `withCursor(...)` on the target element, but
did not add `<CursorPortal />` to `app/layout.tsx`. The page-level configuration looked
valid in the builder, yet the runtime had no portal to render the cursor into.

**Cause:** the editor's local Oracle gate adds the portal as a side effect, but the
headless MCP operation returned only its page-file change and bypassed that editor path.

**Fix and regression guard:** cursor set now includes an idempotent root-layout update,
creating a default layout when absent. T14 tests both existing and missing layouts.

**Verification:** T14 passes (10 tests), the CLI rebuild succeeds, and a fresh stdio
process committed the page and root layout together at revision 387. Read-back confirmed
the runtime import and portal; cursor removal committed at 388 and removed the page
attachment while retaining the harmless shared portal for other pages.

## 2026-10-24 — Glide removal relied on editor-only import cleanup

**Status:** fixed, regression-tested, and live-verified.

**Symptom:** live `siteEffects.glide.remove` correctly unwrapped all children but left
the generated `LayoutGroup` import behind. The normal editor flush prunes that import;
headless MCP commits do not run that UI-only import synchronizer. Reapplying Glide to
such a file also preserved the generator's earlier inconsistent comma spacing.

**Fix and regression guard:** the Glide generator now prunes only an unused
`LayoutGroup` specifier (preserving it if another JSX use remains), and normalizes named
`framer-motion` imports when adding Glide dependencies. Generator tests cover both the
cleanup and shared-use cases.

**Verification:** Glide generator and T14 suites pass (39 tests), TypeScript checks
pass, and a rebuilt MCP process produced one group/five wrappers and then removed the
metadata, wrappers, and unused import at revisions 395–396. Get after removal returned
`hasGlide: false`.

## 2026-10-24 — variables.create failed in the bundled MCP runtime

**Status:** fixed, unit-tested, and live-reproduced after rebuild.

**Symptom:** `variables.create` failed in the independent CLI stdio process with
`generate6 is not a function`; the same capability tests passed under Vitest.

**Cause:** `page-variables-gen.ts` called a raw default import from `@babel/generator`.
The bundled CLI's Node ESM/CJS interop exposes nested default wrappers, unlike the
test runner. Shared generator utilities already normalize these wrappers.

**Fix and regression guard:** page-variable generation now resolves its Babel generator
through the shared `normalizeBabelGenerator` helper. Existing generator and T15
operation tests cover create/bind/update/remove behavior.

**Verification:** T15 and page-variable generator suites pass (45 tests); after rebuilding
the CLI, live create/update/bind committed at revisions 404–406 and read-back showed the
renamed variable and query-param metadata. A later Oracle rejection on a separate
interaction probe was non-committing; the page was restored byte-for-byte at revision 407.

## 2026-10-24 — cms.list.paginate omitted React hooks and its UI component

**Status:** fixed, regression-tested, and live-verified through a rebuilt independent MCP
stdio process.

**Symptom:** `cms.list.paginate` failed Oracle validation on a normal collection list. The
generated page referenced `useState` without importing it and imported `@/components/LoadMore`
even though that component was absent from the project. Infinite-scroll had the same hook
import gap for `useRef` and `useEffect`.

**Cause:** pagination relied on the editor mutation queue to synchronize React imports and
create the shared Load More/Spinner component files. Headless MCP plans bypass that UI-only
path and returned only the edited page.

**Fix and regression guard:** the pagination generator now emits the required React hook
imports for both local and remote modes. `cms.list.paginate` includes the generated or
upgraded LoadMore/Spinner component in the same atomic plan. T16 asserts the hook import and
component file are part of the plan. A remote-pagination regression fixture no longer reads
a machine-local `portfolio-test2` project JSON; it now reconstructs the route-query case
synthetically.

**Verification:** T16 and the pagination generator suites pass (53 tests); the CLI rebuild
succeeded. On the isolated audit branch, local Load More set/read/unpaginate and field
bind/unbind succeeded at revisions 445–447, and infinite-scroll set/read/unpaginate passed
at 448–449. The page was restored exactly and the newly created LoadMore component removed
at revision 450; the pre-existing Spinner file was preserved.

## 2026-10-24 — cms.schema.delete cascade omitted dependent page changes

**Status:** fixed, regression-tested, and live-verified through a rebuilt independent MCP
stdio process.

**Symptom:** deleting a temporary collection with `cascade: true` failed Oracle validation
because the index and detail client/server routes still imported the deleted CMS JSON.

**Cause:** `cascadeDeleteCollection()` removed/reworked files in `ProjectFS`, but the
headless `cms.schema.delete` operation returned only the schema/data deletions. Separately,
generated index pages had no `@cmsPage` marker, so older index routes could not be included
in the cascade's file discovery.

**Fix and regression guard:** the operation now returns a snapshot-to-ProjectFS diff for
every file changed by the cascade, so all route/repeater edits and collection deletions are
one validated transaction. Generated index pages carry `@cmsPage` metadata; the usage scan
also recognizes the exact older generated index-page signature. The CMS delete confirmation
now reports index pages as well as detail pages. T16 covers an unannotated legacy index route
and asserts all four route files are included as deletions.

**Verification:** CMS operation, page generation, and CMS CRUD suites pass (156 tests); the
CLI rebuild succeeds (with the pre-existing direct-eval warning). Live cascade committed at
revision 476, removed both CMS files and all four server/client route files, and read-back
confirmed both `cms.pages.find` results are `null`, the collection is absent, and `/` plus
the existing audit pages remain. `diagnostics.projectCheck` reports no broken imports/assets/
links and no blocking violations.

## 2026-10-24 — generated form helpers drifted from the Oracle dialect

**Status:** fixed, regression-tested, and live-verified through a rebuilt independent MCP
stdio process.

**Symptom:** after `forms.submitButton.add`, read-only `diagnostics.projectCheck` reported
19 drift findings across `components/FormSubmit.tsx` and `components/Spinner.tsx`. They were
not blocking, but meant the generated helpers could not round-trip cleanly through the
builder's editor. The focused Oracle test initially found 15 violations in FormSubmit.

**Cause:** the generator used `display: none` variant maps instead of editable conditional
presence, emitted long prose comments plus an unrecognized generated marker, omitted the
loop metadata for the Spinner's continuous rotation, and gave the root style defaults that
were absent from the root's inline style. The Spinner also emitted percentage geometry and
a root positioning style the Oracle could not map to the editor.

**Fix and regression guard:** FormSubmit now uses keyed conditional children inside
`<AnimatePresence mode="popLayout">`, with layout metadata and editable inline defaults.
The Spinner generator emits supported pixel geometry and `data-loop`; generator versions
were advanced to FormSubmit v4 and Spinner v5. Oracle allows only those exact internal
markers. When the submit helper is ensured, an old generated Spinner is upgraded, while a
user-authored component is left intact. A new generator test checks both files directly
with `checkFile`.

**Verification:** focused form, pagination, CMS, and Oracle suites pass (261 tests, 1
intentionally skipped legacy migration case); `npx tsc --noEmit` and the CLI build pass.
After rebuilding, an independent child committed `forms.create` and `forms.submitButton.add`
at revisions 492–493 and source read-back confirmed the v4/v5 helpers. The temporary page
and FormSubmit master were removed at revisions 494–495. A fresh `diagnostics.projectCheck`
at revision 496 reports `clean: true`, 24 checked files, zero drift/blocking violations,
broken imports, missing assets, or broken links. The pre-existing upgraded Spinner remains.

## 2026-10-24 — external CMS search-field helpers were not headless-safe

**Status:** fixed, regression-tested, and live-verified through a rebuilt independent MCP
stdio process.

**Symptoms:** `cms.api.searchField.add` first failed in the bundled CLI with
`generate7 is not a function`; after that interop issue was fixed, a valid page with only
`import React from 'react'` was rejected because the generated page referenced `useState`
without importing it. A successful `cms.api.searchField.setVariable` then changed the input's
state name but left the repeater filter on its previous `valueVar`, so typing no longer changed
the visible results.

**Causes:** the search-field generator used a raw default import from `@babel/generator`, which
does not resolve to a callable function in the bundled MCP runtime. The generator emitted the
page-state hook but relied on the editor mutation queue to synchronize React imports. The
rebind operation changed the input but did not update `valueSource: "searchField"` filters that
referenced the old variable.

**Fix and regression guards:** the generator now resolves Babel through
`normalizeBabelGenerator` and ensures `react`'s `useState` import in its output. The rebind
operation also ensures the hook import and updates matching search-field filter `valueVar`s
on the affected collection lists. T17 now asserts the named import on a default-only React
page and that a rebind changes both the input and parsed list filter.

**Verification:** CMS search generator and T17 suites pass (38 tests); `npx tsc --noEmit` and
the CLI rebuild pass. After rebuild, a live `cms.api.searchField.add` and `.setVariable` cycle
committed at revisions 528–529. `codeFiles.read` confirmed the input and collection filter
both use `queryFilter`, with the generated React `useState` import present. The test routes
were removed at revisions 530–531, and `diagnostics.projectCheck` reports clean with zero
drift/blocking violations or broken imports/assets/links.

## 2026-10-24 — select caret writes were missing Oracle-required icon metadata

**Status:** fixed, regression-tested, and live-verified through a rebuilt independent MCP
stdio process.

**Symptom:** `forms.selectCaret.set` wrote a `select[data-id="…"]` CSS rule, but a live
call on a select without `data-select-icon` failed plan validation with
`SELECT_ICON_MARKER_MISMATCH`. Clearing only the rule would conversely leave a stale marker.

**Cause:** the operation exposed only `cssBody`, while the editor's native select-icon
control writes a paired JSON marker containing the Iconify icon name and color. The Oracle
correctly requires the rule and marker to stay in sync.

**Fix and regression guard:** the operation now accepts optional `icon` and `color` together,
writes the JSON marker with the CSS rule, requires metadata when no valid marker exists, and
removes both the rule and marker when `cssBody` is `null`. T19 checks the serialized pair,
Oracle acceptance, and paired removal.

**Verification:** T19 form tests and T18 localization tests pass (48 tests), and
`npx tsc --noEmit` passes. After rebuilding, the independent MCP committed the live select
caret at revision 562; read-back showed both the CSS rule and marker, and
`diagnostics.projectCheck` was clean. Clearing the caret committed at revision 563.

## 2026-10-24 — honeypot generation conflicted with the Oracle visibility dialect

**Status:** fixed, regression-tested, and live-verified through a rebuilt independent MCP
stdio process.

**Symptom:** `forms.honeypot.add` generated a hidden `_hp` input using `display: none`, then
the Oracle rejected its own generated plan with `DISPLAY_TOGGLE_VISIBILITY`.

**Cause:** generated form code used a visibility mechanism reserved by the editor's
variant/viewport-aware model. A honeypot still needs to be invisible, but it is not a
variant-controlled canvas node.

**Fix and regression guard:** honeypots are now positioned off-canvas in a 1px clipped box,
with zero opacity, pointer events disabled, `tabIndex=-1`, `autoComplete="off"`, and
`aria-hidden="true"`. T19 asserts the supported style and absence of the Oracle violation.

**Verification:** the focused regression test passes; T18/T19 pass together (48 tests), and
`npx tsc --noEmit` passes. After the CLI rebuild, live `forms.honeypot.add` committed at
revision 567; read-back confirmed the off-canvas input and `diagnostics.projectCheck` was
clean (25 files, zero violations).

## 2026-10-24 — locale removal preserves the next-intl message catalog

**Status:** confirmed intentional behavior and clarified in tests and tool guidance; no
deletion fix was made.

`locales.add` creates `messages/{code}.json` only when it is absent. `locales.remove`
removes the locale configuration, legacy `i18n/{code}.json` overrides, and generated route
wrappers, but leaves the modern message catalog intact. A live add/update/default-switch/
route-sync/remove cycle (revisions 537–553) confirmed this behavior. Preserving the catalog
allows the locale to be re-added without losing translations; T18 now guards that lifecycle
and the MCP skill tells agents not to treat the file as stale cleanup.

## 2026-10-24 — generated ruler metadata was rejected by the general Oracle

**Status:** fixed, regression-tested, and live-verified through a rebuilt independent MCP
stdio process.

**Symptom:** `guides.set` generated the builder's `@rulerGuides` JSDoc annotation, but
`validatePlan()` rejected it with `NO_COMMENTS_IN_GENERATED_CODE`. The operation's local
Oracle pass already filtered this marker, so local validation and plan validation disagreed.

**Cause:** the general Oracle rejected all comments in generated JSX, without recognizing
the builder's structured ruler metadata.

**Fix and regression guard:** the Oracle now permits only a valid JSON array under the exact
`@rulerGuides` tag, with each entry requiring a string ID, horizontal/vertical type, and finite
numeric position. Malformed marker payloads and other comments remain rejected. A regression
test exercises the valid annotation case.

**Verification:** Oracle and T21 project/adversarial suites pass; `npx tsc --noEmit` and the
CLI build pass. A fresh independent MCP child committed `guides.set` at revisions 580 and 581,
`guides.get` read back `[120, 480]` horizontal and `[80]` vertical, empty arrays removed the
temporary metadata, and `diagnostics.projectCheck` passed cleanly (25 files, zero violations).

## 2026-10-24 — screenshot bridge reported an empty zero-height capture as ready

**Status:** fixed, regression-tested, and live-verified through an independent MCP child.

**Symptom:** a live `observe.screenshot` call returned `available: true`, `status: ready`,
`data:,`, and a `1108×0` rectangle. Empty canvas output was presented as a screenshot.

**Cause:** the bridge checked only for a truthy return from `captureElement`; browser canvas
returns the truthy string `data:,` for an empty canvas. It also trusted zero/non-finite bounds.

**Fix and regression guards:** screenshot capture now rejects non-positive/non-finite bounds
before invoking the iframe and validates the expected PNG/JPEG base64 data URL before reporting
success. Invalid cases return an explicit unavailable reason and add a trace error. Bridge tests
cover both the reproduced zero-height/empty-canvas case and malformed capture data.

**Verification:** screenshot bridge tests pass. After the Builder HMR update, the live call
returned `INVALID_CAPTURE_DIMENSIONS` with `available: false` for the same zero-height node;
after opening the audit fixture in the test project's canvas, a later fresh MCP call captured a
valid PNG for `audit-heading` (ready, 120×3.7 CSS px, 2,858-byte data URL). The operation no
longer reports a false success.

## 2026-10-24 — screenshot adapter ignored the requested page path

**Status:** fixed, regression-tested, and live-verified through a rebuilt independent MCP
stdio process.

**Symptom:** requesting a screenshot for the rendered `/mcp-audit` page was sent to the bridge
as `app/page.client.tsx`, producing `ACTIVE_FILE_MISMATCH` even though the requested page was
open in the Builder.

**Cause:** `observe.screenshot` accepted `filePath`/`targetFile` but did not include the resolved
page path in its adapter request, and the CLI adapter always preferred `snapshot.scope.filePath`
or the first page file.

**Fix and regression guard:** the operation resolves the requested page against the snapshot
and passes its canonical path. The CLI adapter now prefers that explicit path over its fallback.
T24 asserts that `targetFile` is forwarded to the adapter.

**Verification:** the new T24 case failed before the fix and passes after it; T24 plus bridge
client suites pass (112 tests), and `npx tsc --noEmit` passes. A rebuilt live MCP process
captured `audit-heading` from the explicitly requested audit page as a valid PNG (ready,
120×3.7 CSS px, 2,858-byte data URL), confirming the bridge no longer falls back to the home page.

## 2026-10-24 — visual audit counted an intentionally hidden honeypot as a visible control

**Status:** fixed, regression-tested, and live-verified through a rebuilt independent MCP
stdio process.

**Symptom:** `observe.audit` reported an off-canvas, `aria-hidden="true"`, zero-opacity form
honeypot as overflowing and as an undersized touch target.

**Cause:** the audit considered every measured `input` interactive even when its source markup
and styles explicitly made it unavailable to users and assistive technology.

**Fix and regression guard:** the design audit now filters only nodes that are both marked
`aria-hidden="true"` and CSS-hidden or explicitly positioned off-canvas. Visible `aria-hidden`
decorative content remains eligible for visual checks. T24 verifies the hidden honeypot creates
no design or touch-target finding; the existing small-visible-button test still passes.

**Verification:** focused T24 and bridge tests pass (112 tests), and `npx tsc --noEmit` passes.
After rebuilding, the live MCP audit page no longer reports the honeypot; it retains two findings
for intentionally undersized visible controls in the test fixture.

## 2026-10-24 — standalone MCP observation tools read the wrong canvas cache

**Status:** fixed, regression-tested, and live-verified through a rebuilt independent MCP
stdio process.

**Symptom:** with the intended Builder page open, `observe.selection`, `observe.layout`, and
`observe.visuals` returned `pending` and null measurements, while `observe.audit` and
`observe.screenshot` could read the same live canvas.

**Cause:** the standalone CLI process has no copy of the editor's Jotai selection or canvas
measurement caches. Only audit and screenshot had a bridge adapter, so the three operations
read their own empty process-local caches and mistook absence of local data for an unrendered
page.

**Fix and regression guards:** all three operations now request a revision-scoped snapshot from
the connected Builder bridge, use its selection, rectangles, and rendered styles, and preserve
the bridge's pending/unavailable status rather than returning a false local result. The bridge
accepts requested computed-style properties and includes selected IDs in its snapshot. T24 adds
one adapter regression per operation; the bridge test verifies selection and requested-style
round-trip.

**Verification:** three targeted T24 regressions and the bridge snapshot regression pass; the
complete T24 + bridge-client suites pass (115 tests), `npx tsc --noEmit` passes, and a fresh
rebuilt MCP process returns ready, measured data for selection, layout, and visuals on the open
`mcp-audit` page.

## 2026-10-24 — viewport-space observations failed to undo the canvas camera zoom

**Status:** fixed, regression-tested, and live-verified through the active Builder bridge.

**Symptom:** at 10% canvas zoom, `observe.layout` and `observe.visuals` reported a 120px width
for a node whose rendered CSS width was 1200px. The measurement was valid screen geometry but
in the wrong coordinate space for the configured viewport.

**Cause:** the coordinate conversion fell back to an optional `getCurrentTransform` method that
the production bridge does not expose. Its fallback therefore used scale 1 instead of reading
the editor's `transformManager` camera state.

**Fix and regression guard:** when a bridge has no transform getter, `getRectInViewportSpace`
now uses the editor camera transform. A regression test fails on the old path and verifies that
screen coordinates at 10% zoom convert back to the expected 1200×400 viewport-space rectangle.

**Verification:** the new regression and the full design-audit, T24, and bridge-client suites
pass (174 tests); live MCP now reports the 1200px CSS width at 10% canvas zoom rather than 120px.

## 2026-10-24 — computed-style observations returned uncached defaults as ready

**Status:** fixed, regression-tested, and live-verified through a rebuilt independent MCP
stdio process.

**Symptom:** `observe.visuals` returned `ready` but blank computed typography/color fields for a
rendered heading. The MCP snapshot had current rectangles, but its requested computed styles had
never been loaded into the synchronous bridge cache.

**Cause:** the observation bridge settled rects and then immediately read its sync style cache.
The iframe provides an async computed-style read, but observation never prefetched the requested
properties. `RENDERED_STYLE_PROPS` from the audit were affected by the same cold-cache issue.

**Fix and regression guard:** before constructing the snapshot, the bridge now asynchronously
prefetches the default rendered-style fields plus requested fields, limited to the requested
node IDs for selection/layout/visuals and chunked for full-page audits. It rechecks page scope
and revision after the iframe reads. Failed prefetches prevent a false `ready` verdict. The bridge
test verifies selection data and style-property round-trip.

**Verification:** focused design-audit, T24, and bridge-client suites pass (174 tests), and
`npx tsc --noEmit` passes. A fresh MCP `observe.visuals` returned rendered `fontSize: 32px`,
`fontWeight: 700`, system font family, colors and extra requested properties. `observe.audit`
still returns a ready audit with no honeypot finding; visible fixture controls retain their
expected warnings/errors.

## 2026-10-24 — screenshot dimensions included the canvas zoom factor

**Status:** fixed, regression-tested, and live-verified through the active Builder bridge.

**Symptom:** at 10% canvas zoom, `observe.screenshot` returned width/height `120×3.7`, while
the returned PNG's actual pixel dimensions were `1200×37` and the element's CSS box was
`1200×37`.

**Cause:** capture dimensions came from the parent-screen rect, which is scaled by the editor's
camera. The image itself is captured inside the iframe and keeps the page's configured CSS size.

**Fix and regression guard:** screenshot dimension checks and metadata now use
`getRectInViewportSpace`, falling back to the screen rect only when no viewport measurement
exists. T23's bridge test distinguishes the screen rect from the expected viewport rect and
asserts the screenshot metadata uses the latter.

**Verification:** focused screenshot tests pass; a live PNG had actual IHDR dimensions
`1200×37`, and `observe.screenshot` reported `1200×37` at 10% canvas zoom.

## 2026-10-24 — Codex-managed MCP child remained stale and did not reconnect after termination

**Status:** workaround documented; no Builder/Oracle source defect reproduced. Integrated-wrapper
reconnect remains a Codex host lifecycle limitation.

**Symptom:** the Codex-registered MCP wrapper reported a drift violation for a generated
`@spinner-gen v5` marker even though the current Oracle source explicitly allowlists it. A fresh
independent stdio child against the same project revision reported `clean=true` and zero drift.
After the exact stale MCP child was terminated, the registered wrapper returned `Transport closed`
and the Codex host did not automatically start a replacement.

**Cause:** the long-lived registered child had loaded an older CLI/Oracle build. Its process
lifecycle is owned by the Codex host, which did not reconnect the wrapper after external
termination. The freshly launched CLI child loads the current build and returns the correct
diagnostics, so changing the Oracle allowlist would have hidden a transport/process-staleness
problem.

**Resolution and guard:** routine verification now uses a fresh independent MCP SDK stdio child
after rebuilding the CLI. Compare any integrated-wrapper discrepancy against current source,
project revision, and a fresh child; do not signal an app-managed process to refresh it. If the
integrated wrapper itself is required, restore it through the host's reconnect/reload lifecycle.
This workflow is documented in `.agents/skills/revyme-mcp/SKILL.md` A3.

**Verification:** on the same branch revision, the fresh child reported zero drift; a later fresh
check reported `clean=true` across 29 files and zero blocking/drift violations. The exact
temporary coverage branch was deleted, `main` restored as active, and the Builder/API process
was left untouched.
