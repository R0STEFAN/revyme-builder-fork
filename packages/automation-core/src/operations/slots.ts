// packages/automation-core/src/operations/slots.ts
import { z } from 'zod';
import type { Operation, FileChange } from '../contracts';
import { defaultRegistry } from '../registry';
import {
  getSlotConnections,
  connectSlotInCode,
  disconnectSlotInCode,
  reorderSlotConnectionsInCode,
  getAllSlotConnections,
} from '@/code/generation/slot-ops';

// 1. slots.list
export const slotsListOperation: Operation<
  {
    targetFile: string;
    componentId?: string;
  },
  {
    connections: Record<string, string[]>;
  }
> = {
  name: 'slots.list',
  description: 'List canvas node connections wired into code-component slots',
  category: 'slots',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T11',
  inputSchema: z.object({
    targetFile: z.string().min(1),
    componentId: z.string().optional(),
  }),
  async execute(snapshot, input) {
    const code = snapshot.files.get(input.targetFile);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Target file "${input.targetFile}" not found in project`);
    }

    if (input.componentId) {
      const conns = getSlotConnections(code, input.componentId);
      return { connections: { [input.componentId]: conns } };
    }

    const allMap = getAllSlotConnections(code);
    const result: Record<string, string[]> = {};
    for (const [k, v] of allMap.entries()) {
      result[k] = v;
    }
    return { connections: result };
  },
};

// 2. slots.connect
export const slotsConnectOperation: Operation<
  {
    targetFile: string;
    componentId: string;
    canvasNodeId: string;
  },
  {
    changes: FileChange[];
    connections: string[];
  }
> = {
  name: 'slots.connect',
  description: 'Connect a canvas node into a code-component slot (e.g. Carousel slide, Marquee item, LensBox content)',
  category: 'slots',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T11',
  inputSchema: z.object({
    targetFile: z.string().min(1),
    componentId: z.string().min(1),
    canvasNodeId: z.string().min(1),
  }),
  async execute(snapshot, input) {
    const code = snapshot.files.get(input.targetFile);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Target file "${input.targetFile}" not found in project`);
    }

    const nextCode = connectSlotInCode(code, input.componentId, input.canvasNodeId);
    const connections = getSlotConnections(nextCode, input.componentId);

    return {
      changes: [
        {
          path: input.targetFile,
          beforeHash: null,
          content: nextCode,
        },
      ],
      connections,
    };
  },
};

// 3. slots.disconnect
export const slotsDisconnectOperation: Operation<
  {
    targetFile: string;
    componentId: string;
    canvasNodeId: string;
  },
  {
    changes: FileChange[];
    connections: string[];
  }
> = {
  name: 'slots.disconnect',
  description: 'Disconnect a canvas node from a code-component slot',
  category: 'slots',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T11',
  inputSchema: z.object({
    targetFile: z.string().min(1),
    componentId: z.string().min(1),
    canvasNodeId: z.string().min(1),
  }),
  async execute(snapshot, input) {
    const code = snapshot.files.get(input.targetFile);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Target file "${input.targetFile}" not found in project`);
    }

    const nextCode = disconnectSlotInCode(code, input.componentId, input.canvasNodeId);
    const connections = getSlotConnections(nextCode, input.componentId);

    return {
      changes: [
        {
          path: input.targetFile,
          beforeHash: null,
          content: nextCode,
        },
      ],
      connections,
    };
  },
};

// 4. slots.reorder
export const slotsReorderOperation: Operation<
  {
    targetFile: string;
    componentId: string;
    orderedCanvasNodeIds: string[];
  },
  {
    changes: FileChange[];
    connections: string[];
  }
> = {
  name: 'slots.reorder',
  description: 'Reorder connected canvas nodes inside a code-component slot',
  category: 'slots',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T11',
  inputSchema: z.object({
    targetFile: z.string().min(1),
    componentId: z.string().min(1),
    orderedCanvasNodeIds: z.array(z.string().min(1)),
  }),
  async execute(snapshot, input) {
    const code = snapshot.files.get(input.targetFile);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Target file "${input.targetFile}" not found in project`);
    }

    const nextCode = reorderSlotConnectionsInCode(code, input.componentId, input.orderedCanvasNodeIds);
    const connections = getSlotConnections(nextCode, input.componentId);

    return {
      changes: [
        {
          path: input.targetFile,
          beforeHash: null,
          content: nextCode,
        },
      ],
      connections,
    };
  },
};

defaultRegistry.register(slotsListOperation);
defaultRegistry.register(slotsConnectOperation);
defaultRegistry.register(slotsDisconnectOperation);
defaultRegistry.register(slotsReorderOperation);
