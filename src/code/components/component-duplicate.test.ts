import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { projectFS, resetProjectFS } from '@/code/project/project-fs';
import { initHistory, getHistoryState, undo, redo, finishPendingRestore } from '@/code/mutation/history';
import { initMutationQueue } from '@/code/mutation/mutation-queue';
import { cancelPendingAutosave } from '@/backend/autosave';
import {
  generateDuplicateDisplayName,
  duplicateComponent,
} from './component-duplicate';
import { checkFile } from '@/code/oracle/check-file';

describe('component-duplicate', () => {
  const page = 'app/page.client.tsx';
  let activeFile = page;

  function wireHistory() {
    initHistory('', () => {}, () => activeFile, undefined, {
      get: () => [],
      set: () => {},
      getNodeIds: () => new Set(),
      navigateToFile: (path) => {
        if (!projectFS.exists(path)) return false;
        activeFile = path;
        return true;
      },
    }, {
      get: () => ({ breadcrumb: [], componentEditorFile: null, componentEditorProps: {} }),
      set: () => {},
    });
  }

  beforeEach(() => {
    resetProjectFS(new Map([
      [page, 'export default function Page() { return <div data-id="root"/>; }'],
      ['app/globals.css', ':root{}'],
    ]));
    activeFile = page;
    initMutationQueue('', (code) => projectFS.writeFile(page, code));
    wireHistory();
  });

  afterEach(() => {
    cancelPendingAutosave();
  });

  describe('generateDuplicateDisplayName', () => {
    it('appends Copy when name does not contain Copy', () => {
      const existing = new Set(['Button']);
      expect(generateDuplicateDisplayName('Button', existing)).toBe('Button Copy');
    });

    it('increments Copy counter if Button Copy already exists', () => {
      const existing = new Set(['Button', 'Button Copy']);
      expect(generateDuplicateDisplayName('Button', existing)).toBe('Button Copy 2');
    });

    it('increments to next available index when multiple copies exist', () => {
      const existing = new Set(['Button', 'Button Copy', 'Button Copy 2']);
      expect(generateDuplicateDisplayName('Button', existing)).toBe('Button Copy 3');
      expect(generateDuplicateDisplayName('Button Copy 2', existing)).toBe('Button Copy 3');
    });
  });

  describe('duplicate design component', () => {
    const originalMaster = 'components/Card.tsx';
    const originalCode = `'use client';

import React from 'react';
import { motion, LayoutGroup } from 'framer-motion';
import { withResponsiveProps } from '@revyme/runtime';
import OtherButton from '@/components/OtherButton';

/** @name "Card" */
const variantConfig = [{ name: 'default', label: 'Card', x: 0, y: 0, isPrimary: true }];

const cardVariants = {
  default: { backgroundColor: '#ffffff' },
};

function Card({ style, initialVariant = 'default' }: { style?: React.CSSProperties; initialVariant?: string }) {
  return (
    <LayoutGroup>
      <motion.div
        layout={true}
        data-id="card-root"
        data-name="Card"
        variants={cardVariants}
        style={{
          position: 'relative',
          width: '300px',
          height: '200px',
          ...style,
        }}
      >
        <motion.p layout={true} data-id="card-text" style={{ fontSize: '16px' }}>
          Hello
        </motion.p>
        <OtherButton data-id="card-btn" />
        {cn_card_slot}
      </motion.div>
    </LayoutGroup>
  );
}

export default withResponsiveProps(Card);

const cn_card_slot = (
  <div data-id="card-slot" data-canvas-node="true" style={{ width: '100px', height: '40px' }} />
);
`;

    beforeEach(() => {
      projectFS.writeFile(originalMaster, originalCode);
      projectFS.writeFile('components/OtherButton.tsx', `'use client';
import { withResponsiveProps } from '@revyme/runtime';
/** @name "OtherButton" */
function OtherButton(props: any) { return <button {...props}>Click</button>; }
export default withResponsiveProps(OtherButton);
`);
      wireHistory();
    });

    it('creates a new master file with unique name and remapped IDs and references', () => {
      const result = duplicateComponent(originalMaster, { activeFileBefore: page });
      expect(result.success).toBe(true);
      expect(result.newFilePath).toBeDefined();
      expect(result.newFilePath).not.toBe(originalMaster);
      expect(result.newDisplayName).toBe('Card Copy');

      const copyPath = result.newFilePath!;
      expect(projectFS.exists(copyPath)).toBe(true);

      const copyCode = projectFS.readFile(copyPath)!;

      // Original IDs
      const originalIds = ['card-root', 'card-text', 'card-btn', 'card-slot'];

      // Extract IDs from copy code
      const copyIdMatches = [...copyCode.matchAll(/data-id="([^"]+)"/g)].map((m) => m[1]);
      expect(copyIdMatches.length).toBeGreaterThanOrEqual(4);

      // Verify ZERO overlap in node IDs between original and copy
      const overlappingIds = copyIdMatches.filter((id) => originalIds.includes(id));
      expect(overlappingIds).toEqual([]);

      // Verify slot const remapping: cn_card_slot must be remapped to new ID
      expect(copyCode).not.toContain('cn_card_slot');
      expect(copyCode).toMatch(/const cn_\w+ =/);
      expect(copyCode).toMatch(/\{cn_\w+\}/);

      // Verify variants const remapping
      expect(copyCode).not.toContain('cardVariants');
      expect(copyCode).toMatch(/const \w+Variants =/);
      expect(copyCode).toMatch(/variants=\{\w+Variants\}/);

      // Verify external import preserved
      expect(copyCode).toContain("import OtherButton from '@/components/OtherButton';");
      expect(copyCode).toContain('<OtherButton');

      // Verify oracle validity: generated code passes oracle validation
      const violations = checkFile(copyCode, { kind: 'component', path: copyPath });
      expect(violations.filter((v) => v.tier === 1 || v.tier === 3)).toEqual([]);

      // Verify history tracking
      expect(getHistoryState().canUndo).toBe(true);
      expect(undo()).toBe(true);
      finishPendingRestore();

      // Undo removes the copy file
      expect(projectFS.exists(copyPath)).toBe(false);

      // Redo restores the copy file
      expect(redo()).toBe(true);
      finishPendingRestore();
      expect(projectFS.exists(copyPath)).toBe(true);
      expect(projectFS.readFile(copyPath)).toBe(copyCode);
    });

    it('duplicating twice produces distinct unique names and files', () => {
      const res1 = duplicateComponent(originalMaster, { activeFileBefore: page });
      expect(res1.success).toBe(true);
      expect(res1.newDisplayName).toBe('Card Copy');

      const res2 = duplicateComponent(originalMaster, { activeFileBefore: page });
      expect(res2.success).toBe(true);
      expect(res2.newDisplayName).toBe('Card Copy 2');
      expect(res2.newFilePath).not.toBe(res1.newFilePath);
    });
  });

  describe('duplicate code component', () => {
    const codeMaster = 'components/MyWidget.tsx';
    const codeSource = `'use client';

/** @label "My Widget" */
/** @comment "A custom interactive widget" */
/** @controls {
  "color": { "type": "color", "label": "Color", "default": "#10b981" }
} */

import { withResponsiveProps } from '@revyme/runtime';

function MyWidget({
  color = '#10b981',
  ...props
}: {
  color?: string;
  [key: string]: any;
}) {
  return (
    <div {...props} style={{ backgroundColor: color, width: '100%', height: '100%' }} />
  );
}

export default withResponsiveProps(MyWidget);
`;

    beforeEach(() => {
      projectFS.writeFile(codeMaster, codeSource);
      wireHistory();
    });

    it('duplicates code component updating label and function identifiers while preserving metadata', () => {
      const result = duplicateComponent(codeMaster, { activeFileBefore: page });
      expect(result.success).toBe(true);
      expect(result.newDisplayName).toBe('My Widget Copy');

      const copyPath = result.newFilePath!;
      expect(projectFS.exists(copyPath)).toBe(true);

      const copyCode = projectFS.readFile(copyPath)!;

      // Preserves controls & comments
      expect(copyCode).toContain('/** @label "My Widget Copy" */');
      expect(copyCode).toContain('/** @comment "A custom interactive widget" */');
      expect(copyCode).toContain('"color": { "type": "color"');

      // Renames function and export
      expect(copyCode).not.toMatch(/\bfunction MyWidget\b/);
      expect(copyCode).not.toMatch(/withResponsiveProps\(MyWidget\)/);
      expect(copyCode).toMatch(/\bfunction [A-Z][a-zA-Z0-9]+\b/);
      expect(copyCode).toMatch(/withResponsiveProps\([A-Z][a-zA-Z0-9]+\)/);

      // Oracle passes
      const violations = checkFile(copyCode, { kind: 'code-component', path: copyPath });
      expect(violations.filter((v) => v.tier === 1 || v.tier === 3)).toEqual([]);

      // Undo/redo
      expect(getHistoryState().canUndo).toBe(true);
      expect(undo()).toBe(true);
      finishPendingRestore();
      expect(projectFS.exists(copyPath)).toBe(false);

      expect(redo()).toBe(true);
      finishPendingRestore();
      expect(projectFS.exists(copyPath)).toBe(true);
    });
  });

  describe('error handling', () => {
    it('returns failure when file does not exist', () => {
      const result = duplicateComponent('components/NonExistent.tsx');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
      expect(getHistoryState().canUndo).toBe(false);
    });
  });
});
