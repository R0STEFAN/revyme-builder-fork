import { describe, it, expect, vi } from 'vitest';
vi.mock('@/shared/debug-trace', () => ({ trace: { action: vi.fn(), fn: vi.fn(), error: vi.fn(), dom: vi.fn(), state: vi.fn() } }));
import { migrateProjectToStartBreakpoints } from './breakpoint-project-migration';
import * as fileMigration from './breakpoint-start-migration';

const canvas = (widths: number[]) => `/** @canvas {
  "viewports": [
${widths.map((w, i) => `    { "id": "v${i}", "label": "v${i}", "width": ${w}, "isPrimary": ${i === 0}, "order": ${i} }`).join(',\n')}
  ],
  "positions": {}
} */`;
const page = (widths: number[]) => `${canvas(widths)}
export default function P() {
  return <div data-id="root"><style>{\`
    @media (max-width: ${widths[1]}px) and (min-width: ${widths[2] + 0.02}px) {
      [data-id="a"] { color: green !important; }
    }
    @media (max-width: ${widths[2]}px) {
      [data-id="a"] { color: red !important; }
    }
  \`}</style><Card data-id="a" data-responsive='{"${widths[1]}":{"initialVariant":"t"},"${widths[2]}":{"initialVariant":"m"},"_bp":[${[...widths].sort((x, y) => x - y).join(',')}]}' /></div>;
}
`;

const PROJECT = {
  format: 'revyme-v1',
  files: {
    'app/(site)/LayoutClient.tsx': page([1440, 768, 375]),
    'app/(site)/page.client.tsx': page([1440, 768, 375]),
    'app/(site)/about/page.client.tsx': page([1440, 810, 390]),
    'app/globals.css': '@media (max-width: 768px) { body { margin: 0; } }',
    'components/Card.tsx': 'export default function Card() { return <div data-id="c" />; }',
    'i18n/config.json': '{"locales":["en"]}',
  },
};

describe('migrateProjectToStartBreakpoints', () => {
  const res = migrateProjectToStartBreakpoints(PROJECT);

  it('migrates every multi-breakpoint file and proves each one', () => {
    expect(res.refused).toEqual([]);
    expect(res.changed.map((c) => c.path)).toEqual(['app/(site)/LayoutClient.tsx', 'app/(site)/page.client.tsx', 'app/(site)/about/page.client.tsx']);
    expect(res.project!.files!['app/(site)/about/page.client.tsx']).toContain('"designWidth": 810');
  });

  it('leaves every other file and field byte-identical', () => {
    expect(res.project!.format).toBe('revyme-v1');
    for (const p of ['app/globals.css', 'components/Card.tsx', 'i18n/config.json']) {
      expect(res.project!.files![p]).toBe((PROJECT.files as Record<string, string>)[p]);
    }
    expect(Object.keys(res.project!.files!)).toEqual(Object.keys(PROJECT.files));
  });

  it('is idempotent — a migrated project has nothing left to do', () => {
    const again = migrateProjectToStartBreakpoints(res.project!);
    expect(again).toEqual({ project: null, changed: [], refused: [] });
  });

  it('refuses the WHOLE project when one file fails its proof', () => {
    const real = fileMigration.migrateFileToStartBreakpoints;
    const spy = vi.spyOn(fileMigration, 'migrateFileToStartBreakpoints').mockImplementation((code: string) => {
      const out = real(code);
      // Sabotage one file: drop its tablet band — the proof must catch the lost override.
      return code.includes('810') ? { ...out, code: out.code.replace(/color: green/, 'color: blue') } : out;
    });
    try {
      const r = migrateProjectToStartBreakpoints(PROJECT);
      expect(r.project).toBeNull();
      expect(r.refused.map((x) => x.path)).toEqual(['app/(site)/about/page.client.tsx']);
      expect(r.refused[0].problems.join('\n')).toMatch(/color: "green !important" → "blue !important"/);
    } finally {
      spy.mockRestore();
    }
  });

  it('does nothing to a project without breakpoints', () => {
    expect(migrateProjectToStartBreakpoints({ files: { 'app/page.tsx': `${canvas([1440])}\nexport default function P() { return null; }` } }).project).toBeNull();
    expect(migrateProjectToStartBreakpoints({}).project).toBeNull();
  });
});
