import { createHash } from 'node:crypto';
import type { FileChange, Snapshot, OperationContext } from '../contracts';
import type { HistoryDiff, HistoryEntry, HistoryState } from './history';

const HISTORY_PATH = '_meta/history.json';

/** Prepare an undo/redo against the caller's snapshot, including the journal. */
export function prepareHistory(snapshot: Snapshot, direction: 'undo' | 'redo', context: OperationContext) {
  const raw = snapshot.files.get(HISTORY_PATH);
  let state: HistoryState = { undoStack: [], redoStack: [] };
  if (raw !== undefined) {
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { throw new Error('INVALID_HISTORY: History journal is not valid JSON'); }
    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as HistoryState).undoStack) || !Array.isArray((parsed as HistoryState).redoStack)) {
      throw new Error('INVALID_HISTORY: History journal has invalid stacks');
    }
    state = parsed as HistoryState;
  }
  const source = direction === 'undo' ? state.undoStack : state.redoStack;
  const entry = source.pop();
  if (!entry) return { [direction === 'undo' ? 'undone' : 'redone']: false, activeFile: '', changes: [] as FileChange[] };
  if (!entry || !Array.isArray(entry.diffs)) throw new Error('INVALID_HISTORY: History entry is invalid');
  if ((entry.branchId ?? 'main') !== snapshot.scope.branchId) {
    throw new Error(`HISTORY_CONFLICT: The latest history entry belongs to branch "${entry.branchId ?? 'main'}"`);
  }
  const changes: FileChange[] = [];
  const reverse: HistoryDiff[] = [];
  for (const diff of entry.diffs) {
    if (!diff || typeof diff.path !== 'string' || diff.path === HISTORY_PATH ||
        (diff.oldContent !== null && typeof diff.oldContent !== 'string') ||
        (diff.newContent !== null && typeof diff.newContent !== 'string')) throw new Error('INVALID_HISTORY: History diff is invalid');
    const current = snapshot.files.get(diff.path) ?? null;
    const expected = direction === 'undo' ? diff.newContent : diff.oldContent;
    if (current !== expected) throw new Error(`HISTORY_CONFLICT: ${diff.path} changed since the history entry`);
    const next = direction === 'undo' ? diff.oldContent : diff.newContent;
    changes.push({ path: diff.path, beforeHash: current === null ? null : createHash('sha256').update(current).digest('hex'), content: next });
    reverse.push({ path: diff.path, oldContent: diff.oldContent, newContent: diff.newContent });
  }
  const moved: HistoryEntry = { ...entry, diffs: reverse };
  (direction === 'undo' ? state.redoStack : state.undoStack).push(moved);
  changes.push({ path: HISTORY_PATH, beforeHash: raw === undefined ? null : createHash('sha256').update(raw).digest('hex'), content: JSON.stringify(state) });
  context.trace(`history:${direction}`, { projectId: snapshot.scope.projectId, branchId: snapshot.scope.branchId, entryId: entry.id });
  return { [direction === 'undo' ? 'undone' : 'redone']: true, activeFile: entry.activeFile, changes };
}
