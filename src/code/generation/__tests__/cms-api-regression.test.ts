// Permanent regression suite for API CMS codegen and integration defects.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { transform } from '@babel/standalone';
import { parse } from '@babel/parser';

const files = vi.hoisted(() => new Map<string, string>());
vi.mock('@/code/project/project-fs', () => ({
  projectFS: {
    readFile: (path: string) => files.get(path) ?? null,
    writeFile: (path: string, code: string) => files.set(path, code),
    exists: (path: string) => files.has(path),
    listFiles: (dir = '') => [...files.keys()].filter(p => p.startsWith(dir)),
    dump: () => Object.fromEntries(files),
  },
}));
vi.mock('@/backend/autosave', () => ({ triggerAutosave: vi.fn() }));

import { saveApiCollection, setCmsMode, getApiCollection } from '@/code/project/cms-api-config';
import { serializeHeadersForCode, buildCmsDetailServerWrapper } from '@/code/project/cms-seo';
import { buildFilterExpression, updateCollectionQueryConfig } from '@/code/generation/cms-gen';
import { cmsNavHrefExpr } from '@/code/generation/map-gen';
import { saveCollectionSchema } from '@/code/project/cms-ops';
import { createCmsIndexPageFile } from '@/code/project/cms-page-ops';
import { serializeJSXAttr } from '@/code/generation/generator-utils';
import { buildNodeJSX } from '@/code/generation/generator-crud';
import { renderToString } from 'react-dom/server';
import { parseExpression } from '@babel/parser';
import { extractItemMemberPath } from '@/code/parsing/parser';

beforeEach(() => {
  files.clear();
  saveApiCollection('posts', {
    name: 'Posts',
    slug: 'posts',
    provider: 'directus',
    url: 'https://cms.example.invalid/items/posts',
    method: 'POST',
    headers: { Authorization: 'Bearer env:AUDIT_TOKEN' },
    itemsKey: 'data',
  });
  setCmsMode('api');
});

describe('API CMS regression: codegen and configuration', () => {
  it('resolves the env:TOKEN format emitted by the API configuration modal', () => {
    const emitted = serializeHeadersForCode({ Authorization: 'Bearer env:AUDIT_TOKEN' });
    const headers = new Function('process', `return (${emitted});`)({ env: { AUDIT_TOKEN: 'audit-value' } });
    expect(headers.Authorization).toBe('Bearer audit-value');
  });

  it('rejects nonmatching route slugs without referring to the generator variable f', () => {
    const expression = buildFilterExpression({
      combinator: 'and',
      filters: [
        { field: 'slug', operator: 'equals', value: '', valueSource: 'routeParam', valueVar: 'slug' },
      ],
    });
    const js = transform(`function match(item: any, params: any) { return (${expression}); }`, {
      filename: 'predicate.ts',
      presets: ['typescript'],
    }).code!;
    const match = new Function(`${js}; return match;`)();
    expect(match({ slug: 'b' }, { slug: 'a' })).toBe(false);
  });

  it('keeps exact relation matching distinct from substring matching', () => {
    const expression = buildFilterExpression({
      combinator: 'and',
      filters: [
        { field: 'category', operator: 'equals', value: '', valueSource: 'routeParam', valueVar: 'category' },
      ],
    });
    const js = transform(`function match(item: any, params: any) { return (${expression}); }`, {
      filename: 'predicate.ts',
      presets: ['typescript'],
    }).code!;
    const match = new Function(`${js}; return match;`)();
    expect(match({ category: { slug: 'japanese' } }, { category: 'japan' })).toBe(false);
  });

  it('can replace a query expression containing a function call without duplicate query config attributes', () => {
    const code = `export default function Page() { return <div data-id="list">{posts.map(item => <p data-id="row">{item.title}</p>)}</div>; }`;
    const first = updateCollectionQueryConfig(code, 'list', {
      params: [
        { key: 'filter[slug][_eq]', value: 'String(params.slug)', isExpression: true },
      ],
    });
    const second = updateCollectionQueryConfig(first, 'list', {
      params: [
        { key: 'filter[slug][_eq]', value: 'params.slug', isExpression: true },
      ],
    });
    const ast = parse(second, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
    const tags: any[] = [];
    const visit = (x: any) => {
      if (!x || typeof x !== 'object') return;
      if (x.type === 'JSXOpeningElement') tags.push(x);
      for (const [key, value] of Object.entries(x)) {
        if (key === 'loc') continue;
        if (Array.isArray(value)) value.forEach(visit); else visit(value);
      }
    };
    visit(ast);
    expect(tags[0].attributes.filter((a: any) => a.name?.name === 'data-query-config')).toHaveLength(1);
  });

  it('builds card navigation from API rows with slug and no _slug', () => {
    const href = new Function('item', `return (${cmsNavHrefExpr('posts', 'posts', 'row')});`)({ slug: 'first-post', id: 1 });
    expect(href).toBe('/posts/first-post');
  });

  it('does not generate static parameter fetching when dynamic mode is requested', () => {
    const emitted = buildCmsDetailServerWrapper({ collection: 'posts', includeStaticParams: false });
    expect(emitted).not.toContain('export async function generateStaticParams');
  });

  it('preserves POST on the published index page', () => {
    saveCollectionSchema('posts', {
      name: 'Posts',
      slug: 'posts',
      fields: [{ id: 'title', name: 'Title', type: 'text' }],
    });
    createCmsIndexPageFile('posts');
    expect(files.get('app/posts/page.tsx')).toMatch(/method:\s*['"]POST['"]/);
  });

  it('disables API lookup after switching the project to local CMS mode', () => {
    setCmsMode('local');
    expect(getApiCollection('posts')).toBeNull();
  });

  it('renders inferred object fields without a React object-child crash', () => {
    saveCollectionSchema('posts', {
      name: 'Posts',
      slug: 'posts',
      fields: [
        { id: 'title', name: 'Title', type: 'text' },
        { id: 'author', name: 'Author', type: 'text' },
        { id: 'author.name', name: 'Author name', type: 'text' },
      ],
    });
    createCmsIndexPageFile('posts');
    const client = files.get('app/posts/page.client.tsx')!;
    const module = { exports: {} as any };
    const js = transform(client, {
      filename: 'page.tsx',
      presets: ['typescript', 'react'],
      plugins: ['transform-modules-commonjs'],
    }).code!;
    const React = require('react');
    const requireShim = (name: string) => name === 'react' ? React : name === 'next/link' ? ((props: any) => React.createElement('a', props)) : [];
    new Function('module', 'exports', 'require', js)(module, module.exports, requireShim);
    expect(() => renderToString(React.createElement(module.exports.default, { items: [{ slug: 'a', title: 'A', author: { name: 'Name' } }] }))).not.toThrow();
    const html = renderToString(React.createElement(module.exports.default, {
      items: [{ slug: 'b', title: { name: { nested: true }, value: 42 }, author: null }],
    }));
    expect(html).toContain('42');
    const match = client.match(/\{(typeof item\.title === 'object'[\s\S]*?String\(item\.title \?\? ''\))\}<\/p>/);
    expect(match).not.toBeNull();
    expect(extractItemMemberPath(parseExpression(match![1]), 'item')).toBe('title');
  });
});

describe('API CMS regression: JSX attribute serialization', () => {
  it('preserves empty alt as a string attribute rather than boolean true', () => {
    expect(serializeJSXAttr('alt', '')).toBe(' alt=""');
  });

  it('keeps empty alt through node source generation', () => {
    const code = buildNodeJSX({ id: 'photo', type: 'img', styles: {}, attrs: { alt: '', src: '/photo.webp' } }, false);
    expect(code).toContain('alt=""');
  });

  it('does not turn empty aria-label into a boolean JSX attribute', () => {
    expect(serializeJSXAttr('aria-label', '')).toBe(' aria-label=""');
  });
});
