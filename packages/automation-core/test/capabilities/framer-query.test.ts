import { describe, expect, it } from 'vitest';
import capturedUnderline from '@/code/import/framer-native/fixtures/captured-underline.json';
import capturedComponents from '@/code/import/framer-native/fixtures/captured-components.json';
import capturedCms from '@/code/import/framer-native/fixtures/captured-cms.json';
import { createOperationContext, createSnapshot } from '../../src/session';
import { defaultRegistry } from '../../src/registry';
import '../../src/operations/framer-query';

const context = createOperationContext();
const target = { projectId: 'test-project', branchId: 'main' };
const snapshot = (files: Record<string, string> = {}) => createSnapshot(target, 0, files);

describe('automation-core: framer-query operations', () => {
  it('registers framer.* operations in defaultRegistry', () => {
    expect(defaultRegistry.get('framer.inspect')).toBeDefined();
    expect(defaultRegistry.get('framer.tokens')).toBeDefined();
    expect(defaultRegistry.get('framer.slice')).toBeDefined();
    expect(defaultRegistry.get('framer.cms')).toBeDefined();
  });

  it('executes framer.inspect via defaultRegistry', async () => {
    const op = defaultRegistry.get('framer.inspect')!;
    const result = await op.execute(
      snapshot(),
      { rawJson: JSON.stringify(capturedUnderline) },
      context
    ) as any;

    expect(result.provenance.projectId).toBe('fixture-project');
    expect(result.components.length).toBe(1);
    expect(result.components[0].name).toBe('Underline Link (Line Out)');
  });

  it('executes framer.tokens via defaultRegistry', async () => {
    const op = defaultRegistry.get('framer.tokens')!;
    const result = await op.execute(
      snapshot(),
      { rawJson: JSON.stringify(capturedComponents) },
      context
    ) as any;

    expect(result.colors.length).toBeGreaterThanOrEqual(2);
    expect(result.typography.length).toBeGreaterThanOrEqual(1);
  });

  it('executes framer.slice via defaultRegistry', async () => {
    const op = defaultRegistry.get('framer.slice')!;
    const result = await op.execute(
      snapshot(),
      { rawJson: JSON.stringify(capturedUnderline), nodeId: 'f03DgVEM5' },
      context
    ) as any;

    expect(result.id).toBe('f03DgVEM5');
    expect(result.name).toBe('Underline Link (Line Out)');
    expect(result.styles).toBeDefined();
    expect(result.children.length).toBeGreaterThan(0);
  });

  it('executes framer.cms via defaultRegistry', async () => {
    const op = defaultRegistry.get('framer.cms')!;
    const result = await op.execute(
      snapshot(),
      { rawJson: JSON.stringify(capturedCms) },
      context
    ) as any;

    expect(result.collections.length).toBeGreaterThanOrEqual(3);
    const names = result.collections.map((c: any) => c.name);
    expect(names).toContain('Works');
    expect(names).toContain('Category');
  });

  it('reads from snapshot files when filePath is provided', async () => {
    const filePath = 'captures/project.json';
    const snap = snapshot({ [filePath]: JSON.stringify(capturedUnderline) });
    const op = defaultRegistry.get('framer.inspect')!;
    const result = await op.execute(snap, { filePath }, context) as any;

    expect(result.provenance.projectId).toBe('fixture-project');
    expect(result.components[0].name).toBe('Underline Link (Line Out)');
  });

  it('throws error when neither filePath nor rawJson is provided or file is missing', async () => {
    const op = defaultRegistry.get('framer.inspect')!;
    await expect(
      op.execute(snapshot(), { filePath: 'non-existent-capture.json' }, context)
    ).rejects.toThrow(/FILE_NOT_FOUND/);
  });
});
