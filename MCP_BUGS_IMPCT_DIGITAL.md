# IMPCT.DIGITAL — Revyme MCP v2 Bug Audit, Diagnosed Issues & Fixes Log

**Project ID:** `proj-1793441277154-mphh5d`  
**Site:** IMPCT.DIGITAL (Swiss Kinetic Brutalism × Warm Alabaster Editorial)  
**Branch:** `main`  
**Date:** 2026-10-31  
**Author:** Antigravity AI Assistant

---

## Executive Summary

During the end-to-end automated construction and testing of the **IMPCT.DIGITAL** production website via Revyme MCP v2 tools, operations across all domains (tokens, presets, fonts, components, code files, layout, viewports, diagnostics) were tested and audited. Detected bugs and edge cases in MCP operations and code generators were systematically diagnosed, fixed in the codebase, verified with automated unit tests, and documented here.

Following implementation, the site was audited with the **Impeccable MCP** engine to eliminate AI slop, and compiled with Next.js Turbopack prerendering with 0 errors.

---

## 1. Diagnosed Issues & Code Fixes

### Bug 1.1: `getSupportedWeightsForFont` Stripped Bold Weights (500–800) Due to Catalog 8-Variant Truncation
- **Location:** `src/code/generation/next-font-gen.ts` (lines 50–65).
- **Symptom:** Running `fonts.import` for standard multi-weight Google Fonts like `JetBrains Mono` or `Plus Jakarta Sans` with requested weights `["400", "500", "600", "700"]` returned only `["400"]`, stripping all bold and semi-bold weights from the generated `@import` URL.
- **Root Cause:** In `src/shared/google-fonts-catalog.json`, all 1,950 font entries were capped at a maximum of 8 variants. For fonts that include italic variants (e.g. `100`, `100i`, `200`, `200i`, `300`, `300i`, `regular`, `italic`), the 8-item array was exhausted before reaching weights `500` through `900`. `getSupportedWeightsForFont` filtered requested weights strictly against `entry.variants`, causing all weights $\ge 500$ to be dropped.
- **Fix:** Added detection in `getSupportedWeightsForFont`: when a font's catalog entry has 8 or more variants and includes italic variants (`v.endsWith('i')`), the catalog is identified as truncated, allowing standard Google Font weights `100`..`900` to be accepted when requested.
- **Verification:** Added regression test `preserves bold and semi-bold weights for catalog fonts with truncated variants (JetBrains Mono, Inter)` to `src/code/generation/next-font-gen.test.ts`. All 10 unit tests passed. Rebuilt `@revyme/cli`.

### Bug 1.2: `fonts.import` Failed In-Place Replacement and Duplicated `@import` Lines Due to Literal Backslash Escape in `String.prototype.includes`
- **Location:** `packages/automation-core/src/operations/fonts.ts` (lines 126–140).
- **Symptom:** Repeatedly running `fonts.import` for a font family with spaces (e.g. `JetBrains Mono` or `Plus Jakarta Sans`) created duplicate `@import` lines at the top of `app/globals.css` instead of updating the existing line in place.
- **Root Cause:** The code constructed `escapedName = cleanFamily.replace(/ /g, '\\+')` and checked `existingImportLines.findIndex(line => line.includes(escapedName))`. Because `String.prototype.includes` performs literal string matching (not regular expression evaluation), it looked for literal `\` followed by `+`, which never matched the URL format `JetBrains+Mono`.
- **Fix:** Switched to `urlFamilyName = cleanFamily.replace(/ /g, '+')`, filtered out all existing lines containing either `urlFamilyName` or `cleanFamily`, and pushed the new import line. This guarantees idempotency and eliminates duplicates.
- **Verification:** Re-imported `JetBrains Mono` and `Plus Jakarta Sans`; verified via `codeFiles.read` that `app/globals.css` contains exactly one clean `@import` line per font family.

### Bug 1.3: `typography.set` Did Not Normalize CSS Property Aliases (`fontFamily`, `fontSize`, etc.) to Canonical Preset Suffixes
- **Location:** `packages/automation-core/src/operations/typography.ts` (lines 320–345).
- **Symptom:** Supplying standard camelCase CSS properties like `fontFamily`, `fontSize`, `fontWeight`, `letterSpacing`, `lineHeight`, `textTransform` in `--values` caused `typography.set` to generate non-standard token names (e.g. `--typo-hero-fontFamily`) while leaving canonical tokens (e.g. `--typo-hero-font`) at their default `'Inter'` values.
- **Root Cause:** `typography.set` directly mapped raw keys from `input.values` without normalizing them against the canonical `TYPO_SUFFIXES` recognized by `groupTypographyPresets` and the builder's styling engines.
- **Fix:** Added `propertyAliasMap` normalizing `fontFamily` → `font`, `fontSize` → `size`, `fontWeight` → `weight`, `letterSpacing` → `spacing`, `lineHeight` → `line-height`, `textTransform` → `transform`, `textDecoration` → `decoration`, `textShadow` → `shadow` across base values and responsive tier overrides.
- **Verification:** Rebuilt `@revyme/cli` and executed `typography.set` across all display, heading, body, and mono presets; verified via `typography.list` that all typography groups correctly bind to their specified fonts, weights, sizes, and responsive tiers.

---

## 2. Oracle & MCP Architectural Rules Discovered & Handled

During component construction and placement, the following Revyme Oracle rules were mapped and satisfied:

1. **`CANVAS_PAGE_SUBMISSION_DISALLOWED`**:
   - `codeFiles.submit` forbids direct overwrites to `app/**/page.client.tsx` to maintain canvas artboard AST synchronization. Page composition must be performed via `components.instance.create`, `nodes.create`, and `nodes.update`.
2. **`PAGE_ROOT_VIEWPORT_SIZE` & `MINMAX_SIZE_UNIT`**:
   - The canvas artboard `root` element (`data-id="root"`) rejects `minHeight: '100vh'` or viewport units because viewports are managed dynamically by the canvas container. Root styled with `width: '100%'`, `height: 'auto'`, `backgroundColor: 'var(--bg-canvas)'`.
3. **`HANDLER_CONTENT_STATE`**:
   - Event handlers inside Code Components are blocked if they call 2 or more distinct `set*` useState setters sequentially (e.g. `setA(1); setB(2);`), as the Oracle classifies this as an implicit state machine prone to desynchronization. Resolved by consolidating multi-variable state into single structured state objects (`useState({ ... })`).
4. **`CLASSNAME_STYLING`**:
   - All Code Components must apply styles via inline style objects reading from CSS variable presets (`var(--bg-canvas)`, `var(--ink-primary)`, `var(--accent-orange)`, etc.) rather than Tailwind or ad-hoc classNames.

---

## 3. Impeccable MCP Anti-Slop Audit & Fix

The deterministic **Impeccable MCP** engine was executed against all component and styling targets (`impeccable_detect`).

### Initial Audit Result:
- **Finding:** `[slop] Overused font: Plus Jakarta Sans` in `app/globals.css`.
- **Diagnosis:** Impeccable flagged `Plus Jakarta Sans` as an overused AI-slop archetype (along with `Inter`, `Roboto`, `Geist`, and `Space Grotesk`).
- **Remediation:**
  1. Selected **`Manrope`** — a distinctive, high-craft European neo-grotesque with comprehensive Ukrainian/Cyrillic & Latin support, optical precision, and Swiss architectural lineage.
  2. Imported `Manrope` weights `["400", "500", "600", "700"]` via `fonts.import`.
  3. Re-bound presets `--typo-body-default-font` and `--typo-body-lead-font` to `"Manrope", sans-serif`.
  4. Removed the legacy `Plus Jakarta Sans` `@import` from `app/globals.css`.
- **Post-Fix Audit Result:**
  ```json
  {
    "status": "clean",
    "findingsCount": 0,
    "findings": [],
    "summary": "✅ No anti-patterns or design flaws detected. Clean craft."
  }
  ```

---

## 4. Final Verification Matrix

| Check | Tool / Mechanism | Result |
|---|---|---|
| Project Health & Oracle Rules | `diagnostics.projectCheck` | **15/15 files clean (0 violations, 0 broken links/imports)** |
| Impeccable AI Slop Audit | `impeccable_detect` | **0 anti-patterns detected ("Clean craft")** |
| Turbopack Production Compilation | `POST /api/local-server/:projectId/build` | **✓ Compiled successfully in 1365ms, static prerendered** |
| Design Tokens / Presets Integrity | `tokens.list` & `typography.list` | **100% token-driven, zero raw hex values in JSX** |
| Verified Unsplash Photography | Manifest inspection | **All 6 exact URLs configured with grayscale/contrast filters** |
