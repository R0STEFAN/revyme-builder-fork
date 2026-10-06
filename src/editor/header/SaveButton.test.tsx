// SaveButton.test.tsx — Unit tests for SaveButton component and saveProjectNow function.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import { saveStatusAtom } from '@/backend/save-store';
import SaveButton, { saveProjectNow } from './SaveButton';
import * as autosaveModule from '@/backend/autosave';
import * as mutationQueueModule from '@/code/mutation/mutation-queue';
import * as textCommitterModule from '@/canvas/text-edit-committer';
import { toast } from 'sonner';

vi.mock('@/backend/autosave', () => ({
  flushSaveNow: vi.fn(async () => {}),
}));

vi.mock('@/code/mutation/mutation-queue', () => ({
  flushNow: vi.fn(),
}));

vi.mock('@/canvas/text-edit-committer', () => ({
  commitActiveTextEdit: vi.fn(async () => {}),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('SaveButton & saveProjectNow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDefaultStore().set(saveStatusAtom, 'saved');
  });

  afterEach(() => {
    cleanup();
  });

  it('renders "Saved" with checkmark when saveStatus is saved', () => {
    getDefaultStore().set(saveStatusAtom, 'saved');
    render(<SaveButton />);

    const button = screen.getByTestId('header-save-button');
    expect(button.textContent).toContain('Saved');
  });

  it('renders "Save" with disk icon when saveStatus is unsaved', () => {
    getDefaultStore().set(saveStatusAtom, 'unsaved');
    render(<SaveButton />);

    const button = screen.getByTestId('header-save-button');
    expect(button.textContent).toContain('Save');
  });

  it('renders "Saving…" when saveStatus is saving', () => {
    getDefaultStore().set(saveStatusAtom, 'saving');
    render(<SaveButton />);

    const button = screen.getByTestId('header-save-button');
    expect(button.textContent).toContain('Saving…');
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('renders "Retry" when saveStatus is error', () => {
    getDefaultStore().set(saveStatusAtom, 'error');
    render(<SaveButton />);

    const button = screen.getByTestId('header-save-button');
    expect(button.textContent).toContain('Retry');
  });

  it('triggers manual save on button click and shows success toast', async () => {
    render(<SaveButton />);

    const button = screen.getByTestId('header-save-button');
    await act(async () => {
      fireEvent.click(button);
    });

    expect(textCommitterModule.commitActiveTextEdit).toHaveBeenCalled();
    expect(mutationQueueModule.flushNow).toHaveBeenCalled();
    expect(autosaveModule.flushSaveNow).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('Project saved');
  });

  it('saveProjectNow returns true on successful save and flushes all queues', async () => {
    const success = await saveProjectNow();
    expect(success).toBe(true);
    expect(textCommitterModule.commitActiveTextEdit).toHaveBeenCalled();
    expect(mutationQueueModule.flushNow).toHaveBeenCalled();
    expect(autosaveModule.flushSaveNow).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('Project saved');
  });

  it('saveProjectNow returns false and shows error toast on save failure', async () => {
    vi.mocked(autosaveModule.flushSaveNow).mockRejectedValueOnce(new Error('Network error'));

    const success = await saveProjectNow();
    expect(success).toBe(false);
    expect(toast.error).toHaveBeenCalledWith('Failed to save project');
  });
});
