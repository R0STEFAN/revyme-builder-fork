// packages/automation-core/test/capabilities/T24-verification.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Snapshot } from '../../src/contracts';
import { createSnapshot, createOperationContext } from '../../src/session';
import { defaultRegistry } from '../../src/registry';
import '../../src/index';

import {
  observeSelectionOperation,
  observeLayoutOperation,
  observeVisualsOperation,
  observeCompositionOperation,
  observeAuditOperation,
  observeScreenshotOperation,
} from '../../src/operations/observe';
import { verifyEffectOperation } from '../../src/operations/verify';
import { diagnosticsProjectCheckOperation } from '../../src/operations/diagnostics';
import { projectFS, MAIN_BRANCH_ID } from '@/code/project/project-fs';
import { setActiveBridge, resetActiveBridge, type CanvasBridge } from '@/canvas/canvas-bridge';

// ─── Test Page Fixtures ──────────────────────────────────────────────────────

const MOCK_PAGE_CODE = `'use client';
import React from 'react';

/** @canvas { "viewports": [ { "id": "desktop", "label": "Desktop", "width": 1200, "height": "auto", "isPrimary": true, "order": 0 }, { "id": "mobile", "label": "Mobile", "width": 375, "height": "auto", "isPrimary": false, "order": 1 } ], "positions": { "desktop": { "x": 0, "y": 0 } } } */

export default function HomePage() {
  return (
    <div data-id="root" style={{ width: '100%', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header data-id="header" style={{ padding: '24px', display: 'flex', justifyContent: 'space-between' }}>
        <h1 data-id="title" style={{ fontSize: '32px', fontWeight: '700', color: '#111827' }}>Revyme Studio</h1>
        <button data-id="cta-btn" role="button" style={{ width: '120px', height: '48px', backgroundColor: '#2563eb', color: '#ffffff' }}>
          Get Started
        </button>
      </header>
      <section data-id="cards-section" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', padding: '24px' }}>
        <div data-id="card-1" style={{ padding: '16px', backgroundColor: '#f9fafb' }}>
          <h3 data-id="card-1-title" style={{ fontSize: '20px' }}>Fast</h3>
          <p data-id="card-1-desc">Zero latency</p>
        </div>
        <div data-id="card-2" style={{ padding: '16px', backgroundColor: '#f9fafb' }}>
          <h3 data-id="card-2-title" style={{ fontSize: '20px' }}>Visual</h3>
          <p data-id="card-2-desc">Direct DOM editing</p>
        </div>
        <div data-id="card-3" style={{ padding: '16px', backgroundColor: '#f9fafb' }}>
          <h3 data-id="card-3-title" style={{ fontSize: '20px' }}>Reliable</h3>
          <p data-id="card-3-desc">Real Next.js code</p>
        </div>
      </section>
      <footer data-id="footer" style={{ padding: '24px', color: '#6b7280' }}>
        <p data-id="footer-copy">© 2026 Revyme</p>
      </footer>
    </div>
  );
}
`;

const MOTION_EFFECT_PAGE = `'use client';
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export default function MotionPage() {
  const [open, setOpen] = useState(false);
  return (
    <div data-id="motion-root">
      <motion.div
        data-id="hero-card"
        whileHover={{ scale: 1.05 }}
        whileInView={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
        style={{ padding: '24px' }}
      >
        <h2 data-id="card-title">Interactive Card</h2>
        <button data-id="toggle-btn" onClick={() => setOpen(!open)}>
          Toggle Details
        </button>
      </motion.div>
    </div>
  );
}
`;

const CIRCULAR_SLOT_PAGE = `'use client';
import React from 'react';

const cn_b = (
  <div data-id="node-b" data-canvas-node="true">
    {cn_a}
  </div>
);

const cn_a = (
  <div data-id="node-a" data-canvas-node="true">
    {cn_b}
  </div>
);

export default function SlotPage() {
  return (
    <div data-id="slot-root">
      {cn_a}
    </div>
  );
}
`;

// ─── Mock Canvas Bridge ──────────────────────────────────────────────────────

class MockCanvasBridge implements CanvasBridge {
  private rects = new Map<string, DOMRect>();
  private styles = new Map<string, Record<string, string>>();

  setNode(
    nodeId: string,
    vpPrefix: string,
    rect: { x: number; y: number; width: number; height: number },
    styles: Record<string, string> = {}
  ) {
    const key = `${vpPrefix}${nodeId}`;
    this.rects.set(key, {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      top: rect.y,
      left: rect.x,
      right: rect.x + rect.width,
      bottom: rect.y + rect.height,
      toJSON: () => ({}),
    } as DOMRect);
    this.styles.set(key, styles);
  }

  getRect(nodeId: string, vpPrefix: string): DOMRect | null {
    return this.rects.get(`${vpPrefix}${nodeId}`) ?? null;
  }
  getRectInViewportSpace(nodeId: string, vpPrefix: string): DOMRect | null {
    return this.rects.get(`${vpPrefix}${nodeId}`) ?? null;
  }
  getComputedValue(nodeId: string, vpPrefix: string, prop: string): string {
    return this.styles.get(`${vpPrefix}${nodeId}`)?.[prop] ?? '';
  }
  getComputedValues(nodeId: string, vpPrefix: string, props: string[]): Record<string, string> {
    const s = this.styles.get(`${vpPrefix}${nodeId}`) ?? {};
    const res: Record<string, string> = {};
    for (const p of props) {
      if (s[p] !== undefined) res[p] = s[p];
    }
    return res;
  }
  getChildRects(): Array<{ id: string; rect: DOMRect }> { return []; }
  getContainerRect(): DOMRect | null { return null; }
  getElementIdsAtPoint(): string[] { return []; }
  patchStyles(): void {}
  patchAttrsAndStyles(): void {}
  setInnerHTML(): void {}
  setAttribute(): void {}
  injectCSS(): void {}
  removeCSS(): void {}
  getIframeDocument(): Document | null { return null; }
  loadFontInIframe(): void {}
}

function createMockSnapshot(files: Record<string, string>, revision = 1): Snapshot {
  return createSnapshot({ projectId: 'test-project', branchId: 'main' }, revision, files);
}

describe('T24: Headless Observation, Verification & Diagnostics Capability Suite', () => {
  let bridge: MockCanvasBridge;
  const context = createOperationContext();

  beforeEach(() => {
    bridge = new MockCanvasBridge();
    setActiveBridge(bridge);

    // Setup standard bridge rects for MOCK_PAGE_CODE on desktop (vpPrefix: '')
    bridge.setNode('root', '', { x: 0, y: 0, width: 1200, height: 900 }, { display: 'flex', flexDirection: 'column' });
    bridge.setNode('header', '', { x: 0, y: 0, width: 1200, height: 80 }, { display: 'flex', justifyContent: 'space-between', padding: '24px' });
    bridge.setNode('title', '', { x: 24, y: 20, width: 300, height: 40 }, { fontSize: '32px', fontWeight: '700', color: '#111827', backgroundColor: '#ffffff' });
    bridge.setNode('cta-btn', '', { x: 1056, y: 16, width: 120, height: 48 }, { width: '120px', height: '48px', backgroundColor: '#2563eb', color: '#ffffff' });
    bridge.setNode('cards-section', '', { x: 0, y: 80, width: 1200, height: 300 }, { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' });
    bridge.setNode('card-1', '', { x: 24, y: 104, width: 360, height: 250 }, { padding: '16px', backgroundColor: '#f9fafb' });
    bridge.setNode('card-1-title', '', { x: 40, y: 120, width: 320, height: 30 }, { fontSize: '20px', color: '#1f2937' });
    bridge.setNode('card-1-desc', '', { x: 40, y: 160, width: 320, height: 20 }, { fontSize: '14px', color: '#4b5563' });
    bridge.setNode('card-2', '', { x: 420, y: 104, width: 360, height: 250 }, { padding: '16px', backgroundColor: '#f9fafb' });
    bridge.setNode('card-2-title', '', { x: 436, y: 120, width: 320, height: 30 }, { fontSize: '20px', color: '#1f2937' });
    bridge.setNode('card-2-desc', '', { x: 436, y: 160, width: 320, height: 20 }, { fontSize: '14px', color: '#4b5563' });
    bridge.setNode('card-3', '', { x: 816, y: 104, width: 360, height: 250 }, { padding: '16px', backgroundColor: '#f9fafb' });
    bridge.setNode('card-3-title', '', { x: 832, y: 120, width: 320, height: 30 }, { fontSize: '20px', color: '#1f2937' });
    bridge.setNode('card-3-desc', '', { x: 832, y: 160, width: 320, height: 20 }, { fontSize: '14px', color: '#4b5563' });
    bridge.setNode('footer', '', { x: 0, y: 380, width: 1200, height: 60 }, { padding: '24px', color: '#6b7280' });
    bridge.setNode('footer-copy', '', { x: 24, y: 395, width: 200, height: 20 }, { fontSize: '14px', color: '#6b7280' });

    projectFS.loadSnapshot(
      new Map([
        ['app/page.client.tsx', MOCK_PAGE_CODE],
      ]),
    );
    projectFS.switchBranch(MAIN_BRANCH_ID);
  });

  afterEach(() => {
    resetActiveBridge();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Group 1: Registry Registration & Compatibility Aliases
  // ───────────────────────────────────────────────────────────────────────────
  describe('1. Registry Registration & Aliases', () => {
    const requiredOps = [
      'observe.selection',
      'observe.layout',
      'observe.visuals',
      'observe.composition',
      'observe.audit',
      'observe.screenshot',
      'verify.effect',
      'diagnostics.projectCheck',
    ];

    it('registers all 8 canonical T24 operations with ownerTask="T24"', () => {
      for (const name of requiredOps) {
        const op = defaultRegistry.get(name);
        expect(op, `Operation "${name}" should be registered`).toBeDefined();
        expect(op?.name).toBe(name);
        expect(op?.ownerTask).toBe('T24');
      }
    });

    it('resolves all compatibility aliases cleanly', () => {
      const aliasPairs: [string, string][] = [
        ['selection.get', 'observe.selection'],
        ['selection.inspect', 'observe.selection'],
        ['canvas.getSelection', 'observe.selection'],
        ['get_selection', 'observe.selection'],
        ['observe.selected', 'observe.selection'],
        ['layout.inspect', 'observe.layout'],
        ['layout.get', 'observe.layout'],
        ['get_layout', 'observe.layout'],
        ['observe.rects', 'observe.layout'],
        ['observe.dimensions', 'observe.layout'],
        ['styles.inspect', 'observe.visuals'],
        ['visuals.get', 'observe.visuals'],
        ['get_visuals', 'observe.visuals'],
        ['computed.get', 'observe.visuals'],
        ['observe.styles', 'observe.visuals'],
        ['composition.get', 'observe.composition'],
        ['composition.inspect', 'observe.composition'],
        ['get_composition', 'observe.composition'],
        ['structure.get', 'observe.composition'],
        ['observe.hierarchy', 'observe.composition'],
        ['audit.design', 'observe.audit'],
        ['audit_design', 'observe.audit'],
        ['design.audit', 'observe.audit'],
        ['observe.linter', 'observe.audit'],
        ['screenshot.capture', 'observe.screenshot'],
        ['get_screenshot', 'observe.screenshot'],
        ['capture.screenshot', 'observe.screenshot'],
        ['verify.animation', 'verify.effect'],
        ['verify.motion', 'verify.effect'],
        ['verify_effect', 'verify.effect'],
        ['project.diagnostics', 'diagnostics.projectCheck'],
        ['diagnostics.check', 'diagnostics.projectCheck'],
      ];

      for (const [alias, canonical] of aliasPairs) {
        const resolved = defaultRegistry.get(alias);
        expect(resolved, `Alias "${alias}" should resolve`).toBeDefined();
        expect(resolved?.name).toBe(canonical);
      }
    });

    it('validates input schemas and suggests near-match operations on typo', () => {
      const validation = defaultRegistry.validateInput('verify.effect', { request: '' });
      expect(validation.ok).toBe(false);

      const suggestions = defaultRegistry.findNearMatches('observe.layut');
      expect(suggestions).toContain('observe.layout');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Group 2: Node Selection & Multi-Node Bounding Box
  // ───────────────────────────────────────────────────────────────────────────
  describe('2. Node Selection & Multi-Node Bounding Box', () => {
    it('returns empty status when no nodes are selected', async () => {
      const snapshot = createMockSnapshot({ 'app/page.client.tsx': MOCK_PAGE_CODE });
      const result = await observeSelectionOperation.execute(snapshot, { nodeIds: [] }, context);

      expect(result.selectedIds).toEqual([]);
      expect(result.count).toBe(0);
      expect(result.isMultiSelect).toBe(false);
      expect(result.bounds).toBeNull();
      expect(result.status).toBe('empty');
    });

    it('inspects single selected node and returns its bounding box', async () => {
      const snapshot = createMockSnapshot({ 'app/page.client.tsx': MOCK_PAGE_CODE });
      const result = await observeSelectionOperation.execute(snapshot, { nodeIds: ['cta-btn'] }, context);

      expect(result.selectedIds).toEqual(['cta-btn']);
      expect(result.primaryId).toBe('cta-btn');
      expect(result.count).toBe(1);
      expect(result.isMultiSelect).toBe(false);
      expect(result.bounds).toEqual({ x: 1056, y: 16, width: 120, height: 48 });
      expect(result.nodes[0]?.isComponent).toBe(false);
      expect(result.status).toBe('ready');
    });

    it('computes accurate enclosing AABB bounds union for multi-selection', async () => {
      const snapshot = createMockSnapshot({ 'app/page.client.tsx': MOCK_PAGE_CODE });
      const result = await observeSelectionOperation.execute(
        snapshot,
        { nodeIds: ['card-1', 'card-2', 'card-3'] },
        context
      );

      expect(result.selectedIds).toHaveLength(3);
      expect(result.count).toBe(3);
      expect(result.isMultiSelect).toBe(true);
      // card-1: x=24, y=104, right=384, bottom=354
      // card-3: x=816, y=104, right=1176, bottom=354
      // Union: x=24, y=104, width=1176 - 24 = 1152, height=250
      expect(result.bounds).toEqual({ x: 24, y: 104, width: 1152, height: 250 });
      expect(result.status).toBe('ready');
    });

    it('returns honest pending status and null bounds if a selected node is unmeasured', async () => {
      const snapshot = createMockSnapshot({ 'app/page.client.tsx': MOCK_PAGE_CODE });
      const result = await observeSelectionOperation.execute(
        snapshot,
        { nodeIds: ['card-1', 'unrendered-node-xyz'] },
        context
      );

      expect(result.status).toBe('pending');
      expect(result.bounds).toBeNull();
      expect(result.nodes.find((n) => n.id === 'unrendered-node-xyz')?.status).toBe('unmeasured');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Group 3: Layout Inspection & Box Model Geometry
  // ───────────────────────────────────────────────────────────────────────────
  describe('3. Layout Inspection & Box Model Geometry', () => {
    it('queries single node layout with margins, padding, and flex properties', async () => {
      const snapshot = createMockSnapshot({ 'app/page.client.tsx': MOCK_PAGE_CODE });
      const result = await observeLayoutOperation.execute(snapshot, { nodeId: 'header' }, context);

      expect(result.status).toBe('ready');
      expect(result.nodes).toHaveLength(1);
      const node = result.nodes[0];
      expect(node.id).toBe('header');
      expect(node.rect).toEqual({ x: 0, y: 0, width: 1200, height: 80 });
      expect(node.display).toBe('flex');
      expect(node.justifyContent).toBe('space-between');
      expect(node.padding?.top).toBe(24);
    });

    it('measures all nodes in viewport when nodeId is omitted', async () => {
      const snapshot = createMockSnapshot({ 'app/page.client.tsx': MOCK_PAGE_CODE });
      const result = await observeLayoutOperation.execute(snapshot, { viewport: 'desktop' }, context);

      expect(result.status).toBe('ready');
      expect(result.total).toBeGreaterThan(5);
      expect(result.measured).toBe(result.total);
      expect(result.unmeasured).toHaveLength(0);
    });

    it('respects depth boundary on subtree layout queries', async () => {
      const snapshot = createMockSnapshot({ 'app/page.client.tsx': MOCK_PAGE_CODE });
      const result = await observeLayoutOperation.execute(snapshot, { nodeId: 'cards-section', depth: 1 }, context);

      expect(result.status).toBe('ready');
      // Root is cards-section, direct children are card-1, card-2, card-3
      expect(result.nodes.map((n) => n.id)).toEqual(['cards-section', 'card-1', 'card-2', 'card-3']);
    });

    it('returns honest unavailable on nonexistent node ID', async () => {
      const snapshot = createMockSnapshot({ 'app/page.client.tsx': MOCK_PAGE_CODE });
      const result = await observeLayoutOperation.execute(snapshot, { nodeId: 'ghost-node-404' }, context);

      expect(result.status).toBe('unavailable');
      expect(result.reason).toContain('NODE_NOT_FOUND');
    });

    it('returns honest unavailable on unknown viewport', async () => {
      const snapshot = createMockSnapshot({ 'app/page.client.tsx': MOCK_PAGE_CODE });
      const result = await observeLayoutOperation.execute(snapshot, { viewport: 'ultrawide-10k' }, context);

      expect(result.status).toBe('unavailable');
      expect(result.reason).toContain('Unknown viewport');
    });

    it('detects parent overflow when child extends > 8px beyond parent bounding box', async () => {
      bridge.setNode('overflowing-child', '', { x: 0, y: 0, width: 1250, height: 100 }, { display: 'block' });
      const testCode = `'use client';
export default function OverflowPage() {
  return (
    <div data-id="root" style={{ width: '1200px' }}>
      <div data-id="overflowing-child" style={{ width: '1250px' }}>Spill</div>
    </div>
  );
}`;
      const snapshot = createMockSnapshot({ 'app/page.client.tsx': testCode });
      const result = await observeLayoutOperation.execute(snapshot, { nodeId: 'overflowing-child' }, context);

      expect(result.nodes[0]?.indicators?.overflowsParent).toBe(true);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Group 4: Visual Styles, Typography & WCAG Contrast
  // ───────────────────────────────────────────────────────────────────────────
  describe('4. Visual Styles, Typography & WCAG Contrast', () => {
    it('queries typography properties and computed values', async () => {
      const snapshot = createMockSnapshot({ 'app/page.client.tsx': MOCK_PAGE_CODE });
      const result = await observeVisualsOperation.execute(snapshot, { nodeId: 'title' }, context);

      expect(result.status).toBe('ready');
      expect(result.typography.fontSize).toBe('32px');
      expect(result.typography.fontSizePx).toBe(32);
      expect(result.typography.fontWeight).toBe('700');
    });

    it('evaluates high-contrast text and returns passing WCAG AA/AAA verdicts', async () => {
      const snapshot = createMockSnapshot({ 'app/page.client.tsx': MOCK_PAGE_CODE });
      const result = await observeVisualsOperation.execute(snapshot, { nodeId: 'title' }, context);

      expect(result.colors.color).toBe('#111827');
      expect(result.colors.backgroundColor).toBe('#ffffff');
      expect(result.contrast).toBeDefined();
      expect(result.contrast?.ratio).toBeGreaterThan(10);
      expect(result.contrast?.meetsAA).toBe(true);
      expect(result.contrast?.meetsAAA).toBe(true);
    });

    it('detects low-contrast text and returns failing WCAG verdict', async () => {
      bridge.setNode('low-contrast-text', '', { x: 10, y: 10, width: 200, height: 30 }, {
        color: '#9ca3af',
        backgroundColor: '#ffffff',
      });
      const lowContrastCode = `'use client';
export default function Page() {
  return <p data-id="low-contrast-text" style={{ color: '#9ca3af', backgroundColor: '#ffffff' }}>Muted</p>;
}`;
      const snapshot = createMockSnapshot({ 'app/page.client.tsx': lowContrastCode });
      const result = await observeVisualsOperation.execute(snapshot, { nodeId: 'low-contrast-text' }, context);

      expect(result.contrast?.meetsAA).toBe(false);
      expect(result.contrast?.ratio).toBeLessThan(4.5);
    });

    it('queries custom requested CSS properties', async () => {
      bridge.setNode('cta-btn', '', { x: 1056, y: 16, width: 120, height: 48 }, {
        cursor: 'pointer',
        boxSizing: 'border-box',
      });
      const snapshot = createMockSnapshot({ 'app/page.client.tsx': MOCK_PAGE_CODE });
      const result = await observeVisualsOperation.execute(
        snapshot,
        { nodeId: 'cta-btn', properties: ['cursor', 'boxSizing'] },
        context
      );

      expect(result.custom?.['cursor']).toBe('pointer');
      expect(result.custom?.['boxSizing']).toBe('border-box');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Group 5: Composition Hierarchy & Structural Perception
  // ───────────────────────────────────────────────────────────────────────────
  describe('5. Composition Hierarchy & Structural Perception', () => {
    it('constructs document order tree with sibling counts and depths', async () => {
      const snapshot = createMockSnapshot({ 'app/page.client.tsx': MOCK_PAGE_CODE });
      const result = await observeCompositionOperation.execute(snapshot, {}, context);

      expect(result.status).toBe('ready');
      expect(result.tree).toBeDefined();
      expect(result.tree?.id).toBe('root');
      expect(result.tree?.children).toHaveLength(3); // header, cards-section, footer
      expect(result.hierarchy).toHaveLength(result.summary.totalNodes);
    });

    it('identifies visual regions and page height proportions', async () => {
      const snapshot = createMockSnapshot({ 'app/page.client.tsx': MOCK_PAGE_CODE });
      const result = await observeCompositionOperation.execute(snapshot, {}, context);

      expect(result.regions).toHaveLength(3); // header, cards-section, footer
      expect(result.regions[0]?.id).toBe('header');
      expect(result.regions[1]?.id).toBe('cards-section');
    });

    it('distinguishes intrinsic elements from component instances and slots', async () => {
      const compCode = `'use client';
import { Navbar } from '@/components/Navbar';

export default function Page() {
  return (
    <div data-id="root">
      <Navbar data-id="nav-1" />
      <p data-id="text-1">Hello</p>
    </div>
  );
}`;
      const snapshot = createMockSnapshot({ 'app/page.client.tsx': compCode });
      const result = await observeCompositionOperation.execute(snapshot, {}, context);

      const navNode = result.hierarchy.find((n) => n.id === 'nav-1');
      const textNode = result.hierarchy.find((n) => n.id === 'text-1');

      expect(navNode?.kind).toBe('component');
      expect(textNode?.kind).toBe('intrinsic');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Group 6: Design Audit & Accessibility Linter
  // ───────────────────────────────────────────────────────────────────────────
  describe('6. Design Audit & Accessibility Linter', () => {
    it('uses fresh rendered measurements supplied by the MCP browser adapter', async () => {
      const snapshot = createMockSnapshot({ 'app/page.client.tsx': MOCK_PAGE_CODE }, 7);
      const auditNodes = [
        {
          id: 'root', parentId: null, children: ['cta-btn'], text: '',
          rect: { x: 0, y: 0, width: 1200, height: 900 }, computed: { display: 'block' },
        },
        {
          id: 'cta-btn', parentId: 'root', children: [], text: 'Get Started',
          rect: { x: 1056, y: 16, width: 120, height: 48 },
          computed: { display: 'block', color: '#ffffff', backgroundColor: '#2563eb', fontSize: '16px' },
        },
      ];
      const epoch = {
        renderSeq: 4,
        projectVersionAtFill: 3,
        projectVersionNow: 3,
        stale: false,
        withRect: 2,
        total: 2,
        unmeasured: [],
        unmeasuredTotal: 0,
      };
      const getSnapshot = vi.fn().mockResolvedValue({
        status: 'ready',
        reason: 'Measured from the active Builder canvas.',
        nodes: auditNodes,
        epoch,
      });
      const adapterContext = {
        ...context,
        adapters: { auditSnapshotService: { getSnapshot } },
      };

      const result = await observeAuditOperation.execute(snapshot, { viewport: 'desktop' }, adapterContext as any);

      expect(getSnapshot).toHaveBeenCalledWith({
        projectId: 'test-project',
        branchId: 'main',
        filePath: 'app/page.client.tsx',
        revision: 7,
        viewport: 'desktop',
      });
      expect(result.status).toBe('ready');
      expect(result.checked).toBe(2);
      expect(result.stats.touchTargetsChecked).toBe(1);
      expect(result.passed).toBe(true);
    });

    it('flags small touch target on interactive elements smaller than 44x44px', async () => {
      bridge.setNode('tiny-btn', '', { x: 50, y: 50, width: 28, height: 28 }, { display: 'inline-block' });
      const tinyBtnCode = `'use client';
export default function Page() {
  return (
    <div data-id="root" style={{ width: '1200px' }}>
      <button data-id="tiny-btn" role="button">X</button>
    </div>
  );
}`;
      const snapshot = createMockSnapshot({ 'app/page.client.tsx': tinyBtnCode });
      const result = await observeAuditOperation.execute(snapshot, {}, context);

      const touchFinding = result.findings.find((f) => f.rule === 'SMALL_TOUCH_TARGET');
      expect(touchFinding).toBeDefined();
      expect(touchFinding?.nodeId).toBe('tiny-btn');
      expect(result.clean).toBe(false);
    });

    it('passes clean audit with zero violations on properly designed page', async () => {
      const snapshot = createMockSnapshot({ 'app/page.client.tsx': MOCK_PAGE_CODE });
      const result = await observeAuditOperation.execute(snapshot, {}, context);

      expect(result.clean).toBe(true);
      expect(result.passed).toBe(true);
      expect(result.errors).toBe(0);
      expect(result.summary).toBe('No violations detected.');
    });

    it('audits built-in viewports omitted from a page canvas configuration', async () => {
      const desktopOnly = `'use client';
/** @canvas { "viewports": [ { "id": "desktop", "label": "Desktop", "width": 1200, "height": "auto", "isPrimary": true, "order": 0 } ] } */
export default function Page() { return <div data-id="root">Page</div>; }`;
      const snapshot = createMockSnapshot({ 'app/page.client.tsx': desktopOnly });

      const result = await observeAuditOperation.execute(snapshot, { viewport: 'mobile' }, context);

      expect(result.viewportWidth).toBe(375);
      expect(result.status).not.toBe('unavailable');
      expect(result.summary).not.toContain('Unknown viewport');
    });

    it('detects sibling overlap exceeding tolerance', async () => {
      bridge.setNode('overlap-1', '', { x: 50, y: 50, width: 100, height: 100 });
      bridge.setNode('overlap-2', '', { x: 60, y: 60, width: 100, height: 100 });
      const overlapCode = `'use client';
export default function Page() {
  return (
    <div data-id="root" style={{ width: '1200px' }}>
      <div data-id="overlap-1">Box 1</div>
      <div data-id="overlap-2">Box 2</div>
    </div>
  );
}`;
      const snapshot = createMockSnapshot({ 'app/page.client.tsx': overlapCode });
      const result = await observeAuditOperation.execute(snapshot, {}, context);

      const overlapFinding = result.findings.find((f) => f.rule === 'OVERLAP');
      expect(overlapFinding?.severity).toBe('warning');
      expect(result.errors).toBe(0);
      expect(result.warnings).toBe(1);
      expect(result.passed).toBe(true);
    });

    it('reports viewport-tile overflow as informational rather than a blocking violation', async () => {
      bridge.setNode('root', '', { x: 0, y: 0, width: 1220, height: 900 });
      const rootOnlyCode = `'use client';
export default function Page() {
  return <div data-id="root" style={{ width: '1200px' }}>Page</div>;
}`;
      const snapshot = createMockSnapshot({ 'app/page.client.tsx': rootOnlyCode });

      const result = await observeAuditOperation.execute(snapshot, {}, context);
      const overflowFinding = result.findings.find((f) => f.rule === 'SECTION_DEPASSE_VIEWPORT');

      expect(overflowFinding?.severity).toBe('info');
      expect(result.errors).toBe(0);
      expect(result.clean).toBe(true);
      expect(result.passed).toBe(true);
      expect(result.summary).toContain('informational');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Group 7: Headless Screenshot Capture
  // ───────────────────────────────────────────────────────────────────────────
  describe('7. Headless Screenshot Capture', () => {
    it('degrades honestly to HEADLESS_DISPLAY_UNAVAILABLE when no display or adapter is present', async () => {
      const snapshot = createMockSnapshot({ 'app/page.client.tsx': MOCK_PAGE_CODE });
      const result = await observeScreenshotOperation.execute(snapshot, { viewport: 'desktop' }, context);

      expect(result.available).toBe(false);
      expect(result.primary.status).toBe('unavailable');
      expect(result.primary.reason).toBe('HEADLESS_DISPLAY_UNAVAILABLE');
      expect(result.primary.dataUrl).toBeUndefined();
    });

    it('delegates to injected screenshot adapter when provided in context', async () => {
      const mockCapture = vi.fn().mockResolvedValue({
        available: true,
        status: 'ready',
        dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        width: 1200,
        height: 800,
      });

      const adapterContext: any = {
        ...context,
        adapters: {
          screenshotService: {
            captureScreenshot: mockCapture,
          },
        },
      };

      const snapshot = createMockSnapshot({ 'app/page.client.tsx': MOCK_PAGE_CODE });
      const result = await observeScreenshotOperation.execute(snapshot, { viewport: 'desktop' }, adapterContext);

      expect(mockCapture).toHaveBeenCalled();
      expect(result.available).toBe(true);
      expect(result.primary.status).toBe('ready');
      expect(result.primary.dataUrl).toContain('data:image/png;base64,');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Group 8: Effect Verification & Interactive Mechanisms
  // ───────────────────────────────────────────────────────────────────────────
  describe('8. Effect Verification & Interactive Mechanisms', () => {
    it('verifies hover animation and spring physics on motion components', async () => {
      const snapshot = createMockSnapshot({ 'app/page.client.tsx': MOTION_EFFECT_PAGE });
      const result = await verifyEffectOperation.execute(
        snapshot,
        {
          targetFile: 'app/page.client.tsx',
          request: 'Add hover scale animation with spring physics to card',
          nodeId: 'hero-card',
          effectType: 'hover',
        },
        context
      );

      expect(result.satisfied).toBe(true);
      const motion = result.motionAnalysis?.['hero-card'];
      expect(motion).toBeDefined();
      expect(motion?.isMotionElement).toBe(true);
      expect(motion?.hasHover).toBe(true);
      expect(motion?.hasSpringPhysics).toBe(true);
      expect(motion?.physics?.presetMatch).toBe('bouncy');
    });

    it('flags absent interactive mechanism when expected token is missing', async () => {
      const staticCardCode = `'use client';
export default function Page() {
  return (
    <div data-id="root">
      <div data-id="card">Static Card</div>
    </div>
  );
}`;
      const snapshot = createMockSnapshot({ 'app/page.client.tsx': staticCardCode });
      const result = await verifyEffectOperation.execute(
        snapshot,
        {
          targetFile: 'app/page.client.tsx',
          request: 'Add whileHover scale animation to card',
          effectType: 'hover',
        },
        context
      );

      expect(result.satisfied).toBe(false);
      expect(result.missing.length).toBeGreaterThan(0);
      expect(result.states.find((s) => s.label === 'hover')?.state).toBe('absent');
    });

    it('recognizes a two-state component hover wired through interaction handlers', async () => {
      const connectedVariantCode = `'use client';
import { useState } from 'react';
import { motion } from 'framer-motion';
const variants = { default: { scale: 1 }, hover: { scale: 1.04 } };
export default function Button() {
  const [variant, setVariant] = useState('default');
  return <motion.button data-id="button-root" variants={variants} animate={variant}
    onHoverStart={() => setVariant('hover')} onHoverEnd={() => setVariant('default')}>CTA</motion.button>;
}`;
      const snapshot = createMockSnapshot({ 'components/PrimaryButton.tsx': connectedVariantCode });
      const result = await verifyEffectOperation.execute(
        snapshot,
        {
          targetFile: 'components/PrimaryButton.tsx',
          request: 'Button hover interaction',
          nodeId: 'button-root',
          effectType: 'hover',
        },
        context
      );

      expect(result.satisfied).toBe(true);
      expect(result.motionAnalysis?.['button-root']?.hasHover).toBe(true);
      expect(result.checks.find((check) => check.label === 'hover-animation')?.state).toBe('wired');
    });

    it('recognizes custom motion.create wrappers as valid motion elements', async () => {
      const wrappedLinkCode = `'use client';
import React, { useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
const MotionLink = motion.create(React.forwardRef(function MotionLinkBase(props: any, ref: any) {
  return <Link ref={ref} {...props} />;
}));
const variants = { default: { backgroundColor: '#000' }, hover: { backgroundColor: '#fff' } };
export default function Button() {
  const [variant, setVariant] = useState('default');
  return <MotionLink data-id="button-root" variants={variants} animate={variant}
    onHoverStart={() => setVariant('hover')} onHoverEnd={() => setVariant('default')}>CTA</MotionLink>;
}`;
      const snapshot = createMockSnapshot({ 'components/PrimaryButton.tsx': wrappedLinkCode });
      const result = await verifyEffectOperation.execute(
        snapshot,
        {
          targetFile: 'components/PrimaryButton.tsx',
          request: 'Button hover interaction',
          nodeId: 'button-root',
          effectType: 'hover',
        },
        context
      );

      expect(result.satisfied).toBe(true);
      expect(result.motionAnalysis?.['button-root']?.isMotionElement).toBe(true);
      expect(result.motionAnalysis?.['button-root']?.hasHover).toBe(true);
      expect(result.missing).toEqual([]);
    });

    it('recognizes a component hover state propagated to nested variants', async () => {
      const nestedVariantCode = `'use client';
import { useState } from 'react';
import { motion } from 'framer-motion';
const mediaVariants = { default: { filter: 'grayscale(100%)' }, hover: { filter: 'grayscale(0%)' } };
export default function Card() {
  const [variant, setVariant] = useState('default');
  return <motion.article data-id="project-card" animate={['default', variant]}
    onHoverStart={() => setVariant('hover')} onHoverEnd={() => setVariant('default')}>
    <motion.div data-id="project-media" variants={mediaVariants} />
  </motion.article>;
}`;
      const snapshot = createMockSnapshot({ 'components/ProjectCard.tsx': nestedVariantCode });
      const result = await verifyEffectOperation.execute(
        snapshot,
        {
          targetFile: 'components/ProjectCard.tsx',
          request: 'Project card hover interaction',
          nodeId: 'project-card',
          effectType: 'hover',
        },
        context
      );

      expect(result.satisfied).toBe(true);
      expect(result.motionAnalysis?.['project-card']?.hasHover).toBe(true);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Group 9: Project Diagnostics & Oracle Health
  // ───────────────────────────────────────────────────────────────────────────
  describe('9. Project Diagnostics & Oracle Health', () => {
    it('passes clean diagnostics on a valid project workspace', async () => {
      const snapshot = createMockSnapshot({
        'app/page.client.tsx': MOCK_PAGE_CODE,
      });
      const result = await diagnosticsProjectCheckOperation.execute(snapshot, {}, context);

      expect(result.clean).toBe(true);
      expect(result.passed).toBe(true);
      expect(result.blockingViolationsCount).toBe(0);
      expect(result.brokenImports).toHaveLength(0);
    });

    it('does not apply canvas Oracle rules to generated Next wrappers or plugin source', async () => {
      const snapshot = createMockSnapshot({
        'app/globals.css': 'body { margin: 0; }',
        'app/page.client.tsx': MOCK_PAGE_CODE,
        'app/providers.tsx': 'export function Providers({ children }) { return children; }',
        'app/page.tsx': `import PageClient from './page.client';
export const metadata = { title: 'IMPCT.DIGITAL' };
export default function Page() { return <PageClient />; }`,
        'app/layout.tsx': `import './globals.css';
import { Providers } from './providers';
export default function Layout({ children }) { return <html><body><Providers>{children}</Providers></body></html>; }`,
        'plugins/DirectusSync.tsx': `const entries = [1, 2];
export default function DirectusSync() { return <div>{entries.map((entry) => <span>{entry}</span>)}</div>; }`,
      });

      const result = await diagnosticsProjectCheckOperation.execute(snapshot, {}, context);

      const nonCanvasFiles = new Set([
        'app/page.tsx',
        'app/layout.tsx',
        'app/providers.tsx',
        'plugins/DirectusSync.tsx',
      ]);
      expect(result.oracleViolations.filter(({ file }) => nonCanvasFiles.has(file))).toEqual([]);
      expect(result.oracleViolations.some(({ file }) => file === 'app/page.client.tsx')).toBe(true);
      expect(result.totalFilesChecked).toBe(5);
    });

    it('detects syntax errors in project files', async () => {
      const brokenSyntaxCode = `'use client';
export default function Broken() {
  return <div data-id="unclosed">;
}`;
      const snapshot = createMockSnapshot({
        'app/page.client.tsx': brokenSyntaxCode,
      });
      const result = await diagnosticsProjectCheckOperation.execute(snapshot, {}, context);

      expect(result.clean).toBe(false);
      expect(result.blockingViolationsCount).toBeGreaterThan(0);
      expect(result.oracleViolations.some((v) => v.code === 'SYNTAX_ERROR')).toBe(true);
    });

    it('audits @controls code components as opaque code instead of editable design components', async () => {
      const codeComponent = `'use client';
/** @label "Looping Items" */
/** @defaultWidth 600 */
/** @defaultHeight 160 */
/** @controls { "speed": { "type": "number", "label": "Speed", "default": 60 } } */
import { withResponsiveProps } from '@revyme/runtime';
function LoopingItems({ speed = 60, ...props }) {
  return <div style={{ position: 'relative', ...props.style }}>{[1, 2].map((copy) => <span>{copy}</span>)}</div>;
}
export default withResponsiveProps(LoopingItems);`;
      const result = await diagnosticsProjectCheckOperation.execute(
        createMockSnapshot({ 'components/LoopingItems.tsx': codeComponent }),
        { targetFile: 'components/LoopingItems.tsx' },
        context,
      );

      expect(result.oracleViolations).toEqual([]);
      expect(result.clean).toBe(true);
    });

    it('detects broken component imports', async () => {
      const brokenImportCode = `'use client';
import { MissingWidget } from '@/components/NonExistent';
export default function Page() {
  return <div data-id="root"><MissingWidget data-id="w1" /></div>;
}`;
      const snapshot = createMockSnapshot({
        'app/page.client.tsx': brokenImportCode,
      });
      const result = await diagnosticsProjectCheckOperation.execute(snapshot, {}, context);

      expect(result.brokenImports.length).toBeGreaterThan(0);
      expect(result.brokenImports[0]?.importPath).toBe('@/components/NonExistent');
    });

    it('detects missing local assets', async () => {
      const missingAssetCode = `'use client';
export default function Page() {
  return (
    <div data-id="root">
      <img data-id="img1" src="/assets/nonexistent-banner.png" alt="Banner" />
    </div>
  );
}`;
      const snapshot = createMockSnapshot({
        'app/page.client.tsx': missingAssetCode,
      });
      const result = await diagnosticsProjectCheckOperation.execute(snapshot, {}, context);

      expect(result.missingAssets.length).toBeGreaterThan(0);
      expect(result.missingAssets[0]?.assetPath).toBe('/assets/nonexistent-banner.png');
    });

    it('detects circular slot hoisting dependencies', async () => {
      const snapshot = createMockSnapshot({
        'app/page.client.tsx': CIRCULAR_SLOT_PAGE,
      });
      const result = await diagnosticsProjectCheckOperation.execute(snapshot, {}, context);

      expect(result.circularBindings.length).toBeGreaterThan(0);
      expect(result.circularBindings[0]?.cycle).toContain('cn_a');
      expect(result.circularBindings[0]?.cycle).toContain('cn_b');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Group 10: Resiliency Matrix & Edge Case Handling
  // ───────────────────────────────────────────────────────────────────────────
  describe('10. Resiliency Matrix & Edge Case Handling', () => {
    it('handles query on nonexistent node gracefully without unhandled throw', async () => {
      const snapshot = createMockSnapshot({ 'app/page.client.tsx': MOCK_PAGE_CODE });
      const layoutRes = await observeLayoutOperation.execute(snapshot, { nodeId: 'missing-node' }, context);
      const visualsRes = await observeVisualsOperation.execute(snapshot, { nodeId: 'missing-node' }, context);

      expect(layoutRes.status).toBe('unavailable');
      expect(visualsRes.status).toBe('unavailable');
    });

    it('handles malformed AST gracefully in verify.effect with inconclusive status', async () => {
      const snapshot = createMockSnapshot({ 'app/page.client.tsx': 'const broken = <div data-id="bad";' });
      const result = await verifyEffectOperation.execute(
        snapshot,
        { request: 'Check broken' },
        context
      );

      expect(result.satisfied).toBe(false);
      expect(result.inconclusive).toBe(true);
    });
  });
});
