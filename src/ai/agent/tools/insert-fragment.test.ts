// src/ai/agent/tools/insert-fragment.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { atom } from 'jotai';
import { queueMutation, flushNow, type Mutation } from '@/code/mutation/mutation-queue';
import { getNodesSnapshot } from '@/code/stores/store';
import type { CanvasNode } from '@/code/parsing/parser';
import type { ToolContext } from '@/ai/agent';
import { insertFragmentTool } from './insert-fragment';
import { addNodeInCode } from '@/code/generation/generator-crud';

vi.mock('@/code/mutation/mutation-queue', () => ({
  queueMutation: vi.fn(),
  flushNow: vi.fn(),
  getQueueActiveFilePath: vi.fn(() => 'app/page.client.tsx'),
}));

vi.mock('@/code/stores/store', () => ({
  getNodesSnapshot: vi.fn(),
  selectedIdsAtom: atom<string[]>([]),
}));

type AddNodeMutation = Extract<Mutation, { type: 'addNode' }>;

function makeCtx(): ToolContext {
  return { ensureCheckpoint: vi.fn(), vpWidth: 1440, signal: new AbortController().signal };
}

function lastMutation(): Mutation {
  return vi.mocked(queueMutation).mock.calls[vi.mocked(queueMutation).mock.calls.length - 1][0] as Mutation;
}

describe('insertFragmentTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts a nested subtree in a single call and auto-assigns unique data-ids', async () => {
    const parentNode = {
      id: 'section-hero',
      type: 'section',
      children: [],
      styles: { display: 'flex', flexDirection: 'column' },
    } as unknown as CanvasNode;

    vi.mocked(getNodesSnapshot).mockReturnValue(new Map([['section-hero', parentNode]]));

    const ctx = makeCtx();
    const result = await insertFragmentTool.execute(
      {
        parent_id: 'section-hero',
        fragment: {
          tag: 'div',
          name: 'Card Container',
          styles: { padding: '24px', backgroundColor: '#1e1e24' },
          children: [
            {
              tag: 'h3',
              name: 'Card Title',
              text: 'Modern Architecture',
              styles: { fontSize: '20px', color: '#ffffff' },
            },
            {
              tag: 'p',
              name: 'Card Body',
              text: 'High-level declarative agent tools.',
              styles: { fontSize: '14px', color: '#a1a1aa' },
            },
          ],
        },
      },
      ctx,
    );

    expect(ctx.ensureCheckpoint).toHaveBeenCalledTimes(1);
    expect(queueMutation).toHaveBeenCalled();
    const m = lastMutation() as AddNodeMutation;
    expect(m.type).toBe('addNode');
    expect(m.parentId).toBe('section-hero');

    // Root node
    expect(m.node.type).toBe('div');
    expect(m.node.name).toBe('Card Container');
    expect(m.node.styles.position).toBe('relative');
    expect(m.node.styles.padding).toBe('24px');
    expect(m.node.id).toBeDefined();

    // Children
    expect(m.node.children).toHaveLength(2);
    const [h3Child, pChild] = m.node.children!;
    expect(h3Child.type).toBe('h3');
    expect(h3Child.textContent).toBe('Modern Architecture');
    expect(h3Child.id).toBeDefined();
    expect(h3Child.id).not.toBe(m.node.id);

    expect(pChild.type).toBe('p');
    expect(pChild.textContent).toBe('High-level declarative agent tools.');
    expect(pChild.id).toBeDefined();
    expect(pChild.id).not.toBe(m.node.id);
    expect(pChild.id).not.toBe(h3Child.id);

    expect(flushNow).toHaveBeenCalledTimes(1);
    const data = JSON.parse((result.content[0] as any).text);
    expect(data.root_id).toBe(m.node.id);
    expect(data.count).toBe(3);
    expect(data.node_ids).toHaveLength(3);
    expect(result.isError).toBeUndefined();
  });

  it('converts hover block into motion whileHover and transition props on node def', async () => {
    vi.mocked(getNodesSnapshot).mockReturnValue(new Map());

    const ctx = makeCtx();
    const result = await insertFragmentTool.execute(
      {
        parent_id: 'container',
        fragment: {
          tag: 'div',
          name: 'Interactive Card',
          styles: { width: '300px' },
          hover: {
            scale: 1.03,
            y: -4,
            transition: { type: 'spring', stiffness: 400, damping: 25 },
          },
        },
      },
      ctx,
    );

    const m = lastMutation() as AddNodeMutation;
    expect(m.node.motionProps).toBeDefined();
    expect(m.node.motionProps!.whileHover).toEqual({
      scale: '1.03',
      y: '-4',
    });
    expect(m.node.motionProps!.transition).toEqual({
      type: 'spring',
      stiffness: '400',
      damping: '25',
    });
  });

  it('generates <motion.div whileHover={...}> JSX when compiled by addNodeInCode', () => {
    const code = `export default function Page() {
  return (
    <div data-id="page-root">
    </div>
  );
}`;

    const nodeDef = {
      id: 'interactive-card',
      type: 'div',
      styles: { width: '320px', padding: '16px' },
      motionProps: {
        whileHover: { scale: '1.03', y: '-4' },
        transition: { type: 'spring', stiffness: '400', damping: '25' },
      },
    };

    const nextCode = addNodeInCode(code, 'page-root', nodeDef);
    expect(nextCode).toContain('<motion.div');
    expect(nextCode).toContain('whileHover={{ scale: 1.03, y: -4 }}');
    expect(nextCode).toContain("transition={{ type: 'spring', stiffness: 400, damping: 25 }}");
  });
});
