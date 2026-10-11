import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import AlignmentControl from './AlignmentControl';
import { mergeVariantPinStyles } from '@/shared/pin-utils';
import { parseJSXToNodes } from '@/code/parsing/parser';
import { updateVariantStyleInCode } from '@/code/generation/generator-styles';
import { resolveVariantStyles } from '@/canvas/Renderer';

vi.mock('@/shared/debug-trace', () => ({
  trace: { action: vi.fn(), fn: vi.fn(), dom: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const SOURCE = `'use client';
import { motion } from 'framer-motion';
const line1Variants = { default: { rotate: 45 }, open: { rotate: 45 } };
const line2Variants = { default: { rotate: -45 }, open: { rotate: -45 } };
export default function Navbar({ initialVariant = 'default' }) {
  return <motion.button data-id="burger" style={{ position: 'relative', display: 'block', width: '100px', height: '100px' }}>
    <motion.div data-id="line-1" variants={line1Variants} initial={['default', initialVariant]} animate={['default', initialVariant]} style={{ position: 'absolute', left: '8px', top: '15px', width: '64px', height: '4px' }} />
    <motion.div data-id="line-2" variants={line2Variants} initial={['default', initialVariant]} animate={['default', initialVariant]} style={{ position: 'absolute', left: '8px', top: '23px', width: '64px', height: '4px' }} />
  </motion.button>;
}`;

describe('alignment buttons on rotated component lines', () => {
  it.each(['default', 'open'])('centres both lines individually on %s after the code round trip', (variant) => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    let code = SOURCE;
    try {
      for (const nodeId of ['line-1', 'line-2']) {
        const renderControl = () => {
          const node = parseJSXToNodes(code).get(nodeId)!;
          // The panel receives independent motion props, while the bridge
          // measures the painted AABB (64 × 4 rotated 45° → 48.08 × 48.08).
          const styles = mergeVariantPinStyles(node.styles, node.motionVariants, variant);
          act(() => root.render(<AlignmentControl
            nodeId={nodeId} enabled styles={styles}
            getElementRect={() => ({ width: 48.08, height: 48.08 })}
            getParentRect={() => ({ width: 100, height: 100 })}
            onUpdate={(update) => { code = updateVariantStyleInCode(code, nodeId, variant, update); }}
          />));
        };
        renderControl();
        act(() => host.querySelector<HTMLButtonElement>('[title="Center Horizontally"]')!.click());
        renderControl();
        act(() => host.querySelector<HTMLButtonElement>('[title="Center Vertically"]')!.click());
      }
      const nodes = parseJSXToNodes(code);
      for (const [nodeId, rotation] of [['line-1', 'rotate(45deg)'], ['line-2', 'rotate(-45deg)']]) {
        const painted = resolveVariantStyles(nodes.get(nodeId)!, variant);
        expect(painted.transform).toBe(rotation);
        // Centre rotation preserves the layout box's centre. Both lines
        // must intersect at the parent's (50, 50), regardless of angle.
        expect(parseFloat(painted.left) + parseFloat(painted.width) / 2).toBe(50);
        expect(parseFloat(painted.top) + parseFloat(painted.height) / 2).toBe(50);
        if (variant !== 'default') {
          expect(resolveVariantStyles(nodes.get(nodeId)!, 'default').left).toBe('8px');
        }
      }
    } finally {
      act(() => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    }
  });

  it('centres rotated lines in variant-2 when layout was removed from container', () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);

    // Initial state: flex container with 2 lines inside
    let code = `'use client';
import { motion } from 'framer-motion';
const burgerVariants = { default: {}, 'variant-1': {} };
const line1Variants = { default: {}, 'variant-1': {} };
const line2Variants = { default: {}, 'variant-1': {} };
export default function Navbar({ initialVariant = 'default' }) {
  return <motion.button data-id="burger" variants={burgerVariants} style={{ position: 'relative', display: 'flex', flexDirection: 'column', width: '100px', height: '100px' }}>
    <motion.div data-id="line-1" variants={line1Variants} initial={['default', initialVariant]} animate={['default', initialVariant]} style={{ position: 'relative', width: '64px', height: '4px' }} />
    <motion.div data-id="line-2" variants={line2Variants} initial={['default', initialVariant]} animate={['default', initialVariant]} style={{ position: 'relative', width: '64px', height: '4px' }} />
  </motion.button>;
}`;

    try {
      const variant = 'variant-1';
      // Step 1: Remove layout from container on variant-1 -> container becomes display: block, lines become position: absolute with initial coordinates
      code = updateVariantStyleInCode(code, 'burger', variant, { display: 'block' });
      code = updateVariantStyleInCode(code, 'line-1', variant, { position: 'absolute', left: '18px', top: '20px' });
      code = updateVariantStyleInCode(code, 'line-2', variant, { position: 'absolute', left: '18px', top: '70px' });

      // Step 2: Rotate lines in variant-1 to 45 and -45 deg
      code = updateVariantStyleInCode(code, 'line-1', variant, { rotate: '45' });
      code = updateVariantStyleInCode(code, 'line-2', variant, { rotate: '-45' });

      // Step 3: Center horizontally and vertically using AlignmentControl
      for (const nodeId of ['line-1', 'line-2']) {
        const renderControl = () => {
          const node = parseJSXToNodes(code).get(nodeId)!;
          const styles = mergeVariantPinStyles(node.styles, node.motionVariants, variant);
          act(() => root.render(<AlignmentControl
            nodeId={nodeId} enabled styles={styles}
            getElementRect={() => ({ width: 48.08, height: 48.08 })}
            getParentRect={() => ({ width: 100, height: 100 })}
            onUpdate={(update) => { code = updateVariantStyleInCode(code, nodeId, variant, update); }}
          />));
        };
        renderControl();
        act(() => host.querySelector<HTMLButtonElement>('[title="Center Horizontally"]')!.click());
        renderControl();
        act(() => host.querySelector<HTMLButtonElement>('[title="Center Vertically"]')!.click());
      }

      // Step 4: Verify that both lines are perfectly centered in variant-1 (50, 50)
      const nodes = parseJSXToNodes(code);
      for (const [nodeId, rotation] of [['line-1', 'rotate(45deg)'], ['line-2', 'rotate(-45deg)']]) {
        const painted = resolveVariantStyles(nodes.get(nodeId)!, variant);
        expect(painted.transform).toBe(rotation);
        expect(parseFloat(painted.left) + parseFloat(painted.width) / 2).toBe(50);
        expect(parseFloat(painted.top) + parseFloat(painted.height) / 2).toBe(50);
      }
    } finally {
      act(() => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    }
  });
});
