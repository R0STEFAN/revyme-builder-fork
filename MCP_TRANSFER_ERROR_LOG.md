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
