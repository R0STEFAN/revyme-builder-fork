/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { isCustomDataAttr, SYSTEM_DATA_ATTRS } from '@/shared/constants';

const queued: any[] = [];
vi.mock('@/code/mutation/mutation-queue', () => ({
  queueMutation: (m: any) => queued.push(m),
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
      'data-name': 'Box',
      'data-theme': 'dark',
      'data-category': 'news',
    },
  },
};

vi.mock('../controls/ControlProvider', () => ({
  useControl: () => mockControl,
}));

import AttributesTool from './AttributesTool';

describe('AttributesTool and Custom Data Attributes', () => {
  beforeEach(() => {
    queued.length = 0;
    mockControl = {
      nodeId: 'n1',
      node: {
        id: 'n1',
        type: 'div',
        attrs: {
          'data-id': 'n1',
          'data-name': 'Box',
          'data-theme': 'dark',
          'data-category': 'news',
        },
      },
    };
  });

  describe('isCustomDataAttr', () => {
    it('returns true for user data attributes', () => {
      expect(isCustomDataAttr('data-category')).toBe(true);
      expect(isCustomDataAttr('data-testid')).toBe(true);
      expect(isCustomDataAttr('data-my-prop')).toBe(true);
    });

    it('returns false for non-data attributes', () => {
      expect(isCustomDataAttr('id')).toBe(false);
      expect(isCustomDataAttr('className')).toBe(false);
      expect(isCustomDataAttr('aria-label')).toBe(false);
    });

    it('returns false for system data attributes', () => {
      expect(isCustomDataAttr('data-id')).toBe(false);
      expect(isCustomDataAttr('data-name')).toBe(false);
      expect(isCustomDataAttr('data-viewport')).toBe(false);
      expect(isCustomDataAttr('data-canvas-node')).toBe(false);
      expect(isCustomDataAttr('data-overlay')).toBe(false);
      expect(isCustomDataAttr('data-form')).toBe(false);
    });
  });

  describe('AttributesTool +/- header toggle UX', () => {
    it('is open with minus button when node has custom attributes', () => {
      render(<AttributesTool />);
      expect(screen.getByTitle('Remove all attributes and close')).toBeDefined();
      expect(screen.getByDisplayValue('data-theme')).toBeDefined();
    });

    it('clicking minus clears all custom attributes and collapses', () => {
      render(<AttributesTool />);
      const minusBtn = screen.getByTitle('Remove all attributes and close');
      fireEvent.click(minusBtn);

      expect(queued).toContainEqual({
        type: 'updateHtmlAttrs',
        nodeId: 'n1',
        attrs: { 'data-category': '', 'data-theme': '' },
      });

      // The button should now be '+'
      expect(screen.getByTitle('Add attribute')).toBeDefined();
    });

    it('when node has no attributes, starts closed with plus button and opens on click', () => {
      mockControl = {
        nodeId: 'empty-1',
        node: {
          id: 'empty-1',
          type: 'div',
          attrs: {},
        },
      };
      render(<AttributesTool />);
      const plusBtn = screen.getByTitle('Add attribute');
      expect(plusBtn).toBeDefined();

      fireEvent.click(plusBtn);

      // Now opens with minus button and draft row ready
      expect(screen.getByTitle('Remove all attributes and close')).toBeDefined();
      expect(screen.getByPlaceholderText('data-attribute')).toBeDefined();
    });

    it('clicking the panel title "Attributes" folds the section without deleting attributes', () => {
      render(<AttributesTool />);
      // Initially open and shows attributes
      expect(screen.getByDisplayValue('data-theme')).toBeDefined();
      expect(queued).toHaveLength(0);

      // Click the title "Attributes"
      const titleSpan = screen.getByText('Attributes');
      fireEvent.click(titleSpan);

      // Section is visually folded: rows are hidden
      expect(screen.queryByDisplayValue('data-theme')).toBeNull();
      // NO deletion mutation was dispatched! Attributes are preserved
      expect(queued).toHaveLength(0);

      // Click the title "Attributes" again to unfold
      fireEvent.click(titleSpan);

      // Section is unfolded again with all attributes intact
      expect(screen.getByDisplayValue('data-theme')).toBeDefined();
      expect(queued).toHaveLength(0);
    });
  });

  describe('Design component instance support', () => {
    it('works on component instance nodes', () => {
      mockControl = {
        nodeId: 'cta-1',
        node: {
          id: 'cta-1',
          type: 'CTAButton',
          isComponentInstance: true,
          componentFile: 'components/CTAButton.tsx',
          attrs: {
            'data-tracking': 'hero-cta',
          },
        },
      };

      render(<AttributesTool />);
      expect(screen.getByDisplayValue('data-tracking')).toBeDefined();
      expect(screen.getByDisplayValue('hero-cta')).toBeDefined();

      const valInput = screen.getByDisplayValue('hero-cta');
      fireEvent.change(valInput, { target: { value: 'footer-cta' } });
      fireEvent.blur(valInput);

      expect(queued).toContainEqual({
        type: 'updateHtmlAttrs',
        nodeId: 'cta-1',
        attrs: { 'data-tracking': 'footer-cta' },
      });
    });
  });

  describe('Attributes editing and deletion', () => {
    it('commits updated value on blur', () => {
      render(<AttributesTool />);
      const valueInput = screen.getByDisplayValue('dark');
      fireEvent.change(valueInput, { target: { value: 'light' } });
      fireEvent.blur(valueInput);

      expect(queued).toContainEqual({
        type: 'updateHtmlAttrs',
        nodeId: 'n1',
        attrs: { 'data-theme': 'light' },
      });
    });

    it('commits renamed attribute key on blur', () => {
      render(<AttributesTool />);
      const keyInput = screen.getByDisplayValue('data-theme');
      fireEvent.change(keyInput, { target: { value: 'data-mode' } });
      fireEvent.blur(keyInput);

      expect(queued).toContainEqual({
        type: 'updateHtmlAttrs',
        nodeId: 'n1',
        attrs: { 'data-theme': '', 'data-mode': 'dark' },
      });
    });

    it('removes an attribute when clicking remove button', () => {
      render(<AttributesTool />);
      const removeButtons = screen.getAllByText('×');
      fireEvent.click(removeButtons[0]);

      expect(queued).toContainEqual({
        type: 'updateHtmlAttrs',
        nodeId: 'n1',
        attrs: { 'data-category': '' },
      });
    });

    it('adds a new attribute via the draft row', () => {
      render(<AttributesTool />);
      const addBtn = screen.getByText('+ Add attribute');
      fireEvent.click(addBtn);

      const nameInput = screen.getByPlaceholderText('data-attribute');
      const valInput = screen.getByPlaceholderText('attribute-value');

      fireEvent.change(nameInput, { target: { value: 'target' } });
      fireEvent.change(valInput, { target: { value: 'modal-1' } });
      fireEvent.keyDown(nameInput, { key: 'Enter' });

      expect(queued).toContainEqual({
        type: 'updateHtmlAttrs',
        nodeId: 'n1',
        attrs: { 'data-target': 'modal-1' },
      });
    });
  });
});
