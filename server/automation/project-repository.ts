// server/automation/project-repository.ts
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { duplicateProject } from '../storage';
import type {
  Scope,
  Snapshot,
  Plan,
  Receipt,
} from '../../packages/automation-core/src/contracts';

export interface ProjectRepository {
  getSnapshot(scope: Scope): Promise<Snapshot | null>;
  getRevision(projectId: string, branchId?: string): Promise<number>;
  getReceipt(projectId: string, operationId: string): Promise<Receipt | null>;
  applyPlan(plan: Plan): Promise<Receipt>;
}

export class ConflictError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

export class LocalProjectRepository implements ProjectRepository {
  private projectsDir: string;
  private dataDir: string;
  private receiptsCache = new Map<string, Receipt>(); // key: `${projectId}:${operationId}`

  constructor(customDataDir?: string) {
    const root = customDataDir || process.env.REVYME_DATA_DIR || path.resolve(process.cwd(), 'data');
    this.dataDir = root;
    this.projectsDir = path.join(root, 'projects');
    if (!fs.existsSync(this.projectsDir)) {
      fs.mkdirSync(this.projectsDir, { recursive: true });
    }
  }

  private getProjectFilePath(projectId: string): string {
    const safe = projectId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.projectsDir, `${safe}.json`);
  }

  private getDuplicateReceiptPath(projectId: string, operationId: string): string {
    const key = createHash('sha256').update(JSON.stringify([projectId, operationId])).digest('hex');
    return path.join(this.dataDir, 'automation-receipts', `${key}.json`);
  }

  private persistDuplicateReceipt(receipt: Receipt): void {
    const receiptPath = this.getDuplicateReceiptPath(receipt.projectId, receipt.operationId);
    fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
    const tmp = `${receiptPath}.tmp.${process.pid}.${randomUUID()}`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(receipt), 'utf8');
      fs.renameSync(tmp, receiptPath);
    } finally {
      try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* target retains recovery record */ }
    }
  }

  private readProjectRecord(projectId: string): any | null {
    const filePath = this.getProjectFilePath(projectId);
    if (!fs.existsSync(filePath)) return null;
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      return null;
    }
  }

  async getSnapshot(scope: Scope): Promise<Snapshot | null> {
    const record = this.readProjectRecord(scope.projectId);
    if (!record) return null;

    const revision = typeof record.revision === 'number' ? record.revision : 1;
    const branchId = scope.branchId || 'main';

    let filesMap: Record<string, string> = {};
    if (branchId === 'main') {
      filesMap = record.data?.files || {};
    } else {
      const branch = record.data?.branches?.[branchId];
      if (!branch || !branch.files) return null;
      // ProjectFS keeps editor metadata in main even while a work branch is
      // active. Ignore stale metadata in older branch snapshots.
      filesMap = {};
      for (const [p, content] of Object.entries(branch.files)) {
        if (!p.startsWith('_meta/') && typeof content === 'string') filesMap[p] = content;
      }
      for (const [p, content] of Object.entries(record.data?.files || {})) {
        if (p.startsWith('_meta/') && typeof content === 'string') filesMap[p] = content;
      }
    }

    return {
      scope: { ...scope },
      revision,
      files: new Map(Object.entries(filesMap)),
      config: record.data?.settings || {},
      branches: record.data?.branches || {},
      mainFiles: record.data?.files || {},
      activeBranchId: record.data?.activeBranchId || 'main',
    };
  }

  async getRevision(projectId: string, _branchId = 'main'): Promise<number> {
    const record = this.readProjectRecord(projectId);
    if (!record) return 1;
    return typeof record.revision === 'number' ? record.revision : 1;
  }

  async getReceipt(projectId: string, operationId: string): Promise<Receipt | null> {
    const cacheKey = `${projectId}:${operationId}`;
    if (this.receiptsCache.has(cacheKey)) {
      return this.receiptsCache.get(cacheKey)!;
    }
    const record = this.readProjectRecord(projectId);
    if (record?.receipts?.[operationId]) {
      const r = record.receipts[operationId] as Receipt;
      this.receiptsCache.set(cacheKey, r);
      return r;
    }
    try {
      const persisted = JSON.parse(fs.readFileSync(this.getDuplicateReceiptPath(projectId, operationId), 'utf8'));
      if (persisted.projectId === projectId && persisted.operationId === operationId) {
        this.receiptsCache.set(cacheKey, persisted);
        return persisted as Receipt;
      }
    } catch { /* an absent receipt may still be recovered from the target */ }
    // If publication succeeded but the source receipt write was interrupted,
    // the duplicate itself is the durable recovery record.
    for (const file of fs.readdirSync(this.projectsDir)) {
      if (!file.endsWith('.json')) continue;
      try {
        const target = JSON.parse(fs.readFileSync(path.join(this.projectsDir, file), 'utf8'));
        const origin = target.duplicateOrigin;
        if (origin?.sourceProjectId === projectId && origin.operationId === operationId && origin.receipt?.planHash === origin.planHash &&
            origin.receipt?.projectId === projectId && origin.receipt?.operationId === operationId &&
            Array.isArray(origin.receipt?.createdIds) && origin.receipt.createdIds.includes(target.id)) {
          // Repair the independent journal so recovery survives target deletion.
          try { this.persistDuplicateReceipt(origin.receipt); } catch { /* target still provides the receipt */ }
          this.receiptsCache.set(cacheKey, origin.receipt);
          return origin.receipt as Receipt;
        }
      } catch { /* ignore unrelated invalid records */ }
    }
    return null;
  }

  async applyPlan(plan: Plan): Promise<Receipt> {
    const projectId = plan.scope.projectId;
    const branchId = plan.scope.branchId || 'main';
    const filePath = this.getProjectFilePath(projectId);

    // 1. Check idempotency
    const existing = await this.getReceipt(projectId, plan.operationId);
    if (existing) {
      if (existing.planHash === plan.planHash) {
        // Idempotent duplicate: return existing receipt
        return existing;
      }
      throw new ConflictError(
        'OPERATION_ID_CONFLICT',
        `Operation ID "${plan.operationId}" was already applied with a different planHash.`
      );
    }

    // 2. Read latest record & perform CAS
    let record = this.readProjectRecord(projectId);
    if (!record) {
      // Initialize project record if absent
      record = {
        id: projectId,
        name: projectId,
        fileCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        revision: 1,
        data: {
          format: 'revyme-v2',
          files: {},
          branches: {},
          settings: {},
        },
        receipts: {},
      };
    }

    const currentRevision = typeof record.revision === 'number' ? record.revision : 1;
    if (plan.baseRevision !== currentRevision) {
      throw new ConflictError(
        'REVISION_CONFLICT',
        `CAS rejection: plan base revision is ${plan.baseRevision}, but current project revision is ${currentRevision}.`
      );
    }

    if (plan.projectAction?.kind === 'project.duplicate') {
      const action = plan.projectAction;
      // A duplicate creates a separate record; it does not change the source
      // document revision. The receipt is also embedded in the new record.
      const receipt: Receipt = { operationId: plan.operationId, projectId, branchId, revision: currentRevision,
        planHash: plan.planHash, changedFiles: [], createdIds: [action.id] };
      try {
        const duplicate = duplicateProject(projectId, action.name, this.dataDir, { targetId: action.id, baseRevision: currentRevision,
          folderId: action.folderId, origin: { sourceProjectId: projectId, operationId: plan.operationId, planHash: plan.planHash, receipt } });
        if (!duplicate) throw new ConflictError('PROJECT_NOT_FOUND', `Source project "${projectId}" no longer exists.`);
      } catch (err) {
        if (err instanceof ConflictError) throw err;
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('REVISION_CONFLICT')) throw new ConflictError('REVISION_CONFLICT', message);
        if (message.includes('PROJECT_ALREADY_EXISTS') || (err as NodeJS.ErrnoException)?.code === 'EEXIST') throw new ConflictError('PROJECT_ALREADY_EXISTS', `Project "${action.id}" already exists.`);
        throw err;
      }
      // The source document is untouched. Persist the receipt independently so
      // a concurrent editor save cannot be overwritten by an older snapshot.
      this.persistDuplicateReceipt(receipt);
      this.receiptsCache.set(`${projectId}:${plan.operationId}`, receipt);
      return receipt;
    }

    // 3. Apply changes to files
    if (!record.data) record.data = { format: 'revyme-v2', files: {} };
    if (!record.data.files) record.data.files = {};

    let targetFiles: Record<string, string>;
    if (branchId === 'main') {
      targetFiles = record.data.files;
    } else {
      if (!record.data.branches) record.data.branches = {};
      if (!record.data.branches[branchId]) {
        throw new ConflictError('BRANCH_NOT_FOUND', `Branch "${branchId}" does not exist.`);
      }
      if (!record.data.branches[branchId].files) {
        record.data.branches[branchId].files = {};
      }
      targetFiles = record.data.branches[branchId].files;
    }

    const changedFiles: string[] = [];
    for (const change of plan.changes) {
      changedFiles.push(change.path);
      const destination = change.path.startsWith('_meta/') ? record.data.files : targetFiles;
      if (change.content === null) {
        delete destination[change.path];
      } else {
        destination[change.path] = change.content;
      }
    }
    if (branchId !== 'main' && plan.changes.some(change => !change.path.startsWith('_meta/'))) {
      const branch = record.data.branches[branchId];
      const current = Object.entries(branch.files).filter(([p]) => !p.startsWith('_meta/'));
      const base = branch.baseSnapshot || {};
      const basePaths = Object.keys(base).filter(p => !p.startsWith('_meta/'));
      branch.status = current.length === basePaths.length && current.every(([p, content]) => base[p] === content) ? 'clean' : 'dirty';
      branch.lastEditedAt = Date.now();
    }

    // Branch metadata and the receipt share the same CAS and durable write as
    // file changes. The validator has checked the action against this revision.
    const action = plan.projectAction;
    if (action) {
      record.data.branches ||= {};
      if (action.kind === 'branch.create') {
        const source = action.from === 'main' ? record.data.files : record.data.branches[action.from].files;
        const files = Object.fromEntries(Object.entries(source).filter(([p]) => !p.startsWith('_meta/')));
        const order = Object.values(record.data.branches).reduce<number>((max, branch: any) => Math.max(max, (branch.order ?? -1) + 1), 0);
        record.data.branches[action.id] = { files, baseSnapshot: { ...files }, status: 'clean', parentId: action.from,
          order, createdAt: action.createdAt, lastEditedAt: null };
        record.data.activeBranchId = action.id;
      } else if (action.kind === 'branch.switch') {
        record.data.activeBranchId = action.id;
      } else if (action.kind === 'branch.delete') {
        delete record.data.branches[action.id];
        if (record.data.activeBranchId === action.id) record.data.activeBranchId = 'main';
      } else if (action.kind === 'branch.apply') {
        for (const change of action.mainChanges) {
          changedFiles.push(change.path);
          if (change.content === null) delete record.data.files[change.path];
          else record.data.files[change.path] = change.content;
        }
        const files = Object.fromEntries(Object.entries(record.data.files).filter(([p]) => !p.startsWith('_meta/')));
        const branch = record.data.branches[action.id];
        branch.files = files;
        branch.baseSnapshot = { ...files };
        branch.status = 'clean';
        if (action.mainChanges.length) record.data.activeBranchId = 'main';
      } else {
        for (const change of action.mainChanges) {
          changedFiles.push(change.path);
          if (change.content === null) delete record.data.files[change.path];
          else record.data.files[change.path] = change.content;
        }
        if (action.branches) {
          record.data.branches = action.branches;
          record.data.activeBranchId = action.activeBranchId ?? 'main';
        }
      }
      record.data.format = 'revyme-v2';
      record.data.mainBranchId = 'main';
    }

    // 4. Increment revision & record receipt
    const nextRevision = currentRevision + 1;
    record.revision = nextRevision;
    record.updatedAt = Date.now();
    record.fileCount = Object.keys(record.data.files).length;

    const receipt: Receipt = {
      operationId: plan.operationId,
      projectId,
      branchId,
      revision: nextRevision,
      planHash: plan.planHash,
      changedFiles,
    };

    if (!record.receipts) record.receipts = {};
    record.receipts[plan.operationId] = receipt;

    // 5. Durable atomic write via temporary file
    const tmpPath = `${filePath}.tmp.${process.pid}.${randomUUID()}`;
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(record, null, 2), 'utf8');
      fs.renameSync(tmpPath, filePath);
    } catch (err) {
      if (fs.existsSync(tmpPath)) {
        try { fs.unlinkSync(tmpPath); } catch {}
      }
      throw err;
    }

    this.receiptsCache.set(`${projectId}:${plan.operationId}`, receipt);

    return receipt;
  }
}
