// packages/automation-core/test/capabilities/T15-bindings.test.ts
import { describe, it, expect } from 'vitest';
import type { Snapshot, FileChange } from '../../src/contracts';
import { createSnapshot, createOperationContext } from '../../src/session';
import {
  variablesListOperation,
  variablesCreateOperation,
  variablesUpdateOperation,
  variablesRemoveOperation,
  variablesBindOperation,
  variablesUnbindOperation,
} from '../../src/operations/variables';
import {
  expressionsBindOperation,
  expressionsUnbindOperation,
  expressionsGetOperation,
  validateExpressionSyntax,
} from '../../src/operations/expressions';
import {
  pageInteractionsListOperation,
  pageInteractionsAddOperation,
  pageInteractionsRemoveOperation,
} from '../../src/operations/page-interactions';
import { parsePageInteractionsForNode } from '@/code/features/page-interactions';

const BASE_PAGE_TSX = `'use client';
import React from 'react';

/** @canvas { "responsive": { "_bp": [768, 375] } } */

export default function Page() {
  return (
    <div data-id="root" style={{ width: '100%', minHeight: '100vh', backgroundColor: '#ffffff' }}>
      <header data-id="header" style={{ padding: '20px' }}>
        <h1 data-id="title" style={{ fontSize: '32px' }}>Welcome</h1>
        <p data-id="desc" style={{ fontSize: '16px' }}>Subtitle</p>
      </header>
      <main data-id="main" style={{ padding: '20px' }}>
        <a data-id="cta" href="/start" style={{ display: 'inline-block', backgroundColor: '#0070f3', color: '#ffffff', padding: '10px 20px' }}>
          Get Started
        </a>
      </main>
    </div>
  );
}
`;

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

describe('T15: Page variables, expressions, bindings, and page interactions', () => {
  describe('1. Page Variables CRUD', () => {
    it('creates page variables, updates them, renames with hook sync, and cascades deletion', async () => {
      let snap = createMockSnapshot({ 'app/page.tsx': BASE_PAGE_TSX });
      const mutableFiles = new Map(snap.files);

      // List initially empty
      const initial = await variablesListOperation.execute(snap, { targetFile: 'app/page.tsx' }, mockContext);
      expect(initial.variables).toHaveLength(0);

      // Create variable 'ctaLabel'
      const createRes1 = await variablesCreateOperation.execute(
        snap,
        {
          targetFile: 'app/page.tsx',
          name: 'ctaLabel',
          type: 'text',
          defaultValue: 'Start Now',
          queryParam: 'cta',
          description: 'Call to action button text',
        },
        mockContext,
      );
      expect(createRes1.changes).toHaveLength(1);
      applyChanges(mutableFiles, createRes1.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      // Create variable 'ctaCount' (number)
      const createRes2 = await variablesCreateOperation.execute(
        snap,
        {
          targetFile: 'app/page.tsx',
          name: 'ctaCount',
          type: 'number',
          defaultValue: '0',
        },
        mockContext,
      );
      applyChanges(mutableFiles, createRes2.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      // Verify list returns both
      const listRes = await variablesListOperation.execute(snap, { targetFile: 'app/page.tsx' }, mockContext);
      expect(listRes.variables).toHaveLength(2);
      expect(listRes.variables.map((v) => v.name)).toEqual(['ctaLabel', 'ctaCount']);

      // Prevent duplicate creation
      await expect(
        variablesCreateOperation.execute(
          snap,
          {
            targetFile: 'app/page.tsx',
            name: 'ctaLabel',
            type: 'text',
          },
          mockContext,
        ),
      ).rejects.toThrow('Variable "ctaLabel" already exists');

      // Prevent invalid identifier name
      await expect(
        variablesCreateOperation.execute(
          snap,
          {
            targetFile: 'app/page.tsx',
            name: '123-invalid!',
            type: 'text',
          },
          mockContext,
        ),
      ).rejects.toThrow();

      // Update variable without renaming
      const updateRes1 = await variablesUpdateOperation.execute(
        snap,
        {
          targetFile: 'app/page.tsx',
          name: 'ctaLabel',
          updates: {
            defaultValue: 'Join Us Today',
          },
        },
        mockContext,
      );
      applyChanges(mutableFiles, updateRes1.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));
      const afterUpdate = await variablesListOperation.execute(snap, { targetFile: 'app/page.tsx' }, mockContext);
      expect(afterUpdate.variables.find((v) => v.name === 'ctaLabel')?.default).toBe('Join Us Today');

      // Bind ctaCount to a style property so useState hook is present
      const bindRes = await variablesBindOperation.execute(
        snap,
        {
          targetFile: 'app/page.tsx',
          nodeId: 'desc',
          property: 'opacity',
          varName: 'ctaCount',
        },
        mockContext,
      );
      applyChanges(mutableFiles, bindRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));
      expect(snap.files.get('app/page.tsx')).toContain('const [ctaCount, setCtaCount] = useState');

      // Rename variable ctaCount -> clickCounter
      const updateRes2 = await variablesUpdateOperation.execute(
        snap,
        {
          targetFile: 'app/page.tsx',
          name: 'ctaCount',
          updates: {
            name: 'clickCounter',
          },
        },
        mockContext,
      );
      applyChanges(mutableFiles, updateRes2.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));
      const codeAfterRename = snap.files.get('app/page.tsx')!;
      expect(codeAfterRename).toContain('clickCounter');
      expect(codeAfterRename).toContain('const [clickCounter, setClickCounter] = useState');
      expect(codeAfterRename).toContain('opacity: clickCounter');

      // Remove variable with cascade
      const removeRes = await variablesRemoveOperation.execute(
        snap,
        {
          targetFile: 'app/page.tsx',
          name: 'clickCounter',
          cascade: true,
        },
        mockContext,
      );
      applyChanges(mutableFiles, removeRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));
      const codeAfterRemove = snap.files.get('app/page.tsx')!;
      expect(codeAfterRemove).not.toContain('const [clickCounter, setClickCounter] = useState');
      const listAfterRemove = await variablesListOperation.execute(snap, { targetFile: 'app/page.tsx' }, mockContext);
      expect(listAfterRemove.variables.map((v) => v.name)).toEqual(['ctaLabel']);
    });
  });

  describe('2. Variable Style & Text Bindings (including Responsive)', () => {
    it('binds style and text variables, handles responsive breakpoint overrides, and unbinds cleanly', async () => {
      let snap = createMockSnapshot({ 'app/page.tsx': BASE_PAGE_TSX });
      const mutableFiles = new Map(snap.files);

      // Create variables
      let res = await variablesCreateOperation.execute(
        snap,
        {
          targetFile: 'app/page.tsx',
          name: 'brandColor',
          type: 'color',
          defaultValue: '#ff0000',
        },
        mockContext,
      );
      applyChanges(mutableFiles, res.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      res = await variablesCreateOperation.execute(
        snap,
        {
          targetFile: 'app/page.tsx',
          name: 'mobileBrandColor',
          type: 'color',
          defaultValue: '#00ff00',
        },
        mockContext,
      );
      applyChanges(mutableFiles, res.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      res = await variablesCreateOperation.execute(
        snap,
        {
          targetFile: 'app/page.tsx',
          name: 'headerTitle',
          type: 'text',
          defaultValue: 'Super Title',
        },
        mockContext,
      );
      applyChanges(mutableFiles, res.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      // Bind textContent to headerTitle
      const bindTextRes = await variablesBindOperation.execute(
        snap,
        {
          targetFile: 'app/page.tsx',
          nodeId: 'title',
          property: 'textContent',
          varName: 'headerTitle',
        },
        mockContext,
      );
      applyChanges(mutableFiles, bindTextRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));
      expect(snap.files.get('app/page.tsx')).toContain('{headerTitle}');
      expect(snap.files.get('app/page.tsx')).toContain('const [headerTitle, setHeaderTitle] = useState');

      // Bind style backgroundColor to brandColor
      const bindStyleRes = await variablesBindOperation.execute(
        snap,
        {
          targetFile: 'app/page.tsx',
          nodeId: 'cta',
          property: 'backgroundColor',
          varName: 'brandColor',
        },
        mockContext,
      );
      applyChanges(mutableFiles, bindStyleRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));
      expect(snap.files.get('app/page.tsx')).toContain('backgroundColor: brandColor');

      // Bind responsive style on Tablet (768px)
      const bindRespStyleRes = await variablesBindOperation.execute(
        snap,
        {
          targetFile: 'app/page.tsx',
          nodeId: 'cta',
          property: 'backgroundColor',
          varName: 'mobileBrandColor',
          vpWidth: 768,
          baseFallback: 'brandColor',
        },
        mockContext,
      );
      applyChanges(mutableFiles, bindRespStyleRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));
      const codeResp = snap.files.get('app/page.tsx')!;
      expect(codeResp).toContain('useMediaQuery');
      expect(codeResp).toContain('mobileBrandColor');

      // Unbind responsive style
      const unbindRespRes = await variablesUnbindOperation.execute(
        snap,
        {
          targetFile: 'app/page.tsx',
          nodeId: 'cta',
          property: 'backgroundColor',
          vpWidth: 768,
        },
        mockContext,
      );
      applyChanges(mutableFiles, unbindRespRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      // Unbind textContent with fallback
      const unbindTextRes = await variablesUnbindOperation.execute(
        snap,
        {
          targetFile: 'app/page.tsx',
          nodeId: 'title',
          property: 'textContent',
          fallbackValue: 'Static Title Restored',
        },
        mockContext,
      );
      applyChanges(mutableFiles, unbindTextRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));
      expect(snap.files.get('app/page.tsx')).toContain('Static Title Restored');
    });
  });

  describe('3. Dynamic Expressions & AST Inspector', () => {
    it('binds dynamic expressions to text, href, and src, inspects them, and rejects invalid syntax without eval', async () => {
      let snap = createMockSnapshot({ 'app/page.tsx': BASE_PAGE_TSX });
      const mutableFiles = new Map(snap.files);

      // Bind text expression: computed price or title
      const textExprRes = await expressionsBindOperation.execute(
        snap,
        {
          targetFile: 'app/page.tsx',
          nodeId: 'title',
          kind: 'text',
          expression: '`Price: $${(99 * 1.2).toFixed(2)}`',
        },
        mockContext,
      );
      applyChanges(mutableFiles, textExprRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      // Bind href expression
      const hrefExprRes = await expressionsBindOperation.execute(
        snap,
        {
          targetFile: 'app/page.tsx',
          nodeId: 'cta',
          kind: 'href',
          expression: '"/checkout?plan=" + planId',
        },
        mockContext,
      );
      applyChanges(mutableFiles, hrefExprRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      // Inspect bound expressions via expressions.get
      const inspectTitle = await expressionsGetOperation.execute(
        snap,
        {
          targetFile: 'app/page.tsx',
          nodeId: 'title',
        },
        mockContext,
      );
      expect(inspectTitle.text).toBe('`Price: $${(99 * 1.2).toFixed(2)}`');

      const inspectCta = await expressionsGetOperation.execute(
        snap,
        {
          targetFile: 'app/page.tsx',
          nodeId: 'cta',
        },
        mockContext,
      );
      expect(inspectCta.href).toBe('"/checkout?plan=" + planId');

      // Verify that invalid JS expression syntax throws error and is NEVER evaluated
      expect(() => validateExpressionSyntax('item.price +*')).toThrow(/Invalid JS expression syntax/);
      await expect(
        expressionsBindOperation.execute(
          snap,
          {
            targetFile: 'app/page.tsx',
            nodeId: 'title',
            kind: 'text',
            expression: 'const x = 1;', // Statements are not valid expressions
          },
          mockContext,
        ),
      ).rejects.toThrow();

      // Unbind dynamic expressions restoring static literals
      const unbindRes = await expressionsUnbindOperation.execute(
        snap,
        {
          targetFile: 'app/page.tsx',
          nodeId: 'cta',
          kind: 'href',
          fallbackValue: '/default-page',
        },
        mockContext,
      );
      applyChanges(mutableFiles, unbindRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));
      expect(snap.files.get('app/page.tsx')).toContain('href="/default-page"');
    });
  });

  describe('4. Page Interactions (Set Variable Triggers)', () => {
    it('wires click-driven variable updates, parses them cleanly, and removes them', async () => {
      let snap = createMockSnapshot({ 'app/page.tsx': BASE_PAGE_TSX });
      const mutableFiles = new Map(snap.files);

      // Create variable 'themeMode'
      const varRes = await variablesCreateOperation.execute(
        snap,
        {
          targetFile: 'app/page.tsx',
          name: 'themeMode',
          type: 'text',
          defaultValue: 'light',
        },
        mockContext,
      );
      applyChanges(mutableFiles, varRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      // Add click interaction on CTA button: setThemeMode('dark')
      const addRes1 = await pageInteractionsAddOperation.execute(
        snap,
        {
          targetFile: 'app/page.tsx',
          nodeId: 'cta',
          trigger: 'click',
          varName: 'themeMode',
          value: 'dark',
        },
        mockContext,
      );
      applyChanges(mutableFiles, addRes1.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));

      // Verify JSX has onClick handler and component has useState hook
      const code = snap.files.get('app/page.tsx')!;
      expect(code).toContain('onClick={() => setThemeMode("dark")}');
      expect(code).toContain('const [themeMode, setThemeMode] = useState("light")');

      // List interactions for node 'cta'
      const listRes1 = await pageInteractionsListOperation.execute(
        snap,
        {
          targetFile: 'app/page.tsx',
          nodeId: 'cta',
        },
        mockContext,
      );
      expect(listRes1.interactions).toHaveLength(1);
      expect(listRes1.interactions[0]).toMatchObject({
        nodeId: 'cta',
        trigger: 'click',
        varName: 'themeMode',
        value: 'dark',
      });

      // Verify parsePageInteractionsForNode agrees
      const parsedDirectly = parsePageInteractionsForNode(code, 'cta');
      expect(parsedDirectly).toHaveLength(1);
      expect(parsedDirectly[0].value).toBe('dark');

      // Remove the interaction
      const removeRes = await pageInteractionsRemoveOperation.execute(
        snap,
        {
          targetFile: 'app/page.tsx',
          nodeId: 'cta',
          trigger: 'click',
          varName: 'themeMode',
        },
        mockContext,
      );
      applyChanges(mutableFiles, removeRes.changes);
      snap = createMockSnapshot(Object.fromEntries(mutableFiles));
      const codeAfterRemove = snap.files.get('app/page.tsx')!;
      expect(codeAfterRemove).not.toContain('onClick');

      const listRes2 = await pageInteractionsListOperation.execute(
        snap,
        {
          targetFile: 'app/page.tsx',
          nodeId: 'cta',
        },
        mockContext,
      );
      expect(listRes2.interactions).toHaveLength(0);
    });
  });
});
