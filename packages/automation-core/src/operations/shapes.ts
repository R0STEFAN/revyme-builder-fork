// packages/automation-core/src/operations/shapes.ts
import { z } from 'zod';
import type { Operation, FileChange } from '../contracts';
import { defaultRegistry } from '../registry';
import {
  updateSvgAttrsInCode,
  updateSvgContainerAttrsInCode,
  addSvgChildInCode,
  removeSvgChildInCode,
  replaceSvgInnerInCode,
} from '@/code/generation/generator-attrs';
import { findJSXDataIdIndex, findTagClose } from '@/code/generation/generator-utils';
import { scanTagAttrs } from '@/code/components/jsx-tag-attrs';

// 1. shapes.get
export const shapesGetOperation: Operation<
  {
    targetFile: string;
    nodeId: string;
  },
  {
    viewBox: string | null;
    fill: string | null;
    stroke: string | null;
    strokeWidth: string | null;
    d: string | null;
    attrs: Record<string, string>;
  }
> = {
  name: 'shapes.get',
  description: 'Read SVG shape attributes from an element',
  category: 'shapes',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T13',
  inputSchema: z.object({
    targetFile: z.string().min(1),
    nodeId: z.string().min(1),
  }),
  async execute(snapshot, input) {
    const code = snapshot.files.get(input.targetFile);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Target file "${input.targetFile}" not found`);
    }

    const idIndex = findJSXDataIdIndex(code, input.nodeId);
    if (idIndex === -1) {
      throw new Error(`NODE_NOT_FOUND: Node with data-id "${input.nodeId}" not found in "${input.targetFile}"`);
    }

    const tagStart = code.lastIndexOf('<', idIndex);
    const tagEnd = findTagClose(code, idIndex);
    if (tagStart === -1 || tagEnd === -1) {
      throw new Error(`TAG_NOT_FOUND: Tag boundaries not found for "${input.nodeId}"`);
    }

    const tagStr = code.slice(tagStart, tagEnd + 1);
    const scanned = scanTagAttrs(tagStr) ?? [];
    const attrs: Record<string, string> = {};

    for (const attr of scanned) {
      if (attr.name === 'data-id') continue;
      if (attr.value.kind === 'string') {
        attrs[attr.name] = attr.value.text;
      } else if (attr.value.kind === 'expr') {
        attrs[attr.name] = attr.value.source;
      } else if (attr.value.kind === 'bare') {
        attrs[attr.name] = 'true';
      }
    }

    return {
      viewBox: attrs.viewBox ?? null,
      fill: attrs.fill ?? null,
      stroke: attrs.stroke ?? null,
      strokeWidth: attrs.strokeWidth ?? attrs['stroke-width'] ?? null,
      d: attrs.d ?? null,
      attrs,
    };
  },
};

// 2. shapes.updateAttrs
export const shapesUpdateAttrsOperation: Operation<
  {
    targetFile: string;
    nodeId: string;
    attrs: Record<string, string>;
    childIndex?: number;
    targetElement?: 'svg' | 'shape';
  },
  {
    changes: FileChange[];
  }
> = {
  name: 'shapes.updateAttrs',
  description: 'Update an SVG container (targetElement: svg) or one of its geometry children (default targetElement: shape; childIndex selects the child). Empty string removes an attribute.',
  category: 'shapes',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T13',
  inputSchema: z.object({
    targetFile: z.string().min(1),
    nodeId: z.string().min(1),
    attrs: z.record(z.string(), z.string()),
    childIndex: z.number().int().nonnegative().optional(),
    targetElement: z.enum(['svg', 'shape']).optional().describe('Use svg to edit the container attributes such as viewBox; shape (default) edits a geometry child.'),
  }),
  async execute(snapshot, input) {
    let code = snapshot.files.get(input.targetFile);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Target file "${input.targetFile}" not found`);
    }

    if (input.targetElement === 'svg') {
      const updated = updateSvgContainerAttrsInCode(code, input.nodeId, input.attrs);
      if (updated === null) {
        throw new Error(`SVG_CONTAINER_NOT_FOUND: Node "${input.nodeId}" is not an SVG container in "${input.targetFile}"`);
      }
      code = updated;
    } else {
      code = updateSvgAttrsInCode(code, input.nodeId, input.attrs, input.childIndex);
    }

    return {
      changes: [
        {
          path: input.targetFile,
          beforeHash: null,
          content: code,
        },
      ],
    };
  },
};

// 3. shapes.addChild
export const shapesAddChildOperation: Operation<
  {
    targetFile: string;
    svgNodeId: string;
    childJSX: string;
  },
  {
    changes: FileChange[];
  }
> = {
  name: 'shapes.addChild',
  description: 'Append a new shape child element (<path>, <circle>, <rect>, etc.) inside an SVG container',
  category: 'shapes',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T13',
  inputSchema: z.object({
    targetFile: z.string().min(1),
    svgNodeId: z.string().min(1),
    childJSX: z.string().min(1),
  }),
  async execute(snapshot, input) {
    let code = snapshot.files.get(input.targetFile);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Target file "${input.targetFile}" not found`);
    }

    code = addSvgChildInCode(code, input.svgNodeId, input.childJSX);

    return {
      changes: [
        {
          path: input.targetFile,
          beforeHash: null,
          content: code,
        },
      ],
    };
  },
};

// 4. shapes.removeChild
export const shapesRemoveChildOperation: Operation<
  {
    targetFile: string;
    svgNodeId: string;
    childIndex: number;
  },
  {
    changes: FileChange[];
  }
> = {
  name: 'shapes.removeChild',
  description: 'Remove a shape child from an SVG container by index',
  category: 'shapes',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T13',
  inputSchema: z.object({
    targetFile: z.string().min(1),
    svgNodeId: z.string().min(1),
    childIndex: z.number().int().nonnegative(),
  }),
  async execute(snapshot, input) {
    let code = snapshot.files.get(input.targetFile);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Target file "${input.targetFile}" not found`);
    }

    code = removeSvgChildInCode(code, input.svgNodeId, input.childIndex);

    return {
      changes: [
        {
          path: input.targetFile,
          beforeHash: null,
          content: code,
        },
      ],
    };
  },
};

// 5. shapes.replaceInner
export const shapesReplaceInnerOperation: Operation<
  {
    targetFile: string;
    svgNodeId: string;
    innerJSX: string;
  },
  {
    changes: FileChange[];
  }
> = {
  name: 'shapes.replaceInner',
  description: 'Replace all inner SVG markup inside an SVG container',
  category: 'shapes',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T13',
  inputSchema: z.object({
    targetFile: z.string().min(1),
    svgNodeId: z.string().min(1),
    innerJSX: z.string(),
  }),
  async execute(snapshot, input) {
    let code = snapshot.files.get(input.targetFile);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Target file "${input.targetFile}" not found`);
    }

    code = replaceSvgInnerInCode(code, input.svgNodeId, input.innerJSX);

    return {
      changes: [
        {
          path: input.targetFile,
          beforeHash: null,
          content: code,
        },
      ],
    };
  },
};

defaultRegistry.register(shapesGetOperation);
defaultRegistry.register(shapesUpdateAttrsOperation);
defaultRegistry.register(shapesAddChildOperation);
defaultRegistry.register(shapesRemoveChildOperation);
defaultRegistry.register(shapesReplaceInnerOperation);
