import { describe, it, expect } from 'vitest';
import { decodeNativeTransfer } from './framer-transfer-envelope.mjs';
import capturedUnderline from '../code/import/framer-native/fixtures/captured-underline.json';

const sample = () => ({
  format: 'revyme.framer.native', version: 1,
  context: { projectId: 'project', branchId: 'main', revision: '4', editorBuild: 'build', scopeId: 'page', mode: 'page' },
  rootIds: ['page'], definitions: [{ id: 'page', kind: 'WebPageNode', data: { id: 'page', children: [] } }],
  assets: [], complete: true, diagnostics: [],
});

describe('native Framer transfer trust boundary', () => {
  it('accepts the live source serialization with exposed variables and all inherited variants', () => {
    const decoded = decodeNativeTransfer(capturedUnderline);
    const component = decoded.definitions[0].data;
    expect(decoded.context.mode).toBe('component');
    expect((component.variables as unknown[]).length).toBe(5);
    const variants = component.children as Array<{ name: string; replicaInfo: unknown }>;
    expect(variants.map(n => n.name)).toEqual(['Regular', 'Regular - Line in', 'Regular - Reset', 'Large', 'Large - Line in', 'Large - Reset']);
    expect(variants.filter(n => n.replicaInfo)).toHaveLength(5);
  });
  it('accepts JSON transport without changing the source identities or content', () => {
    const value = sample();
    value.definitions[0].data.children.push({ id: 'text', name: 'A & B {draft}' } as never);
    const decoded = decodeNativeTransfer(JSON.stringify(value));
    expect(decoded.rootIds).toEqual(['page']);
    expect(decoded.definitions[0].data.children).toEqual([{ id: 'text', name: 'A & B {draft}' }]);
  });

  it.each([
    ['unsupported version', () => ({ ...sample(), version: 2 })],
    ['wrong format', () => ({ ...sample(), format: 'other' })],
    ['missing root', () => ({ ...sample(), rootIds: ['unknown'] })],
    ['duplicate definition', () => { const s = sample(); return { ...s, definitions: [...s.definitions, s.definitions[0]] }; }],
    ['invalid scope mode', () => ({ ...sample(), context: { ...sample().context, mode: 'other' } })],
    ['invalid completeness', () => ({ ...sample(), complete: 'yes' })],
    ['prototype keys', () => JSON.parse(JSON.stringify(sample()).replace('"children":[]', '"__proto__":{"polluted":true}'))],
    ['nonplain data', () => ({ ...sample(), assets: [new Date()] })],
  ])('rejects %s before conversion', (_name, make) => {
    expect(() => decodeNativeTransfer(make())).toThrow();
  });

  it('rejects cycles and excessive nesting with a bounded decode error', () => {
    const value = sample();
    (value.definitions[0].data as Record<string, unknown>).self = value;
    expect(() => decodeNativeTransfer(value)).toThrow(/cycle/i);
    let deep: Record<string, unknown> = {};
    for (let i = 0; i < 260; i++) deep = { child: deep };
    expect(() => decodeNativeTransfer({ ...sample(), assets: [deep] })).toThrow(/depth/i);
  });
});
