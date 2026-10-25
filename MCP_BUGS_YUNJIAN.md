# Yunjian Mountain Retreat — Revyme MCP v2 Bug Audit & Fixes Log

**Project ID:** `proj-1792939066653-d2undo`  
**Site:** Yunjian Mountain Retreat (High-Luxury Minimalist Mountain Experience)  
**Branch:** `feature/mcp-v2`  
**Date:** 2026-10-25  
**Author:** Antigravity AI Assistant

---

## Executive Summary

During the end-to-end automated construction, styling, and verification of the **Yunjian Mountain Retreat** cinematic landing page in project `proj-1792939066653-d2undo`, all operations are performed via Revyme MCP v2 (`packages/cli/dist/main.js`).

Per user instructions, every bug or edge case discovered in the MCP tools/CLI is immediately diagnosed, resolved with a clean code fix, verified with automated tests, committed to git, and documented in this log.

---

## 1. Discovered Bugs, Diagnoses & Code Fixes

### Bug 1: CLI crashes with `ERR_INVALID_ARG_TYPE: The "paths[1]" argument must be of type string. Received type boolean (true)` when passing `--input-file -`
- **Location:** `packages/cli/src/main.ts` (in `parseCliTokens` and input data gathering).
- **Symptom:** Running `revyme assets.upload --input-file -` with piped standard input crashed Node.js with:
  ```
  TypeError [ERR_INVALID_ARG_TYPE]: The "paths[1]" argument must be of type string. Received type boolean (true)
      at Object.resolve (node:path:1257:7)
      at runCli (packages/cli/src/main.ts:235:28)
  ```
- **Root Cause:** 
  1. In `parseCliTokens`: when checking `const next = args[i + 1]`, the code checked `!next.startsWith('-')`. Because `'-'` starts with `'-'`, it treated `--input-file` as a boolean flag `flags['input-file'] = true` instead of assigning `'-'` as the value of the flag.
  2. In the input collector: `flags['input-file']` was checked first, and passed directly into `path.resolve(process.cwd(), flags['input-file'])`. Because `flags['input-file']` was boolean `true`, `path.resolve` threw `ERR_INVALID_ARG_TYPE`.
  3. Short flag parsing had dead code: `else if (token.startsWith('-') && token.length > 1)` checked `if (token === '-')` inside the block, which could never be true since `'-'.length === 1`.
- **Fix:**
  1. Updated `parseCliTokens` lookahead: allowed `next === '-'` to be consumed as flag values (`(!next.startsWith('-') || next === '-')`).
  2. Placed top-level check `if (token === '-')` to mark `flags.stdin = true`.
  3. In input data gathering: checked `if (flags['input-file'] === '-' || flags.stdin || toolArgs.includes('-'))` first to properly read from standard input (`stdin`). Added type guard to validate `flags['input-file']` is a string with informative structured error rather than unhandled exception.
- **Verification & Testing:**
  - Added unit test to `packages/cli/test/cli.test.ts`: `correctly parses --input-file - and passes stdinData to operation execution`.
  - Tested running `node packages/cli/dist/main.js assets.upload --input-file -` uploading `grain.svg` into project `proj-1792939066653-d2undo`. Upload succeeded with status `committed` and revision 4.
- **Git Commit:** `70b5b3a` ("fix(cli): support '--input-file -' and stdin flags without crashing with ERR_INVALID_ARG_TYPE").

### Bug 2: CLI crashes with `Error: EAGAIN: resource temporarily unavailable, read` when piping large inputs into standard input
- **Location:** `packages/cli/src/main.ts` (lines 235–248).
- **Symptom:** When piping large payloads (such as base64-encoded images or large JSON batches) via `--stdin` or `--input-file -`, Node.js threw an unhandled synchronous exception:
  ```
  Error: EAGAIN: resource temporarily unavailable, read
      at Object.readFileSync (node:fs:483:20)
      at runCli (packages/cli/src/main.ts:246:22)
  ```
- **Root Cause:** In Linux environments, standard input pipes when filled with large streams or when libuv sets non-blocking mode on file descriptor 0 can cause synchronous `fs.readFileSync(0, 'utf8')` to fail immediately with `EAGAIN` / `EWOULDBLOCK`. Because `runCli` is an async function, synchronous blocking read on fd 0 was inappropriate for large data transfer.
- **Fix:** Introduced an asynchronous stream consumer `readStdin(): Promise<string>` that subscribes to `process.stdin` `data`, `end`, and `error` events and awaits full stream reception cleanly. If `process.stdin.isTTY` is true, it immediately resolves to empty string.
- **Verification & Testing:**
  - Ran upload of large 468 KB binary JPEG image encoded as base64 via piped stdin: `node packages/cli/dist/main.js assets.upload --input-file -`. Read was completed without EAGAIN and uploaded asset into project successfully.
  - Ran full test suite `npx vitest run packages/cli` (6 test files, 40 tests) — 100% passing.
- **Git Commit:** `666f94c` ("fix(cli): use asynchronous stream read for stdin to prevent EAGAIN on large piped inputs").

### Bug 3: `INVALID_IMAGE_SOURCE` falsely reported on valid uploaded project assets during `codeFiles.submit`, `codeComponents.create`, `diagnostics.projectCheck`, and `publish.preflight`
- **Location:**
  - `packages/automation-core/src/operations/code-files.ts` (line 315)
  - `packages/automation-core/src/operations/diagnostics.ts` (line 205)
  - `packages/automation-core/src/operations/publish.ts` (line 267)
  - `packages/automation-core/src/operations/code-components.ts` (line 159)
  - `src/code/oracle/checks/image-source.ts` (line 31)
- **Symptom:** Submitting or validating files referencing uploaded project assets (e.g. `<img src="/assets/hero.jpg" />` or `components/PassageCard.tsx` referencing `/assets/section2-suites.jpg`) failed Oracle validation with:
  ```
  [INVALID_IMAGE_SOURCE] <img> (data-id="...") has invalid src="/assets/hero.jpg". Image assets must either be an external link (URL: https://...) or uploaded directly into this project via upload (e.g. /api/uploads/...). Arbitrary local filesystem paths outside this project (such as /images/...) are forbidden.
  ```
- **Root Cause:**
  `isAllowedImageSource(src, projectFiles)` includes logic to accept project-scoped assets under `public/assets/` when `projectFiles: Set<string>` is passed in the options to `checkFile()`.
  However, in `codeFiles.submit`, `codeComponents.create`, `diagnostics.projectCheck`, and `publish.preflight`, `checkFile(code, { kind, path })` was invoked without providing `projectFiles`. As a result, `projectFiles` was `undefined`, and valid uploaded assets in `public/assets/` were incorrectly treated as forbidden arbitrary paths. Additionally, in `isAllowedImageSource()`, relative paths without a leading slash (`assets/hero.jpg`) were not mapped to `public/${clean}`.
- **Fix:**
  1. Updated `codeFilesSubmitOperation` to construct `projectFileSet = new Set(projectFS.listFiles())` (including the files in the current submit batch) and pass `projectFiles: projectFileSet` to `checkFile()`.
  2. Updated `diagnosticsOperation`, `publishPreflightOperation`, and `codeComponentsCreateOperation` to pass `projectFiles: new Set(projectFS.listFiles())` to `checkFile()`.
  3. In `isAllowedImageSource()`, ensured that `projectFiles.has('public/' + clean)` is checked regardless of whether `s` begins with `/`.
- **Verification & Testing:**
  - Added test in `packages/automation-core/test/capabilities/T20-challenger1.test.ts`: `successfully allows referencing uploaded project assets in public/assets/ via /assets/ without INVALID_IMAGE_SOURCE`.
  - Ran vitest suite: 34/34 tests passed cleanly in `T20-challenger1.test.ts`.
  - Rebuilt `@revyme/cli` binary.
- **Git Commit:** `b51cf01` ("fix(automation-core): supply projectFiles to Oracle checkFile to validate project-scoped assets").

### Bug 5: Editor Media Gallery tab empty because assets committed via automation did not sync to `data/uploads/` and `data/uploads-meta.json`
- **Location:**
  - `packages/automation-core/src/operations/assets.ts`
  - `server/automation/project-repository.ts` (inside `applyPlan()`)
- **Symptom:** Assets uploaded via `assets.upload` or committed to `public/assets/` were saved in the project's source tree (`record.data.files`), but the editor's left-toolbar Media tab remained empty. Querying `GET /api/upload?websiteId=proj-1792939066653-d2undo&type=image` returned an empty list `{"uploads": []}`.
- **Root Cause:** Revyme has two complementary asset storage systems:
  1. `ProjectFS` (project git tree under `public/assets/` or `snapshot.files`), which Next.js bundles and JSX references.
  2. `Media Gallery` (`data/uploads/` and `data/uploads-meta.json`), which powers the visual editor's Media tab via `server/storage.ts` `listUploads()`.
  The automation commit pipeline in `project-repository.ts` only saved changes into `record.data.files` and did not notify or write to `saveUploadExact()`, leaving the server uploads metadata unpopulated for the project.
- **Fix:** In `server/automation/project-repository.ts`, added automatic synchronization in `applyPlan()`:
  - Whenever a committed plan modifies or creates a file under `public/assets/`, `public/images/`, or `public/uploads/`, the file content is decoded (handling base64, data URIs, SVG, and binary buffers) and written via `saveUploadExact(safeName, buf, this.dataDir, projectId)`.
  - When an asset file is deleted (`change.content === null`), `deleteUpload(safeName, this.dataDir)` is called.
  - Thumbnails are generated automatically by `ensureThumbnail()`.
- **Verification & Testing:**
  - All 7 assets (`hero.jpg`, `section2-suites.jpg`, `section3-terrace.jpg`, `section4-table.jpg`, `section5-night.jpg`, `grain.svg`, `ink-wash.svg`) were synchronized into `data/uploads/` with `projectId: "proj-1792939066653-d2undo"`.
  - Verified live via `curl -s "http://localhost:3333/api/upload?websiteId=proj-1792939066653-d2undo&type=image"`: returns all 7 assets with valid names, keys, sizes, URLs, and thumbnails.
- **Git Commit:** `99f9f0d` ("fix(automation-core, server): resolve snapshot projectFiles in diagnostics and sync assets to editor media gallery").

### Bug 6: `ReferenceError: projectFS is not defined` during `diagnostics.projectCheck`
- **Location:**
  - `packages/automation-core/src/operations/diagnostics.ts` (line 205)
  - `packages/automation-core/src/operations/publish.ts` (line 267)
- **Symptom:** Executing `diagnostics.projectCheck` crashed with:
  ```
  ReferenceError: projectFS is not defined
      at Object.execute (packages/automation-core/src/operations/diagnostics.ts:205:37)
  ```
- **Root Cause:** When updating `diagnostics.ts` to supply `projectFiles` to `checkFile()`, `new Set(projectFS.listFiles())` was referenced, but `projectFS` was never imported in `diagnostics.ts`. In automation operations, the current project state is passed cleanly through `snapshot: Snapshot`, whose `snapshot.files` is a `Map<string, string>`.
- **Fix:**
  - In `packages/automation-core/src/operations/diagnostics.ts`, changed:
    ```ts
    const projectFiles = new Set(snapshot.files?.size ? snapshot.files.keys() : []);
    ```
  - In `publish.ts`, `code-files.ts`, and `code-components.ts`, prioritized `snapshot.files.keys()` over ambient `projectFS`, ensuring headless CLI and server operations are fully decoupled from global state.
- **Verification & Testing:**
  - Ran `npx tsc --noEmit` — 0 errors.
  - Rebuilt `@revyme/cli` binary.
  - Executed `node packages/cli/dist/main.js diagnostics.projectCheck --project-id proj-1792939066653-d2undo`: returned `clean: true`, `passed: true`, 13/13 clean files, 0 errors, 0 violations.
  - Executed `node packages/cli/dist/main.js publish.preflight --project-id proj-1792939066653-d2undo`: 6/6 checks passed cleanly.
- **Git Commit:** `99f9f0d` ("fix(automation-core, server): resolve snapshot projectFiles in diagnostics and sync assets to editor media gallery").

### Bug 7: CLI `observe.screenshot` failed with `HEADLESS_DISPLAY_UNAVAILABLE`
- **Location:**
  - `packages/cli/src/main.ts` (line 397)
  - `packages/cli/src/mcp.ts` (lines 18, 52, 337)
- **Symptom:** Running `revyme observe.screenshot --project-id proj-1792939066653-d2undo ...` failed with:
  ```json
  {
    "ok": false,
    "error": {
      "code": "HEADLESS_DISPLAY_UNAVAILABLE",
      "message": "Headless screenshot capture requires an active canvas browser session or Playwright display service."
    }
  }
  ```
- **Root Cause:**
  1. `AutomationClient` in `packages/cli/src/main.ts` did not provide `screenshotService` inside `context.adapters` during tool execution.
  2. In `packages/cli/src/mcp.ts`, `DEFAULT_MCP_BRIDGE_URL` defaulted to `http://127.0.0.1:8082` (an unconfigured default) rather than using the server's actual API URL (`config.apiUrl`, e.g. `http://localhost:3333`).
  3. When querying the screenshot service, `revision` was passed as undefined instead of defaulting to `snapshot.revision`.
- **Fix:**
  - In `packages/cli/src/mcp.ts`, exported `createBridgeScreenshotService(customUrl?: string)`.
  - Passed `config?.apiUrl` to connect directly to the active Revyme dev server instance.
  - Wired `adapters: { screenshotService }` into `main.ts` for all CLI tool executions.
  - Set default revision fallback `revision: revision ?? snapshot.revision`.
- **Verification & Testing:**
  - Rebuilt `@revyme/cli`.
  - Successfully connected to the browser canvas bridge via HTTP RPC.
- **Git Commit:** `f6b4d6b` ("fix(mcp, cli, server): fix observe.screenshot bridge regex overflow, cli adapter wiring, and asset route resolution").

### Bug 8: Vite dev server returned HTML for `/assets/:file` requests
- **Location:**
  - `server/api-plugin.ts` (line 388)
- **Symptom:** Image elements referencing `/assets/section5-night.jpg` or `/assets/hero.jpg` failed to load in the browser canvas, returning Vite's `index.html` (text/html) with HTTP 200 instead of the image binary.
- **Root Cause:** `server/api-plugin.ts` only intercepted routes starting with `/api/uploads/`. Requests directed to `/assets/:file` fell through all API route handlers and were intercepted by Vite's SPA fallback middleware, which serves `index.html` for unknown routes.
- **Fix:**
  - Extended the API middleware in `server/api-plugin.ts` to match both `/api/uploads/:file` and `/assets/:file`.
  - Added resolution for files existing in `public/assets/` in addition to `data/uploads/`.
  - Ensured correct MIME headers (`image/jpeg`, `image/png`, `image/svg+xml`, `image/webp`).
- **Verification & Testing:**
  - Verified via `curl -I http://localhost:3333/assets/section5-night.jpg`: returned `HTTP/1.1 200 OK`, `Content-Type: image/jpeg`.
  - Verified via `curl -I http://localhost:3333/api/uploads/section5-night.jpg`: returned `HTTP/1.1 200 OK`, `Content-Type: image/jpeg`.
- **Git Commit:** `f6b4d6b` ("fix(mcp, cli, server): fix observe.screenshot bridge regex overflow, cli adapter wiring, and asset route resolution").

### Bug 9: `diagnostics.projectCheck` and `publish.preflight` falsely flagged uploaded assets as `missingAssets`
- **Location:**
  - `packages/automation-core/src/operations/diagnostics.ts` (line 328)
  - `packages/automation-core/src/operations/publish.ts` (line 396)
- **Symptom:** When JSX referenced valid uploaded assets via `/api/uploads/section5-night.jpg` or `/api/uploads/hero.jpg`, `diagnostics.projectCheck` reported them as `missingAssets` even though the files existed in the project repository and public folders.
- **Root Cause:** `diagnostics.ts` checked only `snapshot.files.has(val.replace(/^\//, ''))` which looked for the exact path `api/uploads/section5-night.jpg` in `snapshot.files`. Because uploaded files are stored under `public/assets/`, `public/uploads/`, or `assets/`, the check failed to match the basename.
- **Fix:**
  - In `packages/automation-core/src/operations/diagnostics.ts` and `publish.ts`, updated asset resolution logic to extract the filename basename (`val.split('?')[0].split('/').pop()`) and test candidate paths:
    `[assetRel, public/${assetRel}, public/assets/${baseName}, public/uploads/${baseName}, public/api/uploads/${baseName}, assets/${baseName}]`.
- **Verification & Testing:**
  - Ran `node packages/cli/dist/main.js diagnostics.projectCheck --project-id proj-1792939066653-d2undo`: returned `missingAssetsCount: 0`, `clean: true`.
  - Ran `node packages/cli/dist/main.js publish.preflight --project-id proj-1792939066653-d2undo`: reported "All 10 referenced static asset paths resolve correctly".
- **Git Commit:** `f6b4d6b` ("fix(mcp, cli, server): fix observe.screenshot bridge regex overflow, cli adapter wiring, and asset route resolution").

### Bug 11: Section Collision on Tablet/Mobile — `height: min-content` and Fixed Height on Code Component Wrapper Caused Section Overlap
- **Location:**
  - `app/page.client.tsx` (lines 244–251 and line 58824)
  - `components/GalleryDeck.tsx` (root div styling)
- **Symptom:** On Tablet (810px) and Mobile (390px), Section 6 (`Chronicle`) and Section 7 (`Passage`) collided and overlapped. The `Chronicle` bounding box cut off right below card 1 (`Cloud Pavilion`), while the next section (`Passage` - "The Rhythms of Ascent and Stillness") started immediately and was drawn directly on top of cards 2, 3, and 4 (`Pine Terrace`, `Tea Table`, `Moon Sanctuary`).
- **Root Cause:**
  1. A legacy media rule in `app/page.client.tsx`:
     ```css
     @media (max-width: 810px) and (min-width: 390.02px) {
       [data-id="chronicle-gallery-deck"] { flex: 0 0 auto !important; height: min-content !important; }
     }
     @media (max-width: 390px) {
       [data-id="chronicle-gallery-deck"] { height: min-content !important; }
     }
     ```
     In CSS Flexbox Level 3 specification (§4.1), `height: min-content` on a flex column container evaluates to the maximum intrinsic size of a single item (~380px) rather than the sum of all stacked items. As a result, `chronicle-gallery-deck` was clamped to ~380px–500px, causing the remaining 3 cards to visually overflow into subsequent sibling sections.
  2. In JSX, `<GalleryDeck ... style={{ ... height: '520px' }}>` passed an explicit height of `520px`. While 520px fits the horizontal 4-card deck on desktop, vertical stacking on tablet requires ~1690px (4 cards * 380px + gaps + header).
  3. In `components/GalleryDeck.tsx`, `gallery-deck-root` carried `height: '100%'`, preventing natural content-driven expansion when the container was constrained.
- **Fix:**
  1. Removed the stale `min-content` `<style>` tag block from `app/page.client.tsx`.
  2. Updated `<GalleryDeck ... style={{ ... height: 'auto' }}>` in JSX so the component naturally sizes according to its content on all breakpoints.
  3. In `components/GalleryDeck.tsx`, changed `gallery-deck-root` style to `height: 'auto', minHeight: '100%'`.
  4. In `yunjian-responsive-media-rules`, under `@media (max-width: 900px)`:
     - Set `[data-id="section-chronicle"]` and `[data-id="section-passage"]` to `height: auto !important; min-height: auto !important; flex: 0 0 auto !important;`.
     - Set `[data-id="chronicle-gallery-deck"]`, `[data-id="chronicle-gallery-deck:gallery-deck-root"]`, and `[data-id="gallery-deck-root"]` to `height: auto !important; min-height: auto !important; max-height: none !important; flex: 0 0 auto !important; width: 100% !important;`.
     - Set `[data-id="gallery-deck-cards"]` and `[data-id="chronicle-gallery-deck:gallery-deck-cards"]` to `display: flex !important; flex-direction: column !important; height: auto !important; min-height: auto !important; max-height: none !important; gap: 24px !important; overflow: visible !important; width: 100% !important;`.
- **Systemic Prevention (Oracle Rule Enforced):**
  - Added new Oracle validation check `FORBIDDEN_MIN_CONTENT_HEIGHT` in `src/code/oracle/checks/layout-rules.ts` and wired into `src/code/oracle/check-file.ts`.
  - The rule scans both inline JSX `style={{ height: 'min-content' }}` and `@media` `<style>` blocks for rules targeting component instances or sections.
  - Any future attempt by an AI agent, MCP client, or developer to submit `height: min-content` or `min-height: min-content` on component instances or sections is rejected with a descriptive tier 2 error:
    `ORACLE_VIOLATION: Batch rejected due to 1 violation(s): [FORBIDDEN_MIN_CONTENT_HEIGHT] ... In CSS Flexbox, Grid, and vertical flow, min-content height resolves to a single child height (~380px) instead of the total stack height, causing container clamping and sibling section collisions. Use 'height: auto' or explicit px dimensions instead.`
  - Added 4 unit tests in `src/code/oracle/checks/forbidden-min-content.test.ts` (100% passing).
  - Rebuilt `@revyme/cli` binary (`packages/cli/dist/main.js`).
- **Git Commit:** `b17a02c` ("feat(oracle): add FORBIDDEN_MIN_CONTENT_HEIGHT rule to prevent container clamping and section collisions").

### Bug 13: Design Component Variants (`Default Header` vs `Scrolled Glass`) Failed to Switch Styles in Visual Editor and Had No Scroll Wiring on Page
- **Location:**
  - `components/SiteHeader.tsx` (lines 28–43)
  - `components/ReserveButton.tsx` (lines 28–36)
  - `app/page.client.tsx` (SiteHeader instance)
- **Symptom:**
  - When switching between ❖ `Default Header` and ❖ `Scrolled Glass` in the visual canvas / layers panel (as shown in user screenshot `media_1792945718430_ab056cae.png`), the component's styles did not change in the property controls or on the canvas.
  - On the live site, scrolling past the arrival threshold never triggered the scrolled variant.
- **Root Cause:**
  1. *Parser bypassed by boolean intermediate variable:* In `components/SiteHeader.tsx` and `components/ReserveButton.tsx`, the code declared `const isScrolled = initialVariant === 'scrolled'` (or `const isSecondary = ...; const isCompact = ...`) and used `isScrolled ? '...' : '...'` in style objects. Revyme's parser (`src/code/parsing/parser.ts:4753`) checks AST conditional expressions where `cond.test.left.name === 'variant' || cond.test.left.name === 'initialVariant'`. Because an intermediate identifier `isScrolled` was used, the parser classified it as a `condvar` and evaluated `conditionalStyles: null`. Without `conditionalStyles`, the editor's variant switch mechanism had no variant-specific overrides and rendered identical styles for both variants.
  2. *Missing Scroll Variant wiring on Page:* In `app/page.client.tsx`, `<SiteHeader>` was mounted statically without `data-scroll-variant` or `initialVariant={pageHeaderSv}`, and the page lacked the `useScroll` / `useMotionValueEvent` scroll tracker. Furthermore, an instance style override `height: '76px'` was hardcoded on the page, blocking the component's variant-driven height shrinkage.
- **Fix:**
  1. *Direct Variant Ternaries in Design Components:* In `components/SiteHeader.tsx` and `components/ReserveButton.tsx`, removed intermediate boolean variables and replaced all conditionals with direct inline ternaries testing `initialVariant === '...'`.
     For `SiteHeader.tsx`, authored high-contrast, distinct luxury styling for `scrolled` vs `default`:
     - `height`: `initialVariant === 'scrolled' ? '68px' : '76px'`
     - `paddingLeft` / `paddingRight`: `initialVariant === 'scrolled' ? '28px' : '36px'`
     - `backgroundColor`: `initialVariant === 'scrolled' ? 'rgba(15, 26, 23, 0.94)' : 'rgba(19, 32, 29, 0.25)'`
     - `borderBottom`: `initialVariant === 'scrolled' ? '1px solid rgba(143, 162, 140, 0.35)' : '1px solid rgba(245, 240, 228, 0.08)'`
     - `backdropFilter` / `WebkitBackdropFilter`: `initialVariant === 'scrolled' ? 'blur(20px)' : 'blur(8px)'`
     - `boxShadow`: `initialVariant === 'scrolled' ? '0 12px 36px rgba(0, 0, 0, 0.45)' : 'none'`
     - CTA Button `backgroundColor`: `initialVariant === 'scrolled' ? 'var(--vermilion)' : 'var(--pine)'`
     - CTA Button `border`: `initialVariant === 'scrolled' ? '1px solid rgba(156, 61, 49, 0.65)' : '1px solid rgba(143, 162, 140, 0.45)'`
  2. *Page Scroll Variant Wiring:* In `app/page.client.tsx`:
     - Connected `data-scroll-variant='{"trigger":"onScroll","from":"default","to":"scrolled","direction":"down","replay":true}'` and `initialVariant={pageHeaderSv}` to `<SiteHeader>`.
     - Injected page-level framer-motion scroll hooks: `const [pageHeaderSv, setPageHeaderSv] = useState('default'); const { scrollY: pageHeaderSvScroll } = useScroll(); useMotionValueEvent(pageHeaderSvScroll, "change", (y) => { const prev = pageHeaderSvScroll.getPrevious() ?? 0; if (y > prev) setPageHeaderSv('scrolled'); else if (y < prev) setPageHeaderSv('default'); });`.
     - Removed hardcoded `height: '76px'` from the page instance style so the component's variant-driven height transition applies cleanly.
     - Resolved `mobile-nav-trigger` desktop visibility via responsive CSS media query instead of inline `display: 'none'`, cleanly satisfying Oracle rule `DISPLAY_TOGGLE_VISIBILITY`.
- **Verification & Testing:**
  - Ran `parseJSXToNodes` on `components/SiteHeader.tsx` and `components/ReserveButton.tsx`: verified full `conditionalStyles` extraction for all 8 visual style properties.
  - Ran `diagnostics.projectCheck` via CLI: returned `clean: true`, `passed: true`, `totalFilesChecked: 13`, `oracleViolations: []`.
  - Ran `publish.preflight` via CLI: returned `passed: true`, `failedChecks: 0`, and confirmed `oracle.app/page.client.tsx: pass`.
  - Verified live browser synchronization: revisions 191, 192, and 193 were applied and synced immediately to the open editor tab (`"status": "synced", "clientCount": 1`).







