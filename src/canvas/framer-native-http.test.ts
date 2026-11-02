import { expect, it } from 'vitest';
import { createNativePasteHttpServices } from './framer-native-http';

it('reads the scoped durable snapshot and sends preparation through native submit', async () => {
  const scope = { projectId: 'project-a', branchId: 'draft' }, calls: string[] = [];
  const services = createNativePasteHttpServices(scope, { flush: async () => {}, isCurrent: () => true, apply: async () => {} }, async (url, init) => {
    calls.push(String(url));
    expect(init?.credentials).toBe('same-origin');
    if (String(url).includes('/snapshot')) return Response.json({ ok: true, data: { scope, revision: 7, files: { 'notes.txt': 'saved' }, config: {} } });
    const body = JSON.parse(init!.body as string);
    expect(body.operationId).toBe('one-paste');
    expect(body.input.target).toEqual(scope);
    return Response.json({ ok: true, data: { operationId: 'one-paste' } });
  });
  const snapshot = await services.snapshot();
  expect(snapshot.files.get('notes.txt')).toBe('saved');
  await services.prepare({ target: scope } as any, 'one-paste');
  expect(calls).toEqual(['/api/automation/snapshot?projectId=project-a&branchId=draft', '/api/automation/framer/prepare']);
});

it('rejects a snapshot from another project before it can become an import target', async () => {
  const scope = { projectId: 'project-a', branchId: 'main' };
  const services = createNativePasteHttpServices(scope, { flush: async () => {}, isCurrent: () => true, apply: async () => {} }, async () => Response.json({ ok: true, data: { scope: { ...scope, projectId: 'other' }, revision: 1, files: {} } }));
  await expect(services.snapshot()).rejects.toThrow(/SNAPSHOT_SCOPE_MISMATCH/);
});
it('still checks a durable receipt after cancellation during commit', async () => {
  const scope = { projectId: 'project-a', branchId: 'main' }, controller = new AbortController();
  controller.abort();
  const services = createNativePasteHttpServices(scope, { signal: controller.signal, flush: async () => {}, isCurrent: () => true, apply: async () => {} }, async (_url, init) => {
    expect(init?.signal).toBeUndefined();
    return Response.json({ ok: true, data: { found: true, receipt: { operationId: 'committed' } } });
  });
  expect(await services.status(scope, 'committed')).toMatchObject({ operationId: 'committed' });
});
