# Dynamic Page SEO Expressions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add dynamic expression (formula) authoring with an `[fx]` button and `ExpressionBoundPill` to all Page Settings SEO fields (Title, Description, Canonical URL, OG Title, OG Description, OG Image, Twitter Title, Twitter Description, Twitter Image), enabling dynamic per-item SEO generation for collection detail pages.

**Architecture:** Extend `cms-seo.ts` to generate and parse a `seoExpressions` configuration block in Next.js Server Component page wrappers (`page.tsx`), evaluate expressions dynamically with safe sandboxing in `generateMetadata({ params })`, enhance `ExpressionEditorPopup` with target file path awareness, and update `PagesSeoSection.tsx` with `[fx]` buttons and `ExpressionBoundPill` across all 9 SEO input fields.

**Tech Stack:** Next.js 15 Server Components, React 18/19, TypeScript, Jotai, Babel AST / `parseLocalObjectFromCode`, Vitest.

**Spec:** Documented in this plan and aligned with the styles panel pattern (`ImageTool.tsx`, `TextStyleTool/atoms/ContentControl.tsx`, `ExpressionEditorPopup.tsx`, `ExpressionBoundPill.tsx`).

## Global Constraints

- Never mutate ProjectFS directly; always use `modifyProjectFile(path, code => next)`.
- Server wrappers (`app/**/page.tsx`) must never export both `metadata` and `generateMetadata` (Next.js rejects both in the same file).
- The `[fx]` button styling and `ExpressionBoundPill` must match the visual design system in `ImageTool.tsx` and `ExpressionBoundPill.tsx`.
- Dynamic SEO expressions in `generateMetadata` must degrade gracefully to defaults if a formula fails or throws at runtime.
- Maintain test coverage: Vitest tests must pass without regressions (`npx vitest run src/code/project/cms-seo.test.ts`).

---

### Task 1: Extend `cms-seo.ts` with `CmsSeoExpressions` Parsing, Emission, and Evaluation

**Files:**
- Modify: `src/code/project/cms-seo.ts`
- Test: `src/code/project/cms-seo.test.ts`

**Interfaces:**
- Produces:
  - `type CmsSeoExpressions = Partial<Record<string, string>>`
  - `parseCmsSeoExpressions(serverCode: string): CmsSeoExpressions`
  - Updated `BuildDetailWrapperInput` with `expressions?: CmsSeoExpressions`
  - Updated `buildCmsDetailServerWrapper(input: BuildDetailWrapperInput): string`

- [ ] **Step 1: Write failing tests in `cms-seo.test.ts`**

Add unit tests to `src/code/project/cms-seo.test.ts` verifying that `seoExpressions` are generated, parsed, and evaluated by `runGenerateMetadata`:

```ts
import { parseCmsSeoExpressions } from './cms-seo';

describe('buildCmsDetailServerWrapper with seoExpressions', () => {
  const src = buildCmsDetailServerWrapper({
    collection: 'articles',
    defaults: { title: 'Default Title', canonical: 'https://example.com/blog' },
    bindings: { description: 'excerpt' },
    expressions: {
      title: '`${item.name} | Revyme Store`',
      canonical: '`https://example.com/blog/${item._slug}`',
      ogImage: 'item.cover',
    },
  });

  it('parses seoExpressions back from emitted code', () => {
    const parsed = parseCmsSeoExpressions(src);
    expect(parsed.title).toBe('`${item.name} | Revyme Store`');
    expect(parsed.canonical).toBe('`https://example.com/blog/${item._slug}`');
    expect(parsed.ogImage).toBe('item.cover');
  });

  it('evaluates expression formulas in generateMetadata at runtime', async () => {
    const meta = await runGenerateMetadata(src, ITEMS, 'first');
    expect(meta.title).toBe('First Post | Revyme Store');
    expect(meta.description).toBe('About the first');
    expect(meta.alternates.canonical).toBe('https://example.com/blog/first');
    expect(meta.openGraph.images).toEqual(['https://cdn/a.png']);
  });

  it('expression takes priority over plain field binding', async () => {
    const srcWithBoth = buildCmsDetailServerWrapper({
      collection: 'articles',
      bindings: { title: 'name' },
      expressions: { title: '`Custom: ${item.name}`' },
    });
    const meta = await runGenerateMetadata(srcWithBoth, ITEMS, 'first');
    expect(meta.title).toBe('Custom: First Post');
  });

  it('safely falls back to default if expression throws', async () => {
    const srcBadExpr = buildCmsDetailServerWrapper({
      collection: 'articles',
      defaults: { title: 'Fallback Title' },
      expressions: { title: 'item.nonExistent.deepProp' },
    });
    const meta = await runGenerateMetadata(srcBadExpr, ITEMS, 'first');
    expect(meta.title).toBe('Fallback Title');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/code/project/cms-seo.test.ts`
Expected: FAIL (`parseCmsSeoExpressions is not a function`, etc.)

- [ ] **Step 3: Implement `CmsSeoExpressions` and evaluation logic in `src/code/project/cms-seo.ts`**

1. Define type and parser:
```ts
export type CmsSeoExpressions = Partial<Record<string, string>>;

export function parseCmsSeoExpressions(serverCode: string): CmsSeoExpressions {
  const raw = parseLocalObjectFromCode(serverCode, 'seoExpressions');
  const out: CmsSeoExpressions = {};
  const validKeys = [
    'title', 'description', 'canonical',
    'ogTitle', 'ogDescription', 'ogImage',
    'twitterTitle', 'twitterDescription', 'twitterImage',
  ];
  for (const key of validKeys) {
    const v = raw[key];
    if (typeof v === 'string' && v) out[key] = v;
  }
  return out;
}
```

2. Update `BuildDetailWrapperInput`:
```ts
export interface BuildDetailWrapperInput {
  collection: string;
  defaults?: Record<string, unknown>;
  bindings?: CmsSeoBindings;
  expressions?: CmsSeoExpressions;
  includeStaticParams?: boolean;
  apiConfig?: ApiCollectionConfig | null;
}
```

3. In `buildCmsDetailServerWrapper`:
- Extract `expressions = {}` from input.
- Create `expressionsLiteral`:
```ts
  const allExpressionSlots = [
    'title', 'description', 'canonical',
    'ogTitle', 'ogDescription', 'ogImage',
    'twitterTitle', 'twitterDescription', 'twitterImage',
  ];
  const expressionsLiteral = inlineObject(allExpressionSlots.map((key) => [key, expressions[key]]));
```
- Emit `const seoExpressions = ${expressionsLiteral};` in both API collection and Local JSON templates.
- In both `generateMetadata` templates, add `evalExpr`:
```ts
  const evalExpr = (expr: string) => {
    try {
      const unwrapped = expr.startsWith('{') && expr.endsWith('}') ? expr.slice(1, -1).trim() : expr;
      const fn = new Function('item', 'params', `return (${unwrapped});`);
      const val = fn(item, { slug, ...params });
      if (val === undefined || val === null) return undefined;
      if (typeof val === 'object') {
        return val.url || (val.id ? `/assets/${val.id}` : undefined) || val.filename_disk || undefined;
      }
      return String(val);
    } catch {
      return undefined;
    }
  };

  const bound = (slot: string) => {
    const expr = (seoExpressions as Record<string, string>)[slot];
    if (expr) {
      const v = evalExpr(expr);
      if (v !== undefined && v !== '') return v;
    }
    const field = (seoBindings as Record<string, string>)[slot];
    if (!field || !item) return undefined;
    const value = field.includes('.')
      ? field.split('.').reduce((acc: any, part: string) => acc?.[part], item)
      : item[field];
    if (typeof value === 'object' && value !== null) {
      return value.url || (value.id ? `/assets/${value.id}` : undefined) || value.filename_disk || undefined;
    }
    return typeof value === 'string' && value ? value : undefined;
  };
```
- In both templates, update `alternates`:
```ts
  const canonical = pick('canonical');
  // ...
  alternates: { canonical: canonical || (seoDefaults as any).canonical || undefined },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/code/project/cms-seo.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/code/project/cms-seo.ts src/code/project/cms-seo.test.ts
git commit -m "feat(cms-seo): add CmsSeoExpressions parsing, emission, and runtime evaluation"
```

---

### Task 2: Enhance `ExpressionEditorPopup` with `filePath` Context Prop

**Files:**
- Modify: `src/editor/ui/ExpressionEditorPopup.tsx`

**Interfaces:**
- Consumes: `ExpressionEditorPopupProps`
- Produces: Enhanced `ExpressionEditorPopupProps` accepting optional `filePath?: string`

- [ ] **Step 1: Check existing `ExpressionEditorPopup.tsx` routeParams logic**

Observe lines 46-52 in `src/editor/ui/ExpressionEditorPopup.tsx` where route params are derived from `activeFilePath`. When invoked from `PagesSeoSection`, the selected page may differ from canvas active page.

- [ ] **Step 2: Update `ExpressionEditorPopupProps` and route parameter derivation**

In `src/editor/ui/ExpressionEditorPopup.tsx`:
1. Add `filePath?: string;` to `ExpressionEditorPopupProps`.
2. Update `routeParams`:
```tsx
export default function ExpressionEditorPopup({
  isOpen,
  onClose,
  onApply,
  initialExpression = '',
  targetProperty = 'text',
  collectionSlug,
  itemVar = 'item',
  fields = [],
  filePath,
}: ExpressionEditorPopupProps) {
  // ...
  const activeFilePath = useAtomValue(activeFilePathAtom);
  const effectiveFilePath = filePath || activeFilePath;

  const routeParams = useMemo(() => {
    if (!effectiveFilePath) return [];
    const matches = Array.from(effectiveFilePath.matchAll(/\[([^/\]]+)\]/g));
    const params = matches.map(m => m[1]).filter(p => !p.startsWith('...'));
    return Array.from(new Set(params));
  }, [effectiveFilePath]);
```

- [ ] **Step 3: Run existing tests to ensure no regression**

Run: `npx vitest run src/editor/tools/ImageTool.cms-bind.test.tsx`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/editor/ui/ExpressionEditorPopup.tsx
git commit -m "feat(ui): support explicit filePath prop in ExpressionEditorPopup"
```

---

### Task 3: Integrate `[fx]` Button, `ExpressionBoundPill`, and Expression State in `PagesSeoSection.tsx`

**Files:**
- Modify: `src/cloud/settings/PagesSeoSection.tsx`

**Interfaces:**
- Consumes:
  - `parseCmsSeoExpressions`, `type CmsSeoExpressions` from `@/code/project/cms-seo`
  - `ExpressionBoundPill` from `@/editor/controls/ExpressionBoundPill`
  - `ExpressionEditorPopup` from `@/editor/ui/ExpressionEditorPopup`
- Produces: Complete dynamic expression editing UI for all 9 SEO settings fields

- [ ] **Step 1: Add imports and expression state in `PageSeoForm`**

In `src/cloud/settings/PagesSeoSection.tsx`:
1. Add imports:
```tsx
import ExpressionBoundPill from '@/editor/controls/ExpressionBoundPill';
import ExpressionEditorPopup from '@/editor/ui/ExpressionEditorPopup';
import {
  type CmsSeoSlot,
  type CmsSeoBindings,
  type CmsSeoExpressions,
  bindableFields,
  buildCmsDetailServerWrapper,
  hasCmsSeo,
  parseCmsSeoBindings,
  parseCmsSeoDefaults,
  parseCmsSeoExpressions,
} from '@/code/project/cms-seo';
```

2. Add state to `PageSeoForm`:
```tsx
  const initialExpressions = useMemo<CmsSeoExpressions>(() => {
    void version;
    if (!cms) return {};
    return parseCmsSeoExpressions(projectFS.readFile(metadataPath) ?? '');
  }, [cms, metadataPath, version]);

  const [expressions, setExpressions] = useState<CmsSeoExpressions>(initialExpressions);
  useEffect(() => { setExpressions(initialExpressions); }, [initialExpressions]);

  const [activeExprSlot, setActiveExprSlot] = useState<{
    slot: string;
    targetProperty: 'text' | 'src' | 'href';
    label: string;
  } | null>(null);
```

3. Update `dirty` check:
```tsx
  const dirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(initial)
      || JSON.stringify(bindings) !== JSON.stringify(initialBindings)
      || JSON.stringify(expressions) !== JSON.stringify(initialExpressions),
    [form, initial, bindings, initialBindings, expressions, initialExpressions],
  );
```

4. Update `writeMeta`:
```tsx
  const writeMeta = useCallback((next: PageMeta, nextBindings: CmsSeoBindings, nextExpressions: CmsSeoExpressions) => {
    if (cms) {
      modifyProjectFile(metadataPath, () =>
        buildCmsDetailServerWrapper({
          collection: cms.collection,
          defaults: next as unknown as Record<string, unknown>,
          bindings: nextBindings,
          expressions: nextExpressions,
        }));
      return;
    }
    modifyProjectFile(metadataPath, (code) => updateMetadataInCode(code, formToMeta(next)));
  }, [cms, metadataPath]);
```

5. Add `updateExpression`:
```tsx
  const updateExpression = useCallback((slot: string, expr: string) => {
    const next = { ...expressions };
    if (expr) {
      next[slot] = expr;
    } else {
      delete next[slot];
    }
    setExpressions(next);
    trace.action('pages-seo:set-expression', { slot, expr, collection: cms?.collection });
    writeMeta(form, bindings, next);
  }, [expressions, form, bindings, cms, writeMeta]);
```

- [ ] **Step 2: Implement `renderFieldWithFx` helper in `PageSeoForm`**

Create an inline field renderer in `PageSeoForm`:
```tsx
  const renderFieldWithFx = (
    slot: string,
    targetProperty: 'text' | 'src' | 'href',
    label: string,
    children: React.ReactNode,
  ) => {
    const expr = expressions[slot];
    if (expr) {
      return (
        <ExpressionBoundPill
          expression={expr}
          onEdit={() => setActiveExprSlot({ slot, targetProperty, label })}
          onClear={() => updateExpression(slot, '')}
        />
      );
    }

    return (
      <div className="flex items-center gap-1.5 w-full">
        <div className="flex-1 min-w-0">{children}</div>
        <button
          type="button"
          onClick={() => {
            setActiveExprSlot({ slot, targetProperty, label });
          }}
          title="Dynamic Expression (Formula)"
          className="shrink-0 h-[32px] px-2 flex items-center justify-center rounded bg-[var(--control-bg)] hover:bg-purple-600/20 text-[var(--text-secondary)] hover:text-purple-300 border border-[var(--control-border)] hover:border-purple-500/50 cursor-pointer transition-colors text-xs font-mono font-bold"
        >
          fx
        </button>
      </div>
    );
  };
```

- [ ] **Step 3: Wrap all 9 SEO rows with `renderFieldWithFx`**

1. **Title**:
```tsx
<SettingsRow label="Title" htmlFor="seo-title">
  {renderFieldWithFx('title', 'text', 'Title', (
    <>
      {bindFor('title')}
      {showStatic('title') && (
        <input
          id="seo-title"
          type="text"
          value={form.title}
          onChange={(e) => update('title', e.target.value)}
          className={ROW_INPUT_CLS}
          placeholder="Page title, falls back to the site title"
        />
      )}
    </>
  ))}
</SettingsRow>
```

2. **Description**:
Apply same pattern with `targetProperty: 'text'`.

3. **Canonical URL**:
Apply same pattern with `targetProperty: 'href'`.

4. **OG Title & OG Description**:
Apply same pattern with `targetProperty: 'text'`.

5. **OG Image**:
Apply same pattern with `targetProperty: 'src'` wrapping `ImagePickerField`.

6. **Twitter Title & Twitter Description**:
Apply same pattern with `targetProperty: 'text'`.

7. **Twitter Image**:
Apply same pattern with `targetProperty: 'src'` wrapping `ImagePickerField`.

- [ ] **Step 4: Mount `ExpressionEditorPopup` modal**

At the bottom of `PageSeoForm`:
```tsx
  {activeExprSlot && (
    <ExpressionEditorPopup
      isOpen={true}
      onClose={() => setActiveExprSlot(null)}
      onApply={(expr) => {
        updateExpression(activeExprSlot.slot, expr);
        setActiveExprSlot(null);
      }}
      initialExpression={
        expressions[activeExprSlot.slot] ||
        (bindings[activeExprSlot.slot as CmsSeoSlot]
          ? `item.${bindings[activeExprSlot.slot as CmsSeoSlot]}`
          : (form as any)[activeExprSlot.slot] || '')
      }
      targetProperty={activeExprSlot.targetProperty}
      collectionSlug={cms?.collection}
      itemVar="item"
      fields={cms?.schema?.fields ?? []}
      filePath={page.filePath}
    />
  )}
```

- [ ] **Step 5: Run TypeScript check and verify compilation**

Run: `npx tsc --noEmit`
Expected: No type errors in `PagesSeoSection.tsx`.

- [ ] **Step 6: Commit**

```bash
git add src/cloud/settings/PagesSeoSection.tsx
git commit -m "feat(pages-seo): add fx button and ExpressionBoundPill to all SEO fields"
```

---

### Task 4: Verification, Full Test Suite & E2E Validation

**Files:**
- Modify: `src/code/project/cms-seo.test.ts`

- [ ] **Step 1: Run complete vitest test suite across CMS and SEO modules**

Run: `npx vitest run src/code/project/cms-seo.test.ts src/code/project/cms-seo.api.test.ts src/editor/tools/ImageTool.cms-bind.test.tsx`
Expected: All tests PASS.

- [ ] **Step 2: Run global TypeScript check**

Run: `npx tsc --noEmit`
Expected: Exits with code 0.

- [ ] **Step 3: Verification commit**

```bash
git commit --allow-empty -m "chore(cms-seo): verify dynamic SEO expression generation and editor integration"
```
