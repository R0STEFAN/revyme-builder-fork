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
import { createPlan } from '@revyme/automation-core';

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
    options?: { dryRun?: boolean; context?: Partial<OperationContext> }
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

    // Read-only meta operations can execute directly in-process without requiring project snapshot
    if (op.category === 'meta') {
      const emptySnapshot: Snapshot = {
        scope,
        revision: 0,
        files: new Map(),
        config: {},
      };
      const context: OperationContext = {
        createId: (prefix = 'op') => `${prefix}-${Date.now().toString(36)}`,
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
      return this.commit((validation.data as any).plan);
    }

    // Step 1: Fetch latest snapshot
    const snapshotResult = await this.getSnapshot(scope);
    if (!snapshotResult.ok || !snapshotResult.data) {
      return snapshotResult as unknown as Result<Receipt>;
    }
    const snapshot = snapshotResult.data;

    // Step 2: Prepare operation plan
    const context: OperationContext = {
      createId: (prefix = 'op') => `${prefix}-${Date.now().toString(36)}`,
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
      const operationId = context.createId('op');
      plan = createPlan({
        scope,
        baseRevision: snapshot.revision,
        operationId,
        changes: prepData.changes,
        createdIds: prepData.createdIds || (prepData.page?.id ? [prepData.page.id] : []),
        normalizations: prepData.normalizations,
        issues: prepData.issues,
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

    // If dry-run requested or operation is a read kind, return prepared plan without committing
    if (options?.dryRun || op.kind === 'read') {
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
    return this.commit(plan);
  }
}
