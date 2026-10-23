import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const fsStore = vi.hoisted(() => new Map<string, string>());

vi.mock('@/code/project/project-fs', () => ({
  projectFS: {
    readFile: vi.fn((path: string) => fsStore.get(path) ?? null),
    writeFile: vi.fn((path: string, content: string) => { fsStore.set(path, content); }),
    deleteFile: vi.fn((path: string) => { fsStore.delete(path); }),
    listFiles: vi.fn((dir?: string) => {
      const prefix = dir ? (dir.endsWith('/') ? dir : dir + '/') : '';
      const result: string[] = [];
      for (const path of fsStore.keys()) {
        if (!prefix || path.startsWith(prefix)) result.push(path);
      }
      return result.sort();
    }),
    exists: vi.fn((path: string) => fsStore.has(path)),
  },
}));

vi.mock('@/backend/autosave', () => ({
  triggerAutosave: vi.fn(),
}));

vi.mock('@/shared/debug-trace', () => ({
  trace: { action: vi.fn(), fn: vi.fn(), dom: vi.fn(), error: vi.fn() },
}));

// Mock toast
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { ApiResourceModal, inferSchemaFromItems, appendQueryParams } from './ApiResourceModal';

describe('inferSchemaFromItems', () => {
  it('infers field types correctly from sample JSON array', () => {
    const sampleItems = [
      {
        id: 1,
        title: 'Cyberpunk Katana',
        price: 49.99,
        available: true,
        created_at: '2026-10-12T10:00:00Z',
        cover_image: 'https://cdn.example.com/katana.webp',
        description: 'A very detailed crafted high frequency blade with custom neon engravings and haptic feedback module.',
      },
    ];

    const schema = inferSchemaFromItems('weapons', 'Weapons', sampleItems);
    expect(schema.slug).toBe('weapons');
    expect(schema.name).toBe('Weapons');
    expect(schema.fields).toHaveLength(7);

    const titleField = schema.fields.find(f => f.id === 'title');
    expect(titleField?.type).toBe('text');

    const priceField = schema.fields.find(f => f.id === 'price');
    expect(priceField?.type).toBe('number');

    const boolField = schema.fields.find(f => f.id === 'available');
    expect(boolField?.type).toBe('boolean');

    const dateField = schema.fields.find(f => f.id === 'created_at');
    expect(dateField?.type).toBe('date');

    const imgField = schema.fields.find(f => f.id === 'cover_image');
    expect(imgField?.type).toBe('image');

    const descField = schema.fields.find(f => f.id === 'description');
    expect(descField?.type).toBe('textarea');
  });

  it('infers nested object properties and recognizes image objects like Directus file', () => {
    const sampleItems = [
      {
        id: 'item-1',
        title: 'Tattoo Art',
        img_file: {
          id: '436f6e77-e4d1-451d-9a71-0b2a9e4c2588',
          storage: 'local',
          filename_disk: '436f6e77-e4d1-451d-9a71-0b2a9e4c2588.webp',
          filename_download: 'IMG_0477.webp',
          title: 'Img 0477',
          type: 'image/webp',
          width: 4284,
          height: 5712,
        },
      },
    ];

    const schema = inferSchemaFromItems('tattoos', 'Tattoos', sampleItems);
    expect(schema.slug).toBe('tattoos');

    // Root fields
    const parentImg = schema.fields.find(f => f.id === 'img_file');
    expect(parentImg).toBeDefined();
    expect(parentImg?.type).toBe('image');

    // Nested fields
    const nestedId = schema.fields.find(f => f.id === 'img_file.id');
    expect(nestedId).toBeDefined();
    expect(nestedId?.name).toBe('Img File → Id');
    expect(nestedId?.type).toBe('text');

    const nestedFilename = schema.fields.find(f => f.id === 'img_file.filename_disk');
    expect(nestedFilename).toBeDefined();
    expect(nestedFilename?.type).toBe('image');

    // Asset technical metadata is intentionally omitted from editable fields.
    expect(schema.fields.find(f => f.id === 'img_file.width')).toBeUndefined();
    expect(schema.fields.find(f => f.id === 'img_file.height')).toBeUndefined();
  });
});

describe('appendQueryParams', () => {
  it('appends query parameters cleanly to URL', () => {
    const res = appendQueryParams('https://api.example.com/items', [
      { key: 'fields', value: '*,img_file.*' },
      { key: 'sort', value: '-id' },
    ]);
    expect(res).toBe('https://api.example.com/items?fields=*%2Cimg_file.*&sort=-id');
  });

  it('handles existing query parameters on URL', () => {
    const res = appendQueryParams('https://api.example.com/items?limit=10', [
      { key: 'fields', value: '*.*' },
    ]);
    expect(res).toContain('limit=10');
    expect(res).toContain('fields=');
  });
});

describe('ApiResourceModal', () => {
  beforeEach(() => {
    fsStore.clear();
    vi.restoreAllMocks();
  });

  it('renders inputs and tests connection via /api/proxy with query parameters', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            id: 101,
            name: 'Dragon Tattoo',
            img_file: {
              id: 'uuid-1',
              filename_disk: 'tattoo.webp',
            },
          },
        ],
      }),
    });
    global.fetch = mockFetch;

    render(
      <ApiResourceModal
        isOpen={true}
        onClose={() => {}}
        onSaved={() => {}}
      />
    );

    expect(screen.getByText('Connect External API / CMS')).toBeTruthy();
    const urlInput = screen.getByPlaceholderText('https://api.example.com/items/tattoos');
    fireEvent.change(urlInput, { target: { value: 'https://api.example.com/items/tattoos' } });
    fireEvent.blur(urlInput);

    // Add Directus fields preset
    const presetBtn = screen.getByRole('button', { name: /\+ directus fields \(\*\.\*\)/i });
    fireEvent.click(presetBtn);

    // Now modify the fields parameter to *,img_file.*
    const valInput = screen.getByPlaceholderText('Value (e.g. *,img_file.*)');
    fireEvent.change(valInput, { target: { value: '*,img_file.*' } });

    const testBtn = screen.getByRole('button', { name: /load data \/ test connection/i });
    fireEvent.click(testBtn);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/proxy', expect.objectContaining({
        body: expect.stringContaining('fields=*%2Cimg_file.*'),
      }));
    });

    await waitFor(() => {
      expect(screen.getByText(/loaded 1 items/i)).toBeTruthy();
    });

    const saveBtn = screen.getByRole('button', { name: /save api collection/i });
    fireEvent.click(saveBtn);

    // Verify ProjectFS writes
    expect(fsStore.get('cms/tattoos.schema.json')).toBeDefined();
    expect(fsStore.get('cms/tattoos.json')).toBeDefined();
    expect(fsStore.get('_meta/cms-api-config.json')).toBeDefined();

    const config = JSON.parse(fsStore.get('_meta/cms-api-config.json')!);
    expect(config.mode).toBe('api');
    expect(config.apiCollections.tattoos).toBeDefined();
    expect(config.apiCollections.tattoos.url).toBe('https://api.example.com/items/tattoos');
    expect(config.apiCollections.tattoos.defaultParams).toEqual({
      fields: '*,img_file.*',
    });
  });
});
