import { describe, expect, it, vi } from 'vitest';
import { AutomationClient } from '../src/client';
import { PlanSchema, validatePlan, type Result, type Snapshot } from '@revyme/automation-core';

describe('AutomationClient plan retry', () => {
  it('keeps a history-enriched typography removal plan hash-valid', async () => {
    const scope = { projectId: 'retry-project', branchId: 'main' };
    const globals = `:root {
  --typo-studio-body-font: 'Inter', sans-serif;
  --typo-studio-body-weight: 400;
  --typo-studio-body-size: 16px;
}`;
    const snapshot: Snapshot = {
      scope,
      revision: 7,
      files: new Map([
        ['app/globals.css', globals],
        ['_meta/history.json', JSON.stringify({ undoStack: [], redoStack: [] })],
      ]),
      config: {},
    };
    const client = new AutomationClient({ apiUrl: 'http://localhost:3000' });
    vi.spyOn(client, 'getSnapshot').mockResolvedValue({
      ok: true,
      data: snapshot,
      meta: { commitStatus: 'not_committed', revision: 7 },
    });
    vi.spyOn(client, 'validatePlan').mockImplementation(async plan => {
      const wirePlan = PlanSchema.parse(JSON.parse(JSON.stringify(plan)));
      const validation = validatePlan(snapshot, wirePlan);
      return {
        ok: validation.ok,
        data: validation,
        ...(validation.ok ? {} : { error: { code: 'PLAN_VALIDATION_FAILED', message: 'Plan validation failed', issues: validation.issues } }),
        meta: { commitStatus: 'not_committed', revision: 7 },
      };
    });

    let nextId = 0;
    const result = await client.execute(scope, 'typography.remove', {
      name: 'studio-body',
      force: true,
      targetFile: 'app/globals.css',
    }, {
      dryRun: true,
      context: {
        createId: (kind?: string) => `${kind || 'mcp'}-test-${++nextId}`,
        signal: new AbortController().signal,
        trace: () => {},
        adapters: {},
      },
    });

    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('keeps a history-enriched design-component creation plan hash-valid', async () => {
    const scope = { projectId: 'retry-project', branchId: 'main' };
    const snapshot: Snapshot = {
      scope,
      revision: 7,
      files: new Map([
        ['app/page.client.tsx', 'export default function Page() { return <div data-id="root" style={{ width: \'100%\', height: \'auto\' }} />; }'],
        ['_meta/history.json', JSON.stringify({ undoStack: [], redoStack: [] })],
      ]),
      config: {},
    };
    const client = new AutomationClient({ apiUrl: 'http://localhost:3000' });
    vi.spyOn(client, 'getSnapshot').mockResolvedValue({
      ok: true,
      data: snapshot,
      meta: { commitStatus: 'not_committed', revision: 7 },
    });
    vi.spyOn(client, 'validatePlan').mockImplementation(async plan => {
      const wirePlan = PlanSchema.parse(JSON.parse(JSON.stringify(plan)));
      const validation = validatePlan(snapshot, wirePlan);
      return {
        ok: validation.ok,
        data: validation,
        ...(validation.ok ? {} : { error: { code: 'PLAN_VALIDATION_FAILED', message: 'Plan validation failed', issues: validation.issues } }),
        meta: { commitStatus: 'not_committed', revision: 7 },
      };
    });

    const result = await client.execute(scope, 'components.create', {
      name: 'SiteNavbar',
      props: [{ name: 'label', type: 'string', default: 'Menu' }],
      layout: [{ tag: 'span', dataId: 'navbar-label', text: '{label}', style: { position: 'relative' } }],
    }, { dryRun: true });

    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('re-prepares a mutation once after a transient plan-hash mismatch', async () => {
    const scope = { projectId: 'retry-project', branchId: 'main', filePath: 'app/page.client.tsx' };
    const snapshot: Snapshot = {
      scope,
      revision: 7,
      files: new Map([['app/page.client.tsx', "export default function Page() { return <div data-id=\"root\" style={{ width: '100%', height: 'auto' }} />; }"]]),
      config: {},
    };
    const client = new AutomationClient({ apiUrl: 'http://localhost:3000' });
    const getSnapshot = vi.spyOn(client, 'getSnapshot').mockResolvedValue({
      ok: true,
      data: snapshot,
      meta: { commitStatus: 'not_committed', revision: 7 },
    });
    const commit = vi.spyOn(client, 'commit')
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'PLAN_HASH_MISMATCH', message: 'transient mismatch', issues: [] },
        meta: { commitStatus: 'not_committed', revision: 7 },
      } as Result<any>)
      .mockResolvedValueOnce({
        ok: true,
        data: { operationId: 'retry-ok', projectId: 'retry-project', branchId: 'main', revision: 8, planHash: 'retry-hash', changedFiles: ['app/page.client.tsx'] },
        meta: { commitStatus: 'committed', revision: 8 },
      });

    const result = await client.execute(scope, 'nodes.create', {
      filePath: 'app/page.client.tsx',
      parentId: 'root',
      id: 'retry-child',
      type: 'div',
    });

    expect(result.ok).toBe(true);
    expect(getSnapshot).toHaveBeenCalledTimes(2);
    expect(commit).toHaveBeenCalledTimes(2);
  });

  it('keeps a history-enriched node-removal plan hash-valid after the wire-schema round trip', async () => {
    const scope = { projectId: 'retry-project', branchId: 'main', filePath: 'app/page.client.tsx' };
    const snapshot: Snapshot = {
      scope,
      revision: 7,
      files: new Map([['app/page.client.tsx', `'use client';
export default function Page() {
  return <div data-id="root" style={{ position: 'relative', width: '100%', height: 'auto' }}>
    <div data-id="old-card" style={{ position: 'relative', order: '0' }}>Old</div>
  </div>;
}`]]),
      config: {},
    };
    const client = new AutomationClient({ apiUrl: 'http://localhost:3000' });
    vi.spyOn(client, 'getSnapshot').mockResolvedValue({
      ok: true,
      data: snapshot,
      meta: { commitStatus: 'not_committed', revision: 7 },
    });
    vi.spyOn(client, 'validatePlan').mockImplementation(async plan => {
      const wirePlan = PlanSchema.parse(JSON.parse(JSON.stringify(plan)));
      const validation = validatePlan(snapshot, wirePlan);
      return {
        ok: validation.ok,
        data: validation,
        ...(validation.ok ? {} : { error: { code: 'PLAN_VALIDATION_FAILED', message: 'Plan validation failed', issues: validation.issues } }),
        meta: { commitStatus: 'not_committed', revision: 7 },
      };
    });

    const result = await client.execute(scope, 'nodes.remove', {
      filePath: 'app/page.client.tsx',
      nodeId: 'old-card',
    }, { dryRun: true });

    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('keeps a history-enriched nodes.update order plan hash-valid after the wire-schema round trip', async () => {
    const scope = { projectId: 'retry-project', branchId: 'main', filePath: 'app/page.client.tsx' };
    const snapshot: Snapshot = {
      scope,
      revision: 7,
      files: new Map([['app/page.client.tsx', `'use client';
export default function Page() {
  return <div data-id="root" style={{ position: 'relative', width: '100%', height: 'auto' }}>
    <div data-id="card" style={{ position: 'relative', order: '2' }} />
  </div>;
}`]]),
      config: {},
    };
    const client = new AutomationClient({ apiUrl: 'http://localhost:3000' });
    vi.spyOn(client, 'getSnapshot').mockResolvedValue({
      ok: true,
      data: snapshot,
      meta: { commitStatus: 'not_committed', revision: 7 },
    });
    vi.spyOn(client, 'validatePlan').mockImplementation(async plan => {
      const wirePlan = PlanSchema.parse(JSON.parse(JSON.stringify(plan)));
      const validation = validatePlan(snapshot, wirePlan);
      return {
        ok: validation.ok,
        data: validation,
        ...(validation.ok ? {} : { error: { code: 'PLAN_VALIDATION_FAILED', message: 'Plan validation failed', issues: validation.issues } }),
        meta: { commitStatus: 'not_committed', revision: 7 },
      };
    });

    const result = await client.execute(scope, 'nodes.update', {
      filePath: 'app/page.client.tsx',
      nodeId: 'card',
      styles: { order: '0' },
    }, { dryRun: true });

    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    expect(result.error).toBeUndefined();
  });

});
