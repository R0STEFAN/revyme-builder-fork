import { describe, it, expect } from 'vitest';
import { checkFile } from '../check-file';

describe('DUPLICATE_STYLE_PROPERTY', () => {
  it('flags duplicate keys in a JSX style object', () => {
    const code = `
      export default function Page() {
        return (
          <div data-id="root" style={{
            position: 'relative',
            width: '100%',
            borderBottom: '1px solid red',
            backgroundColor: 'blue',
            borderBottom: '2px solid green',
          }} />
        );
      }
    `;
    const violations = checkFile(code, { kind: 'page' });
    const dup = violations.find((v) => v.code === 'DUPLICATE_STYLE_PROPERTY');
    expect(dup).toBeDefined();
    expect(dup?.message).toContain('borderBottom');
  });

  it('passes style objects without duplicate keys', () => {
    const code = `
      export default function Page() {
        return (
          <div data-id="root" style={{
            position: 'relative',
            width: '100%',
            borderBottom: '1px solid red',
            backgroundColor: 'blue',
          }} />
        );
      }
    `;
    const violations = checkFile(code, { kind: 'page' });
    const dup = violations.find((v) => v.code === 'DUPLICATE_STYLE_PROPERTY');
    expect(dup).toBeUndefined();
  });
});

describe('BOX_SHADOW_INTERPOLATION', () => {
  it("flags boxShadow: 'none' in a variants object", () => {
    const code = `
      'use client';
      import React, { useState } from 'react';
      import { motion } from 'framer-motion';
      import { withResponsiveProps } from '@revyme/runtime';

      export const variantConfig = [
        { name: 'default', label: 'Default', x: 0, y: 0, isPrimary: true },
        { name: 'scrolled', label: 'Scrolled', x: 100, y: 0 },
      ];

      const cardVariants = {
        default: {
          boxShadow: 'none',
        },
        scrolled: {
          boxShadow: '0 12px 36px rgba(0, 0, 0, 0.45)',
        },
      };

      function Card({ initialVariant = 'default' }: { initialVariant?: string }) {
        const [variant, setVariant] = useState(initialVariant);
        return (
          <motion.div
            data-id="card-root"
            variants={cardVariants}
            initial={initialVariant}
            animate={variant}
            style={{ position: 'absolute', width: '100px', height: '100px', boxShadow: 'none' }}
          />
        );
      }

      export default withResponsiveProps(Card);
    `;
    const violations = checkFile(code, { kind: 'component' });
    const hit = violations.find((v) => v.code === 'BOX_SHADOW_INTERPOLATION');
    expect(hit).toBeDefined();
    expect(hit?.message).toContain('cardVariants.default.boxShadow is set to \'none\'');
  });

  it("passes when numeric zero shadow '0 0 0 rgba(0, 0, 0, 0)' is used", () => {
    const code = `
      'use client';
      import React, { useState } from 'react';
      import { motion } from 'framer-motion';
      import { withResponsiveProps } from '@revyme/runtime';

      export const variantConfig = [
        { name: 'default', label: 'Default', x: 0, y: 0, isPrimary: true },
        { name: 'scrolled', label: 'Scrolled', x: 100, y: 0 },
      ];

      const cardVariants = {
        default: {
          boxShadow: '0 0 0 rgba(0, 0, 0, 0)',
        },
        scrolled: {
          boxShadow: '0 12px 36px rgba(0, 0, 0, 0.45)',
        },
      };

      function Card({ initialVariant = 'default' }: { initialVariant?: string }) {
        const [variant, setVariant] = useState(initialVariant);
        return (
          <motion.div
            data-id="card-root"
            variants={cardVariants}
            initial={initialVariant}
            animate={variant}
            style={{ position: 'absolute', width: '100px', height: '100px', boxShadow: '0 0 0 rgba(0, 0, 0, 0)' }}
          />
        );
      }

      export default withResponsiveProps(Card);
    `;
    const violations = checkFile(code, { kind: 'component' });
    const hit = violations.find((v) => v.code === 'BOX_SHADOW_INTERPOLATION');
    expect(hit).toBeUndefined();
  });
});
