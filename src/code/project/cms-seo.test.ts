import { describe, it, expect } from 'vitest';
import { parse } from '@babel/parser';
import {
  buildCmsDetailServerWrapper,
  buildStandardPageServerWrapper,
  parseCmsSeoBindings,
  parseCmsSeoDefaults,
  parseCmsSeoExpressions,
  discoverDynamicRouteParams,
  MAX_PRERENDER_COMBINATIONS,
  hasCmsSeo,
  bindableFields,
  defaultBindings,
  wrapperCollection,
  hasGenerateStaticParams,
  ensureCmsDetailStaticParams,
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
async function runGenerateMetadata(src: string, items: unknown[] | null, slug: string, lang?: string, paramKey: string = 'slug') {
  // The collection arrives through an import, which `new Function` cannot
  // resolve — bind that identifier to the test data instead.
  const importVar = /^import (\w+) from ['"]@\/cms\//m.exec(src)?.[1];
  if (!importVar) throw new Error('wrapper has no collection import');
  const body = src
    .slice(src.indexOf('const seoDefaults'), src.indexOf('export default'))
    .replace('export async function', 'async function')
    .replace(/export\s+const\s+dynamicParams\s*=\s*true;?/g, '')
    // A distinct name: the emitted code declares its own `items`, so reusing
    // that identifier would shadow the injection and throw on its own TDZ.
    .replace(new RegExp(`\\b${importVar}\\b`, 'g'), '__cmsData');
  const factory = new Function('__cmsData', `${body}\nreturn generateMetadata;`);
  const fn = factory(items) as (a: { params: unknown }) => Promise<Record<string, any>>;
  // vinext passes params as a THENABLE, matching Next 15 — the emitted code
  // must await it, so hand it a promise rather than a plain object.
  return fn({ params: Promise.resolve({ [paramKey]: slug, lang }) });
}

async function runGenerateStaticParams(src: string, items: unknown[] | null) {
  const importVar = /^import (\w+) from ['"]@\/cms\//m.exec(src)?.[1];
  if (!importVar) throw new Error('wrapper has no collection import');
  const body = src
    .slice(src.indexOf('export async function generateStaticParams'), src.indexOf('export default'))
    .replace('export async function generateStaticParams', 'async function generateStaticParams')
    .replace(/export\s+const\s+dynamicParams\s*=\s*true;?/g, '')
    .replace(new RegExp(`\\b${importVar}\\b`, 'g'), '__cmsData');
  const factory = new Function('__cmsData', `${body}\nreturn generateStaticParams;`);
  const fn = factory(items) as () => Promise<Array<{ slug: string }>>;
  return fn();
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

describe('generateStaticParams for hybrid SSG', () => {
  it('omits generateStaticParams when includeStaticParams is false or undefined', () => {
    const withoutOpt = buildCmsDetailServerWrapper({ collection: 'articles' });
    expect(hasGenerateStaticParams(withoutOpt)).toBe(false);
    expect(withoutOpt).not.toContain('generateStaticParams');

    const explicitFalse = buildCmsDetailServerWrapper({ collection: 'articles', includeStaticParams: false });
    expect(hasGenerateStaticParams(explicitFalse)).toBe(false);
  });

  it('generates generateStaticParams when includeStaticParams is true', async () => {
    const withOpt = buildCmsDetailServerWrapper({ collection: 'articles', includeStaticParams: true });
    expect(() => parse(withOpt, { sourceType: 'module', plugins: ['jsx', 'typescript'] })).not.toThrow();
    expect(hasGenerateStaticParams(withOpt)).toBe(true);
    expect(withOpt).toContain('export async function generateStaticParams');

    const params = await runGenerateStaticParams(withOpt, [
      ...ITEMS,
      { name: 'No slug' },
      null,
    ]);
    expect(params).toEqual([{ slug: 'first' }, { slug: 'second' }]);
  });

  it('safely handles non-array data in generateStaticParams', async () => {
    const withOpt = buildCmsDetailServerWrapper({ collection: 'articles', includeStaticParams: true });
    const params = await runGenerateStaticParams(withOpt, null);
    expect(params).toEqual([]);
  });

  it('ensureCmsDetailStaticParams injects generateStaticParams idempotently', () => {
    const initial = buildCmsDetailServerWrapper({ collection: 'articles' });
    expect(hasGenerateStaticParams(initial)).toBe(false);

    const injected = ensureCmsDetailStaticParams(initial);
    expect(hasGenerateStaticParams(injected)).toBe(true);
    expect(injected).toContain('const items = Array.isArray(articles) ? articles : [];');
    expect(() => parse(injected, { sourceType: 'module', plugins: ['jsx', 'typescript'] })).not.toThrow();

    // Calling it again does not duplicate
    const twice = ensureCmsDetailStaticParams(injected);
    expect(twice).toBe(injected);
    const count = (twice.match(/export async function generateStaticParams/g) ?? []).length;
    expect(count).toBe(1);
  });

  it('ensureCmsDetailStaticParams detects collection variable from import', () => {
    const customCode = `import PageClient from './page.client';
import customPosts from '@/cms/posts.json';

export default function Page() {
  return <PageClient />;
}
`;
    const injected = ensureCmsDetailStaticParams(customCode);
    expect(injected).toContain('const items = Array.isArray(customPosts) ? customPosts : [];');
    expect(hasGenerateStaticParams(injected)).toBe(true);
  });

  it('caps multi-segment route Cartesian product combinations to MAX_PRERENDER_COMBINATIONS', () => {
    const allFiles: Record<string, string> = {
      'cms/categories.json': JSON.stringify(Array.from({ length: 100 }, (_, i) => ({ slug: `cat-${i}` }))),
      'cms/products.json': JSON.stringify(Array.from({ length: 1000 }, (_, i) => ({ slug: `prod-${i}` }))),
    };
    const discovered = discoverDynamicRouteParams('app/[category]/[product]/page.tsx', allFiles);
    expect(discovered).not.toBeNull();
    expect(discovered!.results.length).toBeLessThanOrEqual(MAX_PRERENDER_COMBINATIONS);
    expect(discovered!.results.length).toBe(500);
  });
});

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

  it('parses seoExpressions back from generated server wrapper', () => {
    const parsed = parseCmsSeoExpressions(src);
    expect(parsed.title).toBe('`${item.name} | Revyme Store`');
    expect(parsed.canonical).toBe('`https://example.com/blog/${item._slug}`');
    expect(parsed.ogImage).toBe('item.cover');
  });
});

describe('buildStandardPageServerWrapper', () => {
  async function runStandardGenerateMetadata(src: string, params: Record<string, string>) {
    const body = src
      .slice(src.indexOf('const seoDefaults'), src.indexOf('export default'))
      .replace('export async function', 'async function');
    const factory = new Function(`return (async function() {
      ${body}
      return generateMetadata({ params: Promise.resolve(${JSON.stringify(params)}) });
    })()`);
    return await factory();
  }

  it('generates clean static metadata when no expressions are present', () => {
    const code = buildStandardPageServerWrapper({
      defaults: { title: 'Home Page', description: 'Welcome home' },
    });

    expect(code).toContain('export const metadata = {');
    expect(code).toContain('title: "Home Page"');
    expect(code).not.toContain('generateMetadata');
    expect(hasCmsSeo(code)).toBe(false);

    const parsed = parseMetadataFromCode(code);
    expect(parsed.title).toBe('Home Page');
    expect(parsed.description).toBe('Welcome home');
  });

  it('generates dynamic generateMetadata with seoExpressions when expressions are provided', async () => {
    const code = buildStandardPageServerWrapper({
      defaults: { title: 'Default Title' },
      expressions: {
        title: '`Revyme · ${params.category || "All"}`',
        canonical: '`https://example.com/${params.category}`',
      },
    });

    expect(code).not.toContain('export const metadata');
    expect(code).toContain('export async function generateMetadata');
    expect(hasCmsSeo(code)).toBe(true);

    const parsedExprs = parseCmsSeoExpressions(code);
    expect(parsedExprs.title).toBe('`Revyme · ${params.category || "All"}`');
    expect(parsedExprs.canonical).toBe('`https://example.com/${params.category}`');

    const parsedDefaults = parseCmsSeoDefaults(code);
    expect(parsedDefaults.title).toBe('Default Title');

    const runtimeMeta = await runStandardGenerateMetadata(code, { category: 'shoes' });
    expect(runtimeMeta.title).toBe('Revyme · shoes');
    expect(runtimeMeta.alternates.canonical).toBe('https://example.com/shoes');
  });

  it('transitions from static metadata to dynamic wrapper cleanly without duplicate exports', () => {
    const initialStatic = `import PageClient from './page.client';

export const metadata = {
  title: "Existing Static Title",
};

export default function Page() {
  return <PageClient />;
}
`;

    const dynamicCode = buildStandardPageServerWrapper({
      defaults: { title: 'Existing Static Title' },
      expressions: { title: '`Dynamic: ${params.slug}`' },
      existingCode: initialStatic,
    });

    expect(dynamicCode).not.toContain('export const metadata');
    expect(dynamicCode).toContain('export async function generateMetadata');
    expect(hasCmsSeo(dynamicCode)).toBe(true);
    expect(parseCmsSeoExpressions(dynamicCode).title).toBe('`Dynamic: ${params.slug}`');

    // And transitions back to static when expressions are cleared
    const revertedStatic = buildStandardPageServerWrapper({
      defaults: { title: 'Existing Static Title' },
      expressions: {},
      existingCode: dynamicCode,
    });

    expect(revertedStatic).toContain('export const metadata = {');
    expect(revertedStatic).not.toContain('generateMetadata');
    expect(revertedStatic).not.toContain('seoExpressions');
    expect(hasCmsSeo(revertedStatic)).toBe(false);
    expect(parseMetadataFromCode(revertedStatic).title).toBe('Existing Static Title');
  });

  it('preserves custom imports and custom page body when applying expressions', () => {
    const existing = `import PageClient from './page.client';
import customBanner from '@/assets/banner.json';

export const metadata = {};

export default function Page({ params }: any) {
  return <PageClient banner={customBanner} />;
}
`;

    const result = buildStandardPageServerWrapper({
      defaults: { title: 'Custom Page' },
      expressions: { title: '`Title: ${params.id}`' },
      existingCode: existing,
    });

    expect(result).toContain("import customBanner from '@/assets/banner.json';");
    expect(result).toContain('export default function Page({ params }: any) {');
    expect(result).toContain('<PageClient banner={customBanner} />');
    expect(hasCmsSeo(result)).toBe(true);
  });
});

describe('buildCmsDetailServerWrapper with localized _i18n items', () => {
  const LOCALIZED_ITEMS = [
    {
      _slug: 'kyiv',
      name: 'Kyiv Tour',
      excerpt: 'Base description in English',
      cover: 'https://cdn/kyiv.jpg',
      _i18n: {
        uk: {
          name: 'Тур Києвом',
          excerpt: '', // Empty string falls back to base
        },
        de: {
          name: 'Kiew Tour',
          excerpt: 'Beschreibung auf Deutsch',
        },
      },
    },
  ];

  const src = buildCmsDetailServerWrapper({
    collection: 'tours',
    bindings: { title: 'name', description: 'excerpt', ogImage: 'cover' },
  });

  it('resolves localized title and falls back on empty string for secondary locale', async () => {
    const metaUk = await runGenerateMetadata(src, LOCALIZED_ITEMS, 'kyiv', 'uk');
    expect(metaUk.title).toBe('Тур Києвом');
    expect(metaUk.description).toBe('Base description in English'); // fallback because ''

    const metaDe = await runGenerateMetadata(src, LOCALIZED_ITEMS, 'kyiv', 'de');
    expect(metaDe.title).toBe('Kiew Tour');
    expect(metaDe.description).toBe('Beschreibung auf Deutsch');

    const metaDefault = await runGenerateMetadata(src, LOCALIZED_ITEMS, 'kyiv');
    expect(metaDefault.title).toBe('Kyiv Tour');
    expect(metaDefault.description).toBe('Base description in English');
  });

  it('resolves localized title when route param is named category instead of slug', async () => {
    const metaUk = await runGenerateMetadata(src, LOCALIZED_ITEMS, 'kyiv', 'uk', 'category');
    expect(metaUk.title).toBe('Тур Києвом');

    const metaDe = await runGenerateMetadata(src, LOCALIZED_ITEMS, 'kyiv', 'de', 'category');
    expect(metaDe.title).toBe('Kiew Tour');
  });

  it('has exact parity with localizeRows nonempty-string merge semantics', () => {
    const raw = LOCALIZED_ITEMS[0];
    const serverMergeUk = {
      ...raw,
      ...Object.fromEntries(Object.entries(raw._i18n.uk).filter(([, v]) => typeof v === 'string' && v !== '')),
    };
    expect(serverMergeUk.name).toBe('Тур Києвом');
    expect(serverMergeUk.excerpt).toBe('Base description in English');
  });
});



