import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import { LocalServerDropdown } from './LocalServerDropdown';
import * as localServerClient from '@/backend/local-server-client';
import * as projectFsModule from '@/code/project/project-fs';
import * as mutationQueue from '@/code/mutation/mutation-queue';
import * as projectIdModule from '@/backend/project-id';
import { toast } from 'sonner';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('@/backend/local-server-client', () => ({
  fetchLocalServerStatus: vi.fn(),
  buildLocalServer: vi.fn(),
  startLocalServer: vi.fn(),
  stopLocalServer: vi.fn(),
}));

vi.mock('@/backend/project-id', () => ({
  getProjectId: vi.fn(() => 'test-project-123'),
}));

vi.mock('@/code/mutation/mutation-queue', () => ({
  flushNow: vi.fn(),
}));

describe('LocalServerDropdown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });

    // Default mock responses
    vi.mocked(localServerClient.fetchLocalServerStatus).mockResolvedValue({
      status: 'idle',
      port: 3000,
      url: null,
      isBuilt: false,
      lastBuiltAt: null,
      lastError: null,
      pid: null,
    });

    vi.mocked(localServerClient.buildLocalServer).mockResolvedValue({
      success: true,
      log: 'Build finished in 1.2s',
    });

    vi.mocked(localServerClient.startLocalServer).mockResolvedValue({
      status: 'running',
      port: 3000,
      url: 'http://localhost:3000',
      isBuilt: true,
      lastBuiltAt: Date.now(),
      lastError: null,
      pid: 12345,
    });

    vi.mocked(localServerClient.stopLocalServer).mockResolvedValue({
      status: 'idle',
      port: null,
      url: null,
      isBuilt: true,
      lastBuiltAt: Date.now(),
      lastError: null,
      pid: null,
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders correctly when open with initial stopped status', async () => {
    const onClose = vi.fn();
    render(<LocalServerDropdown open={true} onClose={onClose} />);

    expect(screen.getByText('Local Live Server')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^build$/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^start$/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^stop$/i })).toBeTruthy();

    await waitFor(() => {
      expect(localServerClient.fetchLocalServerStatus).toHaveBeenCalledWith('test-project-123');
    });

    expect(screen.getByText('Stopped')).toBeTruthy();
    // In stopped status, Start button is enabled and Stop button is disabled
    expect((screen.getByRole('button', { name: /^start$/i }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: /^stop$/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('does not render when open is false', () => {
    const onClose = vi.fn();
    render(<LocalServerDropdown open={false} onClose={onClose} />);
    expect(screen.queryByText('Local Live Server')).toBeNull();
  });

  it('displays running status, port, and URL link when server is running', async () => {
    vi.mocked(localServerClient.fetchLocalServerStatus).mockResolvedValue({
      status: 'running',
      port: 3000,
      url: 'http://localhost:3000',
      isBuilt: true,
      lastBuiltAt: Date.now(),
      lastError: null,
      pid: 9999,
    });

    render(<LocalServerDropdown open={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText('Running: 3000')).toBeTruthy();
    });

    // Check URL link
    const link = screen.getByRole('link', { name: /http:\/\/localhost:3000/i });
    expect(link).toBeTruthy();
    expect(link.getAttribute('href')).toBe('http://localhost:3000');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');

    // In running state, Start button is disabled and Stop button is enabled
    expect((screen.getByRole('button', { name: /^start$/i }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /^stop$/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('displays building status and disables start button', async () => {
    vi.mocked(localServerClient.fetchLocalServerStatus).mockResolvedValue({
      status: 'building',
      port: null,
      url: null,
      isBuilt: false,
      lastBuiltAt: null,
      lastError: null,
      pid: null,
    });

    render(<LocalServerDropdown open={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getAllByText('Building...').length).toBeGreaterThanOrEqual(1);
    });

    expect((screen.getByRole('button', { name: /^start$/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('handles build button click with flushNow, branch files extraction, and buildLocalServer call', async () => {
    const testFiles = new Map([
      ['app/page.tsx', 'export default function Page() { return <div>Hello</div> }'],
      ['app/layout.tsx', 'export default function Layout({ children }) { return <html>{children}</html> }'],
    ]);
    const readSpy = vi.spyOn(projectFsModule.projectFS, 'readBranchFiles').mockReturnValue(testFiles);

    render(<LocalServerDropdown open={true} onClose={() => {}} />);

    const buildBtn = screen.getByRole('button', { name: /^build$/i });
    await act(async () => {
      fireEvent.click(buildBtn);
    });

    expect(mutationQueue.flushNow).toHaveBeenCalled();
    expect(readSpy).toHaveBeenCalledWith(projectFsModule.MAIN_BRANCH_ID, { shared: true });
    expect(localServerClient.buildLocalServer).toHaveBeenCalledWith(
      'test-project-123',
      {
        'app/page.tsx': 'export default function Page() { return <div>Hello</div> }',
        'app/layout.tsx': 'export default function Layout({ children }) { return <html>{children}</html> }',
      },
      projectFsModule.MAIN_BRANCH_ID
    );
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('Build succeeded'));
  });

  it('upgrades old generated transition controller in files sent to the local build', async () => {
    const oldController = `'use client';
// @generated by Revyme — Page Effects controller. Do not edit.
export function PageTransitions() { e.stopImmediatePropagation(); }`;
    vi.spyOn(projectFsModule.projectFS, 'readBranchFiles').mockReturnValue(new Map([
      ['app/(site)/page-transitions.tsx', oldController],
    ]));
    render(<LocalServerDropdown open={true} onClose={() => {}} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^build$/i })); });
    const sent = vi.mocked(localServerClient.buildLocalServer).mock.calls[0][1]!;
    expect(sent['app/(site)/page-transitions.tsx']).not.toContain('stopImmediatePropagation');
    expect(oldController).toContain('stopImmediatePropagation');
  });

  it('extracts files from active non-main branch when building', async () => {
    vi.spyOn(projectFsModule.projectFS, 'getActiveBranchId').mockReturnValue('feature-hero');
    const featureFiles = new Map([
      ['app/page.tsx', 'export default function HeroPage() { return <div>Hero</div> }'],
    ]);
    const readSpy = vi.spyOn(projectFsModule.projectFS, 'readBranchFiles').mockReturnValue(featureFiles);

    render(<LocalServerDropdown open={true} onClose={() => {}} />);

    const buildBtn = screen.getByRole('button', { name: /^build$/i });
    await act(async () => {
      fireEvent.click(buildBtn);
    });

    expect(readSpy).toHaveBeenCalledWith('feature-hero', { shared: true });
    expect(localServerClient.buildLocalServer).toHaveBeenCalledWith(
      'test-project-123',
      {
        'app/page.tsx': 'export default function HeroPage() { return <div>Hero</div> }',
      },
      'feature-hero'
    );
  });

  it('shows error toast when build fails', async () => {
    vi.mocked(localServerClient.buildLocalServer).mockResolvedValue({
      success: false,
      log: 'Syntax error at line 4',
    });

    render(<LocalServerDropdown open={true} onClose={() => {}} />);

    const buildBtn = screen.getByRole('button', { name: /^build$/i });
    await act(async () => {
      fireEvent.click(buildBtn);
    });

    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Build failed'));
    expect(screen.getByText(/Syntax error at line 4/i)).toBeTruthy();
  });

  it('handles start button click with custom port', async () => {
    const onStatusChange = vi.fn();
    render(<LocalServerDropdown open={true} onClose={() => {}} onStatusChange={onStatusChange} />);

    // Change port input
    const portInput = screen.getByLabelText(/port/i) as HTMLInputElement;
    fireEvent.change(portInput, { target: { value: '3005' } });
    expect(portInput.value).toBe('3005');

    const startBtn = screen.getByRole('button', { name: /^start$/i });
    await act(async () => {
      fireEvent.click(startBtn);
    });

    expect(localServerClient.startLocalServer).toHaveBeenCalledWith('test-project-123', 3005);
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('started'));
    expect(onStatusChange).toHaveBeenCalledWith(expect.objectContaining({ status: 'running', port: 3000 }));
  });

  it('handles stop button click when running', async () => {
    vi.mocked(localServerClient.fetchLocalServerStatus).mockResolvedValue({
      status: 'running',
      port: 3000,
      url: 'http://localhost:3000',
      isBuilt: true,
      lastBuiltAt: Date.now(),
      lastError: null,
      pid: 1234,
    });

    const onStatusChange = vi.fn();
    render(<LocalServerDropdown open={true} onClose={() => {}} onStatusChange={onStatusChange} />);

    await waitFor(() => {
      expect(screen.getByText('Running: 3000')).toBeTruthy();
    });

    const stopBtn = screen.getByRole('button', { name: /^stop$/i });
    expect((stopBtn as HTMLButtonElement).disabled).toBe(false);

    await act(async () => {
      fireEvent.click(stopBtn);
    });

    expect(localServerClient.stopLocalServer).toHaveBeenCalledWith('test-project-123', 3000);
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('stopped'));
    expect(onStatusChange).toHaveBeenCalledWith(expect.objectContaining({ status: 'idle' }));
  });

  it('enables stop button and frees port when server is in error state', async () => {
    vi.mocked(localServerClient.fetchLocalServerStatus).mockResolvedValue({
      status: 'error',
      port: 3000,
      url: null,
      isBuilt: true,
      lastBuiltAt: Date.now(),
      lastError: 'Error: listen EADDRINUSE: address already in use :::3000',
      pid: null,
    });

    render(<LocalServerDropdown open={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText('Error')).toBeTruthy();
    });

    const stopBtn = screen.getByRole('button', { name: /^stop$/i });
    expect((stopBtn as HTMLButtonElement).disabled).toBe(false);

    await act(async () => {
      fireEvent.click(stopBtn);
    });

    expect(localServerClient.stopLocalServer).toHaveBeenCalledWith('test-project-123', 3000);
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('freed'));
  });

  it('shows Free Port & Restart button on EADDRINUSE error and handles click', async () => {
    vi.mocked(localServerClient.fetchLocalServerStatus).mockResolvedValue({
      status: 'error',
      port: 3000,
      url: null,
      isBuilt: true,
      lastBuiltAt: Date.now(),
      lastError: 'Error: listen EADDRINUSE: address already in use :::3000',
      pid: null,
    });

    render(<LocalServerDropdown open={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText(/Port 3000 is occupied/i)).toBeTruthy();
    });

    const freePortBtn = screen.getByRole('button', { name: /free port & restart/i });
    expect(freePortBtn).toBeTruthy();

    await act(async () => {
      fireEvent.click(freePortBtn);
    });

    expect(localServerClient.stopLocalServer).toHaveBeenCalledWith('test-project-123', 3000);
    expect(localServerClient.startLocalServer).toHaveBeenCalledWith('test-project-123', 3000);
  });

  it('polls fetchLocalServerStatus periodically while open', async () => {
    render(<LocalServerDropdown open={true} onClose={() => {}} />);

    expect(localServerClient.fetchLocalServerStatus).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(2500);
    });
    expect(localServerClient.fetchLocalServerStatus).toHaveBeenCalledTimes(2);

    await act(async () => {
      vi.advanceTimersByTime(2500);
    });
    expect(localServerClient.fetchLocalServerStatus).toHaveBeenCalledTimes(3);
  });

  it('dismisses on outside click, but ignores clicks inside or on [data-live-trigger]', async () => {
    const onClose = vi.fn();
    render(
      <div>
        <button data-live-trigger>Toggle</button>
        <LocalServerDropdown open={true} onClose={onClose} />
      </div>
    );

    await waitFor(() => {
      expect(localServerClient.fetchLocalServerStatus).toHaveBeenCalled();
    });

    // Click inside dropdown
    const dropdownTitle = screen.getByText('Local Live Server');
    fireEvent.mouseDown(dropdownTitle);
    expect(onClose).not.toHaveBeenCalled();

    // Click on trigger button
    const trigger = screen.getByText('Toggle');
    fireEvent.mouseDown(trigger);
    expect(onClose).not.toHaveBeenCalled();

    // Click outside
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('displays build success box and cleans ANSI escape codes from build log', async () => {
    const rawAnsiLog = '\u001b[1m\u001b[38;2;173;127;168m▲ Next.js 16.2.10\u001b[39m\u001b[22m (Turbopack)\n\u001b[32m\u001b[1m✓\u001b[22m\u001b[39m Compiled successfully in 1797ms';
    vi.mocked(localServerClient.buildLocalServer).mockResolvedValue({
      success: true,
      log: rawAnsiLog,
    });

    render(<LocalServerDropdown open={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(localServerClient.fetchLocalServerStatus).toHaveBeenCalled();
    });

    const buildBtn = screen.getByRole('button', { name: /^build$/i });
    await act(async () => {
      fireEvent.click(buildBtn);
    });

    // Check success badge
    expect(screen.getByText(/Build succeeded/)).toBeTruthy();

    // Toggle log view
    const viewLogBtn = screen.getByText('View build log');
    fireEvent.click(viewLogBtn);

    // Verify ANSI codes are stripped
    expect(screen.getByText(/▲ Next\.js 16\.2\.10 \(Turbopack\)/)).toBeTruthy();
    expect(screen.getByText(/Compiled successfully in 1797ms/)).toBeTruthy();
    expect(screen.queryByText(/\[38;2;/)).toBeNull();
  });
});
