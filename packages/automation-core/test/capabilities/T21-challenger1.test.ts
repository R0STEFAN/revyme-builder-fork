// packages/automation-core/test/capabilities/T21-challenger1.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
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
import { projectFS, MAIN_BRANCH_ID } from '@/code/project/project-fs';

const BASE_PAGE_TSX = `'use client';
import React from 'react';

/** @canvas { "viewports": [ { "id": "desktop", "label": "Desktop", "width": 1200, "height": "auto", "isPrimary": true, "order": 0 } ], "positions": { "desktop": { "x": 0, "y": 0 } } } */

export default function HomePage() {
  return (
    <div data-id="root" style={{ width: '100%', height: 'auto', padding: '24px' }}>
      <h1 data-id="title" style={{ fontSize: '32px' }}>Original Main Title</h1>
      <p data-id="desc">Stable baseline content for testing.</p>
    </div>
  );
}
`;

const ABOUT_PAGE_TSX = `'use client';
import React from 'react';

/** @canvas { "viewports": [ { "id": "desktop", "label": "Desktop", "width": 1200, "height": "auto", "isPrimary": true, "order": 0 } ], "positions": { "desktop": { "x": 0, "y": 0 } } } */

export default function AboutPage() {
  return (
    <div data-id="about-root" style={{ width: '100%', height: 'auto', padding: '16px' }}>
      <h2 data-id="about-heading">About Company</h2>
    </div>
  );
}
`;

function createMockSnapshot(files: Record<string, string>, revision = 1): Snapshot {
  return createSnapshot({ projectId: 'challenger-project', branchId: 'main' }, revision, files);
}

describe('T21 Empirical Challenger: Checksum, Branch Protections & Merge Conflict Resilience', () => {
  const context = createOperationContext();

  beforeEach(() => {
    projectFS.switchBranch(MAIN_BRANCH_ID);
    for (const b of projectFS.listBranches()) {
      if (b.id !== MAIN_BRANCH_ID) {
        projectFS.deleteBranch(b.id);
      }
    }
    projectFS.deleteFile('_meta/branches.json');
    projectFS.loadSnapshot(
      new Map([
        ['app/page.client.tsx', BASE_PAGE_TSX],
        ['app/about/page.client.tsx', ABOUT_PAGE_TSX],
        ['app/globals.css', 'body { margin: 0; font-family: sans-serif; }'],
      ]),
    );
    clearHistoryState();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. Checksum & Tampering Stress Tests
  // ═══════════════════════════════════════════════════════════════════════════
  describe('1. Checksum & Tampering Adversarial Challenges', () => {
    it('rejects backup payload when a file content is modified without updating checksum, preserving projectFS intact', async () => {
      const snap = createMockSnapshot({
        'app/page.client.tsx': BASE_PAGE_TSX,
        'app/about/page.client.tsx': ABOUT_PAGE_TSX,
      }, 10);

      const exported = await projectsBackupExportOperation.execute(snap, { compress: false }, context);
      const parsed = JSON.parse(exported.backupPayload);

      // Tamper: Modify 1 file's content slightly while leaving payload.checksum unchanged
      parsed.files['app/page.client.tsx'] = BASE_PAGE_TSX.replace('Original Main Title', 'Tampered Malicious Title');
      const tamperedPayload = JSON.stringify(parsed);

      // Prior state in projectFS before restore attempt
      const preRestoreContent = projectFS.readFile('app/page.client.tsx');

      await expect(
        projectsBackupRestoreOperation.execute(snap, { backupPayload: tamperedPayload }, context),
      ).rejects.toThrow(/BACKUP_CHECKSUM_MISMATCH/);

      // Atomic non-corruption: ProjectFS must be completely untouched
      expect(projectFS.readFile('app/page.client.tsx')).toBe(preRestoreContent);
      expect(projectFS.readFile('app/page.client.tsx')).not.toContain('Tampered Malicious Title');
    });

    it('rejects backup payload when checksum string is modified/corrupted, preserving projectFS intact', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': BASE_PAGE_TSX }, 1);
      const exported = await projectsBackupExportOperation.execute(snap, { compress: false }, context);
      const parsed = JSON.parse(exported.backupPayload);

      // Tamper: Flip the last hex character in the checksum
      const lastChar = parsed.checksum.slice(-1);
      const flippedChar = lastChar === 'a' ? 'b' : 'a';
      parsed.checksum = parsed.checksum.slice(0, -1) + flippedChar;
      const corruptedChecksumPayload = JSON.stringify(parsed);

      await expect(
        projectsBackupRestoreOperation.execute(snap, { backupPayload: corruptedChecksumPayload }, context),
      ).rejects.toThrow(/BACKUP_CHECKSUM_MISMATCH/);
    });

    it('rejects backup payload with an unauthorized injected file retaining old checksum', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': BASE_PAGE_TSX }, 2);
      const exported = await projectsBackupExportOperation.execute(snap, { compress: false }, context);
      const parsed = JSON.parse(exported.backupPayload);

      // Tamper: Inject an extra file into the dictionary without updating checksum
      parsed.files['app/malicious.js'] = 'process.exit(1);';
      const injectedPayload = JSON.stringify(parsed);

      await expect(
        projectsBackupRestoreOperation.execute(snap, { backupPayload: injectedPayload }, context),
      ).rejects.toThrow(/BACKUP_CHECKSUM_MISMATCH/);

      // Ensure injected file was NOT written to projectFS
      expect(projectFS.readFile('app/malicious.js')).toBeNull();
    });

    it('rejects backup payload with a deleted file retaining old checksum', async () => {
      const snap = createMockSnapshot({
        'app/page.client.tsx': BASE_PAGE_TSX,
        'app/about/page.client.tsx': ABOUT_PAGE_TSX,
      }, 3);
      const exported = await projectsBackupExportOperation.execute(snap, { compress: false }, context);
      const parsed = JSON.parse(exported.backupPayload);

      // Tamper: Delete about page from payload files without updating checksum
      delete parsed.files['app/about/page.client.tsx'];
      const tamperedPayload = JSON.stringify(parsed);

      await expect(
        projectsBackupRestoreOperation.execute(snap, { backupPayload: tamperedPayload }, context),
      ).rejects.toThrow(/BACKUP_CHECKSUM_MISMATCH/);

      // Ensure projectFS still has about page intact
      expect(projectFS.readFile('app/about/page.client.tsx')).toBe(ABOUT_PAGE_TSX);
    });

    it('rejects corrupted compressed (gzip base64) payload with INVALID_BACKUP_PAYLOAD', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': BASE_PAGE_TSX }, 1);
      const exported = await projectsBackupExportOperation.execute(snap, { compress: true }, context);

      // Corrupt base64 gzip payload by injecting invalid characters into the stream
      const corruptedBase64 = exported.backupPayload.slice(0, 15) + '!!!CORRUPTED!!!' + exported.backupPayload.slice(30);

      await expect(
        projectsBackupRestoreOperation.execute(snap, { backupPayload: corruptedBase64 }, context),
      ).rejects.toThrow(/INVALID_BACKUP_PAYLOAD/);
    });

    it('rejects malformed JSON string with INVALID_BACKUP_PAYLOAD', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': BASE_PAGE_TSX }, 1);
      const malformedJson = '{"version": "revyme-backup-v1", "files": { "app/page.client.tsx": "broken...';

      await expect(
        projectsBackupRestoreOperation.execute(snap, { backupPayload: malformedJson }, context),
      ).rejects.toThrow(/INVALID_BACKUP_PAYLOAD/);
    });

    it('rejects payloads where files dictionary is missing or null with INVALID_BACKUP_PAYLOAD', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': BASE_PAGE_TSX }, 1);
      const invalidPayload = JSON.stringify({
        version: 'revyme-backup-v1',
        projectId: 'test-proj',
        revision: 1,
        // files is deliberately missing
      });

      await expect(
        projectsBackupRestoreOperation.execute(snap, { backupPayload: invalidPayload }, context),
      ).rejects.toThrow(/INVALID_BACKUP_PAYLOAD: Missing or invalid "files" dictionary/);
    });

    it('rejects empty or whitespace-only backup payload', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': BASE_PAGE_TSX }, 1);

      await expect(
        projectsBackupRestoreOperation.execute(snap, { backupPayload: '   ' }, context),
      ).rejects.toThrow();
    });

    it('verifies calculateFilesChecksum produces deterministic hash regardless of object key order', () => {
      const filesA: Record<string, string> = {
        'b.txt': 'second',
        'a.txt': 'first',
        'z.txt': 'last',
      };

      const filesB: Record<string, string> = {
        'z.txt': 'last',
        'a.txt': 'first',
        'b.txt': 'second',
      };

      const checksumA = calculateFilesChecksum(filesA);
      const checksumB = calculateFilesChecksum(filesB);
      expect(checksumA).toBe(checksumB);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. Branch Protections Adversarial Challenges
  // ═══════════════════════════════════════════════════════════════════════════
  describe('2. Branch Protections Adversarial Challenges', () => {
    it('strictly refuses deleting protected branch main and keeps main intact', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': BASE_PAGE_TSX });

      await expect(
        branchesDeleteOperation.execute(snap, { branch: 'main' }, context),
      ).rejects.toThrow(/Cannot delete protected branch "main"/i);

      // Verify main still exists in projectFS
      const branches = projectFS.listBranches();
      expect(branches.some((b) => b.id === MAIN_BRANCH_ID)).toBe(true);
      expect(projectFS.getActiveBranchId()).toBe(MAIN_BRANCH_ID);
    });

    it('refuses deleting main even if supplied with whitespace around name', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': BASE_PAGE_TSX });

      await expect(
        branchesDeleteOperation.execute(snap, { branch: '  main  ' }, context),
      ).rejects.toThrow(/Cannot delete protected branch "main"/i);
    });

    it('switches active pointer to main when deleting the currently active branch', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': BASE_PAGE_TSX });

      // Create branch and verify it is active
      const createRes = await branchesCreateOperation.execute(snap, { name: 'feature-active-del' }, context);
      expect(createRes.branch).toBe('feature-active-del');
      expect(projectFS.getActiveBranchId()).toBe('feature-active-del');

      // Delete the active branch
      const deleteRes = await branchesDeleteOperation.execute(snap, { branch: 'feature-active-del' }, context);
      expect(deleteRes.deleted).toBe(true);

      // Verify pointer reverted cleanly to main
      expect(projectFS.getActiveBranchId()).toBe(MAIN_BRANCH_ID);
      expect(projectFS.listBranches().some((b) => b.id === 'feature-active-del')).toBe(false);

      // Verify _meta/branches.json also recorded activeBranchId as main
      const meta = JSON.parse(projectFS.readFile('_meta/branches.json') || '{}');
      expect(meta.activeBranchId).toBe(MAIN_BRANCH_ID);
    });

    it('resets active pointer specifically to main when active branch is deleted among multiple branches', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': BASE_PAGE_TSX });

      // Create branch A
      await branchesCreateOperation.execute(snap, { name: 'branch-alpha' }, context);
      // Create branch B (which becomes active)
      await branchesCreateOperation.execute(snap, { name: 'branch-beta' }, context);
      expect(projectFS.getActiveBranchId()).toBe('branch-beta');

      // Delete active branch B
      await branchesDeleteOperation.execute(snap, { branch: 'branch-beta' }, context);

      // Active branch MUST revert to main, NOT to branch-alpha
      expect(projectFS.getActiveBranchId()).toBe(MAIN_BRANCH_ID);
      expect(projectFS.listBranches().some((b) => b.id === 'branch-alpha')).toBe(true);
      expect(projectFS.listBranches().some((b) => b.id === 'branch-beta')).toBe(false);
    });

    it('rejects deleting non-existent branch with Unknown branch error', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': BASE_PAGE_TSX });

      await expect(
        branchesDeleteOperation.execute(snap, { branch: 'non-existent-branch' }, context),
      ).rejects.toThrow(/Unknown branch "non-existent-branch"/i);
    });

    it('refuses creating a branch named main or case-insensitive / normalized variants', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': BASE_PAGE_TSX });

      await expect(
        branchesCreateOperation.execute(snap, { name: 'main' }, context),
      ).rejects.toThrow(/protected/i);

      await expect(
        branchesCreateOperation.execute(snap, { name: 'MAIN' }, context),
      ).rejects.toThrow(/protected/i);

      await expect(
        branchesCreateOperation.execute(snap, { name: '  main  ' }, context),
      ).rejects.toThrow(/protected/i);
    });

    it('refuses creating duplicate branches with same normalized ID', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': BASE_PAGE_TSX });

      await branchesCreateOperation.execute(snap, { name: 'my-feature' }, context);

      await expect(
        branchesCreateOperation.execute(snap, { name: 'my-feature' }, context),
      ).rejects.toThrow(/already exists/i);

      // Even with different casing that normalizes to same ID
      await expect(
        branchesCreateOperation.execute(snap, { name: 'My-Feature' }, context),
      ).rejects.toThrow(/already exists/i);
    });

    it('refuses switching to unknown branch, preserving current active branch pointer', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': BASE_PAGE_TSX });

      const currentActive = projectFS.getActiveBranchId();

      await expect(
        branchesSwitchOperation.execute(snap, { branch: 'ghost-branch-id' }, context),
      ).rejects.toThrow(/Unknown branch "ghost-branch-id"/i);

      expect(projectFS.getActiveBranchId()).toBe(currentActive);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. Merge Conflict Resilience & Atomic Non-Corruption
  // ═══════════════════════════════════════════════════════════════════════════
  describe('3. Merge Conflict Resilience & Atomic Non-Corruption', () => {
    it('halts on 3-way merge conflict without corrupting main branch content', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': BASE_PAGE_TSX });

      // 1. Create a feature branch from main
      await branchesCreateOperation.execute(snap, { name: 'conflict-worker' }, context);
      expect(projectFS.getActiveBranchId()).toBe('conflict-worker');

      // 2. On the feature branch, modify the title line
      const branchEditedCode = BASE_PAGE_TSX.replace(
        'Original Main Title',
        'Title Altered On Feature Branch',
      );
      projectFS.writeFile('app/page.client.tsx', branchEditedCode);

      // 3. Switch back to main
      await branchesSwitchOperation.execute(snap, { branch: MAIN_BRANCH_ID }, context);
      expect(projectFS.getActiveBranchId()).toBe(MAIN_BRANCH_ID);

      // 4. On main, concurrently modify the EXACT same title line differently
      const mainEditedCode = BASE_PAGE_TSX.replace(
        'Original Main Title',
        'Title Concurrently Altered On Main',
      );
      projectFS.writeFile('app/page.client.tsx', mainEditedCode);

      // 5. Review branch against main: should detect drift
      const reviewRes = await branchesReviewOperation.execute(snap, { branch: 'conflict-worker' }, context);
      expect(reviewRes.mainMovedSince).toBe(true);
      expect(reviewRes.mainChanged).toContain('app/page.client.tsx');

      // 6. Attempt to apply the branch: MUST halt with conflict error
      await expect(
        branchesApplyOperation.execute(snap, { branch: 'conflict-worker' }, context),
      ).rejects.toThrow(/Merge conflict in app\/page\.client\.tsx/i);

      // 7. EMPIRICAL NON-CORRUPTION VERIFICATION:
      // Verify main branch content is EXACTLY the mainEditedCode, without conflict markers or corruption
      const contentOnMainAfterFailedApply = projectFS.readFile('app/page.client.tsx');
      expect(contentOnMainAfterFailedApply).toBe(mainEditedCode);
      expect(contentOnMainAfterFailedApply).toContain('Title Concurrently Altered On Main');
      expect(contentOnMainAfterFailedApply).not.toContain('Title Altered On Feature Branch');
      expect(contentOnMainAfterFailedApply).not.toContain('<<<<<<<');
      expect(contentOnMainAfterFailedApply).not.toContain('>>>>>>>');

      // Branch status in projectFS is now 'conflict'
      const branchInfo = projectFS.listBranches().find((b) => b.id === 'conflict-worker');
      expect(branchInfo?.status).toBe('conflict');
    });

    it('halts and rolls back without corrupting main when merged branch fails Oracle gate', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': BASE_PAGE_TSX });

      // Create branch
      await branchesCreateOperation.execute(snap, { name: 'bad-syntax-branch' }, context);

      // Write invalid code (missing closing tag / syntax error)
      const invalidCode = `'use client';
import React from 'react';
export default function BrokenPage() {
  return (
    <div data-id="root">
      <h1>Unclosed tag
    </div>
  );
}`;
      projectFS.writeFile('app/page.client.tsx', invalidCode);

      // Switch back to main
      await branchesSwitchOperation.execute(snap, { branch: MAIN_BRANCH_ID }, context);
      const preApplyMainCode = projectFS.readFile('app/page.client.tsx');

      // Attempt to apply branch with broken syntax
      await expect(
        branchesApplyOperation.execute(snap, { branch: 'bad-syntax-branch' }, context),
      ).rejects.toThrow(/Branch apply refused|fails the oracle gate/i);

      // Main MUST remain completely uncorrupted
      expect(projectFS.readFile('app/page.client.tsx')).toBe(preApplyMainCode);
      expect(projectFS.readFile('app/page.client.tsx')).toContain('Original Main Title');
    });

    it('strictly rejects applying main branch to itself', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': BASE_PAGE_TSX });
      projectFS.switchBranch(MAIN_BRANCH_ID);

      await expect(
        branchesApplyOperation.execute(snap, { branch: MAIN_BRANCH_ID }, context),
      ).rejects.toThrow(/Cannot apply main to itself/i);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. Multi-Branch & History Isolation Stress Tests
  // ═══════════════════════════════════════════════════════════════════════════
  describe('4. Multi-Branch & History Isolation Stress Tests', () => {
    it('exports and restores branches in full round-trip when restoreBranches is true', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': BASE_PAGE_TSX });

      // Create branch feature-one
      await branchesCreateOperation.execute(snap, { name: 'feature-one' }, context);
      projectFS.writeFile('app/feature.txt', 'Feature One Content');

      // Export with branches
      // Headless export receives the project envelope explicitly, never via the editor singleton.
      snap.branches = projectFS.toEnvelope().branches;
      const exported = await projectsBackupExportOperation.execute(
        snap,
        { includeBranches: true, compress: false },
        context,
      );

      const parsed = JSON.parse(exported.backupPayload);
      expect(parsed.branches).toBeDefined();
      expect(parsed.branches['feature-one']).toBeDefined();

      // Clear projectFS branches
      projectFS.switchBranch(MAIN_BRANCH_ID);
      projectFS.deleteBranch('feature-one');
      expect(projectFS.listBranches().some((b) => b.id === 'feature-one')).toBe(false);

      // Restore backup with restoreBranches = true
      const restored = await projectsBackupRestoreOperation.execute(
        snap,
        { backupPayload: exported.backupPayload, restoreBranches: true },
        context,
      );

      expect(restored.branchCount).toBeGreaterThanOrEqual(1);
      expect(projectFS.listBranches().some((b) => b.id === 'feature-one')).toBe(true);
    });

    it('preserves untracked files in projectFS when cleanOrphanFiles is false', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': BASE_PAGE_TSX }, 1);
      const exported = await projectsBackupExportOperation.execute(snap, {}, context);

      // Add an untracked file to projectFS that is NOT in the backup
      projectFS.writeFile('app/untracked.log', 'local debug logs');

      // Restore with cleanOrphanFiles = false
      const restored = await projectsBackupRestoreOperation.execute(
        snap,
        { backupPayload: exported.backupPayload, cleanOrphanFiles: false },
        context,
      );

      // In FileChange diffs: no deletion change was emitted for untracked.log
      const deletedChange = restored.changes.find((c) => c.path === 'app/untracked.log');
      expect(deletedChange).toBeUndefined();

      // Untracked file must be preserved in projectFS when cleanOrphanFiles: false
      const fileOnDisk = projectFS.readFile('app/untracked.log');
      expect(fileOnDisk).toBe('local debug logs');
    });

    it('isolates history across branches: branches.create resets _meta/history.json', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': BASE_PAGE_TSX });

      // Record an undo step on main
      recordHistoryStep('app/page.client.tsx', [
        { path: 'app/page.client.tsx', oldContent: BASE_PAGE_TSX, newContent: BASE_PAGE_TSX + '\n// edited on main' },
      ]);
      expect(getHistoryStatus().canUndo).toBe(true);

      // Create a new branch
      await branchesCreateOperation.execute(snap, { name: 'work-branch' }, context);

      // Verify history is isolated: canUndo is false because branches.create cleared _meta/history.json
      const statusAfterBranch = getHistoryStatus();
      expect(statusAfterBranch.canUndo).toBe(false);
    });
  });
});
