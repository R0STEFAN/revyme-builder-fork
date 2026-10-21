// packages/automation-core/src/operations/assets.ts
import { z } from 'zod';
import type { Operation, FileChange, Snapshot } from '../contracts';
import { defaultRegistry } from '../registry';
import { simpleHash } from '@/shared/hash-utils';

export interface ProjectAsset {
  path: string;
  url: string;
  hash: string;
  sizeBytes: number;
  mimeType: string;
}

function guessMimeType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'png': return 'image/png';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'svg': return 'image/svg+xml';
    case 'webp': return 'image/webp';
    case 'gif': return 'image/gif';
    case 'mp4': return 'video/mp4';
    case 'webm': return 'video/webm';
    case 'mp3': return 'audio/mpeg';
    case 'wav': return 'audio/wav';
    case 'woff2': return 'font/woff2';
    case 'woff': return 'font/woff';
    default: return 'application/octet-stream';
  }
}

// 1. assets.list
export const assetsListOperation: Operation<
  { prefix?: string },
  { assets: ProjectAsset[] }
> = {
  name: 'assets.list',
  description: 'List all media and static assets stored in the project',
  category: 'assets',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T12',
  inputSchema: z.object({
    prefix: z.string().optional(),
  }),
  async execute(snapshot, input) {
    const assets: ProjectAsset[] = [];
    const searchPrefix = input.prefix ?? 'public/';

    for (const [path, content] of snapshot.files.entries()) {
      if (path.startsWith(searchPrefix) || path.startsWith('public/assets/') || path.startsWith('public/images/')) {
        const url = path.replace(/^public\//, '/');
        const hash = simpleHash(content);
        const mimeType = guessMimeType(path);
        const sizeBytes = Buffer.byteLength(content, 'utf-8');

        assets.push({
          path,
          url,
          hash,
          sizeBytes,
          mimeType,
        });
      }
    }

    return { assets };
  },
};

// 2. assets.upload
export const assetsUploadOperation: Operation<
  {
    fileName: string;
    content: string; // base64 or text (for SVG)
    encoding?: 'base64' | 'utf-8';
    folder?: string;
  },
  {
    changes: FileChange[];
    asset: ProjectAsset;
  }
> = {
  name: 'assets.upload',
  description: 'Upload and save an asset file into the project storage',
  category: 'assets',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T12',
  inputSchema: z.object({
    fileName: z.string().min(1),
    content: z.string().min(1),
    encoding: z.enum(['base64', 'utf-8']).optional().default('utf-8'),
    folder: z.string().optional().default('public/assets'),
  }),
  async execute(snapshot, input) {
    const folderInput = input.folder ?? 'public/assets';
    const folder = folderInput.endsWith('/') ? folderInput.slice(0, -1) : folderInput;
    const cleanFileName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${folder}/${cleanFileName}`;
    const url = path.replace(/^public\//, '/');
    const mimeType = guessMimeType(path);
    const hash = simpleHash(input.content);
    const sizeBytes = Buffer.byteLength(input.content, input.encoding ?? 'utf-8');

    const asset: ProjectAsset = {
      path,
      url,
      hash,
      sizeBytes,
      mimeType,
    };

    return {
      changes: [
        {
          path,
          beforeHash: null,
          content: input.content,
        },
      ],
      asset,
    };
  },
};

// 3. assets.delete
export const assetsDeleteOperation: Operation<
  {
    path: string;
    force?: boolean;
  },
  {
    changes: FileChange[];
    deletedPath: string;
  }
> = {
  name: 'assets.delete',
  description: 'Delete an asset from the project (refuses if referenced in source code unless force is true)',
  category: 'assets',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T12',
  inputSchema: z.object({
    path: z.string().min(1),
    force: z.boolean().optional().default(false),
  }),
  async execute(snapshot, input) {
    if (!snapshot.files.has(input.path)) {
      throw new Error(`ASSET_NOT_FOUND: Asset file "${input.path}" does not exist in project`);
    }

    const url = input.path.replace(/^public\//, '/');

    if (!input.force) {
      // Check references in code
      for (const [filePath, content] of snapshot.files.entries()) {
        if (filePath === input.path) continue;
        if (content.includes(url) || content.includes(input.path)) {
          throw new Error(`ASSET_IN_USE: Asset "${input.path}" is currently referenced in "${filePath}". Pass force=true to delete anyway.`);
        }
      }
    }

    return {
      changes: [
        {
          path: input.path,
          beforeHash: null,
          content: null,
        },
      ],
      deletedPath: input.path,
    };
  },
};

// 4. assets.audit
export const assetsAuditOperation: Operation<
  Record<string, never>,
  {
    totalAssets: number;
    usedAssets: string[];
    unusedAssets: string[];
    brokenReferences: Array<{ filePath: string; referencedUrl: string }>;
  }
> = {
  name: 'assets.audit',
  description: 'Audit asset usage across all project files: identify unused assets and broken references',
  category: 'assets',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T12',
  inputSchema: z.object({}),
  async execute(snapshot) {
    const existingAssetUrls = new Set<string>();
    for (const path of snapshot.files.keys()) {
      if (path.startsWith('public/')) {
        existingAssetUrls.add(path.replace(/^public\//, '/'));
      }
    }

    const usedAssetUrls = new Set<string>();
    const brokenReferences: Array<{ filePath: string; referencedUrl: string }> = [];

    // URL regex matching /assets/... or /images/...
    const assetUrlRegex = /(?:\/assets\/[a-zA-Z0-9._-]+|\/images\/[a-zA-Z0-9._-]+)/g;

    for (const [filePath, content] of snapshot.files.entries()) {
      if (filePath.startsWith('public/')) continue;
      const matches = content.match(assetUrlRegex);
      if (matches) {
        for (const url of matches) {
          if (existingAssetUrls.has(url)) {
            usedAssetUrls.add(url);
          } else {
            brokenReferences.push({ filePath, referencedUrl: url });
          }
        }
      }
    }

    const unusedAssets: string[] = [];
    const usedAssets: string[] = [];
    for (const url of existingAssetUrls) {
      if (usedAssetUrls.has(url)) {
        usedAssets.push(url);
      } else {
        unusedAssets.push(url);
      }
    }

    return {
      totalAssets: existingAssetUrls.size,
      usedAssets,
      unusedAssets,
      brokenReferences,
    };
  },
};

defaultRegistry.register(assetsListOperation);
defaultRegistry.register(assetsUploadOperation);
defaultRegistry.register(assetsDeleteOperation);
defaultRegistry.register(assetsAuditOperation);
