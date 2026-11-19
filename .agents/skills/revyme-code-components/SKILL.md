---
name: revyme-code-components
description: "Create interactive React Code Components (codeComponents.* with /** @controls */ and @revyme/runtime) and project code overrides/custom scripts (overrides.*, customCode.*, codeFiles.*). Never use codeFiles.submit on visual canvas pages."
---

# Revyme Code Components & Custom Code

Use this skill ONLY when custom interactive React logic (3D canvases, interactive charts, stateful calculators, custom widgets, HOC overrides, or head/body scripts) cannot be expressed with visual canvas nodes and Design Components.

---

## Strict Boundary Rules

1. **NEVER use `codeFiles.submit` on visual pages (`page.client.tsx`, `LayoutClient.tsx`) or Design Components.** Canvas files must always be edited through `fragments.insert`, `fragments.replace`, `styles.set`, `text.set`, or `nodes.*`.
2. `codeFiles.submit` is strictly reserved for **Code Components** (`components/*.tsx` carrying `/** @controls { ... } */`) and non-canvas configuration files.
3. Read existing source files ONLY through `codeFiles.read`, `codeFiles.list`, or `codeFiles.search` — never read raw workspace/build caches via shell commands.

---

## 1. Authoring Code Components (`codeComponents.*`)
Every Code Component created via `codeComponents.create` or submitted via `codeFiles.submit` must include:
- `'use client';` directive at the top
- Sizing docblocks: `/** @defaultWidth 400 */` and `/** @defaultHeight 300 */`
- Inspector property controls schema: `/** @controls { "propName": { "type": "text", "label": "Label", "default": "Value" } } */`
- Root wrapper wrapped with `withResponsiveProps` imported from `@revyme/runtime` and carrying `data-id="root"` (or visual prop bindings).
- List and inspect existing Code Components with `codeComponents.list` and `codeComponents.get`.
- After creating a Code Component, place it on any page via `fragments.insert` (`<MyWidget label="..." />`) or `components.instance.create`.

## 2. Overrides & Global Custom Code (`overrides.*`, `customCode.*`)
- Manage React Higher-Order Component overrides: `overrides.list`, `overrides.create`, `overrides.set`, `overrides.remove`.
- Inject site/page `<head>` or `<body>` custom snippets: `customCode.get`, `customCode.set`.

## 3. Useful Reference Discovery
Call `meta.tools({ names: ["codeComponents.create", "overrides.create"] })` to inspect exact schema-validated boilerplate examples before writing custom TSX.
