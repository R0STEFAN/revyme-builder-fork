import { describe, it, expect } from 'vitest';
import { setConditionalStyleInCode } from './generator-styles';
import { setVariantVisibilityInCode } from './variant-visibility-gen';
import { ensureFlipLayoutCounterScale } from './flip-layout-protection';
import { checkFile } from '../oracle/check-file';

const PROJECT_ROW_FIXTURE = `'use client';
import { motion } from 'framer-motion';
import { useState } from 'react';
import { withResponsiveProps } from '@revyme/runtime';

/** @name "ProjectRow" */
export const variantConfig = [
  { name: 'default', label: 'Default', x: 0, y: 0, isPrimary: true },
  { name: 'default-hover', label: 'Hover', x: 0, y: 600, interactionType: 'hover', parentVariant: 'default' },
];

const div19Variants = {
  default: { backgroundColor: '#ffffff' },
  'default-hover': { backgroundColor: '#09090b' },
};

const div36Variants = {
  default: { opacity: 0 },
  'default-hover': { opacity: 1 },
};

function ProjectRow({ style, title = 'FASHION STORE', initialVariant = 'default' }: { style?: React.CSSProperties; title?: string; initialVariant?: string }) {
  const [variant, setVariant] = useState(initialVariant);
  return (
    <motion.div
      data-id="div-19"
      data-name="Project Row"
      variants={div19Variants}
      initial={['default', initialVariant]}
      animate={['default', variant]}
      layout={true}
      style={{ overflow: 'hidden', width: '1200px', backgroundColor: '#ffffff', display: 'flex', flexDirection: 'column', ...style }}
    >
      <div data-id="div-20" data-name="Inner" style={{ position: 'relative', width: '100%', display: 'flex', flexDirection: 'column', flex: '0 0 auto' }}>
        <div data-id="div-21" data-name="Header" style={{ position: 'relative', width: '100%', display: 'flex', flexDirection: 'row', alignItems: 'center', flex: '0 0 auto', order: '0' }}>
          <p data-id="p-25" data-name="Title" style={{ position: 'relative', fontSize: '48px', flex: '0 0 auto' }}>{title}</p>
        </div>
        <motion.div
          data-id="div-36"
          data-name="Preview"
          variants={div36Variants}
          initial={['default', initialVariant]}
          animate={['default', variant]}
          style={{ position: 'relative', overflow: 'hidden', width: '100%', opacity: 0, display: 'flex', flexDirection: 'column', flex: '0 0 auto', order: '1' }}
        >
          <img data-id="img-37" data-name="Image" src="https://example.com/p.jpg" alt="Preview" style={{ position: 'relative', width: '100%', height: '380px', objectFit: 'cover', flex: '0 0 auto' }} />
        </motion.div>
      </div>
    </motion.div>
  );
}

export default withResponsiveProps(ProjectRow);
`;

describe('ensureFlipLayoutCounterScale (MCP-009)', () => {
  it('wraps component in LayoutGroup and promotes inner containers + media to layout="position" when height expands', () => {
    const out = setConditionalStyleInCode(
      PROJECT_ROW_FIXTURE,
      'div-36',
      'height',
      'default-hover',
      '380px',
    );

    expect(out).toContain('<LayoutGroup>');
    expect(out).toContain('</LayoutGroup>');
    expect(out).toMatch(/import\s*\{[^}]*LayoutGroup[^}]*\}\s*from\s*['"]framer-motion['"]/);

    // Expanding preview box keeps layout={true}, NOT layout="position"
    expect(out).toMatch(/<motion\.div[^>]*data-id="div-36"[^>]*layout=\{true\}|<motion\.div[^>]*layout=\{true\}[^>]*data-id="div-36"/);
    expect(out).not.toMatch(/data-id="div-36"[^>]*layout="position"/);

    // Structural inner wrapper, header row, and preview image get motion.* + layout="position"
    expect(out).toMatch(/<motion\.div[^>]*data-id="div-20"[^>]*layout="position"/);
    expect(out).toMatch(/<motion\.div[^>]*data-id="div-21"[^>]*layout="position"/);
    expect(out).toMatch(/<motion\.img[^>]*data-id="img-37"[^>]*layout="position"/);

    // Must pass Oracle with zero violations
    expect(checkFile(out, { kind: 'component', path: 'components/ProjectRow.tsx' })).toEqual([]);
  });

  it('also protects direct header sibling when AnimatePresence adds layout={true} to root', () => {
    const ACCORDION = `'use client';
import React from 'react';
import { withResponsiveProps } from '@revyme/runtime';
/** @name "Accordion" */
export const variantConfig = [
  { name: 'default', label: 'Default', isPrimary: true },
  { name: 'open', label: 'Open' },
];
function Accordion({ style, initialVariant = 'default' }: { style?: React.CSSProperties; initialVariant?: string }) {
  return (
    <div data-id="acc-root" style={{ position: 'relative', display: 'flex', flexDirection: 'column', width: '400px', height: 'auto', overflow: 'hidden', ...style }}>
      <div data-id="acc-header" style={{ position: 'relative', height: '48px', flex: '0 0 auto', order: '0' }}>Header</div>
      <div data-id="acc-body" style={{ position: 'relative', height: '120px', flex: '0 0 auto', order: '1' }}>Body</div>
    </div>
  );
}
export default withResponsiveProps(Accordion);`;
    const out = setVariantVisibilityInCode(ACCORDION, 'acc-body', ['default'], ['default', 'open']);
    expect(out).toContain('<LayoutGroup>');
    expect(out).toMatch(/<motion\.div[^>]*data-id="acc-header"[^>]*layout="position"/);
  });

  it('is idempotent when run a second time', () => {
    const once = setConditionalStyleInCode(
      PROJECT_ROW_FIXTURE,
      'div-36',
      'height',
      'default-hover',
      '380px',
    );
    const twice = ensureFlipLayoutCounterScale(once);
    expect(twice).toBe(once);
  });

  it('does not modify non-variant files or components without scaling layout', () => {
    const noVariantConfig = PROJECT_ROW_FIXTURE.replace('export const variantConfig =', 'const unrelated =');
    expect(ensureFlipLayoutCounterScale(noVariantConfig)).toBe(noVariantConfig);
  });
});
