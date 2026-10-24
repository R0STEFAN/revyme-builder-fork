// packages/automation-core/test/capabilities/T10-interactions.test.ts
import { describe, it, expect } from 'vitest';
import type { Snapshot, FileChange } from '../../src/contracts';
import { createSnapshot, createOperationContext } from '../../src/session';
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
import { normalizeBabelGenerator, normalizeBabelTraverse } from '../../../../src/code/generation/variant-visibility-gen';
import { normalizeBabelTraverse as normalizeParserTraverse } from '../../../../src/code/parsing/ast-utils';
import { checkFile } from '@/code/oracle/check-file';
import { createPlan } from '../../src/plan';
import { validatePlan } from '../../src/validate';
import { createHash } from 'node:crypto';

function createMockSnapshot(files: Record<string, string>): Snapshot {
  return createSnapshot({ projectId: 'test-project', branchId: 'main' }, 0, files);
}

const mockContext = createOperationContext();

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
  it('normalizes Babel traverse from direct, default, and nested Vite SSR module shapes', () => {
    const traverse = () => undefined;
    expect(normalizeBabelTraverse(traverse)).toBe(traverse);
    expect(normalizeBabelTraverse({ default: traverse })).toBe(traverse);
    expect(normalizeBabelTraverse({ default: { default: traverse } })).toBe(traverse);
    expect(normalizeParserTraverse({ default: { default: traverse } })).toBe(traverse);
    expect(normalizeBabelGenerator({ default: { default: traverse } })).toBe(traverse);
  });

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

  it('rejects overlay mutations that target missing overlays or nodes', async () => {
    const pageCode = `export default function Page() {
  return <div data-id="root"><button data-id="trigger">Open</button></div>;
}`;
    let snapshot = createMockSnapshot({ 'app/page.tsx': pageCode });
    const createRes = await overlaysCreateOperation.execute(snapshot, {
      targetFile: 'app/page.tsx',
      triggerId: 'trigger',
      overlayId: 'known-overlay',
    }, mockContext);
    const files = new Map(snapshot.files);
    applyChanges(files, createRes.changes);
    snapshot = { ...snapshot, files };

    await expect(overlaysUpdateOperation.execute(snapshot, {
      targetFile: 'app/page.tsx',
      overlayId: 'missing-overlay',
      patch: { side: 'top' },
    }, mockContext)).rejects.toThrow(/OVERLAY_NOT_FOUND/);
    await expect(overlaysCloseOperation.execute(snapshot, {
      targetFile: 'app/page.tsx',
      nodeId: 'missing-node',
      overlayId: 'known-overlay',
    }, mockContext)).rejects.toThrow(/NODE_NOT_FOUND/);
    await expect(overlaysCloseOperation.execute(snapshot, {
      targetFile: 'app/page.tsx',
      nodeId: 'trigger',
      overlayId: 'missing-overlay',
    }, mockContext)).rejects.toThrow(/OVERLAY_NOT_FOUND/);
    await expect(overlaysRemoveOperation.execute(snapshot, {
      targetFile: 'app/page.tsx',
      overlayId: 'missing-overlay',
      triggerId: 'trigger',
    }, mockContext)).rejects.toThrow(/OVERLAY_NOT_FOUND/);
  });

  it('creates a hover interaction state with metadata and working enter/leave transitions', async () => {
    const componentCode = `"use client";
import { withResponsiveProps } from "@revyme/runtime";
import { motion } from "framer-motion";

/** @name "PrimaryButton" */
export const variantConfig = [
  { name: 'default', label: 'Default', x: 0, y: 0, isPrimary: true },
];
const buttonVariants = { default: { scale: 1 } };

function PrimaryButton({ style, initialVariant = 'default' }: { style?: React.CSSProperties; initialVariant?: string }) {
  return <motion.button data-id="button-root" variants={buttonVariants} style={{ ...style }}>Click</motion.button>;
}

export default withResponsiveProps(PrimaryButton);
`;
    const snapshot = createMockSnapshot({ 'components/PrimaryButton.tsx': componentCode });

    const result = await variantsCreateOperation.execute(
      snapshot,
      {
        componentFile: 'components/PrimaryButton.tsx',
        name: 'default-hover',
        label: 'Button - Hover',
        sourceVariant: 'default',
        interaction: { type: 'hover', parent: 'default' },
      },
      mockContext,
    );

    const generated = result.changes[0].content!;
    expect(generated).toContain("interactionType: 'hover'");
    expect(generated).toContain("parentVariant: 'default'");
    expect(generated).toContain("trigger: 'mouseEnter'");
    expect(generated).toContain("trigger: 'mouseLeave'");
    expect(generated).toContain('onHoverStart=');
    expect(generated).toContain('onHoverEnd=');
  });

  it('rejects variant interactions whose source node does not exist', async () => {
    const snapshot = createMockSnapshot({
      'components/PrimaryButton.tsx': `export const variantConfig = [
  { name: 'default', label: 'Default', x: 0, y: 0, isPrimary: true },
];
function PrimaryButton() { return <button data-id="real-button">Open</button>; }
`,
    });

    await expect(variantsCreateOperation.execute(snapshot, {
      componentFile: 'components/PrimaryButton.tsx',
      name: 'default-hover',
      label: 'Hover',
      sourceVariant: 'default',
      interaction: { type: 'hover', parent: 'default', sourceNode: 'missing-button' },
    }, mockContext)).rejects.toThrow(/NODE_NOT_FOUND/);
  });

  it('wires and removes variant transition connections', async () => {
    const componentCode = `"use client";
import React from "react";
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
    expect(code).toMatch(/import React, \{ useState \} from 'react';/);

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

  it('repairs missing runtime handlers when reapplying an existing connection', async () => {
    const componentCode = `"use client";
import { withResponsiveProps } from "@revyme/runtime";
import { motion } from "framer-motion";

/** @name "PrimaryButton" */
export const variantConfig = [
  { name: 'default', label: 'Default', x: 0, y: 0, isPrimary: true },
  { name: 'hover', label: 'Hover', x: 400, y: 0 },
];
const connections = [
  { from: 'default', to: 'hover', trigger: 'mouseEnter', sourceNode: 'button-root' },
  { from: 'hover', to: 'default', trigger: 'mouseLeave', sourceNode: 'button-root' },
];

function PrimaryButton({ style, initialVariant = 'default' }: { style?: React.CSSProperties; initialVariant?: string }) {
  return <motion.button data-id="button-root" style={{ ...style }}>Click</motion.button>;
}

export default withResponsiveProps(PrimaryButton);
`;
    const snapshot = createMockSnapshot({ 'components/PrimaryButton.tsx': componentCode });

    const result = await connectionsCreateOperation.execute(
      snapshot,
      {
        componentFile: 'components/PrimaryButton.tsx',
        from: 'default',
        to: 'hover',
        trigger: 'mouseEnter',
        sourceNode: 'button-root',
      },
      mockContext,
    );

    const repaired = result.changes[0].content!;
    expect(repaired).toContain('onHoverStart=');
    expect(repaired).toContain('onHoverEnd=');
    expect(repaired).toContain("animate={['default', variant]}");
  });

  it('converts a plain HTML connection source into a motion element', async () => {
    const componentCode = `"use client";
import { withResponsiveProps } from "@revyme/runtime";

/** @name "Navbar" */
export const variantConfig = [
  { name: 'default', label: 'Default', x: 0, y: 0, isPrimary: true },
  { name: 'open', label: 'Open', x: 400, y: 0 },
];

function Navbar({ style, initialVariant = 'default' }: { style?: React.CSSProperties; initialVariant?: string }) {
  return <div data-id="nav-root" style={{ ...style }}><button data-id="nav-toggle">Menu</button></div>;
}

export default withResponsiveProps(Navbar);
`;
    const snapshot = createMockSnapshot({ 'components/Navbar.tsx': componentCode });

    const result = await connectionsCreateOperation.execute(
      snapshot,
      {
        componentFile: 'components/Navbar.tsx',
        from: 'default',
        to: 'open',
        trigger: 'click',
        sourceNode: 'nav-toggle',
      },
      mockContext,
    );

    const generated = result.changes[0].content!;
    expect(generated).toContain('<motion.button');
    expect(generated).toContain('onTap=');
    expect(generated).toContain("from 'framer-motion'");
  });

  it('rejects a connection whose source node does not exist in the component', async () => {
    const snapshot = createMockSnapshot({
      'components/Navbar.tsx': `export const variantConfig = [
  { name: 'default', label: 'Default', x: 0, y: 0, isPrimary: true },
  { name: 'open', label: 'Open', x: 400, y: 0 },
];
function Navbar() { return <button data-id="real-button">Open</button>; }
`,
    });

    await expect(connectionsCreateOperation.execute(
      snapshot,
      {
        componentFile: 'components/Navbar.tsx',
        from: 'default',
        to: 'open',
        trigger: 'click',
        sourceNode: 'missing-button',
      },
      mockContext,
    )).rejects.toThrow(/NODE_NOT_FOUND/);
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
    expect(checkFile(code, { kind: 'page' }).filter((issue) => issue.code === 'WOULD_CRASH')).toEqual([]);

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
    expect(code).not.toContain('modalOverlayOpen');
    expect(code).not.toMatch(/React\.\s*return/);
    expect(checkFile(code, { kind: 'page' }).filter((issue) => issue.code === 'WOULD_CRASH')).toEqual([]);
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

  it('emits framework-safe link elements for pages and design components', async () => {
    const page = createMockSnapshot({
      'app/page.client.tsx': `import React from 'react';\nexport default function Page() { return <a data-id="page-link">Work</a>; }`,
    });
    const pageResult = await linksSetOperation.execute(page, {
      targetFile: 'app/page.client.tsx', nodeId: 'page-link', url: '#work',
    }, mockContext);
    const pageCode = pageResult.changes[0].content!;

    expect(pageCode).toContain("import Link from 'next/link';");
    expect(pageCode).toContain('<Link data-id="page-link" href="#work"');
    expect(pageCode).not.toContain('<a data-id="page-link" href=');

    const component = createMockSnapshot({
      'components/Nav.tsx': `import React from 'react';\nimport { motion } from 'framer-motion';\nfunction Nav() { return <a data-id="component-link">Work</a>; }`,
    });
    const componentResult = await linksSetOperation.execute(component, {
      targetFile: 'components/Nav.tsx', nodeId: 'component-link', url: '#work',
    }, mockContext);
    const componentCode = componentResult.changes[0].content!;

    expect(componentCode).toContain("import Link from 'next/link';");
    expect(componentCode).toContain('const MotionLink = motion.create(React.forwardRef');
    expect(componentCode).toContain('<MotionLink data-id="component-link" href="#work"');
    expect(componentCode).not.toContain('<a data-id="component-link" href=');
    const componentViolations = checkFile(componentCode, { kind: 'component', path: 'components/Nav.tsx' });
    expect(componentViolations.map((violation) => violation.code)).not.toContain('MISSING_DATA_ID');
    expect(componentViolations.map((violation) => violation.code)).not.toContain('COMPONENT_LINK_NOT_MOTIONLINK');
    expect(componentViolations.map((violation) => violation.code)).not.toContain('MOTIONLINK_SETUP_MISSING');
    const originalComponentCode = component.files.get('components/Nav.tsx')!;
    const validation = validatePlan(component, createPlan({
      scope: component.scope,
      baseRevision: component.revision,
      operationId: 'links-set-motionlink-plan',
      changes: [{
        path: 'components/Nav.tsx',
        beforeHash: createHash('sha256').update(originalComponentCode).digest('hex'),
        content: componentCode,
      }],
    }));
    expect(validation.issues.map((issue) => issue.code)).not.toContain('MISSING_DATA_ID');

    const clientComponent = createMockSnapshot({
      'components/ClientNav.tsx': `"use client";\nfunction ClientNav() { return <a data-id="client-link">Work</a>; }`,
    });
    const clientResult = await linksSetOperation.execute(clientComponent, {
      targetFile: 'components/ClientNav.tsx', nodeId: 'client-link', url: '#work',
    }, mockContext);
    const clientCode = clientResult.changes[0].content!;

    expect(clientCode.indexOf('"use client";')).toBeLessThan(clientCode.indexOf("import Link from 'next/link';"));
    expect(clientCode).toContain('<MotionLink data-id="client-link" href="#work"');
  });

  it('imports MotionLink runtime dependencies when linking a plain design-component anchor', async () => {
    const component = createMockSnapshot({
      'components/Footer.tsx': `"use client";\nimport { withResponsiveProps } from '@revyme/runtime';\nfunction Footer() { return <a data-id="footer-email">hello@example.com</a>; }\nexport default withResponsiveProps(Footer);`,
    });
    const result = await linksSetOperation.execute(component, {
      targetFile: 'components/Footer.tsx', nodeId: 'footer-email', url: 'mailto:hello@example.com',
    }, mockContext);
    const code = result.changes[0].content!;

    expect(code).toMatch(/import\s+React(?:,\s*\{[^}]*\})?\s+from\s+['"]react['"]/);
    expect(code).toMatch(/import\s+\{\s*motion\s*\}\s+from\s+['"]framer-motion['"]/);
    expect(checkFile(code, { kind: 'component', path: 'components/Footer.tsx' }).map((issue) => issue.code))
      .not.toContain('WOULD_CRASH');
  });

  it('keeps external page links as native anchors without Next Link imports', async () => {
    const page = createMockSnapshot({
      'app/page.tsx': `export default function Page() { return <a data-id="external-link">Mail</a>; }`,
    });
    const result = await linksSetOperation.execute(page, {
      targetFile: 'app/page.tsx', nodeId: 'external-link', url: 'mailto:hello@example.com',
    }, mockContext);
    const code = result.changes[0].content!;

    expect(code).toContain('<a data-id="external-link" href="mailto:hello@example.com"');
    expect(code).not.toContain("from 'next/link'");
  });

  it('restores safe anchor tags when clearing or removing internal page links', async () => {
    const snapshot = createMockSnapshot({
      'app/page.client.tsx': `export default function Page() {
  return <nav><a data-id="link-cleared">Work</a><a data-id="link-removed">About</a></nav>;
}`,
    });
    const files = new Map(snapshot.files);
    let current = snapshot;

    for (const [nodeId, url] of [['link-cleared', '/work'], ['link-removed', '/about']] as const) {
      const result = await linksSetOperation.execute(current, {
        targetFile: 'app/page.client.tsx', nodeId, url,
      }, mockContext);
      applyChanges(files, result.changes);
      current = { ...current, files };
    }

    const clearResult = await linksSetOperation.execute(current, {
      targetFile: 'app/page.client.tsx', nodeId: 'link-cleared', url: '',
    }, mockContext);
    applyChanges(files, clearResult.changes);
    current = { ...current, files };

    const removeResult = await linksRemoveOperation.execute(current, {
      targetFile: 'app/page.client.tsx', nodeId: 'link-removed',
    }, mockContext);
    applyChanges(files, removeResult.changes);

    const code = files.get('app/page.client.tsx')!;
    expect(code).toContain('<a data-id="link-cleared"');
    expect(code).toContain('<a data-id="link-removed"');
    expect(code).not.toMatch(/<Link\b[^>]*data-id="(?:link-cleared|link-removed)"/);
    expect(code).not.toContain('href="/work"');
    expect(code).not.toContain('href="/about"');
  });
});
