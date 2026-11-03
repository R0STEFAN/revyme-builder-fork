// gate-auto-data-id.test.ts — verify that gateTurnFiles automatically injects data-ids
// so agents can submit clean React code without manual data-id tracking.

import { describe, it, expect, beforeEach } from 'vitest';
import { gateTurnFiles } from './gate';
import { modifyProjectFile } from '@/code/project/modify-file';
import { projectFS, resetProjectFS } from '@/code/project/project-fs';

const PAGE_PATH = 'app/page.client.tsx';
const CLEAN_PAGE = `'use client';
import React from 'react';

/** @canvas { "viewports": [1440], "positions": {} } */

export default function Page() {
  return (
    <div data-id="root" data-name="Page" style={{ position: 'relative', width: '100%', height: 'auto', display: 'flex', flexDirection: 'column' }}>
      <p data-id="p1" style={{ position: 'relative' }}>Original</p>
    </div>
  );
}`;

describe('gateTurnFiles — auto-injection of missing data-ids', () => {
  beforeEach(() => {
    resetProjectFS();
    projectFS.writeFile(PAGE_PATH, CLEAN_PAGE);
  });

  it('accepts a page submitted WITHOUT data-id, auto-injecting root and child ids with 0 violations', () => {
    const rawCode = `'use client';
import React from 'react';

/** @canvas { "viewports": [1440], "positions": {} } */

export default function Page() {
  return (
    <div style={{ position: 'relative', width: '100%', height: 'auto', display: 'flex', flexDirection: 'column' }}>
      <section style={{ position: 'relative', display: 'flex', flexDirection: 'column', order: '0', flex: '0 0 auto' }}>
        <h1 style={{ position: 'relative', order: '0', flex: '0 0 auto' }}>Welcome</h1>
        <button onClick={() => {}} style={{ position: 'relative', order: '1', flex: '0 0 auto' }}>Get Started</button>
      </section>
    </div>
  );
}`;

    const { files, violations } = gateTurnFiles(
      [{ path: PAGE_PATH, kind: 'page', code: rawCode }],
      PAGE_PATH
    );

    // ZERO violations (MISSING_DATA_ID does NOT bounce!)
    expect(violations).toEqual([]);
    expect(files).toHaveLength(1);

    const resultingCode = files[0].code;
    // Outer div got data-id="root"
    expect(resultingCode).toContain('<div data-id="root" style');
    // section, h1, button got unique data-ids
    expect(resultingCode).toMatch(/<section data-id="section-[a-z0-9-]+"/);
    expect(resultingCode).toMatch(/<h1 data-id="text-[a-z0-9-]+"/);
    expect(resultingCode).toMatch(/<button data-id="btn-[a-z0-9-]+"/);
  });

  it('accepts a component submitted WITHOUT data-id, auto-injecting ids with 0 violations', () => {
    const componentPath = 'components/PricingCard.tsx';
    const rawComponent = `import React from 'react';
import { motion, LayoutGroup, MotionConfig } from 'framer-motion';
import { withResponsiveProps } from '@revyme/runtime';

/** @name "Pricing Card" */

const variantConfig = [
  { name: 'default', label: 'Default', x: 0, y: 0, isPrimary: true },
];

function PricingCard({ style }: { style?: React.CSSProperties }) {
  return (
    <LayoutGroup>
      <MotionConfig transition={{ duration: 0.3 }}>
        <motion.div layout style={{ display: 'flex', flexDirection: 'column', width: '320px', ...style }}>
          <motion.h3 layout style={{ position: 'relative', flex: '0 0 auto', order: '0', color: '#ffffff', fontSize: '18px' }}>Pro Plan</motion.h3>
          <motion.p layout style={{ position: 'relative', flex: '0 0 auto', order: '1', color: '#ffffff', fontSize: '40px' }}>$29/mo</motion.p>
        </motion.div>
      </MotionConfig>
    </LayoutGroup>
  );
}

export default withResponsiveProps(PricingCard);
`;

    const { files, violations } = gateTurnFiles(
      [{ path: componentPath, kind: 'component', code: rawComponent }],
      null
    );

    expect(violations).toEqual([]);
    expect(files).toHaveLength(1);

    const resultingCode = files[0].code;
    expect(resultingCode).toMatch(/<motion\.div data-id="[a-z0-9-]+"/);
    expect(resultingCode).toMatch(/<motion\.h3 data-id="text-[a-z0-9-]+"/);
    expect(resultingCode).toMatch(/<motion\.p data-id="text-[a-z0-9-]+"/);
  });

  it('modifyProjectFile automatically injects data-ids when saving a canvas page', () => {
    modifyProjectFile(PAGE_PATH, () => `'use client';
import React from 'react';

/** @canvas { "viewports": [1440], "positions": {} } */

export default function Page() {
  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <p style={{ position: 'relative' }}>New Text</p>
    </div>
  );
}`);

    const saved = projectFS.readFile(PAGE_PATH)!;
    expect(saved).toContain('<div data-id="root" style');
    expect(saved).toMatch(/<p data-id="text-[a-z0-9-]+"/);
  });
});
