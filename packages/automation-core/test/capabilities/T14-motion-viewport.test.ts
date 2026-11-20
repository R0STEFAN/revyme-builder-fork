import { describe, it, expect } from 'vitest';
import { createSnapshot, createOperationContext } from '../../src/session';
import { checkFile } from '@/code/oracle/check-file';
import { motionSetOperation } from '../../src/operations/motion';

function snapshotWithDiv(id: string) {
  return createSnapshot({ projectId: 'test-project', branchId: 'main' }, 0, {
    'app/page.client.tsx': `'use client';
import React from 'react';
export default function Page() {
  return (
    <div data-id="root" style={{ width: '100%' }}>
      <div data-id="${id}" style={{ width: '200px', height: '200px', backgroundColor: '#111111' }}>
        Hello
      </div>
    </div>
  );
}
`,
  });
}

describe('Task 5: motion.set automatic viewport={{ once: true }} on whileInView', () => {
  const context = createOperationContext();

  it('auto-injects viewport={{ once: true }} when setting whileInView and satisfies Oracle', async () => {
    const res = await motionSetOperation.execute(
      snapshotWithDiv('box-1'),
      {
        targetFile: 'app/page.client.tsx',
        nodeId: 'box-1',
        prop: 'whileInView',
        values: { clipPath: 'inset(0% 0% 0% 0%)' },
      } as any,
      context
    );
    const next = res.changes[0].content!;
    expect(next).toMatch(/viewport=\{\{\s*once:\s*true\s*\}\}/);
    const violations = checkFile(next, { kind: 'page' }).filter(
      (v) => v.code === 'APPEAR_MISSING_VIEWPORT_ONCE'
    );
    expect(violations).toHaveLength(0);
  });

  it('allows opting out via viewportOnce: false', async () => {
    const res = await motionSetOperation.execute(
      snapshotWithDiv('box-2'),
      {
        targetFile: 'app/page.client.tsx',
        nodeId: 'box-2',
        prop: 'whileInView',
        values: { opacity: '1' },
        viewportOnce: false,
      } as any,
      context
    );
    const next = res.changes[0].content!;
    expect(next).not.toMatch(/viewport=\{\{/);
  });
});
