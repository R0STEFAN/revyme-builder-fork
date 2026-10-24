// packages/automation-core/src/session.ts
import { createHash, randomUUID } from 'node:crypto';
import type {
  Scope,
  Snapshot,
  FileChange,
  Plan,
  OperationContext,
  Result,
  Issue,
} from './contracts';
import { defaultRegistry } from './registry';
import { normalizeCandidateChanges } from './ingestion/candidate';
import { prepareHistory } from './operations/scoped-history';
import { prepareScopedBranchAction, readScopedBranches } from './operations/scoped-branches';
import { prepareScopedRestore } from './operations/scoped-restore';

export function createIdFactory(prefix = 'id'): (kind?: string) => string {
  let counter = 1;
  const runId = randomUUID();
  return (kind?: string) => `${kind || prefix}-${runId}-${(counter++).toString(36)}`;
}

export function createSnapshot(
  scope: Scope,
  revision: number,
  files: Map<string, string> | Record<string, string>,
  config: Record<string, unknown> = {}
): Snapshot {
  const map = files instanceof Map ? new Map(files) : new Map(Object.entries(files));
  return {
    scope: { ...scope },
    revision,
    files: map,
    config: { ...config },
  };
}

export function createOperationContext(options: {
  createId?: (kind?: string) => string;
  signal?: AbortSignal;
  trace?: (event: string, data: Record<string, unknown>) => void;
  adapters?: Record<string, unknown>;
} = {}): OperationContext {
  const defaultCreateId = createIdFactory();
  const controller = new AbortController();
  return {
    createId: options.createId ?? defaultCreateId,
    signal: options.signal ?? controller.signal,
    trace: options.trace ?? ((_event, _data) => {}),
    adapters: options.adapters ?? {},
  };
}

export function calculatePlanHash(
  scope: Scope,
  baseRevision: number,
  operationId: string,
  changes: FileChange[],
  metadata?: Pick<Plan, 'createdIds' | 'policyVersion' | 'issues' | 'normalizations' | 'projectAction'>
): string {
  const hash = createHash('sha256');
  hash.update(JSON.stringify({ scope: { projectId: scope.projectId, branchId: scope.branchId, filePath: scope.filePath }, baseRevision, operationId }));
  hash.update(JSON.stringify(changes.map(({ path, beforeHash, content }) => ({ path, beforeHash, content }))));
  if (metadata) hash.update(JSON.stringify({ createdIds: metadata.createdIds, policyVersion: metadata.policyVersion,
    issues: metadata.issues.map(({ code, path, message, source }) => ({ code, path, message,
      source: source ? { file: source.file, line: source.line } : undefined })),
    normalizations: metadata.normalizations.map(({ rule, target, before, after }) => ({ rule, target, before, after })),
    projectAction: metadata.projectAction?.kind === 'project.restore' || metadata.projectAction?.kind === 'project.duplicate' ? metadata.projectAction : metadata.projectAction ? { kind: metadata.projectAction.kind, id: metadata.projectAction.id,
      ...('from' in metadata.projectAction ? { from: metadata.projectAction.from, createdAt: metadata.projectAction.createdAt } : {}),
      ...('mainChanges' in metadata.projectAction ? { appliedAt: metadata.projectAction.appliedAt, mainChanges: metadata.projectAction.mainChanges.map(({ path, beforeHash, content }) => ({ path, beforeHash, content })) } : {}) } : undefined }));
  return hash.digest('hex');
}

export async function prepareOperation(
  snapshot: Snapshot,
  operationName: string,
  input: unknown,
  context: OperationContext = createOperationContext()
): Promise<Result<unknown>> {
  const op = defaultRegistry.get(operationName);
  if (!op) {
    const near = defaultRegistry.findNearMatches(operationName);
    return {
      ok: false,
      error: {
        code: 'UNKNOWN_OPERATION',
        message: `Operation "${operationName}" not found. Did you mean: ${near.join(', ')}?`,
        issues: [
          {
            code: 'UNKNOWN_OPERATION',
            path: [],
            message: `Unknown operation: ${operationName}`,
          },
        ],
      },
      meta: {
        commitStatus: 'not_committed',
        revision: snapshot.revision,
      },
    };
  }

  const validation = defaultRegistry.validateInput(operationName, input);
  if (!validation.ok) {
    return {
      ok: false,
      error: {
        code: 'SCHEMA_VALIDATION_FAILED',
        message: `Validation failed for operation "${operationName}"`,
        issues: validation.issues,
      },
      meta: {
        commitStatus: 'not_committed',
        revision: snapshot.revision,
      },
    };
  }

  try {
    // Some legacy operation adapters synchronize through ProjectFS and mutate
    // their input snapshot while collecting candidate changes. Keep the source
    // snapshot immutable so normalization always calculates CAS hashes against
    // the server version, not an optimistic local candidate.
    const operationSnapshot: Snapshot = {
      ...snapshot,
      files: new Map(snapshot.files),
      config: { ...snapshot.config },
    };
    context.trace('operation:start', { name: operationName, scope: snapshot.scope });
    const data = op.name === 'projects.duplicate'
      ? (() => {
          const args = validation.data as { targetName: string; targetProjectId?: string; folderId?: string | null };
          const id = args.targetProjectId ?? context.createId('proj');
          const name = args.targetName.trim();
          if (!name || !/^[A-Za-z0-9_-]{1,120}$/.test(id) || id === snapshot.scope.projectId) throw new Error('Invalid duplicate project name or id');
          context.trace('projects:duplicate:prepare', { source: snapshot.scope.projectId, target: id });
          return { changes: [], createdIds: [id], projectAction: { kind: 'project.duplicate', id, name,
            ...(args.folderId === undefined ? {} : { folderId: args.folderId }) } };
        })()
      : op.name === 'branches.list' || op.name === 'branches.review'
      ? readScopedBranches(snapshot, op.name, validation.data as { branch?: string }, context)
      : op.name === 'branches.create' || op.name === 'branches.switch' || op.name === 'branches.delete' || op.name === 'branches.apply'
      ? prepareScopedBranchAction(snapshot, op.name, validation.data as { name?: string; branch?: string }, context)
      : op.name === 'projects.backup.restore'
      ? prepareScopedRestore(snapshot, validation.data as { backupPayload: string; restoreBranches: boolean; cleanOrphanFiles: boolean }, context)
      : op.name === 'history.undo' || op.name === 'history.redo'
      ? prepareHistory(snapshot, op.name === 'history.undo' ? 'undo' : 'redo', context)
      : await op.execute(operationSnapshot, validation.data, context);
    const candidate = data && typeof data === 'object' ? (data as any).plan ?? data : null;
    if (candidate && Array.isArray(candidate.changes)) {
      const normalized = normalizeCandidateChanges(snapshot, candidate.changes);
      candidate.changes = normalized.changes;
      candidate.issues = [...(candidate.issues ?? []), ...normalized.issues];
      candidate.normalizations = [...(candidate.normalizations ?? []), ...normalized.normalizations];
      if (candidate.planHash) candidate.planHash = calculatePlanHash(candidate.scope, candidate.baseRevision, candidate.operationId, candidate.changes, candidate);
      context.trace('operation:normalize', { name: operationName, files: normalized.changes.length, issues: normalized.issues.length });
    }
    context.trace('operation:success', { name: operationName });
    return {
      ok: true,
      data,
      meta: {
        commitStatus: 'not_committed',
        revision: snapshot.revision,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    context.trace('operation:error', { name: operationName, error: message });
    return {
      ok: false,
      error: {
        code: 'OPERATION_EXECUTION_FAILED',
        message,
        issues: [{ code: 'EXECUTION_ERROR', path: [], message }],
      },
      meta: {
        commitStatus: 'not_committed',
        revision: snapshot.revision,
      },
    };
  }
}
