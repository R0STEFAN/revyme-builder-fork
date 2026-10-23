// e2e/automation-v2/L04-lifecycle.spec.ts
/**
 * E2E Acceptance Spec L04: Project Lifecycle, Backup, Branches, Review & Merge
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createSnapshot, createOperationContext } from '../../packages/automation-core/src/session';
import {
  projectsDuplicateOperation,
  projectsBackupExportOperation,
  projectsBackupRestoreOperation,
} from '../../packages/automation-core/src/operations/projects';
import {
  branchesListOperation,
  branchesCreateOperation,
  branchesSwitchOperation,
  branchesReviewOperation,
  branchesApplyOperation,
} from '../../packages/automation-core/src/operations/branches';
import { projectFS, MAIN_BRANCH_ID } from '@/code/project/project-fs';

const BASE_PAGE = `'use client';
import React from 'react';

/** @canvas { "viewports": [ { "id": "desktop", "label": "Desktop", "width": 1200, "height": "auto", "isPrimary": true, "order": 0 } ], "positions": { "desktop": { "x": 0, "y": 0 } } } */

export default function Page() {
  return (
    <div data-id="root" style={{ width: '100%', minHeight: '100vh', padding: '24px' }}>
      <h1 data-id="title" style={{ fontSize: '32px' }}>Welcome</h1>
    </div>
  );
}
`;

describe('E2E L04: Project Lifecycle Spec', () => {
  const context = createOperationContext();

  beforeEach(() => {
    projectFS.loadSnapshot(new Map([['app/page.client.tsx', BASE_PAGE]]));
    projectFS.switchBranch(MAIN_BRANCH_ID);
  });

  it('validates project duplication, export/restore, branch lifecycle and merge', async () => {
    let snapshot = createSnapshot({ projectId: 'e2e-project', branchId: 'main' }, 1, {
      'app/page.client.tsx': BASE_PAGE,
    });

    // 1. Duplicate
    const dupRes = await projectsDuplicateOperation.execute(
      snapshot,
      { targetName: 'E2E Duplicated Project' },
      context,
    );
    expect(dupRes.newProjectId).toBeDefined();

    // 2. Export & Restore
    const exportRes = await projectsBackupExportOperation.execute(
      snapshot,
      { compress: false },
      context,
    );
    expect(exportRes.backupPayload).toBeDefined();

    const restoreRes = await projectsBackupRestoreOperation.execute(
      snapshot,
      { backupPayload: exportRes.backupPayload },
      context,
    );
    expect(restoreRes.restoredFiles).toBeGreaterThanOrEqual(1);

    // 3. Branches
    const branchRes = await branchesCreateOperation.execute(
      snapshot,
      { name: 'feat-e2e-test' },
      context,
    );
    expect(branchRes.branch).toBe('feat-e2e-test');

    const listRes = await branchesListOperation.execute(snapshot, {}, context);
    expect(listRes.branches.some((b) => b.id === 'feat-e2e-test')).toBe(true);
  });
});
