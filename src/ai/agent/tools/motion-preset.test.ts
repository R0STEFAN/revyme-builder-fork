// src/ai/agent/tools/motion-preset.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { queueMutation, flushNow, type Mutation } from '@/code/mutation/mutation-queue';
import { getNodesSnapshot } from '@/code/stores/store';
import type { CanvasNode } from '@/code/parsing/parser';
import type { ToolContext } from '@/ai/agent';
import { applyMotionPresetTool } from './motion-preset';

vi.mock('@/code/mutation/mutation-queue', () => ({
  queueMutation: vi.fn(),
  flushNow: vi.fn(),
  getQueueActiveFilePath: vi.fn(() => 'app/page.client.tsx'),
}));

vi.mock('@/code/stores/store', () => ({
  getNodesSnapshot: vi.fn(),
}));

function makeCtx(): ToolContext {
  return { ensureCheckpoint: vi.fn(), vpWidth: 1440, signal: new AbortController().signal };
}

describe('applyMotionPresetTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('applies lift-on-hover with calibrated gentle spring physics', async () => {
    const cardNode = {
      id: 'feature-card',
      type: 'div',
      children: [],
      styles: { width: '300px' },
    } as unknown as CanvasNode;

    vi.mocked(getNodesSnapshot).mockReturnValue(new Map([['feature-card', cardNode]]));

    const ctx = makeCtx();
    const result = await applyMotionPresetTool.execute(
      {
        node_id: 'feature-card',
        preset: 'lift-on-hover',
      },
      ctx,
    );

    expect(ctx.ensureCheckpoint).toHaveBeenCalledTimes(1);
    expect(queueMutation).toHaveBeenCalled();
    const calls = vi.mocked(queueMutation).mock.calls.map((c) => c[0] as Mutation);

    // Should queue updateMotionProp for whileHover and transition
    const whileHoverCall = calls.find((m) => m.type === 'updateMotionProp' && m.propName === 'whileHover');
    const transitionCall = calls.find((m) => m.type === 'updateMotionProp' && m.propName === 'transition');

    expect(whileHoverCall).toBeDefined();
    expect((whileHoverCall as any).props).toEqual({
      y: '-4',
      scale: '1.02',
    });

    expect(transitionCall).toBeDefined();
    expect((transitionCall as any).props.type).toBe('spring');
    expect((transitionCall as any).props.stiffness).toBe('200');
    expect((transitionCall as any).props.damping).toBe('20');

    expect(flushNow).toHaveBeenCalledTimes(1);
    expect(result.isError).toBeUndefined();
  });

  it('applies fade-up scroll appear with spring physics', async () => {
    const headerNode = {
      id: 'hero-title',
      type: 'h1',
      children: [],
      styles: {},
    } as unknown as CanvasNode;

    vi.mocked(getNodesSnapshot).mockReturnValue(new Map([['hero-title', headerNode]]));

    const ctx = makeCtx();
    const result = await applyMotionPresetTool.execute(
      {
        node_id: 'hero-title',
        preset: 'fade-up',
        physics: 'snappy',
      },
      ctx,
    );

    const calls = vi.mocked(queueMutation).mock.calls.map((c) => c[0] as Mutation);
    const scrollFxCall = calls.find((m) => m.type === 'updateScrollFx');
    expect(scrollFxCall).toBeDefined();
    expect((scrollFxCall as any).spec.appear).toBeDefined();
    expect((scrollFxCall as any).spec.appear.initial).toEqual({ opacity: '0', y: '30' });
    expect((scrollFxCall as any).spec.appear.once).toBe(true);
    expect((scrollFxCall as any).spec.appear.transition.type).toBe('spring');
    expect((scrollFxCall as any).spec.appear.transition.stiffness).toBe('400');
    expect(result.isError).toBeUndefined();
  });

  it('applies stagger-children across sibling cards', async () => {
    const parentNode = {
      id: 'card-grid',
      type: 'div',
      children: ['card-1', 'card-2', 'card-3'],
      styles: { display: 'grid' },
    } as unknown as CanvasNode;

    const child1 = { id: 'card-1', type: 'div', children: [], parentId: 'card-grid', styles: {} } as unknown as CanvasNode;
    const child2 = { id: 'card-2', type: 'div', children: [], parentId: 'card-grid', styles: {} } as unknown as CanvasNode;
    const child3 = { id: 'card-3', type: 'div', children: [], parentId: 'card-grid', styles: {} } as unknown as CanvasNode;

    vi.mocked(getNodesSnapshot).mockReturnValue(
      new Map([
        ['card-grid', parentNode],
        ['card-1', child1],
        ['card-2', child2],
        ['card-3', child3],
      ]),
    );

    const ctx = makeCtx();
    const result = await applyMotionPresetTool.execute(
      {
        node_id: 'card-grid',
        preset: 'stagger-children',
        stagger: 0.1,
      },
      ctx,
    );

    const calls = vi.mocked(queueMutation).mock.calls.map((c) => c[0] as Mutation);
    const scrollFxCalls = calls.filter((m) => m.type === 'updateScrollFx');
    expect(scrollFxCalls).toHaveLength(3);

    expect((scrollFxCalls[0] as any).nodeId).toBe('card-1');
    expect((scrollFxCalls[0] as any).spec.appear.transition.delay).toBe('0');

    expect((scrollFxCalls[1] as any).nodeId).toBe('card-2');
    expect((scrollFxCalls[1] as any).spec.appear.transition.delay).toBe('0.1');

    expect((scrollFxCalls[2] as any).nodeId).toBe('card-3');
    expect((scrollFxCalls[2] as any).spec.appear.transition.delay).toBe('0.2');

    expect(result.isError).toBeUndefined();
  });
});
