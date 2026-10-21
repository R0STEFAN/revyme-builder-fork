'use client';

/** @name "NavPill" */
/** @propMeta {"brandName":{"type":"plainText"},"link1":{"type":"plainText"},"link2":{"type":"plainText"},"link3":{"type":"plainText"},"ctaText":{"type":"plainText"}} */

import React from 'react';
import { motion } from 'framer-motion';
import { withResponsiveProps } from '@revyme/runtime';

export const variantConfig = [
  { name: 'default', label: 'Default', x: 0, y: 0, isPrimary: true },
  { name: 'inverted', label: 'Inverted Dark', x: 100, y: 0 },
  { name: 'compact', label: 'Compact', x: 200, y: 0 },
];

function NavPill({
  style,
  brandName = "DAYOS",
  link1 = "PLATFORM",
  link2 = "SOLUTIONS",
  link3 = "MANIFESTO",
  ctaText = "SCHEDULE DEMO",
  initialVariant = 'default',
}: {
  style?: React.CSSProperties;
  brandName?: string;
  link1?: string;
  link2?: string;
  link3?: string;
  ctaText?: string;
  initialVariant?: string;
}) {
  return (
    <div data-id="nav-pill-root" style={{ width: 'auto', height: 'auto', ...style }}>
      <motion.div
        data-id="nav-pill-wrapper"
        whileHover={{ y: -2 }}
        transition={{ type: 'spring', stiffness: 350, damping: 25 }}
        style={{
          width: 'auto',
          height: 'auto',
          alignItems: 'center',
          backgroundColor: initialVariant === 'inverted' ? 'var(--color-surface-dark)' : 'var(--color-surface)',
          border: initialVariant === 'inverted' ? '1px solid var(--color-border)' : 'none',
          borderRadius: '48px',
          boxSizing: 'border-box',
          display: 'flex',
          gap: '28px',
          justifyContent: 'space-between',
          padding: '8px 12px 8px 24px',
          position: 'relative',
        }}
      >
        <div
          data-id="nav-brand-box"
          style={{
            width: 'auto',
            height: 'auto',
            alignItems: 'center',
            display: 'flex',
            gap: '8px',
            position: 'relative',
            order: '0',
            flex: '0 0 auto',
          }}
        >
          <span
            data-id="nav-brand-text"
            style={{
              width: 'auto',
              height: 'auto',
              color: initialVariant === 'inverted' ? 'var(--color-paper-white)' : 'var(--color-text)',
              fontFamily: 'var(--font-display)',
              fontSize: '24px',
              fontWeight: '800',
              letterSpacing: '-0.02em',
              position: 'relative',
              order: '0',
              flex: '0 0 auto',
            }}
          >
            {brandName}
          </span>
        </div>
        <div
          data-id="nav-links-box"
          style={{
            width: 'auto',
            height: 'auto',
            alignItems: 'center',
            display: 'flex',
            gap: '24px',
            position: 'relative',
            order: '1',
            flex: '0 0 auto',
          }}
        >
          <motion.span
            data-id="nav-link-1"
            whileHover={{ y: -2, color: 'var(--color-text)' }}
            transition={{ type: 'spring', stiffness: 400, damping: 20 }}
            style={{
              width: 'auto',
              height: 'auto',
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
              fontFamily: 'var(--font-body)',
              fontSize: '14px',
              fontWeight: '500',
              letterSpacing: '-0.01em',
              position: 'relative',
              textTransform: 'uppercase',
              order: '0',
              flex: '0 0 auto',
            }}
          >
            {link1}
          </motion.span>
          <motion.span
            data-id="nav-link-2"
            whileHover={{ y: -2, color: 'var(--color-text)' }}
            transition={{ type: 'spring', stiffness: 400, damping: 20 }}
            style={{
              width: 'auto',
              height: 'auto',
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
              fontFamily: 'var(--font-body)',
              fontSize: '14px',
              fontWeight: '500',
              letterSpacing: '-0.01em',
              position: 'relative',
              textTransform: 'uppercase',
              order: '1',
              flex: '0 0 auto',
            }}
          >
            {link2}
          </motion.span>
          <motion.span
            data-id="nav-link-3"
            whileHover={{ y: -2, color: 'var(--color-text)' }}
            transition={{ type: 'spring', stiffness: 400, damping: 20 }}
            style={{
              width: 'auto',
              height: 'auto',
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
              fontFamily: 'var(--font-body)',
              fontSize: '14px',
              fontWeight: '500',
              letterSpacing: '-0.01em',
              position: 'relative',
              textTransform: 'uppercase',
              order: '2',
              flex: '0 0 auto',
            }}
          >
            {link3}
          </motion.span>
        </div>
        <motion.div
          data-id="nav-cta-btn"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
          style={{
            width: 'auto',
            height: 'auto',
            alignItems: 'center',
            backgroundColor: initialVariant === 'inverted' ? 'var(--color-accent)' : 'var(--color-text)',
            borderRadius: '32px',
            cursor: 'pointer',
            display: 'inline-flex',
            justifyContent: 'center',
            padding: '10px 20px',
            position: 'relative',
            order: '2',
            flex: '0 0 auto',
          }}
        >
          <span
            data-id="nav-cta-text"
            style={{
              width: 'auto',
              height: 'auto',
              color: initialVariant === 'inverted' ? 'var(--color-accent-text)' : 'var(--color-surface)',
              fontFamily: 'var(--font-body)',
              fontSize: '13px',
              fontWeight: '600',
              letterSpacing: '0.02em',
              position: 'relative',
              textTransform: 'uppercase',
              order: '0',
              flex: '0 0 auto',
            }}
          >
            {ctaText}
          </span>
        </motion.div>
      </motion.div>
    </div>
  );
}

export default withResponsiveProps(NavPill);
