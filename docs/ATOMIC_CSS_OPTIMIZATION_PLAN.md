# Technical Implementation Plan: Atomic CSS Optimization Engine

> **Document:** Subagent Implementation Plan  
> **Target Subsystem:** `src/code/generation/atomic-css/`, `src/code/project/source-export.ts`  
> **Status:** Ready for Execution  
> **Language:** English (Agent-Optimized)  

---

## 1. Executive Summary & Objective

In visual website builders and AI-assisted authoring, repeating cards, Bento grids, buttons, and layouts often produce identical inline style declarations. For example, 30 cards across a landing page may each declare:
```tsx
style={{ padding: '24px', borderRadius: '16px', background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.1)' }}
```
While this is natural for an in-memory React AST during editing, shipping hundreds of repetitive inline `style={{ ... }}` objects into published HTML bloats document size by 30–40%, degrades gzip efficiency, and increases browser DOM parsing time.

This plan designs and implements an **AST-based Atomic CSS Compiler** (inspired by Webstudio's `packages/css-engine/src/core/atomic.ts`). During site export:
1. Static CSS declarations in JSX `style={{ ... }}` are analyzed.
2. Identical property-value pairs (and breakpoint variations) are hashed into deterministic atomic utility classes (e.g. `.c-p24px`, `.c-r16px`).
3. Inline styles are replaced with `className` tokens, while dynamic runtime expressions (variables, state-driven ternaries) remain safely in `style`.
4. A single, deduplicated, minified `atomic.css` stylesheet is emitted and injected into `app/layout.tsx`.

---

## 2. Invariants & Design Principles

1. **Non-Destructive to ProjectFS:** The compiler runs strictly during the **export pipeline** (`source-export.ts`). The user's original source files on ProjectFS retain their editable JSX structures so the visual builder's canvas loop remains untouched.
2. **Dynamic Expression Safety:** Only static string/numeric literal properties in `style` objects are extracted. Any property whose value is a variable reference, conditional expression (`x ? a : b`), or function call is preserved in `style`.
3. **Deterministic Hashing:** Class names must be deterministic based on the declaration key, value, and media query (e.g., using a fast hash function like Emotion's hash or murmur3). Generating the export multiple times from the same source must produce bit-for-bit identical CSS and class names.
4. **Specificity & Media Query Order:** Media queries (`@media (max-width: ...)`) must be sorted in correct mobile-first or desktop-first cascade order within `atomic.css` to prevent specificity collisions.

---

## 3. Architecture & Module Breakdown

```
[Core Atomic Engine]
  ├── src/code/generation/atomic-css/hash.ts           # Deterministic lightweight 32-bit hash function
  ├── src/code/generation/atomic-css/css-collector.ts  # Registry collecting unique declarations & rules
  ├── src/code/generation/atomic-css/ast-transform.ts  # Babel JSX AST pass replacing static styles with classes
  └── src/code/generation/atomic-css/atomic-compiler.ts# Main coordinator compiling a file bundle

[Integration Point]
  └── src/code/project/source-export.ts                # Calls atomic compiler when opts.atomicCss === true
```

---

## 4. Implementation Tasks

### Task 1: Hash & Rule Registry Module

**Files:**
- Create: `src/code/generation/atomic-css/hash.ts`
- Create: `src/code/generation/atomic-css/css-collector.ts`
- Test: `src/code/generation/atomic-css/__tests__/css-collector.test.ts`

**Specifications:**
1. `hash.ts`:
   Implement a fast, deterministic string hash returning a 6-character alphanumeric slug prefixed with `c-`:
   ```typescript
   export function hashDeclaration(property: string, value: string, media?: string): string {
     // Returns e.g. "c-a1b2c3"
   }
   ```
2. `css-collector.ts`:
   Manage the deduplicated set of CSS rules:
   ```typescript
   export interface AtomicDeclaration {
     className: string;
     property: string;
     value: string;
     media?: string;
   }

   export class AtomicCssCollector {
     private rules = new Map<string, AtomicDeclaration>();

     register(property: string, value: string, media?: string): string {
       const key = `${media ?? ''}|${property}|${value}`;
       const existing = this.rules.get(key);
       if (existing) return existing.className;
       const className = hashDeclaration(property, value, media);
       this.rules.set(key, { className, property, value, media });
       return className;
     }

     emitCss(): string {
       // Emits sorted CSS: base rules first, followed by sorted media queries
     }
   }
   ```

- [ ] **Step 1:** Write unit tests verifying deduplication, hashing consistency, and media query ordering.
- [ ] **Step 2:** Implement `hash.ts` and `css-collector.ts`.
- [ ] **Step 3:** Run `npx vitest run src/code/generation/atomic-css/__tests__/css-collector.test.ts`.

---

### Task 2: Babel AST JSX Style Transformer

**Files:**
- Create: `src/code/generation/atomic-css/ast-transform.ts`
- Test: `src/code/generation/atomic-css/__tests__/ast-transform.test.ts`

**Specifications:**
Using `@babel/traverse` and `@babel/types`:
1. Find JSX elements with a `style={{ ... }}` attribute.
2. For each `ObjectProperty`:
   - If key and value are static literals (e.g. `padding: '24px'` or `zIndex: 10`):
     - Convert camelCase property to kebab-case (`paddingTop` -> `padding-top`).
     - Register with `AtomicCssCollector` and receive `className`.
     - Remove property from `style` object.
   - If value is dynamic (e.g. `color: themeColor`, `opacity: isOpen ? 1 : 0`):
     - Leave untouched in `style`.
3. If extracted classes exist:
   - If element already has `className="existing-class"`:
     - Append extracted classes: `className="existing-class c-p24px c-r16px"`.
   - If element has dynamic `className={...}`:
     - Wrap with template literal or `clsx` / `join`: `className={`${dynamicClass} c-p24px`}`.
   - If element had no `className`:
     - Add `className="c-p24px c-r16px"`.
4. If `style` object becomes empty after extraction:
   - Remove the `style` attribute entirely from the JSX opening element.

- [ ] **Step 1:** Write AST transform unit tests covering pure static styles, mixed static/dynamic styles, and elements with pre-existing `className`.
- [ ] **Step 2:** Implement `ast-transform.ts`.
- [ ] **Step 3:** Run `npx vitest run src/code/generation/atomic-css/__tests__/ast-transform.test.ts`.

---

### Task 3: Bundle Compiler & Integration with `source-export.ts`

**Files:**
- Create: `src/code/generation/atomic-css/atomic-compiler.ts`
- Modify: `src/code/project/source-export.ts`
- Test: `src/code/project/__tests__/source-export-atomic-css.test.ts`

**Specifications:**
1. `atomic-compiler.ts`:
   Takes the entire project file map `Record<filePath, code>`:
   - Iterates through all `.tsx` files (`app/**/*.tsx`, `components/**/*.tsx`).
   - Runs `transformJsxAtomicStyles` sharing a single `AtomicCssCollector` instance across the entire project.
   - Emits `app/atomic.css`.
   - Ensures `app/layout.tsx` imports `'./atomic.css'`.
   - Returns transformed file map.
2. In `source-export.ts`:
   - Add optional `atomicCss?: boolean` (defaults to `true` for production export, or enabled via export options).
   - When enabled, pass the prepared site files through `compileProjectAtomicCss(files)`.

- [ ] **Step 1:** Write integration test verifying that multiple pages sharing styles result in deduplicated atomic classes and a single valid `atomic.css`.
- [ ] **Step 2:** Implement `atomic-compiler.ts` and wire into `source-export.ts`.
- [ ] **Step 3:** Run `npx vitest run src/code/project/__tests__/source-export-atomic-css.test.ts`.

---

## 5. Verification & Benchmark Goals

```bash
# 1. Run atomic CSS test suite
npx vitest run src/code/generation/atomic-css/

# 2. Run full source export suite
npx vitest run src/code/project/source-export.test.ts

# 3. Type check
npx tsc --noEmit
```

**Target Benchmark:**
- ≥ 30% reduction in raw `.tsx` markup byte size for template/card-heavy pages.
- 100% style fidelity (visual regression parity between inline styles and atomic CSS classes).
