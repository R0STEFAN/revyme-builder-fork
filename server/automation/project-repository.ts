// server/automation/project-repository.ts
import fs from 'node:fs';
import path from 'node:path';
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
  private receiptsCache = new Map<string, Receipt>(); // key: `${projectId}:${operationId}`

  constructor(customDataDir?: string) {
    const root = customDataDir || process.env.REVYME_DATA_DIR || path.resolve(process.cwd(), 'data');
    this.projectsDir = path.join(root, 'projects');
    if (!fs.existsSync(this.projectsDir)) {
      fs.mkdirSync(this.projectsDir, { recursive: true });
    }
  }

  private getProjectFilePath(projectId: string): string {
    const safe = projectId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.projectsDir, `${safe}.json`);
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
      filesMap = record.data?.branches?.[branchId]?.files || record.data?.files || {};
    }

    return {
      scope: { ...scope },
      revision,
      files: new Map(Object.entries(filesMap)),
      config: record.data?.settings || {},
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

    // 3. Apply changes to files
    if (!record.data) record.data = { format: 'revyme-v2', files: {} };
    if (!record.data.files) record.data.files = {};

    let targetFiles: Record<string, string>;
    if (branchId === 'main') {
      targetFiles = record.data.files;
    } else {
      if (!record.data.branches) record.data.branches = {};
      if (!record.data.branches[branchId]) {
        record.data.branches[branchId] = { files: { ...record.data.files } };
      }
      if (!record.data.branches[branchId].files) {
        record.data.branches[branchId].files = {};
      }
      targetFiles = record.data.branches[branchId].files;
    }

    const changedFiles: string[] = [];
    for (const change of plan.changes) {
      changedFiles.push(change.path);
      if (change.content === null) {
        delete targetFiles[change.path];
      } else {
        targetFiles[change.path] = change.content;
      }
    }

    // 4. Increment revision & record receipt
    const nextRevision = currentRevision + 1;
    record.revision = nextRevision;
    record.updatedAt = Date.now();
    record.fileCount = Object.keys(targetFiles).length;

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
    this.receiptsCache.set(`${projectId}:${plan.operationId}`, receipt);

    // 5. Durable atomic write via temporary file
    const tmpPath = path.join(this.projectsDir, `${projectId}.tmp.${Date.now()}`);
    fs.writeFileSync(tmpPath, JSON.stringify(record, null, 2), 'utf8');
    fs.renameSync(tmpPath, filePath);

    return receipt;
  }
}
