import { describe, it, expect } from 'vitest';
import { parse } from '@babel/parser';
import {
  buildCmsDetailServerWrapper,
  parseCmsSeoBindings,
  parseCmsSeoDefaults,
  hasCmsSeo,
  bindableFields,
  defaultBindings,
  wrapperCollection,
} from './cms-seo';
import { parseMetadataFromCode } from '../generation/metadata-gen';
import type { CollectionSchema } from '@/shared/types';

const SCHEMA: CollectionSchema = {
  name: 'Articles',
  slug: 'articles',
  fields: [
    { id: 'cover', name: 'Cover', type: 'image' },
    { id: 'name', name: 'Name', type: 'text' },
    { id: 'excerpt', name: 'Excerpt', type: 'textarea' },
    { id: 'views', name: 'Views', type: 'number' },
    { id: 'live', name: 'Live', type: 'boolean' },
  ],
};

const ITEMS = [
  { _slug: 'first', name: 'First Post', excerpt: 'About the first', cover: 'https://cdn/a.png' },
  { _slug: 'second', name: 'Second Post', excerpt: '', cover: '' },
];

/**
 * Run the emitted `generateMetadata` for real.
 *
 * Server wrappers get no FileKind, so the oracle never sees this file and it
 * ships to production verbatim — executing it here is the only gate it has.
 */
async function runGenerateMetadata(src: string, items: unknown[] | null, slug: string) {
  // The collection arrives through an import, which `new Function` cannot
  // resolve — bind that identifier to the test data instead.
  const importVar = /^import (\w+) from ['"]@\/cms\//m.exec(src)?.[1];
  if (!importVar) throw new Error('wrapper has no collection import');
  const body = src
    .slice(src.indexOf('const seoDefaults'), src.indexOf('export default'))
    .replace('export async function', 'async function')
    // A distinct name: the emitted code declares its own `items`, so reusing
    // that identifier would shadow the injection and throw on its own TDZ.
    .replace(new RegExp(`\\b${importVar}\\b`, 'g'), '__cmsData');
  const factory = new Function('__cmsData', `${body}\nreturn generateMetadata;`);
  const fn = factory(items) as (a: { params: unknown }) => Promise<Record<string, any>>;
  // vinext passes params as a THENABLE, matching Next 15 — the emitted code
  // must await it, so hand it a promise rather than a plain object.
  return fn({ params: Promise.resolve({ slug }) });
}

describe('buildCmsDetailServerWrapper', () => {
  const src = buildCmsDetailServerWrapper({
    collection: 'articles',
    defaults: { title: 'Articles', twitterCard: 'summary_large_image' },
    bindings: { title: 'name', description: 'excerpt', ogImage: 'cover' },
  });

  it('emits a module that parses', () => {
    expect(() => parse(src, { sourceType: 'module', plugins: ['jsx', 'typescript'] })).not.toThrow();
  });

  it('exports generateMetadata and NOT a metadata const', () => {
    // Exporting both is a Next.js build error ("Cannot define both"), and
    // vinext silently prefers the function — so the panel's static values
    // would look saved and never render.
    expect(hasCmsSeo(src)).toBe(true);
    expect(src).not.toMatch(/export\s+const\s+metadata/);
    expect(src).toMatch(/const seoDefaults =/);
  });

  it('resolves the bound fields for the requested item', async () => {
    const meta = await runGenerateMetadata(src, ITEMS, 'first');
    expect(meta.title).toBe('First Post');
    expect(meta.description).toBe('About the first');
    expect(meta.openGraph.images).toEqual(['https://cdn/a.png']);
  });

  it('gives each item its OWN title — the whole point', async () => {
    const a = await runGenerateMetadata(src, ITEMS, 'first');
    const b = await runGenerateMetadata(src, ITEMS, 'second');
    expect(a.title).toBe('First Post');
    expect(b.title).toBe('Second Post');
  });

  it('falls back to the static default when the item field is empty', async () => {
    // 'second' has an empty excerpt and no cover.
    const meta = await runGenerateMetadata(src, ITEMS, 'second');
    expect(meta.description).toBeUndefined();
    expect(meta.openGraph.images).toEqual([]);
    expect(meta.twitter.card).toBe('summary_large_image');
  });

  it('falls back to the static title for an unknown slug', async () => {
    const meta = await runGenerateMetadata(src, ITEMS, 'nope');
    expect(meta.title).toBe('Articles');
  });

  it('survives a collection file that is not an array', async () => {
    // Imported / hand-edited cms JSON is never validated on read, and this
    // file has no oracle behind it — a throw here would 500 the route.
    const meta = await runGenerateMetadata(src, null as never, 'first');
    expect(meta.title).toBe('Articles');
  });

  it('OG and Twitter inherit the resolved title when unbound', async () => {
    const meta = await runGenerateMetadata(src, ITEMS, 'first');
    expect(meta.openGraph.title).toBe('First Post');
    expect(meta.twitter.title).toBe('First Post');
    // Twitter image falls back to the OG image rather than going blank.
    expect(meta.twitter.image).toBe('https://cdn/a.png');
  });

  it('round-trips its bindings and defaults', () => {
    expect(parseCmsSeoBindings(src)).toEqual({ title: 'name', description: 'excerpt', ogImage: 'cover' });
    expect(parseCmsSeoDefaults(src)).toMatchObject({ title: 'Articles', twitterCard: 'summary_large_image' });
    expect(wrapperCollection(src)).toBe('articles');
  });

  it('round-trips values containing quotes and braces', () => {
    const tricky = buildCmsDetailServerWrapper({
      collection: 'articles',
      defaults: { title: `It's a "test" }; export const metadata = {` },
    });
    expect(() => parse(tricky, { sourceType: 'module', plugins: ['jsx', 'typescript'] })).not.toThrow();
    expect(parseCmsSeoDefaults(tricky).title).toBe(`It's a "test" }; export const metadata = {`);
  });

  it('handles a digit-leading collection slug', () => {
    const src2 = buildCmsDetailServerWrapper({ collection: '2023-recap' });
    expect(() => parse(src2, { sourceType: 'module', plugins: ['jsx', 'typescript'] })).not.toThrow();
    expect(src2).toMatch(/import cms2023Recap from '@\/cms\/2023-recap\.json'/);
  });
});

describe('field offering', () => {
  it('offers text fields for text slots and images for image slots', () => {
    expect(bindableFields(SCHEMA, 'title').map((f) => f.id)).toEqual(['name', 'excerpt']);
    // Pointing og:image at a text field produces a broken card, silently.
    expect(bindableFields(SCHEMA, 'ogImage').map((f) => f.id)).toEqual(['cover']);
    expect(bindableFields(null, 'title')).toEqual([]);
  });

  it('seeds a new page with usable bindings', () => {
    expect(defaultBindings(SCHEMA)).toEqual({ title: 'name', description: 'excerpt', ogImage: 'cover' });
    expect(defaultBindings(null)).toEqual({});
  });
});

// ─── Migration from a legacy detail wrapper ─────────────────────────────────
//
// Detail pages created before per-item SEO carry the plain server wrapper
// with `export const metadata = {}`. The panel reads those through the old
// path and the first save replaces the file — the dangerous case, because
// patching instead would leave BOTH exports in one module.

describe('legacy wrapper migration', () => {
  const LEGACY = `import PageClient from './page.client';

export const metadata = { title: 'Blog', description: 'All posts' };

export default function Page() {
  return <PageClient />;
}
`;

  it('the legacy wrapper has no per-item SEO', () => {
    expect(hasCmsSeo(LEGACY)).toBe(false);
    expect(parseCmsSeoBindings(LEGACY)).toEqual({});
  });

  it('regenerating carries the old values over as fallbacks', () => {
    const old = parseMetadataFromCode(LEGACY);
    const next = buildCmsDetailServerWrapper({
      collection: 'articles',
      defaults: { title: old.title, description: old.description },
      bindings: { title: 'name' },
    });
    expect(parseCmsSeoDefaults(next)).toMatchObject({ title: 'Blog', description: 'All posts' });
    // …and the old export is gone, so the module has one metadata source.
    expect(next).not.toMatch(/export\s+const\s+metadata/);
    expect((next.match(/export\s+(async\s+function\s+generateMetadata|const\s+metadata)/g) ?? []).length).toBe(1);
  });
});
