# Revyme MCP Tools & Bridge Reference

## 1. Overview
The Revyme editor communicates with the MCP server using JSON-RPC over a Server-Sent Events (SSE) bridge:
- **Editor Bridge Client**: `src/ai/mcp/bridge-client.ts`
- **Internal Bridge Server**: `server/mcp-bridge.ts`
- **External CLI/MCP Stdio Adapter**: `@revyme/cli` (`packages/cli/dist/main.js mcp`)
- **Port**: `8082` (configurable via `VITE_AI_SERVICE_URL`)
- **HTTP endpoints**:
  - `GET /bridge/events`: SSE stream that connected editor tabs listen to.
  - `POST /bridge/result`: Callback endpoint where the editor posts execution results.
  - `POST /rpc`: Direct JSON-RPC endpoint for CLI / scripting tools (`{ method, params }`).

---

## 2. High-Level MCP Methods

### `revyme_insert_fragment` (PRIMARY for Page Building)
Atomically inserts a nested tree into the active page canvas with automatic kebab-case `data-id` generation and Framer Motion hover bindings:
```json
{
  "parent_id": "root",
  "index": 0,
  "fragment": {
    "tag": "section",
    "name": "Feature Section",
    "styles": {
      "width": "100%",
      "backgroundColor": "var(--color-bg)",
      "paddingTop": "80px",
      "paddingBottom": "80px"
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
          "display": "grid",
          "gridTemplateColumns": "repeat(3, 1fr)",
          "gap": "24px"
        },
        "responsive": {
          "tablet": { "gridTemplateColumns": "repeat(2, 1fr)", "paddingLeft": "20px", "paddingRight": "20px" },
          "mobile": { "gridTemplateColumns": "1fr", "paddingLeft": "16px", "paddingRight": "16px" }
        },
        "children": [
          {
            "tag": "div",
            "name": "Feature Card",
            "styles": {
              "padding": "24px",
              "backgroundColor": "#1E293B",
              "borderRadius": "12px"
            },
            "hover": {
              "targets": { "scale": 1.03, "y": -4 },
              "transition": { "type": "spring", "stiffness": 350, "damping": 25 }
            },
            "children": [
              { "tag": "h3", "text": "Ultra Fast", "styles": { "color": "#FFFFFF", "fontSize": "20px" } },
              { "tag": "p", "text": "Sub-millisecond latency for all requests", "styles": { "color": "#94A3B8" } }
            ]
          }
        ]
      }
    ]
  }
}
```

### `revyme_apply_motion_preset`
Applies calibrated spring animation presets to any node by `node_id`:
```json
{
  "node_id": "feature-card-1",
  "preset": "lift-on-hover",
  "physics": "gentle"
}
```
Supported presets: `lift-on-hover`, `scale-on-hover`, `fade-up`, `fade-in`, `slide-in-left`, `slide-in-right`, `stagger-children`.
Supported physics: `snappy`, `gentle`, `bouncy`, `slow`.

### `revyme_manage_component_variant`
Creates or manipulates interactive variant states on Design Components:
```json
{
  "component": "PricingCard",
  "action": "add_interaction",
  "interaction": "hover",
  "styles": {
    "transform": "translateY(-6px)",
    "borderColor": "#6366F1"
  }
}
```

### `revyme_list_built_in_components`
Browses Revyme's catalog of ~80 production-ready components:
```json
{
  "query": "marquee"
}
```
Returns list of matching tags (`Marquee`, `RibbonMarquee`, `Marquee3D`, etc.), descriptions, and installation status.

### `revyme_add_built_in_component`
Installs and places an instance of a built-in component into any container on the active canvas:
```json
{
  "tag": "Marquee",
  "parent_id": "clients-section",
  "props": {
    "speed": 60,
    "direction": "left",
    "gap": 32,
    "pauseOnHover": true,
    "fadeEdges": true
  }
}
```

### `revyme_set_responsive_styles`
Sets responsive CSS styles on a node for specific viewports (`"tablet"` for 810px, `"mobile"` for 375px):
```json
{
  "node_id": "hero-headline",
  "viewport": "mobile",
  "styles": {
    "fontSize": "32px",
    "textAlign": "center"
  }
}
```

### `revyme_add_component_instance` (First-Class Component Tool)
Places an instance of an existing Design Component (e.g. `Navbar`, `ProjectCard`, `PrimaryButton`) on the active canvas with typed props and positioning:
```json
{
  "name": "Navbar",
  "parent_id": "root",
  "index": 0,
  "props": {
    "studioName": "ACME DESIGN",
    "initialVariant": "default"
  }
}
```
**Parameters**:
- `name` *(string, required)*: Component name as defined in `components/<Name>.tsx`.
- `parent_id` *(string, optional)*: data-id of parent container (defaults to page root or selected node).
- `props` *(object, optional)*: Declared props to pass as JSX attributes.
- `index` *(number, optional)*: 0-based position among siblings in parent.

### `revyme_set_variant` (Variant Styles & Text Editor)
Sets or updates CSS styles or text content of a variant state in the component's master file:
```json
{
  "node_id": "site-nav-instance",
  "variant": "menu-open",
  "styles": {
    "backgroundColor": "var(--color-bg)"
  }
}
```
**Parameters**:
- `node_id` *(string, required)*: data-id of the component instance on the active page.
- `variant` *(string, required)*: Variant name on the master (e.g. `'menu-open'`, `'hover'`, `'dark'`).
- `element` *(string, optional)*: data-id of an element INSIDE the component master to style (defaults to root).
- `styles` *(object, optional)*: camelCase CSS styles (pass `""` to remove a property).
- `text` *(string, optional)*: New text content for that variant.

### `revyme_show_variant` (Canvas Variant Preview & Inspection)
Switches which variant a component instance actively displays on the canvas (`initialVariant`). Use this to preview or edit non-default states like `'menu-open'` on the visual canvas:
```json
{
  "node_id": "site-nav-instance",
  "variant": "menu-open"
}
```
**Parameters**:
- `node_id` *(string, required)*: data-id of the component instance on the page.
- `variant` *(string, required)*: Variant name to show on canvas (pass `'default'` to reset).
- `viewport` *(number, optional)*: Breakpoint width in px (e.g. `375` for mobile) to scope the display override to.
- `inside` *(string, optional)*: Master name when the instance sits inside another component.

### `revyme_add_connection` (Interaction & Click Wiring)
Wires a trigger (`click`, `mouseEnter`, `mouseLeave`, `inView`, `afterDelay`) to switch variants (e.g. clicking hamburger button opens menu):
```json
{
  "component": "Navbar",
  "from": "default",
  "to": "menu-open",
  "trigger": "click",
  "source_node": "header-hamburger-btn"
}
```
**Parameters**:
- `component` *(string, required)*: Component name from `list_components` (e.g. `'Navbar'`).
- `from` *(string, required)*: Source variant name the trigger fires in (e.g. `'default'`).
- `to` *(string, required)*: Target variant name to switch to (e.g. `'menu-open'`).
- `trigger` *(string enum, required)*: `'click'` \| `'clickStart'` \| `'mouseEnter'` \| `'mouseLeave'` \| `'inView'` \| `'afterDelay'`.
- `source_node` *(string, optional)*: data-id inside the master that carries the trigger (e.g. `'header-hamburger-btn'`; omit for component root).
- `delay` *(number, optional)*: Delay in seconds for `afterDelay` (0-2).

### `revyme_open_editor` (Auto-Navigation & Keep-Alive)
Opens the Revyme builder canvas in the user's browser and waits up to `wait_ms` for the SSE connection to become active. Automatically resolves the most recently modified project on disk (`/builder/<recentId>`), preventing blank or non-existent projects from opening:
```json
{
  "project_id": "proj-1792479934977-oegfza",
  "wait_ms": 8000
}
```
**Parameters**:
- `project_id` *(string, optional)*: Explicit project ID to open. If omitted, automatically resolves the newest project from disk.
- `url` *(string, optional)*: Direct target URL (overrides `project_id`, e.g. `'http://localhost:3333/builder/proj-...'`).
- `wait_ms` *(number, optional)*: Milliseconds to wait for canvas SSE connection (defaults to `8000`).

### `revyme_get_context`
Retrieves full snapshot of the editor state:
- `activeFilePath`: e.g. `"app/page.client.tsx"`
- `code`: raw React JSX code
- `kind`: `"page"` | `"component"`
- `surface`: `"page"` | `"template"` | `"component"` | `"icon-set"`
- `pages`: list of registered page files
- `components`: list of reusable components in `components/`
- `presets`: active CSS design tokens (`color-*`, `typo-*`, etc.)
- `collections`: CMS schemas and items

### `revyme_submit_files` (RESTRICTED - Scaffolding & Code Components Only)
Direct file write with Oracle Gate checking. **DO NOT use to build visual pages or sections — use `revyme_insert_fragment` instead.**
```json
{
  "files": [
    {
      "path": "components/ShaderCanvas.tsx",
      "code": "'use client';\n/** @controls { ... } */\n...",
      "kind": "component"
    }
  ]
}
```
**Oracle Rules**:
1. Every element must have a unique `data-id`.
2. Do not use unsupported tags (`<ul>`, `<li>` are invalid — use stacked `<div>` frames).
3. Text styles (`textAlign`, `fontSize`, `color`) must be placed directly on text elements (`<p>`, `<h1>`, `<span>`), not on parent frames.
4. CSS styles must use camelCase.
5. All elements must have explicit positioning (`position: 'relative'`, etc.).

### `revyme_manage_presets`
Manipulates design tokens in `app/globals.css`:
- `action`: `"list"` | `"set"` | `"remove"` | `"set_typography"`
- `tokens`: `[ { "name": "color-primary", "value": "#FF4500", "category": "color" } ]`

### `revyme_manage_cms`
CRUD for CMS:
- `action`: `"list_collections"`, `"create_collection"`, `"add_field"`, `"add_item"`, `"update_item"`, `"remove_item"`
- `collection`: slug of the collection
- `field`: `{ "name": "Author", "type": "text" }`
- `item`: `{ "title": "My Post", "slug": "my-post" }`

---

## 3. Semantic Agent Tools (`revyme_agent_tool`)

Executed through the internal agent tool dispatcher (`src/ai/agent/bridge-tools.ts`). These mutate the virtual AST and DOM directly without full-page re-renders:

### Component Operations (Design Components)
- **`create_component`**:
  Authors a new canvas-native Design Component master in `components/<Name>.tsx`:
  ```json
  {
    "name": "SpecItem",
    "props": [
      { "name": "tag", "type": "string", "default": "SPEC // 01" },
      { "name": "description", "type": "string", "default": "Machined solid brass" },
      { "name": "value", "type": "string", "default": "48.2 g" }
    ],
    "variants": [{ "name": "highlight", "label": "Highlight" }],
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
  ```
- **`extract_component`**:
  Extracts an existing live subtree on the page into a Design Component master and replaces it with an instance:
  ```json
  {
    "node_id": "hero-card-1",
    "name": "PricingCard"
  }
  ```
- **`add_component_instance`**:
  Places an instance of a component on the page:
  ```json
  {
    "name": "SpecItem",
    "parent_id": "measurements-list",
    "props": {
      "tag": "DIM // 01",
      "description": "Total length capped",
      "value": "142.0 mm"
    }
  }
  ```
- **`set_component_prop`**:
  Updates a prop on a component instance:
  ```json
  {
    "node_id": "comp-spec-1",
    "component_name": "SpecItem",
    "prop": "value",
    "value": "150.0 mm"
  }
  ```
- **`set_variant`**:
  Sets or updates the styles or text of a component variant in its master:
  ```json
  {
    "node_id": "pricing-card-1",
    "variant": "highlight",
    "element": "card-title",
    "styles": { "color": "#FFD700" }
  }
  ```
  *(Parameters: `node_id` [string], `variant` [string], optional `element` [string], optional `styles` [object], optional `text` [string])*
- **`show_variant`**:
  Chooses which variant an instance displays on the active canvas (`initialVariant`):
  ```json
  {
    "node_id": "site-nav-instance",
    "variant": "menu-open"
  }
  ```
  *(Parameters: `node_id` [string], `variant` [string], optional `viewport` [number], optional `inside` [string])*
- **`add_connection`**:
  Wires a trigger to switch variants on click or hover:
  ```json
  {
    "component": "Navbar",
    "from": "default",
    "to": "menu-open",
    "trigger": "click",
    "source_node": "header-hamburger-btn"
  }
  ```
  *(Parameters: `component` [string], `from` [string], `to` [string], `trigger` ['click'|'clickStart'|'mouseEnter'|'mouseLeave'|'inView'|'afterDelay'], optional `source_node` [string], optional `delay` [number])*
- **`add_variant`**:
  Adds a new visual variant to a Design Component master:
  ```json
  {
    "component": "PricingCard",
    "name": "dark"
  }
  ```
- **`list_components`**:
  Lists all design and code components available in the project.

### Design & Structure
- **`add_node`**:
  ```json
  {
    "parent_id": "root",
    "tag": "div",
    "id": "hero-card",
    "styles": { "display": "flex", "padding": "40px" },
    "text": "Optional text"
  }
  ```
- **`clone_node`**: Clones subtree with fresh unique `data-id`s.
- **`remove_node`**: Deletes node by `data-id`.
- **`wrap_in_layout`**: Wraps children in flex/grid container.
- **`set_styles`**: Updates camelCase styles on a node. Optional `viewport` (width in px) for responsive overrides.
- **`set_size`**: Sets width/height using `"fill"`, `"fit"`, `"px"`, `"%"`, `"vw"`, `"vh"`.

### Animations & Framer Motion
- **`set_motion`**:
  - `effect: "appear"`: entrance on scroll
    ```json
    { "node_id": "card-1", "effect": "appear", "from": { "opacity": 0, "y": 30 }, "transition": { "type": "spring", "stiffness": 240, "damping": 26 } }
    ```
  - `effect: "hover"` / `"tap"`:
    ```json
    { "node_id": "card-1", "effect": "hover", "targets": { "scale": 1.05, "y": -8 } }
    ```
  - `effect: "loop"`: continuous floating or spinning
    ```json
    { "node_id": "float-icon", "effect": "loop", "targets": { "y": -20, "rotate": 5 }, "transition": { "duration": 10 } }
    ```
  - `effect: "speed"`: parallax scrolling
    ```json
    { "node_id": "bg-layer", "effect": "speed", "speed": 70 }
    ```
  - `effect: "transform"`: scrub property with scroll progress (`trigger: "layerInView"` | `"sectionInView"`).
  
- **`set_text_effect`**:
  Staggered letter or word animations:
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

- **`set_smooth_scroll`**:
  Activates Lenis smooth scrolling:
  ```json
  {
    "enabled": true,
    "intensity": 14,
    "smooth_touch": true
  }
  ```

### Meta & Transactions
- **`batch`**:
  Batches up to 20 semantic operations into an atomic transaction with a single undo checkpoint.
- **`get_node_tree`**:
  Inspects the live CanvasNode tree of the active document.

---

## 4. MCP v2 Standard Operations Reference

In MCP v2, operations are namespaced by domain. Discover live schemas via `meta.tools({ includeSchemas: true, names: [...] })`.

### `codeFiles.submit`
Commits or updates complete code files with automatic AST Oracle validation:
```json
{
  "path": "components/InteractiveHero.tsx",
  "code": "'use client';\n/** @label \"Interactive Hero\" */\n/** @controls { ... } */\n..."
}
```
*Note:* Rejects `className` styling (`CLASSNAME_STYLING`). Scoped `<style>` tags must use `[data-id="..."]` selectors only.

### `codeFiles.read`
Reads the raw source text of any project file:
```json
{
  "path": "app/page.client.tsx"
}
```

### `viewports.setOverride`
Inserts or updates responsive style overrides for a specific node at a target breakpoint:
```json
{
  "filePath": "app/page.client.tsx",
  "nodeId": "projects-grid",
  "viewport": "mobile",
  "styles": {
    "gridTemplateColumns": "1fr",
    "gap": "16px"
  }
}
```
*Note:* Generates container query rules in `<style data-viewport-styles="...">`.

### `cms.schema.create` & `cms.items.create`
Defines CMS collection schemas and seeds data items:
```json
// cms.schema.create
{
  "name": "roster",
  "fields": [
    { "name": "code", "type": "text", "label": "Catalog Number" },
    { "name": "artist", "type": "text", "label": "Artist Name" }
  ]
}

// cms.items.create
{
  "collection": "roster",
  "item": {
    "code": "AUR-001",
    "artist": "ALVA NOTO"
  }
}
```
*Note:* Code components can directly import `@/cms/<name>.json` to consume live collection data.

### `publish.preflight` & `preview.build`
Verifies and prepares project release readiness:
```json
// publish.preflight
{
  "projectId": "proj-..."
}
// Returns { passed: true, errorCount: 0, fileCount: N }

// preview.build
{
  "projectId": "proj-..."
}
// Returns { status: "ready", previewUrl: "http://..." }
```

