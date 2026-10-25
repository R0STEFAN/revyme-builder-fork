# Revyme MCP v2 — Bug Audit, Diagnosed Issues & Fixes Log

**Project:** `proj-1792912529558-5urrmm`  
**Branch:** `main` (feature branch `feature/mcp-v2`)  
**Date:** 2026-10-25  
**Author:** Antigravity AI Assistant

---

## Executive Summary

During the end-to-end automated construction of the record label landing page for **Aura Records** in project `proj-1792912529558-5urrmm`, comprehensive MCP v2 operations were systematically executed across all layers:
1. Design presets & tokens (`tokens.*`, `typography.*`, `presets.*`, `fonts.*`).
2. Design Components with typed variants (`components.create`).
3. Interactive Code Components with `@controls` (`codeFiles.submit`).
4. Native page layout assembly (`app/page.client.tsx`).
5. Responsive viewports overrides (`viewports.setOverride`).
6. Motion presets & Lenis smooth scrolling (`motion.preset.apply`, `siteEffects.smoothScroll.set`).
7. Quality gates, preflight inspections, previews & release packaging (`diagnostics.projectCheck`, `publish.preflight`, `preview.build`, `export.generate`).

Throughout this automated run, several bugs, false-positives, and configuration hurdles in the MCP server and automation core were discovered, isolated, fixed, and verified with test suites.

---

## 1. Config & Environment Issues

### Issue 1.1: Default Port Mismatch (`SERVER_UNAVAILABLE: fetch failed at http://localhost:3000`)
- **Symptom:** MCP CLI operations failed immediately with connection refused at `http://localhost:3000`.
- **Root Cause:** The Vite dev server was running on port `3333`, but the default fallback in `@revyme/cli` resolves to port `3000` when `.revymelocal/automation.json` is absent.
- **Fix:** Created `.revymelocal/automation.json` specifying `"apiUrl": "http://localhost:3333"` and default project `proj-1792912529558-5urrmm`.

### Issue 1.2: Missing MCP Launcher Wrapper Script (`server/run-mcp.sh`)
- **Symptom:** Antigravity MCP registration failed with `spawn /home/rost/.../server/run-mcp.sh ENOENT`.
- **Root Cause:** Global MCP config `~/.gemini/config/mcp_config.json` referenced `server/run-mcp.sh`, which had not yet been created in the workspace.
- **Fix:** Authored executable script `server/run-mcp.sh` injecting required environment variables:
  - `REVYME_API_URL="http://localhost:3333"`
  - `REVYME_PROJECT_ID="proj-1792912529558-5urrmm"`
  - `REVYME_BRANCH_ID="main"`
  - `REVYME_MCP_BRIDGE_URL="http://127.0.0.1:8082"`
  Invokes `exec node "$REPO_ROOT/packages/cli/dist/main.js" mcp`.

---

## 2. Automation Core & MCP Operations Bugs

### Issue 2.1: False-Positive Oracle Violations on Next.js Server Entries (`app/page.tsx`)
- **Location:** `packages/automation-core/src/operations/publish.ts` (lines 240-244).
- **Symptom:** `publish.preflight` reported fatal Oracle violations on `app/page.tsx` (`USE_CLIENT_REQUIRED`, `PAGE_EXTRA_EXPORT` for Next.js SEO `metadata`, `FORBIDDEN_IMPORT` for `./page.client`).
- **Root Cause:** Line 241 used `/(^|\/)page(\.client)?\.tsx$/.test(path)`. In Next.js App Router, every page is a pair:
  - `app/page.tsx`: Server component entry that exports `metadata` and renders `<PageClient />`.
  - `app/page.client.tsx`: The actual canvas-authored client component where all nodes and viewports live.
  The check passed `app/page.tsx` into the canvas client Oracle (`checkFile`), which requires `'use client'` and forbids server `metadata` exports.
- **Fix:** Added check: if `page.tsx` has a sibling `page.client.tsx` or imports `./page.client`, it is recognized as the server wrapper and bypassed in favor of `page.client.tsx`:
  ```ts
  if (/(^|\/)page\.tsx$/.test(path)) {
    const clientPath = path.replace(/page\.tsx$/, 'page.client.tsx');
    if (filesMap.has(clientPath) || code.includes('./page.client')) {
      continue;
    }
  }
  ```

### Issue 2.2: JavaScript Call Matching as CSS `url(...)` in Static Asset Scanner
- **Location:** `packages/automation-core/src/operations/publish.ts` (line 370).
- **Symptom:** `publish.preflight` failed with unlinked asset errors:
  - `assets.unlinked:url.href` in `app/providers.tsx`
  - `assets.unlinked:savedUrl` in `plugins/DirectusSync.tsx`
  - `assets.unlinked:e.target.value` in `plugins/DirectusSync.tsx`
- **Root Cause:** The regex `/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi` with the case-insensitive flag `/i` matched JavaScript expressions such as:
  - `new URL(url.href)` (matched as `URL(...)`)
  - `isValidUrl(savedUrl)` (matched as `url(...)`)
  - `setUrl(e.target.value)` (matched as `url(...)`)
  It extracted JavaScript variables/properties as static asset filenames.
- **Fix:** Restricted CSS URL matching to require:
  1. Negative lookbehind `(?<![A-Za-z0-9_$])` so identifiers ending in `...url(` are ignored.
  2. Case-sensitive `url(` (no `/i` flag), preventing matching of `new URL(...)`.
  3. Explicit quotes `['"]([^'"]+)['"]` representing CSS string literals.
  4. Skip internal `plugins/`, `_meta/`, and `_revyme/` files:
  ```ts
  const urlMatches = code.matchAll(/(?<![A-Za-z0-9_$])url\(\s*['"]([^'"]+)['"]\s*\)/g);
  ```

### Issue 2.3: Editor Plugin Forms Checked as Unconfigured Public Website Forms
- **Location:** `packages/automation-core/src/operations/publish.ts` (lines 421-424 & 467-478).
- **Symptom:** `publish.preflight` failed with `forms.bare_form:plugins/DirectusSync.tsx` ("Form container has neither a data-form configuration nor an action attribute").
- **Root Cause:** The form destination inspection scanned all `.tsx` files in the snapshot indiscriminately, including developer plugin UI panes located in `plugins/`.
- **Fix:** Explicitly filtered out plugin files and metadata directories (`path.startsWith('plugins/') || path.startsWith('_meta/') || path.startsWith('_revyme/')`).

### Issue 2.4: Silent Failure to Insert Responsive `<style>` Block in `updateContainerQueryStyle`
- **Location:** `src/code/generation/generator-styles.ts` (line 429).
- **Symptom:** `viewports.setOverride` returned success with status `committed` and `synced`, but no responsive `<style>` block with `@media` container rules was actually added to the target file.
- **Root Cause:** When inserting the initial `<style>` block, `updateContainerQueryStyle` searched for the root tag's closing bracket using the strict single-line regex `code.match(/\}\}>\s*\n/)`. In standard formatted JSX, the root tag's style object closing braces `}}` and the opening tag's closing bracket `>` are frequently on separate lines (`}}\n    >`). As a result, `rootCloseMatch` evaluated to `null`, and the function silently returned `code` unmodified without inserting the stylesheet.
- **Fix:** Enhanced the insertion logic to anchor on `return` and find the root opening tag's closing `>` via `findTagClose`, falling back to `/\}\}\s*>\s*\n/`:
  ```ts
  const retIdx = code.search(/\breturn\s*[(<]/);
  const idIdx = code.indexOf('data-id="', retIdx === -1 ? 0 : retIdx);
  let insertIdx = -1;
  if (idIdx !== -1) {
    const gt = findTagClose(code, idIdx);
    if (gt !== -1 && code[gt - 1] !== '/') {
      insertIdx = gt + 1;
    }
  }
  if (insertIdx === -1) {
    const rootCloseMatch = code.match(/\}\}\s*>\s*\n/);
    if (!rootCloseMatch) return code;
    insertIdx = rootCloseMatch.index! + rootCloseMatch[0].length;
  }
  const styleBlock = `\n  <style>{\`${newCss}\`}</style>\n`;
  return code.slice(0, insertIdx) + styleBlock + code.slice(insertIdx);
  ```
  Added unit test in `src/code/generation/generator-styles.test.ts` verifying `<style>` block creation on multiline root closing tags. All 129 tests passed. Rebuilt CLI bundle.

---

## 3. Test Suites & Verification

1. **Vitest Capability Suites:**
   ```bash
   npx vitest run packages/automation-core/test/capabilities/T23-release.test.ts packages/automation-core/test/capabilities/T23-challenger2.test.ts
   ```
   - `T23-release.test.ts`: **33 passed** (100%)
   - `T23-challenger2.test.ts`: **26 passed** (100%)
   - Total: **59 tests passed cleanly**.

2. **CLI Bundle Rebuild:**
   ```bash
   node packages/cli/build.cjs
   ```
   - Emitted bundle: `packages/cli/dist/main.js` without errors.

3. **Live Verification via CLI on Target Project:**
   ```bash
   node packages/cli/dist/main.js publish.preflight --project-id proj-1792912529558-5urrmm --api http://localhost:3333
   ```
   **Output:**
   - `passed: true`
   - `failedChecks: 0`
   - `fatalCount: 0`
   - `passedChecks: 6`
   - `oracle.app/page.client.tsx`: `pass`
   - `seo.title`: `pass` ("Aura Records — Sonic Artifacts & Portal")
   - `seo.description`: `pass` (77 chars)
   - `assets.resolution`: `pass` (all 0 referenced static asset paths resolve correctly)
   - `forms.destinations`: `pass` (no forms configured)
   - `redirects.config`: `pass`

4. **Release Bundle Generation:**
   ```bash
   node packages/cli/dist/main.js export.generate --project-id proj-1792912529558-5urrmm --api http://localhost:3333 --input-file <(echo '{"format":"nextjs"}')
   ```
   - Result: Runnable Next.js project archive (`proj-1792912529558-5urrmm-nextjs.zip`), 25 files, `preflightClean: true`, `preflightIssues: []`.

5. **Diagnostic Sanity Check:**
   `diagnostics.projectCheck` returns:
   - `clean: true`
   - `passed: true`
   - Clean files: 15/15
   - Blocking violations: 0
   - Drift violations: 0

---

## 4. User Nuance Implementations & Layout Architecture Fixes

### Issue 4.1: Portal Hero Stage Did Not Stick During Uncover Animation
- **Symptom:** Portal Hero Stage was scrolling away immediately with page scroll instead of remaining pinned at `top: 0` while the panels parted, wordmark expanded, and duotone uncovered.
- **Root Cause:**
  1. CSS `position: sticky` fails if any ancestor element has `overflow: hidden` or `overflow-x: hidden` relative to the window viewport scroll. In `app/page.client.tsx`, `data-id="hero-sec"` had `overflow: 'hidden'`, and `data-id="root"` had `overflowX: 'hidden'`.
  2. Frame synchronization between `requestAnimationFrame` and passive scroll listeners needed dual-dispatch for instantaneous 120Hz/Lenis responsiveness.
- **Fix:**
  - Removed `overflow: 'hidden'` from `hero-sec`.
  - Replaced `overflowX: 'hidden'` with modern `overflowX: 'clip'` on `root` (preserves viewport containment without clipping the sticky scroll context).
  - Encapsulated `sticky` stage at `top: 0; height: 100vh; overflow: hidden; isolation: isolate` inside a `250vh` track in `components/PortalHeroStage.tsx`.
  - Integrated `useStaticCanvas()` from `@revyme/runtime` to satisfy Oracle rule `CODE_COMPONENT_STATIC_FALLBACK`.

### Issue 4.2: Navigation Was Not Responsive on Mobile/Tablet
- **Symptom:** Navigation bar stayed horizontal and lacked mobile hamburger menu / responsive dropdown.
- **Requirement:** Fullscreen overlay on tablet/mobile (`<= 810px`) with animated hamburger button, smooth variants opening, and large display menu items (`clamp(36px, 8vw, 56px)`).
- **Fix:**
  - Implemented `components/ResponsiveNavbar.tsx` using scoped media queries with `[data-id="..."]` to satisfy Oracle rule `CLASSNAME_STYLING`.
  - Added animated 2-bar hamburger turning into an 'X' via Framer Motion transforms.
  - Added fullscreen backdrop-blurred overlay (`AnimatePresence`) featuring large Syne links (`01 // CATALOGUE`, `02 // ROSTER`, `03 // DATES`, `04 // DISPATCH`) with stagger entrances, hover translate effects, and auto-close on selection.

### Issue 4.3: Missing Interactive Hover Effects on Buttons and Rows
- **Symptom:** Buttons and rows lacked tactile feedback in preview.
- **Fix:**
  - `components/LabelButton.tsx`: Added `whileHover` (amber border/text brightening, subtle scale, pill glows) and `whileTap={{ scale: 0.97 }}` across all variants (`default`, `primary`, `secondary`, `pill-nav`).
  - `components/DateRow.tsx`: Added `whileHover={{ x: 6, backgroundColor: 'rgba(237, 231, 220, 0.03)' }}` with subtle transition and pointer cursor.

### Issue 4.4: Interactive Roster with Floating Mouse-Parallax Artwork Card
- **Requirement:** Hovering each roster row highlights the row and surfaces a floating vinyl sleeve card on the right that subtly moves with mouse parallax. A single card instance stays mounted, smoothly crossfades artwork/metadata between hovered rows, and hides gracefully on mobile/tablet.
- **Fix:**
  - Implemented `components/InteractiveRoster.tsx` with `@controls` and `withResponsiveProps`.
  - Managed mouse movement through `getBoundingClientRect()` normalized coordinate tracking for spring physics parallax (`x: relX * 36`, `y: relY * 48`, `rotate: mouseOffset.x * 0.08`).
  - Implemented single persistent floating preview card anchored on the right with 1:1 vinyl sleeve art, format badge, glowing accent indicator dot, and `<AnimatePresence mode="wait">` image crossfading.
  - Automatically hidden on smaller viewports (`@media (max-width: 900px)`) to preserve clean mobile roster browsing.

### Issue 4.5: Navbar Converted to Native Design Component with Variants & Fixed Position
- **Requirements:**
  1. Navbar must be a full Design Component with variants editable in Revyme's visual panel, not a Code Component.
  2. Navbar must be permanently fixed to the viewport (`position: fixed`).
  3. Hamburger button lines turning into an 'X' were crooked/asymmetrical.
- **Fixes Applied:**
  - **Design Component Architecture:** Converted `components/ResponsiveNavbar.tsx` into a native Design Component (`isCodeComponent: false` in `components.list`) with `variantConfig` exposing 4 selectable variants:
    - `default`: Translucent blur dark bar with subtle hairline.
    - `solid`: Opaque dark bar (`#0A0C0E`).
    - `amber-accent`: Dark bar with glowing amber bottom hairline (`#E8913C`).
    - `open`: Fullscreen mobile navigation overlay state.
  - **Fixed Viewport Positioning:** Placed `position: 'fixed', top: '0px', left: '0px', right: '0px', width: '100%', height: '58px', zIndex: 100` on the page instance (`data-id="nav-bar-instance"` in `app/page.client.tsx`). Removed `overflowX` restrictions from `root` so the navbar stays permanently pinned at the top of the browser viewport during the entire scroll.
  - **Symmetrical 'X' Cross Geometry:** Replaced imprecise flex-based offsets with exact box geometry:
    - Icon container: 20x20px.
    - Bar 1 rest: `top: 6px`, `left: 1px`, `rotate: 0, y: 0`.
    - Bar 2 rest: `top: 12px`, `left: 1px`, `rotate: 0, y: 0`.
    - Active 'open' state: Bar 1 moves down `+3px` (`6 + 3 = 9px`) and rotates `+45°`; Bar 2 moves up `-3px` (`12 - 3 = 9px`) and rotates `-45°`.
    - Both bars meet at the exact vertical midpoint (`top: 9px`) at clean 90-degree angles, creating a mathematically and visually perfect, razor-sharp 'X'.

### Issue 4.6: CMS Collection Integration for Interactive Roster
- **Requirement:** Integrate Revyme's native CMS collection architecture into `InteractiveRoster` so that artists, releases, artwork, and metadata can be added, updated, or reordered directly via the visual CMS editor panel.
- **Implementation:**
  - Created native CMS collection `roster` via `cms.schema.create` with schema `cms/roster.schema.json` defining fields: `code` (text), `artist` (text), `title` (text), `count` (text), `accent` (color), `year` (text), `format` (text), `image` (image).
  - Seeded 5 archival artist entries into `cms/roster.json` via `cms.items.create` (ALVA NOTO, MURCOF, RROSE, CATERINA BARBIERI, ANDY STOTT).
  - Bound `components/InteractiveRoster.tsx` to `@/cms/roster.json` with fallback defaults, ensuring immediate live rendering and zero-friction visual CMS management in the builder chrome.

### Issue 4.7: Fullscreen Navbar Overlay Z-Index Blocking Close Button
- **Symptom:** Opening the mobile navigation menu on `ResponsiveNavbar` covered the header bar and close button, preventing the user from closing the menu.
- **Root Cause:** The fullscreen drawer backdrop container had a higher or matching stacking context (`zIndex: 100+`) relative to the header bar, and lacked top clearance padding.
- **Fix:** Restructured the z-index hierarchy:
  - Header top bar: `zIndex: 110`.
  - Hamburger / Close button: `zIndex: 120`.
  - Fullscreen menu overlay container: `zIndex: 90`, `position: 'absolute'`, `top: 0`, `left: 0`, `width: '100%'`, `height: '100vh'`, `overflowY: 'scroll'`, and `paddingTop: '80px'`.
  - Result: The close button stays permanently above the overlay backdrop and clickable, and menu items scroll smoothly without colliding with the top bar.

### Issue 4.8: Multi-Viewport Canvas Iframe vs Preview Responsiveness (Wordmark "OBSIDIAN")
- **Symptom:** Wordmark "OBSIDIAN" in `PortalHeroStage` was responsive in standalone preview mode, but rendered oversized (110px) on the canvas mobile tile, overflowing the artboard boundary.
- **Root Cause:** All viewports on the Revyme canvas render side-by-side in a single shared iframe with `window.innerWidth > 2400px`. Standard CSS `@media (max-width: 480px)` evaluates against `window.innerWidth`, which never matches on canvas artboards.
- **Fix:** Implemented a 4-layer responsive sizing strategy:
  1. `ResizeObserver` tracking `containerRef.current.clientWidth` dynamically in React state.
  2. CSS Container Queries (`@container (max-width: 500px)`).
  3. Canvas artboard wrapper attribute scoping (`[data-viewport="mobile"] [data-id="hero-wordmark"]`).
  4. Standard `@media (max-width: 500px)` for preview and production.
  - Sizing resolved to: 44px on mobile (bold, prominent, zero overflow), 72px on tablet, 110px on desktop.

### Issue 4.9: `updateContainerQueryStyle` Root Tag Closure Parsing Bug
- **Location:** `src/code/generation/generator-styles.ts`
- **Symptom:** `viewports.setOverride` returned success but failed to inject the `<style data-viewport-styles="...">` block into `app/page.client.tsx`.
- **Root Cause:** Line 188 used `code.match(/\}\}>\s*\n/)` to locate the closing bracket of the root element. When formatted as `}}\n >`, the regex failed to match, silently dropping responsive style block insertions.
- **Fix:** Replaced regex matching with AST tag boundary traversal via `findTagClose`, ensuring robust insertion regardless of newline formatting between `}}` and `>`. Added unit test in `src/code/generation/generator-styles.test.ts` (129/129 vitest passed).

### Issue 4.10: Unconstrained Flex Parent Collapsing `width: 100%` Code Components on Desktop
- **Symptom:** `CircularDriftImage` appeared shrunk to 100px on the desktop canvas artboard and completely collapsed/blank (0px) in desktop standalone preview, while displaying normally on mobile.
- **Root Cause:** In `app/page.client.tsx`, `statement-right-col` was an auto-width flex item (`flex: '0 0 auto'`) without an explicit width or flex basis. Inside it, `CircularDriftImage` was styled with `width: '100%'` with `maxWidth: '360px'` and `aspectRatio: '1 / 1'`. In CSS flexbox, a child with `width: 100%` inside an unconstrained auto-width parent produces an indeterminate cyclical dependency: the browser collapses min-content width to 100px (canvas sandboxed artboard) or 0px (standalone preview). On mobile, explicit `280px` overrides existed, masking the issue there.
- **Fix:** Set explicit desktop pixel geometry `width: '360px', height: '360px'` on both `statement-right-col` and `statement-drift-image` in `app/page.client.tsx`, and ensured `CircularDriftImage.tsx` uses `width: \`${size}px\`, height: \`${size}px\`, maxWidth: '100%', aspectRatio: '1 / 1'\`. Verified with `observe.layout`: Desktop measures exactly 360.0px x 360.0px; Mobile measures exactly 280.0px x 280.0px.

---

## 5. Ninth Meridian Project Audit & Fixes (proj-1792922782087-qo0wnl)

### Issue 5.1: Preflight Static Asset Scanner Matching Interpolated Template Literals (`assets.unlinked:${GRAIN_SVG}`)
- **Location:** `packages/automation-core/src/operations/publish.ts` (lines 381–399).
- **Symptom:** `publish.preflight` failed with a fatal error: `Missing static asset "${GRAIN_SVG}" referenced in "components/FilmGrain.tsx"`.
- **Root Cause:** In `components/FilmGrain.tsx`, `backgroundImage: \`url("\${GRAIN_SVG}")\`` was captured by regex `url\(\s*['"]([^'"]+)['"]\s*\)`. The scanner extracted `"${GRAIN_SVG}"` and treated it as a relative filesystem path inside `public/`.
- **Fix:** Added guards in `publish.ts` to skip any scanned value containing `${` or starting with `$`:
  ```ts
  if (val && !/^(https?:|\/\/|data:|blob:)/i.test(val) && !val.includes('${') && !val.startsWith('$')) {
    staticRefs.push({ file: path, rawPath: val });
  }
  ```
- **Test:** Added regression test `ignores interpolated template variables in CSS url() expressions` to `packages/automation-core/test/capabilities/T23-release.test.ts`.

### Issue 5.2: Next.js Root Server Layout Treated as Canvas Client Template (`oracle.app/layout.tsx`)
- **Location:** `packages/automation-core/src/operations/publish.ts` (lines 244–256).
- **Symptom:** `publish.preflight` flagged 24 Oracle violations on `app/layout.tsx` (`USE_CLIENT_REQUIRED`, `FORBIDDEN_IMPORT` for `./globals.css`, `PAGE_EXTRA_EXPORT` for metadata).
- **Root Cause:** Next.js App Router root layout `app/layout.tsx` is a server wrapper containing `<html>`, `<body>`, metadata, and CSS `@import`. `publish.ts` passed `app/layout.tsx` into `checkFile({ kind: 'template' })` without distinguishing server wrappers from editable route-group `LayoutClient.tsx` templates.
- **Fix:** Added a server layout bypass: if `layout.tsx` contains `<html>`, `<body>`, `export const metadata`, or `export const siteConfig`, it is bypassed as the root server wrapper.
- **Test:** Added regression test `bypasses Next.js root server layout.tsx from client canvas Oracle checks` to `packages/automation-core/test/capabilities/T23-release.test.ts`. All 35 capability tests passing.






