# Ninth Meridian — Revyme MCP v2 Bug Audit, Diagnosed Issues & Fixes Log

**Project ID:** `proj-1792922782087-qo0wnl`  
**Site:** Ninth Meridian (Dark-sky Desert Observatory & Residence)  
**Branch:** `feature/mcp-v2`  
**Date:** 2026-10-25  
**Author:** Antigravity AI Assistant

---

## Executive Summary

During the end-to-end automated construction and testing of the long scroll-choreographed landing page for **Ninth Meridian** (dark-sky desert observatory with rooms) in project `proj-1792922782087-qo0wnl`, comprehensive MCP v2 operations were systematically executed and audited across all layers:
1. Global design tokens, palettes, and typography presets (`tokens.set`, `typography.set`, `fonts.import`, `workflow.batch`).
2. Reusable Design Components with typed props and visual variants (`components.create`, `styles.set`).
3. Choreographed interactive Code Components (`codeFiles.submit` with `@controls` and `useStaticCanvas`).
4. Page layout assembly (`app/page.client.tsx`) conforming strictly to the Revyme three-tier hierarchy and Oracle dialect.
5. Smooth scrolling site effect configuration (`siteEffects.smoothScroll.set`).
6. Responsive multi-viewport overrides (`viewports.setOverride`).
7. Full project diagnostics, deployment preflight, preview generation, and production export (`diagnostics.projectCheck`, `publish.preflight`, `preview.build`, `export.generate`).

During this automated run, 2 server-level bugs were identified in `@revyme/automation-core`, diagnosed, fixed, accompanied by automated regression tests in vitest, and verified with zero remaining defects.

---

## 1. Diagnosed MCP Server Bugs & Code Fixes

### Bug 1.1: Preflight Asset Scanner Falsely Flagging Template Literal Expressions (`assets.unlinked:${GRAIN_SVG}`)
- **Location:** `packages/automation-core/src/operations/publish.ts` (lines 381–399).
- **Symptom:** `publish.preflight` failed with a fatal error:
  ```json
  {
    "name": "assets.unlinked:${GRAIN_SVG}",
    "category": "assets",
    "status": "fail",
    "path": "components/FilmGrain.tsx",
    "message": "Missing static asset \"${GRAIN_SVG}\" referenced in \"components/FilmGrain.tsx\""
  }
  ```
- **Root Cause:** The static asset path scanner uses regex `/(?<![A-Za-z0-9_$])url\(\s*['"]([^'"]+)['"]\s*\)/g` to detect unlinked images referenced in CSS. In React components with template literals such as `backgroundImage: \`url("\${GRAIN_SVG}")\``, the literal source code inside the quotes is `"${GRAIN_SVG}"`. The scanner treated `${GRAIN_SVG}` as a static relative file path in `public/`, rather than an interpolated JavaScript variable.
- **Fix:** Added guards in `publish.ts` to skip any scanned value containing `${` or starting with `$`:
  ```ts
  if (val && !/^(https?:|\/\/|data:|blob:)/i.test(val) && !val.includes('${') && !val.startsWith('$')) {
    staticRefs.push({ file: path, rawPath: val });
  }
  ```
- **Verification:** Added vitest regression test `ignores interpolated template variables in CSS url() expressions` in `packages/automation-core/test/capabilities/T23-release.test.ts`. Passed cleanly.

---

### Bug 1.2: Next.js Root Server Layout Treated as Canvas Client Template (`oracle.app/layout.tsx`)
- **Location:** `packages/automation-core/src/operations/publish.ts` (lines 244–256).
- **Symptom:** `publish.preflight` flagged 24 Oracle violations on `app/layout.tsx`:
  - `USE_CLIENT_REQUIRED`: Pages and templates must start with `'use client';`.
  - `FORBIDDEN_IMPORT`: Cannot import `"./globals.css"`, `"./providers"`, `"./smooth-scroll-controller"`.
  - `PAGE_EXTRA_EXPORT`: `export const metadata` and `export const siteConfig`.
  - `MISSING_DATA_ID`: `<html>`, `<body>`, `<Providers>`.
  - `PAGE_ROOT_REQUIRED`: Page has no element with `data-id="root"`.
- **Root Cause:** Next.js App Router uses `app/layout.tsx` as the server root HTML wrapper (with `<html>`, `<body>`, Next.js SEO metadata exports, and CSS imports). In `publish.ts`, line 244 used `/(^|\/)(layout|LayoutClient)\.tsx$/.test(path)` and routed `app/layout.tsx` to `checkFile({ kind: 'template' })`. This violated the builder invariant documented in `revyme-mcp/SKILL.md` (lines 65–69): *"Distinguish Next.js server layout.tsx wrappers from editable route-group LayoutClient.tsx templates. The server wrapper may contain metadata, CSS imports, and `<html>/<body>`; do not apply canvas-page expectations to it."*
- **Fix:** Added a server layout bypass in `packages/automation-core/src/operations/publish.ts`:
  ```ts
  // In Next.js App Router, root layout.tsx is the server HTML wrapper (contains <html>/<body>/metadata).
  // Only editable route-group LayoutClient.tsx or layout files without server root wrappers are canvas templates.
  if (/(^|\/)layout\.tsx$/.test(path)) {
    if (code.includes('<html') || code.includes('<body') || code.includes('export const metadata') || code.includes('export const siteConfig')) {
      continue;
    }
  }
  ```
- **Verification:** Added vitest regression test `bypasses Next.js root server layout.tsx from client canvas Oracle checks` in `packages/automation-core/test/capabilities/T23-release.test.ts`. All 35 tests in suite passed.

---

## 2. Builder & MCP Dialect Invariants Verified

During the construction process, the following Oracle and Builder rules were verified in practice:

1. **`components.create` variant definition:**
   The `default` variant is built-in as primary. Specifying `{ name: 'default' }` in `variants` triggers `COMPONENT_BUILD_ERROR: Variant "default" is built in (primary) — declare only the extra states.`
2. **`components.create` root node naming:**
   The component layout's outer container must not use `[component-name]-root` (e.g. `rate-row-root`), because `components.create` automatically wraps the component in an outer `<div data-id="[component-name]-root">`.
3. **`components.create` declared props binding:**
   Every prop declared in `props` must be bound in text `{propName}` or in a style value in the component's layout elements.
4. **Code Component JSDoc Annotations:**
   Every code component must declare `/** @defaultWidth <px> */` and `/** @defaultHeight <px> */`, plus a valid JSON object in `/** @controls { ... } */`.
5. **Canvas Animation Safety (`useStaticCanvas`):**
   Any code component running `requestAnimationFrame` loops must import and call `useStaticCanvas()` from `@revyme/runtime` to draw a single static frame in the builder canvas editor and disable background animation loops.
6. **Canvas Layout Infinite Loop Prevention (`[CANVAS_FILL_FEEDBACK]`):**
   `<canvas>` elements spanning 100% width/height must use `position: 'absolute'`, `top: '0px'`, `left: '0px'` inside a `position: 'relative'` container to prevent clientHeight feedback through ResizeObserver.
7. **Oracle Page Dialect:**
   - No JSX comments (`{/* ... */}`) in page files.
   - Root artboard takes `position: 'relative'`, `width: '100%'`, `height: 'auto'` (no `minHeight: '100vh'`).
   - Page links must use Next.js `<Link href="...">`, not raw `<a>`.
   - Flow children in flex/grid containers require explicit quoted sequential `order: '0'`, `order: '1'`, etc.
   - Flow children in flex containers require `flex: '0 0 auto'` (no unconstrained shrinking).
   - Text styling properties (`color`, `fontFamily`, `fontSize`) must reside directly on text tags, never on parent frame containers.

---

## 3. Preflight & Quality Gate Results

- **`diagnostics.projectCheck`:**
  - `clean: true`, `passed: true`
  - Total files checked: 18
  - Clean files: 18, Error files: 0
  - Blocking violations: 0, Drift violations: 0, Broken links: 0, Missing assets: 0
- **`publish.preflight`:**
  - `passed: true`
  - Total checks: 6, Passed checks: 6, Failed checks: 0, Fatal count: 0, Warnings: 0
- **`preview.build`:**
  - `status: "ready"`
  - Routes validated: 1 (`/` → `app/page.client.tsx`)
- **`export.generate` (Next.js):**
  - Generated: `proj-1792922782087-qo0wnl-nextjs.zip`
  - Total files in archive: 30
  - `preflightClean: true`
