import { trace } from '../../../shared/debug-trace';
import { decodeNativeTransfer } from './decode';
import { sourceRecord } from './source-graph';
import type { NativeTransfer, TransferDiagnostic } from './types';

export interface NativeSourceSkips { pageReferenceFilters?: boolean; customCursors?: boolean }

/** Explicit user-approved omissions. The captured transfer remains untouched. */
export function omitNativeSourceFeatures(input: unknown, skips: NativeSourceSkips): { transfer: NativeTransfer; omissions: TransferDiagnostic[] } {
  const transfer = structuredClone(decodeNativeTransfer(input)) as NativeTransfer;
  const omissions: TransferDiagnostic[] = [];
  const seen = new Set<string>();
  const report = (sourceId: string | undefined, property: string, message: string) => {
    const key = `${sourceId}:${property}`;
    if (seen.has(key)) return;
    seen.add(key);
    omissions.push({ code: 'SOURCE_FEATURE_OMITTED', sourceId, property, message });
    trace.action('framer-native.source-feature-omitted', { sourceId, property });
  };
  const visit = (value: unknown, action: (object: Record<string, unknown>) => void): void => {
    if (Array.isArray(value)) { value.forEach(item => visit(item, action)); return; }
    const object = sourceRecord(value);
    if (!object) return;
    action(object);
    Object.values(object).forEach(item => visit(item, action));
  };
  if (skips.customCursors) for (const definition of transfer.definitions) visit(definition.data, object => {
    if ('customCursorType' in object || 'customCursorSmartComponentId' in object || 'customCursorVariant' in object) {
      const sourceId = typeof object.id === 'string' ? object.id : definition.id;
      delete object.customCursorType; delete object.customCursorSmartComponentId; delete object.customCursorVariant;
      report(sourceId, 'customCursor', 'Custom cursor appearance was omitted by user choice.');
    }
    for (const [key, control] of Object.entries(object)) if (key.startsWith('$control__')) {
      let hasCursor = false;
      visit(control, nested => { if ('customCursorType' in nested || 'customCursorSmartComponentId' in nested) hasCursor = true; });
      if (hasCursor) { delete object[key]; report(typeof object.id === 'string' ? object.id : definition.id, key, 'Custom cursor assignment was omitted by user choice.'); }
    }
  });
  if (skips.pageReferenceFilters) for (const definition of transfer.definitions) visit(definition.data, page => {
    if (page.__class !== 'WebPageNode' || !Array.isArray(page.variables)) return;
    const variables = page.variables.filter(variable => {
      const v = sourceRecord(variable);
      return v?.type === 'collectionreference' && v.optional === true && typeof v.id === 'string';
    }).map(variable => String(sourceRecord(variable)!.id));
    for (const variableId of variables) {
      let removed = 0;
      const references = (value: unknown): boolean => {
        let found = false;
        visit(value, object => { if (object.type === 'variableReference' && object.providerId === page.id && object.id === variableId) found = true; });
        return found;
      };
      visit(page.children, object => {
        const group = sourceRecord(object.collectionFilters);
        if (!Array.isArray(group?.filters)) return;
        group.filters = group.filters.filter(filter => {
          if (!references(filter)) return true;
          const transforms = sourceRecord(filter)?.transforms;
          if (!Array.isArray(transforms) || transforms.length !== 1) throw new Error(`Cannot omit composite page filter ${variableId}`);
          removed++;
          report(typeof object.id === 'string' ? object.id : definition.id, 'collectionFilters', 'Optional page reference filter was omitted by user choice.');
          return false;
        });
      });
      if (!removed) continue;
      if (references(page.children)) throw new Error(`Page variable ${variableId} has active uses outside the omitted filter`);
      page.variables = (page.variables as unknown[]).filter(variable => sourceRecord(variable)?.id !== variableId);
      report(String(page.id), `variables.${variableId}`, 'Optional page reference variable was omitted with its filter by user choice.');
    }
  });
  return { transfer, omissions };
}
