import type { ProjectData } from './types';
import { createEmptyProject } from '@/code/project/project-fs';

export interface LocalProjectItem {
  id: string;
  name: string;
  fileCount: number;
  updatedAt: number;
  createdAt: number;
  isLocalStorageOnly?: boolean;
}

const STORAGE_PREFIX = 'revyme-project-';
const NAME_PREFIX = 'revyme:project-name:';

/**
 * Fetch all projects from the server API, merged with any pending in localStorage.
 */
export async function listAllProjects(): Promise<LocalProjectItem[]> {
  const itemsMap = new Map<string, LocalProjectItem>();

  // 1. Fetch from server API
  if (typeof fetch === 'function' && typeof window !== 'undefined') {
    try {
      const res = await fetch('/api/projects');
      if (res.ok) {
        const serverList = (await res.json()) as LocalProjectItem[];
        for (const p of serverList) {
          itemsMap.set(p.id, {
            ...p,
            isLocalStorageOnly: false,
          });
        }
      }
    } catch {
      // Server not reachable
    }
  }

  // 2. Scan localStorage for any projects not on server (or offline mode)
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(STORAGE_PREFIX)) {
          const id = key.slice(STORAGE_PREFIX.length);
          if (!itemsMap.has(id)) {
            const raw = localStorage.getItem(key);
            let fileCount = 0;
            try {
              const parsed = JSON.parse(raw || '{}');
              fileCount = parsed.files ? Object.keys(parsed.files).length : 0;
            } catch {
              // ignore
            }
            const name = localStorage.getItem(NAME_PREFIX + id) || (id === 'local' ? 'Default Website' : 'Untitled Website');
            itemsMap.set(id, {
              id,
              name,
              fileCount,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              isLocalStorageOnly: true,
            });
          }
        }
      }
    } catch {
      // ignore localStorage errors
    }
  }

  // 3. If completely empty, seed at least 'local'
  if (itemsMap.size === 0) {
    itemsMap.set('local', {
      id: 'local',
      name: 'Default Website',
      fileCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isLocalStorageOnly: false,
    });
  }

  return Array.from(itemsMap.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Create a new project on the server (and seed in localStorage).
 */
export async function createProject(name?: string, initialData?: ProjectData): Promise<LocalProjectItem> {
  const id = `proj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const finalName = (name && name.trim()) || 'Untitled Website';
  const data: ProjectData = initialData || {
    format: 'revyme-v1',
    files: Object.fromEntries(createEmptyProject()),
  };

  // 1. Try server
  if (typeof fetch === 'function' && typeof window !== 'undefined') {
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name: finalName, data }),
      });
      if (res.ok) {
        const saved = (await res.json()) as LocalProjectItem;
        if (window.localStorage) {
          localStorage.setItem(NAME_PREFIX + id, finalName);
          localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(data));
        }
        return saved;
      }
    } catch {
      // fallback
    }
  }

  // 2. Fallback to localStorage
  if (typeof window !== 'undefined' && window.localStorage) {
    localStorage.setItem(NAME_PREFIX + id, finalName);
    localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(data));
  }

  return {
    id,
    name: finalName,
    fileCount: Object.keys(data.files).length,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isLocalStorageOnly: true,
  };
}

/**
 * Delete a project by ID from both server and localStorage.
 */
export async function deleteProject(id: string): Promise<boolean> {
  let ok = false;

  if (typeof fetch === 'function' && typeof window !== 'undefined') {
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      ok = res.ok;
    } catch {
      // fallback
    }
  }

  if (typeof window !== 'undefined' && window.localStorage) {
    localStorage.removeItem(STORAGE_PREFIX + id);
    localStorage.removeItem(NAME_PREFIX + id);
    ok = true;
  }

  return ok;
}

/**
 * Duplicate a project.
 */
export async function duplicateProject(id: string, newName?: string): Promise<LocalProjectItem | null> {
  // 1. Try server
  if (typeof fetch === 'function' && typeof window !== 'undefined') {
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(id)}/duplicate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName }),
      });
      if (res.ok) {
        return (await res.json()) as LocalProjectItem;
      }
    } catch {
      // fallback
    }
  }

  // 2. Fallback localStorage
  if (typeof window !== 'undefined' && window.localStorage) {
    const raw = localStorage.getItem(STORAGE_PREFIX + id);
    if (!raw) return null;
    const oldName = localStorage.getItem(NAME_PREFIX + id) || 'Untitled';
    const copyName = newName || `${oldName} (Copy)`;
    const newId = `proj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem(STORAGE_PREFIX + newId, raw);
    localStorage.setItem(NAME_PREFIX + newId, copyName);

    let fileCount = 0;
    try {
      const parsed = JSON.parse(raw);
      fileCount = parsed.files ? Object.keys(parsed.files).length : 0;
    } catch {
      // ignore
    }

    return {
      id: newId,
      name: copyName,
      fileCount,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isLocalStorageOnly: true,
    };
  }

  return null;
}

/**
 * Migrate any localStorage projects to the server.
 */
export async function migrateLocalStorageProjectsToServer(): Promise<number> {
  if (typeof window === 'undefined' || !window.localStorage || typeof fetch !== 'function') {
    return 0;
  }

  let count = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(STORAGE_PREFIX)) {
      const id = key.slice(STORAGE_PREFIX.length);
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try {
        const data = JSON.parse(raw);
        const name = localStorage.getItem(NAME_PREFIX + id) || (id === 'local' ? 'My First Website' : 'Website');
        const res = await fetch(`/api/projects/${encodeURIComponent(id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data, name }),
        });
        if (res.ok) count++;
      } catch (err) {
        console.error('[Migration] Failed to migrate project:', id, err);
      }
    }
  }

  return count;
}
