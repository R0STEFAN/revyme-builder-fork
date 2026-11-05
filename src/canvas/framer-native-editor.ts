import { getDefaultStore } from 'jotai';
import { projectFS, projectVersionAtom } from '../code/project/project-fs';
import { activeFilePathAtom, switchActiveFile } from '../code/project/active-file-store';
import { canvasInteractingAtom, codeAtom, selectedIdsAtom, updatingFromCanvasAtom } from '../code/stores/store';
import { isTextEditingAtom } from '../code/stores/editor-store';
import { isViewerMode } from '../code/stores/viewer-mode-store';
import { isBranchLocked, lockBranch, unlockBranch, withAgentWriteAccessAsync } from '../code/stores/agent-run-lock-store';
import { flushNow, hasQueuedMutations, isMutationQueueProcessing, syncQueueCode, setForceRender } from '../code/mutation/mutation-queue';
import { sealPendingHistory, pushHistoryFileOp } from '../code/mutation/history';
import { flushSaveNow, setAutosaveHeld } from '../backend/autosave';
import { getBaseRevision, setLoadedRevision } from '../backend/save-revision';
import { getProjectId } from '../backend/project-id';
import { createNativePasteHttpServices } from './framer-native-http';
import { handleNativeTransferPaste } from './framer-native-paste';
import type { Plan, Snapshot } from '../../packages/automation-core/src/contracts';
import { trace } from '../shared/debug-trace';
import { backend } from '../backend';
import { uploadNativeTransferAssets } from '../code/import/framer-native/upload-assets';

export function sameImportFiles(a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>): boolean {
  return a.size === b.size && [...a].every(([path, code]) => b.get(path) === code);
}
function projectedFiles(snapshot: Snapshot, plan: Plan): Map<string, string> {
  const files = new Map(snapshot.files);
  for (const change of plan.changes) if (change.content === null) files.delete(change.path); else files.set(change.path, change.content);
  return files;
}

let importing = false;
/** Apply a confirmed import through the existing snapshot/history/queue paths. */
export async function pasteNativeTransferInEditor(input: unknown, read: typeof fetch = globalThis.fetch) {
  const store = getDefaultStore();
  const scope = { projectId: getProjectId(), branchId: projectFS.getActiveBranchId(), filePath: store.get(activeFilePathAtom) };
  if (importing || isViewerMode() || isBranchLocked(scope.branchId) || store.get(canvasInteractingAtom) || store.get(isTextEditingAtom)) throw new Error('IMPORT_EDITOR_BUSY');
  importing = true;
  let held = false, baseline: Snapshot | undefined, prepared: Plan | undefined;
  const contextUnchanged = () => getProjectId() === scope.projectId && projectFS.getActiveBranchId() === scope.branchId && store.get(activeFilePathAtom) === scope.filePath && !hasQueuedMutations() && !isMutationQueueProcessing();
  const services = createNativePasteHttpServices(scope, {
    async flush() {
      flushNow(); sealPendingHistory();
      await flushSaveNow();
      if (!contextUnchanged()) throw new Error('LOCAL_CONTEXT_CHANGED');
      lockBranch(scope.branchId); setAutosaveHeld(true); held = true;
    },
    isCurrent(snapshot) {
      baseline ??= snapshot;
      if (!contextUnchanged()) return false;
      const live = projectFS.getSnapshot(), revision = getBaseRevision();
      const current = revision === snapshot.revision && sameImportFiles(live, snapshot.files) || !!prepared && revision === snapshot.revision + 1 && sameImportFiles(live, projectedFiles(snapshot, prepared));
      if (!current) trace.error('framer-native.local-snapshot-mismatch', JSON.stringify({ revision, durableRevision: snapshot.revision, differingPaths: [...new Set([...live.keys(), ...snapshot.files.keys()])].filter(path => live.get(path) !== snapshot.files.get(path)) }));
      return current;
    },
    async apply(receipt, plan) {
      const confirmed = await services.snapshot();
      if (!baseline || confirmed.revision !== receipt.revision || !sameImportFiles(confirmed.files, projectedFiles(baseline, plan)) || !services.isCurrent(baseline)) throw new Error('IMPORT_SOURCE_SYNC_CONFLICT');
      await withAgentWriteAccessAsync(async () => {
        projectFS.loadSnapshot(new Map(confirmed.files));
        setLoadedRevision(receipt.revision);
        const destination = plan.changes.find(change => change.path.endsWith('/page.client.tsx'))?.path ?? scope.filePath;
        const activeCode = projectFS.readFile(scope.filePath);
        if (activeCode !== null) { store.set(codeAtom, activeCode); syncQueueCode(activeCode); }
        if (destination !== scope.filePath) switchActiveFile(scope.filePath, destination, { setActiveFile: path => store.set(activeFilePathAtom, path), setSelectedIds: ids => store.set(selectedIdsAtom, ids), setUpdatingFromCanvas: value => store.set(updatingFromCanvasAtom, value) }, { syncQueueCode, flushNow });
        store.set(projectVersionAtom, version => version + 1);
        setForceRender();
        if (destination.endsWith('/page.client.tsx')) store.set(selectedIdsAtom, ['root']);
        pushHistoryFileOp(scope.filePath);
        trace.action('framer-native.editor-applied', { operationId: receipt.operationId, files: receipt.changedFiles.length });
      });
    },
  }, read);
  services.skipFeatures = { pageReferenceFilters: true, customCursors: true };
  const prepare = services.prepare;
  services.uploadAssets = (transfer, snapshot) => uploadNativeTransferAssets(transfer, snapshot.files, scope.projectId, backend, undefined, services.skipFeatures);
  services.prepare = async (...args) => { prepared = await prepare(...args); return prepared; };
  try { return await handleNativeTransferPaste(input, scope, services); }
  finally { if (held) { setAutosaveHeld(false); unlockBranch(scope.branchId); } importing = false; }
}
