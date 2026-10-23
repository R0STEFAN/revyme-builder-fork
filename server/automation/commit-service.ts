// server/automation/commit-service.ts
import type {
  Plan,
  Receipt,
  Result,
  Issue,
} from '../../packages/automation-core/src/contracts';
import { validatePlan } from '../../packages/automation-core/src/validate';
import {
  type ProjectRepository,
  ConflictError,
} from './project-repository';

class ScopedLock {
  private activeLocks = new Map<string, Promise<void>>();

  async acquire<T>(key: string, fn: () => Promise<T>): Promise<T> {
    while (this.activeLocks.has(key)) {
      await this.activeLocks.get(key);
    }

    let releaseLock!: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    this.activeLocks.set(key, lockPromise);
    try {
      return await fn();
    } finally {
      this.activeLocks.delete(key);
      releaseLock();
    }
  }
}

export class CommitService {
  private locker = new ScopedLock();

  constructor(private repository: ProjectRepository) {}

  async commit(plan: Plan): Promise<Result<Receipt>> {
    const lockKey = `${plan.scope.projectId}:${plan.scope.branchId || 'main'}`;

    return this.locker.acquire(lockKey, async () => {
      // 0. Check idempotency: if plan with same operationId was already committed
      const existingReceipt = await this.repository.getReceipt(plan.scope.projectId, plan.operationId);
      if (existingReceipt) {
        if (existingReceipt.planHash === plan.planHash) {
          return {
            ok: true,
            data: existingReceipt,
            meta: {
              commitStatus: 'committed',
              revision: existingReceipt.revision,
              receipt: existingReceipt,
            },
          };
        } else {
          return {
            ok: false,
            error: {
              code: 'IDEMPOTENCY_CONFLICT',
              message: `Operation ${plan.operationId} was already committed with a different plan hash`,
              issues: [
                {
                  code: 'IDEMPOTENCY_CONFLICT',
                  path: ['operationId'],
                  message: 'Operation ID collision with different payload',
                },
              ],
            },
            meta: {
              commitStatus: 'not_committed',
              revision: existingReceipt.revision,
            },
          };
        }
      }

      // 1. Fetch current snapshot for validation
      const snapshot = await this.repository.getSnapshot(plan.scope);
      if (!snapshot) {
        return {
          ok: false,
          error: {
            code: 'PROJECT_NOT_FOUND',
            message: `Project ${plan.scope.projectId} not found`,
            issues: [{ code: 'PROJECT_NOT_FOUND', path: ['scope', 'projectId'], message: 'Project not found' }],
          },
          meta: {
            commitStatus: 'not_committed',
            revision: 0,
          },
        };
      }

      // 2. Validate plan against latest snapshot
      const validation = validatePlan(snapshot, plan);
      if (!validation.ok) {
        const hasStaleRevision = validation.issues.some((i) => i.code === 'STALE_REVISION');
        const code = hasStaleRevision ? 'REVISION_CONFLICT' : 'PLAN_VALIDATION_FAILED';
        return {
          ok: false,
          error: {
            code,
            message: hasStaleRevision
              ? `Revision conflict: expected base revision ${snapshot.revision}, got ${plan.baseRevision}`
              : `Plan validation failed with ${validation.issues.length} issue(s)`,
            issues: validation.issues,
          },
          meta: {
            commitStatus: 'not_committed',
            revision: snapshot.revision,
          },
        };
      }

      // 3. Apply plan with atomic CAS
      try {
        const receipt = await this.repository.applyPlan(plan);
        return {
          ok: true,
          data: receipt,
          meta: {
            commitStatus: 'committed',
            revision: receipt.revision,
            receipt,
          },
        };
      } catch (err) {
        if (err instanceof ConflictError) {
          return {
            ok: false,
            error: {
              code: err.code,
              message: err.message,
              issues: [{ code: err.code, path: ['revision'], message: err.message }],
            },
            meta: {
              commitStatus: 'not_committed',
              revision: snapshot.revision,
            },
          };
        }
        const msg = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          error: {
            code: 'COMMIT_FAILED',
            message: msg,
            issues: [{ code: 'INTERNAL_ERROR', path: [], message: msg }],
          },
          meta: {
            commitStatus: 'unknown',
            revision: snapshot.revision,
          },
        };
      }
    });
  }

  async status(projectId: string, operationId: string): Promise<Receipt | null> {
    return this.repository.getReceipt(projectId, operationId);
  }
}
