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

---

## 4. Decision Rule of Thumb for AI Agents

1. **Is it a repeating UI pattern like a Card, Row, Button, Testimonial, Badge, or Item?**
   $\rightarrow$ **YES**: Must be a **Design Component** created via `create_component` or `extract_component`.
2. **Does it need custom `useState`, `useEffect`, `useRef`, Canvas 2D/WebGL, or dynamic SVG calculations?**
   $\rightarrow$ **YES**: Must be a **Code Component** with `/** @controls */` written to `components/<Name>.tsx`.
3. **Never create a Code Component for standard layout structures**: If an element is just HTML/SVG frames, flex layouts, typography, and standard CSS/motion styles, it **MUST be a Design Component**.
