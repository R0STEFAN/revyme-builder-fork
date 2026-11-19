// packages/automation-core/src/operations/assets.ts
import fs from 'node:fs';
import path from 'node:path';
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

const HISTORY_FILE_PATH = '_meta/history.json';

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
    fileName?: string;
    filePath?: string;
    url?: string;
    content?: string; // base64 or text (for SVG)
    encoding?: 'base64' | 'utf-8';
    folder?: string;
  },
  {
    changes: FileChange[];
    asset: ProjectAsset;
  }
> = {
  name: 'assets.upload',
  description: 'Upload and save an asset file directly from a local filePath, remote URL, or content string into project storage',
  category: 'assets',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T12',
  inputSchema: z.object({
    fileName: z.string().optional(),
    filePath: z.string().optional().describe('Absolute or workspace-relative path to a local file on disk'),
    url: z.string().optional().describe('Remote HTTP/HTTPS URL of an image to download and save directly'),
    content: z.string().optional().describe('Direct file content (base64 or text)'),
    encoding: z.enum(['base64', 'utf-8']).optional().default('utf-8'),
    folder: z.string().optional().default('public/api/uploads'),
  }).refine((data) => Boolean(data.filePath || data.url || (data.fileName && data.content)), {
    message: 'Must provide either filePath, url, or both fileName and content',
  }),
  async execute(snapshot, input) {
    let rawBuffer: Buffer;
    let derivedFileName = input.fileName;

    if (input.filePath) {
      const resolvedPath = path.isAbsolute(input.filePath)
        ? input.filePath
        : path.resolve(process.cwd(), input.filePath);
      if (!fs.existsSync(resolvedPath)) {
        throw new Error(`Asset file does not exist at filePath: "${input.filePath}"`);
      }
      rawBuffer = fs.readFileSync(resolvedPath);
      if (!derivedFileName) {
        derivedFileName = path.basename(resolvedPath);
      }
    } else if (input.url) {
      const res = await fetch(input.url);
      if (!res.ok) {
        throw new Error(`Failed to fetch asset from URL "${input.url}": HTTP ${res.status}`);
      }
      const arrayBuf = await res.arrayBuffer();
      rawBuffer = Buffer.from(arrayBuf);
      if (!derivedFileName) {
        try {
          const u = new URL(input.url);
          derivedFileName = path.basename(u.pathname) || 'downloaded-asset';
        } catch {
          derivedFileName = 'downloaded-asset';
        }
      }
    } else if (input.content) {
      if (input.encoding === 'base64' || input.content.startsWith('data:')) {
        const cleanBase64 = input.content.replace(/^data:[^;]+;base64,/, '');
        rawBuffer = Buffer.from(cleanBase64, 'base64');
      } else {
        rawBuffer = Buffer.from(input.content, 'utf-8');
      }
      if (!derivedFileName) {
        derivedFileName = 'asset.bin';
      }
    } else {
      throw new Error('Must provide either filePath, url, or content');
    }

    const folderInput = input.folder ?? 'public/api/uploads';
    const folder = folderInput.endsWith('/') ? folderInput.slice(0, -1) : folderInput;
    const cleanFileName = derivedFileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const targetPath = `${folder}/${cleanFileName}`;
    const url = targetPath.replace(/^public\//, '/');
    const mimeType = guessMimeType(targetPath);
    const isText = targetPath.endsWith('.svg') || targetPath.endsWith('.json') || targetPath.endsWith('.txt');
    const finalContent = isText
      ? rawBuffer.toString('utf-8')
      : `data:${mimeType};base64,${rawBuffer.toString('base64')}`;
    const hash = simpleHash(finalContent);
    const sizeBytes = rawBuffer.length;

    const asset: ProjectAsset = {
      path: targetPath,
      url,
      hash,
      sizeBytes,
      mimeType,
    };

    return {
      changes: [
        {
          path: targetPath,
          beforeHash: null,
          content: finalContent,
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
        if (filePath === input.path || filePath === HISTORY_FILE_PATH) continue;
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
      if (filePath.startsWith('public/') || filePath === HISTORY_FILE_PATH) continue;
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
