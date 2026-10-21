// packages/automation-core/test/capabilities/T10-interactions.test.ts
import { describe, it, expect } from 'vitest';
import type { Snapshot, ExecutionContext, FileChange } from '../../src/contracts';
import {
  variantsListOperation,
  variantsCreateOperation,
  variantsRenameOperation,
  variantsRemoveOperation,
  variantsVisibilitySetOperation,
} from '../../src/operations/variants';
import {
  connectionsListOperation,
  connectionsCreateOperation,
  connectionsRemoveOperation,
} from '../../src/operations/connections';
import {
  overlaysCreateOperation,
  overlaysUpdateOperation,
  overlaysCloseOperation,
  overlaysRemoveOperation,
} from '../../src/operations/overlays';
import {
  linksGetOperation,
  linksSetOperation,
  linksRemoveOperation,
} from '../../src/operations/links';

function createMockSnapshot(files: Record<string, string>): Snapshot {
  return {
    projectId: 'test-project',
    branchId: 'main',
    revision: 'rev-0',
    files: new Map(Object.entries(files)),
  };
}

const mockContext: ExecutionContext = {
  createId: (prefix = 'node') => `${prefix}-${Math.random().toString(36).slice(2, 7)}`,
};

function applyChanges(files: Map<string, string>, changes: FileChange[]): void {
  for (const c of changes) {
    if (c.content === null) {
      files.delete(c.path);
    } else {
      files.set(c.path, c.content);
    }
  }
}

describe('T10: Variants, Connections, Overlays, and Navigation', () => {
  it('manages component master variants lifecycle and visibility overrides', async () => {
    const initialComponent = `"use client";
import { withResponsiveProps } from "@revyme/runtime";

/** @name "Navbar" */
export const variantConfig = [
  { name: 'default', label: 'Default', x: 0, y: 0, isPrimary: true },
];

function Navbar({ style, initialVariant = 'default' }: { style?: React.CSSProperties; initialVariant?: string }) {
  return (
    <div data-id="nav-root" style={{ ...style }}>
      <button data-id="nav-toggle">Menu</button>
      <div data-id="nav-drawer" style={{ background: '#fff' }}>
        <a data-id="nav-link" href="/home">Home</a>
      </div>
    </div>
  );
}

export default withResponsiveProps(Navbar);
`;

    let snapshot = createMockSnapshot({
      'components/Navbar.tsx': initialComponent,
    });
    const mutableFiles = new Map(snapshot.files);

    // 1. List initial variants
    const list1 = await variantsListOperation.execute(snapshot, { componentFile: 'components/Navbar.tsx' }, mockContext);
    expect(list1.variants).toHaveLength(1);
    expect(list1.variants[0].name).toBe('default');

    // 2. Create 'open' variant
    const createRes = await variantsCreateOperation.execute(
      snapshot,
      {
        componentFile: 'components/Navbar.tsx',
        name: 'open',
        label: 'Open Drawer',
      },
      mockContext,
    );
    applyChanges(mutableFiles, createRes.changes);
    snapshot = { ...snapshot, files: mutableFiles };

    let code = snapshot.files.get('components/Navbar.tsx')!;
    expect(code).toContain("name: 'open'");
    expect(code).toContain("label: 'Open Drawer'");

    // 3. Rename variant
    const renameRes = await variantsRenameOperation.execute(
      snapshot,
      {
        componentFile: 'components/Navbar.tsx',
        name: 'open',
        newLabel: 'Expanded Mobile Menu',
      },
      mockContext,
    );
    applyChanges(mutableFiles, renameRes.changes);
    snapshot = { ...snapshot, files: mutableFiles };

    code = snapshot.files.get('components/Navbar.tsx')!;
    expect(code).toContain("label: 'Expanded Mobile Menu'");

    // 4. Set visibility override: hide nav-drawer on default variant
    const visRes = await variantsVisibilitySetOperation.execute(
      snapshot,
      {
        componentFile: 'components/Navbar.tsx',
        nodeId: 'nav-drawer',
        hiddenOnVariants: ['default'],
      },
      mockContext,
    );
    applyChanges(mutableFiles, visRes.changes);
    snapshot = { ...snapshot, files: mutableFiles };

    code = snapshot.files.get('components/Navbar.tsx')!;
    expect(code).toContain('AnimatePresence');
    expect(code).toMatch(/!==\s*['"]default['"]/);

    // 5. Remove 'open' variant
    const removeRes = await variantsRemoveOperation.execute(
      snapshot,
      {
        componentFile: 'components/Navbar.tsx',
        name: 'open',
      },
      mockContext,
    );
    applyChanges(mutableFiles, removeRes.changes);
    snapshot = { ...snapshot, files: mutableFiles };

    code = snapshot.files.get('components/Navbar.tsx')!;
    expect(code).not.toContain("name: 'open'");

    // Cannot remove primary variant
    await expect(
      variantsRemoveOperation.execute(snapshot, { componentFile: 'components/Navbar.tsx', name: 'default' }, mockContext),
    ).rejects.toThrow(/CANNOT_REMOVE_PRIMARY/);
  });

  it('wires and removes variant transition connections', async () => {
    const componentCode = `"use client";
import { withResponsiveProps } from "@revyme/runtime";
import { motion } from "framer-motion";

/** @name "Modal" */
export const variantConfig = [
  { name: 'default', label: 'Closed', x: 0, y: 0, isPrimary: true },
  { name: 'open', label: 'Open', x: 100, y: 0 },
];

function Modal({ style, initialVariant = 'default' }: { style?: React.CSSProperties; initialVariant?: string }) {
  return (
    <motion.div data-id="modal-root" style={{ ...style }}>
      <motion.button data-id="open-btn">Open</motion.button>
      <motion.div data-id="dialog">
        <motion.button data-id="close-btn">Close</motion.button>
      </motion.div>
    </motion.div>
  );
}

export default withResponsiveProps(Modal);
`;

    let snapshot = createMockSnapshot({
      'components/Modal.tsx': componentCode,
    });
    const mutableFiles = new Map(snapshot.files);

    // 1. Initially no connections
    const list1 = await connectionsListOperation.execute(snapshot, { componentFile: 'components/Modal.tsx' }, mockContext);
    expect(list1.connections).toHaveLength(0);

    // 2. Wire click on open-btn from default to open
    const createRes = await connectionsCreateOperation.execute(
      snapshot,
      {
        componentFile: 'components/Modal.tsx',
        from: 'default',
        to: 'open',
        trigger: 'click',
        sourceNode: 'open-btn',
      },
      mockContext,
    );
    applyChanges(mutableFiles, createRes.changes);
    snapshot = { ...snapshot, files: mutableFiles };

    let code = snapshot.files.get('components/Modal.tsx')!;
    expect(code).toContain("const connections = [");
    expect(code).toContain("from: 'default'");
    expect(code).toContain("to: 'open'");
    expect(code).toContain("sourceNode: 'open-btn'");
    expect(code).toContain('onTap');

    // 3. Remove connection
    const removeRes = await connectionsRemoveOperation.execute(
      snapshot,
      {
        componentFile: 'components/Modal.tsx',
        from: 'default',
        to: 'open',
        trigger: 'click',
        sourceNode: 'open-btn',
      },
      mockContext,
    );
    applyChanges(mutableFiles, removeRes.changes);
    snapshot = { ...snapshot, files: mutableFiles };

    code = snapshot.files.get('components/Modal.tsx')!;
    expect(code).not.toContain("sourceNode: 'open-btn'");
  });

  it('creates, updates, and removes overlays and close overlay interactions', async () => {
    const pageCode = `export default function Page() {
  return (
    <div data-id="page-root">
      <button data-id="trigger-btn">Open Modal</button>
    </div>
  );
}`;

    let snapshot = createMockSnapshot({
      'app/page.tsx': pageCode,
    });
    const mutableFiles = new Map(snapshot.files);

    // 1. Create overlay
    const createRes = await overlaysCreateOperation.execute(
      snapshot,
      {
        targetFile: 'app/page.tsx',
        triggerId: 'trigger-btn',
        overlayId: 'modal-overlay',
        type: 'fixed',
        side: 'bottom',
        fill: 'rgba(0, 0, 0, 0.75)',
        dismissible: true,
      },
      mockContext,
    );
    applyChanges(mutableFiles, createRes.changes);
    snapshot = { ...snapshot, files: mutableFiles };

    let code = snapshot.files.get('app/page.tsx')!;
    expect(code).toContain('modal-overlay');
    expect(code).toContain('data-overlay=');
    expect(code).toContain('data-overlay-trigger=');

    // 2. Update overlay config
    const updateRes = await overlaysUpdateOperation.execute(
      snapshot,
      {
        targetFile: 'app/page.tsx',
        overlayId: 'modal-overlay',
        patch: {
          side: 'top',
          zIndex: 200,
        },
      },
      mockContext,
    );
    applyChanges(mutableFiles, updateRes.changes);
    snapshot = { ...snapshot, files: mutableFiles };

    code = snapshot.files.get('app/page.tsx')!;
    expect(code).toContain('"zIndex":200');

    // 3. Add Close Overlay interaction on trigger-btn
    const closeRes = await overlaysCloseOperation.execute(
      snapshot,
      {
        targetFile: 'app/page.tsx',
        nodeId: 'trigger-btn',
        overlayId: 'modal-overlay',
        trigger: 'click',
        delay: 0.2,
      },
      mockContext,
    );
    applyChanges(mutableFiles, closeRes.changes);
    snapshot = { ...snapshot, files: mutableFiles };

    code = snapshot.files.get('app/page.tsx')!;
    expect(code).toContain('setTimeout');

    // 4. Remove overlay
    const removeRes = await overlaysRemoveOperation.execute(
      snapshot,
      {
        targetFile: 'app/page.tsx',
        overlayId: 'modal-overlay',
        triggerId: 'trigger-btn',
      },
      mockContext,
    );
    applyChanges(mutableFiles, removeRes.changes);
    snapshot = { ...snapshot, files: mutableFiles };

    code = snapshot.files.get('app/page.tsx')!;
    expect(code).not.toContain('data-id="modal-overlay"');
  });

  it('configures, reads, and clears navigation links following Invariant 3', async () => {
    const pageCode = `export default function Page() {
  return (
    <div data-id="page-root">
      <a data-id="nav-home" href="/about">About Us</a>
      <div data-id="banner-card">Explore Features</div>
    </div>
  );
}`;

    let snapshot = createMockSnapshot({
      'app/page.tsx': pageCode,
    });
    const mutableFiles = new Map(snapshot.files);

    // 1. Read existing link on nav-home
    const getRes = await linksGetOperation.execute(snapshot, { targetFile: 'app/page.tsx', nodeId: 'nav-home' }, mockContext);
    expect(getRes.url).toBe('/about');
    expect(getRes.newTab).toBe(false);

    // 2. Set link on banner-card to external URL with newTab
    const setRes1 = await linksSetOperation.execute(
      snapshot,
      {
        targetFile: 'app/page.tsx',
        nodeId: 'banner-card',
        url: 'https://example.com/docs',
        newTab: true,
        prefetch: false,
      },
      mockContext,
    );
    applyChanges(mutableFiles, setRes1.changes);
    snapshot = { ...snapshot, files: mutableFiles };

    let code = snapshot.files.get('app/page.tsx')!;
    expect(code).toContain('href="https://example.com/docs"');
    expect(code).toContain('target="_blank"');
    expect(code).toContain('rel="noopener noreferrer"');

    // 3. Verify links.get reads the new link attributes back
    const getRes2 = await linksGetOperation.execute(snapshot, { targetFile: 'app/page.tsx', nodeId: 'banner-card' }, mockContext);
    expect(getRes2.url).toBe('https://example.com/docs');
    expect(getRes2.newTab).toBe(true);
    expect(getRes2.rel).toBe('noopener noreferrer');

    // 4. Invariant 3: empty url removes link attributes
    const setRes2 = await linksSetOperation.execute(
      snapshot,
      {
        targetFile: 'app/page.tsx',
        nodeId: 'banner-card',
        url: '',
      },
      mockContext,
    );
    applyChanges(mutableFiles, setRes2.changes);
    snapshot = { ...snapshot, files: mutableFiles };

    code = snapshot.files.get('app/page.tsx')!;
    expect(code).not.toContain('https://example.com/docs');
    expect(code).not.toContain('target="_blank"');

    // 5. Explicit links.remove on nav-home
    const removeRes = await linksRemoveOperation.execute(
      snapshot,
      {
        targetFile: 'app/page.tsx',
        nodeId: 'nav-home',
      },
      mockContext,
    );
    applyChanges(mutableFiles, removeRes.changes);
    snapshot = { ...snapshot, files: mutableFiles };

    code = snapshot.files.get('app/page.tsx')!;
    expect(code).not.toContain('href="/about"');
  });
});
