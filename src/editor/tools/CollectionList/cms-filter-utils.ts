// cms-filter-utils.ts — Shared helpers for the Collection List Filters + Sorting
// popups: field-type-aware operator menus, order labels, and human-readable row
// summaries. Keeps the UI logic out of the controls + reusable across Filter and
// Sort editor panels.

import type { FilterConfig, FieldDefinition, CollectionSchema } from '@/shared/types';
import { trace } from '@/shared/debug-trace';

type FieldType = FieldDefinition['type'];

/** Value-column class for EVERY Collection List row (Source / Filters / Sorting /
 *  Pagination / Limit / Offset). A FIXED flex-basis at the panel's standard value
 *  width, so all CL rows compute to the EXACT same px as every OTHER tool row
 *  (Layout's Align/Justify, SizeTool's Width/Height, …).
 *
 *  Deriving the number (panel is a fixed 260px):
 *    row width R = 260 − 16 (`px-2`) − 12 (`pl-3`)                = 232px
 *    label basis = `w-3/4` = 0.75R                               = 174px
 *  A standard tool row uses a NON-plain `ControlLabel` whose gutter margin is
 *  `-ml-[18px]` (net −18px). With `justify-between` + `w-full` shrink:1 on both,
 *  the value column settles at  R − ((0.75R + R − 18) − R)·(R/1.75R)
 *    = 0.5714·R + 18/1.75  ≈ 142.9px  ≈ **61.6%** of R.
 *
 *  Two traps this avoids:
 *   1. My earlier `basis-[57%]` ignored that −18px gutter — 57% is the split with
 *      ZERO label margin; the real equilibrium is ~61.6%. 57% was ~9px too narrow.
 *   2. The CL uses a PLAIN `ControlLabel`, whose gutter is `-ml-[18px] mr-[2px]`
 *      (net −16px, not −18px) — so a plain row's `w-full` value lands ~2px NARROWER
 *      than the non-plain rows around it (the reported Advisors/Pagination gap). A
 *      margin fix can't heal it uniformly (EntryList's 2nd+ spacer has no `mr-[2px]`).
 *  A FIXED basis sidesteps both: `grow-0 shrink-0` pins the value to 61.6% of R
 *  regardless of label margin, value element type, or spacer rows. `min-w-0` keeps a
 *  wide-min-content value (Limit/Offset = ToolInput + RemoveButton) from clamping past
 *  it. The label column (shrink:1) absorbs whatever remains. */
export const COLLECTION_VALUE_CLS = 'grow-0 shrink-0 basis-[61.6%] min-w-0';

/** System fields present on EVERY CollectionItem (`_createdAt`/`_updatedAt`, set
 *  by addCollectionItem + bumped by updateCollectionItem). They aren't in
 *  `schema.fields` (so they don't show as editable columns) but ARE sortable +
 *  filterable date fields — design-tool parity (Created / Updated). */
const SYSTEM_SORT_FIELDS: FieldDefinition[] = [
  { id: '_createdAt', name: 'Created', type: 'date' },
  { id: '_updatedAt', name: 'Updated', type: 'date' },
];

/** Fields offered in the Sort/Filter field dropdowns: the collection's own
 *  fields PLUS the system Created/Updated date fields. */
export function fieldsForSortFilter(schema: CollectionSchema | null): FieldDefinition[] {
  return [...(schema?.fields ?? []), ...SYSTEM_SORT_FIELDS];
}

/** Operator menu options for a given field type (standard: text gets
 *  contains/equals, number/date get comparisons + between, boolean is/is-not, …). */
export function operatorsForFieldType(type: FieldType | undefined): { value: FilterConfig['operator']; label: string }[] {
  switch (type) {
    case 'number':
    case 'date':
      return [
        { value: 'equals', label: 'equals' },
        { value: 'not_equals', label: 'not equals' },
        { value: 'gt', label: 'after / >' },
        { value: 'gte', label: 'on or after / ≥' },
        { value: 'lt', label: 'before / <' },
        { value: 'lte', label: 'on or before / ≤' },
        { value: 'between', label: 'between' },
        { value: 'exists', label: 'is set' },
      ];
    case 'boolean':
      return [
        { value: 'equals', label: 'is' },
        { value: 'not_equals', label: 'is not' },
      ];
    case 'enum':
      return [
        { value: 'equals', label: 'is' },
        { value: 'not_equals', label: 'is not' },
        { value: 'exists', label: 'is set' },
      ];
    case 'reference':
    case 'multi-reference':
    case 'tags':
      return [
        { value: 'contains', label: 'contains' },
        { value: 'not_contains', label: 'does not contain' },
        { value: 'exists', label: 'is set' },
      ];
    default: // text, textarea, richtext, slug, link, url, color, image, file
      return [
        { value: 'contains', label: 'contains' },
        { value: 'not_contains', label: 'does not contain' },
        { value: 'equals', label: 'equals' },
        { value: 'not_equals', label: 'not equals' },
        { value: 'exists', label: 'is set' },
      ];
  }
}

/** Whether the value widget should be hidden (operators that take no value). */
export function operatorTakesNoValue(op: FilterConfig['operator']): boolean {
  return op === 'exists';
}

/** Resolve the effective sort/order TYPE for a field. Prefers the schema's
 *  declared type; falls back to a name heuristic so system date fields (Created,
 *  Updated, Published, …) that may be missing from `schema.fields` still get
 *  date-style order labels instead of the generic A→Z. */
export function effectiveFieldType(field: FieldDefinition | undefined, fieldId: string): FieldType | undefined {
  if (field?.type) return field.type;
  if (/creat|updat|publish|date|time|year/i.test(fieldId)) return 'date';
  return undefined;
}

/** Sort-order labels per field type — asc/desc in the field's natural language
 *  (A→Z text, Old→New date, Low→High number). Matches the reference's wording. */
export function orderLabels(type: FieldType | undefined): { value: 'asc' | 'desc'; label: string }[] {
  switch (type) {
    case 'date':
      return [{ value: 'asc', label: 'Old → New' }, { value: 'desc', label: 'New → Old' }];
    case 'number':
      return [{ value: 'asc', label: 'Low → High' }, { value: 'desc', label: 'High → Low' }];
    case 'boolean':
      return [{ value: 'asc', label: 'Off → On' }, { value: 'desc', label: 'On → Off' }];
    default: // text/slug/enum/…
      return [{ value: 'asc', label: 'A → Z' }, { value: 'desc', label: 'Z → A' }];
  }
}

const OP_SUMMARY: Record<FilterConfig['operator'], string> = {
  equals: 'is', not_equals: 'is not', contains: 'contains', not_contains: 'excludes',
  gt: '>', gte: '≥', lt: '<', lte: '≤', in: 'in', not_in: 'not in', exists: 'is set', between: 'between',
};

/** Human-readable one-line summary for a filter row (e.g. "Category is News"). */
export function filterSummary(f: FilterConfig, fieldName: string): string {
  const displayField = fieldName.replace(/\./g, ' › ');
  if (f.valueSource === 'searchField') return `${displayField} matches search`;
  if (f.valueSource === 'dateField') return `${displayField} from date`;
  if (f.valueSource === 'routeParam') return `${displayField} is [:${f.valueVar}]`;
  const op = OP_SUMMARY[f.operator] ?? f.operator;
  if (operatorTakesNoValue(f.operator)) return `${displayField} ${op}`;
  if (f.operator === 'between' && Array.isArray(f.value)) return `${displayField} ${op} ${f.value[0]}–${f.value[1]}`;
  const v = f.value === '' || f.value == null ? '…' : String(f.value);
  return `${displayField} ${op} ${v}`;
}

export interface HierarchicalField {
  id: string;
  name: string;
  fullPath: string;
  type?: FieldType | string;
  children?: HierarchicalField[];
}

/** Attach a relative subtree without losing the parent path on its descendants. */
function prefixFieldPaths(field: HierarchicalField, prefix: string): HierarchicalField {
  return {
    ...field,
    fullPath: `${prefix}.${field.fullPath}`,
    children: field.children?.map(child => prefixFieldPaths(child, prefix)),
  };
}

function discoverObjectKeys(samples: any[], prefixPath: string): HierarchicalField[] {
  const map = new Map<string, HierarchicalField>();
  for (const s of samples) {
    if (!s || typeof s !== 'object') continue;
    for (const k of Object.keys(s)) {
      if (k.startsWith('_') && k !== '_id' && k !== '_slug') continue;
      if (!map.has(k)) {
        const val = s[k];
        const subType = typeof val === 'number' ? 'number' : typeof val === 'boolean' ? 'boolean' : (val && typeof val === 'object') ? 'object' : 'text';
        let grandChildren: HierarchicalField[] | undefined;
        if (val && typeof val === 'object') {
          grandChildren = discoverObjectKeys(Array.isArray(val) ? val : [val], `${prefixPath}.${k}`);
        }
        map.set(k, {
          id: k,
          name: k,
          fullPath: `${prefixPath}.${k}`,
          type: subType,
          children: grandChildren && grandChildren.length > 0 ? grandChildren : undefined,
        });
      }
    }
  }
  return Array.from(map.values());
}

function discoverChildrenForField(
  fieldId: string,
  referenceCollection: string | undefined,
  sampleItems: any[],
  collectionSchemas?: Map<string, CollectionSchema>,
  collectionData?: Map<string, any[]>,
  visitedCollections = new Set<string>(),
  depth = 1,
): HierarchicalField[] {
  if (depth > 5) return [];
  const childrenMap = new Map<string, HierarchicalField>();

  // 1. If referenceCollection is explicitly provided on field
  if (referenceCollection && collectionSchemas?.has(referenceCollection) && !visitedCollections.has(referenceCollection)) {
    const refSchema = collectionSchemas.get(referenceCollection)!;
    const subFields = buildHierarchicalFields(refSchema, collectionSchemas, collectionData, visitedCollections, depth);
    for (const sf of subFields) {
      childrenMap.set(sf.id, prefixFieldPaths(sf, fieldId));
    }
  }

  // 2. Infer related collection by field naming convention (e.g. categories_m2m / categoriesM2m / category_id -> categories)
  if (collectionSchemas) {
    const cleanId = fieldId.toLowerCase().replace(/_m2m|m2m|_id|id$/i, '').trim();
    for (const [slug, refSchema] of collectionSchemas.entries()) {
      const cleanSlug = slug.toLowerCase();
      if ((cleanSlug === cleanId || cleanSlug === cleanId + 's' || cleanSlug + 's' === cleanId) && !visitedCollections.has(slug)) {
        const subFields = buildHierarchicalFields(refSchema, collectionSchemas, collectionData, visitedCollections, depth);
        for (const sf of subFields) {
          if (!childrenMap.has(sf.id)) {
            childrenMap.set(sf.id, prefixFieldPaths(sf, fieldId));
          }
        }
      }
    }
  }

  // 3. Inspect live sample items in data
  for (const sample of sampleItems.slice(0, 10)) {
    const val = (sample as any)[fieldId];
    if (!val) continue;

    if (Array.isArray(val)) {
      for (const elem of val) {
        if (elem && typeof elem === 'object') {
          for (const key of Object.keys(elem)) {
            if (key.startsWith('_') && key !== '_id' && key !== '_slug') continue;
            if (!childrenMap.has(key)) {
              const subVal = elem[key];
              const subType = typeof subVal === 'number' ? 'number' : typeof subVal === 'boolean' ? 'boolean' : (subVal && typeof subVal === 'object') ? 'object' : 'text';

              let subChildren: HierarchicalField[] | undefined;
              if (subVal && typeof subVal === 'object') {
                const nestedSamples = Array.isArray(subVal) ? subVal : [subVal];
                subChildren = discoverObjectKeys(nestedSamples, `${fieldId}.${key}`);
              } else if (collectionSchemas && (key.endsWith('_id') || key.endsWith('Id') || key.endsWith('_m2m'))) {
                const subClean = key.toLowerCase().replace(/_m2m|m2m|_id|id$/i, '').trim();
                for (const [slug, refSchema] of collectionSchemas.entries()) {
                  if (slug.toLowerCase() === subClean || slug.toLowerCase() === subClean + 's') {
                    const nested = buildHierarchicalFields(refSchema, collectionSchemas, collectionData, visitedCollections, depth + 1);
                    if (nested.length > 0) {
                      subChildren = nested.map(n => prefixFieldPaths(n, `${fieldId}.${key}`));
                    }
                  }
                }
              }

              childrenMap.set(key, {
                id: key,
                name: key,
                fullPath: `${fieldId}.${key}`,
                type: subType,
                children: subChildren && subChildren.length > 0 ? subChildren : undefined,
              });
            }
          }
        }
      }
    } else if (typeof val === 'object' && val !== null) {
      for (const key of Object.keys(val)) {
        if (key.startsWith('_') && key !== '_id' && key !== '_slug') continue;
        if (!childrenMap.has(key)) {
          const subVal = val[key];
          const subType = typeof subVal === 'number' ? 'number' : typeof subVal === 'boolean' ? 'boolean' : (subVal && typeof subVal === 'object') ? 'object' : 'text';
          let subChildren: HierarchicalField[] | undefined;
          if (subVal && typeof subVal === 'object') {
            const nestedSamples = Array.isArray(subVal) ? subVal : [subVal];
            subChildren = discoverObjectKeys(nestedSamples, `${fieldId}.${key}`);
          }
          childrenMap.set(key, {
            id: key,
            name: key,
            fullPath: `${fieldId}.${key}`,
            type: subType,
            children: subChildren && subChildren.length > 0 ? subChildren : undefined,
          });
        }
      }
    }
  }

  return Array.from(childrenMap.values());
}

/**
 * Builds a hierarchical tree of fields for a collection schema, resolving nested
 * relation subfields and discovered array/object fields.
 */
export function buildHierarchicalFields(
  schema: CollectionSchema | null,
  collectionSchemas?: Map<string, CollectionSchema>,
  collectionData?: Map<string, any[]>,
  visitedCollections = new Set<string>(),
  depth = 0,
): HierarchicalField[] {
  if (!schema || depth > 5) return [];
  if (depth === 0) trace.fn('cms-filter-utils:build-hierarchical-fields', { collection: schema.slug });
  const currSlug = schema.slug;
  const sampleItems = collectionData?.get(currSlug) || [];

  const baseFields = fieldsForSortFilter(schema);
  const result: HierarchicalField[] = [];

  for (const f of baseFields) {
    const item: HierarchicalField = {
      id: f.id,
      fullPath: f.id,
      name: f.name || f.id,
      type: f.type || 'text',
    };

    const children = discoverChildrenForField(
      f.id,
      f.referenceCollection,
      sampleItems,
      collectionSchemas,
      collectionData,
      new Set([...visitedCollections, currSlug]),
      depth + 1,
    );

    if (children && children.length > 0) {
      item.children = children;
    }

    result.push(item);
  }

  return result;
}

export function flattenHierarchicalFields(tree: HierarchicalField[], prefixLabel = ''): { fullPath: string; label: string; type: string }[] {
  const list: { fullPath: string; label: string; type: string }[] = [];
  for (const node of tree) {
    const label = prefixLabel ? `${prefixLabel} › ${node.name}` : node.name;
    list.push({ fullPath: node.fullPath, label, type: String(node.type || 'text') });
    if (node.children && node.children.length > 0) {
      list.push(...flattenHierarchicalFields(node.children, label));
    }
  }
  return list;
}
