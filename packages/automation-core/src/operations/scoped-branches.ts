import type { FileChange, OperationContext, ProjectAction, Snapshot } from '../contracts';
import { describeFileChanges } from '@/code/branching/describe-changes';
import { toBranchId } from '@/code/stores/branch-store';
import { mergeMaps } from '@/code/branching/merge';
import { createHash } from 'node:crypto';

type Branch = { files?: Record<string, string>; baseSnapshot?: Record<string, string>; status?: string; parentId?: string | null };

function mergeBranch(snapshot: Snapshot, id: string, appliedAt: number): FileChange[] {
  const branch = snapshot.branches?.[id] as Branch | undefined;
  if (id === 'main' || !branch?.files || !branch.baseSnapshot || !snapshot.mainFiles) throw new Error(`Unknown or incomplete branch "${id}".`);
  const website = (files: Record<string, string>) => new Map(Object.entries(files).filter(([p]) => !p.startsWith('_meta/')));
  const main = website(snapshot.mainFiles);
  const result = mergeMaps(website(branch.baseSnapshot), main, website(branch.files));
  if (result.conflicts.length) throw new Error(`Merge conflict in ${[...new Set(result.conflicts.map(c => c.path))].join(', ')}.`);
  const changes = [...new Set([...main.keys(), ...result.merged.keys()])].sort().filter(p => main.get(p) !== result.merged.get(p))
    .map(path => ({ path, beforeHash: main.has(path) ? createHash('sha256').update(main.get(path)!).digest('hex') : null,
      content: result.merged.get(path) ?? null }));
  if (changes.length) {
    const historyPath = '_meta/history.json';
    const raw = snapshot.mainFiles[historyPath];
    let state: { undoStack: unknown[]; redoStack: unknown[] } = { undoStack: [], redoStack: [] };
    if (raw !== undefined) {
      try { state = JSON.parse(raw); } catch { throw new Error('INVALID_HISTORY: History journal is not valid JSON'); }
      if (!state || !Array.isArray(state.undoStack) || !Array.isArray(state.redoStack)) throw new Error('INVALID_HISTORY: History journal has invalid stacks');
    }
    const diffs = changes.map(change => ({ path: change.path, oldContent: main.get(change.path) ?? null, newContent: change.content }));
    const entryId = createHash('sha256').update(JSON.stringify([snapshot.scope.projectId, snapshot.revision, id, appliedAt])).digest('hex');
    state.undoStack = [...state.undoStack, { id: `hist-${entryId}`, timestamp: appliedAt, branchId: 'main', activeFile: changes[0].path, diffs }].slice(-100);
    state.redoStack = [];
    changes.push({ path: historyPath, beforeHash: raw === undefined ? null : createHash('sha256').update(raw).digest('hex'), content: JSON.stringify(state) });
  }
  return changes;
}

/** Validate the intention against a fresh snapshot before any envelope is modified. */
export function validateBranchAction(snapshot: Snapshot, action: Extract<ProjectAction, { kind: `branch.${string}` }>): string | null {
  const branches = snapshot.branches ?? {};
  const known = (id: string) => id === 'main' || Object.prototype.hasOwnProperty.call(branches, id);
  if (!/^[a-z0-9-]{1,48}$/.test(action.id)) return 'Invalid branch id.';
  if (action.kind === 'branch.create') {
    if (action.id === 'main' || known(action.id)) return `Branch "${action.id}" already exists or is protected.`;
    if (!known(action.from) || action.from !== (snapshot.activeBranchId ?? 'main')) return 'The source branch is no longer active.';
    const source = action.from === 'main' ? snapshot.mainFiles : (branches[action.from] as Branch | undefined)?.files;
    if (!source || Object.values(source).some(value => typeof value !== 'string')) return 'Source branch files are unavailable.';
  } else if (!known(action.id)) {
    return `Unknown branch "${action.id}".`;
  } else if (action.kind === 'branch.delete' && action.id === 'main') {
    return 'Cannot delete protected branch "main".';
  } else if (action.kind === 'branch.apply') {
    try {
      if (JSON.stringify(mergeBranch(snapshot, action.id, action.appliedAt)) !== JSON.stringify(action.mainChanges)) return 'Merged files do not match the current branch.';
    } catch (err) { return err instanceof Error ? err.message : String(err); }
  }
  return null;
}

export function prepareScopedBranchAction(snapshot: Snapshot, operation: string, input: { name?: string; branch?: string }, context: OperationContext) {
  const active = snapshot.activeBranchId ?? 'main';
  let action: ProjectAction;
  if (operation === 'branches.create') {
    const id = toBranchId(input.name ?? '');
    action = { kind: 'branch.create', id, from: active, createdAt: Date.now() };
  } else if (operation === 'branches.switch') {
    action = { kind: 'branch.switch', id: input.branch?.trim() ?? '' };
  } else if (operation === 'branches.delete') {
    action = { kind: 'branch.delete', id: input.branch?.trim() ?? '' };
  } else {
    const id = input.branch?.trim() || active;
    const appliedAt = Date.now();
    action = { kind: 'branch.apply', id, appliedAt, mainChanges: mergeBranch(snapshot, id, appliedAt) };
  }
  const error = validateBranchAction(snapshot, action);
  if (error) throw new Error(error);
  context.trace(`branches:${action.kind.slice(7)}`, { projectId: snapshot.scope.projectId, branch: action.id });
  return { branch: action.id, changes: [], projectAction: action };
}

function changedPaths(a: Record<string, string>, b: Record<string, string>): string[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(path => a[path] !== b[path]).sort();
}

/** Read only the envelope supplied by the scoped repository, never the editor singleton. */
export function readScopedBranches(snapshot: Snapshot, operation: string, input: { branch?: string }, context: OperationContext) {
  const branches = (snapshot.branches ?? {}) as Record<string, Branch>;
  const active = snapshot.activeBranchId ?? 'main';
  if (operation === 'branches.list') {
    const result = [{ id: 'main', active: active === 'main', status: 'clean', parent: null as string | null, changedFiles: 0 }];
    for (const [id, branch] of Object.entries(branches)) {
      result.push({ id, active: id === active, status: branch.status ?? 'clean', parent: branch.parentId ?? null,
        changedFiles: changedPaths(branch.baseSnapshot ?? {}, branch.files ?? {}).length });
    }
    context.trace('branches:list', { active, count: result.length });
    return { active, branches: result };
  }
  const id = input.branch?.trim() || active;
  if (id === 'main') return { branch: id, files: [], mainMovedSince: false, mainChanged: [] };
  const branch = branches[id];
  if (!branch?.files || !branch.baseSnapshot) throw new Error(`Unknown or incomplete branch "${id}".`);
  const base = branch.baseSnapshot;
  const current = branch.files;
  const mainChanged = changedPaths(base, snapshot.mainFiles ?? {}).filter(path => !path.startsWith('_meta/'));
  const files = changedPaths(base, current).map(path => {
    if (!(path in base)) return { path, status: 'added', changes: ['File added to branch'] };
    if (!(path in current)) return { path, status: 'removed', changes: ['File removed from branch'] };
    const desc = describeFileChanges(base[path], current[path]);
    const changes = !desc.unparsed && desc.changes.length
      ? desc.changes.map(c => `${c.kind}: ${c.title}${c.props.length ? ` (${c.props.map(p => p.label).join(', ')})` : ''}`)
      : ['Content modified'];
    return { path, status: 'changed', changes };
  });
  context.trace('branches:review', { branch: id, fileCount: files.length, mainMovedSince: mainChanged.length > 0 });
  return { branch: id, files, mainMovedSince: mainChanged.length > 0, mainChanged };
}
