// packages/automation-core/test/capabilities/T20-adversarial.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { createSnapshot, createOperationContext } from '../../src/session';
import { defaultRegistry } from '../../src/registry';
import {
  codeComponentsCreateOperation,
  codeComponentsGetOperation,
  codeComponentsListOperation,
} from '../../src/operations/code-components';
import {
  codeFilesListOperation,
  codeFilesReadOperation,
  codeFilesSearchOperation,
  codeFilesSubmitOperation,
} from '../../src/operations/code-files';
import {
  overridesCreateOperation,
  overridesListOperation,
  overridesSetOperation,
  overridesRemoveOperation,
} from '../../src/operations/overrides';
import {
  customCodeGetOperation,
  customCodeSetOperation,
} from '../../src/operations/custom-code';
import {
  redirectsListOperation,
  redirectsAddOperation,
  redirectsRemoveOperation,
  redirectsReorderOperation,
} from '../../src/operations/redirects';
import { projectFS } from '@/code/project/project-fs';

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

describe('Adversarial Stress Test: Milestone T20 Integrity & Robustness', () => {
  const context = createOperationContext();

  beforeEach(() => {
    for (const f of projectFS.listFiles()) {
      projectFS.deleteFile(f);
    }
  });

  describe('Adversarial Code Components', () => {
    it('rejects malformed JSON within /** @controls */ annotation', async () => {
      const snap = createSnapshot({ projectId: 'test-p', branchId: 'main' }, 0, {});
      const badJsonCode = `'use client';
/** @controls { "title": { invalid_json_here } } */
import React from 'react';
export default function BadWidget() { return <div>Bad</div>; }
`;
      await expect(
        codeComponentsCreateOperation.execute(
          snap,
          { name: 'BadWidget', code: badJsonCode },
          context,
        ),
      ).rejects.toThrow(/INVALID_CONTROLS/);
    });

    it('rejects component using Node builtin (e.g. child_process) via Oracle gate', async () => {
      const snap = createSnapshot({ projectId: 'test-p', branchId: 'main' }, 0, {});
      const maliciousCode = `'use client';
/** @controls { "text": { "type": "text", "label": "Text", "default": "hi" } } */
import React from 'react';
import { execSync } from 'child_process';
export default function ExploitWidget() { return <div>{execSync('id')}</div>; }
`;
      await expect(
        codeComponentsCreateOperation.execute(
          snap,
          { name: 'ExploitWidget', code: maliciousCode },
          context,
        ),
      ).rejects.toThrow(/ORACLE_VIOLATION/);
    });

    it('remediated: default dimensions are placed after use-client directive and pass Oracle check', async () => {
      const snap = createSnapshot({ projectId: 'test-p', branchId: 'main' }, 0, {});
      const validCode = `'use client';
/** @controls { "t": { "type": "text", "label": "T", "default": "val" } } */
import React from 'react';
import { withResponsiveProps } from '@revyme/runtime';
function SizeWidget() { return <div>Size</div>; }
export default withResponsiveProps(SizeWidget);
`;
      // When defaultWidth and defaultHeight are passed as input parameters,
      // they are inserted immediately after 'use client';\n, passing Oracle check.
      const res = await codeComponentsCreateOperation.execute(
        snap,
        { name: 'SizeWidget', code: validCode, defaultWidth: 800, defaultHeight: 600 },
        context,
      );
      expect(res.name).toBe('SizeWidget');
      const saved = projectFS.readFile('components/SizeWidget.tsx')!;
      expect(saved.startsWith("'use client';\n")).toBe(true);
      expect(saved).toContain('/** @defaultWidth 800 */');
      expect(saved).toContain('/** @defaultHeight 600 */');
    });

    it('successfully creates component when annotations are placed following Next.js use-client order', async () => {
      const snap = createSnapshot({ projectId: 'test-p', branchId: 'main' }, 0, {});
      const validCode = `'use client';
/** @defaultWidth 800 */
/** @defaultHeight 600 */
/** @controls { "t": { "type": "text", "label": "T", "default": "val" } } */
import React from 'react';
import { withResponsiveProps } from '@revyme/runtime';
function SizeWidget() { return <div>Size</div>; }
export default withResponsiveProps(SizeWidget);
`;
      const res = await codeComponentsCreateOperation.execute(
        snap,
        { name: 'SizeWidget', code: validCode },
        context,
      );

      const written = projectFS.readFile(res.path)!;
      expect(written).toContain("'use client';");
      expect(written).toContain('/** @defaultWidth 800 */');
      expect(written).toContain('/** @defaultHeight 600 */');
      expect(res.meta.controls.t).toBeDefined();
      expect(res.meta.controls.t.default).toBe('val');
    });
  });

  describe('Adversarial Code Files & CAS Security', () => {
    it('guarantees atomicity: when file #3 of 4 fails CAS check, files #1, #2, #4 are never written', async () => {
      const initialA = 'export default function A() { return <div>A</div>; }';
      const initialB = 'export default function B() { return <div>B</div>; }';
      const snap = createSnapshot({ projectId: 'test-p', branchId: 'main' }, 0, {
        'components/A.tsx': initialA,
        'components/B.tsx': initialB,
      });

      const hashA = sha256(initialA);
      const fakeHashB = sha256('mismatched-content');

      await expect(
        codeFilesSubmitOperation.execute(
          snap,
          {
            files: [
              { path: 'components/A.tsx', code: 'export default function A() { return <div>A-MUTATED</div>; }', baseHash: hashA },
              { path: 'components/NewFile.tsx', code: 'export default function New() { return <div>NEW</div>; }' },
              { path: 'components/B.tsx', code: 'export default function B() { return <div>B-MUTATED</div>; }', baseHash: fakeHashB },
              { path: 'components/AnotherNew.tsx', code: 'export default function Another() { return <div>ANOTHER</div>; }' },
            ],
          },
          context,
        ),
      ).rejects.toThrow(/CAS_CONFLICT/);

      // Verify zero files were created or mutated
      expect(projectFS.readFile('components/A.tsx')).toBe(initialA);
      expect(projectFS.readFile('components/B.tsx')).toBe(initialB);
      expect(projectFS.readFile('components/NewFile.tsx')).toBeNull();
      expect(projectFS.readFile('components/AnotherNew.tsx')).toBeNull();
    });

    it('rejects path traversal attempts with null bytes, backslashes, and dot-dots', async () => {
      const snap = createSnapshot({ projectId: 'test-p', branchId: 'main' }, 0, {});

      const badPaths = [
        '../outside.tsx',
        'foo/../../bar.tsx',
        '/root/evil.tsx',
        'C:\\Windows\\System32\\cmd.exe',
        'components/test.tsx\0.js',
      ];

      for (const p of badPaths) {
        await expect(
          codeFilesReadOperation.execute(snap, { path: p }, context),
        ).rejects.toThrow(/PATH_TRAVERSAL/);

        await expect(
          codeFilesSubmitOperation.execute(
            snap,
            { files: [{ path: p, code: 'console.log(1)' }] },
            context,
          ),
        ).rejects.toThrow(/PATH_TRAVERSAL/);
      }
    });

    it('rejects attempts to overwrite protected configuration files', async () => {
      const snap = createSnapshot({ projectId: 'test-p', branchId: 'main' }, 0, {});
      const protectedFiles = [
        'package.json',
        'tsconfig.json',
        'next.config.mjs',
        'next.config.js',
      ];

      for (const p of protectedFiles) {
        await expect(
          codeFilesSubmitOperation.execute(
            snap,
            { files: [{ path: p, code: '{}' }] },
            context,
          ),
        ).rejects.toThrow(/PROTECTED_PATH/);
      }
    });

    it('handles line slicing edge cases on codeFiles.read', async () => {
      const snap = createSnapshot({ projectId: 'test-p', branchId: 'main' }, 0, {
        'test.txt': 'line 1\nline 2\nline 3\nline 4\nline 5',
      });

      // Out of bounds fromLine > toLine
      await expect(
        codeFilesReadOperation.execute(snap, { path: 'test.txt', fromLine: 5, toLine: 2 }, context),
      ).rejects.toThrow(/INVALID_LINE_RANGE/);

      // Clamping high toLine
      const clamped = await codeFilesReadOperation.execute(
        snap,
        { path: 'test.txt', fromLine: 4, toLine: 999 },
        context,
      );
      expect(clamped.content).toBe('line 4\nline 5');
      expect(clamped.sliceLines).toEqual({ from: 4, to: 5 });
    });
  });

  describe('Adversarial Code Overrides', () => {
    it('correctly stacks multiple overrides on the same JSX element', async () => {
      const snap = createSnapshot({ projectId: 'test-p', branchId: 'main' }, 0, {
        'overrides/Hover.tsx': `export function withHover(C: any) { return C; }`,
        'overrides/Click.tsx': `export function withClick(C: any) { return C; }`,
        'app/page.tsx': `'use client';
import React from 'react';
export default function Page() {
  return (
    <div data-id="root">
      <button data-id="my-btn">Click me</button>
    </div>
  );
}
`,
      });

      const res = await overridesSetOperation.execute(
        snap,
        {
          filePath: 'app/page.tsx',
          nodeId: 'my-btn',
          overrides: [
            { file: 'overrides/Hover.tsx', name: 'withHover' },
            { file: 'overrides/Click.tsx', name: 'withClick' },
          ],
        },
        context,
      );

      expect(res.overrides.length).toBe(2);
      const code = projectFS.readFile('app/page.tsx')!;
      expect(code).toContain('<Override with={[withHover, withClick]}>');
      expect(code).toContain("import { withHover } from '@/overrides/Hover';");
      expect(code).toContain("import { withClick } from '@/overrides/Click';");
    });

    it('rejects setting override on non-existent node ID', async () => {
      const snap = createSnapshot({ projectId: 'test-p', branchId: 'main' }, 0, {
        'overrides/Hover.tsx': `export function withHover(C: any) { return C; }`,
        'app/page.tsx': `'use client';\nexport default function Page() { return <div data-id="root">Hi</div>; }`,
      });

      await expect(
        overridesSetOperation.execute(
          snap,
          {
            filePath: 'app/page.tsx',
            nodeId: 'non-existent-id',
            overrides: [{ file: 'overrides/Hover.tsx', name: 'withHover' }],
          },
          context,
        ),
      ).rejects.toThrow(/NODE_NOT_FOUND/);
    });

    it('rejects setting override if the function export does not exist in the override file', async () => {
      const snap = createSnapshot({ projectId: 'test-p', branchId: 'main' }, 0, {
        'overrides/Hover.tsx': `export function withHover(C: any) { return C; }`,
        'app/page.tsx': `'use client';\nexport default function Page() { return <div data-id="root">Hi</div>; }`,
      });

      await expect(
        overridesSetOperation.execute(
          snap,
          {
            filePath: 'app/page.tsx',
            nodeId: 'root',
            overrides: [{ file: 'overrides/Hover.tsx', name: 'withNonExistentExport' }],
          },
          context,
        ),
      ).rejects.toThrow(/OVERRIDE_EXPORT_NOT_FOUND/);
    });
  });

  describe('Adversarial Custom Code & Redirects', () => {
    it('gracefully handles corrupted JSON in app/_custom-code.json', async () => {
      const snap = createSnapshot({ projectId: 'test-p', branchId: 'main' }, 0, {
        'app/_custom-code.json': '{ corrupted_json_syntax: [',
      });

      const res = await customCodeGetOperation.execute(snap, {}, context);
      expect(res).toEqual({
        headStart: null,
        headEnd: null,
        bodyStart: null,
        bodyEnd: null,
      });

      // Overwriting corrupted file recovers it cleanly
      await customCodeSetOperation.execute(
        snap,
        { location: 'headEnd', html: '<meta name="test" />' },
        context,
      );

      const recovered = await customCodeGetOperation.execute(snap, {}, context);
      expect(recovered.headEnd).toBe('<meta name="test" />');
    });

    it('gracefully handles corrupted JSON in app/_redirects.json', async () => {
      const snap = createSnapshot({ projectId: 'test-p', branchId: 'main' }, 0, {
        'app/_redirects.json': 'INVALID_JSON_CONTENT',
      });

      const res = await redirectsListOperation.execute(snap, {}, context);
      expect(res.redirects).toEqual([]);

      // Adding to corrupted file recovers it
      await redirectsAddOperation.execute(
        snap,
        { redirects: [{ from: '/new', to: '/target' }] },
        context,
      );

      const recovered = await redirectsListOperation.execute(snap, {}, context);
      expect(recovered.redirects.length).toBe(1);
      expect(recovered.redirects[0].from).toBe('/new');
    });

    it('detects circular loop within the SAME batch of redirects', async () => {
      const snap = createSnapshot({ projectId: 'test-p', branchId: 'main' }, 0, {});

      await expect(
        redirectsAddOperation.execute(
          snap,
          {
            redirects: [
              { from: '/alpha', to: '/beta' },
              { from: '/beta', to: '/alpha' },
            ],
          },
          context,
        ),
      ).rejects.toThrow(/REDIRECT_LOOP/);
    });

    it('rejects redirect paths without leading slash', async () => {
      const snap = createSnapshot({ projectId: 'test-p', branchId: 'main' }, 0, {});

      await expect(
        redirectsAddOperation.execute(
          snap,
          {
            redirects: [{ from: 'no-leading-slash', to: '/dest' }],
          },
          context,
        ),
      ).rejects.toThrow(/INVALID_REDIRECT/);
    });
  });
});
