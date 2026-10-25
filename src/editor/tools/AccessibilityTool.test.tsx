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
});
