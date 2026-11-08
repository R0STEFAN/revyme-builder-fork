// src/code/import/framer-native/normalizer.test.ts
import { describe, expect, it } from 'vitest';
import capturedUnderline from './fixtures/captured-underline.json';
import capturedComponents from './fixtures/captured-components.json';
import capturedCms from './fixtures/captured-cms.json';
import { normalizeNativeTransfer } from './normalizer';

describe('normalizer: normalizeNativeTransfer', () => {
  it('normalizes captured-underline into RevymeTransferIR format', () => {
    const ir = normalizeNativeTransfer(capturedUnderline);
    expect(ir.format).toBe('revyme.ir.v1');
    expect(ir.version).toBe(1);
    expect(ir.metadata.projectId).toBe('fixture-project');
    expect(ir.components.length).toBe(1);
    expect(ir.components[0].name).toBe('Underline Link (Line Out)');
    expect(ir.components[0].variants.length).toBeGreaterThanOrEqual(2);
  });

  it('normalizes captured-components with tokens and collections', () => {
    const ir = normalizeNativeTransfer(capturedComponents);
    expect(ir.format).toBe('revyme.ir.v1');
    expect(ir.tokens.colors.length).toBeGreaterThanOrEqual(2);
    expect(ir.tokens.typography.length).toBeGreaterThanOrEqual(1);
    expect(ir.cms.some(c => c.name === 'Category')).toBe(true);
    expect(ir.components.length).toBeGreaterThanOrEqual(1);
  });

  it('normalizes captured-cms with all collections and items', () => {
    const ir = normalizeNativeTransfer(capturedCms);
    expect(ir.format).toBe('revyme.ir.v1');
    expect(ir.cms.length).toBeGreaterThanOrEqual(3);
    const works = ir.cms.find(c => c.name === 'Works');
    expect(works).toBeDefined();
    expect(works?.fields.length).toBeGreaterThan(0);
    expect(works?.items.length).toBeGreaterThan(0);
  });
});
