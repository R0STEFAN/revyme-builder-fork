// packages/automation-core/src/operations/folders.ts
import { z } from 'zod';
import { createHash } from 'node:crypto';
import type { Operation, FileChange, Snapshot, OperationContext } from '../contracts';
import { defaultRegistry } from '../registry';
import { projectFS } from '@/code/project/project-fs';
import { listPageFolders, createPageFolder, PAGE_FOLDERS_FILE_PATH } from '@/code/project/page-folders';
import { COMMENTS_FILE_PATH, parseComments, serializeComments } from '@/code/project/comments-config';
import { syncProjectSnapshotToProjectFS } from './projects';

export type FolderKind = 'pages' | 'components' | 'templates' | 'vectors' | 'plugins' | 'presets';

export interface FolderItemNode {
  id: string;
  name: string;
  parentId: string | null;
  children: string[];
}

export interface FoldersConfigFile {
  version: number;
  rootOrder: string[];
  folders: FolderItemNode[];
}

const KIND_CONFIG: Record<
  Exclude<FolderKind, 'pages'>,
  { storagePath: string; idPrefix: string }
> = {
  components: { storagePath: '_meta/component-folders.json', idPrefix: 'fld-' },
  templates: { storagePath: '_meta/template-folders.json', idPrefix: 'tfld-' },
  vectors: { storagePath: '_meta/vector-folders.json', idPrefix: 'vfld-' },
  plugins: { storagePath: '_meta/plugin-folders.json', idPrefix: 'pfld-' },
  presets: { storagePath: '_meta/preset-folders.json', idPrefix: 'pfld-' },
};

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function loadFoldersConfigFile(storagePath: string): FoldersConfigFile {
  const json = projectFS.readFile(storagePath);
  if (!json) {
    return { version: 1, rootOrder: [], folders: [] };
  }
  try {
    const parsed = JSON.parse(json);
    return {
      version: typeof parsed?.version === 'number' ? parsed.version : 1,
      rootOrder: Array.isArray(parsed?.rootOrder) ? parsed.rootOrder : [],
      folders: Array.isArray(parsed?.folders) ? parsed.folders : [],
    };
  } catch {
    return { version: 1, rootOrder: [], folders: [] };
  }
}

function saveFoldersConfigFile(storagePath: string, config: FoldersConfigFile): FileChange {
  const beforeContent = projectFS.readFile(storagePath);
  const beforeHash = beforeContent !== null ? sha256(beforeContent) : null;
  const newContent = JSON.stringify(config, null, 2) + '\n';
  projectFS.writeFile(storagePath, newContent);
  return {
    path: storagePath,
    beforeHash,
    content: newContent,
  };
}

// ─── 1. folders.list ──────────────────────────────────────────────────────────

export const foldersListInputSchema = z.object({
  kind: z.enum(['pages', 'components', 'templates', 'vectors', 'plugins', 'presets']),
});
export type FoldersListInput = z.infer<typeof foldersListInputSchema>;

export interface FolderListItem {
  id: string;
  name: string;
  parentId?: string;
  count: number;
}

export interface FoldersListOutput {
  kind: FolderKind;
  folders: FolderListItem[];
}

export const foldersListOperation: Operation<FoldersListInput, FoldersListOutput> = {
  name: 'folders.list',
  description: 'List folders of the specified kind (pages, components, templates, vectors, plugins, presets)',
  category: 'folders',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T21',
  inputSchema: foldersListInputSchema,
  async execute(snapshot, input, context: OperationContext) {
    syncProjectSnapshotToProjectFS(snapshot);
    const { kind } = input;

    if (kind === 'pages') {
      const explicitDirs = listPageFolders();
      const allAppFiles = projectFS.listFiles('app/');
      const pageDirs = new Set<string>(explicitDirs);

      // Collect directories containing page.client.tsx
      for (const f of allAppFiles) {
        if (f.endsWith('/page.client.tsx')) {
          const dir = f.replace(/\/page\.client\.tsx$/, '');
          if (dir !== 'app') {
            pageDirs.add(dir);
          }
        }
      }

      const folders: FolderListItem[] = Array.from(pageDirs)
        .sort()
        .map((dir) => {
          const count = allAppFiles.filter(
            (f) => f.startsWith(`${dir}/`) && f.endsWith('page.client.tsx'),
          ).length;
          const parentDir = dir.includes('/') && dir.lastIndexOf('/') > 3 ? dir.substring(0, dir.lastIndexOf('/')) : undefined;
          return {
            id: dir,
            name: dir.replace(/^app\/?/, ''),
            parentId: parentDir,
            count,
          };
        });

      context?.trace?.('folders:list', { kind, count: folders.length });

      return {
        kind,
        folders,
      };
    }

    const { storagePath, idPrefix } = KIND_CONFIG[kind];
    const config = loadFoldersConfigFile(storagePath);
    const folders: FolderListItem[] = config.folders.map((f) => ({
      id: f.id,
      name: f.name,
      parentId: f.parentId ?? undefined,
      count: f.children.filter((c) => !c.startsWith(idPrefix)).length,
    }));

    context?.trace?.('folders:list', { kind, count: folders.length });

    return {
      kind,
      folders,
    };
  },
};

// ─── 2. folders.create ────────────────────────────────────────────────────────

export const foldersCreateInputSchema = z.object({
  kind: z.enum(['pages', 'components', 'templates', 'vectors', 'plugins', 'presets']),
  name: z.string().min(1, 'Folder name must not be empty'),
  parentId: z.string().optional(),
});
export type FoldersCreateInput = z.infer<typeof foldersCreateInputSchema>;

export interface FoldersCreateOutput {
  folderId: string;
  name: string;
  changes: FileChange[];
}

export const foldersCreateOperation: Operation<FoldersCreateInput, FoldersCreateOutput> = {
  name: 'folders.create',
  description: 'Create a new folder under specified kind and optional parent',
  category: 'folders',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T21',
  inputSchema: foldersCreateInputSchema,
  async execute(snapshot, input, context: OperationContext) {
    syncProjectSnapshotToProjectFS(snapshot);
    const { kind } = input;
    const trimmedName = input.name.trim();
    if (!trimmedName) {
      throw new Error('VALIDATION_ERROR: Folder name must not be empty.');
    }

    if (kind === 'pages') {
      const parentDir = input.parentId ? input.parentId.trim() : 'app';
      const beforeContent = projectFS.readFile(PAGE_FOLDERS_FILE_PATH);
      const beforeHash = beforeContent !== null ? sha256(beforeContent) : null;

      const createdDir = createPageFolder(trimmedName, parentDir);
      const afterContent = projectFS.readFile(PAGE_FOLDERS_FILE_PATH);

      const change: FileChange = {
        path: PAGE_FOLDERS_FILE_PATH,
        beforeHash,
        content: afterContent,
      };

      context?.trace?.('folders:create:page', { dir: createdDir });

      return {
        folderId: createdDir,
        name: createdDir.replace(/^app\/?/, ''),
        changes: [change],
      };
    }

    const { storagePath, idPrefix } = KIND_CONFIG[kind];
    const config = loadFoldersConfigFile(storagePath);

    if (input.parentId) {
      const parentExists = config.folders.some((f) => f.id === input.parentId);
      if (!parentExists) {
        throw new Error(`Parent folder "${input.parentId}" does not exist.`);
      }
    }

    const folderId = context?.createId
      ? context.createId(idPrefix.replace(/-$/, ''))
      : `${idPrefix}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

    const newFolder: FolderItemNode = {
      id: folderId,
      name: trimmedName,
      parentId: input.parentId ?? null,
      children: [],
    };

    if (input.parentId) {
      const parent = config.folders.find((f) => f.id === input.parentId);
      if (parent) {
        parent.children.push(folderId);
      }
    } else {
      config.rootOrder.push(folderId);
    }

    config.folders.push(newFolder);
    const change = saveFoldersConfigFile(storagePath, config);

    context?.trace?.('folders:create', { kind, folderId, name: trimmedName });

    return {
      folderId,
      name: trimmedName,
      changes: [change],
    };
  },
};

// ─── 3. folders.moveItem ──────────────────────────────────────────────────────

export const foldersMoveItemInputSchema = z.object({
  kind: z.enum(['pages', 'components', 'templates', 'vectors', 'plugins', 'presets']),
  itemId: z.string().min(1, 'Item ID must not be empty'),
  targetFolderId: z.string().nullable(),
});
export type FoldersMoveItemInput = z.infer<typeof foldersMoveItemInputSchema>;

export interface FoldersMoveItemOutput {
  itemId: string;
  targetFolderId: string | null;
  changes: FileChange[];
}

export const foldersMoveItemOperation: Operation<FoldersMoveItemInput, FoldersMoveItemOutput> = {
  name: 'folders.moveItem',
  description: 'Move an item or folder into target folder or root with cycle validation',
  category: 'folders',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T21',
  inputSchema: foldersMoveItemInputSchema,
  async execute(snapshot, input, context: OperationContext) {
    syncProjectSnapshotToProjectFS(snapshot);
    const { kind, itemId, targetFolderId } = input;
    const changes: FileChange[] = [];

    if (kind === 'pages') {
      // 1. Moving a page file
      if (itemId.endsWith('page.client.tsx') || itemId.endsWith('page.tsx')) {
        const clientPath = itemId.endsWith('page.client.tsx') ? itemId : itemId.replace(/page\.tsx$/, 'page.client.tsx');
        const clientCode = projectFS.readFile(clientPath);
        if (!clientCode) {
          throw new Error(`Page file "${clientPath}" does not exist.`);
        }

        // Extract route segment
        const segments = clientPath.split('/');
        // e.g. ['app', 'about', 'page.client.tsx'] -> slug is 'about'
        const slug = segments[segments.length - 2];
        const targetDir = targetFolderId ? (targetFolderId.startsWith('app/') ? targetFolderId : `app/${targetFolderId}`) : 'app';
        const newClientPath = `${targetDir}/${slug}/page.client.tsx`;

        if (clientPath !== newClientPath) {
          if (projectFS.readFile(newClientPath) !== null) {
            throw new Error(`DESTINATION_CONFLICT: Destination page "${newClientPath}" already exists.`);
          }

          // Move client file
          const clientBeforeHash = sha256(clientCode);
          projectFS.deleteFile(clientPath);
          changes.push({ path: clientPath, beforeHash: clientBeforeHash, content: null });

          projectFS.writeFile(newClientPath, clientCode);
          changes.push({ path: newClientPath, beforeHash: null, content: clientCode });

          // Move server page file if present
          const serverPath = clientPath.replace(/page\.client\.tsx$/, 'page.tsx');
          const serverCode = projectFS.readFile(serverPath);
          if (serverCode !== null) {
            const newServerPath = `${targetDir}/${slug}/page.tsx`;
            const serverBeforeHash = sha256(serverCode);
            projectFS.deleteFile(serverPath);
            changes.push({ path: serverPath, beforeHash: serverBeforeHash, content: null });

            projectFS.writeFile(newServerPath, serverCode);
            changes.push({ path: newServerPath, beforeHash: null, content: serverCode });
          }

          // Retarget comments if anchored to old page
          const commentsRaw = projectFS.readFile(COMMENTS_FILE_PATH);
          if (commentsRaw) {
            const comments = parseComments(commentsRaw);
            let updated = false;
            for (const c of comments) {
              if (c.filePath === clientPath) {
                c.filePath = newClientPath;
                updated = true;
              }
            }
            if (updated) {
              const beforeCommentHash = sha256(commentsRaw);
              const serialized = serializeComments(comments);
              projectFS.writeFile(COMMENTS_FILE_PATH, serialized);
              changes.push({ path: COMMENTS_FILE_PATH, beforeHash: beforeCommentHash, content: serialized });
            }
          }
        }

        context?.trace?.('folders:moveItem:page', { from: clientPath, to: newClientPath });
        return {
          itemId,
          targetFolderId,
          changes,
        };
      }

      // 2. Moving a page folder
      if (targetFolderId === itemId || (targetFolderId && targetFolderId.startsWith(`${itemId}/`))) {
        throw new Error(`Cycle detected: Cannot move folder "${itemId}" into its descendant "${targetFolderId}".`);
      }
      return {
        itemId,
        targetFolderId,
        changes,
      };
    }

    const { storagePath, idPrefix } = KIND_CONFIG[kind];
    const config = loadFoldersConfigFile(storagePath);
    const isFolder = itemId.startsWith(idPrefix) || config.folders.some((f) => f.id === itemId);

    // Cycle detection for folder move
    if (isFolder) {
      if (targetFolderId === itemId) {
        throw new Error(`Cycle detected: Cannot move folder "${itemId}" into itself.`);
      }
      if (targetFolderId !== null) {
        let cursor: string | null = targetFolderId;
        while (cursor !== null) {
          if (cursor === itemId) {
            throw new Error(`Cycle detected: Cannot move folder "${itemId}" into its descendant "${targetFolderId}".`);
          }
          const parentNode = config.folders.find((f) => f.id === cursor);
          cursor = parentNode?.parentId ?? null;
        }
      }
    }

    if (targetFolderId !== null) {
      const targetFolder = config.folders.find((f) => f.id === targetFolderId);
      if (!targetFolder) {
        throw new Error(`Target folder "${targetFolderId}" does not exist.`);
      }
    }

    // Remove itemId from rootOrder and all folders' children
    config.rootOrder = config.rootOrder.filter((id) => id !== itemId);
    for (const f of config.folders) {
      f.children = f.children.filter((id) => id !== itemId);
    }

    // Place into target
    if (targetFolderId === null) {
      config.rootOrder.push(itemId);
      if (isFolder) {
        const folder = config.folders.find((f) => f.id === itemId);
        if (folder) folder.parentId = null;
      }
    } else {
      const targetFolder = config.folders.find((f) => f.id === targetFolderId)!;
      targetFolder.children.push(itemId);
      if (isFolder) {
        const folder = config.folders.find((f) => f.id === itemId);
        if (folder) folder.parentId = targetFolderId;
      }
    }

    const change = saveFoldersConfigFile(storagePath, config);
    changes.push(change);

    context?.trace?.('folders:moveItem', { kind, itemId, targetFolderId });

    return {
      itemId,
      targetFolderId,
      changes,
    };
  },
};

// ─── Registry Registration & Aliases ─────────────────────────────────────────

defaultRegistry.register(foldersListOperation);
defaultRegistry.register(foldersCreateOperation);
defaultRegistry.register(foldersMoveItemOperation);

defaultRegistry.registerAlias('folders.add', 'folders.create');
defaultRegistry.registerAlias('folders.move', 'folders.moveItem');
