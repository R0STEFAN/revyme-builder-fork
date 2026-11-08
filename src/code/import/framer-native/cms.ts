import { trace } from '../../../shared/debug-trace';
import type { CollectionItem, CollectionSchema, FieldDefinition } from '../../../shared/types';
import { sourceRecord, sourceVariableKey, sourceVariables } from './source-graph';
import { sourceStaticLinkValue } from './links';
import type { NativeCompileResult, SourceGraph, SourceProperties } from './types';
import { renameCustomPropertyInText } from '../../generation/preset-refs-gen';

export interface NativeCmsOptions {
  assets?: Record<string, string>;
  locale?: string;
  defaultLocale?: string;
  colorNames?: Record<string, string>;
}
export function nativeCollectionSlug(identity: Record<string, string>, collectionId: string): string {
  const id = identity[collectionId];
  if (!id) throw new Error(`Missing collection identity ${collectionId}`);
  return id.replace(/-/g, '');
}
export function sourceCollectionId(identifier: unknown): string {
  const match = typeof identifier === 'string' && /^local-module:collection\/([^:]+):/.exec(identifier);
  if (!match) throw new Error(`Unsupported collection identifier ${String(identifier)}`);
  return match[1];
}
export function nativeFieldId(identity: Record<string, string>, collectionId: string, fieldId: string): string {
  if (fieldId === 'id') return '_id';
  const value = identity[sourceVariableKey(collectionId, fieldId)];
  if (!value) throw new Error(`Missing field identity ${collectionId}:${fieldId}`);
  return value;
}

const fieldTypes: Record<string, FieldDefinition['type']> = {
  string: 'text', richtext: 'richtext', number: 'number', boolean: 'boolean', date: 'date',
  image: 'image', file: 'file', link: 'link', url: 'url', color: 'color', enum: 'enum',
  collectionreference: 'reference', multicollectionreference: 'multi-reference',
  array: 'json',
};

/** Pure, all-or-nothing CMS file generation. No clock or ProjectFS access. */
export function emitNativeCms(graph: SourceGraph, identity: Record<string, string>, options: NativeCmsOptions = {}): NativeCompileResult {
  trace.fn('framer-native.emitNativeCms', { collections: graph.byKind.get('CollectionNode')?.length ?? 0 });
  const result: NativeCompileResult = { files: [], createdIds: [], identity, diagnostics: [...graph.diagnostics] };
  const fatalErrors = result.diagnostics.filter(d => d.code === 'SOURCE_CAPTURE_INVALID');
  if (fatalErrors.length) return result;
  if (options.locale && options.locale !== options.defaultLocale) {
    result.diagnostics.push({ code: 'SOURCE_CMS_LOCALE_UNAVAILABLE', property: 'locale', message: `No original localized CMS values were captured for ${options.locale}.` });
    return result;
  }
  const collections = (graph.byKind.get('CollectionNode') ?? []).filter(id => graph.reachable.has(id));
  let activeScope: string | undefined;
  try {
    const collectionSet = new Set(collections);
    const resolveValue = (value: unknown, variable: SourceProperties, collectionId: string): unknown => {
      if (value === undefined || value === null || value === '') return value;
      const type = String(variable.type);
      if (type === 'color' && typeof value === 'string') {
        let color = value;
        for (const [id, name] of Object.entries(options.colorNames ?? {})) color = renameCustomPropertyInText(color, `token-${id}`, name, true);
        if (/var\(--token-/.test(color)) throw new Error(`Unresolved source color token in ${collectionId}:${String(variable.id)}`);
        return color;
      }
      if (type === 'collectionreference' || type === 'multicollectionreference') {
        const target = sourceCollectionId(variable.dataIdentifier);
        if (!collectionSet.has(target)) throw new Error(`Missing referenced collection ${target}`);
        const resolveId = (sourceId: unknown) => {
          if (typeof sourceId !== 'string' || !graph.nodes.get(target)!.children.includes(sourceId) || !identity[sourceId]) throw new Error(`Unresolved reference ${String(sourceId)} in ${collectionId}:${String(variable.id)}`);
          return identity[sourceId];
        };
        if (type === 'multicollectionreference') {
          if (!Array.isArray(value)) throw new Error(`Invalid multi-reference ${String(variable.id)}`);
          return value.map(resolveId);
        }
        return resolveId(value);
      }
      if (type === 'boolean') {
        if (typeof value !== 'boolean') throw new Error(`Invalid boolean ${String(variable.id)}`);
      } else if (type === 'number') {
        if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Invalid number ${String(variable.id)}`);
      } else if (type === 'array') {
        const isGallery = (Array.isArray(variable.itemVariables) && variable.itemVariables.some((v: any) => v.type === 'image')) ||
          String(variable.name ?? '').toLowerCase().includes('gallery') ||
          String(variable.name ?? '').toLowerCase().includes('slideshow');
        if (isGallery && Array.isArray(value)) {
          return value.map((item: any) => {
            let ref: string | undefined;
            if (typeof item === 'string') ref = item;
            else if (item && typeof item === 'object') {
              if (item.value && typeof item.value === 'object') {
                for (const subVal of Object.values(item.value)) {
                  if (typeof subVal === 'string') ref = subVal;
                  else if (subVal && typeof subVal === 'object' && typeof (subVal as any).value === 'string') {
                    ref = (subVal as any).value;
                  }
                }
              } else if (typeof item.value === 'string') {
                ref = item.value;
              } else if (typeof item.url === 'string') {
                ref = item.url;
              }
            }
            if (ref && typeof ref === 'string' && ref.startsWith('data:framer/asset-reference,')) {
              if (options.assets?.[ref]) return options.assets[ref];
              const keyMatch = ref.slice('data:framer/asset-reference,'.length).split('.')[0];
              if (keyMatch) return `/api/uploads/${keyMatch}.webp`;
            }
            return ref || item;
          }).filter(Boolean);
        }
        return value;
      } else if (type === 'link' || type === 'url') {
        const resolvedLink = sourceStaticLinkValue(value);
        if (typeof resolvedLink !== 'string') throw new Error(`Unsupported ${type} value in ${String(variable.id)}`);
        return resolvedLink;
      } else if (typeof value !== 'string') throw new Error(`Unsupported ${type} value in ${String(variable.id)}`);
      if ((type === 'image' || type === 'file') && typeof value === 'string' && value.startsWith('data:framer/asset-reference,')) {
        if (!options.assets?.[value]) {
          result.diagnostics.push({ code: 'SOURCE_CMS_INVALID', message: `Unresolved source asset in ${collectionId}:${String(variable.id)}` });
        }
        return options.assets?.[value] ?? value;
      }
      return value;
    };
    const files: NativeCompileResult['files'] = [];
    const createdIds: string[] = [];
    for (const collectionId of collections) {
      activeScope = collectionId;
      const collection = graph.nodes.get(collectionId)!;
      const slug = nativeCollectionSlug(identity, collectionId);
      const variables = sourceVariables(graph, collectionId);
      const fields: FieldDefinition[] = [];
      for (const variable of variables) {
        const type = String(variable.type);
        if (type === 'divider' || type === 'slug') continue;
        if (!fieldTypes[type]) throw new Error(`Unsupported CMS field type ${type} in ${collectionId}:${String(variable.id)}`);
        const isGallery = type === 'array' && (
          (Array.isArray(variable.itemVariables) && variable.itemVariables.some((v: any) => v.type === 'image')) ||
          String(variable.name ?? '').toLowerCase().includes('gallery') ||
          String(variable.name ?? '').toLowerCase().includes('slideshow')
        );
        const resolvedType = isGallery ? 'gallery' : fieldTypes[type];
        const field: FieldDefinition = { id: nativeFieldId(identity, collectionId, String(variable.id)), name: String(variable.name ?? variable.id), type: resolvedType };
        if (typeof variable.description === 'string') field.description = variable.description;
        for (const key of ['required', 'translatable'] as const) if (typeof variable[key] === 'boolean') field[key] = variable[key];
        for (const key of ['min', 'max', 'step', 'maxLength'] as const) if (typeof variable[key] === 'number') field[key] = variable[key];
        if (type === 'collectionreference' || type === 'multicollectionreference') {
          const referenced = sourceCollectionId(variable.dataIdentifier);
          if (!collectionSet.has(referenced)) throw new Error(`Missing referenced schema ${referenced}`);
          field.referenceCollection = nativeCollectionSlug(identity, referenced);
        }
        if (type === 'enum') {
          if (!Array.isArray(variable.options) || !variable.options.every(value => typeof value === 'string')) throw new Error(`Unsupported enum options ${String(variable.id)}`);
          field.options = [...variable.options];
        }
        if (variable.initialValue !== undefined) field.defaultValue = resolveValue(variable.initialValue, variable, collectionId);
        fields.push(field);
        if (type === 'collectionreference') {
          const targetCollectionId = sourceCollectionId(variable.dataIdentifier);
          if (collectionSet.has(targetCollectionId)) {
            const headNative = field.id;
            for (const targetVar of sourceVariables(graph, targetCollectionId)) {
              const targetType = String(targetVar.type);
              if (targetType === 'divider' || targetType === 'slug' || targetType === 'collectionreference' || targetType === 'multicollectionreference') continue;
              if (!fieldTypes[targetType]) continue;
              const tailNative = nativeFieldId(identity, targetCollectionId, String(targetVar.id));
              const subField: FieldDefinition = {
                id: `${headNative}_${tailNative}`,
                name: `${field.name} · ${String(targetVar.name ?? targetVar.id)}`,
                type: fieldTypes[targetType],
              };
              if (targetType === 'enum' && Array.isArray(targetVar.options) && targetVar.options.every(v => typeof v === 'string')) {
                subField.options = [...targetVar.options];
              }
              fields.push(subField);
            }
          }
        }
      }
      const { children: _children, ...sourceSchema } = collection.raw;
      const schema: CollectionSchema & { _framerSource: SourceProperties } = { name: String(collection.raw.name ?? collectionId), slug, fields, _framerSource: sourceSchema };
      const slugFields = variables.filter(variable => variable.type === 'slug');
      if (slugFields.length !== 1) throw new Error(`Expected one original slug field on ${collectionId}`);
      const data: CollectionItem[] = [];
      const slugs = new Set<string>();
      for (const sourceId of collection.children) {
        const source = graph.nodes.get(sourceId);
        if (!source || source.kind !== 'CollectionItemNode' || !identity[sourceId]) throw new Error(`Invalid collection row ${sourceId}`);
        const raw = source.raw;
        if (raw.privateToUserId) throw new Error(`Private CMS row ${sourceId} requires a native access adapter`);
        if (raw.isDraft !== undefined && typeof raw.isDraft !== 'boolean') throw new Error(`Invalid draft status ${sourceId}`);
        for (const key of ['createdAt', 'updatedAt']) if (typeof raw[key] !== 'string' || !Number.isFinite(Date.parse(raw[key] as string))) throw new Error(`Missing/invalid source date ${key} on ${sourceId}`);
        const sourceSlug = sourceRecord(raw[`$control__${String(slugFields[0].id)}`])?.value ?? slugFields[0].initialValue;
        if (typeof sourceSlug !== 'string' || !sourceSlug || slugs.has(sourceSlug)) throw new Error(`Missing/duplicate original slug on ${sourceId}`);
        slugs.add(sourceSlug);
        const row: CollectionItem = { _id: identity[sourceId], _slug: sourceSlug, _status: raw.isDraft === true ? 'draft' : 'published', _createdAt: raw.createdAt as string, _updatedAt: raw.updatedAt as string, _framerSource: raw };
        for (const variable of variables) {
          if (variable.type === 'divider' || variable.type === 'slug') continue;
          const control = sourceRecord(raw[`$control__${String(variable.id)}`]);
          const value = control && 'value' in control ? control.value : variable.initialValue;
          const headNative = nativeFieldId(identity, collectionId, String(variable.id));
          if (value !== undefined) row[headNative] = resolveValue(value, variable, collectionId);
          if (variable.type === 'collectionreference' && typeof variable.dataIdentifier === 'string') {
            const targetCollectionId = sourceCollectionId(variable.dataIdentifier);
            if (collectionSet.has(targetCollectionId)) {
              const targetVars = sourceVariables(graph, targetCollectionId);
              const targetNode = typeof value === 'string' ? graph.nodes.get(value) : undefined;
              if (targetNode && targetNode.kind === 'CollectionItemNode') {
                for (const targetVar of targetVars) {
                  const targetType = String(targetVar.type);
                  if (targetType === 'divider' || targetType === 'slug' || targetType === 'collectionreference' || targetType === 'multicollectionreference') continue;
                  if (!fieldTypes[targetType]) continue;
                  const tailNative = nativeFieldId(identity, targetCollectionId, String(targetVar.id));
                  const targetControl = sourceRecord(targetNode.raw[`$control__${String(targetVar.id)}`]);
                  const targetVal = targetControl && 'value' in targetControl ? targetControl.value : targetVar.initialValue;
                  if (targetVal !== undefined) row[`${headNative}_${tailNative}`] = resolveValue(targetVal, targetVar, targetCollectionId);
                }
              }
            }
          }
        }
        data.push(row); createdIds.push(row._id);
      }
      files.push({ path: `cms/${slug}.schema.json`, code: JSON.stringify(schema, null, 2) + '\n' }, { path: `cms/${slug}.json`, code: JSON.stringify(data, null, 2) + '\n' });
    }
    result.files = files; result.createdIds = createdIds;
    trace.action('framer-native.cmsEmitted', { collections: collections.length, records: createdIds.length });
  } catch (error) {
    result.diagnostics.push({ code: 'SOURCE_CMS_INVALID', sourceId: activeScope, message: error instanceof Error ? error.message : String(error) });
  }
  return result;
}
