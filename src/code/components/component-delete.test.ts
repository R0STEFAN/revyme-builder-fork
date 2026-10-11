import { beforeEach, describe, expect, it, vi } from 'vitest';
import { projectFS, resetProjectFS } from '../project/project-fs';
import { parseJSX } from '../parsing/ast-utils';
import { deleteComponent } from './component-ops';
import { initMutationQueue, queueMutation, hasQueuedMutations, flushNow } from '../mutation/mutation-queue';
import { getHistoryState, initHistory, undo, finishPendingRestore, pushHistoryFileOp } from '../mutation/history';
import { lockBranch, unlockBranch } from '../stores/agent-run-lock-store';

vi.mock('@/shared/debug-trace', () => ({ trace: { action: vi.fn(), fn: vi.fn(), dom: vi.fn(), error: vi.fn() } }));

const master = 'components/Card.tsx';
const page = 'app/page.client.tsx';
const card = 'export default function Card(){return <div data-id="card-root"/>;}';

beforeEach(() => resetProjectFS(new Map([[master, card]])));

describe('deleteComponent AST transaction', () => {
  it('replaces a sole JSX return with null and removes the import', () => {
    projectFS.writeFile(page, 'import Card from "@/components/Card"; export default function Page(){ return (<Card data-id="one" />); }');
    expect(deleteComponent(master)).toEqual([page]);
    const result = projectFS.readFile(page)!;
    expect(parseJSX(result)).not.toBeNull();
    expect(result).toMatch(/return\s*\(?null\)?/);
    expect(result).not.toContain('import Card');
    expect(projectFS.exists(master)).toBe(false);
  });

  it('resolves an aliased import by file path and handles arrow props and nested instances', () => {
    projectFS.writeFile(page, 'import Tile from "@/components/Card"; export default function Page(){return <div data-id="root"><Tile data-id="outer" onClick={() => x > 0}><Tile data-id="inner" /></Tile><p data-id="tail">Tail</p></div>;}');
    expect(deleteComponent(master)).toEqual([page]);
    const result = projectFS.readFile(page)!;
    expect(parseJSX(result)).not.toBeNull();
    expect(result).not.toContain('<Tile');
    expect(result).toContain('Tail');
  });

  it('refuses every write when a dependent is malformed', () => {
    const valid = 'import Card from "@/components/Card"; export default function A(){return <Card data-id="a"/>;}';
    const broken = 'import Card from "@/components/Card"; export default function B(){return <Card';
    projectFS.writeFile(page, valid);
    projectFS.writeFile('app/broken.tsx', broken);
    expect(() => deleteComponent(master)).toThrow();
    expect(projectFS.readFile(page)).toBe(valid);
    expect(projectFS.readFile('app/broken.tsx')).toBe(broken);
    expect(projectFS.exists(master)).toBe(true);
  });

  it('refuses unsupported non-JSX references rather than leaving a dangling binding', () => {
    const source = 'import Card from "@/components/Card"; const Other = Card; export default function Page(){return <Card data-id="a"/>;}';
    projectFS.writeFile(page, source);
    expect(() => deleteComponent(master)).toThrow();
    expect(projectFS.readFile(page)).toBe(source);
    expect(projectFS.exists(master)).toBe(true);
  });

  it('refuses type references to the imported component', () => {
    const source = 'import Card from "@/components/Card"; type CardType = typeof Card; export default function Page(){return <Card data-id="a"/>;}';
    projectFS.writeFile(page, source);
    expect(() => deleteComponent(master)).toThrow();
    expect(projectFS.readFile(page)).toBe(source);
    expect(projectFS.exists(master)).toBe(true);
  });

  it('refuses exporting the imported binding', () => {
    const source = 'import Card from "@/components/Card"; export { Card }; export default function Page(){return <Card data-id="a"/>;}';
    projectFS.writeFile(page, source);
    expect(() => deleteComponent(master)).toThrow();
    expect(projectFS.readFile(page)).toBe(source);
    expect(projectFS.exists(master)).toBe(true);
  });

  it('refuses named imports and re-exports before writing a valid dependent', () => {
    const valid = 'import Card from "@/components/Card"; export default function Page(){return <Card data-id="a"/>;}';
    projectFS.writeFile(page, valid);
    projectFS.writeFile('app/reexport.ts', 'export { default as Tile } from "@/components/Card";');
    expect(() => deleteComponent(master)).toThrow();
    expect(projectFS.readFile(page)).toBe(valid);
    expect(projectFS.exists(master)).toBe(true);
  });

  it('refuses dynamic imports of the master', () => {
    const source = 'export async function load(){ return import("@/components/Card"); }';
    projectFS.writeFile(page, source);
    expect(() => deleteComponent(master)).toThrow();
    expect(projectFS.readFile(page)).toBe(source);
    expect(projectFS.exists(master)).toBe(true);
  });

  it.each([
    'import { default as Tile } from "@/components/Card"; export default function Page(){return <Tile data-id="a"/>;}',
    'import * as Kit from "@/components/Card"; export default function Page(){return <Kit.Card data-id="a"/>;}',
  ])('refuses an unsupported binding shape without deleting its source', source => {
    projectFS.writeFile(page, source);
    expect(() => deleteComponent(master)).toThrow();
    expect(projectFS.readFile(page)).toBe(source);
    expect(projectFS.exists(master)).toBe(true);
  });

  it('flushes a pending canvas edit before planning deletion', () => {
    const source = 'import Card from "@/components/Card"; export default function Page(){return <div data-id="root" style={{color: "red"}}><Card data-id="a"/></div>;}';
    projectFS.writeFile(page, source);
    initMutationQueue(source, code => projectFS.writeFile(page, code));
    queueMutation({ type: 'updateStyles', nodeId: 'root', styles: { color: 'blue' } });
    deleteComponent(master);
    expect(projectFS.readFile(page)).toContain('blue');
    expect(projectFS.readFile(page)).not.toContain('<Card');
  });

  it('refuses a locked canvas before draining pending edits or deleting the master', () => {
    const source = 'import Card from "@/components/Card"; export default function Page(){return <div data-id="root" style={{color:"red"}}><Card data-id="a"/></div>;}';
    projectFS.writeFile(page, source);
    initMutationQueue(source, code => projectFS.writeFile(page, code));
    queueMutation({ type: 'updateStyles', nodeId: 'root', styles: { color: 'blue' } });
    const branch = projectFS.getActiveBranchId();
    lockBranch(branch);
    try {
      expect(() => deleteComponent(master)).toThrow();
      expect(projectFS.readFile(page)).toBe(source);
      expect(projectFS.readFile(master)).toBe(card);
      expect(hasQueuedMutations()).toBe(true);
    } finally {
      unlockBranch(branch);
      flushNow();
    }
  });

  it('resolves a directory index master to the actual imported file', () => {
    projectFS.deleteFile(master);
    const indexMaster = 'components/Card/index.tsx';
    projectFS.writeFile(indexMaster, card);
    projectFS.writeFile(page, 'import Tile from "@/components/Card"; export default function Page(){return <Tile data-id="a"/>;}');
    expect(deleteComponent(indexMaster)).toEqual([page]);
    expect(projectFS.readFile(page)).not.toContain('<Tile');
    expect(projectFS.exists(indexMaster)).toBe(false);
  });

  it('preserves a competing file import when deleting a directory index master', () => {
    const indexMaster = 'components/Card/index.tsx';
    projectFS.writeFile(indexMaster, card);
    const source = 'import Tile from "@/components/Card"; export default function Page(){return <Tile data-id="a"/>;}';
    projectFS.writeFile(page, source);
    expect(deleteComponent(indexMaster)).toEqual([]);
    expect(projectFS.readFile(page)).toBe(source);
    expect(projectFS.exists(master)).toBe(true);
  });

  it('resolves an explicit JSX extension to a TSX master when that is the actual project file', () => {
    const source = 'import Tile from "@/components/Card.jsx"; export default function Page(){return <Tile data-id="a"/>;}';
    projectFS.writeFile(page, source);
    expect(deleteComponent(master)).toEqual([page]);
    expect(projectFS.readFile(page)).not.toContain('<Tile');
  });

  it('records the master and dependents as one undoable operation', () => {
    const source = 'import Card from "@/components/Card"; export default function Page(){return <Card data-id="a"/>;}';
    projectFS.writeFile(page, source);
    initHistory(source, () => {}, () => page);
    deleteComponent(master);
    expect(getHistoryState().undoSize).toBe(1);
    expect(undo()).toBe(true);
    finishPendingRestore();
    expect(projectFS.readFile(page)).toBe(source);
    expect(projectFS.readFile(master)).toBe(card);
  });

  it('can finalize the delete history after navigation away from the deleted master', () => {
    const source = 'import Card from "@/components/Card"; export default function Page(){return <Card data-id="a"/>;}';
    projectFS.writeFile(page, source);
    let active = master;
    initHistory(source, () => {}, () => active);
    deleteComponent(master, { deferHistory: true });
    expect(getHistoryState().undoSize).toBe(0);
    active = page;
    pushHistoryFileOp(master);
    expect(getHistoryState().undoSize).toBe(1);
    expect(undo()).toBe(true);
    finishPendingRestore();
    expect(projectFS.readFile(master)).toBe(card);
  });

  it('restores earlier dependent writes if a later write fails', () => {
    const first = 'import Card from "@/components/Card"; export default function Page(){return <Card data-id="a"/>;}';
    const second = 'import Card from "@/components/Card"; export default function Other(){return <Card data-id="b"/>;}';
    projectFS.writeFile(page, first);
    projectFS.writeFile('app/second.tsx', second);
    const original = projectFS.writeFile.bind(projectFS);
    const spy = vi.spyOn(projectFS, 'writeFile').mockImplementation((path, code) => {
      if (path === 'app/second.tsx') throw new Error('write failed');
      return original(path, code);
    });
    try {
      expect(() => deleteComponent(master)).toThrow('write failed');
      expect(projectFS.readFile(page)).toBe(first);
      expect(projectFS.exists(master)).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});
