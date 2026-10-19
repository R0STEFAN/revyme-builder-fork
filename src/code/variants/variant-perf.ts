// variant-perf.ts — perf isolation for design components whose VARIANTS
// animate expensive properties.
//
// the reference tweens variant values directly: layout props (left/top/width/…)
// reflow every frame, and paint-heavy props (filter/boxShadow/gradients)
// re-rasterize every frame. On a large page those per-frame invalidations
// cascade into document-wide Layout / Layerize / Commit work — a tiny
// auto-cycling component measurably janked a 700-node live page (the
// Illustration/Chat find, profiled: Commit 54ms + Layerize 26ms/frame).
//
// The cure is to isolate the component: `contain: 'layout paint'` bounds
// both reflow and paint invalidation to the component's box, and
// `willChange: 'transform'` pins it onto its own compositor layer so its
// repaints never touch the page's layer tree. Component roots already
// carry overflow:'hidden' (artboard rule), so paint containment clips
// nothing new.
//
// NOT applied blanket-wise: every promoted layer holds a GPU texture
// (w×h×4×DPR²) — isolation only pays when the animated props are in the
// heavy sets below. Composite-safe animators (x/y/scale/rotate/opacity)
// and paint-light ones (colors/borderRadius) stay unpromoted.

import { trace } from '@/shared/debug-trace';

/** Per-frame REFLOW when tweened. */
export const LAYOUT_ANIMATED_PROPS = new Set([
  'left', 'top', 'right', 'bottom', 'inset',
  'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight',
  'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'gap', 'rowGap', 'columnGap', 'fontSize', 'lineHeight', 'letterSpacing',
  'borderWidth', 'flexBasis',
]);

/** Per-frame expensive RASTER when tweened. */
export const PAINT_HEAVY_ANIMATED_PROPS = new Set([
  'filter', 'backdropFilter', 'boxShadow', 'textShadow',
  'backgroundImage', 'clipPath', 'maskImage', 'WebkitMaskImage',
]);

export function isHeavyAnimatedProp(prop: string): boolean {
  return LAYOUT_ANIMATED_PROPS.has(prop) || PAINT_HEAVY_ANIMATED_PROPS.has(prop);
}

/** True when any `const xxxVariants = {…}` object in the file animates a
 *  heavy prop in a NON-default entry (the default entry mirrors the base —
 *  only the presence of a heavy prop across states means it TWEENS). */
export function variantsAnimateHeavyProps(code: string): boolean {
  const declRe = /const\s+\w+Variants\s*=\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = declRe.exec(code)) !== null) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let close = -1;
    for (let i = open; i < code.length; i++) {
      if (code[i] === '{') depth++;
      else if (code[i] === '}') { depth--; if (depth === 0) { close = i; break; } }
    }
    if (close < 0) continue;
    const body = code.slice(open + 1, close);
    // keys inside the variant entries
    for (const keyMatch of body.matchAll(/(?:^|[{,])\s*'?([A-Za-z][\w]*)'?\s*:/g)) {
      if (isHeavyAnimatedProp(keyMatch[1])) return true;
    }
  }
  return false;
}

const ISOLATION_SNIPPET = "contain: 'layout paint', willChange: 'transform', ";

function rootHasVisibleOverflow(code: string, styleBody: string, rootId: string): boolean {
  if (/overflow(?:X|Y)?\s*:\s*['"]visible['"]/.test(styleBody)) return true;
  // Look for variants attribute on root tag
  const rootTagFull = code.match(new RegExp(`<motion\\.\\w+[^>]*data-id="${rootId}"[^>]*>`, 's'));
  if (rootTagFull) {
    const varMatch = rootTagFull[0].match(/variants=\{([A-Za-z0-9_]+)\}/);
    if (varMatch) {
      const varDecl = code.match(new RegExp(`const\\s+${varMatch[1]}\\s*=\\s*\\{`));
      if (varDecl && varDecl.index !== undefined) {
        const open = varDecl.index + varDecl[0].length - 1;
        let depth = 0;
        let close = -1;
        for (let i = open; i < code.length; i++) {
          if (code[i] === '{') depth++;
          else if (code[i] === '}') { depth--; if (depth === 0) { close = i; break; } }
        }
        if (close > 0) {
          const varBody = code.slice(open + 1, close);
          if (/overflow(?:X|Y)?\s*:\s*['"]visible['"]/.test(varBody)) return true;
        }
      }
    }
  }
  return false;
}

const SNIPPET_RE = /contain:\s*['"]layout paint['"],?\s*willChange:\s*['"]transform['"],?\s*/;

/** BIDIRECTIONAL perf-isolation maintenance on the component ROOT (the
 *  first data-id-bearing motion element — LayoutGroup/MotionConfig wrappers
 *  carry no data-id). Idempotent both ways:
 *    • variants animate a heavy prop → inject the pair if absent.
 *    • no heavy props remain (the user removed/retuned the animation) →
 *      remove EXACTLY the pair we injected, so the stale layer promotion
 *      stops costing GPU texture memory. A hand-authored `contain` in any
 *      other form is never touched (conservative: we only ever delete our
 *      own contiguous snippet). */
export function ensureRootPerfIsolation(code: string): string {
  const rootTag = code.match(/<motion\.\w+[^>]*data-id="([^"]+)"[^>]*style=\{\{/s);
  if (!rootTag || rootTag.index === undefined) return code;
  const rootId = rootTag[1];
  const styleOpen = rootTag.index + rootTag[0].length;
  let depth = 2;
  let end = styleOpen;
  for (let i = styleOpen; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  const styleBody = code.slice(styleOpen, end);

  // Overlays (data-overlay) rely on position: fixed to escape component overflow and
  // align to the viewport. Applying `contain: paint` or `willChange: transform` creates
  // a containing block for fixed descendants, trapping and clipping the overlay.
  //
  // Similarly, components with visible overflow (`overflow: visible` or visible overflow
  // in root variants) rely on children rendering outside component bounds (dropdown menus,
  // tooltips, popovers, overflowing frames). Applying `contain: paint` acts as
  // `overflow: clip` per CSS Containment spec, forcibly clipping all descendants.
  const hasVisibleOverflow = rootHasVisibleOverflow(code, styleBody, rootId);
  const heavy = variantsAnimateHeavyProps(code) && !code.includes('data-overlay') && !hasVisibleOverflow;

  if (heavy) {
    if (styleBody.includes('contain:')) return code;
    trace.action('variant-perf:root-isolation-injected', {});
    return code.slice(0, styleOpen) + ' ' + ISOLATION_SNIPPET + code.slice(styleOpen);
  }

  // No heavy animated props, or has overlay/visible overflow → drop OUR snippet if present.
  const snippetMatch = styleBody.match(SNIPPET_RE);
  if (!snippetMatch || snippetMatch.index === undefined) return code;
  trace.action('variant-perf:root-isolation-removed', {});
  const abs = styleOpen + snippetMatch.index;
  const removeEnd = abs + snippetMatch[0].length;
  let removeStart = abs;
  // swallow leading whitespace/newline up to styleOpen or line start
  while (removeStart > styleOpen && code[removeStart - 1] === ' ') removeStart--;
  return code.slice(0, removeStart) + (code[removeStart - 1] === '\n' ? '' : ' ') + code.slice(removeEnd).replace(/^\s+/, '');
}
