// packages/automation-core/test/capabilities/T18-adversarial.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Snapshot, FileChange } from '../../src/contracts';
import { createSnapshot, createOperationContext, prepareOperation } from '../../src/session';
import {
  localesGetOperation,
  localesAddOperation,
  localesRemoveOperation,
  localesSetDefaultOperation,
  localesUpdateOperation,
  localesRoutesSyncOperation,
} from '../../src/operations/locales';
import { projectFS } from '@/code/project/project-fs';
import { RTL_LANGUAGES, isRtlLocale } from '@/shared/rtl-text';
import { LOCALE_ROUTE_MARKER } from '@/code/project/locale-route-ops';

const ROOT_PAGE_TSX = `// Hand-crafted server root component
import ClientHome from './page.client';

export const metadata = {
  title: 'My Custom App Root',
  description: 'Custom root metadata never to be overwritten',
};

export default function RootServerPage() {
  return <ClientHome />;
}
`;

const ROOT_PAGE_CLIENT = `'use client';
import React from 'react';

export default function HomePage() {
  return (
    <main data-id="main-root">
      <h1 data-id="heading">Hello World</h1>
    </main>
  );
}
`;

const NESTED_MARKETING_CLIENT = `'use client';
import React from 'react';

export default function MarketingPage() {
  return (
    <div data-id="mkt-root">
      <h1 data-id="mkt-heading">Marketing Campaign</h1>
    </div>
  );
}
`;

const DYNAMIC_POST_CLIENT = `'use client';
import React from 'react';

export default function PostPage({ params }: { params: { slug: string } }) {
  return (
    <article data-id="post-root">
      <h1 data-id="post-title">Blog Post</h1>
    </article>
  );
}
`;

function createMockSnapshot(files: Record<string, string>): Snapshot {
  return createSnapshot({ projectId: 'adversarial-t18', branchId: 'main' }, 0, files);
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

describe('T18 Adversarial Stress Test: RTL Direction & Route Syncing', () => {
  beforeEach(() => {
    for (const f of projectFS.listFiles()) {
      projectFS.deleteFile(f);
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. RTL Direction Invariants: ar, he, fa, ur and scripts
  // ───────────────────────────────────────────────────────────────────────────
  describe('1. RTL Locales Detection & Overrides', () => {
    it('detects all four primary RTL target locales (ar, he, fa, ur) as isRtl=true and direction=rtl', async () => {
      const targetRtl = ['ar', 'he', 'fa', 'ur'];

      for (const code of targetRtl) {
        expect(isRtlLocale(code)).toBe(true);
      }

      let snap = createMockSnapshot({});
      const mutableFiles = new Map<string, string>();

      for (const code of targetRtl) {
        const res = await localesAddOperation.execute(
          snap,
          { code, label: `Language ${code.toUpperCase()}` },
          mockContext,
        );
        expect(res.code).toBe(code);
        expect(res.isRtl).toBe(true);
        applyChanges(mutableFiles, res.changes);
        snap = createMockSnapshot(Object.fromEntries(mutableFiles));
      }

      const listRes = await localesGetOperation.execute(snap, {}, mockContext);
      for (const code of targetRtl) {
        const entry = listRes.locales.find((l) => l.code === code);
        expect(entry).toBeDefined();
        expect(entry?.isRtl).toBe(true);
        expect(entry?.direction).toBe('rtl');
      }
    });

    it('correctly handles regional subtags (ar-EG, he-IL, fa-IR, ur-PK) as RTL', async () => {
      const regionalRtl = ['ar-EG', 'he-IL', 'fa-IR', 'ur-PK'];

      for (const code of regionalRtl) {
        expect(isRtlLocale(code)).toBe(true);
      }

      let snap = createMockSnapshot({});
      const mutableFiles = new Map<string, string>();

      for (const code of regionalRtl) {
        const res = await localesAddOperation.execute(
          snap,
          { code, label: `Regional ${code}` },
          mockContext,
        );
        expect(res.code).toBe(code);
        expect(res.isRtl).toBe(true);
        applyChanges(mutableFiles, res.changes);
        snap = createMockSnapshot(Object.fromEntries(mutableFiles));
      }

      const listRes = await localesGetOperation.execute(snap, {}, mockContext);
      for (const code of regionalRtl) {
        const entry = listRes.locales.find((l) => l.code === code);
        expect(entry?.isRtl).toBe(true);
        expect(entry?.direction).toBe('rtl');
      }
    });

    it('honors explicit direction overrides (e.g. ar with direction=ltr, or en with direction=rtl)', async () => {
      let snap = createMockSnapshot({});
      const mutableFiles = new Map<string, string>();

      // Arabic forced to LTR
      const arLtrRes = await localesAddOperation.execute(
        snap,
        { code: 'ar', label: 'Arabic LTR Override', direction: 'ltr' },
        mockContext,
      );
      expect(arLtrRes.isRtl).toBe(false);
      applyChanges(mutableFiles, arLtrRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      let list = await localesGetOperation.execute(snap, {}, mockContext);
      let arEntry = list.locales.find((l) => l.code === 'ar');
      expect(arEntry?.direction).toBe('ltr');
      expect(arEntry?.isRtl).toBe(false);

      // English forced to RTL
      const enRtlRes = await localesAddOperation.execute(
        snap,
        { code: 'en-rtl', label: 'English RTL Mock', direction: 'rtl' },
        mockContext,
      );
      expect(enRtlRes.isRtl).toBe(true);
      applyChanges(mutableFiles, enRtlRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      list = await localesGetOperation.execute(snap, {}, mockContext);
      const enRtlEntry = list.locales.find((l) => l.code === 'en-rtl');
      expect(enRtlEntry?.direction).toBe('rtl');
      expect(enRtlEntry?.isRtl).toBe(true);

      // Now update Arabic back to RTL via locales.update
      const updateRes = await localesUpdateOperation.execute(
        snap,
        { code: 'ar', direction: 'rtl' },
        mockContext,
      );
      expect(updateRes.isRtl).toBe(true);
      applyChanges(mutableFiles, updateRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      list = await localesGetOperation.execute(snap, {}, mockContext);
      arEntry = list.locales.find((l) => l.code === 'ar');
      expect(arEntry?.direction).toBe('rtl');
      expect(arEntry?.isRtl).toBe(true);
    });

    it('validates all recognized RTL languages in shared/rtl-text', () => {
      for (const lang of RTL_LANGUAGES) {
        expect(isRtlLocale(lang)).toBe(true);
        expect(isRtlLocale(`${lang}-XX`)).toBe(true);
      }
      expect(isRtlLocale('en')).toBe(false);
      expect(isRtlLocale('uk')).toBe(false);
      expect(isRtlLocale('es')).toBe(false);
      expect(isRtlLocale(null)).toBe(false);
      expect(isRtlLocale(undefined)).toBe(false);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Route Syncing & Root page.tsx Invariant Protection
  // ───────────────────────────────────────────────────────────────────────────
  describe('2. Route Sync & Root app/page.tsx Preservation', () => {
    it('generates route wrappers without overwriting or deleting custom app/page.tsx', async () => {
      const files: Record<string, string> = {
        'app/page.tsx': ROOT_PAGE_TSX,
        'app/page.client.tsx': ROOT_PAGE_CLIENT,
        'app/(marketing)/campaign/page.client.tsx': NESTED_MARKETING_CLIENT,
        'app/posts/[slug]/page.client.tsx': DYNAMIC_POST_CLIENT,
      };

      let snap = createMockSnapshot(files);
      const mutableFiles = new Map<string, string>(Object.entries(files));

      // Add 4 RTL locales + 1 LTR locale
      const localesToAdd = [
        { code: 'ar', label: 'العربية' },
        { code: 'he', label: 'עברית' },
        { code: 'fa', label: 'فارسی' },
        { code: 'ur', label: 'اردو' },
        { code: 'fr', label: 'Français' },
      ];

      for (const loc of localesToAdd) {
        const res = await localesAddOperation.execute(snap, loc, mockContext);
        applyChanges(mutableFiles, res.changes);
        snap = createMockSnapshot(Object.fromEntries(mutableFiles));
      }

      // CRITICAL CHECK 1: Root app/page.tsx MUST NOT be modified!
      expect(mutableFiles.has('app/page.tsx')).toBe(true);
      expect(mutableFiles.get('app/page.tsx')).toBe(ROOT_PAGE_TSX);

      // Verify route wrappers were created for each locale
      for (const loc of localesToAdd) {
        const rootWrapper = `app/${loc.code}/page.tsx`;
        expect(mutableFiles.has(rootWrapper)).toBe(true);
        const rootContent = mutableFiles.get(rootWrapper)!;
        expect(rootContent).toContain(LOCALE_ROUTE_MARKER);
        expect(rootContent).toContain("export { default } from '@/app/page'");
        expect(rootContent).toContain(`canonical: '/${loc.code}'`);

        // Route group segment ordering check: app/(marketing)/<locale>/campaign/page.tsx
        const nestedWrapper = `app/(marketing)/${loc.code}/campaign/page.tsx`;
        expect(mutableFiles.has(nestedWrapper)).toBe(true);
        const nestedContent = mutableFiles.get(nestedWrapper)!;
        expect(nestedContent).toContain(LOCALE_ROUTE_MARKER);
        expect(nestedContent).toContain("export { default } from '@/app/(marketing)/campaign/page'");
        expect(nestedContent).toContain(`canonical: '/${loc.code}/campaign'`);

        // Dynamic route wrapper check: app/<locale>/posts/[slug]/page.tsx
        const dynamicWrapper = `app/${loc.code}/posts/[slug]/page.tsx`;
        expect(mutableFiles.has(dynamicWrapper)).toBe(true);
        const dynamicContent = mutableFiles.get(dynamicWrapper)!;
        expect(dynamicContent).toContain(LOCALE_ROUTE_MARKER);
        expect(dynamicContent).toContain("export { default } from '@/app/posts/[slug]/page'");
      }

      // Re-run explicit route sync operation
      const syncRes = await localesRoutesSyncOperation.execute(snap, {}, mockContext);
      applyChanges(mutableFiles, syncRes.changes);

      // CRITICAL CHECK 2: Idempotent sync must not touch root app/page.tsx
      expect(mutableFiles.get('app/page.tsx')).toBe(ROOT_PAGE_TSX);
      expect(syncRes.written).toHaveLength(0);
      expect(syncRes.removed).toHaveLength(0);
    });

    it('avoids collision when a real page matches a locale name (e.g. app/fr/page.client.tsx)', async () => {
      const CUSTOM_FR_PAGE_TSX = '// Real custom French server component\nexport default function FrPage() {}';
      const files: Record<string, string> = {
        'app/page.client.tsx': ROOT_PAGE_CLIENT,
        'app/fr/page.client.tsx': `'use client'; export default function FrClient() {}`,
        'app/fr/page.tsx': CUSTOM_FR_PAGE_TSX,
      };

      let snap = createMockSnapshot(files);
      const mutableFiles = new Map<string, string>(Object.entries(files));

      // Add 'fr' locale
      const res = await localesAddOperation.execute(
        snap,
        { code: 'fr', label: 'Français' },
        mockContext,
      );
      applyChanges(mutableFiles, res.changes);

      // Collision guard should have preserved the real French page!
      expect(mutableFiles.get('app/fr/page.tsx')).toBe(CUSTOM_FR_PAGE_TSX);
      expect(mutableFiles.get('app/fr/page.tsx')).not.toContain(LOCALE_ROUTE_MARKER);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Orphan Locale Route Cleanup
  // ───────────────────────────────────────────────────────────────────────────
  describe('3. Orphan Route Cleanup on Locale Removal and Default Switch', () => {
    it('prunes all route wrappers and overrides when a locale is removed', async () => {
      const files: Record<string, string> = {
        'app/page.tsx': ROOT_PAGE_TSX,
        'app/page.client.tsx': ROOT_PAGE_CLIENT,
        'app/(marketing)/about/page.client.tsx': NESTED_MARKETING_CLIENT,
      };

      let snap = createMockSnapshot(files);
      const mutableFiles = new Map<string, string>(Object.entries(files));

      // Add Arabic and Hebrew
      const addAr = await localesAddOperation.execute(snap, { code: 'ar', label: 'العربية' }, mockContext);
      applyChanges(mutableFiles, addAr.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      const addHe = await localesAddOperation.execute(snap, { code: 'he', label: 'עבריت' }, mockContext);
      applyChanges(mutableFiles, addHe.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      expect(mutableFiles.has('app/ar/page.tsx')).toBe(true);
      expect(mutableFiles.has('app/(marketing)/ar/about/page.tsx')).toBe(true);
      expect(mutableFiles.has('i18n/ar.json')).toBe(true);
      expect(mutableFiles.has('app/he/page.tsx')).toBe(true);

      // Remove Arabic
      const removeAr = await localesRemoveOperation.execute(snap, { code: 'ar' }, mockContext);
      applyChanges(mutableFiles, removeAr.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      // Assert Arabic wrappers and overrides are gone
      expect(mutableFiles.has('app/ar/page.tsx')).toBe(false);
      expect(mutableFiles.has('app/(marketing)/ar/about/page.tsx')).toBe(false);
      expect(mutableFiles.has('i18n/ar.json')).toBe(false);

      // Assert removal changes were accurately recorded
      const arChanges = removeAr.changes.map((c) => ({ path: c.path, deleted: c.content === null }));
      expect(arChanges).toContainEqual({ path: 'app/ar/page.tsx', deleted: true });
      expect(arChanges).toContainEqual({ path: 'app/(marketing)/ar/about/page.tsx', deleted: true });
      expect(arChanges).toContainEqual({ path: 'i18n/ar.json', deleted: true });

      // Assert Hebrew wrappers and root page remain intact
      expect(mutableFiles.has('app/he/page.tsx')).toBe(true);
      expect(mutableFiles.has('app/(marketing)/he/about/page.tsx')).toBe(true);
      expect(mutableFiles.get('app/page.tsx')).toBe(ROOT_PAGE_TSX);
    });

    it('prunes newly default locale wrappers and generates old default wrappers on setDefault', async () => {
      const files: Record<string, string> = {
        'app/page.tsx': ROOT_PAGE_TSX,
        'app/page.client.tsx': ROOT_PAGE_CLIENT,
      };

      let snap = createMockSnapshot(files);
      const mutableFiles = new Map<string, string>(Object.entries(files));

      const addFa = await localesAddOperation.execute(snap, { code: 'fa', label: 'فارسی' }, mockContext);
      applyChanges(mutableFiles, addFa.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      // Initially default is en: fa has wrapper, en has NO wrapper
      expect(mutableFiles.has('app/fa/page.tsx')).toBe(true);
      expect(mutableFiles.has('app/en/page.tsx')).toBe(false);
      expect(mutableFiles.get('app/page.tsx')).toBe(ROOT_PAGE_TSX);

      // Switch default to 'fa'
      const setDefaultFa = await localesSetDefaultOperation.execute(snap, { code: 'fa' }, mockContext);
      applyChanges(mutableFiles, setDefaultFa.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      // Now default is fa:
      // - fa wrapper must be pruned!
      // - en wrapper must be created!
      // - root app/page.tsx must remain untouched!
      expect(mutableFiles.has('app/fa/page.tsx')).toBe(false);
      expect(mutableFiles.has('app/en/page.tsx')).toBe(true);
      expect(mutableFiles.get('app/page.tsx')).toBe(ROOT_PAGE_TSX);

      const enWrapper = mutableFiles.get('app/en/page.tsx')!;
      expect(enWrapper).toContain(LOCALE_ROUTE_MARKER);
      expect(enWrapper).toContain("export { default } from '@/app/page'");
    });

    it('never removes non-marker files in app/ during route sync', async () => {
      const files: Record<string, string> = {
        'app/page.tsx': ROOT_PAGE_TSX,
        'app/page.client.tsx': ROOT_PAGE_CLIENT,
        'app/custom-helper/page.tsx': '// Not a locale route wrapper\nexport default function Helper() {}',
      };

      let snap = createMockSnapshot(files);
      const mutableFiles = new Map<string, string>(Object.entries(files));

      const syncRes = await localesRoutesSyncOperation.execute(snap, {}, mockContext);
      applyChanges(mutableFiles, syncRes.changes);

      expect(mutableFiles.has('app/custom-helper/page.tsx')).toBe(true);
      expect(mutableFiles.has('app/page.tsx')).toBe(true);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Edge Cases and Input Boundaries
  // ───────────────────────────────────────────────────────────────────────────
  describe('4. Input Validation & Boundary Failures', () => {
    it('rejects invalid locale codes (e.g. symbols, numbers-only, too long) via schema validation', async () => {
      const snap = createMockSnapshot({});

      const res1 = await prepareOperation(snap, 'locales.add', { code: 'invalid_code!', label: 'Bad' });
      expect(res1.ok).toBe(false);
      expect(res1.error?.code).toBe('SCHEMA_VALIDATION_FAILED');

      const res2 = await prepareOperation(snap, 'locales.add', { code: '123', label: 'Bad Num' });
      expect(res2.ok).toBe(false);

      const res3 = await prepareOperation(snap, 'locales.add', { code: '', label: 'Empty' });
      expect(res3.ok).toBe(false);
    });

    it('rejects empty labels via schema validation', async () => {
      const snap = createMockSnapshot({});
      const res = await prepareOperation(snap, 'locales.add', { code: 'es', label: '' });
      expect(res.ok).toBe(false);
      expect(res.error?.code).toBe('SCHEMA_VALIDATION_FAILED');
      expect(res.error?.issues[0]?.message).toMatch(/Label cannot be empty/i);
    });

    it('rejects removing the default locale', async () => {
      const snap = createMockSnapshot({});
      await expect(
        localesRemoveOperation.execute(snap, { code: 'en' }, mockContext),
      ).rejects.toThrow(/cannot remove the default locale/i);
    });

    it('rejects removing an unconfigured locale', async () => {
      const snap = createMockSnapshot({});
      await expect(
        localesRemoveOperation.execute(snap, { code: 'xx' }, mockContext),
      ).rejects.toThrow(/is not configured/i);
    });

    it('rejects setting default to an unconfigured locale', async () => {
      const snap = createMockSnapshot({});
      await expect(
        localesSetDefaultOperation.execute(snap, { code: 'xx' }, mockContext),
      ).rejects.toThrow(/is not configured/i);
    });

    it('rejects updating an unconfigured locale', async () => {
      const snap = createMockSnapshot({});
      await expect(
        localesUpdateOperation.execute(snap, { code: 'xx', label: 'Nope' }, mockContext),
      ).rejects.toThrow(/is not configured/i);
    });
  });
});
