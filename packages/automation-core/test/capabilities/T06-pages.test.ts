// packages/automation-core/test/capabilities/T06-pages.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { defaultRegistry } from '../../src/registry';
import type { Snapshot, OperationContext, FileChange } from '../../src/contracts';
import { createPlan } from '../../src/plan';
import { validatePlan } from '../../src/validate';
import { checkFile } from '../../../../src/code/oracle/check-file';
import '../../src/operations/pages';
import '../../src/operations/templates';
import '../../src/operations/metadata';

function createMockContext(): OperationContext {
  let counter = 0;
  return {
    createId: (prefix = 'node') => `${prefix}-${++counter}`,
    signal: new AbortController().signal,
    trace: () => {},
    adapters: {},
  };
}

describe('T06: Pages, Templates, Routes, Metadata and SEO', () => {
  let files: Map<string, string>;
  let snapshot: Snapshot;
  let context: OperationContext;

  function applyChanges(changes: FileChange[]): void {
    for (const ch of changes) {
      if (ch.content === null) files.delete(ch.path);
      else files.set(ch.path, ch.content);
    }
  }

  beforeEach(() => {
    context = createMockContext();
    files = new Map();
    snapshot = {
      scope: { projectId: 't06-test-project', branchId: 'main' },
      revision: 1,
      files,
      config: {},
    };
  });

  it('creates homepage (/) and an about page (/about) with exact routes and pairs', async () => {
    const createOp = defaultRegistry.get('pages.create')!;
    expect(createOp).toBeDefined();

    // 1. Create homepage
    const homeRes = await createOp.execute(snapshot, { slug: '', title: 'Home' }, context);
    expect(homeRes.page.route).toBe('/');
    expect(homeRes.page.isHomepage).toBe(true);
    expect(homeRes.page.clientPath).toBe('app/page.client.tsx');
    expect(homeRes.page.serverPath).toBe('app/page.tsx');
    expect(homeRes.changes).toHaveLength(3); // server, client, and default layout.tsx

    // Apply changes to snapshot
    applyChanges(homeRes.changes);

    // 2. Create /about page
    const aboutRes = await createOp.execute(snapshot, { slug: 'about', title: 'About Us' }, context);
    expect(aboutRes.page.route).toBe('/about');
    expect(aboutRes.page.isHomepage).toBe(false);
    expect(aboutRes.page.clientPath).toBe('app/about/page.client.tsx');
    expect(aboutRes.page.serverPath).toBe('app/about/page.tsx');
    expect(aboutRes.changes).toHaveLength(2); // server, client

    applyChanges(aboutRes.changes);

    // 3. List pages
    const listOp = defaultRegistry.get('pages.list')!;
    const listRes = await listOp.execute(snapshot, {}, context);
    expect(listRes.pages).toHaveLength(2);
    expect(listRes.pages[0].route).toBe('/');
    expect(listRes.pages[1].route).toBe('/about');
    expect(listRes.pages[1].title).toBe('About Us');
  });

  it('detects and refuses route collisions', async () => {
    const createOp = defaultRegistry.get('pages.create')!;

    // Create /pricing
    const p1 = await createOp.execute(snapshot, { slug: 'pricing', title: 'Pricing' }, context);
    applyChanges(p1.changes);

    // Try creating /pricing again
    await expect(
      createOp.execute(snapshot, { slug: 'pricing', title: 'Pricing 2' }, context)
    ).rejects.toThrow(/PAGE_ALREADY_EXISTS|ROUTE_COLLISION/);
  });

  it('creates template pages with a bare root that does not collide with the layout root', async () => {
    const createOp = defaultRegistry.get('pages.create')!;
    const res = await createOp.execute(
      snapshot,
      { slug: 'about', title: 'About Us', template: 'site-shell' },
      context
    );
    const clientCode = res.changes.find((change: FileChange) => change.path.endsWith('page.client.tsx'))!.content!;

    expect(clientCode).toContain("data-id=\"root\"");
    expect(clientCode).not.toContain("minHeight: '900px'");
    expect(clientCode).not.toContain("backgroundColor: '#ffffff'");
    expect(checkFile(clientCode, { kind: 'page', path: res.page.clientPath, isTemplated: true })
      .map((issue) => issue.code)).not.toContain('TEMPLATED_PAGE_ROOT_STYLED');
  });

  it('creates a shared template with exactly one {children} slot', async () => {
    const createTemplateOp = defaultRegistry.get('templates.create')!;

    const res = await createTemplateOp.execute(
      snapshot,
      {
        name: 'marketing',
        headerContent: '<nav data-id="h-nav">Navigation</nav>',
        footerContent: '<p data-id="f-copy">Footer Rights</p>',
      },
      context
    );

    expect(res.template.name).toBe('marketing');
    expect(res.template.clientPath).toBe('app/(marketing)/LayoutClient.tsx');
    expect(res.template.layoutPath).toBe('app/(marketing)/layout.tsx');

    applyChanges(res.changes);

    const clientCode = files.get('app/(marketing)/LayoutClient.tsx')!;
    // Count occurrences of {children} slot
    const matches = clientCode.match(/\{children\}/g);
    expect(matches).not.toBeNull();
    expect(matches?.length).toBe(1);

    // Verify layout re-exports LayoutClient wrapping children
    const layoutCode = files.get('app/(marketing)/layout.tsx')!;
    expect(layoutCode).toContain('<LayoutClient>{children}</LayoutClient>');
  });

  it('creates builder-valid templates with imported component slots and the required root id', async () => {
    const createTemplateOp = defaultRegistry.get('templates.create')!;
    files.set('components/SiteNavbar.tsx', 'export default function SiteNavbar() { return <nav />; }');
    files.set('components/SiteFooter.tsx', 'export default function SiteFooter() { return <footer />; }');

    const res = await createTemplateOp.execute(
      snapshot,
      {
        name: 'site-shell',
        headerContent: '<SiteNavbar data-id="template-navbar" data-name="Site Navbar" />',
        footerContent: '<SiteFooter data-id="template-footer" data-name="Site Footer" />',
      },
      context
    );

    const clientCode = res.changes.find((change: FileChange) => change.path.endsWith('LayoutClient.tsx'))!.content!;
    expect(clientCode).toContain('import SiteNavbar from \'@/components/SiteNavbar\';');
    expect(clientCode).toContain('import SiteFooter from \'@/components/SiteFooter\';');
    expect(clientCode).toContain('<div data-id="root"');
    expect(clientCode).not.toContain("minHeight: '100vh'");
    expect(clientCode).toContain('<SiteNavbar data-id="template-navbar"');
    expect(clientCode).toContain('<SiteFooter data-id="template-footer"');
    expect(clientCode).not.toContain('textAlign: \'center\'');
    expect(clientCode.match(/\{children\}/g)).toHaveLength(1);
    expect(checkFile(clientCode, { kind: 'template', path: res.template.clientPath }).map((issue) => issue.code))
      .toEqual([]);
  });

  it('validates LayoutClient as a template rather than a styled templated page', () => {
    const layoutCode = `'use client';\n\n/* @canvas { single: true } */\n\nimport React from 'react';\n\nexport default function LayoutClient({ children }: { children: React.ReactNode }) {\n  return <div data-id="root" data-name="Template site-shell" style={{ position: 'relative', width: '100%', backgroundColor: '#FFFFFF', overflowX: 'hidden' }}>\n    {children}\n  </div>;\n}`;
    const plan = createPlan({
      scope: snapshot.scope,
      baseRevision: snapshot.revision,
      operationId: 'layout-kind-regression',
      changes: [{ path: 'app/(site-shell)/LayoutClient.tsx', beforeHash: null, content: layoutCode }],
    });

    const result = validatePlan(snapshot, plan);
    expect(result.issues.map((issue) => issue.code)).not.toContain('TEMPLATED_PAGE_ROOT_STYLED');
    expect(result.issues.map((issue) => issue.code)).not.toContain('TEMPLATE_CHILDREN_WRAPPED');
  });

  it('does not mistake a page inside a route group named template for LayoutClient', () => {
    const pageCode = `'use client';\n\n/** @canvas { "viewports": [{ "id": "desktop", "label": "Desktop", "width": 1200, "height": "auto", "isPrimary": true, "order": 0 }], "positions": { "desktop": { "x": 0, "y": 0 } } } */\n\nimport React from 'react';\n\nexport default function Page() {\n  return <div data-id="root" data-name="Page" style={{ position: 'relative', width: '100%', backgroundColor: '#FFFFFF' }} />;\n}`;
    const plan = createPlan({
      scope: snapshot.scope,
      baseRevision: snapshot.revision,
      operationId: 'route-group-kind-regression',
      changes: [{ path: 'app/(template)/about/page.client.tsx', beforeHash: null, content: pageCode }],
    });

    const result = validatePlan(snapshot, plan);
    expect(result.issues.map((issue) => issue.code)).toContain('TEMPLATED_PAGE_ROOT_STYLED');
  });

  it('assigns and unassigns a page to a template', async () => {
    const createPageOp = defaultRegistry.get('pages.create')!;
    const createTemplateOp = defaultRegistry.get('templates.create')!;
    const assignOp = defaultRegistry.get('templates.assign')!;

    // 1. Setup page and template
    const pageRes = await createPageOp.execute(snapshot, { slug: 'features' }, context);
    applyChanges(pageRes.changes);

    const templateRes = await createTemplateOp.execute(snapshot, { name: 'docs' }, context);
    applyChanges(templateRes.changes);

    // 2. Assign /features to docs template
    const assignRes = await assignOp.execute(
      snapshot,
      { pageSlug: 'features', templateName: 'docs' },
      context
    );
    expect(assignRes.template).toBe('docs');
    expect(assignRes.changes).toHaveLength(4); // delete 2 old, create 2 new

    // Apply assign changes
    applyChanges(assignRes.changes);

    expect(files.has('app/(docs)/features/page.client.tsx')).toBe(true);
    expect(files.has('app/features/page.client.tsx')).toBe(false);

    // 3. Unassign /features back to root
    const unassignRes = await assignOp.execute(
      snapshot,
      { pageSlug: 'features', templateName: null },
      context
    );
    expect(unassignRes.template).toBeNull();
    applyChanges(unassignRes.changes);

    expect(files.has('app/features/page.client.tsx')).toBe(true);
    expect(files.has('app/(docs)/features/page.client.tsx')).toBe(false);
  });

  it('keeps pages.assign output valid when moving a styled default page into a template', async () => {
    const createPageOp = defaultRegistry.get('pages.create')!;
    const createTemplateOp = defaultRegistry.get('templates.create')!;
    const assignOp = defaultRegistry.get('templates.assign')!;

    const pageRes = await createPageOp.execute(snapshot, {
      slug: 'styled-page',
      title: 'Styled Page',
      content: '<section data-id="section-1">Content</section>',
    }, context);
    applyChanges(pageRes.changes);
    const templateRes = await createTemplateOp.execute(snapshot, { name: 'site-shell' }, context);
    applyChanges(templateRes.changes);

    const assignRes = await assignOp.execute(snapshot, {
      pageSlug: 'styled-page',
      templateName: 'site-shell',
    }, context);
    const movedPage = assignRes.changes.find((change: FileChange) => change.path.endsWith('page.client.tsx') && change.content);
    expect(checkFile(movedPage!.content!, {
      kind: 'page',
      path: movedPage!.path,
      isTemplated: true,
    }).map((issue) => issue.code)).not.toContain('TEMPLATED_PAGE_ROOT_STYLED');
    expect(movedPage?.content).toContain('data-id="section-1"');
    expect(movedPage?.content).toContain('data-name="Styled Page Content"');
    expect(movedPage?.content).toContain("backgroundColor: '#ffffff'");
  });

  it('keeps pages.update output valid when assigning a styled page to a template', async () => {
    const createPageOp = defaultRegistry.get('pages.create')!;
    const createTemplateOp = defaultRegistry.get('templates.create')!;
    const updateOp = defaultRegistry.get('pages.update')!;

    const pageRes = await createPageOp.execute(snapshot, {
      slug: 'updated-page',
      title: 'Updated Page',
      content: '<section data-id="section-2">Content</section>',
    }, context);
    applyChanges(pageRes.changes);
    const templateRes = await createTemplateOp.execute(snapshot, { name: 'site-shell' }, context);
    applyChanges(templateRes.changes);

    const updateRes = await updateOp.execute(snapshot, {
      slug: 'updated-page',
      template: 'site-shell',
    }, context);
    const movedPage = updateRes.changes.find((change: FileChange) => change.path.endsWith('page.client.tsx') && change.content);
    expect(checkFile(movedPage!.content!, {
      kind: 'page',
      path: movedPage!.path,
      isTemplated: true,
    }).map((issue) => issue.code)).not.toContain('TEMPLATED_PAGE_ROOT_STYLED');
    expect(movedPage?.content).toContain('data-id="section-2"');
    expect(movedPage?.content).toContain('data-name="Updated Page Content"');
    expect(movedPage?.content).toContain("backgroundColor: '#ffffff'");
  });

  it('duplicates an existing page with new IDs and paths', async () => {
    const createPageOp = defaultRegistry.get('pages.create')!;
    const duplicatePageOp = defaultRegistry.get('pages.duplicate')!;

    const p1 = await createPageOp.execute(snapshot, {
      slug: 'blog',
      title: 'Blog',
      content: '<section data-id="section-1"><p data-id="text-1">Article list</p></section>',
    }, context);
    applyChanges(p1.changes);

    const dupRes = await duplicatePageOp.execute(
      snapshot,
      { slug: 'blog', newSlug: 'blog-archive', title: 'Blog Archive' },
      context
    );

    expect(dupRes.page.route).toBe('/blog-archive');
    expect(dupRes.page.title).toBe('Blog Archive');
    applyChanges(dupRes.changes);

    expect(files.has('app/blog/page.client.tsx')).toBe(true);
    expect(files.has('app/blog-archive/page.client.tsx')).toBe(true);

    const clientCode = files.get('app/blog-archive/page.client.tsx')!;
    expect(clientCode).toContain('data-name="Blog Archive"');
    expect(clientCode).toContain('data-id="root"');
    expect(clientCode).toContain('data-id="node-');
    expect(clientCode).not.toContain('data-id="section-1"');
    expect(clientCode).not.toContain('data-id="text-1"');
    expect(checkFile(clientCode, { kind: 'page', path: 'app/blog-archive/page.client.tsx' })
      .map((issue) => issue.code)).not.toContain('PAGE_ROOT_REQUIRED');
  });

  it('removes a non-homepage page and refuses removing homepage', async () => {
    const createPageOp = defaultRegistry.get('pages.create')!;
    const removePageOp = defaultRegistry.get('pages.remove')!;

    const home = await createPageOp.execute(snapshot, { slug: '', title: 'Home' }, context);
    applyChanges(home.changes);

    const contact = await createPageOp.execute(snapshot, { slug: 'contact', title: 'Contact' }, context);
    applyChanges(contact.changes);

    // Refuse removing homepage without force
    await expect(
      removePageOp.execute(snapshot, { slug: '' }, context)
    ).rejects.toThrow(/CANNOT_REMOVE_HOMEPAGE/);

    // Remove contact page successfully
    const removeRes = await removePageOp.execute(snapshot, { slug: 'contact' }, context);
    expect(removeRes.removedSlug).toBe('contact');
    applyChanges(removeRes.changes);

    expect(files.has('app/contact/page.client.tsx')).toBe(false);
    expect(files.has('app/contact/page.tsx')).toBe(false);
  });

  it('reads and updates metadata and siteConfig with empty string property deletion', async () => {
    const metaReadOp = defaultRegistry.get('metadata.read')!;
    const metaUpdateOp = defaultRegistry.get('metadata.update')!;

    // 1. Initial read on empty snapshot creates or returns defaults
    const initial = await metaReadOp.execute(snapshot, {}, context);
    expect(initial.targetFile).toBe('app/layout.tsx');

    // 2. Update metadata with title, description, and openGraph
    const updateRes = await metaUpdateOp.execute(
      snapshot,
      {
        targetFile: 'app/layout.tsx',
        metadata: {
          title: 'My Brand',
          description: 'Top notch software',
          icons: { icon: '/favicon.ico' },
          openGraph: {
            title: 'My Brand Social',
            description: 'Social Description',
          },
        },
        siteConfig: {
          language: 'uk',
          theme: 'dark',
        },
      },
      context
    );

    applyChanges(updateRes.changes);

    // 3. Read back updated metadata
    const readBack = await metaReadOp.execute(snapshot, {}, context);
    expect(readBack.metadata.title).toBe('My Brand');
    expect(readBack.metadata.description).toBe('Top notch software');
    expect(readBack.metadata.icons?.icon).toBe('/favicon.ico');
    expect(readBack.metadata.openGraph?.title).toBe('My Brand Social');
    expect(readBack.siteConfig?.theme).toBe('dark');
    expect(snapshot.files.get('app/layout.tsx')).toContain(`<html lang={siteConfig.language || 'en'} suppressHydrationWarning>`);

    // 4. Test Invariant 3: Empty string deletes property
    const deletePropRes = await metaUpdateOp.execute(
      snapshot,
      {
        targetFile: 'app/layout.tsx',
        metadata: {
          description: '', // Should be removed
        },
      },
      context
    );

    applyChanges(deletePropRes.changes);

    const afterDelete = await metaReadOp.execute(snapshot, {}, context);
    expect(afterDelete.metadata.title).toBe('My Brand');
    expect(afterDelete.metadata.description).toBeUndefined();
  });
});
