// src/ai/agent/tools/motion-preset.ts
//
// High-level motion presets tool for AI agents and MCP.
// Translates declarative presets with calibrated spring physics into
// native Framer Motion whileHover and appear scroll-fx mutations.

import { z } from 'zod';
import type { AgentTool, AgentToolResult, ToolContext } from '@/ai/agent';
import { queueToolMutation, flushTool, getToolNodes } from '@/ai/agent/workspace';
import { formatNodeNotFound } from '../error-format';
import { trace } from '@/shared/debug-trace';

export const PHYSICS_PRESETS = {
  snappy: { type: 'spring', stiffness: '400', damping: '30', mass: '1' },
  gentle: { type: 'spring', stiffness: '200', damping: '20', mass: '1' },
  bouncy: { type: 'spring', stiffness: '300', damping: '10', mass: '1' },
  slow: { type: 'spring', stiffness: '100', damping: '20', mass: '1' },
} as const;

export type PhysicsPresetKey = keyof typeof PHYSICS_PRESETS;

export const MOTION_PRESET_NAMES = [
  'lift-on-hover',
  'scale-on-hover',
  'fade-up',
  'fade-in',
  'slide-in-left',
  'slide-in-right',
  'stagger-children',
] as const;

export type MotionPresetName = typeof MOTION_PRESET_NAMES[number];

function ok(data: unknown): AgentToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

function fail(message: string): AgentToolResult {
  return { content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true };
}

function strings(o: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o ?? {})) {
    if (v !== undefined && v !== null && v !== '') {
      out[k] = String(v);
    }
  }
  return out;
}

export const applyMotionPresetTool: AgentTool = {
  name: 'apply_motion_preset',
  description:
    'Apply a high-level animation or interaction preset with calibrated spring physics (snappy, gentle, bouncy, slow). ' +
    'Presets: "lift-on-hover" (subtle card lift), "scale-on-hover" (button pop), "fade-up" (scroll appear), ' +
    '"fade-in", "slide-in-left", "slide-in-right", "stagger-children" (sequenced child reveals). 100% GUI-Parity.',
  inputSchema: {
    node_id: z.string().describe('data-id of the target element in the page tree'),
    preset: z.enum(MOTION_PRESET_NAMES).describe('High-level animation preset name'),
    physics: z.enum(['snappy', 'gentle', 'bouncy', 'slow']).optional().describe('Calibrated spring curve preset (default matches preset)'),
    stagger: z.number().optional().describe('delay increment between siblings in seconds (for stagger-children, default 0.08)'),
    targets: z.record(z.string(), z.union([z.string(), z.number()])).optional().describe('Optional overrides for whileHover targets'),
  },
  category: 'semantic',
  async execute(args, ctx) {
    ctx.ensureCheckpoint();
    const nodeId = String(args.node_id);
    const nodesNow = getToolNodes(ctx);
    const node = nodesNow.get(nodeId);

    if (!node && nodesNow.size > 0) {
      return fail(formatNodeNotFound(nodeId, nodesNow.keys()));
    }

    const preset = args.preset as MotionPresetName;
    const physicsKey: PhysicsPresetKey = (args.physics as PhysicsPresetKey) || (
      preset === 'scale-on-hover' ? 'snappy' : 'gentle'
    );
    const spring = { ...PHYSICS_PRESETS[physicsKey] };

    if (preset === 'lift-on-hover') {
      const targets = args.targets ? strings(args.targets as Record<string, unknown>) : { y: '-4', scale: '1.02' };
      queueToolMutation(ctx, { type: 'updateMotionProp', nodeId, propName: 'whileHover', props: targets });
      queueToolMutation(ctx, { type: 'updateMotionProp', nodeId, propName: 'transition', props: spring });
    } else if (preset === 'scale-on-hover') {
      const targets = args.targets ? strings(args.targets as Record<string, unknown>) : { scale: '1.03' };
      queueToolMutation(ctx, { type: 'updateMotionProp', nodeId, propName: 'whileHover', props: targets });
      queueToolMutation(ctx, { type: 'updateMotionProp', nodeId, propName: 'transition', props: spring });
    } else if (preset === 'fade-up') {
      queueToolMutation(ctx, {
        type: 'updateScrollFx',
        nodeId,
        spec: {
          appear: {
            initial: { opacity: '0', y: '30' },
            once: true,
            transition: spring,
          },
        },
      });
    } else if (preset === 'fade-in') {
      queueToolMutation(ctx, {
        type: 'updateScrollFx',
        nodeId,
        spec: {
          appear: {
            initial: { opacity: '0' },
            once: true,
            transition: spring,
          },
        },
      });
    } else if (preset === 'slide-in-left') {
      queueToolMutation(ctx, {
        type: 'updateScrollFx',
        nodeId,
        spec: {
          appear: {
            initial: { opacity: '0', x: '-40' },
            once: true,
            transition: spring,
          },
        },
      });
    } else if (preset === 'slide-in-right') {
      queueToolMutation(ctx, {
        type: 'updateScrollFx',
        nodeId,
        spec: {
          appear: {
            initial: { opacity: '0', x: '40' },
            once: true,
            transition: spring,
          },
        },
      });
    } else if (preset === 'stagger-children') {
      const children = node?.children ?? [];
      if (children.length === 0) {
        return fail(`Node "${nodeId}" has no children to stagger.`);
      }
      const staggerStep = typeof args.stagger === 'number' ? args.stagger : 0.08;
      children.forEach((childId, i) => {
        const delay = Math.round(i * staggerStep * 1000) / 1000;
        queueToolMutation(ctx, {
          type: 'updateScrollFx',
          nodeId: childId,
          spec: {
            appear: {
              initial: { opacity: '0', y: '24' },
              once: true,
              transition: {
                ...spring,
                delay: String(delay),
              },
            },
          },
        });
      });
    }

    flushTool(ctx);

    trace.action('agent-tool:apply_motion_preset', {
      nodeId,
      preset,
      physics: physicsKey,
    });

    return ok({
      node_id: nodeId,
      preset,
      physics: physicsKey,
    });
  },
};
