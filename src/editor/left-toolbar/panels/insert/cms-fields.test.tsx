import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { getDefaultStore } from 'jotai';

const fsStore = vi.hoisted(() => new Map<string, string>());

vi.mock('@/code/project/project-fs', () => {
  const { atom } = require('jotai');
  return {
    projectVersionAtom: atom(0),
    projectFS: {
      readFile: vi.fn((path: string) => fsStore.get(path) ?? null),
      writeFile: vi.fn((path: string, content: string) => { fsStore.set(path, content); }),
      deleteFile: vi.fn((path: string) => { fsStore.delete(path); }),
      listFiles: vi.fn((dir?: string) => {
        const prefix = dir ? (dir.endsWith('/') ? dir : dir + '/') : '';
        const result: string[] = [];
        for (const path of fsStore.keys()) {
          if (!prefix || path.startsWith(prefix)) result.push(path);
        }
        return result.sort();
      }),
      exists: vi.fn((path: string) => fsStore.has(path)),
    },
  };
});

vi.mock('@/backend/autosave', () => ({
  triggerAutosave: vi.fn(),
}));

vi.mock('@/shared/debug-trace', () => ({
  trace: { action: vi.fn(), fn: vi.fn(), dom: vi.fn(), error: vi.fn() },
}));

import { projectVersionAtom } from '@/code/project/project-fs';
import { codeAtom, nodesAtom, selectedIdsAtom } from '@/code/stores/store';
import InsertOverlay from './index';

describe('InsertOverlay — CMS Fields', () => {
  const store = getDefaultStore();

  beforeEach(() => {
    fsStore.clear();
    fsStore.set(
      'cms/tattoos.schema.json',
      JSON.stringify({
        name: 'Tattoos',
        slug: 'tattoos',
        fields: [
          { id: 'title', name: 'Title', type: 'text' },
          { id: 'photo', name: 'Photo', type: 'image' },
        ],
      })
    );
    fsStore.set(
      'cms/artists.schema.json',
      JSON.stringify({
        name: 'Artists',
        slug: 'artists',
        fields: [
          { id: 'name', name: 'Artist Name', type: 'text' },
          { id: 'bio', name: 'Biography', type: 'text' },
        ],
      })
    );
    store.set(projectVersionAtom, (v) => v + 1);
    store.set(codeAtom, 'export default function Page() { return <div data-id="root"/>; }');
    store.set(nodesAtom, new Map());
    store.set(selectedIdsAtom, []);
  });

  it('renders fields for multiple collections on a regular (non-detail) page', () => {
    render(<InsertOverlay />);

    // Hover the "Fields" category in the CMS section to open the secondary panel
    const fieldsCategory = screen.getByText('Fields');
    fireEvent.mouseEnter(fieldsCategory);

    // Both collection section headers should be visible
    expect(screen.getByText('Tattoos')).toBeTruthy();
    expect(screen.getByText('Artists')).toBeTruthy();

    // Fields from each collection should be visible
    expect(screen.getByText('Title')).toBeTruthy();
    expect(screen.getByText('Photo')).toBeTruthy();
    expect(screen.getByText('Artist Name')).toBeTruthy();
    expect(screen.getByText('Biography')).toBeTruthy();

    // Previous/Next links are detail-page only and should not appear here
    expect(screen.queryByText('← Previous')).toBeNull();
  });

  it('prioritizes the detail page collection and adds nav links on a detail page', () => {
    store.set(
      codeAtom,
      `/** @cmsPage { "kind": "detail", "collection": "tattoos" } */\nexport default function Page() { return <div data-id="root"/>; }`
    );

    render(<InsertOverlay />);

    const fieldsCategory = screen.getByText('Fields');
    fireEvent.mouseEnter(fieldsCategory);

    // Detail page collection has Previous / Next
    expect(screen.getByText('← Previous')).toBeTruthy();
    expect(screen.getByText('Next →')).toBeTruthy();

    // Both collections are still accessible
    expect(screen.getByText('Tattoos')).toBeTruthy();
    expect(screen.getByText('Artists')).toBeTruthy();
  });

  it('prioritizes the collection of a selected node inside a collection list', () => {
    store.set(nodesAtom, new Map([
      [
        'artist-card',
        {
          id: 'artist-card',
          type: 'div',
          isCollectionTemplate: true,
          collectionList: { source: 'artists', itemVar: 'item' },
        } as any,
      ],
    ]));
    store.set(selectedIdsAtom, ['artist-card']);

    render(<InsertOverlay />);

    const fieldsCategory = screen.getByText('Fields');
    fireEvent.mouseEnter(fieldsCategory);

    const sectionHeadings = screen.getAllByRole('heading', { level: 3 });
    // Artists should be the first section because the selected node is in the artists collection
    expect(sectionHeadings[0].textContent).toBe('Artists');
    expect(sectionHeadings[1].textContent).toBe('Tattoos');
  });
});
