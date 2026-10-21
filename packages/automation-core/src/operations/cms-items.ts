// packages/automation-core/src/operations/cms-items.ts
import { z } from 'zod';
import type { Operation, FileChange } from '../contracts';
import { defaultRegistry } from '../registry';
import { projectFS } from '@/code/project/project-fs';
import {
  getCollectionData,
  addCollectionItem,
  updateCollectionItem,
  removeCollectionItem,
  reorderCollectionItems,
  getCollectionItemTranslation,
  setCollectionItemTranslation,
} from '@/code/project/cms-ops';
import type { CollectionItem } from '@/shared/types';

// 1. cms.items.list
export const cmsItemsListOperation: Operation<
  { collection: string },
  { collection: string; items: CollectionItem[] }
> = {
  name: 'cms.items.list',
  description: 'List all items in a CMS collection',
  category: 'cms-items',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T16',
  inputSchema: z.object({
    collection: z.string().min(1),
  }),
  async execute(snapshot, input) {
    const items = getCollectionData(input.collection);
    return {
      collection: input.collection,
      items,
    };
  },
};

// 2. cms.items.get
export const cmsItemsGetOperation: Operation<
  { collection: string; itemId?: string; slug?: string },
  { item: CollectionItem | null }
> = {
  name: 'cms.items.get',
  description: 'Get a single CMS item by ID or slug',
  category: 'cms-items',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T16',
  inputSchema: z.object({
    collection: z.string().min(1),
    itemId: z.string().optional(),
    slug: z.string().optional(),
  }),
  async execute(snapshot, input) {
    const items = getCollectionData(input.collection);
    const item = items.find((i) => {
      if (input.itemId && i._id === input.itemId) return true;
      if (input.slug && i._slug === input.slug) return true;
      return false;
    }) ?? null;

    return { item };
  },
};

// 3. cms.items.create
export const cmsItemsCreateOperation: Operation<
  {
    collection: string;
    item: Record<string, unknown>;
  },
  {
    item: CollectionItem;
    changes: FileChange[];
  }
> = {
  name: 'cms.items.create',
  description: 'Create a new item in a CMS collection',
  category: 'cms-items',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T16',
  inputSchema: z.object({
    collection: z.string().min(1),
    item: z.record(z.string(), z.unknown()),
  }),
  async execute(snapshot, input) {
    const created = addCollectionItem(input.collection, input.item);
    const content = projectFS.readFile(`cms/${input.collection}.json`)!;

    return {
      item: created,
      changes: [
        {
          path: `cms/${input.collection}.json`,
          beforeHash: null,
          content,
        },
      ],
    };
  },
};

// 4. cms.items.update
export const cmsItemsUpdateOperation: Operation<
  {
    collection: string;
    itemId: string;
    updates: Record<string, unknown>;
  },
  {
    changes: FileChange[];
  }
> = {
  name: 'cms.items.update',
  description: 'Update fields of an existing CMS item',
  category: 'cms-items',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T16',
  inputSchema: z.object({
    collection: z.string().min(1),
    itemId: z.string().min(1),
    updates: z.record(z.string(), z.unknown()),
  }),
  async execute(snapshot, input) {
    updateCollectionItem(input.collection, input.itemId, input.updates);
    const content = projectFS.readFile(`cms/${input.collection}.json`)!;

    return {
      changes: [
        {
          path: `cms/${input.collection}.json`,
          beforeHash: null,
          content,
        },
      ],
    };
  },
};

// 5. cms.items.remove
export const cmsItemsRemoveOperation: Operation<
  {
    collection: string;
    itemId: string;
  },
  {
    changes: FileChange[];
  }
> = {
  name: 'cms.items.remove',
  description: 'Remove an item from a CMS collection by ID',
  category: 'cms-items',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T16',
  inputSchema: z.object({
    collection: z.string().min(1),
    itemId: z.string().min(1),
  }),
  async execute(snapshot, input) {
    removeCollectionItem(input.collection, input.itemId);
    const content = projectFS.readFile(`cms/${input.collection}.json`)!;

    return {
      changes: [
        {
          path: `cms/${input.collection}.json`,
          beforeHash: null,
          content,
        },
      ],
    };
  },
};

// 6. cms.items.reorder
export const cmsItemsReorderOperation: Operation<
  {
    collection: string;
    orderedIds: string[];
  },
  {
    changes: FileChange[];
  }
> = {
  name: 'cms.items.reorder',
  description: 'Reorder items in a CMS collection',
  category: 'cms-items',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T16',
  inputSchema: z.object({
    collection: z.string().min(1),
    orderedIds: z.array(z.string().min(1)),
  }),
  async execute(snapshot, input) {
    reorderCollectionItems(input.collection, input.orderedIds);
    const content = projectFS.readFile(`cms/${input.collection}.json`)!;

    return {
      changes: [
        {
          path: `cms/${input.collection}.json`,
          beforeHash: null,
          content,
        },
      ],
    };
  },
};

// 7. cms.items.setTranslation
export const cmsItemsSetTranslationOperation: Operation<
  {
    collection: string;
    itemId: string;
    locale: string;
    field: string;
    value: string;
  },
  {
    changes: FileChange[];
  }
> = {
  name: 'cms.items.setTranslation',
  description: 'Set a translated value for a field on an item',
  category: 'cms-items',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T16',
  inputSchema: z.object({
    collection: z.string().min(1),
    itemId: z.string().min(1),
    locale: z.string().min(1),
    field: z.string().min(1),
    value: z.string(),
  }),
  async execute(snapshot, input) {
    setCollectionItemTranslation(
      input.collection,
      input.itemId,
      input.locale,
      input.field,
      input.value,
    );
    const content = projectFS.readFile(`cms/${input.collection}.json`)!;

    return {
      changes: [
        {
          path: `cms/${input.collection}.json`,
          beforeHash: null,
          content,
        },
      ],
    };
  },
};

// 8. cms.items.getTranslation
export const cmsItemsGetTranslationOperation: Operation<
  {
    collection: string;
    itemId: string;
    locale: string;
    field: string;
  },
  {
    value: string;
  }
> = {
  name: 'cms.items.getTranslation',
  description: 'Get a translated value for a field on an item',
  category: 'cms-items',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T16',
  inputSchema: z.object({
    collection: z.string().min(1),
    itemId: z.string().min(1),
    locale: z.string().min(1),
    field: z.string().min(1),
  }),
  async execute(snapshot, input) {
    const value = getCollectionItemTranslation(
      input.collection,
      input.itemId,
      input.locale,
      input.field,
    );
    return { value };
  },
};

defaultRegistry.register(cmsItemsListOperation);
defaultRegistry.register(cmsItemsGetOperation);
defaultRegistry.register(cmsItemsCreateOperation);
defaultRegistry.register(cmsItemsUpdateOperation);
defaultRegistry.register(cmsItemsRemoveOperation);
defaultRegistry.register(cmsItemsReorderOperation);
defaultRegistry.register(cmsItemsSetTranslationOperation);
defaultRegistry.register(cmsItemsGetTranslationOperation);
