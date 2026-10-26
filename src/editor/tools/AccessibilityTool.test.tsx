/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

const queued: any[] = [];
vi.mock('@/code/mutation/mutation-queue', () => ({
  queueMutation: (m: any) => queued.push(m),
  queueMutations: (ms: any[]) => queued.push(...ms),
}));

vi.mock('@/shared/debug-trace', () => ({
  trace: { action: vi.fn(), fn: vi.fn(), dom: vi.fn(), error: vi.fn() },
}));

let mockControl: any = {
  nodeId: 'n1',
  node: {
    id: 'n1',
    type: 'div',
    attrs: {
      'data-id': 'n1',
      'data-name': 'div',
    },
    styles: {},
  },
};

vi.mock('../controls/ControlProvider', () => ({
  useControl: () => mockControl,
}));

let mockActiveFile = 'src/app/page.tsx';
vi.mock('jotai', async () => {
  const actual = await vi.importActual('jotai');
  return {
    ...actual,
    useAtomValue: vi.fn(() => mockActiveFile),
  };
});

import AccessibilityTool, { FRAME_TAG_OPTIONS, TEXT_TAG_OPTIONS } from './AccessibilityTool';

describe('AccessibilityTool', () => {
  beforeEach(() => {
    queued.length = 0;
    mockActiveFile = 'src/app/page.tsx';
    mockControl = {
      nodeId: 'n1',
      node: {
        id: 'n1',
        type: 'div',
        attrs: {
          'data-id': 'n1',
          'data-name': 'div',
        },
        styles: {},
      },
    };
  });

  it('includes tag "a" in FRAME_TAG_OPTIONS as well as TEXT_TAG_OPTIONS', () => {
    expect(FRAME_TAG_OPTIONS.some((opt) => opt.value === 'a')).toBe(true);
    expect(TEXT_TAG_OPTIONS.some((opt) => opt.value === 'a')).toBe(true);
  });

  it('renders "div" for a div node and offers "a" in the frame dropdown when opened', () => {
    const { container } = render(<AccessibilityTool />);
    // Click toggle button to open section for default div
    const toggleBtn = container.querySelector('button') as HTMLButtonElement;
    fireEvent.click(toggleBtn);

    const select = container.querySelector('select') as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(select.value).toBe('div');

    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toContain('div');
    expect(options).toContain('section');
    expect(options).toContain('button');
    expect(options).toContain('a');
  });

  it('displays "a" when node.type is "Link" and keeps frame options available', () => {
    mockControl = {
      nodeId: 'lnk-1',
      node: {
        id: 'lnk-1',
        type: 'Link',
        attrs: {
          'data-id': 'lnk-1',
          'data-name': 'a',
          href: '/about',
        },
        styles: {},
      },
    };

    const { container } = render(<AccessibilityTool />);
    const select = container.querySelector('select') as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(select.value).toBe('a');

    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toContain('a');
    expect(options).toContain('div');
    expect(options).toContain('section');
  });

  it('displays "a" when node.type is "MotionLink" on a component master', () => {
    mockActiveFile = 'components/MyButton.tsx';
    mockControl = {
      nodeId: 'mlnk-1',
      node: {
        id: 'mlnk-1',
        type: 'MotionLink',
        attrs: {
          'data-id': 'mlnk-1',
          'data-name': 'a',
          href: '/pricing',
        },
        styles: {},
      },
    };

    const { container } = render(<AccessibilityTool />);
    const select = container.querySelector('select') as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(select.value).toBe('a');
  });

  it('converts div to "a" when user selects "a" in dropdown', () => {
    const { container } = render(<AccessibilityTool />);
    const toggleBtn = container.querySelector('button') as HTMLButtonElement;
    fireEvent.click(toggleBtn);
    const select = container.querySelector('select') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'a' } });

    expect(queued).toEqual([
      { type: 'changeTag', nodeId: 'n1', newTag: 'a' },
      { type: 'updateStyles', nodeId: 'n1', styles: { textDecoration: 'none', color: 'inherit' } },
      { type: 'updateHtmlAttrs', nodeId: 'n1', attrs: { 'data-name': 'a' } },
    ]);
  });

  it('converts div with existing internal href to "Link" on page', () => {
    mockControl.node.attrs.href = '/contact';
    const { container } = render(<AccessibilityTool />);
    const toggleBtn = container.querySelector('button') as HTMLButtonElement;
    fireEvent.click(toggleBtn);
    const select = container.querySelector('select') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'a' } });

    expect(queued).toEqual([
      { type: 'changeTag', nodeId: 'n1', newTag: 'Link' },
      { type: 'updateStyles', nodeId: 'n1', styles: { textDecoration: 'none', color: 'inherit' } },
      { type: 'updateHtmlAttrs', nodeId: 'n1', attrs: { 'data-name': 'a' } },
    ]);
  });

  it('reverting "Link" to "div" cleans up link attributes and styles', () => {
    mockControl = {
      nodeId: 'lnk-1',
      node: {
        id: 'lnk-1',
        type: 'Link',
        attrs: {
          'data-id': 'lnk-1',
          'data-name': 'a',
          href: '/about',
          target: '_blank',
        },
        styles: { textDecoration: 'none', color: 'inherit' },
      },
    };

    const { container } = render(<AccessibilityTool />);
    const select = container.querySelector('select') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'div' } });

    expect(queued).toEqual([
      { type: 'changeTag', nodeId: 'lnk-1', newTag: 'div' },
      {
        type: 'updateHtmlAttrs',
        nodeId: 'lnk-1',
        attrs: { href: '', target: '', rel: '', 'data-smooth-scroll': '' },
      },
      { type: 'updateStyles', nodeId: 'lnk-1', styles: { textDecoration: '', color: '' } },
      { type: 'updateHtmlAttrs', nodeId: 'lnk-1', attrs: { 'data-name': 'div' } },
    ]);
  });

  it('reverting "MotionLink" on component master to "div" converts to "motion.div"', () => {
    mockActiveFile = 'components/Card.tsx';
    mockControl = {
      nodeId: 'card-1',
      node: {
        id: 'card-1',
        type: 'MotionLink',
        attrs: {
          'data-id': 'card-1',
          'data-name': 'a',
          href: '/items',
        },
        styles: {},
      },
    };

    const { container } = render(<AccessibilityTool />);
    const select = container.querySelector('select') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'div' } });

    expect(queued).toEqual([
      { type: 'changeTag', nodeId: 'card-1', newTag: 'motion.div' },
      {
        type: 'updateHtmlAttrs',
        nodeId: 'card-1',
        attrs: { href: '', target: '', rel: '', 'data-smooth-scroll': '' },
      },
      { type: 'updateStyles', nodeId: 'card-1', styles: { textDecoration: '', color: '' } },
      { type: 'updateHtmlAttrs', nodeId: 'card-1', attrs: { 'data-name': 'div' } },
    ]);
  });

  describe('Aria Label expression (fx)', () => {
    it('renders fx button next to aria-label input', () => {
      mockControl = {
        nodeId: 'btn-1',
        node: {
          id: 'btn-1',
          type: 'button',
          attrs: { 'data-id': 'btn-1', 'aria-label': 'Click me' },
          styles: {},
        },
      };

      const { container } = render(<AccessibilityTool />);
      const fxBtn = screen.getByRole('button', { name: 'fx' });
      expect(fxBtn).not.toBeNull();
      expect(fxBtn.getAttribute('title')).toBe('Dynamic Aria Label Expression (Formula)');

      const input = container.querySelector('input[type="text"]') as HTMLInputElement;
      expect(input).not.toBeNull();
      expect(input.value).toBe('Click me');
    });

    it('opens ExpressionEditorPopup when fx button is clicked and queues bindAriaLabelExpression on apply', () => {
      mockControl = {
        nodeId: 'btn-1',
        node: {
          id: 'btn-1',
          type: 'button',
          attrs: { 'data-id': 'btn-1', 'aria-label': 'Delete' },
          styles: {},
        },
        cmsBinding: {
          slug: 'posts',
          itemVar: 'item',
          fields: [{ id: 'title', name: 'Title', type: 'text' }],
        },
      };

      const { container } = render(<AccessibilityTool />);
      const fxBtn = screen.getByRole('button', { name: 'fx' });
      fireEvent.click(fxBtn);

      // Modal is open
      expect(screen.getByText('Aria Label Expression (Formula)')).not.toBeNull();
      // Token button for item.title
      expect(screen.getByText('item.title')).not.toBeNull();

      // Find textarea and change value in modal (portal in document.body)
      const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
      expect(textarea).not.toBeNull();
      fireEvent.change(textarea, { target: { value: '`Delete ${item.title}`' } });

      const applyBtn = screen.getByRole('button', { name: 'Apply Expression' });
      fireEvent.click(applyBtn);

      expect(queued).toContainEqual({
        type: 'bindAriaLabelExpression',
        nodeId: 'btn-1',
        expression: '`Delete ${item.title}`',
      });
    });

    it('renders ExpressionBoundPill when node.ariaLabelExpression is present and queues unbind on clear', () => {
      mockControl = {
        nodeId: 'btn-1',
        node: {
          id: 'btn-1',
          type: 'button',
          attrs: { 'data-id': 'btn-1' },
          ariaLabelExpression: 'item.name',
          styles: {},
        },
      };

      const { container } = render(<AccessibilityTool />);
      // Should show pill with expression
      expect(screen.getByText('item.name')).not.toBeNull();
      expect(screen.getByText('fx')).not.toBeNull();

      // Clicking remove button clears expression
      const removeBtn = container.querySelector('.group\\/remove') || container.querySelector('button[title*="Remove"], div[title*="Remove"]');
      if (removeBtn) {
        fireEvent.click(removeBtn);
        expect(queued).toContainEqual({
          type: 'unbindAriaLabelExpression',
          nodeId: 'btn-1',
        });
      }
    });

    it('unbinds expression when section is collapsed via toggle', () => {
      mockControl = {
        nodeId: 'btn-1',
        node: {
          id: 'btn-1',
          type: 'div',
          attrs: { 'data-id': 'btn-1' },
          ariaLabelExpression: '`Item ${item.id}`',
          styles: {},
        },
      };

      const { container } = render(<AccessibilityTool />);
      // Section auto-opens because of ariaLabelExpression
      expect(screen.getByText('`Item ${item.id}`')).not.toBeNull();

      // Toggle button to collapse
      const toggleBtn = container.querySelector('button') as HTMLButtonElement;
      fireEvent.click(toggleBtn);

      expect(queued).toContainEqual({
        type: 'unbindAriaLabelExpression',
        nodeId: 'btn-1',
      });
    });
  });
});
