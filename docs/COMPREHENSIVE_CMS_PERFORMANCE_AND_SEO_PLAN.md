# Comprehensive Living Hybrid SSG, Dynamic SEO Expressions & Instant Performance Implementation Plan (Consensus V3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify and execute the 4 core architecture initiatives into a single harmonious, production-grade system without conflicts or duplication:
1. **Dynamic Page SEO Expressions** (Formula authoring with `[fx]` buttons and `ExpressionBoundPill` across all 9 SEO fields with AST safety validation).
2. **Living Hybrid SSG & On-Demand Revalidation** (Safe bounded `generateStaticParams`, `dynamicParams = true`, `/api/revalidate`, cached `/api/cms/query` relay, and Component SWR/Live API adaptation).
3. **Dynamic CMS Image Optimization & Responsive `srcSet`** (Centralized Directus/Cloudflare CDN transforms with URL parameter preservation and signed URL immunity).
4. **Instant Route Latency Hiding & Intent-Based Prefetching** (Overlay unmounted link scanning on reveal, differentiated navigation prefetching, and debounced hover intent for CMS collections).

**Architecture:** A coordinated 5-layer pipeline spanning Data Models (`cms-api-config.ts`), Server Wrapper Codegen & AST Persistence (`cms-seo.ts`, `cms-page-ops.ts`), Overlay Runtime Hooks (`overlay-gen.ts`), Site Export Transformations (`source-export.ts`), and Visual Editor UI (`PagesSeoSection.tsx`, `ApiResourceModal.tsx`, `ExpressionEditorPopup.tsx`).

**Tech Stack:** Next.js 15 Server Components & App Router, React 18/19, TypeScript, Babel AST (`@babel/parser`, `@babel/traverse`, `@babel/generator`), Jotai, Vitest.

**Spec References:**
- `docs/PAGE_PREFETCH_ARCHITECTURE_PLAN.md`
- `docs/hybrid-ssg-living-site-architecture.md`
- `docs/CMS_DYNAMIC_IMAGE_OPTIMIZATION_PLAN.md`
- `docs/PAGE_SEO_EXPRESSIONS_PLAN.md`
- `docs/COMPREHENSIVE_CMS_PERFORMANCE_AND_SEO_PLAN_V2.md`

---

## Global Constraints & Cross-Plan Invariants

1. **Server Wrapper Rule:** Server component wrappers (`app/**/page.tsx`) must never export both `metadata` and `generateMetadata`. When dynamic SEO or CMS items are present, use `generateMetadata` exclusively.
2. **SSG Fallback & Prerender Bound Rule:**
   - Always emit `export const dynamicParams = true;` alongside `generateStaticParams()` to ensure unprerendered dynamic routes render on-demand (ISR) rather than returning 404s.
   - In `discoverDynamicRouteParams()`, prioritize concrete internal links (`knownUrls`) and enforce a hard cap on fallback Cartesian product generation (`MAX_PRERENDER_COMBINATIONS = 500`) to guarantee `next build` never crashes or hangs on large multi-segment catalogs.
3. **AST Round-Trip & Code-as-Truth Invariant:**
   - Following `AGENTS.md` (the `.tsx` file is the sole source of truth; no shadow metadata DBs), `seoExpressions` must be parsed from `serverCode` using `parseCmsSeoExpressions()` and serialized back into `buildCmsDetailServerWrapper()`.
   - `syncAffectedCmsPageWrappers` in `cms-page-ops.ts` must parse and forward existing `seoExpressions` during API config updates so user-authored SEO formulas are never wiped out.
4. **Expression Evaluation & Safety Contract:**
   - Author expressions are treated as trusted author code executing via the canonical `evaluateCmsExpression()` semantics (`(item, params) => value`).
   - A shared Babel AST validator (`validateCmsExpression()`) must gate author inputs, imports, and MCP payloads against prototype pollution and runtime escapes (blocking `.constructor`, `__proto__`, `prototype`, variable assignments, and disallowed identifiers like `process`, `require`, `window`).
5. **Image Transform URL Safety & Signature Immunity:**
   - When building CDN/Directus transforms, use `new URL(src)` / `searchParams` manipulation instead of naive string splitting, preserving legitimate query params (e.g. `access_token`).
   - If an image URL contains cryptographic signatures (`sig`, `signature`, `X-Amz-Signature`, `hmac`), bypass transformation entirely and return `undefined` to prevent `403 Forbidden` responses.
6. **Query Relay Contract & Upstream Caching:**
   - The query proxy route (`/api/cms/query`) expects payload `{ collection: '...' }` (never `source`), and must include upstream caching (`next: { revalidate: config.revalidateTtl ?? 60 }`) to prevent excessive load on external CMS APIs during rapid client queries or pagination.
7. **Differentiated Prefetch Strategy:**
   - Navigation menus, headers, and static links use standard Next.js `<Link>` behavior.
   - Large CMS collection lists and repeaters use **Intent-based Prefetch** (triggered on `onMouseEnter` or focus with 60-80ms debounce) to prevent bandwidth saturation and API slamming.
   - Overlays scan and trigger `router.prefetch()` for their internal links upon opening.
8. **Sandboxed Editor Safety:** All client prefetch calls (`router.prefetch()`) and live query endpoints must be safely handled by `next-shims.tsx` and preview sandboxes to guarantee 0 canvas crashes.
9. **No Regressions:** Vitest test suites must pass at every task boundary (`npx vitest run`).

---

## Conflict Elimination & Harmony Matrix

| Subsystem / File | Involved Areas | Resolution & Tandem Architecture |
|---|---|---|
| `src/code/project/cms-api-config.ts` | Data Models, Relay & CDN | Canonical home for `ApiCollectionConfig`. Extended with `CmsImageOptimizationConfig` and `revalidateTtl` without conflicting type declarations in `shared/types.ts`. |
| `src/code/project/cms-seo.ts` | Hybrid SSG & SEO Expressions | Emits single unified server wrapper with `seoDefaults`, `seoBindings`, `seoExpressions`, safe `evalExpr()` in `generateMetadata`, `generateStaticParams()` with Cartesian cap (500), and `dynamicParams = true`. |
| `src/code/project/cms-page-ops.ts` | Wrapper Resync & Persistence | `syncAffectedCmsPageWrappers` parses `seoExpressions` from existing server code via `parseCmsSeoExpressions` and preserves them during wrapper regeneration. |
| `src/code/project/source-export.ts` | Prefetch, Hybrid SSG, CDN Images | Deterministic 4-pass pipeline in `prepareSiteFiles()`: remote CMS image `srcSet`, intent/nav link prefetch, component data adaptation (using `{ collection }`), cached `/api/cms/query` relay, and `/api/revalidate`. |
| `src/shared/image-utils.ts` | Dynamic Images & CDN Transforms | `getCmsImageSrcSet()` safely parses URLs with `new URL()`, preserves existing query parameters (like `access_token`), and bypasses signed URLs. |
| `src/shared/cms-accessor.ts` & AST Validator | Expression Safety & Evaluation | Shared evaluation engine with Babel AST validation (`validateCmsExpression`) blocking prototype pollution (`constructor`, `__proto__`) across Canvas, UI, and Server Metadata. |
| `src/editor/ui/ExpressionEditorPopup.tsx` | SEO Expressions & Route Context | Accepts `filePath` prop so route params (`params.category`, `params.slug`) accurately populate token pills and preview context for any selected route. |

---

## Task Decomposition

### Task 1: Data Models, Safe Image Optimization & Signed URL Immunity

**Files:**
- Modify: `src/code/project/cms-api-config.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/shared/image-utils.ts`
- Modify: `src/shared/image-export-constants.ts`
- Test: `src/shared/__tests__/image-utils.test.ts`

**Interfaces:**
- Produces:
  - `CmsImageOptimizationConfig` and `CmsImageTransformEngine` types in `src/code/project/cms-api-config.ts`.
  - Re-exports in `src/shared/types.ts` for editor consumption without duplicating `ApiCollectionConfig`.
  - `isSignedImageUrl(url: string): boolean`.
  - `getCmsImageSrcSet(src: string | undefined, config?: CmsImageOptimizationConfig): string | undefined` using `new URL()` and signature immunity.
  - Updated `IMAGE_UTILS_TS` export constant bundling the updated helpers.

- [ ] **Step 1: Write failing tests for `getCmsImageSrcSet` with query params and signed URLs**

Create/update `src/shared/__tests__/image-utils.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { getCmsImageSrcSet, isSignedImageUrl } from '../image-utils';
import type { CmsImageOptimizationConfig } from '@/code/project/cms-api-config';

describe('getCmsImageSrcSet', () => {
  const directusConfig: CmsImageOptimizationConfig = {
    enabled: true,
    engine: 'directus',
    quality: 80,
    format: 'webp',
    widths: [320, 640, 1024],
  };

  it('transforms Directus asset URL into responsive srcSet while preserving existing query params', () => {
    const src = 'https://api.example.com/assets/abc-123?access_token=secret123';
    const srcSet = getCmsImageSrcSet(src, directusConfig);
    expect(srcSet).toBe(
      'https://api.example.com/assets/abc-123?access_token=secret123&width=320&quality=80&format=webp 320w, ' +
      'https://api.example.com/assets/abc-123?access_token=secret123&width=640&quality=80&format=webp 640w, ' +
      'https://api.example.com/assets/abc-123?access_token=secret123&width=1024&quality=80&format=webp 1024w'
    );
  });

  it('bypasses transformation and returns undefined for cryptographically signed URLs', () => {
    const signedS3 = 'https://s3.amazonaws.com/bucket/image.png?X-Amz-Signature=abcd1234efgh';
    const signedCloudinary = 'https://res.cloudinary.com/demo/image/upload/s--abc123--/v1/sample.jpg';
    const signedGeneric = 'https://cdn.example.com/image.jpg?sig=xyz789';

    expect(isSignedImageUrl(signedS3)).toBe(true);
    expect(isSignedImageUrl(signedCloudinary)).toBe(true);
    expect(isSignedImageUrl(signedGeneric)).toBe(true);

    expect(getCmsImageSrcSet(signedS3, directusConfig)).toBeUndefined();
    expect(getCmsImageSrcSet(signedGeneric, directusConfig)).toBeUndefined();
  });

  it('returns undefined if optimization is disabled or src is empty', () => {
    expect(getCmsImageSrcSet('https://api.example.com/assets/abc-123', { ...directusConfig, enabled: false })).toBeUndefined();
    expect(getCmsImageSrcSet('', directusConfig)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run src/shared/__tests__/image-utils.test.ts`
Expected: FAIL (`getCmsImageSrcSet is not defined` or signature detection missing).

- [ ] **Step 3: Implement data models and transformation helper**

1. In `src/code/project/cms-api-config.ts`:
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

// In ApiCollectionConfig interface, add:
export interface ApiCollectionConfig {
  // ... existing fields ...
  revalidateTtl?: number;
  imageOptimization?: CmsImageOptimizationConfig;
}
```

2. In `src/shared/types.ts`:
Re-export the image types from `cms-api-config.ts` without declaring a duplicate `ApiCollectionConfig`.

3. In `src/shared/image-utils.ts`:
```ts
export const DEFAULT_CMS_IMAGE_WIDTHS = [320, 640, 768, 1024, 1280];

const SIGNED_URL_PATTERNS = [
  /[?&](X-Amz-Signature|sig|signature|hmac)=/i,
  /\/s--[A-Za-z0-9_-]{8,}--\//, // Cloudinary signed URL pattern
];

export function isSignedImageUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  return SIGNED_URL_PATTERNS.some((pat) => pat.test(url));
}

export function getCmsImageSrcSet(
  src: string | undefined | null,
  config?: CmsImageOptimizationConfig
): string | undefined {
  if (!src || typeof src !== 'string' || !config || !config.enabled) return undefined;
  if (isSignedImageUrl(src)) return undefined; // Bypass signed URLs to prevent 403 Forbidden

  const widths = config.widths && config.widths.length > 0 ? config.widths : DEFAULT_CMS_IMAGE_WIDTHS;
  const quality = config.quality ?? 82;
  const format = config.format ?? 'webp';

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(src);
  } catch {
    return undefined;
  }

  switch (config.engine) {
    case 'directus': {
      return widths
        .map((w) => {
          const u = new URL(parsedUrl.toString());
          u.searchParams.set('width', String(w));
          u.searchParams.set('quality', String(quality));
          u.searchParams.set('format', format);
          return `${u.toString()} ${w}w`;
        })
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
            .replace('{url}', src)
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

4. Update `IMAGE_UTILS_TS` in `src/shared/image-export-constants.ts` to include `isSignedImageUrl` and `getCmsImageSrcSet`.

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run src/shared/__tests__/image-utils.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/code/project/cms-api-config.ts src/shared/types.ts src/shared/image-utils.ts src/shared/image-export-constants.ts src/shared/__tests__/image-utils.test.ts
git commit -m "feat(cms): add safe CMS image optimization with query preservation and signature immunity"
```

---

### Task 2: Expression AST Safety, Wrapper Codegen & Cartesian SSG Bounds

**Files:**
- Create: `src/shared/cms-expression-validator.ts`
- Modify: `src/code/project/cms-seo.ts`
- Modify: `src/code/project/cms-page-ops.ts`
- Modify: `src/code/project/cms-seo.test.ts`
- Create: `src/shared/__tests__/cms-expression-validator.test.ts`

**Interfaces:**
- Produces:
  - `validateCmsExpression(expr: string): { valid: boolean; error?: string }` using Babel AST to block prototype pollution (`constructor`, `__proto__`, `prototype`, assignment, forbidden identifiers).
  - `parseCmsSeoExpressions(serverCode: string): CmsSeoExpressions`.
  - Unified `buildCmsDetailServerWrapper(input: BuildDetailWrapperInput): string` emitting `seoExpressions`, safe `evalExpr()` in `generateMetadata()`, `generateStaticParams()`, and `dynamicParams = true`.
  - Bounded `discoverDynamicRouteParams()` capping Cartesian products at `MAX_PRERENDER_COMBINATIONS = 500`.
  - Updated `syncAffectedCmsPageWrappers` in `cms-page-ops.ts` preserving `seoExpressions`.

- [ ] **Step 1: Write tests for AST validator and Cartesian SSG bounds**

1. Create `src/shared/__tests__/cms-expression-validator.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { validateCmsExpression } from '../cms-expression-validator';

describe('validateCmsExpression', () => {
  it('allows valid member access, string interpolation and expressions', () => {
    expect(validateCmsExpression('item.title').valid).toBe(true);
    expect(validateCmsExpression('`${item.title.toUpperCase()} | Store`').valid).toBe(true);
    expect(validateCmsExpression('item.price ? "$" + item.price : "Free"').valid).toBe(true);
  });

  it('rejects prototype pollution and sandbox escape attempts', () => {
    expect(validateCmsExpression("item.constructor.constructor('return 6 * 7')()").valid).toBe(false);
    expect(validateCmsExpression('item.__proto__.polluted = true').valid).toBe(false);
    expect(validateCmsExpression('Object.prototype.evil = true').valid).toBe(false);
  });

  it('rejects forbidden globals and assignments', () => {
    expect(validateCmsExpression('process.exit(1)').valid).toBe(false);
    expect(validateCmsExpression('require("fs")').valid).toBe(false);
    expect(validateCmsExpression('window.location = "http://evil.com"').valid).toBe(false);
    expect(validateCmsExpression('item.title = "hacked"').valid).toBe(false);
  });
});
```

2. Add Cartesian bound test in `src/code/project/cms-seo.test.ts`:
```ts
it('caps multi-segment route Cartesian product combinations to MAX_PRERENDER_COMBINATIONS', () => {
  const allFiles: Record<string, string> = {
    'cms/categories.json': JSON.stringify(Array.from({ length: 100 }, (_, i) => ({ slug: `cat-${i}` }))),
    'cms/products.json': JSON.stringify(Array.from({ length: 1000 }, (_, i) => ({ slug: `prod-${i}` }))),
  };
  const discovered = discoverDynamicRouteParams('app/[category]/[product]/page.tsx', allFiles);
  expect(discovered).not.toBeNull();
  expect(discovered!.results.length).toBeLessThanOrEqual(500);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run src/shared/__tests__/cms-expression-validator.test.ts`
Expected: FAIL (`validateCmsExpression is not defined`).

- [ ] **Step 3: Implement AST validator, Cartesian cap, and wrapper persistence**

1. Create `src/shared/cms-expression-validator.ts`:
```ts
import { parseExpression } from '@babel/parser';

const DISALLOWED_IDENTIFIERS = new Set([
  'process', 'require', 'global', 'globalThis', 'window', 'document',
  'Function', 'eval', 'import',
]);

const DISALLOWED_PROPERTIES = new Set([
  'constructor', '__proto__', 'prototype',
]);

export function validateCmsExpression(expr: string): { valid: boolean; error?: string } {
  if (!expr || !expr.trim()) return { valid: true };
  const clean = expr.trim().replace(/^\{|\}$/g, '').trim();

  try {
    const ast = parseExpression(clean, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
    });

    let hasViolation = false;
    let violationMsg = '';

    function walk(node: any) {
      if (!node || typeof node !== 'object' || hasViolation) return;

      // Disallow assignments & mutations
      if (node.type === 'AssignmentExpression' || node.type === 'UpdateExpression') {
        hasViolation = true;
        violationMsg = 'Mutations and assignments are not allowed in expressions.';
        return;
      }

      // Check member access: forbid .constructor, .__proto__, .prototype
      if (node.type === 'MemberExpression') {
        const prop = node.property;
        if (!node.computed && prop.type === 'Identifier' && DISALLOWED_PROPERTIES.has(prop.name)) {
          hasViolation = true;
          violationMsg = `Access to "${prop.name}" is forbidden.`;
          return;
        }
        if (node.computed && prop.type === 'StringLiteral' && DISALLOWED_PROPERTIES.has(prop.value)) {
          hasViolation = true;
          violationMsg = `Access to "${prop.value}" is forbidden.`;
          return;
        }
      }

      // Check identifiers: forbid process, require, window, etc.
      if (node.type === 'Identifier' && DISALLOWED_IDENTIFIERS.has(node.name)) {
        hasViolation = true;
        violationMsg = `Access to global identifier "${node.name}" is forbidden.`;
        return;
      }

      for (const key of Object.keys(node)) {
        if (key === 'loc' || key === 'range') continue;
        const val = node[key];
        if (Array.isArray(val)) {
          for (const child of val) walk(child);
        } else if (val && typeof val === 'object') {
          walk(val);
        }
      }
    }

    walk(ast);

    if (hasViolation) return { valid: false, error: violationMsg };
    return { valid: true };
  } catch (err: any) {
    return { valid: false, error: err?.message || 'Invalid JavaScript expression syntax' };
  }
}
```

2. In `src/code/project/cms-seo.ts`:
   - Cap Cartesian product in `discoverDynamicRouteParams`:
     ```ts
     export const MAX_PRERENDER_COMBINATIONS = 500;

     // In Cartesian function:
     if (paramNames.length > 1) {
       function cartesian(index: number, current: Record<string, string>) {
         if (results.length >= MAX_PRERENDER_COMBINATIONS) return;
         if (index === paramNames.length) {
           addCombination({ ...current });
           return;
         }
         const p = paramNames[index];
         const values = Array.from(foundByParam.get(p) || []);
         for (const v of values) {
           if (results.length >= MAX_PRERENDER_COMBINATIONS) break;
           current[p] = v;
           cartesian(index + 1, current);
         }
       }
       cartesian(0, {});
     }
     ```
   - Implement `parseCmsSeoExpressions`:
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
   - In `buildCmsDetailServerWrapper`: serialize `seoExpressions` and evaluate safely with `evalExpr()` in `generateMetadata()`.

3. In `src/code/project/cms-page-ops.ts:1254` (`syncAffectedCmsPageWrappers`):
   ```ts
   const defaults = parseCmsSeoDefaults(serverCode);
   const bindings = parseCmsSeoBindings(serverCode);
   const expressions = parseCmsSeoExpressions(serverCode); // PRESERVE EXPRESSIONS
   const includeStaticParams = hasGenerateStaticParams(serverCode)
     ? true
     : serverCode.includes('dynamicParams')
       ? false
       : undefined;

   let newServerCode = buildCmsDetailServerWrapper({
     collection: collectionSlug,
     defaults,
     bindings,
     expressions,
     includeStaticParams,
     apiConfig,
   });
   ```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run src/shared/__tests__/cms-expression-validator.test.ts src/code/project/cms-seo.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/cms-expression-validator.ts src/shared/__tests__/cms-expression-validator.test.ts src/code/project/cms-seo.ts src/code/project/cms-page-ops.ts src/code/project/cms-seo.test.ts
git commit -m "feat(cms-seo): add AST expression validator, bounded Cartesian SSG, and wrapper round-trip persistence"
```

---

### Task 3: Editor UI: `[fx]` Formula Authoring & AST Validation in `PagesSeoSection.tsx`

**Files:**
- Modify: `src/editor/ui/ExpressionEditorPopup.tsx`
- Modify: `src/cloud/settings/PagesSeoSection.tsx`

**Interfaces:**
- Consumes:
  - `ExpressionEditorPopup` (with `filePath` prop)
  - `ExpressionBoundPill`
  - `parseCmsSeoExpressions`
  - `validateCmsExpression`
- Produces:
  - Formula authoring UI (`[fx]` button + `ExpressionBoundPill`) with real-time AST lint feedback across all 9 SEO settings fields in `PagesSeoSection.tsx`.

- [ ] **Step 1: Add `filePath` prop to `ExpressionEditorPopup.tsx`**

In `src/editor/ui/ExpressionEditorPopup.tsx`:
Add `filePath?: string;` to `ExpressionEditorPopupProps` and resolve `routeParams` from `filePath || activeFilePath`.

- [ ] **Step 2: Add expressions state, AST validation, and `[fx]` controls in `PagesSeoSection.tsx`**

In `src/cloud/settings/PagesSeoSection.tsx`:
1. Import `ExpressionBoundPill`, `ExpressionEditorPopup`, `parseCmsSeoExpressions`, `type CmsSeoExpressions`, and `validateCmsExpression`.
2. In `PageSeoForm`:
   - Initialize `expressions` state from `parseCmsSeoExpressions(projectFS.readFile(metadataPath) ?? '')`.
   - Update `dirty` check to include `expressions`.
   - In `updateExpression(slot, expr)`: validate with `validateCmsExpression(expr)`; if invalid, display feedback toast/tooltip.
   - Pass `nextExpressions` to `buildCmsDetailServerWrapper`.
   - Wrap all 9 SEO rows (`title`, `description`, `canonical`, `ogTitle`, `ogDescription`, `ogImage`, `twitterTitle`, `twitterDescription`, `twitterImage`) with `renderFieldWithFx`.
3. Mount `ExpressionEditorPopup` with `filePath={page.filePath}` and `fields={cms?.schema?.fields ?? []}`.

- [ ] **Step 3: Verify TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/editor/ui/ExpressionEditorPopup.tsx src/cloud/settings/PagesSeoSection.tsx
git commit -m "feat(editor): add validated fx expression authoring across all SEO fields in PagesSeoSection"
```

---

### Task 4: Image Optimization UI in `ApiResourceModal.tsx`

**Files:**
- Modify: `src/editor/left-toolbar/panels/cms/ApiResourceModal.tsx`

**Interfaces:**
- Consumes:
  - `CmsImageOptimizationConfig` and `ApiCollectionConfig` from `@/code/project/cms-api-config`
- Produces:
  - Configuration accordion in Directus/API CMS resource editor saving into `_meta/cms-api-config.json`.

- [ ] **Step 1: Add Image Optimization form state in `ApiResourceModal.tsx`**

Populate form state from `initialConfig?.imageOptimization` (engine: Directus / Cloudflare / Custom, format, quality, zone URL).
Ensure import of `ApiCollectionConfig` and `CmsImageOptimizationConfig` originates from `src/code/project/cms-api-config.ts`.

- [ ] **Step 2: Render Image Optimization Accordion & Save Handler**

Render controls under an "Image Optimization & CDN" section and package into `saveApiCollection()`.

- [ ] **Step 3: Verify TypeScript compilation**

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
- Test: `src/code/generation/overlay-gen.test.ts`

**Interfaces:**
- Produces:
  - Overlay reveal runtime hooks scanning internal links and calling `router.prefetch(href)` upon reveal.
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
Inside the reveal effect, query `overlay.querySelectorAll('a[href^="/"]')` and invoke `router.prefetch(href)`. Inject `useRouter` import where needed.

- [ ] **Step 3: Ensure `next-shims.tsx` has safe `prefetch` stub**

Verify `src/preview-sandbox/next-shims.tsx` defines `prefetch: () => {}` on `useRouter()`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/code/generation/overlay-gen.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/code/generation/overlay-gen.ts src/preview-sandbox/next-shims.tsx
git commit -m "feat(overlay): inject immediate route prefetching for overlay links on reveal"
```

---

### Task 6: Unified Export Pipeline: Differentiated Prefetch, Image Transforms & Cached Relay

**Files:**
- Modify: `src/code/project/source-export.ts`
- Test: `src/code/project/__tests__/source-export-modes.test.ts`

**Interfaces:**
- Consumes:
  - `getCmsImageSrcSet` from `@/shared/image-utils`
  - `loadCmsProjectConfig` from `@/code/project/cms-api-config`
- Produces:
  - Upstream caching in `buildCmsQueryRouteHandler`: `next: { revalidate: config.revalidateTtl ?? 60 }`.
  - Relay payload contract: expects `{ collection: '...' }` (never `source`).
  - Differentiated prefetching:
    - Primary Navigation & Header `<Link>` components receive `prefetch={true}`.
    - Repeating collection items / cards use **Intent-based Prefetch** (`onMouseEnter` / `onFocus` with 60ms debounce) to prevent bandwidth bloat.
  - Remote CMS image tag rewriting attaching `srcSet` and inferred `sizes`.
  - Synthetic on-demand revalidation route (`app/api/revalidate/route.ts`).

- [ ] **Step 1: Write failing tests in `source-export-modes.test.ts`**

In `src/code/project/__tests__/source-export-modes.test.ts`:
1. Verify `buildCmsQueryRouteHandler` emits `next: { revalidate: ... }` for upstream CMS fetches.
2. Verify query calls in components pass `{ collection: '...' }` rather than `source`.
3. Verify remote CMS image tags with optimization enabled receive `srcSet` and preserve query tokens.
4. Verify `app/api/revalidate/route.ts` is emitted when API collections exist.

- [ ] **Step 2: Implement passes in `source-export.ts`**

1. **Pass 1: Remote CMS image optimization:**
   In `injectResponsiveImageSrcSets`: match against collection configs and attach `srcSet={getCmsImageSrcSet(src, config)}` and inferred `sizes`.
2. **Pass 2: Differentiated Link prefetching:**
   - Detect navigation/menu links (`<nav>`, `header`, or fixed menu containers) and inject `prefetch={true}`.
   - For collection repeater links, inject debounced intent handler (`onMouseEnter={() => router.prefetch(href)}`).
3. **Pass 3: Component data adaptation & relay calls:**
   - Use `{ collection: 'slug' }` in `fetch('/api/cms/query', { method: 'POST', body: JSON.stringify({ collection }) })`.
4. **Pass 4: Generate `/api/cms/query` relay with caching & `/api/revalidate`:**
   - In `buildCmsQueryRouteHandler`: inject `next: { revalidate: config.revalidateTtl ?? 60 }` into `fetch(targetUrl.toString(), ...)`.
   - Generate `app/api/revalidate/route.ts`.

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/code/project/__tests__/source-export-modes.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/code/project/source-export.ts src/code/project/__tests__/source-export-modes.test.ts
git commit -m "feat(export): integrate differentiated prefetch, cached CMS query relay, and safe image srcSets"
```

---

### Task 7: Full System Verification & End-to-End Build Test

**Files:**
- Test: All touched test suites

- [ ] **Step 1: Run comprehensive Vitest suite**

Run: `npx vitest run src/code/project/cms-seo.test.ts src/code/project/__tests__/source-export-modes.test.ts src/editor/tools/ImageTool.cms-bind.test.tsx src/shared/__tests__/image-utils.test.ts src/shared/__tests__/cms-expression-validator.test.ts`
Expected: All tests PASS.

- [ ] **Step 2: Run global TypeScript typecheck**

Run: `npx tsc --noEmit`
Expected: Exits with code 0 (zero errors).

- [ ] **Step 3: Final verification commit**

```bash
git commit --allow-empty -m "chore(release): complete comprehensive CMS performance, living hybrid SSG, and SEO expressions plan (consensus v3)"
```
