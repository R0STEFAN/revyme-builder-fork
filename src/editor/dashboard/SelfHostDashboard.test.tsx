// SelfHostDashboard.test.tsx — Tests for SelfHostDashboard component and project card preview image rendering.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import SelfHostDashboard from './SelfHostDashboard';
import * as localProjectsModule from '@/backend/local-projects';

vi.mock('@/backend/local-projects', () => ({
  listAllProjects: vi.fn(),
  listAllFolders: vi.fn(),
  createProject: vi.fn(),
  deleteProject: vi.fn(),
  deleteProjects: vi.fn(),
  duplicateProject: vi.fn(),
  migrateLocalStorageProjectsToServer: vi.fn(),
  createFolder: vi.fn(),
  renameFolder: vi.fn(),
  deleteFolder: vi.fn(),
  setProjectFolder: vi.fn(),
}));

describe('SelfHostDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(localProjectsModule.listAllFolders).mockResolvedValue([]);
  });

  it('renders project cards with preview images when previewImage is present', async () => {
    vi.mocked(localProjectsModule.listAllProjects).mockResolvedValue([
      {
        id: 'proj-with-image',
        name: 'Website with Preview',
        fileCount: 15,
        updatedAt: Date.now(),
        createdAt: Date.now(),
        previewImage: '/api/uploads/thumbnail-proj-with-image.jpg',
      },
    ]);

    render(<SelfHostDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Website with Preview')).toBeDefined();
    });

    const img = screen.getByRole('img', { name: 'Website with Preview' }) as HTMLImageElement;
    expect(img).toBeDefined();
    expect(img.src).toContain('/api/uploads/thumbnail-proj-with-image.jpg');
  });

  it('renders fallback placeholder when previewImage is not present', async () => {
    vi.mocked(localProjectsModule.listAllProjects).mockResolvedValue([
      {
        id: 'proj-no-image',
        name: 'Website without Preview',
        fileCount: 5,
        updatedAt: Date.now(),
        createdAt: Date.now(),
        previewImage: null,
      },
    ]);

    render(<SelfHostDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Website without Preview')).toBeDefined();
    });

    expect(screen.queryByRole('img', { name: 'Website without Preview' })).toBeNull();
  });

  it('supports selecting multiple projects and triggers bulk delete', async () => {
    const mockProjects = [
      {
        id: 'proj-1',
        name: 'Project Alpha',
        fileCount: 4,
        updatedAt: Date.now(),
        createdAt: Date.now(),
      },
      {
        id: 'proj-2',
        name: 'Project Beta',
        fileCount: 6,
        updatedAt: Date.now(),
        createdAt: Date.now(),
      },
      {
        id: 'proj-3',
        name: 'Project Gamma',
        fileCount: 2,
        updatedAt: Date.now(),
        createdAt: Date.now(),
      },
    ];

    vi.mocked(localProjectsModule.listAllProjects).mockResolvedValue(mockProjects);
    vi.mocked(localProjectsModule.deleteProjects).mockResolvedValue({
      deleted: ['proj-1', 'proj-2'],
      failed: [],
    });

    render(<SelfHostDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Project Alpha')).toBeDefined();
      expect(screen.getByText('Project Beta')).toBeDefined();
    });

    // Checkbox for Project Alpha
    const selectAlpha = screen.getByRole('button', { name: 'Select Project Alpha' });
    fireEvent.click(selectAlpha);

    // Checkbox for Project Beta
    const selectBeta = screen.getByRole('button', { name: 'Select Project Beta' });
    fireEvent.click(selectBeta);

    // Multi-selection action bar should be visible
    expect(screen.getByText('2 projects selected')).toBeDefined();

    // Click "Delete (2)" button in the bulk action bar
    const bulkDeleteBtn = screen.getByRole('button', { name: /Delete \(2\)/ });
    fireEvent.click(bulkDeleteBtn);

    // Confirm dialog should be open
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Delete 2 Projects' })).toBeDefined();
    });

    // Click confirm in the dialog
    const confirmBtn = screen.getByRole('button', { name: 'Delete 2 Projects' });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(localProjectsModule.deleteProjects).toHaveBeenCalledWith(['proj-1', 'proj-2']);
    });
  });

  it('selects and deselects all projects using the Select All button', async () => {
    const mockProjects = [
      { id: 'proj-1', name: 'Project 1', fileCount: 1, updatedAt: Date.now(), createdAt: Date.now() },
      { id: 'proj-2', name: 'Project 2', fileCount: 1, updatedAt: Date.now(), createdAt: Date.now() },
    ];
    vi.mocked(localProjectsModule.listAllProjects).mockResolvedValue(mockProjects);

    render(<SelfHostDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Project 1')).toBeDefined();
    });

    // Click "Select All"
    const selectAllBtn = screen.getByRole('button', { name: 'Select All' });
    fireEvent.click(selectAllBtn);

    // Action bar shows 2 projects selected
    expect(screen.getByText('2 projects selected')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Deselect All' })).toBeDefined();

    // Click "Deselect All"
    fireEvent.click(screen.getByRole('button', { name: 'Deselect All' }));
    expect(screen.queryByText('2 projects selected')).toBeNull();
  });
});
