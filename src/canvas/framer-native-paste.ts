import { trace } from '../shared/debug-trace';
import { decodeNativeTransfer } from '../code/import/framer-native/decode';
import { compileNativeTransfer } from '../code/import/framer-native/compile';
import type { NativeTransfer } from '../code/import/framer-native/types';
import type { Plan, Receipt, Scope, Snapshot } from '../../packages/automation-core/src/contracts';
import type { FramerImportSubmitInput } from '../../packages/automation-core/src/operations/framer-import';

export interface NativePasteServices {
  operationId(): string;
  flush(): Promise<void>;
  snapshot(): Promise<Snapshot>;
  assetPayloads(transfer: NativeTransfer, snapshot: Snapshot): Promise<Record<string, string>>;
  isCurrent(snapshot: Snapshot): boolean;
  prepare(input: FramerImportSubmitInput, operationId: string): Promise<Plan>;
  commit(plan: Plan): Promise<Receipt>;
  status(scope: Scope, operationId: string): Promise<Receipt | null>;
  apply(receipt: Receipt, plan: Plan): Promise<void>;
}

/** One user action owns one operation ID, including recovery of a lost response. */
export async function handleNativeTransferPaste(input: unknown, target: Scope, services: NativePasteServices): Promise<Receipt> {
  const transfer = decodeNativeTransfer(input);
  const operationId = services.operationId();
  trace.action('framer-native.paste-start', { operationId, projectId: target.projectId });
  await services.flush();
  const snapshot = await services.snapshot();
  if (snapshot.scope.projectId !== target.projectId || snapshot.scope.branchId !== target.branchId) throw new Error('TARGET_SCOPE_CHANGED');
  const payloads = await services.assetPayloads(transfer, snapshot);
  const compiled = compileNativeTransfer(transfer, { existingFiles: snapshot.files, mode: 'create', assetPayloads: payloads });
  if (compiled.diagnostics.length) throw new Error(compiled.diagnostics.map(item => `${item.code}: ${item.message}`).join('\n'));
  if (!services.isCurrent(snapshot)) throw new Error('LOCAL_CONTEXT_CHANGED');
  const plan = await services.prepare({ files: compiled.files, mode: 'create', target: { projectId: target.projectId, branchId: target.branchId, ...(target.filePath ? { filePath: target.filePath } : {}) }, expectedRevision: snapshot.revision, sourceManifest: { format: transfer.format, version: transfer.version, complete: true, context: transfer.context, rootIds: transfer.rootIds } }, operationId);
  if (plan.operationId !== operationId || plan.scope.projectId !== target.projectId || plan.scope.branchId !== target.branchId || plan.baseRevision !== snapshot.revision) throw new Error('IMPORT_PLAN_CONTEXT_MISMATCH');
  if (!services.isCurrent(snapshot)) throw new Error('LOCAL_CONTEXT_CHANGED');
  let receipt: Receipt;
  try { receipt = await services.commit(plan); }
  catch (error) {
    const recovered = await services.status(target, operationId).catch(() => null);
    if (!recovered) throw Object.assign(new Error(`IMPORT_COMMIT_UNKNOWN: ${operationId}`), { cause: error, operationId });
    receipt = recovered;
  }
  if (receipt.operationId !== operationId || receipt.planHash !== plan.planHash || receipt.projectId !== target.projectId || receipt.branchId !== target.branchId || receipt.revision <= snapshot.revision) throw new Error('IMPORT_RECEIPT_MISMATCH');
  try {
    if (!services.isCurrent(snapshot)) throw new Error('LOCAL_CONTEXT_CHANGED');
    await services.apply(receipt, plan);
  }
  catch (error) { throw Object.assign(new Error(`IMPORT_COMMITTED_SYNC_PENDING: ${operationId}`), { receipt, cause: error }); }
  trace.action('framer-native.paste-applied', { operationId, revision: receipt.revision });
  return receipt;
}
