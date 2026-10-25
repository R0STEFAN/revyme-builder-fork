// packages/automation-core/test/capabilities/T20-challenger1.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { Snapshot } from '../../src/contracts';
import { createSnapshot, createOperationContext } from '../../src/session';
import { defaultRegistry } from '../../src/registry';
import {
  codeComponentsCreateOperation,
  codeComponentsCreateInputSchema,
  codeComponentsGetOperation,
  codeComponentsListOperation,
} from '../../src/operations/code-components';
import {
  codeFilesListOperation,
  codeFilesReadOperation,
  codeFilesSearchOperation,
  codeFilesSubmitOperation,
} from '../../src/operations/code-files';
import { projectFS } from '@/code/project/project-fs';

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function createMockSnapshot(files: Record<string, string>): Snapshot {
  return createSnapshot({ projectId: 'challenger1-project', branchId: 'main' }, 0, files);
}

const VALID_COMPONENT_CODE = `'use client';
/** @defaultWidth 400 */
/** @defaultHeight 300 */
/** @controls {
  "label": { "type": "text", "label": "Button Label", "default": "Click Me" },
  "count": { "type": "number", "label": "Initial Count", "default": 0 }
} */
import React from 'react';
import { withResponsiveProps } from '@revyme/runtime';

function ValidWidget(props: { label?: string; count?: number }) {
  return (
    <div style={{ padding: '16px' }}>
      <span>{props.label ?? 'Click Me'}: {props.count ?? 0}</span>
    </div>
  );
}

export default withResponsiveProps(ValidWidget);
`;

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

describe('T20 Challenger 1: Adversarial Suite for Code Components, Guarded Files & CAS', () => {
  const context = createOperationContext();

  beforeEach(() => {
    for (const f of projectFS.listFiles()) {
      projectFS.deleteFile(f);
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. Adversarial Testing of codeComponents.create
  // =========================================================================
  describe('1. Adversarial codeComponents.create', () => {
    describe('Component Name Validation (PascalCase)', () => {
      it('inputSchema rejects non-PascalCase names', () => {
        expect(() =>
          codeComponentsCreateInputSchema.parse({
            name: 'lowercaseWidget',
            code: VALID_COMPONENT_CODE,
          }),
        ).toThrow(/Component name must be PascalCase/);

        expect(() =>
          codeComponentsCreateInputSchema.parse({
            name: 'my-widget',
            code: VALID_COMPONENT_CODE,
          }),
        ).toThrow(/Component name must be PascalCase/);

        expect(() =>
          codeComponentsCreateInputSchema.parse({
            name: 'my_widget',
            code: VALID_COMPONENT_CODE,
          }),
        ).toThrow(/Component name must be PascalCase/);

        expect(() =>
          codeComponentsCreateInputSchema.parse({
            name: '123Widget',
            code: VALID_COMPONENT_CODE,
          }),
        ).toThrow(/Component name must be PascalCase/);

        expect(() =>
          codeComponentsCreateInputSchema.parse({
            name: '',
            code: VALID_COMPONENT_CODE,
          }),
        ).toThrow(/Component name must be PascalCase/);

        expect(() =>
          codeComponentsCreateInputSchema.parse({
            name: 'Widget$Special',
            code: VALID_COMPONENT_CODE,
          }),
        ).toThrow(/Component name must be PascalCase/);
      });

      it('defaultRegistry.validateInput rejects non-PascalCase names', () => {
        const val1 = defaultRegistry.validateInput('codeComponents.create', {
          name: 'my-widget',
          code: VALID_COMPONENT_CODE,
        });
        expect(val1.ok).toBe(false);

        const val2 = defaultRegistry.validateInput('codeComponents.create', {
          name: '',
          code: VALID_COMPONENT_CODE,
        });
        expect(val2.ok).toBe(false);
      });

      it('rejects non-PascalCase names in codeComponentsCreateOperation.execute (e.g. my-widget, Widget$Special)', async () => {
        const snap = createMockSnapshot({});
        await expect(
          codeComponentsCreateOperation.execute(
            snap,
            { name: 'my-widget', code: VALID_COMPONENT_CODE },
            context,
          ),
        ).rejects.toThrow(/PascalCase/);

        await expect(
          codeComponentsCreateOperation.execute(
            snap,
            { name: 'Widget$Special', code: VALID_COMPONENT_CODE },
            context,
          ),
        ).rejects.toThrow(/PascalCase/);
      });

      it('accepts valid PascalCase name', async () => {
        const snap = createMockSnapshot({});
        const res = await codeComponentsCreateOperation.execute(
          snap,
          { name: 'ValidWidget', code: VALID_COMPONENT_CODE },
          context,
        );
        expect(res.name).toBe('ValidWidget');
        expect(res.path).toBe('components/ValidWidget.tsx');
      });
    });

    describe('@controls Annotation Validation', () => {
      it('rejects code component missing @controls annotation completely', async () => {
        const snap = createMockSnapshot({});
        const codeWithoutControls = `'use client';
/** @defaultWidth 400 */
/** @defaultHeight 300 */
import React from 'react';
import { withResponsiveProps } from '@revyme/runtime';

function MissingControls() {
  return <div>Missing Controls</div>;
}

export default withResponsiveProps(MissingControls);
`;
        await expect(
          codeComponentsCreateOperation.execute(
            snap,
            { name: 'MissingControls', code: codeWithoutControls },
            context,
          ),
        ).rejects.toThrow(/INVALID_CONTROLS/);
      });

      it('rejects code component with malformed JSON in @controls annotation', async () => {
        const snap = createMockSnapshot({});
        const codeWithBrokenJson = `'use client';
/** @defaultWidth 400 */
/** @defaultHeight 300 */
/** @controls { "title": { type: text, unquoted } } */
import React from 'react';
import { withResponsiveProps } from '@revyme/runtime';

function BrokenJson() {
  return <div>Broken JSON</div>;
}

export default withResponsiveProps(BrokenJson);
`;
        await expect(
          codeComponentsCreateOperation.execute(
            snap,
            { name: 'BrokenJson', code: codeWithBrokenJson },
            context,
          ),
        ).rejects.toThrow(/INVALID_CONTROLS/);
      });

      it('rejects code component with invalid control type via Oracle gate', async () => {
        const snap = createMockSnapshot({});
        const codeWithUnknownType = `'use client';
/** @defaultWidth 400 */
/** @defaultHeight 300 */
/** @controls {
  "myProp": { "type": "hyperlink", "label": "Link", "default": "https://example.com" }
} */
import React from 'react';
import { withResponsiveProps } from '@revyme/runtime';

function BadControlType() {
  return <div>Bad Control Type</div>;
}

export default withResponsiveProps(BadControlType);
`;
        await expect(
          codeComponentsCreateOperation.execute(
            snap,
            { name: 'BadControlType', code: codeWithUnknownType },
            context,
          ),
        ).rejects.toThrow(/ORACLE_VIOLATION.*CODE_COMPONENT_CONTROLS_INVALID/);
      });

      it('rejects code component missing control default value via Oracle gate', async () => {
        const snap = createMockSnapshot({});
        const codeWithoutDefault = `'use client';
/** @defaultWidth 400 */
/** @defaultHeight 300 */
/** @controls {
  "myProp": { "type": "text", "label": "Text Label" }
} */
import React from 'react';
import { withResponsiveProps } from '@revyme/runtime';

function NoDefaultControl() {
  return <div>No Default</div>;
}

export default withResponsiveProps(NoDefaultControl);
`;
        await expect(
          codeComponentsCreateOperation.execute(
            snap,
            { name: 'NoDefaultControl', code: codeWithoutDefault },
            context,
          ),
        ).rejects.toThrow(/ORACLE_VIOLATION.*CODE_COMPONENT_CONTROLS_INVALID/);
      });
    });

    describe('Prohibited Imports & Oracle Fatal Violations', () => {
      it('rejects component importing "fs"', async () => {
        const snap = createMockSnapshot({});
        const codeWithFs = `'use client';
/** @defaultWidth 400 */
/** @defaultHeight 300 */
/** @controls { "msg": { "type": "text", "label": "Msg", "default": "test" } } */
import React from 'react';
import fs from 'fs';
import { withResponsiveProps } from '@revyme/runtime';

function FsComp() {
  return <div>{String(fs)}</div>;
}

export default withResponsiveProps(FsComp);
`;
        await expect(
          codeComponentsCreateOperation.execute(
            snap,
            { name: 'FsComp', code: codeWithFs },
            context,
          ),
        ).rejects.toThrow(/ORACLE_VIOLATION.*FORBIDDEN_IMPORT/);
      });

      it('rejects component importing "child_process"', async () => {
        const snap = createMockSnapshot({});
        const codeWithChildProc = `'use client';
/** @defaultWidth 400 */
/** @defaultHeight 300 */
/** @controls { "msg": { "type": "text", "label": "Msg", "default": "test" } } */
import React from 'react';
import { spawn } from 'child_process';
import { withResponsiveProps } from '@revyme/runtime';

function ChildProcComp() {
  return <div>{String(spawn)}</div>;
}

export default withResponsiveProps(ChildProcComp);
`;
        await expect(
          codeComponentsCreateOperation.execute(
            snap,
            { name: 'ChildProcComp', code: codeWithChildProc },
            context,
          ),
        ).rejects.toThrow(/ORACLE_VIOLATION.*FORBIDDEN_IMPORT/);
      });

      it('rejects component importing "net"', async () => {
        const snap = createMockSnapshot({});
        const codeWithNet = `'use client';
/** @defaultWidth 400 */
/** @defaultHeight 300 */
/** @controls { "msg": { "type": "text", "label": "Msg", "default": "test" } } */
import React from 'react';
import net from 'net';
import { withResponsiveProps } from '@revyme/runtime';

function NetComp() {
  return <div>{String(net)}</div>;
}

export default withResponsiveProps(NetComp);
`;
        await expect(
          codeComponentsCreateOperation.execute(
            snap,
            { name: 'NetComp', code: codeWithNet },
            context,
          ),
        ).rejects.toThrow(/ORACLE_VIOLATION.*FORBIDDEN_IMPORT/);
      });

      it('rejects component importing "gsap" via GSAP_FORBIDDEN', async () => {
        const snap = createMockSnapshot({});
        const codeWithGsap = `'use client';
/** @defaultWidth 400 */
/** @defaultHeight 300 */
/** @controls { "msg": { "type": "text", "label": "Msg", "default": "test" } } */
import React from 'react';
import gsap from 'gsap';
import { withResponsiveProps } from '@revyme/runtime';

function GsapComp() {
  return <div>{String(gsap)}</div>;
}

export default withResponsiveProps(GsapComp);
`;
        await expect(
          codeComponentsCreateOperation.execute(
            snap,
            { name: 'GsapComp', code: codeWithGsap },
            context,
          ),
        ).rejects.toThrow(/ORACLE_VIOLATION.*GSAP_FORBIDDEN/);
      });

      it('rejects component missing @defaultWidth or @defaultHeight size annotations', async () => {
        const snap = createMockSnapshot({});
        const codeWithoutSize = `'use client';
/** @controls { "msg": { "type": "text", "label": "Msg", "default": "test" } } */
import React from 'react';
import { withResponsiveProps } from '@revyme/runtime';

function NoSizeComp() {
  return <div>No Size</div>;
}

export default withResponsiveProps(NoSizeComp);
`;
        await expect(
          codeComponentsCreateOperation.execute(
            snap,
            { name: 'NoSizeComp', code: codeWithoutSize },
            context,
          ),
        ).rejects.toThrow(/ORACLE_VIOLATION.*CODE_COMPONENT_MISSING_DEFAULT_SIZE/);
      });

      it('rejects component whose exported function name does not match component name', async () => {
        const snap = createMockSnapshot({});
        const codeMismatchedName = `'use client';
/** @defaultWidth 400 */
/** @defaultHeight 300 */
/** @controls { "msg": { "type": "text", "label": "Msg", "default": "test" } } */
import React from 'react';
import { withResponsiveProps } from '@revyme/runtime';

function DifferentFunctionName() {
  return <div>Mismatched Name</div>;
}

export default withResponsiveProps(DifferentFunctionName);
`;
        await expect(
          codeComponentsCreateOperation.execute(
            snap,
            { name: 'ExpectedName', code: codeMismatchedName },
            context,
          ),
        ).rejects.toThrow(/ORACLE_VIOLATION.*COMPONENT_NAME_MATCHES_FILE/);
      });

      it('successfully places defaultWidth/defaultHeight after "use client", passing Oracle USE_CLIENT_REQUIRED', async () => {
        const snap = createMockSnapshot({});
        // Code has 'use client' and valid controls, but delegates dimensions to input parameters
        const codeDelegatingDimensions = `'use client';
/** @controls {
  "msg": { "type": "text", "label": "Msg", "default": "test" }
} */
import React from 'react';
import { withResponsiveProps } from '@revyme/runtime';

function DimensionBugWidget() {
  return <div>Test</div>;
}

export default withResponsiveProps(DimensionBugWidget);
`;

        const res = await codeComponentsCreateOperation.execute(
          snap,
          {
            name: 'DimensionBugWidget',
            code: codeDelegatingDimensions,
            defaultWidth: 400,
            defaultHeight: 300,
          },
          context,
        );

        expect(res.name).toBe('DimensionBugWidget');
        const savedCode = projectFS.readFile('components/DimensionBugWidget.tsx');
        expect(savedCode).toBeDefined();
        // 'use client' must be the very first line
        expect(savedCode!.startsWith("'use client';\n")).toBe(true);
        expect(savedCode).toContain('/** @defaultWidth 400 */');
        expect(savedCode).toContain('/** @defaultHeight 300 */');
      });
    });
  });

  // =========================================================================
  // 2. Adversarial Testing of codeFiles.submit
  // =========================================================================
  describe('2. Adversarial codeFiles.submit', () => {
    describe('Path Traversal Resistance', () => {
      it('rejects relative parent directory traversal (../secret.txt)', async () => {
        const snap = createMockSnapshot({});
        await expect(
          codeFilesSubmitOperation.execute(
            snap,
            {
              files: [{ path: '../secret.txt', code: 'forbidden' }],
            },
            context,
          ),
        ).rejects.toThrow(/PATH_TRAVERSAL/);
      });

      it('rejects root path traversal (/etc/passwd)', async () => {
        const snap = createMockSnapshot({});
        await expect(
          codeFilesSubmitOperation.execute(
            snap,
            {
              files: [{ path: '/etc/passwd', code: 'forbidden' }],
            },
            context,
          ),
        ).rejects.toThrow(/PATH_TRAVERSAL/);
      });

      it('rejects nested parent directory traversal (components/../../etc/passwd)', async () => {
        const snap = createMockSnapshot({});
        await expect(
          codeFilesSubmitOperation.execute(
            snap,
            {
              files: [{ path: 'components/../../etc/passwd', code: 'forbidden' }],
            },
            context,
          ),
        ).rejects.toThrow(/PATH_TRAVERSAL/);
      });

      it('rejects windows drive letter path (C:\\secret.txt)', async () => {
        const snap = createMockSnapshot({});
        await expect(
          codeFilesSubmitOperation.execute(
            snap,
            {
              files: [{ path: 'C:\\secret.txt', code: 'forbidden' }],
            },
            context,
          ),
        ).rejects.toThrow(/PATH_TRAVERSAL/);
      });

      it('rejects windows backslash root (\\windows\\win.ini)', async () => {
        const snap = createMockSnapshot({});
        await expect(
          codeFilesSubmitOperation.execute(
            snap,
            {
              files: [{ path: '\\windows\\win.ini', code: 'forbidden' }],
            },
            context,
          ),
        ).rejects.toThrow(/PATH_TRAVERSAL/);
      });

      it('rejects path containing null byte', async () => {
        const snap = createMockSnapshot({});
        await expect(
          codeFilesSubmitOperation.execute(
            snap,
            {
              files: [{ path: 'components/evil\0file.tsx', code: 'forbidden' }],
            },
            context,
          ),
        ).rejects.toThrow(/PATH_TRAVERSAL/);
      });

      it('rejects empty string path', async () => {
        const snap = createMockSnapshot({});
        await expect(
          codeFilesSubmitOperation.execute(
            snap,
            {
              files: [{ path: '', code: 'forbidden' }],
            },
            context,
          ),
        ).rejects.toThrow();
      });
    });

    describe('Protected System Files Guard', () => {
      it('rejects modification of package.json', async () => {
        const snap = createMockSnapshot({});
        await expect(
          codeFilesSubmitOperation.execute(
            snap,
            {
              files: [{ path: 'package.json', code: '{"name": "malicious"}' }],
            },
            context,
          ),
        ).rejects.toThrow(/PROTECTED_PATH/);
      });

      it('rejects modification of tsconfig.json', async () => {
        const snap = createMockSnapshot({});
        await expect(
          codeFilesSubmitOperation.execute(
            snap,
            {
              files: [{ path: 'tsconfig.json', code: '{"compilerOptions": {}}' }],
            },
            context,
          ),
        ).rejects.toThrow(/PROTECTED_PATH/);
      });

      it('rejects modification of next.config.mjs', async () => {
        const snap = createMockSnapshot({});
        await expect(
          codeFilesSubmitOperation.execute(
            snap,
            {
              files: [{ path: 'next.config.mjs', code: 'export default {};' }],
            },
            context,
          ),
        ).rejects.toThrow(/PROTECTED_PATH/);
      });

      it('rejects modification of next.config.js', async () => {
        const snap = createMockSnapshot({});
        await expect(
          codeFilesSubmitOperation.execute(
            snap,
            {
              files: [{ path: 'next.config.js', code: 'module.exports = {};' }],
            },
            context,
          ),
        ).rejects.toThrow(/PROTECTED_PATH/);
      });

      it('rejects modification of system directories (_meta/, .git/, node_modules/, .next/)', async () => {
        const snap = createMockSnapshot({});
        for (const forbidden of [
          '_meta/preset-folders.json',
          '.git/config',
          'node_modules/pkg/index.js',
          '.next/static/bundle.js',
        ]) {
          await expect(
            codeFilesSubmitOperation.execute(
              snap,
              {
                files: [{ path: forbidden, code: 'malicious' }],
              },
              context,
            ),
          ).rejects.toThrow(/PROTECTED_PATH/);
        }
      });
    });

    describe('CAS (Compare-And-Swap) Concurrency & Atomicity', () => {
      it('rejects submission when baseHash does not match existing content', async () => {
        const originalContent = 'export const foo = "original";';
        const snap = createMockSnapshot({
          'src/foo.ts': originalContent,
        });

        const staleHash = sha256('something else');
        await expect(
          codeFilesSubmitOperation.execute(
            snap,
            {
              files: [
                {
                  path: 'src/foo.ts',
                  code: 'export const foo = "updated";',
                  baseHash: staleHash,
                },
              ],
            },
            context,
          ),
        ).rejects.toThrow(/CAS_CONFLICT/);

        // Verify content unchanged
        expect(projectFS.readFile('src/foo.ts')).toBe(originalContent);
      });

      it('rejects batch submission atomically if any file has CAS conflict (zero files written)', async () => {
        const existingA = 'export const a = 1;';
        const existingB = 'export const b = 2;';
        const snap = createMockSnapshot({
          'src/a.ts': existingA,
          'src/b.ts': existingB,
        });

        const correctHashA = sha256(existingA);
        const incorrectHashB = sha256('wrong hash');

        await expect(
          codeFilesSubmitOperation.execute(
            snap,
            {
              files: [
                {
                  path: 'src/a.ts',
                  code: 'export const a = 999;',
                  baseHash: correctHashA, // Valid
                },
                {
                  path: 'src/b.ts',
                  code: 'export const b = 999;',
                  baseHash: incorrectHashB, // Conflict!
                },
                {
                  path: 'src/c.ts',
                  code: 'export const c = 3;', // New file
                },
              ],
            },
            context,
          ),
        ).rejects.toThrow(/CAS_CONFLICT/);

        // Verify ATOMICITY: None of the files were written!
        expect(projectFS.readFile('src/a.ts')).toBe(existingA);
        expect(projectFS.readFile('src/b.ts')).toBe(existingB);
        expect(projectFS.readFile('src/c.ts')).toBeNull();
      });

      it('rejects batch when baseHash is supplied for a non-existent file', async () => {
        const snap = createMockSnapshot({});
        await expect(
          codeFilesSubmitOperation.execute(
            snap,
            {
              files: [
                {
                  path: 'src/nonexistent.ts',
                  code: 'export const x = 1;',
                  baseHash: sha256('ghost content'),
                },
              ],
            },
            context,
          ),
        ).rejects.toThrow(/CAS_CONFLICT/);

        expect(projectFS.readFile('src/nonexistent.ts')).toBeNull();
      });
    });

    describe('Oracle Gate Rejection & Atomicity in Batch Submit', () => {
      it('rejects batch if any TSX file contains syntax error (zero files written)', async () => {
        const snap = createMockSnapshot({
          'app/page.tsx': SAMPLE_PAGE_JSX,
        });

        await expect(
          codeFilesSubmitOperation.execute(
            snap,
            {
              files: [
                {
                  path: 'components/Good.tsx',
                  code: VALID_COMPONENT_CODE,
                },
                {
                  path: 'components/Broken.tsx',
                  code: `'use client';\nexport default function Broken() { return <div >>>> broken syntax; }`,
                },
              ],
            },
            context,
          ),
        ).rejects.toThrow(/ORACLE_VIOLATION/);

        // Verify atomic rejection: neither file was written
        expect(projectFS.readFile('components/Good.tsx')).toBeNull();
        expect(projectFS.readFile('components/Broken.tsx')).toBeNull();
      });

      it('rejects batch if any TSX file imports forbidden packages (zero files written)', async () => {
        const snap = createMockSnapshot({});

        await expect(
          codeFilesSubmitOperation.execute(
            snap,
            {
              files: [
                {
                  path: 'components/ValidWidget.tsx',
                  code: VALID_COMPONENT_CODE,
                },
                {
                  path: 'components/Bad.tsx',
                  code: `'use client';\n/** @defaultWidth 400 */\n/** @defaultHeight 300 */\n/** @controls { "t": { "type": "text", "label": "T", "default": "" } } */\nimport React from 'react';\nimport fs from 'fs';\nimport { withResponsiveProps } from '@revyme/runtime';\nfunction Bad() { return <div>{String(fs)}</div>; }\nexport default withResponsiveProps(Bad);`,
                },
              ],
            },
            context,
          ),
        ).rejects.toThrow(/ORACLE_VIOLATION.*FORBIDDEN_IMPORT/);

        expect(projectFS.readFile('components/ValidWidget.tsx')).toBeNull();
        expect(projectFS.readFile('components/Bad.tsx')).toBeNull();
      });

      it('successfully commits batch atomically when all files pass CAS and Oracle checks', async () => {
        const snap = createMockSnapshot({
          'components/ValidWidget.tsx': VALID_COMPONENT_CODE,
        });

        const initialHash = sha256(VALID_COMPONENT_CODE);
        const updatedWidget = VALID_COMPONENT_CODE.replace('Button Label', 'Updated Label');
        const secondWidget = `'use client';
/** @defaultWidth 300 */
/** @defaultHeight 200 */
/** @controls {
  "active": { "type": "toggle", "label": "Active", "default": true }
} */
import React from 'react';
import { withResponsiveProps } from '@revyme/runtime';

function SecondWidget(props: { active?: boolean }) {
  return <div style={{ opacity: props.active ? 1 : 0.5 }}>Second</div>;
}

export default withResponsiveProps(SecondWidget);
`;

        const res = await codeFilesSubmitOperation.execute(
          snap,
          {
            files: [
              {
                path: 'components/ValidWidget.tsx',
                code: updatedWidget,
                baseHash: initialHash,
              },
              {
                path: 'components/SecondWidget.tsx',
                code: secondWidget,
              },
            ],
          },
          context,
        );

        expect(res.committed).toBe(true);
        expect(res.changedFiles).toEqual(['components/ValidWidget.tsx', 'components/SecondWidget.tsx']);
        expect(projectFS.readFile('components/ValidWidget.tsx')).toBe(updatedWidget);
        expect(projectFS.readFile('components/SecondWidget.tsx')).toBe(secondWidget);
      });

      it('successfully allows referencing uploaded project assets in public/assets/ via /assets/ without INVALID_IMAGE_SOURCE', async () => {
        const snap = createMockSnapshot({
          'public/assets/hero.jpg': 'binary-hero-content',
        });

        const imageWidget = `'use client';
/** @name "ImageWidget" */
/** @defaultWidth 400 */
/** @defaultHeight 300 */
/** @controls {} */
import React from 'react';
import { withResponsiveProps } from '@revyme/runtime';

function ImageWidget() {
  return (
    <div data-id="img-root" style={{ width: '400px', height: '300px' }}>
      <img data-id="img-hero" src="/assets/hero.jpg" alt="Hero" style={{ width: '100%', height: '100%' }} />
    </div>
  );
}

export default withResponsiveProps(ImageWidget);
`;

        const res = await codeFilesSubmitOperation.execute(
          snap,
          {
            files: [
              {
                path: 'components/ImageWidget.tsx',
                code: imageWidget,
              },
            ],
          },
          context,
        );

        expect(res.committed).toBe(true);
        expect(projectFS.readFile('components/ImageWidget.tsx')).toBe(imageWidget);
      });
    });
  });
});
