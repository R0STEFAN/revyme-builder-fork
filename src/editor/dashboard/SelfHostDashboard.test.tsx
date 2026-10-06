// SelfHostDashboard.test.tsx — Tests for SelfHostDashboard component and project card preview image rendering.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import SelfHostDashboard from './SelfHostDashboard';
import * as localProjectsModule from '@/backend/local-projects';

vi.mock('@/backend/local-projects', () => ({
  listAllProjects: vi.fn(),
  listAllFolders: vi.fn(),
  createProject: vi.fn(),
  deleteProject: vi.fn(),
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
});
