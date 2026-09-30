// reraster.ts — make self-promoted canvas layers re-rasterize at the zoom the
// camera settled on.
//
// Chrome keeps a `will-change: transform` layer at the scale it was first
// rasterized, whatever its ancestors do — the rule behind the camera's own
// gesture hint (will-change on the content root during a zoom, cleared at
// idle so the content re-rasters sharp). Content that promotes ITSELF stays
// on its old bitmap, blurry at any zoom above it:
//   · the variant perf isolation — `contain` + `willChange: 'transform'`
//     stamped into a component root's source (code/variants/variant-perf.ts),
//     so every INSTANCE of that component on the canvas carries it too;
//   · code components that promote an animated track (a Marquee);
//   · any stylesheet rule the page's own CSS declares will-change in.
//
// Drop each one to `will-change: auto` for two frames, then put back what it
// had: Chrome rasterizes the layer at the current scale when it is promoted
// again. The source and the live site are untouched.
//
// LEAF module (DOM only): it runs INSIDE the canvas iframe (the sandbox's
// camera settle, canvas-sandbox/bridge-sandbox.ts) — the viewports live
// there, not in the editor document.

/** Elements under `roots` that promote themselves with will-change: inline
 *  styles, and elements matched by a stylesheet rule that declares it. */
export function promotedDescendants(roots: Iterable<HTMLElement>, doc: Document = document): HTMLElement[] {
  const found = new Set<HTMLElement>();
  const rootList = [...roots];
  for (const root of rootList) {
    for (const el of root.querySelectorAll<HTMLElement>('[style*="will-change"]')) {
      const v = el.style.willChange;
      if (v && v !== 'auto') found.add(el);
    }
  }
  for (const selector of willChangeSelectors(doc)) {
    for (const root of rootList) {
      let matches: NodeListOf<HTMLElement>;
      try { matches = root.querySelectorAll<HTMLElement>(selector); } catch { continue; }
      for (const el of matches) found.add(el);
    }
  }
  return [...found];
}

const DECLARES_WILL_CHANGE = /will-change\s*:\s*(?!auto\b)[a-z-]/i;

/** Selectors of every style rule (nested in @media / @container / @layer
 *  included) that sets will-change to something other than auto. */
export function willChangeSelectors(doc: Document = document): string[] {
  const out: string[] = [];
  const walk = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      const style = (rule as CSSStyleRule).style;
      const selector = (rule as CSSStyleRule).selectorText;
      if (selector && style && DECLARES_WILL_CHANGE.test(style.cssText)) out.push(selector);
      const nested = (rule as CSSGroupingRule).cssRules;
      if (nested && nested.length) walk(nested);
    }
  };
  for (const sheet of Array.from(doc.styleSheets)) {
    let rules: CSSRuleList;
    try { rules = sheet.cssRules; } catch { continue; }   // cross-origin sheet
    walk(rules);
  }
  return out;
}

/** Toggle every self-promoted descendant off for two frames. Returns how
 *  many were toggled. Exported for tests. */
export function rerasterPromotedDescendants(
  roots: Iterable<HTMLElement>,
  nextFrame: (cb: () => void) => void = (cb) => requestAnimationFrame(() => requestAnimationFrame(cb)),
  doc: Document = document,
): number {
  const restore: Array<[HTMLElement, string]> = [];
  for (const el of promotedDescendants(roots, doc)) {
    if (el.style.willChange === 'auto') continue;   // already toggled by an overlapping settle
    restore.push([el, el.style.willChange]);          // '' when the value comes from a stylesheet
    el.style.willChange = 'auto';
  }
  if (restore.length) {
    nextFrame(() => {
      // Only put back what nobody changed in between (a drag ending clears it).
      for (const [el, v] of restore) if (el.style.willChange === 'auto') el.style.willChange = v;
    });
  }
  return restore.length;
}
