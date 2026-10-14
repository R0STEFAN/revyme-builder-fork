// Permanent regression suite for CMS detail page bindings, expressions, and rendering.
import { describe, expect, it } from 'vitest';
import { transform } from '@babel/standalone';
import React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToString } from 'react-dom/server';
import { parseJSXToNodes } from '@/code/parsing/parser';
import { applyDetailPageBindings } from '@/code/features/cms-page-bindings';
import { cmsItemDisplayLabel } from '@/code/project/cms-page-ops';
import { getItemSlug } from '@/code/stores/cms-page-store';

const mockItems = [
  {
    id: 1,
    slug: 'first-tattoo',
    title: 'Dragon Sleeve',
    category: { slug: 'japanese', title: 'Japanese' },
    img_file: {
      id: '436f6e77-e4d1-451d-9a71-0b2a9e4c2588',
      filename_disk: '436f6e77-e4d1-451d-9a71-0b2a9e4c2588.jpg',
      filename_download: 'dragon.jpg',
      metadata: {},
    },
  },
];

const originalDetailCode = `
import React from 'react';
import { useParams } from 'next/navigation';
import tattoos from '@/cms/tattoos.json';

export default function Page({ item: serverItem }: { item?: any } = {}) {
  const params = useParams();
  const item = serverItem ?? tattoos.find(i => (i.slug || i._slug || String(i.id)) === params?.slug) ?? tattoos[0];
  return (
    <div data-id="root" key={String(params?.slug ?? '')}>
      <h1 data-id="title">{item.title}</h1>
    </div>
  );
}

const canvasNodes = (<>
  <img
    data-id="field-img_file"
    data-name="Img File"
    alt=""
    data-canvas-node="true"
    src={"https://api.tattoozp.com/assets/" + item.img_file.id}
  />
</>);
`;

const currentDetailCode = `
import React from 'react';
import { useParams } from 'next/navigation';
import tattoos from '@/cms/tattoos.json';

export default function Page({ item: serverItem }: { item?: any } = {}) {
  const params = useParams();
  const item = serverItem ?? tattoos.find(i => (i.slug || i._slug || String(i.id)) === params?.slug) ?? tattoos[0];
  return (
    <div data-id="root" key={String(params?.slug ?? '')}>
      <h1 data-id="title">{item.title}</h1>
      <img
        data-id="dup-mv7rocg6-2"
        data-name="Img File"
        alt=""
        src={"https://api.tattoozp.com/assets/" + item.img_file.id}
      />
      <div data-id="field-img_file.metadata">{typeof item.img_file?.metadata === 'object' ? JSON.stringify(item.img_file?.metadata) : item.img_file?.metadata}</div>
    </div>
  );
}
`;

function compile(source: string, items = mockItems) {
  const js = transform(source, {
    filename: 'page.client.tsx',
    presets: [
      ['env', { targets: { esmodules: true }, modules: 'commonjs' }],
      ['react', { runtime: 'automatic' }],
      'typescript',
    ],
  }).code!;
  const module = { exports: {} as any };
  const shim = (name: string) => {
    if (name === 'react') return React;
    if (name === 'react/jsx-runtime') return jsxRuntime;
    if (name === 'next/navigation') return { useParams: () => ({ slug: items[0].slug }) };
    if (name === '@/cms/tattoos.json') return items;
    throw new Error(`Unexpected import in test: ${name}`);
  };
  new Function('module', 'exports', 'require', '__import', js)(module, module.exports, shim, shim);
  return module.exports.default;
}

describe('CMS detail page bindings: observations and regression', () => {
  it('reproduces the original preview module error before Page renders when item is referenced at module scope', () => {
    expect(() => compile(originalDetailCode)).toThrow('item is not defined');
  });

  it('confirms placing expressions inside Page component resolves module-scope item error', () => {
    expect(() => compile(currentDetailCode)).not.toThrow();
  });

  it('confirms the original canvasNodes parser dropped dynamic image expressions', () => {
    const node = parseJSXToNodes(originalDetailCode).get('field-img_file')!;
    expect(node.attrs.src).toBeUndefined();
    expect(node.srcExpression).toBeUndefined();
  });

  it('separates the breadcrumb display title from the actual route slug', () => {
    expect(cmsItemDisplayLabel(mockItems[0])).toBe(mockItems[0].title);
    expect(getItemSlug(mockItems[0])).toBe(mockItems[0].slug);
    expect((mockItems[0] as any)._slug).toBeUndefined();
  });

  it('confirms gallery pages use query metadata with an unfiltered map', () => {
    const gallerySource = `
export default function GalleryPage({ params }: any) {
  return (
    <div data-id="gallery-root" data-query-config="{}">
      {params.category}
      {params.place}
      {tattoos.map(item => <p key={item.id}>{item.title}</p>)}
    </div>
  );
}
`;
    expect(gallerySource).toContain('data-query-config');
    expect(gallerySource).toContain('params.category');
    expect(gallerySource).toContain('params.place');
    expect(gallerySource).toContain('tattoos.map(');
    expect(gallerySource).not.toContain('tattoos.filter(');
  });
});

describe('CMS detail page bindings: remaining expected behavior', () => {
  it('resolves the corrected detail image src expression on the canvas', () => {
    const nodes = parseJSXToNodes(currentDetailCode);
    const image = nodes.get('dup-mv7rocg6-2')!;
    expect(image.srcExpression).toContain('item.img_file.id');
    const resolved = applyDetailPageBindings(nodes, mockItems[0]);
    expect(resolved.get('dup-mv7rocg6-2')!.attrs.src).toBe(`https://api.tattoozp.com/assets/${mockItems[0].img_file.id}`);
  });

  it('renders the corrected detail page without exposing object metadata as a React child', () => {
    const Page = compile(currentDetailCode);
    expect(() => renderToString(React.createElement(Page))).not.toThrow();
  });
});
