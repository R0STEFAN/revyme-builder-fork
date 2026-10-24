import type {
  Scope,
  Snapshot,
  Plan,
  Receipt,
  Result,
  Issue,
  OperationContext,
} from '@revyme/automation-core';
import { defaultRegistry } from '@revyme/automation-core';
import { prepareOperation } from '@revyme/automation-core';
import { createPlan, createIdFactory } from '@revyme/automation-core';
import { createHash } from 'node:crypto';

const HISTORY_PATH = '_meta/history.json';

function addHistory(plan: Plan, snapshot: Snapshot, createId: (kind?: string) => string): Plan {
  if (!plan.changes.length || plan.changes.some(change => change.path === HISTORY_PATH)) return plan;
  const raw = snapshot.files.get(HISTORY_PATH);
  let state: { undoStack: unknown[]; redoStack: unknown[] } = { undoStack: [], redoStack: [] };
  if (raw !== undefined) {
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.undoStack) || !Array.isArray(parsed.redoStack)) throw new Error('INVALID_HISTORY: History journal has invalid stacks');
    state = parsed;
  }
  const diffs = plan.changes.map(change => ({ path: change.path, oldContent: snapshot.files.get(change.path) ?? null, newContent: change.content }))
    .filter(diff => diff.oldContent !== diff.newContent);
  if (!diffs.length) return plan;
  state.undoStack = [...state.undoStack, { id: createId('hist'), timestamp: Date.now(), activeFile: plan.scope.filePath ?? diffs[0].path,
    branchId: plan.scope.branchId, diffs }].slice(-100);
  state.redoStack = [];
  const historyChange = { path: HISTORY_PATH, beforeHash: raw === undefined ? null : createHash('sha256').update(raw).digest('hex'), content: JSON.stringify(state) };
  return createPlan({ scope: plan.scope, baseRevision: plan.baseRevision, operationId: plan.operationId,
    changes: [...plan.changes, historyChange], createdIds: plan.createdIds, normalizations: plan.normalizations, issues: plan.issues });
}

export interface ClientOptions {
  apiUrl: string;
  timeoutMs?: number;
}

export class AutomationClient {
  private apiUrl: string;
  private timeoutMs: number;

  constructor(options: ClientOptions) {
    this.apiUrl = options.apiUrl.replace(/\/$/, '');
    this.timeoutMs = options.timeoutMs ?? 15000;
  }

  private async fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        ...init,
        signal: controller.signal,
      });
      return res;
    } finally {
      clearTimeout(timer);
    }
  }

  async getSnapshot(scope: Scope): Promise<Result<Snapshot>> {
    const url = `${this.apiUrl}/api/automation/snapshot?projectId=${encodeURIComponent(
      scope.projectId
    )}&branchId=${encodeURIComponent(scope.branchId || 'main')}${
      scope.filePath ? `&filePath=${encodeURIComponent(scope.filePath)}` : ''
    }`;

    try {
      const res = await this.fetchWithTimeout(url);
      const json = await res.json();
      if (!res.ok) {
        return json;
      }

      const payload =
        json.data && typeof json.data === 'object' && 'files' in json.data
          ? json.data
          : json.snapshot && typeof json.snapshot === 'object'
          ? json.snapshot
          : json.data || {};

      // Convert serialized files object to Map
      const filesMap = new Map<string, string>();
      if (payload.files && typeof payload.files === 'object') {
        for (const [filePath, content] of Object.entries(payload.files)) {
          filesMap.set(filePath, content as string);
        }
      }

      const snapshot: Snapshot = {
        scope: payload.scope || scope,
        revision: payload.revision ?? 0,
        files: filesMap,
        config: payload.config || {},
        branches: payload.branches,
        mainFiles: payload.mainFiles,
        activeBranchId: payload.activeBranchId,
      };

      return {
        ok: true,
        data: snapshot,
        meta: json.meta || {
          commitStatus: 'not_committed',
          revision: snapshot.revision,
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: {
          code: 'SERVER_UNAVAILABLE',
          message: `Failed to reach automation server at ${this.apiUrl}: ${err?.message || err}`,
          issues: [{ code: 'SERVER_UNAVAILABLE', path: [], message: String(err) }],
        },
        meta: {
          commitStatus: 'not_committed',
          revision: 0,
        },
      };
    }
  }

  async validatePlan(plan: Plan): Promise<Result<{ ok: boolean; issues: Issue[] }>> {
    const url = `${this.apiUrl}/api/automation/plan`;
    try {
      const res = await this.fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(plan),
      });
      return await res.json();
    } catch (err: any) {
      return {
        ok: false,
        error: {
          code: 'SERVER_UNAVAILABLE',
          message: `Failed to reach automation server at ${this.apiUrl}: ${err?.message || err}`,
          issues: [{ code: 'SERVER_UNAVAILABLE', path: [], message: String(err) }],
        },
        meta: {
          commitStatus: 'not_committed',
          revision: 0,
        },
      };
    }
  }

  async commit(plan: Plan): Promise<Result<Receipt>> {
    const url = `${this.apiUrl}/api/automation/commit`;
    try {
      const res = await this.fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(plan),
      });
      return await res.json();
    } catch (err: any) {
      return {
        ok: false,
        error: {
          code: 'SERVER_UNAVAILABLE',
          message: `Failed to commit plan to automation server at ${this.apiUrl}: ${err?.message || err}`,
          issues: [{ code: 'SERVER_UNAVAILABLE', path: [], message: String(err) }],
        },
        meta: {
          commitStatus: 'unknown',
          revision: 0,
        },
      };
    }
  }

  async getStatus(
    scope: Scope,
    operationId?: string
  ): Promise<Result<{ revision: number; healthy: boolean; receipt?: Receipt | null; found?: boolean }>> {
    let url = `${this.apiUrl}/api/automation/status?projectId=${encodeURIComponent(
      scope.projectId
    )}&branchId=${encodeURIComponent(scope.branchId || 'main')}`;
    if (operationId) {
      url += `&operationId=${encodeURIComponent(operationId)}`;
    }
    try {
      const res = await this.fetchWithTimeout(url);
      return await res.json();
    } catch (err: any) {
      return {
        ok: false,
        error: {
          code: 'SERVER_UNAVAILABLE',
          message: `Failed to reach automation server at ${this.apiUrl}: ${err?.message || err}`,
          issues: [{ code: 'SERVER_UNAVAILABLE', path: [], message: String(err) }],
        },
        meta: {
          commitStatus: 'not_committed',
          revision: 0,
        },
      };
    }
  }

  async execute(
    scope: Scope,
    toolName: string,
    input: unknown,
    options?: { dryRun?: boolean; context?: Partial<OperationContext>; _planHashRetried?: boolean }
  ): Promise<Result<Receipt | Plan | any>> {
    const op = defaultRegistry.get(toolName);
    if (!op) {
      const nearMatches = defaultRegistry.findNearMatches(toolName);
      return {
        ok: false,
        error: {
          code: 'UNKNOWN_OPERATION',
          message: `Operation "${toolName}" is not registered. Did you mean: ${nearMatches.join(', ')}?`,
          issues: [
            {
              code: 'UNKNOWN_OPERATION',
              path: [],
              message: `Operation "${toolName}" is not registered`,
            },
          ],
        },
        meta: {
          commitStatus: 'not_committed',
          revision: 0,
        },
      };
    }

    if (toolName === 'workflow.chain') {
      const validation = defaultRegistry.validateInput(toolName, input);
      if (!validation.ok) return { ok: false, error: { code: 'INVALID_INPUT', message: 'Invalid workflow steps', issues: validation.issues }, meta: { commitStatus: 'not_committed', revision: 0 } };
      const { steps } = validation.data as { steps: Array<{ tool: string; input: Record<string, unknown> }> };
      if (options?.dryRun) return this.execute(scope, 'workflow.batch', { operations: steps }, options);
      const receipts: Array<{ stepIndex: number; tool: string; status: 'ok' | 'failed'; result: Result<unknown> }> = [];
      let meta: Result['meta'] = { commitStatus: 'not_committed', revision: 0 };
      for (const [stepIndex, step] of steps.entries()) {
        if (options?.context?.signal?.aborted) return { ok: false, data: { completed: receipts.length, receipts }, error: { code: 'CANCELLED', message: 'Workflow cancelled', issues: [] }, meta };
        options?.context?.trace?.('workflow:step', { stepIndex, tool: step.tool, scope });
        const result = await this.execute(scope, step.tool, step.input, options);
        receipts.push({ stepIndex, tool: step.tool, status: result.ok ? 'ok' : 'failed', result });
        meta = { ...meta, ...result.meta, revision: Math.max(meta.revision, result.meta.revision),
          commitStatus: result.meta.commitStatus === 'unknown' ? 'unknown' : meta.commitStatus === 'committed' ? 'committed' : result.meta.commitStatus };
        if (!result.ok) return { ...result, data: { completed: stepIndex, receipts }, meta };
      }
      return { ok: true, data: { completed: receipts.length, receipts }, meta };
    }

    // Read-only meta operations can execute directly in-process without requiring project snapshot
    if (op.category === 'meta') {
      const emptySnapshot: Snapshot = {
        scope,
        revision: 0,
        files: new Map(),
        config: {},
      };
      const context: OperationContext = {
        createId: createIdFactory(),
        signal: new AbortController().signal,
        trace: () => {},
        adapters: {},
        ...options?.context,
      };

      const validation = defaultRegistry.validateInput(toolName, input);
      if (!validation.ok) {
        return {
          ok: false,
          error: {
            code: 'INVALID_INPUT',
            message: `Invalid input for ${toolName}`,
            issues: validation.issues,
          },
          meta: {
            commitStatus: 'not_committed',
            revision: 0,
          },
        };
      }

      try {
        const output = await op.execute(emptySnapshot, validation.data, context);
        return {
          ok: true,
          data: output,
          meta: {
            commitStatus: 'not_committed',
            revision: 0,
          },
        };
      } catch (err: any) {
        return {
          ok: false,
          error: {
            code: 'OPERATION_EXECUTION_ERROR',
            message: err?.message || String(err),
            issues: [{ code: 'EXECUTION_ERROR', path: [], message: String(err) }],
          },
          meta: {
            commitStatus: 'not_committed',
            revision: 0,
          },
        };
      }
    }

    // For plans.commit: commit directly via API
    if (toolName === 'plans.commit') {
      const validation = defaultRegistry.validateInput(toolName, input);
      if (!validation.ok) {
        return {
          ok: false,
          error: {
            code: 'INVALID_INPUT',
            message: 'Invalid input for plans.commit',
            issues: validation.issues,
          },
          meta: {
            commitStatus: 'not_committed',
            revision: 0,
          },
        };
      }
      const plan = (validation.data as any).plan as Plan;
      if (plan.scope.projectId !== scope.projectId || plan.scope.branchId !== scope.branchId) {
        return { ok: false, error: { code: 'SCOPE_MISMATCH', message: 'Plan scope does not match the requested project and branch', issues: [] },
          meta: { commitStatus: 'not_committed', revision: 0 } };
      }
      if (options?.dryRun) {
        const checked = await this.validatePlan(plan);
        return checked.ok ? { ok: true, data: plan, meta: checked.meta } : checked;
      }
      return this.commit(plan);
    }

    // Step 1: Fetch latest snapshot
    if (options?.dryRun && (op.environment === 'service' || op.kind === 'service')) {
      return { ok: false, error: { code: 'DRY_RUN_UNAVAILABLE', message: 'Service operations require a dedicated preview adapter', issues: [] }, meta: { commitStatus: 'not_committed', revision: 0 } };
    }
    const snapshotResult = await this.getSnapshot(scope);
    if (!snapshotResult.ok || !snapshotResult.data) {
      return snapshotResult as unknown as Result<Receipt>;
    }
    const snapshot = snapshotResult.data;

    // Step 2: Prepare operation plan
    const context: OperationContext = {
      createId: createIdFactory(),
      signal: new AbortController().signal,
      trace: () => {},
      adapters: {},
      ...options?.context,
    };

    const prep = await prepareOperation(snapshot, toolName, input, context);
    if (!prep.ok) {
      return prep as Result<Receipt>;
    }

    // Convert prepared operation output into a validated Plan if it produced changes
    let plan: Plan;
    const prepData = prep.data as any;
    if (prepData && typeof prepData === 'object' && prepData.plan && prepData.plan.planHash) {
      plan = prepData.plan;
    } else if (prepData && typeof prepData === 'object' && prepData.planHash) {
      plan = prepData;
    } else if (prepData && typeof prepData === 'object' && Array.isArray(prepData.changes)) {
      if (prepData.changes.length === 0 && !(prepData.issues?.length) && !prepData.projectAction) {
        return { ok: true, data: prep.data, meta: { commitStatus: 'not_committed', revision: snapshot.revision } };
      }
      const operationId = context.createId('op');
      plan = createPlan({
        scope,
        baseRevision: snapshot.revision,
        operationId,
        changes: prepData.changes,
        createdIds: prepData.createdIds || (prepData.page?.id ? [prepData.page.id] : []),
        normalizations: prepData.normalizations,
        issues: prepData.issues,
        projectAction: prepData.projectAction,
      });
    } else {
      // Read-only or metadata output without file changes
      return {
        ok: true,
        data: prep.data,
        meta: {
          commitStatus: 'not_committed',
          revision: snapshot.revision,
        },
      };
    }

    if (op.kind === 'mutation' && op.category !== 'history' && plan.changes.length) {
      try {
        plan = addHistory(plan, snapshot, context.createId);
        context.trace('history:record', { operation: op.name, files: plan.changes.length - 1 });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: { code: 'INVALID_HISTORY', message, issues: [{ code: 'INVALID_HISTORY', path: [HISTORY_PATH], message }] },
          meta: { commitStatus: 'not_committed', revision: snapshot.revision } };
      }
    }

    // If dry-run requested or operation is a read kind, return prepared plan without committing
    if (options?.dryRun || op.kind === 'read') {
      const checked = await this.validatePlan(plan);
      if (!checked.ok) return checked;
      return {
        ok: true,
        data: plan,
        meta: {
          commitStatus: 'not_committed',
          revision: snapshot.revision,
        },
      };
    }

    // Commit plan atomically via CAS
    const committed = await this.commit(plan);
    // A plan can be rejected while the local automation service finishes
    // synchronizing its snapshot immediately after a previous mutation. The
    // plan was never applied in this case, so one fresh snapshot + re-plan is
    // safe and preserves the server's CAS guarantees. Do not loop: a second
    // mismatch is a real failure the caller needs to see.
    if (!committed.ok && committed.error?.code === 'PLAN_HASH_MISMATCH' && !options?._planHashRetried) {
      return this.execute(scope, toolName, input, { ...options, _planHashRetried: true });
    }
    return committed;
  }
}
