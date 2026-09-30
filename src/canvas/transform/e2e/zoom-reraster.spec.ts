// zoom-reraster.spec.ts — after a zoom settles, content that promotes ITSELF
// (a component instance whose master root carries the perf-isolation
// `will-change: transform`, a Marquee track) is dropped to `will-change: auto`
// for two frames and restored, so Chrome re-rasterizes it at the new zoom —
// text inside component instances stayed blurry while plain text sharpened.
//
// The re-raster used to run in the EDITOR document, where the canvas content
// does not live (it is in the sandbox iframe), so it never reached them. This
// watches the toggle happen where the elements are. (Automated screenshots
// re-raster on capture — even a layer Chrome documents as blurry comes out
// crisp — so the blur itself cannot be measured here.)

import { test, expect, type Page } from '@playwright/test';

const SERVER = `import PageClient from './page.client';\n\nexport const metadata = {};\n\nexport default function Page() {\n  return <PageClient />;\n}\n`;
const PAGE = `/** @canvas { "viewports": [{"id":"desktop","label":"Desktop","width":1200,"isPrimary":true,"order":0}], "positions": {"desktop":{"x":0,"y":0}} } */
'use client';
export default function Page() {
  return (
    <div data-id="root" data-name="Page" style={{ position: 'relative', width: '100%', minHeight: '600px', background: '#ffffff' }}>
      <div data-id="inst" style={{ position: 'relative', contain: 'layout paint', willChange: 'transform' }}>
        <h1 data-id="inner" style={{ position: 'relative', margin: '0', fontSize: '40px' }}>NEON PRIME</h1>
      </div>
    </div>
  );
}
`;

async function open(page: Page) {
  await page.addInitScript((files) => {
    window.localStorage.setItem('revyme-project-local', JSON.stringify({ format: 'revyme-v1', files }));
    window.localStorage.setItem('revyme-onboarding-completed', 'true');
  }, { 'app/page.tsx': SERVER, 'app/page.client.tsx': PAGE });
  await page.goto('/');
  await page.frameLocator('iframe[src*="5174"]').locator('[data-id="inner"]').first().waitFor({ state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => !document.querySelector('div[style*="z-index: 100000"]'), null, { timeout: 30_000 });
  await page.waitForTimeout(800);
}

/** Record every will-change value the instance root takes, inside the iframe. */
async function watch(page: Page) {
  const frame = page.frames().find((f) => f.url().includes('5174'))!;
  await frame.evaluate(() => {
    const el = document.querySelector<HTMLElement>('[data-id="inst"]')!;
    const w = window as unknown as { __wc: string[] };
    w.__wc = [];
    new MutationObserver(() => { w.__wc.push(el.style.willChange); }).observe(el, { attributes: true, attributeFilter: ['style'] });
  });
  return () => frame.evaluate(() => (window as unknown as { __wc: string[] }).__wc);
}

test('a zoom settle re-rasters a self-promoted instance inside the canvas iframe', async ({ page }) => {
  await open(page);
  const seen = await watch(page);
  for (let i = 0; i < 4; i++) await page.keyboard.press('Control+=');
  await page.waitForTimeout(900);   // gesture idle (250ms) + two frames
  const values = await seen();
  expect(values).toContain('auto');                    // released…
  expect(values[values.length - 1]).toBe('transform'); // …and promoted again
});

test('a pan (no zoom change) leaves it alone', async ({ page }) => {
  await open(page);
  // Settle the zoom the load may have applied, then watch a pure pan.
  await page.waitForTimeout(600);
  const seen = await watch(page);
  const canvas = page.locator('iframe[src*="5174"]').first();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(900);
  expect(await seen()).not.toContain('auto');
});
