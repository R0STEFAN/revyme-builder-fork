'use client';

/** @name "UnderlineLink" */
/** @propMeta {"label":{"type":"plainText"},"href":{"type":"plainText"}} */

import React from 'react';
import { withResponsiveProps } from '@revyme/runtime';

export const variantConfig = [
  { name: 'default', label: 'Regular', x: 0, y: 0, isPrimary: true },
  { name: 'large', label: 'Large', x: 0, y: 300 },
];

function UnderlineLink({
  style,
  label = 'Underline Link',
  href = '#',
  initialVariant = 'default',
}: {
  style?: React.CSSProperties;
  label?: string;
  href?: string;
  initialVariant?: string;
}) {
  return (
    <div
      data-id="underline-root"
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        justifyContent: 'flex-start',
        gap: '4px',
        width: 'auto',
        height: 'auto',
        cursor: 'pointer',
        ...style,
      }}
    >
      <p
        data-id="underline-label"
        style={{
          order: '0',
          flex: '0 0 auto',
          fontFamily: '"Zalando Sans", -apple-system, BlinkMacSystemFont, sans-serif',
          fontSize: initialVariant === 'large' ? '28px' : '20px',
          fontWeight: '500',
          lineHeight: '1.4',
          letterSpacing: '-0.02em',
          color: '#000000',
          margin: '0',
          position: 'relative',
        }}
      >
        {label}
      </p>
      <div
        data-id="underline-bar"
        style={{
          order: '1',
          flex: '0 0 auto',
          width: '100%',
          height: '1px',
          backgroundColor: '#000000',
          position: 'relative',
        }}
      />
    </div>
  );
}

export default withResponsiveProps(UnderlineLink);
