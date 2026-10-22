// packages/automation-core/src/operations/code-components.ts
import { z } from 'zod';
import { createHash } from 'node:crypto';
import type { Operation, FileChange, Snapshot, OperationContext } from '../contracts';
import { defaultRegistry } from '../registry';
import { projectFS } from '@/code/project/project-fs';
import {
  parseComponentControlsMeta as parseControls,
  hasComponentControls,
  type ComponentControlsMeta,
} from '@/code/components/controls-parser';
import { checkFile } from '@/code/oracle/check-file';

// Synchronize snapshot files to projectFS and collect FileChanges
export function syncCodeSnapshotToProjectFS(snapshot?: Snapshot): {
  collectChanges: () => FileChange[];
} {
  const beforeFiles = new Map<string, string>();
  for (const path of projectFS.listFiles()) {
    const content = projectFS.readFile(path);
    if (content !== null) {
      beforeFiles.set(path, content);
    }
  }
  if (snapshot && snapshot.files && snapshot.files.size > 0) {
    for (const [path, content] of snapshot.files) {
      beforeFiles.set(path, content);
      if (projectFS.readFile(path) !== content) {
        projectFS.writeFile(path, content);
      }
    }
  }

  return {
    collectChanges() {
      const changes: FileChange[] = [];
      const currentPaths = new Set(projectFS.listFiles());

      for (const path of currentPaths) {
        const currentContent = projectFS.readFile(path);
        const beforeContent = beforeFiles.get(path);
        if (currentContent !== null && currentContent !== beforeContent) {
          changes.push({
            path,
            beforeHash: beforeContent ? createHash('sha256').update(beforeContent).digest('hex') : null,
            content: currentContent,
          });
        }
      }

      for (const [path, beforeContent] of beforeFiles) {
        if (!currentPaths.has(path)) {
          changes.push({
            path,
            beforeHash: createHash('sha256').update(beforeContent).digest('hex'),
            content: null,
          });
        }
      }

      if (snapshot && 'set' in snapshot.files) {
        const map = snapshot.files as Map<string, string>;
        for (const c of changes) {
          if (c.content === null) {
            map.delete(c.path);
          } else {
            map.set(c.path, c.content);
          }
        }
      }

      return changes;
    },
  };
}

// ─── 1. codeComponents.create ─────────────────────────────────────────────────

export const codeComponentsCreateInputSchema = z.object({
  name: z.string().regex(/^[A-Z][A-Za-z0-9]*$/, 'Component name must be PascalCase'),
  code: z.string().min(1),
  defaultWidth: z.number().positive().optional(),
  defaultHeight: z.number().positive().optional(),
});

export type CodeComponentsCreateInput = z.infer<typeof codeComponentsCreateInputSchema>;

export interface CodeComponentsCreateOutput {
  path: string;
  name: string;
  meta: ComponentControlsMeta;
  changes: FileChange[];
}

export const codeComponentsCreateOperation: Operation<
  CodeComponentsCreateInput,
  CodeComponentsCreateOutput
> = {
  name: 'codeComponents.create',
  description: 'Create a new code component with @controls schema, typed props, and Oracle check',
  category: 'code',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T20',
  inputSchema: codeComponentsCreateInputSchema,
  async execute(snapshot, input, _context: OperationContext) {
    const sync = syncCodeSnapshotToProjectFS(snapshot);
    const path = `components/${input.name}.tsx`;

    let finalCode = input.code;
    if (!finalCode.includes('use client')) {
      finalCode = `'use client';\n` + finalCode;
    }
    // Ensure default dimensions if not present
    if (!/@defaultWidth\b/.test(finalCode) && input.defaultWidth) {
      finalCode = `/** @defaultWidth ${input.defaultWidth} */\n` + finalCode;
    }
    if (!/@defaultHeight\b/.test(finalCode) && input.defaultHeight) {
      finalCode = `/** @defaultHeight ${input.defaultHeight} */\n` + finalCode;
    }

    // Parse and validate controls metadata
    const meta = parseControls(finalCode);
    if (!meta || !hasComponentControls(finalCode)) {
      throw new Error(
        `INVALID_CONTROLS: Code component "${input.name}" must contain a valid /** @controls {...} */ JSDoc annotation.`,
      );
    }

    // Run Oracle validation for code-component dialect
    const violations = checkFile(finalCode, {
      kind: 'code-component',
      path,
    });
    if (violations.length > 0) {
      const summary = violations.map((v) => `[${v.code}] ${v.message}`).join(' | ');
      throw new Error(`ORACLE_VIOLATION: Code component "${input.name}" failed Oracle gate: ${summary}`);
    }

    projectFS.writeFile(path, finalCode);

    return {
      path,
      name: input.name,
      meta,
      changes: sync.collectChanges(),
    };
  },
};

// ─── 2. codeComponents.get ────────────────────────────────────────────────────

export const codeComponentsGetInputSchema = z.object({
  name: z.string().min(1),
});

export type CodeComponentsGetInput = z.infer<typeof codeComponentsGetInputSchema>;

export interface CodeComponentsGetOutput {
  path: string;
  name: string;
  meta: ComponentControlsMeta | null;
  code: string;
}

export const codeComponentsGetOperation: Operation<
  CodeComponentsGetInput,
  CodeComponentsGetOutput
> = {
  name: 'codeComponents.get',
  description: 'Get code component source and parsed @controls metadata',
  category: 'code',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T20',
  inputSchema: codeComponentsGetInputSchema,
  async execute(snapshot, input, _context: OperationContext) {
    syncCodeSnapshotToProjectFS(snapshot);
    const baseName = input.name.replace(/^components\//, '').replace(/\.tsx$/, '');
    const path = `components/${baseName}.tsx`;

    const code = projectFS.readFile(path);
    if (code === null) {
      throw new Error(`COMPONENT_NOT_FOUND: Code component "${baseName}" not found at "${path}".`);
    }

    const meta = parseControls(code);

    return {
      path,
      name: baseName,
      meta,
      code,
    };
  },
};

// ─── 3. codeComponents.list ───────────────────────────────────────────────────

export const codeComponentsListInputSchema = z.object({});

export type CodeComponentsListInput = z.infer<typeof codeComponentsListInputSchema>;

export interface CodeComponentsListOutput {
  components: Array<{
    path: string;
    name: string;
    controls: string[];
  }>;
}

export const codeComponentsListOperation: Operation<
  CodeComponentsListInput,
  CodeComponentsListOutput
> = {
  name: 'codeComponents.list',
  description: 'List all code components in components/ with their parsed control prop keys',
  category: 'code',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T20',
  inputSchema: codeComponentsListInputSchema,
  async execute(snapshot, _input, _context: OperationContext) {
    syncCodeSnapshotToProjectFS(snapshot);
    const results: Array<{ path: string; name: string; controls: string[] }> = [];

    for (const filePath of projectFS.listFiles()) {
      if (filePath.startsWith('components/') && filePath.endsWith('.tsx')) {
        const code = projectFS.readFile(filePath);
        if (code && hasComponentControls(code)) {
          const meta = parseControls(code);
          const name = filePath.replace(/^components\//, '').replace(/\.tsx$/, '');
          results.push({
            path: filePath,
            name,
            controls: meta ? Object.keys(meta.controls) : [],
          });
        }
      }
    }

    return {
      components: results,
    };
  },
};

// ─── Registry Registration ───────────────────────────────────────────────────

defaultRegistry.register(codeComponentsCreateOperation);
defaultRegistry.register(codeComponentsGetOperation);
defaultRegistry.register(codeComponentsListOperation);

// Compatibility aliases
defaultRegistry.registerAlias('code-components.create', 'codeComponents.create');
defaultRegistry.registerAlias('code-components.get', 'codeComponents.get');
defaultRegistry.registerAlias('code-components.list', 'codeComponents.list');
defaultRegistry.registerAlias('code.components.create', 'codeComponents.create');
defaultRegistry.registerAlias('code.components.get', 'codeComponents.get');
defaultRegistry.registerAlias('code.components.list', 'codeComponents.list');
