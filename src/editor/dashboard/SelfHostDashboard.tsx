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
  type LocalProjectItem,
} from '@/backend/local-projects';
import Button from '@/design-system/Button';
import Modal from '@/design-system/Modal';
import ConfirmDialog from '@/design-system/ConfirmDialog';
import { toast } from 'sonner';
import { trace } from '@/shared/debug-trace';

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

  // Hidden file input for project import
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    fetchProjects();
  }, []);

  const filteredProjects = useMemo(() => {
    if (!search.trim()) return projects;
    const q = search.toLowerCase();
    return projects.filter(
      (p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)
    );
  }, [projects, search]);

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
      const created = await createProject(name);
      toast.success('Project created');
      setNewModalOpen(false);
      setNewProjectName('');
      handleOpen(created.id);
    } catch (err: any) {
      toast.error(err.message || 'Failed to create project');
      setCreating(false);
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
      toast.success('Export downloaded');
    } catch (err) {
      toast.error('Export failed');
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const name = parsed.name || file.name.replace(/\.json$/i, '');
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
            accept=".json"
            className="hidden"
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
          >
            Import JSON
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
            <h1 className="text-xl font-bold tracking-tight">Your Projects</h1>
            <p className="text-xs text-[var(--text-secondary,#a1a1aa)] mt-0.5">
              {projects.length} {projects.length === 1 ? 'project' : 'projects'} saved on server
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
                    className="h-28 rounded-lg bg-gradient-to-br from-[var(--bg-hover,#27272a)] to-[var(--bg-primary,#121214)] border border-[var(--border-subtle,rgba(255,255,255,0.04))] flex flex-col items-center justify-center cursor-pointer group-hover:brightness-105 transition-all overflow-hidden relative"
                  >
                    <div className="w-10 h-10 rounded bg-[var(--bg-secondary,#18181b)]/80 flex items-center justify-center text-[var(--text-secondary)]">
                      <svg className="w-5 h-5 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <path d="M3 9h18M9 21V9" />
                      </svg>
                    </div>
                    <span className="absolute bottom-2 right-2 text-[10px] text-[var(--text-secondary)] bg-black/40 px-1.5 py-0.5 rounded">
                      {p.fileCount} files
                    </span>
                  </div>

                  {/* Title & Metadata */}
                  <div className="mt-3">
                    <h2
                      onClick={() => handleOpen(p.id)}
                      className="text-sm font-bold truncate cursor-pointer hover:text-[var(--accent,#eab308)] transition-colors"
                      title={p.name}
                    >
                      {p.name}
                    </h2>
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
                      title="Export JSON"
                      onClick={() => handleExportJson(p)}
                      className="p-1.5 rounded hover:bg-[var(--bg-hover,rgba(255,255,255,0.08))] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
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
    </div>
  );
}
