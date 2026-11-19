---
name: revyme-mcp
description: "MCP v2 Router for Revyme Website Builder. Maps any user request (quick screenshot section, micro-edit, full site, design system, motion, CMS/forms, Code Components, or audit/SEO) to the right domain skill and Fast-Path workflow without reading huge monolithic instructions."
---

# Revyme Website Builder — MCP v2 Router

You interact with the live Revyme Website Builder through **`revyme-builder` MCP v2** tools (`call_mcp_tool` / `@revyme/cli` `revyme call`).

Every visual change edits real **Next.js / React TSX** source files cleanly and re-renders the canvas automatically.

---

## Decision Tree: Pick the Right Scope First

Always match your workflow depth to what the user actually asked for — **do NOT spin up full-site pipelines for a card, section, or button**:

| User Intent | Read Skill | Primary MCP Tools | Target Turn Budget |
|---|---|---|---|
| **Build a single section, screenshot block, card, button, navbar, or list** | `revyme-quick-ui` | `observe.selection`, `fragments.insert`, `fragments.replace` | **2–3 calls** |
| **Small style, color, spacing, link, or copy tweak** | `revyme-quick-ui` | `observe.selection`, `nodes.get`, `styles.set`, `text.set`, `links.set` | **1–2 calls** |
| **Full multi-section site / `/goal` brand build / multi-page launch** | `revyme-director` | `tokens.set`, `fonts.import`, `typography.set`, `pages.create`, `fragments.insert`, `components.extract` | Full pipeline |
| **Brand tokens, typography presets, components, variants, breakpoints** | `revyme-design-system` | `tokens.*`, `typography.*`, `presets.*`, `components.*`, `variants.*`, `viewports.*` | Focused |
| **Animations, scroll reveals, split-text, overlays, smooth scroll** | `revyme-motion` | `motion.*`, `textEffects.*`, `overlays.*`, `siteEffects.*`, `verify.effect` | Focused |
| **CMS collections, REST API lists, contact forms, multi-locale copy** | `revyme-cms-and-data` | `cms.*`, `forms.*`, `locales.*`, `translations.*` | Focused |
| **Interactive React widgets (`/** @controls */`), HOC overrides, scripts** | `revyme-code-components` | `codeComponents.create`, `codeFiles.submit`, `overrides.*`, `customCode.*` | Focused |
| **Inspect layout, visual audit, screenshot, SEO, redirects, preflight** | `revyme-audit-and-seo` | `observe.*`, `diagnostics.projectCheck`, `metadata.*`, `seo.*`, `publish.preflight` | Read / Verify |

Need tool discovery on demand? Call:
- `meta.guide({ taskScope: "quick-ui-insert" })` (or `"small-style-or-text-edit"`, `"full-page-pipeline"`, `"cms-and-dynamic-data"`, `"motion-and-interactions"`, `"read-only-audit"`)
- `meta.index({ category })` to list exact operation names
- `meta.tools({ names: ["..."] })` to inspect JSON schemas and valid examples

---

## Fast-Path Rule for Screenshots & UI Requests

When the user drops a screenshot or asks for a standalone section, card, list, or button without mentioning design tokens, presets, viewports, or components:
1. Call `observe.selection` (or target `parentId: "root"` / `targetId` + `where`).
2. Call **`fragments.insert`** (`parentId` or `targetId` + `where: 'before' | 'after' | 'prepend' | 'append' | 'inside'`) or **`fragments.replace`** (`targetId`) with inline `style={{ ... }}` JSX.
3. Done. Wait for feedback (or run `observe.screenshot` if verification is needed).

---

## Global Invariants (Hold Everywhere)

1. **Inline `style={{ ... }}` only**: use React camelCase style objects (`padding: '24px'`, `backgroundColor: '#0f172a'`), never Tailwind `className="..."`.
2. **Never submit canvas pages via `codeFiles.submit`**: `page.client.tsx`, `LayoutClient.tsx`, and Design Components must be authored via `fragments.insert`, `fragments.replace`, `styles.set`, `text.set`, `nodes.*`, `components.*`, `variants.*`, or `sections.insert`. Reserve `codeFiles.submit` strictly for `/** @controls */` Code Components (`components/*.tsx`) and non-canvas configs.
3. **Never touch `data/builds/` or bypass MCP via shell**: always inspect via `codeFiles.read` / `nodes.get` / `observe.*`.
4. **Empty string `""` deletes a style property**: pass `{ borderTopWidth: "" }` to `styles.set` to clear an inherited or inline style.
5. **Valid image sources**: use valid `https://...` URLs or `/api/uploads/...` assets (or `assets.upload`), never fictional `/images/...` paths.
6. **Batch or chain when needed**: use `workflow.batch` / `workflow.chain` if combining multiple dependent mutations in one turn.
