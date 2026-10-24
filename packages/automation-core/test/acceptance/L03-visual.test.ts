// packages/automation-core/test/acceptance/L03-visual.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Snapshot, FileChange } from '../../src/contracts';
import { createSnapshot, createOperationContext } from '../../src/session';
import { catalogListOperation, catalogPlaceOperation } from '../../src/operations/catalog';
import { shapesUpdateAttrsOperation } from '../../src/operations/shapes';
import {
  drawingSketchAnimSetOperation,
  drawingSketchAnimGetOperation,
} from '../../src/operations/drawing';
import { codeComponentsCreateOperation } from '../../src/operations/code-components';
import { componentsInstanceCreateOperation } from '../../src/operations/component-props';
import {
  motionPresetApplyOperation,
  motionGetOperation,
} from '../../src/operations/motion';
import {
  siteEffectsSmoothScrollSetOperation,
  siteEffectsSmoothScrollGetOperation,
  siteEffectsPageTransitionSetOperation,
  siteEffectsPageTransitionGetOperation,
  siteEffectsCursorSetOperation,
} from '../../src/operations/site-effects';
import { observeVisualsOperation } from '../../src/operations/observe';
import { verifyEffectOperation } from '../../src/operations/verify';
import { projectFS } from '@/code/project/project-fs';

function applyChanges(files: Map<string, string>, changes: FileChange[]): void {
  for (const c of changes) {
    if (c.content === null) {
      files.delete(c.path);
    } else {
      files.set(c.path, c.content);
    }
  }
}

const INITIAL_LAYOUT = `'use client';
import React from 'react';
import LayoutClient from './LayoutClient';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body data-id="body-root">
        <LayoutClient>{children}</LayoutClient>
      </body>
    </html>
  );
}
`;

const INITIAL_LAYOUT_CLIENT = `'use client';
import React from 'react';

export default function LayoutClient({ children }: { children: React.ReactNode }) {
  return <main data-id="main-content">{children}</main>;
}
`;

const INITIAL_PAGE = `'use client';
import React from 'react';

/** @canvas { "viewports": [ { "id": "desktop", "label": "Desktop", "width": 1200, "height": "auto", "isPrimary": true, "order": 0 } ], "positions": { "desktop": { "x": 0, "y": 0 } } } */

export default function VisualPage() {
  return (
    <div data-id="canvas-root" style={{ width: '100%', minHeight: '100vh', background: '#0a0a0c', color: '#f3f4f6', position: 'relative' }}>
      <header data-id="visual-header" style={{ padding: '32px', textAlign: 'center' }}>
        <h1 data-id="hero-heading" style={{ fontSize: '48px', fontWeight: 'bold' }}>Visual Excellence</h1>
      </header>
      <section data-id="stage-area" style={{ display: 'flex', flexDirection: 'column', gap: '40px', padding: '32px' }}>
        <div data-id="hero-card" style={{ padding: '24px', background: '#18181b', borderRadius: '12px' }}>
          <h2 data-id="card-title">Dynamic Card Showcase</h2>
        </div>
        <div data-id="shape-container" style={{ display: 'flex', justifyContent: 'center', padding: '20px' }}>
          <svg data-id="vector-badge" viewBox="0 0 120 120" style={{ width: 120, height: 120 }}>
            <polygon data-id="badge-poly" points="60,10 110,40 90,110 30,110 10,40" stroke="#71717a" strokeWidth="2" fill="#27272a" />
          </svg>
        </div>
        <div data-id="cta-wrapper" style={{ textAlign: 'center', marginTop: '20px' }}>
          <button data-id="interactive-cta" style={{ padding: '14px 28px', background: '#6366f1', color: '#ffffff', borderRadius: '8px' }}>
            Experience Motion
          </button>
        </div>
      </section>
    </div>
  );
}
`;

const INTERACTIVE_GLOW_COMPONENT = `'use client';
/** @defaultWidth 400 */
/** @defaultHeight 240 */
/** @controls {
  "headline": { "type": "text", "label": "Headline", "default": "Glow Sensor" },
  "intensity": { "type": "number", "label": "Intensity", "default": 80, "min": 0, "max": 100 },
  "glowColor": { "type": "color", "label": "Glow Color", "default": "#8b5cf6" },
  "animated": { "type": "toggle", "label": "Animated", "default": true }
} */
import React from 'react';
import { withResponsiveProps } from '@revyme/runtime';

function GlowSensor(props: {
  headline?: string;
  intensity?: number;
  glowColor?: string;
  animated?: boolean;
}) {
  return (
    <div
      style={{
        padding: '24px',
        borderRadius: '16px',
        background: '#121216',
        border: \`1px solid \${props.glowColor ?? '#8b5cf6'}\`,
        boxShadow: \`0 0 \${props.intensity ?? 80}px \${props.glowColor ?? '#8b5cf6'}33\`,
      }}
    >
      <h3 style={{ margin: 0, fontSize: '20px', color: '#fff' }}>{props.headline ?? 'Glow Sensor'}</h3>
      <p style={{ margin: '8px 0 0', color: '#a1a1aa' }}>Signal level: {props.intensity ?? 80}%</p>
    </div>
  );
}

export default withResponsiveProps(GlowSensor);
`;

describe('Acceptance Suite L03: Visual Effects, Motion Presets, Shapes, & Code Components', () => {
  const context = createOperationContext();

  beforeEach(() => {
    for (const f of projectFS.listFiles()) {
      projectFS.deleteFile(f);
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('executes the full end-to-end visual workflow: catalog, shapes, code components, motion, site effects, and verification', async () => {
    let snapshot = createSnapshot(
      { projectId: 'l03-project', branchId: 'main' },
      1,
      {
        'app/layout.tsx': INITIAL_LAYOUT,
        'app/LayoutClient.tsx': INITIAL_LAYOUT_CLIENT,
        'app/page.tsx': INITIAL_PAGE,
        'app/page.client.tsx': INITIAL_PAGE,
      },
    );
    const mutableFiles = new Map(snapshot.files);

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 1: Built-in Catalog Browsing & Placement
    // ─────────────────────────────────────────────────────────────────────────
    const catalogList = await catalogListOperation.execute(snapshot, {}, context);
    expect(catalogList.items.length).toBeGreaterThan(5);
    const marqueeItem = catalogList.items.find((i) => i.id === 'cs-marquee');
    expect(marqueeItem).toBeDefined();

    const placeRes = await catalogPlaceOperation.execute(
      snapshot,
      {
        targetFile: 'app/page.tsx',
        parentId: 'stage-area',
        itemId: 'button',
      },
      context,
    );
    applyChanges(mutableFiles, placeRes.changes);
    snapshot = createSnapshot({ projectId: 'l03-project', branchId: 'main' }, 2, Object.fromEntries(mutableFiles));
    let pageCode = snapshot.files.get('app/page.tsx')!;
    expect(pageCode).toContain('Button');

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 2: SVG Vector Shapes & Active Drawing Animation
    // ─────────────────────────────────────────────────────────────────────────
    const shapeUpdateRes = await shapesUpdateAttrsOperation.execute(
      snapshot,
      {
        targetFile: 'app/page.tsx',
        nodeId: 'vector-badge',
        attrs: {
          stroke: '#6366f1',
          strokeWidth: '3',
          fill: '#312e81',
        },
      },
      context,
    );
    applyChanges(mutableFiles, shapeUpdateRes.changes);
    snapshot = createSnapshot({ projectId: 'l03-project', branchId: 'main' }, 3, Object.fromEntries(mutableFiles));
    pageCode = snapshot.files.get('app/page.tsx')!;
    expect(pageCode).toContain('stroke="#6366f1"');
    expect(pageCode).toContain('strokeWidth="3"');

    // Add sketch draw animation to the vector badge
    const sketchAnimRes = await drawingSketchAnimSetOperation.execute(
      snapshot,
      {
        targetFile: 'app/page.tsx',
        nodeId: 'vector-badge',
        trigger: 'inView',
        mode: 'draw',
        durationScale: 1.2,
        stagger: 0.08,
        transition: {
          type: 'spring',
          stiffness: 100,
          damping: 18,
        },
      },
      context,
    );
    applyChanges(mutableFiles, sketchAnimRes.changes);
    snapshot = createSnapshot({ projectId: 'l03-project', branchId: 'main' }, 4, Object.fromEntries(mutableFiles));
    pageCode = snapshot.files.get('app/page.tsx')!;
    expect(pageCode).toContain('playSketchDraw');
    expect(pageCode).toContain('vector-badge');

    // Verify sketch anim configuration readback
    const sketchConfig = await drawingSketchAnimGetOperation.execute(
      snapshot,
      {
        targetFile: 'app/page.tsx',
        nodeId: 'vector-badge',
      },
      context,
    );
    expect(sketchConfig.config).not.toBeNull();
    expect(sketchConfig.config?.trigger).toBe('inView');
    expect(sketchConfig.config?.mode).toBe('draw');
    expect(sketchConfig.config?.durationScale).toBe(1.2);

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 3: Code Component Authoring (@controls) & Placement
    // ─────────────────────────────────────────────────────────────────────────
    const codeCompRes = await codeComponentsCreateOperation.execute(
      snapshot,
      {
        name: 'GlowSensor',
        code: INTERACTIVE_GLOW_COMPONENT,
        defaultWidth: 400,
        defaultHeight: 240,
      },
      context,
    );
    expect(codeCompRes.name).toBe('GlowSensor');
    expect(codeCompRes.meta.controls.headline).toBeDefined();
    expect(codeCompRes.meta.controls.intensity?.type).toBe('number');
    expect(codeCompRes.meta.controls.glowColor?.type).toBe('color');
    applyChanges(mutableFiles, codeCompRes.changes);
    snapshot = createSnapshot({ projectId: 'l03-project', branchId: 'main' }, 5, Object.fromEntries(mutableFiles));
    expect(snapshot.files.has('components/GlowSensor.tsx')).toBe(true);

    // Place an instance of GlowSensor inside hero-card
    const instRes = await componentsInstanceCreateOperation.execute(
      snapshot,
      {
        componentName: 'GlowSensor',
        targetFile: 'app/page.tsx',
        parentId: 'hero-card',
        props: {
          headline: 'Core Reactor Glow',
          intensity: 95,
          glowColor: '#10b981',
        },
        style: {
          marginTop: '16px',
        },
      },
      context,
    );
    applyChanges(mutableFiles, instRes.changes);
    snapshot = createSnapshot({ projectId: 'l03-project', branchId: 'main' }, 6, Object.fromEntries(mutableFiles));
    pageCode = snapshot.files.get('app/page.tsx')!;
    expect(pageCode).toContain("import GlowSensor from '@/components/GlowSensor';");
    expect(pageCode).toContain('<GlowSensor');
    expect(pageCode).toContain('headline="Core Reactor Glow"');

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 4: Motion Presets and Physics
    // ─────────────────────────────────────────────────────────────────────────
    const motionRes = await motionPresetApplyOperation.execute(
      snapshot,
      {
        targetFile: 'app/page.tsx',
        nodeId: 'hero-card',
        preset: 'fade-up',
        physics: 'snappy',
      },
      context,
    );
    applyChanges(mutableFiles, motionRes.changes);
    snapshot = createSnapshot({ projectId: 'l03-project', branchId: 'main' }, 7, Object.fromEntries(mutableFiles));
    pageCode = snapshot.files.get('app/page.tsx')!;
    expect(pageCode).toContain('motion.div');
    expect(pageCode).toContain('whileInView');

    const cardMotion = await motionGetOperation.execute(
      snapshot,
      { targetFile: 'app/page.tsx', nodeId: 'hero-card' },
      context,
    );
    expect(cardMotion.isMotionElement).toBe(true);
    expect(cardMotion.props.whileInView).toBeDefined();

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 5: Site-Wide Effects (Smooth Scroll, Custom Cursor, Page Transitions)
    // ─────────────────────────────────────────────────────────────────────────
    // 5a. Smooth Scroll
    const scrollRes = await siteEffectsSmoothScrollSetOperation.execute(
      snapshot,
      { route: '/', enabled: true, intensity: 18, smoothWheel: true },
      context,
    );
    applyChanges(mutableFiles, scrollRes.changes);
    snapshot = createSnapshot({ projectId: 'l03-project', branchId: 'main' }, 8, Object.fromEntries(mutableFiles));
    expect(snapshot.files.has('app/smooth-scroll.ts')).toBe(true);
    expect(snapshot.files.get('app/layout.tsx')).toContain('<SmoothScroll />');

    const scrollGet = await siteEffectsSmoothScrollGetOperation.execute(snapshot, { route: '/' }, context);
    expect(scrollGet.config?.enabled).toBe(true);
    expect(scrollGet.config?.intensity).toBe(18);

    // 5b. Page Transitions
    const transRes = await siteEffectsPageTransitionSetOperation.execute(
      snapshot,
      { page: '/', preset: 'fade', duration: 0.35 },
      context,
    );
    applyChanges(mutableFiles, transRes.changes);
    snapshot = createSnapshot({ projectId: 'l03-project', branchId: 'main' }, 9, Object.fromEntries(mutableFiles));
    expect(snapshot.files.has('app/page-effects.ts')).toBe(true);

    const transGet = await siteEffectsPageTransitionGetOperation.execute(snapshot, { page: '/' }, context);
    expect(transGet.effect?.preset).toBe('fade');
    expect(transGet.effect?.target).toBe('all');

    // 5c. Custom Cursor attachment
    const cursorRes = await siteEffectsCursorSetOperation.execute(
      snapshot,
      {
        targetFile: 'app/page.tsx',
        nodeId: 'interactive-cta',
        component: 'PointerDot',
        mode: 'follow',
      },
      context,
    );
    applyChanges(mutableFiles, cursorRes.changes);
    snapshot = createSnapshot({ projectId: 'l03-project', branchId: 'main' }, 10, Object.fromEntries(mutableFiles));
    pageCode = snapshot.files.get('app/page.tsx')!;
    expect(pageCode).toContain('withCursor(');
    expect(pageCode).toContain('PointerDot');

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 6: Visual Observation & Verification
    // ─────────────────────────────────────────────────────────────────────────
    // 6a. Visual Observation of hero-card
    const visualCard = await observeVisualsOperation.execute(
      snapshot,
      { nodeId: 'hero-card' },
      context,
    );
    expect(visualCard.nodeId).toBe('hero-card');
    expect(['ready', 'pending']).toContain(visualCard.status);

    // 6b. Verify Effect on hero card animation
    const verifyEffectRes = await verifyEffectOperation.execute(
      snapshot,
      {
        targetFile: 'app/page.tsx',
        nodeId: 'hero-card',
        request: 'Add scroll animation with spring physics to card',
        effectType: 'scroll',
      },
      context,
    );
    expect(verifyEffectRes.satisfied).toBe(true);
    const motionInfo = verifyEffectRes.motionAnalysis?.['hero-card'];
    expect(motionInfo?.isMotionElement).toBe(true);
    expect(motionInfo?.hasScrollTrigger).toBe(true);
    expect(motionInfo?.hasSpringPhysics).toBe(true);
    expect(motionInfo?.physics?.presetMatch).toBe('snappy');

    // Final checks: all critical files are maintained and cleanly integrated
    expect(snapshot.files.has('app/layout.tsx')).toBe(true);
    expect(snapshot.files.has('app/page.tsx')).toBe(true);
    expect(snapshot.files.has('components/GlowSensor.tsx')).toBe(true);
    expect(snapshot.files.has('app/smooth-scroll.ts')).toBe(true);
    expect(snapshot.files.has('app/page-effects.ts')).toBe(true);
  });
});
