import { addWorkspaceFontFacesToCss, type WorkspaceFontFaceSpec } from '../project/preset-ops';
import { trace } from '../../shared/debug-trace';

/** Only canonical native font-face additions may cross the full-file import boundary. */
export function applyFramerFontFaces(css: string, faces: readonly WorkspaceFontFaceSpec[]): string {
  trace.fn('framer-native.applyFontFaces', { count: faces.length });
  const weight = (value: number) => Number.isFinite(value) && value > 0 && value <= 1000;
  for (const face of faces) {
    let hosted = false;
    try {
      const url = new URL(face.url, 'https://revyme.invalid');
      hosted = (face.url.startsWith('/api/uploads/') || face.url.startsWith('/assets/') || face.url.startsWith('https://')) && url.protocol === 'https:' && !url.username && !url.password && !/[\s'"\\{}()<>]/.test(face.url);
    } catch { /* malformed font URL */ }
    const ranges = face.unicodeRange?.split(',').map(range => range.trim());
    const validRange = (range: string) => {
      const match = /^U\+([0-9a-f]{1,6}(?:\?{1,5})?)(?:-([0-9a-f]{1,6}))?$/i.exec(range);
      if (!match || match[1].length > 6 || match[2] && match[1].includes('?')) return false;
      const start = parseInt(match[1].replace(/\?/g, '0'), 16), end = parseInt(match[2] ?? match[1].replace(/\?/g, 'f'), 16);
      return start <= end && end <= 0x10ffff;
    };
    if (!/^Framer framer-[a-z0-9-]+ \d+ [\p{L}\p{N}][\p{L}\p{N} _.-]{0,150}$/u.test(face.family) || !hosted || !['woff2', 'woff', 'otf', 'ttf'].includes(face.ext) || !['normal', 'italic'].includes(face.style) || !weight(face.weight) || face.weightRange && (!weight(face.weightRange.min) || !weight(face.weightRange.max) || face.weightRange.min > face.weightRange.max) || ranges && (!ranges.length || !ranges.every(validRange))) throw new Error('FRAMER_FONT_PATCH_INVALID');
  }
  // Reusing a name must never replace a destination project's existing typeface.
  let unrelated = css;
  for (const face of faces) {
    const rule = addWorkspaceFontFacesToCss('', [face]).match(/@font-face\s*\{[^}]*\}/)![0];
    unrelated = unrelated.split(rule).join('');
  }
  for (const face of faces) {
    const escaped = face.family.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`font-family\\s*:\\s*['"]?${escaped}['"]?\\s*;`, 'i').test(unrelated) || unrelated.includes(`family=${face.family.replace(/ /g, '+')}`) || unrelated.includes(`family=${encodeURIComponent(face.family)}`)) throw new Error('FRAMER_FONT_PATCH_COLLISION');
  }
  return addWorkspaceFontFacesToCss(css, [...faces]);
}
