import { describe, it, expect } from 'vitest';
import { createSnapshot, createOperationContext } from '../../src/session';
import { fragmentsInsertOperation } from '../../src/operations/fragments';
import { ingestJSXFragment } from '../../src/ingestion/jsx';
import { checkFile } from '@/code/oracle/check-file';

const SVG_ORACLE_CODES = new Set([
  'SHAPE_GEOMETRY_NOT_PATH',
  'SHAPE_GEOMETRY_ID_REQUIRED',
  'SHAPE_PATH_MULTIPLE_SUBPATHS',
  'WRAPPER_PAINT_PROPS',
  'NESTED_SVG_OVERFLOW_REQUIRED',
  'NESTED_SVG_BOX_IN_STYLE',
]);

describe('Task 8: SVG primitive & multi-subpath auto-healing on JSX ingestion', () => {
  const context = createOperationContext();

  it('heals <rect>/<circle>/<line>/<polygon> and multi-subpath stroke <path> via fragments.insert with 0 SVG Oracle violations', async () => {
    const basePage = `'use client';
import React from 'react';
export default function Page() {
  return (
    <div data-id="root" style={{ position: 'relative', width: '100%' }}>
    </div>
  );
}
`;
    const snapshot = createSnapshot({ projectId: 'test-proj', branchId: 'main' }, 0, {
      'app/page.client.tsx': basePage,
    });

    const dirtySvg = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#111111" strokeWidth="2" style={{ width: '24px', height: '24px' }}>
  <rect x="3" y="5" width="18" height="14" />
  <circle cx="12" cy="12" r="3" />
  <line x1="2" y1="2" x2="22" y2="22" />
  <polygon points="12,2 20,20 4,20" />
  <path d="M5 12H19M13 6L19 12L13 18" stroke="#111111" />
</svg>`;

    const res = await fragmentsInsertOperation.execute(
      snapshot,
      {
        targetFile: 'app/page.client.tsx',
        parentId: 'root',
        fragment: dirtySvg,
      },
      context
    );

    const nextCode = res.changes[0]?.content ?? '';
    const violations = checkFile(nextCode, { kind: 'page' });
    const svgViolations = violations.filter((v) => SVG_ORACLE_CODES.has(v.code));
    expect(svgViolations).toEqual([]);
    expect(nextCode).not.toMatch(/<(?:rect|circle|line|polygon)\b/);
  });

  it('converts relative subsequent m commands to absolute M when splitting stroke subpaths and preserves filled donut holes', () => {
    const strokeRelative = ingestJSXFragment(
      `<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M2 2L8 2m4 4l4 4" stroke="#111111" /></svg>`
    )!;
    // Outer svg wrapper now holds nested <svg overflow="visible"> children, each with 1 <path>
    expect(strokeRelative.tag).toBe('svg');
    expect(strokeRelative.props?.fill).toBeUndefined();
    expect(strokeRelative.children?.length).toBe(2);
    const secondNested = strokeRelative.children![1];
    expect(secondNested.tag).toBe('svg');
    expect(secondNested.props?.overflow).toBe('visible');
    const secondPath = secondNested.children![0];
    expect(secondPath.tag).toBe('path');
    // M2,2 -> L8,2 -> cursor at (8,2) + relative m4,4 => M12 6
    expect(String(secondPath.props?.d)).toMatch(/^M12[\s,]+6/i);

    // Filled multi-subpath donut hole stays intact as a single path
    const donut = ingestJSXFragment(
      `<svg width="24" height="24" viewBox="0 0 24 24"><path data-id="donut-g0" fill="#111111" fillRule="evenodd" d="M12 2A10 10 0 1 0 12 22A10 10 0 1 0 12 2ZM12 6A6 6 0 1 1 12 18A6 6 0 1 1 12 6Z" /></svg>`
    )!;
    expect(donut.children).toHaveLength(1);
    expect(donut.children![0].tag).toBe('path');
  });
});
