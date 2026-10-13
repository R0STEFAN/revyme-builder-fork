import { describe, it, expect } from 'vitest';
import { setConditionalOrderInCode, setConditionalStyleInCode } from './generator-styles';
import { changeTagInCode } from './generator-attrs';
import { InMemoryProjectFS, createEmptyProject } from '../project/project-fs';

describe('layout={true} motion-element guard & Link conversion', () => {
  it('does NOT add layout={true} to a plain <div> in setConditionalOrderInCode or setConditionalStyleInCode', () => {
    const src = `'use client';
import React, { useState } from 'react';
export default function Navbar() {
  const [variant, setVariant] = useState('default');
  return (
    <div data-id="btn" onClick={() => setVariant('open')} style={{ display: 'flex' }}>
      Menu
    </div>
  );
}`;
    const afterOrder = setConditionalOrderInCode(src, 'btn', { default: 0, open: 1 });
    expect(afterOrder).not.toContain('layout={true}');
    expect(afterOrder).toContain("order: variant === 'open' ? 1 : 0");

    const afterStyle = setConditionalStyleInCode(src, 'btn', 'flexDirection', 'open', 'column');
    expect(afterStyle).not.toContain('layout={true}');
    expect(afterStyle).toContain("flexDirection: variant === 'open' ? 'column' : 'row'");
  });

  it('DOES add layout={true} (without duplicating) to a <motion.div> with an inline arrow handler', () => {
    const src = `'use client';
import React, { useState } from 'react';
import { motion } from 'framer-motion';
export default function Navbar() {
  const [variant, setVariant] = useState('default');
  return (
    <motion.div data-id="btn" onClick={() => setVariant('open')} layout={true} style={{ display: 'flex' }}>
      Menu
    </motion.div>
  );
}`;
    const afterOrder = setConditionalOrderInCode(src, 'btn', { default: 0, open: 1 });
    expect(afterOrder.match(/layout=\{true\}/g)?.length).toBe(1);
  });

  it('converts <motion.div layout={true}> to <MotionLink layout={true}> when changeTagInCode is called with Link', () => {
    const src = `'use client';
import React from 'react';
import { motion } from 'framer-motion';
export default function List() {
  return (
    <motion.div layout={true} data-id="item-1" style={{ display: 'flex' }}>
      <span>Item</span>
    </motion.div>
  );
}`;
    const out = changeTagInCode(src, 'item-1', 'Link');
    expect(out).toContain('<MotionLink layout={true} data-id="item-1"');
    expect(out).toContain('</MotionLink>');
    expect(out).toContain('const MotionLink =');
    expect(out).not.toContain('<Link layout={true}');
  });

  it('heals stray layout={true} on plain <div> and ensures html { position: relative } on loadSnapshot', () => {
    const emptyFiles = createEmptyProject();
    expect(emptyFiles.get('app/globals.css')).toContain('html {\n  position: relative;\n}');

    const fs = new InMemoryProjectFS(new Map());
    fs.loadSnapshot(new Map([
      ['components/Navbar.tsx', `'use client';\nexport default function Navbar() {\n  return <div data-id="navbar-toggle-btn" layout={true} onClick={() => {}}>Menu</div>;\n}`],
    ]));
    expect(fs.readFile('components/Navbar.tsx')).not.toContain('layout={true}');
    expect(fs.readFile('components/Navbar.tsx')).toContain('<div data-id="navbar-toggle-btn" onClick={() => {}}>Menu</div>');
  });
});
