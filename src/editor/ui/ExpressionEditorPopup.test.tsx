/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { atom } from 'jotai';

const { mockSchemas } = vi.hoisted(() => ({
  mockSchemas: new Map([
    [
      'categories',
      {
        name: 'Categories',
        slug: 'categories',
        fields: [
          { id: 'name', name: 'Name', type: 'text' },
          { id: 'slug', name: 'Slug', type: 'slug' },
        ],
      },
    ],
    [
      'posts',
      {
        name: 'Posts',
        slug: 'posts',
        fields: [
          { id: 'title', name: 'Title', type: 'text' },
          { id: 'image', name: 'Image', type: 'image' },
        ],
      },
    ],
  ]),
}));

vi.mock('@/code/stores/cms-store', () => ({
  collectionSchemasAtom: atom(mockSchemas),
  collectionDataAtom: atom(new Map()),
}));

import ExpressionEditorPopup from './ExpressionEditorPopup';

describe('ExpressionEditorPopup — Data Tokens Palette', () => {
  it('renders all collections in the project even when collectionSlug is set', () => {
    const onApply = vi.fn();
    const onClose = vi.fn();

    render(
      <ExpressionEditorPopup
        isOpen={true}
        onClose={onClose}
        onApply={onApply}
        collectionSlug="categories"
        itemVar="item"
      />,
    );

    // Current item / loop tokens should be visible with collection name
    expect(screen.getByText(/Categories \(item\):/)).toBeDefined();
    expect(screen.getByText('item.name')).toBeDefined();
    expect(screen.getByText('item.slug')).toBeDefined();

    // BOTH Categories AND Posts should be displayed in the all-collections palette
    expect(screen.getByText('Categories:')).toBeDefined();
    expect(screen.getByText('Posts:')).toBeDefined();
    expect(screen.getByText('title')).toBeDefined();
    expect(screen.getByText('image')).toBeDefined();
  });

  it('inserts collection token into expression textarea when clicked', () => {
    render(
      <ExpressionEditorPopup
        isOpen={true}
        onClose={vi.fn()}
        onApply={vi.fn()}
        collectionSlug="categories"
        itemVar="item"
      />,
    );

    const titleToken = screen.getByText('title');
    fireEvent.click(titleToken);

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(textarea.value).toContain('posts[0].title');
  });

  it('inserts current item token into expression textarea when clicked', () => {
    render(
      <ExpressionEditorPopup
        isOpen={true}
        onClose={vi.fn()}
        onApply={vi.fn()}
        collectionSlug="categories"
        itemVar="item"
      />,
    );

    const nameToken = screen.getByText('item.name');
    fireEvent.click(nameToken);

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(textarea.value).toContain('item.name');
  });
});
