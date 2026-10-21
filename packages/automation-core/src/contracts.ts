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
}

export interface Receipt {
  operationId: string;
  projectId: string;
  branchId: string;
  revision: number;
  planHash: string;
  changedFiles: string[];
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
});

export const ReceiptSchema = z.object({
  operationId: z.string(),
  projectId: z.string(),
  branchId: z.string(),
  revision: z.number(),
  planHash: z.string(),
  changedFiles: z.array(z.string()),
});
