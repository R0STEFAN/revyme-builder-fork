import { trace } from '../shared/debug-trace';
import { decodeNativeTransfer } from '../code/import/framer-native/decode';
import { compileNativeTransfer } from '../code/import/framer-native/compile';
import { loadNativeTransferAssetPayloads } from '../code/import/framer-native/load-assets';
import type { NativeTransfer } from '../code/import/framer-native/types';
import type { TransferDiagnostic } from '../code/import/framer-native/types';
import type { NativeSourceSkips } from '../code/import/framer-native/omissions';
import type { Plan, Receipt, Scope, Snapshot } from '../../packages/automation-core/src/contracts';
import type { FramerImportSubmitInput } from '../../packages/automation-core/src/operations/framer-import';

export interface NativePasteServices {
  signal?: AbortSignal;
  skipFeatures?: NativeSourceSkips;
  operationId(): string;
  flush(): Promise<void>;
  snapshot(): Promise<Snapshot>;
  assetPayloads?(transfer: NativeTransfer, snapshot: Snapshot): Promise<Record<string, string>>;
  uploadAssets?(transfer: NativeTransfer, snapshot: Snapshot): Promise<Record<string, string>>;
  hash?(code: string): Promise<string>;
  isCurrent(snapshot: Snapshot): boolean;
  prepare(input: FramerImportSubmitInput, operationId: string): Promise<Plan>;
  commit(plan: Plan): Promise<Receipt>;
  status(scope: Scope, operationId: string): Promise<Receipt | null>;
  apply(receipt: Receipt, plan: Plan): Promise<void>;
}

export type NativeImportTarget = Scope & { mode?: 'create' | 'replace' | 'paste'; parentNodeId?: string };

async function hashNativeTarget(code: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('NATIVE_TARGET_HASH_UNAVAILABLE');
  const bytes = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(code)));
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** One user action owns one operation ID, including recovery of a lost response. */
export async function handleNativeTransferPaste(input: unknown, target: NativeImportTarget, services: NativePasteServices): Promise<Receipt & { sourceOmissions?: TransferDiagnostic[] }> {
  const transfer = decodeNativeTransfer(input);
  services.signal?.throwIfAborted();
  const operationId = services.operationId();
  trace.action('framer-native.paste-start', { operationId, projectId: target.projectId });
  await services.flush();
  const snapshot = await services.snapshot();
  if (snapshot.scope.projectId !== target.projectId || snapshot.scope.branchId !== target.branchId) throw new Error('TARGET_SCOPE_CHANGED');
  const uploaded = services.uploadAssets ? await services.uploadAssets(transfer, snapshot) : undefined;
  const payloads = uploaded ? undefined : services.assetPayloads ? await services.assetPayloads(transfer, snapshot) : await loadNativeTransferAssetPayloads(transfer, snapshot.files, { signal: services.signal });
  const importMode = target.mode ?? 'create';
  const compiled = compileNativeTransfer(transfer, { existingFiles: snapshot.files, mode: importMode, filePath: target.filePath, parentNodeId: target.parentNodeId, assetPayloads: payloads, uploadedAssets: uploaded, skipFeatures: services.skipFeatures });
  if (compiled.diagnostics.length) throw new Error(compiled.diagnostics.map(item => `${item.code}: ${item.message}`).join('\n'));
  const isLayoutPatch = (file: typeof compiled.files[number]) =>
    file.path === 'app/layout.tsx' && (
      file.cursorPortal === true ||
      file.favicon !== undefined ||
      file.faviconDark !== undefined ||
      file.siteTitle !== undefined ||
      file.siteDescription !== undefined ||
      file.socialImage !== undefined ||
      file.siteLanguage !== undefined
    );
  if (importMode === 'replace' || importMode === 'paste') for (const file of compiled.files) {
    const prior = snapshot.files.get(file.path);
    if (prior !== undefined && file.path !== 'app/globals.css' && !isLayoutPatch(file)) {
      file.baseHash = await (services.hash ?? hashNativeTarget)(prior);
    }
  }
  services.signal?.throwIfAborted();
  if (!services.isCurrent(snapshot)) throw new Error('LOCAL_CONTEXT_CHANGED');
  const { projectId, branchId, revision, editorBuild, scopeId, mode } = transfer.context;
  const plan = await services.prepare({ files: compiled.files, mode: importMode, target: { projectId: target.projectId, branchId: target.branchId, ...(target.filePath ? { filePath: target.filePath } : {}), ...(target.parentNodeId ? { parentNodeId: target.parentNodeId } : {}) }, expectedRevision: snapshot.revision, sourceManifest: { format: transfer.format, version: transfer.version, complete: true, context: { projectId, branchId, revision, editorBuild, scopeId, mode }, rootIds: transfer.rootIds } }, operationId);
  if (plan.operationId !== operationId || plan.scope.projectId !== target.projectId || plan.scope.branchId !== target.branchId || plan.baseRevision !== snapshot.revision) throw new Error('IMPORT_PLAN_CONTEXT_MISMATCH');
  if (!services.isCurrent(snapshot)) throw new Error('LOCAL_CONTEXT_CHANGED');
  let receipt: Receipt;
  services.signal?.throwIfAborted();
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
  return compiled.omissions?.length ? { ...receipt, sourceOmissions: compiled.omissions } : receipt;
}
