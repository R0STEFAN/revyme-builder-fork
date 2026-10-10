import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import ProjectLoader from './ProjectLoader';
import { RevymeBackend } from './backend/revyme-backend';
import { backend } from './backend';
import { projectFS, resetProjectFS } from './code/project/project-fs';
import { templatePromptDismissKey } from './code/stores/fresh-site-store';

vi.mock('./App', () => ({ default: () => <div>Editor mounted</div> }));
vi.mock('./backend', () => ({ backend: {
  getUser: vi.fn().mockResolvedValue({ id: 'owner' }),
  loadProject: (id: string) => new RevymeBackend().loadProject(id),
  getWebsiteRole: vi.fn().mockResolvedValue('owner'),
  getWebsiteName: vi.fn().mockResolvedValue('Existing project'),
  getWebsiteClosedSource: vi.fn().mockResolvedValue(false),
  getWebsiteWorkspaceId: vi.fn().mockResolvedValue(null),
  saveProject: vi.fn(),
} }));
vi.mock('@/backend/project-id', () => ({ getProjectId: () => 'existing-project' }));
vi.mock('@/shared/cloud-flag', () => ({ CLOUD_ENABLED: true }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

it('shows Retry and preserves files after a failed cloud snapshot GET', async () => {
  window.history.replaceState(null, '', '/builder/existing-project');
  localStorage.setItem(templatePromptDismissKey('existing-project'), '1');
  resetProjectFS(new Map([['app/page.client.tsx', 'existing source']]));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Unavailable', { status: 503 })));
  render(<ProjectLoader />);
  expect((await screen.findByRole('alert')).textContent).toContain('503');
  expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  expect(screen.queryByText('Editor mounted')).toBeNull();
  expect(projectFS.readFile('app/page.client.tsx')).toBe('existing source');
  expect(backend.saveProject).not.toHaveBeenCalled();
});

it('rejects malformed file contents before replacing the previous ProjectFS snapshot', async () => {
  window.history.replaceState(null, '', '/builder/existing-project');
  localStorage.setItem(templatePromptDismissKey('existing-project'), '1');
  resetProjectFS(new Map([['app/page.client.tsx', 'existing source']]));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
    id: 'existing-project', json: JSON.stringify({ format: 'revyme-v1', files: { 'app/globals.css': 1 } }),
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
  render(<ProjectLoader />);
  expect((await screen.findByRole('alert')).textContent).toContain('snapshot');
  expect(screen.queryByText('Editor mounted')).toBeNull();
  expect(projectFS.readFile('app/page.client.tsx')).toBe('existing source');
  expect(backend.saveProject).not.toHaveBeenCalled();
});
