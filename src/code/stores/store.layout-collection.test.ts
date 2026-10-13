import { describe, it, expect, beforeEach } from 'vitest';
import { getDefaultStore } from 'jotai';
import { nodesAtom, getNodesSnapshot } from './store';
import { activeFilePathAtom } from '../project/active-file-store';
import { projectFS, projectVersionAtom } from '../project/project-fs';
import { clearComponentParseCache } from '../parsing/project-parser';

describe('store layout merge — collectionList templateIds prefixing', () => {
  beforeEach(() => {
    clearComponentParseCache();
  });

  it('prefixes collectionList.templateIds with layout:: for component instances and inline lists in layout', () => {
    const store = getDefaultStore();

    projectFS.writeFile(
      'components/Navbar.tsx',
      `import React from 'react';
import placements from '@/cms/placements.json';

export default function Navbar() {
  return (
    <nav data-id="nav-root" style={{ display: 'flex' }}>
      <div data-id="nav-list" style={{ display: 'flex' }}>
        {placements.map((item) => (
          <div key={item.id} data-id="item-muzrmhda-7" style={{ display: 'flex' }}>
            <span data-id="item-label">{item.title}</span>
          </div>
        ))}
      </div>
    </nav>
  );
}
`,
    );

    projectFS.writeFile(
      'app/(main)/layout.tsx',
      `import LayoutClient from './LayoutClient';
export default function MainLayout({ children }: { children: React.ReactNode }) {
  return <LayoutClient>{children}</LayoutClient>;
}
`,
    );

    projectFS.writeFile(
      'app/(main)/LayoutClient.tsx',
      `'use client';
import React from 'react';
import Navbar from '@/components/Navbar';
import placements from '@/cms/placements.json';

export default function LayoutClient({ children }: { children: React.ReactNode }) {
  return (
    <div data-id="layout-root" style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
      <Navbar data-id="navbar" />
      {children}
      <footer data-id="footer" style={{ display: 'flex' }}>
        <div data-id="direct-list" style={{ display: 'flex' }}>
          {placements.map((item) => (
            <div key={item.id} data-id="direct-item" style={{ display: 'flex' }}>
              <span data-id="direct-label">{item.title}</span>
            </div>
          ))}
        </div>
      </footer>
    </div>
  );
}
`,
    );

    projectFS.writeFile(
      'app/(main)/page.client.tsx',
      `'use client';
import React from 'react';

export default function Page() {
  return (
    <div data-id="root" style={{ position: 'relative', width: '100%' }}>
      <section data-id="hero" style={{ width: '100%', height: '400px' }}>Hero</section>
    </div>
  );
}
`,
    );

    store.set(activeFilePathAtom, 'app/(main)/page.client.tsx');
    store.set(projectVersionAtom, (v) => v + 1);

    const nodes = getNodesSnapshot();
    expect(store.get(nodesAtom)).toBe(nodes);

    // Component instance inside layout: 'navbar:nav-list' becomes 'layout::navbar:nav-list'
    const navListNode = nodes.get('layout::navbar:nav-list');
    expect(navListNode).toBeDefined();
    expect(navListNode?.collectionList).toBeDefined();
    expect(navListNode?.collectionList?.templateIds.default).toBe('layout::navbar:item-muzrmhda-7');

    // The template node referenced by templateIds['default'] must exist under that exact key
    const navTemplateNode = nodes.get(navListNode!.collectionList!.templateIds.default);
    expect(navTemplateNode).toBeDefined();
    expect(navTemplateNode?.id).toBe('layout::navbar:item-muzrmhda-7');
    expect(navTemplateNode?.fromLayout).toBe(true);

    // Direct collection list inside layout: 'direct-list' becomes 'layout::direct-list'
    const directListNode = nodes.get('layout::direct-list');
    expect(directListNode).toBeDefined();
    expect(directListNode?.collectionList).toBeDefined();
    expect(directListNode?.collectionList?.templateIds.default).toBe('layout::direct-item');

    const directTemplateNode = nodes.get(directListNode!.collectionList!.templateIds.default);
    expect(directTemplateNode).toBeDefined();
    expect(directTemplateNode?.id).toBe('layout::direct-item');
    expect(directTemplateNode?.fromLayout).toBe(true);
  });
});
