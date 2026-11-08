import { trace } from '../../../shared/debug-trace';
import { nodeIdToVarNameCapitalised } from '../../../shared/id-utils';
import type { FilterConfig, SortConfig } from '../../../shared/types';
import { cmsPropBindingExpression } from '../../../shared/cms-prop-bindings';
import { setTagAttr } from '../../generation/generator-utils';
import { createCollectionListInCode, findJSXElementByDataId, updateCollectionListConfigInCode } from '../../generation/cms-gen';
import { nativePropName } from './components';
import { nativeCollectionSlug, nativeFieldId, sourceCollectionId } from './cms';
import { sourceRecord, sourceVariables } from './source-graph';
import type { SourceGraph } from './types';

export type NativeBinding =
  | { kind: 'literal'; value: unknown }
  | { kind: 'variable'; providerId: string; sourceId: string; name: string; valueType: string }
  | { kind: 'field'; providerId: string; collectionId: string; fieldId: string; sourceId: string; itemVar: string; valueType: string }
  | { kind: 'reference'; collectionId: string; rowId: string | string[] | null }
  | { kind: 'transform'; name: 'isSet' | 'equals' | 'isIncludedIn' | 'prefix' | 'arrayToArray' | 'negate'; input: NativeBinding; argument?: NativeBinding; value?: string };

export interface BindingContext {
  graph: SourceGraph;
  identity: Record<string, string>;
  nodeId?: string;
  locale?: string;
  defaultLocale?: string;
  /** Explicitly known reference destination, e.g. a predicate on a record ID. */
  referenceCollectionId?: string;
  cssImage?: boolean;
}
export interface NativeSourceQuery {
  collectionId: string;
  slug: string;
  itemVar: string;
  combinator: 'and' | 'or';
  predicates: NativeBinding[];
  sorts: SortConfig[];
  reverse: boolean;
  offset?: number;
  limit?: number;
}

function itemVariable(context: BindingContext, providerId: string): string {
  if (context.graph.nodes.get(providerId)?.kind === 'WebPageNode') return 'item';
  const id = context.identity[providerId];
  if (!id) throw new Error(`Missing data-provider identity ${providerId}`);
  return `item${nodeIdToVarNameCapitalised(id)}`;
}
function assertLexicalProvider(context: BindingContext, providerId: string): void {
  if (!context.nodeId) return;
  const seen = new Set<string>();
  let cursor: string | undefined = context.nodeId;
  while (cursor && !seen.has(cursor)) {
    if (cursor === providerId) return;
    seen.add(cursor);
    const parent: unknown = context.graph.nodes.get(cursor)?.raw.parentid;
    cursor = typeof parent === 'string' ? parent : undefined;
  }
  throw new Error(`Source provider ${providerId} is outside the lexical scope of ${context.nodeId}`);
}
function fieldBinding(context: BindingContext, providerId: string, collectionId: string, sourceId: string): NativeBinding & { kind: 'field' } {
  const collection = context.graph.nodes.get(collectionId);
  if (collection?.kind !== 'CollectionNode') throw new Error(`Missing source collection ${collectionId}`);
  if (sourceId.includes('.')) {
    const [head, tail] = sourceId.split('.', 2);
    const headField = sourceVariables(context.graph, collectionId).find(variable => variable.id === head);
    if (!headField) throw new Error(`Missing source field ${head} in ${collectionId}`);
    let targetCollectionId = collectionId;
    if (headField.type === 'collectionreference' && typeof headField.dataIdentifier === 'string') {
      targetCollectionId = sourceCollectionId(headField.dataIdentifier);
    }
    const targetField = sourceVariables(context.graph, targetCollectionId).find(variable => variable.id === tail);
    const headNative = nativeFieldId(context.identity, collectionId, head);
    const tailNative = targetField ? nativeFieldId(context.identity, targetCollectionId, tail) : tail;
    return {
      kind: 'field',
      providerId,
      collectionId,
      sourceId,
      fieldId: `${headNative}_${tailNative}`,
      itemVar: itemVariable(context, providerId),
      valueType: String(targetField?.type ?? 'string'),
    };
  }
  const field = sourceVariables(context.graph, collectionId).find(variable => variable.id === sourceId);
  if (!field && sourceId !== 'id') {
    const isLegacyField = collection.children.some(childId => context.graph.nodes.get(childId)?.raw[`$control__${sourceId}`] !== undefined);
    if (!isLegacyField) throw new Error(`Missing source field ${sourceId} in ${collectionId}`);
    return { kind: 'field', providerId, collectionId, sourceId, fieldId: sourceId, itemVar: itemVariable(context, providerId), valueType: 'string' };
  }
  return { kind: 'field', providerId, collectionId, sourceId, fieldId: nativeFieldId(context.identity, collectionId, sourceId), itemVar: itemVariable(context, providerId), valueType: String(field?.type ?? 'string') };
}

function applyTransforms(input: NativeBinding, raw: unknown, context: BindingContext): NativeBinding {
  if (!Array.isArray(raw)) throw new Error('Source transform chain must be an array');
  let result = input;
  for (const item of raw) {
    const transform = sourceRecord(item);
    if (!transform || !['isSet', 'equals', 'isIncludedIn', 'prefix', 'arrayToArray', 'negate'].includes(String(transform.name))) throw new Error(`Unsupported source transform ${String(transform?.name)}`);
    const name = transform.name as 'isSet' | 'equals' | 'isIncludedIn' | 'prefix' | 'arrayToArray' | 'negate';
    if (name === 'isSet' || name === 'arrayToArray' || name === 'negate') result = { kind: 'transform', name, input: result };
    else if (name === 'prefix') result = { kind: 'transform', name, input: result, value: String(transform.value ?? '') };
    else {
      if (!('value' in transform)) throw new Error(`Missing argument for ${name}`);
      result = { kind: 'transform', name, input: result, argument: resolveSourceBinding(transform.value, context) };
    }
  }
  return result;
}

export function resolveSourceBinding(value: unknown, context: BindingContext): NativeBinding {
  trace.fn('framer-native.resolveSourceBinding', { nodeId: context.nodeId });
  if (context.locale && context.locale !== context.defaultLocale) throw new Error(`Source locale ${context.locale} has not been captured`);
  const record = sourceRecord(value);
  if (record?.type === 'computedValue') return applyTransforms(resolveSourceBinding(record.startValue, context), record.transforms, context);
  if (record?.type === 'variableReference') {
    const providerId = record.providerId, sourceId = record.id;
    if (typeof providerId !== 'string' || typeof sourceId !== 'string') throw new Error('Malformed source variable reference');
    const provider = context.graph.nodes.get(providerId);
    if (!provider) throw new Error(`Missing source provider ${providerId}`);
    if (provider.raw.dataIdentifier !== undefined) {
      assertLexicalProvider(context, providerId);
      return fieldBinding(context, providerId, sourceCollectionId(provider.raw.dataIdentifier), sourceId);
    }
    const variable = sourceVariables(context.graph, providerId).find(variable => variable.id === sourceId);
    if (!variable) throw new Error(`Missing source variable/field ${sourceId} on ${providerId}`);
    return { kind: 'variable', providerId, sourceId, name: nativePropName(context.identity, providerId, sourceId), valueType: String(variable.type === 'controlReference' ? variable.expectedType : variable.type) };
  }
  if (record?.type !== undefined) throw new Error(`Unsupported source binding ${String(record.type)}`);
  if (context.referenceCollectionId && (typeof value === 'string' || value === null || Array.isArray(value))) {
    const collectionId = context.referenceCollectionId;
    const collection = context.graph.nodes.get(collectionId);
    if (collection?.kind !== 'CollectionNode') throw new Error(`Missing reference collection ${collectionId}`);
    const map = (id: unknown) => {
      if (typeof id !== 'string' || !collection.children.includes(id) || !context.identity[id]) throw new Error(`Missing referenced row ${String(id)}`);
      return context.identity[id];
    };
    return { kind: 'reference', collectionId, rowId: value === null || value === '' ? value : Array.isArray(value) ? value.map(map) : map(value) };
  }
  return { kind: 'literal', value };
}

/** Emit supported native component-prop bindings, keeping CMS values live. */
export function bindSourcePropInCode(code: string, nodeId: string, prop: string, value: unknown, context: BindingContext): string {
  trace.fn('framer-native.bindSourceProp', { nodeId, prop });
  if (!/^[A-Za-z_$][\w$]*$/.test(prop)) throw new Error(`Invalid native prop ${prop}`);
  const binding = resolveSourceBinding(value, context);
  let expression: string;
  if (binding.kind === 'field') expression = cmsPropBindingExpression(binding.itemVar, { field: binding.fieldId, ...(context.cssImage ? { urlWrap: true } : {}) });
  else if (binding.kind === 'transform' && binding.name === 'isSet' && binding.input.kind === 'field') {
    expression = cmsPropBindingExpression(binding.input.itemVar, { field: binding.input.fieldId, transform: 'isSet' });
  } else if (binding.kind === 'transform' && binding.name === 'arrayToArray' && binding.input.kind === 'field') {
    expression = cmsPropBindingExpression(binding.input.itemVar, { field: binding.input.fieldId });
  } else if (binding.kind === 'transform' && binding.name === 'prefix' && binding.input.kind === 'field') {
    expression = `\`${binding.value}\${${cmsPropBindingExpression(binding.input.itemVar, { field: binding.input.fieldId })} ?? ''}\``;
  } else if (binding.kind === 'variable') {
    if (context.cssImage) throw new Error('Source image variable requires its native image-domain adapter');
    expression = binding.name;
  }
  else if (binding.kind === 'reference') expression = JSON.stringify(binding.rowId);
  else if (binding.kind === 'literal') {
    if (binding.value === undefined) return setTagAttr(code, nodeId, prop, null);
    if (typeof binding.value === 'string' && binding.value.startsWith('data:framer/asset-reference,')) throw new Error('Source asset must be resolved by its asset adapter');
    const json = JSON.stringify(binding.value);
    if (json === undefined) throw new Error(`Unsupported literal for ${prop}`);
    expression = json;
  } else throw new Error(`A native computed-prop binding adapter is required for ${binding.kind}`);
  return setTagAttr(code, nodeId, prop, `{${expression}}`);
}

export function resolveSourceQuery(providerId: string, context: BindingContext): NativeSourceQuery {
  trace.fn('framer-native.resolveSourceQuery', { providerId });
  const raw = context.graph.nodes.get(providerId)?.raw;
  if (!raw) throw new Error(`Missing source query ${providerId}`);
  const collectionId = sourceCollectionId(raw.dataIdentifier);
  const predicates: NativeBinding[] = [];
  const filterGroup = sourceRecord(raw.collectionFilters);
  const filters = filterGroup?.filters ?? [];
  if (!Array.isArray(filters)) throw new Error(`Malformed source filters ${providerId}`);
  for (const value of filters) {
    const filter = sourceRecord(value);
    if (!filter || typeof filter.itemKey !== 'string') throw new Error(`Malformed filter field ${providerId}`);
    const field = fieldBinding(context, providerId, collectionId, filter.itemKey);
    const transforms = filter.transforms ?? [];
    if (!Array.isArray(transforms)) throw new Error(`Malformed filter transforms ${providerId}`);
    if (!transforms.length) {
      if (field.valueType !== 'boolean') throw new Error(`Missing explicit source predicate on ${filter.itemKey}`);
      predicates.push({ kind: 'transform', name: 'equals', input: field, argument: { kind: 'literal', value: true } });
    } else {
      const variable = sourceVariables(context.graph, collectionId).find(variable => variable.id === filter.itemKey);
      const referenceCollectionId = filter.itemKey === 'id' ? collectionId : variable?.type === 'collectionreference' ? sourceCollectionId(variable.dataIdentifier) : undefined;
      predicates.push(applyTransforms(field, transforms, { ...context, nodeId: providerId, referenceCollectionId }));
    }
  }
  const operator = raw.collectionFiltersOperator ?? 'all';
  if (operator !== 'all' && operator !== 'any') throw new Error(`Unsupported filter combination ${String(operator)}`);
  const sorts: SortConfig[] = [];
  if (raw.collectionOrder !== undefined) {
    if (!Array.isArray(raw.collectionOrder)) throw new Error(`Malformed source sort ${providerId}`);
    for (const value of raw.collectionOrder) {
      const order = sourceRecord(value);
      if (!order || order.itemKey == null) continue; // The editor's empty, unconfigured sort row.
      if (typeof order.itemKey !== 'string' || !['asc', 'desc'].includes(String(order.direction ?? 'asc'))) throw new Error(`Unsupported source sorting ${providerId}`);
      sorts.push({ field: fieldBinding(context, providerId, collectionId, order.itemKey).fieldId, direction: (order.direction ?? 'asc') as 'asc' | 'desc' });
    }
  }
  for (const key of ['collectionStartOffset', 'collectionLimit']) if (raw[key] !== undefined && (typeof raw[key] !== 'number' || !Number.isInteger(raw[key]) || Number(raw[key]) < 0)) throw new Error(`Invalid ${key} on ${providerId}`);
  if (raw.collectionPaginationPageSize !== undefined) throw new Error(`Source pagination on ${providerId} needs its native pagination adapter`);
  return {
    collectionId, slug: nativeCollectionSlug(context.identity, collectionId), itemVar: itemVariable(context, providerId),
    predicates, combinator: operator === 'any' ? 'or' : 'and', sorts, reverse: raw.collectionReverse === true,
    ...(typeof raw.collectionStartOffset === 'number' ? { offset: raw.collectionStartOffset } : {}),
    ...(typeof raw.collectionLimit === 'number' ? { limit: raw.collectionLimit } : {}),
  };
}

/** Source query → editable native collection config; unsupported semantics never disappear. */
export function emitSourceQueryInCode(code: string, parentId: string, providerId: string, templateJSX: string, context: BindingContext, templateTargetId?: string): string {
  trace.fn('framer-native.emitQuery', { parentId, providerId });
  const query = resolveSourceQuery(providerId, context);
  const unsupported = (): never => { throw new Error(`A native source-query adapter is required for ${providerId}`); };
  if (query.reverse || query.limit === 0) unsupported();
  const filters: FilterConfig[] = query.predicates.map(predicate => {
    let target = predicate;
    let negated = false;
    if (target.kind === 'transform' && target.name === 'negate') {
      negated = true;
      target = target.input;
    }
    if (target.kind !== 'transform' || target.input.kind !== 'field' || target.input.providerId !== providerId) return unsupported();
    const argument = target.argument;
    if ((argument?.kind === 'variable' || (argument?.kind === 'field' && argument.providerId !== providerId)) && (target.name === 'equals' || target.name === 'isIncludedIn')) {
      const valueVar = argument.kind === 'variable' ? argument.name : `${argument.itemVar}.${argument.fieldId}`;
      const operator: FilterConfig['operator'] = target.name === 'equals' ? (negated ? 'not_equals' : 'equals') : (negated ? 'not_in' : 'in');
      return { field: target.input.fieldId, operator, value: '', valueSource: 'variable', valueVar };
    }
    if (!argument || argument.kind !== 'literal' && argument.kind !== 'reference') return unsupported();
    const value = argument.kind === 'literal' ? argument.value : argument.rowId;
    if (target.name === 'equals') return { field: target.input.fieldId, operator: negated ? 'not_equals' : 'equals', value };
    if (target.name === 'isIncludedIn' && Array.isArray(value)) return { field: target.input.fieldId, operator: negated ? 'not_in' : 'in', value };
    return unsupported();
  });
  if (findJSXElementByDataId(code, parentId) < 0) throw new Error(`Native query target ${parentId} is missing`);
  const list = createCollectionListInCode(code, parentId, query.slug, templateJSX, query.itemVar, templateTargetId);
  return updateCollectionListConfigInCode(list, parentId, { combinator: query.combinator, filters }, query.sorts, query.limit, query.offset);
}
