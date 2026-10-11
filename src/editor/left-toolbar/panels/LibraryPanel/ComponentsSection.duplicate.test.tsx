import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import { projectFS, resetProjectFS } from '@/code/project/project-fs';
import { activeFilePathAtom, componentBreadcrumbAtom } from '@/code/project/active-file-store';
import { componentEditorFileAtom, componentEditorPropsAtom } from '@/code/stores/component-editor-store';
import { selectedIdsAtom } from '@/code/stores/store';
import { initHistory, getHistoryState, undo, redo, finishPendingRestore } from '@/code/mutation/history';
import { initMutationQueue } from '@/code/mutation/mutation-queue';
import { cancelPendingAutosave } from '@/backend/autosave';
import { toast } from 'sonner';
import LibraryPanel from './index';

vi.mock('@/shared/debug-trace', () => ({
  trace: { action: vi.fn(), fn: vi.fn(), dom: vi.fn(), error: vi.fn() },
}));
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));
vi.mock('./sections/VectorsSection', () => ({ VectorsSection: () => null }));
vi.mock('./sections/TemplatesSection', () => ({ TemplatesSection: () => null }));
vi.mock('./sections/CodeOverridesSection', () => ({ CodeOverridesSection: () => null }));
vi.mock('@/editor/left-toolbar/panels/plugins', () => ({ default: () => null }));

const page = 'app/page.client.tsx';
const designMaster = 'components/Card.tsx';
const designCode = `'use client';
import React from 'react';
import { motion, LayoutGroup } from 'framer-motion';
import { withResponsiveProps } from '@revyme/runtime';

/** @name "Card" */
const variantConfig = [{ name: 'default', label: 'Card', x: 0, y: 0, isPrimary: true }];

function Card({ style }: any) {
  return (
    <LayoutGroup>
      <motion.div data-id="card-root" data-name="Card" style={style}>
        <motion.p data-id="card-title">Hello</motion.p>
      </motion.div>
    </LayoutGroup>
  );
}

export default withResponsiveProps(Card);
`;

const codeMaster = 'components/Widget.tsx';
const codeSource = `'use client';
/** @label "Widget" */
/** @controls {
  "color": { "type": "color", "label": "Color", "default": "#3b82f6" }
} */
import { withResponsiveProps } from '@revyme/runtime';

function Widget(props: any) {
  return <div {...props} />;
}

export default withResponsiveProps(Widget);
`;

const store = getDefaultStore();

function wireHistory() {
  initHistory('', () => {}, () => store.get(activeFilePathAtom), undefined, {
    get: () => [...store.get(selectedIdsAtom)],
    set: (ids) => store.set(selectedIdsAtom, ids),
    getNodeIds: () => new Set(['card-root', 'card-title']),
    navigateToFile: (path) => {
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
    set: (loc) => {
      store.set(componentBreadcrumbAtom, [...(loc.breadcrumb ?? [])]);
      store.set(componentEditorFileAtom, loc.componentEditorFile ?? null);
      store.set(componentEditorPropsAtom, { ...(loc.componentEditorProps ?? {}) });
    },
  });
}

beforeEach(() => {
  resetProjectFS(new Map([
    [page, 'export default function Page() { return <div data-id="root"/>; }'],
    [designMaster, designCode],
    [codeMaster, codeSource],
    ['app/globals.css', ':root{}'],
  ]));
  store.set(activeFilePathAtom, page);
  store.set(componentBreadcrumbAtom, []);
  store.set(componentEditorFileAtom, null);
  store.set(componentEditorPropsAtom, {});
  store.set(selectedIdsAtom, []);
  initMutationQueue('', (code) => projectFS.writeFile(page, code));
  wireHistory();
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.success).mockClear();
});

afterEach(() => {
  cleanup();
  cancelPendingAutosave();
});

describe('LibraryPanel component duplication UI', () => {
  it('duplicates a design component via row ⋯ menu and navigates to the duplicate', () => {
    render(<LibraryPanel mode="library" />);

    // Find the Card row and open its menu
    const cardLabel = screen.getByText('Card');
    const cardRow = cardLabel.closest('[data-component-row], [data-sidebar-row]') || cardLabel.parentElement!;
    const menuBtn = cardRow.querySelector('button')!;
    fireEvent.click(menuBtn);

    // Click "Duplicate" menu entry
    const duplicateOption = screen.getByText('Duplicate');
    fireEvent.click(duplicateOption);

    // Find the created file in components/
    const allFiles = projectFS.listFiles('components/').filter((f) => f.endsWith('.tsx'));
    const copyFile = allFiles.find((f) => f !== designMaster && f !== codeMaster);
    expect(copyFile).toBeDefined();

    // Verify copy file contents
    const copyContent = projectFS.readFile(copyFile!)!;
    expect(copyContent).toContain('/** @name "Card Copy" */');
    expect(copyContent).not.toContain('card-root');

    // Verify navigation occurred (switched active file to new design component)
    expect(store.get(activeFilePathAtom)).toBe(copyFile);

    // Verify history recorded
    expect(getHistoryState().canUndo).toBe(true);
    act(() => {
      expect(undo()).toBe(true);
      finishPendingRestore();
    });
    expect(projectFS.exists(copyFile!)).toBe(false);

    act(() => {
      expect(redo()).toBe(true);
      finishPendingRestore();
    });
    expect(projectFS.exists(copyFile!)).toBe(true);
  });

  it('duplicates a code component via row ⋯ menu and opens the code editor overlay', () => {
    render(<LibraryPanel mode="library" />);

    // Find the Widget row and open its menu
    const widgetLabel = screen.getByText('Widget');
    const widgetRow = widgetLabel.closest('[data-component-row], [data-sidebar-row]') || widgetLabel.parentElement!;
    const menuBtn = widgetRow.querySelector('button')!;
    fireEvent.click(menuBtn);

    // Click "Duplicate" menu entry
    const duplicateOption = screen.getByText('Duplicate');
    fireEvent.click(duplicateOption);

    // Find the created file in components/
    const allFiles = projectFS.listFiles('components/').filter((f) => f.endsWith('.tsx'));
    const copyFile = allFiles.find((f) => f !== designMaster && f !== codeMaster);
    expect(copyFile).toBeDefined();

    // Verify copy file contents
    const copyContent = projectFS.readFile(copyFile!)!;
    expect(copyContent).toContain('/** @label "Widget Copy" */');
    expect(copyContent).toContain('"color": { "type": "color"');

    // Verify code component editor overlay was opened
    expect(store.get(componentEditorFileAtom)).toBe(copyFile);

    // Verify history recorded
    expect(getHistoryState().canUndo).toBe(true);
  });

  it('duplicating twice produces unique names (Card Copy and Card Copy 2)', () => {
    render(<LibraryPanel mode="library" />);

    // 1st duplicate
    const cardLabel = screen.getByText('Card');
    const cardRow = cardLabel.closest('[data-component-row], [data-sidebar-row]') || cardLabel.parentElement!;
    const menuBtn1 = cardRow.querySelector('button')!;
    fireEvent.click(menuBtn1);
    fireEvent.click(screen.getByText('Duplicate'));

    // 2nd duplicate of the original Card
    const menuBtn2 = cardRow.querySelector('button')!;
    fireEvent.click(menuBtn2);
    fireEvent.click(screen.getByText('Duplicate'));

    const allFiles = projectFS.listFiles('components/').filter((f) => f.endsWith('.tsx'));
    expect(allFiles.length).toBe(4); // original 2 + 2 duplicates

    const displayNames = allFiles.map((f) => {
      const code = projectFS.readFile(f)!;
      const m = code.match(/@(?:name|label)\s+"([^"]+)"/);
      return m ? m[1] : '';
    });

    expect(displayNames).toContain('Card');
    expect(displayNames).toContain('Card Copy');
    expect(displayNames).toContain('Card Copy 2');
  });
});
