import { createHash } from 'node:crypto';
import type { Plan, Snapshot } from './contracts';
import { createPlan } from './plan';

export const HISTORY_PATH = '_meta/history.json';

/** Add one reversible journal entry to an already prepared atomic plan. */
export function addPlanHistory(plan: Plan, snapshot: Snapshot, createId: (kind?: string) => string): Plan {
  if (!plan.changes.length || plan.changes.some(change => change.path === HISTORY_PATH)) return plan;
  const raw = snapshot.files.get(HISTORY_PATH);
  let state: { undoStack: unknown[]; redoStack: unknown[] } = { undoStack: [], redoStack: [] };
  if (raw !== undefined) {
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.undoStack) || !Array.isArray(parsed.redoStack)) throw new Error('INVALID_HISTORY: History journal has invalid stacks');
    state = parsed;
  }
  const diffs = plan.changes.map(change => ({ path: change.path, oldContent: snapshot.files.get(change.path) ?? null, newContent: change.content })).filter(diff => diff.oldContent !== diff.newContent);
  if (!diffs.length) return plan;
  state.undoStack = [...state.undoStack, { id: createId('hist'), timestamp: Date.now(), activeFile: plan.scope.filePath ?? diffs[0].path, branchId: plan.scope.branchId, diffs }].slice(-100);
  state.redoStack = [];
  const historyChange = { path: HISTORY_PATH, beforeHash: raw === undefined ? null : createHash('sha256').update(raw).digest('hex'), content: JSON.stringify(state) };
  return createPlan({ scope: plan.scope, baseRevision: plan.baseRevision, operationId: plan.operationId, changes: [...plan.changes, historyChange], createdIds: plan.createdIds, normalizations: plan.normalizations, issues: plan.issues });
}
