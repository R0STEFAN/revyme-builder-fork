import { describe, test, expect, beforeEach } from 'vitest';
import { buildPageTree, extractSlug } from './FileExplorer';
import { createPageFile, createRouteGroup } from '../code/project/active-file-store';
import { createPageFolder } from '../code/project/page-folders';
import { projectFS, resetProjectFS } from '../code/project/project-fs';

beforeEach(() => {
  resetProjectFS();
});

// ─── buildPageTree ──────────────────────────────────────────────────────────

describe('buildPageTree', () => {
  test('returns home page at root level', () => {
    const tree = buildPageTree(0);
    const homePage = tree.find(e => e.isHome);
    expect(homePage).toBeDefined();
    // Home renders as 'Home' (standard), not '/' — matches the
    // human-readable label used in the Pages panel.
    expect(homePage!.label).toBe('Home');
    expect(homePage!.type).toBe('page');
    expect(homePage!.depth).toBe(0);
    expect(homePage!.group).toBeNull();
  });

  test('home page is always first', () => {
    createPageFile('About');
    createPageFile('Contact');
    const tree = buildPageTree(0);
    const pages = tree.filter(e => e.type === 'page');
    expect(pages[0].isHome).toBe(true);
  });

  test('includes additional pages at root level', () => {
    createPageFile('About');
    const tree = buildPageTree(0);
    const aboutEntry = tree.find(e => e.type === 'page' && e.label === '/about');
    expect(aboutEntry).toBeDefined();
    expect(aboutEntry!.depth).toBe(0);
    expect(aboutEntry!.group).toBeNull();
  });

  test('does NOT include any layout entries — layouts live elsewhere', () => {
    // Layout files (root or per-template) used to render in the Pages
    // panel; that's been moved out — the panel is pages-only. Editing a
    // template's LayoutClient happens via the right-panel Template
    // picker's Edit button.
    const tree = buildPageTree(0);
    expect(tree.find(e => e.type === 'layout')).toBeUndefined();
  });

  test('templated pages surface FLAT — no group wrapper in the tree', () => {
    // createRouteGroup with a layout = a Template. Templates are an
    // attribute of a page, not a parent in the panel — pages inside
    // them appear at root level just like bare pages.
    createRouteGroup('marketing');
    // Page-pair migration: buildPageTree keys off the .client.tsx half.
    projectFS.writeFile('app/(marketing)/landing/page.client.tsx', '"use client"; export default function Page() { return <div>Landing</div>; }');
    const tree = buildPageTree(0);
    // No group entry for the template
    expect(tree.find(e => e.type === 'group' && e.group === 'marketing')).toBeUndefined();
    // The templated page sits at root level
    const landing = tree.find(e => e.type === 'page' && e.label === '/landing');
    expect(landing).toBeDefined();
    expect(landing!.depth).toBe(0);
    expect(landing!.group).toBe('marketing');
  });

  test('plain route groups (no layout) DO render as folders', () => {
    // Organisational groups (no LayoutClient) keep their group entry —
    // the user explicitly created the folder for organisation, so we
    // honour that. Only Templates flatten.
    createRouteGroup('archive', false);
    // Page-pair migration: buildPageTree keys off the .client.tsx half.
    projectFS.writeFile('app/(archive)/old/page.client.tsx', '"use client"; export default function Page() { return <div>Old</div>; }');
    const tree = buildPageTree(0);
    const group = tree.find(e => e.type === 'group' && e.group === 'archive');
    expect(group).toBeDefined();
    expect(group!.label).toBe('(archive)');
    expect(group!.isTemplate).toBe(false);
    // Pages inside surface as that group's children, not at root.
    const oldPage = group!.children.find(e => e.type === 'page' && e.label === '/old');
    expect(oldPage).toBeDefined();
    expect(oldPage!.depth).toBe(1);
  });

  test('templated pages nest by path (/landing/team under /landing)', () => {
    createRouteGroup('marketing');
    // Use a slug that doesn't collide with the starter's `(default)/about`.
    // Page-pair migration: buildPageTree keys off the .client.tsx half.
    projectFS.writeFile('app/(marketing)/landing/page.client.tsx', '"use client"; export default function Page() { return <div>Landing</div>; }');
    projectFS.writeFile('app/(marketing)/landing/team/page.client.tsx', '"use client"; export default function Page() { return <div>Team</div>; }');
    const tree = buildPageTree(0);
    const landing = tree.find(e => e.type === 'page' && e.label === '/landing');
    expect(landing).toBeDefined();
    const team = landing!.children.find(e => e.type === 'page' && e.label === '/team');
    expect(team).toBeDefined();
    expect(team!.depth).toBe(1);
  });

  test('multiple plain route groups are sorted alphabetically', () => {
    createRouteGroup('aa-archive', false);
    createRouteGroup('zz-archive', false);
    projectFS.writeFile('app/(aa-archive)/x/page.tsx', '/* x */');
    projectFS.writeFile('app/(zz-archive)/y/page.tsx', '/* y */');
    const tree = buildPageTree(0);
    const groups = tree.filter(e => e.type === 'group');
    expect(groups.length).toBe(2);
    expect(groups[0].label).toBe('(aa-archive)');
    expect(groups[1].label).toBe('(zz-archive)');
  });

  test('sort order: home first, then everything alphabetical', () => {
    createRouteGroup('marketing');
    createPageFile('About');
    const tree = buildPageTree(0);
    // Home should always be first.
    expect(tree[0].isHome).toBe(true);
    // No `'layout'`-typed entries surface in the tree any more — layouts
    // are accessed via the Template picker / Library, not the page tree.
    expect(tree.every(e => e.type !== 'layout')).toBe(true);
  });
});

// ─── extractSlug ────────────────────────────────────────────────────────────

describe('extractSlug', () => {
  test('extracts slug from simple page path', () => {
    expect(extractSlug('app/about/page.tsx')).toBe('about');
  });

  test('returns empty for home page', () => {
    expect(extractSlug('app/page.tsx')).toBe('');
  });

  test('extracts slug from grouped page path', () => {
    expect(extractSlug('app/(marketing)/about/page.tsx')).toBe('about');
  });

  test('handles nested slugs', () => {
    expect(extractSlug('app/blog/posts/page.tsx')).toBe('blog/posts');
  });

  test('handles nested slugs inside groups', () => {
    expect(extractSlug('app/(marketing)/blog/posts/page.tsx')).toBe('blog/posts');
  });
});

// ─── Virtual folder rows ────────────────────────────────────────────────────
//
// Framer publishes `/fonctionnalites` as a FOLDER: it holds pages but is
// not a page itself (the route 404s). Imported flat, its children had no
// ancestor page-file and each sat at the top level under its full path.

describe('buildPageTree — folders for page-less route segments', () => {
  const page = (route: string) =>
    projectFS.writeFile(`app/${route}/page.client.tsx`, '"use client"; export default function Page() { return <div/>; }');

  test('groups children under a folder row when the parent has no page', () => {
    page('fonctionnalites/capture');
    page('fonctionnalites/integrations');
    const tree = buildPageTree(0);

    const folder = tree.find(e => e.type === 'folder');
    expect(folder).toBeDefined();
    expect(folder!.label).toBe('/fonctionnalites');
    expect(folder!.depth).toBe(0);
    expect(folder!.children.map(c => c.label).sort()).toEqual(['/capture', '/integrations']);
    expect(folder!.children.every(c => c.depth === 1)).toBe(true);
    // …and they no longer appear at the top level (the scaffold's own
    // `/about` is the only page row left beside Home).
    expect(tree.filter(e => e.type === 'page' && !e.isHome).map(e => e.label)).toEqual(['/about']);
  });

  test('a real parent page still wins over a folder', () => {
    page('articles');
    page('articles/hello');
    const tree = buildPageTree(0);

    expect(tree.find(e => e.type === 'folder')).toBeUndefined();
    const articles = tree.find(e => e.label === '/articles')!;
    expect(articles.type).toBe('page');
    expect(articles.children.map(c => c.label)).toEqual(['/hello']);
  });

  test('folders nest inside folders', () => {
    page('docs/guides/intro');
    const tree = buildPageTree(0);

    const docs = tree.find(e => e.label === '/docs')!;
    expect(docs.type).toBe('folder');
    const guides = docs.children[0]!;
    expect(guides.type).toBe('folder');
    expect(guides.label).toBe('/guides');
    expect(guides.children[0]!.label).toBe('/intro');
  });

  test('top-level pages never become folders', () => {
    page('about');
    const tree = buildPageTree(0);
    expect(tree.find(e => e.type === 'folder')).toBeUndefined();
    expect(tree.find(e => e.label === '/about')!.type).toBe('page');
  });

  test('an EMPTY folder created by hand still shows a row', () => {
    // Nothing on disk implies it — it comes from `_meta/page-folders.json`.
    const dir = createPageFolder('Ressources');
    const tree = buildPageTree(0);
    const folder = tree.find(e => e.filePath === dir);
    expect(folder).toBeDefined();
    expect(folder!.type).toBe('folder');
    expect(folder!.label).toBe('/ressources');
    expect(folder!.children).toEqual([]);
  });

  test('dynamic routes nest correctly preserving brackets', () => {
    page('gallery/[category]/[place]');
    const tree = buildPageTree(0);

    const gallery = tree.find(e => e.label === '/gallery');
    expect(gallery).toBeDefined();
    expect(gallery!.type).toBe('folder');

    const category = gallery!.children[0];
    expect(category).toBeDefined();
    expect(category.label).toBe('/[category]');
    expect(category.type).toBe('folder');

    const place = category.children[0];
    expect(place).toBeDefined();
    expect(place.label).toBe('/[place]');
    expect(place.type).toBe('page');
  });
});
