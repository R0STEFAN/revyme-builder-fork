# Design Spec: Customizable EmblaCarousel Component for Revyme

**Date:** 2026-10-12  
**Status:** Approved  
**Author:** Antigravity & User  

---

## 1. Executive Summary

This document specifies the design for a new, highly customizable built-in code component, **`EmblaCarousel`**, based on [Embla Carousel](https://github.com/davidjerleke/embla-carousel) (v8/v9) and its official plugin ecosystem. 

Unlike the legacy `Carousel` component (which is built on Framer Motion and limited to single-slide transitions), `EmblaCarousel` provides:
- Multi-slide layouts with responsive visible slide counts (1–6, custom percentage/pixels for peeking effects, or auto-width).
- Flexible scroll modes: single-slide step, full-page/visible group scrolling (`slidesToScroll: 'auto'`), or custom count.
- Full suite of official Embla plugins: Autoplay (with pause on hover), AutoScroll (continuous smooth marquee movement), Fade (cross-fade transition), Wheel Gestures, and Auto Height.
- Highly customizable built-in navigation (arrows and pagination with dots, pills, fraction numbers, or progress bar).
- **Canvas-connected external triggers:** visual handles on the canvas (◀ Prev, ▶ Next) that allow dragging connection wires to link *any* button, icon, or frame on the page layout as a remote navigation controller.

---

## 2. Architecture & Ecosystem Integration

### 2.1 Dependencies
The project will install the following packages in `package.json`:
- `embla-carousel`: Core physics and calculation engine.
- `embla-carousel-react`: Official React hook (`useEmblaCarousel`).
- `embla-carousel-autoplay`: Periodic slide switching with pause triggers.
- `embla-carousel-auto-scroll`: Smooth infinite marquee scrolling.
- `embla-carousel-fade`: Cross-fade opacity animations.
- `embla-carousel-auto-height`: Container height adjustment matching the active slide.
- `embla-carousel-wheel-gestures`: Mouse wheel and touchpad scroll support.

### 2.2 Sandbox & Runtime Resolution (`code-component-runtime.ts`)
In order for the sandboxed canvas iframe (`CodeComponentHost.tsx`) and preview environments to execute code components without runtime bundle errors or network latency, the packages are registered in `MODULE_MAP`:
```ts
import useEmblaCarousel from 'embla-carousel-react';
import Autoplay from 'embla-carousel-autoplay';
import AutoScroll from 'embla-carousel-auto-scroll';
import Fade from 'embla-carousel-fade';
import AutoHeight from 'embla-carousel-auto-height';
import { wheelGestures } from 'embla-carousel-wheel-gestures';

// Inside MODULE_MAP:
'embla-carousel-react': { default: useEmblaCarousel, useEmblaCarousel },
'embla-carousel-autoplay': { default: Autoplay, Autoplay },
'embla-carousel-auto-scroll': { default: AutoScroll, AutoScroll },
'embla-carousel-fade': { default: Fade, Fade },
'embla-carousel-auto-height': { default: AutoHeight, AutoHeight },
'embla-carousel-wheel-gestures': { default: wheelGestures, wheelGestures },
```

---

## 3. Component Specification (`EmblaCarousel.ts`)

The component template lives in `src/code/project/default-code-components/EmblaCarousel.ts` and is exposed via `default-code-components/index.ts` and registered in `project-fs.ts`.

### 3.1 `@controls` Schema

The component exposes rich visual controls organized into logical popups and groups:

```json
/** @label "Embla Carousel" */
/** @comment "A fluid, highly customizable slider powered by Embla Carousel with multi-slide, marquee, and external trigger support." */
/** @defaultWidth 800 */
/** @defaultHeight 450 */
/** @controls {
  "children": { "type": "slot", "label": "Slides", "slotMax": "infinite" },

  "layout": { "type": "group", "label": "Layout & Slides", "controls": {
    "visibleSlides": { "type": "select", "label": "Visible Slides", "default": "1", "options": [
      { "label": "1 Slide", "value": "1" },
      { "label": "2 Slides", "value": "2" },
      { "label": "3 Slides", "value": "3" },
      { "label": "4 Slides", "value": "4" },
      { "label": "5 Slides", "value": "5" },
      { "label": "6 Slides", "value": "6" },
      { "label": "Custom (Peeking)", "value": "custom" },
      { "label": "Auto (Content)", "value": "auto" }
    ]},
    "customSlideWidth": { "type": "text", "label": "Slide Width", "default": "80%" },
    "gap": { "type": "number", "label": "Slide Gap", "min": 0, "max": 120, "step": 2, "default": 16 },
    "align": { "type": "select", "label": "Alignment", "default": "start", "options": [
      { "label": "Start", "value": "start" },
      { "label": "Center", "value": "center" },
      { "label": "End", "value": "end" }
    ]},
    "axis": { "type": "select", "label": "Axis", "default": "horizontal", "options": [
      { "label": "Horizontal", "value": "horizontal" },
      { "label": "Vertical", "value": "vertical" }
    ]},
    "direction": { "type": "select", "label": "Direction", "default": "ltr", "options": [
      { "label": "Left to Right (LTR)", "value": "ltr" },
      { "label": "Right to Left (RTL)", "value": "rtl" }
    ]}
  }},

  "scroll": { "type": "group", "label": "Scroll & Physics", "controls": {
    "scrollMode": { "type": "select", "label": "Scroll Mode", "default": "single", "options": [
      { "label": "Single Slide", "value": "single" },
      { "label": "Full Page (All Visible)", "value": "page" },
      { "label": "Custom Count", "value": "custom" }
    ]},
    "slidesToScrollCustom": { "type": "number", "label": "Scroll Count", "min": 1, "max": 10, "step": 1, "default": 1 },
    "loop": { "type": "toggle", "label": "Infinite Loop", "default": true },
    "dragFree": { "type": "select", "label": "Drag Momentum", "default": "none", "options": [
      { "label": "Off (Snap Only)", "value": "none" },
      { "label": "Free Momentum", "value": "free" },
      { "label": "Free + Snap", "value": "snap" }
    ]},
    "containScroll": { "type": "select", "label": "Contain Scroll", "default": "trimSnaps", "options": [
      { "label": "Trim Snaps", "value": "trimSnaps" },
      { "label": "Keep Snaps", "value": "keepSnaps" },
      { "label": "None", "value": "none" }
    ]},
    "duration": { "type": "number", "label": "Snap Speed", "min": 10, "max": 60, "step": 1, "default": 25 },
    "wheelGestures": { "type": "toggle", "label": "Wheel Gestures", "default": false },
    "autoHeight": { "type": "toggle", "label": "Auto Height", "default": false }
  }},

  "motion": { "type": "group", "label": "Autoplay & Motion", "controls": {
    "autoplayMode": { "type": "select", "label": "Auto Motion", "default": "off", "options": [
      { "label": "Off", "value": "off" },
      { "label": "Step Autoplay", "value": "autoplay" },
      { "label": "Continuous Marquee", "value": "autoScroll" }
    ]},
    "autoplayDelay": { "type": "number", "label": "Step Interval (s)", "min": 1, "max": 15, "step": 0.5, "default": 4 },
    "pauseOnHover": { "type": "toggle", "label": "Pause on Hover", "default": true },
    "marqueeSpeed": { "type": "number", "label": "Marquee Speed", "min": 0.5, "max": 10, "step": 0.5, "default": 2 },
    "marqueeDirection": { "type": "select", "label": "Marquee Direction", "default": "forward", "options": [
      { "label": "Forward", "value": "forward" },
      { "label": "Backward", "value": "backward" }
    ]},
    "effect": { "type": "select", "label": "Transition Effect", "default": "slide", "options": [
      { "label": "Slide", "value": "slide" },
      { "label": "Fade", "value": "fade" }
    ]}
  }},

  "arrows": { "type": "group", "label": "Built-in Arrows", "controls": {
    "arrowsShow": { "type": "toggle", "label": "Show Arrows", "default": true },
    "arrowsPosition": { "type": "select", "label": "Position", "default": "inside-sides", "options": [
      { "label": "Inside Sides", "value": "inside-sides" },
      { "label": "Outside Sides", "value": "outside-sides" },
      { "label": "Bottom Right", "value": "bottom-right" },
      { "label": "Bottom Center", "value": "bottom-center" }
    ]},
    "arrowsOffset": { "type": "number", "label": "Offset (px)", "min": -60, "max": 60, "step": 2, "default": 16 },
    "arrowsSize": { "type": "number", "label": "Button Size", "min": 24, "max": 80, "step": 2, "default": 40 },
    "arrowsRadius": { "type": "number", "label": "Corner Radius (%)", "min": 0, "max": 50, "step": 5, "default": 50 },
    "arrowsFill": { "type": "color", "label": "Background", "default": "rgba(0,0,0,0.5)" },
    "arrowsColor": { "type": "color", "label": "Icon Color", "default": "#ffffff" }
  }},

  "dots": { "type": "group", "label": "Pagination & Indicators", "controls": {
    "dotsShow": { "type": "toggle", "label": "Show Indicators", "default": true },
    "dotsFormat": { "type": "select", "label": "Format", "default": "dots", "options": [
      { "label": "Dots", "value": "dots" },
      { "label": "Pills / Bars", "value": "pills" },
      { "label": "Fraction (01 / 05)", "value": "fraction" },
      { "label": "Progress Bar", "value": "progressBar" }
    ]},
    "dotsPosition": { "type": "select", "label": "Position", "default": "bottom-center", "options": [
      { "label": "Bottom Center", "value": "bottom-center" },
      { "label": "Bottom Left", "value": "bottom-left" },
      { "label": "Top Right", "value": "top-right" }
    ]},
    "dotsSize": { "type": "number", "label": "Size / Height", "min": 4, "max": 24, "step": 1, "default": 8 },
    "dotsGap": { "type": "number", "label": "Gap", "min": 2, "max": 24, "step": 1, "default": 8 },
    "dotsColor": { "type": "color", "label": "Inactive Color", "default": "rgba(255,255,255,0.35)" },
    "dotsActiveColor": { "type": "color", "label": "Active Color", "default": "#ffffff" }
  }},

  "activeSlideIndex": { "type": "number", "label": "Active Slide (Canvas)", "min": 0, "max": 50, "step": 1, "default": 0 }
} */
```

### 3.2 Slide Sizing Calculation
Slide sizing is resolved per slide:
- `visibleSlides === "1"`: `flex: 0 0 100%`
- `visibleSlides === "N"`: `flex: 0 0 calc((100% - ${(N - 1) * gap}px) / ${N})`
- `visibleSlides === "custom"`: `flex: 0 0 ${customSlideWidth}`
- `visibleSlides === "auto"`: `flex: 0 0 auto`

---

## 4. Canvas-Wired External Navigation

### 4.1 Visual Handles (`CarouselTriggerHandle.tsx`)
When a node with `isCodeComponent` representing `EmblaCarousel` is selected on the canvas:
1. Two distinct circular pill handles render on the canvas:
   - **◀ Prev Handle** (tinted indigo/purple, positioned at the left edge or bottom-left).
   - **▶ Next Handle** (positioned at the right edge or bottom-right).
2. On drag start:
   - Draws a live bezier/stepped connector line from the handle to the mouse cursor.
   - Highlights any target canvas element (button, icon, frame) beneath the pointer.
3. On drop:
   - Identifies the target element's `data-id`.
   - Queues a mutation via AST transform to apply attributes to the target element:
     ```tsx
     <Button
       data-id="btn-3"
       data-carousel-target="embla-carousel-1"
       data-carousel-action="next"
     >
       Next Slide
     </Button>
     ```

### 4.2 Persistent Connectors (`CarouselTriggerConnectors.tsx`)
On the canvas overlay:
- Detects any elements matching `[data-carousel-target="<id>"]`.
- Computes edge-to-edge paths between the carousel and the connected buttons using `generateSteppedPath`.
- Renders dashed or solid lines indicating active bindings.

### 4.3 Runtime Listener & Disabled State
In both live sites and canvas preview:
1. `EmblaCarousel` registers a delegated click listener on `window` / container:
   ```ts
   const handleClick = (e: MouseEvent) => {
     const el = (e.target as HTMLElement).closest(`[data-carousel-target="${carouselId}"]`);
     if (!el) return;
     const action = el.getAttribute('data-carousel-action');
     if (action === 'prev') emblaApi?.scrollPrev();
     if (action === 'next') emblaApi?.scrollNext();
   };
   ```
2. On `select` and `reInit` events:
   - Queries `document.querySelectorAll(`[data-carousel-target="${carouselId}"]`)`.
   - For `action === 'prev'`, sets `disabled` (if button) and `data-disabled={!emblaApi.canScrollPrev()}`.
   - For `action === 'next'`, sets `disabled` (if button) and `data-disabled={!emblaApi.canScrollNext()}`.
   - External buttons automatically reflect standard disabled styling (`opacity: 0.4`, `cursor: not-allowed`).

---

## 5. Canvas vs Preview Behavior

Using `@revyme/runtime`'s `useStaticCanvas()`:
- **On Canvas (`isStatic === true`)**:
  - `Autoplay` and `AutoScroll` plugins are disabled/paused so content doesn't move autonomously during editing.
  - Interactive drag and arrow clicking remain active for testing.
  - The inspector exposes `activeSlideIndex`, allowing designers to immediately switch to and edit any specific slide.
- **In Live Preview & Production (`isStatic === false`)**:
  - Full autoplay, continuous marquee auto-scroll, and responsive animations execute naturally.

---

## 6. Implementation Steps

1. **Install Packages:**
   `npm install embla-carousel embla-carousel-react embla-carousel-autoplay embla-carousel-auto-scroll embla-carousel-fade embla-carousel-auto-height embla-carousel-wheel-gestures`
2. **Register in Runtime:**
   Update `src/canvas/code-component-runtime.ts` to export all Embla modules in `MODULE_MAP`.
3. **Create Default Template:**
   Author `src/code/project/default-code-components/EmblaCarousel.ts`.
4. **Export and Register:**
   Add `EMBLA_CAROUSEL_COMPONENT` to `default-code-components/index.ts` and `project-fs.ts`.
5. **Implement External Trigger Handle & Connectors:**
   Author `src/canvas/ui/CarouselTriggerHandle.tsx` and `src/canvas/ui/CarouselTriggerConnectors.tsx`, wire into `Canvas.tsx`.
6. **AST Generator Support:**
   Add `setCarouselTriggerInCode` and `removeCarouselTriggerInCode` in `src/code/generation/carousel-trigger-ops.ts`.
7. **Verification & Tests:**
   Write unit tests for controls parsing, trigger mutations, and runtime compilation.
