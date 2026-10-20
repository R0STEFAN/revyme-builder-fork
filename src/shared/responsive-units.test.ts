// responsive-units.test.ts — Coverage for the per-viewport vw/vh resolver.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  resolveResponsiveUnits,
  getResponsiveVpWidth,
  resolveResponsiveStyles,
  resolveContainerQueryUnits,
  simulatedVpHeight,
  FALLBACK_VP_WIDTH,
  buildViewportTokensCSS,
} from './responsive-units';

describe('resolveResponsiveUnits', () => {
  it('returns non-vw/vh values untouched', () => {
    expect(resolveResponsiveUnits('16px', 1440)).toBe('16px');
    expect(resolveResponsiveUnits('1.5rem', 1440)).toBe('1.5rem');
    expect(resolveResponsiveUnits('auto', 1440)).toBe('auto');
    expect(resolveResponsiveUnits('', 1440)).toBe('');
    expect(resolveResponsiveUnits('red', 1440)).toBe('red');
  });

  it('resolves a simple vw value at the desktop width', () => {
    expect(resolveResponsiveUnits('9vw', 1440)).toBe('129.6px');
  });

  it('resolves the SAME source vw differently per viewport', () => {
    expect(resolveResponsiveUnits('9vw', 1440)).toBe('129.6px');
    expect(resolveResponsiveUnits('9vw', 768)).toBe('69.12px');
    expect(resolveResponsiveUnits('9vw', 375)).toBe('33.75px');
  });

  it('resolves vw inside clamp/calc', () => {
    expect(resolveResponsiveUnits('clamp(16px, 4vw, 48px)', 1440)).toBe('clamp(16px, 57.6px, 48px)');
    expect(resolveResponsiveUnits('clamp(16px, 4vw, 48px)', 768)).toBe('clamp(16px, 30.72px, 48px)');
    expect(resolveResponsiveUnits('calc(100vw - 32px)', 375)).toBe('calc(375px - 32px)');
  });

  it('resolves vh against width × device-class height ratio', () => {
    // Desktop (>= 1024): width * 0.625
    expect(resolveResponsiveUnits('100vh', 1440)).toBe(`${1440 * 0.625}px`);
    // Tablet (>= 500, < 1024): width * 1.33
    expect(resolveResponsiveUnits('100vh', 768)).toBe(`${768 * 1.33}px`);
    // Phone (< 500): width * 2.16
    expect(resolveResponsiveUnits('100vh', 375)).toBe(`${375 * 2.16}px`);
  });

  it('resolves svw, dvw, lvw values like vw', () => {
    expect(resolveResponsiveUnits('9svw', 1440)).toBe('129.6px');
    expect(resolveResponsiveUnits('9dvw', 768)).toBe('69.12px');
    expect(resolveResponsiveUnits('9lvw', 375)).toBe('33.75px');
    expect(resolveResponsiveUnits('clamp(16px, 4svw, 48px)', 1440)).toBe('clamp(16px, 57.6px, 48px)');
  });

  it('resolves svh, dvh, lvh values like vh', () => {
    expect(resolveResponsiveUnits('100svh', 1440)).toBe(`${1440 * 0.625}px`);
    expect(resolveResponsiveUnits('100dvh', 768)).toBe(`${768 * 1.33}px`);
    expect(resolveResponsiveUnits('100lvh', 375)).toBe(`${375 * 2.16}px`);
  });

  it('resolves negative vw values', () => {
    expect(resolveResponsiveUnits('-9vw', 1440)).toBe('-129.6px');
    expect(resolveResponsiveUnits('-9dvw', 1440)).toBe('-129.6px');
  });

  it('passes through malformed values without crashing', () => {
    expect(resolveResponsiveUnits('vw', 1440)).toBe('vw');
    expect(resolveResponsiveUnits('abcvw', 1440)).toBe('abcvw');
  });
});

describe('getResponsiveVpWidth', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('returns FALLBACK_VP_WIDTH when element is null', () => {
    expect(getResponsiveVpWidth(null)).toBe(FALLBACK_VP_WIDTH);
  });

  it('returns FALLBACK_VP_WIDTH when element has no [data-viewport] ancestor', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    expect(getResponsiveVpWidth(el)).toBe(FALLBACK_VP_WIDTH);
  });

  it('reads data-viewport-width from the closest [data-viewport]', () => {
    const vp = document.createElement('div');
    vp.setAttribute('data-viewport', 'tablet');
    vp.setAttribute('data-viewport-width', '768');
    const child = document.createElement('p');
    vp.appendChild(child);
    document.body.appendChild(vp);
    expect(getResponsiveVpWidth(child)).toBe(768);
  });

  it('falls back when data-viewport-width is missing or invalid', () => {
    const vp = document.createElement('div');
    vp.setAttribute('data-viewport', 'tablet');
    document.body.appendChild(vp);
    expect(getResponsiveVpWidth(vp)).toBe(FALLBACK_VP_WIDTH);

    vp.setAttribute('data-viewport-width', 'not-a-number');
    expect(getResponsiveVpWidth(vp)).toBe(FALLBACK_VP_WIDTH);

    vp.setAttribute('data-viewport-width', '0');
    expect(getResponsiveVpWidth(vp)).toBe(FALLBACK_VP_WIDTH);
  });

  it('uses the nearest viewport when nested', () => {
    const outer = document.createElement('div');
    outer.setAttribute('data-viewport', 'desktop');
    outer.setAttribute('data-viewport-width', '1440');
    const inner = document.createElement('div');
    inner.setAttribute('data-viewport', 'tablet');
    inner.setAttribute('data-viewport-width', '768');
    const leaf = document.createElement('p');
    inner.appendChild(leaf);
    outer.appendChild(inner);
    document.body.appendChild(outer);
    expect(getResponsiveVpWidth(leaf)).toBe(768);
  });
});

describe('resolveResponsiveStyles', () => {
  it('resolves every entry in a styles map', () => {
    const out = resolveResponsiveStyles(
      { fontSize: '9vw', padding: '16px', height: '100vh', color: 'red' },
      1440,
    );
    expect(out).toEqual({
      fontSize: '129.6px',
      padding: '16px',
      height: `${1440 * 0.625}px`,
      color: 'red',
    });
  });

  it('preserves empty strings (delete-property sentinel)', () => {
    const out = resolveResponsiveStyles({ fontSize: '', width: '100vw' }, 768);
    expect(out.fontSize).toBe('');
    expect(out.width).toBe('768px');
  });
});

// EMPIRICAL PIN — live find 2026-07-13: a per-viewport font-size override
// `clamp(40px, 11.6vw, 163px) !important` (template footer wordmark, mobile
// @media block) painted at the clamp MAX on every canvas tile: the
// @media→@container transform kept the raw vw, native CSS resolved it
// against the IFRAME window, and the !important beat patchElement's
// correctly-resolved inline merge. Correct on live, giant on canvas.
describe('resolveContainerQueryUnits', () => {
  const WIDTHS = [375, 768, 1440];

  it('resolves clamp vw inside a mobile-only block against the matching tile', () => {
    const css = '@container (max-width: 375px) {\n  [data-id="brand"] { font-size: clamp(40px, 11.6vw, 163px) !important; }\n}';
    const out = resolveContainerQueryUnits(css, WIDTHS);
    expect(out).toContain('@container (min-width: 375px) and (max-width: 375px)');
    expect(out).toContain(`clamp(40px, ${(11.6 / 100) * 375}px, 163px)`);
    expect(out).not.toContain('vw');
  });

  it('duplicates a multi-tile block once per matching width with per-width px', () => {
    const css = '@container (max-width: 1199px) { [data-id="t"] { font-size: 10vw !important; } }';
    const out = resolveContainerQueryUnits(css, WIDTHS);
    expect(out).toContain('@container (min-width: 375px) and (max-width: 375px)');
    expect(out).toContain('@container (min-width: 768px) and (max-width: 768px)');
    expect(out).not.toContain('@container (min-width: 1440px)');
    expect(out).toContain('font-size: 37.5px !important');
    expect(out).toContain('font-size: 76.8px !important');
  });

  it('respects min-width bounds when picking matching tiles', () => {
    const css = '@container (max-width: 768px) and (min-width: 376px) { [data-id="t"] { width: 50vw; } }';
    const out = resolveContainerQueryUnits(css, WIDTHS);
    expect(out).toContain('width: 384px');
    expect(out).not.toContain('@container (min-width: 375px) and (max-width: 375px)');
  });

  it('resolves vh via the device-class height heuristic', () => {
    const css = '@container (max-width: 375px) { [data-id="t"] { height: 50vh; } }';
    const out = resolveContainerQueryUnits(css, WIDTHS);
    expect(out).toContain(`height: ${0.5 * simulatedVpHeight(375)}px`);
  });

  it('passes through blocks without vw/vh and non-block text untouched', () => {
    const css = ':root { --x: 1; }\n@container (max-width: 375px) { [data-id="t"] { display: none !important; } }';
    expect(resolveContainerQueryUnits(css, WIDTHS)).toBe(css);
  });

  it('fast-path: css without vw/vh returns identity', () => {
    const css = '@container (max-width: 768px) { [data-id="t"] { color: red; } }';
    expect(resolveContainerQueryUnits(css, WIDTHS)).toBe(css);
  });

  it('no matching widths → block kept verbatim', () => {
    const css = '@container (max-width: 300px) { [data-id="t"] { font-size: 10vw; } }';
    expect(resolveContainerQueryUnits(css, WIDTHS)).toContain('10vw');
  });

  it('keeps surrounding rules intact while rewriting the vw block', () => {
    const css = '.a { color: blue; }\n@container (max-width: 375px) { [data-id="t"] { font-size: 8vw; } }\n.b { color: green; }';
    const out = resolveContainerQueryUnits(css, WIDTHS);
    expect(out).toContain('.a { color: blue; }');
    expect(out).toContain('.b { color: green; }');
    expect(out).toContain('font-size: 30px');
  });
});

describe('buildViewportTokensCSS', () => {
  const VIEWPORTS = [
    { id: 'desktop', width: 1200 },
    { id: 'tablet', width: 810 },
    { id: 'mobile', width: 390 },
  ];

  it('returns empty string when tokensCSS is empty or has no viewport units', () => {
    expect(buildViewportTokensCSS('', VIEWPORTS)).toBe('');
    expect(buildViewportTokensCSS(':root { --color: red; --font: Inter; }', VIEWPORTS)).toBe('');
  });

  it('returns empty string when viewports array is empty', () => {
    expect(buildViewportTokensCSS(':root { --typo-size: clamp(1rem, 5vw, 3rem); }', [])).toBe('');
  });

  it('resolves fluid clamp tokens with vw per viewport tile', () => {
    const css = `[data-content-root] {
  --color-primary: #111;
  --typo-heading-1-size: clamp(1.65rem, 6.5vw, 6.5rem);
  --space-hero: clamp(2rem, 8vw, 6rem);
}`;
    const out = buildViewportTokensCSS(css, VIEWPORTS);

    // Desktop: 1200px -> 6.5vw = 78px, 8vw = 96px
    expect(out).toContain('[data-viewport="desktop"], [data-overlay-portal="desktop"]');
    expect(out).toContain('--typo-heading-1-size: clamp(1.65rem, 78px, 6.5rem);');
    expect(out).toContain('--space-hero: clamp(2rem, 96px, 6rem);');

    // Tablet: 810px -> 6.5vw = 52.65px, 8vw = 64.8px
    expect(out).toContain('[data-viewport="tablet"], [data-overlay-portal="tablet"]');
    expect(out).toContain('--typo-heading-1-size: clamp(1.65rem, 52.65px, 6.5rem);');
    expect(out).toContain('--space-hero: clamp(2rem, 64.8px, 6rem);');

    // Mobile: 390px -> 6.5vw = 25.35px, 8vw = 31.2px
    expect(out).toContain('[data-viewport="mobile"], [data-overlay-portal="mobile"]');
    expect(out).toContain('--typo-heading-1-size: clamp(1.65rem, 25.35px, 6.5rem);');
    expect(out).toContain('--space-hero: clamp(2rem, 31.2px, 6rem);');

    // Non-viewport tokens are not included in the per-viewport overrides
    expect(out).not.toContain('--color-primary');
  });

  it('respects designWidth when viewport has designWidth', () => {
    const vps = [{ id: 'mobile', width: 809, designWidth: 390 }];
    const css = '[data-content-root] { --h1: clamp(1rem, 10vw, 3rem); }';
    const out = buildViewportTokensCSS(css, vps);
    expect(out).toContain('--h1: clamp(1rem, 39px, 3rem);');
  });

  it('handles dark mode overrides when multiple declarations for the same token exist', () => {
    const css = `[data-content-root] {
  --font-size: clamp(14px, 2vw, 20px);
}
[data-content-root] {
  --font-size: clamp(16px, 3vw, 24px);
}`;
    const out = buildViewportTokensCSS(css, [{ id: 'mobile', width: 390 }]);
    // Later declaration (3vw = 11.7px) wins
    expect(out).toContain('--font-size: clamp(16px, 11.7px, 24px);');
  });

  it('handles multiline clamp declarations and ignores comments', () => {
    const css = `[data-content-root] {
  /* Comment with 10vw */
  --title: clamp(
    1.5rem,
    5vw,
    4rem
  );
}`;
    const out = buildViewportTokensCSS(css, [{ id: 'mobile', width: 390 }]);
    expect(out).toContain('19.5px');
    expect(out).not.toContain('5vw');
    expect(out).not.toContain('10vw'); // from the comment
  });
});
