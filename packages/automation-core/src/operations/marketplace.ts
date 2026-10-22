// packages/automation-core/src/operations/marketplace.ts
import { z } from 'zod';
import { createHash } from 'node:crypto';
import type { Operation, FileChange, Snapshot, OperationContext } from '../contracts';
import { FileChangeSchema } from '../contracts';
import { defaultRegistry } from '../registry';
import { projectFS } from '@/code/project/project-fs';
import { checkFile } from '@/code/oracle/check-file';
import { syncCodeSnapshotToProjectFS } from './code-components';

// ─── Constants & Helpers ─────────────────────────────────────────────────────

export const ASSET_SHARE_URL_REGEX = /^https:\/\/assets\.revyme\.app\/(components|vectors)\/([\w-]+)@([a-f0-9]+)\.js$/;
export const LISTINGS_STORAGE_PATH = '_meta/marketplace-listings.json';

export function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function toPascalCase(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_-]/g, '');
  const pascal = cleaned
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
  return /^[A-Z]/.test(pascal) ? pascal : `Remote${pascal || 'Component'}`;
}

// ─── Canonical Mock Catalog ──────────────────────────────────────────────────

export interface MarketplaceItem {
  id: string;
  name: string;
  kind: 'component' | 'vector' | 'template';
  url: string;
  description: string;
  pricingType: 'free' | 'paid';
}

export const CANONICAL_MARKETPLACE_ITEMS: MarketplaceItem[] = [
  {
    id: 'item-comp-hero',
    name: 'HeroSection',
    kind: 'component',
    url: 'https://assets.revyme.app/components/HeroSection@a1b2c3d4e5f6.js',
    description: 'Responsive hero section with headline, CTA buttons, and badge',
    pricingType: 'free',
  },
  {
    id: 'item-comp-pricing',
    name: 'PricingTable',
    kind: 'component',
    url: 'https://assets.revyme.app/components/PricingTable@b2c3d4e5f6a1.js',
    description: 'Three-tier pricing comparison table with monthly/annual billing toggle',
    pricingType: 'free',
  },
  {
    id: 'item-comp-navbar',
    name: 'NavbarFloating',
    kind: 'component',
    url: 'https://assets.revyme.app/components/NavbarFloating@c3d4e5f6a1b2.js',
    description: 'Glassmorphic floating navigation bar with mobile sheet drawer',
    pricingType: 'paid',
  },
  {
    id: 'item-comp-testimonials',
    name: 'TestimonialsGrid',
    kind: 'component',
    url: 'https://assets.revyme.app/components/TestimonialsGrid@d4e5f6a1b2c3.js',
    description: 'Customer reviews masonry card grid with ratings and avatars',
    pricingType: 'free',
  },
  {
    id: 'item-comp-footer',
    name: 'FooterMega',
    kind: 'component',
    url: 'https://assets.revyme.app/components/FooterMega@e5f6a1b2c3d4.js',
    description: 'Multi-column footer layout with newsletter signup and social icons',
    pricingType: 'free',
  },
  {
    id: 'item-vec-feather',
    name: 'FeatherIcons',
    kind: 'vector',
    url: 'https://assets.revyme.app/vectors/FeatherIcons@f6a1b2c3d4e5.js',
    description: 'Minimalist 24x24 outline vector icon library',
    pricingType: 'free',
  },
  {
    id: 'item-vec-lucide',
    name: 'LucideSet',
    kind: 'vector',
    url: 'https://assets.revyme.app/vectors/LucideSet@1a2b3c4d5e6f.js',
    description: 'Modern comprehensive icon suite with standardized stroke metrics',
    pricingType: 'free',
  },
  {
    id: 'item-vec-brand',
    name: 'BrandLogos',
    kind: 'vector',
    url: 'https://assets.revyme.app/vectors/BrandLogos@2b3c4d5e6f1a.js',
    description: 'Vector tech stack and developer tool corporate identity marks',
    pricingType: 'paid',
  },
  {
    id: 'item-tpl-agency',
    name: 'AgencyPortfolio',
    kind: 'template',
    url: 'https://assets.revyme.app/components/AgencyPortfolio@3c4d5e6f1a2b.js',
    description: 'Creative digital agency portfolio and case study showcase template',
    pricingType: 'free',
  },
  {
    id: 'item-tpl-saas',
    name: 'SaaSKit',
    kind: 'template',
    url: 'https://assets.revyme.app/components/SaaSKit@4d5e6f1a2b3c.js',
    description: 'High-converting B2B SaaS startup landing page with interactive demos',
    pricingType: 'paid',
  },
  {
    id: 'item-tpl-blog',
    name: 'PersonalBlog',
    kind: 'template',
    url: 'https://assets.revyme.app/components/PersonalBlog@5e6f1a2b3c4d.js',
    description: 'Minimalist editorial blog and typography-focused publishing layout',
    pricingType: 'free',
  },
];

// ─── 1. marketplace.browse ───────────────────────────────────────────────────

export const marketplaceBrowseInputSchema = z.object({
  query: z.string().optional(),
  kind: z.enum(['component', 'vector', 'template']).optional(),
});
export type MarketplaceBrowseInput = z.infer<typeof marketplaceBrowseInputSchema>;

export const marketplaceItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string(),
  url: z.string(),
  description: z.string(),
  pricingType: z.string(),
});

export const marketplaceBrowseOutputSchema = z.object({
  items: z.array(marketplaceItemSchema),
});
export type MarketplaceBrowseOutput = z.infer<typeof marketplaceBrowseOutputSchema>;

export const marketplaceBrowseOperation: Operation<
  MarketplaceBrowseInput,
  MarketplaceBrowseOutput
> = {
  name: 'marketplace.browse',
  description: 'Query approved marketplace components, vectors, and templates with filtering',
  category: 'marketplace',
  kind: 'service',
  permit: 'read',
  environment: 'service',
  ownerTask: 'T22',
  inputSchema: marketplaceBrowseInputSchema,
  outputSchema: marketplaceBrowseOutputSchema,
  async execute(_snapshot, input, context: OperationContext) {
    if (
      context?.adapters &&
      typeof (context.adapters as any).marketplaceClient?.browse === 'function'
    ) {
      const adapterRes = await (context.adapters as any).marketplaceClient.browse(
        input?.query,
        input?.kind,
      );
      if (adapterRes && Array.isArray(adapterRes.items)) {
        return { items: adapterRes.items };
      }
    }

    let items = [...CANONICAL_MARKETPLACE_ITEMS];
    if (input?.kind) {
      items = items.filter((item) => item.kind === input.kind);
    }
    if (input?.query && input.query.trim().length > 0) {
      const q = input.query.trim().toLowerCase();
      items = items.filter(
        (item) =>
          item.name.toLowerCase().includes(q) ||
          item.description.toLowerCase().includes(q),
      );
    }

    context?.trace?.('marketplace:browse', {
      query: input?.query,
      kind: input?.kind,
      count: items.length,
    });

    return { items };
  },
};

// ─── 2. marketplace.import ───────────────────────────────────────────────────

export const marketplaceImportInputSchema = z.object({
  url: z.string().url().refine(
    (u) => ASSET_SHARE_URL_REGEX.test(u),
    'Invalid Revyme asset share URL',
  ),
  targetPath: z.string().optional(),
});
export type MarketplaceImportInput = z.infer<typeof marketplaceImportInputSchema>;

export const marketplaceImportOutputSchema = z.object({
  componentName: z.string(),
  localPath: z.string(),
  versionHash: z.string(),
  changes: z.array(FileChangeSchema),
});
export type MarketplaceImportOutput = z.infer<typeof marketplaceImportOutputSchema>;

export const marketplaceImportOperation: Operation<
  MarketplaceImportInput,
  MarketplaceImportOutput
> = {
  name: 'marketplace.import',
  description: 'Import a remote marketplace component or vector into local components/remote/ proxy',
  category: 'marketplace',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T22',
  inputSchema: marketplaceImportInputSchema,
  outputSchema: marketplaceImportOutputSchema,
  async execute(snapshot, rawInput, context: OperationContext) {
    const input = marketplaceImportInputSchema.parse(rawInput);
    const match = input.url.match(ASSET_SHARE_URL_REGEX);
    if (!match) {
      throw new Error('Invalid Revyme asset share URL');
    }

    const assetType = match[1]; // 'components' | 'vectors'
    const rawName = match[2];
    const versionHash = match[3];
    const componentName = toPascalCase(rawName);

    let localPath = input.targetPath;
    if (localPath) {
      if (
        localPath.includes('..') ||
        localPath.includes('\0') ||
        localPath.startsWith('/')
      ) {
        throw new Error(`SECURITY_ERROR: Invalid target path "${localPath}"`);
      }
      if (!localPath.endsWith('.tsx')) {
        localPath = `${localPath}.tsx`;
      }
    } else {
      localPath = `components/remote/${componentName}.tsx`;
    }

    const sync = syncCodeSnapshotToProjectFS(snapshot);

    let proxyCode: string;
    if (assetType === 'vectors') {
      proxyCode = `'use client';\n/** @name "${componentName}" */\n/** @defaultWidth 400 */\n/** @defaultHeight 300 */\n/** @controls {} */\nimport React from 'react';\nimport { withResponsiveProps } from '@revyme/runtime';\nimport RemoteVector from '${input.url}';\n\nfunction ${componentName}({ name = 'icon-1', ...props }: any) {\n  return <RemoteVector data-id="root" name={name} {...props} />;\n}\n\nexport default withResponsiveProps(${componentName});\n`;
    } else {
      proxyCode = `'use client';\n/** @name "${componentName}" */\n/** @defaultWidth 400 */\n/** @defaultHeight 300 */\n/** @controls {} */\nimport React from 'react';\nimport { withResponsiveProps } from '@revyme/runtime';\nimport RemoteComponent from '${input.url}';\n\nfunction ${componentName}(props: any) {\n  return <RemoteComponent data-id="root" {...props} />;\n}\n\nexport default withResponsiveProps(${componentName});\n`;
    }

    const violations = checkFile(proxyCode, {
      kind: 'code-component',
      path: localPath,
    });
    const blockers = violations.filter((v) => v.tier === 3 || v.tier === 1);
    if (blockers.length > 0) {
      throw new Error(
        `ORACLE_REJECTED: Proxy component failed validation: ${blockers
          .map((b) => b.message)
          .join('; ')}`,
      );
    }

    projectFS.writeFile(localPath, proxyCode);
    const changes = sync.collectChanges();

    context?.trace?.('marketplace:import', {
      url: input.url,
      componentName,
      localPath,
      versionHash,
      changesCount: changes.length,
    });

    return {
      componentName,
      localPath,
      versionHash,
      changes,
    };
  },
};

// ─── 3. marketplace.publishListing ───────────────────────────────────────────

export interface MarketplaceListingRecord {
  id: string;
  name: string;
  path: string;
  kind: 'component' | 'vector';
  description?: string;
  pricingType: 'free' | 'paid';
  priceCents?: number;
  thumbnailUrl?: string;
  status: 'draft' | 'pending' | 'published';
  componentUrl: string;
  versionHash: string;
  createdAt: string;
  updatedAt: string;
}

export const marketplacePublishListingInputSchema = z.object({
  path: z.string().min(1, 'Path must not be empty'),
  name: z.string().min(1, 'Name must not be empty'),
  kind: z.enum(['component', 'vector']).optional(),
  description: z.string().optional(),
  pricingType: z.enum(['free', 'paid']).optional(),
  priceCents: z.number().int().nonnegative().optional(),
  thumbnailUrl: z.string().url('Thumbnail must be a valid URL').optional(),
  publish: z.boolean().optional(),
});
export type MarketplacePublishListingInput = z.infer<
  typeof marketplacePublishListingInputSchema
>;

export const marketplacePublishListingOutputSchema = z.object({
  listingId: z.string(),
  status: z.string(),
  componentUrl: z.string(),
  versionHash: z.string(),
  action: z.enum(['created', 'updated']),
});
export type MarketplacePublishListingOutput = z.infer<
  typeof marketplacePublishListingOutputSchema
>;

export const marketplacePublishListingOperation: Operation<
  MarketplacePublishListingInput,
  MarketplacePublishListingOutput
> = {
  name: 'marketplace.publishListing',
  description: 'Publish or stage a component/vector listing to the marketplace registry',
  category: 'marketplace',
  kind: 'service',
  permit: 'write',
  environment: 'service',
  ownerTask: 'T22',
  inputSchema: marketplacePublishListingInputSchema,
  outputSchema: marketplacePublishListingOutputSchema,
  async execute(snapshot, rawInput, context: OperationContext) {
    const input = marketplacePublishListingInputSchema.parse(rawInput);
    syncCodeSnapshotToProjectFS(snapshot);

    const fileContent = projectFS.readFile(input.path);
    if (fileContent === null) {
      throw new Error(`File not found: ${input.path}`);
    }

    const listingKind =
      input.kind ?? (input.path.startsWith('icons/') ? 'vector' : 'component');
    if (listingKind !== 'component' && listingKind !== 'vector') {
      throw new Error(
        'publishListing handles components and vectors. Templates and plugins use different share pipelines — publish those from the creator dashboard.',
      );
    }

    if (input.pricingType === 'paid') {
      if (input.priceCents === undefined || input.priceCents <= 0) {
        throw new Error(
          'VALIDATION_ERROR: Paid listings require a positive price in cents (priceCents > 0)',
        );
      }
    }

    const versionHash = sha256(fileContent).slice(0, 16);
    const subDir = listingKind === 'vector' ? 'vectors' : 'components';
    const componentUrl = `https://assets.revyme.app/${subDir}/${encodeURIComponent(
      input.name,
    )}@${versionHash}.js`;

    if (
      context?.adapters &&
      typeof (context.adapters as any).marketplaceClient?.publishListing === 'function'
    ) {
      return await (context.adapters as any).marketplaceClient.publishListing({
        ...input,
        listingKind,
        componentUrl,
        versionHash,
        fileContent,
      });
    }

    let status: 'draft' | 'pending' | 'published' = 'draft';
    if (input.publish) {
      if (input.thumbnailUrl) {
        status = 'pending';
      } else {
        status = 'draft';
      }
    }

    let listings: MarketplaceListingRecord[] = [];
    const raw = projectFS.readFile(LISTINGS_STORAGE_PATH);
    if (raw) {
      try {
        listings = JSON.parse(raw);
      } catch {
        listings = [];
      }
    }

    const targetNameLower = input.name.trim().toLowerCase();
    const existingIndex = listings.findIndex(
      (item) =>
        item.name.trim().toLowerCase() === targetNameLower ||
        item.path === input.path,
    );

    const now = new Date().toISOString();
    let listingId: string;
    let action: 'created' | 'updated';

    if (existingIndex >= 0) {
      action = 'updated';
      listingId = listings[existingIndex].id;
      listings[existingIndex] = {
        ...listings[existingIndex],
        name: input.name,
        path: input.path,
        kind: listingKind,
        description: input.description ?? listings[existingIndex].description,
        pricingType: input.pricingType ?? listings[existingIndex].pricingType,
        priceCents: input.priceCents ?? listings[existingIndex].priceCents,
        thumbnailUrl: input.thumbnailUrl ?? listings[existingIndex].thumbnailUrl,
        status,
        componentUrl,
        versionHash,
        updatedAt: now,
      };
    } else {
      action = 'created';
      listingId =
        (context?.createId ? context.createId('lst') : undefined) ||
        `lst-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      listings.push({
        id: listingId,
        name: input.name,
        path: input.path,
        kind: listingKind,
        description: input.description,
        pricingType: input.pricingType ?? 'free',
        priceCents: input.priceCents,
        thumbnailUrl: input.thumbnailUrl,
        status,
        componentUrl,
        versionHash,
        createdAt: now,
        updatedAt: now,
      });
    }

    const nextRaw = JSON.stringify(listings, null, 2);
    projectFS.writeFile(LISTINGS_STORAGE_PATH, nextRaw);
    if (snapshot?.files && 'set' in snapshot.files) {
      (snapshot.files as Map<string, string>).set(LISTINGS_STORAGE_PATH, nextRaw);
    }

    context?.trace?.('marketplace:publishListing', {
      listingId,
      status,
      componentUrl,
      versionHash,
      action,
    });

    return {
      listingId,
      status,
      componentUrl,
      versionHash,
      action,
    };
  },
};

// ─── Default Registry Registration ──────────────────────────────────────────

defaultRegistry.register(marketplaceBrowseOperation);
defaultRegistry.register(marketplaceImportOperation);
defaultRegistry.register(marketplacePublishListingOperation);

defaultRegistry.registerAlias('marketplace.search', 'marketplace.browse');
defaultRegistry.registerAlias('marketplace.list', 'marketplace.browse');
defaultRegistry.registerAlias('marketplace.install', 'marketplace.import');
defaultRegistry.registerAlias('marketplace.importAsset', 'marketplace.import');
defaultRegistry.registerAlias('marketplace.publish', 'marketplace.publishListing');
defaultRegistry.registerAlias('marketplace.share', 'marketplace.publishListing');
defaultRegistry.registerAlias('marketplace.createListing', 'marketplace.publishListing');
