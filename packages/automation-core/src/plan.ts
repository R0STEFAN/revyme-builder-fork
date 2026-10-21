// packages/automation-core/src/plan.ts
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type {
  Scope,
  Snapshot,
  FileChange,
  Normalization,
  Issue,
  Plan,
  Receipt,
  Operation,
  OperationContext,
} from './contracts';
import { PlanSchema } from './contracts';
import { calculatePlanHash, prepareOperation } from './session';
import { defaultRegistry } from './registry';

export const POLICY_VERSION = '2026-10-21.v2';

export function createPlan(options: {
  scope: Scope;
  baseRevision: number;
  operationId: string;
  changes: FileChange[];
  createdIds?: string[];
  normalizations?: Normalization[];
  issues?: Issue[];
}): Plan {
  const scope = { ...options.scope };
  const baseRevision = options.baseRevision;
  const operationId = options.operationId;
  const changes = [...options.changes];
  const createdIds = options.createdIds ? [...options.createdIds] : [];
  const normalizations = options.normalizations ? [...options.normalizations] : [];
  const issues = options.issues ? [...options.issues] : [];

  const planHash = calculatePlanHash(scope, baseRevision, operationId, changes);

  return {
    scope,
    baseRevision,
    operationId,
    changes,
    createdIds,
    policyVersion: POLICY_VERSION,
    planHash,
    issues,
    normalizations,
  };
}

// workflow.batch operation
export const workflowBatchOperation: Operation<
  {
    operations: Array<{
      tool: string;
      input: Record<string, unknown>;
    }>;
  },
  {
    success: boolean;
    plan: Plan;
  }
> = {
  name: 'workflow.batch',
  description: 'Plan an atomic multi-step batch of operations into a single validated Plan',
  category: 'workflow',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T03',
  inputSchema: z.object({
    operations: z.array(
      z.object({
        tool: z.string().min(1),
        input: z.record(z.string(), z.unknown()),
      })
    ).min(1),
  }),
  async execute(snapshot, input, context) {
    const issues: Issue[] = [];
    const normalizations: Normalization[] = [];
    const createdIds: string[] = [];
    const accumulatedChanges: FileChange[] = [];

    let currentSnapshot = snapshot;

    for (let i = 0; i < input.operations.length; i++) {
      const step = input.operations[i];
      const res = await prepareOperation(currentSnapshot, step.tool, step.input, context);

      if (!res.ok) {
        issues.push({
          code: 'BATCH_STEP_FAILED',
          path: ['operations', i],
          message: `Batch step ${i} (${step.tool}) failed: ${res.error?.message}`,
        });
        if (res.error?.issues) {
          issues.push(...res.error.issues);
        }
        break; // Stop immediately on failure
      }

      // Check if step produced file changes
      if (res.data && typeof res.data === 'object' && 'changes' in (res.data as any)) {
        const changes = (res.data as any).changes as FileChange[];
        if (Array.isArray(changes)) {
          accumulatedChanges.push(...changes);
          // Update candidate snapshot for subsequent steps
          const nextFiles = new Map(currentSnapshot.files);
          for (const ch of changes) {
            if (ch.content === null) {
              nextFiles.delete(ch.path);
            } else {
              nextFiles.set(ch.path, ch.content);
            }
          }
          currentSnapshot = {
            ...currentSnapshot,
            files: nextFiles,
          };
        }
      }
    }

    const plan = createPlan({
      scope: snapshot.scope,
      baseRevision: snapshot.revision,
      operationId: context.createId('batch'),
      changes: accumulatedChanges,
      createdIds,
      normalizations,
      issues,
    });

    if (issues.length > 0) {
      throw new Error(`Batch execution encountered ${issues.length} issues: ${issues.map((iss) => iss.message).join('; ')}`);
    }

    return {
      success: true,
      plan,
    };
  },
};

// workflow.chain operation
export const workflowChainOperation: Operation<
  {
    steps: Array<{
      tool: string;
      input: Record<string, unknown>;
    }>;
  },
  {
    completed: number;
    receipts: Array<{
      stepIndex: number;
      tool: string;
      status: 'ok' | 'failed';
      data?: unknown;
      error?: string;
    }>;
  }
> = {
  name: 'workflow.chain',
  description: 'Execute a sequential chain of operations with explicit per-step receipts',
  category: 'workflow',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T03',
  inputSchema: z.object({
    steps: z.array(
      z.object({
        tool: z.string().min(1),
        input: z.record(z.string(), z.unknown()),
      })
    ).min(1),
  }),
  async execute(snapshot, input, context) {
    const receipts: Array<{
      stepIndex: number;
      tool: string;
      status: 'ok' | 'failed';
      data?: unknown;
      error?: string;
    }> = [];

    let currentSnapshot = snapshot;

    for (let i = 0; i < input.steps.length; i++) {
      const step = input.steps[i];
      const res = await prepareOperation(currentSnapshot, step.tool, step.input, context);

      if (!res.ok) {
        receipts.push({
          stepIndex: i,
          tool: step.tool,
          status: 'failed',
          error: res.error?.message,
        });
        break; // Stop on first failure
      }

      receipts.push({
        stepIndex: i,
        tool: step.tool,
        status: 'ok',
        data: res.data,
      });

      if (res.data && typeof res.data === 'object' && 'changes' in (res.data as any)) {
        const changes = (res.data as any).changes as FileChange[];
        if (Array.isArray(changes)) {
          const nextFiles = new Map(currentSnapshot.files);
          for (const ch of changes) {
            if (ch.content === null) {
              nextFiles.delete(ch.path);
            } else {
              nextFiles.set(ch.path, ch.content);
            }
          }
          currentSnapshot = {
            ...currentSnapshot,
            files: nextFiles,
          };
        }
      }
    }

    return {
      completed: receipts.filter((r) => r.status === 'ok').length,
      receipts,
    };
  },
};

// plans.commit operation
export const plansCommitOperation: Operation<
  { plan: Plan },
  { receipt: Receipt }
> = {
  name: 'plans.commit',
  description: 'Commit a previously generated plan atomically via CAS and return durable receipt',
  category: 'plans',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T05',
  inputSchema: z.object({
    plan: PlanSchema,
  }),
  async execute(snapshot, input, context) {
    if (context.adapters && typeof (context.adapters as any).commitService?.commit === 'function') {
      const res = await (context.adapters as any).commitService.commit(input.plan);
      if (!res.ok) {
        throw new Error(res.error?.message || 'Commit failed');
      }
      return { receipt: res.data };
    }
    // Headless / in-memory fallback: validate baseRevision and planHash
    if (input.plan.baseRevision !== snapshot.revision) {
      throw new Error(`Revision conflict: snapshot is at ${snapshot.revision}, plan has baseRevision ${input.plan.baseRevision}`);
    }
    const expectedHash = calculatePlanHash(
      input.plan.scope,
      input.plan.baseRevision,
      input.plan.operationId,
      input.plan.changes
    );
    if (expectedHash !== input.plan.planHash) {
      throw new Error(`Plan hash mismatch: calculated ${expectedHash}, plan has ${input.plan.planHash}`);
    }
    return {
      receipt: {
        operationId: input.plan.operationId,
        projectId: input.plan.scope.projectId,
        branchId: input.plan.scope.branchId || 'main',
        revision: snapshot.revision + 1,
        planHash: input.plan.planHash,
        changedFiles: input.plan.changes.map((c) => c.path),
      },
    };
  },
};

// Register workflow operations in defaultRegistry
defaultRegistry.register(workflowBatchOperation);
defaultRegistry.register(workflowChainOperation);
defaultRegistry.register(plansCommitOperation);

