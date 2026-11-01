'use client';

/** @name "Logo" */
/** @propMeta {"text":{"type":"plainText"}} */

import React from 'react';
import { withResponsiveProps } from '@revyme/runtime';

export const variantConfig = [
  { name: 'default', label: 'Fit Text Variant', x: 0, y: 0, isPrimary: true },
  { name: 'navbar', label: 'Last Name Variant', x: 0, y: 400 },
];

function Logo({
  style,
  text = 'WALKER',
  initialVariant = 'default',
}: {
  style?: React.CSSProperties;
  text?: string;
  initialVariant?: string;
}) {
  return (
    <div
      data-id="logo-root"
      style={{
        width: 'auto',
        height: 'auto',
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-start',
        ...style,
      }}
    >
      <h1
        data-id="logo-text"
        style={{
          fontFamily: '"Zalando Sans", -apple-system, BlinkMacSystemFont, sans-serif',
          fontSize: initialVariant === 'navbar' ? '20px' : 'clamp(80px, 18.5vw, 279px)',
          fontWeight: '800',
          lineHeight: initialVariant === 'navbar' ? '1.2' : '0.8',
          letterSpacing: initialVariant === 'navbar' ? '-0.02em' : '-0.06em',
          textTransform: 'uppercase',
          color: '#000000',
          margin: '0',
          width: 'auto',
          position: 'relative',
        }}
      >
        {text}
      </h1>
    </div>
  );
}

export default withResponsiveProps(Logo);
