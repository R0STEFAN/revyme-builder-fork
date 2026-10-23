// packages/automation-core/test/acceptance/L02-dynamic.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import type { Snapshot, OperationContext, FileChange } from '../../src/contracts';
import { createSnapshot, createOperationContext } from '../../src/session';
import { defaultRegistry } from '../../src/registry';
import { parseJSXToNodes } from '@/code/parsing/parser';
import { projectFS } from '@/code/project/project-fs';

// Operations used in L02
import { pagesCreateOperation } from '../../src/operations/pages';
import { nodesCreateOperation } from '../../src/operations/nodes';
import {
  cmsSchemaCreateOperation,
  cmsFieldAddOperation,
} from '../../src/operations/cms-schema';
import {
  cmsItemsCreateOperation,
  cmsItemsUpdateOperation,
  cmsItemsListOperation,
} from '../../src/operations/cms-items';
import {
  cmsPagesCreateIndexOperation,
  cmsPagesCreateDetailOperation,
  cmsPagesFindOperation,
} from '../../src/operations/cms-pages';
import {
  cmsListCreateOperation,
  cmsFieldBindOperation,
} from '../../src/operations/cms-bindings';
import {
  cmsApiModeSetOperation,
  cmsApiCollectionSetOperation,
  cmsApiSearchFieldAddOperation,
  cmsApiQueryConfigSetOperation,
} from '../../src/operations/cms-api';
import {
  localesAddOperation,
  localesGetOperation,
  localesSwitcherAddOperation,
  localesRoutesSyncOperation,
} from '../../src/operations/locales';
import {
  translationsSetOperation,
  translationsListOperation,
} from '../../src/operations/translations';
import {
  variablesCreateOperation,
  variablesBindOperation,
  variablesListOperation,
} from '../../src/operations/variables';

function createMockContext(): OperationContext {
  let counter = 0;
  return {
    createId: (prefix = 'node') => `${prefix}-l02-${++counter}`,
    signal: new AbortController().signal,
    trace: () => {},
    adapters: {},
  };
}

function applyChanges(snapshot: Snapshot, changes?: FileChange[]): Snapshot {
  if (!changes || changes.length === 0) return snapshot;
  const nextFiles = new Map(snapshot.files);
  for (const ch of changes) {
    if (ch.content === null) {
      nextFiles.delete(ch.path);
      projectFS.deleteFile(ch.path);
    } else {
      nextFiles.set(ch.path, ch.content);
      projectFS.writeFile(ch.path, ch.content);
    }
  }
  return {
    ...snapshot,
    revision: snapshot.revision + 1,
    files: nextFiles,
  };
}

describe('L02 Acceptance Suite: Dynamic CMS, Locales, RTL, and Search', () => {
  let snapshot: Snapshot;
  let context: OperationContext;

  const INITIAL_LAYOUT = `import React from 'react';
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`;

  beforeEach(() => {
    context = createMockContext();
    for (const f of projectFS.listFiles()) {
      projectFS.deleteFile(f);
    }

    const files = new Map<string, string>();
    files.set('app/layout.tsx', INITIAL_LAYOUT);
    projectFS.writeFile('app/layout.tsx', INITIAL_LAYOUT);

    snapshot = createSnapshot(
      { projectId: 'l02-dynamic-project', branchId: 'main' },
      1,
      files
    );
  });

  it('assembles a dynamic multi-language site with local CMS, detail pages, external API search, locales/RTL, and variables', async () => {
    // -------------------------------------------------------------------------
    // Phase 1: Base Page Setup
    // -------------------------------------------------------------------------
    const homeRes = await pagesCreateOperation.execute(
      snapshot,
      { slug: '', title: 'Dynamic Showcase' },
      context
    );
    snapshot = applyChanges(snapshot, homeRes.changes);
    const homeClientPath = 'app/page.client.tsx';

    const rootNodes = parseJSXToNodes(snapshot.files.get(homeClientPath)!);
    const rootNode = Array.from(rootNodes.values()).find((n) => !n.parentId);
    const rootId = rootNode?.id || 'root';

    // -------------------------------------------------------------------------
    // Phase 2: Local CMS Schema Definition (T16)
    // -------------------------------------------------------------------------
    const schemaRes = await cmsSchemaCreateOperation.execute(
      snapshot,
      {
        name: 'Case Studies',
        slug: 'case-studies',
        fields: [
          { id: 'title', name: 'Title', type: 'text', required: true },
          { id: 'client', name: 'Client', type: 'text' },
          { id: 'summary', name: 'Summary', type: 'textarea' },
          { id: 'featured', name: 'Featured', type: 'boolean', defaultValue: false },
        ],
      },
      context
    );
    snapshot = applyChanges(snapshot, schemaRes.changes);
    expect(schemaRes.slug).toBe('case-studies');

    // Add field to schema
    const addFieldRes = await cmsFieldAddOperation.execute(
      snapshot,
      {
        collection: 'case-studies',
        name: 'Launch Year',
        type: 'number',
      },
      context
    );
    snapshot = applyChanges(snapshot, addFieldRes.changes);

    // -------------------------------------------------------------------------
    // Phase 3: Local CMS Items Management (T16)
    // -------------------------------------------------------------------------
    const item1 = await cmsItemsCreateOperation.execute(
      snapshot,
      {
        collection: 'case-studies',
        item: {
          _slug: 'fintech-modernization',
          title: 'Global Fintech Platform',
          client: 'Acme Financial',
          summary: 'Scalable Next.js visual architecture for global banking.',
          featured: true,
          launchYear: 2026,
        },
      },
      context
    );
    snapshot = applyChanges(snapshot, item1.changes);

    const item2 = await cmsItemsCreateOperation.execute(
      snapshot,
      {
        collection: 'case-studies',
        item: {
          _slug: 'ai-workspace',
          title: 'Generative AI Creative Suite',
          client: 'Omni Media',
          summary: 'Multi-modal canvas with real-time collaborative editing.',
          featured: false,
          launchYear: 2025,
        },
      },
      context
    );
    snapshot = applyChanges(snapshot, item2.changes);

    // Update item 2
    const updateItem2 = await cmsItemsUpdateOperation.execute(
      snapshot,
      {
        collection: 'case-studies',
        itemId: item2.item._id,
        updates: { featured: true },
      },
      context
    );
    snapshot = applyChanges(snapshot, updateItem2.changes);

    const itemsList = await cmsItemsListOperation.execute(
      snapshot,
      { collection: 'case-studies' },
      context
    );
    expect(itemsList.items.length).toBe(2);

    // -------------------------------------------------------------------------
    // Phase 4: CMS Pages & Dynamic Routes (T16)
    // -------------------------------------------------------------------------
    // 1. Create detail route /case-studies/[slug]
    const detailPageRes = await cmsPagesCreateDetailOperation.execute(
      snapshot,
      { collection: 'case-studies' },
      context
    );
    snapshot = applyChanges(snapshot, detailPageRes.changes);

    const detailClientPath = detailPageRes.clientPath;
    expect(snapshot.files.has(detailClientPath)).toBe(true);

    // 2. Create index route /case-studies
    const indexPageRes = await cmsPagesCreateIndexOperation.execute(
      snapshot,
      { collection: 'case-studies' },
      context
    );
    snapshot = applyChanges(snapshot, indexPageRes.changes);
    expect(snapshot.files.has(indexPageRes.clientPath)).toBe(true);

    // 3. Find CMS pages
    const findDetail = await cmsPagesFindOperation.execute(
      snapshot,
      { collection: 'case-studies', kind: 'detail' },
      context
    );
    expect(findDetail.filePath).toBeDefined();

    const findIndex = await cmsPagesFindOperation.execute(
      snapshot,
      { collection: 'case-studies', kind: 'index' },
      context
    );
    expect(findIndex.filePath).toBeDefined();

    // -------------------------------------------------------------------------
    // Phase 5: External API Mode CMS & Search (T17)
    // -------------------------------------------------------------------------
    // Add a collection list container on the page
    const listContainer = await nodesCreateOperation.execute(
      snapshot,
      {
        filePath: homeClientPath,
        parentId: rootId,
        type: 'div',
        name: 'Case Studies List',
        id: 'case-studies-list',
        styles: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' },
      },
      context
    );
    snapshot = applyChanges(snapshot, listContainer.changes);

    const templateCard = await nodesCreateOperation.execute(
      snapshot,
      {
        filePath: homeClientPath,
        parentId: 'case-studies-list',
        type: 'div',
        name: 'Study Card Template',
        id: 'study-card-template',
        styles: { padding: '16px', border: '1px solid #e2e8f0' },
      },
      context
    );
    snapshot = applyChanges(snapshot, templateCard.changes);

    // Bind repeater to case-studies collection
    const bindListRes = await cmsListCreateOperation.execute(
      snapshot,
      {
        targetFile: homeClientPath,
        parentId: 'case-studies-list',
        collection: 'case-studies',
        itemTemplateId: 'study-card-template',
      },
      context
    );
    snapshot = applyChanges(snapshot, bindListRes.changes);

    // Set API mode enabled for project
    const apiModeRes = await cmsApiModeSetOperation.execute(
      snapshot,
      { mode: 'api' },
      context
    );
    snapshot = applyChanges(snapshot, apiModeRes.changes);

    // Configure external API collection
    const apiCollectionRes = await cmsApiCollectionSetOperation.execute(
      snapshot,
      {
        name: 'Press Releases',
        slug: 'press-releases',
        provider: 'custom_rest',
        url: 'https://api.revyme.com/v1/press',
        method: 'GET',
        itemsKey: 'data',
        headers: { Authorization: 'Bearer mock-token' },
      },
      context
    );
    snapshot = applyChanges(snapshot, apiCollectionRes.changes);
    expect(apiCollectionRes.collection.slug).toBe('press-releases');

    // Add search field for collection list query
    const searchFieldRes = await cmsApiSearchFieldAddOperation.execute(
      snapshot,
      {
        filePath: homeClientPath,
        nodeId: 'case-studies-list',
        field: 'title',
        placeholder: 'Search case studies...',
      },
      context
    );
    snapshot = applyChanges(snapshot, searchFieldRes.changes);

    // -------------------------------------------------------------------------
    // Phase 6: Locales, RTL, Translations & Fallback (T18)
    // -------------------------------------------------------------------------
    // Add Arabic (RTL) locale
    const addLocaleRes = await localesAddOperation.execute(
      snapshot,
      {
        code: 'ar',
        label: 'Arabic',
        direction: 'rtl',
      },
      context
    );
    snapshot = applyChanges(snapshot, addLocaleRes.changes);

    const localesRes = await localesGetOperation.execute(snapshot, {}, context);
    expect(localesRes.locales.some((l) => l.code === 'ar' && l.direction === 'rtl')).toBe(true);

    // Add Locale Switcher to navigation
    const switcherRes = await localesSwitcherAddOperation.execute(
      snapshot,
      {
        filePath: homeClientPath,
        parentId: rootId,
      },
      context
    );
    snapshot = applyChanges(snapshot, switcherRes.changes);

    // Set translations for Arabic
    const transRes = await translationsSetOperation.execute(
      snapshot,
      {
        locale: 'ar',
        items: [
          {
            filePath: homeClientPath,
            nodeId: rootId,
            text: 'مرحبا بكم في ريفايم',
          },
        ],
      },
      context
    );
    snapshot = applyChanges(snapshot, transRes.changes);

    // Verify translations query
    const listTrans = await translationsListOperation.execute(
      snapshot,
      { filePath: homeClientPath },
      context
    );
    expect(listTrans.locales).toContain('ar');

    // Sync locale routes
    const syncRoutes = await localesRoutesSyncOperation.execute(
      snapshot,
      {},
      context
    );
    snapshot = applyChanges(snapshot, syncRoutes.changes);

    // -------------------------------------------------------------------------
    // Phase 7: Page Variables & Dynamic FX Bindings (T15)
    // -------------------------------------------------------------------------
    // Create page variable
    const varRes = await variablesCreateOperation.execute(
      snapshot,
      {
        targetFile: homeClientPath,
        name: 'selectedCategory',
        type: 'text',
        defaultValue: 'All',
      },
      context
    );
    snapshot = applyChanges(snapshot, varRes.changes);

    const varsList = await variablesListOperation.execute(
      snapshot,
      { targetFile: homeClientPath },
      context
    );
    expect(varsList.variables.some((v) => v.name === 'selectedCategory')).toBe(true);

    // -------------------------------------------------------------------------
    // Phase 8: Verification & Source Roundtrip
    // -------------------------------------------------------------------------
    const finalHomeCode = snapshot.files.get(homeClientPath)!;
    expect(finalHomeCode).toContain('selectedCategory');
    expect(finalHomeCode).toContain(searchFieldRes.variable);

    // Verify CMS case-studies collection JSON exists and is valid
    const cmsCaseStudiesJson = snapshot.files.get('cms/case-studies.json');
    expect(cmsCaseStudiesJson).toBeDefined();
    const parsedStudies = JSON.parse(cmsCaseStudiesJson!);
    expect(parsedStudies.length).toBe(2);
    expect(parsedStudies[0].title).toBe('Global Fintech Platform');

    // Verify that AST parsing survives roundtrip without parse errors
    const parsedNodes = parseJSXToNodes(finalHomeCode);
    expect(parsedNodes.size).toBeGreaterThan(0);
  });
});
