import { describe, expect, it } from 'vitest';
import {
  isSecretEnvFile,
  generateEnvExample,
  buildCmsQueryRouteHandler,
  prepareSiteFiles,
  buildSourceExport,
} from '../source-export';
import { parse } from '@babel/parser';

describe('Source Export Cleanliness & Remote Query Relay', () => {
  describe('isSecretEnvFile', () => {
    it('detects all sensitive .env variants and rejects them', () => {
      expect(isSecretEnvFile('.env')).toBe(true);
      expect(isSecretEnvFile('.env.local')).toBe(true);
      expect(isSecretEnvFile('.env.production')).toBe(true);
      expect(isSecretEnvFile('.env.production.local')).toBe(true);
      expect(isSecretEnvFile('.env.development')).toBe(true);
      expect(isSecretEnvFile('.env.development.local')).toBe(true);
      expect(isSecretEnvFile('.env.test.local')).toBe(true);
      expect(isSecretEnvFile('sub/path/.env')).toBe(true);
      expect(isSecretEnvFile('config/.env.local')).toBe(true);
    });

    it('safely preserves .env.example', () => {
      expect(isSecretEnvFile('.env.example')).toBe(false);
      expect(isSecretEnvFile('sub/path/.env.example')).toBe(false);
    });

    it('does not false-positive on arbitrary filenames', () => {
      expect(isSecretEnvFile('environment.ts')).toBe(false);
      expect(isSecretEnvFile('my-env.json')).toBe(false);
      expect(isSecretEnvFile('app/api/route.ts')).toBe(false);
    });
  });

  describe('generateEnvExample', () => {
    it('generates placeholder env documentation from secret env files and source code without leaking values', () => {
      const files = {
        '.env.local': 'CMS_SECRET_KEY=super_secret_12345\nDATABASE_URL=postgres://user:pass@localhost:5432/db\n# A comment\n\n',
        'app/page.tsx': 'export default function Page() { return <div>{process.env.NEXT_PUBLIC_SITE_URL}</div>; }',
        '_meta/cms-api-config.json': JSON.stringify({
          apiCollections: {
            posts: {
              slug: 'posts',
              url: 'https://api.example.com/posts',
              headers: { Authorization: 'Bearer env:CMS_BEARER_TOKEN' },
            },
          },
        }),
      };

      const example = generateEnvExample(files);
      expect(example).not.toBeNull();
      expect(example).toContain('CMS_SECRET_KEY=your_cms_secret_key_here');
      expect(example).toContain('DATABASE_URL=your_database_url_here');
      expect(example).toContain('NEXT_PUBLIC_SITE_URL=your_next_public_site_url_here');
      expect(example).toContain('CMS_BEARER_TOKEN=your_cms_bearer_token_here');
      // Ensure real secrets were not leaked
      expect(example).not.toContain('super_secret_12345');
      expect(example).not.toContain('postgres://');
    });
  });

  describe('buildCmsQueryRouteHandler', () => {
    it('generates a valid Next.js route handler with POST and GET methods', () => {
      const apiConfigs = {
        posts: {
          slug: 'posts',
          name: 'Posts',
          provider: 'directus' as const,
          url: 'https://api.example.com/items/posts',
          method: 'GET' as const,
          headers: { Authorization: 'Bearer env:DIRECTUS_TOKEN' },
          itemsKey: 'data',
          totalKey: 'meta.filter_count',
        },
      };

      const code = buildCmsQueryRouteHandler(apiConfigs);
      expect(code).toContain("export const dynamic = 'force-dynamic';");
      expect(code).toContain('export async function POST(req: Request)');
      expect(code).toContain('export async function GET(req: Request)');
      expect(code).toContain('const API_COLLECTIONS: Record<string,');
      expect(code).toContain('"posts":');
      expect(code).toContain('process.env');
      expect(code).toContain('resolveHeader');
      expect(code).toContain('signal: AbortSignal.timeout(10000)');

      // Verify code parses cleanly
      expect(() =>
        parse(code, {
          sourceType: 'module',
          plugins: ['typescript'],
        }),
      ).not.toThrow();
    });
  });

  describe('prepareSiteFiles & buildSourceExport clean export', () => {
    const apiConfigJson = JSON.stringify({
      mode: 'api',
      apiCollections: {
        posts: {
          slug: 'posts',
          name: 'Posts',
          provider: 'directus',
          url: 'https://cms.example.com/items/posts',
          method: 'GET',
          headers: { Authorization: 'Bearer env:CMS_TOKEN' },
          itemsKey: 'data',
        },
      },
    });

    const clientPage = `'use client';
import React from 'react';
import posts from '@/cms/posts.json';

export default function BlogClient() {
  return (
    <div data-id="root">
      <div data-id="posts-list" data-query-config='{"source":"posts"}'>
        {posts.map((post: any, idx: number) => (
          <article key={idx}>{post.title}</article>
        ))}
      </div>
    </div>
  );
}
`;

    const serverPage = `import PageClient from './page.client';

export default function Page() {
  return <PageClient />;
}
`;

    it('injects app/api/cms/query/route.ts when API collections are present', () => {
      const input = {
        '_meta/cms-api-config.json': apiConfigJson,
        'app/blog/page.client.tsx': clientPage,
        'app/blog/page.tsx': serverPage,
      };

      const prepared = prepareSiteFiles(input);
      expect(prepared['app/api/cms/query/route.ts']).toBeDefined();
      expect(prepared['app/api/cms/query/route.ts']).toContain('export async function POST');
    });

    it('prunes unused API preview cache files while keeping local CMS collections', async () => {
      const input = {
        '_meta/cms-api-config.json': apiConfigJson,
        '.env.local': 'CMS_TOKEN=top_secret_token_value',
        'cms/posts.json': JSON.stringify([{ id: 1, title: 'Preview Post 1' }]),
        'cms/authors.json': JSON.stringify([{ id: 10, name: 'Alice Author' }]),
        'app/blog/page.client.tsx': clientPage,
        'app/blog/page.tsx': serverPage,
        'app/authors/page.tsx': `import authors from '@/cms/authors.json';
export default function AuthorsPage() {
  return <div>{authors.map((a: any) => <span key={a.id}>{a.name}</span>)}</div>;
}`,
      };

      const exported = await buildSourceExport(input, {
        name: 'test-site',
        runtimeRange: '^1.0.0',
      });

      // Secret env file must NEVER be in export
      expect(exported.files['.env.local']).toBeUndefined();
      expect(exported.files['.env']).toBeUndefined();

      // .env.example must be present with placeholder
      expect(exported.files['.env.example']).toBeDefined();
      expect(exported.files['.env.example']).toContain('CMS_TOKEN=your_cms_token_here');
      expect(exported.files['.env.example']).not.toContain('top_secret_token_value');

      // API preview cache cms/posts.json should be pruned because client page was rewritten to cmsDatasets
      expect(exported.files['cms/posts.json']).toBeUndefined();

      // Local collection cms/authors.json must be kept
      expect(exported.files['cms/authors.json']).toBeDefined();

      // Query route handler must be exported
      expect(exported.files['app/api/cms/query/route.ts']).toBeDefined();
    });
  });
});
