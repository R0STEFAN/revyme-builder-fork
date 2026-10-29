// packages/automation-core/src/operations/seo.ts
import { z } from 'zod';
import type { Operation, FileChange, Snapshot, OperationContext } from '../contracts';
import { defaultRegistry } from '../registry';
import { generateRobotsCode, type RobotsGeneratorInput } from '@/code/generation/robots-gen';
import {
  generateLlmsRouteCode,
  generateLlmsFullRouteCode,
  type LlmsGeneratorInput,
} from '@/code/generation/llms-gen';
import { ensureSeoAndAiDiscoveryFiles } from '@/code/project/source-export';
import {
  buildStandardPageServerWrapper,
  buildCmsDetailServerWrapper,
  parseCmsSchemaOrg,
  parseCmsSeoBindings,
  parseCmsSeoDefaults,
  parseCmsSeoExpressions,
  type SchemaOrgConfig,
} from '@/code/project/cms-seo';
import { parseMetadataFromCode, type SiteMetadata } from '@/code/generation/metadata-gen';
import { parseCmsPageMeta } from '@/code/project/cms-page-meta';

function snapshotToFiles(snapshot: Snapshot): Record<string, string> {
  const files: Record<string, string> = {};
  for (const [p, c] of snapshot.files.entries()) {
    files[p] = c;
  }
  return files;
}

function resolveServerPath(page: string, snapshot: Snapshot): string {
  let clean = page.trim().replace(/^\//, '');
  if (!clean.startsWith('app/')) {
    clean = `app/${clean}`;
  }
  if (clean.endsWith('/page.client.tsx')) {
    clean = clean.replace(/\/page\.client\.tsx$/, '/page.tsx');
  } else if (clean.endsWith('/page.tsx')) {
    // already server path
  } else if (clean === 'app' || clean === 'app/') {
    clean = 'app/page.tsx';
  } else {
    clean = `${clean.replace(/\/+$/, '')}/page.tsx`;
  }
  return clean;
}

// ─── 1. seo.audit (alias: get_seo_audit) ──────────────────────────────────────

export const seoAuditInputSchema = z.object({});
export type SeoAuditInput = z.infer<typeof seoAuditInputSchema>;

export const seoAuditOperation: Operation<SeoAuditInput, any> = {
  name: 'seo.audit',
  description: 'Deep audit of site-wide & per-page SEO, sitemap health, robots policies, schema presence, and LLM readiness.',
  category: 'metadata',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T06',
  inputSchema: seoAuditInputSchema,
  async execute(snapshot: Snapshot) {
    const files = snapshotToFiles(snapshot);

    // Site layout metadata
    const layoutCode = files['app/layout.tsx'] || '';
    const siteMeta = layoutCode ? parseMetadataFromCode(layoutCode) : {};
    const siteTitle = (siteMeta.title as string) || '';
    const siteDesc = (siteMeta.description as string) || '';

    // Robots status
    let robotsConfig: any = null;
    if (files['_meta/robots.json']) {
      try {
        robotsConfig = JSON.parse(files['_meta/robots.json']);
      } catch {}
    }
    const hasRobotsFile = Boolean(files['app/robots.ts']);

    // Sitemap status
    const hasSitemapFile = Boolean(files['app/sitemap.ts']);

    // LLMs status
    let llmsConfig: any = null;
    if (files['_meta/llms.json']) {
      try {
        llmsConfig = JSON.parse(files['_meta/llms.json']);
      } catch {}
    }
    const hasLlmsFile = Boolean(files['app/llms.txt/route.ts']);

    // Scan pages
    const pageReports: any[] = [];
    const recommendations: string[] = [];

    for (const [path, code] of Object.entries(files)) {
      if (
        path.startsWith('app/') &&
        !path.startsWith('app/api/') &&
        !path.startsWith('app/llms') &&
        (path.endsWith('/page.client.tsx') || path === 'app/page.client.tsx')
      ) {
        const serverPath = path.replace(/page\.client\.tsx$/, 'page.tsx');
        const serverCode = files[serverPath] || '';
        const meta = serverCode ? parseMetadataFromCode(serverCode) : {};
        const defaults = serverCode ? parseCmsSeoDefaults(serverCode) : {};
        const title = (meta.title as string) || (defaults.title as string) || '';
        const desc = (meta.description as string) || (defaults.description as string) || '';
        const schema = serverCode ? parseCmsSchemaOrg(serverCode) : null;
        const isNoIndex = /robots:\s*\{\s*index:\s*false/.test(serverCode) || /noindex:\s*true/.test(serverCode);

        const issues: string[] = [];
        if (!title) issues.push('missing title');
        if (!desc) issues.push('missing description');
        else if (desc.length < 50 || desc.length > 160) issues.push(`description length (${desc.length}) outside recommended 50-160 chars`);
        if (!schema) issues.push('no Schema.org structured data');

        pageReports.push({
          page: path,
          serverPath,
          title,
          description: desc,
          isNoIndex,
          schema: schema ? schema.type : null,
          issues,
        });
      }
    }

    if (!hasSitemapFile) recommendations.push('Generate sitemap via sync_sitemap');
    if (!hasRobotsFile) recommendations.push('Configure robots policy via set_robots_config');
    if (!hasLlmsFile) recommendations.push('Configure AI discovery via configure_llms_txt');
    const pagesWithoutSchema = pageReports.filter((p) => !p.schema);
    if (pagesWithoutSchema.length > 0) {
      recommendations.push(`Add Schema.org JSON-LD to ${pagesWithoutSchema.length} page(s) via set_page_schema_org`);
    }

    return {
      site: {
        title: siteTitle,
        description: siteDesc,
        hasRobots: hasRobotsFile,
        hasSitemap: hasSitemapFile,
        hasLlmsTxt: hasLlmsFile,
        robotsConfig,
        llmsConfig,
      },
      pageCount: pageReports.length,
      pages: pageReports,
      recommendations,
    };
  },
};

// ─── 2. seo.setRobots (alias: set_robots_config) ──────────────────────────────

export const seoSetRobotsInputSchema = z.object({
  mode: z.enum(['allow_all', 'disallow_all', 'custom']).optional().default('allow_all'),
  disallowPaths: z.array(z.string()).optional(),
  aiBots: z.object({
    gptBot: z.boolean().optional(),
    claudeBot: z.boolean().optional(),
    perplexityBot: z.boolean().optional(),
    googleExtended: z.boolean().optional(),
  }).optional(),
});
export type SeoSetRobotsInput = z.infer<typeof seoSetRobotsInputSchema>;

export const seoSetRobotsOperation: Operation<SeoSetRobotsInput, { changes: FileChange[]; robotsCode: string }> = {
  name: 'seo.setRobots',
  description: 'Configures app/robots.ts rules, disallow paths, and AI crawler permissions.',
  category: 'metadata',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T06',
  inputSchema: seoSetRobotsInputSchema,
  async execute(snapshot: Snapshot, input: SeoSetRobotsInput) {
    const config: RobotsGeneratorInput = {
      mode: input.mode,
      disallowPaths: input.disallowPaths || ['/api/'],
      aiBots: {
        gptBot: input.aiBots?.gptBot ?? true,
        claudeBot: input.aiBots?.claudeBot ?? true,
        perplexityBot: input.aiBots?.perplexityBot ?? true,
        googleExtended: input.aiBots?.googleExtended ?? true,
      },
    };

    const robotsCode = generateRobotsCode(config);
    const jsonStr = JSON.stringify(config, null, 2);

    const changes: FileChange[] = [
      {
        path: '_meta/robots.json',
        beforeHash: null,
        content: jsonStr,
      },
      {
        path: 'app/robots.ts',
        beforeHash: null,
        content: robotsCode,
      },
    ];

    return { changes, robotsCode };
  },
};

// ─── 3. seo.configureLlms (alias: configure_llms_txt) ─────────────────────────

export const seoConfigureLlmsInputSchema = z.object({
  enabled: z.boolean().optional().default(true),
  siteTitle: z.string().optional(),
  siteDescription: z.string().optional(),
  notes: z.string().optional(),
  sections: z.array(z.object({ title: z.string(), content: z.string() })).optional(),
});
export type SeoConfigureLlmsInput = z.infer<typeof seoConfigureLlmsInputSchema>;

export const seoConfigureLlmsOperation: Operation<SeoConfigureLlmsInput, { changes: FileChange[] }> = {
  name: 'seo.configureLlms',
  description: 'Configures and updates llms.txt and llms-full.txt content, custom sections, and notes.',
  category: 'metadata',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T06',
  inputSchema: seoConfigureLlmsInputSchema,
  async execute(snapshot: Snapshot, input: SeoConfigureLlmsInput) {
    const files = snapshotToFiles(snapshot);

    const layoutCode = files['app/layout.tsx'] || '';
    const meta = layoutCode ? parseMetadataFromCode(layoutCode) : {};
    const title = input.siteTitle || (meta.title as string) || 'Revyme Website';
    const desc = input.siteDescription || (meta.description as string) || '';

    const llmsConfig = {
      enabled: input.enabled !== false,
      siteTitle: title,
      siteDescription: desc,
      notes: input.notes || '',
      sections: input.sections || [],
    };

    const changes: FileChange[] = [
      {
        path: '_meta/llms.json',
        beforeHash: null,
        content: JSON.stringify(llmsConfig, null, 2),
      },
    ];

    if (llmsConfig.enabled) {
      const workingFiles = { ...files };
      workingFiles['_meta/llms.json'] = JSON.stringify(llmsConfig, null, 2);
      delete workingFiles['app/llms.txt/route.ts'];
      delete workingFiles['app/llms-full.txt/route.ts'];

      const updated = ensureSeoAndAiDiscoveryFiles(workingFiles);
      if (updated['app/llms.txt/route.ts']) {
        changes.push({
          path: 'app/llms.txt/route.ts',
          beforeHash: null,
          content: updated['app/llms.txt/route.ts'],
        });
      }
      if (updated['app/llms-full.txt/route.ts']) {
        changes.push({
          path: 'app/llms-full.txt/route.ts',
          beforeHash: null,
          content: updated['app/llms-full.txt/route.ts'],
        });
      }
    } else {
      if (files['app/llms.txt/route.ts']) {
        changes.push({
          path: 'app/llms.txt/route.ts',
          beforeHash: null,
          content: '',
        });
      }
      if (files['app/llms-full.txt/route.ts']) {
        changes.push({
          path: 'app/llms-full.txt/route.ts',
          beforeHash: null,
          content: '',
        });
      }
    }

    return { changes };
  },
};

// ─── 4. seo.setSchemaOrg (alias: set_page_schema_org) ─────────────────────────

export const seoSetSchemaOrgInputSchema = z.object({
  page: z.string(),
  schemaType: z.enum(['Article', 'Product', 'Organization', 'FAQPage', 'Custom']),
  staticValues: z.record(z.string(), z.string()).optional(),
  bindings: z.record(z.string(), z.string()).optional(),
  expressions: z.record(z.string(), z.string()).optional(),
  rawJsonLd: z.string().optional(),
});
export type SeoSetSchemaOrgInput = z.infer<typeof seoSetSchemaOrgInputSchema>;

export const seoSetSchemaOrgOperation: Operation<SeoSetSchemaOrgInput, { serverPath: string; changes: FileChange[] }> = {
  name: 'seo.setSchemaOrg',
  description: 'Configures Schema.org JSON-LD for a route, including static values and fx expression bindings.',
  category: 'metadata',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T06',
  inputSchema: seoSetSchemaOrgInputSchema,
  async execute(snapshot: Snapshot, input: SeoSetSchemaOrgInput) {
    const serverPath = resolveServerPath(input.page, snapshot);
    const existingCode = snapshot.files.get(serverPath) || '';
    const clientPath = serverPath.replace(/page\.tsx$/, 'page.client.tsx');
    const clientCode = snapshot.files.get(clientPath) || '';

    const cmsMeta = parseCmsPageMeta(clientCode);
    const isCmsDetail = Boolean(cmsMeta && cmsMeta.kind === 'detail');

    const schemaConfig: SchemaOrgConfig = {
      type: input.schemaType,
      staticValues: input.staticValues || {},
      bindings: input.bindings || {},
      expressions: input.expressions || {},
      rawJsonLd: input.rawJsonLd || '',
    };

    let nextCode: string;
    if (isCmsDetail && cmsMeta?.collection) {
      const existingBindings = parseCmsSeoBindings(existingCode);
      const existingExprs = parseCmsSeoExpressions(existingCode);
      const existingDefaults = parseCmsSeoDefaults(existingCode);

      nextCode = buildCmsDetailServerWrapper({
        collection: cmsMeta.collection,
        defaults: existingDefaults as any,
        bindings: existingBindings,
        expressions: existingExprs,
        schemaOrg: schemaConfig,
      });
    } else {
      const existingExprs = parseCmsSeoExpressions(existingCode);
      const meta = existingCode ? parseMetadataFromCode(existingCode) : {};

      nextCode = buildStandardPageServerWrapper({
        defaults: meta as any,
        expressions: existingExprs,
        schemaOrg: schemaConfig,
        existingCode,
      });
    }

    const changes: FileChange[] = [
      {
        path: serverPath,
        beforeHash: null,
        content: nextCode,
      },
    ];

    return { serverPath, changes };
  },
};

// ─── 5. seo.syncSitemap (alias: sync_sitemap) ─────────────────────────────────

export const seoSyncSitemapInputSchema = z.object({});
export type SeoSyncSitemapInput = z.infer<typeof seoSyncSitemapInputSchema>;

export const seoSyncSitemapOperation: Operation<SeoSyncSitemapInput, { sitemapPath: string; changes: FileChange[] }> = {
  name: 'seo.syncSitemap',
  description: 'Triggers a fresh discovery run and regenerates app/sitemap.ts.',
  category: 'metadata',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T06',
  inputSchema: seoSyncSitemapInputSchema,
  async execute(snapshot: Snapshot) {
    const files = snapshotToFiles(snapshot);
    // Delete old sitemap so ensureSeoAndAiDiscoveryFiles forces fresh generation
    delete files['app/sitemap.ts'];

    const updatedFiles = ensureSeoAndAiDiscoveryFiles(files);
    const newSitemapCode = updatedFiles['app/sitemap.ts'];

    const changes: FileChange[] = [
      {
        path: 'app/sitemap.ts',
        beforeHash: null,
        content: newSitemapCode,
      },
    ];

    return { sitemapPath: 'app/sitemap.ts', changes };
  },
};

// ─── Registry Registration & Aliases ──────────────────────────────────────────

defaultRegistry.register(seoAuditOperation);
defaultRegistry.register(seoSetRobotsOperation);
defaultRegistry.register(seoConfigureLlmsOperation);
defaultRegistry.register(seoSetSchemaOrgOperation);
defaultRegistry.register(seoSyncSitemapOperation);

defaultRegistry.registerAlias('get_seo_audit', 'seo.audit');
defaultRegistry.registerAlias('set_robots_config', 'seo.setRobots');
defaultRegistry.registerAlias('configure_llms_txt', 'seo.configureLlms');
defaultRegistry.registerAlias('set_page_schema_org', 'seo.setSchemaOrg');
defaultRegistry.registerAlias('sync_sitemap', 'seo.syncSitemap');
