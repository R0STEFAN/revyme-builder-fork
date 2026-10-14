// cms-page-ops.ts — Create CMS-backed page files (Index + Detail).
//
// Both flavours emit a SERVER + CLIENT pair — the same shape `createPageFile`
// produces for hand-made pages — so every page-pair helper (PageSelector,
// delete/move, layout resolution, duplicate-detection) resolves them. The
// server `page.tsx` is a thin wrapper that owns the `metadata` export and
// re-exports the canvas-editable client body (`page.client.tsx`).
//
//   1. **Index** — `app/{slug}/page.{tsx,client.tsx}`. A normal page pair
//      hosting a `.map()` repeater over the whole collection. Renders an
//      aggregate list (e.g. "all Articles").
//
//   2. **Detail** — `app/{slug}/[slug]/page.{tsx,client.tsx}`. Next.js
//      dynamic route. The client body is a TEMPLATE rendered ONCE, with
//      bindings to `item.field` — Next.js fills the `[slug]` segment and
//      the page's `useParams()` + `.find()` resolves to the matching item
//      at runtime. The client file carries a
//      `/** @cmsPage { collection, kind: 'detail' } */` annotation so the
//      editor knows to enable detail-page UI (preview-slug navigator etc.).
//
// Both client files use the same canvas-config block so viewport positions
// stay consistent with hand-created pages.

import { defaultCanvasBlock } from './canvas-config';
import { projectFS } from './project-fs';
import { uniqueRouteSlug, slugToFilePath } from './active-file-store';
import { getCollectionSchema } from './cms-ops';
import type { CollectionSchema, FieldDefinition, CollectionQueryConfig } from '@/shared/types';
import { trace } from '@/shared/debug-trace';
import { rootMountBlockedBy } from './cms-root-mount';
import {
  buildCmsDetailServerWrapper,
  defaultBindings,
  serializeHeadersForCode,
  parseCmsSeoBindings,
  parseCmsSeoDefaults,
  hasGenerateStaticParams,
} from './cms-seo';
import { cmsNavHrefExpr } from '@/code/generation/map-gen';
import { getApiCollection, type ApiCollectionConfig } from './cms-api-config';
import { getItemDisplayLabel } from '@/shared/cms-accessor';

// ─── Field selection ────────────────────────────────────────────────────────

/**
 * Pick the first text-shaped field from a schema for the default heading
 * binding. Falls back to `_slug` (always present on every item) when the
 * schema has no text fields.
 */
function firstTextField(schema: CollectionSchema | null): string {
  if (!schema) return '_slug';
  const text = schema.fields.find(f =>
    (f.type === 'text' || f.type === 'textarea' || f.type === 'richtext' || f.type === 'slug') &&
    !schema.fields.some(other => other.id.startsWith(`${f.id}.`)),
  );
  return text?.id ?? '_slug';
}

/**
 * Pick the first body-shaped field — anything text-y that isn't the heading.
 * Falls back to a placeholder field name; the page renders an empty string
 * if the field isn't present at runtime.
 */
function firstBodyField(schema: CollectionSchema | null, headingField: string): string | null {
  if (!schema) return null;
  const text = schema.fields.find(f =>
    (f.type === 'text' || f.type === 'textarea' || f.type === 'richtext') &&
    f.id !== headingField &&
    !schema.fields.some(other => other.id.startsWith(`${f.id}.`)),
  );
  return text?.id ?? null;
}

// ─── Field → JSX renderers ─────────────────────────────────────────────────
// Each scope (`detail` / `card`) gets its own size + style profile so the
// generated page looks balanced without the user having to retouch every
// field. Card variants are smaller and tighter — they live inside a flex
// list. Detail variants are article-sized — they live inside a centered
// 720px reading column.

type RenderScope = 'detail' | 'card';

/**
 * A safe JS accessor for a field id: `item.foo` when the id is a valid
 * identifier, `item.foo?.bar` when nested, `item['foo-bar']` otherwise.
 */
function itemAccess(itemVar: string, fieldId: string): string {
  if (fieldId.includes('.')) {
    const parts = fieldId.split('.');
    if (parts.every((part) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(part))) {
      return `${itemVar}.${parts.join('?.')}`;
    }
  }
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(fieldId)) {
    return `${itemVar}.${fieldId}`;
  }
  return `${itemVar}[${JSON.stringify(fieldId)}]`;
}

/**
 * Generate JSX for a single field bound to `item.fieldId`. Returns null when
 * the field type is unsupported in the chosen scope (e.g. references) — the
 * caller skips it. Indentation is meant to be inserted under a flex parent
 * with a 4-space indent already applied to the line.
 */
function renderFieldJsx(
  field: FieldDefinition,
  itemVar: string,
  scope: RenderScope,
  isHeading: boolean,
  isBody: boolean,
): string | null {
  const id = `field-${field.id}`;
  const access = itemAccess(itemVar, field.id);

  switch (field.type) {
    case 'image':
    case 'file': {
      // Image is the primary visual anchor for the row — render at the top.
      // Width 100% lets it scale with the layout column; objectFit:cover
      // keeps consistent aspect across mismatched source images.
      const height = scope === 'detail' ? '400px' : '180px';
      const radius = scope === 'detail' ? '12px' : '8px';
      const srcExpr = `typeof ${access} === 'object' && ${access} !== null ? (${access}.url || (${access}.id ? \`/assets/\${${access}.id}\` : '') || ${access}.filename_disk || '') : ${access}`;
      return `      <img data-id="${id}" data-name="${field.name}" src={${srcExpr}} alt="" style={{
        width: '100%', height: '${height}',
        objectFit: 'cover', borderRadius: '${radius}',
        display: 'block'
      }} />`;
    }
    case 'text':
    case 'slug': {
      // Heading vs sub-text: distinct sizes so the visual hierarchy reads.
      // Detail-page heading is the page title; card heading is a title row.
      const fontSize = isHeading
        ? (scope === 'detail' ? '48px' : '20px')
        : (scope === 'detail' ? '16px' : '14px');
      const weight = isHeading ? '700' : '500';
      const color = isHeading ? '#0f172a' : '#475569';
      return `      <p data-id="${id}" data-name="${field.name}" style={{
        position: 'relative',
        fontSize: '${fontSize}', fontWeight: '${weight}', color: '${color}',
        fontFamily: 'Inter, sans-serif',
        margin: 0
      }}>{typeof ${access} === 'object' && ${access} !== null ? (${access}.name || ${access}.title || ${access}.label || JSON.stringify(${access})) : ${access}}</p>`;
    }
    case 'textarea':
    case 'richtext': {
      // Body copy: comfortable reading column width on detail pages, no
      // explicit width on cards (flex parent constrains it).
      const fontSize = scope === 'detail' ? '16px' : '14px';
      const lineHeight = isBody ? '1.7' : '1.5';
      const maxWidth = scope === 'detail' ? `, maxWidth: '720px'` : '';
      return `      <p data-id="${id}" data-name="${field.name}" style={{
        position: 'relative',
        fontSize: '${fontSize}', color: '#475569', lineHeight: '${lineHeight}',
        fontFamily: 'Inter, sans-serif',
        margin: 0${maxWidth}
      }}>{typeof ${access} === 'object' && ${access} !== null ? (${access}.name || ${access}.title || ${access}.label || JSON.stringify(${access})) : ${access}}</p>`;
    }
    case 'number':
    case 'date': {
      return `      <p data-id="${id}" data-name="${field.name}" style={{
        position: 'relative',
        fontSize: '14px', color: '#64748b',
        fontFamily: 'Inter, sans-serif',
        margin: 0
      }}>{${access}}</p>`;
    }
    case 'boolean': {
      // Boolean → string label; the user can edit the renderer afterwards.
      // Skip on cards to avoid clutter.
      if (scope === 'card') return null;
      return `      <p data-id="${id}" data-name="${field.name}" style={{
        position: 'relative',
        fontSize: '12px', color: '#64748b',
        fontFamily: 'Inter, sans-serif',
        margin: 0
      }}>{${access} ? '${field.name}: Yes' : '${field.name}: No'}</p>`;
    }
    case 'enum': {
      // Render as a small pill — distinguishes category/status fields from
      // body text without the user having to restyle.
      return `      <span data-id="${id}" data-name="${field.name}" style={{
        position: 'relative',
        fontSize: '11px', fontWeight: '600', color: '#3b82f6',
        backgroundColor: '#eff6ff',
        padding: '4px 10px', borderRadius: '999px',
        fontFamily: 'Inter, sans-serif',
        alignSelf: 'flex-start',
        textTransform: 'uppercase', letterSpacing: '0.04em'
      }}>{${access}}</span>`;
    }
    case 'tags': {
      // Comma-joined display — primitive but valid for any string[]; user can
      // refactor into a .map() pill list afterwards.
      return `      <p data-id="${id}" data-name="${field.name}" style={{
        position: 'relative',
        fontSize: '12px', color: '#64748b',
        fontFamily: 'Inter, sans-serif',
        margin: 0
      }}>{Array.isArray(${access}) ? ${access}.join(', ') : ''}</p>`;
    }
    case 'link':
    case 'url': {
      // Render as visible link so the user can see the binding worked. They
      // can swap the label text afterwards via .map() / static.
      return `      <a data-id="${id}" data-name="${field.name}" href={${access}} style={{
        position: 'relative',
        fontSize: '14px', color: '#3b82f6',
        fontFamily: 'Inter, sans-serif',
        textDecoration: 'none',
        margin: 0
      }}>{${field.name === 'LinkedIn' || field.name === 'Twitter' || field.name === 'GitHub' ? `'${field.name}'` : access}}</a>`;
    }
    case 'color': {
      // Color is a swatch, not display copy. Render a small chip.
      return `      <div data-id="${id}" data-name="${field.name}" style={{
        position: 'relative',
        width: '24px', height: '24px',
        borderRadius: '6px',
        backgroundColor: ${access},
        border: '1px solid #e2e8f0'
      }} />`;
    }
    case 'json':
      // Generic object/json fields are not rendered as raw text elements to avoid React child crashes
      return null;
    // reference / multi-reference are intentionally omitted — they need a
    // join + nested map which is too much to scaffold; the user can add
    // them via the CMS binding menu after the page exists.
    default:
      return null;
  }
}

/**
 * Generate JSX for ALL fields in a schema, in declaration order.
 * `headingFieldId` and `bodyFieldId` flag which text fields receive the
 * upgraded title/body styling (vs being rendered as plain rows).
 */
function renderAllFields(
  schema: CollectionSchema | null,
  itemVar: string,
  scope: RenderScope,
  headingFieldId: string,
  bodyFieldId: string | null,
): string {
  if (!schema) return '';
  const blocks: string[] = [];
  // Filter out parent container fields when their subfields exist in schema (e.g. omit 'author' when 'author.name' exists)
  const fieldsToRender = schema.fields.filter(f =>
    !schema.fields.some(other => other.id.startsWith(`${f.id}.`)),
  );
  // Image fields first — visual anchor at the top.
  // Then heading. Then everything else in schema order.
  const ordered = [...fieldsToRender].sort((a, b) => {
    const aImage = a.type === 'image' || a.type === 'file';
    const bImage = b.type === 'image' || b.type === 'file';
    if (aImage && !bImage) return -1;
    if (!aImage && bImage) return 1;
    if (a.id === headingFieldId && b.id !== headingFieldId) return -1;
    if (b.id === headingFieldId && a.id !== headingFieldId) return 1;
    return 0;
  });
  for (const field of ordered) {
    const isHeading = field.id === headingFieldId;
    const isBody = field.id === bodyFieldId;
    const jsx = renderFieldJsx(field, itemVar, scope, isHeading, isBody);
    // Every in-flow child needs a sequential quoted `order` + no-shrink flex
    // (FLEX_CHILD_MISSING_ORDER / FLEX_CHILD_SHRINKS) — the builder's own
    // scaffolds must pass its own oracle gate on a no-op resubmit.
    if (jsx) blocks.push(jsx.replace('style={{', `style={{
        order: '${blocks.length}', flex: '0 0 auto',`));
  }
  return blocks.join('\n');
}

// ─── Canvas config block (shared) ──────────────────────────────────────────

const CANVAS_CONFIG_BLOCK = `${defaultCanvasBlock()}`;

// ─── Server wrapper (shared) ────────────────────────────────────────────────
// The thin server `page.tsx` half of the page pair: owns the `metadata`
// export and re-exports the canvas-editable client body. `./page.client`
// resolves to the sibling `page.client.tsx` for both index and detail dirs.
const SERVER_WRAPPER = `import PageClient from './page.client';

export const metadata = {};

export default function Page() {
  return <PageClient />;
}
`;

// ─── Index page ─────────────────────────────────────────────────────────────

/**
 * Build the import binding's local variable name for a collection. CMS
 * slugs are kebab-case ([a-z0-9-]); a JS identifier can't contain '-' or
 * start with a digit, so we camelCase the hyphen-separated parts and
 * prefix any digit-leading result.
 *   "blog-posts"   → "blogPosts"
 *   "team"         → "team"
 *   "collection-2" → "collection2"  (the old [a-z]-only rule left the
 *                                    dash in — `import collection-2` is a
 *                                    syntax error that broke the page)
 *   "2023-recap"   → "cms2023Recap" (identifiers can't start with a digit)
 */
function collectionVarName(slug: string): string {
  const camel = slug.replace(/-+([a-z0-9])/g, (_, c: string) => c.toUpperCase());
  return /^[0-9]/.test(camel) ? `cms${camel}` : camel;
}

/**
 * Create a CMS Index page PAIR — server `app/{slug}/page.tsx` + client
 * `app/{slug}/page.client.tsx`. The client body is a pre-bound `.map()`
 * over the collection that the user can immediately customise (add
 * filters, change layout, bind more fields).
 *
 * Each card is a Next.js `<Link>` to `/{slug}/{item._slug}` — the detail
 * page's dynamic route — so clicking a card client-side-navigates to that
 * item (and the route auto-prefetches when the card enters the viewport).
 * The link resolves the right item purely from `.map()` scope
 * (`item._slug`); no per-item wiring needed. (If no detail page exists
 * yet the link 404s until one is created.)
 *
 * Returns the CLIENT path (the canvas-editable half) so the caller can
 * route the editor to it — same contract as `createPageFile`.
 */
export function createCmsIndexPageFile(slug: string): string {
  const schema = getCollectionSchema(slug);
  const headingField = firstTextField(schema);
  const bodyField = firstBodyField(schema, headingField);
  const varName = collectionVarName(slug);
  // Route folder must NOT collide with an existing page (e.g. a `/blog` index
  // already living in a route group like `app/(Body)/blog/`). `slug` stays the
  // COLLECTION (data import + card links → its canonical detail route); only
  // the new index page's FOLDER gets bumped to `blog-2` when taken.
  const routeSlug = uniqueRouteSlug(slug);
  const serverPath = `app/${routeSlug}/page.tsx`;
  const clientPath = `app/${routeSlug}/page.client.tsx`;
  const pageName = schema?.name ?? slug;

  // Card body — every schema field rendered with type-aware JSX. Image
  // fields get an <img>, text gets a <p>, enums get a pill, etc. Rendering
  // ALL fields up-front means the card looks complete the moment the page
  // is created; the user can delete what they don't want instead of having
  // to manually bind every column.
  const cardFieldsJsx = renderAllFields(schema, 'item', 'card', headingField, bodyField);
  const apiConfig = getApiCollection(slug);
  let serverCode = SERVER_WRAPPER;
  let clientSignature = `export default function Page() {`;
  let clientMapExpr = `{${varName}.map((item, idx) => (`;

  if (apiConfig) {
    serverCode = buildCmsIndexServerWrapper(slug, apiConfig);
    clientSignature = `export default function Page({ items: serverItems }: { items?: any[] } = {}) {
  const items = serverItems ?? ${varName};`;
    clientMapExpr = `{items.map((item, idx) => (`;
  }

  const code = `'use client';

${CANVAS_CONFIG_BLOCK}

import React from 'react';
import Link from 'next/link';
import ${varName} from '@/cms/${slug}.json';

${clientSignature}
  return (
    <div data-id="root" data-name="${pageName}" style={{
      position: 'relative', width: '100%',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center',
      gap: '32px', padding: '60px',
      backgroundColor: '#ffffff'
    }}>
      <div data-id="page-container" style={{
        position: 'relative', width: '100%', maxWidth: '960px',
        display: 'flex', flexDirection: 'column',
        gap: '32px',
        order: '0', flex: '0 0 auto'
      }}>
      <p data-id="page-heading" style={{
        position: 'relative',
        order: '0', flex: '0 0 auto',
        fontSize: '40px', fontWeight: '700', color: '#0f172a',
        fontFamily: 'Inter, sans-serif',
        margin: 0
      }}>
        ${pageName}
      </p>
      <div data-id="card-list" style={{
        position: 'relative',
        order: '1', flex: '0 0 auto',
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px'
      }}>
      ${clientMapExpr}
        <Link data-id="card" data-name="Card" key={idx} data-cms-nav="row" href={${cmsNavHrefExpr(slug, collectionVarName(slug), 'row')}} style={{
          position: 'relative',
          display: 'flex', flexDirection: 'column', gap: '12px',
          padding: '20px',
          backgroundColor: '#f8fafc', borderRadius: '12px',
          border: '1px solid #e2e8f0',
          textDecoration: 'none', color: 'inherit'
        }}>
${cardFieldsJsx}
        </Link>
      ))}
      </div>
      </div>
    </div>
  );
}`;

  projectFS.writeFile(serverPath, serverCode);
  projectFS.writeFile(clientPath, code);
  trace.action('cms-page-ops:create-index', { serverPath, clientPath, slug, headingField, bodyField, fieldCount: schema?.fields.length });
  return clientPath;
}

// ─── Detail page ────────────────────────────────────────────────────────────

/**
 * Create a CMS Detail page PAIR — server `app/{slug}/[slug]/page.tsx` +
 * client `app/{slug}/[slug]/page.client.tsx`.
 *
 * The client body is a TEMPLATE rendered once. At runtime, Next.js fills
 * the dynamic `[slug]` segment, the page's `useParams()` resolves the
 * active item, and the bindings (`item.title`, `item.body`, …) substitute
 * that one item's values.
 *
 * The root carries `key={params.slug}`. Two detail URLs (/projects/a → /projects/b) resolve to the
 * SAME component, so React reconciles it in place instead of remounting: `initial` never re-applies
 * and every `whileInView` with `once:true` stays latched, so a next/prev link swaps the content with
 * NO entrance animation while a header link (a different route segment, hence a real remount) plays
 * normally (live find 2026-07-30). Keying the root makes a slug change a new subtree. Deliberately
 * scoped to the page's own root — keying higher (root layout / LayoutClient) would remount the
 * header, resetting its variant state mid-transition, and remount PageTransitions, orphaning the
 * `finishRef` resolver so the view transition never completes.
 *
 * The `/** @cmsPage { collection, kind: 'detail' } *​/` annotation lives in
 * the CLIENT file — that is the file the editor activates and parses, so
 * the panel can surface the preview-slug navigator and the binding
 * resolver can pick values from the currently-previewed item.
 *
 * Returns the CLIENT path so the caller can route the editor to it.
 */
export function createCmsDetailPageFile(
  slug: string,
  /** Mount it at the site ROOT — `app/[slug]`, serving `/amara-okeke` — the
   *  shape a site uses when its collection has no section in front of it.
   *  Refused, with the owner named, when another collection is already
   *  there: two root collections make a slug ambiguous. */
  opts: { atRoot?: boolean } = {},
): string {
  // ONE detail page per collection. If one already exists — in a route group,
  // co-located under an index folder, or a bumped folder — return it instead
  // of scaffolding a second route nothing links to. The Pages menu greys the
  // entry out; this guards the AI `create_pages` mirror + direct callers.
  const existing = findCmsPageFile(slug, 'detail');
  if (existing) {
    trace.action('cms-page-ops:create-detail-exists', { slug, existing });
    return existing;
  }
  const schema = getCollectionSchema(slug);
  const headingField = firstTextField(schema);
  const bodyField = firstBodyField(schema, headingField);
  const varName = collectionVarName(slug);
  // Where the detail page lives. The dynamic route is `[slug]/page.{tsx,
  // client.tsx}` so the URL is /{collection}/{item-slug}. Two cases:
  //  1. The collection already has a BASE page (e.g. an `/advisors` index,
  //     possibly inside a route group like `app/(Body)/advisors/`). CO-LOCATE
  //     the detail in that SAME folder → `app/(Body)/advisors/[slug]/`. The
  //     detail then NESTS under the index in the Pages tree AND inherits the
  //     same route-group template (matches the Next.js index+detail model).
  //  2. No base page → a bare folder, route-group-aware deduped so the detail
  //     route can't collide.
  // Either way the @cmsPage `collection` below stays the real collection — it
  // binds to the data, not the folder.
  const baseFile = slugToFilePath(slug);
  const baseDir = projectFS.exists(baseFile) ? baseFile.replace(/\/page\.(client\.)?tsx$/, '') : '';
  let serverPath: string;
  let clientPath: string;
  const blockedBy = opts.atRoot ? rootMountBlockedBy(slug) : null;
  if (blockedBy) {
    // The caller decides how to tell the user; returning '' rather than
    // scaffolding a nested page keeps a refusal from quietly succeeding
    // somewhere the user never asked for.
    trace.action('cms-page-ops:create-detail-root-taken', { slug, owner: blockedBy });
    return '';
  }
  if (opts.atRoot) {
    serverPath = 'app/[slug]/page.tsx';
    clientPath = 'app/[slug]/page.client.tsx';
  } else if (baseDir && !projectFS.exists(`${baseDir}/[slug]/page.client.tsx`)) {
    serverPath = `${baseDir}/[slug]/page.tsx`;
    clientPath = `${baseDir}/[slug]/page.client.tsx`;
  } else {
    const routeSlug = uniqueRouteSlug(slug, '/[slug]');
    serverPath = `app/${routeSlug}/[slug]/page.tsx`;
    clientPath = `app/${routeSlug}/[slug]/page.client.tsx`;
  }
  const pageName = schema?.name ? `${schema.name} Detail` : `${slug} Detail`;

  // Detail-scope JSX for every field — image at top, heading next, then
  // remaining fields in schema order. Centered 720px column gives a
  // readable article layout out of the box.
  //
  // The emitted find-by-slug line falls back to the first item so the page
  // still renders during navigation transitions or on a stale link. That
  // rationale lives HERE, not as a comment in the emitted code — generated
  // code carries no prose comments (the oracle's NO_COMMENTS rule; quotes in
  // comments corrupt the fast-path generators' string tracking, and the old
  // emitted comment literally contained "doesn't").
  const fieldsJsx = renderAllFields(schema, 'item', 'detail', headingField, bodyField);

  const apiConfig = getApiCollection(slug);
  const pageExportSignature = apiConfig
    ? `export default function Page({ item: serverItem }: { item?: any } = {}) {
  const params = useParams();
  const item = serverItem ?? (${varName}.find((i) => (i.slug || i._slug || String(i.id)) === params?.slug) ?? ${varName}[0]);`
    : `export default function Page() {
  const params = useParams();
  const item = ${varName}.find((i) => i._slug === params?.slug) ?? ${varName}[0];`;

  const code = `'use client';

${CANVAS_CONFIG_BLOCK}

/** @cmsPage {
  "collection": "${slug}",
  "kind": "detail"
} */

import React from 'react';
import { useParams } from 'next/navigation';
import ${varName} from '@/cms/${slug}.json';

${pageExportSignature}
  return (
    <div data-id="root" key={String(params?.slug ?? '')} data-name="${pageName}" style={{
      position: 'relative', width: '100%',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center',
      padding: '80px 40px',
      backgroundColor: '#ffffff'
    }}>
      <div data-id="article-container" style={{
        position: 'relative',
        width: '100%', maxWidth: '720px',
        display: 'flex', flexDirection: 'column',
        gap: '24px',
        order: '0', flex: '0 0 auto'
      }}>
${fieldsJsx}
      </div>
    </div>
  );
}`;

  // A detail page is ONE route rendering every item, so a static
  // `export const metadata` would stamp the same <title> on all of them.
  // The wrapper instead resolves its SEO per item from the collection,
  // seeded with the same fields the body uses for its heading and text.
  const seoBindings = defaultBindings(schema);
  projectFS.writeFile(serverPath, buildCmsDetailServerWrapper({ collection: slug, bindings: seoBindings }));
  projectFS.writeFile(clientPath, code);
  trace.action('cms-page-ops:create-detail', { serverPath, clientPath, slug, headingField, bodyField, seoBindings, fieldCount: schema?.fields.length });
  return clientPath;
}

// ─── @cmsPage annotation parsing ────────────────────────────────────────────
// Lives in cms-page-meta.ts (leaf) so cms-ops can parse the annotation
// without importing this module back (cms-ops ↔ cms-page-ops cycle);
// re-exported here for existing callers.

import { parseCmsPageMeta, type CmsPageMeta } from './cms-page-meta';
export { parseCmsPageMeta, type CmsPageMeta };

/**
 * Locate the EXISTING index/detail page of a collection, wherever it lives.
 *
 * The naive `projectFS.exists('app/<slug>/[slug]/page.client.tsx')` probe is
 * the bug behind "New CMS Page still offers Detail Page although
 * /collection-1/[slug] exists" (user report 2026-07-28) — applying a Template
 * moves pages into a route group, so the real file sits at
 * `app/(Body)/collection-1/[slug]/page.client.tsx`, invisible to the bare path.
 *
 * Resolution order:
 *  1. `@cmsPage { collection, kind }` annotation scan — authoritative. Survives
 *     route groups, a detail co-located under an index folder, AND a bumped
 *     route folder (`blog-2/[slug]` when `/blog` was taken) — the annotation
 *     names the collection regardless of where the folder ended up.
 *  2. Route probe via `slugToFilePath` (route-group aware) — index pages
 *     created before the annotation existed carry none.
 *
 * Returns the client-file path, or null when the page doesn't exist.
 */
export function findCmsPageFile(collection: string, kind: 'index' | 'detail'): string | null {
  for (const f of projectFS.listFiles('app/')) {
    if (!f.endsWith('page.client.tsx')) continue;
    const code = projectFS.readFile(f);
    if (!code || !code.includes('@cmsPage')) continue;
    const meta = parseCmsPageMeta(code);
    if (meta && meta.collection === collection && meta.kind === kind) {
      trace.fn('cms-page-ops:findCmsPageFile', { collection, kind, file: f, via: 'annotation' });
      return f;
    }
  }
  const probe = slugToFilePath(kind === 'detail' ? `${collection}/[slug]` : collection);
  if (projectFS.exists(probe)) {
    trace.fn('cms-page-ops:findCmsPageFile', { collection, kind, file: probe, via: 'route' });
    return probe;
  }
  return null;
}

// ─── Display helpers (shared by the slug breadcrumb + component breadcrumb) ──

/** Human-readable label for a CMS record WITHOUT needing the schema: the first
 *  non-underscore string field, falling back to its `_slug`. Used for the
 *  previewed-item label in the slug breadcrumb. */
export function cmsItemDisplayLabel(
  item: Record<string, any> | undefined | null,
  fallbackSlug?: string | null,
): string {
  if (!item) return fallbackSlug ?? '';
  const label = getItemDisplayLabel(item);
  return label || (fallbackSlug ?? '');
}

/** "blog-posts" / "blog_posts" → "Blog Posts" — collection slug to a title. */
export function prettyCollectionName(slug: string): string {
  return slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Arbitrary Collection Lists: Detection & Server Orchestration ──────────

export interface DetectedCollectionQuery {
  listId: string;
  source: string;
  queryConfig: CollectionQueryConfig;
}

/**
 * Find the closing `>` of a JSX opening tag, taking string literals and braces into account.
 */
export function findTagClose(code: string, startIdx: number): number {
  let braceDepth = 0;
  let inString: string | null = null;
  let escaped = false;

  for (let i = startIdx; i < code.length; i++) {
    const ch = code[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }

    if (inString) {
      if (ch === inString) inString = null;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      inString = ch;
      continue;
    }
    if (ch === '{') {
      braceDepth++;
      continue;
    }
    if (ch === '}') {
      braceDepth--;
      continue;
    }

    if (ch === '>' && braceDepth === 0) return i;
  }
  return -1;
}

/**
 * Finds the index of the matching `</tagName>` closing tag by balancing tag depth.
 */
export function findMatchingCloseTagIndex(code: string, tagName: string, fromIdx: number): number {
  const openPattern = `<${tagName}`;
  const closePattern = `</${tagName}>`;
  let depth = 1;
  let searchFrom = fromIdx;

  while (depth > 0 && searchFrom < code.length) {
    const nextOpen = code.indexOf(openPattern, searchFrom);
    const nextClose = code.indexOf(closePattern, searchFrom);
    if (nextClose === -1) return -1;

    if (nextOpen !== -1 && nextOpen < nextClose) {
      const after = code[nextOpen + openPattern.length];
      if (after === ' ' || after === '>' || after === '/' || after === '\n' || after === '\r' || after === '\t') {
        const gt = findTagClose(code, nextOpen + openPattern.length);
        if (gt === -1) return -1;
        if (code[gt - 1] !== '/') {
          depth++;
        }
        searchFrom = gt + 1;
      } else {
        searchFrom = nextOpen + openPattern.length;
      }
    } else {
      depth--;
      if (depth === 0) return nextClose;
      searchFrom = nextClose + closePattern.length;
    }
  }

  return -1;
}

/**
 * Extracts collection list containers with `data-query-config` from a client page.
 */
export function detectPageCollectionQueries(code: string): DetectedCollectionQuery[] {
  if (!code || !code.includes('data-query-config')) return [];
  const queries: DetectedCollectionQuery[] = [];

  const importMap = new Map<string, string>();
  const importRegex = /import\s+([a-zA-Z0-9_]+)\s+from\s+['"](?:@\/cms\/|\.\/cms\/|\.\.\/cms\/|cms\/)([^'"]+)\.json['"]/g;
  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(code)) !== null) {
    importMap.set(match[1], match[2]);
  }

  const tagStartRegex = /<([a-zA-Z0-9_-]+)\s+([^>]*data-query-config[^>]*)>/g;
  while ((match = tagStartRegex.exec(code)) !== null) {
    const tagName = match[1];
    const attrs = match[2];
    const openTagEnd = tagStartRegex.lastIndex;

    const idMatch = attrs.match(/data-id=["']([^"']+)["']/);
    const listId = idMatch ? idMatch[1] : '';
    if (!listId) continue;

    let queryConfig: any = null;
    const jsonStringifyMatch = attrs.match(/data-query-config=\{JSON\.stringify\(([\s\S]*?)\)\}/);
    if (jsonStringifyMatch) {
      const rawPayload = jsonStringifyMatch[1].trim();
      try {
        queryConfig = JSON.parse(rawPayload);
      } catch {
        try {
          const evalFn = new Function(`return (${rawPayload});`);
          queryConfig = evalFn();
        } catch {
          /* ignore parse failure */
        }
      }
    } else {
      const attrMatch = attrs.match(/data-query-config=(?:\{(['"`])([\s\S]*?)\1\}|["'](\{[\s\S]*?\})["'])/);
      if (attrMatch) {
        const raw = attrMatch[2] || attrMatch[3];
        try {
          queryConfig = JSON.parse(raw);
        } catch {
          /* ignore parse failure */
        }
      }
    }

    if (!queryConfig) continue;

    const closeIndex = findMatchingCloseTagIndex(code, tagName, openTagEnd);
    const innerContent = closeIndex !== -1 ? code.slice(openTagEnd, closeIndex) : code.slice(openTagEnd);

    let source = queryConfig.source || queryConfig.collection || '';
    if (!source) {
      const mapMatch = innerContent.match(/\{([a-zA-Z0-9_]+)(?:\.[a-zA-Z0-9_]+(?:\([^)]*\))?)*\s*\.map\(/);
      if (mapMatch) {
        const varName = mapMatch[1];
        source = importMap.get(varName) || varName;
      }
    }
    if (!source) {
      for (const [varName, colSlug] of importMap.entries()) {
        if (new RegExp(`\\b${varName}\\b[\\s\\S]*?\\.map\\(`).test(innerContent)) {
          source = colSlug;
          break;
        }
      }
    }
    if (!source && importMap.size === 1) {
      source = [...importMap.values()][0];
    }

    if (source) {
      queries.push({ listId, source, queryConfig });
    }
  }

  return queries;
}

/**
 * Wraps collection list mapping expressions inside collection containers so that they
 * evaluate against cmsDatasets if provided by the server wrapper:
 * `{items.map(...)` -> `{(cmsDatasets?.[listId] || cmsDatasets?.[source] || items).map(...)`
 * Also ensures Page component signature receives `cmsDatasets`.
 */
export function injectCmsDatasetsIntoClientPage(code: string, queries?: DetectedCollectionQuery[]): string {
  const detected = queries ?? detectPageCollectionQueries(code);
  if (!detected || detected.length === 0) return code;

  let result = code;

  for (const { listId, source } of detected) {
    const idAttr = `data-id="${listId}"`;
    const idIdx = result.indexOf(idAttr);
    if (idIdx === -1) continue;

    const elStart = result.lastIndexOf('<', idIdx);
    if (elStart === -1) continue;
    const tagClose = findTagClose(result, elStart + 1);
    if (tagClose === -1 || result[tagClose - 1] === '/') continue;

    const tagMatch = result.slice(elStart + 1).match(/^([a-zA-Z0-9_-]+)/);
    if (!tagMatch) continue;
    const tagName = tagMatch[1];

    const closeIdx = findMatchingCloseTagIndex(result, tagName, tagClose + 1);
    if (closeIdx === -1) continue;

    const inner = result.slice(tagClose + 1, closeIdx);
    if (inner.includes('cmsDatasets')) continue;

    const mapRegex = new RegExp(`(\\{\\s*)([a-zA-Z0-9_]+)(\\s*(?:\\.[a-zA-Z0-9_]+(?:\\([^)]*\\))?)*\\s*\\.map\\()`, 'g');
    if (!mapRegex.test(inner)) continue;

    const wrappedInner = inner.replace(
      mapRegex,
      `$1(cmsDatasets?.['${listId}'] || cmsDatasets?.['${source}'] || $2)$3`,
    );

    result = result.slice(0, tagClose + 1) + wrappedInner + result.slice(closeIdx);
  }

  if (!result.includes('cmsDatasets')) {
    return result;
  }

  if (/export\s+default\s+function\s+Page\s*\([^)]*cmsDatasets/.test(result)) {
    return result;
  }

  result = result.replace(
    /export\s+default\s+function\s+Page\s*\(([^)]*)\)/,
    (full, params) => {
      const trimmed = params.trim();
      if (!trimmed) {
        return `export default function Page({ cmsDatasets }: { cmsDatasets?: Record<string, any[]> } = {})`;
      }
      if (trimmed.startsWith('{') && trimmed.includes('}')) {
        const closeBraceIdx = trimmed.indexOf('}');
        const beforeClose = trimmed.slice(0, closeBraceIdx);
        const afterClose = trimmed.slice(closeBraceIdx);
        const withProp = `${beforeClose}, cmsDatasets ${afterClose}`;
        if (withProp.includes(': {')) {
          return `export default function Page(${withProp.replace(/: \{\s*/, ': { cmsDatasets?: Record<string, any[]>; ')}`;
        }
        return `export default function Page(${withProp})`;
      }
      return `export default function Page(${trimmed}, { cmsDatasets }: { cmsDatasets?: Record<string, any[]> } = {})`;
    },
  );

  return result;
}

/**
 * Emits server-side data fetching orchestration for arbitrary collection lists
 * into `page.tsx` and passes `cmsDatasets` to `<PageClient />`.
 */
export function orchestrateServerFetchForQueries(
  serverCode: string,
  queries: DetectedCollectionQuery[],
  apiConfigs?: Record<string, ApiCollectionConfig>,
): string {
  if (!queries || queries.length === 0) return serverCode;

  const apiQueries = queries.filter((q) => {
    const conf = (apiConfigs && apiConfigs[q.source]) || getApiCollection(q.source);
    return conf && conf.url;
  });

  if (apiQueries.length === 0) return serverCode;
  if (serverCode.includes('cmsDatasets[')) return serverCode;

  const hasExpressions = apiQueries.some((q) =>
    Array.isArray(q.queryConfig.params) && q.queryConfig.params.some((p) => p.isExpression),
  );

  const evaluateParamHelper = `function evaluateParam(expr: string, params: Record<string, any>): string {
  try {
    const val = new Function('params', 'routeParams', \`return (\${expr});\`)(params, params);
    return val !== undefined && val !== null ? String(val) : '';
  } catch {
    return '';
  }
}
`;

  const extractItemsHelper = `function extractItems(json: any, itemsKey?: string): any[] {
  if (!json || typeof json !== 'object') return Array.isArray(json) ? json : [];
  if (itemsKey) {
    const val = itemsKey.includes('.')
      ? itemsKey.split('.').reduce((acc: any, p: string) => acc?.[p], json)
      : json[itemsKey];
    if (Array.isArray(val)) return val;
  }
  if (Array.isArray(json)) return json;
  if (Array.isArray(json.data)) return json.data;
  if (Array.isArray(json.results)) return json.results;
  if (Array.isArray(json.items)) return json.items;
  return [];
}
`;

  const fetchLines: string[] = [];
  fetchLines.push('  const cmsDatasets: Record<string, any[]> = {};');

  apiQueries.forEach((q, idx) => {
    const conf = ((apiConfigs && apiConfigs[q.source]) || getApiCollection(q.source))!;
    const headersCode = serializeHeadersForCode(conf.headers);
    const revalidate = conf.cacheMaxAge ?? 14400;
    const methodLine = conf.method && conf.method.toUpperCase() !== 'GET'
      ? `\n        method: '${conf.method.toUpperCase()}',`
      : '';

    const lines: string[] = [];
    lines.push(`  const qParams_${idx} = new URLSearchParams();`);

    if (conf.defaultParams) {
      for (const [k, v] of Object.entries(conf.defaultParams)) {
        if (v !== undefined && v !== null && v !== '') {
          lines.push(`  qParams_${idx}.set(${JSON.stringify(k)}, ${JSON.stringify(String(v))});`);
        }
      }
    }

    if (Array.isArray(q.queryConfig.params)) {
      q.queryConfig.params.forEach((p, pIdx) => {
        if (!p.key) return;
        if (p.isExpression) {
          lines.push(`  const pVal_${idx}_${pIdx} = evaluateParam(${JSON.stringify(p.value)}, routeParams);`);
          lines.push(`  if (pVal_${idx}_${pIdx}) qParams_${idx}.set(${JSON.stringify(p.key)}, pVal_${idx}_${pIdx});`);
        } else {
          lines.push(`  qParams_${idx}.set(${JSON.stringify(p.key)}, ${JSON.stringify(p.value ?? '')});`);
        }
      });
    }

    const sep = conf.url.includes('?') ? '&' : '?';
    lines.push(`  const qs_${idx} = qParams_${idx}.toString();`);
    lines.push(`  const url_${idx} = \`${conf.url}\${qs_${idx} ? ('${sep}' + qs_${idx}) : ''}\`;`);
    lines.push(`  try {`);
    lines.push(`    const res_${idx} = await fetch(url_${idx}, {${methodLine}`);
    lines.push(`      headers: ${headersCode},`);
    lines.push(`      signal: AbortSignal.timeout(10000),`);
    lines.push(`      next: { revalidate: ${revalidate} },`);
    lines.push(`    });`);
    lines.push(`    if (res_${idx}.ok) {`);
    lines.push(`      const json_${idx} = await res_${idx}.json();`);
    lines.push(`      const items_${idx} = extractItems(json_${idx}${conf.itemsKey ? `, ${JSON.stringify(conf.itemsKey)}` : ''});`);
    lines.push(`      cmsDatasets[${JSON.stringify(q.listId)}] = items_${idx};`);
    lines.push(`      if (!cmsDatasets[${JSON.stringify(q.source)}]) {`);
    lines.push(`        cmsDatasets[${JSON.stringify(q.source)}] = items_${idx};`);
    lines.push(`      }`);
    lines.push(`    } else {`);
    lines.push(`      console.error('Failed to fetch CMS dataset for ${q.listId}: ' + res_${idx}.status);`);
    lines.push(`    }`);
    lines.push(`  } catch (err) {`);
    lines.push(`    console.error('Error fetching CMS dataset for ${q.listId}:', err);`);
    lines.push(`  }`);

    fetchLines.push(lines.join('\n'));
  });

  let updated = serverCode;

  let helpersToInsert = '';
  if (hasExpressions && !updated.includes('function evaluateParam')) {
    helpersToInsert += `${evaluateParamHelper}\n`;
  }
  if (!updated.includes('function extractItems')) {
    helpersToInsert += `${extractItemsHelper}\n`;
  }

  const pageFnMatch = updated.match(/export\s+default\s+(async\s+)?function\s+Page\s*\(([^)]*)\)\s*\{/);
  if (!pageFnMatch) return updated;

  const fnSignature = pageFnMatch[0];
  const fnParams = pageFnMatch[2]?.trim() || '';

  let newSignature = fnSignature;
  if (!fnSignature.includes('async')) {
    newSignature = newSignature.replace(/export\s+default\s+function/, 'export default async function');
  }
  if (!fnParams || fnParams === '') {
    newSignature = newSignature.replace(
      /Page\s*\(\s*\)/,
      'Page({ params }: { params?: Promise<Record<string, string | string[]>> } = {})',
    );
  }

  let routeParamsInit = '';
  if (!updated.includes('routeParams')) {
    if (updated.includes('await params')) {
      routeParamsInit = '  const routeParams = (await params) as Record<string, any>;\n';
    } else {
      routeParamsInit = '  const routeParams = (params ? await params : {}) as Record<string, any>;\n';
    }
  }

  updated = updated.replace(fnSignature, `${helpersToInsert}${newSignature}\n${routeParamsInit}${fetchLines.join('\n\n')}\n`);

  if (!updated.includes('cmsDatasets={cmsDatasets}')) {
    updated = updated.replace(/<PageClient(\s+[^>]*)?\/>/, (full, existingProps) => {
      const trimmed = (existingProps || '').trim();
      const props = trimmed ? ` ${trimmed} cmsDatasets={cmsDatasets}` : ' cmsDatasets={cmsDatasets}';
      return `<PageClient${props} />`;
    });
  }

  return updated;
}

// ─── API CMS Config Synchronization & Wrapper Migration ───────────────────

/**
 * Generates or updates the server page.tsx wrapper for a CMS index page.
 * Preserves custom metadata, layouts, route parameters, and additional fetch orchestration.
 */
export function buildCmsIndexServerWrapper(
  collectionSlug: string,
  apiConfig: ApiCollectionConfig,
  existingServerCode?: string,
): string {
  const headersCode = serializeHeadersForCode(apiConfig.headers);
  const revalidate = apiConfig.cacheMaxAge ?? 14400;
  const defaultQuery = new URLSearchParams();
  if (apiConfig.defaultParams) {
    for (const [k, v] of Object.entries(apiConfig.defaultParams)) {
      if (v !== undefined && v !== null && v !== '') defaultQuery.set(k, String(v));
    }
  }
  const defaultQueryStr = defaultQuery.toString();
  const fetchUrl = defaultQueryStr
    ? `${apiConfig.url}${apiConfig.url.includes('?') ? '&' : '?'}${defaultQueryStr}`
    : apiConfig.url;
  const itemsExtract = apiConfig.itemsKey
    ? `(Array.isArray(json[${JSON.stringify(apiConfig.itemsKey)}]) ? json[${JSON.stringify(apiConfig.itemsKey)}] : [])`
    : `(Array.isArray(json) ? json : (Array.isArray(json.data) ? json.data : (Array.isArray(json.results) ? json.results : [])))`;

  const methodLine = apiConfig.method && apiConfig.method.toUpperCase() !== 'GET'
    ? `\n    method: '${apiConfig.method.toUpperCase()}',`
    : '';

  // Preserve existing metadata export if present
  let metadataBlock = 'export const metadata = {};';
  if (existingServerCode) {
    const metaMatch = existingServerCode.match(/export\s+const\s+metadata\s*=\s*(\{[\s\S]*?\});/);
    if (metaMatch) {
      metadataBlock = `export const metadata = ${metaMatch[1].trim()};`;
    }
  }

  // Preserve custom imports (excluding PageClient and cms json imports)
  const customImports: string[] = [];
  if (existingServerCode) {
    const importRegex = /import\s+[^;]+from\s+['"][^'"]+['"];?/g;
    let m: RegExpExecArray | null;
    while ((m = importRegex.exec(existingServerCode)) !== null) {
      const imp = m[0].trim();
      if (!imp.includes('./page.client') && !imp.includes('/cms/') && !customImports.includes(imp)) {
        customImports.push(imp);
      }
    }
  }

  // Preserve custom layout wrapper around PageClient if present
  let returnJsx = '<PageClient items={items} />;';
  if (existingServerCode) {
    const returnMatch = existingServerCode.match(/return\s*\(\s*(<[\s\S]*?PageClient[\s\S]*?>)\s*\);/)
      || existingServerCode.match(/return\s*(<[\s\S]*?PageClient[\s\S]*?\/>);/);
    if (returnMatch) {
      const rawReturn = returnMatch[1].trim();
      if (rawReturn.includes('cmsDatasets')) {
        returnJsx = rawReturn.replace(/<PageClient[^>]*\/>/, '<PageClient items={items} cmsDatasets={cmsDatasets} />') + ';';
      } else if (
        rawReturn !== '<PageClient />' &&
        rawReturn !== '<PageClient items={items} />'
      ) {
        returnJsx = rawReturn.replace(/<PageClient[^>]*\/>/, '<PageClient items={items} />') + ';';
      }
    }
  }

  // Preserve route params if Page had params parameter
  let paramsSignature = '';
  let routeParamsInit = '';
  if (existingServerCode) {
    const pageFnMatch = existingServerCode.match(/export\s+default\s+(async\s+)?function\s+Page\s*\(([^)]*)\)/);
    if (pageFnMatch && pageFnMatch[2].trim()) {
      paramsSignature = pageFnMatch[2].trim();
      if (existingServerCode.includes('routeParams') && existingServerCode.includes('await params')) {
        routeParamsInit = '\n  const routeParams = (params ? await params : {}) as Record<string, any>;';
      }
    }
  }

  const fnParamStr = paramsSignature ? paramsSignature : '';
  const importsStr = customImports.length > 0 ? `\n${customImports.join('\n')}` : '';

  return `import PageClient from './page.client';${importsStr}

${metadataBlock}

export default async function Page(${fnParamStr}) {${routeParamsInit}
  const res = await fetch(\`${fetchUrl}\`, {${methodLine}
    headers: ${headersCode},
    signal: AbortSignal.timeout(10000),
    next: { revalidate: ${revalidate} },
  });
  if (!res.ok) {
    throw new Error(\`Failed to fetch CMS index for ${collectionSlug}: \${res.status} \${res.statusText}\`);
  }
  const json = await res.json();
  const items = ${itemsExtract};
  return ${returnJsx}
}
`;
}

/**
 * Repaired legacy auto-generated `{item.img_file.metadata}` bindings to safe string representations
 * so rendering nested metadata objects in React components will not trigger child-object crashes.
 */
export function repairLegacyDetailBindings(code: string): string {
  let result = code;
  result = result.replace(
    /\{item(?:\.|\?\.)([A-Za-z0-9_]+)(?:\.|\?\.)metadata\}/g,
    `{typeof item.$1?.metadata === 'object' ? JSON.stringify(item.$1?.metadata) : (item.$1?.metadata ?? '')}`,
  );
  result = result.replace(
    /\{item(?:\.|\?\.)metadata\}/g,
    `{typeof item?.metadata === 'object' ? JSON.stringify(item?.metadata) : (item?.metadata ?? '')}`,
  );
  result = result.replace(
    /(<(?:p|span|div|h[1-6]|li)\b[^>]*>)\s*\{item(?:\.|\?\.)([A-Za-z0-9_.]+)\}\s*(<\/(?:p|span|div|h[1-6]|li)>)/g,
    (match, openTag, propPath, closeTag) => {
      const primitives = ['title', 'id', 'slug', 'rank', 'date_updated', 'seo_title', 'seo_description', 'deskription', 'alt_text', 'name'];
      if (primitives.includes(propPath)) {
        return `${openTag}{item.${propPath}}${closeTag}`;
      }
      const safePath = 'item?.' + propPath.replace(/\./g, '?.');
      return `${openTag}{typeof ${safePath} === 'object' && ${safePath} !== null ? (${safePath}?.name || ${safePath}?.title || (Array.isArray(${safePath}) ? ${safePath}.map((c: any) => typeof c === 'object' ? (c?.name || c?.title || c?.id || '') : c).filter(Boolean).join(', ') : JSON.stringify(${safePath}))) : (${safePath} ?? '')}${closeTag}`;
    },
  );
  return result;
}

/**
 * Repairs bare `alt` attributes on <img> tags (e.g. `<img ... alt />` which compiles to `alt={true}`)
 * to standard string attributes `alt=""`.
 */
export function repairBareAltAttributes(code: string): string {
  return code.replace(/(<img\b[^>]*?)(\balt\b)(?!\s*=)([^>]*?>?)/gs, (match) => {
    return match.replace(/\balt\b(?!\s*=)/, 'alt=""');
  });
}

export function isDetailPageForCollection(
  pagePath: string,
  collectionSlug: string,
  clientCode: string,
  serverCode: string,
): boolean {
  // 1. Check for @cmsPage annotation in client or server code
  const codeWithAnnotation = (clientCode.includes('@cmsPage') && clientCode) || (serverCode.includes('@cmsPage') && serverCode);
  if (codeWithAnnotation) {
    const meta = parseCmsPageMeta(codeWithAnnotation);
    if (meta) {
      return meta.collection === collectionSlug && meta.kind === 'detail';
    }
  }

  // 2. When @cmsPage is NOT present, match only if the route folder explicitly corresponds to collectionSlug/[slug]
  if (pagePath.endsWith('/[slug]/page.tsx') || pagePath.includes('/[slug]/')) {
    const normalized = pagePath.replace(/\/\([^)]+\)/g, '');
    const parts = normalized.split('/').filter(Boolean);
    const slugIdx = parts.indexOf('[slug]');
    if (slugIdx > 0 && parts[slugIdx - 1] === collectionSlug) {
      return true;
    }
  }

  return false;
}

export function isIndexPageForCollection(
  pagePath: string,
  collectionSlug: string,
  clientCode: string,
  serverCode: string,
): boolean {
  // Never treat a dynamic [slug] detail page as an index page
  if (pagePath.includes('/[slug]/') || pagePath.endsWith('/[slug]/page.tsx')) {
    return false;
  }

  // 1. Check for @cmsPage annotation in client or server code
  const codeWithAnnotation = (clientCode.includes('@cmsPage') && clientCode) || (serverCode.includes('@cmsPage') && serverCode);
  if (codeWithAnnotation) {
    const meta = parseCmsPageMeta(codeWithAnnotation);
    if (meta) {
      return meta.collection === collectionSlug && meta.kind === 'index';
    }
  }

  // 2. When @cmsPage is NOT present, only match if the route folder explicitly corresponds to collectionSlug
  const normalized = pagePath.replace(/\/\([^)]+\)/g, '');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length >= 2 && parts[parts.length - 2] === collectionSlug && parts[parts.length - 1] === 'page.tsx') {
    return true;
  }

  return false;
}

/**
 * Scans ProjectFS for all index and detail pages associated with collectionSlug,
 * upgrading local server wrappers to API fetch wrappers and synchronizing
 * endpoint URL, method, headers, revalidation, and items extraction.
 * Preserves user code, SEO bindings, route parameters, and layout components.
 */
export function syncAffectedCmsPageWrappers(
  collectionSlug: string,
  apiConfig: ApiCollectionConfig,
): string[] {
  const modified: string[] = [];
  const allFiles = projectFS.listFiles('app/');
  const pageFiles = allFiles.filter(f => f === 'app/page.tsx' || f.endsWith('/page.tsx'));

  for (const pagePath of pageFiles) {
    const clientPath = pagePath.replace(/\/page\.tsx$/, '/page.client.tsx');
    const hasClient = projectFS.exists(clientPath);
    const clientCode = hasClient ? projectFS.readFile(clientPath) || '' : '';
    const serverCode = projectFS.readFile(pagePath) || '';

    const isDetail = isDetailPageForCollection(pagePath, collectionSlug, clientCode, serverCode);
    const isIndex = !isDetail && isIndexPageForCollection(pagePath, collectionSlug, clientCode, serverCode);

    if (isDetail) {
      // 1. Sync detail server wrapper
      const defaults = parseCmsSeoDefaults(serverCode);
      const bindings = parseCmsSeoBindings(serverCode);
      const includeStaticParams = hasGenerateStaticParams(serverCode)
        ? true
        : serverCode.includes('dynamicParams')
          ? false
          : undefined;

      let newServerCode = buildCmsDetailServerWrapper({
        collection: collectionSlug,
        defaults,
        bindings,
        includeStaticParams,
        apiConfig,
      });

      // Preserve custom imports
      const customImports: string[] = [];
      const importRegex = /import\s+[^;]+from\s+['"][^'"]+['"];?/g;
      let m: RegExpExecArray | null;
      while ((m = importRegex.exec(serverCode)) !== null) {
        const imp = m[0].trim();
        if (
          !imp.includes('./page.client') &&
          !imp.includes('next/navigation') &&
          !imp.includes('/cms/') &&
          !customImports.includes(imp)
        ) {
          customImports.push(imp);
        }
      }
      if (customImports.length > 0) {
        newServerCode = newServerCode.replace(
          "import PageClient from './page.client';",
          `import PageClient from './page.client';\n${customImports.join('\n')}`,
        );
      }

      // Preserve custom layout wrapper around PageClient if present
      const returnMatch = serverCode.match(/return\s*\(\s*(<[\s\S]*?PageClient[\s\S]*?>)\s*\);/)
        || serverCode.match(/return\s*(<[\s\S]*?PageClient[\s\S]*?\/>);/);
      if (returnMatch) {
        const rawReturn = returnMatch[1].trim();
        if (
          rawReturn !== '<PageClient />' &&
          rawReturn !== '<PageClient item={item} />' &&
          rawReturn !== '<PageClient items={items} />'
        ) {
          const customWrapperReturn = rawReturn.replace(/<PageClient[^>]*\/>/, '<PageClient item={item} />');
          newServerCode = newServerCode.replace(
            'return <PageClient item={item} />;',
            `return ${customWrapperReturn};`,
          );
        }
      }

      if (newServerCode !== serverCode) {
        projectFS.writeFile(pagePath, newServerCode);
        modified.push(pagePath);
      }

      // 2. Sync / repair detail client file
      if (hasClient) {
        let updatedClient = clientCode;

        // Upgrade signature if local
        if (
          updatedClient.includes('export default function Page() {') &&
          !updatedClient.includes('serverItem')
        ) {
          const varName = collectionVarName(collectionSlug);
          updatedClient = updatedClient.replace(
            'export default function Page() {',
            'export default function Page({ item: serverItem }: { item?: any } = {}) {',
          );
          updatedClient = updatedClient.replace(
            new RegExp(`const item = ${varName}\\.find\\([\\s\\S]*?\\)(?:\\s*\\?\\?\\s*${varName}\\[0\\])?;`),
            `const item = serverItem ?? (${varName}.find((i) => (i.slug || i._slug || String(i.id)) === params?.slug) ?? ${varName}[0]);`,
          );
        }

        // Repair legacy {item.img_file.metadata}
        updatedClient = repairLegacyDetailBindings(updatedClient);

        // Repair bare alt
        updatedClient = repairBareAltAttributes(updatedClient);

        if (updatedClient !== clientCode) {
          projectFS.writeFile(clientPath, updatedClient);
          modified.push(clientPath);
        }
      }
    } else if (isIndex) {
      // 1. Sync index server wrapper
      let newServerCode = buildCmsIndexServerWrapper(collectionSlug, apiConfig, serverCode);

      // If client page had data-query-config queries, re-orchestrate server fetch if needed
      if (hasClient) {
        const queries = detectPageCollectionQueries(clientCode);
        if (queries.length > 0) {
          newServerCode = orchestrateServerFetchForQueries(newServerCode, queries, { [collectionSlug]: apiConfig });
        }
      }

      if (newServerCode !== serverCode) {
        projectFS.writeFile(pagePath, newServerCode);
        modified.push(pagePath);
      }

      // 2. Sync index client file if upgrading from local
      if (hasClient) {
        let updatedClient = clientCode;
        if (
          updatedClient.includes('export default function Page() {') &&
          !updatedClient.includes('serverItems')
        ) {
          const varName = collectionVarName(collectionSlug);
          if (updatedClient.includes(`import ${varName} from '@/cms/${collectionSlug}.json';`)) {
            updatedClient = updatedClient.replace(
              'export default function Page() {',
              `export default function Page({ items: serverItems }: { items?: any[] } = {}) {\n  const items = serverItems ?? ${varName};`,
            );
            updatedClient = updatedClient.replace(
              `{${varName}.map((item, idx) => (`,
              `{items.map((item, idx) => (`,
            );
          }
        }

        // Repair bare alt
        updatedClient = repairBareAltAttributes(updatedClient);

        if (updatedClient !== clientCode) {
          projectFS.writeFile(clientPath, updatedClient);
          modified.push(clientPath);
        }
      }
    }
  }

  trace.action('cms-page-ops:syncAffectedCmsPageWrappers', { collectionSlug, modifiedCount: modified.length, modified });
  return modified;
}
