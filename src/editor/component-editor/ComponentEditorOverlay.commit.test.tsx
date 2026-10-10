import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import { backend } from '@/backend/index';
import { cancelPendingAutosave } from '@/backend/autosave';
import { runBeforeAgentTurn } from '@/ai/agent/turn-hooks';
import { initHistory, getHistoryState, pushHistory, rebaselineHistory, undo, redo, finishPendingRestore } from '@/code/mutation/history';
import { initMutationQueue, getCurrentCode, queueMutation } from '@/code/mutation/mutation-queue';
import { isCanvasBusy, lockBranch, unlockBranch } from '@/code/stores/agent-run-lock-store';
import { setBumpVersion } from '@/code/project/modify-file';
import { activeFilePathAtom, componentBreadcrumbAtom } from '@/code/project/active-file-store';
import { projectFS, projectVersionAtom, resetProjectFS } from '@/code/project/project-fs';
import { componentEditorFileAtom, componentEditorPropsAtom } from '@/code/stores/component-editor-store';
import ComponentEditorOverlay from './ComponentEditorOverlay';
import { useMutationQueueLifecycle } from '@/canvas/hooks/useMutationQueueLifecycle';

vi.mock('./ComponentCodePane', () => ({ default: ({ onChange }: { onChange: (code: string) => void }) => <button onClick={() => onChange('LOCAL CHANGE')}>Type change</button> }));
vi.mock('./ComponentPreviewPane', () => ({ default: () => null }));
vi.mock('./ComponentPropsPanel', () => ({ default: () => null }));
vi.mock('@/editor/agent/AgentChat', () => ({ default: () => null }));
vi.mock('@/backend/index', () => ({ backend: { saveProject: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('@/backend/project-id', () => ({ getProjectId: () => 'component-test' }));
vi.mock('@/canvas/CanvasRenderer', () => ({ getCanvasRenderer: () => ({}) }));
vi.mock('@/canvas/transform', () => ({ applyPageCameraForSwitch: vi.fn(), initCameraPersist: () => () => {} }));

function PersistenceLifecycle() { useMutationQueueLifecycle({ onError: () => {} }); return null; }

const PAGE = 'app/page.client.tsx';
const MASTER = 'components/Widget.tsx';
const pageCode = 'export default function Page(){return <div data-id="root"/>;}';
const store = getDefaultStore();

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(backend.saveProject).mockClear();
  cancelPendingAutosave();
  resetProjectFS(new Map([[PAGE, pageCode], [MASTER, 'ORIGINAL']]));
  store.set(activeFilePathAtom, PAGE);
  store.set(componentBreadcrumbAtom, [PAGE]);
  store.set(componentEditorFileAtom, MASTER);
  initMutationQueue(pageCode, () => {});
  initHistory(pageCode, () => {}, () => store.get(activeFilePathAtom), () => store.set(projectVersionAtom, v => v + 1), undefined, {
    get: () => ({ breadcrumb: [...store.get(componentBreadcrumbAtom)] }),
    set: loc => store.set(componentBreadcrumbAtom, loc.breadcrumb ?? []),
  });
  setBumpVersion(() => store.set(projectVersionAtom, v => v + 1));
});

afterEach(() => {
  cleanup();
  cancelPendingAutosave();
  store.set(componentEditorFileAtom, null);
  vi.useRealTimers();
});

describe.each([
  ['Save', () => fireEvent.click(screen.getByRole('button', { name: 'Save' }))],
  ['Escape', () => fireEvent.keyDown(window, { key: 'Escape' })],
  ['before agent turn', () => act(() => runBeforeAgentTurn())],
])('%s component commit', (_label, commit) => {
  it('persists the nonactive master as one undoable edit and restores its location', async () => {
    render(<ComponentEditorOverlay />);
    fireEvent.click(screen.getByText('Type change'));
    commit();

    expect(projectFS.readFile(MASTER)).toBe('LOCAL CHANGE');
    expect(getCurrentCode()).toBe(pageCode);
    expect(getHistoryState().undoSize).toBe(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(backend.saveProject).toHaveBeenCalledWith('component-test', expect.objectContaining({ files: expect.objectContaining({ [MASTER]: 'LOCAL CHANGE' }) }), expect.anything());

    store.set(componentBreadcrumbAtom, []);
    expect(undo()).toBe(true);
    finishPendingRestore();
    expect(projectFS.readFile(MASTER)).toBe('ORIGINAL');
    expect(store.get(componentBreadcrumbAtom)).toEqual([PAGE]);
    store.set(componentBreadcrumbAtom, []);
    expect(redo()).toBe(true);
    finishPendingRestore();
    expect(projectFS.readFile(MASTER)).toBe('LOCAL CHANGE');
    expect(store.get(componentBreadcrumbAtom)).toEqual([PAGE]);
  });
});

it('an unedited overlay never overwrites an external file update', () => {
  render(<ComponentEditorOverlay />);
  act(() => {
    projectFS.writeFile(MASTER, 'EXTERNAL CHANGE');
    store.set(projectVersionAtom, v => v + 1);
  });
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(projectFS.readFile(MASTER)).toBe('EXTERNAL CHANGE');
});

it('saves a component master after its previous saved contents were emptied', () => {
  resetProjectFS(new Map([[PAGE, pageCode], [MASTER, '']]));
  expect(projectFS.readFile(MASTER)).toBe('');
  render(<ComponentEditorOverlay />);
  fireEvent.click(screen.getByText('Type change'));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(projectFS.readFile(MASTER)).toBe('LOCAL CHANGE');
  expect(getHistoryState().undoSize).toBe(1);
});

it('the Back control commits the edited master before closing', () => {
  render(<ComponentEditorOverlay />);
  fireEvent.click(screen.getByText('Type change'));
  fireEvent.click(screen.getByText('Back'));
  expect(projectFS.readFile(MASTER)).toBe('LOCAL CHANGE');
  expect(getHistoryState().undoSize).toBe(1);
  expect(store.get(componentEditorFileAtom)).toBeNull();
});

it('real history wiring reopens the component editor on undo after Escape and closes it on redo', async () => {
  store.set(componentEditorPropsAtom, { tone: 'soft' });
  render(<><PersistenceLifecycle /><ComponentEditorOverlay /></>);
  fireEvent.click(screen.getByText('Type change'));
  fireEvent.keyDown(window, { key: 'Escape' });
  await act(async () => { await Promise.resolve(); });
  expect(store.get(componentEditorFileAtom)).toBeNull();
  expect(projectFS.readFile(MASTER)).toBe('LOCAL CHANGE');
  act(() => {
    expect(undo()).toBe(true);
    finishPendingRestore();
  });
  expect(projectFS.readFile(MASTER)).toBe('ORIGINAL');
  expect(store.get(componentEditorFileAtom)).toBe(MASTER);
  expect(store.get(componentEditorPropsAtom)).toEqual({ tone: 'soft' });
  act(() => {
    expect(redo()).toBe(true);
    finishPendingRestore();
  });
  expect(projectFS.readFile(MASTER)).toBe('LOCAL CHANGE');
  expect(store.get(componentEditorFileAtom)).toBeNull();
  expect(store.get(componentEditorPropsAtom)).toEqual({});
});

it('undo restores an external file update that preceded the local buffer commit', () => {
  render(<ComponentEditorOverlay />);
  fireEvent.click(screen.getByText('Type change'));
  act(() => {
    projectFS.writeFile(MASTER, 'EXTERNAL CHANGE');
    store.set(projectVersionAtom, v => v + 1);
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(projectFS.readFile(MASTER)).toBe('LOCAL CHANGE');
  act(() => {
    expect(undo()).toBe(true);
    finishPendingRestore();
  });
  expect(projectFS.readFile(MASTER)).toBe('EXTERNAL CHANGE');
});

it('keeps the local buffer open and dirty when the active branch refuses a save', () => {
  render(<ComponentEditorOverlay />);
  fireEvent.click(screen.getByText('Type change'));
  const branch = projectFS.getActiveBranchId();
  lockBranch(branch);
  try {
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(projectFS.readFile(MASTER)).toBe('ORIGINAL');
    expect(store.get(componentEditorFileAtom)).toBe(MASTER);
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false);
    expect(getHistoryState().undoSize).toBe(0);
    expect(runBeforeAgentTurn()).toBe(false);
  } finally {
    unlockBranch(branch);
  }
});

it('does not drain the active page mutation queue when a locked branch refuses the component commit', () => {
  const pageWithBox = '<div data-id="root"><div data-id="box" style={{left: "0px"}} /></div>';
  projectFS.writeFile(PAGE, pageWithBox);
  initMutationQueue(pageWithBox, next => projectFS.writeFile(PAGE, next));
  render(<ComponentEditorOverlay />);
  fireEvent.click(screen.getByText('Type change'));
  queueMutation({ type: 'updateStyles', nodeId: 'box', styles: { left: '50px' } });
  const branch = projectFS.getActiveBranchId();
  lockBranch(branch);
  try {
    expect(isCanvasBusy()).toBe(true);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(projectFS.readFile(PAGE)).toBe(pageWithBox);
    expect(projectFS.readFile(MASTER)).toBe('ORIGINAL');
  } finally {
    unlockBranch(branch);
  }
});

it('seals a queued active-page change before recording the master edit', () => {
  const pageWithBox = '<div data-id="root"><div data-id="box" style={{left: "0px"}} /></div>';
  projectFS.writeFile(PAGE, pageWithBox);
  rebaselineHistory();
  initMutationQueue(pageWithBox, next => {
    projectFS.writeFile(PAGE, next);
    pushHistory(next);
  });
  render(<ComponentEditorOverlay />);
  fireEvent.click(screen.getByText('Type change'));
  queueMutation({ type: 'updateStyles', nodeId: 'box', styles: { left: '50px' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(projectFS.readFile(PAGE)).toContain("left: '50px'");
  expect(projectFS.readFile(MASTER)).toBe('LOCAL CHANGE');
  expect(getHistoryState().undoSize).toBe(2);
  act(() => { expect(undo()).toBe(true); finishPendingRestore(); });
  expect(projectFS.readFile(MASTER)).toBe('ORIGINAL');
  expect(projectFS.readFile(PAGE)).toContain("left: '50px'");
});
