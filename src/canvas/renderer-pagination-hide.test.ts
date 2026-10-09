// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';

const BLOG_ITEMS = JSON.stringify([
  { _id: 'b1', _slug: 'post-1', title: 'Post 1', category: 'news' },
  { _id: 'b2', _slug: 'post-2', title: 'Post 2', category: 'news' },
  { _id: 'b3', _slug: 'post-3', title: 'Post 3', category: 'tech' },
  { _id: 'b4', _slug: 'post-4', title: 'Post 4', category: 'tech' },
  { _id: 'b5', _slug: 'post-5', title: 'Post 5', category: 'tech' },
]);

vi.mock('@/code/project/project-fs', () => ({
  projectFS: {
    readFile: (path: string) => (path === 'cms/blog.json' ? BLOG_ITEMS : ''),
    listFiles: () => ['cms/blog.json'],
    exists: (path: string) => path === 'cms/blog.json',
    writeFile: () => {},
    deleteFile: () => {},
  },
}));

import { parseJSXToNodes } from '@/code/parsing/parser';
import { renderNodes } from '@/canvas/Renderer';

const pageWithPagination = (filterExpr = '') => `
import blog from '@/cms/blog.json';
import LoadMore from '@/components/LoadMore';
export default function Page() {
  const [visList, setVisList] = useState(3);
  return (
    <div data-id="root" style={{ position: 'relative', width: '100%' }}>
      <div data-id="list" data-pagination="loadMore:3" style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}>
        {blog${filterExpr}.slice(0, visList).map((item, idx) => (
          <div data-id="row" key={idx} style={{ position: 'relative', padding: '10px' }}>
            <p data-id="title">{item.title}</p>
          </div>
        ))}
        {visList < blog${filterExpr}.length && <LoadMore data-id="loadmore-list" data-pagination-ui="true" onLoadMore={() => setVisList((c) => c + 3)} />}
      </div>
    </div>
  );
}`;

describe('canvas renderer — pagination UI visibility when exhausted', () => {
  const viewports = [{ id: 'desktop', width: 1440, x: 0, y: 0, isPrimary: true }] as any;

  (globalThis as any).CSS = (globalThis as any).CSS ?? {};
  (globalThis as any).CSS.escape = (globalThis as any).CSS.escape ?? ((s: string) => s.replace(/[^a-zA-Z0-9_-]/g, (c: string) => `\\${c}`));

  it('keeps Load More visible when matching items exceed perPage', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    // 5 items total > 3 perPage
    const code = pageWithPagination('');
    renderNodes(container, parseJSXToNodes(code), null, () => {}, viewports, code);

    const loadMoreEl = container.querySelector('[data-id="loadmore-list"]') as HTMLElement;
    expect(loadMoreEl).not.toBeNull();
    expect(loadMoreEl.style.display).not.toBe('none');
    expect(loadMoreEl.getAttribute('data-pagination-hidden')).toBeNull();

    container.remove();
  });

  it('hides Load More when matching items count is less than or equal to perPage', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    // 2 items matching category === 'news' <= 3 perPage
    const code = pageWithPagination(".filter(item => item.category === 'news')");
    renderNodes(container, parseJSXToNodes(code), null, () => {}, viewports, code);

    const loadMoreEl = container.querySelector('[data-id="loadmore-list"]') as HTMLElement;
    expect(loadMoreEl).not.toBeNull();
    expect(loadMoreEl.style.display).toBe('none');
    expect(loadMoreEl.getAttribute('data-pagination-hidden')).toBe('true');

    container.remove();
  });

  it('hides Load More when 0 items match the filter', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    // 0 items matching category === 'nonexistent'
    const code = pageWithPagination(".filter(item => item.category === 'nonexistent')");
    renderNodes(container, parseJSXToNodes(code), null, () => {}, viewports, code);

    const loadMoreEl = container.querySelector('[data-id="loadmore-list"]') as HTMLElement;
    expect(loadMoreEl).not.toBeNull();
    expect(loadMoreEl.style.display).toBe('none');
    expect(loadMoreEl.getAttribute('data-pagination-hidden')).toBe('true');

    container.remove();
  });

  it('restores Load More visibility when filter changes to include more items than perPage', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    // 1. Initial render with 2 items <= 3 -> hidden
    const codeFiltered = pageWithPagination(".filter(item => item.category === 'news')");
    renderNodes(container, parseJSXToNodes(codeFiltered), null, () => {}, viewports, codeFiltered);

    let loadMoreEl = container.querySelector('[data-id="loadmore-list"]') as HTMLElement;
    expect(loadMoreEl.style.display).toBe('none');

    // 2. Patch render with all 5 items > 3 -> restored
    const codeUnfiltered = pageWithPagination('');
    renderNodes(container, parseJSXToNodes(codeUnfiltered), null, () => {}, viewports, codeUnfiltered);

    loadMoreEl = container.querySelector('[data-id="loadmore-list"]') as HTMLElement;
    expect(loadMoreEl.style.display).not.toBe('none');
    expect(loadMoreEl.getAttribute('data-pagination-hidden')).toBeNull();

    container.remove();
  });
});
