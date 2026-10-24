// packages/automation-core/src/operations/page-interactions.ts
import { z } from 'zod';
import type { Operation, FileChange } from '../contracts';
import { defaultRegistry } from '../registry';
import { projectFS } from '@/code/project/project-fs';
import {
  parsePageInteractionsForNode,
  parseAllPageInteractions,
  type PageInteraction,
  type InteractionTrigger,
} from '@/code/features/page-interactions';
import {
  addPageInteractionInCode,
  removePageInteractionInCode,
} from '@/code/generation/page-interactions-gen';
import { syncPageVariableHooks } from '@/code/generation/page-variables-gen';
import { ensureNamedImport } from '@/code/generation/generator-utils';
import { pageVariableTypeSchema } from './variables';

export const interactionTriggerSchema = z.enum(['click', 'mouseEnter', 'mouseLeave']);

// 1. pageInteractions.list
export const pageInteractionsListOperation: Operation<
  {
    targetFile: string;
    nodeId?: string;
  },
  {
    targetFile: string;
    interactions: PageInteraction[];
  }
> = {
  name: 'pageInteractions.list',
  description: 'List page interactions (Set Variable triggers) for a node or whole page',
  category: 'page-interactions',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T15',
  inputSchema: z.object({
    targetFile: z.string().min(1),
    nodeId: z.string().optional(),
  }),
  async execute(snapshot, input) {
    const code = snapshot.files.get(input.targetFile) ?? projectFS.readFile(input.targetFile);
    if (!code) {
      throw new Error(`Target file "${input.targetFile}" not found`);
    }

    const interactions = input.nodeId
      ? parsePageInteractionsForNode(code, input.nodeId)
      : parseAllPageInteractions(code);

    return {
      targetFile: input.targetFile,
      interactions,
    };
  },
};

// 2. pageInteractions.add
export const pageInteractionsAddOperation: Operation<
  {
    targetFile: string;
    nodeId: string;
    trigger: InteractionTrigger;
    varName: string;
    value: string;
    typeOverride?: z.infer<typeof pageVariableTypeSchema>;
  },
  {
    changes: FileChange[];
  }
> = {
  name: 'pageInteractions.add',
  description: 'Attach or update a Set Variable interaction. Oracle accepts numeric resets and empty-string clears; non-empty string literals are rejected as hidden content/state. Use component variants/connections or CMS for content switching.',
  category: 'page-interactions',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T15',
  inputSchema: z.object({
    targetFile: z.string().min(1),
    nodeId: z.string().min(1),
    trigger: interactionTriggerSchema,
    varName: z.string().min(1),
    value: z.string().describe("Setter argument as source text. Use numeric literals such as '0' for resets or '' to clear; non-empty text/color string literals are rejected by HANDLER_CONTENT_STATE."),
    typeOverride: pageVariableTypeSchema.optional(),
  }),
  async execute(snapshot, input) {
    let code = snapshot.files.get(input.targetFile) ?? projectFS.readFile(input.targetFile);
    if (!code) {
      throw new Error(`Target file "${input.targetFile}" not found`);
    }

    code = addPageInteractionInCode(
      code,
      input.nodeId,
      input.trigger,
      input.varName,
      input.value,
      input.typeOverride,
    );
    code = syncPageVariableHooks(code);
    if (/\buseState\b/.test(code)) {
      code = ensureNamedImport(code, 'react', ['useState']);
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

// 3. pageInteractions.remove
export const pageInteractionsRemoveOperation: Operation<
  {
    targetFile: string;
    nodeId: string;
    trigger: InteractionTrigger;
    varName: string;
  },
  {
    changes: FileChange[];
  }
> = {
  name: 'pageInteractions.remove',
  description: 'Remove a Set Variable interaction from a node',
  category: 'page-interactions',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T15',
  inputSchema: z.object({
    targetFile: z.string().min(1),
    nodeId: z.string().min(1),
    trigger: interactionTriggerSchema,
    varName: z.string().min(1),
  }),
  async execute(snapshot, input) {
    let code = snapshot.files.get(input.targetFile) ?? projectFS.readFile(input.targetFile);
    if (!code) {
      throw new Error(`Target file "${input.targetFile}" not found`);
    }

    code = removePageInteractionInCode(
      code,
      input.nodeId,
      input.trigger,
      input.varName,
    );
    code = syncPageVariableHooks(code);

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

defaultRegistry.register(pageInteractionsListOperation);
defaultRegistry.register(pageInteractionsAddOperation);
defaultRegistry.register(pageInteractionsRemoveOperation);
