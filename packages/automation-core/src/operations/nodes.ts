// packages/automation-core/src/operations/nodes.ts
import { z } from 'zod';
import type { Operation, FileChange, Snapshot, OperationContext } from '../contracts';
import { defaultRegistry } from '../registry';
import { parseJSXToNodes, type CanvasNode } from '@/code/parsing/parser';
import {
  addNodeInCode,
  removeNodeInCode,
  updateNodeInCode,
  moveNodeInCode,
  reorderNodeInCode,
  updateNodeNameInCode,
  type AddNodeDef,
} from '@/code/generation/generator-crud';

function getTargetFile(snapshot: Snapshot, filePath?: string): { path: string; code: string } {
  let target = filePath;
  if (!target) {
    // Default to first page client file or homepage
    for (const key of snapshot.files.keys()) {
      if (key.endsWith('page.client.tsx')) {
        target = key;
        break;
      }
    }
  }
  if (!target || !snapshot.files.has(target)) {
    throw new Error(`FILE_NOT_FOUND: Target file "${target || 'default page'}" not found in snapshot`);
  }
  return { path: target, code: snapshot.files.get(target)! };
}

/** New direct children of CSS flow containers need explicit order values for
 *  the builder's reorder engine. Fill only missing values and leave explicit
 *  user-authored orders intact. */
function ensureFlowChildOrder(code: string, parentId: string): string {
  const nodes = parseJSXToNodes(code);
  const parent = nodes.get(parentId);
  const display = parent?.styles.display;
  if (!parent || !['flex', 'inline-flex', 'grid', 'inline-grid'].includes(display || '')) return code;

  const flowChildren = parent.children
    .map((childId) => nodes.get(childId))
    .filter((child): child is CanvasNode => !!child && child.styles.position !== 'absolute' && child.styles.position !== 'fixed');
  const explicitOrders = flowChildren
    .map((child) => Number(child.styles.order))
    .filter(Number.isFinite);
  let nextCode = code;
  let flowOrder = explicitOrders.length ? Math.max(...explicitOrders) + 1 : 0;
  for (const child of flowChildren) {
    if (child.styles.order === undefined || child.styles.order === '') {
      nextCode = updateNodeInCode(nextCode, child.id, { order: String(flowOrder) });
      flowOrder++;
    }
  }
  return nextCode;
}

// 1. nodes.get
export const nodesGetOperation: Operation<
  { filePath?: string; nodeId: string },
  { node: CanvasNode }
> = {
  name: 'nodes.get',
  description: 'Get parsed CanvasNode by data-id from JSX source',
  category: 'nodes',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T07',
  inputSchema: z.object({
    filePath: z.string().optional(),
    nodeId: z.string().min(1),
  }),
  async execute(snapshot, input) {
    const { code } = getTargetFile(snapshot, input.filePath);
    const nodes = parseJSXToNodes(code);
    const node = nodes.get(input.nodeId);
    if (!node) {
      throw new Error(`NODE_NOT_FOUND: Node with id "${input.nodeId}" not found in source`);
    }
    return { node };
  },
};

// 2. nodes.create
export const nodesCreateOperation: Operation<
  {
    filePath?: string;
    parentId: string;
    type?: string;
    name?: string;
    styles?: Record<string, string>;
    attrs?: Record<string, string>;
    textContent?: string;
    index?: number;
    id?: string;
  },
  {
    nodeId: string;
    changes: FileChange[];
  }
> = {
  name: 'nodes.create',
  description: 'Create and insert a new JSX node under a parent container',
  category: 'nodes',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T07',
  inputSchema: z.object({
    filePath: z.string().optional(),
    parentId: z.string().min(1),
    type: z.string().optional().default('div'),
    name: z.string().optional(),
    styles: z.record(z.string(), z.string()).optional(),
    attrs: z.record(z.string(), z.string()).optional(),
    textContent: z.string().optional(),
    index: z.number().int().optional(),
    id: z.string().optional(),
  }),
  async execute(snapshot, input, context) {
    const { path, code } = getTargetFile(snapshot, input.filePath);
    const nodeId = input.id || context.createId(input.type || 'node');

    const nodeDef: AddNodeDef = {
      id: nodeId,
      type: input.type || 'div',
      name: input.name || input.type || 'Node',
      styles: input.styles || {},
      attrs: input.attrs,
      textContent: input.textContent,
    };

    const insertedCode = addNodeInCode(code, input.parentId, nodeDef, input.index);
    const nextCode = ensureFlowChildOrder(insertedCode, input.parentId);

    return {
      nodeId,
      changes: [
        {
          path,
          beforeHash: null,
          content: nextCode,
        },
      ],
    };
  },
};

// 3. nodes.update
export const nodesUpdateOperation: Operation<
  {
    filePath?: string;
    nodeId: string;
    name?: string;
    styles?: Record<string, string>;
  },
  {
    nodeId: string;
    changes: FileChange[];
  }
> = {
  name: 'nodes.update',
  description: 'Update a node display name or inline styles in JSX source',
  category: 'nodes',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T07',
  inputSchema: z.object({
    filePath: z.string().optional(),
    nodeId: z.string().min(1),
    name: z.string().min(1).optional(),
    styles: z.record(z.string(), z.string()).optional(),
  }),
  async execute(snapshot, input) {
    const { path, code } = getTargetFile(snapshot, input.filePath);
    let nextCode = code;

    if (input.name) {
      nextCode = updateNodeNameInCode(nextCode, input.nodeId, input.name);
    }

    if (input.styles && Object.keys(input.styles).length > 0) {
      nextCode = updateNodeInCode(nextCode, input.nodeId, input.styles);
    }

    return {
      nodeId: input.nodeId,
      changes: [
        {
          path,
          beforeHash: null,
          content: nextCode,
        },
      ],
    };
  },
};

// 4. nodes.move
export const nodesMoveOperation: Operation<
  {
    filePath?: string;
    nodeId: string;
    newParentId: string;
    index?: number;
  },
  {
    nodeId: string;
    changes: FileChange[];
  }
> = {
  name: 'nodes.move',
  description: 'Move an existing node to a new parent container',
  category: 'nodes',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T07',
  inputSchema: z.object({
    filePath: z.string().optional(),
    nodeId: z.string().min(1),
    newParentId: z.string().min(1),
    index: z.number().int().optional(),
  }),
  async execute(snapshot, input) {
    const { path, code } = getTargetFile(snapshot, input.filePath);
    const nextCode = moveNodeInCode(code, input.nodeId, input.newParentId, undefined, input.index);

    return {
      nodeId: input.nodeId,
      changes: [
        {
          path,
          beforeHash: null,
          content: nextCode,
        },
      ],
    };
  },
};

// 5. nodes.reorder
export const nodesReorderOperation: Operation<
  {
    filePath?: string;
    nodeId: string;
    newIndex: number;
  },
  {
    nodeId: string;
    changes: FileChange[];
  }
> = {
  name: 'nodes.reorder',
  description: 'Reorder a sibling node within its parent container',
  category: 'nodes',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T07',
  inputSchema: z.object({
    filePath: z.string().optional(),
    nodeId: z.string().min(1),
    newIndex: z.number().int().nonnegative(),
  }),
  async execute(snapshot, input) {
    const { path, code } = getTargetFile(snapshot, input.filePath);
    const nodes = parseJSXToNodes(code);
    const parentId = nodes.get(input.nodeId)?.parentId || 'root';
    const nextCode = reorderNodeInCode(code, input.nodeId, parentId, input.newIndex);

    return {
      nodeId: input.nodeId,
      changes: [
        {
          path,
          beforeHash: null,
          content: nextCode,
        },
      ],
    };
  },
};

// 6. nodes.duplicate
export const nodesDuplicateOperation: Operation<
  {
    filePath?: string;
    nodeId: string;
  },
  {
    newNodeId: string;
    changes: FileChange[];
  }
> = {
  name: 'nodes.duplicate',
  description: 'Duplicate a node with all its children, generating fresh IDs',
  category: 'nodes',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T07',
  inputSchema: z.object({
    filePath: z.string().optional(),
    nodeId: z.string().min(1),
  }),
  async execute(snapshot, input, context) {
    const { path, code } = getTargetFile(snapshot, input.filePath);
    const nodes = parseJSXToNodes(code);
    const original = nodes.get(input.nodeId);

    if (!original) {
      throw new Error(`NODE_NOT_FOUND: Node "${input.nodeId}" not found to duplicate`);
    }

    const parentId = original.parentId || 'root';
    const newNodeId = context.createId(original.type || 'dup');

    function buildRecursiveDef(node: CanvasNode, newId: string): AddNodeDef {
      const childDefs: AddNodeDef[] = [];
      for (const childId of node.children) {
        const childNode = nodes.get(childId);
        if (childNode) {
          const freshChildId = context.createId(childNode.type || 'child');
          childDefs.push(buildRecursiveDef(childNode, freshChildId));
        }
      }
      return {
        id: newId,
        type: node.type,
        name: `${node.name || node.type} Copy`,
        styles: { ...node.styles },
        attrs: node.attrs ? { ...node.attrs } : undefined,
        textContent: node.textContent,
        children: childDefs.length > 0 ? childDefs : undefined,
      };
    }

    const def = buildRecursiveDef(original, newNodeId);
    const nextCode = addNodeInCode(code, parentId, def);

    return {
      newNodeId,
      changes: [
        {
          path,
          beforeHash: null,
          content: nextCode,
        },
      ],
    };
  },
};

// 7. nodes.wrap
export const nodesWrapOperation: Operation<
  {
    filePath?: string;
    nodeId: string;
    wrapperType?: string;
    wrapperStyles?: Record<string, string>;
  },
  {
    wrapperId: string;
    changes: FileChange[];
  }
> = {
  name: 'nodes.wrap',
  description: 'Wrap an existing node inside a new parent container',
  category: 'nodes',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T07',
  inputSchema: z.object({
    filePath: z.string().optional(),
    nodeId: z.string().min(1),
    wrapperType: z.string().optional().default('div'),
    wrapperStyles: z.record(z.string(), z.string()).optional(),
  }),
  async execute(snapshot, input, context) {
    const { path, code } = getTargetFile(snapshot, input.filePath);
    const nodes = parseJSXToNodes(code);
    const target = nodes.get(input.nodeId);
    if (!target) {
      throw new Error(`NODE_NOT_FOUND: Node "${input.nodeId}" not found`);
    }

    const parentId = target.parentId || 'root';
    const wrapperId = context.createId('wrap');

    const wrapperDef: AddNodeDef = {
      id: wrapperId,
      type: input.wrapperType || 'div',
      name: 'Wrapper',
      styles: input.wrapperStyles || { display: 'flex', flexDirection: 'column' },
    };

    // Step 1: Add wrapper to original parent
    let nextCode = addNodeInCode(code, parentId, wrapperDef);

    // Step 2: Move target node inside wrapper
    nextCode = moveNodeInCode(nextCode, input.nodeId, wrapperId);

    return {
      wrapperId,
      changes: [
        {
          path,
          beforeHash: null,
          content: nextCode,
        },
      ],
    };
  },
};

// 8. nodes.remove
export const nodesRemoveOperation: Operation<
  {
    filePath?: string;
    nodeId: string;
  },
  {
    removedId: string;
    changes: FileChange[];
  }
> = {
  name: 'nodes.remove',
  description: 'Remove a node from JSX source by data-id',
  category: 'nodes',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T07',
  inputSchema: z.object({
    filePath: z.string().optional(),
    nodeId: z.string().min(1),
  }),
  async execute(snapshot, input) {
    const { path, code } = getTargetFile(snapshot, input.filePath);
    const nextCode = removeNodeInCode(code, input.nodeId);

    return {
      removedId: input.nodeId,
      changes: [
        {
          path,
          beforeHash: null,
          content: nextCode,
        },
      ],
    };
  },
};

// Register nodes operations
defaultRegistry.register(nodesGetOperation);
defaultRegistry.register(nodesCreateOperation);
defaultRegistry.register(nodesUpdateOperation);
defaultRegistry.register(nodesMoveOperation);
defaultRegistry.register(nodesReorderOperation);
defaultRegistry.register(nodesDuplicateOperation);
defaultRegistry.register(nodesWrapOperation);
defaultRegistry.register(nodesRemoveOperation);
