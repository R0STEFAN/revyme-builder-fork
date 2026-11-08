# Revyme Framer Porter & MCP Bug Journal — Project Migration Test

**Target Project:** `proj-1794157101920-rz0ttf`  
**Source File:** `/home/rost/Завантажене/framer-native-gNeZkstCZ7bnyRrtX9Va.json`  
**Branch:** `feature/mcp-v2`  
**Date:** 2026-11-08  
**Environment:** Headless Automation CLI (`@revyme/cli`), ProjectFS CAS Revision 142  
**Author:** Antigravity AI Assistant  

---

## 1. Executive Summary

During the end-to-end migration of the Framer project into Revyme project `proj-1794157101920-rz0ttf` using MCP `framer-porter` and MCP `revyme`, comprehensive testing of the MCP operations (`framer.inspect`, `framer.tokens`, `framer.cms`, `framer.slice`) and Revyme management tools was performed.

Three critical bugs were diagnosed in the Framer transfer extraction engine (`src/code/import/framer-native/`), which caused token corruption, empty CMS records, and broken page routing. These issues were resolved, verified by unit and regression test suites, compiled into `@revyme/cli`, and committed locally.

---

## 2. Issues Diagnosed & Resolved

### Issue 1: Malformed Typography Tokens & Missing Font/Weight (`framer.tokens`)
- **Symptom:**
  - `framer.tokens` returned `lineHeight: "1,em"` and `letterSpacing: "-0.04,em"`. In CSS/React, this string syntax with commas is invalid CSS, causing downstream parser and style generation errors.
  - `fontFamily` and `fontWeight` were returned as `undefined` for all typography presets using Framer built-in fonts (e.g. `BI;Open Sauce Two/Medium/v0`).
- **Root Cause:**
  1. In `src/code/import/framer-native/agent-slice.ts`, `raw.lineHeight` and `raw.letterSpacing` were converted using `String(raw.lineHeight)`. In Framer's AST, these values are stored as 2-element tuples `[1, "em"]` and `[-0.04, "em"]`, which JavaScript converts to comma-separated strings `"1,em"` and `"-0.04,em"`.
  2. In `src/code/import/framer-native/text.ts`, `parseSourceBuiltInFont` only checked `FR;` and `Inter-` prefixes, ignoring Framer built-in fonts starting with `BI;` (e.g., `BI;<family>/<variant>/<version>`).
- **Fix:**
  - Updated `parseSourceBuiltInFont` in `text.ts` to parse `BI;` built-in fonts with slash-separated font family and variant names (e.g., `Medium` -> 500, `SemiBold` -> 600, etc.).
  - Updated `extractTransferTokens` in `agent-slice.ts` to utilize `mapSourceTypography` and normalize tuple `lineHeight` (`"1"`) and `letterSpacing` (`"-0.04em"`), and resolve `fontFamily` and `fontWeight`.
- **Verification:**
  - Added unit test in `src/code/import/framer-native/agent-slice.test.ts` verifying normalized values and `BI;` font resolution. All 272 tests in `framer-native` and 9 tests in `agent-slice` passed.

---

### Issue 2: Empty CMS Records & Missing Item Slugs (`framer.cms`)
- **Symptom:**
  - `framer.cms` returned collections with correct field schemas, but every item's `data` object was empty (`data: {}`), and `item.slug` fell back to internal node IDs like `ttrx1mZej` instead of semantic slugs like `edbost`.
- **Root Cause:**
  - In `src/code/import/framer-native/agent-slice.ts`, `extractTransferCms` looked for `raw[field.id]` or `raw[field.name]`. In Framer `CollectionItemNode` structures, field values are stored under `$control__<fieldId>` as `{ type, value }` control objects.
- **Fix:**
  - Updated `extractTransferCms` to check `raw[`$control__${field.id}`]` and extract `.value` when present.
  - Populated `fieldData` with both field IDs and field names to support seamless integration with `cms.items.create`.
  - Added slug field detection (`field.type === 'slug'` or `field.name.toLowerCase() === 'slug'`) to assign the real item slug (e.g. `edbost`).
- **Verification:**
  - Added test assertion in `src/code/import/framer-native/agent-slice.test.ts` ensuring populated fields on items. Verified output on live capture contains complete portfolio case study records.

---

### Issue 3: Page Route Fallback to Root `/` (`framer.inspect`)
- **Symptom:**
  - `framer.inspect` reported `route: "/"` for every single page in the project (`About`, `Portfolio`, `Contact`, `404`).
- **Root Cause:**
  - `inspectNativeTransfer` assigned `route = String(node.raw.path ?? '/')`. In Framer, routes are represented in the `RouteSegmentNode` hierarchy and computed via `sourcePageRoute(graph, node)`.
- **Fix:**
  - Updated `inspectNativeTransfer` to call `sourcePageRoute(graph, node)` with graceful fallback to `node.raw.path ?? '/'`.
- **Verification:**
  - `framer.inspect` now correctly reports:
    - `Home` -> `/`
    - `About` -> `/about`
    - `Page` -> `/portfolio`
    - `Portfolio` -> `/portfolio/[slug]`
    - `Contact` -> `/contact`
    - `Page` -> `/404`

---

### Issue 4: `--projectId` CamelCase CLI Flag Ignored & Target File Scope Missing
- **Symptom:**
  - Invoking CLI operations with `--projectId <id>` (camelCase) caused the CLI to ignore the override and fall back to the project ID saved in `.revymelocal/automation.json`.
  - In addition, target file paths (`targetFile`, `filePath`) were not propagated to the CLI execution `scope`, leading to potential plan validation hash mismatches for file-specific mutations.
- **Root Cause:**
  1. In `packages/cli/src/main.ts`, `loadConfig` was called with `projectId: flags['project-id']`, which did not check `flags.projectId`.
  2. Flag collection for `inputData` did not exclude camelCase reserved flags (`projectId`, `branchId`, `apiUrl`, `inputFile`, `dryRun`), causing them to leak into operation input payloads.
  3. `scope` in `main.ts` did not resolve `filePath` from `inputData.targetFile` or `inputData.filePath`.
- **Fix:**
  - Updated `main.ts` to check `flags.projectId || flags['project-id']`, `flags.branchId || flags['branch-id']`, and `flags.api || flags.apiUrl`.
  - Added `reservedFlags` set with both kebab-case and camelCase keys.
  - Added `scopeFilePath` resolution in `main.ts` matching `mcp.ts`.
- **Verification:**
  - Ran `tokens.set --projectId proj-1794157101920-rz0ttf ...` and verified that revision was committed directly to `proj-1794157101920-rz0ttf` and live synchronized with the open editor tab. All 44 CLI tests passed.

---

### Issue 5: CMS Item `_slug` Derivation Ignored Explicit `slug` Fields & Property Aliases
- **Symptom:**
  - When creating CMS records via `cms.items.create`, newly created items received placeholder slugs like `_slug: "item"`, `_slug: "item-2"`, even though the schema had a designated `Slug` field and the input contained valid slug values.
  - In addition, fields supplied by name (e.g. `"Project Title"`) were not mirrored to their schema IDs (e.g. `"title"`).
- **Root Cause:**
  - In `src/code/project/cms-ops.ts`, `addCollectionItem` only checked `item._slug` and `firstTextField && item[firstTextField.id]`. It did not check `item.slug`, did not check schema fields of `type: 'slug'`, and did not resolve fields by display name (`f.name`).
- **Fix:**
  - Updated `addCollectionItem` in `cms-ops.ts` to check `item._slug`, then `item.slug`, then schema field of `type: 'slug'`, then `firstTextField`, checking both `.id` and `.name`.
  - Added dual mapping for all schema fields (`item[f.id]` and `item[f.name]`) so items are queryable by either property.
- **Verification:**
  - Added test in `src/code/project/cms-ops.test.ts` verifying slug derivation from slug fields and field names. All 128 tests in `cms-ops` passed.

---

### Issue 6: Component Instances Opaque & Not Inlined (`framer.slice` & `framer.inspect`)
- **Symptom:**
  - When calling `framer.slice` on a page (such as `Home` / `augiA20Il`) or layout template, any Framer SmartComponent placed on the canvas (e.g. `Nav`, `Header`, `Portfolio Box`, `Header Box`) was output as an empty `<div class="CodeComponentNode">` with `children: []`.
  - The agent could not inspect the inner elements of components (e.g. Bento Grid layout, card titles, text, images, and links), causing blind design assumptions and missing layout structures.
  - In addition, `framer.inspect` only listed top-level page IDs and routes without indicating which components were utilized on each page or section.
- **Root Cause:**
  1. In Framer's AST, instances of SmartComponents on canvas frames are stored as `CodeComponentNode` with `codeComponentIdentifier: "local-module:canvasComponent/<componentId>:default"` and empty `children: []`.
  2. In `src/code/import/framer-native/agent-slice.ts`, `extractTransferSlice` did not inspect or expand `CodeComponentNode`. It treated them as terminal leaf nodes.
  3. Control values passed to instances (`$control__<varId>`) and variable references (`textContent: { type: "variableReference", id: ... }`, `fillImage`, `link`) were not propagated or resolved.
  4. Media asset references (`data:framer/asset-reference,...`) and page links (`{ type: "webPage", webPageId: ... }`) were not converted to clean semantic URLs and routes.
- **Fix:**
  - Enhanced `agent-slice.ts` with recursive component inlining:
    - Automatically detects `local-module:canvasComponent/<componentId>:default`, looks up the master `SmartComponentNode`, resolves the selected variant frame (or base variant / Desktop), and traverses all its child frames.
    - Resolves instance control overrides (`$control__*`), mapping variable references in `textContent`, `fillImage`, and `link` down the component tree.
    - Added `resolveAssetUrl` to map Framer asset references to real URLs (e.g. avatar portrait and tool icons).
    - Added `resolveLink` to map Framer `webPage` and `url` objects to routes (`/about`, `/portfolio`, `/contact`).
    - Added `components` list to `pages` and `sections` in `inspectNativeTransfer` so `framer.inspect` shows all components used on every page and template.
- **Verification:**
  - Added unit test in `src/code/import/framer-native/agent-slice.test.ts` verifying recursive component inlining, variable overrides, link resolution, and component listing in `inspectNativeTransfer`.
  - Verified on live Framer JSON capture: `framer.inspect` reports exact component dependencies for all 6 pages and layout templates, and `framer.slice` successfully inlines the entire Bento Grid, cards, texts, and links.

---

### Issue 7: Variant Leakage in Nested Inlining (`agent-slice.ts`)
- **Symptom:**
  - When inlining nested component instances inside another component (e.g. `HeaderBox` inside `Header`), child instances inherited the parent component's active variant ID (such as `M6uxoYlpQ`), causing child components to erroneously resolve to the parent variant node or default fallback.
- **Root Cause:**
  - In `agent-slice.ts`, `node.raw.$control__variant` was passed or inherited from parent scope without verifying that the variant ID belonged to the child component's own master variant collection.
- **Fix:**
  - Scoped variant resolution to the instance's own explicit control value (`$control__variant`) or the component's own `baseVariantId` / `children[0]`.
- **Verification:**
  - Verified on live capture that `HeaderBox` correctly resolves its own `Nv38W5Tsu` (Desktop) variant while embedded inside `Header` (`M6uxoYlpQ`).

---

### Issue 8: Missing Component & Motion/Interactivity Inspection (`framer.component` & `framer.slice`)
- **Symptom:**
  - Agents had no dedicated MCP query tool to inspect Framer SmartComponents, their internal variables (`$control__*`), their variant hierarchies (`Desktop`, `Hover`, `Pressed`, custom states), their animation transitions (spring stiffness, damping), or their interaction event wiring (`useSetVariant` triggers on `mouseEnter` / `mouseLeave`).
  - `framer.slice` omitted `motion` (hover scale, appear transitions), `textEffect` (splitText character animations), and `variants` lists from the semantic slice hierarchy.
- **Root Cause:**
  - `framer-porter` only supported 4 static query operations (`inspect`, `tokens`, `slice`, `cms`). SmartComponent definitions, variant transitions, and event control dictionaries remained unextracted.
- **Fix:**
  - Created and registered `framer.component` in `packages/automation-core/src/operations/framer-query.ts` and `src/code/import/framer-native/agent-slice.ts`:
    - Extracts component variables (`Label`, `Link`, `Padding`, `Radius`, `BG Blur`).
    - Extracts all variants with gestures (`hover`, `pressed`), replica overrides (opacity, icon transforms, text rolling), and physics transitions (`spring`, `stiffness: 400`, `damping: 80`).
    - Extracts interactive event wiring (`actionIdentifier: "framer/useSetVariant"` mapping `mouseEnter` and `mouseLeave` to target variants).
  - Enriched `framer.slice` output with `motion`, `textEffect`, and `variants` metadata.
- **Verification:**
  - Added unit test in `packages/automation-core/test/capabilities/framer-query.test.ts`. All 18 tests passed.
  - Verified via CLI on live capture for `SlYfGW2gH` (`Header Box`) and `I5JSnLPt8` (`Header`).

---


