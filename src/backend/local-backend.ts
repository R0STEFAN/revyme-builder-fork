// local-backend.ts — Standalone (no cloud) implementation supporting both
// disk server storage (/api/projects) and localStorage fallback.

import type { ProjectBackend, ProjectData, ProjectSaveMeta, RevymeUser, WorkspaceFont } from './types';
import { isKnownProjectFormat } from './types';
import { trace } from '@/shared/debug-trace';
import { getProjectId } from './project-id';

const STORAGE_PREFIX = 'revyme-project-';
const NAME_PREFIX = 'revyme:project-name:';
const UNSYNCED_FIELD = '__revymeUnsynced';
const REVISION_FIELD = '__revymePersistenceRevision';
const observedRevisions = new Map<string, number>();
const PROJECT_GET_TIMEOUT_MS = 5_000;

async function fetchProjectRow(id: string): Promise<{ res: Response; json: any }> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`Project GET timed out after ${PROJECT_GET_TIMEOUT_MS}ms`));
    }, PROJECT_GET_TIMEOUT_MS);
  });
  try {
    // Race also covers fetch mocks/transports that do not settle on abort and
    // a response body whose JSON stream stalls after headers arrive.
    return await Promise.race([
      (async () => {
        const res = await fetch(`/api/projects/${encodeURIComponent(id)}`, { signal: controller.signal });
        return { res, json: res.ok ? await res.json() : null };
      })(),
      timeout,
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function readRevision(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function observeRevision(id: string, revision: number | null): void {
  if (revision !== null) observedRevisions.set(id, Math.max(observedRevisions.get(id) ?? 0, revision));
}

export class LocalBackend implements ProjectBackend {
  async getUser(): Promise<RevymeUser | null> {
    return { id: 'local', name: 'Local User', email: 'local@dev' };
  }

  async loadProject(id: string): Promise<ProjectData | null> {
    let serverError: Error | null = null;
    const readLocal = (): { data: ProjectData; unsynced: boolean; revision: number | null } | null => {
      const raw = localStorage.getItem(STORAGE_PREFIX + id);
      if (!raw) return null;
      const stored = JSON.parse(raw) as ProjectData & { [UNSYNCED_FIELD]?: boolean; [REVISION_FIELD]?: number };
      const { [UNSYNCED_FIELD]: unsynced, [REVISION_FIELD]: rawRevision, ...data } = stored;
      const fileCount = data?.files ? Object.keys(data.files).length : 0;
      if (fileCount === 0) return null;
      const revision = readRevision(rawRevision);
      observeRevision(id, revision);
      if (!isKnownProjectFormat(data.format)) {
        trace.error('local-backend:unknown-format', { id, format: data.format, fileCount });
      }
      return { data: data as ProjectData, unsynced: unsynced === true, revision };
    };

    // A failed server PUT leaves an older row behind. The local snapshot is
    // the newer recovery copy until a later PUT acknowledges it.
    let local: ReturnType<typeof readLocal> = null;
    try {
      local = readLocal();
    } catch (err) {
      trace.error('local-backend:load-error', { id, error: String(err) });
    }

    // 1. Try server storage first when in browser
    let server: { data: ProjectData; revision: number | null } | null = null;
    if (typeof window !== 'undefined' && typeof fetch === 'function') {
      try {
        const { res, json } = await fetchProjectRow(id);
        if (res.ok) {
          if (json?.data && typeof json.data === 'object' && json.data.files && Object.keys(json.data.files).length > 0) {
            if (json.name && window.localStorage) {
              try { localStorage.setItem(NAME_PREFIX + id, json.name); } catch { /* optional cached name */ }
            }
            const { [REVISION_FIELD]: rawRevision, [UNSYNCED_FIELD]: _unsynced, ...serverData } = json.data;
            const revision = readRevision(rawRevision);
            observeRevision(id, revision);
            if (!isKnownProjectFormat(serverData.format)) {
              trace.error('local-backend:unknown-format', { id, format: serverData.format, fileCount: Object.keys(serverData.files).length });
            }
            server = { data: serverData as ProjectData, revision };
          }
        } else if (res.status >= 500) {
          serverError = new Error(`Server returned HTTP ${res.status}`);
        }
      } catch (err) {
        // In Node/vitest test environment without an origin, relative fetch throws Invalid/Failed to parse URL.
        const isRelativeUrlError =
          err instanceof TypeError &&
          (err.message.includes('Invalid URL') || err.message.includes('Failed to parse URL'));
        if (!isRelativeUrlError) {
          serverError = err instanceof Error ? err : new Error(String(err));
        }
      }
    }

    // An unsynced local copy beats a legacy server row, or a server row
    // carrying an older revision. An acknowledged equal/newer server revision
    // wins even if quota prevented clearing the local recovery marker.
    if (local?.unsynced && (!server || server.revision === null ||
      (local.revision !== null && server.revision < local.revision))) {
      trace.action('backend:load-project', { id, source: 'localStorage', fileCount: Object.keys(local.data.files).length });
      return local.data;
    }
    if (server) {
      trace.action('backend:load-project', { id, source: 'server', fileCount: Object.keys(server.data.files).length });
      return server.data;
    }

    // 2. Fall back to localStorage
    if (local) {
      trace.action('backend:load-project', { id, source: 'localStorage', fileCount: Object.keys(local.data.files).length });
      return local.data;
    }

    // 3. If the server was unreachable or failed with 5xx, and localStorage did not have it,
    // throw to prevent the caller (ProjectLoader) from treating this as an empty project and overwriting it.
    if (serverError) {
      trace.error('local-backend:server-unreachable', { id, error: serverError.message });
      throw new Error(`Failed to load project "${id}" from server: ${serverError.message}`);
    }

    return null;
  }

  async saveProject(id: string, data: ProjectData, meta?: ProjectSaveMeta): Promise<void> {
    const fileCount = data?.files ? Object.keys(data.files).length : 0;
    if (fileCount === 0) {
      trace.error('local-backend:refuse-empty-save', { id });
      throw new Error('Cannot save an empty project');
    }

    const key = STORAGE_PREFIX + id;
    // ProjectLoader normally observes both copies before edits begin. Read
    // local metadata again so direct saves also advance its revision.
    let localRevisionReadable = true;
    try {
      const old = localStorage.getItem(key);
      if (old) observeRevision(id, readRevision((JSON.parse(old) as Record<string, unknown>)[REVISION_FIELD]));
    } catch (err) {
      localRevisionReadable = false;
      trace.error('local-backend:revision-read-error', { id, error: String(err) });
    }
    const revision = Math.max(Date.now(), observedRevisions.get(id) ?? 0) + 1;
    observeRevision(id, revision);
    const serverData = { ...data, [REVISION_FIELD]: revision };
    let localSaved = false;
    let localError: unknown;
    try {
      // Keep the recovery flag in the same atomic storage write as the
      // snapshot. A second key can fail quota after the data write succeeds.
      localStorage.setItem(key, JSON.stringify({ ...serverData, [UNSYNCED_FIELD]: true }));
      localSaved = true;
      trace.action('backend:save-project', { id, source: 'localStorage', fileCount: Object.keys(data.files).length });
    } catch (err) {
      localError = err;
      trace.error('local-backend:local-save-error', { id, error: String(err) });
    }
    if (!localSaved && !localRevisionReadable) {
      throw new Error('Cannot order server save against unreadable local recovery revision');
    }

    // Also persist to server storage API
    if (typeof window !== 'undefined' && typeof fetch === 'function') {
      try {
        let name: string | undefined;
        try { name = localStorage.getItem(NAME_PREFIX + id) || undefined; } catch { /* optional cached name */ }
        const res = await fetch(`/api/projects/${encodeURIComponent(id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            data: serverData,
            name,
            source: meta?.source,
            label: meta?.label,
            branchId: meta?.branchId,
            changesSummary: meta?.changesSummary,
          }),
        });
        if (!res.ok) throw new Error(`Server returned HTTP ${res.status}`);
        if (localSaved) {
          try { localStorage.setItem(key, JSON.stringify(serverData)); } catch { /* recovery flag may outlive a successful PUT */ }
        }
        trace.action('backend:save-project', { id, source: 'server', fileCount: Object.keys(data.files).length });
        return;
      } catch (err) {
        const isRelativeUrlError = err instanceof TypeError &&
          (err.message.includes('Invalid URL') || err.message.includes('Failed to parse URL'));
        if (!isRelativeUrlError || !localSaved) {
          trace.error('local-backend:server-save-error', { id, error: String(err) });
          throw err;
        }
      }
    }
    if (!localSaved) throw localError instanceof Error ? localError : new Error('Local save failed');
  }

  async listVersions(id: string, branchId?: string): Promise<any[]> {
    if (typeof window !== 'undefined' && typeof fetch === 'function') {
      try {
        const query = branchId ? `?branchId=${encodeURIComponent(branchId)}` : '';
        const res = await fetch(`/api/projects/${encodeURIComponent(id)}/versions${query}`);
        if (res.ok) {
          const json = await res.json();
          return json.versions || [];
        }
      } catch {
        // offline
      }
    }
    return [];
  }

  async getVersion(id: string, versionId: string): Promise<any | null> {
    if (typeof window !== 'undefined' && typeof fetch === 'function') {
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}`);
        if (res.ok) {
          return await res.json();
        }
      } catch {
        // offline
      }
    }
    return null;
  }

  async restoreVersion(id: string, versionId: string): Promise<{ success: boolean; project?: any; version?: any } | null> {
    if (typeof window !== 'undefined' && typeof fetch === 'function') {
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}/restore`, {
          method: 'POST',
        });
        if (res.ok) {
          return await res.json();
        }
      } catch {
        // offline
      }
    }
    return null;
  }

  async deleteVersion(id: string, versionId: string): Promise<boolean> {
    if (typeof window !== 'undefined' && typeof fetch === 'function') {
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}`, {
          method: 'DELETE',
        });
        return res.ok;
      } catch {
        // offline
      }
    }
    return false;
  }

  async renameWebsite(id: string, name: string): Promise<void> {
    trace.action('backend:rename-website', { id, name, source: 'local' });
    if (typeof window !== 'undefined' && typeof fetch === 'function') {
      try {
        await fetch(`/api/projects/${encodeURIComponent(id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        });
      } catch {
        // offline / mock
      }
    }
  }

  async getWebsiteName(id: string): Promise<string | null> {
    if (typeof window !== 'undefined' && typeof fetch === 'function') {
      try {
        const { res, json } = await fetchProjectRow(id);
        if (res.ok) {
          if (json?.name) return json.name;
        }
      } catch {
        // offline / mock
      }
    }
    return null;
  }

  async uploadAsset(id: string, file: File): Promise<string> {
    // 1. Try server storage upload first
    if (typeof window !== 'undefined' && typeof fetch === 'function') {
      try {
        const websiteId = id || getProjectId() || 'local';
        const res = await fetch(`/api/upload?filename=${encodeURIComponent(file.name)}&websiteId=${encodeURIComponent(websiteId)}`, {
          method: 'POST',
          headers: {
            'Content-Type': file.type || 'application/octet-stream',
            'x-website-id': websiteId,
          },
          body: file,
        });
        if (res.ok) {
          const json = await res.json();
          if (json?.url) {
            trace.action('backend:upload-asset', { source: 'server', name: file.name, url: json.url, websiteId });
            return json.url;
          }
        }
      } catch {
        // fallback
      }
    }

    // 2. Standalone (no-server) fallback: base64 data URL
    const url = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
    trace.action('backend:upload-asset', { source: 'dataURL', name: file.name, bytes: file.size });
    return url;
  }

  async deleteAssets(id: string, keys: string[]): Promise<void> {
    trace.action('backend:delete-assets', { source: 'local', id, count: keys.length });
    if (typeof window !== 'undefined' && typeof fetch === 'function') {
      try {
        const websiteId = id || getProjectId() || 'local';
        await fetch(`/api/upload?websiteId=${encodeURIComponent(websiteId)}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ websiteId, keys }),
        });
      } catch {
        // offline / mock
      }
    }
  }

  async fetchMediaBytes(remoteUrl: string): Promise<Blob> {
    const res = await fetch(remoteUrl);
    if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
    trace.action('backend:fetch-media-bytes', { source: 'direct' });
    return res.blob();
  }

  async getWebsiteRole(_id: string): Promise<'owner' | 'editor' | 'viewer'> {
    return 'owner';
  }

  async getWebsiteClosedSource(_id: string): Promise<boolean> {
    return false;
  }

  async getWebsiteWorkspaceId(_id: string): Promise<string | null> {
    return null;
  }

  async getCredits(_workspaceId: string): Promise<number | null> {
    return null;
  }

  async listWorkspaceFonts(_workspaceId: string): Promise<WorkspaceFont[]> {
    return [];
  }
}
