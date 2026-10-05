// local-backend.ts — Standalone (no cloud) implementation supporting both
// disk server storage (/api/projects) and localStorage fallback.

import type { ProjectBackend, ProjectData, RevymeUser, WorkspaceFont } from './types';
import { isKnownProjectFormat } from './types';
import { trace } from '@/shared/debug-trace';

const STORAGE_PREFIX = 'revyme-project-';
const NAME_PREFIX = 'revyme:project-name:';

export class LocalBackend implements ProjectBackend {
  async getUser(): Promise<RevymeUser | null> {
    return { id: 'local', name: 'Local User', email: 'local@dev' };
  }

  async loadProject(id: string): Promise<ProjectData | null> {
    // 1. Try server storage first when in browser
    if (typeof window !== 'undefined' && typeof fetch === 'function') {
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(id)}`);
        if (res.ok) {
          const json = await res.json();
          if (json?.data && typeof json.data === 'object' && json.data.files && Object.keys(json.data.files).length > 0) {
            if (json.name && window.localStorage) {
              localStorage.setItem(NAME_PREFIX + id, json.name);
            }
            if (!isKnownProjectFormat(json.data.format)) {
              trace.error('local-backend:unknown-format', { id, format: json.data.format, fileCount: Object.keys(json.data.files).length });
            }
            trace.action('backend:load-project', { id, source: 'server', fileCount: Object.keys(json.data.files).length });
            return json.data as ProjectData;
          }
        }
      } catch {
        // server unreachable / test environment
      }
    }

    // 2. Fall back to localStorage
    const key = STORAGE_PREFIX + id;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const data = JSON.parse(raw) as ProjectData;
      const fileCount = data?.files ? Object.keys(data.files).length : 0;
      if (fileCount === 0) return null;
      if (!isKnownProjectFormat(data.format)) {
        trace.error('local-backend:unknown-format', { id, format: data.format, fileCount });
      }
      trace.action('backend:load-project', { id, source: 'localStorage', fileCount });
      return data;
    } catch (err) {
      trace.error('local-backend:load-error', { id, error: String(err) });
      return null;
    }
  }

  async saveProject(id: string, data: ProjectData): Promise<void> {
    const key = STORAGE_PREFIX + id;
    try {
      localStorage.setItem(key, JSON.stringify(data));
      trace.action('backend:save-project', { id, source: 'localStorage', fileCount: Object.keys(data.files).length });
    } catch {
      // ignore localStorage quota error if storage is full
    }

    // Also persist to server storage API
    if (typeof window !== 'undefined' && typeof fetch === 'function') {
      try {
        const name = localStorage.getItem(NAME_PREFIX + id) || undefined;
        await fetch(`/api/projects/${encodeURIComponent(id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data, name }),
        });
        trace.action('backend:save-project', { id, source: 'server', fileCount: Object.keys(data.files).length });
      } catch {
        // offline / mock
      }
    }
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
        const res = await fetch(`/api/projects/${encodeURIComponent(id)}`);
        if (res.ok) {
          const json = await res.json();
          if (json?.name) return json.name;
        }
      } catch {
        // offline / mock
      }
    }
    return null;
  }

  async uploadAsset(_id: string, file: File): Promise<string> {
    // 1. Try server storage upload first
    if (typeof window !== 'undefined' && typeof fetch === 'function') {
      try {
        const res = await fetch(`/api/upload?filename=${encodeURIComponent(file.name)}`, {
          method: 'POST',
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
          body: file,
        });
        if (res.ok) {
          const json = await res.json();
          if (json?.url) {
            trace.action('backend:upload-asset', { source: 'server', name: file.name, url: json.url });
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

  async deleteAssets(_id: string, keys: string[]): Promise<void> {
    trace.action('backend:delete-assets', { source: 'local-noop', count: keys.length });
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
