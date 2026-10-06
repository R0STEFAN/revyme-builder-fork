import type { ProjectData } from './types';
import { createEmptyProject } from '@/code/project/project-fs';

export interface LocalProjectItem {
  id: string;
  name: string;
  fileCount: number;
  updatedAt: number;
  createdAt: number;
  isLocalStorageOnly?: boolean;
  folderId?: string | null;
}

export interface ProjectFolder {
  id: string;
  name: string;
  createdAt: number;
}

const STORAGE_PREFIX = 'revyme-project-';
const NAME_PREFIX = 'revyme:project-name:';
const FOLDER_PROJECT_PREFIX = 'revyme:project-folder:';
const FOLDERS_KEY = 'revyme:folders';

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
          const localFolderId =
            typeof window !== 'undefined' && window.localStorage
              ? localStorage.getItem(FOLDER_PROJECT_PREFIX + p.id)
              : null;
          itemsMap.set(p.id, {
            ...p,
            isLocalStorageOnly: false,
            folderId: localFolderId !== null ? localFolderId : (p.folderId ?? null),
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
            const folderId = localStorage.getItem(FOLDER_PROJECT_PREFIX + id) || null;
            itemsMap.set(id, {
              id,
              name,
              fileCount,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              isLocalStorageOnly: true,
              folderId,
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
    const folderId =
      typeof window !== 'undefined' && window.localStorage
        ? localStorage.getItem(FOLDER_PROJECT_PREFIX + 'local') || null
        : null;
    itemsMap.set('local', {
      id: 'local',
      name: 'Default Website',
      fileCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isLocalStorageOnly: false,
      folderId,
    });
  }

  return Array.from(itemsMap.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Create a new project on the server (and seed in localStorage).
 */
export async function createProject(
  name?: string,
  initialData?: ProjectData,
  folderId?: string | null
): Promise<LocalProjectItem> {
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
        body: JSON.stringify({ id, name: finalName, data, folderId: folderId ?? null }),
      });
      if (res.ok) {
        const saved = (await res.json()) as LocalProjectItem;
        if (window.localStorage) {
          localStorage.setItem(NAME_PREFIX + id, finalName);
          localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(data));
          if (folderId) localStorage.setItem(FOLDER_PROJECT_PREFIX + id, folderId);
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
    if (folderId) localStorage.setItem(FOLDER_PROJECT_PREFIX + id, folderId);
  }

  return {
    id,
    name: finalName,
    fileCount: Object.keys(data.files).length,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isLocalStorageOnly: true,
    folderId: folderId ?? null,
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
    localStorage.removeItem(FOLDER_PROJECT_PREFIX + id);
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
        const copy = (await res.json()) as LocalProjectItem;
        if (typeof window !== 'undefined' && window.localStorage) {
          const sourceFolder = localStorage.getItem(FOLDER_PROJECT_PREFIX + id);
          if (sourceFolder) {
            localStorage.setItem(FOLDER_PROJECT_PREFIX + copy.id, sourceFolder);
          }
        }
        return copy;
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

    const sourceFolder = localStorage.getItem(FOLDER_PROJECT_PREFIX + id);
    if (sourceFolder) {
      localStorage.setItem(FOLDER_PROJECT_PREFIX + newId, sourceFolder);
    }

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
      folderId: sourceFolder || null,
    };
  }

  return null;
}

/**
 * Fetch all folders from server API and localStorage fallback.
 */
export async function listAllFolders(): Promise<ProjectFolder[]> {
  const foldersMap = new Map<string, ProjectFolder>();

  // 1. Fetch from server API
  if (typeof fetch === 'function' && typeof window !== 'undefined') {
    try {
      const res = await fetch('/api/folders');
      if (res.ok) {
        const serverList = (await res.json()) as ProjectFolder[];
        for (const f of serverList) {
          foldersMap.set(f.id, f);
        }
      }
    } catch {
      // Server not reachable
    }
  }

  // 2. LocalStorage merge
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const raw = localStorage.getItem(FOLDERS_KEY);
      if (raw) {
        const localList = JSON.parse(raw) as ProjectFolder[];
        if (Array.isArray(localList)) {
          for (const f of localList) {
            if (!foldersMap.has(f.id)) {
              foldersMap.set(f.id, f);
            }
          }
        }
      }
    } catch {
      // ignore
    }
  }

  return Array.from(foldersMap.values()).sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * Create a new folder on server and localStorage.
 */
export async function createFolder(name: string): Promise<ProjectFolder> {
  const finalName = name.trim() || 'New Folder';
  const id = `folder-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const folder: ProjectFolder = {
    id,
    name: finalName,
    createdAt: Date.now(),
  };

  if (typeof fetch === 'function' && typeof window !== 'undefined') {
    try {
      const res = await fetch('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: finalName }),
      });
      if (res.ok) {
        const saved = (await res.json()) as ProjectFolder;
        syncFolderToLocalStorage(saved);
        return saved;
      }
    } catch {
      // fallback
    }
  }

  syncFolderToLocalStorage(folder);
  return folder;
}

/**
 * Rename an existing folder.
 */
export async function renameFolder(id: string, name: string): Promise<boolean> {
  const finalName = name.trim();
  if (!finalName) return false;

  let ok = false;
  if (typeof fetch === 'function' && typeof window !== 'undefined') {
    try {
      const res = await fetch(`/api/folders/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: finalName }),
      });
      ok = res.ok;
    } catch {
      // fallback
    }
  }

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const raw = localStorage.getItem(FOLDERS_KEY);
      if (raw) {
        const list = JSON.parse(raw) as ProjectFolder[];
        const idx = list.findIndex((f) => f.id === id);
        if (idx !== -1) {
          list[idx].name = finalName;
          localStorage.setItem(FOLDERS_KEY, JSON.stringify(list));
          ok = true;
        }
      }
    } catch {
      // ignore
    }
  }

  return ok;
}

/**
 * Delete a folder. Projects in the folder are unassigned.
 */
export async function deleteFolder(id: string): Promise<boolean> {
  let ok = false;
  if (typeof fetch === 'function' && typeof window !== 'undefined') {
    try {
      const res = await fetch(`/api/folders/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      ok = res.ok;
    } catch {
      // fallback
    }
  }

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const raw = localStorage.getItem(FOLDERS_KEY);
      if (raw) {
        const list = JSON.parse(raw) as ProjectFolder[];
        const next = list.filter((f) => f.id !== id);
        localStorage.setItem(FOLDERS_KEY, JSON.stringify(next));
        ok = true;
      }
      // Unassign any project in localStorage assigned to this folder
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(FOLDER_PROJECT_PREFIX)) {
          if (localStorage.getItem(key) === id) {
            localStorage.removeItem(key);
          }
        }
      }
    } catch {
      // ignore
    }
  }

  return ok;
}

/**
 * Move or unassign a project to/from a folder.
 */
export async function setProjectFolder(projectId: string, folderId: string | null): Promise<boolean> {
  let ok = false;
  if (typeof fetch === 'function' && typeof window !== 'undefined') {
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId }),
      });
      ok = res.ok;
    } catch {
      // fallback
    }
  }

  if (typeof window !== 'undefined' && window.localStorage) {
    if (folderId) {
      localStorage.setItem(FOLDER_PROJECT_PREFIX + projectId, folderId);
    } else {
      localStorage.removeItem(FOLDER_PROJECT_PREFIX + projectId);
    }
    ok = true;
  }

  return ok;
}

function syncFolderToLocalStorage(folder: ProjectFolder) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const raw = localStorage.getItem(FOLDERS_KEY);
    const list = raw ? (JSON.parse(raw) as ProjectFolder[]) : [];
    const idx = list.findIndex((f) => f.id === folder.id);
    if (idx >= 0) {
      list[idx] = folder;
    } else {
      list.push(folder);
    }
    localStorage.setItem(FOLDERS_KEY, JSON.stringify(list));
  } catch {
    // ignore
  }
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
        // Migration imports missing projects only; browser caches may be stale.
        const existing = await fetch(`/api/projects/${encodeURIComponent(id)}`);
        if (existing.status !== 404) continue;
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
