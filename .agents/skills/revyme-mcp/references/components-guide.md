# Design Components vs Code Components in Revyme Builder

In Revyme Website Builder, there are two distinct categories of components in `components/<Name>.tsx`. Choosing the correct one is fundamental to how the visual builder, the canvas layer tree, and the user editing experience operate.

---

## 1. Quick Comparison

| Characteristic | Design Component (Дизайн-компонент) | Code Component (Кодовий компонент) |
| :--- | :--- | :--- |
| **Primary Purpose** | Reusable visual UI building blocks (cards, buttons, list rows, headers, banners, pricing tiers, badges, footers). | Custom interactive widgets, canvas 2D/WebGL shaders, complex scroll mathematics, third-party libraries, stateful apps. |
| **Canvas Experience** | **Fully Canvas-Native**: Every inner node is visible in the Layers panel, directly selectable by double-clicking, styleable with the visual Style panel, and supports visual variant switching. | **Black Box**: Rendered inside `CodeComponentHost`. Inner elements cannot be individually clicked or styled on the canvas. Configured via the Props panel using `@controls`. |
| **Source File Marker** | **NO `@controls`**. Contains `/** @name "Name" */`, `export const variantConfig = [...]`, typed props with defaults, and `export default withResponsiveProps(Name)`. | **MUST HAVE `/** @controls { ... } */`** JSDoc annotation. Contains custom React hooks (`useState`, `useEffect`, `useRef`), complex JS, or external libraries. |
| **Variants vs Controls** | Has visual states defined in `variantConfig` (`default`, `hover`, `active`, etc.) editable on the canvas. | Parameterized via `@controls` schema (`text`, `number`, `color`, `boolean`, `select`, `image`, `upload`). |
| **Oracle Verification** | **Strict Canvas Rules**: Valid `data-id` on every node, in-flow layout, CSS camelCase, no unmanaged JS expressions in JSX. | **Lax (Black Box)**: Oracle allows custom JS, hooks, math, and external libraries. |
| **Authoring Method** | Use semantic agent tool **`create_component`** (or **`extract_component`**). | Write source code to `components/<Name>.tsx` using **`revyme_submit_files`** (or code editor). |

---

## 2. Design Components

### When to Use
Use a **Design Component** whenever you are building reusable layout sections or UI elements that human designers/users should be able to:
- Double-click on the canvas to inspect and edit inner elements.
- Select inner layers in the Layers tree and change their styles (colors, fonts, padding, borders).
- Create visual variants (e.g. `default`, `compact`, `highlighted`) directly on the canvas.
- Bind instance props (`title`, `price`, `tag`, `description`, `iconVisible`) via the right-hand panel.

### Canonical Design Component Master Template
```tsx
"use client";

import React from "react";
import { withResponsiveProps } from "@revyme/runtime";
import { motion } from "framer-motion"; // optional, only if motion tags are used

/** @name "PricingCard" */
/** @propMeta {"title":{"type":"plainText"},"price":{"type":"plainText"},"highlighted":{"type":"toggle"}} */
export const variantConfig = [
  { name: 'default', label: 'Default', x: 0, y: 0, isPrimary: true },
  { name: 'highlight', label: 'Highlight', x: 100, y: 0 }
];

function PricingCard({
  style,
  title = "Starter Tier",
  price = "$29",
  highlighted = false,
  initialVariant = 'default',
}: {
  style?: React.CSSProperties;
  title?: string;
  price?: string;
  highlighted?: boolean;
  initialVariant?: string;
}) {
  return (
    <div
      data-id="pricing-card-root"
      data-name="Pricing Card"
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        padding: '32px',
        backgroundColor: '#FFFFFF',
        border: '1px solid rgba(0, 0, 0, 0.1)',
        boxSizing: 'border-box',
        ...style,
      }}
    >
      <span
        data-id="card-title"
        data-name="Title"
        style={{
          position: 'relative',
          fontSize: '18px',
          fontWeight: 600,
          color: '#111827',
        }}
      >
        {title}
      </span>
      <span
        data-id="card-price"
        data-name="Price"
        style={{
          position: 'relative',
          fontSize: '32px',
          fontWeight: 700,
          color: '#111827',
          marginTop: '12px',
        }}
      >
        {price}
      </span>
    </div>
  );
}

export default withResponsiveProps(PricingCard);
```

### How to Create a Design Component via MCP
Do NOT write design components with raw file edits. Always use the semantic agent tools:

1. **Declarative Creation (`create_component`)**:
```json
{
  "tool": "revyme_agent_tool",
  "input": {
    "name": "create_component",
    "input": {
      "name": "SpecItem",
      "props": [
        { "name": "tag", "type": "string", "default": "SPEC // 01" },
        { "name": "description", "type": "string", "default": "Cold-machined naval brass" },
        { "name": "value", "type": "string", "default": "48.2 g" }
      ],
      "variants": [
        { "name": "highlight", "label": "Highlight" }
      ],
      "layout": [
        {
          "tag": "div",
          "dataId": "spec-row",
          "style": { "display": "flex", "flexDirection": "row", "justifyContent": "space-between", "padding": "14px 0px" },
          "children": [
            { "tag": "span", "text": "{tag}", "style": { "color": "#2C4A8F", "fontWeight": "700" } },
            { "tag": "span", "text": "{description}", "style": { "color": "#4A5364" } },
            { "tag": "span", "text": "{value}", "style": { "color": "#141C2B", "fontWeight": "700" } }
          ]
        }
      ]
    }
  }
}
```

2. **Extract from Existing Canvas Node (`extract_component`)**:
```json
{
  "tool": "revyme_agent_tool",
  "input": {
    "name": "extract_component",
    "input": {
      "node_id": "hero-pricing-card",
      "name": "PricingCard"
    }
  }
}
```

3. **Instantiate on Page**:
```json
{
  "tool": "revyme_agent_tool",
  "input": {
    "name": "add_component_instance",
    "input": {
      "name": "SpecItem",
      "parent_id": "measurements-list",
      "props": {
        "tag": "DIM // 01",
        "description": "Total length capped",
        "value": "142.0 mm"
      }
    }
  }
}
```

### Canonical Header & Navbar Design Component with Fullscreen Drawer
A site navigation bar with an interactive drawer is best modeled as a **Design Component** with `default` and `menu-open` variants:

```tsx
"use client";

import React, { useState } from "react";
import { withResponsiveProps } from "@revyme/runtime";

/** @name "Navbar" */
export const variantConfig = [
  { name: 'default', label: 'Default (Closed)', x: 0, y: 0, isPrimary: true },
  { name: 'menu-open', label: 'Menu Open', x: 0, y: 300 }
];

// Native Revyme connections: clicking hamburger opens menu; clicking close button resets to default
export const variantConnections = [
  { from: 'default', to: 'menu-open', trigger: 'click', sourceNode: 'header-hamburger-btn' },
  { from: 'menu-open', to: 'default', trigger: 'click', sourceNode: 'drawer-close-btn' }
];

function Navbar({
  initialVariant = 'default',
  studioName = 'STUDIO',
  style,
}: {
  initialVariant?: string;
  studioName?: string;
  style?: React.CSSProperties;
}) {
  const [variant, setVariant] = useState(initialVariant);
  const [prevInitial, setPrevInitial] = useState(initialVariant);
  if (initialVariant !== prevInitial) {
    setPrevInitial(initialVariant);
    setVariant(initialVariant);
  }

  return (
    <motion.div
      data-id="site-nav-root"
      data-name="Navbar"
      style={{
        position: 'relative', // Rule 1: Never position: fixed/sticky on master root! Page instance carries sticky.
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--color-bg)',
        ...style,
      }}
    >
      <header
        data-id="site-header"
        data-name="Site Header Bar"
        style={{
          width: '100%',
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '20px 48px',
          borderBottom: '1px solid var(--color-border)',
          boxSizing: 'border-box',
          order: '0',
          flex: '0 0 auto', // Rule 4: order + flex: '0 0 auto' on flex children
        }}
      >
        <div data-id="header-brand" style={{ display: 'flex', alignItems: 'center', gap: '16px', order: '0', flex: '0 0 auto' }}>
          <span data-id="header-logo" style={{ fontSize: '24px', fontWeight: 700, color: 'var(--color-text)' }}>
            {studioName}
          </span>
          <span data-id="header-status-pill" style={{ fontSize: '11px', padding: '4px 12px', border: '1px solid var(--color-border)', borderRadius: '100px', color: 'var(--color-text-secondary)' }}>
            ● AVAILABLE FOR COMMISSIONS
          </span>
        </div>

        {/* Desktop links group */}
        <div data-id="header-nav-items" style={{ display: 'flex', flexDirection: 'row', gap: '32px', order: '1', flex: '0 0 auto' }}>
          <a data-id="nav-link-1" href="#work" style={{ color: 'var(--color-text)', textDecoration: 'none', fontSize: '13px' }}>01 / WORK</a>
          <a data-id="nav-link-2" href="#manifesto" style={{ color: 'var(--color-text)', textDecoration: 'none', fontSize: '13px' }}>02 / MANIFESTO</a>
          <a data-id="nav-link-3" href="#contact" style={{ color: 'var(--color-text)', textDecoration: 'none', fontSize: '13px' }}>03 / CONTACT</a>
        </div>

        <div data-id="header-actions" style={{ display: 'flex', alignItems: 'center', gap: '16px', order: '2', flex: '0 0 auto' }}>
          <button data-id="header-inquire-btn" style={{ padding: '8px 18px', backgroundColor: 'var(--color-inverse-bg)', color: 'var(--color-inverse-text)', borderRadius: '6px', fontSize: '12px' }}>
            INQUIRE [↗]
          </button>
          <motion.button
            data-id="header-hamburger-btn"
            onTap={() => setVariant('menu-open')}
            style={{
              display: 'none', // NEVER visible on desktop!
              alignItems: 'center',
              padding: '8px 16px',
              backgroundColor: 'var(--color-bg)',
              border: '1px solid var(--color-border)',
              borderRadius: '6px',
              color: 'var(--color-text)',
              fontSize: '12px',
              cursor: 'pointer',
            }}
          >
            [≡] MENU
          </motion.button>
        </div>
      </header>

      {/* OVERLAY DRAWER - Rule 2 (popLayout + key + layout) & Rule 3 (exact variant ===) */}
      <AnimatePresence mode="popLayout">
        {variant === 'menu-open' && (
          <motion.div
            key="nav-fullscreen-overlay"
            data-id="nav-fullscreen-overlay"
            layout={true}
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ type: 'spring', stiffness: 350, damping: 25 }}
            style={{
              position: 'absolute',
              top: '0px',
              left: '0px',
              width: '100%',
              height: '100vh',
              zIndex: 90,
              backgroundColor: 'var(--color-bg)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              padding: '100px 48px 48px 48px',
              boxSizing: 'border-box',
              overflowY: 'scroll',
            }}
          >
            <div data-id="drawer-top-bar" style={{ display: 'flex', justifyContent: 'flex-end', order: '0', flex: '0 0 auto' }}>
              <motion.button
                data-id="drawer-close-btn"
                onTap={() => setVariant('default')}
                style={{
                  padding: '8px 16px',
                  backgroundColor: 'var(--color-inverse-bg)',
                  color: 'var(--color-inverse-text)',
                  borderRadius: '6px',
                  fontSize: '12px',
                  cursor: 'pointer',
                  zIndex: 120,
                }}
              >
                [✕] CLOSE
              </motion.button>
            </div>
            <div data-id="drawer-links" style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '1200px', margin: '0 auto', width: '100%', order: '1', flex: '0 0 auto' }}>
              <a href="#work" onClick={() => setVariant('default')} style={{ fontSize: 'clamp(2.5rem, 6vw, 4rem)', fontWeight: 800, color: 'var(--color-text)', textDecoration: 'none' }}>01 / SELECTED WORK</a>
              <a href="#manifesto" onClick={() => setVariant('default')} style={{ fontSize: 'clamp(2.5rem, 6vw, 4rem)', fontWeight: 800, color: 'var(--color-text)', textDecoration: 'none' }}>02 / MANIFESTO</a>
              <a href="#contact" onClick={() => setVariant('default')} style={{ fontSize: 'clamp(2.5rem, 6vw, 4rem)', fontWeight: 800, color: 'var(--color-text)', textDecoration: 'none' }}>03 / DIRECT INQUIRIES</a>
            </div>
            <div data-id="drawer-footer" style={{ borderTop: '1px solid var(--color-border)', paddingTop: '24px', maxWidth: '1200px', margin: '0 auto', width: '100%', display: 'flex', justifyContent: 'space-between', order: '2', flex: '0 0 auto' }}>
              <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)', fontFamily: 'var(--typo-mono-font)' }}>NYC — 40.7128° N, 74.0060° W</span>
              <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)', fontFamily: 'var(--typo-mono-font)' }}>KYIV — 50.4501° N, 30.5234° E</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default withResponsiveProps(Navbar);
```

> **CRITICAL INVARIANTS FOR NAVBAR MASTERS & INSTANCES:**
> 1. **Master Root vs Instance Placement**: The master component root in `components/Navbar.tsx` MUST use `position: 'absolute'` (or relative/flow), NEVER `position: 'fixed'` (`COMPONENT_ROOT_POSITION`). `position: 'fixed'` is applied strictly to the **page instance** in `app/page.client.tsx` directly under the page root (`FIXED_DEPTH`).
> 2. **Z-Index Layering**: The top bar must carry `zIndex: 110` (and close button `120`), while the fullscreen drawer has `zIndex: 90`. This ensures the close button is always reachable and not blocked by the backdrop.
> 3. **Overflow Keywords**: The Oracle strictly permits `visible | hidden | scroll | clip`. Values like `auto` trigger Oracle rejection.
> 4. **No `className`**: Scoped styles or inline styles must use `[data-id="..."]` selectors only (`CLASSNAME_STYLING`).


---

## 3. Code Components

### When to Use
Use a **Code Component** only when custom React runtime logic or special browser APIs are strictly required:
- Complex scroll animations with continuous frame interpolation (e.g. `TravellingProduct`).
- Interactive SVG vector self-drawing measuring path geometry (`getTotalLength()`, `strokeDashoffset`).
- Canvas 2D / WebGL / Three.js shaders or particle simulations.
- Custom physics engines or complex state machines.
- Integrations with third-party JavaScript libraries or media APIs.

### Canonical Code Component Template
```tsx
'use client';

/** @label "Vector Drawing Canvas" */
/** @comment "Interactive drawing simulation with real-time stroke metrics" */
/** @defaultWidth 600 */
/** @defaultHeight 400 */
/** @controls {
  "strokeWidth": { "type": "number", "label": "Stroke Width (px)", "min": 1, "max": 10, "default": 2 },
  "inkColor": { "type": "color", "label": "Ink Color", "default": "#141C2B" },
  "autoPlay": { "type": "boolean", "label": "Auto Play Animation", "default": true }
} */

import React, { useEffect, useRef, useState } from 'react';
import { withResponsiveProps } from '@revyme/runtime';

interface VectorCanvasProps {
  strokeWidth?: number;
  inkColor?: string;
  autoPlay?: boolean;
  style?: React.CSSProperties;
}

function VectorCanvas(props: VectorCanvasProps) {
  const [progress, setProgress] = useState(0);
  const pathRef = useRef<SVGPathElement>(null);

  useEffect(() => {
    // Custom React hooks, rAF loops, Canvas/SVG calculations
    let frame: number;
    const startTime = performance.now();
    const animate = (now: number) => {
      const elapsed = (now - startTime) / 2000;
      setProgress(Math.min(1, elapsed));
      if (elapsed < 1) frame = requestAnimationFrame(animate);
    };
    if (props.autoPlay) frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [props.autoPlay]);

  return (
    <div
      data-id="vector-canvas-root"
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        ...props.style,
      }}
    >
      <svg width="100%" height="100%" viewBox="0 0 600 400">
        <path
          ref={pathRef}
          d="M 50,200 Q 300,50 550,200"
          fill="none"
          stroke={props.inkColor || '#141C2B'}
          strokeWidth={props.strokeWidth || 2}
          strokeDasharray="1000"
          strokeDashoffset={1000 * (1 - progress)}
        />
      </svg>
    </div>
  );
}

export default withResponsiveProps(VectorCanvas);
```

### 3.1 The Canvas Multi-Viewport Responsive Trap & The 4-Layer Solution (CRITICAL)

#### Why standard CSS `@media` fails on the Builder Canvas
On the Revyme visual canvas, all device viewports (Desktop 1200px, Tablet 810px, Mobile 390px) render side-by-side inside **one single iframe** whose window width is $>2400\text{px}$.
A traditional CSS media query like `@media (max-width: 480px)` evaluates against `window.innerWidth`. Inside the canvas iframe, `window.innerWidth` is always large ($>2400\text{px}$). Consequently:
- `@media (max-width: 480px)` **never triggers on the mobile artboard** during visual editing.
- Components styled purely with `@media` render with desktop sizing (e.g. 110px font size or fixed large widths), overflowing and breaking the mobile canvas tile.
- Yet in standalone Preview mode (where the browser window is resized to 390px), `@media` triggers normally, creating a confusing mismatch where preview looks fine but canvas is broken!

#### The 4-Layer Solution for Bulletproof Responsiveness
Every Code Component that contains large text, complex stage layouts, or canvas/WebGL graphics must implement the 4-layer responsive strategy:

1. **`ResizeObserver` Container Measurement**:
   Directly track the actual rendered container width (`clientWidth`) via a React ref and `ResizeObserver`. This guarantees responsive logic updates dynamically when rendered inside any artboard tile, regardless of iframe window size:
   ```tsx
   const containerRef = useRef<HTMLDivElement>(null);
   const [containerWidth, setContainerWidth] = useState(1200);

   useEffect(() => {
     if (!containerRef.current) return;
     const ro = new ResizeObserver((entries) => {
       for (const entry of entries) {
         setContainerWidth(entry.contentRect.width);
       }
     });
     ro.observe(containerRef.current);
     return () => ro.disconnect();
   }, []);

   const isMobile = containerWidth <= 500;
   const isTablet = containerWidth > 500 && containerWidth <= 850;
   const wordmarkSize = isMobile ? '44px' : isTablet ? '72px' : '110px';
   ```

2. **CSS Container Queries (`@container`)**:
   Revyme wraps each canvas artboard in a container declaring `container-type: inline-size`. Scoped container queries inside `<style>` evaluate against the artboard width:
   ```css
   @container (max-width: 500px) {
     [data-id="hero-wordmark"] {
       font-size: 44px !important;
       letter-spacing: -0.02em !important;
     }
   }
   ```

3. **Canvas Artboard Scoping (`[data-viewport="mobile"]`)**:
   Revyme stamps the active viewport name onto the canvas wrapper (`data-viewport="mobile"` and `data-viewport="tablet"`). Explicitly scope critical sizing overrides:
   ```css
   [data-viewport="mobile"] [data-id="hero-wordmark"] {
     font-size: 44px !important;
   }
   [data-viewport="tablet"] [data-id="hero-wordmark"] {
     font-size: 72px !important;
   }
   ```

4. **Standard CSS `@media` Queries**:
   Retain standard `@media (max-width: 500px)` rules in the scoped `<style>` block for standalone Preview mode and Next.js static/production builds.

---

### 3.2 Binding Code Components to Built-in CMS Collections (`@/cms/*.json`)

When building dynamic or data-driven code components (e.g. interactive discographies, 3D card decks, carousels, or timeline tables), connect the component to Revyme's native CMS:

1. **Create the CMS Schema** using `cms.schema.create`:
   ```json
   {
     "name": "roster",
     "fields": [
       { "name": "code", "type": "text", "label": "Catalog Code" },
       { "name": "artist", "type": "text", "label": "Artist Name" },
       { "name": "title", "type": "text", "label": "Album Title" },
       { "name": "year", "type": "text", "label": "Release Year" },
       { "name": "image", "type": "image", "label": "Artwork URL" }
     ]
   }
   ```
2. **Seed Initial CMS Items** using `cms.items.create`:
   ```json
   {
     "collection": "roster",
     "item": {
       "code": "AUR-001",
       "artist": "ALVA NOTO",
       "title": "HYBR:ID III",
       "year": "2024",
       "image": "https://images.unsplash.com/..."
     }
   }
   ```
3. **Import CMS Collection in the Code Component**:
   ```tsx
   'use client';
   
   /** @label "Interactive Roster" */
   /** @controls {
     "accentColor": { "type": "color", "label": "Accent Color", "default": "#E8913C" }
   } */

   import React, { useState, useRef } from 'react';
   import { withResponsiveProps } from '@revyme/runtime';
   import rosterData from '@/cms/roster.json';

   interface RosterItem {
     id: string;
     code: string;
     artist: string;
     title: string;
     year: string;
     image?: string;
   }

   interface Props {
     items?: RosterItem[];
     accentColor?: string;
     style?: React.CSSProperties;
   }

   function InteractiveRoster(props: Props) {
     // Use passed items prop or fallback to live CMS collection data
     const activeItems: RosterItem[] = (props.items && props.items.length > 0) ? props.items : rosterData;
     const [hoveredId, setHoveredId] = useState<string | null>(null);

     return (
       <div data-id="roster-container" style={{ display: 'flex', flexDirection: 'column', width: '100%', ...props.style }}>
         {activeItems.map((item) => (
           <div
             key={item.id || item.code}
             data-id={`roster-row-${item.code.toLowerCase()}`}
             onMouseEnter={() => setHoveredId(item.id)}
             style={{ display: 'flex', justifyContent: 'space-between', padding: '16px 0', borderBottom: '1px solid rgba(255,255,255,0.08)' }}
           >
             <span style={{ fontFamily: 'monospace', color: props.accentColor || '#E8913C' }}>{item.code}</span>
             <span style={{ fontWeight: 600 }}>{item.artist}</span>
             <span style={{ opacity: 0.6 }}>{item.title}</span>
           </div>
         ))}
       </div>
     );
   }

   export default withResponsiveProps(InteractiveRoster);
   ```
4. **Benefit**: The user can now edit, add, and reorder artists or items directly in Revyme's visual CMS panel, while the Code Component renders them with custom mouse parallax, audio playback, or RAF animations!

---

## 4. Decision Rule of Thumb for AI Agents

1. **Is it a repeating UI pattern like a Card, Row, Button, Testimonial, Badge, or Item?**
   $\rightarrow$ **YES**: Must be a **Design Component** created via `create_component` or `extract_component`.
2. **Does it need custom `useState`, `useEffect`, `useRef`, Canvas 2D/WebGL, or dynamic SVG calculations?**
   $\rightarrow$ **YES**: Must be a **Code Component** with `/** @controls */` written to `components/<Name>.tsx`.
3. **Never create a Code Component for standard layout structures**: If an element is just HTML/SVG frames, flex layouts, typography, and standard CSS/motion styles, it **MUST be a Design Component**.

---

## 5. Critical Anti-Pattern: The Duplicate Inlining Trap

### What went wrong in past agent executions
An agent authors `components/ProjectCard.tsx` and `components/MarqueeCard.tsx` with variant configs and props, but then in `app/page.client.tsx` or `insert_fragment`, pastes 400 lines of repeated raw `<div data-id="card-1">...</div>`, `<div data-id="card-2">...</div>`.

**This completely breaks Revyme's visual builder paradigm:**
1. **No Scalability / Reusability**: When the user wants to add a 4th card, they cannot just drop an instance or pass props. They are forced to copy-paste raw JSX and rewire 20 nested elements manually.
2. **Variants Break**: Component variants (such as `border-rounded`, `highlight`, or `compact`) cannot be toggled in the canvas inspector because raw divs have no component definition or `variantConfig`.
3. **Hover Effects Break**: If hover states or image filters (like grayscale-to-color reveals) are written as component variant styles (e.g. `filter: variant === 'default-hover' ? 'grayscale(0%)' : 'grayscale(100%)'`), they **only execute when rendered as component instances**. Inlined raw divs lose all variant-driven interactivity!

### The Correct Instantiation Pattern

Once a component exists in `components/<Name>.tsx`, instantiate it directly in `revyme_insert_fragment`:

```json
{
  "page": "app/page.client.tsx",
  "parentId": "portfolio-grid",
  "fragment": {
    "tag": "ProjectCard",
    "dataId": "proj-card-alpha",
    "name": "Project Card Alpha",
    "attrs": {
      "title": "Quantum Banking App",
      "category": "Fintech & Mobile UI",
      "image": "https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=800&q=80",
      "initialVariant": "default"
    },
    "style": {
      "flex": "1 1 340px",
      "width": "100%",
      "maxWidth": "420px"
    }
  }
}
```

### Automatic Import Resolution
Revyme's `syncImports` automatically inspects JSX tags. Whenever a tag begins with an uppercase letter (`/^[A-Z]/`) and matches a file in `components/<Tag>.tsx`, the builder **automatically injects**:
```tsx
import ProjectCard from '@/components/ProjectCard';
```
at the top of the file! You do not even need to edit imports manually. Just insert the tag and pass the props in `attrs`.
