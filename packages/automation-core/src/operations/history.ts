// packages/automation-core/src/operations/history.ts
import { z } from 'zod';
import { createHash } from 'node:crypto';
import type { Operation, FileChange, Snapshot, OperationContext } from '../contracts';
import { defaultRegistry } from '../registry';
import { projectFS } from '@/code/project/project-fs';
import { syncProjectSnapshotToProjectFS } from './projects';

const MAX_HISTORY = 100;
const HISTORY_FILE_PATH = '_meta/history.json';

export interface HistoryDiff {
  path: string;
  oldContent: string | null;
  newContent: string | null;
}

export interface HistoryEntry {
  id: string;
  timestamp: number;
  activeFile: string;
  diffs: HistoryDiff[];
}

export interface HistoryState {
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function loadHistoryState(): HistoryState {
  const json = projectFS.readFile(HISTORY_FILE_PATH);
  if (!json) {
    return { undoStack: [], redoStack: [] };
  }
  try {
    const parsed = JSON.parse(json);
    return {
      undoStack: Array.isArray(parsed?.undoStack) ? parsed.undoStack : [],
      redoStack: Array.isArray(parsed?.redoStack) ? parsed.redoStack : [],
    };
  } catch {
    return { undoStack: [], redoStack: [] };
  }
}

export function saveHistoryState(state: HistoryState): void {
  const cappedState: HistoryState = {
    undoStack: state.undoStack.slice(-MAX_HISTORY),
    redoStack: state.redoStack.slice(-MAX_HISTORY),
  };
  projectFS.writeFile(HISTORY_FILE_PATH, JSON.stringify(cappedState, null, 2));
}

export function recordHistoryStep(
  activeFile: string,
  diffs: HistoryDiff[],
  context?: OperationContext,
): void {
  const state = loadHistoryState();
  const entryId = context?.createId ? context.createId('hist') : `hist-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  state.undoStack.push({
    id: entryId,
    timestamp: Date.now(),
    activeFile,
    diffs,
  });
  state.redoStack = []; // New action clears redo stack
  saveHistoryState(state);
}

export function clearHistoryState(): void {
  saveHistoryState({ undoStack: [], redoStack: [] });
}

export function getHistoryStatus(): { canUndo: boolean; canRedo: boolean; undoCount: number; redoCount: number } {
  const state = loadHistoryState();
  return {
    canUndo: state.undoStack.length > 0,
    canRedo: state.redoStack.length > 0,
    undoCount: state.undoStack.length,
    redoCount: state.redoStack.length,
  };
}

// ─── 1. history.undo ──────────────────────────────────────────────────────────

export const historyUndoInputSchema = z.object({});
export type HistoryUndoInput = z.infer<typeof historyUndoInputSchema>;

export interface HistoryUndoOutput {
  undone: boolean;
  activeFile: string;
  changes: FileChange[];
}

export const historyUndoOperation: Operation<HistoryUndoInput, HistoryUndoOutput> = {
  name: 'history.undo',
  description: 'Undo the last project modification and produce reverse FileChange diffs',
  category: 'history',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T21',
  inputSchema: historyUndoInputSchema,
  async execute(snapshot, _input, context: OperationContext) {
    syncProjectSnapshotToProjectFS(snapshot);
    const state = loadHistoryState();

    if (state.undoStack.length === 0) {
      context?.trace?.('history:undo:empty', {});
      return {
        undone: false,
        activeFile: '',
        changes: [],
      };
    }

    const entry = state.undoStack.pop()!;
    const changes: FileChange[] = [];
    const redoDiffs: HistoryDiff[] = [];

    for (const diff of entry.diffs) {
      const currentContent = projectFS.readFile(diff.path);
      const beforeHash = currentContent !== null ? sha256(currentContent) : null;

      redoDiffs.push({
        path: diff.path,
        oldContent: diff.oldContent,
        newContent: currentContent,
      });

      if (diff.oldContent === null) {
        projectFS.deleteFile(diff.path);
        changes.push({
          path: diff.path,
          beforeHash,
          content: null,
        });
      } else {
        projectFS.writeFile(diff.path, diff.oldContent);
        changes.push({
          path: diff.path,
          beforeHash,
          content: diff.oldContent,
        });
      }
    }

    state.redoStack.push({
      id: entry.id,
      timestamp: Date.now(),
      activeFile: entry.activeFile,
      diffs: redoDiffs,
    });

    saveHistoryState(state);

    context?.trace?.('history:undo', {
      entryId: entry.id,
      activeFile: entry.activeFile,
      changeCount: changes.length,
      undoRemaining: state.undoStack.length,
      redoSize: state.redoStack.length,
    });

    return {
      undone: true,
      activeFile: entry.activeFile,
      changes,
    };
  },
};

// ─── 2. history.redo ──────────────────────────────────────────────────────────

export const historyRedoInputSchema = z.object({});
export type HistoryRedoInput = z.infer<typeof historyRedoInputSchema>;

export interface HistoryRedoOutput {
  redone: boolean;
  activeFile: string;
  changes: FileChange[];
}

export const historyRedoOperation: Operation<HistoryRedoInput, HistoryRedoOutput> = {
  name: 'history.redo',
  description: 'Redo the previously undone project modification and produce forward FileChange diffs',
  category: 'history',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T21',
  inputSchema: historyRedoInputSchema,
  async execute(snapshot, _input, context: OperationContext) {
    syncProjectSnapshotToProjectFS(snapshot);
    const state = loadHistoryState();

    if (state.redoStack.length === 0) {
      context?.trace?.('history:redo:empty', {});
      return {
        redone: false,
        activeFile: '',
        changes: [],
      };
    }

    const entry = state.redoStack.pop()!;
    const changes: FileChange[] = [];
    const undoDiffs: HistoryDiff[] = [];

    for (const diff of entry.diffs) {
      const currentContent = projectFS.readFile(diff.path);
      const beforeHash = currentContent !== null ? sha256(currentContent) : null;

      undoDiffs.push({
        path: diff.path,
        oldContent: currentContent,
        newContent: diff.newContent,
      });

      if (diff.newContent === null) {
        projectFS.deleteFile(diff.path);
        changes.push({
          path: diff.path,
          beforeHash,
          content: null,
        });
      } else {
        projectFS.writeFile(diff.path, diff.newContent);
        changes.push({
          path: diff.path,
          beforeHash,
          content: diff.newContent,
        });
      }
    }

    state.undoStack.push({
      id: entry.id,
      timestamp: Date.now(),
      activeFile: entry.activeFile,
      diffs: undoDiffs,
    });

    saveHistoryState(state);

    context?.trace?.('history:redo', {
      entryId: entry.id,
      activeFile: entry.activeFile,
      changeCount: changes.length,
      undoSize: state.undoStack.length,
      redoRemaining: state.redoStack.length,
    });

    return {
      redone: true,
      activeFile: entry.activeFile,
      changes,
    };
  },
};

// ─── Registry Registration & Aliases ─────────────────────────────────────────

defaultRegistry.register(historyUndoOperation);
defaultRegistry.register(historyRedoOperation);

defaultRegistry.registerAlias('history.undoChange', 'history.undo');
defaultRegistry.registerAlias('history.redoChange', 'history.redo');
