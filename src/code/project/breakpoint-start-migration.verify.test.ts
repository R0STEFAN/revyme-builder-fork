// breakpoint-start-migration.verify.test.ts — REHEARSAL on real projects (not part of the normal suite).
//
// Runs the start-model migration over database dumps — in memory, nothing is written back — and
// proves, for every page, that each breakpoint's tile resolves EXACTLY what it resolved before
// (every width-keyed mechanism: see breakpoint-resolve.testkit), that nothing is left keyed at an
// old width, and what a page's TEMPLATE chrome shows on each of the page's tiles. Then reports
// what the migrated ranges give at in-between widths (the intended change).
//
// Skipped unless pointed at dumps (never commit one — it is user data). Comma-separated; both the
// migration-backup shape (`{ db: [{ table, id, original }] }`) and a single project (`{ files }`):
//   BREAKPOINT_DUMP=/path/a.json,/path/b.json [BREAKPOINT_SITE=<id prefix>] [BREAKPOINT_OUT=/dir] \
//     npx vitest run src/code/project/breakpoint-start-migration.verify.test.ts

import { describe, it, expect, vi } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename } from 'node:path';
vi.mock('@/shared/debug-trace', () => ({ trace: { action: vi.fn(), fn: vi.fn(), error: vi.fn(), dom: vi.fn(), state: vi.fn() } }));
import { migrateFileToStartBreakpoints } from './breakpoint-start-migration';
import { parseCanvasConfig } from './canvas-config';
import { renderWidth } from '@/shared/types';
import { resolveAll, diffResolutions, staleKeyHits, canon } from './breakpoint-proof';

const DUMPS = (process.env.BREAKPOINT_DUMP ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const SITE = process.env.BREAKPOINT_SITE;
/** Optional: write each migrated file's before/after here to diff by hand. */
const OUT = process.env.BREAKPOINT_OUT;

type Site = { id: string; table: string; files: Record<string, string> };

function loadSites(): Site[] {
  const out: Site[] = [];
  for (const path of DUMPS) {
    const dump = JSON.parse(readFileSync(path, 'utf8'));
    if (Array.isArray(dump.db)) {
      for (const row of dump.db) {
        if (SITE && !String(row.id).startsWith(SITE)) continue;
        const o = JSON.parse(row.original);
        const files = o?.files ?? Object.values(o ?? {}).find((v: any) => v && typeof v === 'object' && Object.keys(v).some((k) => k.endsWith('.tsx')));
        if (files) out.push({ id: row.id, table: row.table, files });
      }
    } else if (dump.files) {
      out.push({ id: basename(path, '.json'), table: 'file', files: dump.files });
    }
  }
  return out;
}

/** Why a file was not migrated (for the report). */
function skipReason(code: string): string {
  const cfg = parseCanvasConfig(code);
  if (!cfg) return 'no @canvas';
  if (cfg.viewports.length < 2) return 'single viewport';
  if (cfg.viewports.some((v) => typeof v.designWidth === 'number' && v.designWidth > 0)) return 'already start model (designWidth)';
  if (new Set(cfg.viewports.map((v) => v.width)).size < cfg.viewports.length) return 'REVIEW: duplicate widths';
  const primary = cfg.viewports.find((v) => v.isPrimary);
  if (primary && cfg.viewports.some((v) => v.width > primary.width)) return 'REVIEW: replica wider than primary';
  return 'contiguous already (nothing to move)';
}

/** The template (LayoutClient) a page renders inside: the nearest ancestor folder that has one. */
function templateOf(site: Site, pagePath: string): string | null {
  if (/LayoutClient\.tsx$/.test(pagePath) || !pagePath.startsWith('app/')) return null;
  let dir = pagePath.slice(0, pagePath.lastIndexOf('/'));
  while (dir) {
    const p = `${dir}/LayoutClient.tsx`;
    if (typeof site.files[p] === 'string') return p;
    dir = dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : '';
  }
  return null;
}

const ladderOf = (code: string) => (parseCanvasConfig(code)?.viewports ?? []).map((v) => v.width).sort((a, b) => b - a).join('/');
const PROBES = [320, 375, 393, 430, 600, 767, 768, 800, 810, 1000, 1200, 1439, 1440, 1920];

describe.skipIf(DUMPS.length === 0)('breakpoint start-model migration — rehearsal on dumps', () => {
  it('every breakpoint tile resolves exactly what it did before, on every page and template', () => {
    const sites = loadSites();
    expect(sites.length).toBeGreaterThan(0);
    const failures: string[] = [];
    const report: string[] = [];
    const skipped = new Map<string, number>();
    const templateNotes: string[] = [];
    const review: string[] = [];
    let filesMigrated = 0, templatePairs = 0, templatePairsSameLadder = 0;

    for (const site of sites) {
      const tag = `${site.table}:${site.id.slice(0, 8)}`;
      const migrated = new Map<string, string>();
      for (const [path, before] of Object.entries(site.files)) {
        if (!path.endsWith('.tsx') || typeof before !== 'string') continue;
        const { code: after, steps } = migrateFileToStartBreakpoints(before);
        migrated.set(path, after);
        if (steps.length === 0) {
          if (before.includes('@canvas')) {
            const why = skipReason(before);
            skipped.set(why, (skipped.get(why) ?? 0) + 1);
            // Left byte-identical — it keeps working exactly as today; listed for a human decision.
            if (why.startsWith('REVIEW')) review.push(`${tag} ${path}: ${why.slice(8)} (${ladderOf(before)}), width-keyed data: ${/@media|data-responsive|useMediaQuery|useResponsive|responsiveBp/.test(before) ? 'yes' : 'none'}`);
            if (after !== before) failures.push(`${tag} ${path}: skipped but changed`);
          }
          continue;
        }
        filesMigrated++;
        if (OUT) {
          const dir = `${OUT}/${site.table}_${site.id.slice(0, 8)}`;
          mkdirSync(dir, { recursive: true });
          const base = `${dir}/${path.replace(/[\\/()[\]]/g, '_')}`;
          writeFileSync(`${base}.before.tsx`, before);
          writeFileSync(`${base}.after.tsx`, after);
        }
        const oldCfg = parseCanvasConfig(before)!;
        const newCfg = parseCanvasConfig(after)!;
        for (const vp of oldCfg.viewports) {
          const nv = newCfg.viewports.find((v) => v.id === vp.id)!;
          if (renderWidth(vp) !== renderWidth(nv)) failures.push(`${tag} ${path} ${vp.id}: tile drawn at ${renderWidth(vp)} → ${renderWidth(nv)}`);
          const diff = diffResolutions(resolveAll(before, renderWidth(vp)), resolveAll(after, renderWidth(nv)));
          if (diff.length) failures.push(`${tag} ${path} ${vp.id} @${renderWidth(vp)}px:\n    ${diff.slice(0, 8).join('\n    ')}`);
        }
        for (const st of steps) for (const hit of staleKeyHits(after, st.oldEnd)) failures.push(`${tag} ${path}: ${hit}`);
        // The intended change: which breakpoint each probe width lands in now.
        const bandOf = (cfg: ReturnType<typeof parseCanvasConfig>, w: number) => {
          const nonPrimary = cfg!.viewports.filter((v) => !v.isPrimary).sort((x, y) => x.width - y.width);
          let lower = 0;
          for (const v of nonPrimary) { if (w > lower && w <= v.width) return v.id; lower = v.width; }
          return cfg!.viewports.find((v) => v.isPrimary)?.id ?? 'primary';
        };
        report.push(`${tag} ${path}  ${steps.map((s) => `${s.id} ${s.oldEnd}→${s.newEnd} (starts ${s.start})`).join(', ')}\n    ${PROBES.map((w) => `${w}:${bandOf(oldCfg, w)}→${bandOf(newCfg, w)}`).join('  ')}`);
      }

      // Template chrome on each page tile: the template's CSS / instances / gates / route values
      // evaluated at the PAGE's tile widths. Same ladder → must be identical. Different ladders →
      // the template follows the start model at the page's width (reported, not a failure).
      for (const [path, before] of Object.entries(site.files)) {
        const tplPath = templateOf(site, path);
        const pageCfg = typeof before === 'string' ? parseCanvasConfig(before) : null;
        if (!tplPath || !pageCfg || pageCfg.viewports.length < 2) continue;
        const tplBefore = site.files[tplPath];
        const tplAfter = migrated.get(tplPath) ?? tplBefore;
        const pageAfterCfg = parseCanvasConfig(migrated.get(path) ?? before)!;
        const same = ladderOf(before) === ladderOf(tplBefore);
        templatePairs++;
        if (same) templatePairsSameLadder++;
        for (const vp of pageCfg.viewports) {
          const nv = pageAfterCfg.viewports.find((v) => v.id === vp.id)!;
          const a = resolveAll(tplBefore, renderWidth(vp));
          const b = resolveAll(tplAfter, renderWidth(nv));
          if (JSON.stringify(canon(a)) === JSON.stringify(canon(b))) continue;
          const line = `${tag} ${path} (${ladderOf(before)}) in ${tplPath} (${ladderOf(tplBefore)}) ${vp.id} @${renderWidth(vp)}px:\n    ${diffResolutions(a, b).slice(0, 6).join('\n    ')}`;
          if (same) failures.push(`TEMPLATE ${line}`);
          else templateNotes.push(line);
        }
      }
    }

    console.log(`\n${filesMigrated} files migrated across ${sites.length} projects/snapshots (${DUMPS.length} dumps)`);
    console.log(`skipped: ${[...skipped].map(([k, n]) => `${k} ×${n}`).join(', ') || 'none'}`);
    console.log(`template on page tiles: ${templatePairs} page/template pairs, ${templatePairsSameLadder} with the same ladder`);
    if (templateNotes.length) console.log(`\nTEMPLATE CHROME CHANGES where the page and template ladders differ (${templateNotes.length} tiles):\n` + templateNotes.slice(0, 20).join('\n'));
    console.log('\n' + report.slice(0, 10).join('\n'));
    if (review.length) console.log(`\nNEEDS REVIEW — left unchanged (${review.length}):\n` + review.join('\n'));
    if (failures.length) console.log(`\nFAILURES (${failures.length}):\n` + failures.join('\n'));
    expect(failures).toEqual([]);
  }, 600_000);
});
