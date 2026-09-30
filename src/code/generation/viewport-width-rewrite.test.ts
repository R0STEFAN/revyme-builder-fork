import { describe, it, expect } from 'vitest';
import { rewriteOverlayBreakpoints, rewriteRouteKeyBreakpoints } from './viewport-width-rewrite';
import { rewriteAnimationBreakpoints } from '@/code/animations/animation-scope';

describe('rewriteOverlayBreakpoints — overlay per-breakpoint config follows a resized breakpoint', () => {
  const OV = (cfg: object) => `<motion.div data-id="ov" data-overlay='${JSON.stringify(cfg)}'>x</motion.div>`;

  it('re-keys the responsive entry and the responsiveBp list', () => {
    const out = rewriteOverlayBreakpoints(OV({ side: 'bottom', responsive: { '768': { side: 'top' }, '375': { side: 'left' } }, responsiveBp: [375, 768, 1440] }), 768, 1199);
    expect(out).toBe(OV({ side: 'bottom', responsive: { '375': { side: 'left' }, '1199': { side: 'top' } }, responsiveBp: [375, 1199, 1440] }));
  });

  it('merges into an entry already at the new width (the moved one wins per key)', () => {
    const out = rewriteOverlayBreakpoints(OV({ responsive: { '768': { side: 'top' }, '900': { side: 'left', offsetX: 4 } }, responsiveBp: [768, 900] }), 768, 900);
    expect(JSON.parse(/data-overlay='([^']+)'/.exec(out)![1]).responsive).toEqual({ '900': { side: 'top', offsetX: 4 } });
  });

  it('moves the open-variant chain threshold, and only that exact width', () => {
    const code = `initialVariant={o ? (window.innerWidth <= 375 ? 'm' : window.innerWidth <= 768 ? 't' : window.innerWidth <= 7680 ? 'x' : 'd') : 'c'} data-overlay='{"responsive":{"768":{}}}'`;
    const out = rewriteOverlayBreakpoints(code, 768, 1199);
    expect(out).toContain(`window.innerWidth <= 1199 ? 't'`);
    expect(out).toContain(`window.innerWidth <= 375 ? 'm'`);
    expect(out).toContain(`window.innerWidth <= 7680 ? 'x'`);
  });

  it('leaves overlays without that width, and files without overlays, byte-identical', () => {
    const a = OV({ side: 'bottom', responsive: { '375': { side: 'left' } }, responsiveBp: [375, 1440] });
    expect(rewriteOverlayBreakpoints(a, 768, 1199)).toBe(a);
    const b = `<div data-id="x" style={{ maxWidth: 768 }} />`;
    expect(rewriteOverlayBreakpoints(b, 768, 1199)).toBe(b);
  });
});

describe('rewriteRouteKeyBreakpoints — template per-breakpoint route values', () => {
  const LAYOUT = `const __templateProps = {"/":{"v":"a","v@768":"t","v@375":"m","w@7680":"z"}};
  v = (__mq1 ? __tp['v@375'] : __mq0 ? __tp['v@768'] : undefined) ?? __tp.v ?? v;`;

  it('re-keys the map entries and the resolve line, only for that width', () => {
    const out = rewriteRouteKeyBreakpoints(LAYOUT, 768, 1439);
    expect(out).toContain(`"v@1439":"t"`);
    expect(out).toContain(`__tp['v@1439']`);
    expect(out).toContain(`"v@375":"m"`);
    expect(out).toContain(`"w@7680":"z"`);
  });

  it('never touches a file without a template route map', () => {
    const page = `<a href="mailto:team@768" title="'team@768'">x</a>`;
    expect(rewriteRouteKeyBreakpoints(page, 768, 1439)).toBe(page);
  });
});

describe('rewriteAnimationBreakpoints — SplitText JS-literal `query:`', () => {
  it('re-stamps an unquoted `query: "…"` key like the JSON form', () => {
    const code = `<SplitText spec={{ responsive: [{ scope: { query: "(max-width: 768px) and (min-width: 375.02px)" } }] }} data-x='{"query":"(max-width: 768px) and (min-width: 375.02px)"}' />`;
    const out = rewriteAnimationBreakpoints(code, 768, 1199, [1440, 1199, 375]);
    expect(out).toContain(`query: "(max-width: 1199px) and (min-width: 375.02px)"`);
    expect(out).toContain(`"query":"(max-width: 1199px) and (min-width: 375.02px)"`);
  });
});
