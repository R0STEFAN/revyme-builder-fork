// packages/automation-core/test/capabilities/T23-release.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Snapshot } from '../../src/contracts';
import { createSnapshot, createOperationContext } from '../../src/session';
import { defaultRegistry } from '../../src/registry';
import '../../src/index';

import {
  exportFormatsOperation,
  exportGenerateOperation,
} from '../../src/operations/export';
import {
  publishPreflightOperation,
  previewBuildOperation,
  publishDeployOperation,
  publishStatusOperation,
  loadDeployments,
  DEPLOYMENTS_STORAGE_PATH,
} from '../../src/operations/publish';
import { projectFS, MAIN_BRANCH_ID } from '@/code/project/project-fs';

const CLEAN_PAGE_CODE = `'use client';
import React from 'react';

/** @canvas { "viewports": [ { "id": "desktop", "label": "Desktop", "width": 1200, "height": "auto", "isPrimary": true, "order": 0 } ], "positions": { "desktop": { "x": 0, "y": 0 } } } */

export default function HomePage() {
  return (
    <div data-id="root" style={{ width: '100%', minHeight: '100vh', padding: '24px' }}>
      <h1 data-id="h1">Welcome to Revyme</h1>
      <p data-id="p1">Visual Next.js Builder</p>
    </div>
  );
}
`;

const CLEAN_LAYOUT_CODE = `import React from 'react';

export const metadata = {
  title: 'My Revyme Site',
  description: 'Built with Revyme Visual Builder',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`;

const ABOUT_PAGE_CODE = `'use client';
import React from 'react';

/** @canvas { "viewports": [ { "id": "desktop", "label": "Desktop", "width": 1200, "height": "auto", "isPrimary": true, "order": 0 } ], "positions": { "desktop": { "x": 0, "y": 0 } } } */

export default function AboutPage() {
  return (
    <div data-id="about-root" style={{ width: '100%', padding: '16px' }}>
      <h2 data-id="about-h2">About Us</h2>
    </div>
  );
}
`;

const MARKETING_LAYOUT_CLIENT = `'use client';
import React from 'react';

export default function MarketingLayoutClient({ children }: { children: React.ReactNode }) {
  return (
    <div data-id="marketing-shell">
      <header data-id="hdr">Marketing Header</header>
      {children}
    </div>
  );
}
`;

function createMockSnapshot(files: Record<string, string>, revision = 1): Snapshot {
  return createSnapshot({ projectId: 'test-project', branchId: 'main' }, revision, files);
}

describe('T23: Release, Export & Publishing Capability Suite', () => {
  const context = createOperationContext();

  beforeEach(() => {
    projectFS.loadSnapshot(
      new Map([
        ['app/layout.tsx', CLEAN_LAYOUT_CODE],
        ['app/page.client.tsx', CLEAN_PAGE_CODE],
        ['app/about/page.client.tsx', ABOUT_PAGE_CODE],
        ['app/globals.css', 'body { margin: 0; }'],
      ]),
    );
    projectFS.switchBranch(MAIN_BRANCH_ID);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Group 1: Registry Registration & Compatibility Aliases
  // ───────────────────────────────────────────────────────────────────────────
  describe('1. Registry Registration & Aliases', () => {
    const requiredOps = [
      'export.formats',
      'export.generate',
      'preview.build',
      'publish.preflight',
      'publish.deploy',
      'publish.status',
    ];

    it('registers all canonical T23 operations with ownerTask="T23"', () => {
      for (const name of requiredOps) {
        const op = defaultRegistry.get(name);
        expect(op, `Operation "${name}" should be registered`).toBeDefined();
        expect(op?.name).toBe(name);
        expect(op?.ownerTask).toBe('T23');
      }
    });

    it('assigns correct categories and kinds', () => {
      expect(defaultRegistry.get('export.formats')?.category).toBe('export');
      expect(defaultRegistry.get('export.generate')?.category).toBe('export');
      expect(defaultRegistry.get('preview.build')?.category).toBe('publish');
      expect(defaultRegistry.get('publish.preflight')?.category).toBe('publish');
      expect(defaultRegistry.get('publish.deploy')?.category).toBe('publish');
      expect(defaultRegistry.get('publish.status')?.category).toBe('publish');

      expect(defaultRegistry.get('export.generate')?.kind).toBe('read');
      expect(defaultRegistry.get('publish.deploy')?.kind).toBe('mutation');
    });

    it('resolves all compatibility aliases', () => {
      const aliasMap: Record<string, string> = {
        'export.listFormats': 'export.formats',
        'export.list_formats': 'export.formats',
        'export.getFormats': 'export.formats',
        'export.targets': 'export.formats',
        'formats.list': 'export.formats',
        'export.availableFormats': 'export.formats',
        'project.export': 'export.generate',
        'export.project': 'export.generate',
        'export.zip': 'export.generate',
        'export.bundle': 'export.generate',
        'export.source': 'export.generate',
        'export.create': 'export.generate',
        'export.site': 'export.generate',
        'build.preview': 'preview.build',
        'preview.generate': 'preview.build',
        'preview.start': 'preview.build',
        'preview.create': 'preview.build',
        'preview.check': 'preview.build',
        'preflight.check': 'publish.preflight',
        'publish.check': 'publish.preflight',
        'preflight.run': 'publish.preflight',
        'preflight.validate': 'publish.preflight',
        'deploy.site': 'publish.deploy',
        'site.publish': 'publish.deploy',
        'publish.site': 'publish.deploy',
        'project.publish': 'publish.deploy',
        'deploy.status': 'publish.status',
        'publish.history': 'publish.status',
      };

      for (const [alias, canonical] of Object.entries(aliasMap)) {
        const op = defaultRegistry.get(alias);
        expect(op, `Alias "${alias}" should resolve to "${canonical}"`).toBeDefined();
        expect(op?.name).toBe(canonical);
      }
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Group 2: Export Formats & Capability Discovery
  // ───────────────────────────────────────────────────────────────────────────
  describe('2. Export Formats & Capability Discovery (export.formats)', () => {
    it('enumerates nextjs, ssg, static, tailwind, and vite formats', async () => {
      const snapshot = createMockSnapshot({});
      const result = await exportFormatsOperation.execute(snapshot, {}, context);

      expect(result.formats).toBeDefined();
      expect(result.formats.length).toBeGreaterThanOrEqual(3);
      expect(result.defaultFormat).toBe('nextjs');

      const ids = result.formats.map((f) => f.id);
      expect(ids).toContain('nextjs');
      expect(ids).toContain('ssg');
      expect(ids).toContain('static');
      expect(ids).toContain('tailwind');
    });

    it('provides accurate capabilities, extensions, and metadata per format', async () => {
      const snapshot = createMockSnapshot({});
      const result = await exportFormatsOperation.execute(snapshot, {}, context);

      const nextjs = result.formats.find((f) => f.id === 'nextjs');
      expect(nextjs?.extension).toBe('.zip');
      expect(nextjs?.target).toBe('nextjs');
      expect(nextjs?.capabilities).toContain('dynamic-routes');
      expect(nextjs?.status).toBe('supported');

      const ssg = result.formats.find((f) => f.id === 'ssg');
      expect(ssg?.ssgSupported).toBe(true);
      expect(ssg?.capabilities).toContain('static-export');
      expect(ssg?.status).toBe('supported');

      const staticFmt = result.formats.find((f) => f.id === 'static');
      expect(staticFmt?.target).toBe('static');
      expect(staticFmt?.status).toBe('supported');

      const tailwind = result.formats.find((f) => f.id === 'tailwind');
      expect(tailwind?.status).toBe('unsupported');
      expect(tailwind?.unsupportedReason).toMatch(/cloud|501/i);
    });

    it('supports status filtering (supported vs all)', async () => {
      const snapshot = createMockSnapshot({});
      const supportedOnly = await exportFormatsOperation.execute(snapshot, { status: 'supported' }, context);
      expect(supportedOnly.formats.every((f) => f.status === 'supported')).toBe(true);

      const all = await exportFormatsOperation.execute(snapshot, { status: 'all' }, context);
      expect(all.formats.some((f) => f.status === 'unsupported')).toBe(true);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Group 3: Source Export Generation (export.generate)
  // ───────────────────────────────────────────────────────────────────────────
  describe('3. Source Export Generation (export.generate)', () => {
    it('exports a runnable Next.js project with scaffold files', async () => {
      const snapshot = createMockSnapshot({
        'app/layout.tsx': CLEAN_LAYOUT_CODE,
        'app/page.client.tsx': CLEAN_PAGE_CODE,
        'app/about/page.client.tsx': ABOUT_PAGE_CODE,
        'app/globals.css': 'body { margin: 0; }',
      });

      const result = await exportGenerateOperation.execute(
        snapshot,
        { format: 'nextjs', archiveType: 'files', clean: true },
        context,
      );

      expect(result.format).toBe('nextjs');
      expect(result.totalFiles).toBeGreaterThan(0);
      expect(result.fileCount).toBeGreaterThan(0);
      expect(result.totalBytes).toBeGreaterThan(0);
      expect(result.byteCount).toBeGreaterThan(0);
      expect(result.scaffoldIncluded).toBe(true);
      expect(result.files).toBeDefined();

      const files = result.files!;
      // Scaffold verification
      expect(files['package.json']).toBeDefined();
      const pkg = JSON.parse(files['package.json']);
      expect(pkg.dependencies).toBeDefined();
      expect(pkg.dependencies['next']).toBeDefined();
      expect(pkg.dependencies['react']).toBeDefined();
      expect(pkg.dependencies['@revyme/runtime']).toBeDefined();
      expect(pkg.scripts?.dev).toBe('next dev');
      expect(pkg.scripts?.build).toBe('next build');

      expect(files['next.config.mjs'] || files['next.config.js']).toBeDefined();
      expect(files['tsconfig.json']).toBeDefined();
      const tsconfig = JSON.parse(files['tsconfig.json']);
      expect(tsconfig.compilerOptions?.jsx).toBe('react-jsx');

      expect(files['README.md']).toBeDefined();
      expect(files['.gitignore']).toBeDefined();

      // Project source verification
      expect(files['app/layout.tsx']).toBeDefined();
      expect(files['app/page.client.tsx']).toBeDefined();
      expect(files['app/about/page.client.tsx']).toBeDefined();
    });

    it('exports SSG format with output: "export" configured', async () => {
      const snapshot = createMockSnapshot({
        'app/layout.tsx': CLEAN_LAYOUT_CODE,
        'app/page.client.tsx': CLEAN_PAGE_CODE,
      });

      const result = await exportGenerateOperation.execute(
        snapshot,
        { format: 'ssg', archiveType: 'files' },
        context,
      );

      expect(result.format).toBe('ssg');
      const files = result.files!;
      const nextConfig = files['next.config.mjs'] || files['next.config.js'] || '';
      expect(nextConfig).toContain("output: 'export'");
    });

    it('exports base64 zip archive with valid PK zip header', async () => {
      const snapshot = createMockSnapshot({
        'app/layout.tsx': CLEAN_LAYOUT_CODE,
        'app/page.client.tsx': CLEAN_PAGE_CODE,
      });

      const result = await exportGenerateOperation.execute(
        snapshot,
        { format: 'nextjs', archiveType: 'base64' },
        context,
      );

      expect(result.archiveBase64).toBeDefined();
      expect(typeof result.archiveBase64).toBe('string');
      // PK magic bytes (PK\x03\x04 in base64 starts with 'UEsDB')
      expect(result.archiveBase64!.startsWith('UEsDB')).toBe(true);

      expect(result.manifest.length).toBeGreaterThan(0);
      const manifestPaths = result.manifest.map((m) => m.path);
      expect(manifestPaths).toContain('package.json');
      expect(manifestPaths).toContain('app/page.client.tsx');
    });

    it('strips internal builder metadata (_meta/ and _revyme/) from export', async () => {
      const snapshot = createMockSnapshot({
        'app/layout.tsx': CLEAN_LAYOUT_CODE,
        'app/page.client.tsx': CLEAN_PAGE_CODE,
        '_meta/secrets/api-keys.json': '{"secret": "123"}',
        '_meta/history.json': '{"undoStack": []}',
        '_revyme/draft-session.json': '{"session": "active"}',
      });

      const result = await exportGenerateOperation.execute(
        snapshot,
        { format: 'nextjs', archiveType: 'files' },
        context,
      );

      const files = result.files!;
      expect(files['_meta/secrets/api-keys.json']).toBeUndefined();
      expect(files['_meta/history.json']).toBeUndefined();
      expect(files['_revyme/draft-session.json']).toBeUndefined();
    });

    it('rejects unsupported tailwind export with honest message', async () => {
      const snapshot = createMockSnapshot({
        'app/layout.tsx': CLEAN_LAYOUT_CODE,
        'app/page.client.tsx': CLEAN_PAGE_CODE,
      });

      await expect(
        exportGenerateOperation.execute(snapshot, { format: 'tailwind' }, context),
      ).rejects.toThrow(/UNSUPPORTED_EXPORT_FORMAT/i);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Group 4: Genuine Preflight Inspections (publish.preflight)
  // ───────────────────────────────────────────────────────────────────────────
  describe('4. Genuine Preflight Inspections (publish.preflight - Zero Mock Fallbacks)', () => {
    it('passes preflight on a clean, valid project', async () => {
      const snapshot = createMockSnapshot({
        'app/layout.tsx': CLEAN_LAYOUT_CODE,
        'app/page.client.tsx': CLEAN_PAGE_CODE,
      });

      const result = await publishPreflightOperation.execute(snapshot, {}, context);

      expect(result.passed).toBe(true);
      expect(result.failedChecks).toBe(0);
      expect(result.fatalCount).toBe(0);
      expect(result.totalChecks).toBeGreaterThan(0);
      expect(result.checks.every((c) => c.status !== 'fail')).toBe(true);
    });

    it('catches fatal Oracle violations (STRING_STYLE_ATTR)', async () => {
      const BROKEN_PAGE = `'use client';
import React from 'react';

/** @canvas { "viewports": [ { "id": "desktop", "label": "Desktop", "width": 1200, "height": "auto", "isPrimary": true, "order": 0 } ], "positions": { "desktop": { "x": 0, "y": 0 } } } */

export default function BrokenPage() {
  return (
    <div data-id="broken" style="color: red; background: black;">
      <h1 data-id="h1">Invalid string style</h1>
    </div>
  );
}
`;
      const snapshot = createMockSnapshot({
        'app/layout.tsx': CLEAN_LAYOUT_CODE,
        'app/page.client.tsx': BROKEN_PAGE,
      });

      const result = await publishPreflightOperation.execute(snapshot, {}, context);

      expect(result.passed).toBe(false);
      expect(result.failedChecks).toBeGreaterThan(0);
      expect(result.fatalCount).toBeGreaterThan(0);

      const oracleFail = result.checks.find(
        (c) => (c.category === 'oracle' || c.category === 'pages') && c.status === 'fail',
      );
      expect(oracleFail).toBeDefined();
      expect(oracleFail?.code).toBe('STRING_STYLE_ATTR');
      expect(oracleFail?.path).toContain('page.client.tsx');
    });

    it('detects missing SEO metadata in layout', async () => {
      const BARE_LAYOUT = `import React from 'react';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html><body>{children}</body></html>;
}
`;
      const snapshot = createMockSnapshot({
        'app/layout.tsx': BARE_LAYOUT,
        'app/page.client.tsx': CLEAN_PAGE_CODE,
      });

      const result = await publishPreflightOperation.execute(snapshot, { strict: true }, context);

      const metaCheck = result.checks.find((c) => c.category === 'metadata' || c.category === 'seo');
      expect(metaCheck).toBeDefined();
      expect(metaCheck?.status).toMatch(/fail|warn/);
      expect(metaCheck?.message).toMatch(/metadata|title|description/i);
    });

    it('detects unconfigured form destinations', async () => {
      const UNCONFIGURED_FORM_PAGE = `'use client';
import React from 'react';

/** @canvas { "viewports": [ { "id": "desktop", "label": "Desktop", "width": 1200, "height": "auto", "isPrimary": true, "order": 0 } ], "positions": { "desktop": { "x": 0, "y": 0 } } } */

export default function FormPage() {
  return (
    <div data-id="root">
      <form data-id="contact-form" data-form='{"sendTo":[]}'>
        <input data-id="inp-email" type="email" name="email" />
        <button data-id="sub-btn" type="submit">Submit</button>
      </form>
    </div>
  );
}
`;
      const snapshot = createMockSnapshot({
        'app/layout.tsx': CLEAN_LAYOUT_CODE,
        'app/page.client.tsx': UNCONFIGURED_FORM_PAGE,
      });

      const result = await publishPreflightOperation.execute(snapshot, {}, context);

      const formCheck = result.checks.find((c) => c.category === 'forms');
      expect(formCheck).toBeDefined();
      expect(formCheck?.status).toBe('fail');
      expect(formCheck?.message).toMatch(/destination|sendTo|unconfigured/i);
    });

    it('detects circular redirect loops', async () => {
      const REDIRECT_LOOP = JSON.stringify([
        { id: 'r1', from: '/pricing', to: '/plans' },
        { id: 'r2', from: '/plans', to: '/pricing' },
      ]);

      const snapshot = createMockSnapshot({
        'app/layout.tsx': CLEAN_LAYOUT_CODE,
        'app/page.client.tsx': CLEAN_PAGE_CODE,
        'app/_redirects.json': REDIRECT_LOOP,
      });

      const result = await publishPreflightOperation.execute(snapshot, {}, context);

      const redirectCheck = result.checks.find((c) => c.category === 'redirects');
      expect(redirectCheck).toBeDefined();
      expect(redirectCheck?.status).toBe('fail');
      expect(redirectCheck?.message).toMatch(/loop|cycle|redirect/i);
    });

    it('detects missing unlinked uploaded asset references', async () => {
      const MISSING_ASSET_PAGE = `'use client';
import React from 'react';

/** @canvas { "viewports": [ { "id": "desktop", "label": "Desktop", "width": 1200, "height": "auto", "isPrimary": true, "order": 0 } ], "positions": { "desktop": { "x": 0, "y": 0 } } } */

export default function AssetPage() {
  return (
    <div data-id="root">
      <img data-id="hero-img" src="/uploads/non-existent-hero-banner-999.png" alt="Hero" />
    </div>
  );
}
`;
      const snapshot = createMockSnapshot({
        'app/layout.tsx': CLEAN_LAYOUT_CODE,
        'app/page.client.tsx': MISSING_ASSET_PAGE,
      });

      const result = await publishPreflightOperation.execute(snapshot, {}, context);

      const assetCheck = result.checks.find((c) => c.category === 'assets');
      expect(assetCheck).toBeDefined();
      expect(assetCheck?.status).toBe('fail');
      expect(assetCheck?.message).toContain('non-existent-hero-banner-999.png');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Group 5: Preview Build Generation & Routes Map
  // ───────────────────────────────────────────────────────────────────────────
  describe('5. Preview Build Generation & Routes Map (preview.build)', () => {
    it('generates preview server descriptor with full routesMap', async () => {
      const snapshot = createMockSnapshot({
        'app/layout.tsx': CLEAN_LAYOUT_CODE,
        'app/page.client.tsx': CLEAN_PAGE_CODE,
        'app/about/page.client.tsx': ABOUT_PAGE_CODE,
        'app/(marketing)/LayoutClient.tsx': MARKETING_LAYOUT_CLIENT,
      });

      const result = await previewBuildOperation.execute(
        snapshot,
        { port: 5175, mode: 'development' },
        context,
      );

      expect(result.status).toBe('ready');
      expect(result.previewUrl).toContain('5175');
      expect(result.readyCount).toBeGreaterThanOrEqual(2);
      expect(result.routesCount).toBeGreaterThanOrEqual(2);

      expect(result.routesMap['/']).toBeDefined();
      expect(result.routesMap['/']?.path).toBe('app/page.client.tsx');
      expect(result.routesMap['/']?.kind).toBe('page');

      expect(result.routesMap['/about']).toBeDefined();
      expect(result.routesMap['/about']?.path).toBe('app/about/page.client.tsx');

      expect(result.routesMap['/__template_preview/marketing']).toBeDefined();
      expect(result.routesMap['/__template_preview/marketing']?.kind).toBe('template');
    });

    it('reports failure status when pages have critical parse errors', async () => {
      const UNPARSABLE_PAGE = `'use client';
export default function Broken( {
  return <div>unclosed
`;
      const snapshot = createMockSnapshot({
        'app/layout.tsx': CLEAN_LAYOUT_CODE,
        'app/page.client.tsx': UNPARSABLE_PAGE,
      });

      const result = await previewBuildOperation.execute(snapshot, {}, context);

      expect(result.status).toBe('failed');
      expect(result.issues).toBeDefined();
      expect(result.issues!.length).toBeGreaterThan(0);
      expect(result.issues![0]?.path || result.issues![0]?.file).toContain('page.client.tsx');
    });

    it('delegates to preview adapter when provided', async () => {
      const snapshot = createMockSnapshot({
        'app/layout.tsx': CLEAN_LAYOUT_CODE,
        'app/page.client.tsx': CLEAN_PAGE_CODE,
      });

      const mockPreviewAdapter = vi.fn().mockResolvedValue({
        status: 'ready',
        bundleId: 'custom-pvw-123',
        previewUrl: 'http://localhost:9999/preview/custom',
        buildDurationMs: 42,
        durationMs: 42,
        pageRoutes: { '/': 'app/page.client.tsx' },
        routesMap: { '/': { path: 'app/page.client.tsx', kind: 'page' } },
        routesCount: 1,
        readyCount: 1,
        timestamp: new Date().toISOString(),
      });

      const adapterContext = {
        ...context,
        adapters: {
          ...context.adapters,
          preview: { build: mockPreviewAdapter },
        },
      };

      const result = await previewBuildOperation.execute(snapshot, {}, adapterContext as any);
      expect(mockPreviewAdapter).toHaveBeenCalledTimes(1);
      expect(result.bundleId).toBe('custom-pvw-123');
      expect(result.previewUrl).toBe('http://localhost:9999/preview/custom');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Group 6: Deployment Lifecycle & History Persistence
  // ───────────────────────────────────────────────────────────────────────────
  describe('6. Deployment Lifecycle & History Persistence (publish.deploy)', () => {
    it('blocks deployment when preflight fails without force flag', async () => {
      const BROKEN_PAGE = `'use client';
import React from 'react';
export default function Bad() {
  return <div data-id="bad" style="background: red;" />;
}
`;
      const snapshot = createMockSnapshot({
        'app/layout.tsx': CLEAN_LAYOUT_CODE,
        'app/page.client.tsx': BROKEN_PAGE,
      });

      await expect(
        publishDeployOperation.execute(snapshot, { target: 'production' }, context),
      ).rejects.toThrow(/PREFLIGHT_FAILED|DEPLOY_PREFLIGHT_BLOCKED/i);
    });

    it('allows deployment with force=true despite preflight warnings', async () => {
      const BROKEN_PAGE = `'use client';
import React from 'react';
export default function Bad() {
  return <div data-id="bad" style="background: red;" />;
}
`;
      const snapshot = createMockSnapshot({
        'app/layout.tsx': CLEAN_LAYOUT_CODE,
        'app/page.client.tsx': BROKEN_PAGE,
      });

      const result = await publishDeployOperation.execute(
        snapshot,
        { target: 'staging', force: true, message: 'Forced hotfix' },
        context,
      );

      expect(result.status).toBe('deployed');
      expect(result.target).toBe('staging');
      expect(result.preflightPassed).toBe(false);
      expect(result.forced).toBe(true);
      expect(result.deploymentId.startsWith('dep-')).toBe(true);
    });

    it('records and persists deployment history in _meta/deployments.json', async () => {
      const snapshot = createMockSnapshot({
        'app/layout.tsx': CLEAN_LAYOUT_CODE,
        'app/page.client.tsx': CLEAN_PAGE_CODE,
      });

      // 1st deploy to staging
      const dep1 = await publishDeployOperation.execute(
        snapshot,
        { target: 'staging', message: 'Initial staging deploy' },
        context,
      );

      expect(dep1.status).toBe('deployed');
      expect(dep1.target).toBe('staging');
      expect(dep1.preflightPassed).toBe(true);

      const deploymentsAfter1 = loadDeployments(snapshot);
      expect(deploymentsAfter1.length).toBe(1);
      expect(deploymentsAfter1[0].id).toBe(dep1.deploymentId);
      expect(deploymentsAfter1[0].target).toBe('staging');

      // 2nd deploy to production
      const dep2 = await publishDeployOperation.execute(
        snapshot,
        { target: 'production', message: 'Production release' },
        context,
      );

      expect(dep2.status).toBe('deployed');
      expect(dep2.target).toBe('production');

      const deploymentsAfter2 = loadDeployments(snapshot);
      expect(deploymentsAfter2.length).toBe(2);
      expect(deploymentsAfter2[1].id).toBe(dep2.deploymentId);
      expect(deploymentsAfter2[1].target).toBe('production');

      // Verify file persistence in ProjectFS
      const persistedJson = projectFS.readFile(DEPLOYMENTS_STORAGE_PATH);
      expect(persistedJson).toBeDefined();
      const parsed = JSON.parse(persistedJson!);
      expect(parsed.length).toBe(2);
    });

    it('delegates to context.adapters.hosting.deploy when configured', async () => {
      const snapshot = createMockSnapshot({
        'app/layout.tsx': CLEAN_LAYOUT_CODE,
        'app/page.client.tsx': CLEAN_PAGE_CODE,
      });

      const mockDeployAdapter = vi.fn().mockResolvedValue({
        deploymentId: 'custom-deploy-888',
        url: 'https://custom-provider.example.com/site',
        status: 'deployed',
        target: 'production',
        targetEnvironment: 'production',
        commitHash: 'abcdef',
        revision: 1,
        pageCount: 1,
        forced: false,
        timestamp: new Date().toISOString(),
        success: true,
      });

      const adapterContext = {
        ...context,
        adapters: {
          ...context.adapters,
          hosting: { deploy: mockDeployAdapter },
        },
      };

      const result = await publishDeployOperation.execute(
        snapshot,
        { target: 'production' },
        adapterContext as any,
      );

      expect(mockDeployAdapter).toHaveBeenCalledTimes(1);
      expect(result.deploymentId).toBe('custom-deploy-888');
      expect(result.url).toBe('https://custom-provider.example.com/site');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Group 7: Status Introspection & Boundary Conditions
  // ───────────────────────────────────────────────────────────────────────────
  describe('7. Status Introspection & Boundary Conditions', () => {
    it('queries deployment status via publish.status', async () => {
      const snapshot = createMockSnapshot({
        'app/layout.tsx': CLEAN_LAYOUT_CODE,
        'app/page.client.tsx': CLEAN_PAGE_CODE,
      });

      await publishDeployOperation.execute(snapshot, { target: 'staging' }, context);
      await publishDeployOperation.execute(snapshot, { target: 'production' }, context);

      const statusRes = await publishStatusOperation.execute(snapshot, { limit: 5 }, context);
      expect(statusRes.totalDeployments).toBe(2);
      expect(statusRes.latestDeployment).toBeDefined();
      expect(statusRes.latestProduction).toBeDefined();
      expect(statusRes.latestStaging).toBeDefined();
      expect(statusRes.latestProduction?.target).toBe('production');
      expect(statusRes.latestStaging?.target).toBe('staging');
    });

    it('rejects invalid export format with Zod validation error', () => {
      const validation = defaultRegistry.validateInput('export.generate', {
        format: 'unsupported-format-xyz',
      });
      expect(validation.ok).toBe(false);
      if (!validation.ok) {
        expect(validation.issues[0]?.path).toContain('format');
      }
    });

    it('rejects invalid deploy target with Zod validation error', () => {
      const validation = defaultRegistry.validateInput('publish.deploy', {
        target: 'local-desktop-invalid',
      });
      expect(validation.ok).toBe(false);
      if (!validation.ok) {
        expect(validation.issues[0]?.path).toContain('target');
      }
    });

    it('recovers safely from corrupted _meta/deployments.json', async () => {
      const snapshot = createMockSnapshot({
        'app/layout.tsx': CLEAN_LAYOUT_CODE,
        'app/page.client.tsx': CLEAN_PAGE_CODE,
        [DEPLOYMENTS_STORAGE_PATH]: 'CORRUPTED_JSON_NOT_VALID',
      });

      // Does not throw syntax error, resets gracefully
      const records = loadDeployments(snapshot);
      expect(records).toEqual([]);

      const result = await publishDeployOperation.execute(snapshot, { target: 'staging' }, context);
      expect(result.status).toBe('deployed');

      const updated = loadDeployments(snapshot);
      expect(updated.length).toBe(1);
    });

    it('handles empty project gracefully without crashing', async () => {
      const emptySnapshot = createMockSnapshot({});

      const previewRes = await previewBuildOperation.execute(emptySnapshot, {}, context);
      expect(previewRes.readyCount).toBe(0);
      expect(Object.keys(previewRes.routesMap).length).toBe(0);

      const preflightRes = await publishPreflightOperation.execute(emptySnapshot, {}, context);
      expect(preflightRes.totalChecks).toBeGreaterThan(0);
    });
  });
});
