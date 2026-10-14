// @vitest-environment jsdom
import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PreviewErrorBoundary, isPreviewRenderErrorActive, setPreviewRenderErrorActive } from '../PreviewErrorBoundary';
import { captureThumbnail } from '../capture-thumbnail';

function Bomb({ shouldThrow, message }: { shouldThrow: boolean; message?: string }) {
  if (shouldThrow) {
    throw new Error(message || 'Explosion in component render');
  }
  return <div data-testid="bomb-safe">Content is safe</div>;
}

describe('PreviewErrorBoundary', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    setPreviewRenderErrorActive(false);
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
    setPreviewRenderErrorActive(false);
  });

  it('renders children normally when no render exception occurs', async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <PreviewErrorBoundary url="/home" revision={1}>
          <Bomb shouldThrow={false} />
        </PreviewErrorBoundary>,
      );
    });

    expect(container.querySelector('[data-testid="bomb-safe"]')?.textContent).toBe('Content is safe');
    expect(container.querySelector('[data-preview-render-error]')).toBeNull();
    expect(isPreviewRenderErrorActive()).toBe(false);

    await act(async () => {
      root.unmount();
    });
  });

  it('catches thrown render error, renders fallback UI, and notifies parent window', async () => {
    const postMessageSpy = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {});
    const onErrorSpy = vi.fn();
    // React logs error in jsdom; silence for clean test output
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const root = createRoot(container);
    await act(async () => {
      root.render(
        <PreviewErrorBoundary url="/gallery/men" revision={1} onError={onErrorSpy}>
          <Bomb shouldThrow={true} message="Crash on object child" />
        </PreviewErrorBoundary>,
      );
    });

    // Fallback UI rendered
    const fallback = container.querySelector('[data-preview-render-error]');
    expect(fallback).not.toBeNull();
    expect(fallback?.textContent).toContain('Preview Render Error');
    expect(fallback?.textContent).toContain('Crash on object child');

    // Global active error flag set
    expect(isPreviewRenderErrorActive()).toBe(true);

    // onError callback fired
    expect(onErrorSpy).toHaveBeenCalledTimes(1);
    expect(onErrorSpy.mock.calls[0][0].message).toBe('Crash on object child');

    // Notified parent window
    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'preview:render-error',
        error: 'Crash on object child',
        url: '/gallery/men',
      }),
      '*',
    );

    // Retry button is present
    const retryBtn = container.querySelector('[data-testid="preview-error-retry-btn"]');
    expect(retryBtn).not.toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it('resets error state when Retry button is clicked and child no longer throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    function TestApp({ broken }: { broken: boolean }) {
      return (
        <PreviewErrorBoundary url="/products" revision={1}>
          <Bomb shouldThrow={broken} message="Initial render boom" />
        </PreviewErrorBoundary>
      );
    }

    const root = createRoot(container);
    await act(async () => {
      root.render(<TestApp broken={true} />);
    });

    expect(container.querySelector('[data-preview-render-error]')).not.toBeNull();
    expect(isPreviewRenderErrorActive()).toBe(true);

    // Re-render with broken=false so children have non-throwing props, then click retry
    await act(async () => {
      root.render(<TestApp broken={false} />);
    });

    const retryBtn = container.querySelector('[data-testid="preview-error-retry-btn"]') as HTMLButtonElement;
    await act(async () => {
      retryBtn.click();
    });

    // Should have reset error state and rendered safe content
    expect(container.querySelector('[data-preview-render-error]')).toBeNull();
    expect(container.querySelector('[data-testid="bomb-safe"]')?.textContent).toBe('Content is safe');
    expect(isPreviewRenderErrorActive()).toBe(false);

    await act(async () => {
      root.unmount();
    });
  });

  it('automatically resets on route URL change or revision change', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let shouldThrow = true;

    function Wrapper({ url, revision }: { url: string; revision: number }) {
      return (
        <PreviewErrorBoundary url={url} revision={revision}>
          <Bomb shouldThrow={shouldThrow} message="Temporary error" />
        </PreviewErrorBoundary>
      );
    }

    const root = createRoot(container);
    await act(async () => {
      root.render(<Wrapper url="/page-1" revision={1} />);
    });

    expect(container.querySelector('[data-preview-render-error]')).not.toBeNull();

    // Now fix error condition and update revision (e.g. file hot-reload)
    shouldThrow = false;
    await act(async () => {
      root.render(<Wrapper url="/page-1" revision={2} />);
    });

    expect(container.querySelector('[data-preview-render-error]')).toBeNull();
    expect(container.querySelector('[data-testid="bomb-safe"]')).not.toBeNull();

    // Re-break and test URL navigation
    shouldThrow = true;
    await act(async () => {
      root.render(<Wrapper url="/page-1" revision={3} />);
    });
    expect(container.querySelector('[data-preview-render-error]')).not.toBeNull();

    // Navigate to page-2 where condition is fixed
    shouldThrow = false;
    await act(async () => {
      root.render(<Wrapper url="/page-2" revision={3} />);
    });
    expect(container.querySelector('[data-preview-render-error]')).toBeNull();
    expect(container.querySelector('[data-testid="bomb-safe"]')).not.toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it('suppresses thumbnail capture while in error state', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const postMessageSpy = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {});

    const root = createRoot(container);
    await act(async () => {
      root.render(
        <PreviewErrorBoundary url="/error-page" revision={1}>
          <Bomb shouldThrow={true} message="Stop thumbnail capture" />
        </PreviewErrorBoundary>,
      );
    });

    expect(isPreviewRenderErrorActive()).toBe(true);

    // Request thumbnail capture while error is present
    await captureThumbnail();

    // Must NOT post thumbnail message
    const thumbnailMessages = postMessageSpy.mock.calls.filter(
      (call) => (call[0] as any)?.type === 'preview:thumbnail',
    );
    expect(thumbnailMessages.length).toBe(0);

    const warnMessages = warnSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(warnMessages).toContain('skipping thumbnail capture due to render error');

    await act(async () => {
      root.unmount();
    });
  });
});
