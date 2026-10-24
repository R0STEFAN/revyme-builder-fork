// packages/automation-core/test/capabilities/T17-cms-api.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Snapshot, FileChange } from '../../src/contracts';
import { createSnapshot, createOperationContext } from '../../src/session';
import { runCase } from '../fixture';
import {
  cmsApiModeGetOperation,
  cmsApiModeSetOperation,
  cmsApiCollectionListOperation,
  cmsApiCollectionGetOperation,
  cmsApiCollectionSetOperation,
  cmsApiCollectionDeleteOperation,
  cmsApiDetectItemsKeyOperation,
  cmsApiFetchOperation,
  cmsApiQueryConfigSetOperation,
  cmsApiSearchFieldAddOperation,
  cmsApiSearchFieldSetVariableOperation,
  redactUrl,
  redactHeaders,
} from '../../src/operations/cms-api';
import { projectFS } from '@/code/project/project-fs';
import { CMS_API_CONFIG_PATH } from '@/code/project/cms-api-config';
import { parseJSXToNodes } from '@/code/parsing/parser';

const BASE_BLOG_PAGE = `'use client';
import React, { useState } from 'react';
import articles from '@/cms/articles.json';

/** @canvas { "responsive": { "_bp": [768, 375] } } */

export default function BlogPage() {
  return (
    <div data-id="root" style={{ width: '100%', minHeight: '100vh', padding: '24px' }}>
      <h1 data-id="page-title">Blog Articles</h1>
      <div
        data-id="article-list"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}
      >
        {articles.map((post) => (
          <div data-id="article-card" key={post.id} style={{ padding: '16px', border: '1px solid #ccc' }}>
            <h2 data-id="card-title">{post.title}</h2>
          </div>
        ))}
      </div>
    </div>
  );
}
`;

const ARTICLES_SCHEMA = JSON.stringify(
  {
    name: 'Articles',
    slug: 'articles',
    fields: [
      { id: 'title', name: 'Title', type: 'text', required: true },
      { id: 'category', name: 'Category', type: 'text' },
      { id: 'views', name: 'Views', type: 'number' },
      { id: 'isPublished', name: 'Is Published', type: 'boolean' },
    ],
  },
  null,
  2,
);

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

describe('T17: External API CMS & Dynamic Search', () => {
  beforeEach(() => {
    for (const f of projectFS.listFiles()) {
      projectFS.deleteFile(f);
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Mode Switching & Config Persistence', () => {
    it('defaults to local mode, sets api mode, and preserves collections when switching back', async () => {
      let snap = createMockSnapshot({});
      const mutableFiles = new Map<string, string>();

      // 1. Check default mode when no config exists
      const initialMode = await cmsApiModeGetOperation.execute(snap, {}, mockContext);
      expect(initialMode.mode).toBe('local');

      // 2. Switch mode to 'api'
      const setApiModeRes = await cmsApiModeSetOperation.execute(snap, { mode: 'api' }, mockContext);
      expect(setApiModeRes.mode).toBe('api');
      applyChanges(mutableFiles, setApiModeRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      const updatedMode = await cmsApiModeGetOperation.execute(snap, {}, mockContext);
      expect(updatedMode.mode).toBe('api');

      // 3. Add a collection in api mode
      const setColRes = await cmsApiCollectionSetOperation.execute(
        snap,
        {
          slug: 'posts',
          name: 'Blog Posts',
          provider: 'directus',
          url: 'https://api.acme.com/items/posts',
          method: 'GET',
          headers: { Authorization: 'Bearer env:DIRECTUS_TOKEN' },
        },
        mockContext,
      );
      applyChanges(mutableFiles, setColRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      // 4. Switch mode back to 'local' and ensure collections are preserved in config
      const setLocalModeRes = await cmsApiModeSetOperation.execute(snap, { mode: 'local' }, mockContext);
      expect(setLocalModeRes.mode).toBe('local');
      applyChanges(mutableFiles, setLocalModeRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      const listRes = await cmsApiCollectionListOperation.execute(snap, {}, mockContext);
      expect(listRes.collections.posts).toBeDefined();
      expect(listRes.collections.posts.name).toBe('Blog Posts');
    });
  });

  describe('2. Collection CRUD Operations', () => {
    it('supports create, list, get, update, and delete of multiple external API collections', async () => {
      let snap = createMockSnapshot({});
      const mutableFiles = new Map<string, string>();

      // 1. Create Directus collection with headers and cache options
      const directusRes = await cmsApiCollectionSetOperation.execute(
        snap,
        {
          slug: 'articles',
          name: 'Articles',
          provider: 'directus',
          url: 'https://directus.acme.com/items/articles',
          method: 'GET',
          headers: { Authorization: 'Bearer env:DIRECTUS_TOKEN' },
          defaultParams: { fields: '*.*' },
          cacheMaxAge: 7200,
          revalidateTtl: 60,
          itemsKey: 'data',
        },
        mockContext,
      );
      applyChanges(mutableFiles, directusRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));
      expect(directusRes.slug).toBe('articles');
      expect(directusRes.collection.itemsKey).toBe('data');

      // 2. Create Baserow collection with auto-detected itemsKey from sample response
      const baserowRes = await cmsApiCollectionSetOperation.execute(
        snap,
        {
          slug: 'leads',
          name: 'Sales Leads',
          provider: 'baserow',
          url: 'https://baserow.acme.com/api/database/rows/table/42/',
          method: 'GET',
          headers: { Authorization: 'Token env:BASEROW_TOKEN' },
          sampleResponse: {
            count: 1,
            results: [{ id: 101, name: 'Alice Enterprise' }],
          },
        },
        mockContext,
      );
      applyChanges(mutableFiles, baserowRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));
      expect(baserowRes.collection.itemsKey).toBe('results');

      // 3. Create Custom REST collection with image optimization config
      const customRes = await cmsApiCollectionSetOperation.execute(
        snap,
        {
          slug: 'gallery',
          name: 'Portfolio Gallery',
          provider: 'custom_rest',
          url: 'https://cdn.acme.com/api/v2/photos',
          method: 'GET',
          imageOptimization: {
            enabled: true,
            engine: 'cloudflare',
            quality: 85,
            format: 'webp',
            widths: [320, 640, 1024],
          },
        },
        mockContext,
      );
      applyChanges(mutableFiles, customRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      // 4. List all collections
      const listRes = await cmsApiCollectionListOperation.execute(snap, {}, mockContext);
      expect(Object.keys(listRes.collections)).toHaveLength(3);
      expect(listRes.collections.articles.provider).toBe('directus');
      expect(listRes.collections.leads.provider).toBe('baserow');
      expect(listRes.collections.gallery.provider).toBe('custom_rest');

      // 5. Get individual collection
      const getRes = await cmsApiCollectionGetOperation.execute(snap, { slug: 'articles' }, mockContext);
      expect(getRes.collection.name).toBe('Articles');
      expect(getRes.collection.cacheMaxAge).toBe(7200);

      // 6. Update collection properties
      const updateRes = await cmsApiCollectionSetOperation.execute(
        snap,
        {
          ...getRes.collection,
          cacheMaxAge: 14400,
          headers: {
            ...getRes.collection.headers,
            'X-Custom-Tracking': 'v2',
          },
        },
        mockContext,
      );
      applyChanges(mutableFiles, updateRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      const getUpdatedRes = await cmsApiCollectionGetOperation.execute(snap, { slug: 'articles' }, mockContext);
      expect(getUpdatedRes.collection.cacheMaxAge).toBe(14400);
      expect(getUpdatedRes.collection.headers['X-Custom-Tracking']).toBe('v2');

      // 7. Delete collection
      const delRes = await cmsApiCollectionDeleteOperation.execute(snap, { slug: 'leads' }, mockContext);
      expect(delRes.slug).toBe('leads');
      applyChanges(mutableFiles, delRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      const listAfterDelete = await cmsApiCollectionListOperation.execute(snap, {}, mockContext);
      expect(listAfterDelete.collections.leads).toBeUndefined();
      expect(Object.keys(listAfterDelete.collections)).toHaveLength(2);
    });
  });

  describe('3. Dynamic Items Key Detection', () => {
    it('detects explicit keys, top-level arrays, standard data/results keys, and nested dotted paths', async () => {
      const snap = createMockSnapshot({});

      // 1. Explicit key
      const explicitRes = await cmsApiDetectItemsKeyOperation.execute(
        snap,
        {
          responseData: { payload: [{ id: 1 }, { id: 2 }] },
          explicitKey: 'payload',
        },
        mockContext,
      );
      expect(explicitRes.itemsKey).toBe('payload');
      expect(explicitRes.itemCount).toBe(2);
      expect(explicitRes.sampleItem).toEqual({ id: 1 });

      // 2. Top-level array
      const rootArrayRes = await cmsApiDetectItemsKeyOperation.execute(
        snap,
        {
          responseData: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
        },
        mockContext,
      );
      expect(rootArrayRes.itemsKey).toBeUndefined();
      expect(rootArrayRes.itemCount).toBe(3);
      expect(rootArrayRes.sampleItem).toEqual({ id: 'a' });

      // 3. Standard 'data' key (Directus / Strapi style)
      const dataRes = await cmsApiDetectItemsKeyOperation.execute(
        snap,
        {
          responseData: { data: [{ title: 'Directus Item 1' }], meta: { total: 1 } },
        },
        mockContext,
      );
      expect(dataRes.itemsKey).toBe('data');
      expect(dataRes.itemCount).toBe(1);

      // 4. Standard 'results' key (Baserow style)
      const resultsRes = await cmsApiDetectItemsKeyOperation.execute(
        snap,
        {
          responseData: { count: 2, results: [{ id: 10 }, { id: 20 }] },
        },
        mockContext,
      );
      expect(resultsRes.itemsKey).toBe('results');
      expect(resultsRes.itemCount).toBe(2);

      // 5. Deeply nested dotted path (response.data.v2.articles.records)
      const nestedRes = await cmsApiDetectItemsKeyOperation.execute(
        snap,
        {
          responseData: {
            response: {
              data: {
                v2: {
                  articles: {
                    records: [{ id: 'article-99', title: 'Deeply Nested Story' }],
                  },
                },
              },
            },
          },
        },
        mockContext,
      );
      expect(nestedRes.itemsKey).toBe('response.data.v2.articles.records');
      expect(nestedRes.itemCount).toBe(1);
      expect(nestedRes.sampleItem).toEqual({ id: 'article-99', title: 'Deeply Nested Story' });

      // 6. Empty / non-array object returns 0 count
      const emptyRes = await cmsApiDetectItemsKeyOperation.execute(
        snap,
        {
          responseData: { status: 'empty' },
        },
        mockContext,
      );
      expect(emptyRes.itemCount).toBe(0);
      expect(emptyRes.sampleItem).toBeUndefined();
    });
  });

  describe('4. External Fetch Execution & Credential Redaction', () => {
    it('executes external fetch with env variable resolution and strictly redacts credentials', async () => {
      let snap = createMockSnapshot({});
      const mutableFiles = new Map<string, string>();

      // Configure test collection
      const setCol = await cmsApiCollectionSetOperation.execute(
        snap,
        {
          slug: 'protected-posts',
          name: 'Protected Posts',
          provider: 'directus',
          url: 'https://api.acme.com/items/posts',
          headers: {
            Authorization: 'Bearer env:ACME_API_TOKEN',
            'X-Client-Id': 'client-app-1',
          },
          itemsKey: 'data',
        },
        mockContext,
      );
      applyChanges(mutableFiles, setCol.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      let capturedUrl = '';
      let capturedHeaders: Record<string, string> = {};

      // Mock global fetch
      const mockFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        capturedUrl = url;
        capturedHeaders = (init?.headers as Record<string, string>) || {};

        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              { id: 'p1', title: 'Secured Post 1' },
              { id: 'p2', title: 'Secured Post 2' },
            ],
            meta: { total_count: 2 },
          }),
        };
      });
      vi.stubGlobal('fetch', mockFetch);

      // Execute fetch with envVars and queryParams (including sensitive query token)
      const fetchResult = await cmsApiFetchOperation.execute(
        snap,
        {
          slug: 'protected-posts',
          envVars: {
            ACME_API_TOKEN: 'super-confidential-secret-999',
          },
          queryParams: {
            apiKey: 'secret_query_key_777',
            limit: '10',
          },
        },
        mockContext,
      );

      // 1. Verify outgoing request carried the real resolved token
      expect(capturedHeaders['Authorization']).toBe('Bearer super-confidential-secret-999');
      expect(capturedUrl).toContain('apiKey=secret_query_key_777');

      // 2. Verify returned response has strictly REDACTED credentials
      expect(fetchResult.ok).toBe(true);
      expect(fetchResult.status).toBe(200);
      expect(fetchResult.items).toHaveLength(2);
      expect(fetchResult.totalCount).toBe(2);

      // Credential redactions:
      expect(fetchResult.redactedHeaders['Authorization']).toBe('Bearer [REDACTED]');
      expect(fetchResult.redactedHeaders['Authorization']).not.toContain('super-confidential-secret-999');
      expect(fetchResult.url).toContain('apiKey=[REDACTED]');
      expect(fetchResult.url).not.toContain('secret_query_key_777');
    });

    it('redacts basic auth password in URL, compound query parameters, and password headers', () => {
      // 1. Basic auth password embedded in URL
      const basicAuthUrl = 'https://admin:supersecretpassword@api.acme.com/items';
      const redactedBasic = redactUrl(basicAuthUrl);
      expect(redactedBasic).toBe('https://admin:[REDACTED]@api.acme.com/items');
      expect(redactedBasic).not.toContain('supersecretpassword');

      // 2. Compound / hyphenated / underscored query parameters
      const compoundQueryUrl =
        'https://api.acme.com/items?api-key=secret123&client_secret=secret456&auth_token=secret789&access-token=secret000&public=yes';
      const redactedQuery = redactUrl(compoundQueryUrl);
      expect(redactedQuery).toContain('api-key=[REDACTED]');
      expect(redactedQuery).toContain('client_secret=[REDACTED]');
      expect(redactedQuery).toContain('auth_token=[REDACTED]');
      expect(redactedQuery).toContain('access-token=[REDACTED]');
      expect(redactedQuery).toContain('public=yes');
      expect(redactedQuery).not.toContain('secret123');
      expect(redactedQuery).not.toContain('secret456');
      expect(redactedQuery).not.toContain('secret789');
      expect(redactedQuery).not.toContain('secret000');

      // 3. Password and sensitive headers
      const headers = {
        'x-user-password': 'cleartext_user_password_xyz',
        'X-App-Password': 'app_secret_password_abc',
        'X-Custom-Secret': 'custom_secret_123',
        'Authorization': 'Bearer secret-bearer-token',
        'Content-Type': 'application/json',
      };
      const redacted = redactHeaders(headers);
      expect(redacted['x-user-password']).toBe('[REDACTED]');
      expect(redacted['X-App-Password']).toBe('[REDACTED]');
      expect(redacted['X-Custom-Secret']).toBe('[REDACTED]');
      expect(redacted['Authorization']).toBe('Bearer [REDACTED]');
      expect(redacted['Content-Type']).toBe('application/json');
      expect(redacted['x-user-password']).not.toContain('cleartext_user_password_xyz');
    });

    it('executes fetch with basic auth in URL, compound query params, and x-user-password header with full redaction', async () => {
      let snap = createMockSnapshot({});
      const mutableFiles = new Map<string, string>();

      const setCol = await cmsApiCollectionSetOperation.execute(
        snap,
        {
          slug: 'basic-auth-col',
          name: 'Basic Auth Collection',
          provider: 'custom_rest',
          url: 'https://service-user:pass-phrase-987@api.acme.com/v1/data',
          headers: {
            'x-user-password': 'env:USER_PASSWORD_VAL',
          },
        },
        mockContext,
      );
      applyChanges(mutableFiles, setCol.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      let outgoingUrl = '';
      let outgoingHeaders: Record<string, string> = {};

      const mockFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        outgoingUrl = url;
        outgoingHeaders = (init?.headers as Record<string, string>) || {};
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: [{ id: '1' }] }),
        };
      });
      vi.stubGlobal('fetch', mockFetch);

      const fetchResult = await cmsApiFetchOperation.execute(
        snap,
        {
          slug: 'basic-auth-col',
          envVars: {
            USER_PASSWORD_VAL: 'cleartext_user_password_123',
          },
          queryParams: {
            'api-key': 'param_api_key_456',
            'client_secret': 'oauth_client_secret_789',
          },
        },
        mockContext,
      );

      // Verify outgoing request had real values
      expect(outgoingUrl).toContain('service-user:pass-phrase-987@');
      expect(outgoingUrl).toContain('api-key=param_api_key_456');
      expect(outgoingUrl).toContain('client_secret=oauth_client_secret_789');
      expect(outgoingHeaders['x-user-password']).toBe('cleartext_user_password_123');

      // Verify result had all sensitive values redacted
      expect(fetchResult.url).toContain('https://service-user:[REDACTED]@api.acme.com');
      expect(fetchResult.url).toContain('api-key=[REDACTED]');
      expect(fetchResult.url).toContain('client_secret=[REDACTED]');
      expect(fetchResult.url).not.toContain('pass-phrase-987');
      expect(fetchResult.url).not.toContain('param_api_key_456');
      expect(fetchResult.url).not.toContain('oauth_client_secret_789');
      expect(fetchResult.redactedHeaders['x-user-password']).toBe('[REDACTED]');
      expect(fetchResult.redactedHeaders['x-user-password']).not.toContain('cleartext_user_password_123');
    });

    it('returns honest failure status on HTTP 401 without returning fake success', async () => {
      let snap = createMockSnapshot({});
      const mutableFiles = new Map<string, string>();

      const setCol = await cmsApiCollectionSetOperation.execute(
        snap,
        {
          slug: 'unauthorized-col',
          name: 'Unauthorized Collection',
          provider: 'strapi',
          url: 'https://api.acme.com/v1/content',
          headers: { Authorization: 'Bearer env:INVALID_TOKEN' },
        },
        mockContext,
      );
      applyChanges(mutableFiles, setCol.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      const mockFetch = vi.fn().mockImplementation(async () => {
        return {
          ok: false,
          status: 401,
          json: async () => ({ error: 'Unauthorized access' }),
        };
      });
      vi.stubGlobal('fetch', mockFetch);

      const fetchResult = await cmsApiFetchOperation.execute(
        snap,
        {
          slug: 'unauthorized-col',
          envVars: { INVALID_TOKEN: 'bad_token' },
        },
        mockContext,
      );

      expect(fetchResult.ok).toBe(false);
      expect(fetchResult.status).toBe(401);
      expect(fetchResult.items).toEqual([]);
      expect(fetchResult.redactedHeaders['Authorization']).toBe('Bearer [REDACTED]');
    });

    it('rejects on fetch timeout via AbortSignal', async () => {
      let snap = createMockSnapshot({});
      const mutableFiles = new Map<string, string>();

      const setCol = await cmsApiCollectionSetOperation.execute(
        snap,
        {
          slug: 'slow-col',
          name: 'Slow Endpoint',
          provider: 'custom_rest',
          url: 'https://slow.acme.com/api',
        },
        mockContext,
      );
      applyChanges(mutableFiles, setCol.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      const mockFetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        const signal = init?.signal;
        return new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      });
      vi.stubGlobal('fetch', mockFetch);

      await expect(
        cmsApiFetchOperation.execute(
          snap,
          {
            slug: 'slow-col',
            timeoutMs: 50,
          },
          mockContext,
        ),
      ).rejects.toThrow(/timed out/);
    });
  });

  describe('5. Query Configuration on Collection List', () => {
    it('injects, updates, and removes data-query-config attribute on collection list container', async () => {
      let snap = createMockSnapshot({
        'app/blog/page.tsx': BASE_BLOG_PAGE,
      });
      const mutableFiles = new Map<string, string>();

      // 1. Set query config with static and dynamic expression params
      const setQueryRes = await cmsApiQueryConfigSetOperation.execute(
        snap,
        {
          filePath: 'app/blog/page.tsx',
          nodeId: 'article-list',
          queryConfig: {
            isApiMode: true,
            params: [
              { key: 'category', value: 'params.cat', isExpression: true },
              { key: 'limit', value: '12' },
            ],
          },
        },
        mockContext,
      );

      applyChanges(mutableFiles, setQueryRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      const updatedCode = snap.files.get('app/blog/page.tsx')!;
      expect(updatedCode).toContain('data-query-config={JSON.stringify(');
      expect(updatedCode).toContain('"isApiMode":true');
      expect(updatedCode).toContain('"key":"category","value":"params.cat","isExpression":true');

      const parsedNodes = parseJSXToNodes(updatedCode);
      const listNode = parsedNodes.get('article-list');
      expect(listNode?.collectionList?.queryConfig?.isApiMode).toBe(true);
      expect(listNode?.collectionList?.queryConfig?.params).toHaveLength(2);

      // 2. Remove query config by passing null
      const removeQueryRes = await cmsApiQueryConfigSetOperation.execute(
        snap,
        {
          filePath: 'app/blog/page.tsx',
          nodeId: 'article-list',
          queryConfig: null,
        },
        mockContext,
      );

      applyChanges(mutableFiles, removeQueryRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      const clearedCode = snap.files.get('app/blog/page.tsx')!;
      expect(clearedCode).not.toContain('data-query-config');
    });
  });

  describe('6. Dynamic Search Field Insertion & Variable Binding', () => {
    it('inserts styled search container and input, injects contains filter, and rebinds variable', async () => {
      let snap = createMockSnapshot({
        'app/blog/page.tsx': BASE_BLOG_PAGE,
        'cms/articles.schema.json': ARTICLES_SCHEMA,
      });
      const mutableFiles = new Map<string, string>();

      // 1. Add search field on text field 'title'
      const addSearchRes = await cmsApiSearchFieldAddOperation.execute(
        snap,
        {
          filePath: 'app/blog/page.tsx',
          nodeId: 'article-list',
          field: 'title',
          placeholder: 'Search articles by title...',
        },
        mockContext,
      );

      expect(addSearchRes.list).toBe('article-list');
      expect(addSearchRes.field).toBe('title');
      expect(addSearchRes.variable).toBe('searchTitle');
      expect(addSearchRes.inputFrame).toBe('search-article-list-title');

      applyChanges(mutableFiles, addSearchRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      const generatedCode = snap.files.get('app/blog/page.tsx')!;

      // Verify search input markup
      expect(generatedCode).toContain('data-search-field="searchTitle"');
      expect(generatedCode).toContain('placeholder="Search articles by title..."');
      expect(generatedCode).toContain('value={searchTitle}');
      expect(generatedCode).toContain('setSearchTitle(e.target.value)');

      // Verify useState hook emitted
      expect(generatedCode).toContain('const [searchTitle, setSearchTitle] = useState');

      // Verify collection list filter was updated with 'contains' filter
      const parsedNodes = parseJSXToNodes(generatedCode);
      const listNode = parsedNodes.get('article-list');
      expect(listNode?.collectionList?.filterGroup?.filters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'title',
            operator: 'contains',
            valueSource: 'searchField',
            valueVar: 'searchTitle',
          }),
        ]),
      );

      // 2. Re-bind search input to a new variable 'queryFilter'
      const rebindRes = await cmsApiSearchFieldSetVariableOperation.execute(
        snap,
        {
          filePath: 'app/blog/page.tsx',
          inputId: 'search-article-list-title-input',
          varName: 'queryFilter',
          createVar: true,
        },
        mockContext,
      );

      applyChanges(mutableFiles, rebindRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      const reboundCode = snap.files.get('app/blog/page.tsx')!;
      expect(reboundCode).toContain('data-search-field="queryFilter"');
      expect(reboundCode).toContain('value={queryFilter}');
      expect(reboundCode).toContain('setQueryFilter(e.target.value)');
      expect(reboundCode).toContain('const [queryFilter, setQueryFilter] = useState');
      expect(parseJSXToNodes(reboundCode).get('article-list')?.collectionList?.filterGroup?.filters[0]?.valueVar).toBe('queryFilter');
    });

    it('adds the React hook import when rebinding creates a variable on a page with only a default React import', async () => {
      const code = `'use client';
import React from 'react';
export default function Page() {
  return <div data-id="root"><input data-id="search-input" data-search-field="oldSearch" value={""} /></div>;
}`;
      const snap = createMockSnapshot({ 'app/rebind/page.tsx': code });
      const result = await cmsApiSearchFieldSetVariableOperation.execute(
        snap,
        {
          filePath: 'app/rebind/page.tsx',
          inputId: 'search-input',
          varName: 'searchTerm',
          createVar: true,
        },
        mockContext,
      );
      const updated = result.changes[0].content!;

      expect(updated).toMatch(/import React,\s*\{\s*useState\s*\}\s*from ['"]react['"]/);
      expect(updated).toContain('const [searchTerm, setSearchTerm] = useState');
      expect(updated).toContain('value={searchTerm}');
    });
  });

  describe('7. High-Level Declarative Flow via runCase', () => {
    it('executes end-to-end mode switch, collection setup, and queryConfig via runCase harness', async () => {
      await runCase({
        seed: 'empty',
        steps: [
          {
            tool: 'cms.api.mode.set',
            input: { mode: 'api' },
            expectedStatus: 'ok',
          },
          {
            tool: 'cms.api.collection.set',
            input: {
              slug: 'catalog',
              name: 'Product Catalog',
              provider: 'directus',
              url: 'https://catalog.acme.com/items/products',
              headers: { Authorization: 'Bearer env:CATALOG_TOKEN' },
            },
            expectedStatus: 'ok',
          },
        ],
        expect: {
          ok: true,
          revisionDelta: 2,
          changedFiles: [CMS_API_CONFIG_PATH],
        },
      });
    });
  });

  describe('8. Boundary & Error Handling', () => {
    it('throws when getting or deleting a non-existent collection', async () => {
      const snap = createMockSnapshot({});

      await expect(
        cmsApiCollectionGetOperation.execute(snap, { slug: 'non-existent' }, mockContext),
      ).rejects.toThrow('Collection "non-existent" not found');

      await expect(
        cmsApiCollectionDeleteOperation.execute(snap, { slug: 'non-existent' }, mockContext),
      ).rejects.toThrow('Collection "non-existent" not found');
    });

    it('rejects prototype property slugs like toString and constructor in collection get, delete, and fetch', async () => {
      const snap = createMockSnapshot({});

      // toString lookup in get
      await expect(
        cmsApiCollectionGetOperation.execute(snap, { slug: 'toString' }, mockContext),
      ).rejects.toThrow('Collection "toString" not found');

      // constructor lookup in get
      await expect(
        cmsApiCollectionGetOperation.execute(snap, { slug: 'constructor' }, mockContext),
      ).rejects.toThrow('Collection "constructor" not found');

      // toString lookup in delete
      await expect(
        cmsApiCollectionDeleteOperation.execute(snap, { slug: 'toString' }, mockContext),
      ).rejects.toThrow('Collection "toString" not found');

      // constructor lookup in delete
      await expect(
        cmsApiCollectionDeleteOperation.execute(snap, { slug: 'constructor' }, mockContext),
      ).rejects.toThrow('Collection "constructor" not found');

      // toString lookup in fetch
      await expect(
        cmsApiFetchOperation.execute(snap, { slug: 'toString' }, mockContext),
      ).rejects.toThrow('Collection "toString" not found');
    });

    it('rejects invalid URL in collection.set', async () => {
      const snap = createMockSnapshot({});

      await expect(
        cmsApiCollectionSetOperation.execute(
          snap,
          {
            slug: 'bad-url-col',
            name: 'Bad URL',
            provider: 'directus',
            url: 'invalid-not-a-url',
          },
          mockContext,
        ),
      ).rejects.toThrow();
    });

    it('rejects search field addition on a non-string field (e.g. number views)', async () => {
      const snap = createMockSnapshot({
        'app/blog/page.tsx': BASE_BLOG_PAGE,
        'cms/articles.schema.json': ARTICLES_SCHEMA,
      });

      await expect(
        cmsApiSearchFieldAddOperation.execute(
          snap,
          {
            filePath: 'app/blog/page.tsx',
            nodeId: 'article-list',
            field: 'views', // type: 'number'
          },
          mockContext,
        ),
      ).rejects.toThrow(/which cannot be searched/);
    });

    it('rejects duplicate search field on the same field', async () => {
      let snap = createMockSnapshot({
        'app/blog/page.tsx': BASE_BLOG_PAGE,
        'cms/articles.schema.json': ARTICLES_SCHEMA,
      });

      const firstRes = await cmsApiSearchFieldAddOperation.execute(
        snap,
        {
          filePath: 'app/blog/page.tsx',
          nodeId: 'article-list',
          field: 'title',
        },
        mockContext,
      );

      const files = new Map(snap.files);
      applyChanges(files, firstRes.changes);
      snap = createMockSnapshot(Object.fromEntries(files));

      await expect(
        cmsApiSearchFieldAddOperation.execute(
          snap,
          {
            filePath: 'app/blog/page.tsx',
            nodeId: 'article-list',
            field: 'title',
          },
          mockContext,
        ),
      ).rejects.toThrow(/already has a search field/);
    });

    it('rejects search field on non-existent collection list node', async () => {
      const snap = createMockSnapshot({
        'app/blog/page.tsx': BASE_BLOG_PAGE,
      });

      await expect(
        cmsApiSearchFieldAddOperation.execute(
          snap,
          {
            filePath: 'app/blog/page.tsx',
            nodeId: 'page-title', // not a collection list
            field: 'title',
          },
          mockContext,
        ),
      ).rejects.toThrow(/not a collection list/);
    });
  });
});
