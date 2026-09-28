import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto('https://endless-example-741097.framer.app/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await p.waitForTimeout(6000);
console.log(JSON.stringify(await p.evaluate(() => {
  const img = [...document.querySelectorAll('img')].find(e => (e.src||'').includes('5C7sBe8PJy'));
  if (!img) return { note: 'not found' };
  const out = []; let n = img;
  for (let i = 0; i < 11 && n; i++) {
    const cs = getComputedStyle(n); const r = n.getBoundingClientRect();
    out.push({ tag: n.tagName, w: Math.round(r.width), h: Math.round(r.height),
      cssH: cs.height, pos: cs.position, objFit: cs.objectFit, overflow: cs.overflow });
    n = n.parentElement;
  }
  return out;
}), null, 1));
await b.close();
