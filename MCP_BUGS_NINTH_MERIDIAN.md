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

During this automated run, 3 server-level bugs were identified in `@revyme/automation-core`, diagnosed, fixed, accompanied by automated regression tests in vitest, and verified with zero remaining defects.

---

## 1. Diagnosed MCP Server Bugs & Code Fixes

### Bug 1.3: `typography.apply` JSX Syntax Corruption (`{`{``) on Style Block Migration
- **Location:** `packages/automation-core/src/operations/typography.ts` (`upsertTypographyResponsiveBlock`, lines 145–160).
- **Symptom:** Executing `typography.apply` on a node when a page already has an unlabelled `<style>{`...`}</style>` block threw a fatal error:
  ```json
  {
    "code": "PLAN_VALIDATION_FAILED",
    "message": "Syntax error in app/page.client.tsx: Unexpected token, expected \"}\" (74:4)"
  }
  ```
- **Root Cause:** When `upsertTypographyResponsiveBlock` detected an existing `<style>{`...`}</style>` block, it attempted to migrate existing rules into `<style data-id="typography-responsive-${nodeId}" ...>`. However:
  1. It extracted `code.slice(openingEnd + 1, expressionEnd)`. Since `openingEnd` pointed to the `>` of `<style>`, `openingEnd + 1` was `{`. This meant `existingRules` captured `{` and `` ` ``!
  2. It then interpolated `existingRules` into `{\`${existingRules}\n${rules}\n\`}`, producing invalid JSX `{`{`...`}``, breaking Babel compilation.
  3. The fallback insertion used regex `code.replace(/(<\/div>|<\/section>|<\/main>)([\s\S]*?$)/, ...)`, which inadvertently matched the very first `</div>` in the document instead of the root closing tag.
- **Fix:** Corrected expression boundaries to index `{` and slice `exprStart + 2` to strictly extract the rule body without delimiters. Changed root container fallback to `code.lastIndexOf('</div>')`.
- **Verification:** Added vitest regression test `legacy style block without data-id correctly migrates without syntax corruption {`{`` in `packages/automation-core/test/capabilities/T08-design-system.test.ts`. All 8 tests in T08 passed cleanly.

---

### Bug 1.4: `extractStyleCSS` Failed to Match `<style>` Tags with Attributes
- **Location:** `src/code/parsing/parser.ts` (`extractStyleCSS`, line 784).
- **Symptom:** Canvas responsive breakpoint previews (`Tablet 810`, `Mobile 390`) failed to render responsive media queries defined in `<style data-id="...">` or `<style data-name="...">` tags, causing the canvas to display only desktop styling.
- **Root Cause:** The parser regular expression:
  ```ts
  const styleMatch = /<style>\s*\{[`'"]([\s\S]*?)[`'"]\}\s*<\/style>/gs;
  ```
  strictly expected a bare `<style>` tag without any JSX attributes. Because Revyme's Oracle rule `ORACLE_ATTRS_REQUIRED` mandates `data-id` (and optionally `data-name`, `style`) on all tags in page JSX, any compliant `<style data-id="..." data-name="...">` tag was silently skipped. `extractStyleCSS` returned an empty string, preventing `Renderer.ts` from converting page `@media` queries into responsive canvas `@container` queries.
- **Fix:** Updated the regex in `src/code/parsing/parser.ts` to support optional attributes:
  ```ts
  const styleMatch = /<style\b[^>]*>\s*\{[`'"]([\s\S]*?)[`'"]\}\s*<\/style>/gs;
  ```
- **Verification:** Added automated unit test in `src/code/parsing/parser.test.ts`:
  `extracts CSS from style tags with attributes (e.g. data-id, data-name)`. Commit: `51da5d3`.

---

### Bug 1.5: Oracle `PAGE_LINK_NOT_NEXTLINK` False Positive on Component Instances
- **Location:** `src/code/oracle/checks/link-rules.ts` (`checkPageLinks`, line 21).
- **Symptom:** When placing a design component instance that accepts an `href` prop (e.g. `<ObservatoryButton data-id="obs-btn" href="#rates" label="RESERVE" />`) onto a page, the Oracle checker rejected the page:
  ```json
  {
    "code": "PAGE_LINK_NOT_NEXTLINK",
    "message": "Page links must use Next.js <Link href=\"...\">, not raw <a> (found <ObservatoryButton href=\"#rates\">)"
  }
  ```
- **Root Cause:** `checkPageLinks` inspected all JSX elements that contained an `href` prop:
  ```ts
  if (tag === 'Link' || tag === 'MotionLink') return;
  ```
  It assumed that any JSX element with an `href` prop was an anchor element (`<a>`). When a user or designer encapsulated navigation into a design component (like a button component with hover variants and an `href` prop), the checker treated the component instance itself as an illegal raw `<a>` tag.
- **Fix:** In `src/code/oracle/checks/link-rules.ts`, exempted uppercase React component identifiers:
  ```ts
  if (tag === 'Link' || tag === 'MotionLink' || /^[A-Z]/.test(tag)) return;
  ```
  This permits custom component instances with `href` props while strictly enforcing that native lowercase elements with `href` must be Next.js `<Link>` or `<MotionLink>`.
- **Verification:** Added vitest regression tests in `src/code/oracle/page-links-dialect.test.ts`:
  `allows component instances (PascalCase) with href prop on pages`. Commit: `7334269`.

---

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

8. **`COMPONENT_LINK_NOT_MOTIONLINK`:**
   Inside design components (`components/*.tsx`), any navigating link with `href` MUST NOT be a raw `<a>` or plain `<Link>`. It must declare `const MotionLink = motion.create(Link)` and render `<MotionLink data-id="..." data-name="a" href="..." layout style={{ ... }}>`.
9. **`MOTION_PROPS_ON_PLAIN_TAG`:**
   Any element with motion props like `onTap` must be a motion component (e.g. `<motion.button>` rather than `<button>`).
10. **`SPACING_UNIT_NOT_PX`:**
    In design components, Padding/Margin/Radius controls are PX-only. Values like `clamp(...)` or `%` in inline padding/margin/radius trigger `SPACING_UNIT_NOT_PX`. Fluid typography with `clamp()` belongs in typography presets, font sizes, or global CSS.
11. **`ANIMATEPRESENCE_POPLAYOUT_MODE` & `ANIMATEPRESENCE_CHILD_LAYOUT`:**
    Revealed panels inside `<AnimatePresence>` must use `mode="popLayout"`, and direct children must carry `key` and `layout={true}`.
12. **`MEDIA_COLUMN_FLIP_MISSING_REBASE`:**
    When flipping a flex container from row to column in a media query, any child with `flex: '1 0 0px'` must have `flex: 0 0 auto !important; width: 100% !important;` in the same media block.

---

## 3. Responsive Polish & Component Variants Implemented

1. **Responsive Navbar with Variants (`components/ObservatoryHeader.tsx`):**
   - Implemented with two variants: `default` (standard top bar) and `menu-open` (expanded station directory drawer).
   - Declared interactive connections:
     - `{ from: 'default', to: 'menu-open', trigger: 'click', sourceNode: 'hdr-hamburger-btn' }`
     - `{ from: 'menu-open', to: 'default', trigger: 'click', sourceNode: 'hdr-close-btn' }`
   - Smooth enter/exit transitions powered by Framer Motion `<AnimatePresence mode="popLayout">`.
   - On desktop screens (> 810px), the hamburger button is hidden and direct CTA/telemetry is shown; on mobile screens (<= 810px), the hamburger button is displayed and opens the directory drawer.
2. **Fluid Typography with `clamp()` Across All Presets:**
   - `display`: `clamp(32px, 6.5vw, 68px)`
   - `heading-stage`: `clamp(26px, 4.2vw, 44px)`
   - `body-desert`: `clamp(14px, 1.5vw, 17px)`
   - `mono-furniture`: `clamp(10px, 1.1vw, 11px)`
   - Updated directly in `app/globals.css` and via `typography.set`.
3. **Contrast Corrections on Sand Ground:**
   - `components/FaqItem.tsx`: Question in `var(--color-ink)` `#33291E`, answer in `rgba(51, 41, 30, 0.72)`, index in `var(--color-coral)`, and border in `rgba(51, 41, 30, 0.15)`.
4. **Mobile Layout & Pinned Stage Stickiness:**
   - All 4 pinned stages operate on sticky positioning (`position: sticky; top: 0px; height: 100svh; overflow: hidden`) inside `300svh` to `360svh` stage containers.
   - Mobile media queries (`max-width: 810px` and `max-width: 390px`) rebase flex rows to clean stacked columns without overflow.

---

## 4. Preflight & Quality Gate Results

- **`diagnostics.projectCheck`:**
  - `clean: true`, `passed: true`
  - Total files checked: 19
  - Clean files: 19, Error files: 0
  - Blocking violations: 0, Drift violations: 0, Broken links: 0, Missing assets: 0
- **`publish.preflight`:**
  - `passed: true`
  - Total checks: 6, Passed checks: 6, Failed checks: 0, Fatal count: 0, Warnings: 0
- **`preview.build`:**
  - `status: "ready"`
  - Routes validated: 1 (`/` → `app/page.client.tsx`)
- **`export.generate` (Next.js):**
  - Generated: `proj-1792922782087-qo0wnl-nextjs.zip`
  - Total files in archive: 31
  - `preflightClean: true`
