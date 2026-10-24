import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import { projectFS, projectVersionAtom, resetProjectFS } from '@/code/project/project-fs';
import { activeFilePathAtom, componentBreadcrumbAtom } from '@/code/project/active-file-store';
import { componentEditorFileAtom, componentEditorPropsAtom } from '@/code/stores/component-editor-store';
import { selectedIdsAtom } from '@/code/stores/store';
import { initHistory, getHistoryState, undo, redo, finishPendingRestore } from '@/code/mutation/history';
import { initMutationQueue } from '@/code/mutation/mutation-queue';
import { cancelPendingAutosave } from '@/backend/autosave';
import { toast } from 'sonner';
import LibraryPanel from './index';

vi.mock('@/shared/debug-trace', () => ({ trace: { action: vi.fn(), fn: vi.fn(), dom: vi.fn(), error: vi.fn() } }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('./sections/ComponentsSection', () => ({
  ComponentsSection: ({ onDeleteComponent }: { onDeleteComponent: (file: string) => void }) =>
    <button onClick={() => onDeleteComponent('components/Card.tsx')}>Request Card delete</button>,
}));
vi.mock('./sections/VectorsSection', () => ({ VectorsSection: () => null }));
vi.mock('./sections/TemplatesSection', () => ({ TemplatesSection: () => null }));
vi.mock('./sections/CodeOverridesSection', () => ({ CodeOverridesSection: () => null }));
vi.mock('@/editor/left-toolbar/panels/plugins', () => ({ default: () => null }));
vi.mock('@/design-system/ConfirmDialog', () => ({
  default: ({ isOpen, onClose, onConfirm, message }: { isOpen: boolean; onClose: () => void; onConfirm: () => void; message?: string }) =>
    isOpen ? <div><p data-testid="confirm-message">{message}</p><button onClick={onClose}>Cancel delete</button><button onClick={onConfirm}>Confirm delete</button></div> : null,
}));

const page = 'app/page.client.tsx';
const master = 'components/Card.tsx';
const masterCode = 'export default function Card(){return <div data-id="card"/>;}';
const pageCode = 'import Card from "@/components/Card"; export default function Page(){return <Card data-id="card"/>;}';
const store = getDefaultStore();

function wireHistory() {
  initHistory(pageCode, () => {}, () => store.get(activeFilePathAtom), undefined, {
    get: () => [...store.get(selectedIdsAtom)],
    set: ids => store.set(selectedIdsAtom, ids),
    getNodeIds: () => projectFS.exists(master) ? new Set(['card']) : new Set(),
    navigateToFile: path => {
      if (!projectFS.exists(path)) return false;
      store.set(activeFilePathAtom, path);
      return true;
    },
  }, {
    get: () => ({
      breadcrumb: [...store.get(componentBreadcrumbAtom)],
      componentEditorFile: store.get(componentEditorFileAtom),
      componentEditorProps: { ...store.get(componentEditorPropsAtom) },
    }),
    set: loc => {
      store.set(componentBreadcrumbAtom, [...(loc.breadcrumb ?? [])]);
      store.set(componentEditorFileAtom, loc.componentEditorFile ?? null);
      store.set(componentEditorPropsAtom, { ...(loc.componentEditorProps ?? {}) });
    },
  });
}

beforeEach(() => {
  resetProjectFS(new Map([[page, pageCode], [master, masterCode], ['app/globals.css', ':root{}']]));
  store.set(activeFilePathAtom, master);
  store.set(componentBreadcrumbAtom, [page]);
  store.set(componentEditorFileAtom, master);
  store.set(componentEditorPropsAtom, { title: 'Preview' });
  store.set(selectedIdsAtom, ['card']);
  initMutationQueue(pageCode, code => projectFS.writeFile(page, code));
  wireHistory();
  vi.mocked(toast.error).mockClear();
});

afterEach(() => {
  cleanup();
  cancelPendingAutosave();
});

describe('LibraryPanel component deletion', () => {
  it('keeps the editor open when the user cancels confirmation', () => {
    render(<LibraryPanel mode="library" />);
    fireEvent.click(screen.getByText('Request Card delete'));
    expect(screen.getByTestId('confirm-message').textContent).toContain('You can undo this deletion with Edit > Undo.');
    expect(screen.getByTestId('confirm-message').textContent).not.toContain('This cannot be undone');
    expect(store.get(componentEditorFileAtom)).toBe(master);
    fireEvent.click(screen.getByText('Cancel delete'));
    expect(store.get(componentEditorFileAtom)).toBe(master);
    expect(store.get(activeFilePathAtom)).toBe(master);
    expect(projectFS.exists(master)).toBe(true);
    expect(getHistoryState().undoSize).toBe(0);
  });

  it('keeps editor, navigation and history intact when the delete plan refuses', () => {
    projectFS.writeFile('app/bad.tsx', 'import Card from "@/components/Card"; export default function Bad(){return <Card');
    wireHistory();
    render(<LibraryPanel mode="library" />);
    fireEvent.click(screen.getByText('Request Card delete'));
    fireEvent.click(screen.getByText('Confirm delete'));
    expect(projectFS.exists(master)).toBe(true);
    expect(store.get(componentEditorFileAtom)).toBe(master);
    expect(store.get(activeFilePathAtom)).toBe(master);
    expect(store.get(componentBreadcrumbAtom)).toEqual([page]);
    expect(getHistoryState().undoSize).toBe(0);
    expect(toast.error).toHaveBeenCalled();
    expect(screen.getByText('Confirm delete')).toBeTruthy();
  });

  it('undoes and redoes deletion with the correct editor location and selection', () => {
    render(<LibraryPanel mode="library" />);
    fireEvent.click(screen.getByText('Request Card delete'));
    fireEvent.click(screen.getByText('Confirm delete'));
    expect(projectFS.exists(master)).toBe(false);
    expect(store.get(activeFilePathAtom)).toBe(page);
    expect(store.get(componentEditorFileAtom)).toBeNull();
    expect(getHistoryState().undoSize).toBe(1);
    act(() => { expect(undo()).toBe(true); finishPendingRestore(); });
    expect(projectFS.readFile(master)).toBe(masterCode);
    expect(store.get(activeFilePathAtom)).toBe(master);
    expect(store.get(componentEditorFileAtom)).toBe(master);
    expect(store.get(componentEditorPropsAtom)).toEqual({ title: 'Preview' });
    expect(store.get(componentBreadcrumbAtom)).toEqual([page]);
    expect(store.get(selectedIdsAtom)).toEqual(['card']);
    act(() => { expect(redo()).toBe(true); finishPendingRestore(); });
    expect(store.get(activeFilePathAtom)).toBe(page);
    expect(store.get(componentEditorFileAtom)).toBeNull();
    expect(store.get(componentBreadcrumbAtom)).toEqual([]);
    expect(store.get(selectedIdsAtom)).toEqual([]);
  });

  it('keeps a different component editor open when deleting Card from another active page', () => {
    projectFS.writeFile('components/Other.tsx', 'export default function Other(){return <div/>;}');
    store.set(activeFilePathAtom, page);
    store.set(componentEditorFileAtom, 'components/Other.tsx');
    wireHistory();
    render(<LibraryPanel mode="library" />);
    fireEvent.click(screen.getByText('Request Card delete'));
    fireEvent.click(screen.getByText('Confirm delete'));
    expect(projectFS.exists(master)).toBe(false);
    expect(store.get(activeFilePathAtom)).toBe(page);
    expect(store.get(componentEditorFileAtom)).toBe('components/Other.tsx');
    act(() => { expect(undo()).toBe(true); finishPendingRestore(); });
    expect(store.get(activeFilePathAtom)).toBe(page);
    expect(store.get(componentEditorFileAtom)).toBe('components/Other.tsx');
    act(() => { expect(redo()).toBe(true); finishPendingRestore(); });
    expect(store.get(activeFilePathAtom)).toBe(page);
    expect(store.get(componentEditorFileAtom)).toBe('components/Other.tsx');
  });

  it('restores the deleted code editor overlay when a different page was active', () => {
    store.set(activeFilePathAtom, page);
    wireHistory();
    render(<LibraryPanel mode="library" />);
    fireEvent.click(screen.getByText('Request Card delete'));
    fireEvent.click(screen.getByText('Confirm delete'));
    expect(store.get(activeFilePathAtom)).toBe(page);
    expect(store.get(componentEditorFileAtom)).toBeNull();
    act(() => { expect(undo()).toBe(true); finishPendingRestore(); });
    expect(store.get(activeFilePathAtom)).toBe(page);
    expect(store.get(componentEditorFileAtom)).toBe(master);
    expect(store.get(componentEditorPropsAtom)).toEqual({ title: 'Preview' });
    act(() => { expect(redo()).toBe(true); finishPendingRestore(); });
    expect(store.get(componentEditorFileAtom)).toBeNull();
    expect(store.get(componentEditorPropsAtom)).toEqual({});
  });

  it('deletes every token in a responsive dimension preset family and preserves other presets', () => {
    projectFS.writeFile('app/globals.css', `:root {
  --space-card: 16px;
  --space-card-md: 12px;
  --space-card-sm: 8px;
  --radius-card: 10px;
}`);
    store.set(projectVersionAtom, value => value + 1);
    render(<LibraryPanel mode="presets" />);

    const row = document.querySelector('[data-folder-tree-row="space-card"]');
    expect(row).toBeTruthy();
    fireEvent.click(row!.querySelector('button')!);
    fireEvent.click(screen.getByText('Delete'));

    const updatedCss = projectFS.readFile('app/globals.css') ?? '';
    expect(updatedCss).not.toContain('--space-card');
    expect(updatedCss).toContain('--radius-card: 10px');
  });
});
