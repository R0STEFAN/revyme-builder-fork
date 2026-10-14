# Dynamic CMS Image Optimization & Responsive SrcSet Plan

> **Status:** Proposed & Ready for Execution  
> **Target Subsystems:** `src/shared/`, `src/code/project/`, `src/editor/left-toolbar/panels/cms/`  
> **Date:** October 14, 2026  

---

## 1. Executive Summary & Complexity Assessment

### 1.1 The Problem
Currently, Revyme builder automatically generates responsive `srcSet` variants (`320w`, `640w`, `768w`, `1024w`, `1280w`, `1920w`) and calculates CSS `sizes` attributes for **local upload images** (`/uploads/*` and `/api/uploads/*`) via `injectResponsiveImageSrcSets` and `getUploadSrcSet`.

However, for **Remote Headless CMS images** (e.g. Directus assets `https://api.tattoozp.com/assets/<id>` or dynamic bindings `{item.img_file}`):
1. `getUploadSrcSet(src)` returns `undefined` for any non-upload URL.
2. Dynamic images ship to production with bare `src` tags only.
3. Visitors' browsers download uncompressed original files (often 1.5MB – 5MB per photo) regardless of device screen size.
4. Requiring users to configure `srcset` and `sizes` manually on each individual image component on the canvas is tedious, error-prone, and violates DRY principles.

### 1.2 Proposed Solution
Implement a **centralized "Image Optimization & CDN" configuration** directly in the **API CMS Connection Panel** (`ApiResourceModal.tsx`) and persist it in `_meta/cms-api-config.json`. 

Once enabled for an API collection (e.g. Directus):
- **All connected images across the entire website automatically receive optimized `srcSet` and calculated `sizes` attributes.**
- **Works for BOTH export modes:**
  - **Dynamic Mode (SSR):** Generates responsive `srcSet` runtime helpers in JSX so that server-rendered and client-rendered dynamic routes emit optimized image URLs on request.
  - **Hybrid SSG Mode:** Prerenders the exact optimized `srcSet` and `sizes` attributes into static HTML pages during `next build`.
- No per-image manual configuration is required in the editor.
- The user can adjust format (`WebP`, `AVIF`), quality, or switch between Directus Native Transformation, Cloudflare Image Resizing, or a custom CDN pattern in a single click.

### 1.3 Complexity Evaluation
- **Overall Complexity:** **Low to Moderate** (estimated ~250–350 lines of code across 4 files).
- **Existing Foundation:** Revyme **already has 90% of the required infrastructure**:
  - AST JSX walker `injectResponsiveImageSrcSets` in `src/code/project/source-export.ts`.
  - CSS layout analyzer `inferImageSizes` in `src/shared/image-utils.ts`.
  - API collection config persistence in `_meta/cms-api-config.json`.
- **Breaking Change Risk:** **Zero**. Backwards-compatible; if optimization is disabled or absent, it falls back to current bare `src` behavior.

---

## 2. Architecture & Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Configuration (ApiResourceModal.tsx)                     │
│    User enables "Image Optimization & CDN" for Directus     │
└──────────────────────────────┬──────────────────────────────┘
                               │ writes config
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Metadata (_meta/cms-api-config.json)                     │
│    Stores { engine: 'directus', quality: 82, format: 'webp' }│
└──────────────────────────────┬──────────────────────────────┘
                               │ reads on build/export
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. AST Injection (source-export.ts)                         │
│    injectResponsiveImageSrcSets() detects CMS asset URLs,   │
│    calls getCmsImageSrcSet(), and injects calculated sizes  │
└──────────────────────────────┬──────────────────────────────┘
                               │ renders Next.js page
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Client / Browser Execution                               │
│    Browser requests Directus on-the-fly resized WebP       │
│    (e.g., ?width=640&quality=82&format=webp)                │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Data Model Specifications

### 3.1 `src/shared/types.ts`
Extend `ApiCollectionConfig` with an optional `imageOptimization` object:

```ts
export type CmsImageTransformEngine = 'directus' | 'cloudflare' | 'custom';

export interface CmsImageOptimizationConfig {
  /** Master toggle for automatic responsive srcSet generation for this collection */
  enabled: boolean;
  /** Transformation backend engine */
  engine: CmsImageTransformEngine;
  /** Image quality (1-100, default: 82) */
  quality?: number;
  /** Target output format */
  format?: 'webp' | 'avif' | 'auto';
  /** Target responsive breakpoint widths (default: [320, 640, 768, 1024, 1280]) */
  widths?: number[];
  /** Cloudflare zone root URL (e.g. "https://example.com" or empty for current domain) */
  cloudflareZoneUrl?: string;
  /** Custom transformation pattern e.g. "{url}?w={w}&q={q}&format={format}" */
  customPattern?: string;
}

export interface ApiCollectionConfig {
  slug: string;
  name: string;
  provider: 'directus' | 'strapi' | 'baserow' | 'custom_rest';
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  defaultParams?: Record<string, string>;
  cacheMaxAge?: number;
  itemsKey?: string;
  slugField?: string;
  idField?: string;
  /** NEW: Centralized image optimization settings */
  imageOptimization?: CmsImageOptimizationConfig;
}
```

---

## 4. Detailed Implementation Phases

### Phase 1: Runtime Transformation Helper
**File:** `src/shared/image-utils.ts` & `src/shared/image-export-constants.ts`

Add `getCmsImageSrcSet()` utility function that transforms dynamic CMS URLs into valid HTML5 `srcset` strings based on the configured engine.

#### Implementation details:
```ts
export const DEFAULT_CMS_IMAGE_WIDTHS = [320, 640, 768, 1024, 1280];

export function getCmsImageSrcSet(
  src: string | undefined | null,
  config?: CmsImageOptimizationConfig
): string | undefined {
  if (!src || typeof src !== 'string') return undefined;
  if (!config || !config.enabled) return undefined;

  const widths = config.widths && config.widths.length > 0 ? config.widths : DEFAULT_CMS_IMAGE_WIDTHS;
  const quality = config.quality ?? 82;
  const format = config.format ?? 'webp';
  const cleanUrl = src.split('?')[0].split('#')[0];

  switch (config.engine) {
    case 'directus': {
      // Directus handles /assets/<id>?width=W&quality=Q&format=FORMAT
      return widths
        .map((w) => `${cleanUrl}?width=${w}&quality=${quality}&format=${format} ${w}w`)
        .join(', ');
    }
    case 'cloudflare': {
      // Cloudflare Image Resizing: /cdn-cgi/image/width=W,quality=Q,format=auto/<original_url>
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

Also update `getUploadSrcSet()` or expose `getResponsiveImageSrcSet(src, cmsConfigs)` so both local uploads and remote CMS assets can be resolved transparently.

---

### Phase 2: AST Codegen & Build Pipeline
**File:** `src/code/project/source-export.ts`

Enhance `injectResponsiveImageSrcSets` to accept the project's API collection configs:

1. **Detect CMS Image Sources:**
   When iterating JSX `<img />` tags:
   - Check if `src` is a string matching an API asset endpoint (e.g. containing `/assets/` or matching a known API base URL).
   - Or if `src` is an expression container (e.g. `item.img_file.id` or `https://api... + item.id`).
2. **Inject `srcSet` call expression:**
   Emit:
   ```tsx
   srcSet={getCmsImageSrcSet(imageSrc, imageOptConfig)}
   ```
   or if precalculated statically for static URLs:
   ```tsx
   srcSet="https://api.tattoozp.com/assets/...w=320 320w, ..."
   ```
3. **Automatic `sizes` calculation:**
   Use the existing `inferImageSizes(node, viewports)` logic which already inspects the layout (e.g. fixed 128px vs 50vw grid vs 100vw).

---

### Phase 3: User Interface in `ApiResourceModal.tsx`
**File:** `src/editor/left-toolbar/panels/cms/ApiResourceModal.tsx`

Add an accordion/section in `ApiResourceModal`:

```tsx
{/* ── Image Optimization & CDN ── */}
<div style={{ marginTop: '16px', borderTop: '1px solid #334155', paddingTop: '16px' }}>
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
    <label style={{ fontSize: '13px', fontWeight: 600, color: '#f1f5f9' }}>
      Automatic Responsive Images (CDN / Transforms)
    </label>
    <input
      type="checkbox"
      checked={imgOptEnabled}
      onChange={(e) => setImgOptEnabled(e.target.checked)}
    />
  </div>

  {imgOptEnabled && (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '10px' }}>
      {/* Engine Selector */}
      <div>
        <label style={{ fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>
          Transformation Engine
        </label>
        <select
          value={imgOptEngine}
          onChange={(e) => setImgOptEngine(e.target.value as CmsImageTransformEngine)}
          style={{ width: '100%', background: '#0f172a', color: '#f1f5f9', border: '1px solid #334155', borderRadius: '4px', padding: '6px' }}
        >
          <option value="directus">Directus Native (/assets?width=...)</option>
          <option value="cloudflare">Cloudflare Image Resizing (/cdn-cgi/image/...)</option>
          <option value="custom">Custom URL Pattern</option>
        </select>
      </div>

      {/* Format & Quality */}
      <div style={{ display: 'flex', gap: '12px' }}>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>Format</label>
          <select value={imgOptFormat} onChange={(e) => setImgOptFormat(e.target.value)}>
            <option value="webp">WebP (Recommended)</option>
            <option value="avif">AVIF</option>
            <option value="auto">Auto</option>
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>Quality (%)</label>
          <input
            type="number"
            min={1}
            max={100}
            value={imgOptQuality}
            onChange={(e) => setImgOptQuality(parseInt(e.target.value, 10) || 82)}
          />
        </div>
      </div>
    </div>
  )}
</div>
```

---

## 5. Verification & Acceptance Criteria

| Check # | Requirement | Expected Result |
|---|---|---|
| **V1** | Directus default | Enabling Directus engine creates `?width=320&quality=82&format=webp 320w, ...` in `srcSet`. |
| **V2** | Cloudflare engine | Selecting Cloudflare creates `/cdn-cgi/image/width=...` prefix. |
| **V3** | `sizes` preservation | `sizes` is automatically inferred from CSS element width (e.g. `sizes="128px"` or `(max-width: 768px) 100vw, 50vw`). |
| **V4** | Zero manual per-image work | Connecting Directus with image optimization on updates all `<img />` tags for that collection across all pages automatically. |
| **V5** | Test Suite | New tests in `src/shared/__tests__/image-utils.test.ts` and `src/code/project/__tests__/source-export-modes.test.ts` pass with 100% coverage. |
| **V6** | Typecheck | `npx tsc --noEmit` completes with 0 errors. |

---

## 6. Execution Order for Implementing Agent

1. **Step 1:** Add `CmsImageOptimizationConfig` to `src/shared/types.ts`.
2. **Step 2:** Implement `getCmsImageSrcSet` and tests in `src/shared/image-utils.ts` and `src/shared/image-export-constants.ts`.
3. **Step 3:** Update `source-export.ts` to wire CMS collection image optimization into `injectResponsiveImageSrcSets`.
4. **Step 4:** Add the UI controls in `ApiResourceModal.tsx` and wire state to `saveApiCollection()`.
5. **Step 5:** Run tests (`npx vitest run`) and typecheck (`npx tsc --noEmit`) to verify clean delivery.
