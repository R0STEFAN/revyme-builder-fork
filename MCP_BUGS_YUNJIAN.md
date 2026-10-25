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

### Bug 14: Systemic Prevention in MCP & Oracle — Added `FORBIDDEN_INDIRECT_VARIANT_CHECK` Rule
- **Location:**
  - `src/code/oracle/checks/variant-dialect.ts`
  - `src/code/oracle/checks/forbidden-indirect-variant.test.ts`
  - `packages/cli/dist/main.js`
  - `.agents/skills/revyme-mcp/SKILL.md`
  - `.agents/skills/revyme-mcp/references/oracle-rules.md`
  - `components/PassageCard.tsx`
- **Symptom:** AI agents constructing Design Components repeatedly used intermediate boolean variables (e.g. `const isScrolled = initialVariant === 'scrolled'`, `const isActive = initialVariant === 'active'`) and used them in style object ternaries (`filter: isActive ? ... : ...`). Because Revyme's parser (`src/code/parsing/parser.ts:4753`) strictly inspects AST BinaryExpressions where `cond.test.left.name === 'variant' || cond.test.left.name === 'initialVariant'`, any intermediate boolean identifier causes `conditionalStyles` to be evaluated as `null`. As a result, switching variants in the visual canvas or layers panel produced identical static styling.
- **Fix:**
  1. Implemented new Oracle rule `FORBIDDEN_INDIRECT_VARIANT_CHECK` in `src/code/oracle/checks/variant-dialect.ts`.
     - Scans `VariableDeclarator` nodes for intermediate variables initialized with variant comparisons (`variant === ...`, `initialVariant === ...`, `!=`, `!==`, `&&`, `||`, or member calls).
     - Scans style object properties in design components for `ConditionalExpression` nodes where `test` is an indirect boolean identifier (not a declared `@propMeta` boolean prop or responsive gate `__mqN`).
     - Rejects any offending code on submission with a clear tier 2 error:
       `[FORBIDDEN_INDIRECT_VARIANT_CHECK] Intermediate variant variable "<varName>" (line X) — do not store variant checks in boolean variables (e.g. const <varName> = initialVariant === '...'). Revyme's parser and editor inspect inline AST ternaries directly (initialVariant === 'variant-name' ? val : fallback in style objects, or {initialVariant === 'variant-name' && <Child/>} inside AnimatePresence). Using an intermediate variable prevents conditionalStyles extraction, causing variants to lose their styling in the visual editor. Delete "<varName>" and inline the check directly where needed.`
  2. Fixed `components/PassageCard.tsx`: removed `const isActive = initialVariant === 'active'` and used inline `initialVariant === 'active' ? 'grayscale(0) sepia(0)' : 'grayscale(1) sepia(0.16)'`, successfully enabling the `Active Seal` variant filter.
  3. Rebuilt `@revyme/cli` bundle (`packages/cli/dist/main.js`).
- **Verification & Testing:**
  - Unit test suite `src/code/oracle/checks/forbidden-indirect-variant.test.ts`: 4/4 tests passed (100%).
  - Full suite `src/code/oracle/variant-dialect.test.ts`: 26/26 tests passed (100%).
  - Tested rejection by attempting to submit non-compliant `PassageCard.tsx`: CLI correctly rejected submission with `ORACLE_VIOLATION: Batch rejected due to 2 violation(s): [FORBIDDEN_INDIRECT_VARIANT_CHECK]`.
  - Submitted fixed `PassageCard.tsx`: accepted cleanly and committed (revision 209).
  - Ran `diagnostics.projectCheck`: `clean: true`, `passed: true`, 0 oracle violations.

### Bug 15: "Reset Override" in Visual Inspector Failed to Reset Variant Overrides on Component Artboards
- **Location:**
  - `src/canvas/drag/replica-context.ts` (line 682)
  - `src/canvas/node-ops.ts` (lines 2296, 2797, 2806, 2815–2820)
  - `src/code/generation/generator-styles.ts` (lines 2716–2748, 3962, 3967)
  - `src/editor/tools/StylesTool/atoms/ShadowControl.tsx` (lines 28, 287–296, 338)
- **Symptom:**
  - In the component editor on a non-default variant artboard (e.g. `Scrolled Glass`), selecting an element with an override (such as `site-header-brand` with shadow `0, 4, 16`) and clicking "Reset Override" on the Shadow property row context menu did not reset the shadow (as shown in user screenshot `media_1792947174472_4e3238e1.png`).
  - The shadow remained visible, the purple override accent persisted, and the source file was never modified.
- **Root Cause:**
  1. *Missing authored conditional style check in `replica-context.ts`:* `getReplicaContext().styleUpdate` only treated a property as conditional if `PROJECTION_STYLE_PROPS.has(k) || (k === 'display' && isCmsRow)`. Properties authored as conditional ternaries (like `boxShadow`, `backgroundColor`, `border`, `color`, `opacity`, `backdropFilter`, etc.) were routed into `other` -> `updateVariantStyle` (motion variants object) instead of `setConditionalStyleInCode`!
  2. *Stale interacting viewport in `node-ops.ts`:* When editing via inspector panels, `options.viewportPrefix` (e.g. `'scrolled--'`) is passed and mapped to `effectiveVpId = 'scrolled'`. However, `updateNodeStyles` passed `_interactingVpId` (which defaults to `'desktop'` if the user clicked in the sidebar rather than dragging on canvas) to `getReplicaContext(_interactingVpId, ...)`. This falsely treated the write as a primary viewport edit (`isPrimary = true`), causing `styleUpdate` to bypass replica routing.
  3. *Uncaptured conditional style removal in `node-ops.ts`:* In `updateNodeStyles`, lines 2815–2819 checked `if (CSS_RULE_STORAGE_MUTATIONS.has(m.type) && m.styles)` to gather `overrideRemovedKeys`. For `setConditionalStyle` mutations, `m.styles` is undefined (it carries `m.prop` and `m.value`), so `forceRenderForOverrideRemoval` was completely skipped on conditional removals!
  4. *Generator ignored inline ternaries in `updateVariantStyleInCodeInner`:* When `updateVariantStyleInCode` ran on an element without `variants={...}`, an empty value `{ [prop]: '' }` returned `code` untouched instead of modifying the inline ternary.
  5. *`ShadowControl` lacked custom `onResetOverride` handler:* `ShadowControl` manages both `boxShadow` and drop-shadow in `filter`, but didn't pass `onResetOverride` to `EntryList`, so resetting an override only cleared `boxShadow` and missed `filter`.
- **Fix:**
  1. In `src/canvas/drag/replica-context.ts`: extended `isConditional` to check `Boolean(cachedNode?.conditionalStyles && k in cachedNode.conditionalStyles)`.
  2. In `src/canvas/node-ops.ts`: passed `effectiveVpId` to `getReplicaContext(effectiveVpId, ...)` and updated `overrideRemovedKeys` to check `m.type === 'setConditionalStyle' && (m as any).value === ''`.
  3. In `src/code/generation/generator-styles.ts`: added inspection in `updateVariantStyleInCodeInner` to delegate any property with an existing inline ternary to `setConditionalStyleInCode`, and broadened regex matching in `setConditionalStyleInCode` to support both single and double quotes.
  4. In `src/editor/tools/StylesTool/atoms/ShadowControl.tsx`: added `handleResetOverride` to clear `boxShadow: ''` and strip drop-shadow from `filter` via `extractNonShadowFilter`, and passed `onResetOverride={handleResetOverride}` to `EntryList`.
- **Verification & Testing:**
  - Added unit tests in `src/canvas/drag/replica-context.test.ts` (42/42 tests passing).
  - Added unit tests in `src/code/generation/generator-styles.test.ts` (131/131 tests passing).
  - Verified `src/editor/controls/reset-override-canvas-sync.test.ts` (8/8 tests passing).
  - Full TypeScript typecheck `npx tsc --noEmit` passed with 0 errors.

### Bug 16: Navbar Scroll Variant Abruptly Snaps Styles on Scroll (Lack of Motion Variants & Layout Animation)
- **Location:**
  - `components/SiteHeader.tsx`
  - `app/page.client.tsx`
- **Symptom:**
  - When scrolling on the website, the navbar (`SiteHeader`), which uses a scroll variant (`scrolled` / `Scrolled Glass`), changed its styles abruptly and instantaneously (0ms snap) instead of morphing smoothly between glass blur and solid color/compact height.
- **Root Cause:**
  1. *Plain DOM tag instead of motion component:* `site-header-root` was a standard `<div>` instead of `<motion.div>`, had an empty `variants` object without paint values, and lacked an `animate` binding.
  2. *Inline style ternaries snap without interpolation:* In React / Framer Motion, paint properties (`backgroundColor`, `borderBottom`, `backdropFilter`, `boxShadow`) placed inside style ternaries `variant === 'scrolled' ? ... : ...` update synchronously upon state re-render. Without Framer Motion variant interpolation, the browser applies them instantly.
  3. *Duplicate property overwrite:* In `SiteHeader.tsx`, static declarations of `borderBottom: '1px solid rgba(245, 240, 228, 0.12)'` and `backdropFilter: 'blur(16px)'` were declared after the dynamic ternaries in the style object, overriding them and freezing the blur.
  4. *Undefined CSS token:* The CTA button used `var(--vermilion)` which was not defined in `globals.css` (seal red `#9c3d31`).
  5. *1px scroll jitter in `page.client.tsx`:* `useMotionValueEvent` triggered immediately on any 1-pixel scroll delta (`y > prev`), causing twitching at the top edge.
- **Fix:**
  1. Wrapped `SiteHeader` in `<LayoutGroup>` and `<MotionConfig transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}>`.
  2. Promoted root to `<motion.div layout={true} variants={siteHeaderRootVariants} initial={initialVariant} animate={variant}>`.
  3. Extracted paint properties (`backgroundColor`, `borderBottom`, `backdropFilter`, `WebkitBackdropFilter`, `boxShadow`) into `siteHeaderRootVariants` with both `default` and `scrolled` definitions, while mirroring base defaults in `style` to satisfy the `DEFAULT_VALUE_NOT_IN_BASE` Oracle rule.
  4. Added `siteHeaderCtaVariants` and `siteHeaderBrandVariants` for smooth CTA button and logo shadow transitions.
  5. Kept layout properties (`height`, `paddingLeft`, `paddingRight`) in inline style ternaries paired with `layout={true}` for Framer Motion FLIP projection.
  6. Added scroll threshold (`y > 30`) to `useMotionValueEvent` in `app/page.client.tsx`.
  7. Submitted changes cleanly via Revyme MCP CLI (`codeFiles.submit`).
- **Verification & Testing:**
  - Ran `diagnostics.projectCheck`: 0 violations, 0 drift violations (`clean: true`, `passed: true`).
  - Ran `publish.preflight`: all page and Oracle checks passed.
  - Ran `npx tsc --noEmit`: 0 TypeScript errors across entire repo.

### Bug 17: Preview Mode Broken Due to 404 `srcSet` Injections on All Section Images & Navbar Shadow Interpolation Fix
- **Location:**
  - `app/page.client.tsx` (lines 477, 844, 1146, 1207, 1478)
  - `components/SiteHeader.tsx`
- **Symptom:**
  - When opening the preview (`http://localhost:5175/`), the site appeared completely broken and all background images across all 5 sections (`hero-bg-img`, `suites-img`, `terrace-img`, `table-img`, `night-img`) disappeared, showing empty dark boxes. On the editor canvas (`http://localhost:5174/`), the images still showed because the canvas AST parser only reads the primary `src` property.
  - Additionally, the navbar's shadow snapped instantaneously when scrolling rather than blending smoothly.
- **Root Cause:**
  1. *Unresolved webp `srcSet` paths:* Responsive `srcSet` attributes pointing to non-existent `/api/uploads/*-320w.webp` files were present on the 5 background `<img>` tags in `app/page.client.tsx`. When loaded in a real browser in preview, the browser evaluated `srcSet`, attempted to load the WebP images, received HTTP 404 Not Found, and failed to render the images.
  2. *BoxShadow interpolation snap in Framer Motion:* In `components/SiteHeader.tsx`, `boxShadow: 'none'` was used in the `default` variant. Framer Motion cannot interpolate between the keyword `'none'` and a shadow string like `'0 12px 36px rgba(0, 0, 0, 0.45)'`, causing an instant jump. Using `'0 0 0 rgba(0, 0, 0, 0)'` enables Framer Motion to smoothly interpolate color, blur, and spread.
  3. *Global layout group leakage:* `<LayoutGroup>` without an `id` in `SiteHeader.tsx` could leak layout projections into outside page elements.
- **Fix:**
  1. Cleaned `app/page.client.tsx` of all 404 `srcSet` and `sizes` attributes, restoring clean `src="/api/uploads/*.jpg"` which return HTTP 200 OK.
  2. Updated `components/SiteHeader.tsx` variants to use `'0 0 0 rgba(0, 0, 0, 0)'` for `boxShadow` in `default`, isolated `<LayoutGroup id="site-header">`, and configured smooth `MotionConfig` transition (`0.5s` ease).
  3. Submitted changes via Revyme MCP CLI (`codeFiles.submit`).
### Bug 18: Guard Against Direct `data/builds/` Access, Duplicate Style Properties, and Non-Interpolable Variant Shadows
- **Location:**
  - `packages/automation-core/src/operations/code-files.ts` (lines 28–30)
  - `src/code/oracle/checks/style-object.ts` (lines 80–98)
  - `src/code/oracle/checks/variant-dialect.ts` (lines 437–448, 690–697)
  - `.agents/skills/revyme-mcp/SKILL.md`
  - `AGENTS.md`
- **Symptom:**
  - Agents reading raw files from `data/builds/` directly rather than through MCP `codeFiles.read` ended up pulling uncommitted build/export artifacts (such as WebP `srcSet` stubs) into source code.
  - Plain `<div>` tags were used with variant ternaries for paint properties (such as background colors and shadows), resulting in 0ms snaps without smooth animation on the live site.
  - Duplicate keys in JSX `style={{ ... }}` objects went undetected, causing later keys to silently override earlier ones.
  - Variants using `boxShadow: 'none'` caused Framer Motion interpolation failures.
- **Root Cause:**
  1. *Unprotected build directory in automation core:* `isSystemProtectedPath` did not include `data/` or `data/builds/`, allowing agents to accidentally read or write internal Next.js build caches directly.
  2. *Missing duplicate style property validation in Oracle:* Babel AST allows duplicate keys in object expressions; Oracle lacked a rule checking for duplicate CSS property declarations.
  3. *Unrestricted 'none' shadow in variants:* Oracle did not validate that `boxShadow` values in Framer Motion variant objects must be represented numerically (`'0 0 0 rgba(0,0,0,0)'`) rather than `'none'` to allow smooth numeric interpolation.
  4. *Gated animate check in variant dialect:* `MISSING_ANIMATE_ON_VARIANTS` was guarded by `hasConnections`, failing to flag elements with `variants={...}` that lacked `animate` when driven by props or scroll variants rather than internal connections.
- **Fix:**
  1. Added `path.startsWith('data/') || path === 'data'` to `isSystemProtectedPath` in `packages/automation-core`.
  2. Implemented `DUPLICATE_STYLE_PROPERTY` in `src/code/oracle/checks/style-object.ts` to block duplicate keys in JSX style objects.
  3. Implemented `BOX_SHADOW_INTERPOLATION` in `src/code/oracle/checks/variant-dialect.ts` to block `boxShadow: 'none'` in variant objects.
  4. Removed the `&& hasConnections` constraint from `MISSING_ANIMATE_ON_VARIANTS` so any element with `variants={...}` is required to have `animate`.
  5. Updated `AGENTS.md` and `.agents/skills/revyme-mcp/SKILL.md` with explicit rules forbidding direct `data/builds/` reads and enforcing `motion.*` tags with motion variants for visual paint properties.
- **Verification & Testing:**
  - Added unit tests in `src/code/oracle/checks/duplicate-style-box-shadow.test.ts` (4/4 tests passing).
  - Verified `packages/automation-core/test/capabilities/T20-code.test.ts` (39/39 tests passing).
  - Verified `src/code/oracle/checks/*.test.ts` (54/54 tests passing).
  - Full TypeScript typecheck `npx tsc --noEmit` passed with 0 errors.












