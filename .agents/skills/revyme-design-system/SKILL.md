---
name: revyme-design-system
description: "Author and maintain Revyme Design System assets: CSS design tokens (tokens.*), Google/custom fonts (fonts.*), responsive typography presets (typography.*), dimension presets (presets.*), reusable Design Components and variants (components.*, variants.*, slots.*), and responsive breakpoint overrides (viewports.*)."
---

# Revyme Design System & Components

Use this skill when creating a coherent brand system, extracting reusable Design Components, adding hover/responsive variants, or configuring multi-viewport responsive rules.

For quick standalone sections or one-off UI edits without tokens/components, use `revyme-quick-ui` instead.

---

## 1. Tokens (`tokens.*`)
- Inspect existing variables: `tokens.list`, `tokens.get`, `tokens.usage`.
- Create or update color/spacing/shadow tokens: `tokens.set` (`{ name, value, lightValue?, darkValue?, folder? }`).
- Validate and refactor: `tokens.validate`, `tokens.rename`, `tokens.remove`.

## 2. Fonts & Typography SSOT (`fonts.*`, `typography.*`)
- Search and load fonts: `fonts.catalog`, `fonts.import`, `fonts.workspace.add`, `fonts.preload`.
- Define semantic presets (`h1`, `h2`, `body`, `label`) with responsive breakpoint tiers: `typography.set`, `typography.list`, `typography.get`.
- Apply or detach presets on nodes: `typography.apply`, `typography.detach`.
- Note: `fragments.insert` binds matching `--typo-<name>-*` presets automatically when `preset="h2"` or semantic typography attributes are provided.

## 3. Dimension Presets (`presets.*`)
- Create or batch-create reusable spacing/size tokens: `presets.set`, `presets.batchSet`, `presets.folders.create`.
- Apply dimension presets to node properties: `presets.apply`, `presets.list`.
- Note: Dimension preset tokens use concrete `px` values for deterministic token calculation, whereas inline node styles accept `px`, `rem`, `em`, `%`, `clamp()`, etc.

## 4. Design Components, Variants & Slots (`components.*`, `variants.*`, `slots.*`)
- Inspect components: `components.list`, `components.get`.
- Convert an existing canvas node tree into a reusable Design Component: `components.extract` (`{ nodeId, name }`), or scaffold fresh via `components.create`.
- Place or manage instances: `components.instance.create`, `components.instance.props.get`, `components.instance.props.set`, `components.replace`, `components.detach`.
- Expose customizable properties: `components.variables.create`, `components.variables.rename`, `components.variables.remove`.
- Add interaction/design variants (`hover`, `pressed`, named states): `variants.list`, `variants.create`, `variants.rename`, `variants.visibility.set`, `variants.remove`.
- Connect child slots inside components: `slots.list`, `slots.connect`, `slots.disconnect`, `slots.reorder`.

## 5. Responsive Viewports (`viewports.*`)
- List configured breakpoints (default Desktop `1200px`, Tablet `810px`, Mobile `390px`): `viewports.list`.
- Override node layout/styles at a specific breakpoint without breaking primary Desktop styles: `viewports.setOverride` (`styles.set` also accepts `viewport`).
