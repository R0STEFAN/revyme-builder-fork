// @vitest-environment jsdom
import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LinkShim, setCurrentParams, useParams } from './next-shims';

describe('preview-sandbox fixes', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
  });

  describe('LinkShim', () => {
    it('strips Framer Motion props like layout={true}, forwards ref, and renders multiple children without key warnings', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const ref = React.createRef<HTMLAnchorElement>();

      const root = createRoot(container);
      await act(async () => {
        root.render(
          <LinkShim
            ref={ref}
            href="/pricing"
            layout={true}
            layoutId="nav-link"
            whileHover={{ scale: 1.05 }}
            transition={{ duration: 0.2 }}
            data-testid="nav-link"
          >
            <span>Icon</span>
            <span>Pricing</span>
          </LinkShim>,
        );
      });

      const anchor = container.querySelector('a');
      expect(anchor).not.toBeNull();
      expect(ref.current).toBe(anchor);
      expect(anchor?.getAttribute('href')).toBe('/pricing');
      expect(anchor?.getAttribute('layout')).toBeNull();
      expect(anchor?.getAttribute('layoutId')).toBeNull();
      expect(anchor?.textContent).toBe('IconPricing');

      const allMessages = [
        ...errorSpy.mock.calls.map((args) => args.map(String).join(' ')),
        ...warnSpy.mock.calls.map((args) => args.map(String).join(' ')),
      ].join('\n');

      expect(allMessages).not.toContain('non-boolean attribute');
      expect(allMessages).not.toContain('unique "key" prop');

      await act(async () => {
        root.unmount();
      });
    });
  });

  describe('setCurrentParams', () => {
    it('updates snapshot synchronously and notifies listeners in a microtask without cross-component render warnings', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      setCurrentParams({ slug: 'initial' });
      await Promise.resolve();

      const observedInChild: string[] = [];

      function NavbarSubscriber() {
        const params = useParams<{ slug?: string }>();
        observedInChild.push(params.slug ?? '');
        return <nav data-slug={params.slug}>{params.slug}</nav>;
      }

      function PreviewParent({ slug }: { slug: string }) {
        setCurrentParams({ slug });
        const immediateParams = useParams<{ slug?: string }>();
        return (
          <div data-immediate={immediateParams.slug}>
            <NavbarSubscriber />
          </div>
        );
      }

      const root = createRoot(container);
      await act(async () => {
        root.render(<PreviewParent slug="alice" />);
      });

      expect(container.querySelector('div')?.getAttribute('data-immediate')).toBe('alice');
      expect(container.querySelector('nav')?.getAttribute('data-slug')).toBe('alice');

      await act(async () => {
        root.render(<PreviewParent slug="bob" />);
        await Promise.resolve();
      });

      expect(container.querySelector('div')?.getAttribute('data-immediate')).toBe('bob');
      expect(container.querySelector('nav')?.getAttribute('data-slug')).toBe('bob');

      const errorText = errorSpy.mock.calls.map((args) => args.map(String).join(' ')).join('\n');
      expect(errorText).not.toContain('Cannot update a component');

      await act(async () => {
        root.unmount();
      });
    });
  });
});
