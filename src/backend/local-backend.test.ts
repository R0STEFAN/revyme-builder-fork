// local-backend.test.ts — Verifies the localStorage-backed adapter satisfies
// the ProjectBackend contract. Each test uses a fresh in-memory localStorage.
// (Auth flows and the websites index moved out of ProjectBackend — the
// dashboard owns those in cloud mode; local mode has a single project.)

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalBackend } from './local-backend';
import { PROJECT_FORMAT } from './types';

class MemStorage implements Storage {
  private store = new Map<string, string>();
  get length() {
    return this.store.size;
  }
  clear() {
    this.store.clear();
  }
  getItem(k: string) {
    return this.store.has(k) ? (this.store.get(k) as string) : null;
  }
  setItem(k: string, v: string) {
    this.store.set(k, v);
  }
  removeItem(k: string) {
    this.store.delete(k);
  }
  key(i: number) {
    return Array.from(this.store.keys())[i] ?? null;
  }
}

describe('LocalBackend', () => {
  let backend: LocalBackend;

  beforeEach(() => {
    vi.stubGlobal('localStorage', new MemStorage());
    backend = new LocalBackend();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ─── Session ──────────────────────────────────────────────────────────────

  it('returns the local user from getUser()', async () => {
    const user = await backend.getUser();
    expect(user?.id).toBe('local');
  });

  // ─── Project load/save ────────────────────────────────────────────────────

  it('round-trips a project snapshot', async () => {
    const data = {
      format: PROJECT_FORMAT,
      files: { 'app/page.tsx': 'a', 'components/X.tsx': 'b' },
    };
    await backend.saveProject('local', data);
    expect(await backend.loadProject('local')).toEqual(data);
  });

  it('rejects when storage quota and server PUT both fail', async () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => { throw new Error('quota'); } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('full', { status: 500 })));
    await expect(backend.saveProject('local', { format: PROJECT_FORMAT, files: { 'app/page.tsx': 'latest' } })).rejects.toThrow();
  });

  it('succeeds when server PUT succeeds despite storage quota', async () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => { throw new Error('quota'); } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    await expect(backend.saveProject('local', { format: PROJECT_FORMAT, files: { 'app/page.tsx': 'latest' } })).resolves.toBeUndefined();
  });

  it('retains local recovery but reports a failed server PUT', async () => {
    const data = { format: PROJECT_FORMAT, files: { 'app/page.tsx': 'latest' } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('full', { status: 500 })));
    await expect(backend.saveProject('local', data)).rejects.toThrow();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await backend.loadProject('local')).toEqual(data);
  });

  it('prefers known unsynced local work over an older valid server snapshot', async () => {
    const latest = { format: PROJECT_FORMAT, files: { 'app/page.tsx': 'latest' } };
    const stale = { format: PROJECT_FORMAT, files: { 'app/page.tsx': 'old server copy' } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('full', { status: 500 })));
    await expect(backend.saveProject('local', latest)).rejects.toThrow();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: stale }), { status: 200 })));
    expect(await new LocalBackend().loadProject('local')).toEqual(latest);
  });

  it('keeps recovery metadata with the snapshot when a second storage write would exceed quota', async () => {
    const latest = { format: PROJECT_FORMAT, files: { 'app/page.tsx': 'latest' } };
    const stale = { format: PROJECT_FORMAT, files: { 'app/page.tsx': 'old server copy' } };
    const storage = localStorage;
    const realSet = storage.setItem.bind(storage);
    let writes = 0;
    vi.spyOn(storage, 'setItem').mockImplementation((key, value) => {
      if (++writes > 1) throw new Error('quota');
      realSet(key, value);
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('full', { status: 500 })));
    await expect(backend.saveProject('local', latest)).rejects.toThrow();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: stale }), { status: 200 })));
    expect(await new LocalBackend().loadProject('local')).toEqual(latest);
  });

  it('still attempts a server PUT when the optional cached name cannot be read', async () => {
    const storage = localStorage;
    const realGet = storage.getItem.bind(storage);
    vi.spyOn(storage, 'getItem').mockImplementation((key) => {
      if (key.startsWith('revyme:project-name:')) throw new Error('name cache unavailable');
      return realGet(key);
    });
    const put = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', put);
    await expect(backend.saveProject('local', { format: PROJECT_FORMAT, files: { 'app/page.tsx': 'latest' } })).resolves.toBeUndefined();
    expect(put).toHaveBeenCalledOnce();
  });

  it('loads an acknowledged newer server snapshot over an older unsynced local copy', async () => {
    const old = { format: PROJECT_FORMAT, files: { 'app/page.tsx': 'old local copy' } };
    const latest = { format: PROJECT_FORMAT, files: { 'app/page.tsx': 'new server copy' } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('offline', { status: 500 })));
    await expect(backend.saveProject('local', old)).rejects.toThrow();
    const oldStored = JSON.parse(localStorage.getItem('revyme-project-local')!);
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    const put = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', put);
    await expect(backend.saveProject('local', latest)).resolves.toBeUndefined();
    const serverStored = JSON.parse(put.mock.calls[0][1].body).data;
    expect(serverStored.__revymePersistenceRevision).toBeGreaterThan(oldStored.__revymePersistenceRevision);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: serverStored }), { status: 200 })));
    vi.resetModules();
    const { LocalBackend: ReloadedBackend } = await import('./local-backend');
    expect(await new ReloadedBackend().loadProject('local')).toEqual(latest);
  });

  it('loads the acknowledged server revision after local cleanup fails', async () => {
    const old = { format: PROJECT_FORMAT, files: { 'app/page.tsx': 'old local copy' } };
    const latest = { format: PROJECT_FORMAT, files: { 'app/page.tsx': 'new server copy' } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('offline', { status: 500 })));
    await expect(backend.saveProject('local', old)).rejects.toThrow();
    const realSet = localStorage.setItem.bind(localStorage);
    let writes = 0;
    vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
      if (++writes === 2) throw new Error('blocked cleanup');
      realSet(key, value);
    });
    const put = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', put);
    await expect(backend.saveProject('local', latest)).resolves.toBeUndefined();
    const serverStored = JSON.parse(put.mock.calls[0][1].body).data;
    expect(JSON.parse(localStorage.getItem('revyme-project-local')!).__revymeUnsynced).toBe(true);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: serverStored }), { status: 200 })));
    vi.resetModules();
    const { LocalBackend: ReloadedBackend } = await import('./local-backend');
    expect(await new ReloadedBackend().loadProject('local')).toEqual(latest);
  });

  it('returns unsynced local recovery after a stalled server GET and aborts it', async () => {
    vi.useFakeTimers();
    try {
      const data = { format: PROJECT_FORMAT, files: { 'app/page.tsx': 'local recovery' } };
      localStorage.setItem('revyme-project-local', JSON.stringify({
        ...data, __revymeUnsynced: true, __revymePersistenceRevision: 10,
      }));
      const signals: AbortSignal[] = [];
      vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit = {}) => {
        if (init.signal) signals.push(init.signal);
        return new Promise<Response>(() => {});
      }));
      const loading = Promise.all([backend.loadProject('local'), backend.getWebsiteName('local')]);
      let settled = false;
      void loading.then(() => { settled = true; });
      await vi.advanceTimersByTimeAsync(5_000);
      expect(settled).toBe(true);
      expect(await loading).toEqual([data, null]);
      expect(signals).toHaveLength(2);
      expect(signals.every(signal => signal.aborted)).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not acknowledge a server-only save when the older local revision cannot be read', async () => {
    const old = { format: PROJECT_FORMAT, files: { 'app/page.tsx': 'old local copy' } };
    const latest = { format: PROJECT_FORMAT, files: { 'app/page.tsx': 'new server copy' } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('offline', { status: 500 })));
    await expect(backend.saveProject('local', old)).rejects.toThrow();
    const realGet = localStorage.getItem.bind(localStorage);
    vi.spyOn(localStorage, 'getItem').mockImplementation((key) => {
      if (key === 'revyme-project-local') throw new Error('storage blocked');
      return realGet(key);
    });
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    const put = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', put);
    await expect(backend.saveProject('local', latest)).rejects.toThrow(/revision/);
    expect(put).not.toHaveBeenCalled();
  });

  it('returns null for a missing project', async () => {
    expect(await backend.loadProject('missing')).toBeNull();
  });

  it('rejects snapshots with the wrong format tag', async () => {
    localStorage.setItem(
      'revyme-project-local',
      JSON.stringify({ format: 'old-format', files: {} }),
    );
    expect(await backend.loadProject('local')).toBeNull();
  });

  // ─── Format tag: current + legacy ──────────────────────────────────────────
  // The stored tag was renamed canvas-poc-v1 -> revyme-v1 and the data was
  // migrated in place. Reads must still accept the legacy tag so a blob that
  // predates the migration (old export, hand-restored backup) still hydrates
  // rather than silently loading as an empty project.

  it('saves with the current format tag', async () => {
    await backend.saveProject('local', {
      format: PROJECT_FORMAT,
      files: { 'app/page.tsx': 'a' },
    });
    const raw = JSON.parse(localStorage.getItem('revyme-project-local')!);
    expect(raw.format).toBe('revyme-v1');
  });

  it.each([['revyme-v1'], ['canvas-poc-v1']])(
    'loads a snapshot tagged %s',
    async (tag) => {
      localStorage.setItem(
        'revyme-project-local',
        JSON.stringify({ format: tag, files: { 'app/page.tsx': 'hello' } }),
      );
      const loaded = await backend.loadProject('local');
      expect(loaded).not.toBeNull();
      expect(loaded!.files['app/page.tsx']).toBe('hello');
    },
  );

  it('returns null for corrupt (non-JSON) snapshots instead of throwing', async () => {
    localStorage.setItem('revyme-project-local', 'not json {');
    expect(await backend.loadProject('local')).toBeNull();
  });

  // ─── Cloud-shaped methods degrade gracefully in local mode ────────────────

  it('renameWebsite is a no-op (chip localStorage is the source of truth)', async () => {
    await expect(backend.renameWebsite('local', 'New Name')).resolves.toBeUndefined();
  });

  it('getWebsiteName returns null so the chip name is not overridden', async () => {
    expect(await backend.getWebsiteName('local')).toBeNull();
  });

  it('always reports the owner role', async () => {
    expect(await backend.getWebsiteRole('local')).toBe('owner');
  });

  it('has no workspace, credits, or workspace fonts', async () => {
    expect(await backend.getWebsiteWorkspaceId('local')).toBeNull();
    expect(await backend.getCredits('any')).toBeNull();
    expect(await backend.listWorkspaceFonts('any')).toEqual([]);
  });

  // ─── Assets ───────────────────────────────────────────────────────────────

  it('uploadAsset returns a data: URL that survives reloads (not blob:)', async () => {
    const file = new File(['hello'], 'a.txt', { type: 'text/plain' });
    const url = await backend.uploadAsset('local', file);
    expect(url.startsWith('data:')).toBe(true);
    expect(atob(url.split(',')[1])).toBe('hello');
  });
});

// flushSaveNow — publish-path save flush. A publish clicked inside the 2s
// autosave debounce must NOT deploy the previous save: flushSaveNow cancels
// the debounce, awaits any in-flight save (whose snapshot predates the
// newest edit), then saves unconditionally.
import { describe as _fd, it as _fit, expect as _fe, vi as _fvi } from 'vitest';
import { triggerAutosave, flushSaveNow } from './autosave';
import { backend as _backend } from './index';
import { projectFS as _pfs } from '../code/project/project-fs';

_fd('flushSaveNow', () => {
  // The autosave guard drops cloud saves whose project id never resolved
  // ('local' in a CLOUD_ENABLED session = a half-booted or zombie client).
  // These tests exercise the flush machinery itself, so run them as a
  // properly-booted builder session.
  beforeEach(() => window.history.replaceState(null, '', '/builder/test-site'));

  _fit('cancels the debounce and persists the CURRENT snapshot before resolving', async () => {
    const calls: Array<Record<string, string>> = [];
    const spy = _fvi.spyOn(_backend, 'saveProject').mockImplementation(async (_id: string, data: any) => {
      calls.push({ ...(data.files as Record<string, string>) });
    });
    try {
      _pfs.writeFile('app/x.tsx', 'v1');
      triggerAutosave();               // starts the 2s debounce
      _pfs.writeFile('app/x.tsx', 'v2'); // newest edit, still inside debounce
      await flushSaveNow();            // publish path
      _fe(calls.length).toBeGreaterThan(0);
      _fe(calls[calls.length - 1]['app/x.tsx']).toBe('v2');
    } finally {
      spy.mockRestore();
    }
  });

  _fit('waits out an in-flight save then saves again with the newer snapshot', async () => {
    const calls: string[] = [];
    let releaseFirst: () => void = () => {};
    const gate = new Promise<void>((r) => { releaseFirst = r; });
    let n = 0;
    const spy = _fvi.spyOn(_backend, 'saveProject').mockImplementation(async (_id: string, data: any) => {
      n++;
      if (n === 1) await gate; // first save hangs (snapshot = v1)
      calls.push((data.files as Record<string, string>)['app/y.tsx']);
    });
    try {
      _pfs.writeFile('app/y.tsx', 'v1');
      triggerAutosave();
      await _fvi.waitFor(() => {});
      // Fire the debounced save immediately by flushing — it snapshots v1 and hangs.
      const firstFlush = flushSaveNow();
      _pfs.writeFile('app/y.tsx', 'v2');
      releaseFirst();
      await firstFlush;
      // Now the publish-time flush must land v2.
      await flushSaveNow();
      _fe(calls[calls.length - 1]).toBe('v2');
    } finally {
      spy.mockRestore();
    }
  });
});

// ─── Regression: an unknown format tag must NEVER discard a real project ─────
// Rejecting on the tag made ProjectLoader seed an empty starter, which
// autosave then wrote back over the user's files. Two projects were lost to
// this. Files present = load it, whatever the tag says.
describe('LocalBackend — format tag is a hint, not a gate', () => {
  let backend: LocalBackend;
  beforeEach(() => { localStorage.clear(); backend = new LocalBackend(); });

  it('loads a project with an UNKNOWN format tag when it has files', async () => {
    localStorage.setItem('revyme-project-local', JSON.stringify({
      format: 'some-future-tag-v9',
      files: { 'app/page.tsx': 'real work' },
    }));
    const loaded = await backend.loadProject('local');
    expect(loaded).not.toBeNull();
    expect(loaded!.files['app/page.tsx']).toBe('real work');
  });

  it('loads a project with NO format tag at all when it has files', async () => {
    localStorage.setItem('revyme-project-local', JSON.stringify({
      files: { 'app/page.tsx': 'real work' },
    }));
    expect((await backend.loadProject('local'))!.files['app/page.tsx']).toBe('real work');
  });

  it('still returns null for a genuinely fileless row', async () => {
    localStorage.setItem('revyme-project-local', JSON.stringify({ format: 'revyme-v1', files: {} }));
    expect(await backend.loadProject('local')).toBeNull();
  });
});

describe('LocalBackend — server error resilience', () => {
  let backend: LocalBackend;
  beforeEach(() => {
    localStorage.clear();
    backend = new LocalBackend();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws when server returns 500 and project is not in localStorage', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    }));
    await expect(backend.loadProject('proj-123')).rejects.toThrow('Failed to load project "proj-123" from server: Server returned HTTP 500');
  });

  it('throws when server fetch fails with network error and project is not in localStorage', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Failed to fetch')));
    await expect(backend.loadProject('proj-123')).rejects.toThrow('Failed to load project "proj-123" from server: Failed to fetch');
  });

  it('falls back to localStorage if server fails with network error but localStorage has project', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Failed to fetch')));
    localStorage.setItem('revyme-project-proj-123', JSON.stringify({
      format: 'revyme-v1',
      files: { 'app/page.tsx': 'cached work' },
    }));
    const loaded = await backend.loadProject('proj-123');
    expect(loaded).not.toBeNull();
    expect(loaded!.files['app/page.tsx']).toBe('cached work');
  });

  it('refuses to save an empty project with 0 files to prevent clobbering', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    localStorage.setItem('revyme-project-proj-123', JSON.stringify({
      format: 'revyme-v1',
      files: { 'app/page.tsx': 'valid content' },
    }));
    await expect(backend.saveProject('proj-123', { format: 'revyme-v1', files: {} })).rejects.toThrow(/empty/);
    expect(fetchSpy).not.toHaveBeenCalled();
    // LocalStorage still has previous valid work
    const raw = JSON.parse(localStorage.getItem('revyme-project-proj-123')!);
    expect(raw.files['app/page.tsx']).toBe('valid content');
  });
});
