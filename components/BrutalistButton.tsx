'use client';

/** @name "BrutalistButton" */
/** @propMeta {"label":{"type":"plainText"}} */

import React from 'react';
import { motion } from 'framer-motion';
import { withResponsiveProps } from '@revyme/runtime';

export const variantConfig = [
  { name: 'default', label: 'Default', x: 0, y: 0, isPrimary: true },
  { name: 'ghost', label: 'Ghost Border', x: 100, y: 0 },
  { name: 'mint', label: 'Mint Chip', x: 200, y: 0 },
];

function BrutalistButton({
  style,
  label = "SCHEDULE A DEMO",
  initialVariant = 'default',
}: {
  style?: React.CSSProperties;
  label?: string;
  initialVariant?: string;
}) {
  return (
    <div data-id="brutalist-button-root" style={{ width: 'auto', height: 'auto', ...style }}>
      <motion.div
        data-id="button-container"
        whileHover={{ scale: 1.04, y: -2 }}
        whileTap={{ scale: 0.96 }}
        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        style={{
          width: 'auto',
          height: 'auto',
          alignItems: 'center',
          backgroundColor:
            initialVariant === 'ghost'
              ? 'rgba(0, 0, 0, 0)'
              : initialVariant === 'mint'
              ? 'var(--color-accent)'
              : 'var(--color-text)',
          border: initialVariant === 'ghost' ? '1.5px solid var(--color-border)' : 'none',
          borderRadius: initialVariant === 'ghost' ? '4px' : '8px',
          cursor: 'pointer',
          display: 'inline-flex',
          justifyContent: 'center',
          padding: initialVariant === 'ghost' ? '14px 24px' : '16px 28px',
          position: 'relative',
        }}
      >
        <span
          data-id="button-label"
          style={{
            width: 'auto',
            height: 'auto',
            color:
              initialVariant === 'ghost'
                ? 'var(--color-text-muted)'
                : initialVariant === 'mint'
                ? 'var(--color-accent-text)'
                : 'var(--color-surface)',
            fontFamily: 'var(--font-body)',
            fontSize: '15px',
            fontWeight: '600',
            letterSpacing: '0.02em',
            position: 'relative',
            textTransform: 'uppercase',
            order: '0',
            flex: '0 0 auto',
          }}
        >
          {label}
        </span>
      </motion.div>
    </div>
  );
}

export default withResponsiveProps(BrutalistButton);
