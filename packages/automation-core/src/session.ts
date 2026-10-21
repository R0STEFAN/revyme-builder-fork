// packages/automation-core/src/session.ts
import { createHash } from 'node:crypto';
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

export function createIdFactory(prefix = 'id'): (kind?: string) => string {
  let counter = 1;
  return (kind?: string) => `${kind || prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`;
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
  changes: FileChange[]
): string {
  const hash = createHash('sha256');
  hash.update(JSON.stringify({ scope, baseRevision, operationId }));
  for (const change of changes) {
    hash.update(change.path);
    hash.update(change.beforeHash ?? 'null');
    hash.update(change.content ?? 'null');
  }
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
    context.trace('operation:start', { name: operationName, scope: snapshot.scope });
    const data = await op.execute(snapshot, validation.data, context);
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
