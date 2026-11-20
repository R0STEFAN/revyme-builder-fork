import { describe, it, expect } from 'vitest';
import { createSnapshot, createOperationContext } from '../../src/session';
import { observeAuditOperation } from '../../src/operations/observe';

const SVG_PAGE = `'use client';
import React from 'react';
export default function SvgPage() {
  return (
    <div data-id="root" style={{ width: '1200px', minHeight: '600px', backgroundColor: '#ffffff' }}>
      <svg data-id="svg-1" width="24" height="24" viewBox="0 0 24 24" style={{ width: '24px', height: '24px' }}>
        <path data-id="path-2" d="M0 0L24 24" stroke="#111111" strokeWidth="2" />
      </svg>
      <div data-id="box-3" style={{ width: '200px', height: '100px', backgroundColor: '#111111' }} />
    </div>
  );
}
`;

function makeAuditNode(id: string, type: string, rect: { x: number; y: number; width: number; height: number }) {
  return {
    id,
    type,
    name: id,
    parentId: id === 'root' ? null : 'root',
    rect,
    computed: {
      fontSize: '16px',
      color: 'rgb(17, 17, 17)',
      backgroundColor: 'rgb(255, 255, 255)',
      opacity: '1',
      position: 'relative',
    },
    text: '',
    styles: {},
    attrs: {},
  };
}

describe('Task 7: observe.audit ignores internal SVG geometry primitives in unmeasured checks', () => {
  it('promotes audit status to ready when the only unmeasured nodes are SVG child primitives', async () => {
    const snapshot = createSnapshot({ projectId: 'test-proj', branchId: 'main' }, 0, {
      'app/page.client.tsx': SVG_PAGE,
    });

    const context = createOperationContext({
      adapters: {
        auditSnapshotService: {
          async getSnapshot() {
            return {
              status: 'pending' as const,
              reason: 'Not measured: 3/4 nodes checked — canvas rendering; UNMEASURED: [path-2].',
              nodes: [
                makeAuditNode('root', 'div', { x: 0, y: 0, width: 1200, height: 600 }),
                makeAuditNode('svg-1', 'svg', { x: 0, y: 0, width: 24, height: 24 }),
                makeAuditNode('box-3', 'div', { x: 0, y: 24, width: 200, height: 100 }),
              ],
              epoch: {
                renderSeq: 4,
                projectVersionAtFill: 0,
                projectVersionNow: 0,
                stale: false,
                withRect: 3,
                total: 4,
                unmeasured: ['path-2'],
                unmeasuredTotal: 1,
              },
            };
          },
        },
      },
    });

    const res = await observeAuditOperation.execute(
      snapshot,
      { filePath: 'app/page.client.tsx', viewport: 'desktop' },
      context
    );

    expect(res.status).toBe('ready');
    expect(res.unmeasured).toEqual([]);
    expect(res.findings.some((f) => f.rule === 'CANVAS_MID_RENDER')).toBe(false);
  });

  it('still reports pending CANVAS_MID_RENDER when non-SVG DOM nodes remain unmeasured', async () => {
    const snapshot = createSnapshot({ projectId: 'test-proj', branchId: 'main' }, 0, {
      'app/page.client.tsx': SVG_PAGE,
    });

    const context = createOperationContext({
      adapters: {
        auditSnapshotService: {
          async getSnapshot() {
            return {
              status: 'pending' as const,
              reason: 'Not measured: 2/4 nodes checked — canvas rendering; UNMEASURED: [path-2, box-3].',
              nodes: [
                makeAuditNode('root', 'div', { x: 0, y: 0, width: 1200, height: 600 }),
                makeAuditNode('svg-1', 'svg', { x: 0, y: 0, width: 24, height: 24 }),
              ],
              epoch: {
                renderSeq: 4,
                projectVersionAtFill: 0,
                projectVersionNow: 0,
                stale: false,
                withRect: 2,
                total: 4,
                unmeasured: ['path-2', 'box-3'],
                unmeasuredTotal: 2,
              },
            };
          },
        },
      },
    });

    const res = await observeAuditOperation.execute(
      snapshot,
      { filePath: 'app/page.client.tsx', viewport: 'desktop' },
      context
    );

    expect(res.status).toBe('pending');
    expect(res.unmeasured).toEqual(['box-3']);
    expect(res.findings.some((f) => f.rule === 'CANVAS_MID_RENDER')).toBe(true);
  });
});
