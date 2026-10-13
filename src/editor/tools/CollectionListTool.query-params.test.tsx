import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

const mockQueueMutation = vi.fn();
const mockFlushNow = vi.fn();
const mockForceCanvasRender = vi.fn();

vi.mock('@/code/mutation/mutation-queue', () => ({
  queueMutation: (...args: any[]) => mockQueueMutation(...args),
  flushNow: () => mockFlushNow(),
  syncQueueCode: vi.fn(),
}));

vi.mock('@/canvas/node-ops', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    forceCanvasRender: () => mockForceCanvasRender(),
  };
});

vi.mock('@/shared/debug-trace', () => ({
  trace: { action: vi.fn(), fn: vi.fn(), dom: vi.fn(), error: vi.fn() },
}));

const mockNode = {
  id: 'grid-1',
  collectionList: {
    source: 'tattoos',
    itemVar: 'item',
    templateIds: { default: 'card-1' },
    queryConfig: {
      isApiMode: true,
      params: [{ key: 'limit', value: '12', isExpression: false }],
    },
  },
};

vi.mock('../controls/ControlProvider', () => ({
  useControl: () => ({
    node: mockNode,
    styles: {},
    hasOverride: () => false,
    getValueSource: () => ({ source: 'direct' }),
  }),
}));

// Mock atoms
vi.mock('@/code/stores/cms-store', () => {
  const { atom } = require('jotai');
  const apiMap = new Map();
  apiMap.set('tattoos', { slug: 'tattoos', name: 'Tattoos', provider: 'directus', url: 'https://example.com' });
  return {
    collectionSchemasAtom: atom(new Map()),
    collectionDataAtom: atom(new Map()),
    apiCollectionsConfigAtom: atom(apiMap),
  };
});

vi.mock('@/code/stores/store', async (importOriginal) => {
  const actual: any = await importOriginal();
  const { atom } = await import('jotai');
  return {
    ...actual,
    isComponentFileAtom: atom(false),
  };
});

vi.mock('@/code/stores/viewport-store', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    isReplicaViewportAtom: actual.isReplicaViewportAtom,
    interactingViewportWidthAtom: actual.interactingViewportWidthAtom,
  };
});

vi.mock('@/code/project/cms-ops', () => ({
  listCollections: () => ['tattoos'],
  getCollectionSchema: () => ({ slug: 'tattoos', name: 'Tattoos', fields: [] }),
}));

import CollectionListTool from './CollectionListTool';

describe('CollectionListTool with API collection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders Query Parameters table and hides client filter/sort when collection is API', () => {
    render(<CollectionListTool />);

    expect(screen.getByText(/Query Parameters \(Backend\)/i)).toBeTruthy();
    expect(screen.getByDisplayValue('limit')).toBeTruthy();
    expect(screen.getByDisplayValue('12')).toBeTruthy();
    expect(screen.queryByText(/Match All/i)).toBeNull();
    expect(screen.queryByText(/Sort by/i)).toBeNull();
  });

  it('adds a new query parameter on button click and queues mutation', () => {
    render(<CollectionListTool />);

    const addBtn = screen.getByRole('button', { name: /\+ add parameter/i });
    fireEvent.click(addBtn);

    expect(mockQueueMutation).toHaveBeenCalledWith({
      type: 'updateCollectionQueryConfig',
      parentId: 'grid-1',
      queryConfig: {
        isApiMode: true,
        params: [
          { key: 'limit', value: '12', isExpression: false },
          { key: '', value: '', isExpression: false },
        ],
      },
    });
    expect(mockFlushNow).toHaveBeenCalled();
    expect(mockForceCanvasRender).toHaveBeenCalled();
  });
});
