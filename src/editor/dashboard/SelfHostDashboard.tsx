// SelfHostDashboard.tsx — Dashboard for self-hosted Revyme instances.
// Displays all projects saved on disk (and localStorage fallback), allowing
// users to open, create, rename, duplicate, export, and delete projects.

import { useState, useEffect, useMemo, useRef } from 'react';
import {
  listAllProjects,
  createProject,
  deleteProject,
  duplicateProject,
  migrateLocalStorageProjectsToServer,
  listAllFolders,
  createFolder,
  renameFolder,
  deleteFolder,
  setProjectFolder,
  type LocalProjectItem,
  type ProjectFolder,
} from '@/backend/local-projects';
import Button from '@/design-system/Button';
import Modal from '@/design-system/Modal';
import ConfirmDialog from '@/design-system/ConfirmDialog';
import { toast } from 'sonner';
import { trace } from '@/shared/debug-trace';
import { parseCustomFontsFromCss, syncProjectCustomFontsFromCss } from '@/code/stores/workspace-fonts-store';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(timestamp: number): string {
  const diff = Math.floor((Date.now() - timestamp) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} d ago`;
  return new Date(timestamp).toLocaleDateString();
}

// ─── Revyme Logo ─────────────────────────────────────────────────────────────

function RevymeLogo() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 779.79 1578.33"
      width={18}
      height={28}
      style={{ color: 'var(--text-primary)' }}
    >
      <polygon fill="currentColor" points="0 0 0 464.88 779.79 922.26 779.79 461.13 0 0" />
      <polygon fill="currentColor" points="779.79 1357.14 0 899.76 0 1357.14 408.64 1578.33 779.79 1357.14" />
      <polygon fill="currentColor" points="402.21 700.79 402.21 1135.67 779.79 922.26 402.21 700.79" />
    </svg>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function SelfHostDashboard() {
  const [projects, setProjects] = useState<LocalProjectItem[]>([]);
  const [folders, setFolders] = useState<ProjectFolder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [newModalOpen, setNewModalOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [creating, setCreating] = useState(false);

  // Rename modal state
  const [renameItem, setRenameItem] = useState<LocalProjectItem | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Delete confirm state
  const [deleteItem, setDeleteItem] = useState<LocalProjectItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Folder modal states
  const [newFolderModalOpen, setNewFolderModalOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);

  const [renameFolderItem, setRenameFolderItem] = useState<ProjectFolder | null>(null);
  const [renameFolderName, setRenameFolderName] = useState('');

  const [deleteFolderItem, setDeleteFolderItem] = useState<ProjectFolder | null>(null);
  const [deletingFolder, setDeletingFolder] = useState(false);

  // Active dropdown menu for project card folder assignment
  const [activeFolderMenuProjectId, setActiveFolderMenuProjectId] = useState<string | null>(null);

  // Hidden file input for project import
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [exportingBundleId, setExportingBundleId] = useState<string | null>(null);

  const fetchProjects = async () => {
    try {
      setLoading(true);
      const list = await listAllProjects();
      setProjects(list);
    } catch (err) {
      console.error('Failed to load projects:', err);
      toast.error('Failed to load projects');
    } finally {
      setLoading(false);
    }
  };

  const fetchFolders = async () => {
    try {
      const list = await listAllFolders();
      setFolders(list);
    } catch (err) {
      console.error('Failed to load folders:', err);
    }
  };

  useEffect(() => {
    fetchProjects();
    fetchFolders();
  }, []);

  // Close folder menu on click outside
  useEffect(() => {
    if (!activeFolderMenuProjectId) return;
    const handleClickOutside = () => setActiveFolderMenuProjectId(null);
    window.addEventListener('click', handleClickOutside);
    return () => window.removeEventListener('click', handleClickOutside);
  }, [activeFolderMenuProjectId]);

  const projectCountByFolder = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of projects) {
      if (p.folderId) {
        counts.set(p.folderId, (counts.get(p.folderId) || 0) + 1);
      }
    }
    return counts;
  }, [projects]);

  const selectedFolder = useMemo(() => {
    return folders.find((f) => f.id === selectedFolderId) || null;
  }, [folders, selectedFolderId]);

  const filteredProjects = useMemo(() => {
    let list = projects;
    if (selectedFolderId !== null) {
      list = list.filter((p) => p.folderId === selectedFolderId);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)
      );
    }
    return list;
  }, [projects, selectedFolderId, search]);

  const hasLocalStorageOnly = useMemo(() => {
    return projects.some((p) => p.isLocalStorageOnly);
  }, [projects]);

  // Actions
  const handleOpen = (id: string) => {
    trace.action('dashboard:open-project', { id });
    if (id === 'local') {
      window.location.href = '/builder';
    } else {
      window.location.href = `/builder/${encodeURIComponent(id)}`;
    }
  };

  const handleCreate = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (creating) return;
    try {
      setCreating(true);
      const name = newProjectName.trim() || 'Untitled Website';
      const created = await createProject(name, undefined, selectedFolderId);
      toast.success('Project created');
      setNewModalOpen(false);
      setNewProjectName('');
      handleOpen(created.id);
    } catch (err: any) {
      toast.error(err.message || 'Failed to create project');
      setCreating(false);
    }
  };

  const handleCreateFolder = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (creatingFolder) return;
    const trimmed = newFolderName.trim();
    if (!trimmed) return;
    try {
      setCreatingFolder(true);
      const created = await createFolder(trimmed);
      toast.success('Folder created');
      setNewFolderModalOpen(false);
      setNewFolderName('');
      await fetchFolders();
      setSelectedFolderId(created.id);
    } catch {
      toast.error('Failed to create folder');
    } finally {
      setCreatingFolder(false);
    }
  };

  const handleRenameFolder = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!renameFolderItem) return;
    const trimmed = renameFolderName.trim();
    if (!trimmed) return;
    try {
      await renameFolder(renameFolderItem.id, trimmed);
      toast.success('Folder renamed');
      setRenameFolderItem(null);
      await fetchFolders();
    } catch {
      toast.error('Failed to rename folder');
    }
  };

  const handleDeleteFolderConfirm = async () => {
    if (!deleteFolderItem) return;
    try {
      setDeletingFolder(true);
      await deleteFolder(deleteFolderItem.id);
      toast.success('Folder deleted');
      if (selectedFolderId === deleteFolderItem.id) {
        setSelectedFolderId(null);
      }
      setDeleteFolderItem(null);
      await fetchFolders();
      await fetchProjects();
    } catch {
      toast.error('Failed to delete folder');
    } finally {
      setDeletingFolder(false);
    }
  };

  const handleSetProjectFolder = async (projectId: string, folderId: string | null) => {
    try {
      await setProjectFolder(projectId, folderId);
      const targetFolder = folderId ? folders.find((f) => f.id === folderId) : null;
      if (targetFolder) {
        toast.success(`Moved to "${targetFolder.name}"`);
      } else {
        toast.success('Removed from folder');
      }
      setActiveFolderMenuProjectId(null);
      await fetchProjects();
    } catch {
      toast.error('Failed to update project folder');
    }
  };

  const handleRename = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!renameItem) return;
    const trimmed = renameValue.trim();
    if (!trimmed) return;

    try {
      await fetch(`/api/projects/${encodeURIComponent(renameItem.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      }).catch(() => null);

      if (window.localStorage) {
        localStorage.setItem(`revyme:project-name:${renameItem.id}`, trimmed);
      }

      toast.success('Project renamed');
      setRenameItem(null);
      await fetchProjects();
    } catch {
      toast.error('Failed to rename project');
    }
  };

  const handleDuplicate = async (project: LocalProjectItem) => {
    try {
      toast.info(`Duplicating "${project.name}"...`);
      const copy = await duplicateProject(project.id);
      if (copy) {
        toast.success('Project duplicated');
        await fetchProjects();
      } else {
        toast.error('Failed to duplicate project');
      }
    } catch {
      toast.error('Failed to duplicate project');
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteItem) return;
    try {
      setDeleting(true);
      await deleteProject(deleteItem.id);
      toast.success('Project deleted');
      setDeleteItem(null);
      await fetchProjects();
    } catch {
      toast.error('Failed to delete project');
    } finally {
      setDeleting(false);
    }
  };

  const handleExportBundle = async (project: LocalProjectItem) => {
    try {
      setExportingBundleId(project.id);
      toast.info(`Preparing bundle with assets for "${project.name}"...`);

      let bundleData: any = null;
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(project.id)}/bundle`);
        if (res.ok) {
          bundleData = await res.json();
        }
      } catch {}

      // Fallback for localStorage-only projects
      if (!bundleData) {
        let data: any = null;
        if (window.localStorage) {
          const raw = localStorage.getItem(`revyme-project-${project.id}`);
          if (raw) data = JSON.parse(raw);
        }
        if (!data) {
          toast.error('Project data not found');
          return;
        }

        const serialized = JSON.stringify(data);
        const assetMatches = serialized.matchAll(/(?:\/api)?\/uploads\/([a-zA-Z0-9._-]+)/g);
        const assetFileNames = Array.from(new Set(Array.from(assetMatches, (m) => m[1])));

        const assets: Record<string, { base64: string; mime?: string; size: number }> = {};
        for (const fn of assetFileNames) {
          try {
            const aRes = await fetch(`/api/uploads/${fn}`);
            if (aRes.ok) {
              const blob = await aRes.blob();
              const b64 = await new Promise<string>((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => {
                  const resStr = reader.result as string;
                  resolve(resStr.split(',')[1] || '');
                };
                reader.readAsDataURL(blob);
              });
              assets[fn] = { base64: b64, mime: blob.type, size: blob.size };
            }
          } catch {}
        }

        const globalsCss = data?.files?.['app/globals.css'];
        const customFonts = globalsCss ? parseCustomFontsFromCss(globalsCss) : undefined;

        bundleData = {
          format: 'revyme-bundle-v1',
          id: project.id,
          name: project.name,
          exportedAt: new Date().toISOString(),
          data,
          previewImage: project.previewImage || null,
          folderId: project.folderId || null,
          assets,
          customFonts: customFonts && customFonts.length > 0 ? customFonts : undefined,
        };
      }

      const assetCount = Object.keys(bundleData.assets || {}).length;
      const blob = new Blob([JSON.stringify(bundleData, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${project.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.revyme-bundle.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success(`Bundle downloaded (${assetCount} assets included)`);
    } catch (err) {
      toast.error('Failed to export bundle');
    } finally {
      setExportingBundleId(null);
    }
  };

  const handleExportJson = async (project: LocalProjectItem) => {
    try {
      let data: any = null;
      const res = await fetch(`/api/projects/${encodeURIComponent(project.id)}`);
      if (res.ok) {
        const json = await res.json();
        data = json.data;
      }
      if (!data && window.localStorage) {
        const raw = localStorage.getItem(`revyme-project-${project.id}`);
        if (raw) data = JSON.parse(raw);
      }

      if (!data) {
        toast.error('Project data not found');
        return;
      }

      const exportObj = {
        name: project.name,
        exportedAt: new Date().toISOString(),
        data,
      };

      const blob = new Blob([JSON.stringify(exportObj, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${project.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.revyme.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('JSON export downloaded');
    } catch (err) {
      toast.error('Export failed');
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      toast.info('Reading project file...');
      const text = await file.text();
      const parsed = JSON.parse(text);

      // Check if it's a bundle with assets
      if (parsed.assets && typeof parsed.assets === 'object' && Object.keys(parsed.assets).length > 0) {
        const assetCount = Object.keys(parsed.assets).length;
        toast.info(`Importing bundle with ${assetCount} assets...`);
        try {
          const res = await fetch('/api/projects/import-bundle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(parsed),
          });
          if (res.ok) {
            const json = await res.json();
            const globalsCss = parsed.data?.files?.['app/globals.css'] || parsed.files?.['app/globals.css'];
            if (globalsCss) {
              syncProjectCustomFontsFromCss(globalsCss);
            }
            toast.success(`Imported "${json.project?.name || parsed.name}" with ${json.assetCount ?? assetCount} assets!`);
            await fetchProjects();
            return;
          }
        } catch {}
      }

      // Sync custom fonts in standard import fallback as well
      const globalsCss = parsed.data?.files?.['app/globals.css'] || parsed.files?.['app/globals.css'];
      if (globalsCss) {
        syncProjectCustomFontsFromCss(globalsCss);
      }

      // Standard project import fallback
      const name = parsed.name || file.name.replace(/\.(json|revyme|revyme-bundle)$/i, '');
      const data = parsed.data || parsed;

      const created = await createProject(name, data);
      toast.success(`Imported "${created.name}"`);
      await fetchProjects();
    } catch {
      toast.error('Invalid project file');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleMigrateLocalStorage = async () => {
    toast.info('Syncing local projects to server storage...');
    const count = await migrateLocalStorageProjectsToServer();
    toast.success(`Synced ${count} project(s) to server`);
    await fetchProjects();
  };

  return (
    <div className="min-h-screen bg-[var(--bg-primary,#121214)] text-[var(--text-primary,#e4e4e7)] flex flex-col font-sans">
      {/* ─── Top Navigation Bar ─── */}
      <header className="h-14 border-b border-[var(--border-subtle,rgba(255,255,255,0.08))] px-6 flex items-center justify-between bg-[var(--bg-secondary,#18181b)]">
        <div className="flex items-center gap-3">
          <RevymeLogo />
          <div className="flex items-baseline gap-2">
            <span className="font-bold text-sm tracking-wide">Revyme</span>
            <span className="text-xs text-[var(--text-secondary,#a1a1aa)]">Projects</span>
          </div>
          <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            Self-Hosted
          </span>
        </div>

        <div className="flex items-center gap-3">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleImportFile}
            accept=".json,.revyme,.revyme-bundle"
            className="hidden"
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
          >
            Import Project / Bundle
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setNewProjectName('');
              setNewModalOpen(true);
            }}
          >
            + New Project
          </Button>
        </div>
      </header>

      {/* ─── Body Layout: Folders Sidebar + Main Projects Area ─── */}
      <div className="flex-1 flex w-full">
        {/* ─── Folders Sidebar ─── */}
        <aside className="w-60 md:w-64 shrink-0 border-r border-[var(--border-subtle,rgba(255,255,255,0.08))] bg-[var(--bg-secondary,#18181b)]/40 p-4 md:p-5 flex flex-col gap-4">
          {/* Sidebar Header & + New Folder button */}
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold tracking-wider uppercase text-[var(--text-secondary,#a1a1aa)]">
              Folders
            </span>
            <button
              type="button"
              onClick={() => {
                setNewFolderName('');
                setNewFolderModalOpen(true);
              }}
              className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-[var(--bg-secondary,#18181b)] border border-[var(--border-subtle,rgba(255,255,255,0.1))] hover:border-[var(--accent,#eab308)] hover:text-[var(--text-primary)] text-[var(--text-secondary)] transition-colors"
              title="Create new folder"
            >
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              <span>New Folder</span>
            </button>
          </div>

          {/* Navigation list */}
          <div className="flex flex-col gap-1">
            {/* "All Projects" row */}
            <button
              type="button"
              onClick={() => setSelectedFolderId(null)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                selectedFolderId === null
                  ? 'bg-[var(--accent,#eab308)]/15 text-[var(--accent,#eab308)] font-semibold border border-[var(--accent,#eab308)]/30'
                  : 'text-[var(--text-secondary,#a1a1aa)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover,rgba(255,255,255,0.05))]'
              }`}
            >
              <div className="flex items-center gap-2.5 truncate">
                <svg className="w-4 h-4 shrink-0 opacity-80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="7" height="7" rx="1" />
                  <rect x="14" y="3" width="7" height="7" rx="1" />
                  <rect x="14" y="14" width="7" height="7" rx="1" />
                  <rect x="3" y="14" width="7" height="7" rx="1" />
                </svg>
                <span className="truncate">All Projects</span>
              </div>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-primary,#121214)]/60 text-[var(--text-secondary)]">
                {projects.length}
              </span>
            </button>

            {/* Folder list */}
            {folders.map((folder) => {
              const isSelected = selectedFolderId === folder.id;
              const count = projectCountByFolder.get(folder.id) || 0;
              return (
                <div
                  key={folder.id}
                  className={`group/folder w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                    isSelected
                      ? 'bg-[var(--accent,#eab308)]/15 text-[var(--accent,#eab308)] font-semibold border border-[var(--accent,#eab308)]/30'
                      : 'text-[var(--text-secondary,#a1a1aa)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover,rgba(255,255,255,0.05))]'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedFolderId(folder.id)}
                    className="flex-1 flex items-center gap-2.5 truncate text-left"
                    title={folder.name}
                  >
                    <svg className="w-4 h-4 shrink-0 opacity-80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    </svg>
                    <span className="truncate">{folder.name}</span>
                  </button>

                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-primary,#121214)]/60 text-[var(--text-secondary)] group-hover/folder:hidden">
                      {count}
                    </span>

                    {/* Folder Actions: Rename / Delete */}
                    <div className="hidden group-hover/folder:flex items-center gap-0.5">
                      <button
                        type="button"
                        title="Rename folder"
                        onClick={(e) => {
                          e.stopPropagation();
                          setRenameFolderItem(folder);
                          setRenameFolderName(folder.name);
                        }}
                        className="p-1 rounded hover:bg-white/10 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                      >
                        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        title="Delete folder"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteFolderItem(folder);
                        }}
                        className="p-1 rounded hover:bg-red-500/20 text-[var(--text-secondary)] hover:text-red-400 transition-colors"
                      >
                        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            {folders.length === 0 && (
              <div className="px-3 py-4 text-center border border-dashed border-[var(--border-subtle,rgba(255,255,255,0.06))] rounded-lg">
                <p className="text-[11px] text-[var(--text-secondary,#a1a1aa)]">No folders created</p>
                <button
                  type="button"
                  onClick={() => {
                    setNewFolderName('');
                    setNewFolderModalOpen(true);
                  }}
                  className="text-[11px] text-[var(--accent,#eab308)] hover:underline mt-1"
                >
                  + Add a folder
                </button>
              </div>
            )}
          </div>
        </aside>

        {/* ─── Main Content ─── */}
        <main className="flex-1 max-w-7xl w-full mx-auto p-6 md:p-8 flex flex-col gap-6">
          {/* Banner for localStorage migration */}
          {hasLocalStorageOnly && (
            <div className="p-4 rounded-lg bg-[var(--bg-secondary,#1e1e24)] border border-amber-500/30 flex items-center justify-between">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-semibold text-amber-300">
                  Found projects in browser storage
                </span>
                <span className="text-xs text-[var(--text-secondary,#a1a1aa)]">
                  Sync them to persistent disk storage on your server to avoid browser memory limits.
                </span>
              </div>
              <Button variant="secondary" size="sm" onClick={handleMigrateLocalStorage}>
                Sync to Server
              </Button>
            </div>
          )}

          {/* Search & Counter header */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold tracking-tight">
                {selectedFolder ? selectedFolder.name : 'All Projects'}
              </h1>
              <p className="text-xs text-[var(--text-secondary,#a1a1aa)] mt-0.5">
                {filteredProjects.length}{' '}
                {filteredProjects.length === 1 ? 'project' : 'projects'}{' '}
                {selectedFolder ? 'in this folder' : 'saved on server'}
              </p>
            </div>

            <div className="w-full sm:w-72">
              <input
                type="text"
                placeholder="Search projects..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full px-3 py-1.5 text-xs rounded bg-[var(--bg-secondary,#18181b)] border border-[var(--border-subtle,rgba(255,255,255,0.1))] text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent,#eab308)]"
              />
            </div>
          </div>

          {/* Projects Grid */}
          {loading ? (
            <div className="flex-1 flex items-center justify-center p-12 text-xs text-[var(--text-secondary)]">
              Loading projects...
            </div>
          ) : filteredProjects.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-12 border border-dashed border-[var(--border-subtle,rgba(255,255,255,0.1))] rounded-xl text-center">
              {search ? (
                <>
                  <p className="text-sm font-medium">No projects match &ldquo;{search}&rdquo;</p>
                  <p className="text-xs text-[var(--text-secondary)] mt-1">Try another search term.</p>
                </>
              ) : selectedFolder ? (
                <>
                  <div className="w-12 h-12 rounded-full bg-[var(--bg-secondary,#18181b)] flex items-center justify-center mb-3 text-[var(--text-secondary)]">
                    📁
                  </div>
                  <h3 className="text-base font-semibold">Folder &ldquo;{selectedFolder.name}&rdquo; is empty</h3>
                  <p className="text-xs text-[var(--text-secondary)] max-w-sm mt-1 mb-4">
                    Create a new project in this folder or move existing projects here.
                  </p>
                  <div className="flex items-center gap-2">
                    <Button variant="secondary" onClick={() => setSelectedFolderId(null)}>
                      View All Projects
                    </Button>
                    <Button variant="primary" onClick={() => setNewModalOpen(true)}>
                      + New Project Here
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="w-12 h-12 rounded-full bg-[var(--bg-secondary,#18181b)] flex items-center justify-center mb-3 text-[var(--text-secondary)]">
                    📁
                  </div>
                  <h3 className="text-base font-semibold">No projects yet</h3>
                  <p className="text-xs text-[var(--text-secondary)] max-w-sm mt-1 mb-4">
                    Create your first client site or import an existing project JSON.
                  </p>
                  <Button variant="primary" onClick={() => setNewModalOpen(true)}>
                    Create First Project
                  </Button>
                </>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredProjects.map((p) => (
                <div
                  key={p.id}
                  className="group relative flex flex-col justify-between p-4 rounded-xl bg-[var(--bg-secondary,#18181b)] border border-[var(--border-subtle,rgba(255,255,255,0.08))] hover:border-[var(--border-hover,rgba(255,255,255,0.2))] hover:shadow-lg transition-all duration-150"
                >
                  <div>
                    {/* Card Visual Header */}
                    <div
                      onClick={() => handleOpen(p.id)}
                      className="h-36 rounded-lg bg-gradient-to-br from-[var(--bg-hover,#27272a)] to-[var(--bg-primary,#121214)] border border-[var(--border-subtle,rgba(255,255,255,0.08))] flex flex-col items-center justify-center cursor-pointer group-hover:brightness-105 transition-all overflow-hidden relative"
                    >
                      {p.previewImage ? (
                        <img
                          src={p.previewImage}
                          alt={p.name}
                          className="w-full h-full object-cover object-top transition-transform duration-300 group-hover:scale-105"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded bg-[var(--bg-secondary,#18181b)]/80 flex items-center justify-center text-[var(--text-secondary)]">
                          <svg className="w-5 h-5 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="3" y="3" width="18" height="18" rx="2" />
                            <path d="M3 9h18M9 21V9" />
                          </svg>
                        </div>
                      )}
                      <span className="absolute bottom-2 right-2 text-[10px] text-white/90 bg-black/60 backdrop-blur-md px-1.5 py-0.5 rounded font-medium shadow">
                        {p.fileCount} files
                      </span>
                    </div>

                    {/* Title & Metadata */}
                    <div className="mt-3">
                      <div className="flex items-start justify-between gap-2">
                        <h2
                          onClick={() => handleOpen(p.id)}
                          className="text-sm font-bold truncate cursor-pointer hover:text-[var(--accent,#eab308)] transition-colors flex-1"
                          title={p.name}
                        >
                          {p.name}
                        </h2>

                        {/* Folder Badge & Assignment Menu */}
                        <div className="relative">
                          <button
                            type="button"
                            title="Move to folder"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveFolderMenuProjectId(
                                activeFolderMenuProjectId === p.id ? null : p.id
                              );
                            }}
                            className={`text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1 transition-all ${
                              p.folderId
                                ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20'
                                : 'bg-[var(--bg-hover,rgba(255,255,255,0.06))] text-[var(--text-secondary)] border border-[var(--border-subtle,rgba(255,255,255,0.06))] hover:text-[var(--text-primary)] hover:border-[var(--border-subtle,rgba(255,255,255,0.15))]'
                            }`}
                          >
                            <svg className="w-2.5 h-2.5 opacity-80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                            </svg>
                            <span className="truncate max-w-[80px]">
                              {p.folderId
                                ? (folders.find((f) => f.id === p.folderId)?.name || 'Folder')
                                : '+ Folder'}
                            </span>
                          </button>

                          {/* Folder Selection Popover */}
                          {activeFolderMenuProjectId === p.id && (
                            <div
                              onClick={(e) => e.stopPropagation()}
                              className="absolute right-0 top-full mt-1.5 w-48 rounded-lg bg-[var(--bg-surface,#18181b)] border border-[var(--border-subtle,rgba(255,255,255,0.15))] shadow-xl py-1 z-50 text-xs flex flex-col"
                            >
                              <div className="px-2.5 py-1 text-[10px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider border-b border-[var(--border-subtle,rgba(255,255,255,0.08))]">
                                Move to folder
                              </div>

                              <div className="max-h-48 overflow-y-auto py-1">
                                {folders.map((folder) => {
                                  const isCurrent = p.folderId === folder.id;
                                  return (
                                    <button
                                      key={folder.id}
                                      type="button"
                                      onClick={() => handleSetProjectFolder(p.id, folder.id)}
                                      className={`w-full text-left px-2.5 py-1.5 flex items-center justify-between hover:bg-[var(--bg-hover,rgba(255,255,255,0.08))] transition-colors ${
                                        isCurrent
                                          ? 'text-[var(--accent,#eab308)] font-semibold'
                                          : 'text-[var(--text-primary)]'
                                      }`}
                                    >
                                      <span className="truncate">{folder.name}</span>
                                      {isCurrent && <span className="text-[10px]">✓</span>}
                                    </button>
                                  );
                                })}

                                {folders.length === 0 && (
                                  <div className="px-2.5 py-2 text-[11px] text-[var(--text-secondary)] text-center">
                                    No folders created
                                  </div>
                                )}
                              </div>

                              {p.folderId && (
                                <div className="border-t border-[var(--border-subtle,rgba(255,255,255,0.08))] pt-1">
                                  <button
                                    type="button"
                                    onClick={() => handleSetProjectFolder(p.id, null)}
                                    className="w-full text-left px-2.5 py-1.5 text-red-400 hover:bg-red-500/10 transition-colors"
                                  >
                                    Remove from folder
                                  </button>
                                </div>
                              )}

                              <div className="border-t border-[var(--border-subtle,rgba(255,255,255,0.08))] pt-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setActiveFolderMenuProjectId(null);
                                    setNewFolderName('');
                                    setNewFolderModalOpen(true);
                                  }}
                                  className="w-full text-left px-2.5 py-1.5 text-[var(--accent,#eab308)] hover:bg-[var(--accent,#eab308)]/10 transition-colors"
                                >
                                  + Create new folder
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 mt-1 text-[11px] text-[var(--text-secondary,#a1a1aa)]">
                        <span>Updated {timeAgo(p.updatedAt)}</span>
                        {p.isLocalStorageOnly && (
                          <span className="text-[9px] px-1 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                            browser only
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Card Actions */}
                  <div className="mt-4 pt-3 border-t border-[var(--border-subtle,rgba(255,255,255,0.06))] flex items-center justify-between gap-1">
                    <Button
                      variant="primary"
                      size="sm"
                      className="flex-1"
                      onClick={() => handleOpen(p.id)}
                    >
                      Open Editor
                    </Button>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        title="Move to folder"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveFolderMenuProjectId(
                            activeFolderMenuProjectId === p.id ? null : p.id
                          );
                        }}
                        className="p-1.5 rounded hover:bg-[var(--bg-hover,rgba(255,255,255,0.08))] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                        </svg>
                      </button>

                      <button
                        type="button"
                        title="Rename"
                        onClick={() => {
                          setRenameItem(p);
                          setRenameValue(p.name);
                        }}
                        className="p-1.5 rounded hover:bg-[var(--bg-hover,rgba(255,255,255,0.08))] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </button>

                      <button
                        type="button"
                        title="Duplicate"
                        onClick={() => handleDuplicate(p)}
                        className="p-1.5 rounded hover:bg-[var(--bg-hover,rgba(255,255,255,0.08))] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                      </button>

                      <button
                        type="button"
                        title="Export Project Bundle (with all assets)"
                        disabled={exportingBundleId === p.id}
                        onClick={() => handleExportBundle(p)}
                        className={`p-1.5 rounded transition-colors ${
                          exportingBundleId === p.id
                            ? 'text-amber-400 animate-pulse'
                            : 'hover:bg-amber-500/10 text-amber-400 hover:text-amber-300'
                        }`}
                      >
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                          <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                          <line x1="12" y1="22.08" x2="12" y2="12" />
                        </svg>
                      </button>

                      <button
                        type="button"
                        title="Export Code only (JSON)"
                        onClick={() => handleExportJson(p)}
                        className="p-1.5 rounded hover:bg-[var(--bg-hover,rgba(255,255,255,0.08))] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <polyline points="7 10 12 15 17 10" />
                          <line x1="12" y1="22.08" x2="12" y2="12" />
                        </svg>
                      </button>

                      <button
                        type="button"
                        title="Delete"
                        onClick={() => setDeleteItem(p)}
                        className="p-1.5 rounded hover:bg-red-500/10 text-[var(--text-secondary)] hover:text-red-400 transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>

      {/* ─── Modals ─── */}

      {/* New Project Modal */}
      <Modal
        isOpen={newModalOpen}
        onClose={() => setNewModalOpen(false)}
        title="Create New Project"
        width={340}
      >
        <form onSubmit={handleCreate} className="p-4 flex flex-col gap-4">
          <div>
            <label className="text-xs font-medium text-[var(--text-secondary)] block mb-1.5">
              Project Name
            </label>
            <input
              type="text"
              autoFocus
              placeholder="e.g. Acme Marketing Site"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded bg-[var(--bg-primary,#121214)] border border-[var(--border-subtle,rgba(255,255,255,0.15))] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent,#eab308)]"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setNewModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={creating}
            >
              Create Project
            </Button>
          </div>
        </form>
      </Modal>

      {/* Rename Project Modal */}
      <Modal
        isOpen={renameItem !== null}
        onClose={() => setRenameItem(null)}
        title="Rename Project"
        width={340}
      >
        <form onSubmit={handleRename} className="p-4 flex flex-col gap-4">
          <div>
            <label className="text-xs font-medium text-[var(--text-secondary)] block mb-1.5">
              Project Name
            </label>
            <input
              type="text"
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded bg-[var(--bg-primary,#121214)] border border-[var(--border-subtle,rgba(255,255,255,0.15))] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent,#eab308)]"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setRenameItem(null)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
            >
              Save Name
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={deleteItem !== null}
        onClose={() => setDeleteItem(null)}
        onConfirm={handleDeleteConfirm}
        title="Delete Project"
        message={`Are you sure you want to delete "${deleteItem?.name}"?\nAll pages and files in this project will be permanently removed.`}
        confirmLabel="Delete Project"
        danger
        loading={deleting}
      />

      {/* Create New Folder Modal */}
      <Modal
        isOpen={newFolderModalOpen}
        onClose={() => setNewFolderModalOpen(false)}
        title="Create New Folder"
        width={340}
      >
        <form onSubmit={handleCreateFolder} className="p-4 flex flex-col gap-4">
          <div>
            <label className="text-xs font-medium text-[var(--text-secondary)] block mb-1.5">
              Folder Name
            </label>
            <input
              type="text"
              autoFocus
              placeholder="e.g. Client Portfolios"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded bg-[var(--bg-primary,#121214)] border border-[var(--border-subtle,rgba(255,255,255,0.15))] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent,#eab308)]"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setNewFolderModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={creatingFolder}
            >
              Create Folder
            </Button>
          </div>
        </form>
      </Modal>

      {/* Rename Folder Modal */}
      <Modal
        isOpen={renameFolderItem !== null}
        onClose={() => setRenameFolderItem(null)}
        title="Rename Folder"
        width={340}
      >
        <form onSubmit={handleRenameFolder} className="p-4 flex flex-col gap-4">
          <div>
            <label className="text-xs font-medium text-[var(--text-secondary)] block mb-1.5">
              Folder Name
            </label>
            <input
              type="text"
              autoFocus
              value={renameFolderName}
              onChange={(e) => setRenameFolderName(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded bg-[var(--bg-primary,#121214)] border border-[var(--border-subtle,rgba(255,255,255,0.15))] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent,#eab308)]"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setRenameFolderItem(null)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
            >
              Save Name
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Folder Confirm Dialog */}
      <ConfirmDialog
        isOpen={deleteFolderItem !== null}
        onClose={() => setDeleteFolderItem(null)}
        onConfirm={handleDeleteFolderConfirm}
        title="Delete Folder"
        message={`Are you sure you want to delete folder "${deleteFolderItem?.name}"?\nProjects in this folder will NOT be deleted; they will simply be unassigned and available under "All Projects".`}
        confirmLabel="Delete Folder"
        danger
        loading={deletingFolder}
      />
    </div>
  );
}
