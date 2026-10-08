// version-history.ts — Client manager for branch-aware persistent version history.
// Coordinates on-disk storage with server API, canvas state restoration, and Jotai signals.

import { atom, getDefaultStore } from 'jotai';
import { backend } from './index';
import { getProjectId } from './project-id';
import { flushSaveNow } from './autosave';
import { projectFS } from '@/code/project/project-fs';
import { activeFilePathAtom, syncUrlToPage } from '@/code/project/active-file-store';
import { selectedIdsAtom } from '@/code/stores/store';
import {
  flushNow,
  setForceRender,
  settlePendingFanOutForHistory,
  switchQueueFile,
} from '@/code/mutation/mutation-queue';
import { clearHistoryStacks } from '@/code/mutation/history';
import { clearBridgeReadCaches } from '@/canvas/canvas-bridge';
import { refreshCanvasTokens } from '@/canvas/node-ops';
import { bumpProjectVersion } from '@/code/project/modify-file';
import { commitActiveTextEdit } from '@/canvas/text-edit-committer';
import { trace } from '@/shared/debug-trace';
import { toast } from 'sonner';

export interface ProjectVersionSummary {
  id: string;
  projectId: string;
  branchId: string;
  timestamp: number;
  label?: string;
  source: 'manual' | 'autosave' | 'restore';
  fileCount: number;
  changesSummary?: string;
}

export interface ProjectVersionRecord extends ProjectVersionSummary {
  data: any;
}

import { versionHistorySignalAtom, bumpVersionHistorySignal } from './version-history-store';
export { versionHistorySignalAtom, bumpVersionHistorySignal };

/**
 * Fetch all saved versions for the current project, optionally filtered by branch.
 */
export async function fetchProjectVersions(
  branchId?: string,
  projectId?: string
): Promise<ProjectVersionSummary[]> {
  const id = projectId || getProjectId();
  try {
    const listFn = (backend as any).listVersions;
    if (typeof listFn === 'function') {
      const versions = await listFn.call(backend, id, branchId);
      if (Array.isArray(versions)) {
        return versions;
      }
    }
  } catch (err) {
    trace.error('version-history:fetch-error', err);
  }
  return [];
}

/**
 * Fetch the full version record (including data.files snapshot) for a given version.
 */
export async function fetchVersionDetail(
  versionId: string,
  projectId?: string
): Promise<ProjectVersionRecord | null> {
  const id = projectId || getProjectId();
  try {
    const getFn = (backend as any).getVersion;
    if (typeof getFn === 'function') {
      const record = await getFn.call(backend, id, versionId);
      if (record && record.data) {
        return record;
      }
    }
  } catch (err) {
    trace.error('version-history:fetch-detail-error', err);
  }
  return null;
}

/**
 * Execute the full canvas and filesystem restoration ceremony for a target version snapshot.
 * Auto-creates a "Before restore" checkpoint on disk so the user can easily undo.
 */
export async function restoreProjectVersion(
  versionId: string,
  projectId?: string
): Promise<{ success: boolean; error?: string }> {
  const id = projectId || getProjectId();
  trace.action('version-history:restore-start', { id, versionId });

  try {
    // 1. Commit any open text edits on the canvas
    await commitActiveTextEdit().catch(() => {});

    // 2. Settle pending work and flush AST mutation queue
    settlePendingFanOutForHistory();
    flushNow();

    // 3. Restore on disk via backend API
    const restoreFn = (backend as any).restoreVersion;
    let restoredData: any = null;

    if (typeof restoreFn === 'function') {
      const res = await restoreFn.call(backend, id, versionId);
      if (res?.success && res.project?.data) {
        restoredData = res.project.data;
      } else if (res?.version?.data) {
        restoredData = res.version.data;
      }
    }

    // Fallback: if server call didn't return data, fetch detail directly
    if (!restoredData) {
      const detail = await fetchVersionDetail(versionId, id);
      if (!detail?.data) {
        throw new Error('Version data could not be retrieved');
      }
      restoredData = detail.data;
    }

    // 4. Hydrate ProjectFS from restored envelope
    const err = projectFS.fromEnvelope(restoredData);
    if (err) {
      throw new Error(err);
    }

    // 5. Land on a valid file in the restored project
    const store = getDefaultStore();
    const currentFile = store.get(activeFilePathAtom);
    const targetFile = projectFS.exists(currentFile)
      ? currentFile
      : projectFS.exists('app/page.client.tsx')
      ? 'app/page.client.tsx'
      : (projectFS.listFiles()[0] || 'app/page.client.tsx');

    switchQueueFile(targetFile);
    store.set(activeFilePathAtom, targetFile);
    store.set(selectedIdsAtom, []);

    // 6. Reset session undo/redo stack (undo never spans across version restores)
    clearHistoryStacks();

    // 7. Full rebuild + fresh bridge caches + URL + tokens
    setForceRender();
    bumpProjectVersion();
    clearBridgeReadCaches();
    syncUrlToPage(targetFile);
    refreshCanvasTokens();

    // 8. Force save restored state so the backend snapshot matches
    await flushSaveNow({ source: 'restore', label: 'Restored from version' });

    // 9. Late bump (250ms) for late canvas subscribers
    setTimeout(() => {
      setForceRender();
      bumpProjectVersion();
      trace.action('version-history:restore-late-bump');
    }, 250);

    bumpVersionHistorySignal();
    toast.success('Version restored');
    trace.action('version-history:restore-success', { versionId, targetFile });
    return { success: true };
  } catch (err: any) {
    const errorMsg = err?.message || 'Failed to restore version';
    toast.error(errorMsg);
    trace.error('version-history:restore-error', err);
    return { success: false, error: errorMsg };
  }
}
