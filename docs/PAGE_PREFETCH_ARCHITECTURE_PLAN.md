# Page & Route Prefetch Architecture Plan: Overlay Visibility & Intent Hover

> **Status:** Proposed & Ready for Implementation  
> **Target Subsystems:** `src/code/generation/overlay-gen.ts`, `src/code/project/source-export.ts`, `src/code/components/component-ops.ts`  
> **Date:** October 14, 2026  

---

## 1. Executive Summary & Problem Analysis

In modern web applications, the difference between a sluggish feel and a native-app-like experience comes down to **latency hiding**. When a page transition takes 0 ms because the target page was already prefetched into the client router cache, transitions feel instant.

However, in the current Revyme Builder export pipeline, page prefetching suffers from two structural blind spots:

### Problem A: Overlay Links (Popups & Dropdowns)
1. **Unmounted DOM**: Overlays (such as dropdown navigation menus in `Navbar.tsx` or modal popups) are rendered conditionally via Framer Motion:
   ```tsx
   <AnimatePresence>
     {isOverlayOpen && <motion.div data-overlay='...'>...</motion.div>}
   </AnimatePresence>
   ```
2. **Invisible to Next.js**: While `isOverlayOpen` is `false`, neither the overlay container nor any of its `<Link>` / `<MotionLink>` children exist in the DOM tree. Next.js's built-in `IntersectionObserver` cannot observe or prefetch them.
3. **Delayed Prefetch on Open**: When the user opens the menu, the links finally mount. But Next.js's default prefetch uses `requestIdleCallback` and only fetches partial layouts unless `prefetch={true}` is specified. If the user clicks a menu item within 200–400 ms of opening the menu, the prefetch request has either just been queued or has not finished downloading, resulting in a visible stall.

### Problem B: Non-Overlay Links (Navbar, Page Body, Cards, Footer)
1. **Default App Router Prefetch is Partial**: By default in Next.js App Router (Next.js 14, 15, and 16), `<Link>` tags without explicit `prefetch={true}` only prefetch static layout shells and loading boundaries, not the full page data (RSC Flight payload).
2. **Hover Window Underutilized**: When users interact with a navigation bar (e.g. desktop Navbar items), there is an average **100–300 ms dwell time** between cursor hover (`onMouseEnter`) and mouse click (`onClick`). If the link does not actively warm up the route cache on hover, that window is wasted.

---

## 2. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. OVERLAY TRIGGER (Button / Nav Menu Trigger)                              │
│    • User hovers trigger -> (Optional) Pre-warms overlay routes             │
│    • User clicks/opens trigger -> isOverlayOpen = true                      │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 2. OVERLAY RUNTIME EFFECT (overlay-gen.ts)                                  │
│    • Fires synchronously upon mount: if (!isOverlayOpen) return;            │
│    • Scans overlay DOM for internal links: a[href^="/"]                     │
│    • Immediately triggers router.prefetch(href) for each link             │
│    • Zero idle lag: All dropdown/popup routes are cached within ~30-50ms   │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ 3. REGULAR LINKS (Navbar, Page Body, Cards, Footer)                         │
│    • source-export.ts injects prefetch={true} on internal Link/MotionLink   │
│    • Hover Intent: onMouseEnter={() => router.prefetch(href)}               │
│    • Full RSC Payload is cached before the user completes the mouse click   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Detailed Technical Specifications

### 3.1 Subsystem 1: Overlay Visibility Prefetching (`overlay-gen.ts`)

Revyme already generates custom runtime hooks for every overlay in `src/code/generation/overlay-gen.ts`:
- **Fixed Overlays (Modals / Popups):** [`buildFixedOverlayRuntimeEffect`](file:///home/rost/Документи/revyme/revyme-builder-fork/src/code/generation/overlay-gen.ts#L502)
- **Relative Overlays (Dropdowns / Tooltips):** [`buildRelativeOverlayPosEffect`](file:///home/rost/Документи/revyme/revyme-builder-fork/src/code/generation/overlay-gen.ts#L547)

Both hooks execute when `${varName}` (e.g., `overlayButtonOpen`) changes:
```ts
if (!${varName}) return;
```

#### Proposed Change:
1. **Ensure `useRouter` is available**:
   In any component file containing an overlay runtime effect, ensure:
   ```ts
   import { useRouter } from 'next/navigation';
   ```
   and declare inside the component body (if not already declared):
   ```ts
   const router = useRouter();
   ```
2. **Inject Link Scanner & Immediate Prefetch in the Open Branch**:
   Inside both `buildFixedOverlayRuntimeEffect` and `buildRelativeOverlayPosEffect`:
   ```ts
   // Immediately prefetch all internal routes contained inside the opened overlay
   const links = overlay.querySelectorAll('a[href^="/"]');
   links.forEach((link) => {
     const href = link.getAttribute('href');
     if (href && !href.startsWith('//') && !href.startsWith('#')) {
       try {
         router.prefetch(href);
       } catch {}
     }
   });
   ```
3. **Safety for Canvas Sandbox**:
   Inside `src/preview-sandbox/next-shims.tsx`, `useRouter().prefetch` is already shimmed as a no-op:
   ```ts
   export function useRouter(): RouterShim {
     return {
       prefetch: () => {},
       push: () => {},
       ...
     };
   }
   ```
   This guarantees that canvas rendering and editor previews remain unaffected and crash-free.

---

### 3.2 Subsystem 2: Intent-Based Hover Prefetch for Regular Links & Navbar

For links outside overlays (e.g. primary Navbar links, header CTAs, footer links, blog/gallery cards on the page):

#### Strategy A: Universal `prefetch={true}` on Internal Links during Export
In `src/code/project/source-export.ts` (`prepareSiteFiles`), when compiling pages and components:
- Inspect all `<Link>` and `<MotionLink>` elements.
- For internal links (e.g. `href="/"`, `href="/about"`, `href={`/gallery/${item.slug}`}`):
  Ensure `prefetch={true}` is set:
  ```tsx
  <MotionLink prefetch={true} href="/pricing" ...>Pricing</MotionLink>
  ```
- **Why `prefetch={true}`?**
  In Next.js App Router, `prefetch={true}` tells Next.js to fetch the **complete RSC payload** (not just partial layout shells) and keep it in the client router cache. When the link enters the viewport or is hovered, Next.js caches the entire destination route.

#### Strategy B: Intent Hover Handler (`onMouseEnter`)
For high-traffic navigational components (like `Navbar.tsx` or hero CTAs):
- In `component-ops.ts` / `source-export.ts`:
  When a link has an explicit `href`, support or inject an eager hover prefetch:
  ```tsx
  <MotionLink 
    href="/gallery/men" 
    prefetch={true}
    onMouseEnter={(e) => {
      // Eager prefetch immediately upon cursor touch
      try { router.prefetch("/gallery/men"); } catch {}
      props.onMouseEnter?.(e);
    }}
  >
  ```
- Because human cursor-to-click latency is typically 150–300 ms, triggering `router.prefetch` on the very first pixel of hover guarantees that the network fetch completes before the `onClick` event fires.

---

### 3.3 Subsystem 3: Trigger-Level Hover Prefetch for Dropdown Menus

When a user hovers over a dropdown trigger button in the Navbar (for example, hovering over "Men" or "Галерея" before clicking it):
- We can add an `onMouseEnter` handler to the trigger element:
  ```tsx
  <motion.button
    data-overlay-trigger='{"targetId":"overlay-xyz","trigger":"click"}'
    onMouseEnter={() => {
      // If the overlay contains known static links or CMS collections,
      // warmup the overlay links or primary category route immediately
    }}
    onClick={() => setOverlayOpen(!overlayOpen)}
  >
  ```
- This gives the browser a head start even before the user clicks to open the dropdown!

---

## 4. Implementation Steps & File Checklist

| Phase | Target File | Action Required |
|---|---|---|
| **Phase 1** | [`src/code/generation/overlay-gen.ts`](file:///home/rost/Документи/revyme/revyme-builder-fork/src/code/generation/overlay-gen.ts) | 1. In `buildFixedOverlayRuntimeEffect` and `buildRelativeOverlayPosEffect`, inject querySelector for `a[href^="/"]` and execute `router.prefetch(href)`.<br>2. Ensure `useRouter` import and `const router = useRouter()` are ensured when generating/healing overlays. |
| **Phase 2** | [`src/code/project/source-export.ts`](file:///home/rost/Документи/revyme/revyme-builder-fork/src/code/project/source-export.ts) | 1. In `prepareSiteFiles`, add a link optimization pass for page and component files.<br>2. Ensure internal `<Link>` and `<MotionLink>` elements receive `prefetch={true}` for Hybrid SSG and production exports. |
| **Phase 3** | [`src/code/components/component-ops.ts`](file:///home/rost/Документи/revyme/revyme-builder-fork/src/code/components/component-ops.ts) | When componentizing links into `<MotionLink>`, preserve `prefetch` props and pass router-safe handlers. |
| **Phase 4** | [`src/code/generation/overlay-gen.test.ts`](file:///home/rost/Документи/revyme/revyme-builder-fork/src/code/generation/overlay-gen.test.ts) | Add unit tests verifying that generated overlay effects include router prefetch calls and necessary imports. |
| **Phase 5** | Live Verification | Rebuild `proj-1791916305476-oaauxe`, open the Navbar dropdown, and verify in DevTools Network tab that route payloads (`?_rsc=...`) are fetched instantly upon dropdown reveal. |

---

## 5. Security & Edge Case Handling

1. **External URLs & Non-Route Links**:
   The link scanner strictly filters for root-relative paths:
   ```ts
   href && href.startsWith('/') && !href.startsWith('//') && !href.startsWith('/#') && !href.includes(':')
   ```
   External URLs (`https://...`), protocol-relative URLs (`//...`), phone links (`tel:...`), and mail links (`mailto:...`) are completely ignored.
2. **Duplicate Prefetch Deduplication**:
   Next.js's internal `router.prefetch()` automatically deduplicates concurrent requests and maintains an in-memory cache with an expiration TTL (5 minutes for static routes, 30 seconds for dynamic routes). Calling `router.prefetch()` multiple times is idempotent and harmless.
3. **SSR & Static Generation Guard**:
   All prefetch logic is scoped within client-side hooks (`useEffect`, `useLayoutEffect`, or event handlers like `onMouseEnter`). It will never execute during Node.js server-side rendering or static HTML pre-rendering.
4. **Editor Canvas Isolation**:
   Because `router.prefetch` is safe-guarded in `src/preview-sandbox/next-shims.tsx`, opening popups and dropdowns inside the visual builder canvas will not throw or trigger unwanted browser navigation.

---

## 6. Expected Performance Impact

- **Overlay Navigation (Dropdown/Popup to Page):**
  - Before: 300–600 ms (unmounted -> click -> route fetch -> wait -> render).
  - After: **< 16 ms (Instant 1-frame swap)** from client cache.
- **Navbar & On-Page Link Clicks:**
  - Before: Network request initiated only after mouse click release.
  - After: Data already in flight or downloaded during the 150–300 ms hover duration.
