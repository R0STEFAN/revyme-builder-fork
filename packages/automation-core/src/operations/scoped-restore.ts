import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import type { FileChange, OperationContext, ProjectAction, Snapshot } from '../contracts';
import { calculateBackupEnvelopeChecksum, calculateFilesChecksum } from './projects';

type RestoreAction = Extract<ProjectAction, { kind: 'project.restore' }>;
const MAX_BACKUP_BYTES = 64 * 1024 * 1024;

function isFileMap(value: unknown): value is Record<string, string> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every(v => typeof v === 'string');
}

export function safeProjectPath(path: string): boolean {
  return !!path && !path.includes('\\') && !path.includes('\0') && !path.startsWith('/') && !/^[a-zA-Z]:/.test(path) &&
    !path.split('/').some(part => !part || part === '.' || part === '..' || part === '__proto__');
}

export function validateRestoreAction(snapshot: Snapshot, action: RestoreAction): string | null {
  if (!snapshot.mainFiles) return 'The main branch snapshot is unavailable.';
  if (action.branches === undefined) return action.activeBranchId === undefined ? null : 'An active branch requires restored branch data.';
  const ids = Object.keys(action.branches);
  for (const id of ids) {
    if (id === 'main' || !/^[a-z0-9-]{1,48}$/.test(id)) return `Invalid branch id "${id}".`;
    const branch = action.branches[id] as Record<string, unknown> | null;
    if (!branch || typeof branch !== 'object' || Array.isArray(branch) || !isFileMap(branch.files) || !isFileMap(branch.baseSnapshot)) return `Branch "${id}" has invalid files or base snapshot.`;
    if ([...Object.keys(branch.files), ...Object.keys(branch.baseSnapshot)].some(path => !safeProjectPath(path) || path.startsWith('_meta/'))) return `Branch "${id}" has an invalid file path.`;
    if (branch.parentId != null && (typeof branch.parentId !== 'string' || (branch.parentId !== 'main' && !ids.includes(branch.parentId)))) return `Branch "${id}" has an invalid parent.`;
  }
  if (action.activeBranchId && action.activeBranchId !== 'main' && !ids.includes(action.activeBranchId)) return 'The restored active branch does not exist.';
  for (const id of ids) {
    const visited = new Set<string>();
    let current: string | null = id;
    while (current && current !== 'main') {
      if (visited.has(current)) return `Branch "${id}" has a cyclic parent.`;
      visited.add(current);
      current = ((action.branches[current] as Record<string, unknown>).parentId as string | null | undefined) ?? 'main';
    }
  }
  return null;
}

export function prepareScopedRestore(snapshot: Snapshot, input: { backupPayload: string; restoreBranches: boolean; cleanOrphanFiles: boolean }, context: OperationContext) {
  const raw = input.backupPayload.trim();
  if (!raw || raw.length > MAX_BACKUP_BYTES * 2) throw new Error('INVALID_BACKUP_PAYLOAD: Backup is empty or too large');
  let parsed: any;
  try {
    const json = raw.startsWith('{') ? raw : gunzipSync(Buffer.from(raw, 'base64'), { maxOutputLength: MAX_BACKUP_BYTES }).toString('utf8');
    if (Buffer.byteLength(json, 'utf8') > MAX_BACKUP_BYTES) throw new Error('Backup is too large');
    parsed = JSON.parse(json);
  } catch (err) { throw new Error(`INVALID_BACKUP_PAYLOAD: ${err instanceof Error ? err.message : String(err)}`); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !isFileMap(parsed.files)) throw new Error('INVALID_BACKUP_PAYLOAD: Invalid files dictionary');
  if (parsed.version && parsed.version !== 'revyme-backup-v1') throw new Error('INVALID_BACKUP_PAYLOAD: Unsupported backup version');
  if (parsed.checksum && parsed.checksum !== calculateFilesChecksum(parsed.files)) throw new Error('BACKUP_CHECKSUM_MISMATCH: Backup files are corrupted');
  if (parsed.envelopeChecksum && parsed.envelopeChecksum !== calculateBackupEnvelopeChecksum(parsed.files, parsed.branches, parsed.activeBranchId ?? 'main')) {
    throw new Error('BACKUP_CHECKSUM_MISMATCH: Backup envelope is corrupted');
  }
  if (!snapshot.mainFiles) throw new Error('Main branch snapshot is unavailable');
  const original = snapshot.mainFiles;
  const target: Record<string, string> = input.cleanOrphanFiles ? { ...parsed.files } : { ...original, ...parsed.files };
  const changes: FileChange[] = [...new Set([...Object.keys(original), ...Object.keys(target)])].sort()
    .filter(path => original[path] !== target[path])
    .map(path => ({ path, beforeHash: Object.prototype.hasOwnProperty.call(original, path) ? createHash('sha256').update(original[path]).digest('hex') : null,
      content: Object.prototype.hasOwnProperty.call(target, path) ? target[path] : null }));
  let branches: Record<string, unknown> | undefined;
  let activeBranchId: string | undefined;
  if (input.restoreBranches) {
    if (parsed.branches !== undefined && (!parsed.branches || typeof parsed.branches !== 'object' || Array.isArray(parsed.branches))) throw new Error('INVALID_BACKUP_PAYLOAD: Invalid branches');
    branches = Object.fromEntries(Object.entries(parsed.branches ?? {}).map(([id, value]) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [id, value];
      const branch = value as Record<string, unknown>;
      return [id, { ...branch, baseSnapshot: branch.baseSnapshot ?? branch.files }];
    }));
    activeBranchId = typeof parsed.activeBranchId === 'string' && (parsed.activeBranchId === 'main' || Object.prototype.hasOwnProperty.call(branches!, parsed.activeBranchId)) ? parsed.activeBranchId : 'main';
  }
  const action: RestoreAction = { kind: 'project.restore', mainChanges: changes, ...(branches ? { branches, activeBranchId } : {}) };
  const error = validateRestoreAction(snapshot, action);
  if (error) throw new Error(`INVALID_BACKUP_PAYLOAD: ${error}`);
  context.trace('projects:backup:restore', { projectId: snapshot.scope.projectId, files: changes.length, branches: branches ? Object.keys(branches).length : null });
  return { changes: [], projectAction: action };
}
