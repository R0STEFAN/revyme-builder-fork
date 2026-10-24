// packages/automation-core/test/capabilities/T20-code.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { Snapshot, FileChange } from '../../src/contracts';
import { createSnapshot, createOperationContext, prepareOperation } from '../../src/session';
import { createPlan } from '../../src/plan';
import { validatePlan } from '../../src/validate';
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

const SAMPLE_PAGE_JSX = `'use client';
import React from 'react';

export default function HomePage() {
  return (
    <div data-id="root" style={{ width: '100%', minHeight: '100vh', padding: '24px' }}>
      <h1 data-id="title" style={{ fontSize: '32px' }}>Welcome</h1>
      <button data-id="cta-btn" style={{ padding: '8px 16px', background: '#0070f3', color: '#fff' }}>
        Click me
      </button>
    </div>
  );
}
`;

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function createMockSnapshot(files: Record<string, string>): Snapshot {
  return createSnapshot({ projectId: 'test-project', branchId: 'main' }, 0, files);
}

describe('T20: Code Components, Overrides, Guarded Files, Global Code & Redirects', () => {
  const context = createOperationContext();

  it('validates override helpers without treating their JSX as a canvas page', async () => {
    const snapshot = createMockSnapshot({});
    const prepared = await prepareOperation(snapshot, 'overrides.create', {
      name: 'ExampleOverride',
      code: `import type { ComponentType } from 'react';\nexport function withHoverEffect<T extends object>(Component: ComponentType<T>) { return (props: T) => <Component {...props} />; }`,
    }, context);
    expect(prepared.ok).toBe(true);
    const result = prepared.data as { changes: FileChange[] };
    const plan = createPlan({
      scope: snapshot.scope,
      baseRevision: snapshot.revision,
      operationId: 'generated-override-oracle-regression',
      changes: result.changes,
    });

    const validation = validatePlan(snapshot, plan);
    expect(validation.issues).toEqual([]);
    expect(validation.ok).toBe(true);
  });

  it('accepts public asset URLs when the backing file exists in ProjectFS', () => {
    const original = SAMPLE_PAGE_JSX;
    const updated = original.replace(
      '<h1 data-id="title" style={{ fontSize: \'32px\' }}>Welcome</h1>',
      '<img data-id="uploaded-image" src="/assets/audit.svg" alt="Audit" />',
    );
    const snapshot = createMockSnapshot({
      'app/page.client.tsx': original,
      'public/assets/audit.svg': '<svg />',
    });
    const plan = createPlan({
      scope: snapshot.scope,
      baseRevision: snapshot.revision,
      operationId: 'uploaded-public-asset-image-regression',
      changes: [{
        path: 'app/page.client.tsx',
        beforeHash: sha256(original),
        content: updated,
      }],
    });

    const validation = validatePlan(snapshot, plan);
    expect(validation.issues.filter((issue) => issue.code === 'INVALID_IMAGE_SOURCE')).toEqual([]);
  });

  beforeEach(() => {
    for (const f of projectFS.listFiles()) {
      projectFS.deleteFile(f);
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Registry & Aliases Verification
  // ───────────────────────────────────────────────────────────────────────────
  describe('1. Registry Registration & Aliases', () => {
    it('registers all primary T20 operations in defaultRegistry', () => {
      expect(defaultRegistry.get('codeComponents.create')).toBeDefined();
      expect(defaultRegistry.get('codeComponents.get')).toBeDefined();
      expect(defaultRegistry.get('codeComponents.list')).toBeDefined();

      expect(defaultRegistry.get('codeFiles.list')).toBeDefined();
      expect(defaultRegistry.get('codeFiles.read')).toBeDefined();
      expect(defaultRegistry.get('codeFiles.search')).toBeDefined();
      expect(defaultRegistry.get('codeFiles.submit')).toBeDefined();

      expect(defaultRegistry.get('overrides.create')).toBeDefined();
      expect(defaultRegistry.get('overrides.list')).toBeDefined();
      expect(defaultRegistry.get('overrides.set')).toBeDefined();
      expect(defaultRegistry.get('overrides.remove')).toBeDefined();

      expect(defaultRegistry.get('customCode.get')).toBeDefined();
      expect(defaultRegistry.get('customCode.set')).toBeDefined();

      expect(defaultRegistry.get('redirects.list')).toBeDefined();
      expect(defaultRegistry.get('redirects.add')).toBeDefined();
      expect(defaultRegistry.get('redirects.remove')).toBeDefined();
      expect(defaultRegistry.get('redirects.reorder')).toBeDefined();
    });

    it('resolves compatibility aliases to their target operations', () => {
      expect(defaultRegistry.get('code-components.create')).toBe(codeComponentsCreateOperation);
      expect(defaultRegistry.get('code-components.get')).toBe(codeComponentsGetOperation);
      expect(defaultRegistry.get('code-components.list')).toBe(codeComponentsListOperation);
      expect(defaultRegistry.get('code.components.create')).toBe(codeComponentsCreateOperation);
      expect(defaultRegistry.get('code.components.get')).toBe(codeComponentsGetOperation);
      expect(defaultRegistry.get('code.components.list')).toBe(codeComponentsListOperation);

      expect(defaultRegistry.get('code-files.list')).toBe(codeFilesListOperation);
      expect(defaultRegistry.get('code-files.read')).toBe(codeFilesReadOperation);
      expect(defaultRegistry.get('code-files.search')).toBe(codeFilesSearchOperation);
      expect(defaultRegistry.get('code-files.submit')).toBe(codeFilesSubmitOperation);
      expect(defaultRegistry.get('code.files.get')).toBe(codeFilesReadOperation);
      expect(defaultRegistry.get('code.files.write')).toBe(codeFilesSubmitOperation);

      expect(defaultRegistry.get('overrides.apply')).toBe(overridesSetOperation);
      expect(defaultRegistry.get('code.overrides.create')).toBe(overridesCreateOperation);
      expect(defaultRegistry.get('code.overrides.apply')).toBe(overridesSetOperation);
      expect(defaultRegistry.get('code.overrides.remove')).toBe(overridesRemoveOperation);

      expect(defaultRegistry.get('custom-code.get')).toBe(customCodeGetOperation);
      expect(defaultRegistry.get('custom-code.set')).toBe(customCodeSetOperation);
      expect(defaultRegistry.get('customCode.getCustomCode')).toBe(customCodeGetOperation);
      expect(defaultRegistry.get('customCode.setCustomCode')).toBe(customCodeSetOperation);

      expect(defaultRegistry.get('redirects.create')).toBe(redirectsAddOperation);
      expect(defaultRegistry.get('redirects.delete')).toBe(redirectsRemoveOperation);
      expect(defaultRegistry.get('redirects.setOrder')).toBe(redirectsReorderOperation);
      expect(defaultRegistry.get('redirect-rules.list')).toBe(redirectsListOperation);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Code Components Lifecycle (@controls schema, parse, oracle)
  // ───────────────────────────────────────────────────────────────────────────
  describe('2. Code Components Lifecycle (codeComponents.create, get, list)', () => {
    const VALID_CODE_COMPONENT = `'use client';
/** @defaultWidth 450 */
/** @defaultHeight 320 */
/** @controls {
  "title": { "type": "text", "label": "Title", "default": "Interactive Card" },
  "count": { "type": "number", "label": "Count", "default": 10, "min": 0, "max": 100 },
  "active": { "type": "toggle", "label": "Active", "default": true },
  "accentColor": { "type": "color", "label": "Accent Color", "default": "#0070f3" },
  "variant": { "type": "select", "label": "Variant", "default": "compact", "options": [{ "label": "Compact", "value": "compact" }, { "label": "Expanded", "value": "expanded" }] }
} */
import React from 'react';
import { withResponsiveProps } from '@revyme/runtime';

function InteractiveWidget(props: {
  title?: string;
  count?: number;
  active?: boolean;
  accentColor?: string;
  variant?: string;
}) {
  return (
    <div style={{ padding: '16px', background: props.accentColor ?? '#0070f3' }}>
      <h3>{props.title ?? 'Interactive Card'}</h3>
      <p>Count: {props.count ?? 0}</p>
    </div>
  );
}

export default withResponsiveProps(InteractiveWidget);
`;

    it('creates a new code component with parsed @controls metadata and writes to components/', async () => {
      const snap = createMockSnapshot({});
      const result = await codeComponentsCreateOperation.execute(
        snap,
        {
          name: 'InteractiveWidget',
          code: VALID_CODE_COMPONENT,
          defaultWidth: 450,
          defaultHeight: 320,
        },
        context,
      );

      expect(result.name).toBe('InteractiveWidget');
      expect(result.path).toBe('components/InteractiveWidget.tsx');
      expect(result.meta).toBeDefined();
      expect(result.meta.controls.title.type).toBe('text');
      expect(result.meta.controls.count.type).toBe('number');
      expect(result.meta.controls.active.type).toBe('toggle');
      expect(result.meta.controls.accentColor.type).toBe('color');
      expect(result.meta.controls.variant.type).toBe('select');
      expect(result.changes.length).toBe(1);
      expect(result.changes[0].path).toBe('components/InteractiveWidget.tsx');

      expect(projectFS.readFile('components/InteractiveWidget.tsx')).toContain('InteractiveWidget');
    });

    it('creates a component with a null beforeHash when stale ProjectFS state contains that path', async () => {
      projectFS.writeFile('components/InteractiveWidget.tsx', 'stale local component');

      const result = await codeComponentsCreateOperation.execute(
        createMockSnapshot({}),
        { name: 'InteractiveWidget', code: VALID_CODE_COMPONENT, defaultWidth: 450, defaultHeight: 320 },
        context,
      );

      expect(result.changes).toEqual([
        expect.objectContaining({ path: 'components/InteractiveWidget.tsx', beforeHash: null }),
      ]);
    });

    it('preserves the original snapshot while preparing a new component plan', async () => {
      const snapshot = createMockSnapshot({});
      const prepared = await prepareOperation(
        snapshot,
        'codeComponents.create',
        { name: 'InteractiveWidget', code: VALID_CODE_COMPONENT, defaultWidth: 450, defaultHeight: 320 },
        context,
      );

      expect(prepared.ok).toBe(true);
      expect((prepared.data as { changes: FileChange[] }).changes).toEqual([
        expect.objectContaining({ path: 'components/InteractiveWidget.tsx', beforeHash: null }),
      ]);
      expect(snapshot.files.has('components/InteractiveWidget.tsx')).toBe(false);
    });

    it('reads and retrieves code component by name with parsed controls', async () => {
      const snap = createMockSnapshot({
        'components/InteractiveWidget.tsx': VALID_CODE_COMPONENT,
      });

      const res = await codeComponentsGetOperation.execute(
        snap,
        { name: 'InteractiveWidget' },
        context,
      );

      expect(res.name).toBe('InteractiveWidget');
      expect(res.path).toBe('components/InteractiveWidget.tsx');
      expect(res.meta).not.toBeNull();
      expect(Object.keys(res.meta!.controls)).toEqual([
        'title',
        'count',
        'active',
        'accentColor',
        'variant',
      ]);
      expect(res.code).toBe(VALID_CODE_COMPONENT);
    });

    it('lists all code components in components/ directory', async () => {
      const snap = createMockSnapshot({
        'components/InteractiveWidget.tsx': VALID_CODE_COMPONENT,
        'components/SecondWidget.tsx': `'use client';\n/** @controls { "msg": { "type": "text", "label": "Message" } } */\nimport React from 'react';\nimport { withResponsiveProps } from '@revyme/runtime';\nfunction SecondWidget() { return <div>Second</div>; }\nexport default withResponsiveProps(SecondWidget);`,
        'components/PlainDesignComponent.tsx': `'use client';\n/** @name "Plain" */\nimport React from 'react';\nimport { withResponsiveProps } from '@revyme/runtime';\nfunction Plain() { return <div data-id="p1">Plain</div>; }\nexport default withResponsiveProps(Plain);`,
      });

      const res = await codeComponentsListOperation.execute(snap, {}, context);
      expect(res.components.length).toBe(2);
      expect(res.components.map((c) => c.name).sort()).toEqual([
        'InteractiveWidget',
        'SecondWidget',
      ]);

      const interactive = res.components.find((c) => c.name === 'InteractiveWidget');
      expect(interactive?.controls).toEqual([
        'title',
        'count',
        'active',
        'accentColor',
        'variant',
      ]);
    });

    it('rejects component creation with non-PascalCase name', async () => {
      const snap = createMockSnapshot({});
      await expect(
        codeComponentsCreateOperation.execute(
          snap,
          {
            name: 'bad_name' as any,
            code: VALID_CODE_COMPONENT,
          },
          context,
        ),
      ).rejects.toThrow();
    });

    it('creates component with defaultWidth and defaultHeight inserted after use client directive', async () => {
      const snap = createMockSnapshot({});
      const codeWithoutDimensions = `'use client';
/** @controls {
  "label": { "type": "text", "label": "Label", "default": "Hello" }
} */
import React from 'react';
import { withResponsiveProps } from '@revyme/runtime';

function SizeWidget(props: { label?: string }) {
  return <div>{props.label}</div>;
}

export default withResponsiveProps(SizeWidget);
`;

      const result = await codeComponentsCreateOperation.execute(
        snap,
        {
          name: 'SizeWidget',
          code: codeWithoutDimensions,
          defaultWidth: 500,
          defaultHeight: 350,
        },
        context,
      );

      expect(result.name).toBe('SizeWidget');
      const saved = projectFS.readFile('components/SizeWidget.tsx');
      expect(saved).toBeDefined();
      expect(saved!.startsWith("'use client';\n")).toBe(true);
      expect(saved).toContain('/** @defaultWidth 500 */');
      expect(saved).toContain('/** @defaultHeight 350 */');
    });

    it('rejects component creation without @controls schema annotation', async () => {
      const snap = createMockSnapshot({});
      const noControls = `import React from 'react';\nexport default function NoControls() { return <div>Hello</div>; }`;
      await expect(
        codeComponentsCreateOperation.execute(
          snap,
          {
            name: 'NoControls',
            code: noControls,
          },
          context,
        ),
      ).rejects.toThrow(/INVALID_CONTROLS/);
    });

    it('rejects component creation when Oracle checkFile detects forbidden imports', async () => {
      const snap = createMockSnapshot({});
      const dangerousComponent = `/** @controls { "text": { "type": "text", "label": "Text" } } */
import React from 'react';
import fs from 'fs';

export default function Danger() {
  return <div>{String(fs)}</div>;
}
`;
      await expect(
        codeComponentsCreateOperation.execute(
          snap,
          {
            name: 'Danger',
            code: dangerousComponent,
          },
          context,
        ),
      ).rejects.toThrow(/ORACLE_VIOLATION/);
    });

    it('throws COMPONENT_NOT_FOUND when getting non-existent component', async () => {
      const snap = createMockSnapshot({});
      await expect(
        codeComponentsGetOperation.execute(snap, { name: 'NonExistent' }, context),
      ).rejects.toThrow(/COMPONENT_NOT_FOUND/);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Project Files Operations (list, read, search, guarded submit)
  // ───────────────────────────────────────────────────────────────────────────
  describe('3. Code Files Operations (codeFiles.list, read, search, submit)', () => {
    it('lists project files while filtering out protected paths and honoring directory/extension filters', async () => {
      const snap = createMockSnapshot({
        'app/page.tsx': SAMPLE_PAGE_JSX,
        'app/about/page.tsx': SAMPLE_PAGE_JSX,
        'components/Hero.tsx': 'export default function Hero() { return <div data-id="h1">Hero</div>; }',
        'components/sub/Nav.tsx': 'export default function Nav() { return <div data-id="n1">Nav</div>; }',
        'styles/globals.css': 'body { margin: 0; }',
        '_meta/project.json': '{}',
        'node_modules/pkg/index.js': '// secret',
        '.git/config': 'git config',
      });

      // All files (unfiltered)
      const all = await codeFilesListOperation.execute(snap, {}, context);
      expect(all.files).toEqual([
        'app/about/page.tsx',
        'app/page.tsx',
        'components/Hero.tsx',
        'components/sub/Nav.tsx',
        'styles/globals.css',
      ]);
      expect(all.files.some((f) => f.startsWith('_meta/'))).toBe(false);
      expect(all.files.some((f) => f.startsWith('node_modules/'))).toBe(false);

      // Filtered by directory
      const inComp = await codeFilesListOperation.execute(
        snap,
        { directory: 'components/' },
        context,
      );
      expect(inComp.files).toEqual(['components/Hero.tsx', 'components/sub/Nav.tsx']);

      // Filtered by extension
      const cssFiles = await codeFilesListOperation.execute(
        snap,
        { extension: '.css' },
        context,
      );
      expect(cssFiles.files).toEqual(['styles/globals.css']);
    });

    it('reads file content and handles 1-indexed line slicing', async () => {
      const snap = createMockSnapshot({
        'app/page.tsx': SAMPLE_PAGE_JSX,
      });

      // Full file read
      const full = await codeFilesReadOperation.execute(snap, { path: 'app/page.tsx' }, context);
      expect(full.path).toBe('app/page.tsx');
      expect(full.totalLines).toBe(SAMPLE_PAGE_JSX.split('\n').length);
      expect(full.content).toBe(SAMPLE_PAGE_JSX);
      expect(full.sliceLines).toBeUndefined();

      // Sliced read lines 4 to 8
      const sliced = await codeFilesReadOperation.execute(
        snap,
        { path: 'app/page.tsx', fromLine: 4, toLine: 8 },
        context,
      );
      expect(sliced.sliceLines).toEqual({ from: 4, to: 8 });
      const expectedLines = SAMPLE_PAGE_JSX.split('\n').slice(3, 8).join('\n');
      expect(sliced.content).toBe(expectedLines);
    });

    it('prevents path traversal on codeFiles.read', async () => {
      const snap = createMockSnapshot({});
      await expect(
        codeFilesReadOperation.execute(snap, { path: '../etc/passwd' }, context),
      ).rejects.toThrow(/PATH_TRAVERSAL/);
      await expect(
        codeFilesReadOperation.execute(snap, { path: '/var/log/syslog' }, context),
      ).rejects.toThrow(/PATH_TRAVERSAL/);
    });

    it('searches project files with case-sensitivity and regex support', async () => {
      const snap = createMockSnapshot({
        'app/page.tsx': SAMPLE_PAGE_JSX,
        'components/Hero.tsx': 'export default function Hero() {\n  return <h1 data-id="h1">Hero Title</h1>;\n}',
      });

      // Case-insensitive literal search
      const res1 = await codeFilesSearchOperation.execute(
        snap,
        { query: 'welcome' },
        context,
      );
      expect(res1.matches.length).toBe(1);
      expect(res1.matches[0].path).toBe('app/page.tsx');
      expect(res1.matches[0].content).toContain('Welcome');

      // Case-sensitive search
      const res2 = await codeFilesSearchOperation.execute(
        snap,
        { query: 'welcome', caseSensitive: true },
        context,
      );
      expect(res2.matches.length).toBe(0);

      // Regex search
      const res3 = await codeFilesSearchOperation.execute(
        snap,
        { query: 'data-id="[^"]+"', isRegex: true },
        context,
      );
      expect(res3.matches.length).toBe(4); // root, title, cta-btn, h1
    });

    it('performs guarded batch submit with CAS hash matching, writes and deletes atomically', async () => {
      const initialContent = `'use client';
/** @name "Card" */
import React from 'react';
import { withResponsiveProps } from '@revyme/runtime';

function Card() {
  return <div data-id="c1">Old</div>;
}

export default withResponsiveProps(Card);
`;
      const initialHash = sha256(initialContent);

      const snap = createMockSnapshot({
        'components/Card.tsx': initialContent,
        'components/OldToRemove.tsx': `'use client';\n/** @name "OldToRemove" */\nimport React from 'react';\nimport { withResponsiveProps } from '@revyme/runtime';\nfunction OldToRemove() { return <div data-id="d1">Bye</div>; }\nexport default withResponsiveProps(OldToRemove);`,
      });

      const updatedContent = `'use client';
/** @name "Card" */
import React from 'react';
import { withResponsiveProps } from '@revyme/runtime';

function Card() {
  return <div data-id="c1">New</div>;
}

export default withResponsiveProps(Card);
`;
      const newFileContent = `'use client';
/** @name "Badge" */
import React from 'react';
import { withResponsiveProps } from '@revyme/runtime';

function Badge() {
  return <span data-id="b1">Badge</span>;
}

export default withResponsiveProps(Badge);
`;

      const submitRes = await codeFilesSubmitOperation.execute(
        snap,
        {
          files: [
            {
              path: 'components/Card.tsx',
              code: updatedContent,
              baseHash: initialHash,
            },
            {
              path: 'components/Badge.tsx',
              code: newFileContent,
            },
            {
              path: 'components/OldToRemove.tsx',
              code: null, // deletion
            },
          ],
        },
        context,
      );

      expect(submitRes.committed).toBe(true);
      expect(submitRes.changedFiles).toEqual([
        'components/Card.tsx',
        'components/Badge.tsx',
        'components/OldToRemove.tsx',
      ]);
      expect(projectFS.readFile('components/Card.tsx')).toBe(updatedContent);
      expect(projectFS.readFile('components/Badge.tsx')).toBe(newFileContent);
      expect(projectFS.readFile('components/OldToRemove.tsx')).toBeNull();
    });

    it('does not run the canvas Oracle on a Next.js server layout submission', async () => {
      const layout = `import './globals.css';
export const metadata = { title: 'Audit layout' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}`;
      const snap = createMockSnapshot({
        'app/layout.tsx': layout,
        'app/globals.css': ':root {}',
      });

      const result = await codeFilesSubmitOperation.execute(
        snap,
        { files: [{ path: 'app/layout.tsx', code: layout, kind: 'template' }] },
        context,
      );

      expect(result.committed).toBe(true);
      expect(projectFS.readFile('app/layout.tsx')).toBe(layout);
    });

    it('rejects batch submit with CAS conflict when baseHash does not match, writing zero files', async () => {
      const liveContent = 'export default function Live() { return <div data-id="l1">Live</div>; }';
      const staleHash = sha256('some-other-outdated-version');

      const snap = createMockSnapshot({
        'components/Live.tsx': liveContent,
        'components/Other.tsx': 'export default function Other() { return <div data-id="o1">Other</div>; }',
      });

      await expect(
        codeFilesSubmitOperation.execute(
          snap,
          {
            files: [
              {
                path: 'components/Live.tsx',
                code: 'export default function Live() { return <div data-id="l1">Corrupted</div>; }',
                baseHash: staleHash,
              },
              {
                path: 'components/Other.tsx',
                code: 'export default function Other() { return <div data-id="o1">Changed</div>; }',
              },
            ],
          },
          context,
        ),
      ).rejects.toThrow(/CAS_CONFLICT/);

      // Verify ZERO files were written
      expect(projectFS.readFile('components/Live.tsx')).toBe(liveContent);
      expect(projectFS.readFile('components/Other.tsx')).toContain('Other');
    });

    it('rejects batch submit attempting to overwrite protected system files (package.json, tsconfig.json)', async () => {
      const snap = createMockSnapshot({});
      await expect(
        codeFilesSubmitOperation.execute(
          snap,
          {
            files: [
              {
                path: 'package.json',
                code: '{"name": "hacked"}',
              },
            ],
          },
          context,
        ),
      ).rejects.toThrow(/PROTECTED_PATH/);
    });

    it('rejects batch submit attempting to modify system directories (_meta/, .git/, node_modules/, .next/)', async () => {
      const snap = createMockSnapshot({});
      for (const sysPath of [
        '_meta/preset-folders.json',
        '.git/HEAD',
        'node_modules/some-lib/index.js',
        '.next/cache/build.json',
      ]) {
        await expect(
          codeFilesSubmitOperation.execute(
            snap,
            {
              files: [{ path: sysPath, code: 'malicious' }],
            },
            context,
          ),
        ).rejects.toThrow(/PROTECTED_PATH/);
      }
    });

    it('rejects batch submit when any TSX file fails Oracle gate, writing zero files', async () => {
      const snap = createMockSnapshot({
        'app/page.tsx': SAMPLE_PAGE_JSX,
      });

      // Submit batch with 1 good file and 1 invalid TSX (syntax error)
      await expect(
        codeFilesSubmitOperation.execute(
          snap,
          {
            files: [
              {
                path: 'components/Good.tsx',
                code: 'export default function Good() { return <div data-id="g1">Good</div>; }',
              },
              {
                path: 'components/Broken.tsx',
                code: 'export default function Broken() { return <div >>SYNTAX ERROR; }',
              },
            ],
          },
          context,
        ),
      ).rejects.toThrow(/ORACLE_VIOLATION/);

      // Good file must NOT have been written
      expect(projectFS.readFile('components/Good.tsx')).toBeNull();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Code Overrides (create with withX, list, set on node, remove)
  // ───────────────────────────────────────────────────────────────────────────
  describe('4. Code Overrides (overrides.create, list, set, remove)', () => {
    const VALID_OVERRIDE_CODE = `import type { ComponentType } from 'react';

export function withHoverGlow<T extends object>(Component: ComponentType<T>) {
  return (props: T) => {
    return <Component {...props} style={{ ...((props as any).style || {}), filter: 'drop-shadow(0 0 8px #0070f3)' }} />;
  };
}

export function withScaleUp<T extends object>(Component: ComponentType<T>) {
  return (props: T) => {
    return <Component {...props} style={{ ...((props as any).style || {}), transform: 'scale(1.05)' }} />;
  };
}
`;

    it('creates an override file exporting withX HOC functions', async () => {
      const snap = createMockSnapshot({});
      const res = await overridesCreateOperation.execute(
        snap,
        {
          name: 'HoverGlow',
          code: VALID_OVERRIDE_CODE,
        },
        context,
      );

      expect(res.path).toBe('overrides/HoverGlow.tsx');
      expect(res.exports).toEqual(['withHoverGlow', 'withScaleUp']);
      expect(projectFS.readFile('overrides/HoverGlow.tsx')).toBe(VALID_OVERRIDE_CODE);
    });

    it('rejects override creation without withX exports or with default export', async () => {
      const snap = createMockSnapshot({});

      // No withX export
      const noWith = `export function helper() { return 42; }`;
      await expect(
        overridesCreateOperation.execute(snap, { name: 'BadOverride', code: noWith }, context),
      ).rejects.toThrow(/INVALID_OVERRIDE/);

      // Default export forbidden
      const defaultExp = `export default function withDefault(Comp: any) { return Comp; }`;
      await expect(
        overridesCreateOperation.execute(snap, { name: 'BadDefault', code: defaultExp }, context),
      ).rejects.toThrow(/DEFAULT_EXPORT_FORBIDDEN/);

      // Syntax error
      const badSyntax = `export function withBad( { broken syntax`;
      await expect(
        overridesCreateOperation.execute(snap, { name: 'BadSyntax', code: badSyntax }, context),
      ).rejects.toThrow(/SYNTAX_ERROR/);
    });

    it('lists available overrides and checks node attachments', async () => {
      const snap = createMockSnapshot({
        'overrides/HoverGlow.tsx': VALID_OVERRIDE_CODE,
        'app/page.tsx': SAMPLE_PAGE_JSX,
      });

      // List all override files
      const listRes = await overridesListOperation.execute(snap, {}, context);
      expect(listRes.files.length).toBe(1);
      expect(listRes.files[0].file).toBe('overrides/HoverGlow.tsx');
      expect(listRes.files[0].exports).toEqual(['withHoverGlow', 'withScaleUp']);
      expect(listRes.onNode).toBeUndefined();

      // Check node with no overrides
      const nodeCheck = await overridesListOperation.execute(
        snap,
        { filePath: 'app/page.tsx', nodeId: 'cta-btn' },
        context,
      );
      expect(nodeCheck.onNode).toEqual([]);
    });

    it('attaches override to canvas node, verifies JSX wrapping and import injection', async () => {
      const snap = createMockSnapshot({
        'overrides/HoverGlow.tsx': VALID_OVERRIDE_CODE,
        'app/page.tsx': SAMPLE_PAGE_JSX,
      });

      const setRes = await overridesSetOperation.execute(
        snap,
        {
          filePath: 'app/page.tsx',
          nodeId: 'cta-btn',
          overrides: [{ file: 'overrides/HoverGlow.tsx', name: 'withHoverGlow' }],
        },
        context,
      );

      expect(setRes.nodeId).toBe('cta-btn');
      expect(setRes.overrides).toEqual([
        { file: 'overrides/HoverGlow.tsx', name: 'withHoverGlow' },
      ]);

      const updatedPage = projectFS.readFile('app/page.tsx')!;
      expect(updatedPage).toContain("import { Override } from '@revyme/runtime';");
      expect(updatedPage).toContain("import { withHoverGlow } from '@/overrides/HoverGlow';");
      expect(updatedPage).toContain('<Override with={withHoverGlow}>');
      expect(updatedPage).toContain('<button data-id="cta-btn"');

      // Verify node list reflects attached override
      const listCheck = await overridesListOperation.execute(
        snap,
        { filePath: 'app/page.tsx', nodeId: 'cta-btn' },
        context,
      );
      expect(listCheck.onNode).toEqual([
        { file: 'overrides/HoverGlow.tsx', name: 'withHoverGlow' },
      ]);
    });

    it('removes override cleanly and strips unused imports', async () => {
      const pageWithOverride = `'use client';
import React from 'react';
import { Override } from '@revyme/runtime';
import { withHoverGlow } from '@/overrides/HoverGlow';

export default function HomePage() {
  return (
    <div data-id="root" style={{ width: '100%', minHeight: '100vh', padding: '24px' }}>
      <Override with={withHoverGlow}>
        <button data-id="cta-btn" style={{ padding: '8px 16px' }}>Click me</button>
      </Override>
    </div>
  );
}
`;
      const snap = createMockSnapshot({
        'overrides/HoverGlow.tsx': VALID_OVERRIDE_CODE,
        'app/page.tsx': pageWithOverride,
      });

      const remRes = await overridesRemoveOperation.execute(
        snap,
        { filePath: 'app/page.tsx', nodeId: 'cta-btn' },
        context,
      );

      expect(remRes.nodeId).toBe('cta-btn');
      expect(remRes.overrides).toEqual([]);

      const cleanedPage = projectFS.readFile('app/page.tsx')!;
      expect(cleanedPage).not.toContain('<Override');
      expect(cleanedPage).not.toContain('withHoverGlow');
      expect(cleanedPage).not.toContain('@/overrides/HoverGlow');
      expect(cleanedPage).toContain('<button data-id="cta-btn"');
    });

    it('throws error when setting non-existent override file or function', async () => {
      const snap = createMockSnapshot({
        'app/page.tsx': SAMPLE_PAGE_JSX,
      });

      await expect(
        overridesSetOperation.execute(
          snap,
          {
            filePath: 'app/page.tsx',
            nodeId: 'cta-btn',
            overrides: [{ file: 'overrides/DoesNotExist.tsx', name: 'withWhatever' }],
          },
          context,
        ),
      ).rejects.toThrow(/OVERRIDE_FILE_NOT_FOUND/);
    });

    it('handles ref.file resolution gracefully with or without .tsx extension and prefix', async () => {
      const snap = createMockSnapshot({
        'overrides/HoverGlow.tsx': VALID_OVERRIDE_CODE,
        'app/page.tsx': SAMPLE_PAGE_JSX,
      });

      // 1. Without extension and without overrides/ prefix
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
      const pageAfter1 = projectFS.readFile('app/page.tsx');
      expect(pageAfter1).toContain('<Override with={withHoverGlow}>');

      // 2. With extension and without overrides/ prefix
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

      // 3. Without extension and with overrides/ prefix
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
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Global Custom Code (headStart, headEnd, bodyStart, bodyEnd)
  // ───────────────────────────────────────────────────────────────────────────
  describe('5. Global Custom Code (customCode.get, customCode.set)', () => {
    it('returns empty null slots when app/_custom-code.json does not exist', async () => {
      const snap = createMockSnapshot({});
      const res = await customCodeGetOperation.execute(snap, {}, context);
      expect(res).toEqual({
        headStart: null,
        headEnd: null,
        bodyStart: null,
        bodyEnd: null,
      });
    });

    it('injects and updates custom scripts in head and body positions', async () => {
      const snap = createMockSnapshot({});

      // Set headStart script (e.g. tag manager)
      const gtmScript = '<script>window.dataLayer = window.dataLayer || [];</script>';
      const set1 = await customCodeSetOperation.execute(
        snap,
        { location: 'headStart', html: gtmScript },
        context,
      );
      expect(set1.location).toBe('headStart');

      // Set bodyEnd script (e.g. chat widget)
      const chatScript = '<script src="https://chat.example.com/widget.js" async></script>';
      await customCodeSetOperation.execute(
        snap,
        { location: 'bodyEnd', html: chatScript },
        context,
      );

      // Retrieve updated custom code
      const current = await customCodeGetOperation.execute(snap, {}, context);
      expect(current.headStart).toBe(gtmScript);
      expect(current.bodyEnd).toBe(chatScript);
      expect(current.headEnd).toBeNull();
      expect(current.bodyStart).toBeNull();

      // Clear headStart by setting to null
      await customCodeSetOperation.execute(
        snap,
        { location: 'headStart', html: null },
        context,
      );

      const afterClear = await customCodeGetOperation.execute(snap, {}, context);
      expect(afterClear.headStart).toBeNull();
      expect(afterClear.bodyEnd).toBe(chatScript);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 6. Site Redirects (list, add, remove, reorder, circular loop check)
  // ───────────────────────────────────────────────────────────────────────────
  describe('6. Site Redirects (redirects.list, add, remove, reorder)', () => {
    it('reads empty redirects initially when app/_redirects.json is absent', async () => {
      const snap = createMockSnapshot({});
      const res = await redirectsListOperation.execute(snap, {}, context);
      expect(res.redirects).toEqual([]);
    });

    it('adds URL redirects and generates unique IDs', async () => {
      const snap = createMockSnapshot({});
      const res = await redirectsAddOperation.execute(
        snap,
        {
          redirects: [
            { from: '/legacy', to: '/pricing', expandToAllLocales: true },
            { from: '/old-docs', to: '/docs' },
          ],
        },
        context,
      );

      expect(res.count).toBe(2);
      expect(res.ids.length).toBe(2);

      const list = await redirectsListOperation.execute(snap, {}, context);
      expect(list.redirects.length).toBe(2);
      expect(list.redirects[0].from).toBe('/legacy');
      expect(list.redirects[0].to).toBe('/pricing');
      expect(list.redirects[0].expandToAllLocales).toBe(true);
      expect(list.redirects[1].from).toBe('/old-docs');
      expect(list.redirects[1].to).toBe('/docs');
      expect(list.redirects[1].expandToAllLocales).toBe(false);
    });

    it('rejects self-redirects (/a -> /a)', async () => {
      const snap = createMockSnapshot({});
      await expect(
        redirectsAddOperation.execute(
          snap,
          {
            redirects: [{ from: '/pricing', to: '/pricing' }],
          },
          context,
        ),
      ).rejects.toThrow(/INVALID_REDIRECT/);
    });

    it('detects and rejects circular redirect loops (/a -> /b followed by /b -> /a)', async () => {
      const snap = createMockSnapshot({});
      await redirectsAddOperation.execute(
        snap,
        {
          redirects: [{ from: '/page-a', to: '/page-b' }],
        },
        context,
      );

      await expect(
        redirectsAddOperation.execute(
          snap,
          {
            redirects: [{ from: '/page-b', to: '/page-a' }],
          },
          context,
        ),
      ).rejects.toThrow(/REDIRECT_LOOP/);
    });

    it('removes redirects by ID', async () => {
      const snap = createMockSnapshot({});
      const addRes = await redirectsAddOperation.execute(
        snap,
        {
          redirects: [
            { from: '/one', to: '/1' },
            { from: '/two', to: '/2' },
          ],
        },
        context,
      );

      const idToRemove = addRes.ids[0];
      const remRes = await redirectsRemoveOperation.execute(
        snap,
        { redirectIds: [idToRemove] },
        context,
      );
      expect(remRes.removed).toEqual([idToRemove]);

      const list = await redirectsListOperation.execute(snap, {}, context);
      expect(list.redirects.length).toBe(1);
      expect(list.redirects[0].from).toBe('/two');
    });

    it('reorders redirects to configure matching priority', async () => {
      const snap = createMockSnapshot({});
      const addRes = await redirectsAddOperation.execute(
        snap,
        {
          redirects: [
            { from: '/a', to: '/target-a' },
            { from: '/b', to: '/target-b' },
            { from: '/c', to: '/target-c' },
          ],
        },
        context,
      );

      const [idA, idB, idC] = addRes.ids;
      // Reorder to C, A, B
      const reorderRes = await redirectsReorderOperation.execute(
        snap,
        { orderedIds: [idC, idA, idB] },
        context,
      );

      expect(reorderRes.orderedIds).toEqual([idC, idA, idB]);

      const list = await redirectsListOperation.execute(snap, {}, context);
      expect(list.redirects.map((r) => r.id)).toEqual([idC, idA, idB]);
      expect(list.redirects.map((r) => r.from)).toEqual(['/c', '/a', '/b']);
    });
  });
});
