import { describe, it, expect } from 'vitest';
import { parse } from '@babel/parser';
import {
  createDefaultSmoothScroll, normalizeSmoothScroll, parseSmoothScroll, serializeSmoothScroll,
  setSmoothScrollInMap, setSmoothScrollForRoutesInMap, removeSmoothScrollFromMap, ownSmoothScroll, resolveSmoothScroll, routeMatches,
} from '@/code/project/smooth-scroll-config';
import { SMOOTH_SCROLL_CONTROLLER_SOURCE, SMOOTH_SCROLL_MARKER } from './smooth-scroll-gen';
import { ensureSmoothScrollInLayout } from './smooth-scroll-layout';
import { ensureLayoutFile, healLayoutFile } from './metadata-gen';

describe('Smooth Scroll config', () => {
  it('every page carries its own setting, Home included; nothing is site-wide', () => {
    const home = { ...createDefaultSmoothScroll(), intensity: 20 };
    const off = { ...createDefaultSmoothScroll(), enabled: false };
    let map = setSmoothScrollInMap({ pages: {} }, '/', home);
    map = setSmoothScrollInMap(map, '/journal', off);
    expect(map.__default).toBeUndefined();
    expect(map.pages['/']).toEqual(home);
    expect(ownSmoothScroll(map, '/')).toEqual(home);
    expect(ownSmoothScroll(map, '/journal')).toEqual(off);
    expect(ownSmoothScroll(map, '/services')).toBeNull();
    expect(resolveSmoothScroll(map, '/services')).toBeNull();          // no inheritance
    expect(removeSmoothScrollFromMap(map, '/journal').pages['/journal']).toBeUndefined();
    expect(removeSmoothScrollFromMap(map, '/').pages['/']).toBeUndefined();
  });

  it('writes one config onto many pages at once (an import), and still reads a legacy site default', () => {
    const cfg = { ...createDefaultSmoothScroll(), intensity: 10 };
    const map = setSmoothScrollForRoutesInMap({ pages: {} }, ['/', '/about', '/journal/[slug]', 'home'], cfg);
    expect(Object.keys(map.pages).sort()).toEqual(['/', '/about', '/journal/[slug]']);
    expect(resolveSmoothScroll(map, '/journal/a-post')?.intensity).toBe(10);
    const legacy = { pages: {}, __default: cfg };
    expect(ownSmoothScroll(legacy, '/')).toEqual(cfg);
    expect(resolveSmoothScroll(legacy, '/anything')).toEqual(cfg);
  });

  it('matches dynamic and catch-all routes', () => {
    expect(routeMatches('/journal/[slug]', '/journal/learning-to-pause')).toBe(true);
    expect(routeMatches('/journal/[slug]', '/journal')).toBe(false);
    expect(routeMatches('/docs/[...rest]', '/docs/a/b/c')).toBe(true);
    const map = setSmoothScrollInMap({ pages: {} }, '/stories/[slug]', { ...createDefaultSmoothScroll(), intensity: 5 });
    expect(resolveSmoothScroll(map, '/stories/maya')?.intensity).toBe(5);
  });

  it('round-trips through the generated module and normalizes what it reads', () => {
    const map = setSmoothScrollInMap({ pages: {} }, '/about', { ...createDefaultSmoothScroll(), orientation: 'horizontal', infinite: true });
    const code = serializeSmoothScroll(map);
    expect(code).toContain('export const SMOOTH_SCROLL = {');
    expect(parseSmoothScroll(code)).toEqual(map);
    expect(normalizeSmoothScroll({ intensity: 900, orientation: 'sideways' as any })).toMatchObject({ intensity: 100, orientation: 'vertical', enabled: true });
    expect(parseSmoothScroll('garbage')).toEqual({ pages: {} });
  });
});

describe('Smooth Scroll codegen', () => {
  it('the controller is valid TSX that imports Lenis dynamically and the data module, versioned', () => {
    expect(() => parse(SMOOTH_SCROLL_CONTROLLER_SOURCE, { sourceType: 'module', plugins: ['jsx', 'typescript'] })).not.toThrow();
    expect(SMOOTH_SCROLL_CONTROLLER_SOURCE).toContain("import('lenis')");
    expect(SMOOTH_SCROLL_CONTROLLER_SOURCE).not.toContain("import Lenis from 'lenis';");
    expect(SMOOTH_SCROLL_CONTROLLER_SOURCE).toContain("import { SMOOTH_SCROLL } from './smooth-scroll';");
    expect(SMOOTH_SCROLL_CONTROLLER_SOURCE).toContain(SMOOTH_SCROLL_MARKER);
    expect(SMOOTH_SCROLL_CONTROLLER_SOURCE).toContain('prefers-reduced-motion');
    // The mirrored resolver's regexes survive the template literal escaping.
    expect(SMOOTH_SCROLL_CONTROLLER_SOURCE).toContain('/^\\[\\.\\.\\..+\\]$/');
  });

  it('mounts once in <body> of the root layout, with the import, and still parses', () => {
    const once = ensureSmoothScrollInLayout(ensureLayoutFile());
    expect(once).toContain("import { SmoothScroll } from './smooth-scroll-controller';");
    expect(once).toMatch(/<body>\n\s*<SmoothScroll \/>/);
    expect(ensureSmoothScrollInLayout(once)).toBe(once);
    expect(() => parse(once, { sourceType: 'module', plugins: ['jsx', 'typescript'] })).not.toThrow();
  });

  it('a rebuilt (healed) layout keeps the mount', () => {
    const mounted = ensureSmoothScrollInLayout(ensureLayoutFile());
    const broken = mounted.replace('export default function RootLayout', 'export default function RootLayout((');
    const healed = healLayoutFile(broken);
    expect(healed).toContain('<SmoothScroll />');
    expect(healed).toContain("import { SmoothScroll } from './smooth-scroll-controller';");
  });
});
