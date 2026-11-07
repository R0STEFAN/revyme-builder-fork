import type { GoogleFontRequest } from '../../../shared/google-font-import';
import { parseFragment, type DefaultTreeAdapterTypes } from 'parse5';
import { parseStyleString } from '../../../shared/css-utils';
import { isSourceCodeComponent } from './source-graph';
import type { SourceGraph, TransferDiagnostic } from './types';
import { trace } from '../../../shared/debug-trace';
export function parseSourceGoogleFont(value: string, variationAxes?: unknown): GoogleFontRequest | undefined {
  if (value.startsWith('FR;') || value.startsWith('Inter-') || value === 'Inter') {
    const raw = value.startsWith('FR;') ? value.slice(3) : value;
    const [famPart, variantPart] = raw.includes('-') ? raw.split('-', 2) : [raw, 'Regular'];
    let family = famPart.replace(/Display$/, '');
    if (!family) family = 'Inter';
    const weightMap: Record<string, number> = {
      thin: 100,
      extralight: 200,
      ultralight: 200,
      light: 300,
      regular: 400,
      book: 400,
      medium: 500,
      semibold: 600,
      demibold: 600,
      bold: 700,
      extrabold: 800,
      ultrabold: 800,
      black: 900,
      heavy: 900,
    };
    const varLower = (variantPart || 'Regular').toLowerCase();
    const isItalic = varLower.includes('italic');
    const cleanVar = varLower.replace('italic', '');
    const wght = weightMap[cleanVar] ?? (parseInt(cleanVar, 10) || 400);
    const axes: Record<string, number> = { wght };
    if (isItalic) axes.ital = 1;
    return { family, axes };
  }
  const match = /^GF;(.+?)-(variable-)?(regular|italic|[1-9]\d{1,3}(?:italic)?)(?:VF=([A-Za-z0-9+/]+=*))?$/.exec(value);
  if (!match) return;
  const [, family, variable, variant, encoded] = match;
  const axes: Record<string, number> = { wght: parseInt(variant, 10) || 400 };
  if (variant.endsWith('italic')) axes.ital = 1;
  if (encoded) {
    if (!variable) return;
    let decoded: string;
    try { decoded = atob(encoded); } catch { return; }
    if (!/^"[a-zA-Z]{4}" [+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:, "[a-zA-Z]{4}" [+-]?(?:\d+(?:\.\d+)?|\.\d+))*$/.test(decoded)) return;
    const seen = new Set<string>();
    for (const axis of decoded.matchAll(/"([a-zA-Z]{4})" ([+-]?(?:\d+(?:\.\d+)?|\.\d+))/g)) {
      if (seen.has(axis[1])) return;
      seen.add(axis[1]);
      axes[axis[1]] = Number(axis[2]);
    }
  }
  if (variationAxes !== undefined) {
    if (!variable || !variationAxes || typeof variationAxes !== 'object' || Array.isArray(variationAxes)) return;
    for (const [axis, axisValue] of Object.entries(variationAxes)) {
      if (!/^[a-zA-Z]{4}$/.test(axis) || typeof axisValue !== 'number' || !Number.isFinite(axisValue)) return;
      axes[axis] = axisValue;
    }
  }
  if (axes.wght <= 0 || axes.wght > 1000 || axes.ital !== undefined && axes.ital !== 0 && axes.ital !== 1) return;
  return { family, axes };
}

export function sourceGoogleFontRequests(graph: Pick<SourceGraph, 'nodes' | 'reachable'>): { requests: GoogleFontRequest[]; diagnostics: TransferDiagnostic[] } {
  trace.fn('framer-native.googleFonts', { nodes: graph.reachable.size });
  const requests: GoogleFontRequest[] = [], diagnostics: TransferDiagnostic[] = [];
  for (const id of graph.reachable) {
    const node = graph.nodes.get(id)!;
    if (isSourceCodeComponent(node)) continue;
    const add = (selector: string, variationAxes?: unknown) => {
      if (!selector.startsWith('GF;') && !selector.startsWith('FR;') && !selector.startsWith('Inter')) return;
      const request = parseSourceGoogleFont(selector, variationAxes);
      if (request) requests.push(request);
      else diagnostics.push({ code: 'SOURCE_FONT_ADAPTER_REQUIRED', sourceId: id, message: `Unsupported Google font selector ${selector}.` });
    };
    const html = (value: DefaultTreeAdapterTypes.ChildNode) => {
      if ('attrs' in value) {
        const style = value.attrs.find(attr => attr.name === 'style')?.value;
        const encoded = parseStyleString(style ?? '')['--font-selector'];
        if (encoded) { try { add(encoded.startsWith('GF;') ? encoded : atob(encoded)); } catch { diagnostics.push({ code: 'SOURCE_FONT_ADAPTER_REQUIRED', sourceId: id, message: 'Invalid inline font selector.' }); } }
      }
      if ('childNodes' in value) value.childNodes.forEach(html);
    };
    const scan = (value: unknown) => {
      if (Array.isArray(value)) { value.forEach(scan); return; }
      if (!value || typeof value !== 'object') return;
      for (const [key, item] of Object.entries(value)) {
        if (key === 'children') continue;
        if (typeof item === 'string') {
          if (/^(?:formInputF|f)ont(?:Bold|Italic|BoldItalic|Selector)?$/.test(key)) add(item, key === 'formInputFontSelector' ? (value as Record<string, unknown>).formInputVariationAxes : undefined);
          else if (key === 'html') parseFragment(item).childNodes.forEach(html);
        } else scan(item);
      }
    };
    scan(node.raw);
  }
  const unique = new Map(requests.map(request => [JSON.stringify([request.family, Object.entries(request.axes).sort()]), request]));
  return { requests: [...unique].sort(([a], [b]) => a.localeCompare(b)).map(([, request]) => request), diagnostics };
}
