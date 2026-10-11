import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { getDefaultStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LayoutTool, { detectLayoutFlags } from './LayoutTool';
import { setStyleContext } from '@/canvas/node-ops';
import { getCanvasBridge, setActiveBridge } from '@/canvas/canvas-bridge';
import { resolveVariantStyles } from '@/canvas/Renderer';
import { parseJSXToNodes } from '@/code/parsing/parser';
import { updateNodeInCode } from '@/code/generation/generator-crud';
import { setConditionalStyleInCode, updateVariantStyleInCode } from '@/code/generation/generator-styles';
import { setVariantVisibilityInCode } from '@/code/generation/variant-visibility-gen';
import { codeAtom, nodesAtom } from '@/code/stores/store';
import { activeFilePathAtom } from '@/code/project/active-file-store';
import { interactingViewportIdAtom } from '@/code/stores/viewport-store';

// Keep the control, style router, generators, parser and renderer real. Only
// the iframe transport and persistence scheduler are replaced by test doubles.
const { pending } = vi.hoisted(() => ({ pending: [] as any[] }));
vi.mock('@/code/mutation/mutation-queue', () => ({
  queueMutation: (mutation: unknown) => pending.push(mutation),
  flushNow: vi.fn(), setForceRender: vi.fn(),
}));
vi.mock('@/shared/debug-trace', () => ({
  trace: { action: vi.fn(), fn: vi.fn(), error: vi.fn(), dom: vi.fn(), warn: vi.fn() },
}));
vi.mock('@/canvas/transform', () => ({
  transformManager: { getTransform: () => ({ x: 0, y: 0, scale: 1 }) },
}));

const SOURCE = `'use client';
import { motion } from 'framer-motion';
const variantConfig = [
  { name: 'default', label: 'Default', x: 0, y: 0, isPrimary: true },
  { name: 'variant-1', label: 'Open', x: 100, y: 0 },
  { name: 'variant-2', label: 'Other', x: 200, y: 0 },
];
const burgerVariants = { default: {}, 'variant-1': {}, 'variant-2': {} };
const line1Variants = { default: {}, 'variant-1': {}, 'variant-2': {} };
const line2Variants = { default: {}, 'variant-1': {}, 'variant-2': {} };
export default function Navbar({ initialVariant = 'default' }) {
  return <motion.div data-id="navbar" style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}>
    <motion.button data-id="burger" variants={burgerVariants} style={{
      position: 'relative', width: '40px', height: '40px', display: 'flex',
      flexDirection: initialVariant === 'variant-2' ? 'row' : 'column',
      alignItems: 'center', justifyContent: 'center', gap: '6px'
    }}>
      <motion.div data-id="line-1" variants={line1Variants} style={{ position: 'relative', width: '24px', height: '2px' }} />
      <motion.div data-id="line-2" variants={line2Variants} style={{ position: 'relative', width: '24px', height: '2px' }} />
    </motion.button>
  </motion.div>;
}`;

let host: HTMLDivElement;
let root: Root;
const originalBridge = getCanvasBridge();
const noUpdate = () => {};
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  pending.length = 0;
  host = document.createElement('div');
  host.setAttribute('data-content-root', '');
  document.body.append(host);
  root = createRoot(host);
  const rects: Record<string, DOMRect> = {
    burger: new DOMRect(100, 100, 40, 40),
    'line-1': new DOMRect(108, 115, 24, 2),
    'line-2': new DOMRect(108, 123, 24, 2),
  };
  setActiveBridge({
    getRect: (id: string) => rects[id] ?? null,
    getChildRects: () => [], getComputedValue: () => '', getComputedValues: () => ({}),
    getContainerRect: () => null, getElementIdsAtPoint: () => [],
    patchStyles: vi.fn(), patchAttrsAndStyles: vi.fn(), injectCSS: vi.fn(), removeCSS: vi.fn(),
  } as any);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  setActiveBridge(originalBridge);
  vi.unstubAllGlobals();
});

describe('Remove Layout in a component variant', () => {
  it.each([
    ['desktop', false], ['variant-1', false], ['desktop', true],
  ] as const)('removes layout on %s (entered from page: %s) and keeps absolute lines inside the relative burger', (variant, fromPage) => {
    const store = getDefaultStore();
    store.set(activeFilePathAtom, 'components/Navbar.tsx');
    store.set(codeAtom, SOURCE);
    const nodes = store.get(nodesAtom);
    store.set(interactingViewportIdAtom, variant);
    setStyleContext('components/Navbar.tsx', variant, 1440);
    const styles = resolveVariantStyles(nodes.get('burger')!, variant);
    const tool = <LayoutTool nodeId="burger" styles={styles} onUpdate={noUpdate} onUpdateMultiple={noUpdate} />;
    if (fromPage) {
      store.set(activeFilePathAtom, 'app/page.tsx');
      store.set(codeAtom, SOURCE);
      act(() => root.render(tool));
      act(() => {
        store.set(activeFilePathAtom, 'components/Navbar.tsx');
      });
    } else act(() => root.render(tool));
    act(() => host.querySelector<HTMLButtonElement>('[title="Remove Layout"]')!.click());

    let code = SOURCE;
    for (const mutation of pending) {
      if (mutation.type === 'updateStyles') code = updateNodeInCode(code, mutation.nodeId, mutation.styles);
      else if (mutation.type === 'setConditionalStyle') code = setConditionalStyleInCode(code, mutation.nodeId, mutation.prop, mutation.variantName, mutation.value);
      else if (mutation.type === 'updateVariantStyle') code = updateVariantStyleInCode(code, mutation.nodeId, mutation.variantName, mutation.styles);
      else if (mutation.type === 'setVariantVisibility') code = setVariantVisibilityInCode(code, mutation.nodeId, mutation.hiddenVariants, mutation.allVariants);
      else throw new Error(`Unexpected mutation: ${mutation.type}`);
    }
    const updated = parseJSXToNodes(code);
    const burgerStyles = resolveVariantStyles(updated.get('burger')!, variant);
    expect(burgerStyles.display).toBe('block');
    expect(burgerStyles.position).toBe('relative');
    expect(resolveVariantStyles(updated.get('line-1')!, variant)).toMatchObject({ position: 'absolute', left: '8px', top: '15px' });
    expect(resolveVariantStyles(updated.get('line-2')!, variant)).toMatchObject({ position: 'absolute', left: '8px', top: '23px' });
    expect(resolveVariantStyles(updated.get('burger')!, 'variant-2').display).toBe(variant === 'desktop' ? 'block' : 'flex');
    expect(detectLayoutFlags(burgerStyles).hasLayout).toBe(false);
    act(() => root.render(<LayoutTool nodeId="burger" styles={burgerStyles} onUpdate={noUpdate} onUpdateMultiple={noUpdate} />));
    expect(host.querySelector('[title="Add Layout"]')).not.toBeNull();
    expect(host.querySelector('[title="Remove Layout"]')).toBeNull();
  });
});
