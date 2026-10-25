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




