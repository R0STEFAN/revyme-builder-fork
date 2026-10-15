# Comprehensive Living Hybrid SSG, Dynamic SEO Expressions & Instant Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify and execute the 4 core architecture initiatives into a single harmonious, production-grade system without conflicts or duplication:
1. **Dynamic Page SEO Expressions** (Formula authoring with `[fx]` buttons and `ExpressionBoundPill` across all 9 SEO fields).
2. **Living Hybrid SSG & On-Demand Revalidation** (`generateStaticParams`, `dynamicParams = true`, `/api/revalidate`, and Component SWR/Live API adaptation).
3. **Dynamic CMS Image Optimization & Responsive `srcSet`** (Centralized Directus/Cloudflare CDN transforms and auto `sizes` inference).
4. **Instant Route Latency Hiding & Prefetching** (Overlay unmounted link scanning on reveal, universal `prefetch={true}`, and intent hover).

**Architecture:** A coordinated 5-layer pipeline spanning Data Models (`types.ts`, `_meta/cms-api-config.json`), Server Wrapper Codegen (`cms-seo.ts`), Overlay Runtime Hooks (`overlay-gen.ts`), Site Export Transformations (`source-export.ts`), and Visual Editor UI (`PagesSeoSection.tsx`, `ApiResourceModal.tsx`, `ExpressionEditorPopup.tsx`).

**Tech Stack:** Next.js 15 Server Components & App Router, React 18/19, TypeScript, Babel AST (`@babel/parser`, `@babel/traverse`, `@babel/generator`), Jotai, Vitest.

**Spec References:**
- `docs/PAGE_PREFETCH_ARCHITECTURE_PLAN.md`
- `docs/hybrid-ssg-living-site-architecture.md`
- `docs/CMS_DYNAMIC_IMAGE_OPTIMIZATION_PLAN.md`
- `docs/PAGE_SEO_EXPRESSIONS_PLAN.md`

---

## Global Constraints & Cross-Plan Invariants

1. **Server Wrapper Rule:** Server component wrappers (`app/**/page.tsx`) must never export both `metadata` and `generateMetadata`. When dynamic SEO or CMS items are present, use `generateMetadata` exclusively.
2. **SSG Fallback Rule:** Always emit `export const dynamicParams = true;` alongside `generateStaticParams()` to ensure unprerendered dynamic routes render on-demand rather than returning 404s.
3. **AST Pass Sequencing in `source-export.ts`:** In `prepareSiteFiles()`, code modifications must run in a deterministic sequence to prevent AST clobbering:
   - *Pass 1:* CMS and Local Image `srcSet` & `sizes` injection.
   - *Pass 2:* Internal Link `prefetch={true}` injection.
   - *Pass 3:* Component Collection Data transform (Dynamic live query vs. Hybrid SWR).
   - *Pass 4:* Synthetic file emission (`/api/revalidate`, `/api/cms/query`, `lib/image-utils.ts`).
4. **Sandboxed Editor Safety:** All client prefetch calls (`router.prefetch()`) and live query endpoints must be safely handled by `next-shims.tsx` and preview sandboxes to guarantee 0 canvas crashes.
5. **No Regressions:** Vitest test suites must pass at every task boundary (`npx vitest run`).

---

## Conflict Elimination & Harmony Matrix

| Subsystem / File | Original Plans Touching This | Resolution & Tandem Architecture |
|---|---|---|
| `src/code/project/cms-seo.ts` | Hybrid SSG & SEO Expressions | Single unified server wrapper template in `buildCmsDetailServerWrapper` emitting: `seoDefaults`, `seoBindings`, `seoExpressions`, safe `evalExpr()` in `generateMetadata`, `generateStaticParams()`, and `dynamicParams = true`. |
| `src/code/project/source-export.ts` | Prefetch, Hybrid SSG, Dynamic Images | Unified `prepareSiteFiles()` with cleanly separated transformation phases: image optimization, link prefetching, SWR/Dynamic component rewriting, and synthetic route generation. |
| `src/shared/image-utils.ts` | Dynamic Images & SEO Expressions | `getCmsImageSrcSet()` handles Directus asset URLs and expression-resolved URLs with auto-calculated responsive widths and formats. |
| `src/editor/ui/ExpressionEditorPopup.tsx` | SEO Expressions & Hybrid SSG | Accepts `filePath` prop so route params (`params.category`, `params.place`, `params.slug`) accurately populate tokens and preview context for any selected route. |

---

## Task Decomposition

### Task 1: Data Models & Centralized Image Optimization Types

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/image-utils.ts`
- Modify: `src/shared/image-export-constants.ts`
- Test: `src/shared/__tests__/image-utils.test.ts` (or create if needed)

**Interfaces:**
- Produces:
  - `CmsImageOptimizationConfig` and `CmsImageTransformEngine` types in `src/shared/types.ts`.
  - `getCmsImageSrcSet(src: string | undefined, config?: CmsImageOptimizationConfig): string | undefined`.
  - Updated `IMAGE_UTILS_TS` export constant bundling `getCmsImageSrcSet`.

- [ ] **Step 1: Write failing tests for `getCmsImageSrcSet`**

Create/update `src/shared/__tests__/image-utils.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { getCmsImageSrcSet } from '../image-utils';
import type { CmsImageOptimizationConfig } from '../types';

describe('getCmsImageSrcSet', () => {
  const directusConfig: CmsImageOptimizationConfig = {
    enabled: true,
    engine: 'directus',
    quality: 80,
    format: 'webp',
    widths: [320, 640, 1024],
  };

  it('transforms Directus asset URL into responsive srcSet with query parameters', () => {
    const src = 'https://api.example.com/assets/abc-123';
    const srcSet = getCmsImageSrcSet(src, directusConfig);
    expect(srcSet).toBe(
      'https://api.example.com/assets/abc-123?width=320&quality=80&format=webp 320w, ' +
      'https://api.example.com/assets/abc-123?width=640&quality=80&format=webp 640w, ' +
      'https://api.example.com/assets/abc-123?width=1024&quality=80&format=webp 1024w'
    );
  });

  it('returns undefined if optimization is disabled or src is empty', () => {
    expect(getCmsImageSrcSet('https://api.example.com/assets/abc-123', { ...directusConfig, enabled: false })).toBeUndefined();
    expect(getCmsImageSrcSet('', directusConfig)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run src/shared/__tests__/image-utils.test.ts`
Expected: FAIL (`getCmsImageSrcSet is not defined`).

- [ ] **Step 3: Implement data models and transformation helper**

1. In `src/shared/types.ts`:
```ts
export type CmsImageTransformEngine = 'directus' | 'cloudflare' | 'custom';

export interface CmsImageOptimizationConfig {
  enabled: boolean;
  engine: CmsImageTransformEngine;
  quality?: number;
  format?: 'webp' | 'avif' | 'auto';
  widths?: number[];
  cloudflareZoneUrl?: string;
  customPattern?: string;
}

// In ApiCollectionConfig, add:
export interface ApiCollectionConfig {
  // ... existing fields ...
  imageOptimization?: CmsImageOptimizationConfig;
}
```

2. In `src/shared/image-utils.ts`:
```ts
export const DEFAULT_CMS_IMAGE_WIDTHS = [320, 640, 768, 1024, 1280];

export function getCmsImageSrcSet(
  src: string | undefined | null,
  config?: CmsImageOptimizationConfig
): string | undefined {
  if (!src || typeof src !== 'string' || !config || !config.enabled) return undefined;
  const widths = config.widths && config.widths.length > 0 ? config.widths : DEFAULT_CMS_IMAGE_WIDTHS;
  const quality = config.quality ?? 82;
  const format = config.format ?? 'webp';
  const cleanUrl = src.split('?')[0].split('#')[0];

  switch (config.engine) {
    case 'directus': {
      return widths
        .map((w) => `${cleanUrl}?width=${w}&quality=${quality}&format=${format} ${w}w`)
        .join(', ');
    }
    case 'cloudflare': {
      const zone = (config.cloudflareZoneUrl || '').replace(/\/$/, '');
      const prefix = `${zone}/cdn-cgi/image/width=`;
      return widths
        .map((w) => `${prefix}${w},quality=${quality},format=${format === 'auto' ? 'auto' : format}/${src} ${w}w`)
        .join(', ');
    }
    case 'custom': {
      if (!config.customPattern) return undefined;
      return widths
        .map((w) => {
          const transformed = config.customPattern!
            .replace('{url}', cleanUrl)
            .replace('{w}', String(w))
            .replace('{q}', String(quality))
            .replace('{format}', format);
          return `${transformed} ${w}w`;
        })
        .join(', ');
    }
    default:
      return undefined;
  }
}
```

3. Update `IMAGE_UTILS_TS` in `src/shared/image-export-constants.ts` to include `getCmsImageSrcSet`.

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run src/shared/__tests__/image-utils.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/shared/image-utils.ts src/shared/image-export-constants.ts src/shared/__tests__/image-utils.test.ts
git commit -m "feat(cms): add CmsImageOptimizationConfig and getCmsImageSrcSet helper"
```

---

### Task 2: Unified Server Wrapper with SEO Expressions & Universal SSG

**Files:**
- Modify: `src/code/project/cms-seo.ts`
- Modify: `src/code/project/cms-seo.test.ts`

**Interfaces:**
- Consumes:
  - `CmsSeoBindings`, `CmsSeoExpressions`, `discoverDynamicRouteParams`
- Produces:
  - `parseCmsSeoExpressions(serverCode: string): CmsSeoExpressions`
  - Unified `buildCmsDetailServerWrapper(input: BuildDetailWrapperInput): string` emitting `seoExpressions`, safe `evalExpr()` sandbox in `generateMetadata()`, `generateStaticParams()`, and `dynamicParams = true`.

- [ ] **Step 1: Write failing tests in `src/code/project/cms-seo.test.ts`**

Add tests covering expression parsing, runtime evaluation with route parameters, canonical evaluation, and static param emission:
```ts
import { parseCmsSeoExpressions, buildCmsDetailServerWrapper } from './cms-seo';

describe('Unified buildCmsDetailServerWrapper with expressions and SSG', () => {
  const src = buildCmsDetailServerWrapper({
    collection: 'articles',
    defaults: { title: 'Default Title', canonical: 'https://example.com/blog' },
    bindings: { description: 'excerpt' },
    expressions: {
      title: '`${item.name} | Revyme Store`',
      canonical: '`https://example.com/blog/${item._slug}`',
      ogImage: 'item.cover',
    },
    includeStaticParams: true,
  });

  it('parses seoExpressions correctly', () => {
    const parsed = parseCmsSeoExpressions(src);
    expect(parsed.title).toBe('`${item.name} | Revyme Store`');
    expect(parsed.canonical).toBe('`https://example.com/blog/${item._slug}`');
    expect(parsed.ogImage).toBe('item.cover');
  });

  it('evaluates expression formulas in generateMetadata at runtime', async () => {
    const meta = await runGenerateMetadata(src, ITEMS, 'first');
    expect(meta.title).toBe('First Post | Revyme Store');
    expect(meta.description).toBe('About the first');
    expect(meta.alternates.canonical).toBe('https://example.com/blog/first');
    expect(meta.openGraph.images).toEqual(['https://cdn/a.png']);
  });

  it('emits dynamicParams = true and generateStaticParams', () => {
    expect(src).toContain('export const dynamicParams = true;');
    expect(src).toContain('export async function generateStaticParams()');
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run src/code/project/cms-seo.test.ts`
Expected: FAIL (`parseCmsSeoExpressions is not a function`).

- [ ] **Step 3: Implement `CmsSeoExpressions` and unified wrapper codegen in `cms-seo.ts`**

1. Define parser and types:
```ts
export type CmsSeoExpressions = Partial<Record<string, string>>;

export function parseCmsSeoExpressions(serverCode: string): CmsSeoExpressions {
  const raw = parseLocalObjectFromCode(serverCode, 'seoExpressions');
  const out: CmsSeoExpressions = {};
  const validKeys = [
    'title', 'description', 'canonical',
    'ogTitle', 'ogDescription', 'ogImage',
    'twitterTitle', 'twitterDescription', 'twitterImage',
  ];
  for (const key of validKeys) {
    const v = raw[key];
    if (typeof v === 'string' && v) out[key] = v;
  }
  return out;
}
```

2. Update `BuildDetailWrapperInput` to include `expressions?: CmsSeoExpressions`.
3. In `buildCmsDetailServerWrapper`:
   - Serialize `const seoExpressions = ${expressionsLiteral};`.
   - In `generateMetadata`:
     - Inject `evalExpr`:
       ```ts
       const evalExpr = (expr: string) => {
         try {
           const unwrapped = expr.startsWith('{') && expr.endsWith('}') ? expr.slice(1, -1).trim() : expr;
           const fn = new Function('item', 'params', `return (${unwrapped});`);
           const val = fn(item, { slug, ...params });
           if (val === undefined || val === null) return undefined;
           if (typeof val === 'object') {
             return val.url || (val.id ? `/assets/${val.id}` : undefined) || val.filename_disk || undefined;
           }
           return String(val);
         } catch {
           return undefined;
         }
       };
       ```
     - Prioritize expressions in `bound(slot)`:
       ```ts
       const bound = (slot: string) => {
         const expr = (seoExpressions as Record<string, string>)[slot];
         if (expr) {
           const v = evalExpr(expr);
           if (v !== undefined && v !== '') return v;
         }
         const field = (seoBindings as Record<string, string>)[slot];
         if (!field || !item) return undefined;
         const value = field.includes('.')
           ? field.split('.').reduce((acc: any, part: string) => acc?.[part], item)
           : item[field];
         if (typeof value === 'object' && value !== null) {
           return value.url || (value.id ? `/assets/${value.id}` : undefined) || value.filename_disk || undefined;
         }
         return typeof value === 'string' && value ? value : undefined;
       };
       ```
     - Route `canonical` dynamically:
       ```ts
       const canonical = pick('canonical');
       // ...
       alternates: { canonical: canonical || (seoDefaults as any).canonical || undefined },
       ```
   - Ensure `export const dynamicParams = true;` is present in both API and Local templates.

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run src/code/project/cms-seo.test.ts src/code/project/cms-seo.api.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/code/project/cms-seo.ts src/code/project/cms-seo.test.ts
git commit -m "feat(cms-seo): unify SEO expressions and dynamic route SSG generation"
```

---

### Task 3: Editor UI: `[fx]` Formula Button & Pill across All SEO Fields

**Files:**
- Modify: `src/editor/ui/ExpressionEditorPopup.tsx`
- Modify: `src/cloud/settings/PagesSeoSection.tsx`

**Interfaces:**
- Consumes:
  - `ExpressionEditorPopup` (with new `filePath` prop)
  - `ExpressionBoundPill`
  - `parseCmsSeoExpressions`
- Produces:
  - Formula authoring UI (`[fx]` button + `ExpressionBoundPill`) across all 9 SEO settings fields in `PagesSeoSection.tsx`.

- [ ] **Step 1: Add `filePath` prop to `ExpressionEditorPopup.tsx`**

In `src/editor/ui/ExpressionEditorPopup.tsx`:
Add `filePath?: string;` to `ExpressionEditorPopupProps` and update `routeParams`:
```tsx
const effectiveFilePath = filePath || activeFilePath;
const routeParams = useMemo(() => {
  if (!effectiveFilePath) return [];
  const matches = Array.from(effectiveFilePath.matchAll(/\[([^/\]]+)\]/g));
  const params = matches.map(m => m[1]).filter(p => !p.startsWith('...'));
  return Array.from(new Set(params));
}, [effectiveFilePath]);
```

- [ ] **Step 2: Add expressions state and `[fx]` controls in `PagesSeoSection.tsx`**

In `src/cloud/settings/PagesSeoSection.tsx`:
1. Import `ExpressionBoundPill`, `ExpressionEditorPopup`, `parseCmsSeoExpressions`, `type CmsSeoExpressions`.
2. In `PageSeoForm`:
   - Initialize `expressions` state from `parseCmsSeoExpressions(projectFS.readFile(metadataPath) ?? '')`.
   - Update `dirty` check to include `expressions`.
   - Update `writeMeta` to pass `nextExpressions` to `buildCmsDetailServerWrapper`.
   - Add `updateExpression(slot, expr)`.
   - Add `activeExprSlot` state for `ExpressionEditorPopup`.
3. Create inline `renderFieldWithFx` helper wrapping inputs with `[fx]` button when unbound and rendering `ExpressionBoundPill` when bound.
4. Wrap all 9 SEO rows:
   - Primary: `title` (`text`), `description` (`text`), `canonical` (`href`).
   - Open Graph: `ogTitle` (`text`), `ogDescription` (`text`), `ogImage` (`src`).
   - Twitter: `twitterTitle` (`text`), `twitterDescription` (`text`), `twitterImage` (`src`).
5. Mount `ExpressionEditorPopup` with `filePath={page.filePath}` and `fields={cms?.schema?.fields ?? []}`.

- [ ] **Step 3: Verify TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/editor/ui/ExpressionEditorPopup.tsx src/cloud/settings/PagesSeoSection.tsx
git commit -m "feat(editor): add fx button and ExpressionBoundPill to all SEO fields in PagesSeoSection"
```

---

### Task 4: Centralized Image Optimization UI in `ApiResourceModal.tsx`

**Files:**
- Modify: `src/editor/left-toolbar/panels/cms/ApiResourceModal.tsx`

**Interfaces:**
- Consumes:
  - `CmsImageOptimizationConfig` from `@/shared/types`
- Produces:
  - Configuration accordion in Directus/API CMS resource editor saving into `_meta/cms-api-config.json`.

- [ ] **Step 1: Add Image Optimization form state in `ApiResourceModal.tsx`**

In `src/editor/left-toolbar/panels/cms/ApiResourceModal.tsx`:
1. Initialize states:
   - `imgOptEnabled`: boolean
   - `imgOptEngine`: `'directus' | 'cloudflare' | 'custom'`
   - `imgOptFormat`: `'webp' | 'avif' | 'auto'`
   - `imgOptQuality`: number (default: 82)
   - `cloudflareZoneUrl`: string
   - `customPattern`: string
2. Populate state from `initialConfig?.imageOptimization`.
3. Package `imageOptimization` into `saveApiCollection()`.

- [ ] **Step 2: Render Image Optimization Accordion**

Render the controls with toggle checkbox, engine dropdown, format selector, and quality input under an "Image Optimization & CDN" section.

- [ ] **Step 3: Verify build & TypeScript**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/editor/left-toolbar/panels/cms/ApiResourceModal.tsx
git commit -m "feat(cms-ui): add image optimization CDN settings to ApiResourceModal"
```

---

### Task 5: Overlay Link Scanning & Intent-Based Prefetching (`overlay-gen.ts`)

**Files:**
- Modify: `src/code/generation/overlay-gen.ts`
- Modify: `src/preview-sandbox/next-shims.tsx`
- Test: `src/code/generation/overlay-gen.test.ts` (or create if needed)

**Interfaces:**
- Produces:
  - Overlay open runtime hooks scanning `a[href^="/"]` and invoking `router.prefetch(href)` immediately upon overlay reveal.
  - Safe `prefetch` stub in canvas `next-shims.tsx`.

- [ ] **Step 1: Write test for overlay prefetch injection**

In `src/code/generation/overlay-gen.test.ts`:
```ts
it('injects router.prefetch on opened overlay links', () => {
  const code = buildFixedOverlayRuntimeEffect('overlayId', 'isOpen');
  expect(code).toContain('router.prefetch');
  expect(code).toContain('overlay.querySelectorAll(\'a[href^="/"]\')');
});
```

- [ ] **Step 2: Implement overlay prefetching in `overlay-gen.ts`**

In `src/code/generation/overlay-gen.ts`:
1. In `buildFixedOverlayRuntimeEffect` and `buildRelativeOverlayPosEffect`:
   Inside the `if (!${varName}) return;` (open) branch, inject:
   ```ts
   const links = overlay.querySelectorAll('a[href^="/"]');
   links.forEach((link) => {
     const href = link.getAttribute('href');
     if (href && !href.startsWith('//') && !href.startsWith('#') && !href.includes(':')) {
       try { router.prefetch(href); } catch {}
     }
   });
   ```
2. Ensure `useRouter` import (`import { useRouter } from 'next/navigation';`) and `const router = useRouter();` are injected into component files containing overlay effects.

- [ ] **Step 3: Ensure `next-shims.tsx` has safe `prefetch` stub**

Verify `src/preview-sandbox/next-shims.tsx` defines `prefetch: () => {}` on `useRouter()` so canvas execution is 100% safe.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/code/generation/overlay-gen.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/code/generation/overlay-gen.ts src/preview-sandbox/next-shims.tsx
git commit -m "feat(overlay): inject immediate route prefetching for overlay links on reveal"
```

---

### Task 6: Unified Export Pipeline: Link Prefetching, Image Optimization & Revalidation

**Files:**
- Modify: `src/code/project/source-export.ts`
- Test: `src/code/project/__tests__/source-export-modes.test.ts`

**Interfaces:**
- Consumes:
  - `getCmsImageSrcSet` from `@/shared/image-utils`
  - `loadCmsProjectConfig`
- Produces:
  - Synchronous 4-pass pipeline in `prepareSiteFiles()`:
    1. Image optimization (upload and CMS asset `srcSet`).
    2. Link optimization (`prefetch={true}` on internal `<Link>` and `<MotionLink>`).
    3. Component collection data transform (Dynamic Live API query vs. Hybrid SWR).
    4. Synthetic files (`app/api/revalidate/route.ts`).

- [ ] **Step 1: Write failing tests in `source-export-modes.test.ts`**

In `src/code/project/__tests__/source-export-modes.test.ts`:
1. Verify `app/api/revalidate/route.ts` is generated when API collections exist.
2. Verify internal `<Link>` and `<MotionLink>` receive `prefetch={true}`.
3. Verify remote CMS image tags with optimization enabled receive `srcSet`.
4. Verify components in Dynamic mode replace static JSON imports with live queries.

- [ ] **Step 2: Implement passes in `source-export.ts`**

1. **Pass 1: Remote CMS image optimization in `injectResponsiveImageSrcSets`:**
   Inspect image `src` against API collection configs; if matching, attach `srcSet={getCmsImageSrcSet(src, config)}` and inferred `sizes`.
2. **Pass 2: Link prefetching:**
   Walk JSX in exported pages/components; for `<Link href="/...">` or `<MotionLink href="/...">`, ensure `prefetch={true}` attribute is added.
3. **Pass 3: Component data adaptation:**
   - In Dynamic Mode (`ssg: false`): Replace `@/cms/*.json` imports in components with `fetch('/api/cms/query?source=...')` with `cache: 'no-store'`.
   - In Hybrid SSG Mode: Inject Stale-While-Revalidate pattern (initial snapshot + background re-fetch).
4. **Pass 4: Generate `app/api/revalidate/route.ts`:**
   Generate the on-demand revalidation route handler verifying `REVALIDATION_SECRET` and triggering `revalidatePath` / `revalidateTag`.

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/code/project/__tests__/source-export-modes.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/code/project/source-export.ts src/code/project/__tests__/source-export-modes.test.ts
git commit -m "feat(export): integrate universal prefetch, CMS image optimization, and revalidate endpoint"
```

---

### Task 7: Full System Verification & End-to-End Build Test

**Files:**
- Test: All touched test suites

- [ ] **Step 1: Run comprehensive Vitest suite**

Run: `npx vitest run src/code/project/cms-seo.test.ts src/code/project/__tests__/source-export-modes.test.ts src/editor/tools/ImageTool.cms-bind.test.tsx src/shared/__tests__/image-utils.test.ts`
Expected: All tests PASS.

- [ ] **Step 2: Run global TypeScript typecheck**

Run: `npx tsc --noEmit`
Expected: Exits with code 0 (zero errors).

- [ ] **Step 3: Final verification commit**

```bash
git commit --allow-empty -m "chore(release): complete comprehensive CMS performance, living hybrid SSG, and SEO expressions plan"
```
