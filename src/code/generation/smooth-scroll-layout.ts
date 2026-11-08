/**
 * smooth-scroll-layout.ts — the PURE half of the Smooth Scroll codegen: file
 * paths and the idempotent `<SmoothScroll />` mount in the root layout. No
 * ProjectFS import, so project-fs's load-time heal can use it without a cycle.
 */

import { trace } from '@/shared/debug-trace';

export const SMOOTH_SCROLL_DATA_PATH = 'app/smooth-scroll.ts';
export const SMOOTH_SCROLL_CONTROLLER_PATH = 'app/smooth-scroll-controller.tsx';

const SMOOTH_SCROLL_IMPORT = `import { SmoothScroll } from './smooth-scroll-controller';`;

/** Mount `<SmoothScroll />` once as the first child of `<body>` + add the import.
 *  Idempotent; pure (returns the input when there is no `<body>`). */
export function ensureSmoothScrollInLayout(layoutCode: string): string {
  if (layoutCode.includes('<SmoothScroll')) return layoutCode;
  const body = /<body\b[^>]*>/.exec(layoutCode);
  if (!body) return layoutCode;
  const lineStart = layoutCode.lastIndexOf('\n', body.index) + 1;
  const indent = layoutCode.slice(lineStart, body.index).match(/^\s*/)![0];
  const at = body.index + body[0].length;
  let next = layoutCode.slice(0, at) + `\n${indent}  <SmoothScroll />` + layoutCode.slice(at);
  if (!/import\s*\{[^}]*\bSmoothScroll\b[^}]*\}\s*from\s*['"]\.\/smooth-scroll-controller['"]/.test(next)) {
    const lastImport = next.lastIndexOf('\nimport ');
    if (lastImport !== -1) {
      const eol = next.indexOf('\n', lastImport + 1);
      const pos = eol === -1 ? next.length : eol;
      next = next.slice(0, pos) + `\n${SMOOTH_SCROLL_IMPORT}` + next.slice(pos);
    } else {
      next = `${SMOOTH_SCROLL_IMPORT}\n${next}`;
    }
  }
  trace.action('smooth-scroll-gen:mount', {});
  return next;
}
