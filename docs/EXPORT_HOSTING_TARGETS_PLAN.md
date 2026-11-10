# Technical Implementation Plan: Export Hosting Targets (Cloudflare Pages, Docker, Vercel)

> **Document:** Subagent Implementation Plan  
> **Target Subsystem:** `src/code/project/source-export.ts`, `src/editor/header/ExportDropdown.tsx`, `src/editor/header/export-project.ts`  
> **Status:** Ready for Execution  
> **Language:** English (Agent-Optimized)  

---

## 1. Executive Summary & Objective

In standalone and local open-source Revyme, users cannot use the cloud "Publish" button to deploy directly to `revyme.app`. Instead, they rely on **Export Source** to generate a downloadable `.zip` archive. Currently, Revyme exports a generic Next.js 16 project that requires manual configuration to run on self-hosted infrastructure or Edge networks.

This plan implements **Multi-Target Export Presets** directly into Revyme's export pipeline:
1. **Cloudflare Pages (Static SSG):** Zero-config static output (`output: 'export'`) deployable instantly to Cloudflare Pages via GitHub integration with $0 hosting cost.
2. **Cloudflare Workers (Dynamic SSR via OpenNext):** Full Next.js server-side features powered by `@opennextjs/cloudflare` and `wrangler.jsonc`.
3. **Docker / Self-Hosted VPS:** Production-ready multi-stage `Dockerfile` with Next.js `output: 'standalone'`, `docker-compose.yml`, and `.dockerignore` optimized for Coolify, CapRover, Portainer, and standard VPS hosts.
4. **Standard Next.js (Vercel / Node.js):** The existing clean Next.js 16 App Router export.

When a user selects a target and downloads the `.zip`, all required configuration files, scripts, and build parameters are pre-baked into the archive. Pushing the extracted directory to GitHub triggers seamless automated builds on the chosen platform.

---

## 2. Invariants & Constraints

1. **In-Browser Generation:** All file generation and zip packaging must continue to run 100% in the browser (`source-export.ts` + `zip.ts`). No backend server dependency may be introduced.
2. **Lossless Code Preservation:** Page code (`page.tsx`, `page.client.tsx`) and component code (`components/*.tsx`) must remain identical across all targets. Targets only alter scaffold files (`next.config.mjs`, `package.json`, `Dockerfile`, `wrangler.jsonc`, `README.md`).
3. **Standalone Image Handling:** In static exports (`output: 'export'`), Next.js dynamic image optimization is disabled by default (`images: { unoptimized: true }`) unless a Cloudflare Image zone is configured.
4. **Verification Gate:** Every target generator must have dedicated Vitest tests asserting that all expected scaffold files exist and have valid syntax. `npx vitest run` and `npx tsc --noEmit` must pass with 0 errors.

---

## 3. Architecture & File Matrix

```
[UI Chrome: Header]
  ├── src/editor/header/ExportDropdown.tsx          # Target selector UI with icons & descriptions
  └── src/editor/header/export-project.ts           # Passes selected ExportTarget to pipeline

[Core Export Pipeline]
  ├── src/code/project/source-export-targets.ts     # Target definitions, Dockerfile, wrangler templates
  ├── src/code/project/source-export.ts             # Orchestrates scaffold injection based on target
  └── src/code/project/__tests__/source-export-targets.test.ts # Comprehensive test coverage
```

---

## 4. Implementation Tasks

### Task 1: Type Definitions & Scaffold Templates Module

**Files:**
- Create: `src/code/project/source-export-targets.ts`
- Test: `src/code/project/__tests__/source-export-targets.test.ts`

**Specifications:**
Define the `ExportTarget` union and template generators:

```typescript
export type ExportTarget = 
  | 'standard'             // Clean Next.js 16 (Vercel / Node.js)
  | 'cloudflare-static'    // Cloudflare Pages with output: 'export'
  | 'cloudflare-opennext'  // Cloudflare Workers with @opennextjs/cloudflare
  | 'docker';              // Standalone Dockerfile + docker-compose

export interface TargetScaffoldFiles {
  files: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}
```

**Templates to implement:**
1. **Docker Scaffold:**
   - Multi-stage `Dockerfile`:
     - Stage 1 (`deps`): installs production and dev dependencies.
     - Stage 2 (`builder`): runs `npm run build` with `output: 'standalone'`.
     - Stage 3 (`runner`): minimal `node:20-alpine` image copying `.next/standalone` (~90MB total image size).
   - `docker-compose.yml` exposing port `3000:3000` with automatic restart policy.
   - `.dockerignore` excluding `node_modules`, `.git`, `.next`.
2. **Cloudflare Static Scaffold:**
   - `next.config.mjs` modified with `output: 'export'` and `images: { unoptimized: true }`.
   - `README.md` with explicit Cloudflare Pages dashboard instructions (Build command: `npm run build`, Output directory: `out`).
3. **Cloudflare OpenNext Scaffold:**
   - `wrangler.jsonc` specifying `main: ".open-next/worker.js"` and `compatibility_flags: ["nodejs_compat"]`.
   - `open-next.config.ts`.
   - DevDependencies: `@opennextjs/cloudflare`, `wrangler`.
   - Scripts: `"build:worker": "opennextjs-cloudflare"`, `"deploy:cf": "opennextjs-cloudflare && wrangler deploy"`.

- [ ] **Step 1:** Write unit tests in `source-export-targets.test.ts` asserting file presence and key string assertions for all 4 targets.
- [ ] **Step 2:** Implement `src/code/project/source-export-targets.ts`.
- [ ] **Step 3:** Run `npx vitest run src/code/project/__tests__/source-export-targets.test.ts` to confirm passes.

---

### Task 2: Integrate Targets into `source-export.ts`

**Files:**
- Modify: `src/code/project/source-export.ts`

**Specifications:**
Extend `BuildSourceExportOptions`:

```typescript
export interface BuildSourceExportOptions {
  name?: string;
  runtimeRange?: string;
  target?: ExportTarget; // Defaults to 'standard'
  now?: Date;
  ssg?: boolean;
}
```

In `buildSourceExport`:
1. Receive `opts.target ?? 'standard'`.
2. Call `getTargetScaffoldFiles(opts.target, { name: opts.name, ssg: opts.ssg })`.
3. Merge generated files into the export file map:
   - For `docker`: ensure `next.config.mjs` includes `output: 'standalone'`.
   - For `cloudflare-static`: ensure `next.config.mjs` includes `output: 'export'`.
   - For `cloudflare-opennext`: merge OpenNext devDependencies and scripts into `package.json`.
4. Update `buildReadme()` to include target-specific deployment guides (e.g. "Deploying to Cloudflare Pages", "Running with Docker").

- [ ] **Step 1:** Add integration tests in `source-export-targets.test.ts` calling `buildSourceExport` with each target option.
- [ ] **Step 2:** Implement target merging in `src/code/project/source-export.ts`.
- [ ] **Step 3:** Verify with `npx vitest run src/code/project/__tests__/source-export-targets.test.ts`.

---

### Task 3: ExportDropdown UI & Header Integration

**Files:**
- Modify: `src/editor/header/ExportDropdown.tsx`
- Modify: `src/editor/header/export-project.ts`

**Specifications:**
1. Update `FORMATS` array in `ExportDropdown.tsx`:
   - Keep top-level formats clean or add a secondary **Hosting Target** selector:
     - Next.js (Standard / Vercel)
     - Next.js (Cloudflare Pages Static)
     - Next.js (Cloudflare OpenNext SSR)
     - Next.js (Docker VPS / Coolify)
2. Add brand icons:
   - Cloudflare logo SVG.
   - Docker logo SVG.
3. In `export-project.ts`:
   - Pass the selected target down to `exportSourceInBrowser(format, target)`.
   - Ensure `canExportFormat` allows all local hosting target variants in standalone mode.

- [ ] **Step 1:** Update UI state and dropdown items in `ExportDropdown.tsx`.
- [ ] **Step 2:** Wire the selected target through `export-project.ts` to `buildSourceExport`.
- [ ] **Step 3:** Run `npx tsc --noEmit` to verify type cleanliness across all components.

---

## 5. Verification & Test Commands

```bash
# 1. Run targeted unit tests
npx vitest run src/code/project/__tests__/source-export-targets.test.ts

# 2. Run all existing source export tests
npx vitest run src/code/project/source-export.test.ts
npx vitest run src/code/project/__tests__/source-export-modes.test.ts

# 3. Type check the entire codebase
npx tsc --noEmit
```
