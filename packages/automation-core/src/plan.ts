// packages/automation-core/src/plan.ts
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
  ProjectAction,
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
  projectAction?: ProjectAction;
}): Plan {
  const scope = { ...options.scope };
  const baseRevision = options.baseRevision;
  const operationId = options.operationId;
  const changes = [...options.changes];
  const createdIds = options.createdIds ? [...options.createdIds] : [];
  const normalizations = options.normalizations ? [...options.normalizations] : [];
  const issues = options.issues ? [...options.issues] : [];

  const planHash = calculatePlanHash(scope, baseRevision, operationId, changes,
    { createdIds, policyVersion: POLICY_VERSION, issues, normalizations, projectAction: options.projectAction });

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
    ...(options.projectAction ? { projectAction: options.projectAction } : {}),
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
    const accumulatedChanges = new Map<string, FileChange>();

    let currentSnapshot = snapshot;

    for (let i = 0; i < input.operations.length; i++) {
      const step = input.operations[i];
      const operation = defaultRegistry.get(step.tool);
      if (step.tool === 'workflow.chain' || step.tool === 'plans.commit' || operation?.environment === 'service') {
        throw new Error(`BATCH_SIDE_EFFECT_FORBIDDEN: ${step.tool} cannot run inside an atomic candidate batch`);
      }
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
      const candidate = res.data && typeof res.data === 'object' ? (res.data as any).plan ?? res.data : null;
      if (candidate?.projectAction) throw new Error('BATCH_SIDE_EFFECT_FORBIDDEN: Project actions cannot run in a file batch');
      if (candidate && 'changes' in candidate) {
        issues.push(...(candidate.issues ?? []));
        normalizations.push(...(candidate.normalizations ?? []));
        if (Array.isArray(candidate.createdIds)) createdIds.push(...candidate.createdIds);
        const changes = candidate.changes as FileChange[];
        if (Array.isArray(changes)) {
          for (const change of changes) {
            const previous = accumulatedChanges.get(change.path);
            if (previous) {
              accumulatedChanges.set(change.path, { ...change, beforeHash: previous.beforeHash });
              context.trace('workflow:change-coalesced', {
                path: change.path,
                stepIndex: i,
              });
            } else {
              accumulatedChanges.set(change.path, change);
            }
          }
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
      changes: [...accumulatedChanges.values()].filter((change) => {
        const originalContent = snapshot.files.has(change.path)
          ? snapshot.files.get(change.path)!
          : null;
        return originalContent !== change.content;
      }),
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
      const operation = defaultRegistry.get(step.tool);
      if (operation && operation.kind !== 'read' && operation.kind !== 'observation') {
        throw new Error('DURABLE_EXECUTOR_REQUIRED: Execute mutation chains through the CLI/MCP client');
      }
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
    throw new Error('DURABLE_EXECUTOR_REQUIRED: A commit service is required to commit a plan');
  },
};

// Register workflow operations in defaultRegistry
defaultRegistry.register(workflowBatchOperation);
defaultRegistry.register(workflowChainOperation);
defaultRegistry.register(plansCommitOperation);

