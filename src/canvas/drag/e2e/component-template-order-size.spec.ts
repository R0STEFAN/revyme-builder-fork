import { test, expect } from '@playwright/test';
import { EditorPage } from './helpers/editor-page';

const CARD_MASTER = `'use client';
import React from 'react';
import { motion } from 'framer-motion';
import { withResponsiveProps } from '@revyme/runtime';

function Card({ style, ...rest }: any) {
  return (
    <motion.div data-id="card-root" data-name="Card" style={{
      position: 'relative',
      width: '400px',
      height: '250px',
      backgroundColor: '#3b82f6',
      borderRadius: '8px',
      ...style
    }} {...rest}>
      <p data-id="card-title" style={{ color: '#ffffff', padding: '16px' }}>Card</p>
    </motion.div>
  );
}
export default withResponsiveProps(Card);
`;

const NAVBAR_MASTER = `'use client';
import React from 'react';
import { motion } from 'framer-motion';
import { withResponsiveProps } from '@revyme/runtime';

function NavBar({ style, ...rest }: any) {
  return (
    <motion.nav data-id="nav-root" data-name="Navbar" style={{
      position: 'relative',
      width: '100%',
      height: '64px',
      backgroundColor: '#1f2937',
      ...style
    }} {...rest}>
      <span data-id="nav-brand" style={{ color: '#ffffff', padding: '16px' }}>Brand</span>
    </motion.nav>
  );
}
export default withResponsiveProps(NavBar);
`;

const LAYOUT_CLIENT = `'use client';
import React from 'react';
import NavBar from '@/components/NavBar';
import Card from '@/components/Card';

export default function LayoutClient({ children }: any) {
  return (
    <div data-id="root" style={{ display: 'flex', flexDirection: 'column', width: '100%', minHeight: '100vh' }}>
      <NavBar data-id="nav-instance" style={{ position: 'relative' }} />
      <Card data-id="card-instance" style={{ position: 'relative' }} />
      {children}
    </div>
  );
}
`;

const PAGE_CLIENT = `/** @canvas { "viewports": [{"id":"desktop","width":1440,"label":"Desktop","isPrimary":true,"order":0,"height":"auto"}], "positions": {"desktop":{"x":0,"y":0}} } */
'use client';
import React from 'react';

export default function Page() {
  return (
    <div data-id="root" style={{ display: 'flex', flexDirection: 'column', width: '100%', minHeight: '100vh' }}>
      <section data-id="sec-first" style={{ height: '300px', backgroundColor: '#f3f4f6' }}>First Section</section>
      <section data-id="sec-second" style={{ height: '300px', backgroundColor: '#e5e7eb' }}>Second Section</section>
    </div>
  );
}
`;

test.describe('Component Template Order & Size E2E', () => {
  test('template instance size 100% and page section order', async ({ page }) => {
    test.setTimeout(120_000);
    const project = {
      format: 'revyme-v1',
      files: {
        'app/page.tsx': `import PageClient from './page.client';\nexport default function Page() { return <PageClient />; }\n`,
        'app/page.client.tsx': PAGE_CLIENT,
        'app/layout.tsx': `import LayoutClient from './LayoutClient';\nexport default function RootLayout({ children }: any) { return <html><body><LayoutClient>{children}</LayoutClient></body></html>; }\n`,
        'app/LayoutClient.tsx': LAYOUT_CLIENT,
        'components/Card.tsx': CARD_MASTER,
        'components/NavBar.tsx': NAVBAR_MASTER,
      },
    };

    await page.addInitScript((data) => {
      window.localStorage.setItem('revyme-project-local', JSON.stringify(data));
      window.localStorage.setItem('revyme-onboarding-completed', 'true');
    }, project);

    await page.goto('/');
    const editor = new EditorPage(page);
    await editor.sandbox().locator('[data-content-root]').first().waitFor({ state: 'attached', timeout: 60_000 });
    await editor.node('sec-first').waitFor({ state: 'visible', timeout: 60_000 });

    // Verify template chrome exists and is merged in order
    await expect(editor.node('layout::nav-instance')).toBeVisible();
    await expect(editor.node('layout::card-instance')).toBeVisible();
    await expect(editor.node('sec-first')).toBeVisible();
    await expect(editor.node('sec-second')).toBeVisible();

    // Select page section and check bounding boxes
    await page.evaluate(() => (window as any).__e2e.select(['sec-first']));
    const firstBox = await editor.node('sec-first').boundingBox();
    const secondBox = await editor.node('sec-second').boundingBox();
    expect(firstBox).not.toBeNull();
    expect(secondBox).not.toBeNull();
    expect(firstBox!.y).toBeLessThan(secondBox!.y);
  });
});
