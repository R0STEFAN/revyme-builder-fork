// packages/automation-core/src/operations/variables.ts
import { z } from 'zod';
import type { Operation, FileChange } from '../contracts';
import { defaultRegistry } from '../registry';
import { projectFS } from '@/code/project/project-fs';
import {
  parsePageVariables,
  defaultForType,
  addPageVariableInCode,
  removePageVariableInCode,
  updatePageVariableInCode,
  getPageVariables,
  type PageVariable,
  type PageVariableType,
} from '@/code/features/page-variables';
import {
  bindStyleToPageVariableInCode,
  unbindStyleFromPageVariableInCode,
  syncPageVariableHooks,
  renamePageVariableHookInCode,
} from '@/code/generation/page-variables-gen';
import {
  setResponsiveStyleVariableInCode,
  resetResponsiveStyleVariableInCode,
} from '@/code/generation/responsive-style-vars-gen';
import {
  setResponsiveTextVariableInCode,
  resetResponsiveTextVariableInCode,
} from '@/code/generation/responsive-text-vars-gen';
import {
  bindTextExpressionInCode,
  unbindTextExpressionInCode,
} from '@/code/generation/expression-gen';
import { applyDeleteVariablePipeline } from '@/code/features/delete-variable-pipeline';
import { ensureNamedImport } from '@/code/generation/generator-utils';

export const pageVariableTypeSchema = z.enum([
  'number',
  'text',
  'boolean',
  'color',
  'image',
  'componentCursor',
]);

// 1. variables.list
export const variablesListOperation: Operation<
  { targetFile: string },
  { targetFile: string; variables: PageVariable[] }
> = {
  name: 'variables.list',
  description: 'List all page variables declared in a page file',
  category: 'variables',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T15',
  inputSchema: z.object({
    targetFile: z.string().min(1),
  }),
  async execute(snapshot, input) {
    const code = snapshot.files.get(input.targetFile) ?? projectFS.readFile(input.targetFile);
    if (!code) {
      throw new Error(`Target file "${input.targetFile}" not found`);
    }
    const variables = getPageVariables(code);
    return {
      targetFile: input.targetFile,
      variables,
    };
  },
};

// 2. variables.create
export const variablesCreateOperation: Operation<
  {
    targetFile: string;
    name: string;
    type: PageVariableType;
    defaultValue?: string;
    queryParam?: string;
    description?: string;
  },
  {
    changes: FileChange[];
    variable: PageVariable;
  }
> = {
  name: 'variables.create',
  description: 'Create a new page variable and sync component hooks',
  category: 'variables',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T15',
  inputSchema: z.object({
    targetFile: z.string().min(1),
    name: z.string().regex(/^[a-zA-Z_$][a-zA-Z0-9_$]*$/, 'Variable name must be a valid JS identifier'),
    type: pageVariableTypeSchema,
    defaultValue: z.string().optional(),
    queryParam: z.string().optional(),
    description: z.string().optional(),
  }),
  async execute(snapshot, input) {
    const parsed = variablesCreateOperation.inputSchema.parse(input);
    let code = snapshot.files.get(parsed.targetFile) ?? projectFS.readFile(parsed.targetFile);
    if (!code) {
      throw new Error(`Target file "${parsed.targetFile}" not found`);
    }

    const existingVars = getPageVariables(code);
    if (existingVars.some((v) => v.name === parsed.name)) {
      throw new Error(`Variable "${parsed.name}" already exists`);
    }

    const variable: PageVariable = {
      name: parsed.name,
      type: parsed.type,
      default: parsed.defaultValue ?? defaultForType(parsed.type),
      queryParam: parsed.queryParam || undefined,
      description: parsed.description || undefined,
    };

    code = addPageVariableInCode(code, variable);
    code = syncPageVariableHooks(code);
    if (/\buseState\b/.test(code)) {
      code = ensureNamedImport(code, 'react', ['useState']);
    }

    return {
      changes: [
        {
          path: parsed.targetFile,
          beforeHash: null,
          content: code,
        },
      ],
      variable,
    };
  },
};

// 3. variables.update
export const variablesUpdateOperation: Operation<
  {
    targetFile: string;
    name: string;
    updates: {
      name?: string;
      type?: PageVariableType;
      defaultValue?: string;
      queryParam?: string;
      description?: string;
    };
  },
  {
    changes: FileChange[];
  }
> = {
  name: 'variables.update',
  description: 'Update a page variable definition and rename references if renamed',
  category: 'variables',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T15',
  inputSchema: z.object({
    targetFile: z.string().min(1),
    name: z.string().min(1),
    updates: z.object({
      name: z.string().regex(/^[a-zA-Z_$][a-zA-Z0-9_$]*$/, 'Variable name must be a valid JS identifier').optional(),
      type: pageVariableTypeSchema.optional(),
      defaultValue: z.string().optional(),
      queryParam: z.string().optional(),
      description: z.string().optional(),
    }),
  }),
  async execute(snapshot, input) {
    const parsed = variablesUpdateOperation.inputSchema.parse(input);
    let code = snapshot.files.get(parsed.targetFile) ?? projectFS.readFile(parsed.targetFile);
    if (!code) {
      throw new Error(`Target file "${parsed.targetFile}" not found`);
    }

    const existingVars = getPageVariables(code);
    const targetVar = existingVars.find((v) => v.name === parsed.name);
    if (!targetVar) {
      throw new Error(`Variable "${parsed.name}" not found`);
    }

    if (parsed.updates.name && parsed.updates.name !== parsed.name) {
      if (existingVars.some((v) => v.name === parsed.updates.name)) {
        throw new Error(`Variable "${parsed.updates.name}" already exists`);
      }
    }

    const payload: Partial<PageVariable> = {};
    if (parsed.updates.name !== undefined) payload.name = parsed.updates.name;
    if (parsed.updates.type !== undefined) payload.type = parsed.updates.type;
    if (parsed.updates.defaultValue !== undefined) payload.default = parsed.updates.defaultValue;
    if (parsed.updates.queryParam !== undefined) payload.queryParam = parsed.updates.queryParam;
    if (input.updates.description !== undefined) payload.description = input.updates.description;

    code = updatePageVariableInCode(code, input.name, payload);
    if (input.updates.name && input.updates.name !== input.name) {
      code = renamePageVariableHookInCode(code, input.name, input.updates.name);
    }
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

// 4. variables.remove
export const variablesRemoveOperation: Operation<
  {
    targetFile: string;
    name: string;
    cascade?: boolean;
  },
  {
    changes: FileChange[];
  }
> = {
  name: 'variables.remove',
  description: 'Remove a page variable and clean up orphaned references and hooks',
  category: 'variables',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T15',
  inputSchema: z.object({
    targetFile: z.string().min(1),
    name: z.string().min(1),
    cascade: z.boolean().optional().default(true),
  }),
  async execute(snapshot, input) {
    const parsed = variablesRemoveOperation.inputSchema.parse(input);
    let code = snapshot.files.get(parsed.targetFile) ?? projectFS.readFile(parsed.targetFile);
    if (!code) {
      throw new Error(`Target file "${parsed.targetFile}" not found`);
    }

    const existingVars = getPageVariables(code);
    const targetVar = existingVars.find((v) => v.name === parsed.name);
    if (!targetVar) {
      throw new Error(`Variable "${parsed.name}" not found`);
    }

    if (parsed.cascade) {
      code = applyDeleteVariablePipeline(code, parsed.name, targetVar.default);
    } else {
      code = removePageVariableInCode(code, parsed.name);
    }

    const hookRegex = new RegExp(
      `\\s*const\\s*\\[\\s*${parsed.name}\\s*,[^\\]]*\\]\\s*=\\s*useState\\([^;]*\\);?`,
      'g',
    );
    code = code.replace(hookRegex, '');
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

// 5. variables.bind
export const variablesBindOperation: Operation<
  {
    targetFile: string;
    nodeId: string;
    property: string;
    varName: string;
    vpWidth?: number;
    baseFallback?: string;
  },
  {
    changes: FileChange[];
  }
> = {
  name: 'variables.bind',
  description: 'Bind a style, attribute, or text content to a page variable (optionally with responsive breakpoint override)',
  category: 'variables',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T15',
  inputSchema: z.object({
    targetFile: z.string().min(1),
    nodeId: z.string().min(1),
    property: z.string().min(1),
    varName: z.string().min(1),
    vpWidth: z.number().positive().optional(),
    baseFallback: z.string().optional(),
  }),
  async execute(snapshot, input) {
    let code = snapshot.files.get(input.targetFile) ?? projectFS.readFile(input.targetFile);
    if (!code) {
      throw new Error(`Target file "${input.targetFile}" not found`);
    }

    const existingVars = getPageVariables(code);
    if (!existingVars.some((v) => v.name === input.varName)) {
      throw new Error(`Variable "${input.varName}" is not declared in page variables`);
    }

    if (input.vpWidth) {
      if (input.property === 'textContent') {
        code = setResponsiveTextVariableInCode(
          code,
          input.nodeId,
          input.vpWidth,
          input.varName,
          input.baseFallback ?? '',
        );
      } else {
        code = setResponsiveStyleVariableInCode(
          code,
          input.nodeId,
          input.vpWidth,
          input.property,
          input.varName,
          input.baseFallback ?? '',
        );
      }
    } else {
      if (input.property === 'textContent') {
        code = bindTextExpressionInCode(code, input.nodeId, input.varName);
      } else {
        code = bindStyleToPageVariableInCode(code, input.nodeId, input.property, input.varName);
      }
    }

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

// 6. variables.unbind
export const variablesUnbindOperation: Operation<
  {
    targetFile: string;
    nodeId: string;
    property: string;
    fallbackValue?: string;
    vpWidth?: number;
  },
  {
    changes: FileChange[];
  }
> = {
  name: 'variables.unbind',
  description: 'Unbind a style, attribute, or text content from a page variable',
  category: 'variables',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T15',
  inputSchema: z.object({
    targetFile: z.string().min(1),
    nodeId: z.string().min(1),
    property: z.string().min(1),
    fallbackValue: z.string().optional(),
    vpWidth: z.number().positive().optional(),
  }),
  async execute(snapshot, input) {
    let code = snapshot.files.get(input.targetFile) ?? projectFS.readFile(input.targetFile);
    if (!code) {
      throw new Error(`Target file "${input.targetFile}" not found`);
    }

    if (input.vpWidth) {
      if (input.property === 'textContent') {
        code = resetResponsiveTextVariableInCode(code, input.nodeId, input.vpWidth);
      } else {
        code = resetResponsiveStyleVariableInCode(code, input.nodeId, input.vpWidth, input.property);
      }
    } else {
      if (input.property === 'textContent') {
        code = unbindTextExpressionInCode(code, input.nodeId, input.fallbackValue ?? 'Text');
      } else {
        code = unbindStyleFromPageVariableInCode(
          code,
          input.nodeId,
          input.property,
          input.fallbackValue ?? '',
        );
      }
    }

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

defaultRegistry.register(variablesListOperation);
defaultRegistry.register(variablesCreateOperation);
defaultRegistry.register(variablesUpdateOperation);
defaultRegistry.register(variablesRemoveOperation);
defaultRegistry.register(variablesBindOperation);
defaultRegistry.register(variablesUnbindOperation);
