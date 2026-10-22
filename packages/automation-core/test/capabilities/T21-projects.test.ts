// packages/automation-core/test/capabilities/T21-projects.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import type { Snapshot } from '../../src/contracts';
import { createSnapshot, createOperationContext } from '../../src/session';
import { defaultRegistry } from '../../src/registry';
import {
  projectsDuplicateOperation,
  projectsBackupExportOperation,
  projectsBackupRestoreOperation,
  calculateFilesChecksum,
} from '../../src/operations/projects';
import {
  branchesListOperation,
  branchesCreateOperation,
  branchesSwitchOperation,
  branchesReviewOperation,
  branchesApplyOperation,
  branchesDeleteOperation,
} from '../../src/operations/branches';
import {
  historyUndoOperation,
  historyRedoOperation,
  recordHistoryStep,
  clearHistoryState,
  getHistoryStatus,
} from '../../src/operations/history';
import {
  foldersListOperation,
  foldersCreateOperation,
  foldersMoveItemOperation,
} from '../../src/operations/folders';
import {
  commentsListOperation,
  commentsCreateOperation,
  commentsResolveOperation,
} from '../../src/operations/comments';
import {
  guidesGetOperation,
  guidesSetOperation,
} from '../../src/operations/guides';
import { projectFS, MAIN_BRANCH_ID } from '@/code/project/project-fs';

const SAMPLE_PAGE_A = `'use client';
import React from 'react';

/** @canvas { "viewports": [ { "id": "desktop", "label": "Desktop", "width": 1200, "height": "auto", "isPrimary": true, "order": 0 } ], "positions": { "desktop": { "x": 0, "y": 0 } } } */

export default function PageA() {
  return (
    <div data-id="root" style={{ width: '100%', height: 'auto', padding: '24px' }}>
      <h1 data-id="title" style={{ fontSize: '32px' }}>Home Page</h1>
      <p data-id="desc">Welcome to Revyme</p>
    </div>
  );
}
`;

const SAMPLE_PAGE_B = `'use client';
import React from 'react';

/** @canvas { "viewports": [ { "id": "desktop", "label": "Desktop", "width": 1200, "height": "auto", "isPrimary": true, "order": 0 } ], "positions": { "desktop": { "x": 0, "y": 0 } } } */

export default function PageB() {
  return (
    <div data-id="root-b" style={{ width: '100%', height: 'auto', padding: '16px' }}>
      <h2 data-id="heading-b">About Us</h2>
    </div>
  );
}
`;

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function createMockSnapshot(files: Record<string, string>, revision = 1): Snapshot {
  return createSnapshot({ projectId: 'test-project', branchId: 'main' }, revision, files);
}

describe('T21: Project Lifecycle, Branches, History, Folders, Comments & Guides', () => {
  const context = createOperationContext();

  beforeEach(() => {
    projectFS.loadSnapshot(
      new Map([
        ['app/page.client.tsx', SAMPLE_PAGE_A],
        ['app/about/page.client.tsx', SAMPLE_PAGE_B],
        ['app/globals.css', 'body { margin: 0; }'],
      ]),
    );
    projectFS.switchBranch(MAIN_BRANCH_ID);
    for (const b of projectFS.listBranches()) {
      if (b.id !== MAIN_BRANCH_ID) {
        projectFS.deleteBranch(b.id);
      }
    }
    clearHistoryState();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Group 1: Registry Registration & Aliases
  // ───────────────────────────────────────────────────────────────────────────
  describe('1. Registry Registration & Aliases', () => {
    const requiredOps = [
      'projects.duplicate',
      'projects.backup.export',
      'projects.backup.restore',
      'branches.list',
      'branches.create',
      'branches.switch',
      'branches.review',
      'branches.apply',
      'branches.delete',
      'history.undo',
      'history.redo',
      'folders.list',
      'folders.create',
      'folders.moveItem',
      'comments.list',
      'comments.create',
      'comments.resolve',
      'guides.get',
      'guides.set',
    ];

    it('registers all 19 canonical T21 operations in defaultRegistry', () => {
      for (const name of requiredOps) {
        const op = defaultRegistry.get(name);
        expect(op, `Operation "${name}" should be registered`).toBeDefined();
        expect(op?.name).toBe(name);
        expect(op?.ownerTask).toBe('T21');
      }
    });

    it('resolves all compatibility aliases', () => {
      const aliasMap: Record<string, string> = {
        'project.duplicate': 'projects.duplicate',
        'projects.copy': 'projects.duplicate',
        'projects.exportBackup': 'projects.backup.export',
        'project.backup.export': 'projects.backup.export',
        'backup.export': 'projects.backup.export',
        'projects.restoreBackup': 'projects.backup.restore',
        'project.backup.restore': 'projects.backup.restore',
        'backup.restore': 'projects.backup.restore',
        'branches.listBranches': 'branches.list',
        'branches.createBranch': 'branches.create',
        'branches.switchBranch': 'branches.switch',
        'branches.reviewBranch': 'branches.review',
        'branches.applyBranch': 'branches.apply',
        'branches.deleteBranch': 'branches.delete',
        'history.undoChange': 'history.undo',
        'history.redoChange': 'history.redo',
        'folders.add': 'folders.create',
        'folders.move': 'folders.moveItem',
        'comments.add': 'comments.create',
        'comments.toggleResolved': 'comments.resolve',
        'ruler-guides.get': 'guides.get',
        'ruler-guides.set': 'guides.set',
      };

      for (const [alias, canonical] of Object.entries(aliasMap)) {
        const op = defaultRegistry.get(alias);
        expect(op, `Alias "${alias}" should resolve`).toBeDefined();
        expect(op?.name).toBe(canonical);
      }
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Group 2: Project Lifecycle (Duplicate, Backup Export & Restore)
  // ───────────────────────────────────────────────────────────────────────────
  describe('2. Project Lifecycle (Duplicate, Backup Export & Restore)', () => {
    it('duplicates project snapshot into new project record', async () => {
      const snap = createMockSnapshot({
        'app/page.client.tsx': SAMPLE_PAGE_A,
        'app/about/page.client.tsx': SAMPLE_PAGE_B,
      }, 5);

      const res = await projectsDuplicateOperation.execute(
        snap,
        { targetName: 'Clone of Project', folderId: 'fld-marketing' },
        context,
      );

      expect(res.originalProjectId).toBe('test-project');
      expect(res.newProjectId).toBeDefined();
      expect(res.name).toBe('Clone of Project');
      expect(res.fileCount).toBeGreaterThanOrEqual(2);
      expect(res.revision).toBe(5);
      expect(res.folderId).toBe('fld-marketing');
    });

    it('rejects project duplication with empty name', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': SAMPLE_PAGE_A });
      await expect(
        projectsDuplicateOperation.execute(snap, { targetName: '   ' }, context),
      ).rejects.toThrow();
    });

    it('exports self-contained checksummed backup payload', async () => {
      const snap = createMockSnapshot({
        'app/page.client.tsx': SAMPLE_PAGE_A,
        'app/about/page.client.tsx': SAMPLE_PAGE_B,
      }, 3);

      const res = await projectsBackupExportOperation.execute(
        snap,
        { includeBranches: true, compress: false },
        context,
      );

      expect(res.projectId).toBe('test-project');
      expect(res.revision).toBe(3);
      expect(res.fileCount).toBeGreaterThanOrEqual(2);
      expect(res.compressed).toBe(false);

      const parsed = JSON.parse(res.backupPayload);
      expect(parsed.version).toBe('revyme-backup-v1');
      expect(parsed.projectId).toBe('test-project');
      expect(parsed.files['app/page.client.tsx']).toBe(SAMPLE_PAGE_A);
      expect(parsed.checksum).toBe(res.checksum);

      const expectedChecksum = calculateFilesChecksum(parsed.files);
      expect(res.checksum).toBe(expectedChecksum);
    });

    it('exports compressed gzip backup when compress=true', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': SAMPLE_PAGE_A }, 1);
      const res = await projectsBackupExportOperation.execute(
        snap,
        { compress: true },
        context,
      );

      expect(res.compressed).toBe(true);
      expect(res.backupPayload.startsWith('{')).toBe(false);

      const buffer = Buffer.from(res.backupPayload, 'base64');
      const decompressed = gunzipSync(buffer).toString('utf-8');
      const parsed = JSON.parse(decompressed);
      expect(parsed.version).toBe('revyme-backup-v1');
      expect(parsed.files['app/page.client.tsx']).toBe(SAMPLE_PAGE_A);
    });

    it('restores backup payload and produces atomic FileChange diffs', async () => {
      const snap = createMockSnapshot({
        'app/page.client.tsx': SAMPLE_PAGE_A,
      }, 4);

      // Export initial state
      const exported = await projectsBackupExportOperation.execute(snap, {}, context);

      // Mutate ProjectFS (modify one file, add a new one)
      projectFS.writeFile('app/page.client.tsx', SAMPLE_PAGE_A + '\n// modified');
      projectFS.writeFile('app/extra.txt', 'transient file');

      const restoreSnap = createMockSnapshot({
        'app/page.client.tsx': SAMPLE_PAGE_A + '\n// modified',
        'app/extra.txt': 'transient file',
      }, 4);

      // Restore backup
      const restored = await projectsBackupRestoreOperation.execute(
        restoreSnap,
        { backupPayload: exported.backupPayload, cleanOrphanFiles: true },
        context,
      );

      expect(restored.revision).toBe(5);
      expect(restored.changes.length).toBeGreaterThanOrEqual(1);

      // app/extra.txt should be deleted (content: null)
      const deletedChange = restored.changes.find((c) => c.path === 'app/extra.txt');
      expect(deletedChange?.content).toBeNull();

      // app/page.client.tsx should be restored to original
      const modifiedChange = restored.changes.find((c) => c.path === 'app/page.client.tsx');
      expect(modifiedChange?.content).toBe(SAMPLE_PAGE_A);
      expect(projectFS.readFile('app/page.client.tsx')).toBe(SAMPLE_PAGE_A);
    });

    it('restores compressed backup payload cleanly', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': SAMPLE_PAGE_A }, 2);
      const exported = await projectsBackupExportOperation.execute(snap, { compress: true }, context);

      projectFS.deleteFile('app/page.client.tsx');
      expect(projectFS.readFile('app/page.client.tsx')).toBeNull();

      const restored = await projectsBackupRestoreOperation.execute(
        snap,
        { backupPayload: exported.backupPayload },
        context,
      );

      expect(restored.revision).toBe(3);
      expect(projectFS.readFile('app/page.client.tsx')).toBe(SAMPLE_PAGE_A);
    });

    it('rejects restore with corrupted checksum', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': SAMPLE_PAGE_A }, 1);
      const exported = await projectsBackupExportOperation.execute(snap, { compress: false }, context);

      const parsed = JSON.parse(exported.backupPayload);
      parsed.checksum = '0000000000000000000000000000000000000000000000000000000000000000';
      const corruptedPayload = JSON.stringify(parsed);

      await expect(
        projectsBackupRestoreOperation.execute(snap, { backupPayload: corruptedPayload }, context),
      ).rejects.toThrow(/BACKUP_CHECKSUM_MISMATCH/);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Group 3: Branch Lifecycle (Create, List, Switch, Delete)
  // ───────────────────────────────────────────────────────────────────────────
  describe('3. Branch Lifecycle (Create, List, Switch, Delete)', () => {
    it('creates new branch, switches to it, and lists branches', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': SAMPLE_PAGE_A });

      const createRes = await branchesCreateOperation.execute(
        snap,
        { name: 'feature-hero' },
        context,
      );

      expect(createRes.branch).toBe('feature-hero');
      expect(createRes.active).toBe(true);
      expect(createRes.from).toBe('main');
      expect(projectFS.getActiveBranchId()).toBe('feature-hero');

      const listRes = await branchesListOperation.execute(snap, {}, context);
      expect(listRes.active).toBe('feature-hero');
      expect(listRes.branches.some((b) => b.id === 'feature-hero' && b.active)).toBe(true);
      expect(listRes.branches.some((b) => b.id === 'main' && !b.active)).toBe(true);
    });

    it('normalizes branch names with uppercase or spaces', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': SAMPLE_PAGE_A });

      const res = await branchesCreateOperation.execute(
        snap,
        { name: 'Feature Marketing v2!' },
        context,
      );

      expect(res.branch).toBe('feature-marketing-v2');
      expect(projectFS.getActiveBranchId()).toBe('feature-marketing-v2');
    });

    it('rejects creating branch named main or invalid names', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': SAMPLE_PAGE_A });

      await expect(
        branchesCreateOperation.execute(snap, { name: 'main' }, context),
      ).rejects.toThrow();

      await expect(
        branchesCreateOperation.execute(snap, { name: '   ' }, context),
      ).rejects.toThrow();
    });

    it('rejects creating duplicate branch', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': SAMPLE_PAGE_A });
      await branchesCreateOperation.execute(snap, { name: 'alpha' }, context);

      await expect(
        branchesCreateOperation.execute(snap, { name: 'alpha' }, context),
      ).rejects.toThrow(/already exists/i);
    });

    it('switches between branches', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': SAMPLE_PAGE_A });
      await branchesCreateOperation.execute(snap, { name: 'b1' }, context);
      expect(projectFS.getActiveBranchId()).toBe('b1');

      const switchRes = await branchesSwitchOperation.execute(snap, { branch: 'main' }, context);
      expect(switchRes.branch).toBe('main');
      expect(switchRes.active).toBe(true);
      expect(projectFS.getActiveBranchId()).toBe('main');
    });

    it('isolates history when switching branches', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': SAMPLE_PAGE_A });
      await branchesCreateOperation.execute(snap, { name: 'branch-hist' }, context);

      // Record history on branch-hist
      recordHistoryStep('app/page.client.tsx', [
        { path: 'app/page.client.tsx', oldContent: SAMPLE_PAGE_A, newContent: SAMPLE_PAGE_A + '\n// edit' },
      ]);
      expect(getHistoryStatus().canUndo).toBe(true);

      // Switch to main — history must be reset
      await branchesSwitchOperation.execute(snap, { branch: 'main' }, context);
      expect(getHistoryStatus().canUndo).toBe(false);
    });

    it('rejects switching to non-existent branch', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': SAMPLE_PAGE_A });
      await expect(
        branchesSwitchOperation.execute(snap, { branch: 'non-existent' }, context),
      ).rejects.toThrow(/Unknown branch/i);
    });

    it('deletes branch and switches away if active', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': SAMPLE_PAGE_A });
      await branchesCreateOperation.execute(snap, { name: 'temp-branch' }, context);
      expect(projectFS.getActiveBranchId()).toBe('temp-branch');

      const delRes = await branchesDeleteOperation.execute(snap, { branch: 'temp-branch' }, context);
      expect(delRes.deleted).toBe(true);
      expect(projectFS.getActiveBranchId()).toBe('main');
      expect(projectFS.listBranches().some((b) => b.id === 'temp-branch')).toBe(false);
    });

    it('refuses deleting protected main branch', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': SAMPLE_PAGE_A });
      await expect(
        branchesDeleteOperation.execute(snap, { branch: 'main' }, context),
      ).rejects.toThrow(/Cannot delete protected branch/i);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Group 4: Branch Review & Apply
  // ───────────────────────────────────────────────────────────────────────────
  describe('4. Branch Review & Apply', () => {
    it('reviews branch changes against base and flags main drift', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': SAMPLE_PAGE_A });

      // Create branch and modify a file
      await branchesCreateOperation.execute(snap, { name: 'redesign' }, context);
      const modifiedCode = SAMPLE_PAGE_A.replace('Welcome to Revyme', 'Brand New Header');
      projectFS.writeFile('app/page.client.tsx', modifiedCode);
      projectFS.writeFile('app/pricing/page.client.tsx', SAMPLE_PAGE_B);

      const review = await branchesReviewOperation.execute(snap, { branch: 'redesign' }, context);
      expect(review.branch).toBe('redesign');
      expect(review.mainMovedSince).toBe(false);

      const pageA = review.files.find((f) => f.path === 'app/page.client.tsx');
      expect(pageA?.status).toBe('changed');
      expect(pageA?.changes.length).toBeGreaterThan(0);

      const pricing = review.files.find((f) => f.path === 'app/pricing/page.client.tsx');
      expect(pricing?.status).toBe('added');

      // Now move main
      projectFS.switchBranch('main');
      projectFS.writeFile('app/about/page.client.tsx', SAMPLE_PAGE_B + '\n// main edited');

      // Review should now show mainMovedSince = true
      const reviewDrift = await branchesReviewOperation.execute(snap, { branch: 'redesign' }, context);
      expect(reviewDrift.mainMovedSince).toBe(true);
      expect(reviewDrift.mainChanged).toContain('app/about/page.client.tsx');
    });

    it('applies fast-forward merge onto main', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': SAMPLE_PAGE_A });
      await branchesCreateOperation.execute(snap, { name: 'feat-fast' }, context);

      const updatedCode = SAMPLE_PAGE_A.replace('32px', '48px');
      projectFS.writeFile('app/page.client.tsx', updatedCode);

      const res = await branchesApplyOperation.execute(snap, { branch: 'feat-fast' }, context);
      expect(res.applied).toBe(true);
      expect(res.files).toContain('app/page.client.tsx');
      expect(projectFS.readFile('app/page.client.tsx')).toContain("fontSize: '48px'");
    });

    it('refuses applying main to itself', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': SAMPLE_PAGE_A });
      projectFS.switchBranch('main');
      await expect(
        branchesApplyOperation.execute(snap, { branch: 'main' }, context),
      ).rejects.toThrow(/Cannot apply main to itself/);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Group 5: History Stack (Undo & Redo)
  // ───────────────────────────────────────────────────────────────────────────
  describe('5. History Stack (Undo & Redo)', () => {
    it('returns undone/redone false when stacks are empty', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': SAMPLE_PAGE_A });

      const undoRes = await historyUndoOperation.execute(snap, {}, context);
      expect(undoRes.undone).toBe(false);
      expect(undoRes.changes).toEqual([]);

      const redoRes = await historyRedoOperation.execute(snap, {}, context);
      expect(redoRes.redone).toBe(false);
      expect(redoRes.changes).toEqual([]);
    });

    it('performs undo and redo on file modification', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': SAMPLE_PAGE_A });
      const oldContent = SAMPLE_PAGE_A;
      const newContent = SAMPLE_PAGE_A + '\n// edited';

      projectFS.writeFile('app/page.client.tsx', newContent);
      recordHistoryStep('app/page.client.tsx', [
        { path: 'app/page.client.tsx', oldContent, newContent },
      ]);

      const statusBefore = getHistoryStatus();
      expect(statusBefore.canUndo).toBe(true);
      expect(statusBefore.undoCount).toBe(1);

      // Undo
      const undoRes = await historyUndoOperation.execute(snap, {}, context);
      expect(undoRes.undone).toBe(true);
      expect(undoRes.activeFile).toBe('app/page.client.tsx');
      expect(projectFS.readFile('app/page.client.tsx')).toBe(oldContent);

      const statusAfterUndo = getHistoryStatus();
      expect(statusAfterUndo.canUndo).toBe(false);
      expect(statusAfterUndo.canRedo).toBe(true);

      // Redo
      const redoRes = await historyRedoOperation.execute(snap, {}, context);
      expect(redoRes.redone).toBe(true);
      expect(projectFS.readFile('app/page.client.tsx')).toBe(newContent);

      const statusAfterRedo = getHistoryStatus();
      expect(statusAfterRedo.canUndo).toBe(true);
      expect(statusAfterRedo.canRedo).toBe(false);
    });

    it('handles created files by deleting them upon undo', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': SAMPLE_PAGE_A });
      const createdFile = 'app/extra.tsx';
      const fileContent = 'export const extra = true;';

      projectFS.writeFile(createdFile, fileContent);
      recordHistoryStep(createdFile, [
        { path: createdFile, oldContent: null, newContent: fileContent },
      ]);

      expect(projectFS.readFile(createdFile)).toBe(fileContent);

      const undoRes = await historyUndoOperation.execute(snap, {}, context);
      expect(undoRes.undone).toBe(true);
      expect(projectFS.readFile(createdFile)).toBeNull();

      const redoRes = await historyRedoOperation.execute(snap, {}, context);
      expect(redoRes.redone).toBe(true);
      expect(projectFS.readFile(createdFile)).toBe(fileContent);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Group 6: Folders Management
  // ───────────────────────────────────────────────────────────────────────────
  describe('6. Folders Management (List, Create, MoveItem)', () => {
    it('lists folders across different kinds', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': SAMPLE_PAGE_A });

      const pageFolders = await foldersListOperation.execute(snap, { kind: 'pages' }, context);
      expect(pageFolders.kind).toBe('pages');
      expect(Array.isArray(pageFolders.folders)).toBe(true);

      const compFolders = await foldersListOperation.execute(snap, { kind: 'components' }, context);
      expect(compFolders.kind).toBe('components');
      expect(compFolders.folders).toEqual([]);
    });

    it('creates root folder and nested folder for components', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': SAMPLE_PAGE_A });

      const rootRes = await foldersCreateOperation.execute(
        snap,
        { kind: 'components', name: 'Layout' },
        context,
      );
      expect(rootRes.folderId).toMatch(/^fld-/);
      expect(rootRes.name).toBe('Layout');
      expect(rootRes.changes.length).toBe(1);

      const childRes = await foldersCreateOperation.execute(
        snap,
        { kind: 'components', name: 'Headers', parentId: rootRes.folderId },
        context,
      );
      expect(childRes.folderId).toMatch(/^fld-/);
      expect(childRes.name).toBe('Headers');

      const listRes = await foldersListOperation.execute(snap, { kind: 'components' }, context);
      expect(listRes.folders.length).toBe(2);
      const child = listRes.folders.find((f) => f.id === childRes.folderId);
      expect(child?.parentId).toBe(rootRes.folderId);
    });

    it('rejects creating folder under non-existent parent', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': SAMPLE_PAGE_A });
      await expect(
        foldersCreateOperation.execute(
          snap,
          { kind: 'components', name: 'Bad', parentId: 'fld-does-not-exist' },
          context,
        ),
      ).rejects.toThrow(/does not exist/);
    });

    it('moves item into folder and back to root', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': SAMPLE_PAGE_A });

      const folder = await foldersCreateOperation.execute(
        snap,
        { kind: 'components', name: 'Nav' },
        context,
      );

      // Move an item into folder
      const moveRes = await foldersMoveItemOperation.execute(
        snap,
        { kind: 'components', itemId: 'components/Header.tsx', targetFolderId: folder.folderId },
        context,
      );
      expect(moveRes.targetFolderId).toBe(folder.folderId);

      let listRes = await foldersListOperation.execute(snap, { kind: 'components' }, context);
      let navFolder = listRes.folders.find((f) => f.id === folder.folderId);
      expect(navFolder?.count).toBe(1);

      // Move back to root
      await foldersMoveItemOperation.execute(
        snap,
        { kind: 'components', itemId: 'components/Header.tsx', targetFolderId: null },
        context,
      );

      listRes = await foldersListOperation.execute(snap, { kind: 'components' }, context);
      navFolder = listRes.folders.find((f) => f.id === folder.folderId);
      expect(navFolder?.count).toBe(0);
    });

    it('detects and rejects cyclic folder moves', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': SAMPLE_PAGE_A });

      const fldA = await foldersCreateOperation.execute(
        snap,
        { kind: 'components', name: 'ParentA' },
        context,
      );
      const fldB = await foldersCreateOperation.execute(
        snap,
        { kind: 'components', name: 'ChildB', parentId: fldA.folderId },
        context,
      );

      // Moving A into its child B is a cycle
      await expect(
        foldersMoveItemOperation.execute(
          snap,
          { kind: 'components', itemId: fldA.folderId, targetFolderId: fldB.folderId },
          context,
        ),
      ).rejects.toThrow(/Cycle detected/);
    });

    it('detects cyclic moves for folders with non-prefixed custom IDs', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': SAMPLE_PAGE_A });
      projectFS.writeFile(
        '_meta/component-folders.json',
        JSON.stringify({
          folders: [
            { id: 'custom-parent', name: 'CustomParent', parentId: null, children: ['custom-child'] },
            { id: 'custom-child', name: 'CustomChild', parentId: 'custom-parent', children: [] },
          ],
          rootOrder: ['custom-parent'],
        }),
      );

      await expect(
        foldersMoveItemOperation.execute(
          snap,
          { kind: 'components', itemId: 'custom-parent', targetFolderId: 'custom-child' },
          context,
        ),
      ).rejects.toThrow(/Cycle detected/);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Group 7: Comments Management
  // ───────────────────────────────────────────────────────────────────────────
  describe('7. Comments Management (List, Create, Resolve)', () => {
    it('creates, lists, and resolves comment threads', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': SAMPLE_PAGE_A });

      const createRes = await commentsCreateOperation.execute(
        snap,
        {
          filePath: 'app/page.client.tsx',
          nodeId: 'title',
          position: { x: 120, y: 80 },
          content: 'Increase headline size for mobile',
          author: 'UX Reviewer',
        },
        context,
      );

      expect(createRes.commentId).toMatch(/^comment-/);
      expect(createRes.changes.length).toBe(1);

      const listRes = await commentsListOperation.execute(
        snap,
        { filePath: 'app/page.client.tsx' },
        context,
      );

      expect(listRes.comments.length).toBe(1);
      const comment = listRes.comments[0];
      expect(comment.id).toBe(createRes.commentId);
      expect(comment.nodeId).toBe('title');
      expect(comment.content).toBe('Increase headline size for mobile');
      expect(comment.author).toBe('UX Reviewer');
      expect(comment.resolved).toBe(false);
      expect(comment.position).toEqual({ x: 120, y: 80 });

      // Resolve comment
      const resolveRes = await commentsResolveOperation.execute(
        snap,
        { commentId: createRes.commentId, resolved: true },
        context,
      );
      expect(resolveRes.resolved).toBe(true);

      const listAfterResolve = await commentsListOperation.execute(snap, {}, context);
      expect(listAfterResolve.comments[0].resolved).toBe(true);
    });

    it('rejects comment creation for non-existent file', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': SAMPLE_PAGE_A });
      await expect(
        commentsCreateOperation.execute(
          snap,
          { filePath: 'app/ghost.tsx', content: 'Ghost comment' },
          context,
        ),
      ).rejects.toThrow(/does not exist/);
    });

    it('rejects comment creation with empty or whitespace-only content on direct execution', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': SAMPLE_PAGE_A });
      await expect(
        commentsCreateOperation.execute(
          snap,
          { filePath: 'app/page.client.tsx', content: '   ' },
          context,
        ),
      ).rejects.toThrow(/VALIDATION_ERROR: Comment content must not be empty/);
    });

    it('rejects resolving non-existent comment', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': SAMPLE_PAGE_A });
      await expect(
        commentsResolveOperation.execute(
          snap,
          { commentId: 'comment-does-not-exist' },
          context,
        ),
      ).rejects.toThrow(/not found/);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Group 8: Ruler Guides Management
  // ───────────────────────────────────────────────────────────────────────────
  describe('8. Ruler Guides Management (Get, Set)', () => {
    it('sets and retrieves ruler guides in .tsx source code', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': SAMPLE_PAGE_A });

      // Initially no guides
      const initialGuides = await guidesGetOperation.execute(
        snap,
        { filePath: 'app/page.client.tsx' },
        context,
      );
      expect(initialGuides.horizontal).toEqual([]);
      expect(initialGuides.vertical).toEqual([]);

      // Set guides
      const setRes = await guidesSetOperation.execute(
        snap,
        {
          filePath: 'app/page.client.tsx',
          horizontal: [120, 480],
          vertical: [24, 768, 1200],
        },
        context,
      );

      expect(setRes.count).toBe(5);
      expect(setRes.changes.length).toBe(1);

      const savedCode = projectFS.readFile('app/page.client.tsx')!;
      expect(savedCode).toContain('@rulerGuides');

      // Get guides and verify sorting
      const fetchedGuides = await guidesGetOperation.execute(
        snap,
        { filePath: 'app/page.client.tsx' },
        context,
      );
      expect(fetchedGuides.horizontal).toEqual([120, 480]);
      expect(fetchedGuides.vertical).toEqual([24, 768, 1200]);

      // Setting empty guides removes the block cleanly
      const clearRes = await guidesSetOperation.execute(
        snap,
        { filePath: 'app/page.client.tsx', horizontal: [], vertical: [] },
        context,
      );
      expect(clearRes.count).toBe(0);

      const clearedCode = projectFS.readFile('app/page.client.tsx')!;
      expect(clearedCode).not.toContain('@rulerGuides');
    });

    it('rejects guides operation for non-existent file', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': SAMPLE_PAGE_A });
      await expect(
        guidesGetOperation.execute(snap, { filePath: 'app/ghost.tsx' }, context),
      ).rejects.toThrow(/does not exist/);

      await expect(
        guidesSetOperation.execute(
          snap,
          { filePath: 'app/ghost.tsx', horizontal: [10], vertical: [20] },
          context,
        ),
      ).rejects.toThrow(/does not exist/);
    });
  });
});
