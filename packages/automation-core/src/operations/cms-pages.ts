// packages/automation-core/src/operations/cms-pages.ts
import { z } from 'zod';
import type { Operation, FileChange } from '../contracts';
import { defaultRegistry } from '../registry';
import { projectFS } from '@/code/project/project-fs';
import {
  createCmsIndexPageFile,
  createCmsDetailPageFile,
  findCmsPageFile,
} from '@/code/project/cms-page-ops';
import {
  buildCmsDetailServerWrapper,
  parseCmsSeoBindings,
  parseCmsSeoDefaults,
  wrapperCollection,
  hasGenerateStaticParams,
  ensureCmsDetailStaticParams,
  type CmsSeoBindings,
} from '@/code/project/cms-seo';

// 1. cms.pages.createIndex
export const cmsPagesCreateIndexOperation: Operation<
  { collection: string },
  { clientPath: string; serverPath: string; changes: FileChange[] }
> = {
  name: 'cms.pages.createIndex',
  description: 'Create a new CMS index list page (server + client pair)',
  category: 'cms-pages',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T16',
  inputSchema: z.object({
    collection: z.string().min(1),
  }),
  async execute(snapshot, input) {
    const clientPath = createCmsIndexPageFile(input.collection);
    const serverPath = clientPath.replace(/\.client\.tsx$/, '.tsx');

    const clientCode = projectFS.readFile(clientPath) ?? '';
    const serverCode = projectFS.readFile(serverPath) ?? '';

    return {
      clientPath,
      serverPath,
      changes: [
        { path: clientPath, beforeHash: null, content: clientCode },
        { path: serverPath, beforeHash: null, content: serverCode },
      ],
    };
  },
};

// 2. cms.pages.createDetail
export const cmsPagesCreateDetailOperation: Operation<
  { collection: string; atRoot?: boolean },
  { clientPath: string; serverPath: string; changes: FileChange[] }
> = {
  name: 'cms.pages.createDetail',
  description: 'Create a new CMS detail template page with dynamic [slug] route',
  category: 'cms-pages',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T16',
  inputSchema: z.object({
    collection: z.string().min(1),
    atRoot: z.boolean().optional(),
  }),
  async execute(snapshot, input) {
    const clientPath = createCmsDetailPageFile(input.collection, { atRoot: input.atRoot });
    const serverPath = clientPath.replace(/\.client\.tsx$/, '.tsx');

    const clientCode = projectFS.readFile(clientPath) ?? '';
    let serverCode = projectFS.readFile(serverPath) ?? '';
    serverCode = ensureCmsDetailStaticParams(serverCode);
    projectFS.writeFile(serverPath, serverCode);

    return {
      clientPath,
      serverPath,
      changes: [
        { path: clientPath, beforeHash: null, content: clientCode },
        { path: serverPath, beforeHash: null, content: serverCode },
      ],
    };
  },
};

// 3. cms.pages.find
export const cmsPagesFindOperation: Operation<
  { collection: string; kind: 'index' | 'detail' },
  { filePath: string | null }
> = {
  name: 'cms.pages.find',
  description: 'Find the existing index or detail page path for a collection',
  category: 'cms-pages',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T16',
  inputSchema: z.object({
    collection: z.string().min(1),
    kind: z.enum(['index', 'detail']),
  }),
  async execute(snapshot, input) {
    const filePath = findCmsPageFile(input.collection, input.kind);
    return { filePath };
  },
};

// 4. cms.pages.seo
export const cmsPagesSeoOperation: Operation<
  {
    targetFile: string;
    bindings: Record<string, string>;
    defaults?: Record<string, any>;
  },
  {
    changes: FileChange[];
  }
> = {
  name: 'cms.pages.seo',
  description: 'Configure SEO field bindings on a CMS detail page server wrapper',
  category: 'cms-pages',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T16',
  inputSchema: z.object({
    targetFile: z.string().min(1),
    bindings: z.record(z.string(), z.string()),
    defaults: z.record(z.string(), z.any()).optional(),
  }),
  async execute(snapshot, input) {
    const serverPath = input.targetFile.endsWith('.client.tsx')
      ? input.targetFile.replace(/\.client\.tsx$/, '.tsx')
      : input.targetFile;

    const currentCode = snapshot.files.get(serverPath) ?? projectFS.readFile(serverPath);
    if (!currentCode) {
      throw new Error(`Server wrapper "${serverPath}" not found`);
    }

    const collection = wrapperCollection(currentCode);
    if (!collection) {
      throw new Error(`File "${serverPath}" does not look like a CMS detail server wrapper`);
    }

    const existingBindings = parseCmsSeoBindings(currentCode);
    const existingDefaults = parseCmsSeoDefaults(currentCode);

    const mergedBindings: CmsSeoBindings = {
      ...existingBindings,
      ...input.bindings,
    };
    const mergedDefaults = {
      ...existingDefaults,
      ...(input.defaults ?? {}),
    };

    let newServerCode = buildCmsDetailServerWrapper({
      collection,
      defaults: mergedDefaults,
      bindings: mergedBindings,
      includeStaticParams: true,
    });
    newServerCode = ensureCmsDetailStaticParams(newServerCode);

    projectFS.writeFile(serverPath, newServerCode);

    return {
      changes: [
        {
          path: serverPath,
          beforeHash: null,
          content: newServerCode,
        },
      ],
    };
  },
};

defaultRegistry.register(cmsPagesCreateIndexOperation);
defaultRegistry.register(cmsPagesCreateDetailOperation);
defaultRegistry.register(cmsPagesFindOperation);
defaultRegistry.register(cmsPagesSeoOperation);
