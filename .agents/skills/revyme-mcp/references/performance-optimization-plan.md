# Production Performance & Bundle Optimization Architecture Plan

> **Author**: Antigravity AI Engineering  
> **Target System**: Revyme Website Builder (`Next.js 16`, `Turbopack`, `framer-motion`, `ProjectFS`)  
> **Primary Objectives**:
> 1. Achieve a guaranteed 98–100 Google PageSpeed / Lighthouse score on all exported sites.
> 2. Reduce initial production client-side JavaScript payload to < 35 KiB (gzipped).
> 3. Eliminate unnecessary JavaScript execution and render-blocking resources.
> 4. Ensure buttery-smooth 60/120 FPS animations without layout shifts (CLS = 0) or scroll stutter.

---

## 1. Executive Summary & Current State Analysis

### Current Bundle Footprint:
- **Baseline Next.js 16 + React 19 Runtime**: `~26.6 KiB` (gzipped).
- **Full `framer-motion` + Component Runtime**: `~21.7 KiB` (gzipped).
- **Lighthouse Estimated Savings on Unused JS**: `~48.3 KiB` reported during initial viewport mount.

### Root Cause:
1. **Monolithic Motion Import**: Pages currently import `motion` from `framer-motion`, which bundles full gesture tracking, pan handlers, drag constraints, and projection engines even for simple fade/slide transitions.
2. **Eager Component Loading**: Heavy third-party embeds (Spline 3D, WebGL shaders, maps, audio/video players) are imported statically at the top of the client component bundle rather than dynamically loaded when nearing the viewport.
3. **Client Component Tree Monolith**: The visual canvas utilizes `'use client'` across `page.client.tsx`, shipping all markup hydration code to the browser regardless of whether nodes are static or interactive.

---

## 2. Phased Architectural Roadmap

```
┌───────────────────────────────────────────────────────────────────────────────────┐
│ PHASE 1: Zero-Risk High-Impact Optimizations (1–2 Days)                           │
│   • Framer Motion `LazyMotion` + `m.*` lightweight tree-shaking                   │
│   • Viewport-aware `next/dynamic` imports for heavy widgets / 3D scenes           │
│   • Gzip / Brotli compression optimization in `next.config.mjs`                   │
├───────────────────────────────────────────────────────────────────────────────────┤
│ PHASE 2: Media & Asset Pipeline Optimization (2–3 Days)                           │
│   • Automated `next/image` transformer (AVIF/WebP, responsive `sizes`, `priority`)│
│   • Zero-CLS layout placeholder reservation for media tiles                       │
├───────────────────────────────────────────────────────────────────────────────────┤
│ PHASE 3: React Server Component (RSC) Island Decomposition (1–2 Weeks)            │
│   • AST-driven separation: static HTML on server (0 KB JS) vs interactive islands │
└───────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Detailed Technical Specifications

### Phase 1: `LazyMotion` & Lightweight Motion Primitives

#### 1.1 `LazyMotion` Root Provider in `app/layout.tsx`
Wrap the root children with `LazyMotion` configuring `domAnimation` (which includes basic animations, exit transitions, and variants while stripping ~15 KiB of unused gesture/drag overhead):

```tsx
// app/layout.tsx
import { LazyMotion, domAnimation } from 'framer-motion';
import { Providers } from './providers';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <LazyMotion features={domAnimation} strict>
          <Providers>{children}</Providers>
        </LazyMotion>
      </body>
    </html>
  );
}
```

#### 1.2 Code Generation AST Transformer (`syncImports` & `motion-gen.ts`)
- **Module**: `src/code/mutation/mutation-queue.ts` & `src/code/generation/`
- When generating motion nodes for exported production code:
  - Replace `import { motion } from 'framer-motion'` with `import { m } from 'framer-motion'`.
  - Transform JSX tags from `<motion.div>` to `<m.div>`, `<motion.h1>` to `<m.h1>`, etc.
- **Safety**: `strict` mode in `LazyMotion` ensures that accidental usage of `<motion.*>` throws a clear build-time lint rather than bundling the fallback runtime.

---

### Phase 2: Viewport-Aware Dynamic Imports (`next/dynamic`)

#### 2.1 Heavy Widget Registry
Identify all computationally heavy code components:
- `SplineScene` (Three.js / WebGL runtime: ~1.2 MB)
- `Shader*` / `PlasmaShader` / `NebulaField` (Canvas WebGL context)
- `YouTubeEmbed`, `VimeoEmbed`, `SpotifyEmbed` (iFrame embed loaders)
- `CustomCursor` / `BlobCursor` (Desktop-only cursor trackers)

#### 2.2 Production Export Transformation
- **Module**: `src/code/project/source-export.ts` (`prepareSiteFiles`)
- For heavy components located below the fold:
```tsx
import dynamic from 'next/dynamic';

const SplineScene = dynamic(() => import('@/components/SplineScene'), {
  ssr: false,
  loading: () => (
    <div
      style={{
        width: '100%',
        height: '100%',
        minHeight: '400px',
        backgroundColor: 'rgba(255, 255, 255, 0.03)',
        borderRadius: '12px',
      }}
      aria-hidden="true"
    />
  ),
});
```

#### 2.3 Viewport Buffer Rules (No "Pop-in" Stutter)
To ensure users never see blank boxes while scrolling down:
1. **Above-the-Fold (Hero Section)**: **Never** lazy loaded. Must render statically on the server or eagerly on mount.
2. **Intersection Preload Buffer (`rootMargin`)**: Trigger lazy chunks when the user is within **250px–400px** of scrolling to the target component.
3. **Fixed Dimension Reservation**: All lazy wrappers must declare concrete `minHeight` / `aspectRatio` to maintain **CLS = 0**.

---

### Phase 3: Automated `next/image` Transformation

#### 3.1 Background & Inlined Images
Transform standard `<img>` and static background image frames into optimized Next.js image primitives:
```tsx
import Image from 'next/image';

// For responsive background frames:
<div className="relative w-full h-[500px] overflow-hidden">
  <Image
    src="/api/uploads/hero-banner.jpg"
    alt="Hero Background"
    fill
    sizes="(max-width: 768px) 100vw, (max-width: 1200px) 80vw, 1200px"
    className="object-cover"
    priority={isAboveTheFold}
    quality={85}
  />
</div>
```

#### 3.2 Benefits:
- Automatic WebP/AVIF format negotiation based on browser support.
- Correct responsive resolution served based on device DPI (saving 70%+ bandwidth on mobile devices).
- Native browser lazy-loading for off-screen images.

---

### Phase 4: Production Next.js Config Tuning

#### In `next.config.mjs`:
```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  compress: true, // Enable Brotli / Gzip compression
  poweredByHeader: false, // Security & byte reduction
  images: {
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 31536000, // 1 year cache TTL for optimized assets
  },
  experimental: {
    optimizePackageImports: ['framer-motion', 'lucide-react'],
  },
};

export default nextConfig;
```

---

## 4. Verification & Testing Checklist for Agents

When implementing any step of this optimization plan:
1. **Unit Tests**:
   - Run `npx vitest run src/code/generation/next-font-gen.test.ts`
   - Run `npx vitest run src/code/project/source-export.test.ts`
2. **Type Safety**:
   - Run `npx tsc --noEmit` (zero errors allowed).
3. **Production Build Verification**:
   - Run `npm run build` in `data/builds/local`.
   - Verify Turbopack compiles without missing chunk or module resolution errors.
4. **Lighthouse Benchmark**:
   - Audit with Chrome DevTools in an Incognito window (disabling extensions).
   - Ensure `LCP < 1.2s`, `INP < 30ms`, `CLS = 0`, `Performance Score >= 98`.
