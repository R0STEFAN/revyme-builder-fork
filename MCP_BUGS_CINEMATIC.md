# Cinematic Style — Revyme MCP v2 Bug Audit, Diagnosed Issues & Fixes Log

**Project ID:** `proj-1792930233313-wjzr6r`  
**Site:** Cinematic Style (Immersive Dark-Mode Brutalist Experience)  
**Branch:** `main`  
**Date:** 2026-10-25  
**Author:** Antigravity AI Assistant

---

## Executive Summary

During the end-to-end automated construction and testing of the **Cinematic Style** website in project `proj-1792930233313-wjzr6r`, comprehensive MCP v2 operations are being executed across all layers:
1. Design tokens, color palettes, and typography presets (`tokens.set`, `typography.set`, `presets.set`, `fonts.import`).
2. Reusable Design Components (`components.create`).
3. 3D & interactive Code Components (`codeFiles.submit`).
4. CMS Schema & Item seeding (`cms.schema.create`, `cms.items.create`).
5. Native page layout assembly (`app/page.client.tsx`).
6. Responsive multi-viewport overrides (`viewports.setOverride`).
7. Full diagnostics, preflight checks, and production verification (`diagnostics.projectCheck`, `publish.preflight`).

All bugs, discrepancies, or false-positives encountered in the MCP operations or builder during this run are systematically diagnosed, fixed in the codebase, verified with regression tests, and recorded in this log.

---

## 1. Diagnosed Issues & Code Fixes

### Bug 1.1: `revyme init` Ignores CLI Flags and Overwrites `apiUrl` with Inaccessible Default Port 3000
- **Location:** `packages/cli/src/main.ts` (lines 196–205) and `packages/cli/src/config.ts` (lines 83, 111).
- **Symptom:** Running `revyme init <projectId> --api http://localhost:3333` silently ignored the `--api` flag and wrote `"apiUrl": "http://localhost:3000"` to `.revymelocal/automation.json`. Subsequent MCP / CLI commands failed immediately with:
  ```json
  {
    "ok": false,
    "error": "Failed to reach automation server at http://localhost:3000: Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON"
  }
  ```
- **Root Cause:** In `packages/cli/src/main.ts`, the `init` command handler passed only `argv[1]` directly to `initProjectConfig(process.cwd(), projectId)` without parsing remaining CLI arguments (`argv.slice(2)`). Furthermore, `packages/cli/src/config.ts` defaulted `apiUrl` to `'http://localhost:3000'`, whereas Revyme Vite development server always defaults to port `3333`.
- **Fix:** 
  1. Updated `packages/cli/src/main.ts` to tokenize remaining arguments with `parseCliTokens(argv.slice(2))`, extracting `--api` and `--branch`.
  2. Updated `packages/cli/src/config.ts` default fallback port from `3000` to `3333` to match Vite dev server.
  3. Rebuilt `@revyme/cli` bundle (`dist/main.js`).
- **Verification:** Ran `node packages/cli/dist/main.js init proj-1792930233313-wjzr6r` followed by `node packages/cli/dist/main.js doctor`. Returned `"ok": true`, `"status": { "healthy": true, "revision": 8 }`, `"registeredToolsCount": 275`.

### Bug 1.2: `addPresetTokenToCSS` Erased CSS Resets, `@import` Fonts, and Dark Selectors on New Category
- **Location:** `src/code/generation/preset-gen.ts` (lines 288–294).
- **Symptom:** Adding a token to a category that didn't yet have a comment header in `:root` (for example, adding `border-glass` under category `border` to a CSS file that only had `color` and `typography`) completely wiped out `@import url(...)` font imports, the universal modern reset `*, *::before, *::after`, and `:root.dark` overrides from `app/globals.css`.
- **Root Cause:** When the category comment was missing from `:root`, the function called `return serializePresetTokens(tokens);`. `serializePresetTokens` builds an isolated `:root` block string from scratch, inadvertently replacing the entire contents of `globals.css` instead of splicing into the existing document.
- **Fix:** Updated the fallback branch to match and replace only the existing `:root` block (along with any preceding `/* Design Tokens */` banner), leaving all leading `@import` lines, CSS resets, and subsequent `:root.dark` blocks intact:
  ```ts
  const newRootBlock = serializePresetTokens(tokens);
  const fullRootPattern = /(?:\/\*\s*Design Tokens[^\n]*\*\/\s*)?:root\s*\{[\s\S]*?\}/;
  if (fullRootPattern.test(css)) {
    return css.replace(fullRootPattern, newRootBlock.trim());
  }
  return css.replace(rootMatch[0], newRootBlock.trim());
  ```
- **Verification:** Added vitest regression test `preserves imports, reset, and dark theme when adding token in a new category group to existing :root` in `src/code/generation/preset-gen.test.ts`. All 26 unit tests passed cleanly. Rebuilt CLI distribution.

### Bug 1.3: `compileCodeComponent` Failed with Syntax Error on TypeScript `export interface` / `export type`
- **Location:** `src/canvas/code-component-runtime.ts` (line 434).
- **Symptom:** Code components authored with standard TypeScript export declarations (`export interface FaceItem { ... }`, `export type Mode = ...`) completely vanished from the canvas sandbox iframe with runtime errors:
  ```
  [code-component-runtime:compile-failed] {
    componentName: 'Rolodex3DCube',
    error: "/Rolodex3DCube.tsx: 'import' and 'export' may only appear at the top level. (9:0)"
  }
  ```
- **Root Cause:** When preparing user component code for Babel standalone compilation, `code-component-runtime.ts` wraps the cleaned code inside an IIFE script wrapper: `(function(__require, __import, React) { ... })`. To prevent top-level export syntax errors inside the function wrapper, it stripped `export (const|let|var|function|class|async)`. However, it omitted `interface` and `type`. Because `export interface` and `export type` remained inside the function body, Babel's parser threw `'import' and 'export' may only appear at the top level`, resulting in `compileCodeComponent` returning `null` and the components failing to mount in the canvas sandbox.
- **Fix:** Extended the export stripping regex in `src/canvas/code-component-runtime.ts`:
  ```ts
  cleanCode = cleanCode
    .replace(/export\s+(const|let|var|function|class|async|interface|type)\b/g, '$1')
    .replace(/export\s*\{[^}]*\}\s*;?/g, '');
  ```
- **Verification:** Added vitest regression test `compiles a code component with named export interface and export type declarations` to `src/canvas/code-component-runtime.test.ts`. Tested compilation of `Rolodex3DCube` with `FaceItem` interface. All 16 unit tests in `code-component-runtime.test.ts` passed. Rebuilt CLI distribution.

### Bug 1.4: Section Headings Fired Split-Text Animation on Page Mount Due to `--trigger appear`
- **Location:** `app/page.client.tsx` (`case-studies-title`, `pricing-main-title`, `calc-section-title`).
- **Symptom:** When opening the site preview, split-text animations on sections down the page played immediately on load rather than waiting until the user scrolled to them ("Layer in View").
- **Root Cause:** The nodes were configured with `trigger: "appear"` instead of `trigger: "view"`. In `@revyme/runtime`, `trigger: "appear"` immediately sets `played = true` on mount (`if (trigger === 'appear') { setPlayed(true); return; }`).
- **Resolution:** Re-applied text animation via `textEffects.set` using `--trigger view --mask true --y 100% --stagger 0.025 --animationType character`. With `trigger: "view"`, `buildSplitTextSpecSource` sets `data-text-anim` with `trigger: "view"` and omits `trigger` from `spec` (as `"view"` is the default runtime trigger), matching the exact structure from working projects. The character-by-character animation now triggers precisely when the headings scroll into view.

### Bug 1.5: Reversion of Temporary Runtime / Preview Patches
- **Location:** `patches/@revyme+runtime+0.0.28.patch`, `src/editor/tools/AnimationTool/motion/TextEffectPreview.tsx`.
- **User Instruction:** Per user directive, all patches to `@revyme/runtime` and `TextEffectPreview.tsx` were reverted via `git checkout` and `npx patch-package` to ensure 100% stock runtime integrity, matching the behavior of unmodified projects.

### Bug 1.6: Builder Preview Sandbox (`:5175`) Prematurely Triggered "Layer in View" Text Animations at 0ms
- **Location:** `src/preview-sandbox/main.tsx` and `src/preview-sandbox/PreviewRevymeSplitText.tsx`.
- **Symptom:** In the builder's Preview mode ("Попередній перегляд"), split-text animations with `trigger: "view"` fired immediately when opening the preview, even though on the published site they waited for the user to scroll to each section.
- **Root Cause:** In the preview sandbox iframe, `<RevymeSplitText>` renders a host wrapper `<span ref={hostRef} style={{ display: 'contents' }}>`. Because elements with `display: contents` generate no layout box, `host.getBoundingClientRect()` returns `{ top: 0, left: 0, width: 0, height: 0 }`. In the in-view check, `r.top <= h * line` evaluated to `0 <= window.innerHeight * 1`, which was unconditionally `true` on initial preview mount regardless of how far down the section was.
- **Fix:** Provided a dedicated preview adapter `src/preview-sandbox/PreviewRevymeSplitText.tsx` and re-exported it in `src/preview-sandbox/main.tsx` (`MODULE_MAP['@revyme/runtime'].RevymeSplitText`). When `host` has `display: contents` (or 0 dimensions), the hook measures `host.parentElement` (the actual `<h2>` or `<h1>` heading element), guards against unlaid-out 0-rects, and schedules initial evaluation via `requestAnimationFrame`. This completely fixes the preview inside the builder across all projects without modifying the `@revyme/runtime` npm package.
- **Verification:** Added vitest test suite `src/preview-sandbox/PreviewRevymeSplitText.test.tsx` verifying that below-the-fold headings do not trigger on mount and only fire on scroll. All 8 test files (51 tests) in `src/preview-sandbox/` passed. Full `tsc --noEmit` passed with 0 errors.

---

## 2. Architectural Decisions & Design Component Refactoring

Per feedback and strict adherence to the design rules (`craft-floor.md` in `.agents/skills/impeccable/`):

1. **Design Components vs Code Components:**
   - `PricingCard.tsx`: Converted into a pure Design Component (`/** @name "PricingCard" */`, `@propMeta`, `variantConfig` with `default` and `growth` variants, `withResponsiveProps`). Fully editable and visible natively in the canvas.
   - `ProjectCard.tsx`: Converted into a pure Design Component (`/** @name "ProjectCard" */`, `@propMeta`, `variantConfig` with `default` and `featured` variants, macOS traffic light controls).
   - Only `Rolodex3DCube.tsx` (complex CSS 3D `transform-style: preserve-3d` prism) and `PriceCalculator.tsx` (interactive dynamic JavaScript range slider) remain Code Components.

2. **Hero Title Scroll Scaling:**
   - Implemented scroll-driven transform on the hero title ("CINEMATIC // SPATIAL") in `app/page.client.tsx` using `useScroll` and `useTransform` from `framer-motion`:
     ```tsx
     const { scrollY } = useScroll();
     const heroScale = useTransform(scrollY, [0, 600], [1, 1.35]);
     const heroOpacity = useTransform(scrollY, [0, 500], [0.32, 0.08]);
     ```
   - Bound directly to `<motion.span style={{ scale: heroScale, opacity: heroOpacity, ... }}>`.

3. **Anti-Pattern Elimination (Impeccable Craft Floor Compliance):**
   - Removed all kicker/eyebrow badges (`MEMBERSHIP TIERS // 02`, `CURATED ARCHIVES // 01`, `ESTIMATION ENGINE // 01`).
   - Removed arbitrary section numbering (01, 02, 03).
   - Massive headings (`CASE STUDIES`, `ACQUISITION TIERS`, `PROJECT ESTIMATOR`) carry visual authority directly.

4. **Native Motion, Split-Text & Hover Animations:**
   - **Character Split-Text Section Headings (`textEffects.set`):**
     Applied character-level stagger animation using Revyme's native `@revyme/runtime` `<RevymeSplitText>` component to all major section headings:
     - `case-studies-title` (`CASE STUDIES`)
     - `pricing-main-title` (`ACQUISITION TIERS`)
     - `calc-section-title` (`PROJECT ESTIMATOR`)
     Configured with `trigger: "view"`, `animationType: "character"`, `stagger: 0.03`, `y: 30`, `opacity: 0`, and spring damping physics.
   - **Card Hover Elevation (`motion.preset.apply --preset lift-on-hover`):**
     Applied interactive hover elevation (`whileHover={{ y: -4, scale: 1.02 }}`) to all 7 cards and interactive containers:
     - `case-studies-featured-wrapper` (Featured showcase)
     - `subproject-wrapper-1` (Kinetic Prism)
     - `subproject-wrapper-2` (Astral Vortex)
     - `pricing-card-col-1` (Essential tier)
     - `pricing-card-col-2` (Growth tier)
     - `pricing-card-col-3` (Enterprise tier)
     - `calc-component-wrapper` (Price Calculator module)
   - **Element Entrance Animations (`motion.preset.apply --preset fade-up / fade-in`):**
     Applied viewport entrance animations (`whileInView`, `viewport={{ once: true }}`) across all key site sections:
     - Subtexts: `pricing-subtext`, `calc-section-subtext` (`fade-up`)
     - Hero elements: `hero-cube-centerpiece` (`fade-up`), `hero-meta-top-left` (`fade-in`), `hero-meta-top-right` (`fade-in`), `hero-bottom-scroll` (`fade-in`)
     - Footer elements: `footer-brand-col`, `footer-links-col`, `footer-telemetry-col` (`fade-up`), `footer-massive-text-wrapper`, `footer-bottom-bar` (`fade-in`)
   - **Responsive Override Preservation:**
     Preserved all user-configured mobile media queries at `390px` viewport breakpoint without regression.

   - **Typography Presets Direct Binding (`typography.apply`):**
     Applied canonical typography presets from `app/globals.css` directly to all headings and body copy:
     - `heading-hero` applied to `hero-display-title` (`h1`, 12vw, 900 weight, -0.05em tracking)
     - `heading-section` applied to `case-studies-title`, `pricing-main-title`, and `calc-section-title` (`h2`, 10vw, 900 weight, -0.04em tracking)
     - `body-cinematic` applied to `pricing-subtext` and `calc-section-subtext` (`p`, 18px, 300 weight, 1.7 line-height)
     All typography properties now bind to CSS variables (`var(--typo-heading-section-font)`, etc.) and register cleanly in the builder's Typography panel.

   - **Calibrated Entrance Viewport Thresholds:**
     Updated `viewport` on all lower sections and cards to `viewport={{ once: true, amount: 0.2, margin: '0px 0px -60px 0px' }}` so entrance animations trigger deliberately when 20% visible inside the viewport, rather than firing prematurely at 1px of intersection.

5. **Production & Diagnostics Status:**
   - `diagnostics.projectCheck`: 12/12 files clean, 0 errors, 0 Oracle violations (revision: 150).
   - `publish.preflight`: 6/6 checks passed cleanly (Oracle validation, SEO title/description, asset resolution, forms, redirects).
   - `export.generate --format nextjs`: 30 files generated cleanly in Next.js archive.
   - Vitest unit tests: 59 passed across `split-text-runtime.test.tsx`, `code-component-runtime.test.ts`, and `preset-gen.test.ts`.

