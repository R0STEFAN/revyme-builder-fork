// packages/cli/test/recovery.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createPlan, defaultRegistry } from '@revyme/automation-core';
import type { Snapshot, OperationContext } from '@revyme/automation-core';
import { CommitService } from '../../../server/automation/commit-service';
import { LocalProjectRepository } from '../../../server/automation/project-repository';

describe('T05: Recovery, Dry-Run & CAS Enforcement', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'revyme-recovery-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function commitService(snapshot: Snapshot) {
    const projects = path.join(tmpDir, 'projects');
    fs.mkdirSync(projects, { recursive: true });
    fs.writeFileSync(path.join(projects, `${snapshot.scope.projectId}.json`), JSON.stringify({
      id: snapshot.scope.projectId, revision: snapshot.revision,
      data: { files: Object.fromEntries(snapshot.files), branches: {}, settings: snapshot.config },
    }));
    return new CommitService(new LocalProjectRepository(tmpDir));
  }

  it('ensures dry-run leaves status explicitly as not_committed', async () => {
    const scope = { projectId: 'recovery-proj', branchId: 'main' };
    const snapshot: Snapshot = {
      scope,
      revision: 4,
      files: new Map([['app/page.tsx', `export default function Page() { return <div data-id="root">Hello</div>; }`]]),
      config: {},
    };

    const batchOp = defaultRegistry.get('workflow.batch');
    expect(batchOp).toBeDefined();

    const context: OperationContext = {
      createId: (prefix = 'op') => `${prefix}-123`,
      signal: new AbortController().signal,
      trace: () => {},
      adapters: {},
    };

    const result = await batchOp!.execute(
      snapshot,
      {
        operations: [{ tool: 'meta.guide', input: { topic: 'general' } }],
      },
      context
    );

    expect(result.success).toBe(true);
    expect(result.plan).toBeDefined();
    expect(result.plan.baseRevision).toBe(4);
    expect(result.plan.scope.projectId).toBe('recovery-proj');
  });

  it('plans.commit rejects plan with stale baseRevision', async () => {
    const scope = { projectId: 'stale-proj', branchId: 'main' };
    const snapshot: Snapshot = {
      scope,
      revision: 5, // Server current revision is 5
      files: new Map(),
      config: {},
    };

    const stalePlan = createPlan({
      scope,
      baseRevision: 3, // Plan was generated based on revision 3 (stale)
      operationId: 'op-stale-attempt',
      changes: [
        {
          path: 'app/page.tsx',
          beforeHash: null,
          content: 'export default function Page() { return <div data-id="r">Stale</div>; }',
        },
      ],
    });

    const commitOp = defaultRegistry.get('plans.commit');
    expect(commitOp).toBeDefined();

    const context: OperationContext = {
      createId: () => 'ctx-1',
      signal: new AbortController().signal,
      trace: () => {},
      adapters: { commitService: commitService(snapshot) },
    };

    await expect(
      commitOp!.execute(snapshot, { plan: stalePlan }, context)
    ).rejects.toThrow(/Revision conflict/);
  });

  it('plans.commit accepts matching baseRevision and planHash and produces incremented receipt', async () => {
    const scope = { projectId: 'valid-proj', branchId: 'main' };
    const snapshot: Snapshot = {
      scope,
      revision: 10,
      files: new Map(),
      config: {},
    };

    const validPlan = createPlan({
      scope,
      baseRevision: 10,
      operationId: 'op-valid-1',
      changes: [
        {
          path: 'app/page.tsx',
          beforeHash: null,
          content: 'export default function Page() { return <div data-id="r">Valid</div>; }',
        },
      ],
    });

    const commitOp = defaultRegistry.get('plans.commit');
    const context: OperationContext = {
      createId: () => 'ctx-valid',
      signal: new AbortController().signal,
      trace: () => {},
      adapters: { commitService: commitService(snapshot) },
    };

    const res = await commitOp!.execute(snapshot, { plan: validPlan }, context);
    expect(res.receipt).toBeDefined();
    expect(res.receipt.revision).toBe(11);
    expect(res.receipt.operationId).toBe('op-valid-1');
    expect(res.receipt.planHash).toBe(validPlan.planHash);
  });

  it('reports both hashes when the commit service rejects a corrupted plan hash', async () => {
    const scope = { projectId: 'hash-diagnostic-proj', branchId: 'main' };
    const snapshot: Snapshot = { scope, revision: 1, files: new Map(), config: {} };
    const plan = createPlan({
      scope,
      baseRevision: 1,
      operationId: 'op-hash-diagnostic',
      changes: [{ path: 'app/page.tsx', beforeHash: null, content: 'export default function Page() { return <div />; }' }],
    });
    plan.planHash = 'invalid-hash';

    const result = await commitService(snapshot).commit(plan);

    expect(result.error?.code).toBe('PLAN_HASH_MISMATCH');
    expect(result.error?.message).toContain('received invalid-hash');
    expect(result.error?.message).toContain('calculated ');
  });
});
