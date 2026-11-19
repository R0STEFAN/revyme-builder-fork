---
name: revyme-quick-ui
description: "Fast-path skill for inserting or replacing a single section, screenshot UI block, card, hero, navbar, list, or button via Revyme MCP v2 in 2-3 tool calls without setting up tokens, presets, viewports, or Design Components."
---

# Revyme Quick UI (Fast-Path)

Use this skill whenever the user wants a **quick section, card, button, navbar, footer, FAQ list, or screenshot replication** inserted or swapped onto a page without asking for a design system, reusable component architecture, or multi-breakpoint refactor.

For full multi-page sites, brand systems, or `/goal` builds, hand off to `revyme-director` or `revyme-design-system`.

---

## 3-Step Fast-Path Workflow

Aim to finish in **2–3 MCP tool calls**:

1. **Locate target (`observe.selection` or `pages.list`)**
   - If the user has an element selected, call `observe.selection`.
   - Otherwise, pass `parentId: "root"` directly to insert into the primary page (`page.client.tsx`), or use `pages.list` / `nodes.get` if placing relative to an existing section.
   - Optional: `meta.guide({ taskScope: "quick-ui-insert" })` confirms Fast-Path parameters.

2. **Insert or replace raw inline-styled JSX (`fragments.insert` or `fragments.replace`)**
   - Insert relative to any node using `targetId` + `where`:
     - `where: "after"` — insert immediately after `targetId` (updates flex `order` automatically)
     - `where: "before"` — insert immediately before `targetId`
     - `where: "prepend"` — insert as first child inside `targetId`
     - `where: "append"` / `"inside"` — append inside container
   - Or swap an existing section/card atomically with `fragments.replace({ targetId, fragment })`.

3. **Inspect visually (optional `observe.screenshot`)**
   - Only capture `observe.screenshot` when visual verification against a user screenshot or layout check is needed.

---

## Explicitly Skip on Fast-Path

Unless the user asks for them, **do NOT run**:
- `tokens.set`, `typography.set`, `presets.set`, `fonts.import`
- `viewports.setOverride`
- `components.extract`, `components.create`, `variants.create`
- Multi-agent `revyme-director` planning

Inline hex/rgba colors and inline typography styles on the JSX elements are first-class and immediately editable in the visual inspector panels.

---

## Native JSX Capabilities & AST Auto-Healer

The `fragments.insert` / `fragments.replace` ingestion pipeline automatically normalizes standard CSS/JSX patterns so raw markup passes Oracle on the first call:

- **Native Lists**: Use semantic `<ul>`, `<ol>`, `<li>` with `listStyleType` (`'disc'`, `'decimal'`, `'none'`) and `listStylePosition`.
- **Multi-Unit CSS**: Standard units (`px`, `rem`, `em`, `%`, `vh`, `vw`, `dvh`, `svh`, `clamp()`, `calc()`, `none`, `auto`) work directly in spacing, line-height, and min/max size controls.
- **Layout & Scroll**: `overflow: 'auto'` and `alignItems: 'baseline'` are natively supported.
- **Auto-Healed Automatically**:
  - Solid `background: '#0f172a'` -> `backgroundColor: '#0f172a'`
  - `'transparent'` -> `'rgba(0, 0, 0, 0)'`
  - `height`/`minHeight: 'min-content'` -> `'auto'`
  - CSS `transition*` properties stripped cleanly
  - `inset` shorthand expanded to explicit edges; bare `0` formatted as `'0px'`
  - CSS comments in `lineHeight` stripped
  - Wrapper frames (`div`, `section`, `ul`, `ol`, `li`, etc.) without `display` gain `display: 'flex', flexDirection: 'column'`
  - Typography props (`color`, `fontFamily`, `fontSize`, `fontWeight`, `lineHeight`, etc.) cascade from pure wrappers down to leaf text/button/input elements
  - `position: 'absolute'` automatically receives `data-pinned="true"`
  - Unsized `<img>` receives `width: '100%', height: 'auto', objectFit: 'cover'`
  - Flex row `width: '100%'` children become `flex: '1 0 0px'`; flow children receive `flex: '0 0 auto'` and sequential string `order` (`'0'`, `'1'`, ...)

---

## Non-Negotiable Rules

1. **Always use JSX inline `style={{ ... }}` (camelCase)** — never write Tailwind `className="..."` utilities in `fragments.insert` / `fragments.replace`.
2. **Never submit canvas pages via `codeFiles.submit`** — always use `fragments.insert`, `fragments.replace`, `styles.set`, `text.set`, or `nodes.*`.
3. **Never use fake local image paths** (like `/img.png`) — use valid `https://...` URLs or project assets (`/api/uploads/...`).
4. **Micro-edits take 1 tool call**: for color/spacing/text tweaks on an existing `data-id`, call `styles.set` (pass `""` to delete a CSS property) or `text.set` instead of replacing the section.
