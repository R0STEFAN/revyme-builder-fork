// @vitest-environment node
// breakpoint-canvas.verify.test.ts — REHEARSAL in a real browser (not part of the normal suite).
//
// The migration keeps each tile drawn at the same width, but moves its band from the TOP of the
// range to the BOTTOM of it — and a canvas tile's container measures inside the root's own
// padding/border. This renders every migrated page of the dumps in headless Chromium, the way the
// canvas does (tile root = query container at its drawn width, border-box, its real padding), and
// compares every overridden property of every element on every tile: before the migration vs after
// it with the drawn-ladder queries. Also reports what the canvas would show WITHOUT them.
//
//   BREAKPOINT_DUMP=/path/a.json,… BREAKPOINT_CHROMIUM=1 npx vitest run src/code/project/breakpoint-canvas.verify.test.ts

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
vi.mock('@/shared/debug-trace', () => ({ trace: { action: vi.fn(), fn: vi.fn(), error: vi.fn(), dom: vi.fn(), state: vi.fn() } }));
import { migrateFileToStartBreakpoints } from './breakpoint-start-migration';
import { parseCanvasConfig } from './canvas-config';
import { renderWidth } from '@/shared/types';
import { mediaToCanvasContainer } from '@/shared/canvas-band-queries';
import { resolveContainerQueryUnits } from '@/shared/responsive-units';
import { cssAt } from './breakpoint-proof';

const DUMPS = (process.env.BREAKPOINT_DUMP ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const RUN = DUMPS.length > 0 && !!process.env.BREAKPOINT_CHROMIUM;

function loadFiles(): Array<{ tag: string; path: string; code: string }> {
  const out: Array<{ tag: string; path: string; code: string }> = [];
  for (const dumpPath of DUMPS) {
    const dump = JSON.parse(readFileSync(dumpPath, 'utf8'));
    const rows = Array.isArray(dump.db) ? dump.db : [{ table: 'file', id: basename(dumpPath, '.json'), original: JSON.stringify(dump) }];
    for (const row of rows) {
      const files = JSON.parse(row.original)?.files ?? {};
      for (const [path, code] of Object.entries(files)) {
        if (path.endsWith('.tsx') && typeof code === 'string' && code.includes('@canvas')) out.push({ tag: `${row.table}:${String(row.id).slice(0, 8)}`, path, code });
      }
    }
  }
  return out;
}

const styleOf = (code: string) => /<style>\s*\{[`']([\s\S]*?)[`']\}\s*<\/style>/.exec(code)?.[1] ?? '';

/** The root element of the page component and its horizontal padding/border decls (inline style). */
function rootOf(code: string): { id: string; decls: string } | null {
  const i = code.indexOf('export default function');
  const j = code.indexOf('return', i);
  const m = /<[A-Za-z][\w.]*\s[^>]*?data-id="([^"]+)"/.exec(code.slice(j));
  if (!m) return null;
  const tagAt = j + m.index;
  const style = /style=\{\{([\s\S]*?)\}\}/.exec(code.slice(tagAt, tagAt + 4000))?.[1] ?? '';
  const decls: string[] = [];
  for (const d of style.matchAll(/(padding(?:Left|Right|Inline)?|border(?:Left|Right)?(?:Width)?)\s*:\s*['"]([^'"]+)['"]/g)) {
    decls.push(`${d[1].replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}: ${d[2]}`);
  }
  return { id: m[1], decls: decls.join('; ') };
}

/** Canvas CSS the way Renderer builds it (plain rename, or the drawn-width ladder). */
function canvasCss(code: string, drawn: number[], ladder: boolean, stored: number[]): string {
  const css = mediaToCanvasContainer(styleOf(code), ladder ? drawn : null);
  return resolveContainerQueryUnits(css, ladder ? [...drawn].sort((a, b) => a - b) : [...stored].sort((a, b) => a - b), { drawnLadder: ladder });
}

describe.skipIf(!RUN)('breakpoint start-model migration — canvas tiles in Chromium', () => {
  it('every migrated page paints every tile exactly as before', async () => {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1600, height: 800 } });
    const failures: string[] = [];
    let pages = 0, tilesChecked = 0, propsChecked = 0, unfixedDiffs = 0;
    const unfixedExamples: string[] = [];
    try {
      for (const f of loadFiles()) {
        const { code: after, steps } = migrateFileToStartBreakpoints(f.code);
        if (steps.length === 0) continue;
        const root = rootOf(f.code);
        if (!root) continue;
        const beforeVps = parseCanvasConfig(f.code)!.viewports;
        const afterVps = parseCanvasConfig(after)!.viewports;
        const drawn = afterVps.map((v) => renderWidth(v));
        // Elements to probe: every simple [data-id] selector a band styles (the root itself is
        // styled inline by the renderer, not by a container query on itself).
        const ids = new Set<string>();
        const props = new Map<string, Set<string>>();
        for (const m of styleOf(f.code).matchAll(/\[data-id="([^"]+)"\]\s*\{([^}]*)\}/g)) {
          if (m[1] === root.id) continue;
          ids.add(m[1]);
          const set = props.get(m[1]) ?? new Set<string>();
          for (const d of m[2].split(';')) { const k = d.slice(0, d.indexOf(':')).trim(); if (k && !k.startsWith('--')) set.add(k); }
          props.set(m[1], set);
        }
        if (ids.size === 0) continue;
        pages++;
        const variants = {
          before: canvasCss(f.code, beforeVps.map((v) => renderWidth(v)), false, beforeVps.map((v) => v.width)),
          fixed: canvasCss(after, drawn, true, afterVps.map((v) => v.width)),
          unfixed: canvasCss(after, drawn, false, afterVps.map((v) => v.width)),
        };
        const results: Record<string, Record<string, string>> = {};
        for (const [name, css] of Object.entries(variants)) {
          const tiles = beforeVps.map((vp, i) => {
            const w = renderWidth(vp);
            // The root's effective padding/border at this tile: base inline + the band the tile paints.
            const band = cssAt(f.code, w);
            const rootBand = Object.entries(band).filter(([k]) => k.startsWith(`[data-id="${root.id}"] :: `) && /padding|border/.test(k))
              .map(([k, v]) => `${k.split(' :: ')[1]}: ${v.replace(/\s*!important/, '')}`).join('; ');
            const kids = [...ids].map((id) => `<div data-id="${id}">x</div>`).join('');
            return `<div data-viewport="${vp.id}" style="position:absolute; top:${i * 300}px; left:0; width:${w}px; container-type:inline-size; ${root.decls}; ${rootBand}">${kids}</div>`;
          }).join('');
          await page.setContent(`<!doctype html><html lang="en"><head><style>* { margin: 0; padding: 0; box-sizing: border-box; }\n${css}</style></head><body>${tiles}</body></html>`);
          results[name] = await page.evaluate((spec: Array<[string, string[]]>) => {
            const out: Record<string, string> = {};
            for (const tile of Array.from(document.querySelectorAll('[data-viewport]'))) {
              for (const [id, list] of spec) {
                const el = tile.querySelector(`[data-id="${id}"]`);
                if (!el) continue;
                const cs = getComputedStyle(el);
                for (const p of list) out[`${tile.getAttribute('data-viewport')} ${id} ${p}`] = cs.getPropertyValue(p);
              }
            }
            return out;
          }, [...props].map(([id, s]) => [id, [...s]] as [string, string[]]));
        }
        tilesChecked += beforeVps.length;
        for (const [k, v] of Object.entries(results.before)) {
          propsChecked++;
          if (results.fixed[k] !== v) failures.push(`${f.tag} ${f.path} ${k}: ${v} → ${results.fixed[k]}`);
          if (results.unfixed[k] !== v) { unfixedDiffs++; if (unfixedExamples.length < 8) unfixedExamples.push(`${f.tag} ${f.path} ${k}: ${v} → ${results.unfixed[k]}`); }
        }
      }
    } finally {
      await browser.close();
    }
    console.log(`\nChromium: ${pages} migrated pages, ${tilesChecked} tiles, ${propsChecked} element×property checks`);
    console.log(`without the drawn-ladder queries: ${unfixedDiffs} differences${unfixedExamples.length ? `\n  ${unfixedExamples.join('\n  ')}` : ''}`);
    if (failures.length) console.log(`\nFAILURES (${failures.length}):\n` + failures.slice(0, 40).join('\n'));
    expect(failures).toEqual([]);
  }, 600_000);
});
