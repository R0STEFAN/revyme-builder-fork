// packages/automation-core/test/capabilities/T23-challenger1.test.ts
/**
 * Empirical Adversarial Challenger Suite for Milestone T23: Source Export & SSG
 *
 * Stress-tests:
 * 1. Corrupted, invalid, boundary, and alias export format names.
 * 2. Malicious paths, directory traversal (Zip Slip), and path injection.
 * 3. Asset discovery, strictAssets vs non-strict error behavior, and includeAssets bypass.
 * 4. Structural validation of PK zip magic headers, local headers, and central directory records.
 * 5. Comprehensive leak prevention for builder metadata (_meta, _revyme, _*) and secrets (.env*).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { Snapshot } from '../../src/contracts';
import { createSnapshot, createOperationContext } from '../../src/session';
import '../../src/index';

import {
  exportFormatsOperation,
  exportGenerateOperation,
  normalizeExportFormat,
} from '../../src/operations/export';
import { projectFS, MAIN_BRANCH_ID } from '@/code/project/project-fs';
import {
  isBuilderMetadataPath,
  isSecretEnvFile,
} from '@/code/project/source-export';

const BASE_PAGE_CODE = `'use client';
import React from 'react';

/** @canvas { "viewports": [ { "id": "desktop", "label": "Desktop", "width": 1200, "height": "auto", "isPrimary": true, "order": 0 } ], "positions": { "desktop": { "x": 0, "y": 0 } } } */

export default function HomePage() {
  return (
    <div data-id="root" style={{ width: '100%', minHeight: '100vh', padding: '24px' }}>
      <h1 data-id="h1">Home</h1>
    </div>
  );
}
`;

const BASE_LAYOUT_CODE = `import React from 'react';

export const metadata = {
  title: 'Test Site',
  description: 'Adversarial Test Site',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`;

function createMockSnapshot(files: Record<string, string>, revision = 1): Snapshot {
  return createSnapshot({ projectId: 'adversarial-project', branchId: 'main' }, revision, files);
}

/**
 * Helper to parse a zip buffer and inspect central directory headers and local headers
 */
interface ParsedZipEntry {
  filename: string;
  compressedSize: number;
  uncompressedSize: number;
  crc32: number;
  offset: number;
}

function inspectZipBuffer(buffer: Buffer): {
  hasValidLocalMagic: boolean;
  hasValidEocd: boolean;
  entryCount: number;
  entries: ParsedZipEntry[];
} {
  // Check local header magic (first 4 bytes: 0x50, 0x4B, 0x03, 0x04)
  const hasValidLocalMagic = buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50;

  // Search backwards for End of Central Directory (0x50, 0x4B, 0x05, 0x06 -> 0x06054b50)
  let eocdOffset = -1;
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    return { hasValidLocalMagic, hasValidEocd: false, entryCount: 0, entries: [] };
  }

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const _cdSize = buffer.readUInt32LE(eocdOffset + 12);
  const cdOffset = buffer.readUInt32LE(eocdOffset + 16);

  const entries: ParsedZipEntry[] = [];
  let currentOffset = cdOffset;

  for (let idx = 0; idx < entryCount; idx++) {
    if (currentOffset + 46 > buffer.length) break;
    const magic = buffer.readUInt32LE(currentOffset);
    if (magic !== 0x02014b50) break; // central directory header signature

    const crc = buffer.readUInt32LE(currentOffset + 16);
    const compSize = buffer.readUInt32LE(currentOffset + 20);
    const uncompSize = buffer.readUInt32LE(currentOffset + 24);
    const nameLen = buffer.readUInt16LE(currentOffset + 28);
    const extraLen = buffer.readUInt16LE(currentOffset + 30);
    const commentLen = buffer.readUInt16LE(currentOffset + 32);
    const localHeaderOffset = buffer.readUInt32LE(currentOffset + 42);

    const filename = buffer.toString('utf8', currentOffset + 46, currentOffset + 46 + nameLen);
    entries.push({
      filename,
      compressedSize: compSize,
      uncompressedSize: uncompSize,
      crc32: crc,
      offset: localHeaderOffset,
    });

    currentOffset += 46 + nameLen + extraLen + commentLen;
  }

  return {
    hasValidLocalMagic,
    hasValidEocd: true,
    entryCount,
    entries,
  };
}

describe('T23 Empirical Challenger: Source Export & SSG Stress Test', () => {
  const context = createOperationContext();

  beforeEach(() => {
    projectFS.loadSnapshot(
      new Map([
        ['app/layout.tsx', BASE_LAYOUT_CODE],
        ['app/page.client.tsx', BASE_PAGE_CODE],
      ]),
    );
    projectFS.switchBranch(MAIN_BRANCH_ID);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Challenge Group 1: Corrupted, Invalid, and Boundary Export Format Names
  // ───────────────────────────────────────────────────────────────────────────
  describe('1. Corrupted & Unsupported Export Formats', () => {
    it('rejects unsupported and corrupted format strings with explicit error', async () => {
      const corruptedFormats = [
        'tar.gz',
        '7z',
        'bzip2',
        'unknown_format_xyz',
        'wordpress',
        'gatsby',
        'remix',
        '../malicious-format',
        '../../format',
        'format/with/slashes',
        'format\0nullbyte',
        '12345',
        'null',
        'undefined',
      ];

      const snapshot = createMockSnapshot({
        'app/layout.tsx': BASE_LAYOUT_CODE,
        'app/page.client.tsx': BASE_PAGE_CODE,
      });

      for (const fmt of corruptedFormats) {
        await expect(
          exportGenerateOperation.execute(snapshot, { format: fmt as unknown as 'nextjs' }, context),
          `Format "${fmt}" should be rejected`,
        ).rejects.toThrow(/UNSUPPORTED_EXPORT_FORMAT/i);
      }
    });

    it('rejects prototype pollution attempts in format names', async () => {
      const protoAttacks = ['__proto__', 'constructor', 'prototype', 'toString', 'valueOf'];
      const snapshot = createMockSnapshot({
        'app/layout.tsx': BASE_LAYOUT_CODE,
        'app/page.client.tsx': BASE_PAGE_CODE,
      });

      for (const fmt of protoAttacks) {
        await expect(
          exportGenerateOperation.execute(snapshot, { format: fmt as unknown as 'nextjs' }, context),
        ).rejects.toThrow(/UNSUPPORTED_EXPORT_FORMAT/i);
      }
    });

    it('rejects tailwind with informative Cloud compiler 501 notice', async () => {
      const snapshot = createMockSnapshot({
        'app/layout.tsx': BASE_LAYOUT_CODE,
        'app/page.client.tsx': BASE_PAGE_CODE,
      });

      await expect(
        exportGenerateOperation.execute(snapshot, { format: 'tailwind' }, context),
      ).rejects.toThrow(/requires the Revyme Cloud compiler service \(501 \/ Phase 2\)/i);

      await expect(
        exportGenerateOperation.execute(snapshot, { format: 'nextjs-tailwind' as unknown as 'tailwind' }, context),
      ).rejects.toThrow(/requires the Revyme Cloud compiler service \(501 \/ Phase 2\)/i);
    });

    it('normalizes case variations and whitespace for valid formats', () => {
      expect(normalizeExportFormat('  NEXTJS  ')).toBe('nextjs');
      expect(normalizeExportFormat('Next.js-dynamic'.replace('.', ''))).toBe('nextjs');
      expect(normalizeExportFormat('SSG')).toBe('ssg');
      expect(normalizeExportFormat('\tstatic\n')).toBe('static');
      expect(normalizeExportFormat('Vite')).toBe('vite');
    });

    it('correctly maps all known aliases to their canonical export formats', async () => {
      const aliasMatrix: Record<string, 'nextjs' | 'ssg' | 'static' | 'vite'> = {
        'source': 'nextjs',
        'nextjs-dynamic': 'nextjs',
        'next': 'nextjs',
        'source-ssg': 'ssg',
        'nextjs-ssg': 'ssg',
        'static-site': 'ssg',
        'html-zip': 'static',
        'html': 'static',
        'html-css': 'static',
        'vite': 'vite',
        'vite-react': 'vite',
      };

      const snapshot = createMockSnapshot({
        'app/layout.tsx': BASE_LAYOUT_CODE,
        'app/page.client.tsx': BASE_PAGE_CODE,
      });

      for (const [alias, expectedCanonical] of Object.entries(aliasMatrix)) {
        const result = await exportGenerateOperation.execute(
          snapshot,
          { format: alias as unknown as 'nextjs', archiveType: 'files' },
          context,
        );
        expect(result.format).toBe(expectedCanonical);
      }
    });

    it('handles format enumeration filtering edge cases in export.formats', async () => {
      const snapshot = createMockSnapshot({});

      // Filter by unsupported status
      const unsupported = await exportFormatsOperation.execute(snapshot, { status: 'unsupported' }, context);
      expect(unsupported.formats.length).toBeGreaterThan(0);
      expect(unsupported.formats.every((f) => f.status === 'unsupported')).toBe(true);
      expect(unsupported.formats.some((f) => f.id === 'tailwind')).toBe(true);

      // Filter by experimental status
      const experimental = await exportFormatsOperation.execute(snapshot, { status: 'experimental' }, context);
      expect(experimental.formats.every((f) => f.status === 'experimental')).toBe(true);
      expect(experimental.formats.some((f) => f.id === 'vite')).toBe(true);

      // Plan tier filtering
      const freeTier = await exportFormatsOperation.execute(snapshot, { planTier: 'free' }, context);
      expect(freeTier.formats.every((f) => f.minPlan === 'free')).toBe(true);
      expect(freeTier.formats.some((f) => f.id === 'tailwind')).toBe(false);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Challenge Group 2: Malicious Paths & Path Traversal (Zip Slip / Injection)
  // ───────────────────────────────────────────────────────────────────────────
  describe('2. Path Traversal & Path Injection Resilience', () => {
    it('empirically audits directory traversal paths in snapshot files', async () => {
      const snapshot = createMockSnapshot({
        'app/layout.tsx': BASE_LAYOUT_CODE,
        'app/page.client.tsx': BASE_PAGE_CODE,
        '../../etc/passwd': 'root:x:0:0:root:/root:/bin/bash',
        '../malicious.sh': 'rm -rf /',
        'app/../../secret.txt': 'injected-outside',
        '/absolute/path/file.txt': 'absolute-root',
      });

      const result = await exportGenerateOperation.execute(
        snapshot,
        { format: 'nextjs', outputType: 'both' },
        context,
      );

      // Inspect manifest paths
      const manifestPaths = result.manifest.map((m) => m.path);
      const traversalEntries = manifestPaths.filter((p) => p.includes('..'));
      expect(traversalEntries.length).toBeGreaterThan(0);

      // Also inspect central directory inside the zip archive
      const zipBuffer = Buffer.from(result.archiveBase64!, 'base64');
      const zipInspection = inspectZipBuffer(zipBuffer);
      const zipFilenames = zipInspection.entries.map((e) => e.filename);
      const zipTraversal = zipFilenames.filter((n) => n.includes('..'));

      // If paths containing ".." make it into the zip, unzipping on a client machine is a Zip Slip attack!
      // Here we document the exact empirical behavior.
      expect(result.fileCount).toBeGreaterThan(0);
      expect(zipInspection.hasValidEocd).toBe(true);

      // Check whether root slash is stripped in the zip entries
      const absoluteEntry = zipFilenames.find((n) => n.startsWith('/'));
      expect(absoluteEntry, 'Zip entry paths must never start with a leading slash').toBeUndefined();

      // Check whether directory traversal entries are sanitized or present
      // Empirical finding: zipEntries retains relative path traversal segments ("..") from snapshot files!
      expect(zipTraversal).toContain('../../etc/passwd');
      expect(zipTraversal).toContain('../malicious.sh');
      expect(zipTraversal).toContain('app/../../secret.txt');
    });

    it('empirically verifies path normalization of Windows-style backslashes in .env detection', () => {
      expect(isSecretEnvFile('config\\.env')).toBe(true);
      expect(isSecretEnvFile('nested\\sub\\.env.local')).toBe(true);
      expect(isSecretEnvFile('.env.production')).toBe(true);
      expect(isSecretEnvFile('.env.example')).toBe(false);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Challenge Group 3: Missing Assets under strictAssets vs Non-Strict Mode
  // ───────────────────────────────────────────────────────────────────────────
  describe('3. Asset Resolution: strictAssets vs Non-Strict Mode', () => {
    const PAGE_WITH_MISSING_UPLOADS = `'use client';
import React from 'react';

export default function AssetPage() {
  return (
    <div data-id="root">
      <img data-id="img1" src="/uploads/missing-hero-999.png" alt="Missing Hero" />
      <img data-id="img2" src="/api/uploads/missing-avatar-404.jpg" alt="Missing Avatar" />
    </div>
  );
}
`;

    const PAGE_WITH_MISSING_PUBLIC_ASSETS = `'use client';
import React from 'react';

export default function FontsPage() {
  return (
    <div data-id="root" style={{ backgroundImage: "url('/images/background-pattern.svg')" }}>
      <link rel="stylesheet" href="/fonts/custom-font.woff2" />
      <img data-id="brand-logo" src="/images/brand-vector.svg" alt="Brand" />
    </div>
  );
}
`;

    it('tolerates missing assets in non-strict mode and reports them in diagnostics', async () => {
      const snapshot = createMockSnapshot({
        'app/layout.tsx': BASE_LAYOUT_CODE,
        'app/page.client.tsx': PAGE_WITH_MISSING_UPLOADS,
      });

      const result = await exportGenerateOperation.execute(
        snapshot,
        { format: 'nextjs', strictAssets: false, archiveType: 'files' },
        context,
      );

      expect(result.diagnostics.missingAssets).toBeDefined();
      expect(result.diagnostics.missingAssets.length).toBe(2);
      expect(result.diagnostics.missingAssets).toContain('uploads/missing-hero-999.png');
      expect(result.diagnostics.missingAssets).toContain('uploads/missing-avatar-404.jpg');

      // The export itself succeeded and generated files
      expect(result.files).toBeDefined();
      expect(result.files!['app/page.client.tsx']).toBeDefined();
      // But the missing assets are NOT in the files map
      expect(result.files!['public/uploads/missing-hero-999.png']).toBeUndefined();
    });

    it('rejects with MISSING_EXPORT_ASSETS in strictAssets: true mode for missing uploads', async () => {
      const snapshot = createMockSnapshot({
        'app/layout.tsx': BASE_LAYOUT_CODE,
        'app/page.client.tsx': PAGE_WITH_MISSING_UPLOADS,
      });

      await expect(
        exportGenerateOperation.execute(
          snapshot,
          { format: 'nextjs', strictAssets: true },
          context,
        ),
      ).rejects.toThrow(/MISSING_EXPORT_ASSETS/i);
    });

    it('rejects with MISSING_EXPORT_ASSETS in strictAssets: true mode for missing public fonts & images', async () => {
      const snapshot = createMockSnapshot({
        'app/layout.tsx': BASE_LAYOUT_CODE,
        'app/page.client.tsx': PAGE_WITH_MISSING_PUBLIC_ASSETS,
      });

      let caughtError: Error | null = null;
      try {
        await exportGenerateOperation.execute(
          snapshot,
          { format: 'nextjs', strictAssets: true },
          context,
        );
      } catch (err: unknown) {
        caughtError = err instanceof Error ? err : new Error(String(err));
      }

      expect(caughtError).not.toBeNull();
      expect(caughtError?.message).toMatch(/MISSING_EXPORT_ASSETS/i);
      expect(caughtError?.message).toMatch(/images\/background-pattern\.svg|fonts\/custom-font\.woff2|images\/brand-vector\.svg/);
    });

    it('succeeds in strictAssets: true mode when all referenced assets exist in project', async () => {
      const PAGE_WITH_EXISTING_ASSETS = `'use client';
import React from 'react';

export default function GoodPage() {
  return (
    <div data-id="root">
      <img data-id="hero" src="/uploads/valid-hero.png" alt="Hero" />
      <img data-id="logo" src="/images/logo.svg" alt="Logo" />
    </div>
  );
}
`;

      const snapshot = createMockSnapshot({
        'app/layout.tsx': BASE_LAYOUT_CODE,
        'app/page.client.tsx': PAGE_WITH_EXISTING_ASSETS,
        'uploads/valid-hero.png': 'FAKED_PNG_BINARY_CONTENT',
        'public/images/logo.svg': '<svg></svg>',
      });

      const result = await exportGenerateOperation.execute(
        snapshot,
        { format: 'nextjs', strictAssets: true, archiveType: 'files' },
        context,
      );

      expect(result.diagnostics.missingAssets).toEqual([]);
      expect(result.files).toBeDefined();
      expect(result.files!['public/uploads/valid-hero.png']).toBeDefined();
      expect(result.files!['public/api/uploads/valid-hero.png']).toBeDefined();
      expect(result.files!['public/images/logo.svg']).toBeDefined();
    });

    it('bypasses asset verification when includeAssets: false even if strictAssets: true', async () => {
      const snapshot = createMockSnapshot({
        'app/layout.tsx': BASE_LAYOUT_CODE,
        'app/page.client.tsx': PAGE_WITH_MISSING_UPLOADS,
      });

      const result = await exportGenerateOperation.execute(
        snapshot,
        { format: 'nextjs', includeAssets: false, strictAssets: true, archiveType: 'files' },
        context,
      );

      expect(result.diagnostics.missingAssets).toEqual([]);
      expect(result.totalFiles).toBeGreaterThan(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Challenge Group 4: PK Zip Magic Header & Structure Verification
  // ───────────────────────────────────────────────────────────────────────────
  describe('4. PK Zip Magic Bytes & Archive Structure', () => {
    it('produces valid PK0304 local header and PK0506 central directory in base64 zip', async () => {
      const snapshot = createMockSnapshot({
        'app/layout.tsx': BASE_LAYOUT_CODE,
        'app/page.client.tsx': BASE_PAGE_CODE,
        'app/about/page.client.tsx': BASE_PAGE_CODE.replace('Home', 'About'),
        'public/robots.txt': 'User-agent: *\nDisallow:',
      });

      const result = await exportGenerateOperation.execute(
        snapshot,
        { format: 'nextjs', archiveType: 'base64' },
        context,
      );

      expect(result.archiveBase64).toBeDefined();
      const zipBuffer = Buffer.from(result.archiveBase64!, 'base64');

      // 1. Check local file header magic: 0x04034b50 (PK\x03\x04)
      expect(zipBuffer.length).toBeGreaterThan(100);
      expect(zipBuffer.readUInt32LE(0)).toBe(0x04034b50);

      // 2. Inspect ZIP structure via Central Directory parser
      const inspection = inspectZipBuffer(zipBuffer);
      expect(inspection.hasValidLocalMagic).toBe(true);
      expect(inspection.hasValidEocd).toBe(true);
      expect(inspection.entryCount).toBe(result.manifest.length);
      expect(inspection.entries.length).toBe(result.manifest.length);

      // 3. Verify that every entry recorded in manifest exists in ZIP central directory
      const manifestPaths = new Set(result.manifest.map((m) => m.path));
      for (const entry of inspection.entries) {
        expect(manifestPaths.has(entry.filename), `ZIP entry "${entry.filename}" should be in manifest`).toBe(true);
        // Verify CRC32 is non-zero for non-empty files
        if (entry.uncompressedSize > 0) {
          expect(entry.crc32).not.toBe(0);
        }
      }
    });

    it('assembles a large archive with 50+ files without header or size corruption', async () => {
      const largeFileSet: Record<string, string> = {
        'app/layout.tsx': BASE_LAYOUT_CODE,
        'app/page.client.tsx': BASE_PAGE_CODE,
      };

      for (let i = 1; i <= 50; i++) {
        largeFileSet[`app/sub-${i}/page.client.tsx`] = BASE_PAGE_CODE.replace('Home', `SubPage-${i}`);
        largeFileSet[`components/widget-${i}.tsx`] = `export function Widget${i}() { return <div>W${i}</div>; }`;
      }

      const snapshot = createMockSnapshot(largeFileSet);
      const result = await exportGenerateOperation.execute(
        snapshot,
        { format: 'nextjs', archiveType: 'zip' },
        context,
      );

      expect(result.totalFiles).toBeGreaterThanOrEqual(102);
      expect(result.archiveBase64).toBeDefined();

      const zipBuffer = Buffer.from(result.archiveBase64!, 'base64');
      const inspection = inspectZipBuffer(zipBuffer);
      expect(inspection.hasValidEocd).toBe(true);
      expect(inspection.entryCount).toBe(result.totalFiles);
      expect(inspection.entries.length).toBe(result.totalFiles);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Challenge Group 5: Strict Internal Files & Secrets Leakage Prevention
  // ───────────────────────────────────────────────────────────────────────────
  describe('5. Exclusion of Internal Builder Metadata & Secrets', () => {
    it('strictly prevents leakage of all _meta and _revyme files into zip and manifest', async () => {
      const snapshot = createMockSnapshot({
        'app/layout.tsx': BASE_LAYOUT_CODE,
        'app/page.client.tsx': BASE_PAGE_CODE,
        '_meta/secrets/api-keys.json': JSON.stringify({ key: 'sk_live_123456789' }),
        '_meta/deployments.json': JSON.stringify({ deployments: [{ id: 'd1', target: 'vercel' }] }),
        '_meta/history.json': JSON.stringify({ undo: [], redo: [] }),
        '_meta/cms-api-config.json': JSON.stringify({ apiCollections: {} }),
        '_meta/comments.json': JSON.stringify([{ id: 'c1', text: 'Internal comment' }]),
        '_meta/plugins/plugin-data.json': JSON.stringify({ installed: ['plugin-1'] }),
        '_revyme/draft-session.json': JSON.stringify({ active: true, user: 'admin' }),
        '_revyme/undo.json': JSON.stringify({ steps: [] }),
        '_internal/internal-notes.txt': 'CONFIDENTIAL',
        '_custom_top_level_internal/data.json': '{}',
      });

      const result = await exportGenerateOperation.execute(
        snapshot,
        { format: 'nextjs', outputType: 'both' },
        context,
      );

      const files = result.files!;
      const manifestPaths = result.manifest.map((m) => m.path);
      const zipBuffer = Buffer.from(result.archiveBase64!, 'base64');
      const inspection = inspectZipBuffer(zipBuffer);
      const zipFilenames = inspection.entries.map((e) => e.filename);

      const sensitivePrefixes = ['_meta/', '_revyme/', '_internal/', '_custom_top_level_internal/'];

      for (const prefix of sensitivePrefixes) {
        // Check files map
        for (const path of Object.keys(files)) {
          expect(path.startsWith(prefix), `Path "${path}" leaked into filesMap`).toBe(false);
        }
        // Check manifest
        for (const path of manifestPaths) {
          expect(path.startsWith(prefix), `Path "${path}" leaked into manifest`).toBe(false);
        }
        // Check actual ZIP central directory
        for (const path of zipFilenames) {
          expect(path.startsWith(prefix), `Path "${path}" leaked into zip archive`).toBe(false);
        }
      }
    });

    it('strictly prevents leakage of all sensitive .env variants', async () => {
      const secretEnvMap: Record<string, string> = {
        'app/layout.tsx': BASE_LAYOUT_CODE,
        'app/page.client.tsx': BASE_PAGE_CODE,
        '.env': 'DATABASE_URL=postgres://root:topsecret@localhost/db\nAPI_KEY=key_123',
        '.env.local': 'JWT_SECRET=super_secret_jwt_signature',
        '.env.production': 'AWS_SECRET_ACCESS_KEY=AKIAIOSFODNN7EXAMPLE',
        '.env.development': 'LOCAL_TOKEN=dev_token',
        '.env.test': 'TEST_SECRET=test_secret',
        '.env.staging': 'STAGING_TOKEN=staging_val',
        '.env.production.local': 'PROD_OVERRIDE=xyz',
        'nested/.env': 'NESTED_SECRET=nested_val',
        'sub/folder/.env.local': 'DEEP_SECRET=deep_val',
      };

      const snapshot = createMockSnapshot(secretEnvMap);
      const result = await exportGenerateOperation.execute(
        snapshot,
        { format: 'nextjs', outputType: 'both', includeEnvExample: true },
        context,
      );

      const files = result.files!;
      const manifestPaths = result.manifest.map((m) => m.path);
      const zipBuffer = Buffer.from(result.archiveBase64!, 'base64');
      const inspection = inspectZipBuffer(zipBuffer);
      const zipFilenames = inspection.entries.map((e) => e.filename);

      // Verify no sensitive .env file is present
      for (const envPath of Object.keys(secretEnvMap)) {
        if (envPath.startsWith('app/')) continue;
        expect(files[envPath], `File "${envPath}" should not be in files map`).toBeUndefined();
        expect(manifestPaths).not.toContain(envPath);
        expect(zipFilenames).not.toContain(envPath);
      }

      // Verify that no secret value exists in ANY generated file
      const secretValues = [
        'topsecret',
        'super_secret_jwt_signature',
        'AKIAIOSFODNN7EXAMPLE',
        'nested_val',
        'deep_val',
      ];

      for (const [filePath, content] of Object.entries(files)) {
        for (const secret of secretValues) {
          expect(content.includes(secret), `Secret value "${secret}" leaked into "${filePath}"`).toBe(false);
        }
      }

      // Verify .env.example IS created and only contains variable keys
      expect(files['.env.example']).toBeDefined();
      const envExampleContent = files['.env.example'];
      expect(envExampleContent).toContain('DATABASE_URL=');
      expect(envExampleContent).toContain('API_KEY=');
      expect(envExampleContent).toContain('JWT_SECRET=');
      expect(envExampleContent).toContain('AWS_SECRET_ACCESS_KEY=');
      // Must not contain secret values
      expect(envExampleContent).not.toContain('topsecret');
      expect(envExampleContent).not.toContain('super_secret_jwt_signature');
    });

    it('empirically audits leading slash and relative dot evasion on internal metadata paths', async () => {
      // Testing whether leading slashes or relative segments could bypass isBuilderMetadataPath
      const snapshot = createMockSnapshot({
        'app/layout.tsx': BASE_LAYOUT_CODE,
        'app/page.client.tsx': BASE_PAGE_CODE,
        './_meta/evasion.json': '{"leaked": true}',
        '/_meta/evasion2.json': '{"leaked": true}',
      });

      const result = await exportGenerateOperation.execute(
        snapshot,
        { format: 'nextjs', archiveType: 'files' },
        context,
      );

      const files = result.files!;
      // Check whether './_meta/evasion.json' or '/_meta/evasion2.json' bypassed the check
      const leakedEvasion1 = files['./_meta/evasion.json'] !== undefined;
      const leakedEvasion2 = files['/_meta/evasion2.json'] !== undefined;

      // Empirical finding: leading './' or '/' bypasses isBuilderMetadataPath because
      // (path.split('/', 1)[0] ?? '').startsWith('_') expects clean unrooted paths!
      expect(isBuilderMetadataPath('./_meta/evasion.json')).toBe(false);
      expect(isBuilderMetadataPath('/_meta/evasion2.json')).toBe(false);
      expect(leakedEvasion1).toBe(true);
      expect(leakedEvasion2).toBe(true);
    });
  });
});
