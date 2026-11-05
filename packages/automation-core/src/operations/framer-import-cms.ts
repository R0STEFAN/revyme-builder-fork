import { z } from 'zod';
import type { CollectionSchema, FieldDefinition } from '@/shared/types';
import { trace } from '@/shared/debug-trace';
import { parse } from '@babel/parser';
import { parsePropMeta } from '@/code/components/prop-meta';
import { extractComponentPropDefaults } from '@/code/parsing/parser';

const identifier = z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/);
const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const provenance = z.record(z.string(), z.unknown());
const fieldSchema = z.object({
  id: identifier, name: z.string().min(1),
  type: z.enum(['text', 'textarea', 'richtext', 'number', 'boolean', 'date', 'image', 'file', 'link', 'url', 'color', 'enum', 'tags', 'slug', 'reference', 'multi-reference', 'json']),
  required: z.boolean().optional(), translatable: z.boolean().optional(), description: z.string().optional(),
  options: z.array(z.string()).optional(), referenceCollection: slug.optional(), defaultValue: z.unknown().optional(),
  source: z.string().optional(), min: z.number().finite().optional(), max: z.number().finite().optional(),
  step: z.number().positive().optional(), maxLength: z.number().int().nonnegative().optional(),
}).strict();
const schemaSchema = z.object({
  name: z.string().min(1), slug, fields: z.array(fieldSchema),
  layouts: z.array(z.object({ id: z.string().min(1), name: z.string().min(1) }).strict()).optional(),
  _framerSource: provenance.optional(),
}).strict();
const rowSchema = z.object({
  _id: z.string().min(1), _slug: z.string().min(1), _status: z.enum(['published', 'draft']),
  _createdAt: z.iso.datetime({ offset: true }), _updatedAt: z.iso.datetime({ offset: true }),
  _publishAt: z.iso.datetime({ offset: true }).optional(), _layout: z.string().optional(),
  _framerSource: provenance.optional(),
}).catchall(z.unknown());
const systemFields = new Set(['_id', '_slug', '_status', '_createdAt', '_updatedAt', '_publishAt', '_layout', '_framerSource']);

function fail(message: string): never { throw new Error(`CMS_INVALID: ${message}`); }
function parseJson(content: string, path: string): unknown {
  try {
    return JSON.parse(content, (key, value) => {
      if (key === '__proto__' || key === 'prototype' || key === 'constructor') fail(`Unsafe key in ${path}`);
      return value;
    });
  } catch (error) { return fail(`Invalid JSON in ${path}: ${String(error)}`); }
}

/** Validate the affected collection closure against a candidate, without ProjectFS access. */
export function validateFramerImportCms(files: ReadonlyMap<string, string>, changedPaths: ReadonlySet<string>): string[] {
  const affected = new Set([...changedPaths].filter(path => /^cms\/.+\.json$/.test(path)).map(path => path.slice(4).replace(/(?:\.schema)?\.json$/, '')));
  const references: { path: string; prop: string; collection: string; value: unknown }[] = [];
  for (const [path, code] of files) {
    if (!/\.tsx$/.test(path)) continue;
    const entries = Object.entries(parsePropMeta(code)).filter(([, meta]) => meta.type === 'reference' && (changedPaths.has(path) || !!meta.referenceCollection && affected.has(meta.referenceCollection)));
    if (!entries.length) continue;
    const defaults = extractComponentPropDefaults(parse(code, { sourceType: 'module', plugins: ['typescript', 'jsx'] }), true);
    for (const [prop, meta] of entries) {
      if (!meta.referenceCollection) fail(`Missing prop reference collection ${path}:${prop}`);
      affected.add(meta.referenceCollection);
      references.push({ path, prop, collection: meta.referenceCollection, value: defaults[prop] });
    }
  }
  trace.fn('framer-import.validateCms', { collections: affected.size });
  if (!affected.size) return [];
  // Replacing a referenced record must also preserve inbound references in existing data.
  let grew = true;
  while (grew) {
    grew = false;
    for (const [path, code] of files) {
      if (!/^cms\/.+\.schema\.json$/.test(path)) continue;
      const name = path.slice(4, -12);
      if (affected.has(name)) continue;
      let candidate: unknown;
      try { candidate = JSON.parse(code); } catch { continue; }
      const parsed = schemaSchema.safeParse(candidate);
      if (parsed.success && parsed.data.fields.some(field => field.referenceCollection && affected.has(field.referenceCollection))) {
        affected.add(name); grew = true;
      }
    }
  }
  const collections = new Map<string, { schema: CollectionSchema; rows: z.infer<typeof rowSchema>[] }>();
  function load(name: string): void {
    if (collections.has(name)) return;
    const schemaPath = `cms/${name}.schema.json`, dataPath = `cms/${name}.json`;
    const schemaCode = files.get(schemaPath), dataCode = files.get(dataPath);
    if (schemaCode === undefined || dataCode === undefined) fail(`Missing schema/data pair for ${name}`);
    const schemaResult = schemaSchema.safeParse(parseJson(schemaCode, schemaPath));
    const dataResult = z.array(rowSchema).safeParse(parseJson(dataCode, dataPath));
    if (!schemaResult.success) fail(`${schemaPath}: ${schemaResult.error.message}`);
    if (!dataResult.success) fail(`${dataPath}: ${dataResult.error.message}`);
    const schema = schemaResult.data, rows = dataResult.data;
    if (schema.slug !== name) fail(`Schema slug does not match ${schemaPath}`);
    const fieldIds = new Set<string>();
    for (const field of schema.fields) {
      if (fieldIds.has(field.id) || systemFields.has(field.id)) fail(`Duplicate/reserved field ${name}.${field.id}`);
      fieldIds.add(field.id);
      if (field.min !== undefined && field.max !== undefined && field.min > field.max) fail(`Reversed bounds ${name}.${field.id}`);
      if (field.type === 'reference' || field.type === 'multi-reference') {
        if (!field.referenceCollection) fail(`Missing reference collection ${name}.${field.id}`);
      }
    }
    const ids = new Set<string>(), slugs = new Set<string>();
    for (const row of rows) {
      if (ids.has(row._id) || slugs.has(row._slug)) fail(`Duplicate record id/slug in ${name}`);
      ids.add(row._id); slugs.add(row._slug);
      for (const key of Object.keys(row)) if (!fieldIds.has(key) && !systemFields.has(key)) fail(`Unknown field ${name}.${key}`);
      if (row._layout && !schema.layouts?.some(layout => layout.id === row._layout)) fail(`Missing row layout in ${name}`);
    }
    collections.set(name, { schema, rows }); // Before following references: self/cyclic collections are valid.
    for (const field of schema.fields) if (field.type === 'reference' || field.type === 'multi-reference') load(field.referenceCollection!);
  }
  for (const name of affected) load(name);
  for (const ref of references) {
    if (ref.value == null || ref.value === '') continue;
    if (typeof ref.value !== 'string' || !collections.get(ref.collection)!.rows.some(row => row._id === ref.value)) fail(`Dangling prop reference ${ref.path}:${ref.prop}`);
  }

  function checkValue(value: unknown, field: FieldDefinition, label: string): void {
    if (value === undefined || value === null) {
      if (field.required) fail(`Required value ${label}`);
      return;
    }
    const type = field.type;
    if (type === 'json') return;
    if (type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) fail(`Expected number ${label}`);
      if (field.min !== undefined && value < field.min || field.max !== undefined && value > field.max) fail(`Number bounds ${label}`);
    } else if (type === 'boolean') {
      if (typeof value !== 'boolean') fail(`Expected boolean ${label}`);
    } else if (type === 'tags' || type === 'multi-reference') {
      if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) fail(`Expected string array ${label}`);
      if (field.required && !value.length) fail(`Required values ${label}`);
      if (field.min !== undefined && value.length < field.min || field.max !== undefined && value.length > field.max) fail(`Array bounds ${label}`);
      if (type === 'multi-reference') for (const id of value) checkReference(id, field, label);
    } else {
      if (typeof value !== 'string') fail(`Expected string ${label}`);
      if (field.required && !value.trim()) fail(`Required text ${label}`);
      if (field.maxLength !== undefined && value.length > field.maxLength) fail(`Text length ${label}`);
      if (type === 'date' && value && !Number.isFinite(Date.parse(value))) fail(`Invalid date ${label}`);
      if (type === 'enum' && value && !field.options?.includes(value)) fail(`Unknown enum option ${label}`);
      if (type === 'reference' && value) checkReference(value, field, label);
      if ((type === 'image' || type === 'file') && value) {
        if (value.startsWith('/assets/')) {
          if (!files.has(`public${value}`)) fail(`Missing asset ${label}: ${value}`);
        } else if (!/^https:\/\//.test(value) && !/^\/api\/uploads\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) fail(`Unresolved asset ${label}`);
      }
    }
  }
  function checkReference(id: string, field: FieldDefinition, label: string): void {
    if (!collections.get(field.referenceCollection!)?.rows.some(row => row._id === id)) fail(`Dangling reference ${label}: ${id}`);
  }
  for (const [name, { schema, rows }] of collections) {
    for (const field of schema.fields) {
      if (field.defaultValue !== undefined) checkValue(field.defaultValue, field, `${name}.${field.id} default`);
      for (const row of rows) checkValue(row[field.id], field, `${name}/${row._id}.${field.id}`);
    }
  }
  return [...collections].filter(([name]) => changedPaths.has(`cms/${name}.json`)).flatMap(([, { rows }]) => rows.map(row => row._id));
}
