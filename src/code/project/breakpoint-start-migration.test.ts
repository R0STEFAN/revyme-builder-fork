import { describe, it, expect, vi, afterEach } from 'vitest';
vi.mock('@/shared/debug-trace', () => ({ trace: { action: vi.fn(), fn: vi.fn(), error: vi.fn(), dom: vi.fn(), state: vi.fn() } }));
import { migrateFileToStartBreakpoints, ladderFromStarts } from './breakpoint-start-migration';
import { parseCanvasConfig } from './canvas-config';
import { getViewportWidths, syncViewportWidths } from '@/code/stores/viewport-store';
import { renderWidth } from '@/shared/types';
import {
  resolveAll, diffResolutions, staleKeyHits, cssAt, responsiveAt, overlayAt, openVariantAt,
  templateRouteAt, listConfigAt, queriesAt, responsiveTextAt,
} from './breakpoint-proof';

// ─── Fixtures ────────────────────────────────────────────────────────────────────────────────
type Vp = { id: string; width: number; primary?: boolean; designWidth?: number };
const canvasBlock = (vps: Vp[]) => `/** @canvas {
  "viewports": [
${vps.map((v, i) => `    { "id": "${v.id}", "label": "${v.id}", "width": ${v.width}${v.designWidth ? `, "designWidth": ${v.designWidth}` : ''}, "isPrimary": ${!!v.primary}, "order": ${i} }`).join(',\n')}
  ],
  "positions": { ${vps.map((v, i) => `"${v.id}": { "x": ${i * 1600}, "y": 0 }`).join(', ')} }
} */`;

const LADDER4: Vp[] = [
  { id: 'desktop', width: 1440, primary: true },
  { id: 'laptop', width: 1200 },
  { id: 'tablet', width: 768 },
  { id: 'mobile', width: 375 },
];

/** A page carrying EVERY width-keyed shape the builder writes. */
const PAGE = `${canvasBlock(LADDER4)}
'use client';
import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SplitText } from '@revyme/runtime';
import Card from '@/components/Card';

function useMediaQuery(query) {
  const [m, setM] = useState(false);
  useEffect(() => { const q = window.matchMedia(query); setM(q.matches); }, [query]);
  return m;
}
function useResponsiveText(primary, overrides, vpWidths) { return primary; }
function useResponsiveListConfig(base, vpOverrides, vpWidths, variant, variantOverrides) { return base; }

export default function Page() {
  const __mq0 = useMediaQuery('(max-width: 768px) and (min-width: 375.02px)');
  const __mq1 = useMediaQuery('(max-width: 375px)');
  const [menuOpen, setMenuOpen] = useState(false);
  const listCfgL1 = useResponsiveListConfig({"limit":6}, {"1200":{"limit":5},"768":{"limit":4},"375":{"limit":2}}, [375,768,1200,1440], undefined, {});
  return <div data-id="root">
    <style>{\`
    @media (max-width: 1200px) and (min-width: 768.02px) {
      [data-id="a"] { color: blue !important; }
    }
    @media (max-width: 768px) and (min-width: 375.02px) {
      [data-id="a"] { color: green !important; }
      :lang(fr) [data-id="a"] { letter-spacing: 2px !important; }
    }
    @media (max-width: 375px) {
      [data-id="a"] { color: red !important; }
    }
    @media (max-width: 768px) {
      [data-id="b"] { padding: 4px !important; }
    }
  \`}</style>
    <h1 data-id="a" style={{ opacity: __mq1 ? 0.5 : __mq0 ? 0.8 : 1 }}>{useResponsiveText("Hello", {1200: "Hi laptop", 768: "Hi tablet", 375: "Hi phone"}, [1440, 1200, 768, 375])}</h1>
    <p data-id="b">Body</p>
    <Card data-id="c1" data-responsive='{"1200":{"initialVariant":"l"},"768":{"initialVariant":"t"},"375":{"initialVariant":"m"},"_bp":[375,768,1200,1440]}' data-scroll-variant='{"trigger":"onScroll","from":"default","to":"end","responsive":[{"scope":{"query":"(max-width: 768px)"},"from":"t"},{"scope":{"query":"(max-width: 375px)"},"from":"m"}]}' />
    <SplitText data-id="st" spec={{ type: "words", responsive: [{ scope: { query: "(max-width: 768px) and (min-width: 375.02px)" }, stagger: 0.1 }] }}>Split me</SplitText>
    <button data-id="trig" onClick={() => setMenuOpen(!menuOpen)}>Menu</button>
    <Card data-id="c2" initialVariant={menuOpen ? (window.innerWidth <= 375 ? 'mob' : window.innerWidth <= 768 ? 'open' : 'open') : 'closed'} />
    <AnimatePresence>{menuOpen && (
      <motion.div key="ov" data-id="ov" data-name="Overlay" data-overlay='{"triggerId":"trig","side":"bottom","onOpenVariant":"open","responsive":{"768":{"side":"top"},"375":{"side":"left","onOpenVariant":"mob"}},"responsiveBp":[375,768,1200,1440]}'>Menu</motion.div>
    )}</AnimatePresence>
  </div>;
}
`;

const TEMPLATE_LADDER: Vp[] = [
  { id: 'desktop', width: 1440, primary: true },
  { id: 'tablet', width: 768 },
  { id: 'mobile', width: 375 },
];

/** A template LayoutClient: its own ladder, bands, instance data-responsive and per-breakpoint
 *  route values (`name@W`) resolved through `__mq` gates. */
const layoutClient = (vps: Vp[]) => `${canvasBlock(vps)}
'use client';
import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Nav from '@/components/Nav';

function useMediaQuery(query) {
  const [m, setM] = useState(false);
  useEffect(() => { const q = window.matchMedia(query); setM(q.matches); }, [query]);
  return m;
}
const __templateProps = {"/":{"headerVariant":"home","headerVariant@768":"home-t","headerVariant@375":"home-m"},"/blog":{"headerVariant":"blog","headerVariant@375":"blog-m"}};
const __matchTemplateRoute = (__p) => __templateProps[__p] ?? {};
export default function LayoutClient({ children, headerVariant = "default" }) {
  const __mq0 = useMediaQuery('(max-width: 768px)');
  const __mq1 = useMediaQuery('(max-width: 375px)');
  const __tp = __matchTemplateRoute(usePathname());
  headerVariant = (__mq1 ? __tp['headerVariant@375'] : __mq0 ? __tp['headerVariant@768'] : undefined) ?? __tp.headerVariant ?? headerVariant;
  return <div data-id="lroot">
    <style>{\`
    @media (max-width: 768px) and (min-width: 375.02px) {
      [data-id="nav"] { order: -1 !important; }
    }
    @media (max-width: 375px) {
      [data-id="nav"] { display: none !important; }
    }
  \`}</style>
    <Nav data-id="nav" initialVariant={headerVariant} data-responsive='{"375":{"initialVariant":"mobile"},"768":{"initialVariant":"tablet"},"_bp":[375,768,1440]}' />
    {children}
  </div>;
}
`;

/** Every breakpoint's tile must resolve EXACTLY what it did before (drawn at the same width). */
function expectTilesUnchanged(before: string, after: string) {
  const oldCfg = parseCanvasConfig(before)!;
  const newCfg = parseCanvasConfig(after)!;
  for (const vp of oldCfg.viewports) {
    const nv = newCfg.viewports.find((v) => v.id === vp.id)!;
    expect(renderWidth(nv), `${vp.id} tile width`).toBe(renderWidth(vp));
    const diff = diffResolutions(resolveAll(before, renderWidth(vp)), resolveAll(after, renderWidth(nv)));
    expect(diff, `${vp.id} @${renderWidth(vp)}px`).toEqual([]);
  }
}

afterEach(() => { syncViewportWidths({}); });

// ─── The rule ────────────────────────────────────────────────────────────────────────────────
describe('ladderFromStarts', () => {
  it('ends each breakpoint one pixel before the next-larger start; the primary is open', () => {
    expect(ladderFromStarts([
      { id: 'm', start: 375 }, { id: 'd', start: 1440, isPrimary: true }, { id: 'l', start: 1200 }, { id: 't', start: 768 },
    ])).toEqual([
      { id: 'd', start: 1440, end: null },
      { id: 'l', start: 1200, end: 1439 },
      { id: 't', start: 768, end: 1199 },
      { id: 'm', start: 375, end: 767 },
    ]);
  });

  it('a breakpoint wider than the primary gets the open top; same widths share a range', () => {
    expect(ladderFromStarts([
      { id: 'd', start: 1440, isPrimary: true }, { id: 'hd', start: 1920 }, { id: 'a', start: 768 }, { id: 'b', start: 768 },
    ])).toEqual([
      { id: 'hd', start: 1920, end: 100000 },
      { id: 'd', start: 1440, end: 1919 },
      { id: 'a', start: 768, end: 1439 },
      { id: 'b', start: 768, end: 1439 },
    ]);
  });
});

// ─── One page, every carrier, four breakpoints ───────────────────────────────────────────────
describe('migrateFileToStartBreakpoints — every carrier on a 4-breakpoint page', () => {
  const { code: after, steps } = migrateFileToStartBreakpoints(PAGE);

  it('declares each breakpoint as start (designWidth) + end (width)', () => {
    expect(steps.map((s) => [s.id, s.start, s.oldEnd, s.newEnd])).toEqual([
      ['laptop', 1200, 1200, 1439], ['tablet', 768, 768, 1199], ['mobile', 375, 375, 767],
    ]);
    const vps = Object.fromEntries(parseCanvasConfig(after)!.viewports.map((v) => [v.id, [v.width, v.designWidth]]));
    expect(vps).toEqual({ desktop: [1440, undefined], laptop: [1439, 1200], tablet: [1199, 768], mobile: [767, 375] });
  });

  it('every tile resolves exactly what it did before (bands, :lang, gates, queries, instances, text, list, overlay, open-variant)', () => {
    expectTilesUnchanged(PAGE, after);
  });

  it('leaves nothing keyed at an old end', () => {
    for (const s of steps) expect(staleKeyHits(after, s.oldEnd), `old ${s.oldEnd}`).toEqual([]);
  });

  it('moves each carrier to the new ends', () => {
    expect(after).toContain(`"1439":{"initialVariant":"l"}`);
    expect(after).toContain(`"1199":{"initialVariant":"t"}`);
    expect(after).toContain(`"767":{"initialVariant":"m"}`);
    expect(after).toMatch(/\{1439: "Hi laptop", 1199: "Hi tablet", 767: "Hi phone"\}/);
    expect(after).toContain(`"responsiveBp":[767,1199,1439,1440]`);
    expect(after).toContain(`window.innerWidth <= 767 ? 'mob' : window.innerWidth <= 1199 ? 'open'`);
    expect(after).toMatch(/query: "\(max-width: 1199px\) and \(min-width: 767\.02px\)"/);
    expect(after).toContain(`useResponsiveListConfig({"limit":6}, {"767":{"limit":2},"1199":{"limit":4},"1439":{"limit":5}}, [767,1199,1439,1440]`);
    expect(after).toMatch(/:lang\(fr\) \[data-id="a"\] \{ letter-spacing: 2px !important; \}/);
  });

  it('the in-between widths now follow the start model (the intended change)', () => {
    // 393 (an iPhone) was Tablet — now Mobile. 1000 was Laptop — now Tablet. 1300 was Desktop — now Laptop.
    expect(responsiveAt(PAGE, 393)[0]).toEqual({ initialVariant: 't' });
    expect(responsiveAt(after, 393)[0]).toEqual({ initialVariant: 'm' });
    expect(responsiveAt(PAGE, 1000)[0]).toEqual({ initialVariant: 'l' });
    expect(responsiveAt(after, 1000)[0]).toEqual({ initialVariant: 't' });
    expect(responsiveAt(PAGE, 1300)[0]).toEqual({});
    expect(responsiveAt(after, 1300)[0]).toEqual({ initialVariant: 'l' });
    // …and every other mechanism agrees with the instances at those widths.
    expect(cssAt(after, 393)['[data-id="a"] :: color']).toBe('red !important');
    expect(cssAt(after, 1000)['[data-id="a"] :: color']).toBe('green !important');
    expect(cssAt(after, 1300)['[data-id="a"] :: color']).toBe('blue !important');
    expect(responsiveTextAt(after, 393)[0]).toBe('"Hi phone"');
    expect(responsiveTextAt(after, 1000)[0]).toBe('"Hi tablet"');
    expect(listConfigAt(after, 393)[0]).toEqual({ limit: 2 });
    expect(overlayAt(after, 393)[0]).toMatchObject({ side: 'left', onOpenVariant: 'mob' });
    expect(overlayAt(after, 1000)[0]).toMatchObject({ side: 'top' });
    expect(openVariantAt(after, 393)[0]).toBe('mob');
    expect(queriesAt(after, 1000)).toEqual([true, false, true]); // scroll tablet, scroll mobile, SplitText tablet
  });

  it('is idempotent — a migrated file is left alone', () => {
    expect(migrateFileToStartBreakpoints(after)).toEqual({ code: after, steps: [] });
  });

  it('restores the global breakpoint store it borrows', () => {
    syncViewportWidths({ x: 1, y: 2 });
    migrateFileToStartBreakpoints(PAGE);
    expect(getViewportWidths()).toEqual({ x: 1, y: 2 });
  });
});

// ─── Templates ───────────────────────────────────────────────────────────────────────────────
describe('migrateFileToStartBreakpoints — template LayoutClient', () => {
  const TEMPLATE = layoutClient(TEMPLATE_LADDER);
  const { code: after, steps } = migrateFileToStartBreakpoints(TEMPLATE);

  it('migrates on its own ladder; every template tile resolves the same (bands, instances, route values)', () => {
    expect(steps.map((s) => [s.id, s.newEnd])).toEqual([['tablet', 1439], ['mobile', 767]]);
    expectTilesUnchanged(TEMPLATE, after);
    for (const s of steps) expect(staleKeyHits(after, s.oldEnd), `old ${s.oldEnd}`).toEqual([]);
    expect(after).toContain(`"headerVariant@1439":"home-t"`);
    expect(after).toContain(`__tp['headerVariant@767']`);
  });

  it('route values follow the start model per route', () => {
    expect(templateRouteAt(after, 393)).toEqual({ '/ :: headerVariant': 'home-m', '/blog :: headerVariant': 'blog-m' });
    expect(templateRouteAt(after, 1000)).toEqual({ '/ :: headerVariant': 'home-t', '/blog :: headerVariant': 'blog' });
    expect(templateRouteAt(after, 1440)).toEqual({ '/ :: headerVariant': 'home', '/blog :: headerVariant': 'blog' });
  });

  it('on a page with the SAME ladder, the template chrome on every page tile is unchanged', () => {
    const page = `${canvasBlock(TEMPLATE_LADDER)}\nexport default function P() { return <div data-id="p" />; }\n`;
    const pageAfter = migrateFileToStartBreakpoints(page).code;
    const oldVps = parseCanvasConfig(page)!.viewports;
    const newVps = parseCanvasConfig(pageAfter)!.viewports;
    for (const vp of oldVps) {
      const nv = newVps.find((v) => v.id === vp.id)!;
      const d = diffResolutions(resolveAll(TEMPLATE, renderWidth(vp)), resolveAll(after, renderWidth(nv)));
      expect(d, `${vp.id} page tile`).toEqual([]);
    }
  });

  it('on a page with a DIFFERENT ladder, the template follows the start model at the page tile width', () => {
    // Page 1440/810/390 under a 1440/768/375 template. Before: the page's 810 tablet tile got the
    // template's DESKTOP chrome (810 > 768) and its 390 mobile tile the template's TABLET chrome
    // (390 > 375). After: 810 ≥ the template tablet's start 768 → tablet chrome; 390 < 768 → mobile.
    expect(responsiveAt(TEMPLATE, 810)[0]).toEqual({});
    expect(responsiveAt(after, 810)[0]).toEqual({ initialVariant: 'tablet' });
    expect(responsiveAt(TEMPLATE, 390)[0]).toEqual({ initialVariant: 'tablet' });
    expect(responsiveAt(after, 390)[0]).toEqual({ initialVariant: 'mobile' });
  });
});

// ─── Ladders and file kinds ──────────────────────────────────────────────────────────────────
describe('migrateFileToStartBreakpoints — ladders and file kinds', () => {
  const page = (vps: Vp[], body = '<div data-id="p" />') => `${canvasBlock(vps)}\nexport default function P() { return ${body}; }\n`;

  it('many breakpoints (6) — each ends one pixel before the next start, all tiles unchanged', () => {
    const vps: Vp[] = [
      { id: 'd', width: 1920, primary: true }, { id: 'lg', width: 1440 }, { id: 'md', width: 1200 },
      { id: 't', width: 810 }, { id: 'm', width: 390 }, { id: 'xs', width: 320 },
    ];
    const bands = vps.filter((v) => !v.primary).map((v, i, arr) => {
      const next = arr[i + 1];
      return `@media (max-width: ${v.width}px)${next ? ` and (min-width: ${next.width + 0.02}px)` : ''} {\n      [data-id="p"] { color: c${v.width} !important; }\n    }`;
    }).join('\n    ');
    const resp = `{${vps.filter((v) => !v.primary).map((v) => `"${v.width}":{"initialVariant":"v${v.width}"}`).join(',')},"_bp":[${vps.map((v) => v.width).sort((a, b) => a - b).join(',')}]}`;
    const before = page(vps, `<div data-id="root"><style>{\`\n    ${bands}\n  \`}</style><Card data-id="p" data-responsive='${resp}' /></div>`);
    const { code: after, steps } = migrateFileToStartBreakpoints(before);
    expect(steps.map((s) => s.newEnd)).toEqual([1919, 1439, 1199, 809, 389]);
    expectTilesUnchanged(before, after);
    for (const s of steps) expect(staleKeyHits(after, s.oldEnd), `old ${s.oldEnd}`).toEqual([]);
    expect(responsiveAt(after, 393)[0]).toEqual({ initialVariant: 'v390' });
    expect(responsiveAt(after, 1000)[0]).toEqual({ initialVariant: 'v810' });
  });

  it('breakpoints 1px apart need no move (already contiguous)', () => {
    const { code, steps } = migrateFileToStartBreakpoints(page([{ id: 'd', width: 1440, primary: true }, { id: 't', width: 1439 }, { id: 'm', width: 767 }]));
    expect(steps.map((s) => s.id)).toEqual(['m']);
    const vps = parseCanvasConfig(code)!.viewports;
    expect(vps.find((v) => v.id === 't')).toMatchObject({ width: 1439 });
    expect(vps.find((v) => v.id === 'm')).toMatchObject({ width: 1438, designWidth: 767 });
  });

  it('leaves a Framer import (already start model) untouched', () => {
    const framer = page([{ id: 'd', width: 1200, primary: true }, { id: 't', width: 1199, designWidth: 810 }, { id: 'm', width: 809, designWidth: 390 }]);
    expect(migrateFileToStartBreakpoints(framer)).toEqual({ code: framer, steps: [] });
  });

  it('leaves single-viewport files and files without @canvas untouched', () => {
    const one = page([{ id: 'd', width: 1440, primary: true }]);
    expect(migrateFileToStartBreakpoints(one).steps).toEqual([]);
    const component = `export default function Card() { return <div data-id="c" />; }\n`;
    expect(migrateFileToStartBreakpoints(component)).toEqual({ code: component, steps: [] });
  });

  it('breakpoints at the same width share one range (they already share their bands)', () => {
    const dup = page([{ id: 'd', width: 1440, primary: true }, { id: 'a', width: 768 }, { id: 'b', width: 768 }, { id: 'm', width: 375 }],
      `<div data-id="root"><style>{\`\n    @media (max-width: 768px) and (min-width: 375.02px) {\n      [data-id="p"] { color: red !important; }\n    }\n  \`}</style><p data-id="p">x</p></div>`);
    const { code, steps } = migrateFileToStartBreakpoints(dup);
    const vps = Object.fromEntries(parseCanvasConfig(code)!.viewports.map((v) => [v.id, [v.width, v.designWidth]]));
    expect(vps).toEqual({ d: [1440, undefined], a: [1439, 768], b: [1439, 768], m: [767, 375] });
    expectTilesUnchanged(dup, code);
    for (const s of steps) expect(staleKeyHits(code, s.oldEnd)).toEqual([]);
  });

  it('a breakpoint wider than the primary runs up from its start; the primary ends below it', () => {
    const vps: Vp[] = [{ id: 'd', width: 1440, primary: true }, { id: 'hd', width: 1920 }, { id: 't', width: 768 }];
    const before = page(vps, `<div data-id="root"><style>{\`\n    @media (max-width: 1920px) and (min-width: 1440.02px) {\n      [data-id="p"] { font-size: 80px !important; }\n    }\n    @media (max-width: 768px) {\n      [data-id="p"] { font-size: 32px !important; }\n    }\n  \`}</style><Card data-id="p" data-responsive='{"768":{"initialVariant":"t"},"1920":{"initialVariant":"hd"},"_bp":[768,1440,1920]}' /></div>`);
    const { code: after, steps } = migrateFileToStartBreakpoints(before);
    const cfg = Object.fromEntries(parseCanvasConfig(after)!.viewports.map((v) => [v.id, [v.width, v.designWidth]]));
    expect(cfg).toEqual({ d: [1919, 1440], hd: [100000, 1920], t: [1439, 768] });
    expectTilesUnchanged(before, after);
    for (const s of steps) expect(staleKeyHits(after, s.oldEnd)).toEqual([]);
    // The intended change: 2560 (a wide monitor) now gets the 1920 design, 1600 the desktop one.
    expect(cssAt(before, 2560)['[data-id="p"] :: font-size']).toBeUndefined();
    expect(cssAt(after, 2560)['[data-id="p"] :: font-size']).toBe('80px !important');
    expect(responsiveAt(after, 2560)[0]).toEqual({ initialVariant: 'hd' });
    expect(responsiveAt(before, 1600)[0]).toEqual({ initialVariant: 'hd' });
    expect(responsiveAt(after, 1600)[0]).toEqual({});
  });
});
