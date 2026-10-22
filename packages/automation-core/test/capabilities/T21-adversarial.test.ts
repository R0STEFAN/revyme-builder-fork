// packages/automation-core/test/capabilities/T21-adversarial.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import type { Snapshot } from '../../src/contracts';
import { createSnapshot, createOperationContext } from '../../src/session';
import { defaultRegistry } from '../../src/registry';
import {
  projectsDuplicateOperation,
  projectsBackupExportOperation,
  projectsBackupRestoreOperation,
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

const VALID_PAGE = `'use client';
import React from 'react';

/** @canvas { "viewports": [ { "id": "desktop", "label": "Desktop", "width": 1200, "height": "auto", "isPrimary": true, "order": 0 } ], "positions": { "desktop": { "x": 0, "y": 0 } } } */

export default function Page() {
  return (
    <div data-id="root" style={{ position: 'relative', width: '100%', height: 'auto' }}>
      <button data-id="btn" style={{ padding: '8px 16px' }}>
        Click Me
      </button>
    </div>
  );
}
`;

const INVALID_PAGE_NO_ROOT = `'use client';
import React from 'react';

export default function BadPage() {
  return (
    <button data-id="btn" style={{ padding: '8px 16px' }}>
      No Root Div
    </button>
  );
}
`;

function createMockSnapshot(files: Record<string, string>, revision = 1): Snapshot {
  return createSnapshot({ projectId: 'test-project', branchId: 'main' }, revision, files);
}

describe('Adversarial Stress Test: Milestone T21 Integrity & Robustness', () => {
  const context = createOperationContext();

  beforeEach(() => {
    projectFS.loadSnapshot(
      new Map([
        ['app/page.client.tsx', VALID_PAGE],
        ['app/bad.client.tsx', INVALID_PAGE_NO_ROOT],
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

  describe('Adversarial Folders & Hierarchy Protection', () => {
    it('detects and rejects multi-level deep cycle moves (A -> B -> C -> D, move A into D)', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': VALID_PAGE });

      const fldA = await foldersCreateOperation.execute(
        snap,
        { kind: 'components', name: 'LevelA' },
        context,
      );
      const fldB = await foldersCreateOperation.execute(
        snap,
        { kind: 'components', name: 'LevelB', parentId: fldA.folderId },
        context,
      );
      const fldC = await foldersCreateOperation.execute(
        snap,
        { kind: 'components', name: 'LevelC', parentId: fldB.folderId },
        context,
      );
      const fldD = await foldersCreateOperation.execute(
        snap,
        { kind: 'components', name: 'LevelD', parentId: fldC.folderId },
        context,
      );

      // Attempt moving ancestor A into deep descendant D
      await expect(
        foldersMoveItemOperation.execute(
          snap,
          { kind: 'components', itemId: fldA.folderId, targetFolderId: fldD.folderId },
          context,
        ),
      ).rejects.toThrow(/Cycle detected/);

      // Attempt moving B into D
      await expect(
        foldersMoveItemOperation.execute(
          snap,
          { kind: 'components', itemId: fldB.folderId, targetFolderId: fldD.folderId },
          context,
        ),
      ).rejects.toThrow(/Cycle detected/);

      // Attempt moving C into D
      await expect(
        foldersMoveItemOperation.execute(
          snap,
          { kind: 'components', itemId: fldC.folderId, targetFolderId: fldD.folderId },
          context,
        ),
      ).rejects.toThrow(/Cycle detected/);

      // Moving D to root should succeed without cycle
      const moveRootRes = await foldersMoveItemOperation.execute(
        snap,
        { kind: 'components', itemId: fldD.folderId, targetFolderId: null },
        context,
      );
      expect(moveRootRes.targetFolderId).toBeNull();

      // Now moving A into D is valid since D is no longer a descendant of A!
      const moveAfterUntangle = await foldersMoveItemOperation.execute(
        snap,
        { kind: 'components', itemId: fldA.folderId, targetFolderId: fldD.folderId },
        context,
      );
      expect(moveAfterUntangle.targetFolderId).toBe(fldD.folderId);
    });

    it('rejects moving folder directly into itself', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': VALID_PAGE });
      const fld = await foldersCreateOperation.execute(
        snap,
        { kind: 'components', name: 'SelfRef' },
        context,
      );

      await expect(
        foldersMoveItemOperation.execute(
          snap,
          { kind: 'components', itemId: fld.folderId, targetFolderId: fld.folderId },
          context,
        ),
      ).rejects.toThrow(/into itself/i);
    });

    it('handles moving items across folders while maintaining item counts', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': VALID_PAGE });

      const fld1 = await foldersCreateOperation.execute(
        snap,
        { kind: 'components', name: 'Folder1' },
        context,
      );
      const fld2 = await foldersCreateOperation.execute(
        snap,
        { kind: 'components', name: 'Folder2' },
        context,
      );

      // Put item in folder 1
      await foldersMoveItemOperation.execute(
        snap,
        { kind: 'components', itemId: 'item-1', targetFolderId: fld1.folderId },
        context,
      );

      let list = await foldersListOperation.execute(snap, { kind: 'components' }, context);
      expect(list.folders.find((f) => f.id === fld1.folderId)?.count).toBe(1);
      expect(list.folders.find((f) => f.id === fld2.folderId)?.count).toBe(0);

      // Move item from folder 1 to folder 2
      await foldersMoveItemOperation.execute(
        snap,
        { kind: 'components', itemId: 'item-1', targetFolderId: fld2.folderId },
        context,
      );

      list = await foldersListOperation.execute(snap, { kind: 'components' }, context);
      expect(list.folders.find((f) => f.id === fld1.folderId)?.count).toBe(0);
      expect(list.folders.find((f) => f.id === fld2.folderId)?.count).toBe(1);
    });
  });

  describe('Adversarial Comments & Canvas/Node Anchoring', () => {
    it('supports canvas coordinates with negative and floating numbers and preserves node IDs', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': VALID_PAGE });

      const createRes = await commentsCreateOperation.execute(
        snap,
        {
          filePath: 'app/page.client.tsx',
          nodeId: 'node-complex-123',
          position: { x: -150.75, y: 320.5 },
          content: 'Float coordinate comment with node anchor',
          author: 'Automated Critic',
        },
        context,
      );

      expect(createRes.commentId).toBeDefined();

      const listRes = await commentsListOperation.execute(
        snap,
        { filePath: 'app/page.client.tsx' },
        context,
      );
      expect(listRes.comments.length).toBe(1);
      const comment = listRes.comments[0];
      expect(comment.nodeId).toBe('node-complex-123');
      expect(comment.position).toEqual({ x: -150.75, y: 320.5 });
      expect(comment.author).toBe('Automated Critic');
      expect(comment.resolved).toBe(false);

      // Toggle resolve to true then back to false
      await commentsResolveOperation.execute(
        snap,
        { commentId: createRes.commentId, resolved: true },
        context,
      );
      let afterResolve = await commentsListOperation.execute(snap, {}, context);
      expect(afterResolve.comments[0].resolved).toBe(true);

      await commentsResolveOperation.execute(
        snap,
        { commentId: createRes.commentId, resolved: false },
        context,
      );
      afterResolve = await commentsListOperation.execute(snap, {}, context);
      expect(afterResolve.comments[0].resolved).toBe(false);
    });

    it('enforces schema input validation on comments.create via defaultRegistry', () => {
      const emptyContentValidation = defaultRegistry.validateInput('comments.create', {
        filePath: 'app/page.client.tsx',
        content: '',
      });
      expect(emptyContentValidation.ok).toBe(false);
      if (!emptyContentValidation.ok) {
        expect(emptyContentValidation.issues.some((i) => i.path.includes('content'))).toBe(true);
      }

      const missingPathValidation = defaultRegistry.validateInput('comments.create', {
        filePath: '',
        content: 'Valid content',
      });
      expect(missingPathValidation.ok).toBe(false);
      if (!missingPathValidation.ok) {
        expect(missingPathValidation.issues.some((i) => i.path.includes('filePath'))).toBe(true);
      }
    });
  });

  describe('Adversarial Ruler Guides & AST Integration', () => {
    it('sorts arbitrary unordered numbers, preserves negative coordinates, and handles duplicates cleanly', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': VALID_PAGE });

      const setRes = await guidesSetOperation.execute(
        snap,
        {
          filePath: 'app/page.client.tsx',
          horizontal: [500, -100, 250, 0, 500],
          vertical: [1920, 1024, -50, 768],
        },
        context,
      );

      expect(setRes.count).toBe(9);

      const getRes = await guidesGetOperation.execute(
        snap,
        { filePath: 'app/page.client.tsx' },
        context,
      );

      expect(getRes.horizontal).toEqual([-100, 0, 250, 500, 500]);
      expect(getRes.vertical).toEqual([-50, 768, 1024, 1920]);
    });

    it('removes the @rulerGuides annotation entirely when guides are emptied', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': VALID_PAGE });

      await guidesSetOperation.execute(
        snap,
        { filePath: 'app/page.client.tsx', horizontal: [100], vertical: [200] },
        context,
      );
      expect(projectFS.readFile('app/page.client.tsx')).toContain('@rulerGuides');

      await guidesSetOperation.execute(
        snap,
        { filePath: 'app/page.client.tsx', horizontal: [], vertical: [] },
        context,
      );
      expect(projectFS.readFile('app/page.client.tsx')).not.toContain('@rulerGuides');
    });

    it('rejects guides set on malformed page via Oracle AST gate', async () => {
      const snap = createMockSnapshot({ 'app/bad.client.tsx': INVALID_PAGE_NO_ROOT });

      await expect(
        guidesSetOperation.execute(
          snap,
          { filePath: 'app/bad.client.tsx', horizontal: [100], vertical: [200] },
          context,
        ),
      ).rejects.toThrow(/ORACLE_VIOLATION/);
    });
  });

  describe('Adversarial Backup, Branches & History Integrity', () => {
    it('rejects corrupted base64 in compressed backup restore', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': VALID_PAGE });
      await expect(
        projectsBackupRestoreOperation.execute(
          snap,
          { backupPayload: 'not-valid-base64-gzip-payload!@#$' },
          context,
        ),
      ).rejects.toThrow();
    });

    it('rejects restoring payload with missing required version or files field', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': VALID_PAGE });
      const badPayload = JSON.stringify({ projectId: 'test', checksum: 'xyz' });
      await expect(
        projectsBackupRestoreOperation.execute(snap, { backupPayload: badPayload }, context),
      ).rejects.toThrow();
    });

    it('verifies multi-step undo and redo stack integrity with multiple files', async () => {
      const snap = createMockSnapshot({ 'app/page.client.tsx': VALID_PAGE });

      const file1 = 'app/page.client.tsx';
      const file2 = 'app/extra.client.tsx';

      const orig1 = projectFS.readFile(file1)!;
      projectFS.writeFile(file2, orig1);
      const orig2 = orig1;

      // Step 1: edit file 1
      projectFS.writeFile(file1, orig1 + '\n// edit 1');
      recordHistoryStep(file1, [{ path: file1, oldContent: orig1, newContent: orig1 + '\n// edit 1' }]);

      // Step 2: edit file 2
      projectFS.writeFile(file2, orig2 + '\n// edit 2');
      recordHistoryStep(file2, [{ path: file2, oldContent: orig2, newContent: orig2 + '\n// edit 2' }]);

      expect(getHistoryStatus().undoCount).toBe(2);

      // Undo step 2
      await historyUndoOperation.execute(snap, {}, context);
      expect(projectFS.readFile(file2)).toBe(orig2);
      expect(projectFS.readFile(file1)).toBe(orig1 + '\n// edit 1');

      // Undo step 1
      await historyUndoOperation.execute(snap, {}, context);
      expect(projectFS.readFile(file1)).toBe(orig1);

      // Redo step 1
      await historyRedoOperation.execute(snap, {}, context);
      expect(projectFS.readFile(file1)).toBe(orig1 + '\n// edit 1');

      // Redo step 2
      await historyRedoOperation.execute(snap, {}, context);
      expect(projectFS.readFile(file2)).toBe(orig2 + '\n// edit 2');
    });
  });
});
