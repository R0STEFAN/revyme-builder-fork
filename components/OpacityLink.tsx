'use client';

/** @name "OpacityLink" */
/** @propMeta {"label":{"type":"plainText"},"href":{"type":"plainText"}} */

import React from 'react';
import { withResponsiveProps } from '@revyme/runtime';

export const variantConfig = [
  { name: 'default', label: 'Default', x: 0, y: 0, isPrimary: true },
];

function OpacityLink({
  style,
  label = 'Link',
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
      data-id="opacity-link-root"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'flex-start',
        width: 'auto',
        height: 'auto',
        cursor: 'pointer',
        ...style,
      }}
    >
      <p
        data-id="opacity-link-label"
        style={{
          fontFamily: '"Zalando Sans", -apple-system, BlinkMacSystemFont, sans-serif',
          fontSize: '15px',
          fontWeight: '400',
          lineHeight: '1.5',
          color: '#555555',
          margin: '0',
          position: 'relative',
        }}
      >
        {label}
      </p>
    </div>
  );
}

export default withResponsiveProps(OpacityLink);
