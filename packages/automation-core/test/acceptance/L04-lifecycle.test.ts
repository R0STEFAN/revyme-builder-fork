// packages/automation-core/test/acceptance/L04-lifecycle.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import type { Snapshot } from '../../src/contracts';
import { createSnapshot, createOperationContext } from '../../src/session';
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
import { projectFS, MAIN_BRANCH_ID } from '@/code/project/project-fs';

const SAMPLE_PAGE_CLIENT = `'use client';
import React from 'react';

/** @canvas { "viewports": [ { "id": "desktop", "label": "Desktop", "width": 1200, "height": "auto", "isPrimary": true, "order": 0 } ], "positions": { "desktop": { "x": 0, "y": 0 } } } */

export default function HomePage() {
  return (
    <div data-id="root" style={{ width: '100%', minHeight: '100vh', padding: '24px' }}>
      <h1 data-id="headline" style={{ fontSize: '36px' }}>Original Production Baseline</h1>
      <p data-id="subtext">Initial stable release content.</p>
    </div>
  );
}
`;

const SAMPLE_LAYOUT = `'use client';
import React from 'react';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`;

describe('Acceptance Suite L04: Project Lifecycle, Branches, Merge, History & Rollback', () => {
  const context = createOperationContext();

  beforeEach(() => {
    projectFS.loadSnapshot(
      new Map([
        ['app/page.client.tsx', SAMPLE_PAGE_CLIENT],
        ['app/layout.tsx', SAMPLE_LAYOUT],
      ]),
    );
    projectFS.switchBranch(MAIN_BRANCH_ID);
    clearHistoryState();
  });

  it('executes the full end-to-end lifecycle: duplicate, backup export/restore, branching, review/merge, undo/redo, and failure recovery', async () => {
    const initialFiles = {
      'app/page.client.tsx': SAMPLE_PAGE_CLIENT,
      'app/layout.tsx': SAMPLE_LAYOUT,
    };
    let snapshot = createSnapshot({ projectId: 'prod-project', branchId: 'main' }, 1, initialFiles);

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 1: Project Duplication & Checksummed Backup Lifecycle
    // ─────────────────────────────────────────────────────────────────────────
    // 1a. Duplicate Project
    const dupRes = await projectsDuplicateOperation.execute(
      snapshot,
      { targetName: 'Production Clone Q4', folderId: 'fld-archive' },
      context,
    );
    expect(dupRes.originalProjectId).toBe('prod-project');
    expect(dupRes.newProjectId).toBeDefined();
    expect(dupRes.name).toBe('Production Clone Q4');
    expect(dupRes.folderId).toBe('fld-archive');
    expect(dupRes.fileCount).toBeGreaterThanOrEqual(2);

    // 1b. Backup Export
    const exportRes = await projectsBackupExportOperation.execute(
      snapshot,
      { includeBranches: true, compress: false },
      context,
    );
    expect(exportRes.projectId).toBe('prod-project');
    expect(exportRes.backupPayload).toBeDefined();
    const backupObj = JSON.parse(exportRes.backupPayload);
    expect(backupObj.version).toBe('revyme-backup-v1');
    expect(backupObj.files['app/page.client.tsx']).toBe(SAMPLE_PAGE_CLIENT);

    // 1c. Corrupted Payload Protection (Failure Rollback Guardrail)
    const corruptedPayload = JSON.stringify({
      ...backupObj,
      checksum: 'deadbeef00000000000000000000000000000000000000000000000000000000',
    });
    await expect(
      projectsBackupRestoreOperation.execute(snapshot, { backupPayload: corruptedPayload }, context),
    ).rejects.toThrow(/BACKUP_CHECKSUM_MISMATCH/);

    // 1d. Legitimate Backup Restore
    const restoreRes = await projectsBackupRestoreOperation.execute(
      snapshot,
      { backupPayload: exportRes.backupPayload },
      context,
    );
    expect(restoreRes.restoredFiles).toBeGreaterThanOrEqual(2);
    expect(restoreRes.revision).toBeGreaterThanOrEqual(2);
    expect(projectFS.readFile('app/page.client.tsx')).toBe(SAMPLE_PAGE_CLIENT);

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 2: Branch Creation, Staging Edits & Branch Switching
    // ─────────────────────────────────────────────────────────────────────────
    // 2a. Create feature branch 'feat-redesign'
    const branchCreate = await branchesCreateOperation.execute(
      snapshot,
      { name: 'feat-redesign' },
      context,
    );
    expect(branchCreate.branch).toBe('feat-redesign');
    expect(branchCreate.active).toBe(true);
    expect(projectFS.getActiveBranchId()).toBe('feat-redesign');

    // 2b. List branches
    const branchList = await branchesListOperation.execute(snapshot, {}, context);
    expect(branchList.active).toBe('feat-redesign');
    expect(branchList.branches.some((b) => b.id === 'feat-redesign' && b.active)).toBe(true);
    expect(branchList.branches.some((b) => b.id === 'main' && !b.active)).toBe(true);

    // 2c. Staging Edits on 'feat-redesign'
    const REDESIGNED_PAGE = SAMPLE_PAGE_CLIENT.replace(
      'Original Production Baseline',
      'Next Generation Experience',
    ).replace('36px', '52px');
    const NEW_COMPONENT_FILE = 'components/HeroBadge.tsx';
    const NEW_COMPONENT_CODE = `'use client';
export default function HeroBadge() {
  return <span data-id="hero-badge-tag" style={{ background: '#3b82f6', color: '#fff', padding: '4px 8px' }}>NEW</span>;
}
`;
    projectFS.writeFile('app/page.client.tsx', REDESIGNED_PAGE);
    projectFS.writeFile(NEW_COMPONENT_FILE, NEW_COMPONENT_CODE);

    // Verify branch isolation: switch back to main and verify clean state
    await branchesSwitchOperation.execute(snapshot, { branch: 'main' }, context);
    expect(projectFS.getActiveBranchId()).toBe('main');
    expect(projectFS.readFile('app/page.client.tsx')).toBe(SAMPLE_PAGE_CLIENT);
    expect(projectFS.readFile(NEW_COMPONENT_FILE)).toBeNull();

    // Switch back to 'feat-redesign'
    await branchesSwitchOperation.execute(snapshot, { branch: 'feat-redesign' }, context);
    expect(projectFS.getActiveBranchId()).toBe('feat-redesign');
    expect(projectFS.readFile('app/page.client.tsx')).toBe(REDESIGNED_PAGE);
    expect(projectFS.readFile(NEW_COMPONENT_FILE)).toBe(NEW_COMPONENT_CODE);

    // 2d. Guardrail: protected main branch cannot be deleted
    await expect(
      branchesDeleteOperation.execute(snapshot, { branch: 'main' }, context),
    ).rejects.toThrow(/Cannot delete protected branch/);

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 3: Branch Review (Diff) & Fast-Forward Apply (Merge)
    // ─────────────────────────────────────────────────────────────────────────
    // 3a. Review branch diff against main
    const reviewRes = await branchesReviewOperation.execute(
      snapshot,
      { branch: 'feat-redesign' },
      context,
    );
    expect(reviewRes.branch).toBe('feat-redesign');
    expect(reviewRes.mainMovedSince).toBe(false);

    const changedPage = reviewRes.files.find((f) => f.path === 'app/page.client.tsx');
    expect(changedPage?.status).toBe('changed');
    expect(changedPage?.changes.length).toBeGreaterThan(0);

    const addedComp = reviewRes.files.find((f) => f.path === NEW_COMPONENT_FILE);
    expect(addedComp?.status).toBe('added');

    // 3b. Apply / merge branch onto main
    const applyRes = await branchesApplyOperation.execute(
      snapshot,
      { branch: 'feat-redesign' },
      context,
    );
    expect(applyRes.applied).toBe(true);
    expect(applyRes.files).toContain('app/page.client.tsx');
    expect(applyRes.files).toContain(NEW_COMPONENT_FILE);

    // Verify main now has the merged changes
    expect(projectFS.getActiveBranchId()).toBe('main');
    const mergedPage = projectFS.readFile('app/page.client.tsx')!;
    expect(mergedPage).toContain('Next Generation Experience');
    const mergedBadge = projectFS.readFile(NEW_COMPONENT_FILE)!;
    expect(mergedBadge).toContain('HeroBadge');
    expect(mergedBadge).toContain('hero-badge-tag');

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 4: History Checkpoints, Undo & Redo Lifecycle
    // ─────────────────────────────────────────────────────────────────────────
    // 4a. Verify empty history stack initially
    const initUndo = await historyUndoOperation.execute(snapshot, {}, context);
    expect(initUndo.undone).toBe(false);
    expect(initUndo.changes).toEqual([]);

    // 4b. Perform an edit and record history step
    const PRE_EDIT = mergedPage;
    const POST_EDIT = PRE_EDIT.replace('Next Generation Experience', 'Hyper Speed Edition');
    projectFS.writeFile('app/page.client.tsx', POST_EDIT);
    recordHistoryStep('app/page.client.tsx', [
      { path: 'app/page.client.tsx', oldContent: PRE_EDIT, newContent: POST_EDIT },
    ]);

    let histStatus = getHistoryStatus();
    expect(histStatus.canUndo).toBe(true);
    expect(histStatus.undoCount).toBe(1);

    // 4c. Undo
    const undoRes = await historyUndoOperation.execute(snapshot, {}, context);
    expect(undoRes.undone).toBe(true);
    expect(projectFS.readFile('app/page.client.tsx')).toBe(PRE_EDIT);

    histStatus = getHistoryStatus();
    expect(histStatus.canUndo).toBe(false);
    expect(histStatus.canRedo).toBe(true);

    // 4d. Redo
    const redoRes = await historyRedoOperation.execute(snapshot, {}, context);
    expect(redoRes.redone).toBe(true);
    expect(projectFS.readFile('app/page.client.tsx')).toBe(POST_EDIT);

    // 4e. File creation history undo (removes file) and redo (restores file)
    const SCRATCH_FILE = 'app/scratch.tsx';
    const SCRATCH_CONTENT = 'export const scratch = 42;';
    projectFS.writeFile(SCRATCH_FILE, SCRATCH_CONTENT);
    recordHistoryStep(SCRATCH_FILE, [
      { path: SCRATCH_FILE, oldContent: null, newContent: SCRATCH_CONTENT },
    ]);

    const undoCreate = await historyUndoOperation.execute(snapshot, {}, context);
    expect(undoCreate.undone).toBe(true);
    expect(projectFS.readFile(SCRATCH_FILE)).toBeNull();

    const redoCreate = await historyRedoOperation.execute(snapshot, {}, context);
    expect(redoCreate.redone).toBe(true);
    expect(projectFS.readFile(SCRATCH_FILE)).toBe(SCRATCH_CONTENT);

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 5: Cleanup & Branch Deletion
    // ─────────────────────────────────────────────────────────────────────────
    const delRes = await branchesDeleteOperation.execute(
      snapshot,
      { branch: 'feat-redesign' },
      context,
    );
    expect(delRes.deleted).toBe(true);
    expect(projectFS.listBranches().some((b) => b.id === 'feat-redesign')).toBe(false);
    expect(projectFS.getActiveBranchId()).toBe('main');
  });
});
