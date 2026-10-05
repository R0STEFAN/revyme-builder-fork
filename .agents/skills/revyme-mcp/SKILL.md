---
name: revyme-mcp
description: >-
  Use this skill whenever the user asks to control, modify, generate designs, animate elements,
  or manage CMS in the Revyme Website Builder via the Model Context Protocol (MCP) bridge.
---

# Revyme MCP Agent Skill

This skill guides the AI agent on how to interact with the **Revyme Website Builder** running in the browser via its local **MCP Bridge Server**.

## 1. Prerequisites Check
Before executing any tool calls, verify that both the editor and the bridge server are running:
1. **Editor**: `http://localhost:3333` (started via `npm run dev`)
2. **MCP Bridge**: `http://localhost:8082` (started via `npm run mcp`)
3. The browser tab must be active and connected (check `scripts/mcp-bridge-server.ts` logs for active SSE tabs).

---

## 2. Communication Methods

The agent can send requests to the builder in two ways:
1. **Through MCP Tools directly** (if Antigravity / Claude has loaded `mcp_config.json`):
   - `revyme_get_context`
   - `revyme_submit_files`
   - `revyme_manage_presets`
   - `revyme_manage_cms`
   - `revyme_agent_tool`
   - `revyme_agent_manifest`

2. **Through the Bridge HTTP RPC Endpoint**:
   If running via script or CLI:
   ```bash
   curl -X POST http://localhost:8082/rpc \
     -H "Content-Type: application/json" \
     -d '{"method": "agent.tool", "params": {"name": "add_node", "input": {...}}}'
   ```

---

## 3. Workflows & Best Practices

### A. Reading Context Before Editing
Always query the editor first to understand the current page structure, active `data-id`s, and design tokens:
- Call `revyme_get_context`
- Inspect `result.activeFilePath` and `result.code`.

### B. Adding Elements and Layouts
Use `add_node`:
- `parent_id`: Target container's `data-id` (e.g. `"root"` or another section/frame).
- `tag`: Use valid tags: `div`, `section`, `p`, `h1`-`h6`, `span`, `img`, `a`.
  - **CRITICAL**: Never emit `<ul>` or `<li>` tags; build stacked flex column `<div>`s instead.
- `id`: Always provide a stable, semantic, unique kebab-case ID (e.g., `pricing-card-1`, `faq-item-3`).
- `styles`: Pass camelCase CSS (`display: 'flex'`, `flexDirection: 'column'`).
- `text`: Plain text only (no HTML).
- Place text styles (`fontSize`, `color`, `textAlign`) on the text element itself, not on wrapper frames.

### C. Adding Motion & Animations (Choreography & Springs)
Always apply animations using Revyme's native semantic tools (`set_motion`, `set_text_effect`, `set_smooth_scroll`) rather than raw code. This ensures they are interactive on the canvas and editable in the builder's GUI.

- **Physics-Based Transitions (Springs)**:
  Avoid linear animations. Prefer realistic springs:
  - *Snappy Buttons/Taps*: `transition: { "type": "spring", "stiffness": 400, "damping": 28 }`
  - *Smooth Cards/Popups*: `transition: { "type": "spring", "stiffness": 300, "damping": 24 }`
  - *Gentle Section Entrance*: `transition: { "type": "spring", "stiffness": 240, "damping": 26 }`

- **Interactive Hover & Tap**:
  Keep hover scale subtle (`1.02` - `1.04`) with slight vertical elevation:
  ```json
  {
    "tool": "set_motion",
    "input": {
      "node_id": "card-1",
      "effect": "hover",
      "targets": { "scale": 1.025, "y": -6, "boxShadow": "0 20px 25px -5px rgba(0,0,0,0.15)" },
      "transition": { "type": "spring", "stiffness": 320, "damping": 22 }
    }
  }
  ```

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

- **Scroll Parallax & Scrubbing**:
  - *Parallax Speed*: `speed: 125` (moves up faster), `speed: 75` (lags behind).
  - *Scroll Transform*: `effect: "transform"`, `trigger: "layerInView"`, `from: { "opacity": 0.3, "scale": 0.9 }`, `to: { "opacity": 1, "scale": 1 }`.

- **Smooth Momentum Scrolling**:
  Enable Lenis physics: `set_smooth_scroll` with `enabled: true, intensity: 14`.

### D. Managing CMS
- To create a collection: `cms_create_collection` with `name: "Projects"`.
- To add fields: `cms_add_field` with `collection`, `name`, `type`.
- To insert data: `cms_add_items`.

### E. References
- Read [references/motion-choreography.md](./references/motion-choreography.md) for full animation physics, springs, easing presets, and choreography recipes.
- Read [references/tools-api.md](./references/tools-api.md) for full parameter specifications of all 168 available semantic tools.
