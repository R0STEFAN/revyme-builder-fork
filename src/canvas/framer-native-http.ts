import { trace } from '../shared/debug-trace';
import type { Scope, Snapshot } from '../../packages/automation-core/src/contracts';
import type { NativePasteServices } from './framer-native-paste';

export function createNativePasteHttpServices(scope: Scope, editor: Pick<NativePasteServices, 'flush' | 'isCurrent' | 'apply' | 'signal'>, read: typeof fetch = globalThis.fetch): NativePasteServices {
  const query = new URLSearchParams({ projectId: scope.projectId, branchId: scope.branchId });
  async function request(path: string, body?: unknown, recovery = false) {
    const response = await read(`/api/automation/${path}`, { credentials: 'same-origin', signal: recovery ? undefined : editor.signal,
      ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    const envelope = await response.json();
    if (!response.ok || envelope.ok !== true) throw new Error(typeof envelope.error === 'string' ? envelope.error : envelope.error?.message ?? `IMPORT_HTTP_FAILED: ${response.status}`);
    return envelope.data;
  }
  return {
    ...editor,
    operationId: () => `framer-${crypto.randomUUID()}`,
    async snapshot(): Promise<Snapshot> {
      const data = await request(`snapshot?${query}`);
      if (data?.scope?.projectId !== scope.projectId || data?.scope?.branchId !== scope.branchId) throw new Error('SNAPSHOT_SCOPE_MISMATCH');
      if (!Number.isInteger(data.revision) || data.revision < 0 || !data.files || typeof data.files !== 'object' || Array.isArray(data.files) || Object.values(data.files).some(code => typeof code !== 'string')) throw new Error('SNAPSHOT_INVALID');
      trace.action('framer-native.http-snapshot', { projectId: scope.projectId, revision: data.revision });
      return { ...data, files: new Map(Object.entries(data.files as Record<string, string>)) };
    },
    prepare: (input, operationId) => request('framer/prepare', { input, operationId }),
    commit: plan => request('commit', plan),
    async status(target, operationId) {
      if (target.projectId !== scope.projectId || target.branchId !== scope.branchId) throw new Error('STATUS_SCOPE_MISMATCH');
      const data = await request(`status?${query}&operationId=${encodeURIComponent(operationId)}`, undefined, true);
      return data?.found === true ? data.receipt : null;
    },
  };
}
