# Publish-Time Localization Implementation Plan

> **For agentic workers:** use `executing-plans` to implement this plan task by task after the user approves implementation. Checkboxes track implementation, not the completion of this design document.

**Goal:** publish correct Ukrainian/default and secondary-language websites from the current Revyme project, without migrating the editor's page tree or replacing its localization system.

**Architecture:** extend the existing `prepareSiteFiles` pipeline with a deterministic localization pass over a copy of the project. Only the generated application receives an `app/[lang]` route tree, an explicit route locale, localized links and a default-language rewrite. Keep template layouts and their transition controllers persistent.

**Tech Stack:** the existing Babel tools, next-intl, React, TypeScript, Next.js 16, ProjectFS, Vitest and Playwright. Reuse `@revyme/runtime` as installed. No new runtime package or CMS translation framework.

**Spec:** sections 1–10 below are the design contract; section 11 is the execution plan. This document replaces v3's editor-tree migration proposal for this task. Earlier plans remain historical records.

**Method:** written using the installed [Ponytail skill](https://github.com/DietrichGebert/ponytail/blob/main/skills/ponytail/SKILL.md), `full` level: reuse the existing mechanisms, add only what is needed, and verify all affected callers.

**Status:** design, not implemented. Existing baseline: six localization/runtime test files, 80 passing tests on 2026-10-17. This does not validate the proposed compiler.

## Global Constraints

- Do not move or duplicate editable pages in ProjectFS. Preserve page pairs, existing page/component namespaces, node IDs, templates, comments, translation files and undo/redo. The bounded direct-template namespace fix is described in section 6.3.
- Published routes may differ from editable file paths. The difference must be an explicit, deterministic build transformation used by export, server preview and deployment.
- Read a fresh snapshot after flushing queued mutations. Compilation must not write back generated output to ProjectFS or read configuration from an unrelated active editor project.
- Keep the current text, rich-text, localized style and component translation mechanisms.
- A URL's language determines rendered messages, CMS requests and metadata. LocalStorage does not override it.
- Keep `LayoutClient` in its persistent layout. Do not introduce v3's `PageFrame` or move the Navbar/transition controller into each page.
- Do not call `localizeRows` through the client-only runtime entrypoint from Server Components or metadata functions.
- Never mutate canvas DOM as a localization implementation. Respect the existing iframe bridge.
- Keep upstream credentials server-side, validate the language at request boundaries, and preserve existing error handling.
- The acceptance build must enable TypeScript checking even though the current exported Next config uses `ignoreBuildErrors: true`.

## Review Focus

1. A default-language page with no language segment must still receive `params.lang = defaultLocale` everywhere a query expression is evaluated.
2. A shared Navbar must have translated labels and correct SSR hrefs, without remounting its transition controller on same-language navigation.
3. A heading containing a dynamic span and a separately translated static span must remain dynamic after export.
4. API filtering must agree across initial SSR, detail metadata, pagination, canvas and preview; a late response from the old language must not replace current data.
5. Compilation must preserve the author's custom 404 and leave every source file unchanged, including on errors and repeated export.

## 1. Product decision: one authored page, multiple published URLs

The user creates `/gallery` once and translates it using the existing localizer. There is no need to manually create both `/gallery` and `/[lang]/gallery`.

| Browser URL | Internal generated route | Effective language |
|---|---|---|
| `/gallery` | `/uk/gallery` | `uk` |
| `/en/gallery` | `/en/gallery` | `en` |
| `/blog/dragon` | `/uk/blog/dragon` | `uk` |
| `/en/blog/dragon` | `/en/blog/dragon` | `en` |

`uk` is an example. Always read `defaultLocale` and supported codes from `i18n/config.json`.

The first release uses the requested policy: default language without a public prefix, secondary languages with a prefix. Do not add an `always` switch, domain routing, language negotiation or automatic browser-language redirects to solve this task.

The reserved parameter name is `lang`. It contains the configured project language code, such as `uk` or `en`; it is not the CMS record slug and does not automatically mean `uk-UA` or `en-US`.

### Deliberate limits

- Record and category slugs are shared between languages in this release. The language segment changes; `/blog/dragon` becomes `/en/blog/dragon`.
- Language-specific record slugs need a stable-ID URL mapping and are a separate feature. Do not pretend prefix substitution supports them.
- External CMS queries are configured explicitly by the author. Do not guess a Directus schema or flatten arbitrary REST responses.
- This targets the existing server-backed Next/vinext publishing model, including its current hybrid mode. A pure `output: 'export'` host cannot execute the rewrite or CMS relay and is not introduced here.
- A locale added to the site is expected to be usable for its published content. Unknown/missing remote records return a real missing-content result, not a random record or silent cross-language substitution.

These limits remove the need for a new CMS i18n strategy system, automatic translated-slug resolver and per-language expression storage.

## 2. Reuse map and actual gaps

| Existing mechanism | Keep | Necessary addition |
|---|---|---|
| `messages/{code}.json`, `useTranslations` | Text, rich text, attributes and component dictionaries | Pass an explicit language in generated root/provider |
| `i18n/config.json`, active locale atom | Existing language list and editor selection | Expose its effective code as `params.lang` in preview/query contexts |
| `cms/<collection>.json` with `_i18n` | Built-in translations and existing `localizeRows` | Localize detail display and server SEO as well as repeaters |
| `CollectionQueryConfig`, `isExpression` | Existing fx query model and evaluator | Permit it at collection-default level so index/detail/metadata share a language filter |
| `buildApiRequestUrl`, extraction helpers | Endpoint/default parameter handling | Evaluate expression defaults before building the request |
| `prepareSiteFiles` | Existing output preparation | One final locale projection; remove active-project config fallback in snapshot export |
| Template `layout.tsx` / `LayoutClient.tsx` | Persistence, header/footer, Page Transitions | Normalize language prefixes when matching logical page-effect/template keys |
| Current page metadata/SEO editor | Literal exports, bindings and expressions | Localized overrides and language-aware output metadata |
| `LocaleSwitcher` | Existing component, appearance controls, canvas channel | URL navigation on the published site |
| `app/not-found.tsx` | The user's editable 404 | Generated locale/global wrappers render that same content |

There is a real gap in collection defaults: `ApiResourceModal` currently saves plain string `defaultParams`. Writing `params.lang` there today sends literal text. Per-list query expressions already exist, but generated detail wrappers do not consume that same expression-capable default model. This plan fixes that gap rather than assuming it works.

## 3. The output-only localization pass

### 3.1 Small implementation surface

Add `src/code/project/localized-site-export.ts`:

```ts
export function prepareLocalizedSiteFiles(
  files: Readonly<Record<string, string>>,
): Record<string, string>;
```

It uses existing Babel parsing/generation and snapshots/config passed in `files`. Its result is a new map. It either returns a complete valid map or throws a diagnostic with the source file and reason; it never partially updates the editor.

Add a small self-contained `src/shared/locale-routing.ts` for the URL rules below. Emit that same source plus a project-config adapter into `lib/revyme-locale-routing.ts` in the generated application. Do not write different prefix algorithms in the switcher, link transformer, transitions and proxy.

Do not create a plugin framework, persistent route database or four new source files per authored page.

### 3.2 Transformation order

1. Read and validate the snapshot's i18n/CMS configuration before builder metadata is removed. With no i18n configuration, retain the current non-localized export behavior.
2. Remove only marker-owned legacy `@revyme-locale-route` pointer files from the **output map**. Keep them untouched in the editable source for compatibility with today's browser preview.
3. Run the existing source preparation passes on original page paths: query detection, data delivery, responsive images, fonts and generated controller healing. Make those generators language-aware as described below. If the author already has a leading `[lang]`, exclude that reserved segment from record-parameter discovery before any existing SSG pass; it is not a CMS slug to infer from sample data.
4. Build a transient `sourcePath -> outputPath` map. Place authored UI pages, template layouts and their local support files under `app/[lang]/`. Keep API handlers and site-wide robots/sitemap/manifest endpoints outside the language tree. Classify by route role; do not blindly prefix every `app/` file.
5. Rewrite local imports, re-exports and aliases using that map, including references from `components/` to moved app files. Preserve relative CSS/asset imports. Translation namespace strings are **not** recalculated from generated paths.
6. Adapt the generated root layout/provider, page metadata and links. Preserve all authored JSX, t() calls, rich text, responsive/localized CSS, template composition, animations and dynamic expressions except the explicitly described transforms.
7. Add the proxy and small generated URL/SEO/query helpers. Validate the complete output graph and allowed Next route exports.
8. Mark generated output with `@revyme-localized-output v1`. Reprocessing a matching compiled snapshot is idempotent; conflicting manually authored output files produce an error instead of being overwritten.

The font pass in step 3 is mandatory **before** route relocation: `transformSiteFilesForNextFonts` currently injects loaders only into the exact key `app/layout.tsx`, while also removing Google Fonts CSS imports. Running it after that root has moved can leave CSS variables without their loaders. Retain the transformed root when moving it to `app/[lang]/layout.tsx`. Keep shared `app/globals.css` in place and retarget its root import from `./globals.css` to `../globals.css` (or the existing supported `@/app/globals.css` alias) in step 5. Resolve every other moved relative import using the same path map.

If the author already created a leading `[lang]` route, reuse that segment once. Do not generate `[lang]/[lang]`. If `/gallery` and `/[lang]/gallery` both define the same logical page, report a collision. Do not choose one silently.

The path map is a compilation detail for import retargeting and error reporting. No editor namespace/path migration or transparent filesystem aliases are needed.

### 3.3 Root and provider

The generated application has no outer `app/layout.tsx`; its HTML root is `app/[lang]/layout.tsx`:

```tsx
export default async function RootLayout({ children, params }: {
  children: React.ReactNode;
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!configuredLocales.includes(lang)) notFound();
  return <html lang={lang} suppressHydrationWarning>
    <body><Providers locale={lang}>{children}</Providers></body>
  </html>;
}
```

This snippet specifies the locale contract; the transformer must retain the current root's CSS, theme, fonts, custom head/body code and runtime features. Keep existing message imports in Providers: a new dictionary loader is unnecessary for correctness.

Extend the provider generator to accept an explicit locale prop. When present, use it synchronously for SSR/hydration and ignore the persisted locale/event for site-language selection. When absent in the existing editor preview, retain its locale event behavior. Do not let a stored `en` change an unprefixed Ukrainian page.

Keep the authored root metadata/site config readable by the current SEO editor. In generated route files allow only legal Next exports. For the known generated root shape, remove the export qualifier from the internal `siteConfig` literal while retaining its values and usage; if another module imports that unsupported route export, report the dependency and adapt it explicitly rather than deleting data.

Do not automatically add `dir="rtl"`; retain Revyme's existing text-direction policy.

## 4. Public URLs, links, switcher and persistent transitions

### 4.1 URL functions

The shared helper exposes these operations using the project's validated default/language list:

```ts
export function stripLocale(pathname: string, locales: readonly string[]): string;
export function localizePath(pathname: string, lang: string, defaultLang: string): string;
```

`stripLocale` removes a configured leading language only. `localizePath` receives a bare pathname and adds a prefix only for non-default languages. It must not add a trailing slash except for `/`.

The generated `localizeHref` adapter splits pathname from search/hash and preserves their values. It ignores external/protocol-relative URLs, `mailto:`, `tel:`, fragment-only hrefs, APIs, Next internals and known public assets. A dot in a CMS slug is not enough to classify it as an asset. Already explicitly language-prefixed links remain explicit; do not double-prefix them. Preserve Next Link URL objects by changing their pathname only.

### 4.2 Default-language rewrite

Generate `proxy.ts` for Next.js 16. For each incoming public request:

- `/gallery` rewrites internally to `/<defaultLocale>/gallery`, preserving the visible URL and query.
- `/en/gallery` passes to its existing generated route.
- `/<defaultLocale>/gallery` redirects 308 to `/gallery` as the public canonical form.
- System/API/public asset and site-wide metadata requests bypass locale routing.

Run these rules for Next RSC and prefetch navigation too. Do not use `headers()` or `cookies()` to determine the React render language. Keep the browser URL and internal route distinct; do not compare only stripped paths when checking whether two language routes are identical.

An existing custom proxy/middleware is an integration conflict until its rules are deliberately composed. Never silently replace it. The actual deployment vinext version must pass the same rewrite tests; filename support cannot be inferred from a comment in this repository.

### 4.3 Navbar and other internal links

In **compiled output**, wrap navigational href expressions in the helper at render time:

```tsx
const __activeLocale = useLocale();
<MotionLink href={localizeHref('/gallery', __activeLocale)}>...</MotionLink>
<Link href={localizeHref(`/blog/${item._slug}`, __activeLocale)}>...</Link>
```

Reuse the existing locale hook scaffold for ordinary components; use Babel's enclosing component function when a module has several functions/HOCs. Do not insert hooks at module scope or into helper callbacks. Transform links in reachable components, template files, dropdowns and data-driven nav rendering, not only page JSX literals.

Preserve `Link`, `MotionLink`, refs, layout props, event handlers and existing smooth-scroll/keep-params behavior. No global DOM MutationObserver is needed to make SSR hrefs correct. The source Link tool still edits the original logical href, so no new editor link dialect is required.

Generated server page/layout links receive `lang` from their props/params and call the pure helper. Do not insert `useLocale` into Server Components or change arbitrary custom server modules into Client Components. A custom server component with unresolved route-sensitive links needs an explicit locale prop or a source diagnostic before publishing.

### 4.4 Switcher

Update the existing generated LocaleSwitcher template and known default instances safely; preserve appearance props and never overwrite custom code based solely on its filename.

- Canvas: retain the current locale event behavior using the existing `useStaticCanvas` signal.
- Published site: obtain the active language from `useLocale()` and build native language anchor hrefs from the current bare path. Shared record slugs make this sufficient, including in a persistent header.
- Use full document navigation across languages so the new root HTML language is correct. Preserve current query/hash on hydrated navigation; without JS the anchors still reach the right language page.
- Mark language anchors `data-no-vt` and make other nav interceptors leave them alone. Do not let PageTransitions convert the language switch into router.push.
- Keep internal same-language navigation on the existing Next Link/PageTransitions path.

No per-page global alternate store, metadata DOM lookup or PageFrame is needed for shared slugs.

### 4.5 Transitions and template route properties

Keep the original generated template nesting and `<PageTransitions>{children}</PageTransitions>` injection in `LayoutClient`. Same-language navigation must not destroy `pendingEffectRef`, the stage or the exit container.

Only normalize the paths used for logical effect/template-key lookup: `/en/gallery` matches the authored `/gallery` key. Keep the actual language and public destination for navigation identity, history, scroll and router.push. Update both the PageTransitions runtime and template-route matcher; replace language-looking regex guesses with configured language matching.

## 5. One language-aware CMS query mechanism

### 5.1 Extend the existing defaults just enough

Keep `ApiCollectionConfig.defaultParams` and add one optional field:

```ts
defaultQueryParams?: CollectionQueryParam[];
// CollectionQueryParam already has key, value, isExpression.
```

Give the existing API resource parameter rows the same fx capability as collection query rows. Do not add `directus_translations`/`query_param` strategies or an automatic localeMap system. The author can write the mapping in the existing expression language.

Request precedence:

1. Query already present in the endpoint URL.
2. Existing literal `defaultParams`.
3. Evaluated `defaultQueryParams`.
4. Evaluated node/page query overrides.
5. The caller's existing pagination parameters.

No duplicated query keys. Blank/invalid expression results produce a visible diagnostic for required language filters; do not send the string `params.lang` upstream or silently remove a required filter.

Extract/reuse the existing pure expression evaluation functions from `cms-api-config.ts` in a small browser/server-safe leaf only where necessary to emit the same behavior into generated server code. Re-export the current public functions so callers do not break. Keep one evaluation policy and test it against both emitted code and builder calls.

### 5.2 Directus example

The author configures:

| Key | Value | Mode |
|---|---|---|
| `fields` | `*,translations.*` | Literal |
| `deep[translations][_filter][languages_code][_eq]` | `({uk: 'uk-UA', en: 'en-US'})[params.lang]` | fx |

For project codes already matching Directus, use `params.lang` directly. Directus receives a resolved string, never JavaScript.

The response shape remains the author's CMS shape. For this Directus query a binding can read `item.translations[0].name`; do not pretend the name has been flattened onto `item.name`.

`deep` filters nested translations, not parent records. If untranslated records must be excluded, configure the corresponding parent relation filter too. For example, use an expression value for `filter[translations][languages_code][_eq]` with the same mapping. A detail query must return no matching record when the requested translated record is unavailable.

### 5.3 Reach every request path

Use the same effective params, including `lang`, for:

- API resource Test Connection and initial preview ingestion;
- canvas `useRendererSync` requests;
- index SSR via `buildCmsIndexServerWrapper`;
- generic repeaters via `orchestrateServerFetchForQueries`;
- detail body and `generateMetadata` via `buildCmsDetailServerWrapper`;
- generated `/api/cms/query` and its browser-preview relay;
- pagination and component background refresh;
- per-language static-parameter discovery when a CMS needs language-specific enumeration.

Do not update only `buildApiRequestUrl`: the existing server generators currently build URLs themselves. Extend those callers to emit evaluation of the same configured rows. Retain configured `slugField`, `itemsKey`, headers, method, query filters and revalidate settings.

Relay payload adds validated `lang` and the route params needed by configured expressions. Serialize `defaultQueryParams` in the generated server config; they must not disappear from its allowlisted fields. Evaluate defaults server-side. Preserve existing request limits and restrict caller overrides to the declared query/pagination contract, not arbitrary upstream endpoints or headers.

On language changes, abort stale queries and reset pagination. The current canvas already tracks request keys/generations; reuse that pattern. The effective URL/params must include language so cache entries cannot cross languages. Do not put upstream tokens into messages, client props or generated client modules.

## 6. Built-in CMS and mixed text

### 6.1 Built-in collection lists and detail

Keep `_i18n` and the existing `localizeRows`. Lists already use this pattern. For generated detail client code, use the same existing export:

```tsx
const item = rawItem ? localizeRows([rawItem], __activeLocale)[0] : undefined;
```

Keep the prop contract `PageClient({ item: rawItem })`, where the server sends the canonical default row plus `_i18n`. Do not send an already overwritten language row as the new base: switching to a partial translation could otherwise retain text from the previous language.

For metadata, emit a small pure merge of `row._i18n?.[lang]` using the installed runtime's nonempty-string semantics. Do not import its `"use client"` entrypoint on the server. A parity test compares the pure server merge with `localizeRows`.

Use shared record slugs for this release. If a built-in `_i18n` entry contains a `_slug` different from the base slug, report that unsupported configuration before publishing: the current runtime would otherwise overwrite `_slug` and emit links that this release does not generate. Do not silently strip the override or mutate the stored record. Built-in generation produces a route per language and record. A real unknown public slug yields notFound; `rows[0]` is only a canvas fallback when no slug was selected.

The generated boundary should document this intentional shortcut: `shortcut: shared record slugs only; add stable-ID language URL mappings before enabling translated slugs`. Native header language links can reach a missing-record page if a remote author later removes that language's record; they must never substitute an unrelated record. Availability-aware disabling of individual header languages would require an additional route-data contract and is not claimed here.

### 6.2 Dynamic span plus translated static span

Use two real canvas text nodes with their own `data-id`, not two formatting runs without IDs:

```tsx
<h1 data-id="heading">
  <span data-id="heading-dynamic">{item.name}</span>
  <span data-id="heading-tail"> у Запоріжжі: фото робіт та ескізи</span>
</h1>
```

The first retains its supported CMS binding/fx expression; the second uses today's localization UI and t() generation. The author supplies the English suffix. A test must confirm that localizing the static node does not wrap/replace the whole heading or destroy the dynamic child.

Keep expressions as code. SSR/SSG evaluates them against the current language's data. Do not snapshot the expression result into exported source or translate every string literal in JavaScript automatically. Preserve the current supported expression scope; the foreign `CurrentCategory.data.data` example from the discussion is not a new Revyme datasource API requirement.

### 6.3 Components and template text

Reuse component namespaces, translation adoption and instance-prop localization. A Navbar component remains one authored component and receives the route language through the generated provider.

Direct text inside `LayoutClient.tsx` is a known enumeration gap: `listTranslatableTexts` currently visits pages and `components/*.tsx`. Add template files to that existing enumeration rather than making another localization panel.

Use `template:Body` for `app/(Body)/LayoutClient.tsx`, and the corresponding `template:<group>` namespace for each template. Both `filePathToSlug` in `src/code/project/active-file-store.ts` and `pageSlugForPath` in `src/code/oracle/checks/translation-dialect.ts` must recognize templates before generic page-path stripping. Preserve page/component namespaces. Template namespace keys must contain no dots: next-intl treats dots as nesting, and its message validator rejects dotted keys. Do not silently collapse distinct group names when making a namespace safe.

Today both functions return `LayoutClient.tsx` for that template, colliding across groups. Changing only the editor helper would introduce `TRANSLATION_NAMESPACE_MISMATCH` when `commitTranslationText` runs its before/after Oracle check; `checkFile` normalizes template kind to page kind, so the translation rule applies to templates too. Keep the dependency-light Oracle derivation aligned with the editor helper and add parity cases rather than importing the editor store into the Oracle.

`CanvasTextEditController.ts` and `useLocaleOverrides.ts` already call `filePathToSlug`. Verify their template write/read behavior against the new namespace; do not add separate namespace derivations there. For an already-translated template, migrate only its collected translation keys from its old namespace when ownership is unambiguous; otherwise report the conflicting keys. This is a bounded compatibility fix, not a page-tree migration. Include two templates with identical node IDs in its test.

## 7. Metadata and the custom 404

Keep default SEO literals/expressions in the current authored `page.tsx`. No `page.seo.ts`, `page.server.tsx` or root-config migration is required in ProjectFS.

Store optional translated SEO form fields under the existing logical namespace's `_seo` entry in `messages/{lang}.json`. Reuse the Page SEO form with the active editor language: default edits continue through the current metadata writer; secondary-language edits save only their override values. Reserve `_seo` from translation-node enumeration/orphan cleanup.

In generated output:

- Preserve static and computed metadata, regardless of whether the page pathname has a dynamic record segment.
- Resolve CMS-bound metadata using the same language-filtered record as the page body. Prefer the existing binding/expression result, then translated literal override, then current default/fallback values.
- Wrap a static metadata export in a standard generated `generateMetadata` when language-specific values are needed. For an existing generateMetadata, keep its logic in a local non-exported function and wrap its result. Never export both metadata and generateMetadata.
- Use canonical public paths: default without prefix, secondary with prefix. Include reciprocal language alternatives and `x-default` for the known available versions. Build absolute URLs using the validated production site origin; do not ship localhost metadata.
- For external detail records, determine known availability with the same per-language configured lookup, reusing request caching. Do not advertise a language version confirmed missing. This is an existence check, not a translated-slug mapping system. For shared pages and built-in records, the route set is known directly.
- Use explicit Open Graph locale mapping if supplied; do not invent a region from `en`.

Preserve the author's `app/not-found.tsx` and its editor sentinel unchanged. In compiled output, reuse its body from the locale not-found wrapper and standalone global fallback. The latter provides its own html/body and default-language provider, without replacing the user's design with hardcoded text. Next's top-level dynamic root may require `global-not-found`/its opt-in: verify the pinned Next and real vinext deployment versions in the first proof task. Do not promise runtime compatibility from a Next-only build.

## 8. Editor and preview: small bridges, no tree migration

- In editor query contexts, merge `{...previewRouteParams, lang: activeLocale}` before evaluation, including pages with no dynamic segments. The reserved language value comes from the language selector, not a fake sample slug.
- The same effective params feed the fx popup's preview/autocomplete and the renderer. Do not require the author to create `[lang]` just to get the language variable.
- Keep the current browser canvas/preview source paths and legacy route-wrapper support. Its navigation shim can use the shared URL helper and current locale; its CMS relay receives the same evaluated language filters.
- Server preview of the finished website must run the same prepared artifact as export/deploy. `ServerPreview.buildFiles` currently adds session prefixes and heals `app/layout.tsx`; these operations must not run as if the compiled application still had the old root. Apply preview mounting outside the compiler, exactly once, and test `/session/en/gallery` as well as `/session/gallery` if that mounting mode is used.
- In particular, the current `if (!files['app/layout.tsx']) ... ensureLayoutFile()` fallback may run on authored input before compilation, but must not run unconditionally after it. A compiled map deliberately has `app/[lang]/layout.tsx` and no outer root. Either keep healing before preparation or guard the fallback on **both** root paths being absent. Preserve ordinary non-localized preview healing, and assert that preview preparation never creates an extra outer `app/layout.tsx` around the compiled language root.
- Do not execute newly async root Server Components in the browser Babel sandbox. The existing browser preview remains an authoring preview; the server preview is the SSR/deployment acceptance view.

## 9. Build modes and deployment contract

- Static-content pages get one language URL per configured locale. They can share source modules; Next.js creates the language HTML through the generated root params.
- In hybrid mode the generated root enumerates languages. Detail `generateStaticParams({params})` receives the parent's plain `{lang}` object and enumerates records using that language's query. Return child record params, not a second invented language source.
- Exclude reserved `lang` when inferring CMS record parameter names. Keep authored record/category parameters and current root-mounted collection base paths.
- Dynamic mode retains request-time fetching. Hybrid keeps its existing ISR/on-demand policy. Do not add a new snapshot system as part of localization.
- For full enumeration, follow upstream pagination. If the existing product has a prerender cap, report it honestly and rely on on-demand routes only where the selected mode supports them.
- A pure static-host export has no server rewrite or POST relay. Reject an incompatible target explicitly; do not silently describe server-backed SSG as `output: 'export'` support.

The standalone export currently uses `buildSourceExport -> prepareSiteFiles`. Cloud source export is implemented separately in `backend/src/services/export-project.ts`, outside this checkout. Deployment is not proven until that service and server preview consume the same locale preparation contract. Reuse the same pure compiler source where possible; if backend architecture requires a port, its golden output fixtures must match. Do not let two implementations invent different routing rules.

## 10. What this intentionally removes from v3

- No editor `app/[locale]` migration, root-path locator rollout, filesystem aliases or changes to every AI page tool.
- No PageFrame, per-page template composition, global alternate store or transition-controller relocation.
- No automatic Directus translation detector/normalizer or external runtime package change.
- No per-language fx-expression model. Real dynamic/static text nodes cover the discussed heading.
- No automatic translation of record slugs or new hosting modes.

The necessary changes remain: output routing, explicit locale, existing query expressions reaching all callers, href generation, switcher behavior, built-in detail/SEO, and actual deployment verification.

## 11. Execution plan

Work sequentially. Each task starts with a focused behavioral failure, implements the smallest correction, and runs its relevant checks. Do not begin the larger compiler until Task 1 demonstrates the output shape on the actual runtimes. Existing code is not to be changed merely to make this document look implemented.

### Task 1 — Prove the output route shape and persistent template

**Files:** create `scripts/verify-localized-site.ts` and a minimal fixture under `tests/fixtures/localized-site/`; use existing page/provider/template sources.

**Contract:** the runner creates a temporary generated application, never changes ProjectFS, and closes child servers after pass/failure.

The initial proof fixture is a small application already in the proposed output shape. The final runner must also accept the actual exported project directory (`--project <temporary-path>`); obtain that artifact through the existing standalone export/download test rather than importing browser-initialized editor modules into a plain Node process. Reuse the zip extraction helper in `src/editor/header/e2e/local-export.spec.ts`.

- [ ] Fixture: uk/en, one template with Navbar and PageTransitions, `/gallery`, `/about`, a user-designed 404, default-language rewrite, explicit root lang.
- [ ] Build with TypeScript checking enabled and the existing runtime version. Assert the HTML of `/gallery` and `/en/gallery`, both root lang and body text, canonical default-prefix redirect, custom 404 and native language links.
- [ ] Browser test: same-language navigation retains the controller instance, exit animation works, cross-language navigation loads the correct document, hydration has no rewrite mismatch.
- [ ] Run the equivalent fixture on the actual deployment vinext version, including proxy and global-not-found. Record the version and result. If unavailable, record deployment as unverified and do not claim release readiness.
- [ ] Run `npx tsx scripts/verify-localized-site.ts --fixture routing`; expect exit 0 only when HTTP, hydration and persistence assertions pass.

### Task 2 — Implement the small output compiler and URL helper

**Files:** create `src/code/project/localized-site-export.ts`, its test; create `src/shared/locale-routing.ts`, its test; modify `source-export.ts`, `providers-gen.ts` and their tests.

**Interfaces:** produces `prepareLocalizedSiteFiles`, `stripLocale`, `localizePath`, the generated href adapter and explicit provider locale prop described above.

- [ ] Start with a failing snapshot-immutability/route test:

```ts
const before = JSON.stringify(sourceFiles);
const output = prepareLocalizedSiteFiles(sourceFiles);
expect(JSON.stringify(sourceFiles)).toBe(before);
expect(output['app/[lang]/(Body)/gallery/page.tsx']).toBeDefined();
expect(output['app/layout.tsx']).toBeUndefined();
expect(output['app/api/cms/query/route.ts']).toBeDefined();
expect(output['app/[lang]/(Body)/LayoutClient.tsx']).toContain('PageTransitions');
expect(output['app/[lang]/(Body)/gallery/page.client.tsx']).toContain("useTranslations('gallery')");
```

- [ ] Implement section 3 with existing AST utilities. Retarget imports in both moved and unmoved files, preserve site-wide endpoints and source namespaces, handle authored `[lang]` once and reject collisions.
- [ ] Add a Google Fonts fixture: run `transformSiteFilesForNextFonts` before moving the root, retain the generated `next/font/google` loaders/body variables in `app/[lang]/layout.tsx`, and resolve its CSS import to the unchanged `app/globals.css`. Assert that no dangling `./globals.css` reference or unbound font variable remains.
- [ ] Remove global `loadCmsProjectConfig` fallback from snapshot-based export paths; pass explicit snapshot config into the existing generators so they do not fall back to `getApiCollection` from another project. For the current detail generator, pass explicit `apiConfig: null` for a built-in collection instead of `undefined`, which triggers its interactive fallback. Do not remove that convenience from unrelated interactive callers.
- [ ] Emit root/proxy/helpers and custom 404 adapters; preserve all root features. No custom named exports may remain in generated Next route entries.
- [ ] Test root/public URL, assets, external links, query/hash, dotted record slugs, invalid language, idempotence, import graph and compile failure leaving source untouched.
- [ ] Run `npx vitest run src/code/project/localized-site-export.test.ts src/shared/locale-routing.test.ts src/code/project/source-export.test.ts src/code/project/providers-gen.test.ts`.

### Task 3 — Make existing query configuration language-aware everywhere

**Files:** modify `cms-api-config.ts`, `ApiResourceModal.tsx`, `cms-page-ops.ts`, `cms-seo.ts`, `source-export.ts`, `cms-pagination-gen.ts`, `useRendererSync.ts`, the fx popup/preview context and matching tests. Extract the existing evaluator into a small leaf only if needed for shared emitted code.

**Interfaces:** add `ApiCollectionConfig.defaultQueryParams?: CollectionQueryParam[]`; requests carry a validated effective `lang` and required route params. Preserve existing static defaults and query row types.

- [ ] Failing test: the same configured deep-language fx row produces `uk-UA` for the default public route and `en-US` for English in resource Test Connection, canvas, index SSR, detail SSR, metadata and relay. Assert the actual URLSearchParams, not just emitted source text.
- [ ] Add fx to the existing resource parameter rows; round-trip static legacy config and mixed literal/expression config. Test Connection must evaluate the rows with the active language.
- [ ] Update all callers in section 5.3. Reuse evaluator and URL/extraction helpers; keep method/auth/filter/revalidate behavior. Serialize the new defaults into generated server config.
- [ ] Test locale-prefixed pagination, effective URL cache keys, page reset, abort and late old-language replies. Keep language in SSR, hydration and SWR initial data consistent.
- [ ] Test that malformed/unknown language is rejected by the relay and secrets are absent from client output.
- [ ] Run targeted CMS config/page/SEO/export/pagination tests, then the Directus fixture through `scripts/verify-localized-site.ts`.

### Task 4 — Preserve localized text/components and complete built-in detail support

**Files:** modify `cms-locale-gen.ts`, detail generation in `cms-page-ops.ts`/`cms-seo.ts`, `translation-ops.ts` template enumeration, `active-file-store.ts`, Oracle `checks/translation-dialect.ts` and corresponding tests. Verify `src/canvas/text-edit/CanvasTextEditController.ts` and `src/canvas/hooks/useLocaleOverrides.ts` consumers; change them only if necessary. Keep existing page/component namespace behavior.

**Contract:** canonical built-in rows remain unchanged; the existing runtime resolves visible fields; server metadata uses an equivalent pure merge.

- [ ] Failing test: uk/en detail body and title resolve the right `_i18n` fields; an empty override falls back to the original default base. The installed `localizeRows` and generated server merge agree.
- [ ] Add the existing `localizeRows([rawItem], lang)[0]` shape to generated detail clients without adding a runtime export. Keep `item` as the prop key; do not confuse it with the local alias `serverItem`.
- [ ] Test unknown public slug -> notFound, preview with no slug -> current controlled preview row; never silently show the first record for a real unknown URL. Test a differing localized `_slug` override produces an actionable compile diagnostic instead of broken links.
- [ ] Fixture contains two real text spans with IDs. Translate the static span through the existing localizer; assert the dynamic binding/fx source remains intact and updates with English CMS data. Preserve rich text and locale styles too.
- [ ] Include direct template text in the existing enumeration with noncolliding namespaces; preserve known existing template translations or report ambiguity before changing them. Test two templates with identical node IDs and component extraction/adoption.
- [ ] Assert editor/Oracle namespace parity for `app/(Body)/LayoutClient.tsx` -> `template:Body` and a second template. Save through `commitTranslationText`, assert the JSX changed without a new `TRANSLATION_NAMESPACE_MISMATCH`, and verify canvas editing/locale overrides read the same messages. Include next-intl message validation and unchanged page/component namespace cases.
- [ ] Run `npx vitest run src/code/generation/cms-locale-gen.test.ts src/code/stores/cms-locale.test.ts src/code/project/cms-seo.test.ts src/code/project/cms-seo.api.test.ts` plus the added translation/template tests.

### Task 5 — Localize generated links and update the switcher safely

**Files:** extend `localized-site-export.ts`; modify the default LocaleSwitcher template, `page-transitions-gen.ts`, `template-route-gen.ts`, provider nav handling and preview shims as needed; update tests.

**Contract:** authored hrefs stay logical; compiled hrefs render the active-language URL during SSR; template/controller lifetime is unchanged.

- [ ] Failing SSR test: a component Navbar, nested dropdown, CMS card and footer all render `/en/...`; a download, external URL, hash and explicit language-switch href remain correct.
- [ ] Wrap generated hrefs with the shared helper, using supported client locale scope or explicit server locale. Preserve MotionLink/ref/layout props and all preexisting handlers.
- [ ] Upgrade known generated switchers while preserving custom ones; render native language anchors with `data-no-vt`. Keep canvas locale events and component isolation behavior.
- [ ] Test shared-slug `/blog/dragon` -> `/en/blog/dragon`, locale persistence rules, query/hash, modifier clicks and zero-JS language navigation.
- [ ] Update logical effect/template matching for configured language prefixes. Assert `/en/gallery` -> `/en/about` finds the authored effect, while `/gallery` -> `/en/gallery` remains a language-changing document navigation.
- [ ] Run page-transition/template-route/provider tests and the routing browser fixture.

### Task 6 — Preserve and localize metadata through the current SEO form

**Files:** modify `PagesSeoSection.tsx`, `translation-ops.ts` SEO override read/write, output metadata transform in `localized-site-export.ts`, and existing `cms-seo.ts` generators/tests.

**Contract:** default SEO still round-trips through current literal metadata/seoDefaults; secondary overrides live under the same namespace's `_seo`.

- [ ] Failing UI round-trip test: save an English title, reopen it, and verify the default title/code is unchanged. Clear the override and confirm fallback. `_seo` survives orphan cleanup.
- [ ] Wrap static/dynamic metadata in generated output without illegal route exports or metadata/generateMetadata conflict. Localize the record before resolving CMS SEO fields; use the same request settings as body SSR.
- [ ] Test a static URL with a computed SEO expression, title/description/OG/Twitter fallbacks, absolute canonical, reciprocal known alternates and x-default. Preserve explicit custom metadata outside localized slots.
- [ ] For external detail availability, reuse the same configured lookup for each language and omit confirmed missing versions. Keep shared slugs; do not invent translated mappings.
- [ ] Preserve the custom 404 content, noindex behavior and response status. Resolve detail existence before a streaming shell commits a success response; verify both browser and HTML-limited bot requests.
- [ ] Run the existing metadata/SEO tests and generated-site HTML assertions with a valid production-like site origin.

### Task 7 — Connect export, previews and actual deployment; finish verification

**Files:** integrate `source-export.ts`, `ServerPreview.tsx`, browser preview locale/query adapters, standalone export, and the external backend export/deploy service; extend fixtures and existing export-mode tests.

**Contract:** every finished-site entrypoint uses the same compiled semantics and output import graph. The canvas remains on authored files.

- [ ] Wire server preview to preparation before mounting it under any session prefix. Do not recreate the old outer root after compilation or prefix href strings twice.
- [ ] Test `ServerPreview` with authored, already-compiled and non-localized inputs. A compiled language root must survive without an added `app/layout.tsx`; a non-localized project missing its root must retain the existing healing behavior. Apply root healing only before compilation or when both root paths are absent.
- [ ] Wire cloud source export and deployment to the same preparation contract. Record the actual vinext version and fixture results. This is a release requirement even though that backend service is outside this checkout.
- [ ] Hybrid test: known language/record combinations are present in the prerender output; a new remote record works on demand where the current mode permits it. The child static-params function receives the parent's language and uses language-aware queries.
- [ ] Run `npx tsc --noEmit`, `npx vitest run`, and the generated-site runner in dynamic and hybrid modes. The generated fixture uses `ignoreBuildErrors: false` and includes `.next/types/**/*.ts` in its own typecheck.
- [ ] Browser acceptance: uk/en body text, component labels, mixed spans, Navbar/CMS hrefs, same-language effects, language switch, back/forward, pagination, custom 404 and no hydration errors.
- [ ] Reopen the editor project and compare its file snapshot with the pre-export snapshot. No generated route copies, moved pages, export-induced namespace changes or stale references may appear.
- [ ] Document shared-slug and hosting limits. Report any unavailable backend/runtime verification instead of marking it passed.

## 12. Acceptance checklist

- [ ] One authored page yields `/gallery` and `/en/gallery` without manual duplicates.
- [ ] `params.lang` is `uk` on the unprefixed default route and `en` on English, including canvas/Test Connection/SSR/relay contexts.
- [ ] Directus receives resolved language filters; explicit field bindings match its actual response shape.
- [ ] Existing text/component/style localization works; dynamic expressions remain live.
- [ ] The shared Navbar has correct initial HTML hrefs and translated labels.
- [ ] The template/transition controller persists on same-language navigation.
- [ ] Built-in detail body and metadata use `_i18n` consistently without a new runtime package.
- [ ] Metadata and the author's 404 survive compilation and SEO form round-trips.
- [ ] Source snapshots are unchanged; output is deterministic and checked by real builds.
- [ ] Next.js and the deployed vinext path pass their respective fixtures.

## 13. References and remaining verification

- [Ponytail](https://github.com/DietrichGebert/ponytail/blob/main/skills/ponytail/SKILL.md): the smallest complete change; installed at `/home/rost/.codex/skills/ponytail/SKILL.md`.
- [Next.js internationalization](https://nextjs.org/docs/app/guides/internationalization): language root layouts and route params.
- [Next.js proxy](https://nextjs.org/docs/app/api-reference/file-conventions/proxy): rewrite/redirect behavior.
- [Next.js generateStaticParams](https://nextjs.org/docs/app/api-reference/functions/generate-static-params): parent language context for child enumeration.
- [Next.js usePathname](https://nextjs.org/docs/app/api-reference/functions/use-pathname): rewrites and hydration cautions.
- [Directus query parameters](https://directus.com/docs/guides/connect/query-parameters): fields, deep filters and pagination.
- [vinext support matrix](https://github.com/cloudflare/vinext) and [changelog](https://github.com/cloudflare/vinext/blob/main/packages/vinext/CHANGELOG.md): current public support does not identify the user's deployed version.

Checked for this design: the relevant existing generators/callers, provider/switcher source, template transition lifecycle, query evaluator/defaults, preview route contexts and the six-file 80-test baseline. Not executed: the proposed compiler, generated-site builds or the external backend deployment. Do not describe those future acceptance checks as completed work.
