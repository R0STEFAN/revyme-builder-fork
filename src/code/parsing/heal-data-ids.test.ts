// heal-data-ids.test.ts — self-heal for instance tags without data-id (the
// auto_N silent-no-op class) + corrupted bare `data-` attribute stripping.

import { describe, it, expect } from 'vitest';
import { healMissingInstanceDataIds, autoInjectMissingDataIds } from './heal-data-ids';

describe('healMissingInstanceDataIds', () => {
  it('stamps a data-id on a PascalCase instance missing one (the corrupted-tag shape)', () => {
    // The wild corruption: `data-id="X"` split into bare `data-` + `id="X"`.
    const code = `<div data-id="root"><ZaPoKa data- curveRadius={18} id="ZaPoKa-1" data-name="ZaPoKa" style={{ left: '409px' }}></ZaPoKa></div>`;
    const r = healMissingInstanceDataIds(code);
    expect(r.healed).toBe(1);
    expect(r.strippedJunk).toBe(1);
    expect(r.code).toMatch(/<ZaPoKa data-id="ZaPoKa-[a-z0-9-]+" curveRadius=\{18\}/);
    expect(r.code).not.toContain(' data- ');
    // The stray `id=` prop is left alone — `id` is a legitimate anchor prop.
    expect(r.code).toContain('id="ZaPoKa-1"');
  });

  it('strips `data-="true"` junk from pasted copies (keeps their real data-id)', () => {
    const code = `<ZaPoKa data-id="ZaPoKa-ok-1" data-name="ZaPoKa" id="ZaPoKa-1" data-="true" style={{}}></ZaPoKa>`;
    const r = healMissingInstanceDataIds(code);
    expect(r.healed).toBe(0);
    expect(r.strippedJunk).toBe(1);
    expect(r.code).toContain('data-id="ZaPoKa-ok-1"');
    expect(r.code).not.toContain('data-="true"');
  });

  it('does not touch healthy instances, transparent wrappers, or lowercase tags', () => {
    const code = `<LayoutGroup><MotionConfig transition={{ duration: 0.3 }}>
      <Hero data-id="hero-1" />
      <div style={{ left: '4px' }}><span>data- text</span></div>
    </MotionConfig></LayoutGroup>`;
    const r = healMissingInstanceDataIds(code);
    expect(r.healed).toBe(0);
    expect(r.strippedJunk).toBe(0);
    expect(r.code).toBe(code);
  });

  it('heals multiple instances and keeps ids unique', () => {
    const code = `<div data-id="root"><Card style={{}} /><Card style={{}} /></div>`;
    const r = healMissingInstanceDataIds(code);
    expect(r.healed).toBe(2);
    const ids = [...r.code.matchAll(/<Card data-id="([^"]+)"/g)].map(x => x[1]);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('ignores `[data-id=...]` CSS selectors in style strings', () => {
    const code = `<div data-id="root"><style>{\`[data-id="x"]::after { content: ''; }\`}</style><Card data-id="c-1" /></div>`;
    const r = healMissingInstanceDataIds(code);
    expect(r.code).toBe(code);
  });

  it('handles self-closing instances with arrow-function props', () => {
    const code = `<Nav style={{}} onOpen={() => setOpen(v => !v)} />`;
    const r = healMissingInstanceDataIds(code);
    expect(r.healed).toBe(1);
    expect(r.code).toMatch(/^<Nav data-id="Nav-[a-z0-9-]+" style/);
    expect(r.code).toContain('onOpen={() => setOpen(v => !v)} />');
  });

  it('never stamps the RevymeSplitText text-effect wrapper, and strips an id a past heal put there', () => {
    const src = `<p data-id="t-1" data-text-anim='{}'><RevymeSplitText spec={{ a: 1 }}>Hi</RevymeSplitText></p>`;
    const r1 = healMissingInstanceDataIds(src);
    expect(r1.code).toBe(src);
    expect(r1.healed).toBe(0);
    const stamped = `<p data-id="t-1"><RevymeSplitText data-id="RevymeSplitText-old-1" spec={{ a: 1 }}>Hi</RevymeSplitText></p>`;
    const r2 = healMissingInstanceDataIds(stamped);
    expect(r2.code).toBe(`<p data-id="t-1"><RevymeSplitText spec={{ a: 1 }}>Hi</RevymeSplitText></p>`);
    expect(r2.strippedJunk).toBe(1);
    expect(r2.healed).toBe(0);
  });

  it('treats PageTransitions like the other transparent wrappers (never stamped, stamped id stripped)', () => {
    const src = `<PageTransitions><div data-id="root" /></PageTransitions>`;
    expect(healMissingInstanceDataIds(src).code).toBe(src);
    const stamped = `<PageTransitions data-id="PageTransitions-old-1"><div data-id="root" /></PageTransitions>`;
    const r = healMissingInstanceDataIds(stamped);
    expect(r.code).toBe(src);
    expect(r.strippedJunk).toBe(1);
  });
});

describe('autoInjectMissingDataIds', () => {
  it('automatically injects data-id on elements lacking one', () => {
    const raw = `<section style={{ display: 'flex' }}>
      <h1>Title</h1>
      <button onClick={() => {}}>Click</button>
    </section>`;
    const { code, injectedCount } = autoInjectMissingDataIds(raw);
    expect(injectedCount).toBe(3);
    expect(code).toMatch(/<section data-id="section-[a-z0-9-]+"/);
    expect(code).toMatch(/<h1 data-id="text-[a-z0-9-]+"/);
    expect(code).toMatch(/<button data-id="btn-[a-z0-9-]+"/);
  });

  it('preserves existing data-ids and only injects where missing', () => {
    const raw = `<div data-id="my-custom-box"><p>Content</p></div>`;
    const { code, injectedCount } = autoInjectMissingDataIds(raw);
    expect(injectedCount).toBe(1);
    expect(code).toContain('data-id="my-custom-box"');
    expect(code).toMatch(/<p data-id="text-[a-z0-9-]+"/);
  });

  it('automatically assigns data-id="root" to page outermost element when isPage: true', () => {
    const raw = `export default function Page() {
      return (
        <div style={{ position: 'relative' }}>
          <p>Hello</p>
        </div>
      );
    }`;
    const { code, injectedCount } = autoInjectMissingDataIds(raw, { isPage: true });
    expect(injectedCount).toBe(2);
    expect(code).toContain('<div data-id="root" style');
    expect(code).toMatch(/<p data-id="text-[a-z0-9-]+"/);
  });

  it('exempts SVG children and inline rich-text spans from getting data-id', () => {
    const raw = `<div>
      <p>Hello <span>world</span></p>
      <svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" /></svg>
    </div>`;
    const { code, injectedCount } = autoInjectMissingDataIds(raw);
    // div, p, svg get data-id (3 elements), span and circle do NOT
    expect(injectedCount).toBe(3);
    expect(code).toContain('<span>world</span>');
    expect(code).toContain('<circle cx="50" cy="50" r="50" />');
  });
});
