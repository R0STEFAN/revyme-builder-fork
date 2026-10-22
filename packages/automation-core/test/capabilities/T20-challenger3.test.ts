// packages/automation-core/test/capabilities/T20-challenger3.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Snapshot } from '../../src/contracts';
import { createSnapshot, createOperationContext } from '../../src/session';
import { defaultRegistry } from '../../src/registry';
import {
  codeComponentsCreateOperation,
  codeComponentsCreateInputSchema,
} from '../../src/operations/code-components';
import {
  codeFilesSubmitOperation,
  isSystemProtectedPath,
} from '../../src/operations/code-files';
import {
  overridesSetOperation,
} from '../../src/operations/overrides';
import { projectFS } from '@/code/project/project-fs';

function createMockSnapshot(files: Record<string, string>): Snapshot {
  return createSnapshot({ projectId: 'challenger3-project', branchId: 'main' }, 0, files);
}

const SAMPLE_PAGE_JSX = `'use client';
import React from 'react';

export default function HomePage() {
  return (
    <div data-id="root" style={{ width: '100%', minHeight: '1000px', padding: '24px' }}>
      <h1 data-id="title" style={{ fontSize: '32px' }}>Welcome</h1>
      <button data-id="cta-btn" style={{ padding: '8px 16px', background: '#0070f3', color: '#fff' }}>
        Click me
      </button>
    </div>
  );
}
`;

const VALID_OVERRIDE_TSX = `import React from 'react';
export function withHoverGlow(Component: any) {
  return function WithHoverGlow(props: any) {
    return <Component {...props} data-glow="true" />;
  };
}
`;

const VALID_OVERRIDE_TS = `import React from 'react';
export function withHelper(Component: any) {
  return function WithHelper(props: any) {
    return <Component {...props} data-helper="true" />;
  };
}
`;

const VALID_BORDER_OVERRIDE = `import React from 'react';
export function withBorderGlow(Component: any) {
  return function WithBorderGlow(props: any) {
    return <Component {...props} data-border="true" />;
  };
}
`;

describe('T20 Challenger 3: Empirical Verification of Challenger 1 Defect Fixes (af00695)', () => {
  const context = createOperationContext();

  beforeEach(() => {
    for (const f of projectFS.listFiles()) {
      projectFS.deleteFile(f);
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Area 1: Directive placement in codeComponents.create
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Area 1: Directive placement in codeComponents.create', () => {
    it('preserves single-quoted \'use client\'; on line 1 and passes Oracle USE_CLIENT_REQUIRED', async () => {
      const snap = createMockSnapshot({});
      const rawCode = `'use client';
/** @controls {
  "label": { "type": "text", "label": "Label", "default": "Click Me" }
} */
import React from 'react';
import { withResponsiveProps } from '@revyme/runtime';

function SizeWidgetA(props: { label?: string }) {
  return <div>{props.label}</div>;
}

export default withResponsiveProps(SizeWidgetA);
`;

      const result = await codeComponentsCreateOperation.execute(
        snap,
        {
          name: 'SizeWidgetA',
          code: rawCode,
          defaultWidth: 640,
          defaultHeight: 480,
        },
        context,
      );

      expect(result.name).toBe('SizeWidgetA');
      const saved = projectFS.readFile('components/SizeWidgetA.tsx');
      expect(saved).toBeDefined();

      const lines = saved!.split('\n');
      expect(lines[0].trim()).toBe("'use client';");
      expect(saved).toContain('/** @defaultWidth 640 */');
      expect(saved).toContain('/** @defaultHeight 480 */');

      // Verify dimensions appear BEFORE the imports and AFTER 'use client'
      const useClientIdx = saved!.indexOf("'use client'");
      const widthIdx = saved!.indexOf('@defaultWidth 640');
      const heightIdx = saved!.indexOf('@defaultHeight 480');
      const importIdx = saved!.indexOf("import React from 'react'");

      expect(useClientIdx).toBeLessThan(widthIdx);
      expect(useClientIdx).toBeLessThan(heightIdx);
      expect(widthIdx).toBeLessThan(importIdx);
      expect(heightIdx).toBeLessThan(importIdx);
    });

    it('preserves double-quoted "use client"; on line 1 and passes Oracle gate', async () => {
      const snap = createMockSnapshot({});
      const rawCode = `"use client";
/** @controls {
  "title": { "type": "text", "label": "Title", "default": "Banner" }
} */
import React from 'react';
import { withResponsiveProps } from '@revyme/runtime';

function DoubleQuoteWidget(props: { title?: string }) {
  return <h1>{props.title}</h1>;
}

export default withResponsiveProps(DoubleQuoteWidget);
`;

      const result = await codeComponentsCreateOperation.execute(
        snap,
        {
          name: 'DoubleQuoteWidget',
          code: rawCode,
          defaultWidth: 800,
          defaultHeight: 400,
        },
        context,
      );

      expect(result.name).toBe('DoubleQuoteWidget');
      const saved = projectFS.readFile('components/DoubleQuoteWidget.tsx');
      expect(saved).toBeDefined();

      const lines = saved!.split('\n');
      expect(lines[0].trim()).toBe('"use client";');
      expect(saved).toContain('/** @defaultWidth 800 */');
      expect(saved).toContain('/** @defaultHeight 400 */');
    });

    it('handles "use client" without trailing semicolon', async () => {
      const snap = createMockSnapshot({});
      const rawCode = `'use client'
/** @controls {
  "label": { "type": "text", "label": "Label", "default": "Test" }
} */
import React from 'react';
import { withResponsiveProps } from '@revyme/runtime';

function NoSemiWidget(props: { label?: string }) {
  return <div>{props.label}</div>;
}

export default withResponsiveProps(NoSemiWidget);
`;

      const result = await codeComponentsCreateOperation.execute(
        snap,
        {
          name: 'NoSemiWidget',
          code: rawCode,
          defaultWidth: 500,
          defaultHeight: 300,
        },
        context,
      );

      expect(result.name).toBe('NoSemiWidget');
      const saved = projectFS.readFile('components/NoSemiWidget.tsx');
      expect(saved).toBeDefined();
      const lines = saved!.split('\n');
      expect(lines[0].trim()).toBe("'use client'");
      expect(saved).toContain('/** @defaultWidth 500 */');
      expect(saved).toContain('/** @defaultHeight 300 */');
    });

    it('handles CRLF line breaks with use client directive', async () => {
      const snap = createMockSnapshot({});
      const rawCode = `'use client';\r\n/** @controls {\r\n  "label": { "type": "text", "label": "Label", "default": "CRLF" }\r\n} */\r\nimport React from 'react';\r\nimport { withResponsiveProps } from '@revyme/runtime';\r\n\r\nfunction CrlfWidget(props: { label?: string }) {\r\n  return <div>{props.label}</div>;\r\n}\r\n\r\nexport default withResponsiveProps(CrlfWidget);\r\n`;

      const result = await codeComponentsCreateOperation.execute(
        snap,
        {
          name: 'CrlfWidget',
          code: rawCode,
          defaultWidth: 450,
          defaultHeight: 250,
        },
        context,
      );

      expect(result.name).toBe('CrlfWidget');
      const saved = projectFS.readFile('components/CrlfWidget.tsx');
      expect(saved).toBeDefined();
      expect(saved!.startsWith("'use client';\r\n") || saved!.startsWith("'use client';\n")).toBe(true);
      expect(saved).toContain('/** @defaultWidth 450 */');
      expect(saved).toContain('/** @defaultHeight 250 */');
    });

    it('injects "use client" on line 1 when input code completely lacks the directive', async () => {
      const snap = createMockSnapshot({});
      const rawCodeWithoutDirective = `/** @controls {
  "label": { "type": "text", "label": "Label", "default": "Injected" }
} */
import React from 'react';
import { withResponsiveProps } from '@revyme/runtime';

function AutoDirectiveWidget(props: { label?: string }) {
  return <div>{props.label}</div>;
}

export default withResponsiveProps(AutoDirectiveWidget);
`;

      const result = await codeComponentsCreateOperation.execute(
        snap,
        {
          name: 'AutoDirectiveWidget',
          code: rawCodeWithoutDirective,
          defaultWidth: 320,
          defaultHeight: 240,
        },
        context,
      );

      expect(result.name).toBe('AutoDirectiveWidget');
      const saved = projectFS.readFile('components/AutoDirectiveWidget.tsx');
      expect(saved).toBeDefined();

      const lines = saved!.split('\n');
      expect(lines[0].trim()).toBe("'use client';");
      expect(saved).toContain('/** @defaultWidth 320 */');
      expect(saved).toContain('/** @defaultHeight 240 */');
    });

    it('preserves existing embedded annotations and avoids duplicates', async () => {
      const snap = createMockSnapshot({});
      const codeWithWidthOnly = `'use client';
/** @defaultWidth 550 */
/** @controls {
  "label": { "type": "text", "label": "Label", "default": "Partial" }
} */
import React from 'react';
import { withResponsiveProps } from '@revyme/runtime';

function PartialWidget(props: { label?: string }) {
  return <div>{props.label}</div>;
}

export default withResponsiveProps(PartialWidget);
`;

      const result = await codeComponentsCreateOperation.execute(
        snap,
        {
          name: 'PartialWidget',
          code: codeWithWidthOnly,
          defaultWidth: 999, // should be ignored since @defaultWidth already present
          defaultHeight: 333, // should be added
        },
        context,
      );

      expect(result.name).toBe('PartialWidget');
      const saved = projectFS.readFile('components/PartialWidget.tsx');
      expect(saved).toBeDefined();
      expect(saved!.split('\n')[0].trim()).toBe("'use client';");
      expect(saved).toContain('/** @defaultWidth 550 */');
      expect(saved).not.toContain('/** @defaultWidth 999 */');
      expect(saved).toContain('/** @defaultHeight 333 */');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Area 2: Input schema validation in codeComponentsCreateOperation.execute
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Area 2: Input schema validation in codeComponentsCreateOperation.execute', () => {
    const validBody = `'use client';
/** @defaultWidth 400 */
/** @defaultHeight 300 */
/** @controls { "msg": { "type": "text", "label": "Msg", "default": "hi" } } */
import React from 'react';
import { withResponsiveProps } from '@revyme/runtime';
function Comp() { return <div>hi</div>; }
export default withResponsiveProps(Comp);
`;

    it.each([
      ['kebab-case', 'my-custom-widget'],
      ['snake_case', 'my_custom_widget'],
      ['camelCase', 'myCustomWidget'],
      ['leading digit', '123Widget'],
      ['special dollar sign', 'Widget$Special'],
      ['special @', 'Widget@Hero'],
      ['special dot', 'Widget.Child'],
      ['empty string', ''],
      ['whitespace with spaces', 'My Widget'],
      ['trailing whitespace', 'MyWidget '],
      ['leading whitespace', ' MyWidget'],
    ])('rejects non-PascalCase name "%s" (%s) with validation error', async (_desc, invalidName) => {
      const snap = createMockSnapshot({});

      await expect(
        codeComponentsCreateOperation.execute(
          snap,
          {
            name: invalidName,
            code: validBody,
          },
          context,
        ),
      ).rejects.toThrow(/Component name must be PascalCase/);

      // Verify no file was created on projectFS
      const allFiles = projectFS.listFiles('components/');
      expect(allFiles.filter((f) => f.includes(invalidName))).toHaveLength(0);
    });

    it('accepts valid PascalCase component names', async () => {
      const snap = createMockSnapshot({});
      for (const validName of ['ValidWidget', 'A', 'Widget123', 'HeroSectionV2']) {
        const codeForComp = validBody.replace(/Comp/g, validName);
        const res = await codeComponentsCreateOperation.execute(
          snap,
          {
            name: validName,
            code: codeForComp,
          },
          context,
        );
        expect(res.name).toBe(validName);
        expect(res.path).toBe(`components/${validName}.tsx`);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Area 3: Protected system directories guard in codeFiles.submit
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Area 3: Protected system directories guard in codeFiles.submit', () => {
    it.each([
      ['_meta directory file', '_meta/preset-folders.json'],
      ['_meta nested file', '_meta/nested/deep/config.json'],
      ['_meta bare directory', '_meta'],
      ['.git HEAD', '.git/HEAD'],
      ['.git config', '.git/config'],
      ['.git bare directory', '.git'],
      ['node_modules package', 'node_modules/my-lib/index.js'],
      ['node_modules .bin', 'node_modules/.bin/run'],
      ['node_modules bare directory', 'node_modules'],
      ['.next cache', '.next/cache/build.json'],
      ['.next server', '.next/server/pages.js'],
      ['.next bare directory', '.next'],
      ['package.json', 'package.json'],
      ['tsconfig.json', 'tsconfig.json'],
      ['next.config.mjs', 'next.config.mjs'],
      ['next.config.js', 'next.config.js'],
    ])('rejects modification of protected system path "%s" (%s)', async (_desc, protectedPath) => {
      const snap = createMockSnapshot({});

      await expect(
        codeFilesSubmitOperation.execute(
          snap,
          {
            files: [{ path: protectedPath, code: 'malicious-content' }],
          },
          context,
        ),
      ).rejects.toThrow(/PROTECTED_PATH/);
    });

    it('rejects deletion (code: null) of protected system directories/files', async () => {
      const snap = createMockSnapshot({
        '_meta/preset-folders.json': '{}',
        'package.json': '{}',
      });

      await expect(
        codeFilesSubmitOperation.execute(
          snap,
          {
            files: [{ path: '_meta/preset-folders.json', code: null }],
          },
          context,
        ),
      ).rejects.toThrow(/PROTECTED_PATH/);

      await expect(
        codeFilesSubmitOperation.execute(
          snap,
          {
            files: [{ path: 'package.json', code: null }],
          },
          context,
        ),
      ).rejects.toThrow(/PROTECTED_PATH/);
    });

    it('enforces atomicity on batch submit: if one file targets a protected path, zero files are written', async () => {
      const snap = createMockSnapshot({
        'app/page.tsx': SAMPLE_PAGE_JSX,
      });

      await expect(
        codeFilesSubmitOperation.execute(
          snap,
          {
            files: [
              { path: 'components/ValidA.tsx', code: '// valid code A' },
              { path: 'node_modules/hack.js', code: '// backdoor' },
              { path: 'components/ValidB.tsx', code: '// valid code B' },
            ],
          },
          context,
        ),
      ).rejects.toThrow(/PROTECTED_PATH/);

      // Verify zero files written
      expect(projectFS.readFile('components/ValidA.tsx')).toBeNull();
      expect(projectFS.readFile('components/ValidB.tsx')).toBeNull();
      expect(projectFS.readFile('node_modules/hack.js')).toBeNull();
    });

    it('allows submitting legitimate project files in app, components, lib, overrides, public', async () => {
      const snap = createMockSnapshot({});

      const validComp = `'use client';
/** @defaultWidth 400 */
/** @defaultHeight 300 */
/** @controls { "msg": { "type": "text", "label": "Msg", "default": "hi" } } */
import React from 'react';
import { withResponsiveProps } from '@revyme/runtime';
function Header() { return <div>hi</div>; }
export default withResponsiveProps(Header);
`;

      const result = await codeFilesSubmitOperation.execute(
        snap,
        {
          files: [
            { path: 'components/Header.tsx', code: validComp },
            { path: 'lib/utils.ts', code: 'export const x = 1;' },
            { path: 'overrides/Effects.tsx', code: '// effects' },
            { path: 'public/robots.txt', code: 'User-agent: *' },
          ],
        },
        context,
      );

      expect(result.committed).toBe(true);
      expect(result.changedFiles).toHaveLength(4);
      expect(projectFS.readFile('components/Header.tsx')).toBe(validComp);
      expect(projectFS.readFile('lib/utils.ts')).toBe('export const x = 1;');
      expect(projectFS.readFile('overrides/Effects.tsx')).toBe('// effects');
      expect(projectFS.readFile('public/robots.txt')).toBe('User-agent: *');
    });

    it('isSystemProtectedPath helper correctly identifies protected paths', () => {
      expect(isSystemProtectedPath('_meta')).toBe(true);
      expect(isSystemProtectedPath('_meta/folders.json')).toBe(true);
      expect(isSystemProtectedPath('.git')).toBe(true);
      expect(isSystemProtectedPath('.git/HEAD')).toBe(true);
      expect(isSystemProtectedPath('node_modules')).toBe(true);
      expect(isSystemProtectedPath('node_modules/pkg/index.js')).toBe(true);
      expect(isSystemProtectedPath('.next')).toBe(true);
      expect(isSystemProtectedPath('.next/build-manifest.json')).toBe(true);

      expect(isSystemProtectedPath('app/page.tsx')).toBe(false);
      expect(isSystemProtectedPath('components/Button.tsx')).toBe(false);
      expect(isSystemProtectedPath('overrides/Hover.tsx')).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Area 4: Override resolution in overrides.set
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Area 4: Override resolution in overrides.set', () => {
    it('resolves all 4 permutations: bare name, bare name with ext, prefixed without ext, prefixed with ext', async () => {
      const snap = createMockSnapshot({
        'overrides/HoverGlow.tsx': VALID_OVERRIDE_TSX,
        'app/page.tsx': SAMPLE_PAGE_JSX,
      });

      // Permutation 1: Bare name without prefix and without extension
      const res1 = await overridesSetOperation.execute(
        snap,
        {
          filePath: 'app/page.tsx',
          nodeId: 'cta-btn',
          overrides: [{ file: 'HoverGlow', name: 'withHoverGlow' }],
        },
        context,
      );
      expect(res1.overrides[0].file).toBe('overrides/HoverGlow.tsx');
      expect(projectFS.readFile('app/page.tsx')).toContain('<Override with={withHoverGlow}>');

      // Permutation 2: Bare name with .tsx extension
      const res2 = await overridesSetOperation.execute(
        snap,
        {
          filePath: 'app/page.tsx',
          nodeId: 'cta-btn',
          overrides: [{ file: 'HoverGlow.tsx', name: 'withHoverGlow' }],
        },
        context,
      );
      expect(res2.overrides[0].file).toBe('overrides/HoverGlow.tsx');

      // Permutation 3: Prefixed path without extension
      const res3 = await overridesSetOperation.execute(
        snap,
        {
          filePath: 'app/page.tsx',
          nodeId: 'cta-btn',
          overrides: [{ file: 'overrides/HoverGlow', name: 'withHoverGlow' }],
        },
        context,
      );
      expect(res3.overrides[0].file).toBe('overrides/HoverGlow.tsx');

      // Permutation 4: Full prefixed path with .tsx extension
      const res4 = await overridesSetOperation.execute(
        snap,
        {
          filePath: 'app/page.tsx',
          nodeId: 'cta-btn',
          overrides: [{ file: 'overrides/HoverGlow.tsx', name: 'withHoverGlow' }],
        },
        context,
      );
      expect(res4.overrides[0].file).toBe('overrides/HoverGlow.tsx');
    });

    it('resolves override files with .ts extension on disk', async () => {
      const snap = createMockSnapshot({
        'overrides/HelperHoc.ts': VALID_OVERRIDE_TS,
        'app/page.tsx': SAMPLE_PAGE_JSX,
      });

      // Without extension and without prefix -> resolves to .ts
      const res1 = await overridesSetOperation.execute(
        snap,
        {
          filePath: 'app/page.tsx',
          nodeId: 'cta-btn',
          overrides: [{ file: 'HelperHoc', name: 'withHelper' }],
        },
        context,
      );
      expect(res1.overrides[0].file).toBe('overrides/HelperHoc.ts');

      // With prefix and without extension -> resolves to .ts
      const res2 = await overridesSetOperation.execute(
        snap,
        {
          filePath: 'app/page.tsx',
          nodeId: 'cta-btn',
          overrides: [{ file: 'overrides/HelperHoc', name: 'withHelper' }],
        },
        context,
      );
      expect(res2.overrides[0].file).toBe('overrides/HelperHoc.ts');

      // Explicit .ts with prefix
      const res3 = await overridesSetOperation.execute(
        snap,
        {
          filePath: 'app/page.tsx',
          nodeId: 'cta-btn',
          overrides: [{ file: 'overrides/HelperHoc.ts', name: 'withHelper' }],
        },
        context,
      );
      expect(res3.overrides[0].file).toBe('overrides/HelperHoc.ts');
    });

    it('trims leading and trailing whitespace from file input', async () => {
      const snap = createMockSnapshot({
        'overrides/HoverGlow.tsx': VALID_OVERRIDE_TSX,
        'app/page.tsx': SAMPLE_PAGE_JSX,
      });

      const res = await overridesSetOperation.execute(
        snap,
        {
          filePath: 'app/page.tsx',
          nodeId: 'cta-btn',
          overrides: [{ file: '   HoverGlow   ', name: 'withHoverGlow' }],
        },
        context,
      );
      expect(res.overrides[0].file).toBe('overrides/HoverGlow.tsx');
    });

    it('handles multiple overrides with mixed formats simultaneously', async () => {
      const snap = createMockSnapshot({
        'overrides/HoverGlow.tsx': VALID_OVERRIDE_TSX,
        'overrides/BorderGlow.tsx': VALID_BORDER_OVERRIDE,
        'app/page.tsx': SAMPLE_PAGE_JSX,
      });

      const res = await overridesSetOperation.execute(
        snap,
        {
          filePath: 'app/page.tsx',
          nodeId: 'cta-btn',
          overrides: [
            { file: 'HoverGlow', name: 'withHoverGlow' }, // bare
            { file: 'overrides/BorderGlow.tsx', name: 'withBorderGlow' }, // full
          ],
        },
        context,
      );

      expect(res.overrides).toHaveLength(2);
      expect(res.overrides[0].file).toBe('overrides/HoverGlow.tsx');
      expect(res.overrides[1].file).toBe('overrides/BorderGlow.tsx');

      const pageCode = projectFS.readFile('app/page.tsx');
      expect(pageCode).toContain('<Override with={[withHoverGlow, withBorderGlow]}>');
    });

    it('throws OVERRIDE_FILE_NOT_FOUND when file does not exist (both bare and prefixed)', async () => {
      const snap = createMockSnapshot({
        'app/page.tsx': SAMPLE_PAGE_JSX,
      });

      await expect(
        overridesSetOperation.execute(
          snap,
          {
            filePath: 'app/page.tsx',
            nodeId: 'cta-btn',
            overrides: [{ file: 'DoesNotExist', name: 'withSomething' }],
          },
          context,
        ),
      ).rejects.toThrow(/OVERRIDE_FILE_NOT_FOUND.*overrides\/DoesNotExist\.tsx/);

      await expect(
        overridesSetOperation.execute(
          snap,
          {
            filePath: 'app/page.tsx',
            nodeId: 'cta-btn',
            overrides: [{ file: 'overrides/DoesNotExist.tsx', name: 'withSomething' }],
          },
          context,
        ),
      ).rejects.toThrow(/OVERRIDE_FILE_NOT_FOUND.*overrides\/DoesNotExist\.tsx/);
    });

    it('throws OVERRIDE_EXPORT_NOT_FOUND when file exists but export does not', async () => {
      const snap = createMockSnapshot({
        'overrides/HoverGlow.tsx': VALID_OVERRIDE_TSX,
        'app/page.tsx': SAMPLE_PAGE_JSX,
      });

      await expect(
        overridesSetOperation.execute(
          snap,
          {
            filePath: 'app/page.tsx',
            nodeId: 'cta-btn',
            overrides: [{ file: 'HoverGlow', name: 'withNonExistent' }],
          },
          context,
        ),
      ).rejects.toThrow(/OVERRIDE_EXPORT_NOT_FOUND/);
    });

    it('allows clearing overrides by passing an empty overrides array', async () => {
      const snap = createMockSnapshot({
        'overrides/HoverGlow.tsx': VALID_OVERRIDE_TSX,
        'app/page.tsx': SAMPLE_PAGE_JSX,
      });

      // Set first
      await overridesSetOperation.execute(
        snap,
        {
          filePath: 'app/page.tsx',
          nodeId: 'cta-btn',
          overrides: [{ file: 'HoverGlow', name: 'withHoverGlow' }],
        },
        context,
      );
      expect(projectFS.readFile('app/page.tsx')).toContain('<Override with={withHoverGlow}>');

      // Clear
      const clearRes = await overridesSetOperation.execute(
        snap,
        {
          filePath: 'app/page.tsx',
          nodeId: 'cta-btn',
          overrides: [],
        },
        context,
      );
      expect(clearRes.overrides).toHaveLength(0);
      expect(projectFS.readFile('app/page.tsx')).not.toContain('<Override');
    });
  });
});
