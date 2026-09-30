// local-export.spec.ts — the standalone (VITE_REVYME_CLOUD=false) editor
// exports a runnable Next.js project with no backend: the zip is built in the
// browser. The e2e server on :4333 runs in local mode, which is this case.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

const SERVER = `import PageClient from './page.client';\n\nexport const metadata = {};\n\nexport default function Page() {\n  return <PageClient />;\n}\n`;
const HOME = `/** @canvas { "viewports": [{"id":"desktop","label":"Desktop","width":1200,"isPrimary":true,"order":0}], "positions": {"desktop":{"x":0,"y":0}} } */
'use client';
export default function Page() {
  return <div data-id="root" data-name="Page" style={{ position: 'relative', width: '100%', minHeight: '400px' }}><h1 data-id="t" style={{ position: 'relative' }}>Exported home</h1></div>;
}
`;

function unzip(buf: Buffer): Map<string, string> {
  const out = new Map<string, string>();
  const eocd = buf.length - 22;
  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(at + 10);
    const csize = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.subarray(at + 46, at + 46 + nameLen).toString('utf8');
    const lnameLen = buf.readUInt16LE(local + 26);
    const data = buf.subarray(local + 30 + lnameLen, local + 30 + lnameLen + csize);
    out.set(name, (method === 8 ? inflateRawSync(data) : data).toString('utf8'));
    at += 46 + nameLen;
  }
  return out;
}

test('standalone: Export → Source code builds the Next.js zip in the browser', async ({ page }) => {
  await page.addInitScript((files) => {
    window.localStorage.setItem('revyme-project-local', JSON.stringify({ format: 'revyme-v1', files }));
    window.localStorage.setItem('revyme-onboarding-completed', 'true');
  }, { 'app/page.tsx': SERVER, 'app/page.client.tsx': HOME });
  await page.goto('/');
  await page.frameLocator('iframe[src*="5174"]').locator('[data-content-root]').first().waitFor({ state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => !document.querySelector('div[style*="z-index: 100000"]'), null, { timeout: 30_000 });

  const exportBtn = page.locator('[data-export-trigger]');
  await expect(exportBtn).toBeEnabled();
  await exportBtn.click();
  // Only what the browser can build is offered.
  await expect(page.getByText('Source code', { exact: true })).toBeVisible();
  await expect(page.getByText('Vite project', { exact: true })).toHaveCount(0);
  await expect(page.getByText('HTML + CSS', { exact: true })).toHaveCount(0);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export project' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.zip$/);
  const files = unzip(readFileSync(await download.path() as string));
  expect(files.get('app/page.client.tsx')).toContain('Exported home');
  expect(files.has('app/page.tsx')).toBe(true);
  for (const f of ['package.json', 'next.config.mjs', 'tsconfig.json', 'README.md', '.gitignore']) expect(files.has(f)).toBe(true);
  expect([...files.keys()].some((p) => p.startsWith('_'))).toBe(false);
  const pkg = JSON.parse(files.get('package.json') as string);
  expect(pkg.scripts.dev).toBe('next dev');
  expect(pkg.dependencies['@revyme/runtime']).toMatch(/^\^?\d/);   // the editor's own range, not 'latest'
});
