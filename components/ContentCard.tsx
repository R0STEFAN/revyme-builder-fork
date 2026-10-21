'use client';

/** @name "ContentCard" */
/** @propMeta {"monoLabel":{"type":"plainText"},"tagText":{"type":"plainText"},"title":{"type":"plainText"},"description":{"type":"plainText"}} */

import React from 'react';
import { motion } from 'framer-motion';
import { withResponsiveProps } from '@revyme/runtime';

export const variantConfig = [
  { name: 'default', label: 'Default', x: -347, y: -176, isPrimary: true },
  { name: 'inverted', label: 'Inverted Dark', x: 36, y: 186 },
  { name: 'compact', label: 'Compact', x: 379, y: 489 },
];

function ContentCard({
  style,
  monoLabel = "01 // SYSTEM",
  tagText = "AUTONOMOUS CORE",
  title = "ENTERPRISE COGNITION MATRIX",
  description = "Squeezed models operating at 0.9 line-height with zero runtime latency. Direct integration into existing ERP architectures.",
  initialVariant = 'default',
}: {
  style?: React.CSSProperties;
  monoLabel?: string;
  tagText?: string;
  title?: string;
  description?: string;
  initialVariant?: string;
}) {
  return (
    <div data-id="content-card-root" style={{ width: 'auto', height: 'auto', ...style }}>
      <motion.div
        data-id="content-card-box"
        whileHover={{ y: -8, scale: 1.02 }}
        transition={{ type: 'spring', stiffness: 300, damping: 24 }}
        style={{
          width: 'auto',
          height: 'auto',
          backgroundColor: initialVariant === 'inverted' ? 'var(--color-inverted-card-bg)' : 'var(--color-card-bg)',
          border: initialVariant === 'inverted' ? '1px solid var(--color-border)' : '1px solid var(--color-card-border)',
          borderRadius: '32px',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
          padding: '36px',
          position: 'relative',
          cursor: 'pointer',
        }}
      >
        <div
          data-id="card-meta-row"
          style={{
            height: 'auto',
            alignItems: 'center',
            display: 'flex',
            justifyContent: 'space-between',
            position: 'relative',
            width: '100%',
            order: '0',
            flex: '0 0 auto',
          }}
        >
          <span
            data-id="card-mono-label"
            style={{
              width: 'auto',
              height: 'auto',
              color: 'var(--color-text-light)',
              fontFamily: 'var(--font-mono)',
              fontSize: '12px',
              letterSpacing: '-0.03em',
              position: 'relative',
              textTransform: 'uppercase',
              order: '0',
              flex: '0 0 auto',
            }}
          >
            {monoLabel}
          </span>
          <span
            data-id="card-tag-pill"
            style={{
              width: 'auto',
              height: 'auto',
              backgroundColor: initialVariant === 'inverted' ? 'var(--color-surface-dark)' : 'var(--color-accent)',
              color: initialVariant === 'inverted' ? 'var(--color-accent)' : 'var(--color-accent-text)',
              borderRadius: '64px',
              fontFamily: 'var(--font-mono)',
              fontSize: '12px',
              padding: '4px 12px',
              position: 'relative',
              textTransform: 'uppercase',
              order: '1',
              flex: '0 0 auto',
            }}
          >
            {tagText}
          </span>
        </div>
        <h3
          data-id="card-title-text"
          style={{
            width: 'auto',
            height: 'auto',
            color: initialVariant === 'inverted' ? 'var(--color-paper-white)' : 'var(--color-text)',
            fontFamily: 'var(--font-display)',
            fontSize: '36px',
            fontWeight: '800',
            letterSpacing: '-0.02em',
            lineHeight: '0.95',
            position: 'relative',
            textTransform: 'uppercase',
            order: '1',
            flex: '0 0 auto',
          }}
        >
          {title}
        </h3>
        <p
          data-id="card-desc-text"
          style={{
            width: 'auto',
            height: 'auto',
            color: initialVariant === 'inverted' ? 'var(--color-text-light)' : 'var(--color-text-muted)',
            fontFamily: 'var(--font-body)',
            fontSize: '15px',
            lineHeight: '1.4',
            position: 'relative',
            order: '2',
            flex: '0 0 auto',
          }}
        >
          {description}
        </p>
      </motion.div>
    </div>
  );
}

export default withResponsiveProps(ContentCard);
