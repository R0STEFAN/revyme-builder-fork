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

### C. Adding Motion & Animations
- **Text Reveal (Character/Word Stagger)**:
  Use `set_text_effect`:
  ```json
  {
    "node_id": "element-id",
    "preset": "Slide Up",
    "split": "character",
    "stagger": 0.035,
    "mask": true,
    "trigger": "appear"
  }
  ```
- **Parallax Speed**:
  Use `set_motion` with `effect: "speed"`:
  - `speed < 100`: Lags behind scroll (moves down relative to viewport).
  - `speed > 100`: Moves faster than scroll (moves up relative to viewport).
- **Hover & Tap**:
  Use `set_motion` with `effect: "hover"` and `targets: { "scale": 1.05, "y": -8 }`.
- **Entrance on Scroll**:
  Use `set_motion` with `effect: "appear"`, `from: { "opacity": 0, "y": 30 }`.
- **Smooth Scroll**:
  Use `set_smooth_scroll` with `enabled: true, intensity: 14`.

### D. Managing CMS
- To create a collection: `cms_create_collection` with `name: "Projects"`.
- To add fields: `cms_add_field` with `collection`, `name`, `type`.
- To insert data: `cms_add_items`.

### E. References
Read [references/tools-api.md](./references/tools-api.md) for full parameter specifications of all 168 available semantic tools.
