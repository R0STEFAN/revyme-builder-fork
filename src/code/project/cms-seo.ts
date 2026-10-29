// cms-seo.ts — per-ITEM SEO for a CMS detail (`[slug]`) page.
//
// A normal page has one title. A detail page is one route that renders every
// item in a collection, so a single static title would put the same
// `<title>` on all of them — which is what the SEO panel used to write. What
// the user actually wants is "title = the item's Name field", resolved per
// URL.
//
// Next.js has exactly one mechanism for that: `generateMetadata({ params })`,
// a SERVER function that receives the resolved route params. So a bound
// detail page's server wrapper looks like:
//
//   import PageClient from './page.client';
//   import articles from '@/cms/articles.json';
//
//   const seoDefaults = { title: 'Blog', … };
//   const seoBindings = { title: 'name', description: 'excerpt' };
//
//   export async function generateMetadata({ params }) { … }
//   export default function Page() { return <PageClient />; }
//
// Three things that look like details and are not:
//
//  1. `metadata` is a LOCAL const, not an export. A module may not export
//     both `metadata` and `generateMetadata` — Next.js fails the build with
//     "Cannot define both", and vinext silently prefers the function, so the
//     panel's edits would appear saved and never render. Keeping the static
//     values local means one exported source of truth.
//
//  2. `params` must be AWAITED. vinext passes a thenable (its
//     `makeThenableParams`), matching Next 15, so `params.slug` without the
//     await is `undefined` and every page silently falls back.
//
//  3. The binding is stored as a FIELD ID, never as an interpolated string.
//     A token like `{{item.name}}` would have to survive the Next source
//     export, the static export and the preview sandbox intact; a field id
//     read at runtime does not.

import {
  parseLocalObjectFromCode,
  updateMetadataInCode,
  extractExportObject,
  moduleParses,
  type SiteMetadata,
} from '../generation/metadata-gen';
import type { CollectionSchema, FieldDefinition } from '@/shared/types';
import { getApiCollection, type ApiCollectionConfig } from './cms-api-config';

/** The SEO slots that can take a per-item binding.
 *
 *  Deliberately not canonical URL (per-item canonicals are derived from the
 *  route, not authored) and not robots (a boolean, not text). */
export const CMS_SEO_SLOTS = [
  { key: 'title', label: 'Title', kind: 'text' },
  { key: 'description', label: 'Description', kind: 'text' },
  { key: 'ogTitle', label: 'OG title', kind: 'text' },
  { key: 'ogDescription', label: 'OG description', kind: 'text' },
  { key: 'ogImage', label: 'OG image', kind: 'image' },
  { key: 'twitterTitle', label: 'Twitter title', kind: 'text' },
  { key: 'twitterDescription', label: 'Twitter description', kind: 'text' },
  { key: 'twitterImage', label: 'Twitter image', kind: 'image' },
] as const;

export type CmsSeoSlot = typeof CMS_SEO_SLOTS[number]['key'];
/** slot → collection field id. A missing key means "use the static value". */
export type CmsSeoBindings = Partial<Record<CmsSeoSlot, string>>;

const SLOT_KINDS = new Map(CMS_SEO_SLOTS.map((s) => [s.key as CmsSeoSlot, s.kind]));

/** Field types that read as prose — anything that can sensibly be a title or
 *  a description. `slug` is included because it is always present and makes a
 *  passable last-resort title; `richtext` is legacy (imported collections)
 *  but still appears in real schemas. */
const TEXT_TYPES = new Set<FieldDefinition['type']>(['text', 'textarea', 'richtext', 'slug']);
const IMAGE_TYPES = new Set<FieldDefinition['type']>(['image', 'file']);

/** The fields offerable for one slot. Images only for image slots: pointing
 *  `og:image` at a text field produces a broken card, silently. */
export function bindableFields(schema: CollectionSchema | null, slot: CmsSeoSlot): FieldDefinition[] {
  if (!schema) return [];
  const want = SLOT_KINDS.get(slot) === 'image' ? IMAGE_TYPES : TEXT_TYPES;
  return schema.fields.filter((f) => want.has(f.type));
}

/** Sensible bindings for a NEW detail page, so per-item SEO works before the
 *  user opens the panel at all. Mirrors how the page body itself picks its
 *  heading and body fields. */
export function defaultBindings(schema: CollectionSchema | null): CmsSeoBindings {
  if (!schema) return {};
  const text = schema.fields.filter((f) =>
    TEXT_TYPES.has(f.type) &&
    f.type !== 'slug' &&
    !schema.fields.some(other => other.id.startsWith(`${f.id}.`)),
  );
  const image = schema.fields.find((f) => IMAGE_TYPES.has(f.type));
  const title = text[0];
  const body = text.find((f) => f.id !== title?.id);
  const out: CmsSeoBindings = {};
  if (title) out.title = title.id;
  if (body) out.description = body.id;
  if (image) out.ogImage = image.id;
  return out;
}

// ─── Read ───────────────────────────────────────────────────────────────────

/** True when this server wrapper already carries per-item SEO. */
export function hasCmsSeo(serverCode: string): boolean {
  return /export\s+async\s+function\s+generateMetadata\b/.test(serverCode);
}

/** The slot → field map a wrapper was generated with. */
export function parseCmsSeoBindings(serverCode: string): CmsSeoBindings {
  const raw = parseLocalObjectFromCode(serverCode, 'seoBindings');
  const out: CmsSeoBindings = {};
  for (const { key } of CMS_SEO_SLOTS) {
    const v = raw[key];
    if (typeof v === 'string' && v) out[key as CmsSeoSlot] = v;
  }
  return out;
}

/** The static fallbacks, in the same flat shape the SEO form uses. */
export function parseCmsSeoDefaults(serverCode: string): Record<string, any> {
  return parseLocalObjectFromCode(serverCode, 'seoDefaults');
}

export type CmsSeoExpressions = Partial<Record<string, string>>;

export interface SchemaOrgConfig {
  type?: string; // 'Article' | 'Product' | 'Organization' | 'LocalBusiness' | 'FAQPage' | 'Custom'
  bindings?: Record<string, string>;
  expressions?: Record<string, string>;
  staticValues?: Record<string, unknown>;
  rawJsonLd?: string;
}

export function parseCmsSchemaOrg(serverCode: string): SchemaOrgConfig | null {
  const raw = parseLocalObjectFromCode(serverCode, 'schemaOrg');
  if (!raw || Object.keys(raw).length === 0 || !raw.type) return null;
  return {
    type: typeof raw.type === 'string' ? raw.type : undefined,
    bindings: typeof raw.bindings === 'object' && raw.bindings !== null ? raw.bindings : {},
    expressions: typeof raw.expressions === 'object' && raw.expressions !== null ? raw.expressions : {},
    staticValues: typeof raw.staticValues === 'object' && raw.staticValues !== null ? raw.staticValues : {},
    rawJsonLd: typeof raw.rawJsonLd === 'string' ? raw.rawJsonLd : undefined,
  };
}

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

// ─── Write ──────────────────────────────────────────────────────────────────

/** kebab-or-digit-leading collection slug → a legal JS identifier. Mirrors
 *  `collectionVarName` in cms-page-ops so the two wrappers agree. */
function importVarName(collection: string): string {
  const camel = collection.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
  return /^[0-9]/.test(camel) ? `cms${camel[0]!.toUpperCase()}${camel.slice(1)}` : camel;
}

function literal(value: unknown): string {
  return JSON.stringify(value ?? '');
}

/** Emit `{ a: 'x', b: 'y' }` on one line, or `{}` when empty. */
function inlineObject(entries: Array<[string, unknown]>): string {
  const kept = entries.filter(([, v]) => v !== undefined && v !== '' && v !== null);
  if (kept.length === 0) return '{}';
  return `{ ${kept.map(([k, v]) => `${k}: ${literal(v)}`).join(', ')} }`;
}

export function serializeHeadersForCode(headers: Record<string, string> | undefined): string {
  if (!headers || Object.keys(headers).length === 0) return '{}';
  const entries: string[] = [];
  for (const [k, v] of Object.entries(headers)) {
    if (!v) continue;
    if (v.includes('process.env.')) {
      const replaced = v.replace(/process\.env\.([A-Za-z0-9_]+)/g, '${process.env.$1}');
      entries.push(`${JSON.stringify(k)}: \`${replaced}\``);
    } else if (v.includes('env:')) {
      const replaced = v.replace(/env:([A-Za-z0-9_]+)/g, '${process.env.$1}');
      entries.push(`${JSON.stringify(k)}: \`${replaced}\``);
    } else if (v.includes('$')) {
      const replaced = v.replace(/\$([A-Za-z0-9_]+)/g, '${process.env.$1}');
      entries.push(`${JSON.stringify(k)}: \`${replaced}\``);
    } else {
      entries.push(`${JSON.stringify(k)}: ${JSON.stringify(v)}`);
    }
  }
  return `{\n    ${entries.join(',\n    ')}\n  }`;
}

export interface BuildDetailWrapperInput {
  collection: string;
  /** Static values, used when a slot has no binding or the item's field is
   *  empty. Flat keys matching CMS_SEO_SLOTS, plus `canonical`/robots. */
  defaults?: Record<string, unknown>;
  bindings?: CmsSeoBindings;
  expressions?: CmsSeoExpressions;
  includeStaticParams?: boolean;
  apiConfig?: ApiCollectionConfig | null;
  schemaOrg?: SchemaOrgConfig | null;
}

/**
 * The complete server wrapper for a CMS detail page.
 *
 * Regenerated whole on every save rather than patched: the file is
 * builder-owned (the AI gate refuses `page.tsx`, the code editor is
 * read-only for non-admins), its shape is fixed, and a patcher would be a
 * second parser to keep in sync with this emitter.
 *
 * The emitted `generateMetadata` is defensive on purpose — this file is
 * never seen by the oracle (server wrappers get no FileKind) and ships to
 * production verbatim, so a malformed `cms/*.json` must degrade to the
 * static defaults rather than throw and 500 the route.
 */
export function buildCmsDetailServerWrapper(input: BuildDetailWrapperInput): string {
  const { collection, defaults = {}, bindings = {}, expressions = {}, includeStaticParams } = input;
  const apiConfig = input.apiConfig !== undefined ? input.apiConfig : getApiCollection(collection);
  const varName = importVarName(collection);

  const defaultsLiteral = inlineObject([
    ['title', defaults.title],
    ['description', defaults.description],
    ['ogTitle', defaults.ogTitle],
    ['ogDescription', defaults.ogDescription],
    ['ogImage', defaults.ogImage],
    ['twitterCard', defaults.twitterCard],
    ['twitterTitle', defaults.twitterTitle],
    ['twitterDescription', defaults.twitterDescription],
    ['twitterImage', defaults.twitterImage],
    ['canonical', defaults.canonical],
  ]);
  const bindingsLiteral = inlineObject(CMS_SEO_SLOTS.map(({ key }) => [key, bindings[key as CmsSeoSlot]]));

  const allExpressionSlots = [
    'title', 'description', 'canonical',
    'ogTitle', 'ogDescription', 'ogImage',
    'twitterTitle', 'twitterDescription', 'twitterImage',
  ];
  const expressionsLiteral = inlineObject(allExpressionSlots.map((key) => [key, expressions[key]]));
  const schemaOrg = input.schemaOrg;
  const schemaOrgLiteral = schemaOrg && schemaOrg.type
    ? `\nconst schemaOrg = ${JSON.stringify(schemaOrg, null, 2)};\n`
    : '';

  const robots = defaults.robotsIndex === false || defaults.robotsFollow === false
    ? `\n    robots: { index: ${defaults.robotsIndex !== false}, follow: ${defaults.robotsFollow !== false} },`
    : '';

  if (apiConfig) {
    const headersCode = serializeHeadersForCode(apiConfig.headers);
    const revalidate = apiConfig.cacheMaxAge ?? 14400;

    let slugParam = 'filter[slug][_eq]';
    if (apiConfig.provider === 'baserow') slugParam = 'filter__slug__equal';
    else if (apiConfig.provider === 'strapi') slugParam = 'filters[slug][$eq]';

    const defaultQuery = new URLSearchParams();
    if (apiConfig.defaultParams) {
      for (const [k, v] of Object.entries(apiConfig.defaultParams)) {
        if (v !== undefined && v !== null) defaultQuery.set(k, String(v));
      }
    }
    if (Array.isArray(apiConfig.defaultQueryParams)) {
      for (const p of apiConfig.defaultQueryParams) {
        if (!p.key) continue;
        if (!p.isExpression && p.value !== undefined && p.value !== null && !defaultQuery.has(p.key)) {
          defaultQuery.set(p.key, String(p.value));
        }
      }
    }
    const defaultQueryStr = defaultQuery.toString();
    const endpointBase = apiConfig.url;
    const separator = endpointBase.includes('?') ? '&' : '?';
    const baseWithDefaults = defaultQueryStr
      ? `${endpointBase}${separator}${defaultQueryStr}`
      : endpointBase;
    const finalSeparator = baseWithDefaults.includes('?') ? '&' : '?';

    const hasDefaultExprs = Array.isArray(apiConfig.defaultQueryParams) && apiConfig.defaultQueryParams.some((p) => p.isExpression);
    const evalHelper = hasDefaultExprs
      ? `\nfunction evaluateParam(expr: string, params: Record<string, any>): string {
  try {
    const val = new Function('params', 'routeParams', \`return (\${expr});\`)(params, params);
    return val !== undefined && val !== null ? String(val) : '';
  } catch {
    return '';
  }
}\n`
      : '';

    const itemExtract = apiConfig.itemsKey
      ? `json[${JSON.stringify(apiConfig.itemsKey)}]?.[0]`
      : `(Array.isArray(json) ? json[0] : (json.data?.[0] ?? json.results?.[0]))`;

    const itemsExtract = apiConfig.itemsKey
      ? `(Array.isArray(json[${JSON.stringify(apiConfig.itemsKey)}]) ? json[${JSON.stringify(apiConfig.itemsKey)}] : [])`
      : `(Array.isArray(json) ? json : (Array.isArray(json.data) ? json.data : (Array.isArray(json.results) ? json.results : [])))`;

    const methodLine = apiConfig.method && apiConfig.method.toUpperCase() !== 'GET'
      ? `\n    method: '${apiConfig.method.toUpperCase()}',`
      : '';

    const buildEndpointExpr = (forStatic?: boolean) => {
      if (!hasDefaultExprs) {
        return forStatic
          ? `\`${baseWithDefaults}${finalSeparator}fields=slug&limit=500\``
          : `\`${baseWithDefaults}${finalSeparator}${slugParam}=\${encodeURIComponent(slug)}&limit=1\``;
      }
      if (forStatic) {
        const exprs = apiConfig.defaultQueryParams!
          .filter((p) => p.isExpression && p.key)
          .map((p, i) => `const pVal_${i} = evaluateParam(${JSON.stringify(p.value)}, { lang }); if (pVal_${i}) qp.set(${JSON.stringify(p.key)}, pVal_${i});`)
          .join(' ');
        return `(() => { const qp = new URLSearchParams(); ${exprs}; const qs = qp.toString(); return \`${baseWithDefaults}\${qs ? ('${finalSeparator}' + qs + '&') : '${finalSeparator}'}fields=slug&limit=500\`; })()`;
      }
      const exprs = apiConfig.defaultQueryParams!
        .filter((p) => p.isExpression && p.key)
        .map((p, i) => `const pVal_${i} = evaluateParam(${JSON.stringify(p.value)}, { slug, lang }); if (pVal_${i}) qp.set(${JSON.stringify(p.key)}, pVal_${i});`)
        .join(' ');
      return `(() => { const qp = new URLSearchParams(); ${exprs}; const qs = qp.toString(); return \`${baseWithDefaults}\${qs ? ('${finalSeparator}' + qs + '&') : '${finalSeparator}'}${slugParam}=\${encodeURIComponent(slug)}&limit=1\`; })()`;
    };

    const staticParams = includeStaticParams !== false
      ? `\nexport async function generateStaticParams({ params }: { params?: { lang?: string } } = {}) {
  const lang = params?.lang;
  const endpoint = ${buildEndpointExpr(true)};
  try {
    const res = await fetch(endpoint, {${methodLine}
      headers: ${headersCode},
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const json = await res.json();
    const items = ${itemsExtract};
    return items
      .filter((i: any) => i && (i.slug || i._slug))
      .map((i: any) => ({ slug: String(i.slug || i._slug) }));
  } catch (err) {
    console.error('Failed to generate static params for ${collection}:', err);
    return [];
  }
}\n`
      : '';

    const pageReturn = schemaOrg && schemaOrg.type
    ? `  const buildJsonLd = (itm: any) => {
    if (!schemaOrg || !schemaOrg.type) return null;
    if (schemaOrg.type === 'Custom' && schemaOrg.rawJsonLd) {
      try {
        return typeof schemaOrg.rawJsonLd === 'string' ? JSON.parse(schemaOrg.rawJsonLd) : schemaOrg.rawJsonLd;
      } catch { return null; }
    }
    const evalFieldExpr = (expr: string) => {
      try {
        const unwrapped = expr.startsWith('{') && expr.endsWith('}') ? expr.slice(1, -1).trim() : expr;
        const fn = new Function('item', 'params', '${varName}', \`return (\${unwrapped});\`);
        const val = fn(itm, { slug: slugVal, ...(resolved || {}) }, ${varName});
        if (val === undefined || val === null) return undefined;
        return typeof val === 'object' ? val : String(val);
      } catch {
        return undefined;
      }
    };
    const data: Record<string, any> = {
      '@context': 'https://schema.org',
      '@type': schemaOrg.type,
    };
    const staticVals = (schemaOrg.staticValues as Record<string, any>) || {};
    const bindings = (schemaOrg.bindings as Record<string, string>) || {};
    const expressions = (schemaOrg.expressions as Record<string, string>) || {};
    const allKeys = Array.from(new Set([...Object.keys(staticVals), ...Object.keys(bindings), ...Object.keys(expressions)]));
    for (const k of allKeys) {
      if (expressions[k]) {
        const v = evalFieldExpr(expressions[k]);
        if (v !== undefined && v !== '') data[k] = v;
      } else if (bindings[k] && itm) {
        const field = bindings[k];
        const val = field.includes('.') ? field.split('.').reduce((acc: any, part: string) => acc?.[part], itm) : itm[field];
        if (val !== undefined && val !== null && val !== '') data[k] = val;
      } else if (staticVals[k] !== undefined && staticVals[k] !== '') {
        data[k] = staticVals[k];
      }
    }
    return data;
  };
  const jsonLd = buildJsonLd(item || raw);
  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      <PageClient item={item || raw} />
    </>
  );`
    : `  return <PageClient item={item || raw} />;`;

  return `import PageClient from './page.client';
import { notFound } from 'next/navigation';

const seoDefaults = ${defaultsLiteral};

const seoBindings = ${bindingsLiteral};

const seoExpressions = ${expressionsLiteral};
${evalHelper}
export async function generateMetadata({ params }: { params: Promise<{ slug: string; lang?: string }> }) {
  const { slug, lang } = (await params) as { slug: string; lang?: string };
  const endpoint = ${buildEndpointExpr(false)};
  try {
    const res = await fetch(endpoint, {${methodLine}
      headers: ${headersCode},
      signal: AbortSignal.timeout(10000),
      next: { revalidate: ${revalidate} },
    });
    if (!res.ok) return seoDefaults;
    const json = await res.json();
    const item = ${itemExtract};
    if (!item) return seoDefaults;

  const evalExpr = (expr: string) => {
    try {
      const unwrapped = expr.startsWith('{') && expr.endsWith('}') ? expr.slice(1, -1).trim() : expr;
      const fn = new Function('item', 'params', \`return (\${unwrapped});\`);
      const val = fn(item, { slug });
      if (val === undefined || val === null) return undefined;
      if (typeof val === 'object') {
        return val.url || (val.id ? \`/assets/\${val.id}\` : undefined) || val.filename_disk || undefined;
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
      return value.url || (value.id ? \`/assets/\${value.id}\` : undefined) || value.filename_disk || undefined;
    }
    return typeof value === 'string' && value ? value : undefined;
  };
  const pick = (slot: string, fallbackSlot?: string) =>
    bound(slot) ?? (seoDefaults as any)[slot] ?? (fallbackSlot ? bound(fallbackSlot) ?? (seoDefaults as any)[fallbackSlot] : undefined) ?? undefined;

  const title = pick('title');
  const description = pick('description');
  const ogImage = pick('ogImage');
  const twitterImage = pick('twitterImage') ?? ogImage;
  const canonical = pick('canonical');

  return {
    title,
    description,
    openGraph: {
      title: pick('ogTitle', 'title'),
      description: pick('ogDescription', 'description'),
      images: ogImage ? [ogImage] : [],
    },
    twitter: {
      card: (seoDefaults as any).twitterCard || undefined,
      title: pick('twitterTitle', 'title'),
      description: pick('twitterDescription', 'description'),
      image: twitterImage,
    },
    alternates: { canonical: canonical || (seoDefaults as any).canonical || undefined },${robots}
  };
  } catch {
    return seoDefaults;
  }
}
${staticParams}
export const dynamicParams = true;

export default async function Page({ params }: { params: Promise<{ slug: string; lang?: string }> }) {
  const { slug, lang } = (await params) as { slug: string; lang?: string };
  const endpoint = ${buildEndpointExpr(false)};
  let res;
  try {
    res = await fetch(endpoint, {${methodLine}
      headers: ${headersCode},
      signal: AbortSignal.timeout(10000),
      next: { revalidate: ${revalidate} },
    });
  } catch (err) {
    console.error('Network error fetching CMS detail for ' + slug + ':', err);
    throw err;
  }
  if (res.status === 404) notFound();
  if (!res.ok) {
    throw new Error(\`Failed to fetch CMS detail for \${slug}: \${res.status} \${res.statusText}\`);
  }
  const json = await res.json();
  const item = ${itemExtract};
  if (!item) notFound();

  return <PageClient item={item} />;
}
`;
  }

  const staticParams = includeStaticParams
    ? `\nexport async function generateStaticParams() {
  const items = Array.isArray(${varName}) ? ${varName} : [];
  return items
    .filter((i) => i && i._slug)
    .map((i) => ({ slug: String(i._slug) }));
}\n`
    : '';

  const pageReturn = schemaOrg && schemaOrg.type
    ? `  const buildJsonLd = (itm: any) => {
    if (!schemaOrg || !schemaOrg.type) return null;
    if (schemaOrg.type === 'Custom' && schemaOrg.rawJsonLd) {
      try {
        return typeof schemaOrg.rawJsonLd === 'string' ? JSON.parse(schemaOrg.rawJsonLd) : schemaOrg.rawJsonLd;
      } catch { return null; }
    }
    const evalFieldExpr = (expr: string) => {
      try {
        const unwrapped = expr.startsWith('{') && expr.endsWith('}') ? expr.slice(1, -1).trim() : expr;
        const fn = new Function('item', 'params', '${varName}', \`return (\${unwrapped});\`);
        const val = fn(itm, { slug: slugVal, ...(resolved || {}) }, ${varName});
        if (val === undefined || val === null) return undefined;
        return typeof val === 'object' ? val : String(val);
      } catch {
        return undefined;
      }
    };
    const data: Record<string, any> = {
      '@context': 'https://schema.org',
      '@type': schemaOrg.type,
    };
    const staticVals = (schemaOrg.staticValues as Record<string, any>) || {};
    const bindings = (schemaOrg.bindings as Record<string, string>) || {};
    const expressions = (schemaOrg.expressions as Record<string, string>) || {};
    const allKeys = Array.from(new Set([...Object.keys(staticVals), ...Object.keys(bindings), ...Object.keys(expressions)]));
    for (const k of allKeys) {
      if (expressions[k]) {
        const v = evalFieldExpr(expressions[k]);
        if (v !== undefined && v !== '') data[k] = v;
      } else if (bindings[k] && itm) {
        const field = bindings[k];
        const val = field.includes('.') ? field.split('.').reduce((acc: any, part: string) => acc?.[part], itm) : itm[field];
        if (val !== undefined && val !== null && val !== '') data[k] = val;
      } else if (staticVals[k] !== undefined && staticVals[k] !== '') {
        data[k] = staticVals[k];
      }
    }
    return data;
  };
  const jsonLd = buildJsonLd(item || raw);
  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      <PageClient item={item || raw} />
    </>
  );`
    : `  return <PageClient item={item || raw} />;`;

  return `import PageClient from './page.client';
import ${varName} from '@/cms/${collection}.json';
import { notFound } from 'next/navigation';

const seoDefaults = ${defaultsLiteral};

const seoBindings = ${bindingsLiteral};

const seoExpressions = ${expressionsLiteral};
${schemaOrgLiteral}
export async function generateMetadata({ params }) {
  const resolved = await params;
  const items = Array.isArray(${varName}) ? ${varName} : [];
  const slugVal = resolved?.slug || (resolved ? Object.entries(resolved).find(([k, v]) => k !== 'lang' && typeof v === 'string')?.[1] : undefined);
  const raw = items.find((i) => i && (i._slug === slugVal || i.slug === slugVal || i.id === slugVal));
  const lang = resolved?.lang;
  const item = (raw && lang && raw._i18n?.[lang])
    ? { ...raw, ...Object.fromEntries(Object.entries(raw._i18n[lang]).filter(([, v]) => typeof v === 'string' && v !== '')) }
    : raw;
  const evalExpr = (expr) => {
    try {
      const unwrapped = expr.startsWith('{') && expr.endsWith('}') ? expr.slice(1, -1).trim() : expr;
      const fn = new Function('item', 'params', '${varName}', \`return (\${unwrapped});\`);
      const val = fn(item, { slug: slugVal, ...(resolved || {}) }, ${varName});
      if (val === undefined || val === null) return undefined;
      if (typeof val === 'object') {
        return val.url || (val.id ? \`/assets/\${val.id}\` : undefined) || val.filename_disk || undefined;
      }
      return String(val);
    } catch {
      return undefined;
    }
  };

  const bound = (slot) => {
    const expr = seoExpressions[slot];
    if (expr) {
      const v = evalExpr(expr);
      if (v !== undefined && v !== '') return v;
    }
    const field = seoBindings[slot];
    if (!field || !item) return undefined;
    const value = field.includes('.')
      ? field.split('.').reduce((acc, part) => acc?.[part], item)
      : item[field];
    if (typeof value === 'object' && value !== null) {
      return value.url || (value.id ? \`/assets/\${value.id}\` : undefined) || value.filename_disk || undefined;
    }
    return typeof value === 'string' && value ? value : undefined;
  };
  const pick = (slot, fallbackSlot) =>
    bound(slot) ?? seoDefaults[slot] ?? (fallbackSlot ? bound(fallbackSlot) ?? seoDefaults[fallbackSlot] : undefined) ?? undefined;

  const title = pick('title');
  const description = pick('description');
  const ogImage = pick('ogImage');
  const twitterImage = pick('twitterImage') ?? ogImage;
  const canonical = pick('canonical');

  return {
    title,
    description,
    openGraph: {
      title: pick('ogTitle', 'title'),
      description: pick('ogDescription', 'description'),
      images: ogImage ? [ogImage] : [],
    },
    twitter: {
      card: seoDefaults.twitterCard || undefined,
      title: pick('twitterTitle', 'title'),
      description: pick('twitterDescription', 'description'),
      image: twitterImage,
    },
    alternates: { canonical: canonical || seoDefaults.canonical || undefined },${robots}
  };
}
${staticParams}
export const dynamicParams = true;

export default async function Page({ params }: { params?: Promise<Record<string, string>> } = {}) {
  const resolved = (params ? await params : undefined);
  const items = Array.isArray(${varName}) ? ${varName} : [];
  const slugVal = resolved?.slug || (resolved ? Object.entries(resolved).find(([k, v]) => k !== 'lang' && typeof v === 'string')?.[1] : undefined);
  const raw = slugVal ? items.find((i) => i && (i._slug === slugVal || i.slug === slugVal || i.id === slugVal)) : undefined;
  if (slugVal && !raw) notFound();
  const lang = resolved?.lang;
  const item = (raw && lang && raw._i18n?.[lang])
    ? { ...raw, ...Object.fromEntries(Object.entries(raw._i18n[lang]).filter(([, v]) => typeof v === 'string' && v !== '')) }
    : raw;
${pageReturn}
}
`;
}

/**
 * Remove any generated dynamic SEO blocks (`seoDefaults`, `seoBindings`, `seoExpressions`,
 * and `export async function generateMetadata`) from a page server wrapper.
 */
export function stripGenerateMetadataFromCode(code: string): string {
  let cleaned = code;
  cleaned = cleaned.replace(/(?:export\s+)?const\s+seoDefaults(?:\s*:\s*[\w<>,.\[\]\s]+?)?\s*=\s*\{[\s\S]*?\};\s*\n*/g, '');
  cleaned = cleaned.replace(/(?:export\s+)?const\s+seoBindings(?:\s*:\s*[\w<>,.\[\]\s]+?)?\s*=\s*\{[\s\S]*?\};\s*\n*/g, '');
  cleaned = cleaned.replace(/(?:export\s+)?const\s+seoExpressions(?:\s*:\s*[\w<>,.\[\]\s]+?)?\s*=\s*\{[\s\S]*?\};\s*\n*/g, '');
  cleaned = cleaned.replace(/(?:export\s+)?const\s+schemaOrg(?:\s*:\s*[\w<>,.\[\]\s]+?)?\s*=\s*\{[\s\S]*?\};\s*\n*/g, '');

  const genMetaIdx = cleaned.indexOf('export async function generateMetadata');
  if (genMetaIdx !== -1) {
    const paramOpen = cleaned.indexOf('(', genMetaIdx);
    if (paramOpen !== -1) {
      let parenDepth = 0;
      let paramClose = -1;
      for (let i = paramOpen; i < cleaned.length; i++) {
        if (cleaned[i] === '(') parenDepth++;
        else if (cleaned[i] === ')') {
          parenDepth--;
          if (parenDepth === 0) {
            paramClose = i;
            break;
          }
        }
      }
      if (paramClose !== -1) {
        const braceStart = cleaned.indexOf('{', paramClose);
        if (braceStart !== -1) {
          let depth = 0;
          let endIdx = -1;
          for (let i = braceStart; i < cleaned.length; i++) {
            if (cleaned[i] === '{') depth++;
            else if (cleaned[i] === '}') {
              depth--;
              if (depth === 0) {
                endIdx = i + 1;
                break;
              }
            }
          }
          if (endIdx !== -1) {
            while (endIdx < cleaned.length && (cleaned[endIdx] === '\n' || cleaned[endIdx] === '\r' || cleaned[endIdx] === ' ')) {
              endIdx++;
            }
            cleaned = cleaned.slice(0, genMetaIdx) + cleaned.slice(endIdx);
          }
        }
      }
    }
  }
  return cleaned;
}

export function formToSiteMetadata(defaults: Record<string, unknown>): SiteMetadata {
  return {
    title: (defaults.title as string) || undefined,
    description: (defaults.description as string) || undefined,
    openGraph: {
      title: (defaults.ogTitle as string) || undefined,
      description: (defaults.ogDescription as string) || undefined,
      images: defaults.ogImage ? [defaults.ogImage as string] : [],
    },
    twitter: {
      card: defaults.twitterCard || undefined,
      title: defaults.twitterTitle || undefined,
      description: defaults.twitterDescription || undefined,
      image: defaults.twitterImage || undefined,
    } as Record<string, unknown>,
    alternates: {
      canonical: defaults.canonical || undefined,
    } as Record<string, unknown>,
    robots: {
      index: defaults.robotsIndex !== false,
      follow: defaults.robotsFollow !== false,
    } as Record<string, unknown>,
  };
}

export interface BuildStandardWrapperInput {
  defaults?: Record<string, unknown>;
  expressions?: CmsSeoExpressions;
  existingCode?: string;
  schemaOrg?: SchemaOrgConfig | null;
}

/**
 * Server wrapper generator for standard (non-CMS detail) pages.
 *
 * Supports both static metadata (`export const metadata = { ... }`) and dynamic
 * expressions (`generateMetadata` evaluating formulas with `params`).
 * Ensures Next.js invariants: never emits both `metadata` and `generateMetadata` simultaneously.
 */
export function buildStandardPageServerWrapper(input: BuildStandardWrapperInput): string {
  const { defaults = {}, expressions = {}, existingCode = '' } = input;
  const hasExprs = Object.values(expressions).some((v) => typeof v === 'string' && v.trim().length > 0);
  const schemaOrg = input.schemaOrg;
  const hasSchema = Boolean(schemaOrg && schemaOrg.type);

  if (!hasExprs && !hasSchema) {
    const siteMeta = formToSiteMetadata(defaults);
    const cleaned = stripGenerateMetadataFromCode(existingCode);
    const fallbackWrapper = `import PageClient from './page.client';\n\nexport const metadata = {};\n\nexport default function Page() {\n  return <PageClient />;\n}\n`;
    return updateMetadataInCode(cleaned.trim().length > 0 ? cleaned : fallbackWrapper, siteMeta);
  }

  // Clean existing code: remove export const metadata and any existing generateMetadata
  let base = existingCode;
  const metaBlock = extractExportObject(base, 'metadata');
  if (metaBlock) {
    base = base.slice(0, metaBlock.start) + base.slice(metaBlock.end);
  }
  base = stripGenerateMetadataFromCode(base);
  base = base.replace(/const\s+schemaOrg\s*=\s*\{[\s\S]*?\n\};\n?/g, '');
  base = base.replace(/const\s+seoDefaults\s*=\s*\{[\s\S]*?\n\};\n?/g, '');
  base = base.replace(/const\s+seoExpressions\s*=\s*\{[\s\S]*?\n\};\n?/g, '');

  if (!base.trim()) {
    base = `import PageClient from './page.client';\n\nexport default function Page() {\n  return <PageClient />;\n}\n`;
  }

  let metadataSnippet = '';
  if (hasExprs) {
    const defaultsLiteral = inlineObject([
      ['title', defaults.title],
      ['description', defaults.description],
      ['ogTitle', defaults.ogTitle],
      ['ogDescription', defaults.ogDescription],
      ['ogImage', defaults.ogImage],
      ['twitterCard', defaults.twitterCard],
      ['twitterTitle', defaults.twitterTitle],
      ['twitterDescription', defaults.twitterDescription],
      ['twitterImage', defaults.twitterImage],
      ['canonical', defaults.canonical],
    ]);

    const allExpressionSlots = [
      'title', 'description', 'canonical',
      'ogTitle', 'ogDescription', 'ogImage',
      'twitterTitle', 'twitterDescription', 'twitterImage',
    ];
    const expressionsLiteral = inlineObject(allExpressionSlots.map((key) => [key, expressions[key]]));
    const robots = defaults.robotsIndex === false || defaults.robotsFollow === false
      ? `\n    robots: { index: ${defaults.robotsIndex !== false}, follow: ${defaults.robotsFollow !== false} },`
      : '';

    metadataSnippet = `const seoDefaults = ${defaultsLiteral};

const seoExpressions = ${expressionsLiteral};

export async function generateMetadata({ params }) {
  const resolved = (await params) || {};
  const evalExpr = (expr) => {
    try {
      const unwrapped = expr.startsWith('{') && expr.endsWith('}') ? expr.slice(1, -1).trim() : expr;
      const fn = new Function('params', 'item', \`return (\${unwrapped});\`);
      const val = fn(resolved, {});
      if (val === undefined || val === null) return undefined;
      if (typeof val === 'object') {
        return val.url || (val.id ? \`/assets/\${val.id}\` : undefined) || val.filename_disk || undefined;
      }
      return String(val);
    } catch {
      return undefined;
    }
  };

  const pick = (slot, fallbackSlot) => {
    const expr = seoExpressions[slot];
    if (expr) {
      const v = evalExpr(expr);
      if (v !== undefined && v !== '') return v;
    }
    return seoDefaults[slot] ?? (fallbackSlot ? (seoExpressions[fallbackSlot] ? evalExpr(seoExpressions[fallbackSlot]) : seoDefaults[fallbackSlot]) : undefined);
  };

  const title = pick('title');
  const description = pick('description');
  const ogImage = pick('ogImage');
  const twitterImage = pick('twitterImage') ?? ogImage;
  const canonical = pick('canonical');

  return {
    title,
    description,
    openGraph: {
      title: pick('ogTitle', 'title'),
      description: pick('ogDescription', 'description'),
      images: ogImage ? [ogImage] : [],
    },
    twitter: {
      card: seoDefaults.twitterCard || undefined,
      title: pick('twitterTitle', 'title'),
      description: pick('twitterDescription', 'description'),
      image: twitterImage,
    },
    alternates: { canonical: canonical || seoDefaults.canonical || undefined },${robots}
  };
}`;
  } else {
    const siteMeta = formToSiteMetadata(defaults);
    const metaCode = updateMetadataInCode(`export const metadata = {};`, siteMeta);
    metadataSnippet = metaCode.trim();
  }

  const schemaOrgLiteral = hasSchema
    ? `\nconst schemaOrg = ${JSON.stringify(schemaOrg, null, 2)};\n`
    : '';

  if (base.includes('export default')) {
    const defIdx = base.indexOf('export default');
    const importsAndTop = base.slice(0, defIdx).trimEnd();
    let exportDefaultPart = base.slice(defIdx);

    if (hasSchema) {
      if (!exportDefaultPart.includes('application/ld+json')) {
        const buildHelper = `  const buildJsonLd = () => {
    if (!schemaOrg || !schemaOrg.type) return null;
    if (schemaOrg.type === 'Custom' && schemaOrg.rawJsonLd) {
      try {
        return typeof schemaOrg.rawJsonLd === 'string' ? JSON.parse(schemaOrg.rawJsonLd) : schemaOrg.rawJsonLd;
      } catch { return null; }
    }
    const evalFieldExpr = (expr) => {
      try {
        const unwrapped = expr.startsWith('{') && expr.endsWith('}') ? expr.slice(1, -1).trim() : expr;
        const fn = new Function('params', \`return (\${unwrapped});\`);
        const val = fn({});
        if (val === undefined || val === null) return undefined;
        return typeof val === 'object' ? val : String(val);
      } catch {
        return undefined;
      }
    };
    const data = {
      '@context': 'https://schema.org',
      '@type': schemaOrg.type,
    };
    const staticVals = schemaOrg.staticValues || {};
    const exprs = schemaOrg.expressions || {};
    const allKeys = Array.from(new Set([...Object.keys(staticVals), ...Object.keys(exprs)]));
    for (const k of allKeys) {
      if (exprs[k]) {
        const v = evalFieldExpr(exprs[k]);
        if (v !== undefined && v !== '') data[k] = v;
      } else if (staticVals[k] !== undefined && staticVals[k] !== '') {
        data[k] = staticVals[k];
      }
    }
    return data;
  };
  const jsonLd = buildJsonLd();\n`;

        if (/return\s+<PageClient\b([^>]*)\/>;/.test(exportDefaultPart)) {
          exportDefaultPart = exportDefaultPart.replace(
            /return\s+<PageClient\b([^>]*)\/>;/,
            `${buildHelper}  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      <PageClient$1/>
    </>
  );`,
          );
        }
      }
    }

    const out = `${importsAndTop}\n\n${metadataSnippet}${schemaOrgLiteral}\n${exportDefaultPart}`;
    if (moduleParses(out)) return out;
  }

  const pageComponent = hasSchema
    ? `export default function Page() {
  const buildJsonLd = () => {
    if (!schemaOrg || !schemaOrg.type) return null;
    if (schemaOrg.type === 'Custom' && schemaOrg.rawJsonLd) {
      try {
        return typeof schemaOrg.rawJsonLd === 'string' ? JSON.parse(schemaOrg.rawJsonLd) : schemaOrg.rawJsonLd;
      } catch { return null; }
    }
    const evalFieldExpr = (expr) => {
      try {
        const unwrapped = expr.startsWith('{') && expr.endsWith('}') ? expr.slice(1, -1).trim() : expr;
        const fn = new Function('params', \`return (\${unwrapped});\`);
        const val = fn({});
        if (val === undefined || val === null) return undefined;
        return typeof val === 'object' ? val : String(val);
      } catch {
        return undefined;
      }
    };
    const data = {
      '@context': 'https://schema.org',
      '@type': schemaOrg.type,
    };
    const staticVals = schemaOrg.staticValues || {};
    const exprs = schemaOrg.expressions || {};
    const allKeys = Array.from(new Set([...Object.keys(staticVals), ...Object.keys(exprs)]));
    for (const k of allKeys) {
      if (exprs[k]) {
        const v = evalFieldExpr(exprs[k]);
        if (v !== undefined && v !== '') data[k] = v;
      } else if (staticVals[k] !== undefined && staticVals[k] !== '') {
        data[k] = staticVals[k];
      }
    }
    return data;
  };
  const jsonLd = buildJsonLd();
  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      <PageClient />
    </>
  );
}`
    : `export default function Page() {
  return <PageClient />;
}`;

  return `import PageClient from './page.client';\n\n${metadataSnippet}\n${schemaOrgLiteral}\n${pageComponent}\n`;
}

/** The collection a detail page's wrapper imports, when it has per-item SEO. */
export function wrapperCollection(serverCode: string): string | null {
  return /from\s+['"]@\/cms\/([A-Za-z0-9_-]+)\.json['"]/.exec(serverCode)?.[1] ?? null;
}

/** True when this server wrapper already exports generateStaticParams. */
export function hasGenerateStaticParams(serverCode: string): boolean {
  return /export\s+(?:async\s+)?function\s+generateStaticParams\b|export\s*\{[^}]*\bgenerateStaticParams\b/.test(serverCode);
}

/**
 * Ensure generateStaticParams is present in a CMS detail page server wrapper.
 * If missing, detects the imported collection var name and injects it.
 */
export function ensureCmsDetailStaticParams(serverCode: string, paramName = 'slug'): string {
  if (hasGenerateStaticParams(serverCode)) return serverCode;

  const importMatch = /import\s+([A-Za-z0-9_$]+)\s+from\s+['"]@\/cms\/[A-Za-z0-9_-]+\.json['"]/.exec(serverCode);
  const collection = wrapperCollection(serverCode);
  const varName = importMatch?.[1] ?? (collection ? importVarName(collection) : 'items');

  const snippet = `export async function generateStaticParams() {
  const items = Array.isArray(${varName}) ? ${varName} : [];
  return items
    .filter((i) => i && (i._slug || i.slug || i.id))
    .map((i) => ({ ${paramName}: String(i.${paramName} || i._slug || i.slug || i.id) }));
}
`;

  if (/export\s+default\b/.test(serverCode)) {
    return serverCode.replace(/export\s+default\b/, `${snippet}\nexport default`);
  }
  return serverCode.endsWith('\n') ? `${serverCode}\n${snippet}` : `${serverCode}\n\n${snippet}`;
}

export const MAX_PRERENDER_COMBINATIONS = 500;

/**
 * Discover known static parameter combinations for a dynamic Next.js route path.
 * Searches:
 *  1. Local and API CMS collections (cms/*.json).
 *  2. Internal links in project JSX/TSX files (static hrefs, dynamic concat, template literals).
 *  3. Dynamic segment patterns in the route path.
 */
export function discoverDynamicRouteParams(
  routePath: string,
  allFiles: Record<string, string>,
  _apiConfigs: Record<string, ApiCollectionConfig> = {},
): { paramNames: string[]; results: Array<Record<string, string>> } | null {
  const cleanRoute = routePath
    .replace(/^app\//, '')
    .replace(/\/?\([^)]+\)\/?/g, '/')
    .replace(/\/page\.tsx$/, '')
    .replace(/^\/+/, '');
  const segments = cleanRoute.split('/').filter(Boolean);
  const paramNames: string[] = [];
  const patternParts: string[] = [];

  for (const seg of segments) {
    const m = seg.match(/^\[([a-zA-Z0-9_-]+)\]$/);
    if (m) {
      paramNames.push(m[1]);
      patternParts.push('([^/]+)');
    } else {
      patternParts.push(seg);
    }
  }

  if (paramNames.length === 0) return null;

  const routeRegex = new RegExp('^/?' + patternParts.join('/') + '$');
  const parentSegment = segments.length > 1 ? segments[segments.length - 2] : null;

  // 1. Gather all collections
  const collections = new Map<string, any[]>();
  for (const [fPath, content] of Object.entries(allFiles)) {
    if (fPath.startsWith('cms/') && fPath.endsWith('.json') && !fPath.endsWith('.schema.json')) {
      const slug = fPath.replace(/^cms\//, '').replace(/\.json$/, '');
      try {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) collections.set(slug, parsed);
      } catch {}
    }
  }

  // 2. Discover known URLs & link patterns from JSX/TSX files
  const knownUrls = new Set<string>();
  const foundByParam = new Map<string, Set<string>>();
  for (const p of paramNames) {
    foundByParam.set(p, new Set<string>());
  }

  for (const [fPath, code] of Object.entries(allFiles)) {
    if (!/\.(tsx|jsx|ts|js)$/.test(fPath)) continue;

    // Static hrefs: href="/..." or href={'/...'}
    const sMatches = code.matchAll(/href=(?:["']([^"']+)["']|\{["']([^"']+)["']\})/g);
    for (const m of sMatches) {
      const val = m[1] || m[2];
      if (val && val.startsWith('/')) {
        knownUrls.add(val.split('?')[0].split('#')[0]);
      }
    }

    // Dynamic concat: href={"/prefix/" + iterVar.field}
    const concatMatches = code.matchAll(/href=\{\s*["']([^"']+)["']\s*\+\s*([a-zA-Z0-9_$]+)\.([a-zA-Z0-9_$]+)\s*\}/g);
    for (const m of concatMatches) {
      const prefix = m[1];
      const iterVar = m[2];
      const field = m[3];
      const mapMatch = code.match(new RegExp(`([a-zA-Z0-9_$]+)\\.map\\s*\\(\\s*(?:\\(\\s*${iterVar}\\b|${iterVar}\\b)`));
      const colName = mapMatch ? mapMatch[1] : null;
      if (colName && collections.has(colName)) {
        for (const item of collections.get(colName)!) {
          const val = item[field] || item.slug || item._slug || item.id;
          if (val) knownUrls.add(prefix + val);
        }
      }
    }

    // Template literals: href={`/prefix/${iterVar.field}`}
    const tplMatches = code.matchAll(/href=\{\s*`([^`$]+)\$\{([^}]+)\}([^`]*)`\s*\}/g);
    for (const m of tplMatches) {
      const prefix = m[1];
      const expr = m[2].trim();
      const suffix = m[3] || '';
      const dotParts = expr.split('.');
      if (dotParts.length === 2) {
        const iterVar = dotParts[0];
        const field = dotParts[1];
        const mapMatch = code.match(new RegExp(`([a-zA-Z0-9_$]+)\\.map\\s*\\(\\s*(?:\\(\\s*${iterVar}\\b|${iterVar}\\b)`));
        const colName = mapMatch ? mapMatch[1] : null;
        if (colName && collections.has(colName)) {
          for (const item of collections.get(colName)!) {
            const val = item[field] || item.slug || item._slug || item.id;
            if (val) knownUrls.add(prefix + val + suffix);
          }
        }
      }
    }
  }

  const results: Array<Record<string, string>> = [];
  const seen = new Set<string>();

  function addCombination(obj: Record<string, string>) {
    if (results.length >= MAX_PRERENDER_COMBINATIONS) return;
    for (const p of paramNames) {
      if (!obj[p]) return;
    }
    const key = JSON.stringify(obj);
    if (!seen.has(key)) {
      seen.add(key);
      results.push(obj);
    }
  }

  // A. Match URLs against route segments (exact and prefix)
  for (const u of knownUrls) {
    if (results.length >= MAX_PRERENDER_COMBINATIONS) break;
    const urlParts = u.replace(/^\/+/, '').split('/');
    if (urlParts.length >= segments.length) {
      let matches = true;
      const matchedParams: Record<string, string> = {};
      for (let k = 0; k < segments.length; k++) {
        const rSeg = segments[k];
        const m = rSeg.match(/^\[([a-zA-Z0-9_-]+)\]$/);
        if (m) {
          matchedParams[m[1]] = urlParts[k];
          foundByParam.get(m[1])?.add(urlParts[k]);
        } else if (rSeg !== urlParts[k]) {
          matches = false;
          break;
        }
      }
      if (matches && urlParts.length === segments.length) {
        addCombination(matchedParams);
      }
    }
  }

  // C. Match collections to individual params
  for (const p of paramNames) {
    let col = null;
    const iesPlural = p.endsWith('y') ? p.slice(0, -1) + 'ies' : null;
    if (collections.has(p)) col = collections.get(p);
    else if (collections.has(p + 's')) col = collections.get(p + 's');
    else if (collections.has(p + 'es')) col = collections.get(p + 'es');
    else if (iesPlural && collections.has(iesPlural)) col = collections.get(iesPlural);
    else if (parentSegment && collections.has(parentSegment)) col = collections.get(parentSegment);

    if (col) {
      for (const item of col) {
        const val = item[p] || item.slug || item._slug || item.id;
        if (val) foundByParam.get(p)?.add(String(val));
      }
    }
  }

  // D. Multi-segment Cartesian product
  if (paramNames.length > 1) {
    function cartesian(index: number, current: Record<string, string>) {
      if (results.length >= MAX_PRERENDER_COMBINATIONS) return;
      if (index === paramNames.length) {
        addCombination({ ...current });
        return;
      }
      const p = paramNames[index];
      const values = Array.from(foundByParam.get(p) || []);
      for (const v of values) {
        if (results.length >= MAX_PRERENDER_COMBINATIONS) break;
        current[p] = v;
        cartesian(index + 1, current);
      }
    }
    cartesian(0, {});
  } else if (paramNames.length === 1) {
    const p = paramNames[0];
    for (const v of foundByParam.get(p) || []) {
      if (results.length >= MAX_PRERENDER_COMBINATIONS) break;
      addCombination({ [p]: v });
    }
  }

  return { paramNames, results };
}

/**
 * Ensure generateStaticParams is present for ANY dynamic route in Hybrid SSG mode.
 * Handles single-param detail pages, multi-param routes, and queries.
 */
export function ensureDynamicRouteStaticParams(options: {
  routePath: string;
  serverCode: string;
  allFiles: Record<string, string>;
  apiConfigs?: Record<string, ApiCollectionConfig>;
}): string {
  const { routePath, serverCode, allFiles, apiConfigs } = options;

  if (hasGenerateStaticParams(serverCode)) return serverCode;

  const cleanRoute = routePath
    .replace(/^app\//, '')
    .replace(/\/?\([^)]+\)\/?/g, '/')
    .replace(/\/page\.tsx$/, '');
  const matches = cleanRoute.match(/\[([a-zA-Z0-9_-]+)\]/g);
  if (!matches || matches.length === 0) return serverCode;

  const paramNames = matches.map((m) => m.slice(1, -1));

  // If single param and imports a collection directly, delegate to ensureCmsDetailStaticParams
  const importMatch = /import\s+([A-Za-z0-9_$]+)\s+from\s+['"]@\/cms\/[A-Za-z0-9_-]+\.json['"]/.exec(serverCode);
  if (paramNames.length === 1 && importMatch) {
    return ensureCmsDetailStaticParams(serverCode, paramNames[0]);
  }

  // Otherwise discover from links & collections
  const discovered = discoverDynamicRouteParams(routePath, allFiles, apiConfigs);
  const items = discovered?.results || [];

  const itemsJson = JSON.stringify(items, null, 2);
  const dynamicParamsSnippet = !serverCode.includes('dynamicParams') ? '\nexport const dynamicParams = true;\n' : '';
  const snippet = `export async function generateStaticParams() {
  return ${itemsJson};
}
${dynamicParamsSnippet}`;

  if (/export\s+default\b/.test(serverCode)) {
    return serverCode.replace(/export\s+default\b/, `${snippet}\nexport default`);
  }
  return serverCode.endsWith('\n') ? `${serverCode}\n${snippet}` : `${serverCode}\n\n${snippet}`;
}

/**
 * Strips generateStaticParams from a server page wrapper for Dynamic mode SSR.
 * Replaces re-export specifiers, strips function declarations, and ensures dynamicParams = true.
 */
export function stripGenerateStaticParams(serverCode: string): string {
  if (!serverCode.includes('generateStaticParams')) return serverCode;

  // 1. Re-export specifiers: export { default, generateStaticParams } from '...'
  let stripped = serverCode.replace(
    /export\s*\{\s*(?:default\s*,\s*generateStaticParams|generateStaticParams\s*,\s*default)\s*\}\s*from/g,
    'export { default } from',
  );
  stripped = stripped.replace(
    /export\s*\{\s*generateStaticParams\s*\}\s*(?:from\s*['"][^'"]+['"])?;?\s*\n?/g,
    '',
  );

  // 2. Function declaration: export (async)? function generateStaticParams(...) { ... }
  const fnRegex = /export\s+(?:async\s+)?function\s+generateStaticParams\s*\([^)]*\)\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = fnRegex.exec(stripped)) !== null) {
    const startIndex = match.index;
    const openBraceIndex = match.index + match[0].length - 1;
    let depth = 1;
    let i = openBraceIndex + 1;
    let inString: string | null = null;
    let escaped = false;

    while (i < stripped.length && depth > 0) {
      const ch = stripped[i];
      if (escaped) {
        escaped = false;
        i++;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        i++;
        continue;
      }
      if (inString) {
        if (ch === inString) inString = null;
        i++;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === '`') {
        inString = ch;
        i++;
        continue;
      }
      if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
      }
      i++;
    }

    if (depth === 0) {
      while (i < stripped.length && (stripped[i] === '\n' || stripped[i] === '\r')) {
        i++;
      }
      stripped = stripped.slice(0, startIndex) + stripped.slice(i);
      fnRegex.lastIndex = startIndex;
    } else {
      break;
    }
  }

  // Ensure dynamicParams is present for dynamic SSR
  if (
    !stripped.includes('dynamicParams') &&
    !stripped.includes("dynamic = 'force-dynamic'") &&
    !stripped.includes('dynamic = "force-dynamic"')
  ) {
    stripped += '\nexport const dynamicParams = true;\n';
  }

  return stripped;
}

