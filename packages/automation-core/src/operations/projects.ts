// packages/automation-core/src/operations/projects.ts
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import type { Operation, FileChange, Snapshot, OperationContext } from '../contracts';
import { FileChangeSchema } from '../contracts';
import { defaultRegistry } from '../registry';
import { projectFS, MAIN_BRANCH_ID } from '@/code/project/project-fs';
import type { ProjectData } from '@/backend/types';

// ─── Helper: Canonical Checksum ───────────────────────────────────────────────

export function calculateFilesChecksum(files: Record<string, string>): string {
  const sortedKeys = Object.keys(files).sort();
  const hash = createHash('sha256');
  for (const key of sortedKeys) {
    hash.update(key);
    hash.update(':');
    hash.update(files[key]);
    hash.update(';');
  }
  return hash.digest('hex');
}

// ─── Helper: Sync Snapshot to ProjectFS ───────────────────────────────────────

export function syncProjectSnapshotToProjectFS(snapshot?: Snapshot): {
  beforeFiles: Map<string, string>;
  collectChanges: (targetFiles: Record<string, string>, cleanOrphan: boolean) => FileChange[];
} {
  const beforeFiles = new Map<string, string>();
  for (const path of projectFS.listFiles()) {
    const content = projectFS.readFile(path);
    if (content !== null) {
      beforeFiles.set(path, content);
    }
  }

  // Seed from snapshot if projectFS has no files, or add missing files
  if (beforeFiles.size === 0 && snapshot && snapshot.files && snapshot.files.size > 0) {
    for (const [path, content] of snapshot.files) {
      beforeFiles.set(path, content);
      projectFS.writeFile(path, content);
    }
  } else if (snapshot && snapshot.files && snapshot.files.size > 0) {
    for (const [path, content] of snapshot.files) {
      if (!beforeFiles.has(path)) {
        beforeFiles.set(path, content);
        projectFS.writeFile(path, content);
      }
    }
  }

  return {
    beforeFiles,
    collectChanges(targetFiles: Record<string, string>, cleanOrphan: boolean): FileChange[] {
      const changes: FileChange[] = [];
      const targetPaths = new Set(Object.keys(targetFiles));

      // 1. Created or modified files
      for (const [path, content] of Object.entries(targetFiles)) {
        const before = beforeFiles.get(path);
        if (before === undefined) {
          changes.push({
            path,
            beforeHash: null,
            content,
          });
        } else if (before !== content) {
          changes.push({
            path,
            beforeHash: createHash('sha256').update(before).digest('hex'),
            content,
          });
        }
      }

      // 2. Deleted orphan files
      if (cleanOrphan) {
        for (const [path, beforeContent] of beforeFiles) {
          if (!targetPaths.has(path)) {
            changes.push({
              path,
              beforeHash: createHash('sha256').update(beforeContent).digest('hex'),
              content: null,
            });
          }
        }
      }

      return changes;
    },
  };
}

// ─── 1. projects.duplicate ────────────────────────────────────────────────────

export const projectsDuplicateInputSchema = z.object({
  targetName: z.string().min(1, 'Target project name must not be empty').max(120),
  targetProjectId: z.string().optional(),
  folderId: z.string().nullable().optional(),
});

export type ProjectsDuplicateInput = z.infer<typeof projectsDuplicateInputSchema>;

export const projectsDuplicateOutputSchema = z.object({
  originalProjectId: z.string(),
  newProjectId: z.string(),
  name: z.string(),
  fileCount: z.number(),
  revision: z.number(),
  folderId: z.string().nullable().optional(),
});

export type ProjectsDuplicateOutput = z.infer<typeof projectsDuplicateOutputSchema>;

export const projectsDuplicateOperation: Operation<ProjectsDuplicateInput, ProjectsDuplicateOutput> = {
  name: 'projects.duplicate',
  description: 'Duplicate an existing project snapshot, preserving all files, branches, settings, and folder metadata',
  category: 'projects',
  kind: 'mutation',
  permit: 'write',
  environment: 'service',
  ownerTask: 'T21',
  inputSchema: projectsDuplicateInputSchema,
  outputSchema: projectsDuplicateOutputSchema,
  async execute(snapshot, input, context: OperationContext) {
    const originalProjectId = snapshot?.scope?.projectId || 'default-project';
    const targetName = input.targetName.trim();
    if (!targetName) {
      throw new Error('VALIDATION_ERROR: Target project name must not be empty');
    }

    const newProjectId =
      input.targetProjectId ||
      (context?.createId ? context.createId('proj') : undefined) ||
      `proj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // 1. Adapter integration (if available)
    if (context?.adapters && typeof (context.adapters as any).projectStorage?.duplicateProject === 'function') {
      const duplicated = await (context.adapters as any).projectStorage.duplicateProject(
        originalProjectId,
        targetName,
        input.folderId,
      );
      if (!duplicated) {
        throw new Error(`PROJECT_NOT_FOUND: Source project "${originalProjectId}" could not be duplicated`);
      }
      return {
        originalProjectId,
        newProjectId: duplicated.id,
        name: duplicated.name,
        fileCount: duplicated.fileCount,
        revision: duplicated.revision ?? (snapshot?.revision ?? 1),
        folderId: duplicated.folderId ?? null,
      };
    }

    // 2. Headless in-memory duplication fallback
    syncProjectSnapshotToProjectFS(snapshot);
    const envelope = projectFS.toEnvelope();
    const filesCount = envelope.files ? Object.keys(envelope.files).length : (snapshot?.files?.size ?? 0);

    context?.trace?.('projects:duplicate', {
      originalProjectId,
      newProjectId,
      targetName,
      fileCount: filesCount,
    });

    return {
      originalProjectId,
      newProjectId,
      name: targetName,
      fileCount: filesCount,
      revision: snapshot?.revision ?? 1,
      folderId: input.folderId ?? null,
    };
  },
};

// ─── 2. projects.backup.export ────────────────────────────────────────────────

export const projectsBackupExportInputSchema = z.object({
  includeBranches: z.boolean().optional().default(true),
  compress: z.boolean().optional().default(false),
});

export type ProjectsBackupExportInput = z.input<typeof projectsBackupExportInputSchema>;

export const projectsBackupExportOutputSchema = z.object({
  projectId: z.string(),
  revision: z.number(),
  fileCount: z.number(),
  backupPayload: z.string(),
  compressed: z.boolean().optional(),
  checksum: z.string(),
});

export type ProjectsBackupExportOutput = z.infer<typeof projectsBackupExportOutputSchema>;

export const projectsBackupExportOperation: Operation<ProjectsBackupExportInput, ProjectsBackupExportOutput> = {
  name: 'projects.backup.export',
  description: 'Export a self-contained, checksummed project backup payload with optional branch preservation',
  category: 'projects',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T21',
  inputSchema: projectsBackupExportInputSchema,
  outputSchema: projectsBackupExportOutputSchema,
  async execute(snapshot, input, context: OperationContext) {
    syncProjectSnapshotToProjectFS(snapshot);
    const envelope = projectFS.toEnvelope();

    let files: Record<string, string> = {};
    if (envelope.files && Object.keys(envelope.files).length > 0) {
      files = { ...envelope.files };
    } else if (snapshot?.files) {
      for (const [k, v] of snapshot.files) {
        files[k] = v;
      }
    }

    const includeBranches = input.includeBranches ?? true;
    const branches = includeBranches && envelope.branches && Object.keys(envelope.branches).length > 0 ? envelope.branches : undefined;
    const format = branches ? 'revyme-v2' : 'revyme-v1';
    const checksum = calculateFilesChecksum(files);
    const fileCount = Object.keys(files).length;
    const projectId = snapshot?.scope?.projectId || 'default-project';
    const revision = snapshot?.revision ?? 1;

    const payloadObject = {
      version: 'revyme-backup-v1',
      projectId,
      revision,
      exportedAt: new Date().toISOString(),
      fileCount,
      format,
      files,
      ...(branches ? { branches } : {}),
      activeBranchId: envelope.activeBranchId || snapshot?.scope?.branchId || MAIN_BRANCH_ID,
      checksum,
    };

    let backupPayload = JSON.stringify(payloadObject, null, 2);
    let compressed = false;

    if (input.compress) {
      const gzipped = gzipSync(Buffer.from(backupPayload, 'utf-8'));
      backupPayload = gzipped.toString('base64');
      compressed = true;
    }

    context?.trace?.('projects:backup:export', {
      projectId,
      revision,
      fileCount,
      includeBranches,
      compressed,
    });

    return {
      projectId,
      revision,
      fileCount,
      backupPayload,
      compressed,
      checksum,
    };
  },
};

// ─── 3. projects.backup.restore ───────────────────────────────────────────────

export const projectsBackupRestoreInputSchema = z.object({
  backupPayload: z.string().min(1, 'Backup payload cannot be empty'),
  restoreBranches: z.boolean().optional().default(true),
  cleanOrphanFiles: z.boolean().optional().default(true),
});

export type ProjectsBackupRestoreInput = z.input<typeof projectsBackupRestoreInputSchema>;

export const projectsBackupRestoreOutputSchema = z.object({
  restoredFiles: z.number(),
  revision: z.number(),
  changes: z.array(FileChangeSchema),
  branchCount: z.number().optional(),
  activeBranchId: z.string().optional(),
});

export type ProjectsBackupRestoreOutput = z.infer<typeof projectsBackupRestoreOutputSchema>;

export const projectsBackupRestoreOperation: Operation<ProjectsBackupRestoreInput, ProjectsBackupRestoreOutput> = {
  name: 'projects.backup.restore',
  description: 'Restore project files and branches from a backup payload, producing atomic FileChange[] diffs and an incremented revision',
  category: 'projects',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T21',
  inputSchema: projectsBackupRestoreInputSchema,
  outputSchema: projectsBackupRestoreOutputSchema,
  async execute(snapshot, input, context: OperationContext) {
    const rawPayload = input.backupPayload.trim();
    if (!rawPayload) {
      throw new Error('INVALID_BACKUP_PAYLOAD: Backup payload is empty');
    }

    // Phase 1: Decoding (JSON or Base64/Gzip)
    let payloadJson: string;
    if (rawPayload.startsWith('{')) {
      payloadJson = rawPayload;
    } else {
      try {
        const buffer = Buffer.from(rawPayload, 'base64');
        const decompressed = gunzipSync(buffer);
        payloadJson = decompressed.toString('utf-8');
      } catch (err) {
        throw new Error(`INVALID_BACKUP_PAYLOAD: Failed to parse or decompress payload: ${(err as Error).message}`);
      }
    }

    let parsed: any;
    try {
      parsed = JSON.parse(payloadJson);
    } catch (err) {
      throw new Error(`INVALID_BACKUP_PAYLOAD: Malformed JSON: ${(err as Error).message}`);
    }

    if (!parsed || typeof parsed !== 'object' || !parsed.files || typeof parsed.files !== 'object') {
      throw new Error('INVALID_BACKUP_PAYLOAD: Missing or invalid "files" dictionary in backup payload');
    }

    const targetFiles: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed.files)) {
      if (typeof v === 'string') {
        targetFiles[k] = v;
      }
    }

    // Phase 2: Checksum Verification (if present)
    if (parsed.checksum) {
      const calculatedChecksum = calculateFilesChecksum(targetFiles);
      if (calculatedChecksum !== parsed.checksum) {
        throw new Error(
          `BACKUP_CHECKSUM_MISMATCH: Calculated checksum "${calculatedChecksum}" does not match payload checksum "${parsed.checksum}"`,
        );
      }
    }

    // Phase 3: Compute Atomic File Changes
    const cleanOrphan = input.cleanOrphanFiles ?? true;
    const syncHelper = syncProjectSnapshotToProjectFS(snapshot);
    const changes = syncHelper.collectChanges(targetFiles, cleanOrphan);

    // Phase 4: Apply to ProjectFS & Restore Branches
    const preservedFiles: Record<string, string> = {};
    if (!cleanOrphan) {
      for (const path of projectFS.listFiles()) {
        if (!(path in targetFiles)) {
          const content = projectFS.readFile(path);
          if (content !== null) {
            preservedFiles[path] = content;
          }
        }
      }
    }

    const restoreBranches = input.restoreBranches ?? true;
    const projectDataEnvelope: ProjectData = {
      format: restoreBranches && parsed.branches ? 'revyme-v2' : 'revyme-v1',
      files: targetFiles,
      ...(restoreBranches && parsed.branches ? { branches: parsed.branches } : {}),
      activeBranchId: parsed.activeBranchId || MAIN_BRANCH_ID,
      mainBranchId: MAIN_BRANCH_ID,
    };

    // Hydrate ProjectFS via envelope (restores branches + runs loadSnapshot heals)
    projectFS.fromEnvelope(projectDataEnvelope);

    // If cleanOrphan is true, remove any files deleted in the restore; otherwise restore preserved untracked files
    if (cleanOrphan) {
      const restoredKeys = new Set(Object.keys(targetFiles));
      for (const existingPath of projectFS.listFiles()) {
        if (!restoredKeys.has(existingPath)) {
          projectFS.deleteFile(existingPath);
        }
      }
    } else {
      for (const [path, content] of Object.entries(preservedFiles)) {
        projectFS.writeFile(path, content);
      }
    }

    // Phase 5: Revision Increment (Restoration is a new versioned commit)
    const nextRevision = (snapshot?.revision ?? 0) + 1;
    const branchCount = parsed.branches ? Object.keys(parsed.branches).length : 0;
    const activeBranchId = parsed.activeBranchId || MAIN_BRANCH_ID;

    context?.trace?.('projects:backup:restore', {
      restoredFiles: Object.keys(targetFiles).length,
      nextRevision,
      changeCount: changes.length,
      branchCount,
    });

    return {
      restoredFiles: Object.keys(targetFiles).length,
      revision: nextRevision,
      changes,
      branchCount,
      activeBranchId,
    };
  },
};

// ─── Registry Registration & Aliases ─────────────────────────────────────────

defaultRegistry.register(projectsDuplicateOperation);
defaultRegistry.register(projectsBackupExportOperation);
defaultRegistry.register(projectsBackupRestoreOperation);

defaultRegistry.registerAlias('project.duplicate', 'projects.duplicate');
defaultRegistry.registerAlias('projects.copy', 'projects.duplicate');
defaultRegistry.registerAlias('project.copy', 'projects.duplicate');

defaultRegistry.registerAlias('projects.exportBackup', 'projects.backup.export');
defaultRegistry.registerAlias('project.backup.export', 'projects.backup.export');
defaultRegistry.registerAlias('backup.export', 'projects.backup.export');
defaultRegistry.registerAlias('projects.backup', 'projects.backup.export');

defaultRegistry.registerAlias('projects.restoreBackup', 'projects.backup.restore');
defaultRegistry.registerAlias('project.backup.restore', 'projects.backup.restore');
defaultRegistry.registerAlias('backup.restore', 'projects.backup.restore');
defaultRegistry.registerAlias('projects.restore', 'projects.backup.restore');
