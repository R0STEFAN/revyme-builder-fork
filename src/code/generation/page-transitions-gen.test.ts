import { describe, it, expect } from 'vitest';
import { transform } from '@babel/standalone';
import {
  injectPageTransitionsInCode,
  PAGE_EFFECTS_RUNTIME_SOURCE,
  PAGE_TRANSITIONS_SOURCE,
  pageEffectsDataPath,
  pageTransitionsPath,
} from './page-transitions-gen';
import { buildViewTransitionCSS } from './view-transition-css';
import { createDefaultSide } from '../project/page-effects-config';

const parsesTsx = (code: string) =>
  expect(() => transform(code, { presets: ['react', 'typescript'], filename: 'f.tsx' })).not.toThrow();
const parsesTs = (code: string) =>
  expect(() => transform(code, { presets: ['typescript'], filename: 'f.ts' })).not.toThrow();

const LAYOUT_CLIENT = `'use client';
import React from 'react';
export default function LayoutClient({ children }: { children: React.ReactNode }) {
  return (
    <div data-id="root" data-name="Layout" style={{ position: 'relative' }}>
      {children}
    </div>
  );
}
`;

const TEMPLATE_LAYOUT_CLIENT = `'use client';

/* @canvas { single: true } */

import React from 'react';
import SiteNavbar from '@/components/SiteNavbar';
import SiteFooter from '@/components/SiteFooter';

export default function LayoutClient({ children }: { children: React.ReactNode }) {
  return (
    <div data-id="root" data-name="Template site-shell" style={{
      position: 'relative', width: '100%', backgroundColor: '#FFFFFF', overflowX: 'hidden'
    }}>
      <SiteNavbar data-id="template-navbar" data-name="Site Navigation" logoText="IMPCT.DIGITAL" menuTitle="Сайти та ШІ для бізнесу" menuLabel="+ МЕНЮ" contactLabel="Обговорити проєкт ↗" style={{ position: "fixed", top: "0px", left: "0px", right: "0px", zIndex: "100" }} />
      {children}
      <SiteFooter data-id="template-footer" data-name="Site Footer" email="HELLO@IMPCT.DIGITAL" about="Незалежна студія цифрових продуктів і ШІ-рішень для бізнесу." brand="IMPCT.DIGITAL" style={{ position: "relative", width: "100%" }} />
    </div>
  );
}
`;

describe('page-transitions-gen: injectPageTransitionsInCode', () => {
  it('wraps {children} + adds the import', () => {
    const out = injectPageTransitionsInCode(LAYOUT_CLIENT);
    expect(out).toContain('<PageTransitions>{children}</PageTransitions>');
    expect(out).toContain("import { PageTransitions } from './page-transitions';");
    parsesTsx(out);
  });
  it('is idempotent', () => {
    const once = injectPageTransitionsInCode(LAYOUT_CLIENT);
    expect(injectPageTransitionsInCode(once)).toBe(once);
  });
  it('injects into a template shell with imported components before and after the slot', () => {
    const out = injectPageTransitionsInCode(TEMPLATE_LAYOUT_CLIENT);
    expect(out).toContain('<SiteNavbar');
    expect(out).toContain('<PageTransitions>{children}</PageTransitions>');
    expect(out).toContain('<SiteFooter');
    expect(out).toContain("import { PageTransitions } from './page-transitions';");
    parsesTsx(out);
  });
  it('no-op when there is no {children}', () => {
    const noKids = `export default function L() { return <div/>; }`;
    expect(injectPageTransitionsInCode(noKids)).toBe(noKids);
  });
});

describe('page-transitions-gen: generated source files', () => {
  it('the controller component is valid TSX and renders scoped in-DOM stage with height tracking', () => {
    parsesTsx(PAGE_TRANSITIONS_SOURCE);
    expect(PAGE_TRANSITIONS_SOURCE).toContain("import { PAGE_EFFECTS } from './page-effects'");
    expect(PAGE_TRANSITIONS_SOURCE).toContain('data-revyme-pt-stage');
    expect(PAGE_TRANSITIONS_SOURCE).toContain('revyme-pt-enter');
    expect(PAGE_TRANSITIONS_SOURCE).toContain('revyme-pt-exit');
    expect(PAGE_TRANSITIONS_SOURCE).toContain('addEventListener(\'click\', onClick, true)'); // capture phase
  });
  it('the runtime helpers module is valid TS with @rt-v7 marker', () => {
    parsesTs(PAGE_EFFECTS_RUNTIME_SOURCE);
    expect(PAGE_EFFECTS_RUNTIME_SOURCE).toContain('@rt-v7');
    expect(PAGE_TRANSITIONS_SOURCE).toContain('@rt-v9');
  });
  it('path helpers sit next to the LayoutClient', () => {
    expect(pageEffectsDataPath('app/(Body)/LayoutClient.tsx')).toBe('app/(Body)/page-effects.ts');
    expect(pageTransitionsPath('app/(Body)/LayoutClient.tsx')).toBe('app/(Body)/page-transitions.tsx');
  });
});

describe('page-transitions-gen: deployed runtime matches the editor builder (no drift)', () => {
  // eval the generated standalone helpers and compare buildViewTransitionCSS output.
  function loadRuntime(): { buildViewTransitionCSS: (e?: any, n?: any) => string } {
    const src = PAGE_EFFECTS_RUNTIME_SOURCE.replace(/export function/g, 'function');
     
    const factory = new Function(src + '\nreturn { buildViewTransitionCSS };');
    return factory();
  }
  const rt = loadRuntime();
  const cases = [
    [createDefaultSide(), { ...createDefaultSide(), opacity: 0 }],
    [undefined, { ...createDefaultSide(), offsetX: 100 }],
    [{ ...createDefaultSide(), opacity: 0 }, undefined],
    [undefined, { ...createDefaultSide(), mask: { type: 'circle', originX: 50, originXUnit: 'rel', originY: 50, originYUnit: 'rel' } }],
    [undefined, { ...createDefaultSide(), transition: { kind: 'spring', stiffness: 200, damping: 12, mass: 1, duration: 0, delay: 0 } }],
  ] as const;
  cases.forEach(([exit, enter], i) => {
    it(`case ${i}: deployed CSS === editor CSS`, () => {
      expect(rt.buildViewTransitionCSS(exit as any, enter as any)).toBe(buildViewTransitionCSS(exit as any, enter as any));
    });
  });
});
