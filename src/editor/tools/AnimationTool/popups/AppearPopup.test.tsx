import { describe, it, expect, vi } from 'vitest';
import { parseJSXToNodes } from '@/code/parsing/parser';
import { updateMotionPropInCode } from '@/code/generation/generator-motion-props';
import { updateHtmlAttrsInCode } from '@/code/generation/generator-attrs';

describe('Appear Popup & Children Stagger', () => {
  const CONTAINER_CODE = `'use client';
import React from 'react';

export default function Page() {
  return (
    <div data-id="container" style={{ display: 'flex', flexDirection: 'column' }}>
      <div data-id="card-1">Card 1</div>
      <div data-id="card-2">Card 2</div>
      <div data-id="card-3">Card 3</div>
    </div>
  );
}`;

  it('captures data-stagger on a container', () => {
    const withStagger = updateHtmlAttrsInCode(CONTAINER_CODE, 'container', { 'data-stagger': '0.15' });
    expect(withStagger).toContain('data-stagger="0.15"');
    const nodes = parseJSXToNodes(withStagger);
    const container = nodes.get('container')!;
    expect(container.attrs?.['data-stagger']).toBe('0.15');
    expect(container.children).toEqual(['card-1', 'card-2', 'card-3']);
  });

  it('applies staggered appear animations across direct children', () => {
    let code = updateHtmlAttrsInCode(CONTAINER_CODE, 'container', { 'data-stagger': '0.1' });
    const nodes = parseJSXToNodes(code);
    const childIds = nodes.get('container')!.children;
    const enterProps = { opacity: '0', y: '30' };
    const transition = { type: 'spring', stiffness: '300', damping: '25' };
    const stagger = 0.1;

    childIds.forEach((cid, index) => {
      const delay = parseFloat((index * stagger).toFixed(2));
      code = updateMotionPropInCode(code, cid, 'initial', enterProps);
      code = updateMotionPropInCode(code, cid, 'whileInView', { opacity: '1', y: '0' });
      code = updateMotionPropInCode(code, cid, 'viewport', { once: 'true' });
      code = updateMotionPropInCode(code, cid, 'transition', { ...transition, delay: String(delay) });
    });

    const parsed = parseJSXToNodes(code);
    expect(parsed.get('card-1')!.motionProps?.transition?.delay).toBe('0');
    expect(parsed.get('card-2')!.motionProps?.transition?.delay).toBe('0.1');
    expect(parsed.get('card-3')!.motionProps?.transition?.delay).toBe('0.2');
    expect(parsed.get('container')!.attrs?.['data-stagger']).toBe('0.1');
  });

  it('supports stagger on collection list template with index expression', () => {
    const code = updateMotionPropInCode(
      `<motion.div data-id="card" />`,
      'card',
      'transition',
      { type: 'spring', stiffness: '300', damping: '25', delay: 'index * 0.1' }
    );
    expect(code).toContain('delay: index * 0.1');
  });
});
