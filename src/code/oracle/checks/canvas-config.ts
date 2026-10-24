// oracle/checks/canvas-config.ts — @canvas viewport config rules (pages).
// All code moved VERBATIM from check-file.ts (Phase 7.1 god-file split).

import type { OracleViolation } from './shared';

/** @canvas VIEWPORT CONFIG — the page's breakpoint tiles. The block is a
 *  JSON comment the canvas parses literally:
 *    /** @canvas { "viewports": [{ "id", "label", "width", "height"?,
 *    "isPrimary", "order" }...], "positions": { "<id>": { "x", "y" } } } *\/
 *  Models may EDIT it to ADD viewports (e.g. tablet 810 / mobile 390) but the
 *  shape must stay valid: exactly one primary, unique ids, a positions entry
 *  per viewport. */
function checkCanvasConfig(code: string, v: OracleViolation[]): void {
  const m = code.match(/\/\*\*\s*@canvas\s*([\s\S]*?)\*\//);
  // The default ladder (Desktop 1200 / Tablet 810 / Mobile 390). A model writes each breakpoint's
  // number as its `width`; the gate converts the page to the start model on write.
  const CANONICAL = `/** @canvas { "viewports": [ { "id": "desktop", "label": "Desktop", "width": 1200, "height": "auto", "isPrimary": true, "order": 0 }, { "id": "tablet", "label": "Tablet", "width": 810, "height": "auto", "isPrimary": false, "order": 1 }, { "id": "mobile", "label": "Mobile", "width": 390, "height": "auto", "isPrimary": false, "order": 2 } ], "positions": { "desktop": { "x": 0, "y": 0 }, "tablet": { "x": 1360, "y": 0 }, "mobile": { "x": 2330, "y": 0 } } } */`;
  if (!m) {
    v.push({
      code: 'CANVAS_CONFIG_MISSING', tier: 2,
      message: `The page has no /** @canvas { … } */ block — the canvas reads its viewport tiles from it; without it the page renders a single default tile and responsive overrides have nothing to key on. Add it as the first block after 'use client', e.g.: ${CANONICAL}`,
    });
    return;
  }
  let cfg: { viewports?: Array<Record<string, unknown>>; positions?: Record<string, unknown> };
  try { cfg = JSON.parse(m[1]); } catch {
    v.push({
      code: 'CANVAS_CONFIG_INVALID', tier: 2,
      message: `The /** @canvas */ block is not valid JSON — the canvas silently ignores it and the page collapses to one default tile. Canonical shape: ${CANONICAL}`,
    });
    return;
  }
  const vps = Array.isArray(cfg.viewports) ? cfg.viewports : [];
  const problems: string[] = [];
  // An EMPTY viewports array is valid — the canvas falls back to the default
  // viewport set. The shape checks below apply to declared entries only.
  const ids = new Set<string>();
  let primaries = 0;
  for (const vp of vps) {
    const id = typeof vp.id === 'string' ? vp.id : '';
    if (!id) problems.push('a viewport entry is missing its "id"');
    else if (ids.has(id)) problems.push(`duplicate viewport id "${id}"`);
    ids.add(id);
    if (typeof vp.width !== 'number' || vp.width <= 0) problems.push(`viewport "${id}" needs a positive numeric "width"`);
    if (vp.isPrimary === true) primaries++;
    if (typeof vp.label !== 'string' || !vp.label) problems.push(`viewport "${id}" needs a "label"`);
  }
  if (vps.length > 0 && primaries !== 1) problems.push(`exactly ONE viewport must have "isPrimary": true (found ${primaries})`);
  const positions = (cfg.positions ?? {}) as Record<string, unknown>;
  for (const id of ids) {
    const pos = positions[id] as Record<string, unknown> | undefined;
    if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') {
      problems.push(`positions["${id}"] must be { "x": <number>, "y": <number> } (place new viewports to the RIGHT of existing ones: x = previous x + previous width + ~120)`);
    }
  }
  if (problems.length > 0) {
    v.push({
      code: 'CANVAS_CONFIG_INVALID', tier: 2,
      message: `The /** @canvas */ block has ${problems.length} problem(s):\n- ${problems.join('\n- ')}\nCanonical shape: ${CANONICAL}`,
    });
  }

  // CANVAS_VIEWPORT_BREAKPOINT_MISMATCH — responsive rules need a canvas tile
  // on which that rule actually applies. A max-width media query is covered
  // by ANY declared viewport at or below its threshold (e.g. width 810 previews
  // max-width 1199); data-responsive `_bp` entries are exact viewport widths.
  if (vps.length > 0) {
    const vpWidths = new Set(vps.map((vp) => (typeof vp.width === 'number' ? vp.width : -1)));
    const maxWidthBreakpoints = new Set<number>();
    const exactBreakpoints = new Set<number>();
    for (const mm of code.matchAll(/@media[^{]*max-width:\s*(\d+(?:\.\d+)?)px/g)) {
      maxWidthBreakpoints.add(Math.round(parseFloat(mm[1])));
    }
    for (const bp of code.matchAll(/"_bp"\s*:\s*\[([^\]]*)\]/g)) {
      for (const n of bp[1].split(',')) {
        const w = Math.round(parseFloat(n));
        if (Number.isFinite(w)) exactBreakpoints.add(w);
      }
    }
    const configuredWidths = [...vpWidths].filter((w) => w > 0);
    const missing = [
      ...[...maxWidthBreakpoints].filter((w) => w > 0 && !configuredWidths.some((width) => width <= w)),
      ...[...exactBreakpoints].filter((w) => w > 0 && !vpWidths.has(w)),
    ].filter((w, i, all) => all.indexOf(w) === i);
    if (missing.length > 0) {
      v.push({
        code: 'CANVAS_VIEWPORT_BREAKPOINT_MISMATCH', tier: 2,
        message: `The page styles breakpoint width(s) ${missing.sort((a, b) => b - a).map((w) => `${w}px`).join(', ')} (@media max-width / data-responsive "_bp") but the /** @canvas */ block declares no viewport at those widths — the responsive styles work on the live site, yet the canvas shows NO tile to preview or edit them. Add a viewport entry (+ a positions entry, to the RIGHT of existing tiles) for each breakpoint, e.g. tablet 810 / mobile 390 as in: ${CANONICAL}`,
      });
    }
  }

  // CANVAS_VIEWPORT_FIXED_HEIGHT — a viewport with a fixed PIXEL height locks
  // its canvas tile to that height; content taller than it is CLIPPED (the
  // "my page cuts off at 900px" trap). Content-driven pages must grow with
  // their content, so the viewport height should be "auto" (or omitted).
  // A fixed number is only correct for a deliberately fixed-size artboard.
  const fixedH = vps.filter((vp) => typeof vp.height === 'number' && vp.height > 0).map((vp) => (typeof vp.id === 'string' ? vp.id : '?'));
  if (fixedH.length > 0) {
    v.push({
      code: 'CANVAS_VIEWPORT_FIXED_HEIGHT', tier: 2,
      message: `Viewport(s) ${fixedH.map((id) => `"${id}"`).join(', ')} declare a fixed pixel "height" — the canvas tile is locked to it and any content past that height is CLIPPED. Set "height": "auto" on each viewport (or omit "height") so the tile grows with the page. Use a numeric height ONLY for an intentionally fixed-size artboard.`,
    });
  }
}


export { checkCanvasConfig };
