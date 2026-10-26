// packages/automation-core/src/operations/cms-bindings.ts
import { z } from 'zod';
import type { Operation, FileChange } from '../contracts';
import { defaultRegistry } from '../registry';
import { projectFS } from '@/code/project/project-fs';
import {
  createCollectionListInCode,
  updateCollectionListConfigInCode,
  bindFieldInCode,
  unbindFieldInCode,
} from '@/code/generation/cms-gen';
import { bindToCmsCollectionInCode } from '@/code/generation/map-gen';
import {
  setPaginationInCode,
  removePaginationInCode,
  ensureLoadMoreComponentFile,
  ensureSpinnerComponentFile,
} from '@/code/generation/cms-pagination-gen';
import type { FilterGroup, SortConfig } from '@/shared/types';

// 1. cms.list.create
export const cmsListCreateOperation: Operation<
  {
    targetFile: string;
    parentId: string;
    collection: string;
    itemTemplateId: string;
  },
  {
    changes: FileChange[];
  }
> = {
  name: 'cms.list.create',
  description: 'Wrap a template item in a .map() repeater bound to a collection',
  category: 'cms-bindings',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T16',
  inputSchema: z.object({
    targetFile: z.string().min(1),
    parentId: z.string().min(1),
    collection: z.string().min(1),
    itemTemplateId: z.string().min(1),
  }),
  async execute(snapshot, input) {
    let code = snapshot.files.get(input.targetFile) ?? projectFS.readFile(input.targetFile);
    if (!code) {
      throw new Error(`Target file "${input.targetFile}" not found`);
    }

    code = bindToCmsCollectionInCode(
      code,
      input.itemTemplateId,
      input.collection,
    );

    return {
      changes: [
        {
          path: input.targetFile,
          beforeHash: null,
          content: code,
        },
      ],
    };
  },
};

// 2. cms.list.configure
export const cmsListConfigureOperation: Operation<
  {
    targetFile: string;
    parentId: string;
    filterGroup?: FilterGroup;
    sort?: SortConfig;
    limit?: number;
    offset?: number;
  },
  {
    changes: FileChange[];
  }
> = {
  name: 'cms.list.configure',
  description: 'Configure filter, sort, limit, and offset on a collection list repeater',
  category: 'cms-bindings',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T16',
  inputSchema: z.object({
    targetFile: z.string().min(1),
    parentId: z.string().min(1),
    filterGroup: z.any().optional(),
    sort: z.any().optional(),
    limit: z.number().positive().optional(),
    offset: z.number().nonnegative().optional(),
  }),
  async execute(snapshot, input) {
    let code = snapshot.files.get(input.targetFile) ?? projectFS.readFile(input.targetFile);
    if (!code) {
      throw new Error(`Target file "${input.targetFile}" not found`);
    }

    let filterGroup = input.filterGroup;
    if (typeof filterGroup === 'string') {
      try {
        filterGroup = JSON.parse(filterGroup);
      } catch {
        /* skip */
      }
    }
    let sort = input.sort;
    if (typeof sort === 'string') {
      try {
        sort = JSON.parse(sort);
      } catch {
        /* skip */
      }
    }

    let fg: FilterGroup | undefined = undefined;
    if (filterGroup) {
      const rawFilters = filterGroup.filters ?? (filterGroup as any).rules ?? [];
      const normalizedFilters = rawFilters.map((f: any) => ({
        ...f,
        operator: f.operator === 'eq' ? 'equals' : f.operator === 'neq' ? 'not_equals' : f.operator,
      }));
      fg = {
        combinator: filterGroup.combinator ?? 'and',
        filters: normalizedFilters,
      };
    }

    code = updateCollectionListConfigInCode(
      code,
      input.parentId,
      fg,
      sort,
      input.limit,
      input.offset,
    );

    return {
      changes: [
        {
          path: input.targetFile,
          beforeHash: null,
          content: code,
        },
      ],
    };
  },
};

// 3. cms.list.paginate
export const cmsListPaginateOperation: Operation<
  {
    targetFile: string;
    parentId: string;
    mode: 'loadMore' | 'infinite';
    perPage?: number;
  },
  {
    changes: FileChange[];
  }
> = {
  name: 'cms.list.paginate',
  description: 'Attach Load More or Infinite Scroll pagination to a collection list',
  category: 'cms-bindings',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T16',
  inputSchema: z.object({
    targetFile: z.string().min(1),
    parentId: z.string().min(1),
    mode: z.enum(['loadMore', 'infinite']),
    perPage: z.number().positive().optional(),
  }),
  async execute(snapshot, input) {
    let code = snapshot.files.get(input.targetFile) ?? projectFS.readFile(input.targetFile);
    if (!code) {
      throw new Error(`Target file "${input.targetFile}" not found`);
    }

    code = setPaginationInCode(code, input.parentId, {
      mode: input.mode,
      perPage: input.perPage ?? 6,
    });

    const scaffoldPath = input.mode === 'loadMore' ? 'components/LoadMore.tsx' : 'components/Spinner.tsx';
    if (input.mode === 'loadMore') ensureLoadMoreComponentFile();
    else ensureSpinnerComponentFile();
    const scaffoldCode = projectFS.readFile(scaffoldPath);
    const changes: FileChange[] = [
      {
        path: input.targetFile,
        beforeHash: null,
        content: code,
      },
    ];
    if (scaffoldCode !== null && scaffoldCode !== snapshot.files.get(scaffoldPath)) {
      changes.push({ path: scaffoldPath, beforeHash: null, content: scaffoldCode });
    }

    return {
      changes,
    };
  },
};

// 4. cms.list.unpaginate
export const cmsListUnpaginateOperation: Operation<
  {
    targetFile: string;
    parentId: string;
  },
  {
    changes: FileChange[];
  }
> = {
  name: 'cms.list.unpaginate',
  description: 'Remove pagination from a collection list',
  category: 'cms-bindings',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T16',
  inputSchema: z.object({
    targetFile: z.string().min(1),
    parentId: z.string().min(1),
  }),
  async execute(snapshot, input) {
    let code = snapshot.files.get(input.targetFile) ?? projectFS.readFile(input.targetFile);
    if (!code) {
      throw new Error(`Target file "${input.targetFile}" not found`);
    }

    code = removePaginationInCode(code, input.parentId);

    return {
      changes: [
        {
          path: input.targetFile,
          beforeHash: null,
          content: code,
        },
      ],
    };
  },
};

// 5. cms.field.bind
export const cmsFieldBindOperation: Operation<
  {
    targetFile: string;
    nodeId: string;
    property: string;
    fieldId: string;
    itemVar?: string;
    fieldType?: string;
  },
  {
    changes: FileChange[];
  }
> = {
  name: 'cms.field.bind',
  description: 'Bind an element property to a CMS field on the repeated item',
  category: 'cms-bindings',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T16',
  inputSchema: z.object({
    targetFile: z.string().min(1),
    nodeId: z.string().min(1),
    property: z.string().min(1),
    fieldId: z.string().min(1),
    itemVar: z.string().optional(),
    fieldType: z.string().optional(),
  }),
  async execute(snapshot, input) {
    let code = snapshot.files.get(input.targetFile) ?? projectFS.readFile(input.targetFile);
    if (!code) {
      throw new Error(`Target file "${input.targetFile}" not found`);
    }

    code = bindFieldInCode(
      code,
      input.nodeId,
      input.property,
      input.fieldId,
      input.itemVar ?? 'item',
      input.fieldType,
    );

    return {
      changes: [
        {
          path: input.targetFile,
          beforeHash: null,
          content: code,
        },
      ],
    };
  },
};

// 6. cms.field.unbind
export const cmsFieldUnbindOperation: Operation<
  {
    targetFile: string;
    nodeId: string;
    property: string;
    fallbackValue?: string;
  },
  {
    changes: FileChange[];
  }
> = {
  name: 'cms.field.unbind',
  description: 'Unbind an element property from a CMS field and restore static value',
  category: 'cms-bindings',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T16',
  inputSchema: z.object({
    targetFile: z.string().min(1),
    nodeId: z.string().min(1),
    property: z.string().min(1),
    fallbackValue: z.string().optional(),
  }),
  async execute(snapshot, input) {
    let code = snapshot.files.get(input.targetFile) ?? projectFS.readFile(input.targetFile);
    if (!code) {
      throw new Error(`Target file "${input.targetFile}" not found`);
    }

    code = unbindFieldInCode(
      code,
      input.nodeId,
      input.property,
      input.fallbackValue ?? '',
    );

    return {
      changes: [
        {
          path: input.targetFile,
          beforeHash: null,
          content: code,
        },
      ],
    };
  },
};

defaultRegistry.register(cmsListCreateOperation);
defaultRegistry.register(cmsListConfigureOperation);
defaultRegistry.register(cmsListPaginateOperation);
defaultRegistry.register(cmsListUnpaginateOperation);
defaultRegistry.register(cmsFieldBindOperation);
defaultRegistry.register(cmsFieldUnbindOperation);
