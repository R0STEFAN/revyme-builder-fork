// src/ai/agent/tools/seo-tools.ts
import { z } from 'zod';
import type { AgentTool, AgentToolResult } from '@/ai/agent';
import { projectFS, projectVersionAtom } from '@/code/project/project-fs';
import { modifyProjectFile } from '@/code/project/modify-file';
import { generateRobotsCode, type RobotsGeneratorInput } from '@/code/generation/robots-gen';
import {
  generateLlmsRouteCode,
  generateLlmsFullRouteCode,
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
import { parseMetadataFromCode } from '@/code/generation/metadata-gen';
import { parseCmsPageMeta } from '@/code/project/cms-page-meta';
import { getDefaultStore } from 'jotai';

const store = getDefaultStore();
const bump = (): void => {
  store.set(projectVersionAtom, (v) => v + 1);
};

function ok(data: unknown): AgentToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}
function fail(message: string): AgentToolResult {
  return { content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true };
}

function resolveServerPath(page: string): string | null {
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
  return projectFS.exists(clean) ? clean : null;
}

function collectProjectFiles(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const path of projectFS.listFiles()) {
    const content = projectFS.readFile(path);
    if (content !== null) files[path] = content;
  }
  return files;
}

// ─── 1. get_seo_audit ─────────────────────────────────────────────────────────

export const getSeoAuditTool: AgentTool = {
  name: 'get_seo_audit',
  description:
    'Deep audit of site-wide & per-page SEO, sitemap health, robots policies, schema presence, and LLM readiness.',
  inputSchema: {},
  category: 'read',
  async execute() {
    const layoutCode = projectFS.readFile('app/layout.tsx') || '';
    const siteMeta = layoutCode ? parseMetadataFromCode(layoutCode) : {};
    const siteTitle = (siteMeta.title as string) || '';
    const siteDesc = (siteMeta.description as string) || '';

    let robotsConfig: any = null;
    const rawRobots = projectFS.readFile('_meta/robots.json');
    if (rawRobots) {
      try {
        robotsConfig = JSON.parse(rawRobots);
      } catch {}
    }
    const hasRobotsFile = projectFS.exists('app/robots.ts');
    const hasSitemapFile = projectFS.exists('app/sitemap.ts');

    let llmsConfig: any = null;
    const rawLlms = projectFS.readFile('_meta/llms.json');
    if (rawLlms) {
      try {
        llmsConfig = JSON.parse(rawLlms);
      } catch {}
    }
    const hasLlmsFile = projectFS.exists('app/llms.txt/route.ts');

    const pageReports: any[] = [];
    const recommendations: string[] = [];

    for (const path of projectFS.listFiles('app/')) {
      if (
        !path.startsWith('app/api/') &&
        !path.startsWith('app/llms') &&
        (path.endsWith('/page.client.tsx') || path === 'app/page.client.tsx')
      ) {
        const serverPath = path.replace(/page\.client\.tsx$/, 'page.tsx');
        const serverCode = projectFS.readFile(serverPath) || '';
        const meta = serverCode ? parseMetadataFromCode(serverCode) : {};
        const defaults = serverCode ? parseCmsSeoDefaults(serverCode) : {};
        const title = (meta.title as string) || (defaults.title as string) || '';
        const desc = (meta.description as string) || (defaults.description as string) || '';
        const schema = serverCode ? parseCmsSchemaOrg(serverCode) : null;
        const isNoIndex =
          /robots:\s*\{\s*index:\s*false/.test(serverCode) || /noindex:\s*true/.test(serverCode);

        const issues: string[] = [];
        if (!title) issues.push('missing title');
        if (!desc) issues.push('missing description');
        else if (desc.length < 50 || desc.length > 160) {
          issues.push(`description length (${desc.length}) outside recommended 50-160 chars`);
        }
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
      recommendations.push(
        `Add Schema.org JSON-LD to ${pagesWithoutSchema.length} page(s) via set_page_schema_org`,
      );
    }

    return ok({
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
    });
  },
};

// ─── 2. set_robots_config ─────────────────────────────────────────────────────

const setRobotsInput = z.object({
  mode: z.enum(['allow_all', 'disallow_all', 'custom']).optional().default('allow_all'),
  disallowPaths: z.array(z.string()).optional(),
  aiBots: z
    .object({
      gptBot: z.boolean().optional(),
      claudeBot: z.boolean().optional(),
      perplexityBot: z.boolean().optional(),
      googleExtended: z.boolean().optional(),
    })
    .optional(),
});

export const setRobotsConfigTool: AgentTool = {
  name: 'set_robots_config',
  description:
    'Configures app/robots.ts rules, disallow paths, and AI crawler permissions (GPTBot, ClaudeBot, PerplexityBot, Google-Extended).',
  inputSchema: setRobotsInput.shape,
  category: 'meta',
  async execute(rawInput: unknown) {
    const parsed = setRobotsInput.safeParse(rawInput);
    if (!parsed.success) return fail(parsed.error.message);
    const input = parsed.data;

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

    const code = generateRobotsCode(config);
    modifyProjectFile('_meta/robots.json', () => JSON.stringify(config, null, 2));
    modifyProjectFile('app/robots.ts', () => code);
    bump();

    return ok({ success: true, mode: config.mode, disallowPaths: config.disallowPaths, aiBots: config.aiBots });
  },
};

// ─── 3. configure_llms_txt ────────────────────────────────────────────────────

const configureLlmsInput = z.object({
  enabled: z.boolean().optional().default(true),
  siteTitle: z.string().optional(),
  siteDescription: z.string().optional(),
  notes: z.string().optional(),
  sections: z.array(z.object({ title: z.string(), content: z.string() })).optional(),
});

export const configureLlmsTxtTool: AgentTool = {
  name: 'configure_llms_txt',
  description:
    'Configures and updates llms.txt and llms-full.txt content, summary, and custom documentation sections for AI agents and LLM crawlers.',
  inputSchema: configureLlmsInput.shape,
  category: 'meta',
  async execute(rawInput: unknown) {
    const parsed = configureLlmsInput.safeParse(rawInput);
    if (!parsed.success) return fail(parsed.error.message);
    const input = parsed.data;

    const layoutCode = projectFS.readFile('app/layout.tsx') || '';
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

    modifyProjectFile('_meta/llms.json', () => JSON.stringify(llmsConfig, null, 2));

    if (llmsConfig.enabled) {
      const routeCode = generateLlmsRouteCode({
        siteTitle: title,
        siteDescription: desc,
        notes: input.notes,
        customSections: input.sections,
      });
      const fullRouteCode = generateLlmsFullRouteCode({
        siteTitle: title,
        siteDescription: desc,
        notes: input.notes,
        customSections: input.sections,
      });

      modifyProjectFile('app/llms.txt/route.ts', () => routeCode);
      modifyProjectFile('app/llms-full.txt/route.ts', () => fullRouteCode);
    }
    bump();

    return ok({ success: true, enabled: llmsConfig.enabled, siteTitle: title });
  },
};

// ─── 4. set_page_schema_org ───────────────────────────────────────────────────

const setPageSchemaOrgInput = z.object({
  page: z.string(),
  schemaType: z.enum(['Article', 'Product', 'Organization', 'FAQPage', 'Custom']),
  staticValues: z.record(z.string(), z.string()).optional(),
  bindings: z.record(z.string(), z.string()).optional(),
  expressions: z.record(z.string(), z.string()).optional(),
  rawJsonLd: z.string().optional(),
});

export const setPageSchemaOrgTool: AgentTool = {
  name: 'set_page_schema_org',
  description:
    'Configures Schema.org JSON-LD for a route, including static values and fx expression bindings for CMS detail pages.',
  inputSchema: setPageSchemaOrgInput.shape,
  category: 'meta',
  async execute(rawInput: unknown) {
    const parsed = setPageSchemaOrgInput.safeParse(rawInput);
    if (!parsed.success) return fail(parsed.error.message);
    const input = parsed.data;

    const serverPath = resolveServerPath(input.page);
    if (!serverPath) {
      return fail(`Page "${input.page}" not found in project.`);
    }

    const existingCode = projectFS.readFile(serverPath) || '';
    const clientPath = serverPath.replace(/page\.tsx$/, 'page.client.tsx');
    const clientCode = projectFS.readFile(clientPath) || '';

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

    modifyProjectFile(serverPath, () => nextCode);
    bump();

    return ok({ success: true, serverPath, schemaType: input.schemaType });
  },
};

// ─── 5. sync_sitemap ──────────────────────────────────────────────────────────

export const syncSitemapTool: AgentTool = {
  name: 'sync_sitemap',
  description:
    'Triggers a fresh route and CMS discovery run to regenerate app/sitemap.ts, discovering all static pages and dynamic collections.',
  inputSchema: {},
  category: 'meta',
  async execute() {
    const files = collectProjectFiles();
    delete files['app/sitemap.ts'];

    const updated = ensureSeoAndAiDiscoveryFiles(files);
    const newSitemapCode = updated['app/sitemap.ts'];
    if (!newSitemapCode) {
      return fail('Failed to generate sitemap code.');
    }

    modifyProjectFile('app/sitemap.ts', () => newSitemapCode);
    bump();

    return ok({ success: true, sitemapPath: 'app/sitemap.ts' });
  },
};

export const SEO_TOOLS: AgentTool[] = [
  getSeoAuditTool,
  setRobotsConfigTool,
  configureLlmsTxtTool,
  setPageSchemaOrgTool,
  syncSitemapTool,
];
