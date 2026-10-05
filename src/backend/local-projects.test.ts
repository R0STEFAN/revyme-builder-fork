import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { listAllProjects, createProject, deleteProject, duplicateProject } from './local-projects';

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
