import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import RightHeader from './RightHeader';
import * as localServerClient from '@/backend/local-server-client';
import * as projectIdModule from '@/backend/project-id';

vi.mock('@/shared/cloud-flag', () => ({
  CLOUD_ENABLED: false,
}));

vi.mock('@/backend/local-server-client', () => ({
  fetchLocalServerStatus: vi.fn(),
  buildLocalServer: vi.fn(),
  startLocalServer: vi.fn(),
  stopLocalServer: vi.fn(),
}));

vi.mock('@/backend/project-id', () => ({
  getProjectId: vi.fn(() => 'local-test-proj'),
}));

vi.mock('./export-project', () => ({
  exportProject: vi.fn(),
}));

describe('RightHeader in self-host mode (!CLOUD_ENABLED)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(localServerClient.fetchLocalServerStatus).mockResolvedValue({
      status: 'idle',
      port: 3000,
      url: null,
      isBuilt: false,
      lastBuiltAt: null,
      lastError: null,
      pid: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('clicking Publish toggles LocalServerDropdown open and closed', async () => {
    render(<RightHeader previewMode={false} onTogglePreview={vi.fn()} />);

    // Dropdown should initially not be visible
    expect(screen.queryByText('Local Live Server')).toBeNull();

    // Click Publish button
    const publishBtn = screen.getByRole('button', { name: /publish/i });
    await act(async () => {
      fireEvent.click(publishBtn);
    });

    // LocalServerDropdown should now be rendered
    expect(screen.getByText('Local Live Server')).toBeTruthy();

    // Click Publish button again
    await act(async () => {
      fireEvent.click(publishBtn);
    });

    // LocalServerDropdown should close
    await waitFor(() => {
      expect(screen.queryByText('Local Live Server')).toBeNull();
    });
  });

  it('displays the green live dot indicator when local server is running', async () => {
    vi.mocked(localServerClient.fetchLocalServerStatus).mockResolvedValue({
      status: 'running',
      port: 3000,
      url: 'http://localhost:3000',
      isBuilt: true,
      lastBuiltAt: Date.now(),
      lastError: null,
      pid: 1234,
    });

    render(<RightHeader previewMode={false} onTogglePreview={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('local-server-live-dot')).toBeTruthy();
    });
  });

  it('does not display the live dot when local server is not running', async () => {
    vi.mocked(localServerClient.fetchLocalServerStatus).mockResolvedValue({
      status: 'idle',
      port: 3000,
      url: null,
      isBuilt: false,
      lastBuiltAt: null,
      lastError: null,
      pid: null,
    });

    render(<RightHeader previewMode={false} onTogglePreview={vi.fn()} />);

    await waitFor(() => {
      expect(localServerClient.fetchLocalServerStatus).toHaveBeenCalled();
    });

    expect(screen.queryByTestId('local-server-live-dot')).toBeNull();
  });
});
