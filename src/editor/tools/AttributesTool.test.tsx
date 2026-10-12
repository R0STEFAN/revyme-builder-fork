/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { isCustomDataAttr, isCustomAttr, isBuilderDefaultAttr, COMMON_ATTRIBUTE_SUGGESTIONS, SYSTEM_DATA_ATTRS } from '@/shared/constants';

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

  describe('isCustomAttr', () => {
    it('returns true for user data attributes and non-data custom/HTML attributes', () => {
      expect(isCustomAttr('data-category')).toBe(true);
      expect(isCustomAttr('data-testid')).toBe(true);
      expect(isCustomAttr('loading')).toBe(true);
      expect(isCustomAttr('title')).toBe(true);
      expect(isCustomAttr('role')).toBe(true);
      expect(isCustomAttr('aria-describedby')).toBe(true);
      expect(isCustomAttr('custom-attr')).toBe(true);
    });

    it('returns false for primary dedicated HTML attributes', () => {
      expect(isCustomAttr('id')).toBe(false);
      expect(isCustomAttr('src')).toBe(false);
      expect(isCustomAttr('alt')).toBe(false);
      expect(isCustomAttr('href')).toBe(false);
      expect(isCustomAttr('aria-label')).toBe(false);
    });

    it('returns false for reserved JSX/React props', () => {
      expect(isCustomAttr('style')).toBe(false);
      expect(isCustomAttr('className')).toBe(false);
      expect(isCustomAttr('key')).toBe(false);
      expect(isCustomAttr('ref')).toBe(false);
    });

    it('returns false for system data attributes', () => {
      expect(isCustomAttr('data-id')).toBe(false);
      expect(isCustomAttr('data-name')).toBe(false);
      expect(isCustomAttr('data-viewport')).toBe(false);
      expect(isCustomAttr('data-canvas-node')).toBe(false);
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

    it('adds a new data attribute via the draft row keeping data- prefix', () => {
      render(<AttributesTool />);
      const addBtn = screen.getByText('+ Add attribute');
      fireEvent.click(addBtn);

      const nameInput = screen.getByPlaceholderText('data-attribute');
      const valInput = screen.getByPlaceholderText('attribute-value');

      expect((nameInput as HTMLInputElement).value).toBe('data-');

      fireEvent.change(nameInput, { target: { value: 'data-target' } });
      fireEvent.change(valInput, { target: { value: 'modal-1' } });
      fireEvent.keyDown(nameInput, { key: 'Enter' });

      expect(queued).toContainEqual({
        type: 'updateHtmlAttrs',
        nodeId: 'n1',
        attrs: { 'data-target': 'modal-1' },
      });
    });

    it('allows deleting data- prefix and adding custom attribute without data- prefix', () => {
      render(<AttributesTool />);
      const addBtn = screen.getByText('+ Add attribute');
      fireEvent.click(addBtn);

      const nameInput = screen.getByPlaceholderText('data-attribute');
      const valInput = screen.getByPlaceholderText('attribute-value');

      // data- is there by default
      expect((nameInput as HTMLInputElement).value).toBe('data-');

      // User deletes "data-" and writes "loading"
      fireEvent.change(nameInput, { target: { value: 'loading' } });
      fireEvent.change(valInput, { target: { value: 'lazy' } });
      fireEvent.keyDown(nameInput, { key: 'Enter' });

      expect(queued).toContainEqual({
        type: 'updateHtmlAttrs',
        nodeId: 'n1',
        attrs: { loading: 'lazy' },
      });
    });

    it('displays custom non-data attributes such as loading and allows updating them', () => {
      mockControl = {
        nodeId: 'img-1',
        node: {
          id: 'img-1',
          type: 'img',
          attrs: {
            'data-id': 'img-1',
            src: 'photo.jpg',
            alt: 'Photo',
            loading: 'lazy',
            'data-zoom': 'true',
          },
        },
      };

      render(<AttributesTool />);
      expect(screen.getByDisplayValue('loading')).toBeDefined();
      expect(screen.getByDisplayValue('lazy')).toBeDefined();
      expect(screen.getByDisplayValue('data-zoom')).toBeDefined();
      // Dedicated attributes like src/alt are not listed under custom attributes
      expect(screen.queryByDisplayValue('photo.jpg')).toBeNull();

      // Update loading value from lazy to eager
      const valInput = screen.getByDisplayValue('lazy');
      fireEvent.change(valInput, { target: { value: 'eager' } });
      fireEvent.blur(valInput);

      expect(queued).toContainEqual({
        type: 'updateHtmlAttrs',
        nodeId: 'img-1',
        attrs: { loading: 'eager' },
      });
    });
  });

  describe('Builder default attributes protection', () => {
    it('isBuilderDefaultAttr identifies default builder attributes on img', () => {
      expect(isBuilderDefaultAttr('img', 'decoding', 'async')).toBe(true);
      expect(isBuilderDefaultAttr('img', 'loading', 'lazy')).toBe(true);
      expect(isBuilderDefaultAttr('motion.img', 'decoding', 'async')).toBe(true);
      expect(isBuilderDefaultAttr('Image', 'decoding', 'async')).toBe(true);

      // Modified by user -> no longer default
      expect(isBuilderDefaultAttr('img', 'decoding', 'sync')).toBe(false);
      expect(isBuilderDefaultAttr('img', 'loading', 'eager')).toBe(false);

      // Custom attributes -> not builder defaults
      expect(isBuilderDefaultAttr('img', 'data-zoom', 'true')).toBe(false);
      expect(isBuilderDefaultAttr('div', 'decoding', 'async')).toBe(false);
    });

    it('disables deletion for unchanged builder default attribute and prevents removal', () => {
      mockControl = {
        nodeId: 'img-1',
        node: {
          id: 'img-1',
          type: 'img',
          attrs: {
            'data-id': 'img-1',
            decoding: 'async',
            'data-custom': '123',
          },
        },
      };

      render(<AttributesTool />);
      const decodingKeyInput = screen.getByDisplayValue('decoding');
      // The key of builder default attribute is disabled to prevent accidental rename
      expect(decodingKeyInput.getAttribute('disabled')).not.toBeNull();

      // Find the disabled remove button
      const removeButtons = screen.getAllByText('×');
      // The first button corresponds to data-custom or decoding depending on sorting
      const decodingRemoveBtn = screen.getByTitle('Default builder attribute (cannot be deleted)');
      expect(decodingRemoveBtn).toBeDefined();

      // Clicking disabled remove button does NOT dispatch removal
      fireEvent.click(decodingRemoveBtn);
      expect(queued).toHaveLength(0);
    });

    it('header toggle button does not delete builder default attributes', () => {
      mockControl = {
        nodeId: 'img-1',
        node: {
          id: 'img-1',
          type: 'img',
          attrs: {
            'data-id': 'img-1',
            decoding: 'async',
            'data-custom': 'test-val',
          },
        },
      };

      render(<AttributesTool />);
      const minusBtn = screen.getByTitle('Remove all attributes and close');
      fireEvent.click(minusBtn);

      // Only data-custom should be removed; decoding="async" must be preserved!
      expect(queued).toContainEqual({
        type: 'updateHtmlAttrs',
        nodeId: 'img-1',
        attrs: { 'data-custom': '' },
      });
      // decoding must NOT be in the removal mutation
      const updateMut = queued.find((m) => m.type === 'updateHtmlAttrs');
      expect(updateMut.attrs.decoding).toBeUndefined();
    });

    it('allows deleting builder attribute if user changed its value from default', () => {
      mockControl = {
        nodeId: 'img-1',
        node: {
          id: 'img-1',
          type: 'img',
          attrs: {
            'data-id': 'img-1',
            decoding: 'sync', // modified by user!
          },
        },
      };

      render(<AttributesTool />);
      // Remove button should be active because value was modified by user
      const removeBtn = screen.getByTitle('Remove attribute');
      expect(removeBtn).toBeDefined();

      fireEvent.click(removeBtn);
      expect(queued).toContainEqual({
        type: 'updateHtmlAttrs',
        nodeId: 'img-1',
        attrs: { decoding: '' },
      });
    });
  });

  describe('Attribute suggestions dropdown', () => {
    it('shows suggestions dropdown and allows picking with mouse', () => {
      render(<AttributesTool />);
      const addBtn = screen.getByText('+ Add attribute');
      fireEvent.click(addBtn);

      const nameInput = screen.getByPlaceholderText('data-attribute');
      const valInput = screen.getByPlaceholderText('attribute-value');

      // Type "load"
      fireEvent.change(nameInput, { target: { value: 'load' } });

      const suggestions = screen.getByTestId('attribute-suggestions');
      expect(suggestions).toBeDefined();

      // Click on "loading" suggestion
      const loadingOption = screen.getByTestId('attribute-suggestion-loading');
      expect(loadingOption).toBeDefined();
      fireEvent.click(loadingOption);

      // nameInput now has "loading" and valInput has default value "lazy"
      expect((nameInput as HTMLInputElement).value).toBe('loading');
      expect((valInput as HTMLInputElement).value).toBe('lazy');
    });

    it('navigates suggestions with ArrowDown, ArrowUp and selects with Enter', () => {
      render(<AttributesTool />);
      const addBtn = screen.getByText('+ Add attribute');
      fireEvent.click(addBtn);

      const nameInput = screen.getByPlaceholderText('data-attribute');
      const valInput = screen.getByPlaceholderText('attribute-value');

      // Type "dec"
      fireEvent.change(nameInput, { target: { value: 'dec' } });

      // Suggestions dropdown is open
      expect(screen.getByTestId('attribute-suggestions')).toBeDefined();

      // Press ArrowDown then Enter to select first suggestion
      fireEvent.keyDown(nameInput, { key: 'ArrowDown' });
      fireEvent.keyDown(nameInput, { key: 'Enter' });

      // Suggestion decoding should be applied with defaultValue async
      expect((nameInput as HTMLInputElement).value).toBe('decoding');
      expect((valInput as HTMLInputElement).value).toBe('async');
    });

    it('flips suggestions dropdown upwards when space below in viewport is insufficient', () => {
      const originalInnerHeight = window.innerHeight;
      window.innerHeight = 600;

      const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
      HTMLElement.prototype.getBoundingClientRect = vi.fn().mockReturnValue({
        bottom: 520,
        top: 480,
        left: 20,
        right: 250,
        width: 230,
        height: 40,
      });

      try {
        render(<AttributesTool />);
        const addBtn = screen.getByText('+ Add attribute');
        fireEvent.click(addBtn);

        const nameInput = screen.getByPlaceholderText('data-attribute');
        fireEvent.change(nameInput, { target: { value: 'loa' } });

        const suggestions = screen.getByTestId('attribute-suggestions');
        expect(suggestions.getAttribute('data-direction')).toBe('up');
        expect(suggestions.className).toContain('bottom-full');
      } finally {
        window.innerHeight = originalInnerHeight;
        HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
      }
    });

    it('opens suggestions dropdown downwards when space below is sufficient', () => {
      const originalInnerHeight = window.innerHeight;
      window.innerHeight = 1000;

      const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
      HTMLElement.prototype.getBoundingClientRect = vi.fn().mockReturnValue({
        bottom: 300,
        top: 260,
        left: 20,
        right: 250,
        width: 230,
        height: 40,
      });

      try {
        render(<AttributesTool />);
        const addBtn = screen.getByText('+ Add attribute');
        fireEvent.click(addBtn);

        const nameInput = screen.getByPlaceholderText('data-attribute');
        fireEvent.change(nameInput, { target: { value: 'loa' } });

        const suggestions = screen.getByTestId('attribute-suggestions');
        expect(suggestions.getAttribute('data-direction')).toBe('down');
        expect(suggestions.className).toContain('top-full');
      } finally {
        window.innerHeight = originalInnerHeight;
        HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
      }
    });
  });
});
