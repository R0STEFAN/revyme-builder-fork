# IMPCT.DIGITAL Landing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Ukrainian, typography-led, responsive IMPCT.DIGITAL landing page through Revyme MCP v2.

**Architecture:** The existing empty homepage becomes a canvas-native sequence of semantic sections whose styles refer to global tokens. A small `DifferenceCursor` code component contains only browser-specific pointer logic; header, content, marquee cards, and footer remain normal Revyme nodes so they remain editable in Builder. Mutations are sent to project `proj-1792770801304-tbg5o9` on branch `main` as validated MCP v2 plans, then verified from the persisted revision.

**Tech Stack:** Revyme MCP v2, generated Next.js/React TSX, Revyme Oracle, CSS custom properties, Framer Motion/runtime code component, Inter.

**Spec:** `docs/superpowers/specs/2026-10-23-impct-digital-landing-design.md`

## Global Constraints

- Write only to project `proj-1792770801304-tbg5o9`, branch `main`; read the revision before every mutation batch.
- Use `#FFFFFF`, `#000000`, `#525252`, `#737373`, `rgba(0, 0, 0, 0.10)`, and footer `#0A0A0A`; photography is the only colour.
- Use Inter (400, 700); headline tracking is `-0.05em`, headline line-height `0.9`; body tracking is `-0.02em`, body line-height `1.5`.
- All public copy is Ukrainian. Demo portfolio work must be labelled “Концепт”, never described as a client engagement.
- Use `cubic-bezier(0.16, 1, 0.3, 1)` for requested hover/reveal timing; respect `prefers-reduced-motion`.
- Do not use borders thicker than 1px, a generic gradient, or invented company results.
- Do not overwrite ProjectFS outside MCP v2; all final writes must have an MCP receipt.

## Review Focus

- **Project revision changes during authoring:** each mutation must reject stale plans instead of overwriting a GUI edit (Task 1 and every dry-run/commit pair).
- **Fine versus coarse pointers:** custom cursor must be absent on touch and must not remove keyboard focus (Task 3).
- **Mobile 375px grid:** cards, footer columns, and marquee must avoid horizontal overflow (Task 5).
- **Motion preference:** reduced-motion visitors must see readable static hero text and a non-moving marquee (Task 4).
- **External imagery:** every image source must be HTTPS and valid; no local path or unlabelled fictional client claim may ship (Task 4).

---

### Task 1: Establish the MCP v2 project contract and baseline

**Files:**
- Read: `app/page.client.tsx`, `app/layout.tsx`, `app/globals.css`
- Modify: no source file until the baseline revision is recorded
- Test: MCP `diagnostics.projectCheck` result for the full project

**Interfaces:**
- Consumes: `projectId: "proj-1792770801304-tbg5o9"`, `branchId: "main"`.
- Produces: a recorded `baseRevision`, valid file paths, and a clean/known baseline for subsequent mutation plans.

- [ ] **Step 1: Read the current project scope and revision**

Run `pages.list`, `codeFiles.list`, `codeFiles.read` for `app/page.client.tsx`, `app/layout.tsx`, and `app/globals.css`, then `diagnostics.projectCheck`.

Expected baseline: homepage files exist, `root` is the only homepage node, and the current persisted revision is recorded before authoring.

- [ ] **Step 2: Prove stale-write protection before changing the site**

Create a harmless `tokens.set` plan using `dryRun: true`, retain its plan receipt, then re-read revision before any commit. If the revision differs, discard the old plan and generate a new one.

Expected: an altered revision never receives a commit; the MCP response reports a revision or structured stale-plan rejection.

- [ ] **Step 3: Run the baseline project check**

```ts
await diagnostics.projectCheck({
  projectId: 'proj-1792770801304-tbg5o9',
  branchId: 'main',
  strict: true,
  categories: ['oracle', 'imports', 'assets', 'links', 'syntax'],
});
```

Expected: document existing issues before adding new work. Do not present pre-existing failures as caused by the landing page.

- [ ] **Step 4: Commit**

Commit only the run receipt/implementation documentation if the repository workflow requires it; project mutations are committed through MCP receipts, not local Git writes.

### Task 2: Install brand foundations and Ukrainian metadata

**Files:**
- Modify: `app/globals.css`
- Modify: `app/layout.tsx`
- Test: `tokens.get`, `typography.get`, `metadata.read`, `diagnostics.projectCheck`

**Interfaces:**
- Consumes: the Task 1 revision and the named token palette.
- Produces: `--color-page`, `--color-ink`, `--color-secondary`, `--color-muted`, `--color-rule`, `--color-footer`, `--space-section-y`, `--space-page-x`, `--radius-marquee-a`, `--radius-marquee-b`, plus `display-impct`, `body-impct`, and `meta-impct` typography presets.

- [ ] **Step 1: Write failing token/preset checks**

Query `tokens.get` for `color-page`, `color-ink`, and `color-footer`, and query `typography.get` for `display-impct`. They must be absent before the implementation.

Expected: each read returns a missing-token/preset response, demonstrating the check is meaningful.

- [ ] **Step 2: Import Inter and set the global token vocabulary**

Use `fonts.import` for Inter weights `400` and `700`, then commit a dry-run `workflow.batch` whose token operations include:

```ts
[
  { tool: 'tokens.set', input: { name: 'color-page', value: '#FFFFFF', category: 'color', targetFile: 'app/globals.css' } },
  { tool: 'tokens.set', input: { name: 'color-ink', value: '#000000', category: 'color', targetFile: 'app/globals.css' } },
  { tool: 'tokens.set', input: { name: 'color-secondary', value: '#525252', category: 'color', targetFile: 'app/globals.css' } },
  { tool: 'tokens.set', input: { name: 'color-muted', value: '#737373', category: 'color', targetFile: 'app/globals.css' } },
  { tool: 'tokens.set', input: { name: 'color-rule', value: 'rgba(0, 0, 0, 0.10)', category: 'border', targetFile: 'app/globals.css' } },
  { tool: 'tokens.set', input: { name: 'color-footer', value: '#0A0A0A', category: 'color', targetFile: 'app/globals.css' } }
]
```

- [ ] **Step 3: Define compound typography and page metadata**

Create presets with these exact values:

```ts
await typography.set({
  targetFile: 'app/globals.css', name: 'display-impct', tag: 'h1',
  values: { fontFamily: "'Inter', sans-serif", fontWeight: '700', fontSize: 'clamp(52px, 12vw, 184px)', lineHeight: '0.9', letterSpacing: '-0.05em', color: 'var(--color-ink)' },
  responsiveTiers: { sm: { fontSize: 'clamp(48px, 16vw, 76px)' } }
});
```

Create `body-impct` and `meta-impct` with the values in Global Constraints. Update layout metadata to title `IMPCT.DIGITAL — сайти та ШІ-системи для бізнесу`, Ukrainian description, `language: 'uk'`, and `theme: 'light'`.

- [ ] **Step 4: Verify foundations pass**

Read every named token and preset, inspect `metadata.read`, then run `diagnostics.projectCheck` for `app/globals.css` and `app/layout.tsx`.

Expected: all token values match the spec and no invalid import or Oracle diagnostics appear.

- [ ] **Step 5: Commit**

Commit the validated MCP plan; record its `operationId`, revision, and changed files in the implementation log.

### Task 3: Build the reusable interaction primitives

**Files:**
- Create: `components/DifferenceCursor.tsx`
- Create: `components/StudioHeader.tsx`
- Create: `icons/StudioIcons.tsx`
- Test: `codeComponents.get`, `components.get`, `variants.list`, `verify.effect`

**Interfaces:**
- Consumes: `color-page`, `color-ink`, `color-rule`, and the Inter presets from Task 2.
- Produces: `<DifferenceCursor />`, `<StudioHeader />`, and an `ArrowUpRight` icon that the homepage can instantiate by component name.

- [ ] **Step 1: Write failing component existence checks**

Call `codeComponents.get({ name: 'DifferenceCursor' })`, `components.get({ name: 'StudioHeader' })`, and `vectors.list()`.

Expected: the components and `StudioIcons` set are absent before creation.

- [ ] **Step 2: Create the cursor as the only code component**

Use `codeComponents.create` with a typed `DifferenceCursor` implementation that has `pointer-events: none`, 32px dimensions, `position: fixed`, `z-index: 9999`, `mix-blend-mode: difference`, white background, and requestAnimationFrame lerp state. The component must gate itself with `matchMedia('(pointer: fine)')`, add/remove link/button hover listeners in an effect cleanup, and include this reduced-motion branch:

```ts
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
if (reduceMotion) return null;
```

The hover state applies a 2.5 scale through Framer Motion or a component-local transform, never a page-wide raw CSS hover rule.

- [ ] **Step 3: Create the editable header and icon set**

Create `StudioHeader` as a design component with `default` and `menu-open` variants. Use an explicit page-level fixed placement when it is instantiated; do not put `position: fixed` or `mixBlendMode` in the master root. Create a vector icon set with an `ArrowUpRight` glyph and the plus/close glyphs for the menu trigger.

- [ ] **Step 4: Verify behavior and accessibility contracts**

Run `verify.effect` with `effectType: 'interactive'`, `expectedMechanism: ['requestAnimationFrame']`, and a second check for the menu interaction. Inspect component source to confirm event listeners have cleanup and keyboard-visible controls retain names.

Expected: no page-default cursor suppression exists outside the fine-pointer path, and both header variants remain non-overlapping in the component artboard.

- [ ] **Step 5: Commit**

Commit the MCP receipts after component and icon verification passes.

### Task 4: Compose the editorial desktop page and content

**Files:**
- Modify: `app/page.client.tsx`
- Test: `nodes.get`, `text.get`, `styles.get`, `verify.effect`, `assets.audit`

**Interfaces:**
- Consumes: Task 2 tokens and presets, Task 3 components/icons.
- Produces: stable node IDs `site-header`, `hero-sec`, `work-marquee-sec`, `studio-statement-sec`, `projects-sec`, and `site-footer`.

- [ ] **Step 1: Write failing structural checks**

Read `nodes.get({ filePath: 'app/page.client.tsx', nodeId: 'hero-sec' })` and the same call for all five required section IDs.

Expected: every section lookup fails before the composition batch.

- [ ] **Step 2: Create the page hierarchy through nodes and component instances**

Keep `root` as the page wrapper and create, in order:

```text
root
├── DifferenceCursor instance
├── StudioHeader instance (site-header)
├── hero-sec / hero-container / hero-title / hero-summary
├── work-marquee-sec / work-marquee
├── studio-statement-sec / statement-copy
├── projects-sec / projects-grid / four project cards
└── site-footer / footer-grid / footer-bottom
```

Set `root` to `minHeight: '100vh'`, `backgroundColor: 'var(--color-page)'`, `color: 'var(--color-ink)'`, and `overflowX: 'hidden'`. Use the following hero copy:

```text
Сайти та ШІ-системи
для бізнесу,
який має рости.

IMPCT.DIGITAL поєднує стратегію, дизайн, розробку та автоматизацію в одну систему, що рухає бізнес уперед.
```

- [ ] **Step 3: Add motion and the portfolio media treatment**

Use the catalog `cs-marquee` with 30-second motion and pause-on-hover behavior. Add four HTTPS-hosted editorial images using the Image catalog node; apply grayscale `100%`, 4:3 project-card proportions, and alternating `100px 0 0 0`, `0 100px 0 40px`, and `40px` radii for marquee media. Give every project card a hover overlay, arrow icon, and metadata beginning with `Концепт`.

Use `pageInteractions.add` or the native motion operation to reveal `hero-title` upward with `cubic-bezier(0.16, 1, 0.3, 1)` over 1000ms, and to apply the specified image hover scale/filter transition.

- [ ] **Step 4: Build the dark footer and contact routes**

Create four desktop footer columns. Include the studio statement, `Instagram`, `LinkedIn`, and a `hello@impct.digital` mail link only if those are intended public destinations; otherwise use visibly marked placeholders `Посилання уточнюється` and `Контакт уточнюється` rather than a fabricated address. Add the Ukrainian copyright/credits row with a 1px white 10% rule.

- [ ] **Step 5: Verify the desktop structure and content**

Run `verify.effect` against `app/page.client.tsx` for hero reveal, marquee, and hover effects. Run `assets.audit` and reject non-HTTPS/local image paths. Inspect all six required section IDs and verify that all work cards include `Концепт`.

- [ ] **Step 6: Commit**

Commit the desktop composition only after the dry-run plan validates and the post-commit reads show all six section IDs.

### Task 5: Add responsive rules and visual validation

**Files:**
- Modify: `app/page.client.tsx`
- Test: `viewports.setOverride`, `observe.screenshot`, `observe.audit`, `preview.build`, `diagnostics.projectCheck`

**Interfaces:**
- Consumes: section and card IDs from Task 4.
- Produces: correct 1200px desktop, 768px tablet, and 375px mobile presentations.

- [ ] **Step 1: Write failing mobile layout checks**

Capture an initial `observe.screenshot` for `mobile` and run `observe.audit` for `app/page.client.tsx`.

Expected: the empty/default desktop rules cannot satisfy the final explicit 375px mobile layout until overrides are added.

- [ ] **Step 2: Apply tablet and mobile overrides**

Use `viewports.setOverride` with these exact targets:

```ts
await viewports.setOverride({ nodeId: 'projects-grid', viewport: 'mobile', styles: { gridTemplateColumns: '1fr', gap: '24px' } });
await viewports.setOverride({ nodeId: 'footer-grid', viewport: 'mobile', styles: { gridTemplateColumns: '1fr', gap: '32px' } });
await viewports.setOverride({ nodeId: 'hero-sec', viewport: 'mobile', styles: { minHeight: '72vh', paddingLeft: '16px', paddingRight: '16px' } });
await viewports.setOverride({ nodeId: 'site-header', viewport: 'mobile', styles: { paddingLeft: '16px', paddingRight: '16px' } });
```

Keep the grid intrinsically responsive in its base style rather than relying only on overrides.

- [ ] **Step 3: Verify viewport results**

Capture desktop, tablet, and mobile screenshots; inspect each response for `horizontalOverflow: false`. Run `observe.audit` in all three viewports. If an overflow or overlap is found, make one scoped override, recapture the affected viewport, and repeat until that check is clean.

- [ ] **Step 4: Run final project validation and build**

```ts
await diagnostics.projectCheck({
  projectId: 'proj-1792770801304-tbg5o9',
  branchId: 'main',
  strict: true,
  categories: ['oracle', 'imports', 'assets', 'links', 'layoutCycles', 'slots', 'components', 'syntax'],
});
await preview.build({
  projectId: 'proj-1792770801304-tbg5o9',
  branchId: 'main',
  mode: 'production', clean: true, includeRoutes: true, optimize: true,
});
```

Expected: no newly introduced Oracle, import, asset, route, or syntax error; build result identifies `/` as successful.

- [ ] **Step 5: Commit and record the final receipt**

Record final revision, operation ID, changed files, project-check result, build result, and screenshot paths. Do not claim visual completion if a screenshot or audit reports unavailable measurement.

## Self-Review

- **Spec coverage:** Task 2 implements colour/type/metadata; Task 3 covers cursor and menu; Task 4 covers all six visual page regions, Ukrainian copy, marquee, projects, and footer; Task 5 owns responsive, build, and visual verification.
- **Placeholder scan:** no task defers implementation; intentionally unknown public URLs are explicitly rendered as non-deceptive placeholders instead of made-up data.
- **Type consistency:** all tasks use `projectId`, `branchId`, `targetFile`/`filePath`, and node IDs consistently; component names produced by Task 3 are consumed by Task 4.
- **Review focus:** stale revisions map to Task 1, pointer/focus behavior to Task 3, asset validity/reduced motion to Task 4, and responsive overflow to Task 5.
