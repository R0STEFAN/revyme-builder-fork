import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { listAllProjects, createProject, deleteProject, duplicateProject, migrateLocalStorageProjectsToServer } from './local-projects';

describe('local-projects management', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('lists projects from localStorage fallback when offline', async () => {
    localStorage.setItem('revyme-project-site1', JSON.stringify({ format: 'revyme-v1', files: { 'a': '1' } }));
    localStorage.setItem('revyme:project-name:site1', 'My Portfolio');

    const list = await listAllProjects();
    expect(list.some((p) => p.id === 'site1' && p.name === 'My Portfolio')).toBe(true);
  });

  it('creates project in localStorage when server is unreachable', async () => {
    const created = await createProject('Client Site X');
    expect(created.name).toBe('Client Site X');
    expect(created.id).toMatch(/^proj-/);

    const saved = localStorage.getItem(`revyme-project-${created.id}`);
    expect(saved).not.toBeNull();
    expect(localStorage.getItem(`revyme:project-name:${created.id}`)).toBe('Client Site X');
  });

  it('deletes project from localStorage', async () => {
    const created = await createProject('To Delete');
    expect(localStorage.getItem(`revyme-project-${created.id}`)).not.toBeNull();

    await deleteProject(created.id);
    expect(localStorage.getItem(`revyme-project-${created.id}`)).toBeNull();
  });

  it('duplicates project from localStorage', async () => {
    const created = await createProject('Original');
    const dup = await duplicateProject(created.id, 'Original Copied');

    expect(dup).not.toBeNull();
    expect(dup?.name).toBe('Original Copied');
    expect(dup?.id).not.toBe(created.id);
  });
});

 it('migration never overwrites an existing server project with a stale browser copy', async () => {
  localStorage.setItem('revyme-project-existing', JSON.stringify({ format: 'revyme-v1', files: { home: 'stale' } }));
  const request = vi.fn().mockResolvedValue({ ok: true, status: 200 });
  vi.stubGlobal('fetch', request);
  try {
    expect(await migrateLocalStorageProjectsToServer()).toBe(0);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('/api/projects/existing');
  } finally { vi.unstubAllGlobals(); localStorage.clear(); }
 });

it('migration imports a browser project only after the server confirms it is missing', async () => {
  const data = { format: 'revyme-v1', files: { home: 'custom' } };
  localStorage.setItem('revyme-project-missing', JSON.stringify(data));
  const request = vi.fn().mockResolvedValueOnce({ ok: false, status: 404 }).mockResolvedValueOnce({ ok: true });
  vi.stubGlobal('fetch', request);
  try {
    expect(await migrateLocalStorageProjectsToServer()).toBe(1);
    expect(request.mock.calls[1][1]).toMatchObject({ method: 'PUT' });
    expect(JSON.parse(request.mock.calls[1][1].body).data).toEqual(data);
  } finally { vi.unstubAllGlobals(); localStorage.clear(); }
});

it('migration does not write when the server cannot establish whether the project exists', async () => {
  localStorage.setItem('revyme-project-existing', JSON.stringify({ files: { home: 'stale' } }));
  const request = vi.fn().mockResolvedValue({ ok: false, status: 500 });
  vi.stubGlobal('fetch', request);
  try {
    expect(await migrateLocalStorageProjectsToServer()).toBe(0);
    expect(request).toHaveBeenCalledTimes(1);
  } finally { vi.unstubAllGlobals(); localStorage.clear(); }
});
