// packages/automation-core/src/contracts.ts
import { z } from 'zod';

export interface Scope {
  projectId: string;
  branchId: string;
  filePath?: string;
}

export interface Snapshot {
  scope: Scope;
  revision: number;
  files: ReadonlyMap<string, string>;
  config: Readonly<Record<string, unknown>>;
  branches?: Readonly<Record<string, unknown>>;
  mainFiles?: Readonly<Record<string, string>>;
  activeBranchId?: string;
}

export interface FileChange {
  path: string;
  beforeHash: string | null;
  content: string | null; // null indicates deletion
}

export interface Issue {
  code: string;
  path: Array<string | number>;
  message: string;
  source?: { file: string; line: number };
}

export interface Normalization {
  rule: string;
  target: string;
  before: string;
  after: string;
}

export type ProjectAction =
  | { kind: 'branch.create'; id: string; from: string; createdAt: number }
  | { kind: 'branch.switch'; id: string }
  | { kind: 'branch.delete'; id: string }
  | { kind: 'branch.apply'; id: string; appliedAt: number; mainChanges: FileChange[] }
  | { kind: 'project.duplicate'; id: string; name: string; folderId?: string | null }
  | { kind: 'project.restore'; mainChanges: FileChange[]; branches?: Record<string, unknown>; activeBranchId?: string };

export interface Plan {
  scope: Scope;
  baseRevision: number;
  operationId: string;
  changes: FileChange[];
  createdIds: string[];
  policyVersion: string;
  planHash: string;
  issues: Issue[];
  normalizations: Normalization[];
  projectAction?: ProjectAction;
}

export interface Receipt {
  operationId: string;
  projectId: string;
  branchId: string;
  revision: number;
  planHash: string;
  changedFiles: string[];
  createdIds?: string[];
}

export type OperationKind = 'read' | 'mutation' | 'observation' | 'service';
export type OperationEnvironment = 'headless' | 'browser' | 'service';

export interface OperationContext {
  createId(kind?: string): string;
  signal: AbortSignal;
  trace(event: string, data: Record<string, unknown>): void;
  adapters: Readonly<Record<string, unknown>>;
}

export interface Operation<I = unknown, O = unknown> {
  name: string;
  description: string;
  category: string;
  inputSchema: z.ZodType<I>;
  outputSchema?: z.ZodType<O>;
  kind: OperationKind;
  permit: string;
  environment: OperationEnvironment;
  ownerTask: string;
  execute(snapshot: Snapshot, input: I, context: OperationContext): Promise<O>;
}

export interface Result<T = unknown> {
  ok: boolean;
  data?: T;
  /** Domain output from a committed mutation, excluding its file-change payload. */
  operationResult?: unknown;
  error?: {
    code: string;
    message: string;
    issues: Issue[];
  };
  meta: {
    commitStatus: 'not_committed' | 'committed' | 'unknown';
    revision: number;
    receipt?: Receipt;
  };
}

// Zod schemas for runtime schema validation & reflection
export const ScopeSchema = z.object({
  projectId: z.string().min(1),
  branchId: z.string().min(1),
  filePath: z.string().optional(),
});

export const FileChangeSchema = z.object({
  path: z.string(),
  beforeHash: z.string().nullable(),
  content: z.string().nullable(),
});

export const IssueSchema = z.object({
  code: z.string(),
  path: z.array(z.union([z.string(), z.number()])),
  message: z.string(),
  source: z.object({ file: z.string(), line: z.number() }).optional(),
});

export const NormalizationSchema = z.object({
  rule: z.string(),
  target: z.string(),
  before: z.string(),
  after: z.string(),
});

export const PlanSchema = z.object({
  scope: ScopeSchema,
  baseRevision: z.number().int().nonnegative(),
  operationId: z.string().min(1),
  changes: z.array(FileChangeSchema),
  createdIds: z.array(z.string()),
  policyVersion: z.string(),
  planHash: z.string(),
  issues: z.array(IssueSchema),
  normalizations: z.array(NormalizationSchema),
  projectAction: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('branch.create'), id: z.string().min(1), from: z.string().min(1), createdAt: z.number().int().nonnegative() }),
    z.object({ kind: z.literal('branch.switch'), id: z.string().min(1) }),
    z.object({ kind: z.literal('branch.delete'), id: z.string().min(1) }),
    z.object({ kind: z.literal('branch.apply'), id: z.string().min(1), appliedAt: z.number().int().nonnegative(), mainChanges: z.array(FileChangeSchema) }),
    z.object({ kind: z.literal('project.duplicate'), id: z.string().min(1), name: z.string().min(1).max(120), folderId: z.string().nullable().optional() }),
    z.object({ kind: z.literal('project.restore'), mainChanges: z.array(FileChangeSchema),
      branches: z.record(z.string(), z.unknown()).optional(), activeBranchId: z.string().optional() }),
  ]).optional(),
});

export const ReceiptSchema = z.object({
  operationId: z.string(),
  projectId: z.string(),
  branchId: z.string(),
  revision: z.number(),
  planHash: z.string(),
  changedFiles: z.array(z.string()),
  createdIds: z.array(z.string()).optional(),
});
