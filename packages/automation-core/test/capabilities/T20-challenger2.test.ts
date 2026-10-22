// packages/automation-core/test/capabilities/T20-challenger2.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Snapshot } from '../../src/contracts';
import { createSnapshot, createOperationContext } from '../../src/session';
import { defaultRegistry } from '../../src/registry';
import {
  overridesCreateOperation,
  overridesListOperation,
  overridesSetOperation,
  overridesRemoveOperation,
} from '../../src/operations/overrides';
import {
  customCodeGetOperation,
  customCodeSetOperation,
  CUSTOM_CODE_FILE,
} from '../../src/operations/custom-code';
import {
  redirectsListOperation,
  redirectsAddOperation,
  redirectsRemoveOperation,
  redirectsReorderOperation,
  REDIRECTS_FILE,
} from '../../src/operations/redirects';
import { projectFS } from '@/code/project/project-fs';

const COMPLEX_PAGE_JSX = `'use client';
import React from 'react';
import { withResponsiveProps } from '@revyme/runtime';

export default function ComplexPage() {
  return (
    <div data-id="page-root" style={{ width: '100%', minHeight: '100vh', padding: '32px' }}>
      <header data-id="site-header">
        <h1 data-id="main-heading">Adversarial Testing</h1>
        <nav data-id="nav-bar">
          <a data-id="nav-link-1" href="/features">Features</a>
          <a data-id="nav-link-2" href="/pricing">Pricing</a>
        </nav>
      </header>
      <main data-id="content-container">
        <section data-id="hero-section">
          <p data-id="hero-desc">Testing code overrides and redirects robustness.</p>
          <img data-id="hero-image" src="/banner.png" alt="Banner" />
          <button data-id="primary-btn" type="button">Get Started</button>
        </section>
      </main>
    </div>
  );
}
`;

function createMockSnapshot(files: Record<string, string>): Snapshot {
  return createSnapshot({ projectId: 'adversarial-project', branchId: 'main' }, 0, files);
}

describe('T20 Challenger 2: Adversarial Suite for Overrides, Custom Code, and Redirects', () => {
  const context = createOperationContext();

  beforeEach(() => {
    for (const f of projectFS.listFiles()) {
      projectFS.deleteFile(f);
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Adversarial Overrides (create & set)
  // ───────────────────────────────────────────────────────────────────────────
  describe('1. Adversarial Overrides Verification', () => {
    describe('overrides.create', () => {
      it('rejects override files without any withX HOC exports', async () => {
        const snap = createMockSnapshot({});

        // Case A: purely helper function
        const onlyHelper = `export function calculatePadding() { return 16; }`;
        await expect(
          overridesCreateOperation.execute(snap, { name: 'CalcPadding', code: onlyHelper }, context),
        ).rejects.toThrow(/INVALID_OVERRIDE/);

        // Case B: empty file or no exports
        const noExports = `const secret = 42; console.log(secret);`;
        await expect(
          overridesCreateOperation.execute(snap, { name: 'NoExports', code: noExports }, context),
        ).rejects.toThrow(/INVALID_OVERRIDE/);

        // Case C: function name starting with "with" but lowercase next character (e.g. withoutSomething)
        const lowercaseNext = `export function withoutPrefix(Comp: any) { return Comp; }`;
        await expect(
          overridesCreateOperation.execute(snap, { name: 'WithoutPrefix', code: lowercaseNext }, context),
        ).rejects.toThrow(/INVALID_OVERRIDE/);
      });

      it('rejects override files with default export', async () => {
        const snap = createMockSnapshot({});

        // Case A: default export function
        const defaultFunc = `export default function withDefault(Comp: any) { return Comp; }`;
        await expect(
          overridesCreateOperation.execute(snap, { name: 'DefaultFunc', code: defaultFunc }, context),
        ).rejects.toThrow(/DEFAULT_EXPORT_FORBIDDEN/);

        // Case B: export default identifier
        const defaultIdent = `function withSomething(Comp: any) { return Comp; }\nexport default withSomething;`;
        await expect(
          overridesCreateOperation.execute(snap, { name: 'DefaultIdent', code: defaultIdent }, context),
        ).rejects.toThrow(/DEFAULT_EXPORT_FORBIDDEN/);
      });

      it('rejects invalid PascalCase file names via inputSchema and registry validation', async () => {
        const snap = createMockSnapshot({});
        const validCode = `export function withValid(Comp: any) { return Comp; }`;

        // camelCase
        expect(() => {
          overridesCreateOperation.inputSchema.parse({ name: 'withValid', code: validCode });
        }).toThrow(/PascalCase/);
        expect(defaultRegistry.validateInput('overrides.create', { name: 'withValid', code: validCode }).ok).toBe(false);

        // kebab-case
        expect(() => {
          overridesCreateOperation.inputSchema.parse({ name: 'with-valid' as any, code: validCode });
        }).toThrow(/PascalCase/);
        expect(defaultRegistry.validateInput('overrides.create', { name: 'with-valid', code: validCode }).ok).toBe(false);

        // snake_case
        expect(() => {
          overridesCreateOperation.inputSchema.parse({ name: 'With_Valid' as any, code: validCode });
        }).toThrow(/PascalCase/);
        expect(defaultRegistry.validateInput('overrides.create', { name: 'With_Valid', code: validCode }).ok).toBe(false);

        // Starting with digit
        expect(() => {
          overridesCreateOperation.inputSchema.parse({ name: '123Valid' as any, code: validCode });
        }).toThrow(/PascalCase/);
        expect(defaultRegistry.validateInput('overrides.create', { name: '123Valid', code: validCode }).ok).toBe(false);
      });

      it('rejects malformed syntax', async () => {
        const snap = createMockSnapshot({});
        const brokenSyntax = `export function withBroken(Comp: any { return <Comp;`;
        await expect(
          overridesCreateOperation.execute(snap, { name: 'BrokenSyntax', code: brokenSyntax }, context),
        ).rejects.toThrow(/SYNTAX_ERROR/);
      });

      it('accepts arrow function HOCs and various withX naming conventions', async () => {
        const snap = createMockSnapshot({});
        const validArrow = `import React from 'react';
export const withArrowHoc = (Comp: any) => (props: any) => <Comp {...props} data-glow="true" />;
export const with123Numeric = (Comp: any) => (props: any) => <Comp {...props} />;
export const with_UnderScore = (Comp: any) => (props: any) => <Comp {...props} />;
export const with$Dollar = (Comp: any) => (props: any) => <Comp {...props} />;
`;
        const res = await overridesCreateOperation.execute(
          snap,
          { name: 'MultiHocs', code: validArrow },
          context,
        );

        expect(res.path).toBe('overrides/MultiHocs.tsx');
        expect(res.exports).toContain('withArrowHoc');
        expect(res.exports).toContain('with123Numeric');
        expect(res.exports).toContain('with_UnderScore');
        expect(res.exports).toContain('with$Dollar');
        expect(projectFS.readFile('overrides/MultiHocs.tsx')).toBe(validArrow);
      });
    });

    describe('overrides.set & overrides.remove', () => {
      const HOVER_OVERRIDE_CODE = `import type { ComponentType } from 'react';
export function withHover(Component: ComponentType<any>) {
  return (props: any) => <Component {...props} />;
}
`;
      const GLOW_OVERRIDE_CODE = `import type { ComponentType } from 'react';
export function withGlow(Component: ComponentType<any>) {
  return (props: any) => <Component {...props} />;
}
`;

      it('rejects setting overrides on non-existent file or non-existent node', async () => {
        const snap = createMockSnapshot({
          'overrides/Hover.tsx': HOVER_OVERRIDE_CODE,
          'app/page.tsx': COMPLEX_PAGE_JSX,
        });

        // Non-existent target file
        await expect(
          overridesSetOperation.execute(
            snap,
            {
              filePath: 'app/missing-page.tsx',
              nodeId: 'primary-btn',
              overrides: [{ file: 'overrides/Hover.tsx', name: 'withHover' }],
            },
            context,
          ),
        ).rejects.toThrow(/FILE_NOT_FOUND/);

        // Non-existent node ID
        await expect(
          overridesSetOperation.execute(
            snap,
            {
              filePath: 'app/page.tsx',
              nodeId: 'ghost-element-404',
              overrides: [{ file: 'overrides/Hover.tsx', name: 'withHover' }],
            },
            context,
          ),
        ).rejects.toThrow(/NODE_NOT_FOUND/);
      });

      it('rejects setting non-existent override file or non-existent export name', async () => {
        const snap = createMockSnapshot({
          'overrides/Hover.tsx': HOVER_OVERRIDE_CODE,
          'app/page.tsx': COMPLEX_PAGE_JSX,
        });

        // Non-existent override file
        await expect(
          overridesSetOperation.execute(
            snap,
            {
              filePath: 'app/page.tsx',
              nodeId: 'primary-btn',
              overrides: [{ file: 'overrides/NonExistent.tsx', name: 'withHover' }],
            },
            context,
          ),
        ).rejects.toThrow(/OVERRIDE_FILE_NOT_FOUND/);

        // Non-existent export name in existing file
        await expect(
          overridesSetOperation.execute(
            snap,
            {
              filePath: 'app/page.tsx',
              nodeId: 'primary-btn',
              overrides: [{ file: 'overrides/Hover.tsx', name: 'withNonExistentExport' }],
            },
            context,
          ),
        ).rejects.toThrow(/OVERRIDE_EXPORT_NOT_FOUND/);
      });

      it('resolves ref.file gracefully when omitting .tsx extension or overrides/ prefix', async () => {
        const snap = createMockSnapshot({
          'overrides/Hover.tsx': HOVER_OVERRIDE_CODE,
          'app/page.tsx': COMPLEX_PAGE_JSX,
        });

        const res = await overridesSetOperation.execute(
          snap,
          {
            filePath: 'app/page.tsx',
            nodeId: 'primary-btn',
            overrides: [{ file: 'Hover', name: 'withHover' }],
          },
          context,
        );

        expect(res.overrides[0].file).toBe('overrides/Hover.tsx');
        const updated = projectFS.readFile('app/page.tsx')!;
        expect(updated).toContain('<Override with={withHover}>');
      });

      it('wraps self-closing elements correctly without corrupting JSX syntax', async () => {
        const snap = createMockSnapshot({
          'overrides/Hover.tsx': HOVER_OVERRIDE_CODE,
          'app/page.tsx': COMPLEX_PAGE_JSX,
        });

        // hero-image is self-closing <img data-id="hero-image" src="..." />
        await overridesSetOperation.execute(
          snap,
          {
            filePath: 'app/page.tsx',
            nodeId: 'hero-image',
            overrides: [{ file: 'overrides/Hover.tsx', name: 'withHover' }],
          },
          context,
        );

        const updated = projectFS.readFile('app/page.tsx')!;
        expect(updated).toContain('<Override with={withHover}>');
        expect(updated).toContain('<img data-id="hero-image" src="/banner.png" alt="Banner" />');
        expect(updated).toContain('</Override>');
      });

      it('supports multiple overrides wrapped in array syntax: <Override with={[withHover, withGlow]}>', async () => {
        const snap = createMockSnapshot({
          'overrides/Hover.tsx': HOVER_OVERRIDE_CODE,
          'overrides/Glow.tsx': GLOW_OVERRIDE_CODE,
          'app/page.tsx': COMPLEX_PAGE_JSX,
        });

        await overridesSetOperation.execute(
          snap,
          {
            filePath: 'app/page.tsx',
            nodeId: 'primary-btn',
            overrides: [
              { file: 'overrides/Hover.tsx', name: 'withHover' },
              { file: 'overrides/Glow.tsx', name: 'withGlow' },
            ],
          },
          context,
        );

        const updated = projectFS.readFile('app/page.tsx')!;
        expect(updated).toContain('<Override with={[withHover, withGlow]}>');
        expect(updated).toContain("import { withHover } from '@/overrides/Hover';");
        expect(updated).toContain("import { withGlow } from '@/overrides/Glow';");
        expect(updated).toContain("import { withResponsiveProps, Override } from '@revyme/runtime';");
      });

      it('handles export name collisions across different files via import aliasing', async () => {
        const FILE_A_CODE = `export function withAction(Comp: any) { return Comp; }`;
        const FILE_B_CODE = `export function withAction(Comp: any) { return Comp; }`;

        const snap = createMockSnapshot({
          'overrides/First.tsx': FILE_A_CODE,
          'overrides/Second.tsx': FILE_B_CODE,
          'app/page.tsx': COMPLEX_PAGE_JSX,
        });

        await overridesSetOperation.execute(
          snap,
          {
            filePath: 'app/page.tsx',
            nodeId: 'primary-btn',
            overrides: [
              { file: 'overrides/First.tsx', name: 'withAction' },
              { file: 'overrides/Second.tsx', name: 'withAction' },
            ],
          },
          context,
        );

        const updated = projectFS.readFile('app/page.tsx')!;
        // Second should be aliased withAction_Second
        expect(updated).toContain("import { withAction } from '@/overrides/First';");
        expect(updated).toContain("import { withAction as withAction_Second } from '@/overrides/Second';");
        expect(updated).toContain('<Override with={[withAction, withAction_Second]}>');
      });

      it('replaces existing override cleanly when updated without nesting multiple Override tags', async () => {
        const snap = createMockSnapshot({
          'overrides/Hover.tsx': HOVER_OVERRIDE_CODE,
          'overrides/Glow.tsx': GLOW_OVERRIDE_CODE,
          'app/page.tsx': COMPLEX_PAGE_JSX,
        });

        // 1. Set withHover
        await overridesSetOperation.execute(
          snap,
          {
            filePath: 'app/page.tsx',
            nodeId: 'primary-btn',
            overrides: [{ file: 'overrides/Hover.tsx', name: 'withHover' }],
          },
          context,
        );

        // 2. Replace with withGlow
        await overridesSetOperation.execute(
          snap,
          {
            filePath: 'app/page.tsx',
            nodeId: 'primary-btn',
            overrides: [{ file: 'overrides/Glow.tsx', name: 'withGlow' }],
          },
          context,
        );

        const updated = projectFS.readFile('app/page.tsx')!;
        expect(updated).toContain('<Override with={withGlow}>');
        expect(updated).not.toContain('withHover');
        expect(updated).not.toContain('<Override with={withHover}>');
        // Count occurrences of <Override
        const count = (updated.match(/<Override/g) || []).length;
        expect(count).toBe(1);
      });

      it('removes override and preserves other runtime imports (e.g. withResponsiveProps)', async () => {
        const snap = createMockSnapshot({
          'overrides/Hover.tsx': HOVER_OVERRIDE_CODE,
          'app/page.tsx': COMPLEX_PAGE_JSX,
        });

        // Attach
        await overridesSetOperation.execute(
          snap,
          {
            filePath: 'app/page.tsx',
            nodeId: 'primary-btn',
            overrides: [{ file: 'overrides/Hover.tsx', name: 'withHover' }],
          },
          context,
        );

        // Remove
        await overridesRemoveOperation.execute(
          snap,
          {
            filePath: 'app/page.tsx',
            nodeId: 'primary-btn',
          },
          context,
        );

        const finalCode = projectFS.readFile('app/page.tsx')!;
        expect(finalCode).not.toContain('<Override');
        expect(finalCode).not.toContain('withHover');
        expect(finalCode).not.toContain('@/overrides/Hover');
        // withResponsiveProps must be preserved!
        expect(finalCode).toContain("import { withResponsiveProps } from '@revyme/runtime';");
        expect(finalCode).not.toContain('Override');
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Adversarial Custom Code (get & set)
  // ───────────────────────────────────────────────────────────────────────────
  describe('2. Adversarial Custom Code Verification', () => {
    it('rejects invalid injection locations via schema validation', async () => {
      const snap = createMockSnapshot({});

      const invalidLocations = ['head', 'body', 'footer', 'header', 'script', 'top'];
      for (const loc of invalidLocations) {
        expect(() => {
          customCodeSetOperation.inputSchema.parse({
            location: loc as any,
            html: '<script>console.log(1);</script>',
          });
        }).toThrow();
        expect(
          defaultRegistry.validateInput('customCode.set', {
            location: loc as any,
            html: '<script>console.log(1);</script>',
          }).ok,
        ).toBe(false);
      }
    });

    it('sets and clears all valid locations independently', async () => {
      const snap = createMockSnapshot({});

      // Set all 4 locations
      await customCodeSetOperation.execute(
        snap,
        { location: 'headStart', html: '<!-- headStart -->' },
        context,
      );
      await customCodeSetOperation.execute(
        snap,
        { location: 'headEnd', html: '<!-- headEnd -->' },
        context,
      );
      await customCodeSetOperation.execute(
        snap,
        { location: 'bodyStart', html: '<!-- bodyStart -->' },
        context,
      );
      await customCodeSetOperation.execute(
        snap,
        { location: 'bodyEnd', html: '<!-- bodyEnd -->' },
        context,
      );

      let current = await customCodeGetOperation.execute(snap, {}, context);
      expect(current).toEqual({
        headStart: '<!-- headStart -->',
        headEnd: '<!-- headEnd -->',
        bodyStart: '<!-- bodyStart -->',
        bodyEnd: '<!-- bodyEnd -->',
      });

      // Clear bodyStart with null
      await customCodeSetOperation.execute(
        snap,
        { location: 'bodyStart', html: null },
        context,
      );

      // Set headStart with empty string
      await customCodeSetOperation.execute(
        snap,
        { location: 'headStart', html: '' },
        context,
      );

      current = await customCodeGetOperation.execute(snap, {}, context);
      expect(current.bodyStart).toBeNull();
      expect(current.headStart).toBe('');
      expect(current.headEnd).toBe('<!-- headEnd -->');
      expect(current.bodyEnd).toBe('<!-- bodyEnd -->');
    });

    it('recovers gracefully from corrupted app/_custom-code.json', async () => {
      const snap = createMockSnapshot({
        [CUSTOM_CODE_FILE]: '{ invalid json file content !!',
      });

      const res = await customCodeGetOperation.execute(snap, {}, context);
      expect(res).toEqual({
        headStart: null,
        headEnd: null,
        bodyStart: null,
        bodyEnd: null,
      });

      // Can overwrite corrupted file successfully
      await customCodeSetOperation.execute(
        snap,
        { location: 'headStart', html: '<script>recovered();</script>' },
        context,
      );
      const after = await customCodeGetOperation.execute(snap, {}, context);
      expect(after.headStart).toBe('<script>recovered();</script>');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Adversarial Redirects (add, reorder, remove, loop detection)
  // ───────────────────────────────────────────────────────────────────────────
  describe('3. Adversarial Redirects Verification', () => {
    describe('redirects.add edge cases', () => {
      it('rejects self-redirects under various formats and whitespace', async () => {
        const snap = createMockSnapshot({});

        // Exact match
        await expect(
          redirectsAddOperation.execute(
            snap,
            { redirects: [{ from: '/about', to: '/about' }] },
            context,
          ),
        ).rejects.toThrow(/INVALID_REDIRECT/);

        // Leading/trailing whitespace
        await expect(
          redirectsAddOperation.execute(
            snap,
            { redirects: [{ from: '  /features  ', to: '/features' }] },
            context,
          ),
        ).rejects.toThrow(/INVALID_REDIRECT/);
      });

      it('rejects from paths that do not start with /', async () => {
        const snap = createMockSnapshot({});
        await expect(
          redirectsAddOperation.execute(
            snap,
            { redirects: [{ from: 'about-us', to: '/about' }] },
            context,
          ),
        ).rejects.toThrow(/INVALID_REDIRECT.*must start with "\/"/);
      });

      it('detects 2-hop circular redirect loops across separate operations', async () => {
        const snap = createMockSnapshot({});

        // 1. Add /a -> /b
        await redirectsAddOperation.execute(
          snap,
          { redirects: [{ from: '/a', to: '/b' }] },
          context,
        );

        // 2. Add /b -> /a (loop)
        await expect(
          redirectsAddOperation.execute(
            snap,
            { redirects: [{ from: '/b', to: '/a' }] },
            context,
          ),
        ).rejects.toThrow(/REDIRECT_LOOP/);
      });

      it('detects circular redirect loops within the same batch atomically', async () => {
        const snap = createMockSnapshot({});

        // Batch contains both /x -> /y and /y -> /x
        await expect(
          redirectsAddOperation.execute(
            snap,
            {
              redirects: [
                { from: '/x', to: '/y' },
                { from: '/y', to: '/x' },
              ],
            },
            context,
          ),
        ).rejects.toThrow(/REDIRECT_LOOP/);

        // Verify atomic rollback — no redirects were saved!
        const list = await redirectsListOperation.execute(snap, {}, context);
        expect(list.redirects).toEqual([]);
      });

      it('permits external URLs as destinations without triggering false loop detection', async () => {
        const snap = createMockSnapshot({});

        const res = await redirectsAddOperation.execute(
          snap,
          {
            redirects: [
              { from: '/github', to: 'https://github.com/revyme' },
              { from: '/twitter', to: 'https://twitter.com/revyme' },
            ],
          },
          context,
        );

        expect(res.count).toBe(2);
        const list = await redirectsListOperation.execute(snap, {}, context);
        expect(list.redirects.length).toBe(2);
        expect(list.redirects[0].to).toBe('https://github.com/revyme');
        expect(list.redirects[1].to).toBe('https://twitter.com/revyme');
      });
    });

    describe('redirects.reorder edge cases', () => {
      it('preserves redirects omitted from orderedIds by placing them at the end', async () => {
        const snap = createMockSnapshot({});
        const added = await redirectsAddOperation.execute(
          snap,
          {
            redirects: [
              { from: '/p1', to: '/t1' },
              { from: '/p2', to: '/t2' },
              { from: '/p3', to: '/t3' },
              { from: '/p4', to: '/t4' },
            ],
          },
          context,
        );

        const [id1, id2, id3, id4] = added.ids;

        // Only specify id4 and id2 in orderedIds
        const reorderRes = await redirectsReorderOperation.execute(
          snap,
          { orderedIds: [id4, id2] },
          context,
        );

        expect(reorderRes.orderedIds).toEqual([id4, id2, id1, id3]);

        const list = await redirectsListOperation.execute(snap, {}, context);
        expect(list.redirects.map((r) => r.id)).toEqual([id4, id2, id1, id3]);
      });

      it('safely ignores non-existent or invalid IDs during reordering', async () => {
        const snap = createMockSnapshot({});
        const added = await redirectsAddOperation.execute(
          snap,
          {
            redirects: [
              { from: '/first', to: '/1' },
              { from: '/second', to: '/2' },
            ],
          },
          context,
        );

        const [id1, id2] = added.ids;

        // Pass phantom ID in front
        const reorderRes = await redirectsReorderOperation.execute(
          snap,
          { orderedIds: ['phantom-id-999', id2, id1] },
          context,
        );

        // Phantom ID should not appear in the resulting list
        expect(reorderRes.orderedIds).toEqual([id2, id1]);
      });

      it('rejects empty orderedIds array via schema validation', async () => {
        expect(() => {
          redirectsReorderOperation.inputSchema.parse({ orderedIds: [] });
        }).toThrow();
        expect(
          defaultRegistry.validateInput('redirects.reorder', { orderedIds: [] }).ok,
        ).toBe(false);
      });
    });

    describe('redirects file resilience', () => {
      it('handles corrupted app/_redirects.json gracefully', async () => {
        const snap = createMockSnapshot({
          [REDIRECTS_FILE]: 'NOT VALID JSON !!!',
        });

        const list = await redirectsListOperation.execute(snap, {}, context);
        expect(list.redirects).toEqual([]);

        // Removing non-existent ID on corrupted file doesn't crash
        const remRes = await redirectsRemoveOperation.execute(
          snap,
          { redirectIds: ['any-id'] },
          context,
        );
        expect(remRes.removed).toEqual([]);
      });

      it('filters out non-conforming objects in app/_redirects.json', async () => {
        const snap = createMockSnapshot({
          [REDIRECTS_FILE]: JSON.stringify([
            { id: 'valid-1', from: '/v1', to: '/dest-1' },
            { id: 'bad-1', from: '/v2' }, // missing to
            null,
            42,
            { from: '/v3', to: '/dest-3' }, // missing id
          ]),
        });

        const list = await redirectsListOperation.execute(snap, {}, context);
        expect(list.redirects.length).toBe(1);
        expect(list.redirects[0].id).toBe('valid-1');
      });
    });

    describe('multi-hop redirect behavior', () => {
      it('evaluates multi-hop redirect chains (/a -> /b -> /c)', async () => {
        const snap = createMockSnapshot({});

        // Add /a -> /b
        await redirectsAddOperation.execute(
          snap,
          { redirects: [{ from: '/a', to: '/b' }] },
          context,
        );

        // Add /b -> /c
        await redirectsAddOperation.execute(
          snap,
          { redirects: [{ from: '/b', to: '/c' }] },
          context,
        );

        const list = await redirectsListOperation.execute(snap, {}, context);
        expect(list.redirects.length).toBe(2);
        expect(list.redirects[0].from).toBe('/a');
        expect(list.redirects[0].to).toBe('/b');
        expect(list.redirects[1].from).toBe('/b');
        expect(list.redirects[1].to).toBe('/c');

        // Documenting behavior: 2-hop checks direct reciprocity (A->B and B->A).
        // 3-hop transitive loops (/c -> /a) are currently handled by downstream server/edge router rules.
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Advanced Stress Tests (Nested Overrides & Complex Scripts)
  // ───────────────────────────────────────────────────────────────────────────
  describe('4. Advanced Stress Scenarios', () => {
    const HOVER_CODE = `import type { ComponentType } from 'react';
export function withHover(Component: ComponentType<any>) {
  return (props: any) => <Component {...props} />;
}
`;
    const GLOW_CODE = `import type { ComponentType } from 'react';
export function withGlow(Component: ComponentType<any>) {
  return (props: any) => <Component {...props} />;
}
`;

    it('handles nested overrides on both outer container and inner child element', async () => {
      const snap = createMockSnapshot({
        'overrides/Hover.tsx': HOVER_CODE,
        'overrides/Glow.tsx': GLOW_CODE,
        'app/page.tsx': COMPLEX_PAGE_JSX,
      });

      // 1. Override outer container (hero-section)
      await overridesSetOperation.execute(
        snap,
        {
          filePath: 'app/page.tsx',
          nodeId: 'hero-section',
          overrides: [{ file: 'overrides/Hover.tsx', name: 'withHover' }],
        },
        context,
      );

      // 2. Override inner button (primary-btn)
      await overridesSetOperation.execute(
        snap,
        {
          filePath: 'app/page.tsx',
          nodeId: 'primary-btn',
          overrides: [{ file: 'overrides/Glow.tsx', name: 'withGlow' }],
        },
        context,
      );

      let pageCode = projectFS.readFile('app/page.tsx')!;
      expect(pageCode).toContain('<Override with={withHover}>');
      expect(pageCode).toContain('<Override with={withGlow}>');

      // 3. Remove override from inner button only
      await overridesRemoveOperation.execute(
        snap,
        {
          filePath: 'app/page.tsx',
          nodeId: 'primary-btn',
        },
        context,
      );

      pageCode = projectFS.readFile('app/page.tsx')!;
      // Outer override must remain intact
      expect(pageCode).toContain('<Override with={withHover}>');
      expect(pageCode).toContain("import { withHover } from '@/overrides/Hover';");
      // Inner override must be gone
      expect(pageCode).not.toContain('<Override with={withGlow}>');
      expect(pageCode).not.toContain('withGlow');
      expect(pageCode).not.toContain('@/overrides/Glow');

      // 4. Remove outer override
      await overridesRemoveOperation.execute(
        snap,
        {
          filePath: 'app/page.tsx',
          nodeId: 'hero-section',
        },
        context,
      );

      pageCode = projectFS.readFile('app/page.tsx')!;
      expect(pageCode).not.toContain('<Override');
      expect(pageCode).not.toContain('withHover');
      expect(pageCode).not.toContain('@/overrides/Hover');
      expect(pageCode).not.toContain('Override');
    });

    it('is idempotent when removing override from a node that has no overrides', async () => {
      const snap = createMockSnapshot({
        'app/page.tsx': COMPLEX_PAGE_JSX,
      });

      const res = await overridesRemoveOperation.execute(
        snap,
        {
          filePath: 'app/page.tsx',
          nodeId: 'primary-btn',
        },
        context,
      );

      expect(res.nodeId).toBe('primary-btn');
      expect(res.overrides).toEqual([]);
      expect(projectFS.readFile('app/page.tsx')).toBe(COMPLEX_PAGE_JSX);
    });

    it('supports complex multiline CDATA, script tags and unicode in customCode', async () => {
      const snap = createMockSnapshot({});
      const complexHtml = `<script>
  (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
  new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
  j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
  'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
  })(window,document,'script','dataLayer','GTM-XXXXX');
  // Unicode test: Українська мова, 日本語, 🚀
</script>`;

      await customCodeSetOperation.execute(
        snap,
        { location: 'headStart', html: complexHtml },
        context,
      );

      const res = await customCodeGetOperation.execute(snap, {}, context);
      expect(res.headStart).toBe(complexHtml);
    });
  });
});
