// viewport-width-rewrite.ts — ONE entry point for "a viewport's breakpoint
// width changed": re-stamps every width-keyed artifact in the ACTIVE file.
// Shared by both width-change surfaces (the SizeTool breakpoint input and
// the SelectionOverlay tile drag) so they cannot drift apart.
//
// THE ACTIVE FILE ONLY — deliberately. A templated page's LayoutClient
// carries its own `/** @canvas */` widths, bands and gates, and those key
// off the TEMPLATE's breakpoints by design: on canvas AND on the published
// site the template chrome evaluates against the actual width with its own
// keys, so a page tile resized to 1110 correctly shows desktop chrome
// (1110 IS desktop for the template). An earlier version propagated the
// resize into the LayoutClient to "converge" the two files — which
// silently resized the template's own editing viewports ("when I increase
// the page's mobile it increases the width of the TEMPLATE, the template
// should be completely intact", 2026-08-18). The bug that motivated the
// propagation was actually the normalize-ordering destruction, fixed at
// the call sites (rewrite BEFORE the @canvas config write).

import { modifyProjectFile } from '@/code/project/modify-file';
import { getSortedBreakpointWidths } from '@/code/stores/viewport-store';
import {
  rewriteContainerBreakpoints,
  rewriteResponsiveBreakpoints,
  rewriteResponsiveTextBreakpoints,
} from '@/code/generation/generator-styles';
import { rewriteAnimationBreakpoints } from '@/code/animations/animation-scope';

/** Every width-keyed rewrite a width change needs, in one place: @media style
 *  bands, animation media-query gates (useMediaQuery consts, spec-attr
 *  `"query"` strings and SplitText's JS-literal `query: "…"`), component-
 *  instance `data-responsive` (per-viewport values + `_bp`, and the CMS list
 *  config), width-keyed `useResponsiveText`, overlay per-breakpoint config
 *  (`data-overlay` `responsive` + `responsiveBp`, and the open-variant
 *  `window.innerWidth <= W` chain) and template route keys (`name@W`). */
export function rewriteWidthKeyedArtifacts(code: string, oldWidth: number, newWidth: number): string {
  const widths = getSortedBreakpointWidths();
  const out = rewriteResponsiveTextBreakpoints(
    rewriteResponsiveBreakpoints(
      rewriteAnimationBreakpoints(
        rewriteContainerBreakpoints(code, oldWidth, newWidth),
        oldWidth, newWidth, widths),
      oldWidth, newWidth, widths),
    oldWidth, newWidth, widths);
  return rewriteRouteKeyBreakpoints(rewriteOverlayBreakpoints(out, oldWidth, newWidth), oldWidth, newWidth);
}

/** Overlay per-breakpoint config: `data-overlay='{…"responsive":{"768":…},"responsiveBp":[…]}'`,
 *  plus the open-variant chain generated from it (`window.innerWidth <= 768 ? 'a' : …`). Left
 *  under the old width, the runtime's `bps.filter(b => ww <= b)` bucketed the resized viewport
 *  onto the wrong override. */
export function rewriteOverlayBreakpoints(code: string, oldWidth: number, newWidth: number): string {
  if (oldWidth === newWidth || !code.includes('data-overlay=')) return code;
  let out = code.replace(/data-overlay='(\{[^']*\})'/g, (full, json: string) => {
    let cfg: { responsive?: Record<string, unknown>; responsiveBp?: number[] };
    try { cfg = JSON.parse(json); } catch { return full; }
    let changed = false;
    const k = String(oldWidth);
    if (cfg.responsive && cfg.responsive[k] !== undefined) {
      const into = cfg.responsive[String(newWidth)];
      cfg.responsive[String(newWidth)] = into && typeof into === 'object' ? { ...into, ...(cfg.responsive[k] as object) } : cfg.responsive[k];
      delete cfg.responsive[k];
      changed = true;
    }
    if (Array.isArray(cfg.responsiveBp) && cfg.responsiveBp.includes(oldWidth)) {
      cfg.responsiveBp = cfg.responsiveBp.map((w) => (w === oldWidth ? newWidth : w));
      changed = true;
    }
    return changed ? `data-overlay='${JSON.stringify(cfg)}'` : full;
  });
  out = out.replace(new RegExp(`window\\.innerWidth\\s*<=\\s*${oldWidth}\\b`, 'g'), `window.innerWidth <= ${newWidth}`);
  return out;
}

/** Template route values set for ONE breakpoint: `'headerVariant@768'` keys in the
 *  LayoutClient's `__templateProps` map (their gates move with rewriteAnimationBreakpoints). */
export function rewriteRouteKeyBreakpoints(code: string, oldWidth: number, newWidth: number): string {
  if (oldWidth === newWidth || !code.includes('__templateProps') || !code.includes(`@${oldWidth}`)) return code;
  return code.replace(new RegExp(`(["'])([A-Za-z_$][\\w$]*)@${oldWidth}\\1`, 'g'), (_m, q: string, name: string) => `${q}${name}@${newWidth}${q}`);
}

/**
 * Apply a viewport width change to the active file. Callers keep their own
 * atom updates (viewportWidthsAtom / viewportsConfigAtom) — this owns only
 * the source rewrite, and MUST run before the @canvas config write (see the
 * call-site comments: normalize keys off the file's own config).
 */
export function applyViewportWidthChange(activeFilePath: string, vpId: string, oldWidth: number, newWidth: number): void {
  void vpId; // kept for call-site symmetry with the drag path's resizedVpId
  if (oldWidth === newWidth) return;
  modifyProjectFile(activeFilePath, code => rewriteWidthKeyedArtifacts(code, oldWidth, newWidth));
}
