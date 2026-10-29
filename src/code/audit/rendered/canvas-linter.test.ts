// src/code/audit/rendered/canvas-linter.test.ts
import { describe, it, expect } from 'vitest';
import { runRenderedAudit } from './canvas-linter';
import type { AuditNode } from '@/ai/agent/tools/design-audit';

describe('Site Audit: Phase 2 In-Canvas Live Inspector', () => {
  it('detects low-text-contrast against background and parent background', async () => {
    const nodes: AuditNode[] = [
      {
        id: 'container',
        parentId: null,
        children: ['text-bad', 'text-good'],
        text: '',
        rect: { x: 0, y: 0, width: 800, height: 400 },
        computed: { backgroundColor: '#ffffff' },
      },
      {
        id: 'text-bad',
        parentId: 'container',
        children: [],
        text: 'Unreadable faint gray text',
        rect: { x: 20, y: 20, width: 200, height: 30 },
        computed: {
          color: '#cccccc', // contrast ratio against white is ~1.6:1 (way below 4.5:1)
          backgroundColor: '',
          fontSize: '14px',
          fontWeight: '400',
        },
      },
      {
        id: 'text-good',
        parentId: 'container',
        children: [],
        text: 'High contrast text',
        rect: { x: 20, y: 60, width: 200, height: 30 },
        computed: {
          color: '#111111',
          backgroundColor: '',
          fontSize: '14px',
          fontWeight: '400',
        },
      },
    ];

    const result = await runRenderedAudit({
      nodes,
      pagePath: 'app/page.tsx',
      scopes: ['accessibility'],
    });

    const contrastFindings = result.findings.filter((f) => f.ruleId === 'low-text-contrast');
    expect(contrastFindings).toHaveLength(1);
    expect(contrastFindings[0].location.nodeId).toBe('text-bad');
  });

  it('detects horizontal viewport overflow and clipped content', async () => {
    const nodes: AuditNode[] = [
      {
        id: 'wide-box',
        parentId: null,
        children: [],
        text: '',
        rect: { x: 100, y: 50, width: 1400, height: 100 }, // 100 + 1400 = 1500 > 1200
        computed: {},
      },
      {
        id: 'clipped-parent',
        parentId: null,
        children: ['clipped-child'],
        text: '',
        rect: { x: 0, y: 200, width: 300, height: 50 },
        computed: { overflow: 'hidden' },
      },
      {
        id: 'clipped-child',
        parentId: 'clipped-parent',
        children: [],
        text: 'This long text definitely spills out of the 50px high box and gets cut off completely by parent overflow.',
        rect: { x: 0, y: 200, width: 300, height: 120 },
        computed: {},
      },
    ];

    const result = await runRenderedAudit({
      nodes,
      viewportWidth: 1200,
      viewportHeight: 800,
      pagePath: 'app/page.tsx',
      scopes: ['performance'],
    });

    const ruleIds = result.findings.map((f) => f.ruleId);
    expect(ruleIds).toContain('horizontal-overflow');
    expect(ruleIds).toContain('clipped-content');
  });

  it('detects oversized images, below-fold eager loading, and missing LCP priority', async () => {
    const nodes: AuditNode[] = [
      {
        id: 'hero-img',
        parentId: null,
        children: [],
        text: '',
        rect: { x: 50, y: 50, width: 800, height: 400 }, // area 320,000 above fold
        computed: {},
      },
      {
        id: 'below-fold-img',
        parentId: null,
        children: [],
        text: '',
        rect: { x: 50, y: 1200, width: 200, height: 150 }, // y=1200 > 800
        computed: {},
      },
    ];

    const result = await runRenderedAudit({
      nodes,
      viewportWidth: 1200,
      viewportHeight: 800,
      pagePath: 'app/page.tsx',
      scopes: ['performance'],
      imagesMeta: [
        {
          nodeId: 'hero-img',
          naturalWidth: 800,
          naturalHeight: 400,
          loading: 'lazy', // LCP hero should not be lazy
        },
        {
          nodeId: 'below-fold-img',
          naturalWidth: 2000, // natural 2000 vs rendered 200 -> 10x oversized
          naturalHeight: 1500,
          loading: 'eager', // below fold should be lazy
        },
      ],
    });

    const ruleIds = result.findings.map((f) => f.ruleId);
    expect(ruleIds).toContain('missing-lcp-priority');
    expect(ruleIds).toContain('oversized-image');
    expect(ruleIds).toContain('eager-below-fold-image');
  });
});
