// packages/automation-core/src/operations/code-files.ts
import { z } from 'zod';
import { createHash } from 'node:crypto';
import type { Operation, FileChange, Snapshot, OperationContext } from '../contracts';
import { defaultRegistry } from '../registry';
import { projectFS } from '@/code/project/project-fs';
import { checkFile, type FileKind } from '@/code/oracle/check-file';
import { isCodeComponentSource } from '@/code/oracle/checks/shared';
import { isLayoutFile } from '@/code/project/active-file-store';
import { syncCodeSnapshotToProjectFS } from './code-components';

export const PROTECTED_SYSTEM_FILES = new Set([
  'package.json',
  'tsconfig.json',
  'next.config.mjs',
  'next.config.js',
]);

export function isSystemProtectedPath(path: string): boolean {
  return (
    path.startsWith('_meta/') ||
    path === '_meta' ||
    path.startsWith('.git/') ||
    path === '.git' ||
    path.startsWith('node_modules/') ||
    path === 'node_modules' ||
    path.startsWith('.next/') ||
    path === '.next'
  );
}

export function assertValidProjectPath(path: string): void {
  const p = path.trim();
  if (!p) {
    throw new Error('PATH_ERROR: File path cannot be empty.');
  }
  if (
    p.startsWith('/') ||
    p.startsWith('\\') ||
    /^[a-zA-Z]:/.test(p) ||
    p.includes('..') ||
    p.includes('\0')
  ) {
    throw new Error(`PATH_TRAVERSAL: Path "${p}" is outside the active project workspace.`);
  }
}

// ─── 1. codeFiles.list ────────────────────────────────────────────────────────

export const codeFilesListInputSchema = z.object({
  directory: z.string().optional(),
  extension: z.string().optional(),
});

export type CodeFilesListInput = z.infer<typeof codeFilesListInputSchema>;

export interface CodeFilesListOutput {
  files: string[];
}

export const codeFilesListOperation: Operation<CodeFilesListInput, CodeFilesListOutput> = {
  name: 'codeFiles.list',
  description: 'List project files, filtering out protected system directories',
  category: 'code',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T20',
  inputSchema: codeFilesListInputSchema,
  async execute(snapshot, input, _context: OperationContext) {
    syncCodeSnapshotToProjectFS(snapshot);
    let files = projectFS.listFiles().filter((p) => !isSystemProtectedPath(p));

    if (input.directory) {
      const dir = input.directory.replace(/^\.\//, '').replace(/\/$/, '') + '/';
      files = files.filter((p) => p.startsWith(dir));
    }

    if (input.extension) {
      const ext = input.extension.startsWith('.') ? input.extension : '.' + input.extension;
      files = files.filter((p) => p.endsWith(ext));
    }

    return { files: files.sort() };
  },
};

// ─── 2. codeFiles.read ────────────────────────────────────────────────────────

export const codeFilesReadInputSchema = z.object({
  path: z.string().min(1),
  fromLine: z.number().int().positive().optional(),
  toLine: z.number().int().positive().optional(),
});

export type CodeFilesReadInput = z.infer<typeof codeFilesReadInputSchema>;

export interface CodeFilesReadOutput {
  path: string;
  content: string;
  totalLines: number;
  sliceLines?: {
    from: number;
    to: number;
  };
}

export const codeFilesReadOperation: Operation<CodeFilesReadInput, CodeFilesReadOutput> = {
  name: 'codeFiles.read',
  description: 'Read file content from ProjectFS with optional line slicing',
  category: 'code',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T20',
  inputSchema: codeFilesReadInputSchema,
  async execute(snapshot, input, _context: OperationContext) {
    syncCodeSnapshotToProjectFS(snapshot);
    assertValidProjectPath(input.path);

    const content = projectFS.readFile(input.path);
    if (content === null) {
      throw new Error(`FILE_NOT_FOUND: Target file "${input.path}" does not exist in project.`);
    }

    const lines = content.split('\n');
    const totalLines = lines.length;

    if (input.fromLine !== undefined || input.toLine !== undefined) {
      const from = Math.max(1, input.fromLine ?? 1);
      const to = Math.min(totalLines, input.toLine ?? totalLines);
      if (from > to) {
        throw new Error(`INVALID_LINE_RANGE: fromLine (${from}) cannot be greater than toLine (${to}).`);
      }
      const sliced = lines.slice(from - 1, to).join('\n');
      return {
        path: input.path,
        content: sliced,
        totalLines,
        sliceLines: { from, to },
      };
    }

    return {
      path: input.path,
      content,
      totalLines,
    };
  },
};

// ─── 3. codeFiles.search ──────────────────────────────────────────────────────

export const codeFilesSearchInputSchema = z.object({
  query: z.string().min(1),
  isRegex: z.boolean().optional(),
  caseSensitive: z.boolean().optional(),
});

export type CodeFilesSearchInput = z.infer<typeof codeFilesSearchInputSchema>;

export interface CodeFilesSearchMatch {
  path: string;
  line: number;
  content: string;
}

export interface CodeFilesSearchOutput {
  matches: CodeFilesSearchMatch[];
}

export const codeFilesSearchOperation: Operation<CodeFilesSearchInput, CodeFilesSearchOutput> = {
  name: 'codeFiles.search',
  description: 'Search project files for matching lines using literal or regex patterns',
  category: 'code',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T20',
  inputSchema: codeFilesSearchInputSchema,
  async execute(snapshot, input, _context: OperationContext) {
    syncCodeSnapshotToProjectFS(snapshot);
    const matches: CodeFilesSearchMatch[] = [];

    let regex: RegExp | null = null;
    if (input.isRegex) {
      try {
        regex = new RegExp(input.query, input.caseSensitive ? '' : 'i');
      } catch (err) {
        throw new Error(`INVALID_REGEX: ${(err as Error).message}`);
      }
    }

    const queryLower = input.query.toLowerCase();

    for (const path of projectFS.listFiles()) {
      if (isSystemProtectedPath(path)) continue;
      const content = projectFS.readFile(path);
      if (!content) continue;

      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        let isMatch = false;

        if (regex) {
          isMatch = regex.test(line);
        } else if (input.caseSensitive) {
          isMatch = line.includes(input.query);
        } else {
          isMatch = line.toLowerCase().includes(queryLower);
        }

        if (isMatch) {
          matches.push({
            path,
            line: i + 1,
            content: line,
          });
        }
      }
    }

    return { matches };
  },
};

// ─── 4. codeFiles.submit (Guarded Batch Submit) ───────────────────────────────

export const codeFilesSubmitInputSchema = z.object({
  files: z
    .array(
      z.object({
        path: z.string().min(1),
        code: z.string().nullable(),
        kind: z
          .enum(['page', 'template', 'component', 'code-component', 'asset', 'config', 'other'])
          .optional(),
        baseHash: z.string().optional(),
      }),
    )
    .min(1),
});

export type CodeFilesSubmitInput = z.infer<typeof codeFilesSubmitInputSchema>;

export interface CodeFilesSubmitOutput {
  committed: boolean;
  changedFiles: string[];
  changes: FileChange[];
}

export const codeFilesSubmitOperation: Operation<CodeFilesSubmitInput, CodeFilesSubmitOutput> = {
  name: 'codeFiles.submit',
  description:
    'Guarded batch file submit with CAS hash matching, protected path enforcement, and Oracle verification',
  category: 'code',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T20',
  inputSchema: codeFilesSubmitInputSchema,
  async execute(snapshot, input, _context: OperationContext) {
    const sync = syncCodeSnapshotToProjectFS(snapshot);

    // Phase 1: Path traversal & protected paths checks
    for (const f of input.files) {
      assertValidProjectPath(f.path);
      if (PROTECTED_SYSTEM_FILES.has(f.path) || isSystemProtectedPath(f.path)) {
        throw new Error(
          `PROTECTED_PATH: Modifying protected system file "${f.path}" is disallowed.`,
        );
      }
    }

    // Phase 2: CAS (Compare-And-Swap) Check
    for (const f of input.files) {
      if (f.baseHash !== undefined) {
        const existing = projectFS.readFile(f.path);
        const currentHash =
          existing !== null
            ? createHash('sha256').update(existing).digest('hex')
            : null;
        if (f.baseHash !== currentHash) {
          throw new Error(
            `CAS_CONFLICT: Base hash conflict on "${f.path}". Expected "${f.baseHash}", but current hash is "${currentHash}".`,
          );
        }
      }
    }

    // Phase 3: Oracle Verification Gate for TSX / TS files
    const projectFileSet = new Set(snapshot.files?.size ? snapshot.files.keys() : projectFS.listFiles());
    for (const f of input.files) {
      if (f.code !== null) {
        projectFileSet.add(f.path);
      } else {
        projectFileSet.delete(f.path);
      }
    }

    for (const f of input.files) {
      if (f.code !== null && (f.path.endsWith('.tsx') || f.path.endsWith('.ts'))) {
        // Next.js server layouts are structural wrappers, not editable canvas
        // templates. The full MCP plan validator still checks their syntax and
        // relative imports; the canvas Oracle would reject valid metadata/CSS
        // imports and the required <html>/<body> structure.
        if (/(^|\/)layout\.(tsx|ts)$/.test(f.path)) continue;

        let kind: FileKind = 'page';
        if (f.kind === 'template' || isLayoutFile(f.path)) {
          kind = 'template';
        } else if (f.kind === 'component' || f.path.startsWith('components/')) {
          kind = isCodeComponentSource(f.code) ? 'code-component' : 'component';
        } else if (f.kind === 'code-component') {
          kind = 'code-component';
        } else if (f.kind === 'page' || /(^|\/)page(\.client)?\.tsx$/.test(f.path)) {
          kind = 'page';
        } else {
          // If kind is 'asset', 'config', or 'other', skip Oracle gate
          continue;
        }

        const violations = checkFile(f.code, {
          kind,
          path: f.path,
          projectFiles: projectFileSet,
        });

        if (violations.length > 0) {
          const summary = violations.map((v) => `[${v.code}] ${v.message}`).join(' | ');
          throw new Error(
            `ORACLE_VIOLATION: Batch rejected due to ${violations.length} violation(s) in "${f.path}": ${summary}`,
          );
        }
      }
    }

    // Phase 4: Atomic Commit (all validations passed)
    const changedFiles: string[] = [];
    for (const f of input.files) {
      if (f.code === null) {
        projectFS.deleteFile(f.path);
      } else {
        projectFS.writeFile(f.path, f.code);
      }
      changedFiles.push(f.path);
    }

    return {
      committed: true,
      changedFiles,
      changes: sync.collectChanges(),
    };
  },
};

// ─── Registry Registration ───────────────────────────────────────────────────

defaultRegistry.register(codeFilesListOperation);
defaultRegistry.register(codeFilesReadOperation);
defaultRegistry.register(codeFilesSearchOperation);
defaultRegistry.register(codeFilesSubmitOperation);

// Compatibility aliases
defaultRegistry.registerAlias('code-files.list', 'codeFiles.list');
defaultRegistry.registerAlias('code-files.read', 'codeFiles.read');
defaultRegistry.registerAlias('code-files.search', 'codeFiles.search');
defaultRegistry.registerAlias('code-files.submit', 'codeFiles.submit');
defaultRegistry.registerAlias('code.files.list', 'codeFiles.list');
defaultRegistry.registerAlias('code.files.read', 'codeFiles.read');
defaultRegistry.registerAlias('code.files.get', 'codeFiles.read');
defaultRegistry.registerAlias('code.files.search', 'codeFiles.search');
defaultRegistry.registerAlias('code.files.submit', 'codeFiles.submit');
defaultRegistry.registerAlias('code.files.write', 'codeFiles.submit');
defaultRegistry.registerAlias('code-files.patch', 'codeFiles.submit');
