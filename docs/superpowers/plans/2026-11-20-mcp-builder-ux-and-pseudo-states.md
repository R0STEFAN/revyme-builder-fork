# Revyme MCP, Headless Observation & Visual CSS Pseudo-States Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the MCP, headless screenshot, audit, motion/SVG ingestion, and visual CSS state editing gaps identified during live page generation — including full visual editing for `:hover`, `:active`, `:focus-visible`, `:disabled`, and safe node-scoped custom pseudo-states in `StylesTool`, autonomous browserless screenshots in `observe.screenshot`, accurate SVG audit/auto-healing, and explicit skill routing.

**Architecture:** The plan splits into four independently deliverable tracks that preserve Revyme's 3x source-of-truth round trip (Parse → Render → Generate + Oracle + MCP): (A) unified CSS pseudo-states & custom node-scoped selectors across `pseudo-parser`, `generator-styles`, Oracle `check-file`, `StylesTool` (`PseudoElementControl` + live canvas preview + `Transition`), and MCP `styles.*`; (B) autonomous headless Playwright screenshots against a lightweight preview route with native `locator.screenshot()` and MCP image content blocks; (C) `motion.set` automatic `viewport={{ once: true }}`, `verify.effect` CSS-hover awareness, and `observe.audit` SVG geometry filtering; (D) SVG ingestion auto-healing, `fonts.import` italic support, mixed-content whitespace preservation, MCP schema/chain ergonomics, and skill updates.

**Tech Stack:** TypeScript, React 19, Jotai, Babel AST (`@babel/parser`, `@babel/traverse`, `@babel/types`), Zod v4, Playwright, Vitest, `@revyme/automation-core`, `@revyme/cli`.

**Spec:** Derived from the live MCP v2 session audit on `proj-1795160879401-2c8apt` (2026-11-20) and repository invariants in `AGENTS.md`.

## Global Constraints

- Source of truth is real Next.js/React `.tsx` files; every style/state feature must round-trip through `pseudo-parser.ts`, `generator-styles.ts`, `check-file.ts` (Oracle), `Renderer`, and `packages/automation-core` (`styles.set` / `styles.get`).
- Never touch canvas iframe DOM directly from parent editor controls; use `injectCanvasCSS` / `removeCanvasCSS` (`src/canvas/node-ops.ts`) and `queueMutation`.
- Never read or write `data/builds/`.
- Empty string `""` deletes a style property everywhere.
- Top-level `<style>` rules in `check-file.ts` (`isEditorMediaStyleBlock`) must remain scoped to `[data-id="..."]` (never allow unscoped element/class selectors that break cloning or component expansion).
- Add `trace.fn` / `trace.action` / `trace.error` calls on new operations and UI commits.
- Run `npx vitest run` on modified suites and `npx tsc --noEmit` before completing any track, and rebuild `@revyme/cli` (`npm --workspace=@revyme/cli run build`) whenever `packages/automation-core` or `packages/cli` changes.

---

## Track A: Visual CSS States (`:hover`, `:active`, `:focus-visible`, `:disabled`, Custom Suffixes) + Live Canvas Preview

### Task 1: Unify Pseudo-State Parsing & Code Generation (`pseudo-parser.ts`, `generator-styles.ts`, `mutation-queue.ts`)

**Files:**
- Modify: `src/code/parsing/pseudo-parser.ts:1-53`
- Modify: `src/code/generation/generator-styles.ts:1525-1737`
- Modify: `src/code/mutation/mutation-queue.ts:672-682,3658-3664`
- Modify: `src/code/parsing/pseudo-parser.test.ts:1-55`
- Test: `src/code/generation/generator.test.ts`

**Interfaces:**
- Produces in `src/code/parsing/pseudo-parser.ts`:
  - `BUILTIN_PSEUDO_STATES`: `readonly ['hover', 'active', 'focus', 'focus-visible', 'focus-within', 'disabled', 'checked']`
  - `BUILTIN_PSEUDO_ELEMENTS`: `readonly ['before', 'after', 'placeholder']`
  - `CustomPseudoKey`: `` `custom:${string}` ``
  - `PseudoKind`: `'before' | 'after' | 'placeholder' | 'checked' | 'focus' | 'hover' | 'active' | 'focus-visible' | 'focus-within' | 'disabled' | CustomPseudoKey`
  - `PseudoStyles`: `{ [K in PseudoKind]?: Record<string, string> }`
  - `isValidCustomPseudoSuffix(suffix: string): boolean`
  - `normalizePseudoKind(raw: string): PseudoKind | null`
- Produces in `src/code/generation/generator-styles.ts`:
  - `PseudoRuleKind = PseudoKind`
  - `pseudoSelector(nodeId: string, pseudo: PseudoRuleKind): string`
  - `updatePseudoStyleInCode(code: string, nodeId: string, pseudo: PseudoRuleKind, styles: Record<string, string>): string`
  - `removePseudoStyleInCode(code: string, nodeId: string, pseudo: PseudoRuleKind): string`

- [ ] **Step 1: Update existing test and add failing unit tests for new pseudo-states & custom suffixes**

Modify `src/code/parsing/pseudo-parser.test.ts` (update line 40 where `:hover` previously returned empty map, and add new cases):
```ts
import { describe, expect, it } from 'vitest';
import {
  parsePseudoRules,
  isValidCustomPseudoSuffix,
  normalizePseudoKind,
} from './pseudo-parser';

describe('pseudo-parser extended states & custom suffixes', () => {
  it('parses :hover, :active, :focus-visible, :focus-within, :disabled, and custom node-scoped suffixes', () => {
    const css = `
      [data-id="btn-1"]:hover {
        background-color: #1e1e1e !important;
        color: #f2f2f2 !important;
      }
      [data-id="btn-1"]:active {
        transform: scale(0.98) !important;
      }
      [data-id="btn-1"]:focus-visible {
        outline: 2px solid #111111 !important;
      }
      [data-id="btn-1"]:nth-child(odd) {
        background-color: #ffffff !important;
      }
      [data-id="btn-1"][aria-expanded="true"] {
        border-color: #111111 !important;
      }
    `;
    const parsed = parsePseudoRules(css);
    const btn = parsed.get('btn-1');
    expect(btn?.hover).toEqual({ backgroundColor: '#1e1e1e', color: '#f2f2f2' });
    expect(btn?.active).toEqual({ transform: 'scale(0.98)' });
    expect(btn?.['focus-visible']).toEqual({ outline: '2px solid #111111' });
    expect(btn?.['custom::nth-child(odd)']).toEqual({ backgroundColor: '#ffffff' });
    expect(btn?.['custom:[aria-expanded="true"]']).toEqual({ borderColor: '#111111' });
  });

  test('rejects unsafe custom suffixes containing combinators, braces, or foreign data-ids', () => {
    expect(isValidCustomPseudoSuffix(':nth-child(2n)')).toBe(true);
    expect(isValidCustomPseudoSuffix('[data-open="true"]')).toBe(true);
    expect(isValidCustomPseudoSuffix(':hover::after')).toBe(true);
    expect(isValidCustomPseudoSuffix(' .child')).toBe(false);
    expect(isValidCustomPseudoSuffix(' > [data-id="other"]')).toBe(false);
    expect(isValidCustomPseudoSuffix(':hover { color: red }')).toBe(false);
    expect(normalizePseudoKind(':hover')).toBe('hover');
    expect(normalizePseudoKind('::before')).toBe('before');
    expect(normalizePseudoKind(':nth-child(2)')).toBe('custom::nth-child(2)');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/code/parsing/pseudo-parser.test.ts`
Expected: FAIL (`isValidCustomPseudoSuffix` / `normalizePseudoKind` not exported, `:hover`/`:active`/custom not parsed).

- [ ] **Step 3: Implement extended `PseudoKind`, validation, and unified `pseudoSelector` in `pseudo-parser.ts`, `generator-styles.ts`, and `mutation-queue.ts`**

In `src/code/parsing/pseudo-parser.ts`:
```ts
import { toCamel } from '@/shared/css-utils';
import { trace } from '@/shared/debug-trace';

export const BUILTIN_PSEUDO_ELEMENTS = ['before', 'after', 'placeholder'] as const;
export const BUILTIN_PSEUDO_STATES = [
  'hover',
  'active',
  'focus',
  'focus-visible',
  'focus-within',
  'disabled',
  'checked',
] as const;

export type BuiltinPseudoElement = typeof BUILTIN_PSEUDO_ELEMENTS[number];
export type BuiltinPseudoState = typeof BUILTIN_PSEUDO_STATES[number];
export type CustomPseudoKey = `custom:${string}`;
export type PseudoKind = BuiltinPseudoElement | BuiltinPseudoState | CustomPseudoKey;

export type PseudoStyles = Partial<Record<PseudoKind, Record<string, string>>>;

const PSEUDO_ELEMENT_SET = new Set<string>(BUILTIN_PSEUDO_ELEMENTS);
const PSEUDO_STATE_SET = new Set<string>(BUILTIN_PSEUDO_STATES);

/**
 * Node-scoped custom suffix attached directly to `[data-id="..."]` (no descendant
 * combinators, spaces, braces, or foreign selectors).
 */
export function isValidCustomPseudoSuffix(suffix: string): boolean {
  const trimmed = suffix.trim();
  if (!trimmed || trimmed.length > 80) return false;
  if (/[\s{}$;,]/.test(trimmed)) return false;
  if (!trimmed.startsWith(':') && !trimmed.startsWith('[')) return false;
  return /^(?:::[a-z-]+|:[a-z-]+(?:\([^(){}]*\))?|\[[a-zA-Z0-9_-]+(?:[~|^$*]?=(?:"[^"{}]*"|'[^'{}]*'|[^\]{}\s]+))?\])+$/.test(trimmed);
}

export function normalizePseudoKind(raw: string): PseudoKind | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('custom:')) {
    const suffix = trimmed.slice('custom:'.length).trim();
    return isValidCustomPseudoSuffix(suffix) ? `custom:${suffix}` : null;
  }
  const stripped = trimmed.replace(/^:+/, '');
  if (PSEUDO_ELEMENT_SET.has(stripped)) return stripped as BuiltinPseudoElement;
  if (PSEUDO_STATE_SET.has(stripped)) return stripped as BuiltinPseudoState;
  const candidate = trimmed.startsWith(':') || trimmed.startsWith('[') ? trimmed : `:${trimmed}`;
  return isValidCustomPseudoSuffix(candidate) ? `custom:${candidate}` : null;
}

export function parsePseudoRules(css: string): Map<string, PseudoStyles> {
  const result = new Map<string, PseudoStyles>();
  if (!css) return result;

  const ruleRx = /\[data-id="([^"]+)"\]((?:::[a-z-]+|:[a-z-]+(?:\([^(){}]*\))?|\[[^\]{}\s]+\])+)\s*\{([^}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = ruleRx.exec(css)) !== null) {
    const nodeId = match[1];
    const suffix = match[2];
    const pseudo = normalizePseudoKind(suffix);
    if (!pseudo) continue;

    const declBlock = match[3];
    const props: Record<string, string> = {};
    const decls = declBlock.split(';').map((d) => d.trim()).filter(Boolean);
    for (const decl of decls) {
      const colonIdx = decl.indexOf(':');
      if (colonIdx === -1) continue;
      const prop = decl.slice(0, colonIdx).trim();
      const value = decl.slice(colonIdx + 1).trim().replace(/\s*!important\s*$/, '').trim();
      if (prop && value) props[toCamel(prop)] = value;
    }

    if (Object.keys(props).length > 0) {
      const existing = result.get(nodeId) || {};
      existing[pseudo] = props;
      result.set(nodeId, existing);
    }
  }

  trace.fn('pseudo-parser:parsePseudoRules', { ruleCount: result.size });
  return result;
}
```

In `src/code/generation/generator-styles.ts`:
- Import `BUILTIN_PSEUDO_ELEMENTS`, `type PseudoKind` from `@/code/parsing/pseudo-parser`.
- Export `export type PseudoRuleKind = PseudoKind;`
- Update `pseudoSelector(nodeId: string, pseudo: PseudoRuleKind): string`:
  - If `pseudo.startsWith('custom:')` -> `` `[data-id="${nodeId}"]${pseudo.slice('custom:'.length)}` ``
  - If `pseudo === 'before' || pseudo === 'after' || pseudo === 'placeholder'` -> `` `[data-id="${nodeId}"]::${pseudo}` ``
  - Otherwise -> `` `[data-id="${nodeId}"]:${pseudo}` ``
- Keep `updateHoverStyleInCode` and `removeHoverStyleInCode` delegating to `updatePseudoStyleInCode(code, nodeId, 'hover', styles)` and `removePseudoStyleInCode(code, nodeId, 'hover')` so all callers stay 100% compatible.
- Update `src/code/mutation/mutation-queue.ts` lines 674-676 so `pseudo` on `updatePseudoStyle` and `removePseudo` uses `PseudoRuleKind`.

- [ ] **Step 4: Add generator round-trip test in `src/code/generation/generator.test.ts` and run tests**

Add to `src/code/generation/generator.test.ts`:
```ts
test('writes and removes :active, :focus-visible, and custom node-scoped pseudo rules', () => {
  const base = `<div data-id="box-1" style={{ color: '#111' }}>Hi</div>`;
  const s1 = updatePseudoStyleInCode(base, 'box-1', 'focus-visible', { outline: '2px solid #111' });
  expect(s1).toContain('[data-id="box-1"]:focus-visible');
  const s2 = updatePseudoStyleInCode(s1, 'box-1', 'custom::nth-child(odd)', { backgroundColor: '#fff' });
  expect(s2).toContain('[data-id="box-1"]:nth-child(odd)');
  const s3 = removePseudoStyleInCode(s2, 'box-1', 'focus-visible');
  expect(s3).not.toContain(':focus-visible');
  expect(s3).toContain('[data-id="box-1"]:nth-child(odd)');
});
```
Run: `npx vitest run src/code/parsing/pseudo-parser.test.ts src/code/generation/generator.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/code/parsing/pseudo-parser.ts src/code/parsing/pseudo-parser.test.ts src/code/generation/generator-styles.ts src/code/generation/generator.test.ts src/code/mutation/mutation-queue.ts
git commit -m "feat(styles): extend pseudo-state parser and generator for hover, active, focus-visible, disabled, and safe custom suffixes"
```

---

### Task 2: Oracle Validation & MCP `styles.set` / `styles.get` Alignment

**Files:**
- Modify: `src/code/oracle/check-file.ts:195-212`
- Modify: `packages/automation-core/src/operations/styles.ts:100-175,207-276`
- Test: `src/code/oracle/check-file.test.ts`
- Test: `src/code/parsing/project-parser.test.ts` (verify `expandComponent` `afterCSS` rewrites `[data-id="X"]` for `:hover` and custom suffixes)
- Test: `packages/automation-core/test/capabilities/T07-styles.test.ts` (or matching styles test in `packages/automation-core/test/`)

**Interfaces:**
- Consumes: `normalizePseudoKind`, `parsePseudoRules`, `pseudoSelector` from Task 1.
- Produces:
  - `check-file.ts` `isEditorMediaStyleBlock`: accepts `[data-id="..."]` followed by one or more pseudo-elements/classes or attribute qualifiers (`isValidCustomPseudoSuffix` pattern).
  - `styles.set`: normalizes `input.pseudo` via `normalizePseudoKind`; throws `INVALID_PSEUDO_SELECTOR` if invalid.
  - `styles.get`: optionally returns `pseudoStyles?: Record<string, Record<string, string>>` when present in `<style>`.

- [ ] **Step 1: Write failing Oracle & MCP `styles.set` tests**

In `src/code/oracle/check-file.test.ts`:
```ts
test('allows node-scoped attribute and compound pseudo selectors in editor style block', () => {
  const code = `'use client';
import React from 'react';
export default function Card() {
  return (
    <div data-id="root" style={{ display: 'flex' }}>
      <style>{\`
        [data-id="btn-1"]:hover { background-color: #1e1e1e !important; }
        [data-id="btn-1"]:focus-visible { outline: 2px solid #111111 !important; }
        [data-id="btn-1"][aria-expanded="true"] { border-color: #111111 !important; }
      \`}</style>
      <button data-id="btn-1" type="button" style={{ color: '#111111' }}>Open</button>
    </div>
  );
}`;
  const violations = checkFile(code, { kind: 'page' });
  expect(violations.filter((v) => v.code === 'RAW_STYLE_TAG')).toHaveLength(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/code/oracle/check-file.test.ts`
Expected: FAIL (`[data-id="btn-1"][aria-expanded="true"]` rejected as `RAW_STYLE_TAG`).

- [ ] **Step 3: Update `isEditorMediaStyleBlock` in `src/code/oracle/check-file.ts` and `styles.ts`**

In `src/code/oracle/check-file.ts` line 199, extract suffix check:
```ts
      const idMatch = sel.match(/^\[data-id="([^"]+)"\](.+)$/);
      const hasValidNodePseudoSuffix = Boolean(idMatch && isValidCustomPseudoSuffix(idMatch[2]));
      if (!hasValidNodePseudoSuffix
        && !/^:lang\([^)]+\)\s*\[data-id="[^"]+"\]$/.test(sel)
        && !/^\[data-variant="([^"]+)"\]\s\[data-id="([^"]+)"\]::after,\s*\[data-id="\2"\]\[data-variant="\1"\]::after$/.test(sel)
        && !/^select\[data-id="[^"]+"\]$/.test(sel)) return false;
```
In `packages/automation-core/src/operations/styles.ts` lines 245-256:
```ts
    } else if (input.pseudo) {
      const normalizedPseudo = normalizePseudoKind(input.pseudo);
      if (!normalizedPseudo) {
        throw new Error(`INVALID_PSEUDO_SELECTOR: Unsupported or unsafe pseudo selector "${input.pseudo}".`);
      }
      if (normalizedPseudo === 'hover') {
        nextCode = updateHoverStyleInCode(nextCode, effectiveNodeId, normalizedStyles);
      } else {
        nextCode = updatePseudoStyleInCode(
          nextCode,
          effectiveNodeId,
          normalizedPseudo,
          normalizedStyles
        );
      }
    }
```
And in `styles.get` (`packages/automation-core/src/operations/styles.ts`), parse `extractStyleCSS(code)` with `parsePseudoRules` and return `pseudoStyles` for `effectiveNodeId` when non-empty.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/code/oracle/check-file.test.ts packages/automation-core/test/`
Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/code/oracle/check-file.ts src/code/oracle/check-file.test.ts packages/automation-core/src/operations/styles.ts
git commit -m "feat(oracle,mcp): validate and execute extended and custom node-scoped pseudo-states"
```

---

### Task 3: Visual States / Pseudo Editor UI with `Transition` & Live Canvas Preview (`StylesTool`)

**Files:**
- Modify: `src/editor/tools/StylesTool/atoms/PseudoElementControl.tsx:1-665`
- Modify: `src/editor/tools/StylesTool/index.tsx:135-145,250-350`
- Test: `src/editor/tools/StylesTool/atoms/PseudoElementControl.test.tsx` (create)

**Interfaces:**
- Consumes: `pseudoStylesAtom`, `BUILTIN_PSEUDO_STATES`, `BUILTIN_PSEUDO_ELEMENTS`, `isValidCustomPseudoSuffix`, `pseudoSelector`, `queueMutation({ type: 'updatePseudoStyle' | 'removePseudo' })`, `injectCanvasCSS`, `removeCanvasCSS`.
- Produces:
  - Unified `PseudoElementControl` ("States & Pseudo") rendering active rows for `:hover`, `:active`, `:focus-visible`, `:focus-within`, `:disabled`, `::before`, `::after`, plus any `custom:*` entries present on the node.
  - Inside `PseudoEditor`: `FillControl`, `BorderControl`, `ShadowControl`, `OpacityControl`, `RadiusControl`, `FilterControl`, `TransformControl`, `ClipPathControl`, `TextColor` (`color`), **`Transition` row** (duration + easing), and a **"Preview state" toggle** that temporarily injects `[data-id="${nodeId}"]` with the state's declarations into the canvas iframe while open/toggled and cleans up on close/unmount.

- [ ] **Step 1: Write failing React Testing Library test for `:hover`, custom suffix validation, `Transition`, and live preview injection**

Create `src/editor/tools/StylesTool/atoms/PseudoElementControl.test.tsx` testing:
1. Adding `:hover` dispatches `queueMutation({ type: 'updatePseudoStyle', nodeId, pseudo: 'hover', styles: ... })`.
2. Adding a custom state `:nth-child(odd)` dispatches `pseudo: 'custom::nth-child(odd)'`, while `.other > div` shows a validation error and does not mutate.
3. Toggling "Preview state" calls `injectCanvasCSS('[data-id="n1"]__preview_hover', ...)` (or `[data-id="n1"] { ... }`) and `removeCanvasCSS` on close.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/editor/tools/StylesTool/atoms/PseudoElementControl.test.tsx`
Expected: FAIL (`:hover` / custom state UI not implemented).

- [ ] **Step 3: Implement unified state rows, custom state input, `Transition` row, and Live State Preview in `PseudoElementControl.tsx`**

Key implementation rules inside `PseudoElementControl.tsx`:
- Display label helper `formatPseudoLabel(pseudo: PseudoKind)`: `'hover' -> ':hover'`, `'before' -> '::before'`, `'custom::nth-child(odd)' -> ':nth-child(odd)'`.
- State `+` picker inside `PseudoPopupContent` lists unused built-in states (`:hover`, `:active`, `:focus-visible`, `:focus-within`, `:disabled`, `::before`, `::after`) plus an inline `+ Custom state` input validated via `isValidCustomPseudoSuffix`. On form control tags (`input`, `textarea`, `select`), skip `:focus` and `:checked` inside `PseudoElementControl` so they do not duplicate `FormStateControl.tsx`.
- In `PseudoEditor`, add:
  - `Transition` control (duration in `ms`/`s` + easing `ease` / `cubic-bezier(0.77, 0, 0.175, 1)` / `linear`, writing `transition` on the base element style when editing interactive states so both hover-in and hover-out animate smoothly, or on the pseudo rule itself when desired).
  - `Preview on canvas` toggle button (active by default when editing `:hover` / `:active` / `:focus-visible`): calls `injectCanvasCSS` with `[data-id="${nodeId}"] { ${cssDecls} }` under a dedicated preview key and removes it in `useEffect` cleanup on unmount/close.
  - Note in `PseudoPopupContent` footer: *"Use States for single-node CSS states. For parent-hover affecting child elements, extract a Design Component with Hover variants."*

- [ ] **Step 4: Run test & typecheck**

Run: `npx vitest run src/editor/tools/StylesTool/ && npx tsc --noEmit`
Expected: PASS with 0 TypeScript errors.

- [ ] **Step 5: Commit Task 3**

```bash
git add src/editor/tools/StylesTool/atoms/PseudoElementControl.tsx src/editor/tools/StylesTool/atoms/PseudoElementControl.test.tsx src/editor/tools/StylesTool/index.tsx
git commit -m "feat(editor): add visual CSS states (:hover, :active, :focus-visible, custom) with live canvas preview"
```

---

## Track B: Autonomous Browserless Screenshots (`observe.screenshot`)

### Task 4: Fix Headless Playwright Fallback, Native Element Capture, and Image Content Blocks

**Files:**
- Modify: `packages/cli/src/mcp.ts:18-214,472-486`
- Modify: `packages/automation-core/src/operations/observe.ts:1810-1940`
- Test: `packages/cli/src/__tests__/mcp-screenshot.test.ts` (create)

**Interfaces:**
- Consumes: `observeScreenshotOutputSchema` (`packages/automation-core/src/operations/observe.ts`).
- Produces:
  - `captureHeadlessScreenshot(...)` in `packages/cli/src/mcp.ts` using native Playwright `locator.screenshot()` / `page.screenshot()` against `REVYME_PREVIEW_URL` (default `http://localhost:5175/preview/${projectId}` or `/builder/${projectId}` fallback), exact desktop width `1200x900`, waiting for `document.fonts.ready` and image load completion.
  - Fallback triggered on `EDITOR_NOT_CONNECTED`, `ECONNREFUSED`, and `AbortError`.
  - Saves captured binary to `os.tmpdir()/revyme-screenshots/${projectId}-${vp}-${nodeId}.png` (`filePath` returned in result) and emits an MCP `{ type: 'image', data: base64, mimeType }` content block alongside compact JSON metadata in `CallToolResult`.

- [ ] **Step 1: Write failing unit tests for bridge fallback on `EDITOR_NOT_CONNECTED` and MCP image content block emission**

Create `packages/cli/src/__tests__/mcp-screenshot.test.ts` mocking `fetch` returning `503 { error: "No editor tab connected" }` and a stub Playwright launcher, asserting `captureScreenshot` invokes headless fallback instead of returning `EDITOR_NOT_CONNECTED` early, and verifying `CallToolResult.content` includes `{ type: 'image', mimeType: 'image/png', data: ... }` without dumping raw 1MB `dataUrl` JSON into text.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/cli/src/__tests__/mcp-screenshot.test.ts`
Expected: FAIL (`EDITOR_NOT_CONNECTED` returns early without invoking headless fallback).

- [ ] **Step 3: Implement autonomous Playwright preview capture & MCP image response in `packages/cli/src/mcp.ts` and `observe.ts`**

1. In `packages/cli/src/mcp.ts` `captureHeadlessScreenshot`:
   - Set `desktop: { width: 1200, height: 900, prefix: '' }`, `tablet: { width: 810, height: 1080, prefix: 'tablet-' }`, `mobile: { width: 390, height: 844, prefix: 'mobile-' }`.
   - Try lightweight preview sandbox (`REVYME_PREVIEW_URL`, default `http://localhost:5175` from `vite.preview.config.ts`) first, falling back to `${builderBase}/builder/${projectId}` (`localhost:3333`) or an on-demand spawned preview server when neither port `5175` nor `3333` is already listening — so headless screenshots work even when the user has no browser or dev server open.
   - Wait for `await page.evaluate(() => document.fonts.ready)` and all `<img>` elements (`complete === true`).
   - Capture directly with Playwright:
     ```ts
     const buffer: Buffer = targetNode === 'root'
       ? await page.screenshot({ type: format === 'jpeg' ? 'jpeg' : 'png', fullPage: true })
       : await page.locator(`[data-id="${targetNode}"]`).first().screenshot({ type: format === 'jpeg' ? 'jpeg' : 'png' });
     ```
   - Write buffer to `${os.tmpdir()}/revyme-screenshots/${projectId}-${viewport || 'desktop'}-${targetNode}.${format === 'jpeg' ? 'jpg' : 'png'}` and return `{ available: true, status: 'ready', filePath: outPath, dataUrl, bytes: buffer.length, width, height, waitedMs, source: 'headless-chromium' }`.
2. In `createBridgeScreenshotService` (`packages/cli/src/mcp.ts:176-211`):
   - When `payload?.error?.startsWith('No editor tab connected')` OR `err?.name === 'AbortError'` OR `err?.code === 'ECONNREFUSED'`, invoke `captureHeadlessScreenshot(...)`. If it returns `available: true`, return it; otherwise return structured `{ available: false, status: 'unavailable', reason: 'HEADLESS_CAPTURE_FAILED', note: ... }` instead of re-throwing raw `AbortError`.
3. In `CallToolResult` (`packages/cli/src/mcp.ts:477-486`):
   - When `toolName === 'observe.screenshot'` and `result.ok && result.data?.primary?.dataUrl`, strip `dataUrl` from the JSON text payload (keep `filePath`, `width`, `height`, `bytes`, `status`) and append `{ type: 'image', data: base64, mimeType: format === 'jpeg' ? 'image/jpeg' : 'image/png' }` to `content`.

- [ ] **Step 4: Run tests & rebuild CLI**

Run: `npx vitest run packages/cli/src/__tests__/mcp-screenshot.test.ts && npm --workspace=@revyme/cli run build`
Expected: PASS and `dist/main.js` builds cleanly.

- [ ] **Step 5: Commit Task 4**

```bash
git add packages/cli/src/mcp.ts packages/cli/src/__tests__/mcp-screenshot.test.ts packages/automation-core/src/operations/observe.ts
git commit -m "feat(cli,mcp): enable browserless Playwright preview screenshot fallback and MCP image blocks"
```

---

## Track C: Motion, Effect Verification, and SVG Audit Accuracy

### Task 5: Auto-Wire `viewport={{ once: true }}` in `motion.set`

**Files:**
- Modify: `src/code/generation/generator-motion-props.ts:170-210`
- Modify: `packages/automation-core/src/operations/motion.ts:40-94`
- Test: `src/code/generation/generator-motion.test.ts` (or existing motion test)

**Interfaces:**
- Produces: `motion.set` accepts optional `viewportOnce?: boolean` (defaults to `true` whenever `prop === 'whileInView'`), and `updateMotionPropInCode` ensures `viewport={{ once: true }}` is present on the JSX tag when `propName === 'whileInView'`.

- [ ] **Step 1: Write failing test for `motion.set` `whileInView` adding `viewport={{ once: true }}`**

In `packages/automation-core/test/` (find motion test file or add `T14-motion-viewport.test.ts`):
```ts
test('motion.set whileInView automatically adds viewport={{ once: true }}', async () => {
  const res = await motionSetOperation.execute(snapshotWithDiv('box-1'), {
    targetFile: 'app/page.client.tsx',
    nodeId: 'box-1',
    prop: 'whileInView',
    values: { clipPath: 'inset(0% 0% 0% 0%)' },
  });
  const next = res.changes[0].content!;
  expect(next).toContain('viewport={{ once: true }}');
  expect(checkFile(next, { kind: 'page' }).filter((v) => v.code === 'APPEAR_MISSING_VIEWPORT_ONCE')).toHaveLength(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/automation-core/test/capabilities/T14-motion-viewport.test.ts`
Expected: FAIL (`viewport={{ once: true }}` absent, `APPEAR_MISSING_VIEWPORT_ONCE` raised).

- [ ] **Step 3: Update `updateMotionPropInCode` in `generator-motion-props.ts` and `motionSetOperation` in `motion.ts`**

When `propName === 'whileInView'`, check if `viewport` attribute exists on the element (`findMotionPropExpr(result, nodeId, 'viewport')`); if missing, insert `viewport={{ once: true }}` alongside `whileInView`. Support `viewportOnce: false` override in `motion.ts` to omit/remove it if explicitly requested.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/automation-core/test/capabilities/T14-motion-viewport.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit Task 5**

```bash
git add src/code/generation/generator-motion-props.ts packages/automation-core/src/operations/motion.ts packages/automation-core/test/capabilities/T14-motion-viewport.test.ts
git commit -m "feat(motion): auto-inject viewport={{ once: true }} when setting whileInView"
```

---

### Task 6: Teach `verify.effect` to Recognize CSS `:hover` Rules & Component Variant Connections

**Files:**
- Modify: `packages/automation-core/src/operations/verify.ts:153-270`
- Test: `packages/automation-core/test/capabilities/T24-verify.test.ts`

- [ ] **Step 1: Write failing test for `verify.effect` detecting `[data-id="..."]:hover` in `<style>`**

Add test verifying that a page with `<style>{\`[data-id="cta-1"]:hover { background-color: #1e1e1e !important; }\`}</style>` satisfies `hover-animation` check (`state: 'wired'`) in `verify.effect`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/automation-core/test/capabilities/T24-verify.test.ts`
Expected: FAIL (`hover-animation` reports `absent`).

- [ ] **Step 3: Parse `<style>` block with `parsePseudoRules` in `verify.ts`**

In `packages/automation-core/src/operations/verify.ts`, extract `<style>` CSS via `extractStyleCSS(code)` and run `parsePseudoRules(css)`. If any target node (or any node when `targetNodeIds` is omitted) has a `hover` rule, mark `hasHover = true` and record `hasCssHover: true` in `motionAnalysis[nodeId]`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/automation-core/test/capabilities/T24-verify.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit Task 6**

```bash
git add packages/automation-core/src/operations/verify.ts packages/automation-core/test/capabilities/T24-verify.test.ts
git commit -m "feat(verify): recognize CSS :hover pseudo rules in verify.effect"
```

---

### Task 7: Exclude Internal SVG Geometry Primitives from `observe.audit` Unmeasured Rect Checks

**Files:**
- Modify: `packages/automation-core/src/operations/observe.ts:1563-1630`
- Test: `packages/automation-core/test/capabilities/T24-observe-audit.test.ts`

- [ ] **Step 1: Write failing test for `observe.audit` with unmeasured SVG `<path>`/`<rect>` children**

Create a snapshot fixture where `<svg data-id="svg-1">` has a valid rect, while its `<path data-id="path-2">` child is listed in `epoch.unmeasured`, and assert `observe.audit` completes with `status: 'ready'` instead of `CANVAS_MID_RENDER`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/automation-core/test/capabilities/T24-observe-audit.test.ts`
Expected: FAIL (`status: 'pending'`, `CANVAS_MID_RENDER`).

- [ ] **Step 3: Filter SVG child geometry tags from `epoch.unmeasured` before `observationStatusWithEpoch`**

In `packages/automation-core/src/operations/observe.ts`, define `SVG_CHILD_PRIMITIVE_TAGS = new Set(['path', 'circle', 'rect', 'line', 'polygon', 'polyline', 'ellipse', 'g', 'defs', 'use', 'clippath', 'lineargradient', 'radialgradient', 'stop'])` and exclude `unmeasured` IDs whose `nodeMap.get(id)?.type.toLowerCase()` is in `SVG_CHILD_PRIMITIVE_TAGS` when checking `observationStatusWithEpoch`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/automation-core/test/capabilities/T24-observe-audit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit Task 7**

```bash
git add packages/automation-core/src/operations/observe.ts packages/automation-core/test/capabilities/T24-observe-audit.test.ts
git commit -m "fix(observe): ignore internal SVG primitive tags in unmeasured audit check"
```

---

## Track D: Ingestion Auto-Healing, Fonts, Inline Spacing, MCP DX & Skills

### Task 8: SVG Shape Auto-Healing During JSX Ingestion (`ingestion/jsx.ts`)

**Files:**
- Modify: `packages/automation-core/src/ingestion/jsx.ts:250-270,415-460`
- Create: `packages/automation-core/src/ingestion/svg-heal.ts`
- Test: `packages/automation-core/test/ingestion/svg-heal.test.ts`

**Interfaces:**
- Produces `healSvgSubtree(svgNode: IngestedNode, idManager: IdManager, reporter?: IngestionReporter): void`:
  - Converts `<rect>`, `<circle>`, `<line>`, `<polygon>` into single `<path d="..." />`.
  - Moves `fill` / `stroke` / `strokeWidth` from outer `<svg>` onto child `<path>`s.
  - Splits multi-subpath stroke-only `<path>` (`>= 2` `M`/`m` commands with `fill === 'none'` or no fill) into nested `<svg overflow="visible" viewBox={...}><path .../></svg>` children.

- [ ] **Step 1: Write failing test for SVG primitive conversion and multi-subpath splitting**

Test `<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="14" stroke="#111" /><path d="M5 12H19M13 6L19 12L13 18" stroke="#111" /></svg>` passing `checkFile(..., { kind: 'page' })` with zero `SHAPE_GEOMETRY_NOT_PATH`, `SHAPE_PATH_MULTIPLE_SUBPATHS`, `WRAPPER_PAINT_PROPS`, and `NESTED_SVG_OVERFLOW_REQUIRED` violations.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/automation-core/test/ingestion/svg-heal.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `healSvgSubtree` in `packages/automation-core/src/ingestion/svg-heal.ts` and wire into `jsx.ts`**

Convert `<rect>`, `<circle>`, `<line>`, `<polygon>` mathematically to `d` strings, propagate inherited `fill`/`stroke`/`strokeWidth` down to `<path>`, remove `fill` from `<svg>` wrapper, and split stroke-only multi-`M` paths into nested `<svg overflow="visible" width={w} height={h} viewBox={vb}>`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/automation-core/test/ingestion/svg-heal.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit Task 8**

```bash
git add packages/automation-core/src/ingestion/svg-heal.ts packages/automation-core/src/ingestion/jsx.ts packages/automation-core/test/ingestion/svg-heal.test.ts
git commit -m "feat(ingestion): auto-heal SVG primitives and multi-subpath strokes to Oracle-compliant paths"
```

---

### Task 9: Fix `fonts.import` Italic Support & Mixed-Content Inline Text Whitespace

**Files:**
- Modify: `packages/automation-core/src/operations/fonts.ts:100-153`
- Modify: `packages/automation-core/src/ingestion/jsx.ts:216-248`
- Test: `packages/automation-core/test/capabilities/T08-fonts.test.ts`
- Test: `packages/automation-core/test/ingestion/inline-whitespace.test.ts`

- [ ] **Step 1: Write failing tests for `fonts.import` (`400italic`) and `<h2>AND <span>silence</span> TAKES</h2>` spacing**

1. `fonts.import` with `family: 'Instrument Serif', weights: ['400', '400italic']` must emit `family=Instrument+Serif:ital,wght@0,400;1,400`.
2. `ingestJSXFragment('<h2>AND <span>silence</span> TAKES</h2>')` must preserve separating spaces (`text` on leading/trailing spans or preserved inline spacing) so rendered text reads `"AND silence TAKES"`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/automation-core/test/capabilities/T08-fonts.test.ts packages/automation-core/test/ingestion/inline-whitespace.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement italic URL builder in `fonts.ts` and boundary-aware whitespace collapse in `jsx.ts`**

1. In `fonts.ts`: detect `italic` tokens (`400italic`, `italic`, `1,400`), emit `:ital,wght@${tuples.join(';')}` when any italic weight is requested, else `:wght@${wghtStr}`.
2. In `jsx.ts`: when `hasElementChildren` is true inside a text tag (`h1`–`h6`, `p`, `span`, `a`, `li`), collapse `/\s+/g` to `' '` without stripping single separating spaces adjacent to inline sibling elements (only drop pure-whitespace indentation nodes between block elements).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/automation-core/test/capabilities/T08-fonts.test.ts packages/automation-core/test/ingestion/inline-whitespace.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit Task 9**

```bash
git add packages/automation-core/src/operations/fonts.ts packages/automation-core/src/ingestion/jsx.ts packages/automation-core/test/capabilities/T08-fonts.test.ts packages/automation-core/test/ingestion/inline-whitespace.test.ts
git commit -m "fix(fonts,ingestion): support italic Google Fonts imports and preserve mixed inline whitespace"
```

---

### Task 10: MCP Schema Cleanup, `workflow.chain` ID Interpolation, CLI Rebuild & Skill Updates

**Files:**
- Modify: `packages/cli/src/mcp.ts:294-339`
- Modify: `packages/cli/src/client.ts:264-282`
- Modify: `.agents/skills/revyme-motion/SKILL.md`
- Modify: `.agents/skills/revyme-director/SKILL.md`
- Test: `packages/cli/src/__tests__/workflow-chain-interpolation.test.ts` (create)

- [ ] **Step 1: Write failing test for `workflow.chain` `$prev.rootId` interpolation and `$schema`-free `ListTools` output**

Assert `ListTools` omits `$schema` on each tool `inputSchema`, and `workflow.chain` resolves `{ targetId: '$prev.rootId' }` using `stepIndex - 1`'s `operationResult.rootId`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/cli/src/__tests__/workflow-chain-interpolation.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `$schema` stripping, `$prev` / `$steps[N]` interpolation, update skills, and rebuild `@revyme/cli`**

1. In `packages/cli/src/mcp.ts`: strip `$schema` (`const { $schema: _, ...rest } = jsonSchema`) before returning `inputSchema` in `ListToolsRequestSchema`.
2. In `packages/cli/src/client.ts`: add `resolveChainStepInput(stepInput, receipts)` resolving `$prev.<path>` and `$steps[<idx>].<path>` from prior `receipts[idx].result.operationResult` / `result.data`.
3. In `.agents/skills/revyme-motion/SKILL.md` and `.agents/skills/revyme-director/SKILL.md`: add the **Hover & States Routing Matrix**:
   - Single-element hover/active/focus states → `styles.set({ pseudo: 'hover' | 'active' | 'focus-visible' })` (editable in `StylesTool` States/Pseudo UI) or `motion.set({ prop: 'whileHover' })` for spring physics.
   - Parent-hover driving child elements (overlays, nested image scale, rotating child icons) → `components.extract` + `variants.create` + `connections.create` (`whileHover`). If the user explicitly asks to avoid creating components, warn upfront that parent→child hover will not run natively in the editor canvas without a component variant.
4. Rebuild CLI bundle: `npm --workspace=@revyme/cli run build`.

- [ ] **Step 4: Run full verification gate**

Run:
```powershell
npx vitest run packages/cli/src/__tests__/ packages/automation-core/test/ src/code/parsing/pseudo-parser.test.ts src/code/oracle/check-file.test.ts src/editor/tools/StylesTool/
npx tsc --noEmit
npm --workspace=@revyme/cli run build
```
Expected: All tests PASS, `tsc --noEmit` exits 0, `dist/main.js` rebuilt cleanly.

- [ ] **Step 5: Commit Task 10**

```bash
git add packages/cli/src/mcp.ts packages/cli/src/client.ts packages/cli/src/__tests__/workflow-chain-interpolation.test.ts .agents/skills/revyme-motion/SKILL.md .agents/skills/revyme-director/SKILL.md
git commit -m "feat(cli,skills): strip \$schema in ListTools, interpolate chain step IDs, and document hover routing"
```
