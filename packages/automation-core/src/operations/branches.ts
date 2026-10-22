// packages/automation-core/src/operations/branches.ts
import { z } from 'zod';
import { createHash } from 'node:crypto';
import type { Operation, FileChange, Snapshot, OperationContext } from '../contracts';
import { defaultRegistry } from '../registry';
import { projectFS, MAIN_BRANCH_ID } from '@/code/project/project-fs';
import { toBranchId } from '@/code/stores/branch-store';
import { describeFileChanges } from '@/code/branching/describe-changes';
import { applyBranch } from '@/code/branching/apply';
import { clearHistoryStacks } from '@/code/mutation/history';
import { syncProjectSnapshotToProjectFS } from './projects';

// ─── Helper: Persist Meta Branches ───────────────────────────────────────────

export function persistMetaBranches(): void {
  const envelope = projectFS.toEnvelope();
  const branchesPayload = {
    activeBranchId: envelope.activeBranchId || MAIN_BRANCH_ID,
    mainBranchId: MAIN_BRANCH_ID,
    branches: envelope.branches || {},
  };
  projectFS.writeFile('_meta/branches.json', JSON.stringify(branchesPayload, null, 2));
}

export function syncBranchesSnapshotToProjectFS(snapshot?: Snapshot): void {
  syncProjectSnapshotToProjectFS(snapshot);
  if (projectFS.listBranches().length <= 1) {
    const metaBranchesJson = projectFS.readFile('_meta/branches.json');
    if (metaBranchesJson) {
      try {
        const parsed = JSON.parse(metaBranchesJson);
        if (parsed.branches && Object.keys(parsed.branches).length > 0) {
          projectFS.hydrateBranches(parsed.branches, parsed.activeBranchId);
        }
      } catch {}
    }
  }
}

// ─── 1. branches.list ─────────────────────────────────────────────────────────

export const branchesListInputSchema = z.object({});
export type BranchesListInput = z.infer<typeof branchesListInputSchema>;

export interface BranchListItem {
  id: string;
  active: boolean;
  status: string;
  parent: string | null;
  changedFiles?: number;
}

export interface BranchesListOutput {
  active: string;
  branches: BranchListItem[];
}

export const branchesListOperation: Operation<BranchesListInput, BranchesListOutput> = {
  name: 'branches.list',
  description: 'List all project branches with active indicator, status, and changed files count',
  category: 'branches',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T21',
  inputSchema: branchesListInputSchema,
  async execute(snapshot, _input, context: OperationContext) {
    syncBranchesSnapshotToProjectFS(snapshot);

    const activeBranchId = projectFS.getActiveBranchId();
    const branchInfos = projectFS.listBranches();
    const branches: BranchListItem[] = [];

    for (const b of branchInfos) {
      if (b.id === MAIN_BRANCH_ID) {
        branches.push({
          id: MAIN_BRANCH_ID,
          active: activeBranchId === MAIN_BRANCH_ID,
          status: 'clean',
          parent: null,
          changedFiles: 0,
        });
      } else {
        const base = projectFS.readBranchBase(b.id);
        const branchFiles = projectFS.readBranchFiles(b.id);
        let changedFiles = 0;

        if (base && branchFiles) {
          const allPaths = new Set([...base.keys(), ...branchFiles.keys()]);
          for (const path of allPaths) {
            if (base.get(path) !== branchFiles.get(path)) {
              changedFiles++;
            }
          }
        }

        branches.push({
          id: b.id,
          active: b.id === activeBranchId,
          status: b.status,
          parent: b.parentId ?? null,
          changedFiles,
        });
      }
    }

    context?.trace?.('branches:list', { active: activeBranchId, count: branches.length });

    return {
      active: activeBranchId,
      branches,
    };
  },
};

// ─── 2. branches.create ───────────────────────────────────────────────────────

export const branchesCreateInputSchema = z.object({
  name: z.string().min(1, 'Branch name must not be empty'),
});
export type BranchesCreateInput = z.infer<typeof branchesCreateInputSchema>;

export interface BranchesCreateOutput {
  branch: string;
  active: boolean;
  from: string;
}

export const branchesCreateOperation: Operation<BranchesCreateInput, BranchesCreateOutput> = {
  name: 'branches.create',
  description: 'Create a new branch from current workspace state and switch to it',
  category: 'branches',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T21',
  inputSchema: branchesCreateInputSchema,
  async execute(snapshot, input, context: OperationContext) {
    syncBranchesSnapshotToProjectFS(snapshot);

    const rawName = input.name.trim();
    if (!rawName) {
      throw new Error('VALIDATION_ERROR: Branch name must not be empty.');
    }

    const id = toBranchId(rawName);
    if (!id) {
      throw new Error('VALIDATION_ERROR: Invalid branch name. Must contain alphanumeric characters or hyphens.');
    }

    if (id === MAIN_BRANCH_ID) {
      throw new Error(`VALIDATION_ERROR: Branch "${MAIN_BRANCH_ID}" is protected — main is the publish truth, never a work branch.`);
    }

    const fromBranch = projectFS.getActiveBranchId();
    const refusal = projectFS.createBranch(id, { from: projectFS.getSnapshot() });
    if (refusal) {
      throw new Error(refusal);
    }

    const switched = projectFS.switchBranch(id);
    if (switched) {
      throw new Error(switched);
    }

    clearHistoryStacks();
    persistMetaBranches();

    context?.trace?.('branches:create', { branch: id, from: fromBranch });

    return {
      branch: id,
      active: true,
      from: fromBranch,
    };
  },
};

// ─── 3. branches.switch ───────────────────────────────────────────────────────

export const branchesSwitchInputSchema = z.object({
  branch: z.string().min(1, 'Target branch name must not be empty'),
});
export type BranchesSwitchInput = z.infer<typeof branchesSwitchInputSchema>;

export interface BranchesSwitchOutput {
  branch: string;
  active: boolean;
}

export const branchesSwitchOperation: Operation<BranchesSwitchInput, BranchesSwitchOutput> = {
  name: 'branches.switch',
  description: 'Switch active workspace branch pointer',
  category: 'branches',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T21',
  inputSchema: branchesSwitchInputSchema,
  async execute(snapshot, input, context: OperationContext) {
    syncBranchesSnapshotToProjectFS(snapshot);

    const targetId = input.branch.trim();
    const isKnown = targetId === MAIN_BRANCH_ID || projectFS.listBranches().some((b) => b.id === targetId);
    if (!isKnown) {
      throw new Error(`Unknown branch "${targetId}".`);
    }

    const refusal = projectFS.switchBranch(targetId);
    if (refusal) {
      throw new Error(refusal);
    }

    clearHistoryStacks();
    persistMetaBranches();

    context?.trace?.('branches:switch', { branch: targetId });

    return {
      branch: targetId,
      active: true,
    };
  },
};

// ─── 4. branches.review ───────────────────────────────────────────────────────

export const branchesReviewInputSchema = z.object({
  branch: z.string().optional(),
});
export type BranchesReviewInput = z.infer<typeof branchesReviewInputSchema>;

export interface BranchFileReview {
  path: string;
  status: 'added' | 'removed' | 'changed';
  changes: string[];
}

export interface BranchesReviewOutput {
  branch: string;
  files: BranchFileReview[];
  mainMovedSince: boolean;
  mainChanged?: string[];
}

export const branchesReviewOperation: Operation<BranchesReviewInput, BranchesReviewOutput> = {
  name: 'branches.review',
  description: 'Review diff of branch against merge base, detecting changes and main branch drift',
  category: 'branches',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T21',
  inputSchema: branchesReviewInputSchema,
  async execute(snapshot, input, context: OperationContext) {
    syncBranchesSnapshotToProjectFS(snapshot);

    const targetBranch = input.branch ? input.branch.trim() : projectFS.getActiveBranchId();

    if (targetBranch === MAIN_BRANCH_ID) {
      return {
        branch: MAIN_BRANCH_ID,
        files: [],
        mainMovedSince: false,
        mainChanged: [],
      };
    }

    const base = projectFS.readBranchBase(targetBranch);
    const branchFiles = projectFS.readBranchFiles(targetBranch);
    if (!base || !branchFiles) {
      throw new Error(`Unknown branch "${targetBranch}".`);
    }

    const mainFiles = projectFS.readBranchFiles(MAIN_BRANCH_ID) ?? new Map<string, string>();
    const allMainPaths = new Set([...base.keys(), ...mainFiles.keys()]);
    const mainChanged: string[] = [];

    for (const path of allMainPaths) {
      if (base.get(path) !== mainFiles.get(path)) {
        mainChanged.push(path);
      }
    }
    const mainMovedSince = mainChanged.length > 0;

    const allBranchPaths = new Set([...base.keys(), ...branchFiles.keys()]);
    const files: BranchFileReview[] = [];

    for (const path of allBranchPaths) {
      const baseContent = base.get(path);
      const branchContent = branchFiles.get(path);

      if (baseContent === undefined && branchContent !== undefined) {
        files.push({
          path,
          status: 'added',
          changes: ['File added to branch'],
        });
      } else if (baseContent !== undefined && branchContent === undefined) {
        files.push({
          path,
          status: 'removed',
          changes: ['File removed from branch'],
        });
      } else if (baseContent !== branchContent && baseContent !== undefined && branchContent !== undefined) {
        const desc = describeFileChanges(baseContent, branchContent);
        let changeStrings: string[] = [];
        if (!desc.unparsed && desc.changes.length > 0) {
          changeStrings = desc.changes.map((c) => {
            const propsDesc = c.props.length > 0 ? ` (${c.props.map((p) => p.label).join(', ')})` : '';
            return `${c.kind}: ${c.title}${propsDesc}`;
          });
        } else {
          changeStrings = ['Content modified'];
        }
        files.push({
          path,
          status: 'changed',
          changes: changeStrings,
        });
      }
    }

    context?.trace?.('branches:review', {
      branch: targetBranch,
      fileCount: files.length,
      mainMovedSince,
    });

    return {
      branch: targetBranch,
      files,
      mainMovedSince,
      mainChanged,
    };
  },
};

// ─── 5. branches.apply ────────────────────────────────────────────────────────

export const branchesApplyInputSchema = z.object({
  branch: z.string().optional(),
});
export type BranchesApplyInput = z.infer<typeof branchesApplyInputSchema>;

export interface BranchesApplyOutput {
  branch: string;
  applied: boolean;
  files: string[];
  changes: FileChange[];
}

export const branchesApplyOperation: Operation<BranchesApplyInput, BranchesApplyOutput> = {
  name: 'branches.apply',
  description: 'Merge branch into main with 3-way conflict detection, Oracle validation, and atomic commit',
  category: 'branches',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T21',
  inputSchema: branchesApplyInputSchema,
  async execute(snapshot, input, context: OperationContext) {
    syncBranchesSnapshotToProjectFS(snapshot);

    const targetBranch = input.branch ? input.branch.trim() : projectFS.getActiveBranchId();

    if (targetBranch === MAIN_BRANCH_ID) {
      throw new Error('Cannot apply main to itself.');
    }

    const base = projectFS.readBranchBase(targetBranch);
    const branchFiles = projectFS.readBranchFiles(targetBranch);
    if (!base || !branchFiles) {
      throw new Error(`Unknown branch "${targetBranch}".`);
    }

    const preApplyMain = projectFS.readBranchFiles(MAIN_BRANCH_ID, { shared: true }) ?? new Map(projectFS.getSnapshot());

    const result = applyBranch(targetBranch);

    if (result.status === 'conflicts') {
      const conflictedPaths = result.conflicts.map((c) => c.path);
      throw new Error(`Merge conflict in ${conflictedPaths.join(', ')}. Branch cannot be applied without conflict resolution.`);
    }

    if (result.status === 'refused') {
      throw new Error(`Branch apply refused: ${result.reason || 'Oracle gate failed'}`);
    }

    const postApplyMain = projectFS.readBranchFiles(MAIN_BRANCH_ID, { shared: true }) ?? new Map(projectFS.getSnapshot());
    const changes: FileChange[] = [];
    const allPaths = new Set([...preApplyMain.keys(), ...postApplyMain.keys()]);

    for (const p of allPaths) {
      const before = preApplyMain.get(p);
      const after = postApplyMain.get(p);
      if (before !== after) {
        changes.push({
          path: p,
          beforeHash: before ? createHash('sha256').update(before).digest('hex') : null,
          content: after ?? null,
        });
      }
    }

    persistMetaBranches();

    context?.trace?.('branches:apply', {
      branch: targetBranch,
      filesWritten: result.files.length,
      changeCount: changes.length,
    });

    return {
      branch: targetBranch,
      applied: true,
      files: Array.from(new Set([...result.files, ...changes.map((c) => c.path)])),
      changes,
    };
  },
};

// ─── 6. branches.delete ───────────────────────────────────────────────────────

export const branchesDeleteInputSchema = z.object({
  branch: z.string().min(1, 'Branch name must not be empty'),
});
export type BranchesDeleteInput = z.infer<typeof branchesDeleteInputSchema>;

export interface BranchesDeleteOutput {
  branch: string;
  deleted: boolean;
}

export const branchesDeleteOperation: Operation<BranchesDeleteInput, BranchesDeleteOutput> = {
  name: 'branches.delete',
  description: 'Delete branch (reverts active pointer to main if deleting active branch)',
  category: 'branches',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T21',
  inputSchema: branchesDeleteInputSchema,
  async execute(snapshot, input, context: OperationContext) {
    syncBranchesSnapshotToProjectFS(snapshot);

    const targetId = input.branch.trim();
    if (targetId === MAIN_BRANCH_ID) {
      throw new Error(`Cannot delete protected branch "${MAIN_BRANCH_ID}".`);
    }

    const isKnown = projectFS.listBranches().some((b) => b.id === targetId);
    if (!isKnown) {
      throw new Error(`Unknown branch "${targetId}".`);
    }

    if (projectFS.getActiveBranchId() === targetId) {
      projectFS.switchBranch(MAIN_BRANCH_ID);
    }

    const refusal = projectFS.deleteBranch(targetId);
    if (refusal) {
      throw new Error(refusal);
    }

    persistMetaBranches();

    context?.trace?.('branches:delete', { branch: targetId });

    return {
      branch: targetId,
      deleted: true,
    };
  },
};

// ─── Registry Registration & Aliases ─────────────────────────────────────────

defaultRegistry.register(branchesListOperation);
defaultRegistry.register(branchesCreateOperation);
defaultRegistry.register(branchesSwitchOperation);
defaultRegistry.register(branchesReviewOperation);
defaultRegistry.register(branchesApplyOperation);
defaultRegistry.register(branchesDeleteOperation);

defaultRegistry.registerAlias('branches.listBranches', 'branches.list');
defaultRegistry.registerAlias('branches.createBranch', 'branches.create');
defaultRegistry.registerAlias('branches.switchBranch', 'branches.switch');
defaultRegistry.registerAlias('branches.reviewBranch', 'branches.review');
defaultRegistry.registerAlias('branches.applyBranch', 'branches.apply');
defaultRegistry.registerAlias('branches.deleteBranch', 'branches.delete');
