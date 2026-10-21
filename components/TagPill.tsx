'use client';

/** @name "TagPill" */
/** @propMeta {"text":{"type":"plainText"}} */

import React from 'react';
import { motion } from 'framer-motion';
import { withResponsiveProps } from '@revyme/runtime';

export const variantConfig = [
  { name: 'default', label: 'Default', x: 0, y: 0, isPrimary: true },
  { name: 'voltage', label: 'Voltage Yellow', x: 100, y: 0 },
  { name: 'dark', label: 'Graphite Dark', x: 200, y: 0 },
];

function TagPill({
  style,
  text = "SPEC // 01",
  initialVariant = 'default',
}: {
  style?: React.CSSProperties;
  text?: string;
  initialVariant?: string;
}) {
  return (
    <div data-id="tag-pill-root" style={{ width: 'auto', height: 'auto', ...style }}>
      <motion.div
        data-id="tag-pill-badge"
        whileHover={{ scale: 1.05 }}
        transition={{ type: 'spring', stiffness: 400, damping: 20 }}
        style={{
          width: 'auto',
          height: 'auto',
          alignItems: 'center',
          backgroundColor:
            initialVariant === 'voltage'
              ? 'var(--color-highlight)'
              : initialVariant === 'dark'
              ? 'var(--color-surface-dark)'
              : 'var(--color-accent)',
          borderRadius: '64px',
          display: 'inline-flex',
          justifyContent: 'center',
          padding: '6px 16px',
          position: 'relative',
          cursor: 'default',
        }}
      >
        <span
          data-id="tag-pill-text"
          style={{
            width: 'auto',
            height: 'auto',
            color:
              initialVariant === 'dark' ? 'var(--color-paper-white)' : 'var(--color-accent-text)',
            fontFamily: 'var(--font-mono)',
            fontSize: '12px',
            fontWeight: '500',
            letterSpacing: '-0.03em',
            position: 'relative',
            textTransform: 'uppercase',
            order: '0',
            flex: '0 0 auto',
          }}
        >
          {text}
        </span>
      </motion.div>
    </div>
  );
}

export default withResponsiveProps(TagPill);
