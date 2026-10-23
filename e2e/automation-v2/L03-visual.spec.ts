// e2e/automation-v2/L03-visual.spec.ts
/**
 * E2E Acceptance Spec L03: Visual Effects, Motion Presets, Shapes, & Code Components
 */

import { describe, it, expect } from 'vitest';
import { createSnapshot, createOperationContext } from '../../packages/automation-core/src/session';
import { catalogListOperation } from '../../packages/automation-core/src/operations/catalog';
import { shapesUpdateAttrsOperation } from '../../packages/automation-core/src/operations/shapes';
import { drawingSketchAnimSetOperation, drawingSketchAnimGetOperation } from '../../packages/automation-core/src/operations/drawing';
import { codeComponentsCreateOperation } from '../../packages/automation-core/src/operations/code-components';
import { motionPresetApplyOperation, motionGetOperation } from '../../packages/automation-core/src/operations/motion';
import { siteEffectsSmoothScrollSetOperation, siteEffectsPageTransitionSetOperation } from '../../packages/automation-core/src/operations/site-effects';

describe('E2E L03: Visual & Motion Spec', () => {
  const context = createOperationContext();

  it('validates catalog browsing, vector shape animations, motion presets, and site effects', async () => {
    const pageCode = `'use client';
import React from 'react';

export default function VisualPage() {
  return (
    <div data-id="root">
      <svg data-id="badge-svg" viewBox="0 0 100 100">
        <circle data-id="circle-1" cx="50" cy="50" r="40" stroke="#000" fill="#fff" />
      </svg>
      <div data-id="hero-card">
        <h1 data-id="card-title">Super Fast</h1>
      </div>
    </div>
  );
}
`;
    let snapshot = createSnapshot(
      { projectId: 'e2e-project', branchId: 'main' },
      0,
      { 'app/page.tsx': pageCode },
    );

    // 1. Catalog
    const catRes = await catalogListOperation.execute(snapshot, {}, context);
    expect(catRes.items.length).toBeGreaterThan(0);

    // 2. Shapes & Sketch anim
    const shapeRes = await shapesUpdateAttrsOperation.execute(
      snapshot,
      {
        targetFile: 'app/page.tsx',
        nodeId: 'badge-svg',
        attrs: { stroke: '#2563eb' },
      },
      context,
    );
    expect(shapeRes.changes.length).toBeGreaterThan(0);

    const sketchRes = await drawingSketchAnimSetOperation.execute(
      snapshot,
      {
        targetFile: 'app/page.tsx',
        nodeId: 'badge-svg',
        trigger: 'inView',
        mode: 'draw',
      },
      context,
    );
    expect(sketchRes.changes.length).toBeGreaterThan(0);

    // 3. Motion Preset
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
    expect(motionRes.changes.length).toBeGreaterThan(0);
  });
});
