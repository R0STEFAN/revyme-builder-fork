// packages/automation-core/src/operations/connections.ts
import { z } from 'zod';
import type { Operation, FileChange } from '../contracts';
import { defaultRegistry } from '../registry';
import {
  parseConnections,
  addConnectionToCode,
  removeConnectionFromCode,
  type Connection,
  type ConnectionTrigger,
} from '@/code/variants/connection-config';
import { parseVariantConfig } from '@/code/variants/variant-config';

// 1. connections.list
export const connectionsListOperation: Operation<
  { componentFile: string },
  { connections: Connection[] }
> = {
  name: 'connections.list',
  description: 'List all interaction connections configured on a component master',
  category: 'variants',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T10',
  inputSchema: z.object({
    componentFile: z.string().min(1),
  }),
  async execute(snapshot, input) {
    const code = snapshot.files.get(input.componentFile);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Component file "${input.componentFile}" not found in project`);
    }

    const connections = parseConnections(code);
    return { connections };
  },
};

// 2. connections.create
export const connectionsCreateOperation: Operation<
  {
    componentFile: string;
    from: string;
    to: string;
    trigger: ConnectionTrigger;
    delay?: number;
    sourceNode?: string;
  },
  {
    changes: FileChange[];
    connections: Connection[];
  }
> = {
  name: 'connections.create',
  description: 'Wire an interaction trigger to transition between variants',
  category: 'variants',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T10',
  inputSchema: z.object({
    componentFile: z.string().min(1),
    from: z.string().min(1),
    to: z.string().min(1),
    trigger: z.enum(['click', 'clickStart', 'mouseEnter', 'mouseLeave', 'inView', 'afterDelay']),
    delay: z.number().nonnegative().optional(),
    sourceNode: z.string().optional(),
  }),
  async execute(snapshot, input) {
    const code = snapshot.files.get(input.componentFile);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Component file "${input.componentFile}" not found in project`);
    }

    const variants = parseVariantConfig(code);
    const fromExists = variants.some((v) => v.name === input.from);
    const toExists = variants.some((v) => v.name === input.to);
    if (!fromExists) {
      throw new Error(`VARIANT_NOT_FOUND: Source variant "${input.from}" does not exist on component`);
    }
    if (!toExists) {
      throw new Error(`VARIANT_NOT_FOUND: Target variant "${input.to}" does not exist on component`);
    }

    const { code: nextCode, connections } = addConnectionToCode(
      code,
      input.from,
      input.to,
      input.trigger,
      input.delay,
      input.sourceNode,
    );

    return {
      changes: [
        {
          path: input.componentFile,
          beforeHash: null,
          content: nextCode,
        },
      ],
      connections,
    };
  },
};

// 3. connections.remove
export const connectionsRemoveOperation: Operation<
  {
    componentFile: string;
    from: string;
    to: string;
    trigger?: ConnectionTrigger;
    sourceNode?: string | null;
  },
  {
    changes: FileChange[];
    connections: Connection[];
  }
> = {
  name: 'connections.remove',
  description: 'Remove a variant connection or specific trigger from a component master',
  category: 'variants',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T10',
  inputSchema: z.object({
    componentFile: z.string().min(1),
    from: z.string().min(1),
    to: z.string().min(1),
    trigger: z.enum(['click', 'clickStart', 'mouseEnter', 'mouseLeave', 'inView', 'afterDelay']).optional(),
    sourceNode: z.string().nullable().optional(),
  }),
  async execute(snapshot, input) {
    const code = snapshot.files.get(input.componentFile);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Component file "${input.componentFile}" not found in project`);
    }

    const match =
      input.trigger !== undefined || input.sourceNode !== undefined
        ? { trigger: input.trigger, sourceNode: input.sourceNode }
        : undefined;

    const { code: nextCode, connections } = removeConnectionFromCode(
      code,
      input.from,
      input.to,
      match,
    );

    return {
      changes: [
        {
          path: input.componentFile,
          beforeHash: null,
          content: nextCode,
        },
      ],
      connections,
    };
  },
};

defaultRegistry.register(connectionsListOperation);
defaultRegistry.register(connectionsCreateOperation);
defaultRegistry.register(connectionsRemoveOperation);
