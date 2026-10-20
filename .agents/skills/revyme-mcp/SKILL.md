---
name: revyme-mcp
description: >-
  Use this skill whenever the user asks to control, modify, generate designs, animate elements,
  author design components or code components, or manage CMS in the Revyme Website Builder via the Model Context Protocol (MCP) bridge.
---

# Revyme MCP Agent Skill

This skill guides the AI agent on how to interact with the **Revyme Website Builder** running in the browser via its local **MCP Bridge Server**.

## 1. MCP Configuration & Prerequisites

### Client Configuration (`mcp_config.json`)
For an agent (Antigravity, Claude Desktop, Cursor) to connect to the builder on a machine:
Add the following configuration to `~/.gemini/config/mcp_config.json` (or your client's MCP config):
```json
{
  "mcpServers": {
    "revyme-builder": {
      "command": "npx",
      "args": ["tsx", "server/mcp-server.ts"],
      "cwd": "/path/to/revyme-builder-fork"
    }
  }
}
```
> **Important**: Set `cwd` to the absolute path of the `revyme-builder-fork` repository on the current machine.

### Runtime Prerequisites
Before executing any tool calls, ensure that:
1. **Editor & Bridge are running**: Run `npm run dev` (starts editor on `http://localhost:3333` and HTTP bridge on `http://localhost:8082`).
2. **Browser tab is open & connected**: Open `http://localhost:3333` in the browser (the browser tab establishes an active SSE connection to port 8082).
3. **MCP Stdio Server**: The AI agent automatically launches `server/mcp-server.ts` via the `mcp_config.json` entry above (or manually via `npm run mcp`).

---

## 2. Communication Methods

The agent can send requests to the builder in two ways:
1. **Through MCP Tools directly** (Antigravity / Claude loaded tools):
   - `revyme_insert_fragment`: **PRIMARY TOOL for UI generation.** Atomically inserts entire subtrees (sections, cards, grids) with auto-generated IDs, native Framer Motion hovers, and responsive viewports (`tablet`, `mobile`).
   - `revyme_list_built_in_components`: Browse Revyme's ~80 built-in code components (Marquee, Carousel, shaders, text effects, cursors, embeds).
   - `revyme_add_built_in_component`: Install and place a built-in component (e.g. `Marquee`, `Carousel`, `AuroraBackground`) into any container.
   - `revyme_set_responsive_styles`: Set responsive overrides for `'tablet'` (810px) or `'mobile'` (375px) on any element.
   - `revyme_apply_motion_preset`: Applies calibrated spring animations (`lift-on-hover`, `scale-on-hover`, `fade-up`, `stagger-children`).
   - `revyme_manage_component_variant`: Creates and manages interactive variant states (`default-hover`, etc.) on Design Components.
   - `revyme_get_context`: Reads active page/component AST, tokens, and schemas.
   - `revyme_read_file`: Reads source code of any project file.
   - `revyme_list_files`: Lists all project files.
   - `revyme_submit_files`: Writes complete files. **Use strictly for Code Components (`@controls`) or non-visual logic. DO NOT use to overwrite whole pages when building UI.**
   - `revyme_manage_presets`: Manages design tokens in globals.css (colors, typography, radii).
   - `revyme_manage_cms`: Manages CMS collections, fields, and items.
   - `revyme_agent_tool`: Executes granular semantic builder operations (`create_component`, `set_motion`, `add_node`, etc.).
   - `revyme_agent_manifest`: Lists all available semantic agent tools.

2. **Through the Bridge HTTP RPC Endpoint**:
   If running via script or CLI:
   ```bash
   curl -X POST http://localhost:8082/rpc \
     -H "Content-Type: application/json" \
     -d '{"method": "agent.tool", "params": {"name": "add_node", "input": {...}}}'
   ```

---

## 3. The Revyme Built-In Arsenal (~80 Ready-Made Components)

Revyme includes a rich library of ~80 pre-built, GPU-optimized components. **NEVER write custom static divs or mock scroll implementations for features that already exist in the builder!**
Always check [references/built-in-arsenal.md](./references/built-in-arsenal.md) or call `revyme_list_built_in_components`.

- **Marquees & Tickers**: When the user asks for a ticker, client logo wall, or continuous scroll, **DO NOT code a fake `<div>`**. Use `revyme_add_built_in_component` with tag `"Marquee"`:
  ```json
  {
    "tag": "Marquee",
    "parent_id": "marquee-section",
    "props": { "speed": 60, "direction": "left", "gap": 32, "pauseOnHover": true, "fadeEdges": true }
  }
  ```
  Also available: `RibbonMarquee` (3D angled ribbon) and `Marquee3D` (isometric depth grid).
- **Carousels**: Use `Carousel` (touch/drag slider with dots) or `EmblaCarousel` (physics snap carousel).
- **Cursors (pointer-events: none)**: Use `BlobCursor` (organic fluid blob), `DesignCursor` (Figma coordinates crosshair), or `SplashCursor` (interactive WebGL fluid smoke splashes).
- **Text Effects**: Use `MorphingText`, `WordRotate`, `SpinningText`, `AnimatedCounter`, `TextPressure`, `MagneticText`, `TypingEffect`, or `GlitchText`.
- **WebGL2 Shaders & Backgrounds**: Use `AuroraBackground`, `MeshGradient`, `CausticsLight`, `LiquidMetal`, `LiquidChrome`, `GrainGradient`, `GemSmoke`, `Metaballs`, `CyberGrid`, or `MatrixRain`.
- **Noise & Utilities**: Use `FilmGrain`, `StaticTV`, `Accordion`, `ThemeToggle`, `CopyButton`.

---

## 4. Design Components vs Code Components (CRITICAL)

In Revyme, components in `components/<Name>.tsx` belong to two completely different paradigms. You **MUST** choose correctly based on the requirement:

```
                          ┌───────────────────────────┐
                          │   Component in Revyme     │
                          └─────────────┬─────────────┘
                                        │
             ┌──────────────────────────┴──────────────────────────┐
             ▼                                                     ▼
┌─────────────────────────┐                           ┌─────────────────────────┐
│    Design Component     │                           │     Code Component      │
│  (Canvas-Native Master) │                           │       (Black Box)       │
├─────────────────────────┤                           ├─────────────────────────┤
│ • NO @controls          │                           │ • MUST HAVE @controls   │
│ • Visually editable     │                           │ • Edited in Code Editor │
│ • Appears in Layers     │                           │ • Internal DOM hidden   │
│ • Has variantConfig     │                           │ • Custom hooks & state  │
│ • Authored via          │                           │ • Shaders, math, Canvas │
│   create_component /    │                           │ • Authored via          │
│   manage_component_var  │                           │   revyme_submit_files   │
└─────────────────────────┘                           └─────────────────────────┘
```

### A. Design Components (Native Canvas Masters)
- **What it is**: Reusable visual UI elements (cards, spec rows, buttons, pricing tables, navigation items, testimonial blocks, badges).
- **Canvas Experience**: Fully interactive and visual! Designers can double-click on the canvas to select inner elements, see all layers in the Layers panel, customize styles with the Style Inspector, reorder elements, and switch visual variants.
- **THE CARDINAL RULE: REPEATED CARDS MUST BE INSTANTIATED AS COMPONENTS, NEVER RAW DIVS!**:
  - Whenever building a page with repeated UI elements (Project Cards, Marquee Cards, Testimonial Cards, Pricing Tiers, Team Members):
    1. Define the Design Component master in `components/<Name>.tsx` with typed props (`title`, `image`, `tags`, `category`) and `variantConfig` (`default`, `variant-b`, `default-hover`).
    2. **ON THE PAGE, YOU MUST INSTANTIATE THE COMPONENT**:
       - In `revyme_insert_fragment`: use `"tag": "ProjectCard"`, `"name": "Project Card 1"`, and pass props in `"attrs": { "title": "...", "category": "..." }`.
       - Or in page JSX: `<ProjectCard data-id="card-1" title="..." ... />`.
    3. **CRITICAL ANTI-PATTERN STRICTLY FORBIDDEN**: Never write a component file and then copy-paste hundreds of lines of duplicate raw `<div>` blocks on the page!
       - Inlined raw divs prevent the user from editing props in the Inspector.
       - Inlined raw divs prevent the user from duplicating cards with one click or swapping variants in the panel.
       - Inlined raw divs BREAK component variant transitions (`default-hover`, etc.).
       - If the user wants to add a new project card, they should only need to add an instance of `<ProjectCard />`, not duplicate and rewire a massive raw div tree!
- **Navbars & Headers Rule**: When asked to create a navigation bar or header as a component, **NEVER build it as a closed Code Component with internal React `useState(false)` and `mixBlendMode: 'difference'`**. Instead:
  1. Build it directly on the page via `revyme_insert_fragment` with responsive desktop / mobile layout, OR
  2. Create a **Design Component** with visual variant states (`default` vs `mobile-open`) using `revyme_manage_component_variant` or `create_component`!
- **File Structure**:
  - `/** @name "ComponentName" */`
  - `export const variantConfig = [ { name: 'default', ... }, { name: 'highlight', ... } ];`
  - Typed props with defaults in destructuring: `function ComponentName({ style, tag = "...", initialVariant = 'default' }: Props)`
  - `export default withResponsiveProps(ComponentName);`
  - **NEVER include `/** @controls */`**.

### B. Code Components (Custom Logic & Shaders)
- **What it is**: Complex, stateful, or low-level components requiring custom React runtime logic, WebGL shaders, Canvas 2D drawings, complex keyframed scroll math, audio/video players, or third-party libraries.
- **Canvas Experience**: Rendered inside `CodeComponentHost` as a **black box**. Individual inner DOM nodes are not selectable or styleable on the canvas; configuration is exposed strictly via the Inspector's `@controls` panel.
- **File Structure**:
  - **MUST have `/** @controls { ... } */`** JSDoc annotation.
  - Can use `useState`, `useEffect`, `useRef`, `useCallback`, `requestAnimationFrame`, `window` event listeners.
  - `export default withResponsiveProps(ComponentName);`

---

## 5. Workflows & Best Practices

### A. Reading Context Before Editing
Always query the editor first to understand the current page structure, active `data-id`s, and design tokens:
- Call `revyme_get_context`
- Inspect `result.activeFilePath` and `result.code`.

### B. Building UI & Sections (Use `revyme_insert_fragment`, NOT `revyme_submit_files`)
**CRITICAL**: When building websites, landing pages, or adding sections, **DO NOT overwrite whole files via `revyme_submit_files`**.
Overwriting files via `submit_files`:
- Bypasses incremental AST validation and creates invalid non-GUI state.
- Often wipes out required wrapper boilerplate (`LayoutClient`, route group setup, page root attributes).
- Fails Oracle checks if IDs are missing or non-kebab-case.

### C. Standard Layout Hierarchy: Page Wrapper → Section → Container

Every professional page in Revyme MUST follow the strict three-tier layout architecture:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. Page Root Wrapper (<div data-id="root" data-name="Page">)                │
│    width: 100%, minHeight: 100vh, flex-col, backgroundColor, overflowX: hidden│
│                                                                             │
│ ┌─────────────────────────────────────────────────────────────────────────┐ │
│ │ 2. Section (<section data-id="*-sec" data-name="* Section">)            │ │
│ │    FULL-BLEED: width: 100%, explicit backgroundColor, vertical padding   │ │
│ │                                                                         │ │
│ │   ┌─────────────────────────────────────────────────────────────────┐   │ │
│ │   │ 3. Container (<div data-id="*-container" data-name="Container">)│   │ │
│ │   │    SHARED MAX-WIDTH: maxWidth: 1200px (or 1280px), width: 100% │   │ │
│ │   │    CENTERED: margin: 0 auto, padding: 0 24px (responsive: 16px)│   │ │
│ │   │                                                                 │   │ │
│ │   │    └── Inner Content (Headlines, Grid, Cards, Buttons, Form)    │   │ │
│ │   └─────────────────────────────────────────────────────────────────┘   │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 1. Page Root Wrapper (`data-id="root"`)
Every page begins with a top-level flex column wrapper:
```tsx
<div
  data-id="root"
  data-name="Page"
  style={{
    position: 'relative',
    width: '100%',
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: 'var(--color-bg)',
    color: 'var(--color-text)',
    overflowX: 'hidden'
  }}
>
```

#### 2. Full-Bleed Section (`<section>`)
- Spans edge-to-edge: `width: "100%"`.
- **Mandatory Section Background**: MUST have an explicit `backgroundColor` (e.g. `"var(--color-bg)"`, `"#09090B"`, `"#FFFFFF"` or gradient) so sections NEVER render as transparent voids!
- Handles vertical spacing: `paddingTop: "100px"`, `paddingBottom: "100px"` (tablet: `60px`, mobile: `40px`).
- Does NOT contain loose text directly — all content goes inside the inner Container!

#### 3. Centered Content Container (`<div name="Container">`)
- **Shared Max-Width**: Sets the universal layout boundary for the entire website: `maxWidth: "1200px"` (or `"1280px"`). Every section on the page must use the exact same `maxWidth`!
- **Auto-Centered**: `margin: "0 auto"`, `width: "100%"`.
- **Horizontal Gutters**: `paddingLeft: "24px"`, `paddingRight: "24px"` (tablet: `20px`, mobile: `16px`).
- Contains the section's headlines, descriptions, cards, grids, and buttons.

---

### D. The Golden Recipe to Build Any Page/Section

1. Call `revyme_get_context` to inspect the active page and verify the root container (`parent_id: "root"`).
2. Call `revyme_insert_fragment` for each major section (Hero, Features, Pricing, Testimonials, Footer) using the Section + Container architecture:
   ```json
   {
     "parent_id": "root",
     "fragment": {
       "tag": "section",
       "name": "Hero Section",
       "styles": {
         "width": "100%",
         "backgroundColor": "var(--color-bg)",
         "paddingTop": "100px",
         "paddingBottom": "100px",
         "display": "flex",
         "flexDirection": "column",
         "alignItems": "center"
       },
       "responsive": {
         "tablet": { "paddingTop": "60px", "paddingBottom": "60px" },
         "mobile": { "paddingTop": "40px", "paddingBottom": "40px" }
       },
       "children": [
         {
           "tag": "div",
           "name": "Container",
           "styles": {
             "width": "100%",
             "maxWidth": "1200px",
             "margin": "0 auto",
             "paddingLeft": "24px",
             "paddingRight": "24px",
             "display": "flex",
             "flexDirection": "column",
             "alignItems": "center",
             "textAlign": "center"
           },
           "responsive": {
             "tablet": { "paddingLeft": "20px", "paddingRight": "20px" },
             "mobile": { "paddingLeft": "16px", "paddingRight": "16px" }
           },
           "children": [
             {
               "tag": "h1",
               "text": "Radical Form. Fluid Motion.",
               "styles": {
                 "fontSize": "64px",
                 "fontWeight": "800",
                 "color": "var(--color-text)",
                 "lineHeight": "1.1",
                 "marginBottom": "20px"
               },
               "responsive": {
                 "tablet": { "fontSize": "44px" },
                 "mobile": { "fontSize": "32px" }
               }
             },
             {
               "tag": "p",
               "text": "Crafting digital experiences with precision and kinematic feedback.",
               "styles": {
                 "fontSize": "18px",
                 "color": "var(--color-text-secondary)",
                 "maxWidth": "640px",
                 "marginBottom": "36px"
               },
               "responsive": {
                 "mobile": { "fontSize": "16px" }
               }
             },
             {
               "tag": "button",
               "name": "CTA Button",
               "text": "Explore Selected Work",
               "styles": {
                 "padding": "14px 28px",
                 "backgroundColor": "#3B82F6",
                 "color": "#FFFFFF",
                 "borderRadius": "8px",
                 "fontWeight": "600"
               },
               "hover": {
                 "targets": { "scale": 1.04, "y": -2 },
                 "transition": { "type": "spring", "stiffness": 400, "damping": 25 }
               }
             }
           ]
         }
       ]
     }
   }
   ```
3. If adding a Marquee, Carousel, or background shader:
   Call `revyme_add_built_in_component` with tag `"Marquee"` or `"Carousel"` instead of coding static divs!
4. Optionally call `revyme_apply_motion_preset` (e.g. `lift-on-hover`, `fade-up`, `stagger-children`) to add entrance animations to inserted cards.
5. Use granular `add_node` only for single, isolated element additions. Never emit `<ul>` or `<li>` tags; build stacked flex column `<div>`s instead. Always place text styles on text elements directly.

---

### E. Utopia Fluid Typography & Spacing Standard (utopia.fyi)

Revyme adopts the **Utopia fluid responsive methodology** (from [utopia.fyi](https://utopia.fyi)).
Instead of rigid breakpoints where text and padding snap abruptly, Utopia interpolates dimensions smoothly between **Mobile (375px)** and **Desktop (1200px)** via pure CSS `clamp()`.

#### 1. Why Fluid clamp() Outperforms Rigid Media Queries
- **Continuous Scaling**: Between 375px and 1200px (and beyond), font sizes and section paddings scale fluidly with viewport width.
- **Zero Breakpoint Snapping**: No sudden jumps where text awkwardly overflows or breaks onto three lines.
- **Zero Media Query Bloat**: A single declaration `fontSize: "clamp(2.25rem, 1.75rem + 2.13vw, 3.625rem)"` looks perfect on Mobile (36px), Tablet (46px), and Desktop (58px)!

#### 2. Utopia Fluid Scale Reference
Read [references/utopia-fluid-design.md](./references/utopia-fluid-design.md) for full mathematical tables. Key values:

- **Typography Steps**:
  - `Hero Display`: `clamp(2.75rem, 2.02rem + 3.1vw, 4.75rem)` (44px → 76px)
  - `H1 / Headline`: `clamp(2.25rem, 1.75rem + 2.13vw, 3.625rem)` (36px → 58px)
  - `H2 / Section Title`: `clamp(1.75rem, 1.39rem + 1.55vw, 2.75rem)` (28px → 44px)
  - `H3 / Card Title`: `clamp(1.5rem, 1.27rem + 0.97vw, 2.125rem)` (24px → 34px)
  - `H4 / Subtitle`: `clamp(1.25rem, 1.11rem + 0.58vw, 1.625rem)` (20px → 26px)
  - `Body Base`: `clamp(0.9375rem, 0.89rem + 0.19vw, 1.0625rem)` (15px → 17px)
  - `Small Caption`: `clamp(0.8125rem, 0.78rem + 0.12vw, 0.875rem)` (13px → 14px)

- **Spacing Steps**:
  - `Section Y Padding`: `clamp(3.5rem, 2.27rem + 5.24vw, 6.875rem)` (56px → 110px)
  - `Container Gutter`: `clamp(1rem, 0.64rem + 1.55vw, 2rem)` (16px → 32px)
  - `Card Padding`: `clamp(1.25rem, 0.89rem + 1.55vw, 2.25rem)` (20px → 36px)
  - `Grid Gap`: `clamp(1rem, 0.64rem + 1.55vw, 2rem)` (16px → 32px)

#### 3. How to Set in globals.css via `revyme_manage_presets`
```json
{
  "action": "set",
  "tokens": [
    { "name": "font-step-5", "value": "clamp(2.25rem, 1.75rem + 2.13vw, 3.625rem)", "category": "typography" },
    { "name": "font-step-4", "value": "clamp(1.75rem, 1.39rem + 1.55vw, 2.75rem)", "category": "typography" },
    { "name": "font-step-0", "value": "clamp(0.9375rem, 0.89rem + 0.19vw, 1.0625rem)", "category": "typography" },
    { "name": "space-section-y", "value": "clamp(3.5rem, 2.27rem + 5.24vw, 6.875rem)", "category": "spacing" },
    { "name": "space-gutter", "value": "clamp(1rem, 0.64rem + 1.55vw, 2rem)", "category": "spacing" }
  ]
}
```
In element styles, reference via `var(--font-step-5)` or inline `clamp(...)` directly!

---

### F. Hover Animations & Interactive States (100% GUI-Parity Standard)
> **CRITICAL RULE**: NEVER emit raw CSS `:hover` rules in `<style>`. CSS hover was explicitly removed from the builder UI because CSS transforms fight Framer Motion's FLIP projection. Moreover, CSS `:hover` rules do NOT appear in the builder's Inspector, breaking visual editability!
>
> You MUST use ONLY the two visual mechanisms supported by the Revyme Builder:

1. **Framer Motion Hover (For Page Elements — 100% GUI-Editable in Effects Panel)**:
   For buttons, cards, and links on regular pages, use Framer Motion via `set_motion` or `<motion.tag whileHover={...} />`:
   - Tool call:
     ```json
     {
       "tool": "set_motion",
       "input": {
         "node_id": "cta-btn",
         "effect": "hover",
         "targets": { "scale": 1.025, "y": -4 },
         "transition": { "type": "spring", "stiffness": 350, "damping": 25 }
       }
     }
     ```
   - In TSX, the builder emits:
     ```tsx
     <motion.button
       data-id="cta-btn"
       whileHover={{ scale: 1.025, y: -4 }}
       transition={{ type: "spring", stiffness: 350, damping: 25 }}
       style={{ ... }}
     >
       Get Started
     </motion.button>
     ```
   - When the user selects this element in the builder, it immediately shows as an active **Hover** card under the **Effects** panel with interactive sliders!

2. **Component Variants (For Design Components — Editable in Variants Panel)**:
   For reusable Design Components in `components/<Name>.tsx`, define native hover via variant states and connections:
   ```tsx
   export const variantConfig = [
     { name: 'default', label: 'Default', x: 0, y: 0 },
     { name: 'default-hover', label: 'Hover', x: 0, y: 200, interactionType: 'hover', parentVariant: 'default' }
   ];
   export const variantConnections = [
     { from: 'default', to: 'default-hover', trigger: 'mouseEnter' },
     { from: 'default-hover', to: 'default', trigger: 'mouseLeave' }
   ];
   export const transitions = {
     'default-hover': { transition: { duration: 0.2, ease: [0.16, 1, 0.3, 1] } }
   };
   ```
   In the component JSX:
   ```tsx
   <div
     data-id="btn"
     onMouseEnter={() => setVariant('default-hover')}
     onMouseLeave={() => setVariant('default')}
     style={{
       backgroundColor: variant === 'default-hover' ? '#4f46e5' : '#4338ca',
       transform: variant === 'default-hover' ? 'translateY(-2px)' : 'none',
       transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)'
     }}
   >
   ```

3. **Card Color Reveals & Image Filter Transitions (Grayscale ➔ Full Color)**:
   - When cards should become colorful on hover (e.g. grayscale to full color):
     - **NEVER** write `whileHover={{ filter: 'grayscale(1%)' }}` on an outer container — string percentage filters on outer flex containers do NOT cascade to nested images in Framer Motion.
     - **Inside a Design Component (`components/ProjectCard.tsx`)**:
       Apply the filter transition directly to the `<img>` or image wrapper based on the variant:
       ```tsx
       <img
         data-id="card-img"
         src={image}
         style={{
           width: '100%',
           height: '100%',
           objectFit: 'cover',
           filter: variant === 'default-hover' ? 'grayscale(0%)' : 'grayscale(100%)',
           transform: variant === 'default-hover' ? 'scale(1.04)' : 'scale(1)',
           transition: 'filter 0.4s ease, transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)'
         }}
       />
       ```
       When the user hovers over `<ProjectCard />`, the master's variant triggers `default-hover`, bringing the image into vivid full color!

---

### G. Professional Header, Navbar & Drawer Navigation Architecture

> **CRITICAL POST-MORTEM & FATAL ANTI-PATTERNS**:
> 1. **The In-Flow Menu Disaster**: NEVER insert a fullscreen menu or drawer as an in-flow `<section>` or `<div>` with `position: relative` or `order` in `app/page.client.tsx`. This renders a 750px tall static black rectangle right in the middle of the webpage! A menu/drawer MUST ALWAYS be an overlay (`position: fixed`, `inset: 0`, `zIndex: 9999`) and MUST be hidden (`display: none` or conditional) when closed.
> 2. **The Desktop Hamburger Button**: The hamburger button MUST have `display: "none"` on desktop! Never set its default base style to `inline-flex` without hiding it on desktop.
> 3. **The Tablet Horizontal Overflow Trap**: On tablet viewports (810px - 1199px), a header with Logo + Status Pill (260px) + 4 Nav Links (300px) + Inquire CTA + Hamburger Button requires ~980px. On an 810px screen, it **100% overflows horizontally**. On tablet, you MUST hide the status pill and switch desktop nav links to the hamburger button!

#### 1. The 3-Viewport Responsive Navigation Matrix

Every navigation header in Revyme MUST conform to this exact display matrix:

| Element | Desktop ($\ge$ 1200px) | Tablet (810px - 1199px) | Mobile ($\le$ 809px) |
| :--- | :--- | :--- | :--- |
| **Logo / Brand Mark** | `display: flex` | `display: flex` | `display: flex` |
| **Status Pill / Secondary Badges** | `display: flex` | **`display: none !important`** *(Prevents Tablet Overflow!)* | **`display: none !important`** |
| **Desktop Nav Links Group** (`header-nav-items`) | `display: flex` | **`display: none !important`** *(Switches to Hamburger)* | **`display: none !important`** |
| **Hamburger Button** (`header-hamburger-btn`) | **`display: none`** *(CRITICAL: NEVER visible on desktop!)* | **`display: flex !important`** | **`display: flex !important`** |
| **Primary CTA Button** (e.g. "INQUIRE") | `display: flex` | `display: flex` (or compact) | `display: none` (or inside drawer) |
| **Fullscreen Menu / Drawer Overlay** | `display: none` *(closed)* | `display: none` *(closed)* | `display: none` *(closed)* |

---

#### 2. Pattern A: Dedicated Design Component Navbar (`components/Navbar.tsx`)

Authoring Navbar as a Design Component provides 100% canvas inspectability with interactive variants:

```tsx
"use client";

import React, { useState } from "react";
import { withResponsiveProps } from "@revyme/runtime";
import { motion, AnimatePresence } from "framer-motion";

/** @name "Navbar" */
export const variantConfig = [
  { name: 'default', label: 'Default (Closed)', x: 0, y: 0, isPrimary: true },
  { name: 'menu-open', label: 'Menu Open', x: 0, y: 300 }
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
  const isOpen = variant === 'menu-open';

  return (
    <>
      <header
        data-id="site-header"
        data-name="Site Header"
        style={{
          position: 'sticky',
          top: 0,
          width: '100%',
          zIndex: 100,
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '20px 48px',
          backgroundColor: 'var(--color-bg)',
          borderBottom: '1px solid var(--color-border)',
          boxSizing: 'border-box',
          ...style,
        }}
      >
        {/* Brand */}
        <div data-id="header-brand" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span data-id="header-logo" style={{ fontSize: '24px', fontWeight: 700, color: 'var(--color-text)' }}>
            {studioName}
          </span>
          <span data-id="header-status-pill" style={{ fontSize: '11px', padding: '4px 12px', border: '1px solid var(--color-border)', borderRadius: '100px', color: 'var(--color-text-secondary)' }}>
            ● AVAILABLE FOR COMMISSIONS
          </span>
        </div>

        {/* Desktop Links Group */}
        <div data-id="header-nav-items" style={{ display: 'flex', flexDirection: 'row', gap: '32px' }}>
          <a data-id="nav-link-1" href="#work" style={{ color: 'var(--color-text)', textDecoration: 'none', fontSize: '13px', fontFamily: 'var(--typo-mono-font)' }}>01 / WORK</a>
          <a data-id="nav-link-2" href="#manifesto" style={{ color: 'var(--color-text)', textDecoration: 'none', fontSize: '13px', fontFamily: 'var(--typo-mono-font)' }}>02 / MANIFESTO</a>
          <a data-id="nav-link-3" href="#contact" style={{ color: 'var(--color-text)', textDecoration: 'none', fontSize: '13px', fontFamily: 'var(--typo-mono-font)' }}>03 / CONTACT</a>
        </div>

        {/* Actions Wrap: CTA + Hamburger */}
        <div data-id="header-actions" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button data-id="header-inquire-btn" style={{ padding: '8px 18px', backgroundColor: 'var(--color-inverse-bg)', color: 'var(--color-inverse-text)', borderRadius: '6px', fontSize: '12px' }}>
            INQUIRE [↗]
          </button>
          <button
            data-id="header-hamburger-btn"
            onClick={() => setVariant(isOpen ? 'default' : 'menu-open')}
            style={{
              display: 'none', // HIDDEN ON DESKTOP BY DEFAULT!
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
            {isOpen ? '[✕] CLOSE' : '[≡] MENU'}
          </button>
        </div>
      </header>

      {/* Fullscreen Drawer Overlay - NEVER IN-FLOW! */}
      <div
        data-id="nav-fullscreen-overlay"
        style={{
          position: 'fixed',
          inset: 0,
          width: '100vw',
          height: '100vh',
          zIndex: 9999,
          backgroundColor: 'var(--color-bg)',
          display: isOpen ? 'flex' : 'none',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '100px 48px 48px 48px',
          boxSizing: 'border-box',
          overflowY: 'auto',
        }}
      >
        <div data-id="drawer-links" style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '1200px', margin: '0 auto', width: '100%' }}>
          <a href="#work" onClick={() => setVariant('default')} style={{ fontSize: 'clamp(2.5rem, 6vw, 4rem)', fontWeight: 800, color: 'var(--color-text)', textDecoration: 'none' }}>01 / SELECTED WORK</a>
          <a href="#manifesto" onClick={() => setVariant('default')} style={{ fontSize: 'clamp(2.5rem, 6vw, 4rem)', fontWeight: 800, color: 'var(--color-text)', textDecoration: 'none' }}>02 / MANIFESTO</a>
          <a href="#contact" onClick={() => setVariant('default')} style={{ fontSize: 'clamp(2.5rem, 6vw, 4rem)', fontWeight: 800, color: 'var(--color-text)', textDecoration: 'none' }}>03 / DIRECT INQUIRIES</a>
        </div>
        <div data-id="drawer-footer" style={{ borderTop: '1px solid var(--color-border)', paddingTop: '24px', maxWidth: '1200px', margin: '0 auto', width: '100%', display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)', fontFamily: 'var(--typo-mono-font)' }}>NYC — 40.7128° N, 74.0060° W</span>
          <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)', fontFamily: 'var(--typo-mono-font)' }}>KYIV — 50.4501° N, 30.5234° E</span>
        </div>
      </div>
    </>
  );
}

export default withResponsiveProps(Navbar);
```

On `app/page.client.tsx`, simply instantiate:
```tsx
<Navbar data-id="site-nav-instance" />
```

---

#### 3. Pattern B: Inserting Responsive Header via `revyme_insert_fragment`

If inserting directly into the page canvas:

```json
{
  "parent_id": "root",
  "index": 0,
  "fragment": {
    "tag": "header",
    "id": "site-header",
    "name": "Site Header",
    "styles": {
      "position": "sticky",
      "top": "0",
      "width": "100%",
      "zIndex": "100",
      "display": "flex",
      "flexDirection": "row",
      "alignItems": "center",
      "justifyContent": "space-between",
      "padding": "20px 48px",
      "backgroundColor": "var(--color-bg)",
      "borderBottom": "1px solid var(--color-border)"
    },
    "responsive": {
      "tablet": { "padding": "16px 24px" },
      "mobile": { "padding": "14px 16px" }
    },
    "children": [
      {
        "tag": "div",
        "id": "header-brand",
        "name": "Brand",
        "styles": { "display": "flex", "alignItems": "center", "gap": "16px" },
        "children": [
          { "tag": "span", "id": "header-logo", "text": "sd", "styles": { "fontSize": "24px", "fontWeight": "700", "color": "var(--color-text)" } },
          {
            "tag": "span",
            "id": "header-status-pill",
            "text": "● AVAILABLE FOR COMMISSIONS",
            "styles": { "fontSize": "11px", "padding": "4px 12px", "border": "1px solid var(--color-border)", "borderRadius": "100px", "color": "var(--color-text-secondary)" },
            "responsive": {
              "tablet": { "display": "none" },
              "mobile": { "display": "none" }
            }
          }
        ]
      },
      {
        "tag": "div",
        "id": "header-nav-items",
        "name": "Desktop Nav Items",
        "styles": { "display": "flex", "flexDirection": "row", "gap": "32px" },
        "responsive": {
          "tablet": { "display": "none" },
          "mobile": { "display": "none" }
        },
        "children": [
          { "tag": "a", "text": "01 / WORK", "attrs": { "href": "#work" }, "styles": { "color": "var(--color-text)", "fontSize": "13px" } },
          { "tag": "a", "text": "02 / MANIFESTO", "attrs": { "href": "#manifesto" }, "styles": { "color": "var(--color-text)", "fontSize": "13px" } },
          { "tag": "a", "text": "03 / CONTACT", "attrs": { "href": "#contact" }, "styles": { "color": "var(--color-text)", "fontSize": "13px" } }
        ]
      },
      {
        "tag": "div",
        "id": "header-actions",
        "name": "Action Items",
        "styles": { "display": "flex", "alignItems": "center", "gap": "16px" },
        "children": [
          {
            "tag": "button",
            "id": "header-inquire-btn",
            "text": "INQUIRE [↗]",
            "styles": { "padding": "8px 18px", "backgroundColor": "var(--color-inverse-bg)", "color": "var(--color-inverse-text)", "borderRadius": "6px", "fontSize": "12px" }
          },
          {
            "tag": "button",
            "id": "header-hamburger-btn",
            "text": "[≡] MENU",
            "styles": {
              "display": "none",
              "alignItems": "center",
              "padding": "8px 16px",
              "backgroundColor": "var(--color-bg)",
              "border": "1px solid var(--color-border)",
              "borderRadius": "6px",
              "color": "var(--color-text)",
              "fontSize": "12px"
            },
            "responsive": {
              "tablet": { "display": "flex" },
              "mobile": { "display": "flex" }
            }
          }
        ]
      }
    ]
  }
}
```

---

### H. Adding Motion & Animations (Choreography & Springs)
Always apply animations using Revyme's native semantic tools (`set_motion`, `set_text_effect`, `set_smooth_scroll`) rather than raw code:

- **Physics-Based Transitions (Springs)**:
  Avoid linear animations. Prefer realistic springs:
  - *Snappy Buttons/Taps*: `transition: { "type": "spring", "stiffness": 400, "damping": 28 }`
  - *Smooth Cards/Popups*: `transition: { "type": "spring", "stiffness": 300, "damping": 24 }`
  - *Gentle Section Entrance*: `transition: { "type": "spring", "stiffness": 240, "damping": 26 }`

- **Staggered Multi-Card Entrances**:
  When introducing cards or features, stagger them by `0.1s`:
  ```json
  {
    "tool": "batch",
    "input": {
      "actions": [
        { "tool": "set_motion", "input": { "node_id": "card-1", "effect": "appear", "from": { "opacity": 0, "y": 30 }, "transition": { "type": "spring", "stiffness": 260, "damping": 24, "delay": 0 } } },
        { "tool": "set_motion", "input": { "node_id": "card-2", "effect": "appear", "from": { "opacity": 0, "y": 30 }, "transition": { "type": "spring", "stiffness": 260, "damping": 24, "delay": 0.1 } } },
        { "tool": "set_motion", "input": { "node_id": "card-3", "effect": "appear", "from": { "opacity": 0, "y": 30 }, "transition": { "type": "spring", "stiffness": 260, "damping": 24, "delay": 0.2 } } }
      ]
    }
  }
  ```

- **Cinematic Text Reveals**:
  Use `set_text_effect` with `mask: true` for split-text entrance:
  ```json
  {
    "node_id": "hero-title",
    "preset": "Slide Up",
    "split": "character",
    "stagger": 0.035,
    "mask": true,
    "trigger": "appear"
  }
  ```

- **Smooth Momentum Scrolling**:
  Enable Lenis physics: `set_smooth_scroll` with `enabled: true, intensity: 14`.

### I. Managing CMS
- To create a collection: `cms_create_collection` with `name: "Projects"`.
- To add fields: `cms_add_field` with `collection`, `name`, `type`.
- To insert data: `cms_add_items`.

---

## 6. Preserving Existing Pages & Safety Rules (CRITICAL)

When creating new pages, styling elements, or adding features, you must protect the integrity of the user's existing website:

### A. Never Overwrite Unrelated Pages / The Active Home Page
- **Check Project Layout First**: Before creating a page, call `revyme_list_files` (or `listFiles`). Notice whether the project uses Next.js Route Groups (e.g. `app/(Main)/page.client.tsx`, `app/(Main)/LayoutClient.tsx`).
- **Create New Pages in the Correct Folder**:
  - When asked to create `/about`, `/pricing`, or any other subpage, submit `app/(Main)/about/page.client.tsx` and `app/(Main)/about/page.tsx` (if using route groups) or `app/about/page.client.tsx` and `app/about/page.tsx`.
  - **NEVER overwrite the Home page** (`app/(Main)/page.client.tsx`) when fulfilling requests for a different page.
- **Beware of Active Canvas Context**:
  - Semantic tools like `add_node`, `set_motion`, `set_styles`, etc. operate on the **currently active file** in the editor (`result.activeFilePath` from `revyme_get_context`).
  - If the user is currently viewing the Home page on canvas, running `add_node` without navigating to the target page will add nodes to the Home page!
  - When authoring a separate page, use `revyme_submit_files` with the explicit file path.

### B. Preserve Shared Component Masters & CMS
- Components in `components/` (e.g. `PortalHero.tsx`, `ThrowableDeck.tsx`, `SuFeSe.tsx` Navbar, `WeVuXi.tsx` Footer) and collections in `cms/` are shared across multiple pages and templates.
- **Do not delete, gut, or break shared components** when working on a new subpage. Reuse them or build new dedicated components.
- If a component requires hooks like `useScroll` or `useState`, ensure it is self-contained so other consumer pages or Next.js SSR builds don't fail with undefined variable errors.

### C. Mandatory Build & Prerender Verification
Always verify that all pages still build cleanly:
- Trigger build: `POST http://localhost:3333/api/local-server/local/build` or query `GET http://localhost:3333/api/local-server/local/status`.
- Ensure all routes (`/`, `/_not-found`, and your new pages) compile with `0 errors` and static prerender succeeds.

---

## 7. References & Deep Dives
- Read [references/utopia-fluid-design.md](./references/utopia-fluid-design.md) for the complete Utopia fluid typography and spacing scale tables and formulas.
- Read [references/built-in-arsenal.md](./references/built-in-arsenal.md) for the complete catalog of ~80 pre-built components (Marquee, Carousel, shaders, text effects, cursors).
- Read [references/components-guide.md](./references/components-guide.md) for the complete guide on Design Components vs Code Components, templates, and authoring workflows.
- Read [references/motion-choreography.md](./references/motion-choreography.md) for full animation physics, springs, easing presets, and choreography recipes.
- Read [references/tools-api.md](./references/tools-api.md) for full parameter specifications of all available semantic tools.
