# Revyme MCP Tools & Bridge Reference

## 1. Overview
The Revyme editor communicates with the MCP server using JSON-RPC over a Server-Sent Events (SSE) bridge:
- **Editor Bridge Client**: `src/ai/mcp/bridge-client.ts`
- **Bridge Server**: `scripts/mcp-bridge-server.ts`
- **Port**: `8082` (configurable via `VITE_AI_SERVICE_URL`)
- **HTTP endpoints**:
  - `GET /bridge/events`: SSE stream that connected editor tabs listen to.
  - `POST /bridge/result`: Callback endpoint where the editor posts execution results.
  - `POST /rpc`: Direct JSON-RPC endpoint for CLI / scripting tools (`{ method, params }`).

---

## 2. High-Level MCP Methods

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

### `revyme_submit_files`
Direct file write with Oracle Gate checking:
```json
{
  "files": [
    {
      "path": "app/page.client.tsx",
      "code": "'use client'; ...",
      "kind": "page"
    }
  ]
}
```
**Oracle Rules**:
1. Every element must have a unique `data-id`.
2. Do not use unsupported tags (`<ul>`, `<li>` are invalid — use stacked `<div>` frames).
3. Text styles (`textAlign`, `fontSize`, `color`) must be placed directly on text elements (`<p>`, `<h1>`, `<span>`), not on parent frames.
4. CSS styles must use camelCase.

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
    { "node_id": "card-1", "effect": "appear", "from": { "opacity": 0, "y": 30 }, "transition": { "duration": 0.8 } }
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
