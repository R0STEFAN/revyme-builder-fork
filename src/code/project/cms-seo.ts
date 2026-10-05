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

import { parseLocalObjectFromCode } from '../generation/metadata-gen';
import type { CollectionSchema, FieldDefinition } from '@/shared/types';

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
  const text = schema.fields.filter((f) => TEXT_TYPES.has(f.type) && f.type !== 'slug');
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

export interface BuildDetailWrapperInput {
  collection: string;
  /** Static values, used when a slot has no binding or the item's field is
   *  empty. Flat keys matching CMS_SEO_SLOTS, plus `canonical`/robots. */
  defaults?: Record<string, unknown>;
  bindings?: CmsSeoBindings;
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
  const { collection, defaults = {}, bindings = {} } = input;
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

  const robots = defaults.robotsIndex === false || defaults.robotsFollow === false
    ? `\n    robots: { index: ${defaults.robotsIndex !== false}, follow: ${defaults.robotsFollow !== false} },`
    : '';

  return `import PageClient from './page.client';
import ${varName} from '@/cms/${collection}.json';

const seoDefaults = ${defaultsLiteral};

const seoBindings = ${bindingsLiteral};

export async function generateMetadata({ params }) {
  const resolved = await params;
  const items = Array.isArray(${varName}) ? ${varName} : [];
  const item = items.find((i) => i && i._slug === resolved?.slug);
  const bound = (slot) => {
    const field = seoBindings[slot];
    if (!field || !item) return undefined;
    const value = item[field];
    return typeof value === 'string' && value ? value : undefined;
  };
  const pick = (slot, fallbackSlot) =>
    bound(slot) ?? seoDefaults[slot] ?? (fallbackSlot ? bound(fallbackSlot) ?? seoDefaults[fallbackSlot] : undefined) ?? undefined;

  const title = pick('title');
  const description = pick('description');
  const ogImage = pick('ogImage');
  const twitterImage = pick('twitterImage') ?? ogImage;

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
    alternates: { canonical: seoDefaults.canonical || undefined },${robots}
  };
}

export default function Page() {
  return <PageClient />;
}
`;
}

/** The collection a detail page's wrapper imports, when it has per-item SEO. */
export function wrapperCollection(serverCode: string): string | null {
  return /from\s+['"]@\/cms\/([A-Za-z0-9_-]+)\.json['"]/.exec(serverCode)?.[1] ?? null;
}
