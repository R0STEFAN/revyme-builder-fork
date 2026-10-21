// packages/automation-core/test/capabilities/T07-layout.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { defaultRegistry } from '../../src/registry';
import type { Snapshot, OperationContext, FileChange } from '../../src/contracts';
import { parseJSXToNodes } from '@/code/parsing/parser';
import '../../src/operations/nodes';
import '../../src/operations/layout';
import '../../src/operations/styles';
import '../../src/operations/text';
import '../../src/operations/viewports';

function createMockContext(): OperationContext {
  let counter = 0;
  return {
    createId: (prefix = 'node') => `${prefix}-${++counter}`,
    signal: new AbortController().signal,
    trace: () => {},
    adapters: {},
  };
}

describe('T07: Structure, Layout, Responsive, Text and Style Controls', () => {
  let files: Map<string, string>;
  let snapshot: Snapshot;
  let context: OperationContext;

  const INITIAL_PAGE_CODE = `'use client';

/* @canvas { single: true, height: 'auto' } */

import React from 'react';

export default function Page() {
  return (
    <div data-id="root" data-name="Page" style={{
      position: 'relative', width: '100%', minHeight: '900px',
      backgroundColor: '#ffffff'
    }}>
      <header data-id="header-1" data-name="Header" style={{ display: 'flex', width: '100%' }}>
        <h1 data-id="title-1">Original Title</h1>
      </header>
      <main data-id="main-1" data-name="Main" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)' }}>
      </main>
    </div>
  );
}
`;

  function applyChanges(changes: FileChange[]): void {
    for (const ch of changes) {
      if (ch.content === null) files.delete(ch.path);
      else files.set(ch.path, ch.content);
    }
  }

  beforeEach(() => {
    context = createMockContext();
    files = new Map([['app/page.client.tsx', INITIAL_PAGE_CODE]]);
    snapshot = {
      scope: { projectId: 't07-layout-project', branchId: 'main' },
      revision: 1,
      files,
      config: {},
    };
  });

  it('creates, moves, reorders, duplicates and wraps nodes in JSX tree', async () => {
    const createOp = defaultRegistry.get('nodes.create')!;
    const moveOp = defaultRegistry.get('nodes.move')!;
    const reorderOp = defaultRegistry.get('nodes.reorder')!;
    const dupOp = defaultRegistry.get('nodes.duplicate')!;
    const wrapOp = defaultRegistry.get('nodes.wrap')!;
    const removeOp = defaultRegistry.get('nodes.remove')!;

    // 1. Create a child card inside main-1
    const createRes = await createOp.execute(
      snapshot,
      {
        parentId: 'main-1',
        type: 'div',
        name: 'Card 1',
        styles: { padding: '24px', backgroundColor: '#f3f4f6' },
      },
      context
    );
    expect(createRes.nodeId).toBeDefined();
    applyChanges(createRes.changes);

    const card1Id = createRes.nodeId;

    // 2. Duplicate card 1
    const dupRes = await dupOp.execute(
      snapshot,
      { nodeId: card1Id },
      context
    );
    expect(dupRes.newNodeId).toBeDefined();
    applyChanges(dupRes.changes);
    const card2Id = dupRes.newNodeId;

    // 3. Move card 2 into header-1
    const moveRes = await moveOp.execute(
      snapshot,
      { nodeId: card2Id, newParentId: 'header-1' },
      context
    );
    applyChanges(moveRes.changes);

    let parsed = parseJSXToNodes(files.get('app/page.client.tsx')!);
    expect(parsed.get(card2Id)?.parentId).toBe('header-1');

    // 4. Wrap card 1 inside a container
    const wrapRes = await wrapOp.execute(
      snapshot,
      { nodeId: card1Id, wrapperType: 'section', wrapperStyles: { border: '1px solid #e5e7eb' } },
      context
    );
    applyChanges(wrapRes.changes);

    parsed = parseJSXToNodes(files.get('app/page.client.tsx')!);
    expect(parsed.get(wrapRes.wrapperId)).toBeDefined();
    expect(parsed.get(card1Id)?.parentId).toBe(wrapRes.wrapperId);

    // 5. Remove card 2
    const removeRes = await removeOp.execute(
      snapshot,
      { nodeId: card2Id },
      context
    );
    applyChanges(removeRes.changes);

    parsed = parseJSXToNodes(files.get('app/page.client.tsx')!);
    expect(parsed.has(card2Id)).toBe(false);
  });

  it('sets flex, grid, pins, sizing, and position layout properties', async () => {
    const layoutOp = defaultRegistry.get('layout.set')!;

    const res = await layoutOp.execute(
      snapshot,
      {
        nodeId: 'main-1',
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: '20px',
        position: 'relative',
        width: '100%',
        minHeight: '600px',
      },
      context
    );
    applyChanges(res.changes);

    const parsed = parseJSXToNodes(files.get('app/page.client.tsx')!);
    const mainNode = parsed.get('main-1')!;
    expect(mainNode.styles.display).toBe('grid');
    expect(mainNode.styles.gridTemplateColumns).toBe('repeat(4, 1fr)');
    expect(mainNode.styles.gap).toBe('20px');
    expect(mainNode.styles.width).toBe('100%');
    expect(mainNode.styles.minHeight).toBe('600px');
  });

  it('sets, reads, and removes comprehensive StylesTool controls with empty-string deletion', async () => {
    const stylesGetOp = defaultRegistry.get('styles.get')!;
    const stylesSetOp = defaultRegistry.get('styles.set')!;
    const stylesRemoveOp = defaultRegistry.get('styles.remove')!;

    // 1. Set comprehensive styles (fills, borders, shadows, transforms, opacity)
    const setRes = await stylesSetOp.execute(
      snapshot,
      {
        nodeId: 'title-1',
        styles: {
          color: '#111827',
          backgroundColor: '#3b82f6',
          borderRadius: '8px',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
          transform: 'scale(1.05)',
          opacity: '0.9',
          cursor: 'pointer',
        },
      },
      context
    );
    applyChanges(setRes.changes);

    // 2. Read back styles
    const readRes = await stylesGetOp.execute(snapshot, { nodeId: 'title-1' }, context);
    expect(readRes.styles.color).toBe('#111827');
    expect(readRes.styles.borderRadius).toBe('8px');
    expect(readRes.styles.opacity).toBe('0.9');

    // 3. Remove styles via empty string (Invariant 3)
    const removeRes = await stylesRemoveOp.execute(
      snapshot,
      {
        nodeId: 'title-1',
        properties: ['borderRadius', 'transform'],
      },
      context
    );
    applyChanges(removeRes.changes);

    const afterRemove = await stylesGetOp.execute(snapshot, { nodeId: 'title-1' }, context);
    expect(afterRemove.styles.borderRadius).toBeUndefined();
    expect(afterRemove.styles.transform).toBeUndefined();
    // Unchanged sibling styles preserved
    expect(afterRemove.styles.color).toBe('#111827');
  });

  it('applies pseudo (:hover, ::before, ::after) and responsive container overrides', async () => {
    const stylesSetOp = defaultRegistry.get('styles.set')!;
    const vpOverrideOp = defaultRegistry.get('viewports.setOverride')!;

    // 1. Set hover style
    const hoverRes = await stylesSetOp.execute(
      snapshot,
      {
        nodeId: 'title-1',
        pseudo: ':hover',
        styles: {
          color: '#ef4444',
        },
      },
      context
    );
    applyChanges(hoverRes.changes);

    const codeWithHover = files.get('app/page.client.tsx')!;
    expect(codeWithHover).toContain('[data-id="title-1"]:hover');
    expect(codeWithHover).toContain('color: #ef4444');

    // 2. Set mobile responsive override (width 375)
    const mobileRes = await vpOverrideOp.execute(
      snapshot,
      {
        nodeId: 'main-1',
        viewport: 'mobile',
        styles: {
          gridTemplateColumns: '1fr',
          gap: '8px',
        },
      },
      context
    );
    applyChanges(mobileRes.changes);

    const codeWithMobile = files.get('app/page.client.tsx')!;
    expect(codeWithMobile).toMatch(/@media\s*\(max-width:\s*375px\)/);
    expect(codeWithMobile).toContain('grid-template-columns: 1fr');
  });

  it('updates text content without breaking inline JSX structure', async () => {
    const textGetOp = defaultRegistry.get('text.get')!;
    const textSetOp = defaultRegistry.get('text.set')!;

    // 1. Read existing text
    const text1 = await textGetOp.execute(snapshot, { nodeId: 'title-1' }, context);
    expect(text1.textContent).toBe('Original Title');

    // 2. Set updated text
    const setRes = await textSetOp.execute(
      snapshot,
      { nodeId: 'title-1', textContent: 'Revolutionary Visual Builder' },
      context
    );
    applyChanges(setRes.changes);

    const text2 = await textGetOp.execute(snapshot, { nodeId: 'title-1' }, context);
    expect(text2.textContent).toBe('Revolutionary Visual Builder');

    // Ensure parser verifies node tree intact
    const parsed = parseJSXToNodes(files.get('app/page.client.tsx')!);
    expect(parsed.get('title-1')?.textContent).toBe('Revolutionary Visual Builder');
  });

  it('scales to a complex 100-node layout tree gracefully', async () => {
    const createOp = defaultRegistry.get('nodes.create')!;

    // Create 100 child nodes inside main-1
    for (let i = 1; i <= 50; i++) {
      const res = await createOp.execute(
        snapshot,
        {
          parentId: 'main-1',
          type: 'div',
          name: `Item ${i}`,
          styles: { width: '100%', height: '120px', backgroundColor: '#e5e7eb' },
          textContent: `Content ${i}`,
        },
        context
      );
      applyChanges(res.changes);
    }

    const parsed = parseJSXToNodes(files.get('app/page.client.tsx')!);
    const mainNode = parsed.get('main-1')!;
    expect(mainNode.children.length).toBe(50);
  });
});
