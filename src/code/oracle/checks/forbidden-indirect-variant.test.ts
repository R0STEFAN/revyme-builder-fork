import { describe, it, expect } from 'vitest';
import { checkFile } from '../check-file';

describe('FORBIDDEN_INDIRECT_VARIANT_CHECK oracle rule', () => {
  const codes = (src: string) => checkFile(src, { kind: 'component' }).map((v) => v.code);

  it('bounces intermediate boolean variable testing initialVariant', () => {
    const code = `
'use client';
import React from 'react';
import { withResponsiveProps } from '@revyme/runtime';

/** @name "SiteHeader" */
export const variantConfig = [
  { name: 'default', label: 'Default', x: 0, y: 0, isPrimary: true },
  { name: 'scrolled', label: 'Scrolled', x: 1250, y: 0 },
];

function SiteHeader({ initialVariant = 'default', style }: { initialVariant?: string; style?: React.CSSProperties }) {
  const isScrolled = initialVariant === 'scrolled';
  return (
    <div data-id="header-root" style={{ width: '1200px', height: '76px', ...style }}>
      <span data-id="title" style={{ color: isScrolled ? 'red' : 'blue' }}>Title</span>
    </div>
  );
}

export default withResponsiveProps(SiteHeader);
`;
    const c = codes(code);
    expect(c).toContain('FORBIDDEN_INDIRECT_VARIANT_CHECK');
  });

  it('bounces intermediate boolean variable testing variant', () => {
    const code = `
'use client';
import React, { useState } from 'react';
import { withResponsiveProps } from '@revyme/runtime';

/** @name "PassageCard" */
export const variantConfig = [
  { name: 'default', label: 'Default', x: 0, y: 0, isPrimary: true },
  { name: 'active', label: 'Active', x: 400, y: 0 },
];

function PassageCard({ initialVariant = 'default', style }: { initialVariant?: string; style?: React.CSSProperties }) {
  const [variant, setVariant] = useState(initialVariant);
  const isActive = variant === 'active';
  return (
    <div data-id="card-root" style={{ width: '360px', height: '240px', ...style }}>
      <img data-id="card-img" style={{ filter: isActive ? 'none' : 'grayscale(1)' }} />
    </div>
  );
}

export default withResponsiveProps(PassageCard);
`;
    const c = codes(code);
    expect(c).toContain('FORBIDDEN_INDIRECT_VARIANT_CHECK');
  });

  it('allows direct inline ternaries testing initialVariant or variant', () => {
    const code = `
'use client';
import React from 'react';
import { withResponsiveProps } from '@revyme/runtime';

/** @name "SiteHeader" */
export const variantConfig = [
  { name: 'default', label: 'Default', x: 0, y: 0, isPrimary: true },
  { name: 'scrolled', label: 'Scrolled', x: 1250, y: 0 },
];

function SiteHeader({ initialVariant = 'default', style }: { initialVariant?: string; style?: React.CSSProperties }) {
  return (
    <div data-id="header-root" style={{
      width: '1200px',
      height: initialVariant === 'scrolled' ? '68px' : '76px',
      backgroundColor: initialVariant === 'scrolled' ? 'rgba(15, 26, 23, 0.94)' : 'rgba(19, 32, 29, 0.25)',
      ...style
    }}>
      <span data-id="title">Title</span>
    </div>
  );
}

export default withResponsiveProps(SiteHeader);
`;
    const c = codes(code);
    expect(c).not.toContain('FORBIDDEN_INDIRECT_VARIANT_CHECK');
  });

  it('allows boolean props with boolean default in style ternaries', () => {
    const code = `
'use client';
import React from 'react';
import { withResponsiveProps } from '@revyme/runtime';

/** @name "Card" */
export const variantConfig = [
  { name: 'default', label: 'Default', x: 0, y: 0, isPrimary: true },
  { name: 'hover', label: 'Hover', x: 400, y: 0 },
];

function Card({ initialVariant = 'default', hasBorder = false, style }: { initialVariant?: string; hasBorder?: boolean; style?: React.CSSProperties }) {
  return (
    <div data-id="card-root" style={{
      width: '360px',
      border: hasBorder ? '1px solid red' : 'none',
      ...style
    }} />
  );
}

export default withResponsiveProps(Card);
`;
    const c = codes(code);
    expect(c).not.toContain('FORBIDDEN_INDIRECT_VARIANT_CHECK');
  });
});
