import { trace } from './debug-trace';
export interface GoogleFontRequest { family: string; axes: Record<string, number> }
/** Shared by native typography controls and deterministic source imports. */
export function addGoogleFontImportsToCss(css: string, requests: readonly GoogleFontRequest[]): string {
  trace.fn('google-font-import:add', { count: requests.length });
  const groups = new Map<string, { family: string; axes: string[]; tuples: number[][] }>();
  for (const request of requests) {
    const axes = Object.keys(request.axes).sort();
    if (!/^[\p{L}\p{N}][\p{L}\p{N} .-]{0,150}$/u.test(request.family) || axes.length > 16 || axes.some(axis => !/^[a-zA-Z]{4}$/.test(axis) || !Number.isFinite(request.axes[axis]) || Math.abs(request.axes[axis]) > 100000)) throw new Error('GOOGLE_FONT_REQUEST_INVALID');
    const key = JSON.stringify([request.family, axes]);
    const group = groups.get(key) ?? { family: request.family, axes, tuples: [] };
    group.tuples.push(axes.map(axis => request.axes[axis]));
    groups.set(key, group);
  }
  const lines: string[] = [];
  for (const [, group] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const tuples = [...new Map(group.tuples.map(tuple => [tuple.join(','), tuple])).values()].sort((a, b) => {
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
      return 0;
    });
    const family = encodeURIComponent(group.family).replace(/%20/g, '+');
    const spec = group.axes.length ? `:${group.axes.join(',')}@${tuples.map(tuple => tuple.join(',')).join(';')}` : '';
    const url = `https://fonts.googleapis.com/css2?family=${family}${spec}&display=swap`;
    if (url.length > 8192) throw new Error('GOOGLE_FONT_REQUEST_LIMIT');
    if (!css.includes(url)) lines.push(`@import url('${url}');`);
  }
  return lines.length ? `${lines.join('\n')}\n${css}` : css;
}
