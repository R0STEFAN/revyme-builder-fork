// HistoryButton.test.tsx — Unit tests for HistoryButton, HistoryDropdown, and VersionChangesModal.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, cleanup, waitFor } from '@testing-library/react';
import HistoryButton from './HistoryButton';
import * as versionHistoryModule from '@/backend/version-history';
import { projectFS } from '@/code/project/project-fs';

vi.mock('@/backend/version-history', async (importOriginal) => {
  const actual = await importOriginal<typeof versionHistoryModule>();
  return {
    ...actual,
    fetchProjectVersions: vi.fn(),
    fetchVersionDetail: vi.fn(),
    restoreProjectVersion: vi.fn(),
  };
});

describe('HistoryButton & HistoryDropdown', () => {
  const mockVersions: versionHistoryModule.ProjectVersionSummary[] = [
    {
      id: 'v1',
      projectId: 'proj-1',
      branchId: 'main',
      timestamp: Date.now() - 10000,
      source: 'manual',
      label: 'Manual save',
      changesSummary: 'Modified /app/page.tsx',
      fileCount: 1,
    },
    {
      id: 'v2',
      projectId: 'proj-1',
      branchId: 'main',
      timestamp: Date.now() - 120000,
      source: 'autosave',
      label: 'Autosave',
      changesSummary: 'Autosaved changes',
      fileCount: 1,
    },
    {
      id: 'v3',
      projectId: 'proj-1',
      branchId: 'main',
      timestamp: Date.now() - 3600000,
      source: 'restore',
      label: 'Before restore',
      changesSummary: 'Pre-restore backup',
      fileCount: 1,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(versionHistoryModule.fetchProjectVersions).mockResolvedValue(mockVersions);
    vi.mocked(versionHistoryModule.fetchVersionDetail).mockImplementation(async (id) => {
      const v = mockVersions.find((x) => x.id === id);
      return {
        ...v!,
        data: {
          files: {
            '/app/page.tsx': 'export default function Page() { return <div>Updated</div>; }',
          },
        },
      };
    });
    vi.mocked(versionHistoryModule.restoreProjectVersion).mockResolvedValue({ success: true });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders History button in toolbar', () => {
    render(<HistoryButton />);
    const button = screen.getByTestId('header-history-button');
    expect(button).toBeDefined();
    expect(button.textContent).toContain('History');
  });

  it('opens HistoryDropdown when button is clicked', async () => {
    render(<HistoryButton />);
    const button = screen.getByTestId('header-history-button');

    await act(async () => {
      fireEvent.click(button);
    });

    expect(screen.getByText('Version History')).toBeDefined();
    expect(versionHistoryModule.fetchProjectVersions).toHaveBeenCalled();

    // Verify version items are listed
    await waitFor(() => {
      expect(screen.getByText('Modified /app/page.tsx')).toBeDefined();
      expect(screen.getByText('Autosaved changes')).toBeDefined();
      expect(screen.getByText('Pre-restore backup')).toBeDefined();
    });
  });

  it('triggers restoreProjectVersion when Restore button is clicked', async () => {
    render(<HistoryButton />);
    const button = screen.getByTestId('header-history-button');

    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => {
      expect(screen.getAllByText('Restore').length).toBeGreaterThan(0);
    });

    const restoreButtons = screen.getAllByText('Restore');
    await act(async () => {
      fireEvent.click(restoreButtons[0]);
    });

    expect(versionHistoryModule.restoreProjectVersion).toHaveBeenCalledWith('v1');
  });

  it('opens VersionChangesModal when Review button is clicked', async () => {
    render(<HistoryButton />);
    const button = screen.getByTestId('header-history-button');

    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => {
      expect(screen.getAllByTitle('Review changes in this version').length).toBeGreaterThan(0);
    });

    const reviewButtons = screen.getAllByTitle('Review changes in this version');
    await act(async () => {
      fireEvent.click(reviewButtons[0]);
    });

    expect(versionHistoryModule.fetchVersionDetail).toHaveBeenCalledWith('v1');
    await waitFor(() => {
      expect(screen.getByText(/Review changes:/)).toBeDefined();
    });
  });
});
