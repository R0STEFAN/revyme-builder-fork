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
   - `revyme_insert_fragment`: **PRIMARY TOOL for UI generation.** Atomically inserts entire subtrees (sections, cards, grids) with auto-generated IDs and native Framer Motion hovers into the active canvas.
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

## 3. Design Components vs Code Components (CRITICAL)

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
│   extract_component     │                           │   revyme_submit_files   │
└─────────────────────────┘                           └─────────────────────────┘
```

### A. Design Components (Native Canvas Masters)
- **What it is**: Reusable visual UI elements (cards, spec rows, buttons, pricing tables, navigation items, testimonial blocks, badges).
- **Canvas Experience**: Fully interactive and visual! Designers can double-click on the canvas to select inner elements, see all layers in the Layers panel, customize styles with the Style Inspector, reorder elements, and switch visual variants.
- **File Structure**:
  - `/** @name "ComponentName" */`
  - `export const variantConfig = [ { name: 'default', ... }, { name: 'highlight', ... } ];`
  - Typed props with defaults in destructuring: `function ComponentName({ style, tag = "...", initialVariant = 'default' }: Props)`
  - `export default withResponsiveProps(ComponentName);`
  - **NEVER include `/** @controls */`**.
- **How to Author**:
  - Always use the semantic tool `create_component` (declarative `{ name, props, variants, layout }` or `{ from: "node_id" }`).
  - Or use `extract_component` on a live subtree on the page.
  - Instantiate on pages with `add_component_instance({ name: "SpecItem", parent_id: "...", props: {...} })` or in page JSX `<SpecItem data-id="..." ... />`.

### B. Code Components (Custom Logic & Shaders)
- **What it is**: Complex, stateful, or low-level components requiring custom React runtime logic, WebGL shaders, Canvas 2D drawings, complex keyframed scroll math, audio/video players, or third-party libraries.
- **Canvas Experience**: Rendered inside `CodeComponentHost` as a **black box**. Individual inner DOM nodes are not selectable or styleable on the canvas; configuration is exposed strictly via the Inspector's `@controls` panel.
- **File Structure**:
  - **MUST have `/** @controls { ... } */`** JSDoc annotation.
  - Can use `useState`, `useEffect`, `useRef`, `useCallback`, `requestAnimationFrame`, `window` event listeners.
  - `export default withResponsiveProps(ComponentName);`
- **How to Author**:
  - Author source directly to `components/<Name>.tsx` using `revyme_submit_files` or direct file creation.

---

## 4. Workflows & Best Practices

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

**The Golden Recipe to Build Any Page/Section**:
1. Call `revyme_get_context` to inspect the active page and identify the root container (`parent_id: "root"` or section container ID).
2. Call `revyme_insert_fragment` for each major section (Hero, Features, Pricing, Testimonials, Footer):
   ```json
   {
     "parent_id": "root",
     "fragment": {
       "tag": "section",
       "name": "Hero Section",
       "styles": {
         "display": "flex",
         "flexDirection": "column",
         "alignItems": "center",
         "padding": "80px 24px",
         "backgroundColor": "#0F172A"
       },
       "children": [
         {
           "tag": "h1",
           "text": "Build Faster with AI",
           "styles": { "fontSize": "48px", "fontWeight": "800", "color": "#F8FAFC", "marginBottom": "16px" }
         },
         {
           "tag": "button",
           "name": "CTA Button",
           "text": "Get Started",
           "styles": { "padding": "12px 24px", "backgroundColor": "#3B82F6", "color": "#FFFFFF", "borderRadius": "8px" },
           "hover": {
             "targets": { "scale": 1.05, "y": -2 },
             "transition": { "type": "spring", "stiffness": 400, "damping": 25 }
           }
         }
       ]
     }
   }
   ```
3. Optionally call `revyme_apply_motion_preset` (e.g. `lift-on-hover` or `fade-up`) to add entrance animations to inserted cards.
4. Use granular `add_node` only for single, isolated element additions. Never emit `<ul>` or `<li>` tags; build stacked flex column `<div>`s instead. Always place text styles on text elements directly.

### C. Hover Animations & Interactive States (100% GUI-Parity Standard)
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

### D. Adding Motion & Animations (Choreography & Springs)
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

### D. Managing CMS
- To create a collection: `cms_create_collection` with `name: "Projects"`.
- To add fields: `cms_add_field` with `collection`, `name`, `type`.
- To insert data: `cms_add_items`.

---

## 5. Preserving Existing Pages & Safety Rules (CRITICAL)

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

## 6. References & Deep Dives
- Read [references/components-guide.md](./references/components-guide.md) for the complete guide on Design Components vs Code Components, templates, and authoring workflows.
- Read [references/motion-choreography.md](./references/motion-choreography.md) for full animation physics, springs, easing presets, and choreography recipes.
- Read [references/tools-api.md](./references/tools-api.md) for full parameter specifications of all available semantic tools.
