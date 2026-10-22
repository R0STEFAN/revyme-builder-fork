// packages/automation-core/test/capabilities/T21-challenger2.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import type { Snapshot } from '../../src/contracts';
import { createSnapshot, createOperationContext } from '../../src/session';
import { defaultRegistry } from '../../src/registry';
import {
  foldersListOperation,
  foldersCreateOperation,
  foldersMoveItemOperation,
  type FolderKind,
} from '../../src/operations/folders';
import {
  historyUndoOperation,
  historyRedoOperation,
  recordHistoryStep,
  clearHistoryState,
  getHistoryStatus,
  loadHistoryState,
} from '../../src/operations/history';
import {
  guidesGetOperation,
  guidesSetOperation,
} from '../../src/operations/guides';
import { projectFS, MAIN_BRANCH_ID } from '@/code/project/project-fs';

const VALID_PAGE_JSX = `'use client';
import React from 'react';

/** @canvas { "viewports": [ { "id": "desktop", "label": "Desktop", "width": 1200, "height": "auto", "isPrimary": true, "order": 0 } ], "positions": { "desktop": { "x": 0, "y": 0 } } } */

export default function ValidPage() {
  return (
    <div data-id="root" style={{ width: '100%', height: 'auto', padding: '24px' }}>
      <h1 data-id="title" style={{ fontSize: '32px' }}>Adversarial Challenge Page</h1>
      <p data-id="desc">Testing T21 edge cases and stress limits.</p>
    </div>
  );
}
`;

const SYNTAX_ERROR_PAGE_JSX = `'use client';
import React from 'react';

export default function BrokenPage( {
  return (
    <div data-id="root" style={{ width: '100%' }}>
      <h1>Unclosed tag
  );
}
`;

const DIALECT_VIOLATION_PAGE_JSX = `'use client';
import React from 'react';

/** @canvas { "viewports": [ { "id": "desktop", "label": "Desktop", "width": 1200, "height": "auto", "isPrimary": true, "order": 0 } ], "positions": { "desktop": { "x": 0, "y": 0 } } } */

export default function DialectViolationPage() {
  return (
    <div data-id="root" style={{ width: '100%', minHeight: '100vh', padding: '24px' }}>
      <h1 data-id="title" style={{ fontSize: '32px' }}>Disallowed Viewport Units</h1>
    </div>
  );
}
`;

const TEST_PAGE = 'app/ch2/page.client.tsx';

function createMockSnapshot(files: Record<string, string>, revision = 1): Snapshot {
  return createSnapshot({ projectId: 'test-adversarial-t21', branchId: 'main' }, revision, files);
}

describe('T21 Challenger 2: Adversarial Stress Tests (Folders, History, Guides)', () => {
  const context = createOperationContext();

  beforeEach(() => {
    projectFS.writeFile(TEST_PAGE, VALID_PAGE_JSX);
    projectFS.writeFile('app/ch2/blog/page.client.tsx', VALID_PAGE_JSX);
    projectFS.writeFile('app/ch2/blog/tech/page.client.tsx', VALID_PAGE_JSX);
    projectFS.writeFile('app/ch2/catalog/page.client.tsx', VALID_PAGE_JSX);
    projectFS.writeFile('app/ch2/cataloging/page.client.tsx', VALID_PAGE_JSX);
    clearHistoryState();
  });

  // ===========================================================================
  // 1. Folder Ancestor Cycle Prevention & Hierarchy Stress
  // ===========================================================================
  describe('1. Folder Ancestor Cycle Prevention & Hierarchy Stress', () => {
    const kinds: FolderKind[] = ['components', 'templates', 'vectors', 'plugins', 'presets'];

    for (const kind of kinds) {
      it(`[${kind}] rejects moving folder into itself`, async () => {
        const snap = createMockSnapshot({ [TEST_PAGE]: VALID_PAGE_JSX });
        const folder = await foldersCreateOperation.execute(
          snap,
          { kind, name: `Root-${kind}` },
          context,
        );

        await expect(
          foldersMoveItemOperation.execute(
            snap,
            { kind, itemId: folder.folderId, targetFolderId: folder.folderId },
            context,
          ),
        ).rejects.toThrow(/Cycle detected.*Cannot move folder.*into itself/i);
      });

      it(`[${kind}] rejects moving parent into direct child`, async () => {
        const snap = createMockSnapshot({ [TEST_PAGE]: VALID_PAGE_JSX });
        const parent = await foldersCreateOperation.execute(
          snap,
          { kind, name: `Parent-${kind}` },
          context,
        );
        const child = await foldersCreateOperation.execute(
          snap,
          { kind, name: `Child-${kind}`, parentId: parent.folderId },
          context,
        );

        await expect(
          foldersMoveItemOperation.execute(
            snap,
            { kind, itemId: parent.folderId, targetFolderId: child.folderId },
            context,
          ),
        ).rejects.toThrow(/Cycle detected.*descendant/i);
      });
    }

    it('rejects cycle in a 5-level deep descendant hierarchy', async () => {
      const snap = createMockSnapshot({ [TEST_PAGE]: VALID_PAGE_JSX });
      const kind: FolderKind = 'components';

      const l1 = await foldersCreateOperation.execute(snap, { kind, name: 'Level1' }, context);
      const l2 = await foldersCreateOperation.execute(snap, { kind, name: 'Level2', parentId: l1.folderId }, context);
      const l3 = await foldersCreateOperation.execute(snap, { kind, name: 'Level3', parentId: l2.folderId }, context);
      const l4 = await foldersCreateOperation.execute(snap, { kind, name: 'Level4', parentId: l3.folderId }, context);
      const l5 = await foldersCreateOperation.execute(snap, { kind, name: 'Level5', parentId: l4.folderId }, context);

      // Attempt moving L1 into deep descendant L5 (4 hops down)
      await expect(
        foldersMoveItemOperation.execute(
          snap,
          { kind, itemId: l1.folderId, targetFolderId: l5.folderId },
          context,
        ),
      ).rejects.toThrow(/Cycle detected.*descendant/i);

      // Attempt moving L2 into L4 (2 hops down)
      await expect(
        foldersMoveItemOperation.execute(
          snap,
          { kind, itemId: l2.folderId, targetFolderId: l4.folderId },
          context,
        ),
      ).rejects.toThrow(/Cycle detected.*descendant/i);

      // Attempt moving L3 into L5 (2 hops down)
      await expect(
        foldersMoveItemOperation.execute(
          snap,
          { kind, itemId: l3.folderId, targetFolderId: l5.folderId },
          context,
        ),
      ).rejects.toThrow(/Cycle detected.*descendant/i);

      // Attempt moving L4 into L5 (1 hop down)
      await expect(
        foldersMoveItemOperation.execute(
          snap,
          { kind, itemId: l4.folderId, targetFolderId: l5.folderId },
          context,
        ),
      ).rejects.toThrow(/Cycle detected.*descendant/i);

      // Valid upward moves: moving leaf L5 into L1 directly (not descendant)
      const moveUpRes = await foldersMoveItemOperation.execute(
        snap,
        { kind, itemId: l5.folderId, targetFolderId: l1.folderId },
        context,
      );
      expect(moveUpRes.targetFolderId).toBe(l1.folderId);

      // Valid move to root
      const moveRootRes = await foldersMoveItemOperation.execute(
        snap,
        { kind, itemId: l5.folderId, targetFolderId: null },
        context,
      );
      expect(moveRootRes.targetFolderId).toBeNull();
    });

    it('rejects cyclic folder moves for page folders and distinguishes prefix siblings', async () => {
      const snap = createMockSnapshot({ [TEST_PAGE]: VALID_PAGE_JSX });

      // Moving 'app/blog' into itself
      await expect(
        foldersMoveItemOperation.execute(
          snap,
          { kind: 'pages', itemId: 'app/blog', targetFolderId: 'app/blog' },
          context,
        ),
      ).rejects.toThrow(/Cycle detected/i);

      // Moving 'app/blog' into descendant 'app/blog/tech'
      await expect(
        foldersMoveItemOperation.execute(
          snap,
          { kind: 'pages', itemId: 'app/blog', targetFolderId: 'app/blog/tech' },
          context,
        ),
      ).rejects.toThrow(/Cycle detected/i);

      // Moving 'app/catalog' into 'app/cataloging' (sibling sharing prefix without trailing slash)
      // This is NOT a descendant and should not be detected as cycle
      const res = await foldersMoveItemOperation.execute(
        snap,
        { kind: 'pages', itemId: 'app/catalog', targetFolderId: 'app/cataloging' },
        context,
      );
      expect(res.targetFolderId).toBe('app/cataloging');
    });

    it('rejects moving folder or item into non-existent target folder', async () => {
      const snap = createMockSnapshot({ [TEST_PAGE]: VALID_PAGE_JSX });
      await expect(
        foldersMoveItemOperation.execute(
          snap,
          { kind: 'components', itemId: 'components/Button.tsx', targetFolderId: 'fld-does-not-exist' },
          context,
        ),
      ).rejects.toThrow(/Target folder "fld-does-not-exist" does not exist/i);
    });

    it('rejects folder creation with empty, whitespace-only name or invalid parent', async () => {
      const snap = createMockSnapshot({ [TEST_PAGE]: VALID_PAGE_JSX });

      await expect(
        foldersCreateOperation.execute(snap, { kind: 'components', name: '' }, context),
      ).rejects.toThrow();

      await expect(
        foldersCreateOperation.execute(snap, { kind: 'components', name: '    \t\n  ' }, context),
      ).rejects.toThrow(/VALIDATION_ERROR/);

      await expect(
        foldersCreateOperation.execute(
          snap,
          { kind: 'components', name: 'ValidName', parentId: 'fld-missing' },
          context,
        ),
      ).rejects.toThrow(/Parent folder "fld-missing" does not exist/i);
    });
  });

  // ===========================================================================
  // 2. History Stack Limits & Boundary Stress
  // ===========================================================================
  describe('2. History Stack Limits & Boundary Stress', () => {
    it('returns undone: false when undo stack is empty without throwing', async () => {
      const snap = createMockSnapshot({ [TEST_PAGE]: VALID_PAGE_JSX });
      clearHistoryState();

      const res = await historyUndoOperation.execute(snap, {}, context);
      expect(res).toEqual({
        undone: false,
        activeFile: '',
        changes: [],
      });
    });

    it('returns redone: false when redo stack is empty without throwing', async () => {
      const snap = createMockSnapshot({ [TEST_PAGE]: VALID_PAGE_JSX });
      clearHistoryState();

      const res = await historyRedoOperation.execute(snap, {}, context);
      expect(res).toEqual({
        redone: false,
        activeFile: '',
        changes: [],
      });
    });

    it('strictly caps undo stack at 100 entries when pushing >100 steps', async () => {
      const snap = createMockSnapshot({ [TEST_PAGE]: VALID_PAGE_JSX });
      clearHistoryState();

      // Push 150 history steps
      for (let i = 1; i <= 150; i++) {
        const oldContent = `// step ${i - 1}`;
        const newContent = `// step ${i}`;
        projectFS.writeFile(TEST_PAGE, newContent);
        recordHistoryStep(TEST_PAGE, [
          { path: TEST_PAGE, oldContent, newContent },
        ]);
      }

      const status = getHistoryStatus();
      expect(status.canUndo).toBe(true);
      expect(status.canRedo).toBe(false);
      // Queue bound verification: must be capped at 100, not 150
      expect(status.undoCount).toBe(100);

      const savedState = loadHistoryState();
      expect(savedState.undoStack.length).toBe(100);
      // The oldest entries (1..50) were evicted; first remaining is step 51
      expect(savedState.undoStack[0].diffs[0].newContent).toBe('// step 51');
      expect(savedState.undoStack[99].diffs[0].newContent).toBe('// step 150');

      // Now undo all 100 entries in sequence
      for (let step = 100; step >= 1; step--) {
        const undoRes = await historyUndoOperation.execute(snap, {}, context);
        expect(undoRes.undone).toBe(true);
      }

      // After 100 undos, undo stack is empty and redo stack has 100 entries
      const afterStatus = getHistoryStatus();
      expect(afterStatus.undoCount).toBe(0);
      expect(afterStatus.canUndo).toBe(false);
      expect(afterStatus.redoCount).toBe(100);
      expect(afterStatus.canRedo).toBe(true);

      // The 101st undo must return undone: false
      const overUndoRes = await historyUndoOperation.execute(snap, {}, context);
      expect(overUndoRes.undone).toBe(false);

      // Redo all 100 entries in sequence
      for (let step = 1; step <= 100; step++) {
        const redoRes = await historyRedoOperation.execute(snap, {}, context);
        expect(redoRes.redone).toBe(true);
      }

      const endStatus = getHistoryStatus();
      expect(endStatus.undoCount).toBe(100);
      expect(endStatus.redoCount).toBe(0);

      // The 101st redo must return redone: false
      const overRedoRes = await historyRedoOperation.execute(snap, {}, context);
      expect(overRedoRes.redone).toBe(false);
    });

    it('clears redo stack upon recording a new history step', async () => {
      const snap = createMockSnapshot({ [TEST_PAGE]: VALID_PAGE_JSX });
      clearHistoryState();

      // Record 10 steps
      for (let i = 1; i <= 10; i++) {
        recordHistoryStep(TEST_PAGE, [
          { path: TEST_PAGE, oldContent: `v${i - 1}`, newContent: `v${i}` },
        ]);
      }

      // Undo 4 steps -> redoCount becomes 4, undoCount becomes 6
      for (let i = 0; i < 4; i++) {
        await historyUndoOperation.execute(snap, {}, context);
      }
      expect(getHistoryStatus().redoCount).toBe(4);
      expect(getHistoryStatus().undoCount).toBe(6);

      // Record a new fork step -> redo stack must be wiped
      recordHistoryStep(TEST_PAGE, [
        { path: TEST_PAGE, oldContent: 'v6', newContent: 'v6-forked' },
      ]);

      const statusAfterNewAction = getHistoryStatus();
      expect(statusAfterNewAction.redoCount).toBe(0);
      expect(statusAfterNewAction.canRedo).toBe(false);
      expect(statusAfterNewAction.undoCount).toBe(7);
    });

    it('correctly handles multi-file atomic batch undo and redo', async () => {
      const fileA = TEST_PAGE;
      const fileB = 'app/extra-temp.tsx';
      const fileC = 'app/created.tsx';

      const contentAOriginal = projectFS.readFile(fileA)!;
      const contentBOriginal = 'export const temp = true;';

      projectFS.writeFile(fileB, contentBOriginal);

      const contentAModified = contentAOriginal + '\n// mod A';
      const contentCNew = 'export const c = 42;';

      // Record batch mutation: modify A, delete B, create C
      projectFS.writeFile(fileA, contentAModified);
      projectFS.deleteFile(fileB);
      projectFS.writeFile(fileC, contentCNew);

      recordHistoryStep(fileA, [
        { path: fileA, oldContent: contentAOriginal, newContent: contentAModified },
        { path: fileB, oldContent: contentBOriginal, newContent: null },
        { path: fileC, oldContent: null, newContent: contentCNew },
      ]);

      expect(projectFS.readFile(fileA)).toBe(contentAModified);
      expect(projectFS.readFile(fileB)).toBeNull();
      expect(projectFS.readFile(fileC)).toBe(contentCNew);

      // Snapshot for post-mutation state
      const snap = createMockSnapshot({});

      // Undo batch
      const undoRes = await historyUndoOperation.execute(snap, {}, context);
      expect(undoRes.undone).toBe(true);
      expect(undoRes.changes.length).toBe(3);

      expect(projectFS.readFile(fileA)).toBe(contentAOriginal);
      expect(projectFS.readFile(fileB)).toBe(contentBOriginal);
      expect(projectFS.readFile(fileC)).toBeNull();

      // Redo batch
      const redoRes = await historyRedoOperation.execute(snap, {}, context);
      expect(redoRes.redone).toBe(true);
      expect(redoRes.changes.length).toBe(3);

      expect(projectFS.readFile(fileA)).toBe(contentAModified);
      expect(projectFS.readFile(fileB)).toBeNull();
      expect(projectFS.readFile(fileC)).toBe(contentCNew);
    });
  });

  // ===========================================================================
  // 3. Ruler Guides AST Resilience & Oracle Gate
  // ===========================================================================
  describe('3. Ruler Guides AST Resilience & Oracle Gate', () => {
    it('rejects guides.set on file with invalid TSX syntax via Oracle gate tier 1', async () => {
      const snap = createMockSnapshot({
        'app/broken/page.client.tsx': SYNTAX_ERROR_PAGE_JSX,
      });

      // Attempting to set guides on a syntactically broken file
      await expect(
        guidesSetOperation.execute(
          snap,
          {
            filePath: 'app/broken/page.client.tsx',
            horizontal: [100],
            vertical: [200],
          },
          context,
        ),
      ).rejects.toThrow(/ORACLE_VIOLATION.*does not parse/i);
    });

    it('rejects guides.set on file with dialect violations via Oracle gate tier 2', async () => {
      const snap = createMockSnapshot({
        'app/dialect/page.client.tsx': DIALECT_VIOLATION_PAGE_JSX,
      });

      // Attempting to set guides on a file violating Revyme dialect constraints (minHeight: 100vh)
      await expect(
        guidesSetOperation.execute(
          snap,
          {
            filePath: 'app/dialect/page.client.tsx',
            horizontal: [100],
            vertical: [200],
          },
          context,
        ),
      ).rejects.toThrow(/ORACLE_VIOLATION.*minHeight.*100vh/i);
    });

    it('preserves and sorts duplicate coordinate values', async () => {
      const snap = createMockSnapshot({ [TEST_PAGE]: VALID_PAGE_JSX });

      const setRes = await guidesSetOperation.execute(
        snap,
        {
          filePath: TEST_PAGE,
          horizontal: [300, 100, 300, 100],
          vertical: [50, 200, 50],
        },
        context,
      );

      expect(setRes.count).toBe(7);
      expect(setRes.changes.length).toBe(1);

      const getRes = await guidesGetOperation.execute(
        snap,
        { filePath: TEST_PAGE },
        context,
      );

      // Sorted numeric arrays including duplicates
      expect(getRes.horizontal).toEqual([100, 100, 300, 300]);
      expect(getRes.vertical).toEqual([50, 50, 200]);
    });

    it('correctly handles negative, zero, and floating-point coordinates', async () => {
      const snap = createMockSnapshot({ [TEST_PAGE]: VALID_PAGE_JSX });

      await guidesSetOperation.execute(
        snap,
        {
          filePath: TEST_PAGE,
          horizontal: [-150.25, 0, -20.5],
          vertical: [-400, 1080.33, 0],
        },
        context,
      );

      const getRes = await guidesGetOperation.execute(
        snap,
        { filePath: TEST_PAGE },
        context,
      );

      expect(getRes.horizontal).toEqual([-150.25, -20.5, 0]);
      expect(getRes.vertical).toEqual([-400, 0, 1080.33]);
    });

    it('completely strips @rulerGuides annotation when passed empty arrays without leaving empty tags', async () => {
      const snap = createMockSnapshot({ [TEST_PAGE]: VALID_PAGE_JSX });

      // 1. First add some guides
      await guidesSetOperation.execute(
        snap,
        {
          filePath: TEST_PAGE,
          horizontal: [100, 200],
          vertical: [50],
        },
        context,
      );

      let code = projectFS.readFile(TEST_PAGE)!;
      expect(code).toContain('@rulerGuides');

      // 2. Set empty arrays
      const clearRes = await guidesSetOperation.execute(
        snap,
        {
          filePath: TEST_PAGE,
          horizontal: [],
          vertical: [],
        },
        context,
      );

      expect(clearRes.count).toBe(0);
      expect(clearRes.changes.length).toBe(1);

      code = projectFS.readFile(TEST_PAGE)!;
      // Verify clean stripping: no @rulerGuides tag at all
      expect(code).not.toContain('@rulerGuides');
      expect(code).not.toMatch(/\/\*\*\s*@rulerGuides/);
      // No triple blank lines created by removal
      expect(code).not.toContain('\n\n\n');

      // 3. guides.get returns empty arrays
      const getRes = await guidesGetOperation.execute(
        snap,
        { filePath: TEST_PAGE },
        context,
      );
      expect(getRes.horizontal).toEqual([]);
      expect(getRes.vertical).toEqual([]);
    });

    it('resiliently handles existing malformed @rulerGuides annotations without crashing', async () => {
      const codeWithMalformedAnnotation = VALID_PAGE_JSX.replace(
        '/** @canvas',
        '/** @rulerGuides [ { "invalid": true } ] */\n\n/** @canvas',
      );
      projectFS.writeFile(TEST_PAGE, codeWithMalformedAnnotation);

      const snap = createMockSnapshot({ [TEST_PAGE]: codeWithMalformedAnnotation });

      // parseRulerGuides defensively filters out invalid objects and returns empty array
      const getRes = await guidesGetOperation.execute(
        snap,
        { filePath: TEST_PAGE },
        context,
      );
      expect(getRes.horizontal).toEqual([]);
      expect(getRes.vertical).toEqual([]);

      // Setting valid guides cleanly overwrites the malformed annotation in place
      await guidesSetOperation.execute(
        snap,
        {
          filePath: TEST_PAGE,
          horizontal: [500],
          vertical: [250],
        },
        context,
      );

      const updatedCode = projectFS.readFile(TEST_PAGE)!;
      expect(updatedCode).not.toContain('{ "invalid": true }');
      expect(updatedCode).toContain('@rulerGuides');

      const finalGet = await guidesGetOperation.execute(
        snap,
        { filePath: TEST_PAGE },
        context,
      );
      expect(finalGet.horizontal).toEqual([500]);
      expect(finalGet.vertical).toEqual([250]);
    });

    it('resiliently handles syntax-broken JSON in @rulerGuides annotation', async () => {
      const codeWithBrokenJson = VALID_PAGE_JSX.replace(
        '/** @canvas',
        '/** @rulerGuides [ { unquoted_key: broken } ] */\n\n/** @canvas',
      );
      projectFS.writeFile(TEST_PAGE, codeWithBrokenJson);

      const snap = createMockSnapshot({ [TEST_PAGE]: codeWithBrokenJson });

      // parseRulerGuides catches JSON.parse error defensively
      const getRes = await guidesGetOperation.execute(
        snap,
        { filePath: TEST_PAGE },
        context,
      );
      expect(getRes.horizontal).toEqual([]);
      expect(getRes.vertical).toEqual([]);

      // Overwrite cleanly replaces the broken annotation in place
      await guidesSetOperation.execute(
        snap,
        {
          filePath: TEST_PAGE,
          horizontal: [600],
          vertical: [300],
        },
        context,
      );

      const updatedCode = projectFS.readFile(TEST_PAGE)!;
      expect(updatedCode).not.toContain('unquoted_key');
      expect(updatedCode).toContain('"position": 600');
    });
  });
});
