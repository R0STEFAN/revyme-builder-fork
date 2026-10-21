// packages/automation-core/src/operations/cms-schema.ts
import { z } from 'zod';
import type { Operation, FileChange } from '../contracts';
import { defaultRegistry } from '../registry';
import { projectFS } from '@/code/project/project-fs';
import {
  listCollections,
  getCollectionSchema,
  saveCollectionSchema,
  saveCollectionData,
  deleteCollection,
  cascadeDeleteCollection,
  createBlankCollection,
  renameCollection,
  duplicateCollection,
  addCollectionField,
  updateCollectionField,
  removeCollectionField,
  reorderCollectionFields,
  slugify,
} from '@/code/project/cms-ops';
import type { CollectionSchema, FieldDefinition } from '@/shared/types';

export const fieldTypeSchema = z.enum([
  'text',
  'textarea',
  'number',
  'boolean',
  'date',
  'image',
  'file',
  'url',
  'link',
  'color',
  'enum',
  'tags',
  'slug',
  'reference',
  'multi-reference',
  'json',
]);

// 1. cms.schema.list
export const cmsSchemaListOperation: Operation<
  Record<string, never>,
  { collections: string[]; schemas: Record<string, CollectionSchema> }
> = {
  name: 'cms.schema.list',
  description: 'List all CMS collections and their schemas',
  category: 'cms-schema',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T16',
  inputSchema: z.object({}),
  async execute() {
    const collections = listCollections();
    const schemas: Record<string, CollectionSchema> = {};
    for (const slug of collections) {
      const s = getCollectionSchema(slug);
      if (s) schemas[slug] = s;
    }
    return { collections, schemas };
  },
};

// 2. cms.schema.get
export const cmsSchemaGetOperation: Operation<
  { slug: string },
  { schema: CollectionSchema }
> = {
  name: 'cms.schema.get',
  description: 'Get schema for a single CMS collection',
  category: 'cms-schema',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T16',
  inputSchema: z.object({
    slug: z.string().min(1),
  }),
  async execute(snapshot, input) {
    const schema = getCollectionSchema(input.slug);
    if (!schema) {
      throw new Error(`Collection "${input.slug}" not found`);
    }
    return { schema };
  },
};

// 3. cms.schema.create
export const cmsSchemaCreateOperation: Operation<
  {
    name: string;
    slug?: string;
    fields?: Array<{
      id?: string;
      name: string;
      type: FieldDefinition['type'];
      required?: boolean;
      defaultValue?: unknown;
      options?: string[];
      referenceCollection?: string;
    }>;
  },
  {
    slug: string;
    schema: CollectionSchema;
    changes: FileChange[];
  }
> = {
  name: 'cms.schema.create',
  description: 'Create a new CMS collection with schema and empty data file',
  category: 'cms-schema',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T16',
  inputSchema: z.object({
    name: z.string().min(1),
    slug: z.string().optional(),
    fields: z.array(
      z.object({
        id: z.string().optional(),
        name: z.string().min(1),
        type: fieldTypeSchema,
        required: z.boolean().optional(),
        defaultValue: z.unknown().optional(),
        options: z.array(z.string()).optional(),
        referenceCollection: z.string().optional(),
      }),
    ).optional(),
  }),
  async execute(snapshot, input) {
    const baseSlug = input.slug ? slugify(input.slug) : slugify(input.name);
    let finalSlug = baseSlug;
    const existing = new Set(listCollections());
    let counter = 2;
    while (existing.has(finalSlug)) {
      finalSlug = `${baseSlug}-${counter}`;
      counter++;
    }

    const fields: FieldDefinition[] = input.fields && input.fields.length > 0
      ? input.fields.map((f, idx) => ({
          id: f.id || (idx === 0 && f.type === 'text' ? 'title' : slugify(f.name).replace(/-/g, '')),
          name: f.name,
          type: f.type,
          required: f.required,
          defaultValue: f.defaultValue,
          options: f.options,
          referenceCollection: f.referenceCollection,
        }))
      : [{ id: 'title', name: 'Title', type: 'text', required: true }];

    const schema: CollectionSchema = {
      name: input.name,
      slug: finalSlug,
      fields,
    };

    saveCollectionSchema(finalSlug, schema);
    saveCollectionData(finalSlug, []);

    const schemaContent = projectFS.readFile(`cms/${finalSlug}.schema.json`)!;
    const dataContent = projectFS.readFile(`cms/${finalSlug}.json`)!;

    return {
      slug: finalSlug,
      schema,
      changes: [
        {
          path: `cms/${finalSlug}.schema.json`,
          beforeHash: null,
          content: schemaContent,
        },
        {
          path: `cms/${finalSlug}.json`,
          beforeHash: null,
          content: dataContent,
        },
      ],
    };
  },
};

// 4. cms.schema.update
export const cmsSchemaUpdateOperation: Operation<
  {
    slug: string;
    name: string;
  },
  {
    schema: CollectionSchema;
    changes: FileChange[];
  }
> = {
  name: 'cms.schema.update',
  description: 'Rename collection display name',
  category: 'cms-schema',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T16',
  inputSchema: z.object({
    slug: z.string().min(1),
    name: z.string().min(1),
  }),
  async execute(snapshot, input) {
    const existing = getCollectionSchema(input.slug);
    if (!existing) {
      throw new Error(`Collection "${input.slug}" not found`);
    }

    renameCollection(input.slug, input.name);
    const updated = getCollectionSchema(input.slug)!;
    const content = projectFS.readFile(`cms/${input.slug}.schema.json`)!;

    return {
      schema: updated,
      changes: [
        {
          path: `cms/${input.slug}.schema.json`,
          beforeHash: null,
          content,
        },
      ],
    };
  },
};

// 5. cms.schema.duplicate
export const cmsSchemaDuplicateOperation: Operation<
  {
    slug: string;
  },
  {
    newSlug: string;
    changes: FileChange[];
  }
> = {
  name: 'cms.schema.duplicate',
  description: 'Duplicate an entire collection (schema and data)',
  category: 'cms-schema',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T16',
  inputSchema: z.object({
    slug: z.string().min(1),
  }),
  async execute(snapshot, input) {
    const newSlug = duplicateCollection(input.slug);
    if (!newSlug) {
      throw new Error(`Collection "${input.slug}" not found for duplication`);
    }

    const schemaContent = projectFS.readFile(`cms/${newSlug}.schema.json`)!;
    const dataContent = projectFS.readFile(`cms/${newSlug}.json`) ?? '[]';

    return {
      newSlug,
      changes: [
        {
          path: `cms/${newSlug}.schema.json`,
          beforeHash: null,
          content: schemaContent,
        },
        {
          path: `cms/${newSlug}.json`,
          beforeHash: null,
          content: dataContent,
        },
      ],
    };
  },
};

// 6. cms.schema.delete
export const cmsSchemaDeleteOperation: Operation<
  {
    slug: string;
    cascade?: boolean;
  },
  {
    changes: FileChange[];
  }
> = {
  name: 'cms.schema.delete',
  description: 'Delete a collection (schema, data, and optionally cascade dependent pages/repeaters)',
  category: 'cms-schema',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T16',
  inputSchema: z.object({
    slug: z.string().min(1),
    cascade: z.boolean().optional().default(false),
  }),
  async execute(snapshot, input) {
    const changes: FileChange[] = [];
    const schemaPath = `cms/${input.slug}.schema.json`;
    const dataPath = `cms/${input.slug}.json`;

    if (input.cascade) {
      cascadeDeleteCollection(input.slug);
    } else {
      deleteCollection(input.slug);
    }

    changes.push(
      { path: schemaPath, beforeHash: null, content: null },
      { path: dataPath, beforeHash: null, content: null },
    );

    return { changes };
  },
};

// 7. cms.field.add
export const cmsFieldAddOperation: Operation<
  {
    collection: string;
    name: string;
    type: FieldDefinition['type'];
    required?: boolean;
    defaultValue?: unknown;
    options?: string[];
    referenceCollection?: string;
  },
  {
    fieldId: string;
    changes: FileChange[];
  }
> = {
  name: 'cms.field.add',
  description: 'Add a new field to a collection schema',
  category: 'cms-schema',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T16',
  inputSchema: z.object({
    collection: z.string().min(1),
    name: z.string().min(1),
    type: fieldTypeSchema,
    required: z.boolean().optional(),
    defaultValue: z.unknown().optional(),
    options: z.array(z.string()).optional(),
    referenceCollection: z.string().optional(),
  }),
  async execute(snapshot, input) {
    const fieldId = addCollectionField(input.collection, {
      name: input.name,
      type: input.type,
      required: input.required,
      defaultValue: input.defaultValue,
      options: input.options,
      referenceCollection: input.referenceCollection,
    });

    if (!fieldId) {
      throw new Error(`Failed to add field to collection "${input.collection}"`);
    }

    const schemaContent = projectFS.readFile(`cms/${input.collection}.schema.json`)!;
    const dataContent = projectFS.readFile(`cms/${input.collection}.json`) ?? '[]';

    return {
      fieldId,
      changes: [
        {
          path: `cms/${input.collection}.schema.json`,
          beforeHash: null,
          content: schemaContent,
        },
        {
          path: `cms/${input.collection}.json`,
          beforeHash: null,
          content: dataContent,
        },
      ],
    };
  },
};

// 8. cms.field.update
export const cmsFieldUpdateOperation: Operation<
  {
    collection: string;
    fieldId: string;
    patch: {
      name?: string;
      type?: FieldDefinition['type'];
      required?: boolean;
      defaultValue?: unknown;
      options?: string[];
      referenceCollection?: string;
    };
  },
  {
    changes: FileChange[];
  }
> = {
  name: 'cms.field.update',
  description: 'Update a field in a collection schema',
  category: 'cms-schema',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T16',
  inputSchema: z.object({
    collection: z.string().min(1),
    fieldId: z.string().min(1),
    patch: z.object({
      name: z.string().optional(),
      type: fieldTypeSchema.optional(),
      required: z.boolean().optional(),
      defaultValue: z.unknown().optional(),
      options: z.array(z.string()).optional(),
      referenceCollection: z.string().optional(),
    }),
  }),
  async execute(snapshot, input) {
    const success = updateCollectionField(input.collection, input.fieldId, input.patch);
    if (!success) {
      throw new Error(`Field "${input.fieldId}" not found in collection "${input.collection}"`);
    }

    const schemaContent = projectFS.readFile(`cms/${input.collection}.schema.json`)!;
    const dataContent = projectFS.readFile(`cms/${input.collection}.json`) ?? '[]';

    return {
      changes: [
        {
          path: `cms/${input.collection}.schema.json`,
          beforeHash: null,
          content: schemaContent,
        },
        {
          path: `cms/${input.collection}.json`,
          beforeHash: null,
          content: dataContent,
        },
      ],
    };
  },
};

// 9. cms.field.remove
export const cmsFieldRemoveOperation: Operation<
  {
    collection: string;
    fieldId: string;
  },
  {
    changes: FileChange[];
  }
> = {
  name: 'cms.field.remove',
  description: 'Remove a field from a collection schema',
  category: 'cms-schema',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T16',
  inputSchema: z.object({
    collection: z.string().min(1),
    fieldId: z.string().min(1),
  }),
  async execute(snapshot, input) {
    const success = removeCollectionField(input.collection, input.fieldId);
    if (!success) {
      throw new Error(`Field "${input.fieldId}" not found in collection "${input.collection}"`);
    }

    const schemaContent = projectFS.readFile(`cms/${input.collection}.schema.json`)!;

    return {
      changes: [
        {
          path: `cms/${input.collection}.schema.json`,
          beforeHash: null,
          content: schemaContent,
        },
      ],
    };
  },
};

// 10. cms.field.reorder
export const cmsFieldReorderOperation: Operation<
  {
    collection: string;
    orderedFieldIds: string[];
  },
  {
    changes: FileChange[];
  }
> = {
  name: 'cms.field.reorder',
  description: 'Reorder fields in a collection schema',
  category: 'cms-schema',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T16',
  inputSchema: z.object({
    collection: z.string().min(1),
    orderedFieldIds: z.array(z.string().min(1)),
  }),
  async execute(snapshot, input) {
    reorderCollectionFields(input.collection, input.orderedFieldIds);
    const schemaContent = projectFS.readFile(`cms/${input.collection}.schema.json`)!;

    return {
      changes: [
        {
          path: `cms/${input.collection}.schema.json`,
          beforeHash: null,
          content: schemaContent,
        },
      ],
    };
  },
};

defaultRegistry.register(cmsSchemaListOperation);
defaultRegistry.register(cmsSchemaGetOperation);
defaultRegistry.register(cmsSchemaCreateOperation);
defaultRegistry.register(cmsSchemaUpdateOperation);
defaultRegistry.register(cmsSchemaDuplicateOperation);
defaultRegistry.register(cmsSchemaDeleteOperation);
defaultRegistry.register(cmsFieldAddOperation);
defaultRegistry.register(cmsFieldUpdateOperation);
defaultRegistry.register(cmsFieldRemoveOperation);
defaultRegistry.register(cmsFieldReorderOperation);
