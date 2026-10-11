import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useLibraryMultiSelect } from './useLibraryMultiSelect';

describe('Library bulk deletion refusal', () => {
  it('keeps a refused component selected for retry', async () => {
    const onDelete = vi.fn(() => false);
    let controls!: ReturnType<typeof useLibraryMultiSelect>;
    function Harness() {
      controls = useLibraryMultiSelect({ itemLabel: 'components', getDisplayName: path => path, onDelete });
      return controls.bulkDeleteModal;
    }
    render(<Harness />);
    act(() => { controls.togglePath('components/Card.tsx'); controls.requestBulkDelete(); });
    // requestBulkDelete reads state from the next render.
    act(() => controls.requestBulkDelete());
    await act(async () => { screen.getByRole('button', { name: 'Delete' }).click(); });
    expect(onDelete).toHaveBeenCalledWith('components/Card.tsx');
    expect(controls.isMultiSelected('components/Card.tsx')).toBe(true);
  });
});
