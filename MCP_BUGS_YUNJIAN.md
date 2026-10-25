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
- **Git Commit:** (Pending commit)


