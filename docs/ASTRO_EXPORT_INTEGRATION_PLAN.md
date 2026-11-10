# Technical Implementation Plan: Astro 5 Export Integration (Smart Island Decomposition)

> **Document:** Subagent Implementation Plan  
> **Target Subsystem:** `src/code/project/astro-export/`, `src/code/project/source-export.ts`, `src/editor/header/ExportDropdown.tsx`  
> **Status:** Ready for Execution  
> **Language:** English (Agent-Optimized)  

---

## 1. Executive Summary & Objective

Modern web users and enterprise e-commerce platforms increasingly migrate from monolithic React hydration (Next.js) to **Astro** for its **Islands Architecture** (0 KB JavaScript default, superior Interaction to Next Paint / INP scores, and high mobile Google rankings).

This plan outlines the architecture and implementation for an **Astro Export Target** in Revyme.
Crucially, **Revyme's internal authoring core does not change**: the visual builder, canvas iframe, Jotai state, and MCP v2 AI agents continue to operate on real Next.js/React `.tsx` code. 

When a user selects **"Export as Astro 5"**:
1. Static content (headers, text blocks, image grids, footers) is compiled into pure HTML inside `.astro` templates (sending **0 KB JS** to the client).
2. Animated elements (`motion.*`, `RevymeSplitText`) and interactive components (`useState`, forms, click interactions) are retained as React `.tsx` components and mounted as Astro islands via `client:visible` or `client:load`.
3. Page transitions seamlessly utilize Astro's native `<ClientRouter />` (`astro:transitions`), executing Revyme's pre-existing `@keyframes revyme-vt-*` CSS transitions on native browser View Transitions.
4. CMS routes translate `generateStaticParams()` into Astro's `getStaticPaths()`.

---

## 2. Invariants & Guardrails

1. **Zero Core Disruption:** Internal ProjectFS files remain `.tsx`. All Astro transformations occur ephemerally during the export packaging pipeline in `src/code/project/astro-export/`.
2. **Component Reuse:** Design components (`components/*.tsx`) remain standard React components. Astro natively consumes them using `@astrojs/react`.
3. **Island Granularity (Level 2 Decomposition):** We avoid wrapping entire pages in a single `<PageClient client:load />` island (which would defeat Astro's zero-JS advantage). The AST analyzer must decompose pages into static `.astro` markup punctuated by targeted interactive islands.
4. **View Transition Parity:** The page transitions configured in Revyme's Page Effects tool must render identically in Astro using browser-native View Transitions without a monolithic React router wrapper.

---

## 3. Architecture & Pipeline Map

```
                  ┌───────────────────────────────────────────────┐
                  │    ProjectFS (.tsx, Next.js 16 pages/comps)   │
                  └───────────────────────┬───────────────────────┘
                                          │
                         source-export.ts │ (format === 'astro')
                                          ▼
                ┌───────────────────────────────────────────────────┐
                │        src/code/project/astro-export/             │
                │                                                   │
                │  1. astro-scaffold.ts (astro.config, package.json)│
                │  2. island-classifier.ts (detects motion/state)   │
                │  3. astro-page-compiler.ts (JSX -> .astro + islands│
                │  4. astro-cms-adapter.ts (generateStaticParams -> │
                │                           getStaticPaths)         │
                └─────────────────────────┬─────────────────────────┘
                                          ▼
                ┌───────────────────────────────────────────────────┐
                │   Astro 5 Standalone Project (.zip)               │
                │   ├── astro.config.mjs                            │
                │   ├── src/pages/*.astro                           │
                │   ├── src/components/*.tsx (React islands)        │
                │   └── src/styles/page-effects.css                 │
                └───────────────────────────────────────────────────┘
```

---

## 4. Implementation Tasks

### Task 1: Astro Project Scaffold Generator

**Files:**
- Create: `src/code/project/astro-export/astro-scaffold.ts`
- Test: `src/code/project/astro-export/__tests__/astro-scaffold.test.ts`

**Specifications:**
1. Generate `astro.config.mjs`:
   ```javascript
   import { defineConfig } from 'astro/config';
   import react from '@astrojs/react';

   export default defineConfig({
     integrations: [react()],
   });
   ```
2. Generate `package.json` tailored for Astro 5:
   ```json
   {
     "name": "revyme-astro-site",
     "type": "module",
     "scripts": {
       "dev": "astro dev",
       "build": "astro build",
       "preview": "astro preview"
     },
     "dependencies": {
       "astro": "^5.0.0",
       "@astrojs/react": "^4.0.0",
       "react": "^19.0.0",
       "react-dom": "^19.0.0",
       "framer-motion": "^12.0.0",
       "@revyme/runtime": "latest",
       "lenis": "^1.3.26"
     }
   }
   ```
3. Generate root layout `src/layouts/Layout.astro` incorporating:
   - Metadata (`title`, `description`, OpenGraph tags).
   - Astro native `<ClientRouter />` for page transitions.
   - Global stylesheet imports (`atomic.css` / `globals.css`).

- [ ] **Step 1:** Write unit tests asserting scaffold file generation and valid config syntax.
- [ ] **Step 2:** Implement `astro-scaffold.ts`.
- [ ] **Step 3:** Run `npx vitest run src/code/project/astro-export/__tests__/astro-scaffold.test.ts`.

---

### Task 2: AST Island Classifier & Decomposition

**Files:**
- Create: `src/code/project/astro-export/island-classifier.ts`
- Test: `src/code/project/astro-export/__tests__/island-classifier.test.ts`

**Specifications:**
Analyze each JSX subtree to classify it as **Static HTML** or **Interactive Island**:
1. An element/branch is classified as an **Island** if:
   - Tag is `motion.<tag>` or has Framer Motion props (`whileHover`, `animate`, `variants`).
   - Tag is a runtime component (`RevymeSplitText`, `Carousel`).
   - Element contains interactive props (`onClick`, `onSubmit`, `onChange`).
   - Element uses React hooks (`useState`, `useEffect`, `useRef`).
2. An element/branch is classified as **Static** if:
   - Pure HTML tags (`div`, `section`, `h1`-`h6`, `p`, `span`, `img`, `a`).
   - Contains only static styles, static text, or static SVG icons.
3. If a component contains mixed nodes, the classifier hoists only the interactive sub-branch into a dedicated island in `src/components/islands/` or wraps it with `<Component client:visible />`.

- [ ] **Step 1:** Write tests classifying sample JSX snippets (static hero vs animated Bento card vs interactive form).
- [ ] **Step 2:** Implement `island-classifier.ts` with `@babel/traverse`.
- [ ] **Step 3:** Run `npx vitest run src/code/project/astro-export/__tests__/island-classifier.test.ts`.

---

### Task 3: Page Compiler (`page.tsx` -> `index.astro`)

**Files:**
- Create: `src/code/project/astro-export/astro-page-compiler.ts`
- Test: `src/code/project/astro-export/__tests__/astro-page-compiler.test.ts`

**Specifications:**
Convert Next.js `app/**/page.tsx` and `page.client.tsx` into Astro pages:
1. Extract frontmatter (`---` block):
   - Import `Layout` from `../layouts/Layout.astro`.
   - Import necessary React island components from `../components/`.
   - Hoist page-level data fetching.
2. Template Body:
   - Render static JSX trees directly as HTML.
   - Mount interactive React islands with appropriate directives:
     - Hero / Above-the-fold elements: `client:load`.
     - Below-the-fold animated cards & split text: `client:visible`.
     - Modals / Popups: `client:idle`.
3. Page Transitions:
   - Export Revyme's `page-effects.ts` and `page-effects-runtime.ts` into a unified `src/styles/page-effects.css`.
   - Wire `<ClientRouter />` so transitions fire on navigation without full page reload.

- [ ] **Step 1:** Write compiler tests testing complete page translation from `.tsx` to `.astro`.
- [ ] **Step 2:** Implement `astro-page-compiler.ts`.
- [ ] **Step 3:** Run `npx vitest run src/code/project/astro-export/__tests__/astro-page-compiler.test.ts`.

---

### Task 4: CMS Adapter (`generateStaticParams` -> `getStaticPaths`)

**Files:**
- Create: `src/code/project/astro-export/astro-cms-adapter.ts`
- Modify: `src/code/project/source-export.ts`
- Test: `src/code/project/astro-export/__tests__/astro-cms-adapter.test.ts`

**Specifications:**
1. Dynamic Route Translation:
   - Next.js: `app/articles/[slug]/page.tsx`
   - Astro: `src/pages/articles/[slug].astro`
2. Static Paths Translation:
   - Detect `export async function generateStaticParams()` in Next.js code.
   - Translate into Astro frontmatter:
     ```astro
     ---
     export async function getStaticPaths() {
       const params = await fetchArticleParams(); // extracted from generateStaticParams logic
       return params.map(p => ({ params: { slug: p.slug }, props: { ... } }));
     }
     const { slug } = Astro.params;
     const { item } = Astro.props;
     ---
     ```
3. API Mode vs Local JSON:
   - For Local CMS: inline the collection items directly into `getStaticPaths()`.
   - For Dynamic/SSR mode: emit `export const prerender = false;` in the `.astro` page.

- [ ] **Step 1:** Write CMS transformation tests for collection index and detail routes.
- [ ] **Step 2:** Implement `astro-cms-adapter.ts`.
- [ ] **Step 3:** Wire Astro export into `buildSourceExport` in `source-export.ts`.

---

### Task 5: UI Integration & End-to-End Verification

**Files:**
- Modify: `src/editor/header/ExportDropdown.tsx`
- Modify: `src/editor/header/export-project.ts`

**Specifications:**
1. Add `astro` to `ExportFormat` union in `ExportDropdown.tsx`:
   - Label: `'Astro 5 (Zero-JS Islands)'`
   - Sublabel: `'Static HTML + Framer Motion islands'`
   - Icon: Astro logo SVG.
2. In `export-project.ts`:
   - Enable `canExportFormat('astro')` for standalone mode.
   - Dispatch export download as `${projectName}-astro.zip`.

- [ ] **Step 1:** Add Astro option to `ExportDropdown.tsx`.
- [ ] **Step 2:** Run full Vitest suite across all export modules.
- [ ] **Step 3:** Verify `npx tsc --noEmit` exits with 0 errors.

---

## 5. Verification Commands

```bash
# 1. Run dedicated Astro export test suite
npx vitest run src/code/project/astro-export/

# 2. Run existing export tests to ensure zero regression
npx vitest run src/code/project/source-export.test.ts

# 3. Full project type-check
npx tsc --noEmit
```
