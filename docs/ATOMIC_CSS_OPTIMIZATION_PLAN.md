# Atomic CSS Optimization Engine — Reviewed Implementation Plan

> **Reviewed:** 2026-11-11 against this checkout.
>
> **Status:** Corrected design; implementation must pass the gates below. Not ready for unconditional production enablement.
>
> **Initial scope:** Opt-in standalone Next.js source ZIP export.
>
> **Source of truth:** ProjectFS is unchanged; compilation operates on a copied export snapshot.

## 1. Objective and corrections

Deduplicate eligible static inline declarations into generated CSS without changing supported exported-site behavior. Correctness takes priority over extraction coverage. Unsupported input stays inline with a diagnostic. This document retains English to match the original implementation plan.

| Original assumption | Required correction |
|---|---|
| Every literal declaration can move to a class | Moving inline styles changes cascade priority, animation behavior and observable props/attributes. Require a tested safety contract. |
| Keep only dynamic properties inline | Partial extraction can reverse shorthand/longhand precedence and runtime updates. V1 skips the entire object if any entry is unsupported. |
| Sorting atoms/media queries solves precedence | Class token order does not control the cascade. Conflicting declarations can require opposite orders on different elements. V1 rejects overlap and leaves media rules untouched. |
| Six-character 32-bit hash identifies a rule | Detect hash and authored-class collisions; resolve deterministically. |
| Stringify literal values | React adds units selectively. Numeric strings, zero, prefixes, custom properties and SVG need distinct handling. |
| Always import from `app/layout.tsx` | Localization moves layouts; `.jsx` and multiple-root structures need explicit policies. |
| `source-export.ts` covers publishing | Verified integration covers browser source ZIP export. Cloud export and publish use separate backend endpoints. |
| Default on; promise 30–40% savings | Start disabled. Repetition already compresses well; measure total compressed delivery, not just JSX source bytes. |

This is a compile-time export feature. No new `@revyme/runtime` API is required unless a later design introduces browser behavior. Do not persist optimized classes in ProjectFS or change canvas parsing/rendering for this feature.

## 2. Verified repository integration map

Paths are repository-relative; symbols are navigation anchors because line numbers drift.

| Area | Inspected code and implication |
|---|---|
| Browser export | `src/editor/header/export-project.ts`: `exportSourceInBrowser` flushes mutations, snapshots MAIN with shared files, then calls `buildSourceExport`. Preserve that boundary. |
| Coordinator | `src/code/project/source-export.ts`: `buildSourceExport` calls preparation, URL localization, filtering and scaffold assembly. Run atomic compilation on the final copied export map. |
| Preparation | `prepareSiteFiles` repairs controllers/overlays/CMS, injects image attributes, transforms fonts, generates SEO files, then calls `prepareLocalizedSiteFiles`. Do not extract styles before these passes. |
| Image inference | `injectResponsiveImageSrcSets` reads inline `width`/`maxWidth` to infer `sizes`; early extraction would change its output. |
| Fonts | `src/code/generation/next-font-gen.ts` rewrites fonts/layout. Preserve the structures it consumes by running atomic compilation afterward. |
| Localization | `src/code/project/localized-site-export.ts` moves root layout under `app/[lang]`, keeps `app/globals.css` at root, and can move other app files. Emit atomic CSS after localization and resolve imports from final paths. |
| Responsive styles | `src/code/generation/generator-styles.ts` emits `[data-id="..."]` rules with `!important`, bounded media bands, locale/variant/pseudo styles. Preserve existing CSS text and order. |
| Motion | `src/code/generation/generator-motion-props.ts` and `transform-template.test.ts` maintain composition with `style.transform`. Literal Motion styles are not automatically ordinary CSS. |
| Runtime | Installed `@revyme/runtime/src/withResponsiveProps.tsx` inspects/merges `style`; `split-text.tsx` includes child `props.style` in its rich-text signature. These are dependency sources, not files to edit here. Exclude unverified runtime-owned subtrees. |
| Editor parser | `src/code/parsing/parser.ts` reads inline styles for editing. Do not feed compiled export output back into persisted editor source. |
| Babel helpers | Reuse `parseJSX`/`traverse` from `src/code/parsing/ast-utils.ts` and `generate` from `src/code/generation/generator-utils.ts` for module interop. Handle `parseJSX` returning `null`. |
| CSS helpers | `src/shared/css-utils.ts` provides `toKebab`, `coerceCssNumberToPx`, `resolveSpacingSides`, `SHORTHAND_LONGHANDS`, `mergeStyleLayers`. Reuse only where semantics match; see section 4. |
| Cloud boundary | Cloud `exportProject` fetches `/api/export/${format}/${id}`; `RightHeader.tsx` publishes through `/api/websites/${id}/publish`. The backend service cited in the source-export header is absent at `backend/src/services/export-project.ts` here. Inspect its actual implementation before claiming cloud support. |

No raw `data/builds/` reads are needed. Use committed synthetic fixtures rather than private projects, build caches or live network requests.

## 3. Safety contract

### 3.1 Moving inline declarations is not generally equivalent

Normal inline declarations outrank normal author stylesheet rules; one generated class does not. Appending CSS last, repeating class selectors or adding a layer does not reproduce arbitrary inline priority. Blanket `!important` is forbidden: it changes interaction with responsive/hover overrides, animations and runtime writes. See the [CSS Cascade specification](https://www.w3.org/TR/css-cascade-5/).

These examples must be rejected or explicitly proven safe:

```tsx
// A normal #hero rule loses to inline color but wins over an atomic class.
<div id="hero" style={{ color: 'red' }} />

// Different elements can require opposite shorthand/longhand order.
<div style={{ padding: '24px', paddingTop: '8px' }} />
<div style={{ paddingTop: '8px', padding: '24px' }} />

// Extracting only paddingTop reverses precedence against retained inline padding.
<div style={{ padding: dynamicPadding, paddingTop: '8px' }} />

// Spread order changes effective DOM props.
<div style={{ color: 'red' }} {...props} />

// Component props and Motion keys have contracts beyond ordinary CSS.
<Card style={{ width: 200 }} />
<motion.div style={{ x: 20, rotate: 10, opacity: 1 }} />
```

### 3.2 Project preflight is a prerequisite

The opt-in flag requests optimization; it does not waive correctness. V1 supports a closed, inspected styling environment:

1. Inventory exported CSS files/imports, static JSX style blocks, CSS-in-JS, runtime controllers and imported components. Define the exact accepted CSS/selector grammar in tests. Use a CSS AST parser, not regex or delimiter splitting. If no direct dependency is suitable, explicitly choose a browser-compatible parser dependency; do not rely on a transitive installation.
2. Extract a candidate only when competing rules for the same property family are proven absent or lower priority in the supported environment. Account for specificity, layers, scope, source order, `all`, logical properties and variable dependencies. Unknown selector matches/imports/at-rules/conflicts cause a skip. A conservative V1 may reject any candidate touched by competing CSS.
3. Existing important responsive/pseudo rules may remain unchanged only when their original precedence is retained. Their presence is not evidence that every other rule is safe. Do not sort or extract media, locale, variant, pseudo-element or keyframe blocks in V1.
4. Adding `class` or removing `style` can change selector matching (`[class]`, `[style]`, `:not(...)`, relational selectors). Reject affected candidates, or the bundle if impact cannot be bounded. Class-based values also differ from inline values relative to CSS animations; reject affected animation/property combinations unless tested equivalent.
5. Code can observe `props.style`, `element.style`, classes, attributes and child identity. Exclude affected subtrees/files. Unknown global DOM queries, scripts or runtime-injected CSS require bundle fallback. A text search for `ref`/`style` alone is not proof of safety.
6. External stylesheets and opaque component/package/remote-module effects require audited contracts or bundle fallback. Checking only an opening tag cannot prove ancestor/descendant runtime behavior safe.

**Gate:** implement and test this accepted subset before enabling extraction. If broad coverage requires weaker assumptions, review that as a separate design decision. Zero extraction with diagnostics is valid for unsupported projects; silently assuming all builder output is controlled CSS is not.

### 3.3 Conservative V1 JSX eligibility

After project preflight, require all conditions below:

- Known built-in HTML tag from an explicit allowlist. Exclude custom elements (including `is`), SVG/MathML, capitalized tags and member expressions such as `motion.div`. Exclude children of components that inspect/clone children unless audited.
- Exactly one `style` attribute containing a direct `ObjectExpression`; no JSX spreads anywhere on this opening tag and no duplicate attributes.
- No object spread, computed key (even a computed literal), getter/method, duplicate normalized key, nested object or `__proto__` special case. Any unsupported entry skips the whole object.
- All values are supported static strings or finite numeric literals, optionally tested unary minus. Skip identifiers, calls, ternaries, templates and TS wrappers in V1. Do not execute or constant-fold user expressions. Mixed static/dynamic objects remain unchanged.
- Every property is in a serialization/conflict allowlist. Do not accept Motion-only keys merely because they are identifiers. Custom properties remain inline in V1 by skipping their containing object.
- No shorthand/longhand or logical/physical overlap within the object. Start with explicitly classified disjoint families; unknown relationships reject the object. `SHORTHAND_LONGHANDS` is useful but incomplete (border/background/font/all and logical mappings need broader coverage).
- `className` is absent or literal (string attribute or expression containing a string literal). Skip dynamic/boolean/duplicate forms in V1. Do not introduce `clsx`, stringify false/undefined, or alter evaluation order.
- No unverified ref, override, animation, responsive-prop or style-observing runtime ownership affecting the candidate. Preserve `data-id`, other `data-*`, keys, event props and all unrelated JSX.

Remove `style` only after complete eligibility succeeds and all effective declarations are represented. Do not opportunistically clean unsupported empty objects. Mixed extraction requires later conflict/evaluation-order analysis and mounted-update tests; it is outside V1.

## 4. React-compatible CSS serialization

Implement a dedicated export serializer before AST extraction. The [React style API](https://react.dev/reference/react-dom/components/common#applying-css-styles) and versioned [unitless table](https://github.com/facebook/react/blob/v19.2.0/packages/react-dom-bindings/src/shared/isUnitlessNumber.js)/[server serializer](https://github.com/facebook/react/blob/v19.2.0/packages/react-dom-bindings/src/server/ReactFizzConfigDOM.js) are references; test against installed and exported supported versions.

| Input | Required policy |
|---|---|
| `width: 24` | `width:24px` |
| `width: 0` | Unitless zero with equivalent browser semantics |
| `opacity: 0.5`, `lineHeight: 1.4`, `zIndex: 10` | Unitless according to supported React behavior |
| `width: '24'` | Preserve string semantics; never silently append `px`. Skip invalid/unsupported CSS rather than repairing it. |
| Negative numeric AST | Accept only tested finite unary-minus literal forms, including negative-zero coverage |
| Null/boolean/empty/whitespace-only/invalid values | Skip containing object in V1; no empty atoms or conversion of absence to a CSS value |
| `WebkitLineClamp`, `msOverflowStyle` | Correct prefixes if allowlisted (`-webkit-...`, `-ms-...`); generic uppercase splitting misses leading `-ms-` |
| Custom properties, SVG, Motion transform conventions | Unsupported in V1; preserve original object |

`coerceCssNumberToPx` is a canvas string helper, not an export serializer: it coerces numeric strings, includes editor conventions such as rotate→degrees, and has a smaller unitless set than React. Do not reuse unchanged. `toKebab` needs tested vendor-prefix handling.

Use ReactDOM SSR as a test oracle, without importing private React internals into production. Installed ReactDOM inspected here is `19.2.6`; verify behavior against the React range emitted by `buildPackageJson` and supported project-owned manifests. Disable optimization for unverified versions rather than promising arbitrary version compatibility.

Parse values as one valid declaration, forbidding extra declarations/rules or injected `!important`. Preserve accepted escapes, quoted font families, `calc`, `var`, data URLs and meaningful whitespace. No global whitespace replacement or splitting by `;` for minification. Prefer compact safe emission and the site's normal production CSS toolchain over a custom minifier.

Moving `url(...)` changes the resolution base. V1 rejects document-relative and fragment-only URLs, including `url(images/a.png)` and `url(#mask)`. Accept only explicitly tested root-relative/absolute/data URLs. Future rebasing requires a separate asset-resolution policy and tests.

## 5. Modules, APIs and transactions

```text
src/code/generation/atomic-css/
  eligibility.ts        # project/JSX analysis; stable skip reasons
  serialize-style.ts    # typed React literals -> validated CSS
  hash.ts               # deterministic identity/collision handling
  css-collector.ts      # allocation, deduplication, stable CSS emission
  ast-transform.ts      # apply approved edits only
  atomic-compiler.ts    # analyze -> allocate -> emit -> validate -> commit
  *.test.ts             # or consistent __tests__/ organization
src/code/project/__tests__/source-export-atomic-css.test.ts
```

Suggested new public interface:

```ts
interface AtomicCssOptions { enabled: boolean }
interface AtomicCssDiagnostic {
  path?: string;
  nodeId?: string;
  reason: string; // stable code; do not log source/env contents
}
interface AtomicCssResult {
  status: 'disabled' | 'optimized' | 'skipped' | 'invalid-input';
  files: Record<string, string>;
  diagnostics: AtomicCssDiagnostic[];
  stats: {
    transformedElements: number;
    extractedDeclarations: number;
    uniqueRules: number;
    skippedElements: number;
  };
}
function compileProjectAtomicCss(
  files: Record<string, string>, options: AtomicCssOptions,
): AtomicCssResult;
```

Distinguish ineligible nodes, incompatible bundles and unexpected compiler errors. `skipped` means a safe unoptimized snapshot can still be exported. `invalid-input` means an already-optimized input has lost its validity: the caller must stop export with a rebuild-from-authored-source error, rather than return broken artifacts as successful output. Add bounded `trace.action` summaries and `trace.error` at orchestration boundaries using `src/shared/debug-trace.ts`; no logging of every CSS literal or side effects in hashing.

### 5.1 Identity, collisions and deterministic output

- Identity is a structured versioned tuple, e.g. `JSON.stringify(['rv-atomic-v1', property, serializedValue])`. Avoid ambiguous delimiter concatenation. V1 has no media identity because media rules are not extracted.
- Use a reserved namespace such as `rv-a-`; no fixed six-character requirement. A noncryptographic browser-safe hash is acceptable only with tuple→class and class→tuple collision detection.
- Analyze all candidates, sort complete tuples with locale-independent comparison, then allocate names. Resolve collisions with deterministic suffixes/extension. Test with an injected colliding hash. Input traversal order must not decide which tuple keeps a name.
- Inventory authored tokens, CSS selectors and other reserved-name uses. Reject opaque/dynamic namespace collisions unless an audited contract excludes them. Never overwrite authored classes.
- Sort input paths and emitted independent rules. Sorting is safe because conflicting declarations were rejected; it does not solve shorthand precedence. Preserve existing class order and append new tokens.
- Register only committed accepted edits. No atoms from skipped/failed files or metadata. Fresh collector per compilation; concurrent exports cannot share mutable state.

### 5.2 AST integrity and atomic commit

Use repository Babel wrappers. Preserve directives (`use client`/`use server`), imports, exports, data IDs and comments used by other passes. Unchanged files return their exact original strings. Reparse every changed module after emission.

Analyze immutable input first; emit into a new file map second. Commit rewritten modules, CSS, imports and ownership metadata together after validation. On unexpected parse/generation/integration failure discard the whole atomic transaction, return the pre-atomic snapshot and report diagnostics. Expected node skips can coexist with successful edits only when project preflight still proves their interactions safe.

Do not modify runtime source strings, `.ts` files, metadata, JSON, dependency files or downloaded marketplace implementations in V1. Their effects still matter to preflight. No regex rewriting of strings containing JSX and no evaluation of user expressions.

## 6. Exact export integration

### 6.1 Order and feature flag

Add `atomicCss?: boolean` to `SourceExportOptions`, default **false**. Initially leave `PrepareSiteFilesOptions`/`prepareSiteFiles` unchanged because they are independently called preparation APIs.

```text
caller: flush mutations -> authored MAIN snapshot
  -> prepareSiteFiles(input, { ssg })
     (images, fonts, CMS, SEO, localization, existing repairs)
  -> localizeUrlImports
  -> existing metadata/secret/cache filtering + scaffold + .env.example
  -> compileProjectAtomicCss(finalFiles, { enabled: opts.atomicCss === true })
  -> return transformed files or diagnosed pre-atomic fallback
  -> existing asset collection and ZIP download
```

Insert compilation immediately before `buildSourceExport` returns its assembled files. Preserve `downloaded`/`failed` reporting and filtering behavior. Failed or opaque remote imports can make optimization unsupported; do not assume they are safe because they are excluded from rewriting.

Propagate opt-in explicitly from the intended caller/test harness. Adding an option type alone does not activate it in the UI. V1 needs no new UI; any later setting must retain rollback and expose unsupported optimization outcomes.

### 6.2 Asset paths and layouts

1. Reserve an owned CSS path such as `app/revyme-atomic.css`. Check it and the planned manifest path before any edits. Never overwrite an authored `app/atomic.css` or another conflicting file.
2. Resolve root layout from the final route tree. Cover tested root `.tsx`/`.jsx` and localized `app/[lang]/layout.tsx`. Do not select every nested layout. In V1, missing/ambiguous layouts, `src/app` and multiple route-group roots trigger unchanged fallback unless explicitly implemented/tested.
3. Add exactly one side-effect import with a computed relative path: `./revyme-atomic.css` from root layout, `../revyme-atomic.css` from localized layout. Parse/check imports and preserve directives. No Windows filesystem paths or assumed alias support.
4. Fix/document import ordering without moving existing imports. Validate actual Next production CSS loading and client navigation; source import order alone does not prove runtime order.
5. For fresh unoptimized input with zero transformed nodes, emit no CSS, imports or manifest. Existing valid owned output follows section 6.3 instead. Every generated class in successful output must have exactly one reachable matching rule.

### 6.3 Ownership and idempotence

Define a versioned manifest beside the asset, recording owned paths, rule identities, compiler options and fingerprints of all analyzed source/CSS/package inputs and generated artifacts (excluding the manifest's own fingerprint). Changes to untransformed CSS or runtime dependencies can invalidate earlier safety analysis too. Recompiling valid unchanged owned output must return it unchanged, keeping its CSS even though extracted inline declarations are gone. No duplicated classes/imports or repeated suffix allocation.

For edited owned output, missing CSS or unknown manifest versions, return `invalid-input` with rebuild diagnostics and do not partially reoptimize. The export caller must reject this result; neither unchanged fallback nor a successful ZIP is safe for corrupted optimized input. Rebuild from the authored snapshot; never reconstruct inline styles from hashes. Unowned path collisions on ordinary authored input trigger unchanged fallback.

Current builder parsing relies on inline styles, so lossless re-import of optimized ZIPs into the visual builder is outside scope. Do not send artifacts through ProjectFS/oracle ingestion or advertise builder round-trip compatibility. Explain this scope when exposing the feature.

### 6.4 Cloud/publish follow-up

Standalone ZIP, cloud source export and deployed sites are separate targets. Before extending scope, inspect actual backend preparation and snapshot/cache lifecycle. Share the pure compiler with explicit flags and equivalent asset/rollback tests. The compiler must work in browser and backend contexts without Node-only filesystem/crypto imports or browser-only runtime APIs. No build-cache editing.

## 7. Implementation phases and gates

### A. Freeze the supported subset

- [ ] Build committed fixtures for static HTML, responsive bands, locales, font loaders, CMS, Motion/variants, overlays and imported components.
- [ ] Define accepted CSS grammar, property allowlist/conflicts, package/runtime contracts and layout shapes in tests. Resolve parser dependency and any borrowed-code licensing explicitly.
- [ ] Add the adversarial cases in sections 3–4 and document intentional skips. Do not enable extraction while project preflight is unspecified.

### B. Serializer, hash and collector

- [ ] Implement/test every supported serialization case, invalid-input rejection, prefixes and URL policy.
- [ ] Implement/test tuple identity, deterministic collision handling, authored-name checks, deduplication and shuffled file-order invariance.
- [ ] Parse emitted CSS to verify only intended declarations/rules exist. Defer aggressive minification to production tooling.

### C. Eligibility and AST transformation

- [ ] Implement/test project preflight and JSX checks with stable diagnostics.
- [ ] Apply approved static HTML edits only; verify unchanged-source byte equality.
- [ ] Test parse/generation failure rollback, directives/import preservation and output reparsing.
- [ ] Verify browser/Vite compatibility, no Node built-ins and no new runtime dependencies in exported pages. Every new module needs tests.

### D. Opt-in bundle/export integration

- [ ] Add the disabled flag and final-stage compiler call.
- [ ] Resolve layouts/imports/owned assets and implement manifest/idempotence.
- [ ] Test normal/localized output, `.jsx`, `ssg: true`/`false`, immutable input, URL-localization policy and secret/metadata filtering.
- [ ] Preserve pre-atomic output on transaction failure and surface bounded diagnostics for requested-but-skipped optimization.

### E. Real browser parity and benchmarks

- [ ] Build off/on exported Next projects using fixed inputs, dependency versions and `now`. Builder Vite/TypeScript success is not an exported Next build test.
- [ ] Compare production screenshots and computed styles before/after hydration, on client navigation and at desktop/tablet/mobile plus just below/at/above breakpoint boundaries.
- [ ] Exercise hover/focus/active, locale switching, CMS loading, reduced motion and relevant runtime cleanup. Skipped components must still behave like baseline.
- [ ] Measure per-route HTML + loaded CSS + JS/RSC raw/gzip/Brotli bytes, cold/warm transfer, render-blocking CSS, compiler time and memory.
- [ ] Keep default off until supported-project parity and net transfer benefit are demonstrated. Measure global CSS growth with many routes; route partitioning is a separate optimization.

## 8. Required regression matrix

| Layer | Minimum cases |
|---|---|
| Serializer | Numeric px vs strings; unitless values; zero/negative zero/unary minus; prefixes; empty/null/boolean/invalid cases; escaping, quotes, calc/var; URL resolution; declaration/rule injection |
| Collector | Within/across-file dedup; different typed values where serialization differs; forced hashes; authored namespace collisions; ambiguous delimiters; traversal order; fresh/concurrent registries |
| Eligibility | HTML success; SVG/custom/component/Motion skips; dynamic/duplicate classes; JSX spreads before/after style; object spreads in both orders; computed/duplicate keys; methods/getters; mixed values; refs/runtime-owned children |
| Cascade | IDs/compound selectors; same-specificity order; layers/all; pseudo states; important responsive/locale rules; keyframes; class/style selectors; logical/physical overlap; opposite shorthand order; opaque CSS/runtime fallback |
| AST | Data IDs/directives/metadata/comments/imports/props retained; untouched-file equality; output reparsing; no expression evaluation/reordered side effects |
| Bundle | Cross-page dedup; localized/root JSX layout; unsupported/missing/ambiguous roots; zero candidates; authored asset/manifest conflicts; idempotence; edited/stale owned output; all-or-nothing failure rollback |
| Export | Omitted/false flag unchanged; true compiles final assembly; image sizes/next-font parity; localized imports; remote modules; env/metadata filtering; both SSG settings; input immutability |
| Browser | SSR first paint, hydration, mounted updates, navigation/CSS loading and all relevant states compared with baseline |

JSDOM and snapshots do not establish cascade/media/animation/resource-loading fidelity. Browser checks must use independently served exported sites. Do not bypass the builder's iframe bridge rules to inspect its canvas.

## 9. Validation commands and observed baseline

Commands for implementation; new compiler tests do not exist yet:

```powershell
npx vitest run src/code/generation/atomic-css/ src/code/project/__tests__/source-export-atomic-css.test.ts
npx vitest run src/code/project/source-export.test.ts src/code/project/__tests__/source-export-modes.test.ts src/code/project/__tests__/source-export-clean.test.ts
npx vitest run
npx tsc --noEmit
npm run build
```

Then run the new exported-Next build/browser harness from phase E. Repository `npm run build` builds Vite, not exported Next projects. Unit tests must not require live module/font fetches.

**Baseline on 2026-11-11:** the three existing export suites ran 51 tests: **50 passed, 1 failed**. `source-export.test.ts`, test `generates correct sitemap for real blog project proj-1793030645294-xrmdi5`, throws `ENOENT` reading absent `data/projects/proj-1793030645294-xrmdi5.json`. The modes and clean suites passed. Replace this private-fixture dependency with a committed synthetic fixture as separate test maintenance before requiring a green export release gate. Do not fabricate private project files to hide the failure.

This review changes documentation only. No compiler was implemented, no new atomic tests exist, and the full builder typecheck/exported Next build/browser parity remain implementation gates.

## 10. Acceptance, metrics and rollback

V1 is complete when accepted transformations satisfy the explicit safety contract, skips are diagnosed, real Next builds/browser parity pass, and authored ProjectFS remains unchanged. Determinism means identical atomic results for identical prepared inputs/options, not identical ZIPs across changing timestamps, remote downloads or dependency versions.

Remove the unsubstantiated 30% requirement. Report measured total delivery savings; a global stylesheet and extra class tokens may increase compressed transfer on small/dynamic projects. If benchmarks justify a repetition/profitability threshold, define it deterministically and test separately.

Rollback: disable the option and rebuild from authored source. No source migration or ProjectFS cleanup is required. Cloud rollout, broader component support, mixed extraction, responsive atomization and visual-builder re-import are separate reviewed extensions, not implicit V1 deliverables.
