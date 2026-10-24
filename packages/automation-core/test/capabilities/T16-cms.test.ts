// packages/automation-core/test/capabilities/T16-cms.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import type { Snapshot, FileChange } from '../../src/contracts';
import { createSnapshot, createOperationContext } from '../../src/session';
import {
  cmsSchemaListOperation,
  cmsSchemaGetOperation,
  cmsSchemaCreateOperation,
  cmsSchemaUpdateOperation,
  cmsSchemaDuplicateOperation,
  cmsSchemaDeleteOperation,
  cmsFieldAddOperation,
  cmsFieldUpdateOperation,
  cmsFieldRemoveOperation,
  cmsFieldReorderOperation,
} from '../../src/operations/cms-schema';
import {
  cmsItemsListOperation,
  cmsItemsGetOperation,
  cmsItemsCreateOperation,
  cmsItemsUpdateOperation,
  cmsItemsRemoveOperation,
  cmsItemsReorderOperation,
  cmsItemsSetTranslationOperation,
  cmsItemsGetTranslationOperation,
} from '../../src/operations/cms-items';
import {
  cmsListCreateOperation,
  cmsListConfigureOperation,
  cmsListPaginateOperation,
  cmsListUnpaginateOperation,
  cmsFieldBindOperation,
  cmsFieldUnbindOperation,
} from '../../src/operations/cms-bindings';
import {
  cmsPagesCreateIndexOperation,
  cmsPagesCreateDetailOperation,
  cmsPagesFindOperation,
  cmsPagesSeoOperation,
} from '../../src/operations/cms-pages';
import { projectFS } from '@/code/project/project-fs';
import { parseCmsSeoBindings, hasGenerateStaticParams } from '@/code/project/cms-seo';
import { createCmsIndexPageFile, createCmsDetailPageFile } from '@/code/project/cms-page-ops';

function createMockSnapshot(files: Record<string, string>): Snapshot {
  return createSnapshot({ projectId: 'test-project', branchId: 'main' }, 0, files);
}

const mockContext = createOperationContext();

function applyChanges(files: Map<string, string>, changes: FileChange[]): void {
  for (const c of changes) {
    if (c.content === null) {
      files.delete(c.path);
    } else {
      files.set(c.path, c.content);
    }
  }
}

describe('T16: Local CMS, schema/items/lists/detail pages', () => {
  beforeEach(() => {
    for (const f of projectFS.listFiles()) {
      projectFS.deleteFile(f);
    }
  });

  describe('1. Schema & Field Lifecycle', () => {
    it('creates case-studies collection with various field types, adds, updates, reorders, and duplicates', async () => {
      let snap = createMockSnapshot({});
      const mutableFiles = new Map(snap.files);

      // 1. Create collection with fields
      const createRes = await cmsSchemaCreateOperation.execute(
        snap,
        {
          name: 'Case Studies',
          slug: 'case-studies',
          fields: [
            { id: 'title', name: 'Title', type: 'text', required: true },
            { id: 'summary', name: 'Summary', type: 'textarea' },
            { id: 'heroImage', name: 'Hero Image', type: 'image' },
            { id: 'publishedDate', name: 'Published Date', type: 'date' },
            { id: 'featured', name: 'Featured', type: 'boolean', defaultValue: false },
            { id: 'rating', name: 'Rating', type: 'number', defaultValue: 5 },
            { id: 'tags', name: 'Tags', type: 'tags' },
            { id: 'category', name: 'Category', type: 'enum', options: ['Design', 'Engineering', 'Marketing'] },
          ],
        },
        mockContext,
      );
      applyChanges(mutableFiles, createRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));
      expect(createRes.slug).toBe('case-studies');
      expect(createRes.schema.fields).toHaveLength(8);

      // 2. Add field
      const addFieldRes = await cmsFieldAddOperation.execute(
        snap,
        {
          collection: 'case-studies',
          name: 'Client URL',
          type: 'url',
        },
        mockContext,
      );
      applyChanges(mutableFiles, addFieldRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));
      expect(addFieldRes.fieldId).toBe('clientUrl');

      // 3. Update field
      const updateFieldRes = await cmsFieldUpdateOperation.execute(
        snap,
        {
          collection: 'case-studies',
          fieldId: 'rating',
          patch: { defaultValue: 4 },
        },
        mockContext,
      );
      applyChanges(mutableFiles, updateFieldRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      // 4. Reorder fields
      const reorderRes = await cmsFieldReorderOperation.execute(
        snap,
        {
          collection: 'case-studies',
          orderedFieldIds: ['title', 'heroImage', 'summary', 'publishedDate', 'featured', 'rating', 'tags', 'category', 'clientUrl'],
        },
        mockContext,
      );
      applyChanges(mutableFiles, reorderRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      // 5. Get schema & verify order and update
      const getRes = await cmsSchemaGetOperation.execute(snap, { slug: 'case-studies' }, mockContext);
      expect(getRes.schema.fields[1].id).toBe('heroImage');
      expect(getRes.schema.fields.find((f) => f.id === 'rating')?.defaultValue).toBe(4);

      // 6. Duplicate collection
      const dupRes = await cmsSchemaDuplicateOperation.execute(
        snap,
        { slug: 'case-studies' },
        mockContext,
      );
      applyChanges(mutableFiles, dupRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));
      expect(dupRes.newSlug).toBe('case-studies-copy');

      // 7. List collections
      const listRes = await cmsSchemaListOperation.execute(snap, {}, mockContext);
      expect(listRes.collections).toContain('case-studies');
      expect(listRes.collections).toContain('case-studies-copy');
    });

    it('returns all dependent CMS route deletions in the cascade plan', async () => {
      const slug = 'cascade-route-probe';
      projectFS.writeFile(`cms/${slug}.schema.json`, JSON.stringify({
        slug,
        name: 'Cascade Route Probe',
        fields: [{ id: 'title', name: 'Title', type: 'text' }],
      }));
      projectFS.writeFile(`cms/${slug}.json`, '[]');
      const indexClient = createCmsIndexPageFile(slug);
      const detailClient = createCmsDetailPageFile(slug);
      // Simulate an index page created before generated CMS pages carried
      // metadata; cascade discovery must still recognize its old code shape.
      const indexCode = projectFS.readFile(indexClient)!;
      projectFS.writeFile(indexClient, indexCode.replace(/\/\*\* @cmsPage \{[\s\S]*?\*\//, ''));
      const initialFiles = Object.fromEntries(projectFS.listFiles().map(path => [path, projectFS.readFile(path)!]));
      const snapshot = createMockSnapshot(initialFiles);

      const result = await cmsSchemaDeleteOperation.execute(snapshot, { slug, cascade: true }, mockContext);
      const changesByPath = new Map(result.changes.map(change => [change.path, change.content]));

      expect(changesByPath.get(`cms/${slug}.schema.json`)).toBeNull();
      expect(changesByPath.get(`cms/${slug}.json`)).toBeNull();
      expect(changesByPath.get(indexClient)).toBeNull();
      expect(changesByPath.get(indexClient.replace(/\.client\.tsx$/, '.tsx'))).toBeNull();
      expect(changesByPath.get(detailClient)).toBeNull();
      expect(changesByPath.get(detailClient.replace(/\.client\.tsx$/, '.tsx'))).toBeNull();
    });
  });

  describe('2. CMS Items CRUD, Normalization, & Translations', () => {
    it('creates 5 items, normalizes image URLs, updates slugs, sets translations, and reorders', async () => {
      let snap = createMockSnapshot({});
      const mutableFiles = new Map(snap.files);

      // Create collection
      const collRes = await cmsSchemaCreateOperation.execute(
        snap,
        {
          name: 'Case Studies',
          slug: 'case-studies',
          fields: [
            { id: 'title', name: 'Title', type: 'text', required: true },
            { id: 'heroImage', name: 'Hero Image', type: 'image' },
            { id: 'featured', name: 'Featured', type: 'boolean', defaultValue: false },
          ],
        },
        mockContext,
      );
      applyChanges(mutableFiles, collRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      // 1. Create 5 items
      const createdItems = [];
      for (let i = 1; i <= 5; i++) {
        const itemRes = await cmsItemsCreateOperation.execute(
          snap,
          {
            collection: 'case-studies',
            item: {
              title: `Case Study ${i}`,
              heroImage: `url('https://example.com/img${i}.png')`, // Should be stripped of url() wrapper
              featured: i % 2 === 1,
            },
          },
          mockContext,
        );
        applyChanges(mutableFiles, itemRes.changes);
        snap = createMockSnapshot(Object.fromEntries(mutableFiles));
        createdItems.push(itemRes.item);
      }

      expect(createdItems).toHaveLength(5);
      // Verify image normalization: stripped of url('...')
      expect(createdItems[0].heroImage).toBe('https://example.com/img1.png');
      expect(createdItems[0]._slug).toBe('case-study-1');

      // 2. Update item 1: change title -> verify auto-derived _slug updates to match
      const updateRes = await cmsItemsUpdateOperation.execute(
        snap,
        {
          collection: 'case-studies',
          itemId: createdItems[0]._id,
          updates: {
            title: 'Revamped Alpha Project',
          },
        },
        mockContext,
      );
      applyChanges(mutableFiles, updateRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      const getUpdated = await cmsItemsGetOperation.execute(
        snap,
        { collection: 'case-studies', itemId: createdItems[0]._id },
        mockContext,
      );
      expect(getUpdated.item?.title).toBe('Revamped Alpha Project');
      expect(getUpdated.item?._slug).toBe('revamped-alpha-project');

      // 3. Translation support on item 1
      const transRes = await cmsItemsSetTranslationOperation.execute(
        snap,
        {
          collection: 'case-studies',
          itemId: createdItems[0]._id,
          locale: 'de',
          field: 'title',
          value: 'Überarbeitetes Alpha-Projekt',
        },
        mockContext,
      );
      applyChanges(mutableFiles, transRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      const transGet = await cmsItemsGetTranslationOperation.execute(
        snap,
        {
          collection: 'case-studies',
          itemId: createdItems[0]._id,
          locale: 'de',
          field: 'title',
        },
        mockContext,
      );
      expect(transGet.value).toBe('Überarbeitetes Alpha-Projekt');

      // 4. Reorder items: reverse order
      const reverseIds = createdItems.map((i) => i._id).reverse();
      const reorderRes = await cmsItemsReorderOperation.execute(
        snap,
        {
          collection: 'case-studies',
          orderedIds: reverseIds,
        },
        mockContext,
      );
      applyChanges(mutableFiles, reorderRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      const listRes = await cmsItemsListOperation.execute(
        snap,
        { collection: 'case-studies' },
        mockContext,
      );
      expect(listRes.items[0]._id).toBe(createdItems[4]._id);

      // 5. Delete an item
      const deleteRes = await cmsItemsRemoveOperation.execute(
        snap,
        {
          collection: 'case-studies',
          itemId: createdItems[4]._id,
        },
        mockContext,
      );
      applyChanges(mutableFiles, deleteRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      const listAfterDelete = await cmsItemsListOperation.execute(
        snap,
        { collection: 'case-studies' },
        mockContext,
      );
      expect(listAfterDelete.items).toHaveLength(4);
    });
  });

  describe('3. Collection List Repeater, Field Bindings, and Pagination', () => {
    it('creates repeater list in TSX, binds fields, configures filters/sorting, and attaches pagination', async () => {
      const pageCode = `'use client';
import React from 'react';

export default function Page() {
  return (
    <div data-id="root" style={{ padding: '40px' }}>
      <div data-id="list-wrapper" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
        <div data-id="card-item" style={{ padding: '20px', border: '1px solid #ccc' }}>
          <img data-id="card-img" src="/placeholder.png" alt="" style={{ width: '100%', height: '200px' }} />
          <h3 data-id="card-title">Default Title</h3>
          <a data-id="card-link" href="#">Read More</a>
        </div>
      </div>
    </div>
  );
}
`;
      let snap = createMockSnapshot({ 'app/page.tsx': pageCode });
      const mutableFiles = new Map(snap.files);

      // 1. Create collection list repeater
      const listCreateRes = await cmsListCreateOperation.execute(
        snap,
        {
          targetFile: 'app/page.tsx',
          parentId: 'list-wrapper',
          collection: 'case-studies',
          itemTemplateId: 'card-item',
        },
        mockContext,
      );
      applyChanges(mutableFiles, listCreateRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      let code = snap.files.get('app/page.tsx')!;
      expect(code).toContain('import caseStudies from');
      expect(code).toContain('.map((item, idx) =>');

      // 2. Bind card-title to item.title
      const bindTitleRes = await cmsFieldBindOperation.execute(
        snap,
        {
          targetFile: 'app/page.tsx',
          nodeId: 'card-title',
          property: 'textContent',
          fieldId: 'title',
        },
        mockContext,
      );
      applyChanges(mutableFiles, bindTitleRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      // 3. Bind card-img to item.heroImage
      const bindImgRes = await cmsFieldBindOperation.execute(
        snap,
        {
          targetFile: 'app/page.tsx',
          nodeId: 'card-img',
          property: 'src',
          fieldId: 'heroImage',
        },
        mockContext,
      );
      applyChanges(mutableFiles, bindImgRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      // 4. Bind card-link to item._slug
      const bindLinkRes = await cmsFieldBindOperation.execute(
        snap,
        {
          targetFile: 'app/page.tsx',
          nodeId: 'card-link',
          property: 'href',
          fieldId: '_slug',
        },
        mockContext,
      );
      applyChanges(mutableFiles, bindLinkRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      code = snap.files.get('app/page.tsx')!;
      expect(code).toContain('{item.title}');
      expect(code).toContain('src={item.heroImage}');
      expect(code).toContain('href={item._slug}');

      // 5. Configure filter, sort, limit
      const configRes = await cmsListConfigureOperation.execute(
        snap,
        {
          targetFile: 'app/page.tsx',
          parentId: 'list-wrapper',
          filterGroup: {
            combinator: 'and',
            filters: [{ field: 'featured', operator: 'equals', value: true }],
          },
          sort: { field: 'publishedDate', direction: 'desc' },
          limit: 3,
        },
        mockContext,
      );
      applyChanges(mutableFiles, configRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      code = snap.files.get('app/page.tsx')!;
      expect(code).toContain('.filter(');
      expect(code).toContain('.sort(');
      expect(code).toContain('.slice(0, 3)');

      // 6. Attach pagination
      const paginateRes = await cmsListPaginateOperation.execute(
        snap,
        {
          targetFile: 'app/page.tsx',
          parentId: 'list-wrapper',
          mode: 'loadMore',
          perPage: 3,
        },
        mockContext,
      );
      const paginatedPage = paginateRes.changes.find((change) => change.path === 'app/page.tsx')?.content ?? '';
      expect(paginatedPage).toMatch(/import React, \{[^}]*\buseState\b[^}]*\} from 'react'/);
      expect(paginateRes.changes).toContainEqual(expect.objectContaining({
        path: 'components/LoadMore.tsx',
        content: expect.stringContaining('function LoadMore('),
      }));
      applyChanges(mutableFiles, paginateRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      code = snap.files.get('app/page.tsx')!;
      expect(code).toContain('visListwrapper');
      expect(code).toContain('LoadMore');

      // 7. Unpaginate
      const unpaginateRes = await cmsListUnpaginateOperation.execute(
        snap,
        {
          targetFile: 'app/page.tsx',
          parentId: 'list-wrapper',
        },
        mockContext,
      );
      applyChanges(mutableFiles, unpaginateRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));
      code = snap.files.get('app/page.tsx')!;
      expect(code).not.toContain('loadmore-list-wrapper');

      // 8. Unbind card-title
      const unbindRes = await cmsFieldUnbindOperation.execute(
        snap,
        {
          targetFile: 'app/page.tsx',
          nodeId: 'card-title',
          property: 'textContent',
          fallbackValue: 'Static Card Title',
        },
        mockContext,
      );
      applyChanges(mutableFiles, unbindRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));
      code = snap.files.get('app/page.tsx')!;
      expect(code).toContain('Static Card Title');
    });
  });

  describe('4. CMS Pages: Index, Detail, and SEO', () => {
    it('creates index and detail pages with static params and dynamic SEO metadata', async () => {
      let snap = createMockSnapshot({});
      const mutableFiles = new Map(snap.files);

      // Create collection
      const collRes = await cmsSchemaCreateOperation.execute(
        snap,
        {
          name: 'Case Studies',
          slug: 'case-studies',
          fields: [
            { id: 'title', name: 'Title', type: 'text', required: true },
            { id: 'summary', name: 'Summary', type: 'textarea' },
            { id: 'heroImage', name: 'Hero Image', type: 'image' },
          ],
        },
        mockContext,
      );
      applyChanges(mutableFiles, collRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      // 1. Create Index page
      const indexRes = await cmsPagesCreateIndexOperation.execute(
        snap,
        { collection: 'case-studies' },
        mockContext,
      );
      applyChanges(mutableFiles, indexRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));
      expect(indexRes.clientPath).toContain('app/case-studies/page.client.tsx');

      // 2. Create Detail page
      const detailRes = await cmsPagesCreateDetailOperation.execute(
        snap,
        { collection: 'case-studies' },
        mockContext,
      );
      applyChanges(mutableFiles, detailRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));
      expect(detailRes.clientPath).toContain('app/case-studies/[slug]/page.client.tsx');
      expect(detailRes.serverPath).toContain('app/case-studies/[slug]/page.tsx');

      const serverCode = snap.files.get(detailRes.serverPath)!;
      expect(hasGenerateStaticParams(serverCode)).toBe(true);
      expect(serverCode).toContain('generateMetadata');

      // 3. Find pages
      const foundIndex = await cmsPagesFindOperation.execute(
        snap,
        { collection: 'case-studies', kind: 'index' },
        mockContext,
      );
      expect(foundIndex.filePath).not.toBeNull();

      const foundDetail = await cmsPagesFindOperation.execute(
        snap,
        { collection: 'case-studies', kind: 'detail' },
        mockContext,
      );
      expect(foundDetail.filePath).not.toBeNull();

      // 4. Update SEO on detail page
      const seoRes = await cmsPagesSeoOperation.execute(
        snap,
        {
          targetFile: detailRes.serverPath,
          bindings: {
            title: 'title',
            description: 'summary',
            ogImage: 'heroImage',
          },
          defaults: {
            title: 'Default Case Study',
          },
        },
        mockContext,
      );
      applyChanges(mutableFiles, seoRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      const updatedServer = snap.files.get(detailRes.serverPath)!;
      const parsedBindings = parseCmsSeoBindings(updatedServer);
      expect(parsedBindings.title).toBe('title');
      expect(parsedBindings.description).toBe('summary');
      expect(parsedBindings.ogImage).toBe('heroImage');
    });
  });

  describe('5. Cascade Delete of Collection and Dependents', () => {
    it('deletes collection and cascades deletion to pages and schema files', async () => {
      let snap = createMockSnapshot({});
      const mutableFiles = new Map(snap.files);

      // Create collection
      const collRes = await cmsSchemaCreateOperation.execute(
        snap,
        {
          name: 'Temporary Blog',
          slug: 'temp-blog',
          fields: [{ id: 'title', name: 'Title', type: 'text', required: true }],
        },
        mockContext,
      );
      applyChanges(mutableFiles, collRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      // Create detail page
      const detailRes = await cmsPagesCreateDetailOperation.execute(
        snap,
        { collection: 'temp-blog' },
        mockContext,
      );
      applyChanges(mutableFiles, detailRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      // Delete with cascade: true
      const deleteRes = await cmsSchemaDeleteOperation.execute(
        snap,
        { slug: 'temp-blog', cascade: true },
        mockContext,
      );
      applyChanges(mutableFiles, deleteRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      // Verify schema and data files are deleted
      expect(snap.files.has('cms/temp-blog.schema.json')).toBe(false);
      expect(snap.files.has('cms/temp-blog.json')).toBe(false);

      // Verify listCollections no longer contains temp-blog
      const listRes = await cmsSchemaListOperation.execute(snap, {}, mockContext);
      expect(listRes.collections).not.toContain('temp-blog');
    });
  });
});
