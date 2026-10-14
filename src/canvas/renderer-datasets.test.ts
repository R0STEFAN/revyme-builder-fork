// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

const DEFAULT_TATTOOS = JSON.stringify([
  { _id: 't-fallback', _slug: 'fallback-tattoo', title: 'Fallback Default Tattoo' },
]);

vi.mock('@/code/project/project-fs', () => ({
  projectFS: {
    readFile: (path: string) => (path === 'cms/tattoos.json' ? DEFAULT_TATTOOS : ''),
    listFiles: () => ['cms/tattoos.json'],
    exists: (path: string) => path === 'cms/tattoos.json',
    writeFile: () => {},
    deleteFile: () => {},
  },
}));

import { parseJSXToNodes } from '@/code/parsing/parser';
import { renderNodes, setRendererListDatasets } from '@/canvas/Renderer';

const pageWithTwoLists = `
import tattoos from '@/cms/tattoos.json';

export default function Page() {
  return (
    <div data-id="root" style={{ position: 'relative', width: '100%' }}>
      <div data-id="list-men" style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}>
        {tattoos.filter(item => item.category === 'men').map((item, idx) => (
          <div data-id="row-men" key={idx} style={{ position: 'relative', padding: '10px' }}>
            <p data-id="title-men">{item.title}</p>
          </div>
        ))}
      </div>
      <div data-id="list-women" style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}>
        {tattoos.filter(item => item.category === 'women').map((item, idx) => (
          <div data-id="row-women" key={idx} style={{ position: 'relative', padding: '10px' }}>
            <p data-id="title-women">{item.title}</p>
          </div>
        ))}
      </div>
    </div>
  );
};
`;

describe('canvas renderer — per-node list datasets and empty response lifecycle', () => {
  const viewports = [{ id: 'desktop', width: 1440, x: 0, y: 0, isPrimary: true }] as any;

  (globalThis as any).CSS = (globalThis as any).CSS ?? {};
  (globalThis as any).CSS.escape =
    (globalThis as any).CSS.escape ??
    ((s: string) => s.replace(/[^a-zA-Z0-9_-]/g, (c: string) => `\\${c}`));

  beforeEach(() => {
    setRendererListDatasets(null);
  });

  it('renders independent datasets for two lists backed by the same collection', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const menData = [
      { _id: 'm1', _slug: 'dragon-tattoo', title: 'Dragon Tattoo (Men)', category: 'men' },
      { _id: 'm2', _slug: 'tiger-tattoo', title: 'Tiger Tattoo (Men)', category: 'men' },
    ];
    const womenData = [
      { _id: 'w1', _slug: 'rose-tattoo', title: 'Rose Tattoo (Women)', category: 'women' },
      { _id: 'w2', _slug: 'lotus-tattoo', title: 'Lotus Tattoo (Women)', category: 'women' },
      { _id: 'w3', _slug: 'butterfly-tattoo', title: 'Butterfly Tattoo (Women)', category: 'women' },
    ];

    const listDatasets = {
      'list-men': menData,
      'list-women': womenData,
    };

    const nodes = parseJSXToNodes(pageWithTwoLists);
    renderNodes(
      container,
      nodes,
      null,
      () => {},
      viewports,
      pageWithTwoLists,
      undefined,
      undefined,
      undefined,
      undefined,
      { data: {}, schemas: {}, listData: listDatasets },
      listDatasets,
    );

    const listMenEl = container.querySelector('[data-id="list-men"]') as HTMLElement;
    const listWomenEl = container.querySelector('[data-id="list-women"]') as HTMLElement;

    expect(listMenEl).not.toBeNull();
    expect(listWomenEl).not.toBeNull();

    // Verify list-men has 2 items: 1 template + 1 ghost
    const menGhosts = listMenEl.querySelectorAll(':scope > [data-collection-ghost]');
    expect(menGhosts.length).toBe(1);
    expect(listMenEl.textContent).toContain('Dragon Tattoo (Men)');
    expect(listMenEl.textContent).toContain('Tiger Tattoo (Men)');
    expect(listMenEl.textContent).not.toContain('Rose Tattoo (Women)');

    // Verify list-women has 3 items: 1 template + 2 ghosts
    const womenGhosts = listWomenEl.querySelectorAll(':scope > [data-collection-ghost]');
    expect(womenGhosts.length).toBe(2);
    expect(listWomenEl.textContent).toContain('Rose Tattoo (Women)');
    expect(listWomenEl.textContent).toContain('Lotus Tattoo (Women)');
    expect(listWomenEl.textContent).toContain('Butterfly Tattoo (Women)');
    expect(listWomenEl.textContent).not.toContain('Dragon Tattoo (Men)');

    container.remove();
  });

  it('updates list to empty state on empty response ([]) without retaining stale items', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const initialMenData = [
      { _id: 'm1', _slug: 'dragon-tattoo', title: 'Dragon Tattoo (Men)', category: 'men' },
      { _id: 'm2', _slug: 'tiger-tattoo', title: 'Tiger Tattoo (Men)', category: 'men' },
    ];
    const initialWomenData = [
      { _id: 'w1', _slug: 'rose-tattoo', title: 'Rose Tattoo (Women)', category: 'women' },
    ];

    const nodes = parseJSXToNodes(pageWithTwoLists);

    // Initial render with items
    renderNodes(
      container,
      nodes,
      null,
      () => {},
      viewports,
      pageWithTwoLists,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        'list-men': initialMenData,
        'list-women': initialWomenData,
      },
    );

    const listMenEl = container.querySelector('[data-id="list-men"]') as HTMLElement;
    expect(listMenEl.querySelectorAll(':scope > [data-collection-ghost]').length).toBe(1);
    expect(listMenEl.textContent).toContain('Dragon Tattoo (Men)');

    // Transition list-men to empty array []
    const updatedDatasets = {
      'list-men': [],
      'list-women': initialWomenData,
    };

    renderNodes(
      container,
      nodes,
      null,
      () => {},
      viewports,
      pageWithTwoLists,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      updatedDatasets,
    );

    // Stale ghosts must be completely removed
    const remainingGhosts = listMenEl.querySelectorAll(':scope > [data-collection-ghost]');
    expect(remainingGhosts.length).toBe(0);

    // Template row must be hidden
    const templateRow = listMenEl.querySelector('[data-id="row-men"]') as HTMLElement;
    expect(templateRow).not.toBeNull();
    expect(templateRow.style.display).toBe('none');
    expect(templateRow.getAttribute('data-collection-empty-hidden')).toBe('true');

    // Empty placeholder must be shown
    const emptyPlaceholder = listMenEl.querySelector('[data-collection-empty="true"]') as HTMLElement;
    expect(emptyPlaceholder).not.toBeNull();
    expect(emptyPlaceholder.textContent).toBe('No items in tattoos');

    // list-women must still have its items rendered
    const listWomenEl = container.querySelector('[data-id="list-women"]') as HTMLElement;
    expect(listWomenEl.textContent).toContain('Rose Tattoo (Women)');

    container.remove();
  });

  it('restores rows when transitioning from empty state back to non-empty dataset', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const nodes = parseJSXToNodes(pageWithTwoLists);

    // First render: empty
    renderNodes(
      container,
      nodes,
      null,
      () => {},
      viewports,
      pageWithTwoLists,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { 'list-men': [], 'list-women': [] },
    );

    const listMenEl = container.querySelector('[data-id="list-men"]') as HTMLElement;
    expect(listMenEl.querySelector('[data-collection-empty="true"]')).not.toBeNull();

    // Second render: populated
    const populated = [
      { _id: 'm1', _slug: 'new-tattoo', title: 'Restored New Tattoo', category: 'men' },
    ];
    renderNodes(
      container,
      nodes,
      null,
      () => {},
      viewports,
      pageWithTwoLists,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { 'list-men': populated, 'list-women': [] },
    );

    // Placeholder must be gone
    expect(listMenEl.querySelector('[data-collection-empty="true"]')).toBeNull();

    // Template row must be unhidden and contain new title
    const templateRow = listMenEl.querySelector('[data-id="row-men"]') as HTMLElement;
    expect(templateRow.style.display).toBe('');
    expect(templateRow.getAttribute('data-collection-empty-hidden')).toBeNull();
    expect(listMenEl.textContent).toContain('Restored New Tattoo');

    container.remove();
  });
});
