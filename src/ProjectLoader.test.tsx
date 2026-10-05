import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import ProjectLoader from './ProjectLoader';

vi.mock('./App', () => ({ default: () => <div>Editor mounted</div> }));
vi.mock('./backend', () => ({ backend: {
  getUser: vi.fn().mockResolvedValue({ id: 'local' }),
  loadProject: vi.fn().mockRejectedValue(new Error('Storage unavailable')),
  getWebsiteRole: vi.fn().mockResolvedValue('owner'),
  getWebsiteName: vi.fn().mockResolvedValue('Saved project'),
  getWebsiteClosedSource: vi.fn().mockResolvedValue(false),
} }));
vi.mock('@/shared/cloud-flag', () => ({ CLOUD_ENABLED: false }));

it('does not mount the editor with the default snapshot when initialization fails', async () => {
  window.history.replaceState(null, '', '/builder/saved-project');
  render(<ProjectLoader />);
  expect((await screen.findByRole('alert')).textContent).toContain('Storage unavailable');
  expect(screen.queryByText('Editor mounted')).toBeNull();
});
