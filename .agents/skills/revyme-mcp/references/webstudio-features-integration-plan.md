# Webstudio Feature Parity & Integration Plan for Revyme

> **Author**: Antigravity AI Engineering  
> **Target Audience**: AI Agents & Engineering Team  
> **Scope**: High-Value Architectural & UX Features from Webstudio for Adoption in Revyme Builder

---

## 1. Executive Summary

Webstudio is an open-source visual website builder built on Remix/Radix/CSS standards. While Revyme excels at **Next.js code generation, interactive canvas drag-and-drop, and pure TypeScript/TSX AST roundtrips**, Webstudio has pioneered several best-in-class features for **data binding, design token hierarchies, accessible Radix primitives, and visual CSS Grid manipulation**.

This document details the top 7 architectural capabilities from Webstudio that should be adapted into Revyme to significantly elevate developer and visual designer ergonomics.

---

## 2. Top High-Value Features for Revyme Adoption

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ 1. Visual Formula & Computed Expression Bar (Dynamic Data Transformation)       │
│ 2. Polymorphic Radix UI Slot Primitives (Accessible UI Components)               │
│ 3. Design Tokens with Token Aliasing & Multi-Mode Themes                         │
│ 4. 2D Visual CSS Grid Matrix Area Builder                                        │
│ 5. Automated Accessibility (a11y) & SEO Linter in Canvas Inspector               │
│ 6. Side-by-Side Localization (i18n) Batch Matrix Table                           │
│ 7. Multi-Step Form Logic & Webhook Dispatcher Pipeline                          │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Feature Specifications & Implementation Architecture

### 1. Visual Formula & Computed Expression Bar

#### The Problem in Revyme:
Currently, Revyme supports binding CMS fields or component props directly to a single field (e.g. `title = item.name`). Transforming data (e.g. string formatting, date formatting, arithmetic, conditional ternary fallback) requires manually editing the raw code component.

#### The Webstudio Pattern:
A visual expression bar (similar to Airtable / Excel formulas or JavaScript template expressions):
- **String Concatenation**: `item.firstName + " " + item.lastName`
- **Ternary Conditionals**: `item.inStock ? "In Stock (" + item.quantity + ")" : "Sold Out"`
- **Formatters**: `formatDate(item.publishedAt, "MMM DD, YYYY")`, `formatCurrency(item.price, "USD")`
- **Array Transformations**: `item.tags.join(", ")` or `item.gallery.slice(0, 3)`

#### Implementation in Revyme:
- **Module**: `src/code/generation/expression-gen.ts` & `src/editor/controls/CmsBoundPill.tsx`
- **AST Generation**: Generator emits clean inline JSX expressions:
  ```tsx
  <span data-id="price-tag">
    {item.inStock ? `$${item.price.toFixed(2)}` : 'Out of Stock'}
  </span>
  ```
- **Safety**: Oracle rule `ORACLE_EXPRESSION_VALID` parses the AST snippet with Babel before committing.

---

### 2. Polymorphic Radix UI Primitive Integration & Multi-Slot System

#### The Problem in Revyme:
Revyme components currently have a single primary `slot` or scalar props. Building complex accessible interactive UI patterns (Tabs, Accordions, Dropdown Menus, Dialogs) requires writing custom code components with bespoke state handling.

#### The Webstudio Pattern:
Webstudio wraps `@radix-ui/react-*` primitives natively into the builder with polymorphic slotting (`asChild`):
- **Accordion Root** → **Accordion Item** → **Accordion Trigger (Slot)** + **Accordion Content (Slot)**
- **Dialog Root** → **Dialog Trigger (Slot)** + **Dialog Overlay** + **Dialog Content (Slot)**
- **Tabs Root** → **Tabs List (Slot)** + **Tabs Content (Slot)**

#### Implementation in Revyme:
- **Module**: `src/code/generation/slot-ops.ts` & `src/shared/insert-items/element-data.ts`
- **Emitted Code**: Clean Radix UI or `@revyme/runtime` accessible primitives:
  ```tsx
  import * as Accordion from '@radix-ui/react-accordion';

  <Accordion.Root type="single" collapsible className="w-full space-y-2">
    <Accordion.Item value="item-1" className="border rounded-lg p-4">
      <Accordion.Header>
        <Accordion.Trigger className="flex justify-between w-full font-bold">
          <span>What is Revyme?</span>
          <ChevronDownIcon className="transition-transform duration-200" />
        </Accordion.Trigger>
      </Accordion.Header>
      <Accordion.Content className="pt-2 text-neutral-400">
        Revyme is a visual website builder generating real Next.js code.
      </Accordion.Content>
    </Accordion.Item>
  </Accordion.Root>
  ```

---

### 3. Design Tokens with Token Aliasing & Multi-Mode Themes

#### The Problem in Revyme:
Revyme stores CSS variables in `tokens.css` with basic light/dark support, but does not support token referencing (semantic aliases) or multi-brand themes.

#### The Webstudio Pattern:
- **Tier 1 (Core Palette)**: `color.indigo.500 = #6366f1`
- **Tier 2 (Semantic Tokens / Aliases)**: `color.bg.primary = var(--color-indigo-500)`
- **Tier 3 (Component Tokens)**: `btn.primary.bg = var(--color-bg-primary)`
- **Modes**: Unlimited named theme modes (`Light`, `Dark`, `Cyberpunk`, `Brand-B2B`).

#### Implementation in Revyme:
- **Module**: `src/code/project/preset-ops.ts` & `src/editor/left-toolbar/panels/LibraryPanel/presets/`
- **Persistence**: Emitted into `styles/tokens.css` with CSS custom property cascading:
  ```css
  :root {
    --indigo-500: #6366f1;
    --bg-primary: var(--indigo-500);
    --btn-primary-bg: var(--bg-primary);
  }
  [data-theme="brand-dark"] {
    --bg-primary: #09090b;
    --btn-primary-bg: #8b5cf6;
  }
  ```

---

### 4. 2D Visual CSS Grid Matrix Area Builder

#### The Problem in Revyme:
Flexbox layouts in Revyme have excellent visual tools (align, justify, gap, direction). However, CSS Grid is edited primarily via manual CSS property inputs.

#### The Webstudio Pattern:
An interactive 2D Grid Canvas overlay:
- Drag across grid cells to define named areas (`grid-template-areas`).
- Click track headers to scrub column widths (`1fr`, `minmax(200px, 1fr)`, `auto`, `px`).
- Visual gap controls directly on the canvas boundary.

#### Implementation in Revyme:
- **Module**: `src/editor/tools/PositionTool/` & `src/canvas/ui/GridOverlay.tsx`
- **Generated Code**:
  ```tsx
  <div
    data-id="bento-grid"
    className="grid gap-4"
    style={{
      gridTemplateColumns: 'repeat(3, 1fr)',
      gridTemplateRows: 'auto auto',
      gridTemplateAreas: '"hero hero side" "stat1 stat2 side"',
    }}
  >
    <div style={{ gridArea: 'hero' }}>...</div>
    <div style={{ gridArea: 'side' }}>...</div>
    <div style={{ gridArea: 'stat1' }}>...</div>
    <div style={{ gridArea: 'stat2' }}>...</div>
  </div>
  ```

---

### 5. Automated Accessibility (a11y) & SEO Real-Time Linter

#### The Problem in Revyme:
The Oracle validates code syntax and dialect violations, but does not flag visual accessibility issues or semantic HTML omissions in the UI inspector.

#### The Webstudio Pattern:
An embedded linter panel that highlights:
1. **Missing Image Alt Text**: Direct input to add `alt` descriptions.
2. **Heading Level Hierarchy**: Warns when an `<h3>` appears without a parent `<h2>`.
3. **Color Contrast Ratio**: Calculates WCAG AA / AAA compliance between text color and background.
4. **Interactive Element Labels**: Flags `<button>` or `<a>` with only icons and no `aria-label`.

#### Implementation in Revyme:
- **Module**: `src/editor/overlays/A11yInspector.tsx` & `src/code/oracle/checks/a11y-dialect.ts`
- Runs non-blocking AST & computed style scans on the active page.

---

### 6. Side-by-Side Localization (i18n) Batch Matrix Table

#### The Problem in Revyme:
Translating a page requires switching locales one by one and selecting individual text nodes.

#### The Webstudio Pattern:
A centralized translation spreadsheet view:
- Table of all text keys across the project.
- Side-by-side columns (`en`, `uk`, `de`, `es`).
- "Auto-Translate with AI / DeepL" one-click button per row or per column.
- Syncs directly with `messages/{locale}.json` or inline i18n dictionaries.

#### Implementation in Revyme:
- **Module**: `src/editor/left-toolbar/panels/locale/TranslationsOverlay.tsx`
- Connects with existing `src/code/project/translation-ops.ts` to batch update dictionary files.

---

### 7. Visual Multi-Step Form Logic & Webhook Pipeline

#### The Problem in Revyme:
Forms submit to basic endpoints without visual step-branching or field validation rules.

#### The Webstudio Pattern:
- **Multi-Step Flow Container**: Step 1 (Contact) → Step 2 (Service Selection) → Step 3 (Confirmation).
- **Conditional Branching**: `If selectedService === "Enterprise" -> Show Budget Field`.
- **Integrations**: Direct webhook dispatch to Zapier, Make, Telegram, Slack, or Supabase.

---

## 4. Suggested Implementation Roadmap

| Priority | Feature | Estimated Effort | Impact |
|---|---|---|---|
| 🟢 **High** | 1. Visual Formula & Computed Expressions | 3–4 Days | Unlocks dynamic CMS calculations without manual code |
| 🟢 **High** | 2. Polymorphic Radix UI Primitives | 4–5 Days | Accessible Accordions, Tabs, Modals out of the box |
| 🟡 **Medium** | 3. Automated a11y & SEO Linter | 2–3 Days | High-ranking SEO and accessibility guarantee |
| 🟡 **Medium** | 4. Side-by-Side i18n Translation Matrix | 2–3 Days | 10x faster multi-language website creation |
| 🔵 **Advanced** | 5. 2D Visual CSS Grid Matrix Builder | 1–2 Weeks | Bento-grid and complex layouts designed visually |

---

## 5. Architectural Verification Guidelines

When implementing any of the above modules in Revyme:
1. **Never touch Canvas DOM directly**: Always route through `modifyProjectFile()` and AST generators.
2. **Preserve Next.js Invariant**: All emitted code must be standard Next.js App Router compatible (`app/*.tsx`).
3. **Oracle Compliance**: Add dedicated rule checks in `src/code/oracle/` to validate roundtrip serialization.
