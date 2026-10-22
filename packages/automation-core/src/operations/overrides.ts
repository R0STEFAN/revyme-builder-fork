// packages/automation-core/src/operations/overrides.ts
import { z } from 'zod';
import { parse } from '@babel/parser';
import type { Operation, FileChange, Snapshot, OperationContext } from '../contracts';
import { defaultRegistry } from '../registry';
import { projectFS } from '@/code/project/project-fs';
import {
  OVERRIDES_DIR,
  listOverrideExports,
  readCodeOverrides,
  setCodeOverridesInCode,
  type CodeOverrideRef,
} from '@/code/generation/code-override-gen';
import { findSubtreeRange } from '@/code/generation/generator-utils';
import { syncCodeSnapshotToProjectFS } from './code-components';

// ─── 1. overrides.create ──────────────────────────────────────────────────────

export const overridesCreateInputSchema = z.object({
  name: z.string().regex(/^[A-Z][A-Za-z0-9]*$/, 'Override file must be PascalCase'),
  code: z.string().min(1),
});

export type OverridesCreateInput = z.infer<typeof overridesCreateInputSchema>;

export interface OverridesCreateOutput {
  path: string;
  exports: string[];
  changes: FileChange[];
}

export const overridesCreateOperation: Operation<OverridesCreateInput, OverridesCreateOutput> = {
  name: 'overrides.create',
  description: 'Create a new code override file exporting withX HOC functions',
  category: 'code',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T20',
  inputSchema: overridesCreateInputSchema,
  async execute(snapshot, input, _context: OperationContext) {
    const sync = syncCodeSnapshotToProjectFS(snapshot);
    const path = `${OVERRIDES_DIR}${input.name}.tsx`;

    // 1. Must parse as valid JS/TS/JSX
    try {
      parse(input.code, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
    } catch (err) {
      throw new Error(`SYNTAX_ERROR: Override code failed to parse: ${(err as Error).message}`);
    }

    // 2. Default export is disallowed
    if (/\bexport\s+default\b/.test(input.code)) {
      throw new Error(
        'DEFAULT_EXPORT_FORBIDDEN: Override files must not have a default export; only named withX HOC functions are supported.',
      );
    }

    // 3. Must export at least one with<Something> function
    const exportedFunctions = listOverrideExports(input.code);
    const withExports = exportedFunctions.filter((name) => /^with[A-Z0-9_$]/.test(name));
    if (withExports.length === 0) {
      throw new Error(
        'INVALID_OVERRIDE: Override file must export at least one HOC function starting with "with" (e.g. withHoverEffect).',
      );
    }

    projectFS.writeFile(path, input.code);

    return {
      path,
      exports: exportedFunctions,
      changes: sync.collectChanges(),
    };
  },
};

// ─── 2. overrides.list ────────────────────────────────────────────────────────

export const overridesListInputSchema = z.object({
  filePath: z.string().optional(),
  nodeId: z.string().optional(),
});

export type OverridesListInput = z.infer<typeof overridesListInputSchema>;

export interface OverridesListOutput {
  files: Array<{
    file: string;
    exports: string[];
  }>;
  onNode?: Array<{
    file: string;
    name: string;
  }>;
}

export const overridesListOperation: Operation<OverridesListInput, OverridesListOutput> = {
  name: 'overrides.list',
  description: 'List available override files and their exports, optionally inspecting a node',
  category: 'code',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T20',
  inputSchema: overridesListInputSchema,
  async execute(snapshot, input, _context: OperationContext) {
    syncCodeSnapshotToProjectFS(snapshot);
    const files: Array<{ file: string; exports: string[] }> = [];

    for (const filePath of projectFS.listFiles()) {
      if (filePath.startsWith(OVERRIDES_DIR) && (filePath.endsWith('.tsx') || filePath.endsWith('.ts'))) {
        const content = projectFS.readFile(filePath);
        files.push({
          file: filePath,
          exports: content ? listOverrideExports(content) : [],
        });
      }
    }

    let onNode: Array<{ file: string; name: string }> | undefined;
    if (input.filePath && input.nodeId) {
      const pageCode = projectFS.readFile(input.filePath);
      if (pageCode) {
        onNode = readCodeOverrides(pageCode, input.nodeId);
      }
    }

    return {
      files,
      ...(onNode !== undefined ? { onNode } : {}),
    };
  },
};

// ─── 3. overrides.set ─────────────────────────────────────────────────────────

export const overridesSetInputSchema = z.object({
  filePath: z.string().min(1),
  nodeId: z.string().min(1),
  overrides: z.array(
    z.object({
      file: z.string().min(1),
      name: z.string().min(1),
    }),
  ),
});

export type OverridesSetInput = z.infer<typeof overridesSetInputSchema>;

export interface OverridesSetOutput {
  nodeId: string;
  overrides: Array<{
    file: string;
    name: string;
  }>;
  changes: FileChange[];
}

export const overridesSetOperation: Operation<OverridesSetInput, OverridesSetOutput> = {
  name: 'overrides.set',
  description: 'Attach or clear code overrides on a specific JSX canvas node',
  category: 'code',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T20',
  inputSchema: overridesSetInputSchema,
  async execute(snapshot, input, _context: OperationContext) {
    const sync = syncCodeSnapshotToProjectFS(snapshot);

    const code = projectFS.readFile(input.filePath);
    if (code === null) {
      throw new Error(`FILE_NOT_FOUND: Target file "${input.filePath}" not found in project.`);
    }

    if (!findSubtreeRange(code, input.nodeId)) {
      throw new Error(
        `NODE_NOT_FOUND: Node with data-id "${input.nodeId}" not found in "${input.filePath}".`,
      );
    }

    const normalizedOverrides: CodeOverrideRef[] = [];
    for (const ref of input.overrides) {
      let normFile = ref.file.trim();
      if (!normFile.startsWith(OVERRIDES_DIR)) {
        normFile = `${OVERRIDES_DIR}${normFile}`;
      }
      if (!normFile.endsWith('.tsx') && !normFile.endsWith('.ts')) {
        if (projectFS.readFile(normFile) !== null) {
          // file exists without extension
        } else if (projectFS.readFile(`${normFile}.tsx`) !== null) {
          normFile = `${normFile}.tsx`;
        } else if (projectFS.readFile(`${normFile}.ts`) !== null) {
          normFile = `${normFile}.ts`;
        } else {
          normFile = `${normFile}.tsx`;
        }
      }

      const overrideContent = projectFS.readFile(normFile);
      if (overrideContent === null) {
        throw new Error(
          `OVERRIDE_FILE_NOT_FOUND: Referenced override file "${normFile}" does not exist.`,
        );
      }

      const availableExports = listOverrideExports(overrideContent);
      if (!availableExports.includes(ref.name)) {
        throw new Error(
          `OVERRIDE_EXPORT_NOT_FOUND: Export "${ref.name}" not found in "${normFile}". Available exports: ${availableExports.join(', ')}`,
        );
      }

      normalizedOverrides.push({
        file: normFile,
        name: ref.name,
      });
    }

    const nextCode = setCodeOverridesInCode(code, input.nodeId, normalizedOverrides);
    projectFS.writeFile(input.filePath, nextCode);

    return {
      nodeId: input.nodeId,
      overrides: normalizedOverrides,
      changes: sync.collectChanges(),
    };
  },
};

// ─── 4. overrides.remove ──────────────────────────────────────────────────────

export const overridesRemoveInputSchema = z.object({
  filePath: z.string().min(1),
  nodeId: z.string().min(1),
});

export type OverridesRemoveInput = z.infer<typeof overridesRemoveInputSchema>;

export const overridesRemoveOperation: Operation<
  OverridesRemoveInput,
  OverridesSetOutput
> = {
  name: 'overrides.remove',
  description: 'Remove all code overrides from a specific JSX canvas node',
  category: 'code',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T20',
  inputSchema: overridesRemoveInputSchema,
  async execute(snapshot, input, context: OperationContext) {
    return overridesSetOperation.execute(
      snapshot,
      {
        filePath: input.filePath,
        nodeId: input.nodeId,
        overrides: [],
      },
      context,
    );
  },
};

// ─── Registry Registration ───────────────────────────────────────────────────

defaultRegistry.register(overridesCreateOperation);
defaultRegistry.register(overridesListOperation);
defaultRegistry.register(overridesSetOperation);
defaultRegistry.register(overridesRemoveOperation);

// Compatibility aliases
defaultRegistry.registerAlias('overrides.create', 'overrides.create');
defaultRegistry.registerAlias('overrides.list', 'overrides.list');
defaultRegistry.registerAlias('overrides.set', 'overrides.set');
defaultRegistry.registerAlias('overrides.apply', 'overrides.set');
defaultRegistry.registerAlias('code.overrides.create', 'overrides.create');
defaultRegistry.registerAlias('code.overrides.list', 'overrides.list');
defaultRegistry.registerAlias('code.overrides.apply', 'overrides.set');
defaultRegistry.registerAlias('code.overrides.set', 'overrides.set');
defaultRegistry.registerAlias('code.overrides.remove', 'overrides.remove');
