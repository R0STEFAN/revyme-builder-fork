// src/ai/agent/tools/insert-fragment.ts
//
// High-level declarative fragment insertion tool for AI agents and MCP.
// Inserts a whole semantic subtree/fragment in a single atomic operation.
// 100% GUI-Parity: hover interactions are compiled directly into Framer Motion
// `whileHover` and spring transitions, ensuring full round-trip visual inspectability.

import { z } from 'zod';
import type { AgentTool, AgentToolResult, ToolContext } from '@/ai/agent';
import { queueToolMutation, flushTool, getToolNodes } from '@/ai/agent/workspace';
import { generateNodeId } from '@/shared/id-utils';
import type { AddNodeDef } from '@/code/generation/generator-crud';
import { coerceRecord } from './coerce';
import { formatNodeNotFound } from '../error-format';
import { seedFlowChild } from './flow-placement';
import { queueOrderWrites } from './semantic-structure';
import { trace } from '@/shared/debug-trace';

const recordSchema = z.preprocess(coerceRecord, z.record(z.string(), z.string()));

const MODEL_ID_RE = /^[a-z0-9][a-z0-9-]{0,59}$/i;
const RESERVED_CREATE_ATTRS = ['data-id', 'data-name'] as const;

function stripReservedAttrs(attrs: Record<string, string>): { attrs: Record<string, string>; idHint?: string } {
  const next: Record<string, string> = { ...attrs };
  let idHint: string | undefined;
  if (typeof next.id === 'string' && next.id !== '') {
    idHint = next.id;
    delete next.id;
  }
  for (const key of RESERVED_CREATE_ATTRS) {
    if (key in next) {
      delete next[key];
    }
  }
  return { attrs: next, ...(idHint !== undefined ? { idHint } : {}) };
}

export type FragmentNodeInput = {
  tag?: string;
  id?: string;
  name?: string;
  styles?: Record<string, string>;
  attrs?: Record<string, string>;
  text?: string;
  hover?: {
    scale?: number | string;
    y?: number | string;
    x?: number | string;
    opacity?: number | string;
    rotate?: number | string;
    backgroundColor?: string;
    borderColor?: string;
    transition?: {
      type?: 'spring' | 'tween';
      stiffness?: number;
      damping?: number;
      mass?: number;
      bounce?: number;
      duration?: number;
      ease?: string;
    };
    [key: string]: unknown;
  };
  children?: FragmentNodeInput[];
};

export const fragmentNodeSchema: z.ZodType<FragmentNodeInput> = z.lazy(() =>
  z.object({
    tag: z.string().default('div').describe('HTML tag, e.g. div, section, h2, p, button, a'),
    id: z.string().optional().describe('stable unique data-id: lowercase letters, digits and hyphens only, max 60 chars'),
    name: z.string().optional().describe('display name in the page tree'),
    styles: recordSchema.default({}).describe('camelCase CSS properties, e.g. { display: "flex", padding: "16px" }'),
    attrs: recordSchema.default({}).describe('HTML attributes as {name: value} strings — src, href, alt, etc.'),
    text: z.string().optional().describe('plain text content, no HTML'),
    hover: z
      .object({
        scale: z.union([z.number(), z.string()]).optional(),
        y: z.union([z.number(), z.string()]).optional(),
        x: z.union([z.number(), z.string()]).optional(),
        opacity: z.union([z.number(), z.string()]).optional(),
        rotate: z.union([z.number(), z.string()]).optional(),
        backgroundColor: z.string().optional(),
        borderColor: z.string().optional(),
        transition: z
          .object({
            type: z.enum(['spring', 'tween']).optional(),
            stiffness: z.number().optional(),
            damping: z.number().optional(),
            mass: z.number().optional(),
            bounce: z.number().optional(),
            duration: z.number().optional(),
            ease: z.string().optional(),
          })
          .optional(),
      })
      .passthrough()
      .optional()
      .describe('Framer Motion hover state targets and transition'),
    children: z.array(fragmentNodeSchema).optional().describe('nested children nodes'),
  })
);

function ok(data: unknown): AgentToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

function fail(message: string): AgentToolResult {
  return { content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true };
}

export const insertFragmentTool: AgentTool = {
  name: 'insert_fragment',
  description:
    'Insert a whole semantic subtree/fragment (nested tree with auto-generated unique data-ids, styles, attributes, text, and Framer Motion hover effects) in a single atomic operation. GUI-parity: hover effects compile to Framer Motion whileHover and spring transitions.',
  inputSchema: {
    parent_id: z.string().describe('data-id of the parent node in the page tree'),
    index: z.number().optional().describe('0-based position among siblings'),
    fragment: fragmentNodeSchema.describe('Tree structure to insert'),
  },
  category: 'semantic',
  async execute(args, ctx) {
    ctx.ensureCheckpoint();
    const parentId = String(args.parent_id);
    const nodesNow = getToolNodes(ctx);
    const parentNode = nodesNow.get(parentId);

    if (!parentNode && nodesNow.size > 0) {
      return fail(formatNodeNotFound(parentId, nodesNow));
    }

    const allocatedIds = new Set<string>();
    const allCreatedIds: string[] = [];

    function resolveId(requested: unknown, fallbackTag: string): { id: string } | { error: string } {
      if (typeof requested === 'string' && requested.trim() !== '') {
        const raw = requested.trim();
        if (!MODEL_ID_RE.test(raw)) {
          return { error: `Invalid data-id "${raw}": use lowercase letters, digits and dashes only (max 60 chars).` };
        }
        if (nodesNow.has(raw) || allocatedIds.has(raw)) {
          return { error: `data-id "${raw}" already exists in the page tree or current fragment — choose another id.` };
        }
        allocatedIds.add(raw);
        return { id: raw };
      }
      let generated = generateNodeId(fallbackTag || 'frame');
      while (nodesNow.has(generated) || allocatedIds.has(generated)) {
        generated = generateNodeId(fallbackTag || 'frame');
      }
      allocatedIds.add(generated);
      return { id: generated };
    }

    function convertHoverToMotionProps(hover?: FragmentNodeInput['hover']): Record<string, Record<string, string>> | undefined {
      if (!hover) return undefined;
      const { transition, ...targets } = hover;
      const whileHover: Record<string, string> = {};
      for (const [k, v] of Object.entries(targets)) {
        if (v !== undefined && v !== null && v !== '') {
          whileHover[k] = String(v);
        }
      }
      const motionProps: Record<string, Record<string, string>> = {};
      if (Object.keys(whileHover).length > 0) {
        motionProps.whileHover = whileHover;
      }
      if (transition && typeof transition === 'object') {
        const transObj: Record<string, string> = {};
        for (const [tk, tv] of Object.entries(transition)) {
          if (tv !== undefined && tv !== null && tv !== '') {
            transObj[tk] = String(tv);
          }
        }
        if (Object.keys(transObj).length > 0) {
          motionProps.transition = transObj;
        }
      }
      return Object.keys(motionProps).length > 0 ? motionProps : undefined;
    }

    function transformNode(input: FragmentNodeInput, isRoot: boolean): { def: AddNodeDef } | { error: string } {
      const { attrs, idHint } = stripReservedAttrs(input.attrs ?? {});
      const idRes = resolveId(input.id ?? idHint, input.tag ?? 'frame');
      if ('error' in idRes) return idRes;
      const id = idRes.id;
      allCreatedIds.push(id);

      const styles = { ...(input.styles ?? {}) };
      if (!styles.position) {
        styles.position = 'relative';
      }

      const motionProps = convertHoverToMotionProps(input.hover);

      const childrenDefs: AddNodeDef[] = [];
      if (input.children && input.children.length > 0) {
        for (const childInput of input.children) {
          const childRes = transformNode(childInput, false);
          if ('error' in childRes) return childRes;
          childrenDefs.push(childRes.def);
        }
      }

      const def: AddNodeDef = {
        id,
        type: input.tag || 'div',
        styles,
        attrs,
        ...(input.name ? { name: input.name } : {}),
        ...(input.text != null ? { textContent: input.text } : {}),
        ...(motionProps ? { motionProps } : {}),
        ...(childrenDefs.length > 0 ? { children: childrenDefs } : {}),
      };

      return { def };
    }

    const fragment = args.fragment as FragmentNodeInput;
    const rootRes = transformNode(fragment, true);
    if ('error' in rootRes) return fail(rootRes.error);
    const rootDef = rootRes.def;

    // Apply seedFlowChild to the root element relative to its parent
    const placed = seedFlowChild(
      rootDef.styles,
      parentNode,
      nodesNow,
      typeof args.index === 'number' ? args.index : undefined,
    );
    rootDef.styles = placed.styles;
    queueOrderWrites(ctx, placed.siblings);

    queueToolMutation(ctx, {
      type: 'addNode',
      parentId,
      node: rootDef,
      ...(typeof args.index === 'number' ? { index: args.index } : {}),
    });

    flushTool(ctx);

    trace.action('agent-tool:insert_fragment', {
      parentId,
      rootId: rootDef.id,
      nodeCount: allCreatedIds.length,
    });

    return ok({
      root_id: rootDef.id,
      node_ids: allCreatedIds,
      count: allCreatedIds.length,
    });
  },
};
