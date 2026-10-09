import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import ProjectLoader from './ProjectLoader';
import { backend } from './backend';

vi.mock('./App', () => ({ default: () => <div>Editor mounted</div> }));
vi.mock('./backend', () => ({ backend: {
  getUser: vi.fn().mockResolvedValue({ id: 'local' }),
  loadProject: vi.fn().mockRejectedValue(new Error('Storage unavailable')),
  getWebsiteRole: vi.fn().mockResolvedValue('owner'),
  getWebsiteName: vi.fn().mockResolvedValue('Saved project'),
  getWebsiteClosedSource: vi.fn().mockResolvedValue(false),
  getWebsiteWorkspaceId: vi.fn().mockResolvedValue(null),
} }));
vi.mock('@/shared/cloud-flag', () => ({ CLOUD_ENABLED: false }));

beforeEach(() => {
  vi.clearAllMocks();
});

it('does not mount the editor with the default snapshot when initialization fails', async () => {
  vi.mocked(backend.loadProject).mockRejectedValueOnce(new Error('Storage unavailable'));
  window.history.replaceState(null, '', '/builder/saved-project');
  render(<ProjectLoader />);
  expect((await screen.findByRole('alert')).textContent).toContain('Storage unavailable');
  expect(screen.queryByText('Editor mounted')).toBeNull();
});

it('blocks seeding empty project and displays alert when specific project is missing or empty in standalone mode', async () => {
  vi.mocked(backend.loadProject).mockResolvedValueOnce(null);
  window.history.replaceState(null, '', '/builder/proj-test-missing');
  render(<ProjectLoader />);
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain('Project "proj-test-missing" was not found or contains no files');
  expect(alert.textContent).toContain('Your saved project has not been replaced');
  expect(screen.queryByText('Editor mounted')).toBeNull();
});

it('redirects root route / to /dashboard in standalone mode', () => {
  const replaceSpy = vi.fn();
  const origLocation = window.location;
  Object.defineProperty(window, 'location', {
    value: {
      ...origLocation,
      pathname: '/',
      replace: replaceSpy,
    },
    configurable: true,
    writable: true,
  });

  try {
    const { container } = render(<ProjectLoader />);
    expect(replaceSpy).toHaveBeenCalledWith('/dashboard');
    expect(container.firstChild).toBeNull();
  } finally {
    Object.defineProperty(window, 'location', {
      value: origLocation,
      configurable: true,
      writable: true,
    });
  }
});
