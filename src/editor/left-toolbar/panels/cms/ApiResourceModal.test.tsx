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

import { ApiResourceModal, inferSchemaFromItems } from './ApiResourceModal';

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
});

describe('ApiResourceModal', () => {
  beforeEach(() => {
    fsStore.clear();
    vi.restoreAllMocks();
  });

  it('renders inputs and tests connection via /api/proxy', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: 101, name: 'Dragon Tattoo', style: 'Irezumi' },
          { id: 102, name: 'Koi Fish', style: 'Japanese' },
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

    const testBtn = screen.getByRole('button', { name: /load data \/ test connection/i });
    fireEvent.click(testBtn);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/proxy', expect.any(Object));
    });

    await waitFor(() => {
      expect(screen.getByText(/loaded 2 items/i)).toBeTruthy();
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
  });
});
