import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

const fsStore = vi.hoisted(() => new Map<string, string>());

vi.mock('@/code/project/project-fs', () => {
  const { atom } = require('jotai');
  return {
    projectVersionAtom: atom(0),
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
  };
});

vi.mock('@/backend/autosave', () => ({
  triggerAutosave: vi.fn(),
}));

vi.mock('@/shared/debug-trace', () => ({
  trace: { action: vi.fn(), fn: vi.fn(), dom: vi.fn(), error: vi.fn() },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import CmsPanel from './CmsPanel';

describe('CmsPanel', () => {
  beforeEach(() => {
    fsStore.clear();
  });

  it('renders mode switch and defaults to Local (JSON) mode', () => {
    render(<CmsPanel />);
    expect(screen.getByText('CMS Mode')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^local \(json\)$/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^external api$/i })).toBeTruthy();
    expect(screen.getByText('No collections yet')).toBeTruthy();
  });

  it('switches to External API mode and shows API banner and empty state', () => {
    render(<CmsPanel />);
    const apiBtn = screen.getByRole('button', { name: /^external api$/i });
    fireEvent.click(apiBtn);

    expect(screen.getByText(/content is managed in external cms/i)).toBeTruthy();
    expect(screen.getByText(/no api resources connected/i)).toBeTruthy();
  });
});
