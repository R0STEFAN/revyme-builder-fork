import { describe, it, expect, vi } from 'vitest';
vi.mock('@/shared/debug-trace', () => ({ trace: { action: vi.fn(), fn: vi.fn(), error: vi.fn(), dom: vi.fn(), state: vi.fn() } }));
import { remapWidthQuery, relabelWidthQueries, renameWidthKey } from './breakpoint-relabel';
import { migrateFileToStartBreakpoints } from './breakpoint-start-migration';
import { proveFileMigration, responsiveAt } from './breakpoint-proof';

// 1440 / 768 / 375 → tablet 768–1439, mobile < 768.
const LADDER = { preserveAbove: true, tiles: [{ drawn: 768, newEnd: 1439 }, { drawn: 375, newEnd: 767 }] };
// 1920 / 1440 (primary) / 768 → 1920+ (ends at OPEN_END), desktop 1440–1919, tablet < 1440.
const WIDE = { preserveAbove: false, tiles: [{ drawn: 1920, newEnd: 100000 }, { drawn: 1440, newEnd: 1919 }, { drawn: 768, newEnd: 1439 }] };

describe('remapWidthQuery', () => {
  it('editor bands become the canonical bands of the new ends', () => {
    expect(remapWidthQuery('(max-width: 768px) and (min-width: 375.02px)', LADDER)).toBe('(max-width: 1439px) and (min-width: 767.02px)');
    expect(remapWidthQuery('(max-width: 375px)', LADDER)).toBe('(max-width: 767px)');
    expect(remapWidthQuery('(max-width: 768px)', LADDER)).toBe('(max-width: 1439px)');
  });

  it('a band keyed at the PRIMARY width keeps painting the desktop tile, and only it', () => {
    // Real file: `@media (max-width: 1440px) and (min-width: 768.02px) { … display: none }`.
    expect(remapWidthQuery('(max-width: 1440px) and (min-width: 768.02px)', LADDER)).toBe('(max-width: 1440px) and (min-width: 1439.02px)');
  });

  it('keeps everything at and above the primary exactly as it was', () => {
    expect(remapWidthQuery('(min-width: 1600px)', LADDER)).toBe('(min-width: 1600px)');
    // Matches the tablet tile AND widths up to 1500: tablet's new range + the part above the seam, merged.
    expect(remapWidthQuery('(max-width: 1500px) and (min-width: 700px)', LADDER)).toBe('(max-width: 1500px) and (min-width: 767.02px)');
  });

  it('a breakpoint wider than the primary runs up from its start; the primary ends below it', () => {
    // Its old band (1441–1920) → 1920 and up, as a plain band keyed at OPEN_END.
    expect(remapWidthQuery('(max-width: 1920px) and (min-width: 1440.02px)', WIDE)).toBe('(max-width: 100000px) and (min-width: 1919.02px)');
    // The old min-width gate for it follows the same range.
    expect(remapWidthQuery('(min-width: 1440.02px)', WIDE)).toBe('(max-width: 100000px) and (min-width: 1919.02px)');
    // A band at the primary's width is the primary's own range now.
    expect(remapWidthQuery('(max-width: 1440px) and (min-width: 768.02px)', WIDE)).toBe('(max-width: 1919px) and (min-width: 1439.02px)');
  });

  it('leaves non-width queries, and queries no tile or desktop width matches, untouched', () => {
    expect(remapWidthQuery('(orientation: portrait)', LADDER)).toBeNull();
    expect(remapWidthQuery('(max-width: 200px)', LADDER)).toBeNull();
  });
});

describe('relabelWidthQueries — rule bodies stay byte-identical', () => {
  it('keeps `html [data-id]` selectors and declarations without !important', () => {
    const css = `\n    @media (max-width: 768px) and (min-width: 375.02px) {\n      html [data-id="root"] { height: auto !important; }\n      [data-id="hero"] { padding: 64px 24px; }\n    }\n  `;
    const out = relabelWidthQueries(`<style>{\`${css}\`}</style>`, LADDER);
    expect(out).toBe(`<style>{\`${css.replace('(max-width: 768px) and (min-width: 375.02px)', '(max-width: 1439px) and (min-width: 767.02px)')}\`}</style>`);
  });

  it('relabels gates and spec queries the same way', () => {
    const out = relabelWidthQueries(`const __mq0 = useMediaQuery('(max-width: 768px)'); <A data-x='{"query":"(max-width: 375px)"}' /> <S spec={{ query: "(max-width: 375px)" }} />`, LADDER);
    expect(out).toContain(`useMediaQuery('(max-width: 1439px)')`);
    expect(out).toContain(`"query":"(max-width: 767px)"`);
    expect(out).toContain(`query: "(max-width: 767px)"`);
  });
});

describe('renameWidthKey — a pure rename', () => {
  it('a keys-only data-responsive stays keys-only (an empty `_bp` would read as "no breakpoints")', () => {
    const code = `<Nav data-id="n" data-responsive='{"375":{"initialVariant":"mobile"},"768":{"initialVariant":"mobile"}}' />`;
    const out = renameWidthKey(renameWidthKey(code, 768, 1439), 375, 767);
    expect(out).toBe(`<Nav data-id="n" data-responsive='{"767":{"initialVariant":"mobile"},"1439":{"initialVariant":"mobile"}}' />`);
    expect(out).not.toContain('_bp');
    expect(responsiveAt(out, 768)).toEqual([{ initialVariant: 'mobile' }]);
  });

  it('the computed data-responsive form is renamed in place', () => {
    const code = `<Card data-responsive={JSON.stringify({"768":{"title":item.name},"_bp":[375,768,1440]})} />`;
    expect(renameWidthKey(code, 768, 1439)).toBe(`<Card data-responsive={JSON.stringify({"1439":{"title":item.name},"_bp":[375,1439,1440]})} />`);
  });

  it('never adopts a stale text key (375 while mobile is 420) — no tile showed it, none does after', () => {
    const code = `const t = useResponsiveText("Hi", {375: "Phone"}, [420, 768, 1440]);`;
    expect(renameWidthKey(code, 420, 767)).toBe(`const t = useResponsiveText("Hi", {375: "Phone"}, [767, 768, 1440]);`);
  });
});

describe('migrateFileToStartBreakpoints — the production shapes, proven', () => {
  const page = (css: string, extra = '') => `/** @canvas {
  "viewports": [
    { "id": "desktop", "label": "Desktop", "width": 1440, "isPrimary": true, "order": 0 },
    { "id": "tablet", "label": "Tablet", "width": 768, "isPrimary": false, "order": 1 },
    { "id": "mobile", "label": "Mobile", "width": 375, "isPrimary": false, "order": 2 }
  ],
  "positions": {}
} */
export default function P() {
  return <div data-id="root"><style>{\`${css}\`}</style>${extra}</div>;
}
`;
  const cases: Record<string, string> = {
    'desktop-keyed band': page(`\n    @media (max-width: 1440px) and (min-width: 768.02px) {\n      [data-id="x"] { display: none !important; }\n    }\n  `),
    'html-prefixed selectors': page(`\n    @media (max-width: 768px) and (min-width: 375.02px) {\n      html [data-id="x"] { margin: 32px !important; }\n    }\n    @media (max-width: 375px) {\n      html [data-id="x"] { margin: 24px !important; }\n    }\n  `),
    'declarations without !important': page(`\n    @media (max-width: 768px) and (min-width: 375.02px) {\n      [data-id="hero"] { padding: 64px 24px 88px; }\n    }\n  `),
    'keys-only instance': page('', `<Nav data-id="n" data-responsive='{"375":{"initialVariant":"mobile"},"768":{"initialVariant":"mobile"}}' />`),
  };
  for (const [name, before] of Object.entries(cases)) {
    it(name, () => {
      const { code: after, steps } = migrateFileToStartBreakpoints(before);
      expect(steps.length).toBe(2);
      expect(proveFileMigration(before, after, steps.map((s) => s.oldEnd))).toEqual([]);
    });
  }
});

import { dropWidthKey } from './breakpoint-relabel';
describe('dropWidthKey — a removed breakpoint takes its keyed values with it', () => {
  it('per-breakpoint text: the override and the width list entry', () => {
    expect(dropWidthKey(`useResponsiveText("Hi", {1439: "Tab", 767: "Phone"}, [1440, 1439, 767])`, 1439))
      .toBe(`useResponsiveText("Hi", {767: "Phone"}, [1440, 767])`);
    expect(dropWidthKey(`useResponsiveText("Hi", {767: "Phone"}, [1440, 767])`, 767)).toBe(`useResponsiveText("Hi", {}, [1440])`);
  });
  it('overlay config: the entry and its breakpoint; an emptied config drops both fields', () => {
    expect(dropWidthKey(`data-overlay='{"side":"bottom","responsive":{"1439":{"side":"top"},"767":{"side":"left"}},"responsiveBp":[767,1439,1440]}'`, 1439))
      .toBe(`data-overlay='{"side":"bottom","responsive":{"767":{"side":"left"}},"responsiveBp":[767,1440]}'`);
    expect(dropWidthKey(`data-overlay='{"side":"bottom","responsive":{"767":{"side":"left"}},"responsiveBp":[767,1440]}'`, 767))
      .toBe(`data-overlay='{"side":"bottom"}'`);
  });
});
