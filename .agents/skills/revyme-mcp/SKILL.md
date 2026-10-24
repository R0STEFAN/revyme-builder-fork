---
name: revyme-mcp
description: >-
  Use this skill whenever the user asks to control, modify, generate designs, animate elements,
  author design components or code components, or manage CMS in the Revyme Website Builder via the Model Context Protocol (MCP) bridge.
---

# Revyme MCP Agent Skill

This skill guides the AI agent on how to interact with the **Revyme Website Builder** running in the browser via its local **MCP Bridge Server**.

> **MCP v2 source of truth:** use the live `mcp__revyme_v2` tool schemas provided by the current session. The legacy `revyme_*` tool names and JSON examples below are historical and are not executable MCP v2 calls. Prefer the typed dot-named operations such as `pages.list`, `pages.create`, `templates.create`, and `siteEffects.pageTransition.set`; do not guess from old examples when an operation schema is available.

## 1. MCP Configuration & Prerequisites

### Client Configuration (`mcp_config.json`)
For an agent (Antigravity, Claude Desktop, Cursor) to connect to the builder on a machine:
Add the following configuration to `~/.gemini/config/mcp_config.json` (or your client's MCP config):
```json
{
  "mcpServers": {
    "revyme-builder": {
      "command": "node",
      "args": ["packages/cli/dist/main.js", "mcp"],
      "cwd": "/path/to/revyme-builder-fork"
    }
  }
}
```
> **Important**: Set `cwd` to the absolute path of the `revyme-builder-fork` repository on the current machine.

### Runtime Prerequisites
Before executing any tool calls, ensure that:
1. **Editor & Bridge are running**: Run `npm run dev` (starts editor on `http://localhost:3333` and HTTP bridge on `http://localhost:8082`).
2. **Builder tab is open & connected**: Open `http://localhost:3333/builder` in your browser (the builder canvas tab establishes an active SSE connection to port 8082).
   > **Note on `/dashboard`**: Navigating to `http://localhost:3333` redirects to `/dashboard` in standalone mode, which unmounts the canvas. Ensure a project is opened in the builder (`/builder` or `/builder/local`), or call `revyme_open_editor` to open/reconnect automatically.
3. **MCP Stdio Server**: The AI agent automatically launches the Revyme MCP stdio server via the `mcp_config.json` entry above (or manually via `node packages/cli/dist/main.js mcp`).

---

## 2. MCP v2 Operations

Use the currently registered `mcp__revyme_v2` tools and their live schemas. In Codex the
wrappers look like `mcp__revyme_v2__pages_list`; an MCP SDK client calls the corresponding
dot-name such as `pages.list`.

- Discover operations with `meta.index`; inspect exact arguments and examples with
  `meta.tools({ includeSchemas: true, names: [...] })`. Use `meta.guide` for the workflow.
- Pass the intended `projectId` and `branchId` on scoped calls when available. Browser
  selection is not a reliable project/branch selector. For deterministic CLI runs, set
  `REVYME_PROJECT_ID` and `REVYME_BRANCH_ID` and still pass explicit IDs in test calls.
  When switching projects in a shared client or shell, always change both IDs together: a stale
  `REVYME_BRANCH_ID` from another project can make a healthy project look missing if that branch
  does not exist there.
- Read source through `pages.list`, `codeFiles.list/read/search`, and domain reads such as
  `nodes.get`, `styles.get`, `components.get`, or `cms.schema.list`; mutate through the
  matching typed operations. Use `dryRun: true` where supported, then verify commit receipts
  and read changed source back.
- A successful mutation returns its durable commit receipt in `data` and its compact,
  operation-specific output in top-level `operationResult` (for example, a created `formId`
  or `nodeId`). Use those returned IDs for the next call instead of scraping generated
  source; dry-runs preserve the same summary alongside the proposed plan.
- Use the exact preset names returned by `presets.list`; `presets.apply` accepts both
  category-prefixed names (such as `radius-card`) and short names (such as `card`).
- Distinguish Next.js server `layout.tsx` wrappers from editable route-group
  `LayoutClient.tsx` templates. The server wrapper may contain metadata, CSS imports,
  and `<html>/<body>`; do not apply canvas-page expectations to it. `fonts.transformNextFont`
  moves Google font loading into `next/font/google`, removes the matching CSS `@import`,
  and rewrites quoted font families to the generated CSS variable.
- Source operations run headlessly against the selected project snapshot and do not need an
  editor tab to infer context. `observe.*` and rendered-browser checks may need the local
  HTTP bridge and an active Builder tab; trust the operation's reported availability/status.
- Responsive defaults are Desktop 1200px, Tablet 810px, and Mobile 390px. `viewports.list`
  reports these defaults, not the actual tile set of every page; inspect that page's
  `/** @canvas */` block with `codeFiles.read`. Apply a rule with
  `viewports.setOverride({ filePath, nodeId, viewport, styles })`; a missing requested
  default viewport is added to that page's canvas config and positioned after existing tiles.
- Use `variants.*`, `connections.*`, `motion.*`, `textEffects.*`, or `siteEffects.*` for
  animation. Raw CSS `transition` is rejected by the Oracle because the builder cannot edit
  it; do not replace a failed native animation call with untracked CSS.
- For page state, pair `variables.*` with `variables.bind` and `pageInteractions.*`. The
  `HANDLER_CONTENT_STATE` Oracle intentionally allows numeric reset literals (for example
  `'0'`) and empty-string clears only; non-empty text/color literals in setters are rejected
  because hidden content/state machines cannot round-trip through the editor. Use design
  component variants/connections or CMS for content switching. For `expressions.bind` href,
  target a Next.js `<Link>` or configured `<MotionLink>`, never a raw navigating `<a>`; use
  the operation-specific schema and Oracle diagnostics for supported expression shapes.
- If a valid MCP call fails, diagnose the server operation, add a regression test, record the
  exact symptom/cause/fix in `MCP_V2_ISSUES.md`, then verify through a fresh independent MCP
  stdio child after rebuilding. Do not hide a server defect with direct file writes or an
  alternate mutation path.
- For a broad MCP audit, inventory the live registry (not the legacy examples in this file),
  track each operation in a per-tool matrix, and distinguish committed/read-back success,
  successful dry-run, expected negative path, and safety exclusion. A schema-valid `meta.tools`
  example may still depend on a real target node, route, collection, or file; use a compatible
  fixture before claiming execution success. Do not count `NODE_NOT_FOUND` or similar missing
  resource responses as a passing mutation test.
- The plan validator must apply canvas data-id/Oracle dialect only to editable pages, templates,
  and design components. Keep generated/materialized runtimes, icon-set masters, code overrides,
  and plugin entrypoints on their own validation path: retain syntax, relative-import, and
  operation-specific checks, but do not require page-root markup or canvas IDs in code that is
  not rendered as an editable page. When a generated MCP operation emits an import, include its
  runtime file in the same plan so validation sees a resolvable projected source tree.
- Generated helper components must also round-trip through the Oracle, not just the page that
  imports them. In particular, `forms.submitButton.add` must include its generated/upgraded
  `components/FormSubmit.tsx` and `components/Spinner.tsx` in the same validated plan. Use
  keyed conditional children inside `<AnimatePresence mode="popLayout">` for submit states;
  do not model hidden states with `display: none`. Continuous Spinner rotation needs the
  builder's `data-loop` marker. After the form operation, read back the helper sources and run
  `diagnostics.projectCheck`; non-blocking drift warnings still mean the generated code is not
  fully editor-compatible. Preserve user-authored helper components rather than overwriting
  them during generated-component upgrades.
- `cms.api.searchField.add` and `.setVariable` must keep the field, React state hook/import, and
  the repeater's `valueSource: "searchField"` filter on the same variable. After rebinding,
  inspect the parsed filter as well as the input's `data-search-field`/`value`/`onChange`; a
  visible text field alone does not prove the search still filters results. Headless operations
  must add the React `useState` import themselves rather than depending on the canvas mutation
  queue's later import synchronization.

---

### Historical MCP v1 names (not executable in the current MCP v2 registry)

The agent can send requests to the builder in two ways:
1. **Through MCP Tools directly** (Antigravity / Claude loaded tools):
   - `revyme_insert_fragment`: **PRIMARY TOOL for UI generation.** Atomically inserts entire subtrees (sections, cards, grids) with auto-generated IDs, native Framer Motion hovers, and responsive viewports (`tablet`, `mobile`).
   - `revyme_insert_section`: Inserts an art-directed section blueprint (`header-editorial`, `header-glass`, `hero-editorial`, `hero-typewall`) with verified responsive layout and typography.
   - `revyme_add_component_instance`: **PRIMARY TOOL for placing components.** Instantiates a reusable master (Navbar, Hero, ProjectCard, PrimaryButton) into any container with typed props (`studioName`, `title`, `initialVariant`) and position.
   - `revyme_set_variant`: Sets/updates styles or text for a specific variant state in the component master (e.g. `variant: 'menu-open'`, `styles: { ... }`).
   - `revyme_show_variant`: **CANVAS DISPLAY TOOL.** Switches which variant an instance actively displays on canvas (`initialVariant`). Use this to preview or inspect non-default states like `'menu-open'` on canvas!
   - `revyme_add_connection`: **INTERACTION TRIGGER TOOL.** Wires a trigger (`click`, `mouseEnter`, `mouseLeave`, `inView`, `afterDelay`) from an element (`source_node`, e.g. hamburger button) to toggle or switch variants (`from: 'default'`, `to: 'menu-open'`).
   - `revyme_open_editor`: Opens `http://localhost:3333/builder` in the user's browser and waits for the SSE connection to become active.
   - `revyme_list_built_in_components`: Browse Revyme's ~80 built-in code components (Marquee, Carousel, shaders, text effects, cursors, embeds).
   - `revyme_add_built_in_component`: Install and place a built-in component (e.g. `Marquee`, `Carousel`, `AuroraBackground`) into any container.
   - `revyme_set_responsive_styles`: Set responsive overrides for `'tablet'` (810px) or `'mobile'` (375px) on any element.
   - `revyme_apply_motion_preset`: Applies calibrated spring animations (`lift-on-hover`, `scale-on-hover`, `fade-up`, `stagger-children`).
   - `revyme_manage_component_variant`: Creates and manages interactive variant states (`default-hover`, etc.) on Design Components.
   - `revyme_get_context`: Reads active page/component AST, tokens, CMS collections, and the compact page `nodeTree` (showing exact hierarchy and data-ids).
   - `revyme_inspect_node`: Pointed inspection of any node by `data-id` (returns full CSS styles, attributes, children, and text).
   - `revyme_search_project`: High-speed full-text search across all project files (finds symbols, classes, text, or data-ids without reading files one-by-one).
   - `revyme_audit_design`: Automated visual linter (checks WCAG text contrast, sibling overlaps, child overflows, and responsive viewport sizing).
   - `revyme_read_file`: Reads source code of any project file.
   - `revyme_list_files`: Lists all project files.
   - `revyme_submit_files`: Writes complete files. **Use strictly for Code Components (`@controls`) or non-visual logic. DO NOT use to overwrite whole pages when building UI.**
   - `revyme_manage_presets`: Manages design tokens in globals.css (colors, typography, radii).
   - `revyme_apply_typography_preset`: Applies a typography preset (e.g. `heading-hero`, `heading-section`, `heading-card`, `body-default`, `mono-metadata`) to any text element by data-id, automatically replacing hardcoded font/color/size with design tokens.
   - `revyme_manage_cms`: Comprehensive CMS engine: manages collections, fields, and items; binds repeater lists (`bind_list`) and fields (`bind_field`, `bind_prop`); configures filters/sorting (`set_list_config`) and pagination (`set_pagination`); connects External API CMS (`set_mode`, `configure_api_collection`, `set_list_query`); binds dynamic expressions (`bind_expression`, `unbind_expression`).
   - `revyme_bind_expression`: High-level tool to bind dynamic JavaScript formulas/expressions (fx) to text, link href, or image src (auto-injects Next.js `useParams()`).
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
- **THE CARDINAL RULE: BUTTONS, CARDS, AND NAV ITEMS MUST BE DESIGN COMPONENTS, NEVER RAW INLINE ELEMENTS!**:
  - Whenever building a website, landing page, or section:
    1. **FIRST, define Design Component masters** in `components/<Name>.tsx` with typed props (`title`, `label`, `image`, `tags`, `category`) and `variantConfig` (`default`, `secondary`, `hover`, `asym-b`, `menu-open`).
    2. **ON THE PAGE, INSTANTIATE THE COMPONENTS**:
       - In `revyme_insert_fragment`: use `"tag": "Button"`, `"name": "Primary CTA"`, and pass props/variants in `"attrs": { "label": "Explore Work", "variant": "secondary" }`.
       - Or via `revyme_add_component_instance`: `{ "name": "ProjectCard", "variant": "hover", "props": { "title": "...", "category": "..." } }`.
    3. **CRITICAL ANTI-PATTERN STRICTLY FORBIDDEN**: Never inline raw `<button>` tags or copy-paste hundreds of lines of duplicate raw `<div>` blocks on the page!
       - Inlined raw elements prevent the user from editing props in the Inspector.
       - Inlined raw elements prevent the user from duplicating cards/buttons with one click or swapping variants in the panel.
       - Inlined raw elements BREAK component variant transitions (`default-hover`, `menu-open`, etc.).
       - If the user wants to add a button or card, they should only need to add an instance of `<Button />` or `<ProjectCard />`, not hand-craft raw HTML trees!
- **Navbars & Headers Rule**: When asked to create a navigation bar or header as a component, **NEVER build it as a closed Code Component with internal React `useState(false)` and `mixBlendMode: 'difference'`**. Instead:
  1. Create a **Design Component** with visual variant states (`default` vs `menu-open`) using `create_component` (or `revyme_manage_component_variant`)!
  2. Wire the toggle button with `revyme_add_connection`: trigger `'click'` from the hamburger button switches from `'default'` to `'menu-open'`.
  3. Instantiate `<Navbar />` on the page via `revyme_insert_fragment` or `revyme_add_component_instance`.
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

### A. Reading & Inspecting Context Before Editing
Always query the editor first to understand the current page structure, active `data-id`s, and design tokens:
- **`revyme_get_context`**:
  - `result.activeFilePath`: path of the file currently open on the canvas (`app/page.client.tsx`, etc.).
  - `result.nodeTree`: compact, human-readable indented tree of the active canvas (showing exact `data-id`s, tags, names, and abbrev styles). Use this to choose exact `parent_id`s for `revyme_insert_fragment`!
  - `result.code`: complete raw TSX code.
  - `result.presets`: available design tokens (`color-*`, `typo-*`, `space-*`).
  - `result.collections`: CMS collections with fields and schemas.
- **`revyme_inspect_node`**:
  - Call with `{ "node_id": "site-header" }` to inspect any node's full unabbreviated styles, responsive overrides, text, and children.
- **`revyme_search_project`**:
  - Call with `{ "query": "ProjectCard" }` or `{ "query": "--color-bg" }` to search across all project files instantly without reading files one-by-one.
- **`revyme_audit_design`**:
  - Run this after inserting or modifying sections: `{ "viewport": "tablet" }`. It automatically checks for WCAG contrast violations, overlapping siblings (>4px), and child overflow (>8px) beyond parent or viewport boundaries!

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

### D. The Mandatory 5-Phase Design-System-First (DS-First) Protocol

In Revyme, professional sites are built using **Design-System-First Architecture**. Never jump directly into inlining raw HTML tags (`<button>`, repetitive `<div>` cards) inside page fragments. Always follow the 5 phases in order:

#### Phase 1: Design Tokens & Foundations (`revyme_manage_presets`)
Establish the global CSS variables in `globals.css` before authoring any components or layouts:
- Semantic colors: `color-bg`, `color-text`, `color-text-secondary`, `color-border-hairline`, `color-accent`, `color-footer-bg`.
- Radii and borders: `radius-card`, `radius-pill`, `border-hairline`.
```json
{
  "action": "set",
  "tokens": [
    { "name": "color-bg", "value": "#FFFFFF", "category": "color" },
    { "name": "color-text", "value": "#000000", "category": "color" },
    { "name": "color-text-secondary", "value": "#525252", "category": "color" },
    { "name": "color-border-hairline", "value": "rgba(0, 0, 0, 0.10)", "category": "color" }
  ]
}
```

> [!CRITICAL]
> **CRITICAL RULE: NEVER HARDCODE RAW STYLES WHEN PRESETS EXIST.**
> Creating presets in `revyme_manage_presets` is meaningless if you don't consume them.
> 1. **Colors & Borders**: NEVER use raw `#000000`, `#FFFFFF`, `#525252`, or `rgba(...)` in component/section styles. ALWAYS use `var(--color-bg)`, `var(--color-text)`, `var(--color-border-hairline)`, etc.
> 2. **Typography**: Every heading, subhead, paragraph, and mono metadata tag MUST use typography presets — either by referencing `var(--typo-<name>-font)`, `var(--typo-<name>-size)`, `var(--typo-<name>-weight)` in the fragment, or by calling `revyme_apply_typography_preset({ node_id, preset })` immediately after inserting the fragment!

#### Phase 2: Master Design Component Library (`create_component` via `revyme_agent_tool`)
Author atomic and molecular UI primitives in `components/<Name>.tsx` using `create_component`.
Every component must declare:
1. **`props`**: Typed interface with defaults (e.g. `label`, `href`, `title`, `category`, `year`).
2. **`variants`**: Visual states (`default`, `secondary`, `hover`, `asym-b`, `menu-open`).
3. **`elements`**: Tree of nodes, each with `position: 'relative'`.

**Example: Creating a Reusable Button Component (`StudioButton`)**:
```json
{
  "name": "create_component",
  "input": {
    "name": "StudioButton",
    "props": [{ "name": "label", "type": "string", "defaultValue": "CLICK HERE" }],
    "variants": [
      { "name": "default" },
      { "name": "secondary" }
    ],
    "elements": [
      {
        "id": "btn-root",
        "tag": "div",
        "styles": { "display": "flex", "position": "relative" },
        "children": [
          {
            "id": "btn-el",
            "tag": "button",
            "styles": {
              "position": "relative",
              "display": "flex",
              "alignItems": "center",
              "justifyContent": "center",
              "padding": "14px 28px",
              "backgroundColor": "var(--color-text)",
              "color": "var(--color-bg)",
              "borderRadius": "4px",
              "cursor": "pointer"
            },
            "children": [
              {
                "id": "btn-label",
                "tag": "span",
                "styles": { "position": "relative", "fontFamily": "var(--typo-heading-font)", "fontSize": "14px", "fontWeight": "700" },
                "text": "{label}"
              }
            ]
          }
        ]
      }
    ]
  }
}
```
Follow up with `revyme_set_variant` to style the `secondary` variant (e.g. `backgroundColor: "var(--color-bg)"`, `color: "var(--color-text)"`, `border: "1px solid var(--color-border-hairline)"`).

#### Phase 3: Page Assembly via Fragment Composition (`revyme_insert_fragment`)
Now compose full-bleed sections and centered containers. **Insert component instances directly using uppercase tags** (`tag: "StudioButton"`, `tag: "ProjectCard"`):
```json
{
  "parent_id": "root",
  "fragment": {
    "tag": "section",
    "name": "Hero Section",
    "styles": {
      "width": "100%",
      "backgroundColor": "var(--color-bg)",
      "paddingTop": "120px",
      "paddingBottom": "90px",
      "display": "flex",
      "flexDirection": "column",
      "alignItems": "center"
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
        "children": [
          {
            "tag": "h1",
            "id": "h1-hero-title",
            "text": "STUDIO DISCIPLINE",
            "styles": {
              "fontFamily": "var(--typo-heading-hero-font)",
              "fontSize": "var(--typo-heading-hero-size)",
              "fontWeight": "var(--typo-heading-hero-weight)",
              "lineHeight": "var(--typo-heading-hero-line-height)",
              "letterSpacing": "var(--typo-heading-hero-spacing)",
              "color": "var(--typo-heading-hero-color)"
            }
          },
          {
            "tag": "div",
            "name": "Button Row",
            "styles": { "display": "flex", "gap": "20px", "marginTop": "40px" },
            "children": [
              {
                "tag": "StudioButton",
                "name": "Primary CTA",
                "attrs": { "label": "EXPLORE ARCHIVE", "variant": "default" }
              },
              {
                "tag": "StudioButton",
                "name": "Secondary CTA",
                "attrs": { "label": "READ MONOGRAPH ↗", "variant": "secondary" }
              }
            ]
          }
        ]
      }
    ]
  }
}
```
*Tip: You can also call `revyme_apply_typography_preset({ node_id: "h1-hero-title", preset: "heading-hero" })` to automatically bind all font and color properties to the typography preset!*
*Notice how `<StudioButton>` is cleanly instantiated with `label` and `variant`, and all colors and typography use design tokens! No raw `<button>` tags or hardcoded `#000000` / `#FFFFFF` values!*

#### Phase 4: Interaction Wiring & Variant State (`revyme_add_connection`, `revyme_show_variant`)
Wire interactive triggers between variants on components:
- Wire hamburger menu toggle:
  ```json
  {
    "component": "Navbar",
    "from": "default",
    "to": "menu-open",
    "trigger": "click",
    "source_node": "navbar-hamburger-btn"
  }
  ```
- Change displayed variant on an instance:
  `revyme_show_variant({ "node_id": "<instance-data-id>", "variant": "asym-b" })`

#### Phase 5: Responsive Verification & Visual Audit (`revyme_audit_design`)
Run automated linting on viewports to verify contrast and prevent overflow:
- Call `revyme_audit_design({ "viewport": "desktop" })`
- Call `revyme_audit_design({ "viewport": "tablet" })`
- Call `revyme_audit_design({ "viewport": "mobile" })`
- Fine-tune any element styles per viewport with `revyme_set_responsive_styles`.

---

### E. Responsive dimensions and fluid text

The Builder's editable style dialect accepts `clamp()` for font size in typography
presets only. Do not use `clamp()` in raw element styles, spacing/radius presets, or any
other CSS property: the Oracle rejects or the Builder cannot round-trip those values.

- For responsive text, create or use a complete typography preset and keep its fluid
  `font-size` there; all other text properties belong to that same preset.
- For responsive padding, margin, and radius, use their preset editors and set explicit
  pixel values at Desktop, Tablet, and Mobile breakpoints.
- For responsive element-level styles outside those presets, use `viewports.setOverride`
  with pixel values and verify the page has the matching viewport tile.
- Do not add standalone `space-*` clamp tokens or inline `clamp()` declarations. Use the
  Utopia reference only as a guide for choosing the text preset's fluid font-size values.

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
   <motion.button
     data-id="btn"
     onTapStart={() => setVariant('default-hover')}
     onHoverEnd={() => setVariant('default')}
     style={{
       backgroundColor: variant === 'default-hover' ? '#4f46e5' : '#4338ca',
       transform: variant === 'default-hover' ? 'translateY(-2px)' : 'none',
     }}
   >
     Click Me
   </motion.button>
   ```
   *(Note: Motion timing and spring physics are driven automatically by Framer Motion / MotionConfig — NEVER write inline `transition: 'all 0.2s'` in the style object!)*

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
         }}
       />
       ```
       When the user hovers over `<ProjectCard />`, the master's variant triggers `default-hover`, bringing the image into vivid full color!

---

### G. Revyme Oracle: 216 Rules & Core Invariants for Design Components & Code

All TSX files submitted or edited undergo strict AST validation in `src/code/oracle/`. The builder enforces **216 unique architectural and dialect rules** across 13 functional areas. Violating ANY rule rejects the file save immediately.

> [!IMPORTANT]
> For the complete categorized directory of all 216 rules with exact descriptions and AST requirements, refer directly to:
> [`references/oracle-rules.md`](file:///d:/revyme-fork/revyme-builder-fork/.agents/skills/revyme-mcp/references/oracle-rules.md)

#### Top Core Rules (Always Check Before Submitting)

| Oracle Rule | What It Checks | Correct Pattern | Why It Exists |
| :--- | :--- | :--- | :--- |
| **1. `COMPONENT_ROOT_POSITION`** | Root of a Design Component master cannot have `position: 'sticky'`, `fixed`, or `relative` with inset offsets | Root has `position: 'relative'` (or omits `position`). If the element should stick to the page top, the **page instance** carries `position: 'sticky'`! | The visual canvas owns artboard coordinates (`variantConfig` x/y + `...style` spread). Fixed/sticky on the master root breaks canvas placement. |
| **2. `ROOT_STYLE_SPREAD`** | The component root's inline style object MUST end with `...style` | `style={{ position: 'relative', width: '100%', ..., ...style }}` | Instances on the page and canvas overrides depend on spreading `...style` onto the master root. |
| **3. `ANIMATEPRESENCE_POPLAYOUT_MODE`** | `<AnimatePresence>` must have `mode="popLayout"` | `<AnimatePresence mode="popLayout">`<br/>Child must have `key="unique-id"` and `layout={true}` | Without `popLayout`, exiting elements occupy layout space until animation ends, causing siblings to snap abruptly. |
| **4. `ANIMATEPRESENCE_CHILD_LAYOUT` & `ANIMATEPRESENCE_KEY`** | Direct conditional children inside `<AnimatePresence>` must have `layout={true}` and `key="<data-id>"` | `<motion.div key="header-mobile-drawer" layout={true} ...>` | Framer Motion requires `layout={true}` and explicit key to interpolate layout geometry smoothly during mount/unmount. |
| **5. `VARIANT_VISIBILITY_CONDITION`** | Conditional rendering inside components must be an exact inline variant check | `{variant === 'menu-open' && <motion.div ... />}`<br/>*(NEVER `{isOpen && ...}` or variables!)* | The canvas parser statically evaluates visibility conditions to determine `hiddenOnVariants`. Variables return null and render on ALL variants. |
| **6. `FLEX_CHILD_MISSING_ORDER` & `FLEX_CHILD_SHRINKS`** | Every flow child in a flex/grid container must have sequential string `order` and no shrink | `style={{ order: '0', flex: '0 0 auto', ... }}`<br/>Next sibling: `order: '1'`, `flex: '0 0 auto'` | Revyme's drag-to-reorder engine manipulates CSS `order: String(n)`. Missing orders break drag reordering; shrinking collapses children to 0px. |
| **7. `CSS_TRANSITION`** | Inline CSS `transition:` strings are forbidden | **DELETE** `transition: 'all 0.3s'`. Use Framer Motion `transition={{ type: 'spring', ... }}` or `export const transitions` | CSS transitions conflict with Framer Motion's FLIP projection and cannot be adjusted in the Inspector Animation panel. |
| **8. `ATTR_ORDER_DATA_ID_FIRST`** | Place `data-id` and `data-name` FIRST on every tag, before `style` and motion props | `<div data-id="card-root" data-name="Card" style={{ ... }}>` | Parser attribute scanners read in order; early style tags block ID binding. |
| **9. `COMPONENT_CHILD_FIXED_WIDTH`** | Never hardcode the component artboard width (e.g. `1200px`) on inner spanning containers | Use `width: '100%'` with optional `maxWidth: '1200px'` | Hardcoded master artboard widths break responsive scaling when the component is placed on mobile/tablet viewports. |
| **10. `TEXT_EXPRESSION`** | The text editing tool cannot edit computed JavaScript expressions | Write text as clean string literals, or bind expressions via `revyme_bind_expression` (`item.<field>`) | The visual canvas text tool directly binds to string literals; computed expressions cannot be round-tripped. |
| **11. `FREE_CANVAS_LEFT_PLACEMENT`** | Free-canvas nodes (slot candidates, marquee/carousel cards) MUST ALWAYS be positioned to the LEFT of the site | Use negative X coordinates (`left: '-380px'`, `left: '-760px'`). **NEVER** use positive `left` (e.g. `1350px`) | The right side of the canvas ($x \ge 0$) is reserved for responsive viewports (Tablet at $x=1360$, Mobile at $x=2330$). Placing nodes on the right causes physical overlap and visual breakage with breakpoints! |
| **12. `VARIANT_CONFIG_NON_OVERLAPPING`** | Variant artboards in component files (`variantConfig`) must NEVER overlap | Offset variants by at least `width + 80px` horizontally (e.g. `x: 0`, `x: 1400`) or `height + 80px` vertically | Overlapping coordinates in `variantConfig` cause the component editor to render variant artboards directly on top of each other, making visual editing impossible. |
| **13. `FIXED_DEPTH_AND_BLEND_MODE`** | Never put `position: 'fixed'` or `mixBlendMode: 'difference'` inside component masters | Use `position: 'sticky', top: 0` on the root header with explicit background color (e.g. `rgba(255,255,255,0.85)` + `backdropFilter: 'blur(16px)'`) | Inside component masters, `position: 'fixed'` is trapped by Framer Motion's `transform` containing block and becomes invisible or displaced on the canvas. `mixBlendMode: 'difference'` renders as invisible/black on canvas iframe transparent layers. |
| **14. `RAW_STYLE_TAG_PROHIBITION`** | Raw `<style>` tags with `@media` in JSX are strictly forbidden | Use responsive dimension presets or `viewports.setOverride` with pixel values; fluid `clamp()` is allowed only in typography preset font-size | Raw `<style>` blocks bypass the visual inspector and cannot be edited by the builder panels. |

---

### H. Professional Header, Navbar & Drawer Navigation Architecture

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

This boilerplate strictly satisfies **all 216 Oracle Rules**, includes native **`connections`** to open/close on click, and provides 100% canvas inspectability:

```tsx
"use client";

/** @name "Navbar" */

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { withResponsiveProps } from "@revyme/runtime";
import { motion, AnimatePresence } from "framer-motion";

const MotionLink = motion.create(Link);

export const variantConfig = [
  { name: 'default', label: 'Default', x: 0, y: 0, isPrimary: true },
  { name: 'menu-open', label: 'Menu Open', x: 0, y: 500 }
];

const connections = [
  { from: 'default', to: 'menu-open', trigger: 'click', sourceNode: 'header-toggle-btn' },
  { from: 'menu-open', to: 'default', trigger: 'click', sourceNode: 'drawer-close-btn' }
];

function Navbar({
  initialVariant = 'default',
  logoText = 'Studio',
  badgeText = 'Index',
  metadataText = 'Selected Works',
  drawerFooterLeft = 'Studio © 2026',
  drawerFooterRight = 'All Rights Reserved',
  style,
}: {
  initialVariant?: string;
  logoText?: string;
  badgeText?: string;
  metadataText?: string;
  drawerFooterLeft?: string;
  drawerFooterRight?: string;
  style?: React.CSSProperties;
}) {
  const [variant, setVariant] = useState(initialVariant);
  useEffect(() => {
    setVariant(initialVariant);
  }, [initialVariant]);

  return (
    <motion.div
      data-id="site-nav-root"
      data-name="Navbar"
      style={{
        width: '1280px',
        height: 'auto',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#FFFFFF',
        ...style,
      }}
    >
      <header
        data-id="site-header-bar"
        data-name="Header Bar"
        style={{
          position: 'relative',
          width: '100%',
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '24px 32px',
          borderBottom: '1px solid rgba(0, 0, 0, 0.10)',
          boxSizing: 'border-box',
          order: '0',
          flex: '0 0 auto',
        }}
      >
        <div
          data-id="header-brand-wrap"
          data-name="Brand Wrap"
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            order: '0',
            flex: '0 0 auto',
          }}
        >
          <MotionLink
            data-id="header-logo-link"
            data-name="a"
            href="#hero"
            layout={true}
            style={{
              position: 'relative',
              textDecoration: 'none',
              order: '0',
              flex: '0 0 auto',
            }}
          >
            <span
              data-id="header-logo-text"
              data-name="Logo"
              style={{
                position: 'relative',
                fontFamily: "'Inter', sans-serif",
                fontSize: '24px',
                fontWeight: '700',
                letterSpacing: '-0.05em',
                lineHeight: '0.9',
                color: '#000000',
                textTransform: 'lowercase',
                order: '0',
                flex: '0 0 auto',
              }}
            >
              {logoText}
            </span>
          </MotionLink>
          <span
            data-id="header-edition-pill"
            data-name="Edition Pill"
            style={{
              position: 'relative',
              fontFamily: 'monospace',
              fontSize: '11px',
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              padding: '3px 8px',
              borderRadius: '2px',
              border: '1px solid rgba(0, 0, 0, 0.10)',
              color: '#525252',
              order: '1',
              flex: '0 0 auto',
            }}
          >
            {badgeText}
          </span>
        </div>

        <div
          data-id="header-actions-wrap"
          data-name="Actions Wrap"
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            gap: '24px',
            order: '1',
            flex: '0 0 auto',
          }}
        >
          <span
            data-id="header-location"
            data-name="Location"
            style={{
              position: 'relative',
              fontFamily: 'monospace',
              fontSize: '12px',
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              color: '#737373',
              order: '0',
              flex: '0 0 auto',
            }}
          >
            {metadataText}
          </span>
          <motion.button
            data-id="header-toggle-btn"
            data-name="Menu Toggle Button"
            type="button"
            onTap={() => {
              const _n = variant === 'default' ? 'menu-open' : null;
              if (_n) setVariant(_n);
            }}
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              padding: '10px 18px',
              backgroundColor: '#000000',
              border: 'none',
              borderRadius: '2px',
              cursor: 'pointer',
              order: '1',
              flex: '0 0 auto',
            }}
          >
            <span
              data-id="toggle-btn-label"
              data-name="Toggle Label"
              style={{
                position: 'relative',
                fontFamily: 'monospace',
                fontSize: '12px',
                fontWeight: '700',
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                color: '#FFFFFF',
                order: '0',
                flex: '0 0 auto',
              }}
            >
              MENU
            </span>
            <span
              data-id="toggle-btn-plus"
              data-name="Plus Icon"
              style={{
                position: 'relative',
                fontFamily: "'Inter', sans-serif",
                fontSize: '16px',
                fontWeight: '700',
                lineHeight: '1',
                color: '#FFFFFF',
                order: '1',
                flex: '0 0 auto',
              }}
            >
              +
            </span>
          </motion.button>
        </div>
      </header>

      <AnimatePresence mode="popLayout">
        {variant === 'menu-open' && (
          <motion.div
            key="nav-fullscreen-overlay"
            data-id="nav-fullscreen-overlay"
            data-name="Fullscreen Overlay"
            layout={true}
            initial={{ opacity: 0, y: -24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -24 }}
            transition={{ type: 'spring', stiffness: 350, damping: 25 }}
            style={{
              position: 'absolute',
              top: '0px',
              left: '0px',
              width: '100%',
              height: '800px',
              zIndex: 9999,
              backgroundColor: '#0A0A0A',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              padding: '32px 48px',
              boxSizing: 'border-box',
              order: '1',
              flex: '0 0 auto',
            }}
          >
            <div
              data-id="drawer-top-bar"
              data-name="Drawer Top Bar"
              style={{
                position: 'relative',
                width: '100%',
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderBottom: '1px solid rgba(255, 255, 255, 0.10)',
                paddingBottom: '24px',
                order: '0',
                flex: '0 0 auto',
              }}
            >
              <span
                data-id="drawer-logo"
                data-name="Drawer Logo"
                style={{
                  position: 'relative',
                  fontFamily: "'Inter', sans-serif",
                  fontSize: '24px',
                  fontWeight: '700',
                  color: '#FFFFFF',
                  letterSpacing: '-0.05em',
                  order: '0',
                  flex: '0 0 auto',
                }}
              >
                sd
              </span>
              <motion.button
                data-id="drawer-close-btn"
                data-name="Drawer Close Button"
                type="button"
                onTap={() => {
                  const _n = variant === 'menu-open' ? 'default' : null;
                  if (_n) setVariant(_n);
                }}
                style={{
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '10px 18px',
                  backgroundColor: '#FFFFFF',
                  border: 'none',
                  borderRadius: '2px',
                  cursor: 'pointer',
                  order: '1',
                  flex: '0 0 auto',
                }}
              >
                <span
                  data-id="drawer-close-label"
                  data-name="Close Label"
                  style={{
                    position: 'relative',
                    fontFamily: 'monospace',
                    fontSize: '12px',
                    fontWeight: '700',
                    textTransform: 'uppercase',
                    letterSpacing: '0.1em',
                    color: '#000000',
                    order: '0',
                    flex: '0 0 auto',
                  }}
                >
                  CLOSE
                </span>
                <span
                  data-id="drawer-close-icon"
                  data-name="Close Icon"
                  style={{
                    position: 'relative',
                    fontSize: '14px',
                    fontWeight: '700',
                    color: '#000000',
                    order: '1',
                    flex: '0 0 auto',
                  }}
                >
                  ✕
                </span>
              </motion.button>
            </div>

            <nav
              data-id="drawer-nav-list"
              data-name="Drawer Nav List"
              style={{
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
                paddingTop: '40px',
                paddingBottom: '40px',
                order: '1',
                flex: '0 0 auto',
              }}
            >
              <MotionLink
                data-id="drawer-link-1"
                data-name="a"
                href="#projects"
                layout={true}
                onClick={() => {
                  const _n = variant === 'menu-open' ? 'default' : null;
                  if (_n) setVariant(_n);
                }}
                style={{
                  position: 'relative',
                  textDecoration: 'none',
                  order: '0',
                  flex: '0 0 auto',
                }}
              >
                <span
                  data-id="drawer-link-text-1"
                  data-name="Link Text"
                  style={{
                    position: 'relative',
                    fontFamily: "'Inter', sans-serif",
                    fontSize: '48px',
                    fontWeight: '700',
                    letterSpacing: '-0.05em',
                    lineHeight: '1',
                    color: '#FFFFFF',
                    order: '0',
                    flex: '0 0 auto',
                  }}
                >
                  01 / SELECTED WORK
                </span>
              </MotionLink>
              <MotionLink
                data-id="drawer-link-2"
                data-name="a"
                href="#marquee"
                layout={true}
                onClick={() => {
                  const _n = variant === 'menu-open' ? 'default' : null;
                  if (_n) setVariant(_n);
                }}
                style={{
                  position: 'relative',
                  textDecoration: 'none',
                  order: '1',
                  flex: '0 0 auto',
                }}
              >
                <span
                  data-id="drawer-link-text-2"
                  data-name="Link Text"
                  style={{
                    position: 'relative',
                    fontFamily: "'Inter', sans-serif",
                    fontSize: '48px',
                    fontWeight: '700',
                    letterSpacing: '-0.05em',
                    lineHeight: '1',
                    color: '#FFFFFF',
                    order: '0',
                    flex: '0 0 auto',
                  }}
                >
                  02 / ARCHIVE
                </span>
              </MotionLink>
              <MotionLink
                data-id="drawer-link-3"
                data-name="a"
                href="#statement"
                layout={true}
                onClick={() => {
                  const _n = variant === 'menu-open' ? 'default' : null;
                  if (_n) setVariant(_n);
                }}
                style={{
                  position: 'relative',
                  textDecoration: 'none',
                  order: '2',
                  flex: '0 0 auto',
                }}
              >
                <span
                  data-id="drawer-link-text-3"
                  data-name="Link Text"
                  style={{
                    position: 'relative',
                    fontFamily: "'Inter', sans-serif",
                    fontSize: '48px',
                    fontWeight: '700',
                    letterSpacing: '-0.05em',
                    lineHeight: '1',
                    color: '#FFFFFF',
                    order: '0',
                    flex: '0 0 auto',
                  }}
                >
                  03 / MANIFESTO
                </span>
              </MotionLink>
              <MotionLink
                data-id="drawer-link-4"
                data-name="a"
                href="#footer"
                layout={true}
                onClick={() => {
                  const _n = variant === 'menu-open' ? 'default' : null;
                  if (_n) setVariant(_n);
                }}
                style={{
                  position: 'relative',
                  textDecoration: 'none',
                  order: '3',
                  flex: '0 0 auto',
                }}
              >
                <span
                  data-id="drawer-link-text-4"
                  data-name="Link Text"
                  style={{
                    position: 'relative',
                    fontFamily: "'Inter', sans-serif",
                    fontSize: '48px',
                    fontWeight: '700',
                    letterSpacing: '-0.05em',
                    lineHeight: '1',
                    color: '#FFFFFF',
                    order: '0',
                    flex: '0 0 auto',
                  }}
                >
                  04 / DIRECT INQUIRIES
                </span>
              </MotionLink>
            </nav>

            <div
              data-id="drawer-footer-meta"
              data-name="Drawer Footer Meta"
              style={{
                position: 'relative',
                width: '100%',
                display: 'flex',
                flexDirection: 'row',
                justifyContent: 'space-between',
                borderTop: '1px solid rgba(255, 255, 255, 0.10)',
                paddingTop: '20px',
                order: '2',
                flex: '0 0 auto',
              }}
            >
              <span
                data-id="drawer-meta-left"
                data-name="Meta Left"
                style={{
                  position: 'relative',
                  fontFamily: 'monospace',
                  fontSize: '13px',
                  color: '#737373',
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                  order: '0',
                  flex: '0 0 auto',
                }}
              >
                {drawerFooterLeft}
              </span>
              <span
                data-id="drawer-meta-right"
                data-name="Meta Right"
                style={{
                  position: 'relative',
                  fontFamily: 'monospace',
                  fontSize: '13px',
                  color: '#737373',
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                  order: '1',
                  flex: '0 0 auto',
                }}
              >
                {drawerFooterRight}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default withResponsiveProps(Navbar);
```
```

#### 3. How to Instantiate and Solve the Canvas Display Paradox

1. **Instantiate on page via `revyme_add_component_instance`**:
   ```json
   {
     "name": "Navbar",
     "parent_id": "root",
     "index": 0,
     "props": { "studioName": "ACME STUDIO" }
   }
   ```
   Or in page JSX:
   ```tsx
   <Navbar data-id="site-nav-instance" style={{ position: 'sticky', top: 0, zIndex: 100 }} />
   ```
   *(Note: Sticky belongs on the page instance, which satisfies `COMPONENT_ROOT_POSITION`!)*

2. **The Canvas Display Paradox**:
   - By default, the canvas renders `initialVariant = 'default'`, which means the drawer overlay is hidden (`variant === 'menu-open'` is false).
   - If an agent wants to preview, audit, or style the opened menu drawer on the canvas:
     Call `revyme_show_variant`:
     ```json
     {
       "node_id": "site-nav-instance",
       "variant": "menu-open"
     }
     ```
     The canvas immediately displays the open drawer!
   - To return to normal view, switch back:
     ```json
     {
       "node_id": "site-nav-instance",
       "variant": "default"
     }
     ```

3. **Wiring Click Interactions via MCP**:
   To wire a button click to a variant switch dynamically, use `revyme_add_connection`:
   ```json
   {
     "component": "Navbar",
     "from": "default",
     "to": "menu-open",
     "trigger": "click",
     "source_node": "header-hamburger-btn"
   }
   ```
   This automatically injects the `variantConnections` record and wires `onTap` to `setVariant('menu-open')` on the button!

---

#### 4. Anti-Pattern: Never Inline Headers via revyme_insert_fragment

> [!CAUTION]
> **STRICT PROHIBITION**: NEVER insert `<header>` or `<nav>` as raw inline JSX elements on the page via `revyme_insert_fragment`!
>
> Inlining raw header trees:
> 1. Breaks fullscreen interactive drawer overlays (opening/closing variant states).
> 2. Clutters the page tree with dozens of un-reusable layout frames.
> 3. Triggers Oracle violations (`COMPONENT_ROOT_POSITION`, `FLEX_CHILD_SHRINKS`, `PAGE_LINK_NOT_NEXTLINK`).
> 4. Prevents the user from reusing the navigation bar across subpages (`/about`, `/work`).
>
> **The Mandated Rule**:
> Always author `components/Navbar.tsx` as a Design Component master (Pattern A) or via `revyme_create_navbar`. Then instantiate it on the page using `<Navbar data-id="site-nav-instance" style={{ position: 'sticky', top: 0, zIndex: 100 }} />` or via `revyme_add_component_instance`!

---

### I. The Free-Canvas Slot Connection Protocol (Marquee, Carousel, & Slot Code Components)

> [!IMPORTANT]
> **THE CARDINAL RULE OF SLOTS**: In Revyme and Framer, Code Components with `"type": "slot"` (such as `<Marquee>`, `<Carousel>`, `<EmblaCarousel>`, or `<LensBox>`) **NEVER accept inline JSX children**!
>
> Inlined children are strictly invisible on the canvas and trigger the Oracle error `SLOT_COMPONENT_INLINE_CHILDREN`, causing the Inspector to report **`0 items`**.
>
> **The Mandated Architectural Pattern**:
> 1. Elements connected to a Marquee or Carousel **MUST BE CREATED ON THE FREE CANVAS TO THE LEFT OF THE SITE** (outside any page viewport, using negative X coordinates, e.g. `left: "-380px"`, `left: "-760px"`, `left: "-1140px"`) via `revyme_add_canvas_node`.
>    **NEVER** place free-canvas nodes to the right of the site ($x \ge 0$, e.g. `1350px`), because responsive viewports (Tablet at $x=1360$, Mobile at $x=2330$) occupy the right side of the canvas. Placing nodes on the right creates visual collisions, overlaps, and viewport boundary errors!
> 2. Each free-canvas node carries `data-canvas-node="true"`.
> 3. Each free-canvas node is connected to the slot using `revyme_connect_slot({ "node_id": marqueeInstanceId, "canvas_node_id": cardId })`.
> 4. In generated code, Revyme hoists the node to `const cn_<id> = (<MarqueeCard ... data-canvas-node="true" />)` and references `{cn_<id>}` inside the instance:
>    ```tsx
>    const cn_card_1 = (<MarqueeCard data-id="card-1" data-canvas-node="true" category="01" title="KINETIC" style={{ position: 'absolute', left: '-380px', top: '150px', width: '320px', height: '448px' }} />);
>    const cn_card_2 = (<MarqueeCard data-id="card-2" data-canvas-node="true" category="02" title="BRUTALIST" style={{ position: 'absolute', left: '-760px', top: '150px', width: '320px', height: '448px' }} />);
>    ...
>    <Marquee data-id="marquee-instance" speed={45}>{cn_card_1}{cn_card_2}</Marquee>
>    ```
> 5. This allows designers to visually see, drag, reposition, and edit the cards freely on the canvas outside the page frame (safely docked on the left), while the live Marquee continuously iterates through the connected `{cn_...}` references!

#### Step-by-Step Slot Connection Workflow:
// Step 1: Create card on the free canvas (CRITICAL: Must have position: 'absolute' and negative left offset, e.g. -380px, -760px, so it sits cleanly to the left of the page artboard instead of overlapping the site at 0,0)
{
  "tool": "revyme_add_canvas_node",
  "input": {
    "tag": "MarqueeCard",
    "id": "marquee-card-1",
    "name": "Marquee Card 01",
    "styles": { "position": "absolute", "left": "-380px", "top": "150px", "width": "320px", "height": "448px" },
    "attrs": { "category": "ISSUE 01", "title": "KINETIC MONOGRAPH", "initialVariant": "default" }
  }
}

// Step 2: Connect the free-canvas card to the Marquee slot
{
  "tool": "revyme_connect_slot",
  "input": {
    "node_id": "frame-mvgsaq8o-1",
    "canvas_node_id": "marquee-card-1"
  }
}
```

---

### J. Adding Motion & Animations (Choreography & Springs)
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

### I. Managing CMS & Connecting Dynamic Data
Revyme supports three levels of CMS and dynamic data binding:

1. **Built-in Local CMS**:
   - Create collection: `revyme_manage_cms` with `action: "create_collection"`, `name: "Projects"`.
   - Add fields: `action: "add_field"`, `collection: "projects"`, `name: "Cover"`, `field: { "type": "image" }`.
   - Add items: `action: "add_item"`, `collection: "projects"`, `item: { ... }`.
   - Bind Repeater List: `action: "bind_list"`, `nodeId: "template-row"`, `collection: "projects"`.
   - Bind Field: `action: "bind_field"`, `nodeId: "title-node"`, `property: "text"`, `fieldId: "title"`.
   - Bind Design Component Prop: `action: "bind_prop"`, `nodeId: "card-inst"`, `componentName: "ProjectCard"`, `prop: "title"`, `fieldId: "title"`.
   - Query & Sort: `action: "set_list_config"`, `nodeId: "grid-container"`, `filters: [...]`, `sort: [...]`, `limit: 6`.
   - Pagination: `action: "set_pagination"`, `nodeId: "grid-container"`, `mode: "loadMore"`, `perPage: 6`.

2. **External API CMS Mode (Directus, Strapi, Baserow, REST)**:
   - Switch mode: `action: "set_mode"`, `mode: "api"`.
   - Configure external API endpoint: `action: "configure_api_collection"`, `slug: "articles"`, `apiConfig: { provider: "directus", url: "https://...", headers: { Authorization: "Bearer env:TOKEN" }, itemsKey: "data" }`.
   - Query config with backend parameters & route expressions: `action: "set_list_query"`, `nodeId: "grid"`, `queryConfig: { isApiMode: true, params: [{ key: "filter[cat][_eq]", value: "params.category", isExpression: true }] }`.

3. **Dynamic Expressions & Formulas (`fx`)**:
   - Bind formula: `revyme_bind_expression` (or `action: "bind_expression"` in `revyme_manage_cms`):
     - Text: `{ nodeId: "title", targetProperty: "text", expression: "item.name + ' in ' + item.city" }`
     - Route Params: `{ nodeId: "title", targetProperty: "text", expression: "params.category + ' тату'" }` *(auto-injects `useParams`)*
     - Image URL: `{ nodeId: "img", targetProperty: "src", expression: "`https://cdn.example.com/assets/${item.image}`" }`
     - Link Href: `{ nodeId: "link", targetProperty: "href", expression: "`/${params.lang || 'en'}/projects/${item.slug}`" }`
   - **Syntax Rule**: Never wrap in `{}`; never pass bare numeric literals (`{42}`) directly as JSX text children (convert to string to satisfy Oracle fidelity).

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

### A2. Shared Route Templates (MCP v2)
When the user asks to share a header/footer across routes, use route templates rather than duplicating those instances on each page:

1. Inspect the exact page routes and component names with `pages.list`, `templates.list`, and `components.get` (plus `codeFiles.read` when source details are needed). Preserve existing component masters.
2. Preview `templates.create` with `dryRun: true`, passing the existing header/footer as direct JSX component instances in `headerContent` and `footerContent`. Give each instance stable `data-id` and `data-name` values. Do not wrap a Navbar that renders its own `<header>` in another `<header>`, or a Footer that renders its own `<footer>` in another `<footer>`.
3. The generated `LayoutClient` must have the exact outer `<div data-id="root" data-name="…" style={{ position: 'relative', width: '100%' }}>`; do not add unsupported viewport units such as `minHeight: '100vh'`. Component tags included in template content must be imported from their existing `components/<Name>.tsx` files. Put `{children}` exactly once as a **direct child** of this root—never wrap it in `<main>` or another layout element.
4. After the dry-run is Oracle-clean, create the template with `templates.create`. Before assigning a page, ensure its `data-id="root"` carries only root geometry; move shared background/clipping to the template root and clear those properties from the page root with `nodes.update`. Then assign the homepage using `templates.assign` with `pageSlug: ""`, and remove the old header/footer instances from the moved homepage with `nodes.remove` using their exact IDs and the new `app/(<template>)/page.client.tsx` path.
5. Create additional pages through `pages.create` with the same `template` name. Keep page content in the page body only; do not re-add shared shell components.
6. For a native route crossfade, use `siteEffects.pageTransition.set` for each direction (`page: "/", target: "/about"` and the reverse), with `preset: "crossfade"`. The operation must use the selected route's nearest `LayoutClient`, scaffold the runtime files beside it, and wrap its `{children}` slot; for a route-group template, these files belong under `app/(<template>)/`, not blindly in `app/`. `crossfade` must store opacity `0` on both enter and exit sides. If `siteEffects.pageTransition.get` returns identity opacity `1`, treat it as a failed transition and diagnose the MCP operation. Do not hand-write View Transition CSS or a custom transition component.
7. Verify with `pages.list`, `templates.list`, `siteEffects.pageTransition.get`, `diagnostics.projectCheck`, and `preview.build`; inspect rendered desktop and mobile output where observation tools are available. A page pair (`page.client.tsx` + `page.tsx`) is one public route: the server wrapper must not appear as a duplicate route or expose a route-group name. `preview.build` may report an internal `/__template_preview/<name>` route and may have no live URL when no preview adapter is configured; do not report that as a live preview.

### A3. Test and restart an independent MCP v2 process
When a rebuilt CLI needs live verification, launch it as a child of an MCP SDK client instead of restarting Codex. Keep the Builder API running; the stdio MCP child is separate and can be closed/recreated on demand.

```js
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['packages/cli/bin/revyme.mjs', 'mcp'],
  cwd: process.cwd(), // repository root
  env: {
    ...process.env,
    REVYME_API_URL: 'http://[::1]:3333', // use the Builder's actual API origin
    REVYME_PROJECT_ID: '<project-id>',
    REVYME_BRANCH_ID: 'main',
    REVYME_MCP_BRIDGE_URL: 'http://127.0.0.1:8082', // needed by browser/observe tools
  },
});
const client = new Client({ name: 'independent-revyme-test', version: '1.0.0' });
await client.connect(transport);
const result = await client.callTool({ name: 'pages.list', arguments: {} });
// Restart only this MCP process: close this client, then create/connect a fresh one.
await client.close();
```

Rebuild with `npm run build --workspace=@revyme/cli` before launching the child after CLI source changes; `packages/cli/bin/revyme.mjs` loads the built `dist/main.js` when present. Set `REVYME_API_URL` to the Builder API origin actually in use (this local Builder listens on IPv6 loopback at port 3333; `127.0.0.1:3333` is not reachable here). Screenshot/observe operations also need the HTTP bridge on port 8082 and an active Builder tab. Restart `npm run dev` only when the Builder/API source or its process changed—not merely to reload a CLI MCP child. A Codex restart is only needed if specifically testing Codex's own configured MCP connection, not for routine operation checks.

If the Codex-registered MCP wrapper disagrees with a fresh CLI child (for example, stale Oracle output), compare both against the current source and project revision before changing code. Do not signal an app-managed MCP child just to refresh it: the Codex host may not respawn it, and the registered wrapper can become `Transport closed`. Continue routine work with a fresh independent child; restoring the integrated wrapper requires the host's own reconnect/reload lifecycle. Record this as a transport lifecycle issue, not a Builder or Oracle defect, unless fresh children reproduce it.

If a dry-run returns stale output that contradicts the current source, first rebuild `packages/cli`, then start a fresh independent MCP child as above. Record the failing operation and exact Oracle issue in `MCP_V2_ISSUES.md` before continuing. When code loaded through MCP's Vite SSR path traverses Babel ASTs, use the shared `normalizeBabelTraverse()` helper from `src/code/parsing/ast-utils.ts`; direct `@babel/traverse` imports may be nested under `default.default`, and catching that TypeError can mask it as “no editable JSX slot.”

### A4. Localization and form operations must preserve their full dialect
- `guides.set` writes a JSON-backed `@rulerGuides` JSDoc annotation. This exact metadata comment is Oracle-allowed, but arbitrary generated comments remain prohibited; read back with `guides.get` and clear with empty `horizontal`/`vertical` arrays when the guides are temporary.
- `locales.remove` removes the locale from `i18n/config.json`, prunes its route wrappers, and deletes the legacy `i18n/{code}.json` overrides. It intentionally preserves `messages/{code}.json` so translations survive a remove/re-add cycle; do not treat that file as an orphan or delete it as cleanup.
- `translations.set` writes the requested locale message and seeds the default-locale message before changing JSX to `t(key)`. Localized HTML attributes use their own message key; localized component props are locale-gated expressions. Read back both JSX and message files, not only the operation receipt.
- A `forms.selectCaret.set` write must stay paired with the select's `data-select-icon` JSON marker. For a select without a marker, pass `icon` and `color` together with `cssBody`; when clearing the caret, pass `cssBody: null` so both the CSS rule and marker are removed. CSS-only writes are valid only when the select already carries the marker.
- Honeypot inputs must be hidden off-canvas with a tiny clipped box, `tabIndex=-1`, `autoComplete="off"`, and `aria-hidden="true"`; the Oracle rejects `display: none` even for generated helpers.

### A5. Screenshot and visual-audit results must be tied to the requested page
- In a standalone MCP process, the editor's selection and canvas caches are not local to the
  CLI. `observe.selection`, `observe.layout`, and `observe.visuals` must use the connected
  Builder snapshot adapter, scoped to the exact project, branch, page, saved revision, and
  viewport. Preserve its `pending`/`unavailable` status; do not claim a clean or measured result
  from empty CLI-local caches. `observe.composition` reads source structure and does not require
  rendered canvas measurements. Layout rects are in unzoomed viewport coordinates; the bridge
  must invert the editor's camera transform before reporting bounds. For visual/layout/audit
  results, prefetch requested computed styles from the iframe before using the synchronous style
  cache, and do not report `ready` if that read failed.
- `observe.screenshot` accepts `filePath` or `targetFile`; pass the exact target page through to the screenshot adapter. The active Builder tab must match the requested project, branch, page, and revision. A mismatched page, unrendered node, invalid dimensions, or malformed image data is `unavailable`/`pending`, never a valid screenshot. Report width/height in unzoomed viewport CSS pixels, not camera-scaled parent-screen pixels.
- The design audit ignores elements that are explicitly `aria-hidden="true"` and are also CSS-hidden or positioned off-canvas. Do not treat its findings about those internal helper elements as user-visible layout failures.

### B. Preserve Shared Component Masters & CMS
- Components in `components/` (e.g. `PortalHero.tsx`, `ThrowableDeck.tsx`, `SuFeSe.tsx` Navbar, `WeVuXi.tsx` Footer) and collections in `cms/` are shared across multiple pages and templates.
- **Do not delete, gut, or break shared components** when working on a new subpage. Reuse them or build new dedicated components.
- If a component requires hooks like `useScroll` or `useState`, ensure it is self-contained so other consumer pages or Next.js SSR builds don't fail with undefined variable errors.

### C. Mandatory Build & Prerender Verification
Always verify that all pages still build cleanly:
- Trigger build: `POST http://localhost:3333/api/local-server/local/build` or query `GET http://localhost:3333/api/local-server/local/status`.
- Ensure all routes (`/`, `/_not-found`, and your new pages) compile with `0 errors` and static prerender succeeds.

### D. Strict Project File Isolation & Image Asset Protocol (MANDATORY RULE)
1. **ProjectFS Boundary Isolation**:
   - The MCP bridge and AI agents ONLY have access to the files inside the active project (`app/`, `components/`, `icons/`, `plugins/`, `messages/`, `i18n/`, `_meta/`).
   - Absolute OS paths (`/home/...`, `/etc/...`, `C:\...`) and directory traversal (`..`) are strictly rejected with `Access denied`.
   - Never inspect or reference files from other demo projects or the host filesystem.
2. **Image Asset Protocol**:
   - **Rule**: Every image referenced in JSX elements, component props (`image`, `src`, `thumbnail`, `avatar`, `poster`), or inline styles (`backgroundImage: url(...)`) MUST BE EITHER:
     a) **An external high-quality link (URL)**: e.g. Unsplash stock photos (`https://images.unsplash.com/...`), CDN links, or inline data URIs (`data:image/...`).
     b) **OR uploaded directly into THIS project**: Uploaded via `revyme_upload_image` into this specific project, returning the permanent project URL `/api/uploads/<filename>`.
   - **STRICTLY FORBIDDEN**: Arbitrary local paths (such as `/images/...` from the global repository or demo projects). Any usage of foreign `/images/...` paths is blocked at preflight and by the Oracle check `INVALID_IMAGE_SOURCE`.

---

## 7. Self-Documenting MCP & Discovery Protocol (Webstudio Standard)

To eliminate guessing and prevent trial-and-error errors, Revyme MCP tools are self-documenting:

### A. The Interactive Reference Manual (`revyme_help`)
Whenever you are unsure of the syntax, argument names, or best practices for an operation, call `revyme_help`:
```json
// Inspect a specific tool:
revyme_help({ "tool_name": "revyme_manage_presets" })
revyme_help({ "tool_name": "revyme_set_responsive_styles" })
revyme_help({ "tool_name": "revyme_capture_screenshot" })

// Or inspect an architectural topic:
revyme_help({ "topic": "responsive_grid" })
revyme_help({ "topic": "typography" })
revyme_help({ "topic": "tokens" })
```

### B. In-Flight `help: true` Parameter
Major tools accept `help: true`. When passed, the tool returns its complete usage manual and production examples without performing any mutations:
```json
revyme_manage_presets({ "action": "list", "help": true })
revyme_set_responsive_styles({ "node_id": "test", "viewport": "mobile", "styles": {}, "help": true })
```

---

## 8. The Complete Typography Presets Matrix (H1–H6 Semantic Tagging)

Typography presets in Revyme represent complete text style families grouped in `globals.css`.
When creating typography presets via `revyme_manage_presets` with `action: "set_typography"`, you MUST configure the **semantic `tag`** to match the element's role:

| Preset Name | Semantic `tag` | Fluid `size` Scale | Unitless `line-height` | Intended Usage |
|---|---|---|---|---|
| `heading-1` | `"h1"` | `clamp(3rem, 8vw, 6.5rem)` | `1.02` to `1.05` | Main Hero Title |
| `heading-2` | `"h2"` | `clamp(2rem, 4.5vw, 3.5rem)` | `1.1` to `1.15` | Section Headlines |
| `heading-3` | `"h3"` | `clamp(1.25rem, 2.5vw, 1.75rem)` | `1.2` to `1.3` | Card & Modal Titles |
| `body` | `"p"` | `clamp(1rem, 1.4vw, 1.25rem)` | `1.5` to `1.6` | Paragraphs & Editorial Copy |
| `mono-label` | `"span"` | `clamp(11px, 1.2vw, 13px)` | `1.0` | Overlines, Badges, Metadata |

### Authoring Example:
```json
{
  "action": "set_typography",
  "name": "heading-1",
  "tag": "h1",
  "values": {
    "size": "clamp(3rem, 8vw, 6.5rem)",
    "line-height": "1.05",
    "weight": "700",
    "font": "'Inter', sans-serif",
    "spacing": "-0.04em",
    "color": "#000000"
  }
}
```

---

## 9. Design Tokens System: Radius, Borders, Shadows, and Spacing

Revyme supports 7 distinct token categories under `:root` in `globals.css`. Do not hardcode raw values when a token can represent the design intent:

1. **`radius`**:
   - `radius-card` (e.g. `16px`)
   - `radius-button` (e.g. `8px`)
   - `radius-pill` (e.g. `9999px`)
2. **`border`**:
   - `border-hairline` (e.g. `1px solid rgba(0, 0, 0, 0.10)`)
   - `border-focus` (e.g. `2px solid #6366f1`)
3. **`shadow`**:
   - `shadow-card` (e.g. `0 4px 20px rgba(0, 0, 0, 0.06)`)
   - `shadow-elevated` (e.g. `0 12px 32px rgba(0, 0, 0, 0.12)`)
4. **`spacing`** / **`margin`**:
   - Store spacing values in pixels (e.g. `space-section-y: 112px`, `space-container-x: 32px`).
   - Set Desktop, Tablet, and Mobile values in the responsive Padding/Margin preset editors; use pixel values at each breakpoint.
5. **`color`**:
   - `color-brand`, `color-bg`, `color-surface`, `color-text`, `color-text-secondary`, `color-text-muted`.

---

## 10. Responsive-First Mobile Layouts (Intrinsic Grid & Overflow Prevention)

### The Intrinsic Grid Protocol
Multi-column grids like `gridTemplateColumns: '1fr 1fr'` or `'2fr 1fr 1fr'` **BLOW OUT ON MOBILE** because 390px cannot fit 2 or 3 columns with padding and gap.

**Rule**: Always make grids intrinsically responsive using `repeat(auto-fit, minmax(...))`:
```tsx
// 2-column on desktop, smoothly collapses to 1-column on phone:
style={{
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
  gap: '32px',
  width: '100%'
}}
```

### Multi-Viewport Overrides (`viewports.setOverride`)
For explicit device layout changes, first read the target page's `@canvas` viewport config
with `codeFiles.read`, then call `viewports.setOverride` with the exact `filePath`, `nodeId`,
viewport ID or width, and styles. The operation adds a missing standard viewport tile to the
page config before Oracle validation; use the live `meta.tools` schema for current arguments.
```json
{
  "filePath": "app/page.client.tsx",
  "nodeId": "projects-grid",
  "viewport": "mobile",
  "styles": {
    "gridTemplateColumns": "1fr",
    "gap": "24px"
  }
}
```

---

## 11. Visual Verification Loop: Screenshot Capture & Overflow Checks

Never claim that a website is ready without visual verification. Follow the 2-step verification loop:

1. **Capture Visual Screenshot (`revyme_capture_screenshot`)**:
   ```json
   revyme_capture_screenshot({ "viewport": "mobile", "format": "png" })
   ```
   Inspect the response:
   - Check `layout.horizontalOverflow`: if `true`, content is spilling out horizontally!
   - Inspect the saved image file returned in `savedFilePath` using multimodal inspection tools.

2. **Run Hard Linting (`revyme_audit_design`)**:
   ```json
   revyme_audit_design({ "viewport": "mobile" })
   revyme_audit_design({ "viewport": "desktop" })
   ```
   Both viewports must achieve zero overlapping or boundary violations.

---

## 12. References & Deep Dives
- Read [references/cms-and-expressions-guide.md](./references/cms-and-expressions-guide.md) for the complete guide to Built-in CMS, External API CMS mode (Directus/Strapi/Baserow), and Dynamic Expression Formulas (`fx`).
- Read [references/utopia-fluid-design.md](./references/utopia-fluid-design.md) for Utopia typography guidance. `clamp()` is allowed only for the `size` field of a typography preset; spacing and radius stay in pixels.
- Read [references/built-in-arsenal.md](./references/built-in-arsenal.md) for the complete catalog of ~80 pre-built components (Marquee, Carousel, shaders, text effects, cursors).
- Read [references/components-guide.md](./references/components-guide.md) for the complete guide on Design Components vs Code Components, templates, and authoring workflows.
- Read [references/motion-choreography.md](./references/motion-choreography.md) for full animation physics, springs, easing presets, and choreography recipes.
- Read [references/tools-api.md](./references/tools-api.md) for full parameter specifications of all available semantic tools.
