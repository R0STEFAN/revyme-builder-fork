# Revyme MCP & Builder Bug Journal — Multilingual CMS Blog Test

**Project:** `proj-1793030645294-xrmdi5`  
**Branch:** `main`  
**Date:** 2026-10-26  
**Environment:** Headless Automation CLI (`@revyme/cli`), ProjectFS CAS Revision 78  
**Author:** Antigravity AI Assistant  

---

## 1. Executive Summary

A comprehensive automated test was performed to construct a full-featured multilingual blog in Revyme project `proj-1793030645294-xrmdi5` exclusively through the Revyme MCP / Automation CLI bridge (`packages/cli/dist/main.js`). 

The test verified:
1. **CMS Schema & Item Seeding:** `categories` collection, `posts` collection with reference field, 3 categories, and 10 articles.
2. **Localization (i18n):** Default locale Ukrainian (`uk`) at root `/`, secondary locale English (`en`) at `/en/`. English translations for all CMS categories and posts via `cms.items.setTranslation`.
3. **Components & Layouts:** `LocaleSwitcher` code component, responsive `Navbar`, `Footer`, homepage with latest 3 posts, blog listing page with all 10 posts, CMS detail article page (`/blog/[slug]`), and category archive page (`/category/[category]`).
4. **Oracle AST Conformance:** Zero Oracle violations across all client pages (`checkFile` passing cleanly).
5. **Route Synchronization & Preflight:** `locales.routes.sync` ensuring locale route wrappers for static and dynamic paths.
6. **Release Packaging & Export Verification:** Clean preflight on both Next.js App Router Dynamic mode (`format: "nextjs"`) and Hybrid SSG mode (`format: "ssg"`).

During this end-to-end test, several edge cases, dialect constraints, and builder behaviors were isolated and documented.

---

## 2. Issues Diagnosed & Workarounds

### Issue 1: Cyrillic Slugs Stripped to Empty / Fallback "untitled"
- **Symptom:** Creating CMS items with Ukrainian names (e.g. `"Технології"`) without an explicit `_slug` field generated empty slugs that fell back to `"untitled"`, `"untitled-1"`.
- **Root Cause:** In `src/code/project/cms-ops.ts`, `slugify()` uses a regex `replace(/[^a-z0-9\s-]/g, '')` that only retains ASCII alphanumeric characters without prior Cyrillic transliteration.
- **Workaround / Resolution:** Explicitly provided English standard `_slug` values (e.g. `_slug: "tech"`, `_slug: "future-of-ai"`) during item creation.
- **Architectural Recommendation:** Introduce standard Cyrillic-to-Latin transliteration in `slugify()` before stripping non-ASCII characters.

---

### Issue 2: `codeFiles.submit` Strict Schema Validation
- **Symptom:** Submitting code payloads failed with `SCHEMA_VALIDATION_FAILED` when submitting single-file payloads `{ path, code }` or using invalid `kind` values.
- **Root Cause:** The `codeFiles.submit` operation expects `{ files: Array<{ path, code, kind }> }`, where `kind` must strictly be one of `"page" | "template" | "component" | "code-component" | "asset" | "config" | "other"`.
- **Resolution:** Formatted all CLI payloads with `{ files: [ { path, code, kind } ] }` using the proper enum values.

---

### Issue 3: Oracle Dialect Rejection on Server Route Wrappers (`app/**/page.tsx`)
- **Symptom:** Attempting to update `app/category/[category]/page.tsx` via `codeFiles.submit` triggered 9 Oracle violations (`[USE_CLIENT_REQUIRED]`, `[FORBIDDEN_IMPORT]`, `[PAGE_EXTRA_EXPORT]`, `[MISSING_DATA_ID]`, `[PAGE_ROOT_REQUIRED]`).
- **Root Cause:** The Oracle engine classifies any file ending in `/page.tsx` as an editable canvas page, mandating `'use client'`, canvas viewport metadata comments, and a single default export. Next.js server components and route wrappers (which export `generateMetadata` or `generateStaticParams`) are not canvas pages.
- **Resolution & System Architecture:** Server wrappers are generated and maintained by the builder core (`cms-seo.ts`, `locale-route-ops.ts`, `source-export.ts`). Canvas pages live in `page.client.tsx`. During export, `source-export.ts` automatically discovers dynamic route parameters and injects `generateStaticParams` into server wrappers for SSG, or strips them for Dynamic mode.

---

### Issue 4: Dynamic Function Calls in Inline Styles Dropped
- **Symptom:** Using dynamic style attributes like `order: String(idx)` resulted in `[RESOLVE_STYLE_DROPPED]` warnings.
- **Root Cause:** Revyme's static AST style parser expects literal strings or numbers in inline style objects (e.g. `order: '0'`). Dynamic expressions are stripped to protect visual editor synchronization.
- **Resolution:** Used static literal `order: '0'` for repeater card elements.

---

### Issue 5: Unsupported Hand-Written Conditional JSX
- **Symptom:** Oracle rejected `{cat && <Link>...}</Link>}` with `[CONDITIONAL_RENDER_UNSUPPORTED]`.
- **Root Cause:** The Revyme canvas requires all editable nodes to remain mounted unconditionally in the AST so they can be selected, measured, and styled in the canvas iframe.
- **Resolution:** Mounted components unconditionally, using defensive fallback variables (e.g. `cat = rawCat ?? categories[0]`).

---

### Issue 6: Repeater Chain Parsing on Localized Collections
- **Symptom:** Oracle flagged `[CMS_MAP_UNRESOLVED]` when slicing or filtering collections in a temporary variable before `.map()`.
- **Root Cause:** Revyme's AST analyzer resolves repeater bounds by inspecting the direct JSX map expression.
- **Resolution:** Chained `.slice()` and `.filter()` directly on `localizeRows()` in JSX:
  `{localizeRows(posts, __activeLocale).slice(0, 3).map((item) => ...)}`.

---

### Issue 7: Direct Submission of Canvas Pages and Templates via `codeFiles.submit`
- **Symptom:** Submitting raw TSX source for `page.client.tsx` or `LayoutClient.tsx` bypasses the visual editor's responsive styling engine, strips container styles (`<style data-viewport-styles="...">`), breaks canvas node `data-id` tracking, and risks overwriting concurrent user visual edits.
- **Root Cause:** Lack of an explicit guard in `packages/automation-core/src/operations/code-files.ts`.
- **Fix Implemented:** Added `CANVAS_PAGE_SUBMISSION_DISALLOWED` runtime guard in `codeFiles.submit` (commit `9dd11f8`), rejecting any submission of `kind: 'page' | 'template'` or paths ending in `page.client.tsx` / `LayoutClient.tsx`. Directed agents to use high-level semantic tools (`nodes.*`, `templates.*`, `components.instance.*`, `styles.*`).

---

### Issue 8: `templates.assign` Broke Generated Locale Route Wrappers (`UNRESOLVED_IMPORT`)
- **Symptom:** When assigning a page (e.g. `/` or `/blog`) to a route group template (e.g. `(main)`), `templates.assign` moved `app/page.tsx` to `app/(main)/page.tsx`. However, the generated locale routes (e.g. `app/en/page.tsx`) still imported `export { default } from '@/app/page'`, causing `UNRESOLVED_IMPORT: Unresolved import "@/app/page" in app/en/page.tsx` during validation.
- **Root Cause:** `templates.assign` and `templates.remove` in `packages/automation-core/src/operations/templates.ts` moved server page files without cascading path updates to `@revyme-locale-route` wrappers.
- **Fix Implemented:** Updated `templatesAssignOperation` and `templatesRemoveOperation` to scan for `@revyme-locale-route` files referencing the moved server paths and rewrite both the `@/app/...` import path and the `Content lives in ...` metadata header.

---

### Issue 9: Authoring Design Components via `codeFiles.submit` vs `components.create`
- **Symptom:** Attempting to write Design Components (`Navbar`, `Footer`) with raw code via `codeFiles.submit` triggered Oracle errors (`[COMPONENT_ROOT_PERCENT_SIZE]`, `[TEXT_STYLE_ON_FRAME]`, `[COMPONENT_LINK_NOT_MOTIONLINK]`).
- **Root Cause:** Design Components in Revyme require specific canvas AST structures: artboard wrapper with `withResponsiveProps`, `variantConfig`, typography isolated on text leaves rather than frames, and unique `data-id`s. Moreover, `codeFiles.submit` previously lacked a guard against submitting design components, leaving a loophole.
- **Fix Implemented:** Added `DESIGN_COMPONENT_SUBMISSION_DISALLOWED` runtime guard in `packages/automation-core/src/operations/code-files.ts`, rejecting any submission with `kind: 'component'` or any file in `components/` that lacks `/** @controls { ... } */`. Design components must be authored using the high-level semantic MCP tool `components.create` with typed `props` and declarative `layout` AST, or extracted from canvas via `components.extract`.

---

## 3. Export Pipeline Verification

Both export targets were tested and verified via `export.generate` at ProjectFS Revision 78:

### A. Next.js App Router (Dynamic Mode)
- **Command:** `export.generate --input '{"format":"nextjs","outputType":"archive"}'`
- **Output:** `proj-1793030645294-xrmdi5-nextjs.zip` (34 files, 41,997 bytes)
- **Preflight Diagnostics:** `preflightClean: true`, `preflightIssues: []`
- **Behavior:** Dynamic SSR route handling; `generateStaticParams` stripped from server wrappers.

### B. Next.js App Router (Hybrid SSG Mode)
- **Command:** `export.generate --input '{"format":"ssg","outputType":"archive"}'`
- **Output:** `proj-1793030645294-xrmdi5-ssg.zip` (34 files, 42,188 bytes)
- **Preflight Diagnostics:** `preflightClean: true`, `preflightIssues: []`
- **Behavior:** `generateStaticParams` automatically injected for `/blog/[slug]` and `/category/[category]`. Locale route wrappers at `/en/blog/[slug]` and `/en/category/[category]` automatically re-export `{ default, generateStaticParams }`.

---

## 4. Final Verification Matrix

| Checkpoint | Target | Status |
|---|---|---|
| Ukrainian Default Locale (`/`) | Root route serves Ukrainian content | PASSED |
| English Secondary Locale (`/en/`) | English localized route & CMS fields | PASSED |
| CMS Collections | `categories` & `posts` with foreign key ref | PASSED |
| Test Articles | 10 articles with image, summary, content | PASSED |
| Latest Posts on Home | Top 3 posts displayed on homepage | PASSED |
| Blog List Page | All 10 posts displayed on `/blog` | PASSED |
| Article Detail Page | Dynamic route `/blog/[slug]` | PASSED |
| Category Page | Dynamic route `/category/[category]` | PASSED |
| Language Switcher | Navbar dropdown switching `/` ↔ `/en/` | PASSED |
| Oracle AST Compliance | 0 errors across all client pages | PASSED |
| Dynamic Export | 34 files, 100% clean preflight | PASSED |
| Hybrid SSG Export | 34 files, 100% clean preflight | PASSED |
