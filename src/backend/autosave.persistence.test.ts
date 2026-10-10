import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getDefaultStore } from 'jotai';
import { backend } from './index';
import { cancelPendingAutosave, flushSaveNow, setAutosaveHeld, triggerAutosave } from './autosave';
import { saveStatusAtom } from './save-store';
import { projectFS, resetProjectFS } from '@/code/project/project-fs';

vi.mock('./index', () => ({ backend: { saveProject: vi.fn() } }));
vi.mock('./project-id', () => ({ getProjectId: () => 'site-1' }));
vi.mock('./thumbnail-capture', () => ({ captureAndSaveProjectThumbnail: vi.fn() }));

const page = 'app/page.client.tsx';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(backend.saveProject).mockReset().mockResolvedValue(undefined);
  resetProjectFS(new Map([[page, 'A']]));
  getDefaultStore().set(saveStatusAtom, 'saved');
});

afterEach(() => {
  setAutosaveHeld(false);
  cancelPendingAutosave();
  vi.useRealTimers();
});

it('serializes edits and only reports Saved after the latest snapshot persists', async () => {
  const first = deferred();
  const second = deferred();
  const persisted: string[] = [];
  let active = 0;
  let maximum = 0;
  vi.mocked(backend.saveProject).mockImplementation(async (_id, data) => {
    active++;
    maximum = Math.max(maximum, active);
    await (persisted.length === 0 ? first.promise : second.promise);
    persisted.push(data.files[page]);
    active--;
  });
  triggerAutosave();
  await vi.advanceTimersByTimeAsync(2000);
  projectFS.writeFile(page, 'B');
  triggerAutosave();
  await vi.advanceTimersByTimeAsync(2000);
  expect(backend.saveProject).toHaveBeenCalledTimes(1);
  first.resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect(getDefaultStore().get(saveStatusAtom)).not.toBe('saved');
  expect(backend.saveProject).toHaveBeenCalledTimes(2);
  second.resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect(maximum).toBe(1);
  expect(persisted).toEqual(['A', 'B']);
  expect(getDefaultStore().get(saveStatusAtom)).toBe('saved');
});

it('keeps unload protection while a newer edit is waiting for debounce', async () => {
  const first = deferred();
  vi.mocked(backend.saveProject).mockImplementationOnce(() => first.promise);
  triggerAutosave();
  await vi.advanceTimersByTimeAsync(2000);
  projectFS.writeFile(page, 'B');
  triggerAutosave();
  first.resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect(getDefaultStore().get(saveStatusAtom)).not.toBe('saved');
  window.dispatchEvent(new Event('beforeunload', { cancelable: true }));
  expect(backend.saveProject).toHaveBeenCalledTimes(2);
});

it('concurrent explicit flushes await the current revision without overlap', async () => {
  const first = deferred();
  const second = deferred();
  let active = 0;
  let maximum = 0;
  const persisted: string[] = [];
  vi.mocked(backend.saveProject).mockImplementation(async (_id, data) => {
    active++;
    maximum = Math.max(maximum, active);
    await (persisted.length === 0 ? first.promise : second.promise);
    persisted.push(data.files[page]);
    active--;
  });
  triggerAutosave();
  await vi.advanceTimersByTimeAsync(2000);
  projectFS.writeFile(page, 'B');
  const flushA = flushSaveNow();
  const flushB = flushSaveNow();
  expect(backend.saveProject).toHaveBeenCalledTimes(1);
  first.resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect(backend.saveProject).toHaveBeenCalledTimes(2);
  second.resolve();
  await Promise.all([flushA, flushB]);
  expect(maximum).toBe(1);
  expect(persisted[persisted.length - 1]).toBe('B');
});

it('retries the newest snapshot after an older write fails', async () => {
  const first = deferred();
  const persisted: string[] = [];
  vi.mocked(backend.saveProject).mockImplementationOnce(() => first.promise).mockImplementationOnce(async (_id, data) => {
    persisted.push(data.files[page]);
  });
  triggerAutosave();
  await vi.advanceTimersByTimeAsync(2000);
  projectFS.writeFile(page, 'B');
  triggerAutosave();
  first.reject(new Error('503'));
  await vi.advanceTimersByTimeAsync(5000);
  expect(persisted).toEqual(['B']);
  expect(getDefaultStore().get(saveStatusAtom)).toBe('saved');
});

it('reports an empty snapshot as a failed explicit save', async () => {
  resetProjectFS(new Map());
  await expect(flushSaveNow()).rejects.toThrow(/empty project/);
  expect(getDefaultStore().get(saveStatusAtom)).toBe('error');
  expect(backend.saveProject).not.toHaveBeenCalled();
});

it('attaches manual metadata to the follow-up write rather than an older in-flight write', async () => {
  const first = deferred();
  vi.mocked(backend.saveProject).mockImplementationOnce(() => first.promise);
  triggerAutosave();
  await vi.advanceTimersByTimeAsync(2000);
  projectFS.writeFile(page, 'B');
  const flush = flushSaveNow({ source: 'manual', label: 'Manual save' });
  expect(backend.saveProject).toHaveBeenCalledTimes(1);
  first.resolve();
  await flush;
  expect(vi.mocked(backend.saveProject).mock.calls[0][2]?.source).toBe('autosave');
  expect(vi.mocked(backend.saveProject).mock.calls[1][2]).toMatchObject({ source: 'manual', label: 'Manual save' });
});

it('rejects explicit failures, then retries background work within the budget', async () => {
  vi.mocked(backend.saveProject).mockRejectedValue(new Error('503'));
  await expect(flushSaveNow({ source: 'manual' })).rejects.toThrow('503');
  expect(getDefaultStore().get(saveStatusAtom)).toBe('error');
  await vi.advanceTimersByTimeAsync(60_000);
  expect(backend.saveProject).toHaveBeenCalledTimes(4);
});

it('does not persist held work or a cancelled follow-up', async () => {
  const first = deferred();
  vi.mocked(backend.saveProject).mockImplementationOnce(() => first.promise);
  triggerAutosave();
  await vi.advanceTimersByTimeAsync(2000);
  projectFS.writeFile(page, 'B');
  triggerAutosave();
  await vi.advanceTimersByTimeAsync(2000);
  setAutosaveHeld(true);
  first.resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect(backend.saveProject).toHaveBeenCalledTimes(1);
  cancelPendingAutosave();
  setAutosaveHeld(false);
  await vi.advanceTimersByTimeAsync(5000);
  expect(backend.saveProject).toHaveBeenCalledTimes(1);
});

it('refuses an explicit flush while template decision hold is active', async () => {
  setAutosaveHeld(true);
  triggerAutosave();
  await expect(flushSaveNow({ source: 'manual' })).rejects.toThrow(/held/);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(backend.saveProject).not.toHaveBeenCalled();
});

it('cancel invalidates a follow-up that became ready during an in-flight write', async () => {
  const first = deferred();
  vi.mocked(backend.saveProject).mockImplementationOnce(() => first.promise);
  triggerAutosave();
  await vi.advanceTimersByTimeAsync(2000);
  projectFS.writeFile(page, 'B');
  triggerAutosave();
  await vi.advanceTimersByTimeAsync(2000);
  cancelPendingAutosave();
  first.resolve();
  await vi.advanceTimersByTimeAsync(5000);
  expect(backend.saveProject).toHaveBeenCalledTimes(1);
});

it('rejects a waiting explicit flush when cancellation prevents its snapshot from saving', async () => {
  const first = deferred();
  vi.mocked(backend.saveProject).mockImplementationOnce(() => first.promise);
  triggerAutosave();
  await vi.advanceTimersByTimeAsync(2000);
  projectFS.writeFile(page, 'B');
  const flush = flushSaveNow({ source: 'manual' });
  cancelPendingAutosave();
  first.resolve();
  await expect(flush).rejects.toThrow(/cancelled/);
  expect(backend.saveProject).toHaveBeenCalledTimes(1);
});
