// packages/automation-core/src/operations/metadata.ts
import { z } from 'zod';
import type { Operation, FileChange, Snapshot } from '../contracts';
import { defaultRegistry } from '../registry';
import {
  parseMetadataFromCode,
  parseSiteConfigFromCode,
  updateMetadataInCode,
  ensureLayoutFile,
  moduleParses,
  type SiteMetadata,
} from '@/code/generation/metadata-gen';

// 1. metadata.read operation
export const metadataReadOperation: Operation<
  { targetFile?: string },
  {
    targetFile: string;
    metadata: SiteMetadata;
    siteConfig?: Record<string, string>;
  }
> = {
  name: 'metadata.read',
  description: 'Read SEO metadata and siteConfig from layout.tsx or a specific page file',
  category: 'metadata',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T06',
  inputSchema: z.object({
    targetFile: z.string().optional().default('app/layout.tsx'),
  }),
  async execute(snapshot, input) {
    const targetFile = input.targetFile || 'app/layout.tsx';
    const code = snapshot.files.get(targetFile);

    if (!code) {
      return {
        targetFile,
        metadata: {},
        siteConfig: {},
      };
    }

    const metadata = parseMetadataFromCode(code);
    const siteConfig = parseSiteConfigFromCode(code);

    return {
      targetFile,
      metadata,
      siteConfig,
    };
  },
};

// 2. metadata.update operation
export const metadataUpdateOperation: Operation<
  {
    targetFile?: string;
    metadata: Record<string, unknown>;
    siteConfig?: Record<string, string>;
  },
  {
    targetFile: string;
    changes: FileChange[];
  }
> = {
  name: 'metadata.update',
  description: 'Update SEO metadata (title, description, openGraph, favicon) and siteConfig in layout.tsx or page.tsx',
  category: 'metadata',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T06',
  inputSchema: z.object({
    targetFile: z.string().optional().default('app/layout.tsx'),
    metadata: z.record(z.string(), z.unknown()),
    siteConfig: z.record(z.string(), z.string()).optional(),
  }),
  async execute(snapshot, input) {
    const targetFile = input.targetFile || 'app/layout.tsx';
    let code = snapshot.files.get(targetFile);

    if (!code) {
      if (targetFile === 'app/layout.tsx') {
        code = ensureLayoutFile();
      } else {
        throw new Error(`FILE_NOT_FOUND: Target file "${targetFile}" not found in project`);
      }
    }

    let nextCode = updateMetadataInCode(code, input.metadata as SiteMetadata);

    if (input.siteConfig) {
      // Update siteConfig block if provided
      const siteConfigDecl = `export const siteConfig: Record<string, string> = ${JSON.stringify(input.siteConfig, null, 2)};`;
      if (/export\s+const\s+siteConfig[\s\S]*?;/.test(nextCode)) {
        nextCode = nextCode.replace(/export\s+const\s+siteConfig[\s\S]*?;/, siteConfigDecl);
      } else {
        nextCode = `${nextCode}\n\n${siteConfigDecl}`;
      }
    }

    if (!moduleParses(nextCode)) {
      throw new Error(`METADATA_PARSE_ERROR: Generated code in ${targetFile} has syntax errors and cannot be parsed as a module`);
    }

    const changes: FileChange[] = [
      {
        path: targetFile,
        beforeHash: null,
        content: nextCode,
      },
    ];

    return {
      targetFile,
      changes,
    };
  },
};

// Register metadata operations
defaultRegistry.register(metadataReadOperation);
defaultRegistry.register(metadataUpdateOperation);
