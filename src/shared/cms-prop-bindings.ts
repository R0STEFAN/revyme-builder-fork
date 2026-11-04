import { trace } from './debug-trace';

/** Native CMS prop metadata, shared by parsing, preview and detach/rehydration. */
export interface CmsPropBinding {
  prop: string;
  field: string;
  urlWrap?: boolean;
  transform?: 'isSet';
  visibility?: CmsStyleBinding['visibility'];
}

export interface CmsStyleBinding {
  styleProp: string;
  field: string;
  visibility?: { display: string; transform?: 'isSet' };
}

export function applyCmsPropBinding(value: unknown, binding: Pick<CmsPropBinding, 'transform' | 'urlWrap' | 'visibility'>): unknown {
  if (binding.visibility) return applyCmsPropBinding(value, binding.visibility) ? binding.visibility.display : 'none';
  if (binding.transform === 'isSet') return Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && value !== '';
  return binding.urlWrap ? `url(${value ?? ''})` : value;
}

/** Plain browser expressions: published pages need no importer runtime. */
export function cmsPropBindingExpression(itemVar: string, binding: Pick<CmsPropBinding, 'field' | 'transform' | 'urlWrap' | 'visibility'>): string {
  trace.fn('cms-prop-binding.expression', { field: binding.field, transform: binding.transform });
  if (!/^[A-Za-z_$][\w$]*$/.test(itemVar) || !/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(binding.field)) throw new Error('Invalid CMS binding identifier');
  const value = `${itemVar}.${binding.field}`;
  if (binding.visibility) return `(${cmsPropBindingExpression(itemVar, { field: binding.field, transform: binding.visibility.transform })}) ? ${JSON.stringify(binding.visibility.display)} : "none"`;
  if (binding.transform === 'isSet') return `Array.isArray(${value}) ? ${value}.length > 0 : ${value} != null && ${value} !== ''`;
  return binding.urlWrap ? '`url(${' + value + '})`' : value;
}

export function parseCmsPropBindingStash(value: string): CmsPropBinding[] {
  return value.split(',').map(part => part.trim()).filter(Boolean).flatMap(part => {
    const [prop, field, marker] = part.split(':');
    if (!prop || !field) return [];
    if (marker?.startsWith('visibility=')) {
      try {
        const visibility = JSON.parse(decodeURIComponent(marker.slice('visibility='.length)));
        if (typeof visibility?.display !== 'string' || (visibility.transform !== undefined && visibility.transform !== 'isSet')) return [];
        return [{ prop, field, visibility }];
      } catch { return []; }
    }
    return [{ prop, field, ...(marker === 'url' ? { urlWrap: true } : marker === 'isSet' ? { transform: 'isSet' as const } : {}) }];
  });
}
export function serializeCmsPropBindingStash(entries: CmsPropBinding[]): string {
  return entries.map(entry => `${entry.prop}:${entry.field}${entry.visibility ? `:visibility=${encodeURIComponent(JSON.stringify(entry.visibility))}` : entry.transform ? `:${entry.transform}` : entry.urlWrap ? ':url' : ''}`).join(',');
}
