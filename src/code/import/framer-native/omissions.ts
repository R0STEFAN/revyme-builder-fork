import { trace } from '../../../shared/debug-trace';
import { decodeNativeTransfer } from './decode';
import { sourceRecord } from './source-graph';
import type { NativeTransfer, TransferDiagnostic } from './types';

export interface NativeSourceSkips {
  pageReferenceFilters?: boolean;
  pageVariableFallbacks?: boolean;
  customCursors?: boolean;
  collectionLoops?: boolean;
}

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

  const cleanVariableReferences = (target: unknown, providerId: string, variableId: string, fallback: unknown, reportProp?: (prop: string) => void): void => {
    if (Array.isArray(target)) {
      for (let i = 0; i < target.length; i++) {
        const item = target[i];
        if (item && typeof item === 'object') {
          if (item.type === 'variableReference' && item.providerId === providerId && item.id === variableId) {
            target[i] = fallback;
            reportProp?.(`array[${i}]`);
          } else {
            cleanVariableReferences(item, providerId, variableId, fallback, reportProp);
          }
        }
      }
      return;
    }
    const obj = sourceRecord(target);
    if (!obj) return;
    for (const [key, value] of Object.entries(obj)) {
      if (value && typeof value === 'object') {
        const valObj = value as Record<string, unknown>;
        const startVal = valObj.startValue as Record<string, unknown> | undefined;
        const isDirectRef = valObj.type === 'variableReference' && valObj.providerId === providerId && valObj.id === variableId;
        const isComputedRef = valObj.type === 'computedValue' && startVal?.type === 'variableReference' && startVal.providerId === providerId && startVal.id === variableId;
        if (isDirectRef || isComputedRef) {
          if (key === 'textContent') {
            delete obj[key];
          } else if (key === 'visible') {
            delete obj[key];
          } else if (key.startsWith('$control__')) {
            if (fallback !== undefined) {
              obj[key] = { value: fallback };
            } else {
              delete obj[key];
            }
          } else if (fallback !== undefined) {
            obj[key] = fallback;
          } else {
            delete obj[key];
          }
          reportProp?.(key);
        } else {
          cleanVariableReferences(value, providerId, variableId, fallback, reportProp);
        }
      }
    }
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
      if (references(page.children)) {
        if (!skips.pageVariableFallbacks) {
          throw new Error(`Page variable ${variableId} has active uses outside the omitted filter`);
        }
        const variableDef = sourceRecord((page.variables as unknown[])?.find(v => sourceRecord(v)?.id === variableId));
        const fallback = variableDef?.initialValue ?? (variableDef?.type === 'boolean' ? false : variableDef?.type === 'number' ? 0 : variableDef?.type === 'string' ? '' : undefined);
        cleanVariableReferences(page.children, String(page.id), variableId, fallback, key => {
          report(String(page.id), `variables.${variableId}.${key}`, 'Active page variable use outside omitted filter replaced with fallback.');
        });
      }
      page.variables = (page.variables as unknown[]).filter(variable => sourceRecord(variable)?.id !== variableId);
      report(String(page.id), `variables.${variableId}`, 'Optional page reference variable was omitted with its filter by user choice.');
    }
  });
  if (skips.pageVariableFallbacks) for (const definition of transfer.definitions) visit(definition.data, page => {
    if (page.__class !== 'WebPageNode' || !Array.isArray(page.variables) || !page.variables.length) return;
    for (const v of [...page.variables]) {
      const variable = sourceRecord(v);
      if (!variable || typeof variable.id !== 'string') continue;
      const variableId = String(variable.id);
      const fallback = variable.initialValue ?? (variable.type === 'boolean' ? false : variable.type === 'number' ? 0 : variable.type === 'string' ? '' : undefined);
      cleanVariableReferences(page.children, String(page.id), variableId, fallback, key => {
        report(String(page.id), `variables.${variableId}.${key}`, 'Page variable reference was replaced with fallback.');
      });
      visit(page.children, object => {
        for (const [key, val] of Object.entries(object)) {
          if (/^on[A-Z]/.test(key) && Array.isArray(val)) {
            object[key] = val.filter(action => {
              const act = sourceRecord(action);
              if (act?.actionIdentifier === 'framer/useSetVariableValue') {
                const varId = sourceRecord(act.controls)?.variableId;
                const v = sourceRecord(varId)?.value ?? varId;
                if (v === variableId) {
                  report(typeof object.id === 'string' ? object.id : definition.id, key, 'Omitted action setting omitted page variable.');
                  return false;
                }
              }
              return true;
            });
          }
        }
      });
      report(String(page.id), `variables.${variableId}`, 'Page variable was converted to static fallback.');
    }
    page.variables = [];
  });
  if (skips.collectionLoops) {
    const cleanLoopsInList = (node: Record<string, unknown>, inList: boolean, definitionId: string): void => {
      const isList = inList || (node.__class !== 'WebPageNode' && node.dataIdentifier !== undefined);
      if (isList && node.loopEffectEnabled === true) {
        delete node.loopEffectEnabled;
        report(typeof node.id === 'string' ? node.id : definitionId, 'loopEffectEnabled', 'Loop animation in repeated collection list was omitted to comply with React rules of hooks.');
      }
      if (node.dataIdentifier !== undefined && Array.isArray(node.children)) {
        node.children = (node.children as unknown[]).filter(child => {
          let hasRepeaterCount = false;
          visit(sourceRecord(child)?.visible, v => {
            if (v.type === 'variableReference' && v.id === 'repeater_item_count') hasRepeaterCount = true;
          });
          if (hasRepeaterCount) {
            report(typeof (child as any)?.id === 'string' ? (child as any).id : definitionId, 'emptyState', 'Collection empty state was omitted.');
            return false;
          }
          return true;
        });
      }
      if (node.textContent) {
        let hasRepeaterCount = false;
        visit(node.textContent, v => {
          if (v.type === 'variableReference' && v.id === 'repeater_item_count') hasRepeaterCount = true;
        });
        if (hasRepeaterCount) {
          delete node.textContent;
          report(typeof node.id === 'string' ? node.id : definitionId, 'textContent', 'Repeater item count binding was replaced with static text.');
        }
      }
      if (Array.isArray(node.children)) {
        for (const child of node.children) {
          const childRec = sourceRecord(child);
          if (childRec) cleanLoopsInList(childRec, isList, definitionId);
        }
      }
      for (const [key, val] of Object.entries(node)) {
        if (key !== 'children' && val && typeof val === 'object') {
          const rec = sourceRecord(val);
          if (rec) cleanLoopsInList(rec, isList, definitionId);
        }
      }
    };
    for (const definition of transfer.definitions) {
      const data = sourceRecord(definition.data);
      if (data) cleanLoopsInList(data, false, definition.id);
    }
    const codeFiles = transfer.codeFiles ?? [];
    for (const definition of transfer.definitions) {
      visit(definition.data, object => {
        if (object.codeOverrideEnabled === true && typeof object.codeOverrideIdentifier === 'string') {
          const id = object.codeOverrideIdentifier;
          const localMatch = /^local-module:(codeFile\/[^:]+):([A-Za-z_$][\w$]*)$/.exec(id);
          const extMatch = /^module:([^/]+)\/([^/]+)\/([^:]+):([A-Za-z_$][\w$]*)$/.exec(id);
          const sourceId = localMatch?.[1] ?? extMatch?.[1];
          const file = sourceId ? codeFiles.find(f => f.sourceId === sourceId) : undefined;
          if (!file || /from\s+["']framer["']/.test(file.code)) {
            object.codeOverrideEnabled = false;
            delete object.codeOverrideIdentifier;
            report(typeof object.id === 'string' ? object.id : definition.id, 'codeOverrideIdentifier', 'Unsupported Framer runtime code override was omitted.');
          }
        }
      });
    }
  }
  return { transfer, omissions };
}
