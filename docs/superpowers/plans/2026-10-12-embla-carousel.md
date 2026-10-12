# EmblaCarousel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a feature-complete, highly customizable `EmblaCarousel` code component for Revyme with visual control over all Embla options, official plugins (Autoplay, AutoScroll/Marquee, Fade, WheelGestures, AutoHeight), multi-slide responsive layouts, and canvas-drag external trigger wiring.

**Architecture:** 
1. Install core Embla packages and register them in `code-component-runtime.ts` (`MODULE_MAP`) for sandbox and preview resolution.
2. Implement AST codegen utilities (`carousel-trigger-ops.ts`) for reading, writing, and removing `data-carousel-target` and `data-carousel-action` attributes on target canvas elements.
3. Author the default TSX template `EmblaCarousel.ts` with comprehensive `@controls` metadata, slide flex sizing math, delegated external trigger listener, and built-in navigation/pagination.
4. Add canvas UI components: `CarouselTriggerHandle.tsx` (drag-to-wire external ◀ / ▶ handles) and `CarouselTriggerConnectors.tsx` (persistent connector lines on canvas).
5. Register in `default-code-components/index.ts` and `project-fs.ts`, and verify via tests and typechecks.

**Tech Stack:** React 19, TypeScript, Embla Carousel (`embla-carousel-react`, `embla-carousel-autoplay`, `embla-carousel-auto-scroll`, `embla-carousel-fade`, `embla-carousel-auto-height`, `embla-carousel-wheel-gestures`), Babel Standalone (AST parsing & generation), Jotai, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-12-embla-carousel-design.md`

## Global Constraints

- Document format is real Next.js/React source code (never mutate canvas DOM as the source of truth).
- Invariant 1: Canvas is an iframe — never call DOM methods across frames directly; use `findNodeRect`, `patchNodeStyles`, and canvas-bridge.
- Invariant 2: Never write ProjectFS directly — use `queueMutation` / `modifyProjectFile`.
- Invariant 3: Empty string style removes property.
- Invariant 4: Responsive overrides live as `@media` rules / `data-responsive` JSON attribute via `withResponsiveProps`.
- Invariant 5: Preserve legacy `Carousel.ts` component completely for backward compatibility.

---

### Task 1: Install Embla Dependencies & Register in Runtime

**Files:**
- Modify: `package.json`
- Modify: `src/canvas/code-component-runtime.ts:208-251`
- Test: `src/canvas/code-component-runtime.test.ts`

**Interfaces:**
- Produces: `embla-carousel-react`, `embla-carousel-autoplay`, `embla-carousel-auto-scroll`, `embla-carousel-fade`, `embla-carousel-auto-height`, `embla-carousel-wheel-gestures` in `MODULE_MAP`.

- [ ] **Step 1: Install Embla packages**

Run command in root workspace:
```powershell
npm install embla-carousel embla-carousel-react embla-carousel-autoplay embla-carousel-auto-scroll embla-carousel-fade embla-carousel-auto-height embla-carousel-wheel-gestures
```

- [ ] **Step 2: Write failing test in `src/canvas/code-component-runtime.test.ts`**

Add test verifying that compiling code with `import useEmblaCarousel from 'embla-carousel-react'` resolves without error:
```ts
it('resolves embla-carousel modules from MODULE_MAP', async () => {
  const code = `
    import useEmblaCarousel from 'embla-carousel-react';
    import Autoplay from 'embla-carousel-autoplay';
    export default function Test() {
      return <div>Embla Loaded</div>;
    }
  `;
  const Comp = await compileCodeComponent(code);
  expect(Comp).toBeDefined();
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/canvas/code-component-runtime.test.ts`
Expected: FAIL ("Cannot find module 'embla-carousel-react'")

- [ ] **Step 4: Update `MODULE_MAP` in `src/canvas/code-component-runtime.ts`**

Import and add to `MODULE_MAP`:
```ts
import useEmblaCarousel from 'embla-carousel-react';
import Autoplay from 'embla-carousel-autoplay';
import AutoScroll from 'embla-carousel-auto-scroll';
import Fade from 'embla-carousel-fade';
import AutoHeight from 'embla-carousel-auto-height';
import { wheelGestures } from 'embla-carousel-wheel-gestures';

// inside MODULE_MAP:
'embla-carousel-react': { default: useEmblaCarousel, useEmblaCarousel },
'embla-carousel-autoplay': { default: Autoplay, Autoplay },
'embla-carousel-auto-scroll': { default: AutoScroll, AutoScroll },
'embla-carousel-fade': { default: Fade, Fade },
'embla-carousel-auto-height': { default: AutoHeight, AutoHeight },
'embla-carousel-wheel-gestures': { default: wheelGestures, wheelGestures },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/canvas/code-component-runtime.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/canvas/code-component-runtime.ts src/canvas/code-component-runtime.test.ts
git commit -m "feat(runtime): register embla-carousel packages in MODULE_MAP"
```

---

### Task 2: AST Operations for Carousel Triggers (`carousel-trigger-ops.ts`)

**Files:**
- Create: `src/code/generation/carousel-trigger-ops.ts`
- Create: `src/code/generation/carousel-trigger-ops.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function setCarouselTriggerInCode(code: string, targetNodeId: string, carouselId: string, action: 'prev' | 'next'): string;
  export function removeCarouselTriggerInCode(code: string, targetNodeId: string): string;
  export function getCarouselTriggers(code: string, carouselId: string): { prevIds: string[]; nextIds: string[] };
  ```

- [ ] **Step 1: Write the failing tests**

Create `src/code/generation/carousel-trigger-ops.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { setCarouselTriggerInCode, removeCarouselTriggerInCode, getCarouselTriggers } from './carousel-trigger-ops';

describe('carousel-trigger-ops', () => {
  const baseCode = `
    export default function Page() {
      return (
        <div>
          <button data-id="btn-1">Prev</button>
          <button data-id="btn-2">Next</button>
          <EmblaCarousel data-id="slider-1" />
        </div>
      );
    }
  `;

  it('sets carousel target and action attributes on target node', () => {
    const updated = setCarouselTriggerInCode(baseCode, 'btn-1', 'slider-1', 'prev');
    expect(updated).toContain('data-carousel-target="slider-1"');
    expect(updated).toContain('data-carousel-action="prev"');

    const conns = getCarouselTriggers(updated, 'slider-1');
    expect(conns.prevIds).toEqual(['btn-1']);
    expect(conns.nextIds).toEqual([]);
  });

  it('removes carousel trigger attributes from target node', () => {
    const wired = setCarouselTriggerInCode(baseCode, 'btn-1', 'slider-1', 'prev');
    const removed = removeCarouselTriggerInCode(wired, 'btn-1');
    expect(removed).not.toContain('data-carousel-target');
    expect(removed).not.toContain('data-carousel-action');
    expect(getCarouselTriggers(removed, 'slider-1').prevIds).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/code/generation/carousel-trigger-ops.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `carousel-trigger-ops.ts`**

Create `src/code/generation/carousel-trigger-ops.ts`:
- Use `parseJSX` and `traverse` from `@/code/parsing/ast-utils`.
- Target the element by `data-id`.
- Add/update `data-carousel-target` and `data-carousel-action` JSX attributes using `@babel/types`.
- Use `generate(ast).code` to reprint JSX.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/code/generation/carousel-trigger-ops.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/code/generation/carousel-trigger-ops.ts src/code/generation/carousel-trigger-ops.test.ts
git commit -m "feat(codegen): add carousel trigger AST operations"
```

---

### Task 3: Author Default Template `EmblaCarousel.ts`

**Files:**
- Create: `src/code/project/default-code-components/EmblaCarousel.ts`
- Modify: `src/code/project/default-code-components/index.ts`
- Modify: `src/code/project/project-fs.ts`
- Create: `src/code/project/default-code-components/embla-carousel.test.ts`

**Interfaces:**
- Produces: `EMBLA_CAROUSEL_COMPONENT` string export and registration in `BUILT_IN_COMPONENTS`.

- [ ] **Step 1: Write test for `@controls` parsing and metadata**

Create `src/code/project/default-code-components/embla-carousel.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { EMBLA_CAROUSEL_COMPONENT } from './EmblaCarousel';
import { parseComponentControlsMeta } from '@/code/components/controls-parser';

describe('EmblaCarousel Component Metadata', () => {
  it('parses @controls metadata successfully', () => {
    const meta = parseComponentControlsMeta(EMBLA_CAROUSEL_COMPONENT);
    expect(meta).not.toBeNull();
    expect(meta?.label).toBe('Embla Carousel');
    expect(meta?.controls.children?.type).toBe('slot');
    expect(meta?.controls.layout?.type).toBe('group');
    expect(meta?.controls.scroll?.type).toBe('group');
    expect(meta?.controls.motion?.type).toBe('group');
    expect(meta?.controls.arrows?.type).toBe('group');
    expect(meta?.controls.dots?.type).toBe('group');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/code/project/default-code-components/embla-carousel.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `EmblaCarousel.ts`**

Write `src/code/project/default-code-components/EmblaCarousel.ts`:
- Include `@label "Embla Carousel"` and full `@controls` JSDoc string from Spec Section 3.1.
- Import `useEmblaCarousel`, `Autoplay`, `AutoScroll`, `Fade`, `AutoHeight`, `wheelGestures`, `withResponsiveProps`, `useStaticCanvas`.
- Compute slide flex-basis according to `visibleSlides`, `customSlideWidth`, `gap`.
- Wire delegated click and state update for `[data-carousel-target="${id}"]`.
- Wire activeSlideIndex canvas sync via `emblaApi.scrollTo(activeSlideIndex)`.
- Render built-in arrows and pagination format (dots, pills, fraction, progressBar).
- Wrap with `withResponsiveProps(EmblaCarousel)`.

- [ ] **Step 4: Export and wire in `default-code-components/index.ts` & `project-fs.ts`**

- In `src/code/project/default-code-components/index.ts`: export `EMBLA_CAROUSEL_COMPONENT`.
- In `src/code/project/project-fs.ts`: add `components/EmblaCarousel.tsx` to `BUILT_IN_COMPONENTS` and `createDefaultProject`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/code/project/default-code-components/embla-carousel.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/code/project/default-code-components/EmblaCarousel.ts src/code/project/default-code-components/index.ts src/code/project/project-fs.ts src/code/project/default-code-components/embla-carousel.test.ts
git commit -m "feat(components): author EmblaCarousel template and register in project-fs"
```

---

### Task 4: Canvas External Trigger Handles (`CarouselTriggerHandle.tsx`)

**Files:**
- Create: `src/canvas/ui/CarouselTriggerHandle.tsx`
- Modify: `src/canvas/Canvas.tsx`
- Test: `src/canvas/ui/CarouselTriggerHandle.test.tsx`

**Interfaces:**
- Produces: `CarouselTriggerHandle` component mounted in `Canvas.tsx`.
- Calls: `queueMutation({ type: 'setCarouselTrigger', targetNodeId, carouselId, action })` and `flushNow()`.

- [ ] **Step 1: Write unit test for trigger handle visibility and positioning**

Create `src/canvas/ui/CarouselTriggerHandle.test.tsx`:
```ts
import { describe, it, expect } from 'vitest';

describe('CarouselTriggerHandle', () => {
  it('is exported and mounts without crashing', async () => {
    const mod = await import('./CarouselTriggerHandle');
    expect(mod.default).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/canvas/ui/CarouselTriggerHandle.test.tsx`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `CarouselTriggerHandle.tsx`**

Create `src/canvas/ui/CarouselTriggerHandle.tsx`:
- Show when `selectedNode?.componentFile` is `components/EmblaCarousel.tsx`.
- Place ◀ (Prev) and ▶ (Next) circular handle pills at bottom-left and bottom-right of the carousel rect using `getScreenCornersById`.
- On pointer down: capture drag, track mouse, call `getNodeHitsAtPoint(x, y)` to find target element.
- Highlight target element with `patchNodeStyles(contentEl, targetId, prefix, { outline: '2px solid #8b5cf6' })`.
- On drop: commit mutation using `setCarouselTriggerInCode` via `modifyProjectFile`.
- Wire into `src/canvas/Canvas.tsx`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/canvas/ui/CarouselTriggerHandle.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/canvas/ui/CarouselTriggerHandle.tsx src/canvas/ui/CarouselTriggerHandle.test.tsx src/canvas/Canvas.tsx
git commit -m "feat(canvas): add CarouselTriggerHandle for dragging trigger connections"
```

---

### Task 5: Canvas External Trigger Connectors (`CarouselTriggerConnectors.tsx`)

**Files:**
- Create: `src/canvas/ui/CarouselTriggerConnectors.tsx`
- Modify: `src/canvas/Canvas.tsx`
- Test: `src/canvas/ui/CarouselTriggerConnectors.test.tsx`

**Interfaces:**
- Produces: `CarouselTriggerConnectors` rendered on canvas overlay.

- [ ] **Step 1: Write test for connectors rendering**

Create `src/canvas/ui/CarouselTriggerConnectors.test.tsx`:
```ts
import { describe, it, expect } from 'vitest';

describe('CarouselTriggerConnectors', () => {
  it('is exported and defined', async () => {
    const mod = await import('./CarouselTriggerConnectors');
    expect(mod.default).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/canvas/ui/CarouselTriggerConnectors.test.tsx`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `CarouselTriggerConnectors.tsx`**

Create `src/canvas/ui/CarouselTriggerConnectors.tsx`:
- Parse triggers from code for active carousel using `getCarouselTriggers(code, carouselId)`.
- For each target id, find rects using `findNodeRect(targetId, 'desktop')` and `findNodeRect(carouselId, 'desktop')`.
- Calculate connection path using `generateSteppedPath`.
- Render SVG path with indicator arrowhead and action label badge ("Prev" / "Next").
- Mount inside `src/canvas/Canvas.tsx`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/canvas/ui/CarouselTriggerConnectors.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/canvas/ui/CarouselTriggerConnectors.tsx src/canvas/ui/CarouselTriggerConnectors.test.tsx src/canvas/Canvas.tsx
git commit -m "feat(canvas): render persistent trigger connector lines on canvas"
```

---

### Task 6: Full Integration Verification & Typecheck

**Files:**
- All touched files

- [ ] **Step 1: Run TypeScript compiler**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 2: Run full Vitest suite**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git commit -am "chore: verify EmblaCarousel integration and test suite"
```
