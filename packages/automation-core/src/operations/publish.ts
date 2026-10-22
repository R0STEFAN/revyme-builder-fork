// packages/automation-core/src/operations/publish.ts
import { z } from 'zod';
import { createHash } from 'node:crypto';
import type { Operation, FileChange, Snapshot, OperationContext } from '../contracts';
import { defaultRegistry } from '../registry';
import { projectFS } from '@/code/project/project-fs';
import { checkFile } from '@/code/oracle/check-file';
import { parseMetadataFromCode, type SiteMetadata } from '@/code/generation/metadata-gen';
import { readFormConfig } from '@/editor/tools/FormTool/form-config';
import { templatePreviewRoute } from '@/preview/template-preview';
import { parsePageFromPath } from './pages';
import { parse } from '@babel/parser';

import { REDIRECTS_FILE } from './redirects';

export const DEPLOYMENTS_STORAGE_PATH = '_meta/deployments.json';
export const DEPLOYMENTS_META_FILE = '_meta/deployments.json';

// ─── Deployment History Types & Storage Helpers ───────────────────────────────

export const deploymentRecordSchema = z.object({
  id: z.string(),
  deploymentId: z.string(),
  timestamp: z.string(),
  targetEnvironment: z.enum(['production', 'staging']),
  target: z.enum(['production', 'staging']).optional(),
  revision: z.number(),
  commitHash: z.string(),
  url: z.string(),
  status: z.enum(['deployed', 'failed', 'building', 'queued']),
  preflightPassed: z.boolean(),
  forced: z.boolean(),
  pageCount: z.number(),
  durationMs: z.number().optional(),
  message: z.string().optional(),
});

export type DeploymentRecord = z.infer<typeof deploymentRecordSchema>;

export function loadDeployments(snapshot?: Snapshot): DeploymentRecord[] {
  let raw: string | null | undefined;
  if (snapshot?.files) {
    raw = snapshot.files.get(DEPLOYMENTS_STORAGE_PATH);
  }
  if (!raw) {
    raw = projectFS.readFile(DEPLOYMENTS_STORAGE_PATH);
  }
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveDeployments(records: DeploymentRecord[], snapshot?: Snapshot): FileChange[] {
  const content = JSON.stringify(records, null, 2);
  projectFS.writeFile(DEPLOYMENTS_STORAGE_PATH, content);
  if (snapshot?.files && 'set' in snapshot.files) {
    (snapshot.files as Map<string, string>).set(DEPLOYMENTS_STORAGE_PATH, content);
  }
  return [
    {
      path: DEPLOYMENTS_STORAGE_PATH,
      beforeHash: null,
      content,
    },
  ];
}

// ─── Snapshot Synchronization Helper ──────────────────────────────────────────

export function syncPublishSnapshotToProjectFS(snapshot?: Snapshot): {
  collectChanges: () => FileChange[];
} {
  const beforeFiles = new Map<string, string>();
  for (const path of projectFS.listFiles()) {
    const content = projectFS.readFile(path);
    if (content !== null) beforeFiles.set(path, content);
  }
  if (snapshot && snapshot.files.size > 0) {
    for (const [path, content] of snapshot.files) {
      beforeFiles.set(path, content);
      if (projectFS.readFile(path) !== content) {
        projectFS.writeFile(path, content);
      }
    }
  }

  return {
    collectChanges() {
      const changes: FileChange[] = [];
      const currentPaths = new Set(projectFS.listFiles());

      for (const path of currentPaths) {
        const currentContent = projectFS.readFile(path);
        const beforeContent = beforeFiles.get(path);
        if (currentContent !== null && currentContent !== beforeContent) {
          changes.push({
            path,
            beforeHash: null,
            content: currentContent,
          });
        }
      }

      for (const [path] of beforeFiles) {
        if (!currentPaths.has(path)) {
          changes.push({
            path,
            beforeHash: null,
            content: null,
          });
        }
      }

      if (snapshot && 'set' in snapshot.files) {
        const map = snapshot.files as Map<string, string>;
        for (const c of changes) {
          if (c.content === null) map.delete(c.path);
          else map.set(c.path, c.content);
        }
      }
      return changes;
    },
  };
}

// ─── SHA-256 Checksum Helper ──────────────────────────────────────────────────

export function calculateSnapshotHash(files: ReadonlyMap<string, string>): string {
  const sortedKeys = Array.from(files.keys()).sort();
  const hash = createHash('sha256');
  for (const k of sortedKeys) {
    hash.update(k);
    hash.update('\0');
    hash.update(files.get(k) || '');
    hash.update('\0');
  }
  return hash.digest('hex');
}

// ─── Graph Cycle Detection (DFS) for Redirects ────────────────────────────────

export function detectRedirectCycles(redirects: Array<{ from: string; to: string }>): string[][] {
  const adj = new Map<string, string>();
  for (const r of redirects) {
    if (r.from && r.to) {
      adj.set(r.from.trim(), r.to.trim());
    }
  }
  const cycles: string[][] = [];
  const visitedGlobal = new Set<string>();

  for (const start of adj.keys()) {
    if (visitedGlobal.has(start)) continue;
    const path: string[] = [];
    const pathSet = new Set<string>();
    let curr: string | undefined = start;

    while (curr && adj.has(curr)) {
      if (pathSet.has(curr)) {
        const cycleStart = path.indexOf(curr);
        cycles.push([...path.slice(cycleStart), curr]);
        break;
      }
      if (visitedGlobal.has(curr)) break;
      path.push(curr);
      pathSet.add(curr);
      curr = adj.get(curr);
    }
    for (const n of path) visitedGlobal.add(n);
  }
  return cycles;
}

// ─── 1. publish.preflight Operation ───────────────────────────────────────────

export const publishPreflightInputSchema = z.object({
  branchId: z.string().optional(),
  strict: z.boolean().optional(),
  categories: z.array(z.enum(['pages', 'oracle', 'seo', 'metadata', 'assets', 'forms', 'redirects'])).optional(),
});

export type PublishPreflightInput = z.infer<typeof publishPreflightInputSchema>;

export const preflightCheckItemSchema = z.object({
  name: z.string(),
  category: z.enum(['pages', 'oracle', 'seo', 'metadata', 'assets', 'forms', 'redirects']),
  status: z.enum(['pass', 'fail', 'warn']),
  message: z.string().optional(),
  path: z.string().optional(),
  line: z.number().optional(),
  code: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export type PreflightCheckItem = z.infer<typeof preflightCheckItemSchema>;

export const publishPreflightOutputSchema = z.object({
  passed: z.boolean(),
  totalChecks: z.number().int().nonnegative(),
  passedChecks: z.number().int().nonnegative(),
  failedChecks: z.number().int().nonnegative(),
  fatalCount: z.number().int().nonnegative(),
  warnChecks: z.number().int().nonnegative(),
  warningCount: z.number().int().nonnegative(),
  checks: z.array(preflightCheckItemSchema),
});

export type PublishPreflightOutput = z.infer<typeof publishPreflightOutputSchema>;

export async function executePreflightChecks(
  snapshot: Snapshot,
  options?: { strict?: boolean; categories?: string[] },
): Promise<PublishPreflightOutput> {
  const checks: PreflightCheckItem[] = [];
  const requested = options?.categories;
  const activeCategories = new Set(
    requested && requested.length > 0
      ? requested
      : ['pages', 'oracle', 'seo', 'metadata', 'assets', 'forms', 'redirects'],
  );
  const strict = options?.strict ?? false;

  const filesMap = snapshot.files;

  // ── A. Oracle Page Checks ──────────────────────────────────────────────────
  if (activeCategories.has('pages') || activeCategories.has('oracle')) {
    const fatalCodes = new Set([
      'SYNTAX_ERROR',
      'STRING_STYLE_ATTR',
      'WOULD_CRASH',
      'OVERRIDE_CHILD_COUNT',
      'OVERRIDE_NOT_IMPORTED',
    ]);
    let inspectedPagesCount = 0;

    for (const [path, code] of filesMap.entries()) {
      const isPage = /(^|\/)page(\.client)?\.tsx$/.test(path);
      const isLayout = /(^|\/)(layout|LayoutClient)\.tsx$/.test(path);
      if (!isPage && !isLayout) continue;

      inspectedPagesCount += 1;
      let violations;
      try {
        violations = checkFile(code, {
          kind: isLayout ? 'template' : 'page',
          path,
        });
      } catch (err) {
        checks.push({
          name: `oracle.${path}`,
          category: 'oracle',
          status: 'fail',
          path,
          code: 'ORACLE_EXCEPTION',
          message: `Oracle execution failed unexpectedly on ${path}: ${err instanceof Error ? err.message : String(err)}`,
        });
        continue;
      }

      if (violations.length === 0) {
        checks.push({
          name: `oracle.${path}`,
          category: 'oracle',
          status: 'pass',
          path,
          message: `Page "${path}" passed Oracle checks cleanly`,
        });
      } else {
        const fatalViolations = violations.filter((v) => fatalCodes.has(v.code) || v.tier === 1);
        const hasFatal = fatalViolations.length > 0;
        const status = hasFatal ? 'fail' : (strict ? 'fail' : 'warn');
        const primaryViolation = fatalViolations[0] || violations[0];
        const summary = violations
          .map((v) => `[${v.code}] ${v.message}${v.line ? ` (line ${v.line})` : ''}`)
          .join('; ');

        checks.push({
          name: `oracle.${path}`,
          category: 'oracle',
          status,
          path,
          line: primaryViolation?.line,
          code: primaryViolation?.code,
          message: `Page "${path}" has Oracle violation(s): ${summary}`,
          details: { violations },
        });
      }
    }

    if (inspectedPagesCount === 0) {
      checks.push({
        name: 'oracle.pages_count',
        category: 'oracle',
        status: 'warn',
        message: 'No page or layout files found in project snapshot',
      });
    }
  }

  // ── B. SEO Metadata Checks ─────────────────────────────────────────────────
  if (activeCategories.has('seo') || activeCategories.has('metadata')) {
    const layoutCode = filesMap.get('app/layout.tsx');
    if (!layoutCode) {
      checks.push({
        name: 'seo.root_layout',
        category: 'metadata',
        status: 'fail',
        path: 'app/layout.tsx',
        message: 'Root layout "app/layout.tsx" is missing',
      });
    } else {
      let meta: Partial<SiteMetadata> = {};
      try {
        meta = parseMetadataFromCode(layoutCode);
      } catch (err) {
        checks.push({
          name: 'seo.parse_error',
          category: 'metadata',
          status: 'fail',
          path: 'app/layout.tsx',
          message: `Failed to parse SEO metadata in app/layout.tsx: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      const metaTitle = typeof meta.title === 'string' ? meta.title.trim() : '';
      const hasTitle = metaTitle.length > 0;
      checks.push({
        name: 'seo.title',
        category: 'metadata',
        status: hasTitle ? 'pass' : (strict ? 'fail' : 'warn'),
        path: 'app/layout.tsx',
        message: hasTitle ? `SEO title configured: "${metaTitle}"` : 'Missing or empty SEO title in root layout metadata',
      });

      const metaDescription = typeof meta.description === 'string' ? meta.description.trim() : '';
      const hasDescription = metaDescription.length > 0;
      checks.push({
        name: 'seo.description',
        category: 'metadata',
        status: hasDescription ? 'pass' : (strict ? 'fail' : 'warn'),
        path: 'app/layout.tsx',
        message: hasDescription
          ? `SEO description configured (${metaDescription.length} chars)`
          : 'Missing or empty SEO meta description in root layout metadata',
      });
    }
  }

  // ── C. Static Asset Paths Checks ───────────────────────────────────────────
  if (activeCategories.has('assets')) {
    const staticRefs: Array<{ file: string; rawPath: string }> = [];

    for (const [path, code] of filesMap.entries()) {
      if (!path.endsWith('.tsx')) continue;

      // Scan JSX src and image props
      const srcMatches = code.matchAll(/(?:src|image|poster|avatar|thumbnail)=['"]([^'"]+)['"]/g);
      for (const m of srcMatches) {
        const val = m[1].trim();
        if (val && !/^(https?:|\/\/|data:|blob:)/i.test(val)) {
          staticRefs.push({ file: path, rawPath: val });
        }
      }

      // Scan CSS url(...) in style attributes
      const urlMatches = code.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi);
      for (const m of urlMatches) {
        const val = m[1].trim();
        if (val && !/^(https?:|\/\/|data:|blob:)/i.test(val)) {
          staticRefs.push({ file: path, rawPath: val });
        }
      }
    }

    let missingAssets = 0;
    for (const ref of staticRefs) {
      const clean = ref.rawPath.replace(/^\/+/, '');
      const candidates = [
        ref.rawPath,
        clean,
        `public/${clean}`,
        `public/assets/${clean}`,
        `public/images/${clean}`,
        `public/uploads/${clean}`,
        `public/api/uploads/${clean}`,
      ];

      const exists = candidates.some((c) => filesMap.has(c) || projectFS.readFile(c) !== null);
      if (!exists) {
        missingAssets += 1;
        checks.push({
          name: `assets.unlinked:${ref.rawPath}`,
          category: 'assets',
          status: 'fail',
          path: ref.file,
          message: `Missing static asset "${ref.rawPath}" referenced in "${ref.file}"`,
          details: { file: ref.file, rawPath: ref.rawPath },
        });
      }
    }

    if (missingAssets === 0) {
      checks.push({
        name: 'assets.resolution',
        category: 'assets',
        status: 'pass',
        message: `All ${staticRefs.length} referenced static asset paths resolve correctly`,
      });
    }
  }

  // ── D. Form Destinations Checks ────────────────────────────────────────────
  if (activeCategories.has('forms')) {
    let formsCount = 0;
    let unconfiguredForms = 0;

    for (const [path, code] of filesMap.entries()) {
      if (!path.endsWith('.tsx')) continue;
      if (!code.includes('<form') && !code.includes('data-form=')) continue;

      // Extract data-form attributes
      const formMatches = code.matchAll(/data-form=(?:'([^']+)'|"([^"]+)")/g);
      for (const m of formMatches) {
        formsCount += 1;
        const rawJson = m[1] || m[2];
        const config = readFormConfig(rawJson);

        if (!config.sendTo || config.sendTo.length === 0) {
          unconfiguredForms += 1;
          checks.push({
            name: `forms.unconfigured:${path}`,
            category: 'forms',
            status: 'fail',
            path,
            message: `Form in "${path}" has no configured destination endpoints (sendTo is empty)`,
          });
        } else {
          for (const dest of config.sendTo) {
            if (dest.type === 'email' && (!dest.recipient || !dest.recipient.trim())) {
              unconfiguredForms += 1;
              checks.push({
                name: `forms.destination_missing_email:${path}`,
                category: 'forms',
                status: 'fail',
                path,
                message: `Form in "${path}" email destination is missing recipient address`,
              });
            } else if (dest.type === 'webhook' && (!dest.url || !dest.url.trim())) {
              unconfiguredForms += 1;
              checks.push({
                name: `forms.destination_missing_webhook:${path}`,
                category: 'forms',
                status: 'fail',
                path,
                message: `Form in "${path}" webhook destination is missing target URL`,
              });
            }
          }
        }
      }

      // Check bare <form> elements without data-form or action
      const bareForms = code.matchAll(/<form(?![^>]*data-form)(?![^>]*action=)[^>]*>/g);
      for (const _ of bareForms) {
        formsCount += 1;
        unconfiguredForms += 1;
        checks.push({
          name: `forms.bare_form:${path}`,
          category: 'forms',
          status: 'fail',
          path,
          message: `Form container in "${path}" has neither a data-form configuration nor an action attribute`,
        });
      }
    }

    if (unconfiguredForms === 0) {
      checks.push({
        name: 'forms.destinations',
        category: 'forms',
        status: 'pass',
        message: formsCount > 0 ? `All ${formsCount} forms have valid destinations configured` : 'No forms configured',
      });
    }
  }

  // ── E. Redirect Loops Checks ───────────────────────────────────────────────
  if (activeCategories.has('redirects')) {
    const rawRedirects = filesMap.get(REDIRECTS_FILE) || projectFS.readFile(REDIRECTS_FILE);
    if (!rawRedirects) {
      checks.push({
        name: 'redirects.config',
        category: 'redirects',
        status: 'pass',
        message: 'No redirects configured',
      });
    } else {
      let redirects: Array<{ from: string; to: string }> = [];
      try {
        redirects = JSON.parse(rawRedirects);
      } catch (err) {
        checks.push({
          name: 'redirects.syntax',
          category: 'redirects',
          status: 'fail',
          message: `Failed to parse ${REDIRECTS_FILE}: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      let loopCount = 0;
      for (const r of redirects) {
        if (r.from && r.to && r.from.trim() === r.to.trim()) {
          loopCount += 1;
          checks.push({
            name: `redirects.self_loop:${r.from}`,
            category: 'redirects',
            status: 'fail',
            message: `Self-redirect loop detected: "${r.from}" redirects to itself`,
          });
        }
      }

      const cycles = detectRedirectCycles(redirects);
      for (const c of cycles) {
        loopCount += 1;
        checks.push({
          name: `redirects.cycle:${c[0]}`,
          category: 'redirects',
          status: 'fail',
          message: `Circular redirect loop detected: ${c.join(' -> ')}`,
          details: { cycle: c },
        });
      }

      if (loopCount === 0) {
        checks.push({
          name: 'redirects.cycles',
          category: 'redirects',
          status: 'pass',
          message: `All ${redirects.length} redirects validated with zero circular loops`,
        });
      }
    }
  }

  const passedChecks = checks.filter((c) => c.status === 'pass').length;
  const failedChecks = checks.filter((c) => c.status === 'fail').length;
  const warnChecks = checks.filter((c) => c.status === 'warn').length;
  const passed = failedChecks === 0;

  return {
    passed,
    totalChecks: checks.length,
    passedChecks,
    failedChecks,
    fatalCount: failedChecks,
    warnChecks,
    warningCount: warnChecks,
    checks,
  };
}

export const publishPreflightOperation: Operation<PublishPreflightInput, PublishPreflightOutput> = {
  name: 'publish.preflight',
  description:
    'Run comprehensive preflight validation for deployment (Oracle page syntax/render checks, SEO title/description, static asset paths, form destinations, and redirect loops) with zero mock fallbacks',
  category: 'publish',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T23',
  inputSchema: publishPreflightInputSchema,
  outputSchema: publishPreflightOutputSchema,
  async execute(snapshot, input, _context: OperationContext) {
    return await executePreflightChecks(snapshot, input);
  },
};

// ─── 2. preview.build Operation ───────────────────────────────────────────────

export const previewBuildInputSchema = z.object({
  projectId: z.string().optional(),
  branchId: z.string().optional(),
  port: z.number().int().positive().optional(),
  mode: z.enum(['development', 'production', 'static']).optional(),
  clean: z.boolean().optional(),
  optimize: z.boolean().optional(),
  includeRoutes: z.boolean().optional(),
  targetViewport: z.enum(['desktop', 'tablet', 'mobile']).optional(),
});

export type PreviewBuildInput = z.infer<typeof previewBuildInputSchema>;

export const routeDescriptorSchema = z.object({
  path: z.string(),
  route: z.string().optional(),
  title: z.string().optional(),
  kind: z.enum(['page', 'template', 'cms']),
  isDynamic: z.boolean().optional(),
});

export type RouteDescriptor = z.infer<typeof routeDescriptorSchema>;

export const previewBuildOutputSchema = z.object({
  status: z.enum(['ready', 'building', 'failed']),
  bundleId: z.string(),
  previewUrl: z.string(),
  buildDurationMs: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  pageRoutes: z.record(z.string(), z.string()),
  routesMap: z.record(z.string(), routeDescriptorSchema),
  routesCount: z.number().int().nonnegative(),
  readyCount: z.number().int().nonnegative(),
  timestamp: z.string(),
  issues: z
    .array(
      z.object({
        file: z.string().optional(),
        path: z.string().optional(),
        message: z.string(),
        line: z.number().optional(),
        severity: z.enum(['error', 'warn']).optional(),
      }),
    )
    .optional(),
});

export type PreviewBuildOutput = z.infer<typeof previewBuildOutputSchema>;

export const previewBuildOperation: Operation<PreviewBuildInput, PreviewBuildOutput> = {
  name: 'preview.build',
  description: 'Compile and validate preview bundle readiness across all project pages, routes, and templates',
  category: 'publish',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T23',
  inputSchema: previewBuildInputSchema,
  outputSchema: previewBuildOutputSchema,
  async execute(snapshot, input, context: OperationContext) {
    const startTime = performance.now();
    const projectId = input.projectId || snapshot.scope?.projectId || 'default-project';
    const port = input.port || 3000;

    // 1. Adapter delegation if configured
    const previewAdapter = (
      context?.adapters as
        | {
            preview?: {
              build?: (args: {
                projectId: string;
                snapshot: Snapshot;
                input: PreviewBuildInput;
              }) => Promise<PreviewBuildOutput>;
            };
          }
        | undefined
    )?.preview;
    if (typeof previewAdapter?.build === 'function') {
      return await previewAdapter.build({
        projectId,
        snapshot,
        input,
      });
    }

    // 2. Discover routes and validate compilation readiness
    const pageRoutes: Record<string, string> = {};
    const routesMap: Record<string, RouteDescriptor> = {};
    const issues: Array<{ file?: string; path?: string; message: string; line?: number; severity?: 'error' | 'warn' }> = [];

    const fileEntries: Array<[string, string]> = [];
    if (snapshot?.files) {
      for (const [p, c] of snapshot.files.entries()) fileEntries.push([p, c]);
    } else {
      for (const p of projectFS.listFiles()) {
        const c = projectFS.readFile(p);
        if (c !== null) fileEntries.push([p, c]);
      }
    }

    for (const [path, code] of fileEntries) {
      const isClientPage = path.endsWith('page.client.tsx');
      const isServerPage = path.endsWith('page.tsx') && !path.includes('__template_preview');

      if (isClientPage || isServerPage) {
        let route = '/';
        const parsed = parsePageFromPath(path);
        if (parsed) {
          route = parsed.route;
        } else {
          const m = path.match(/^app\/(.+)\/page(?:\.client)?\.tsx$/);
          if (m) route = `/${m[1]}`;
        }

        pageRoutes[route] = path;
        routesMap[route] = {
          path,
          route,
          kind: route.includes('[') ? 'cms' : 'page',
          isDynamic: route.includes('['),
        };

        // Syntax and Babel compilation verification
        try {
          parse(code, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
        } catch (err: unknown) {
          const parseErr = err as { message?: string; loc?: { line?: number } } | null;
          issues.push({
            file: path,
            path,
            message: parseErr?.message || 'Syntax parse failed',
            line: parseErr?.loc?.line,
            severity: 'error',
          });
        }
      }

      // Check route group templates
      if (path.endsWith('LayoutClient.tsx')) {
        const m = path.match(/^app\/\(([^)]+)\)\/LayoutClient\.tsx$/);
        if (m) {
          const group = m[1];
          const { url } = templatePreviewRoute(group);
          pageRoutes[url] = path;
          routesMap[url] = {
            path,
            route: url,
            kind: 'template',
          };
        }
      }
    }

    const durationMs = Math.round(performance.now() - startTime);
    const status = issues.length > 0 ? 'failed' : 'ready';
    const bundleId = `pvw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const previewUrl = `http://localhost:${port}/preview/${projectId}`;
    const routesCount = Object.keys(pageRoutes).length;

    return {
      status,
      bundleId,
      previewUrl,
      buildDurationMs: durationMs,
      durationMs,
      pageRoutes,
      routesMap,
      routesCount,
      readyCount: routesCount,
      timestamp: new Date().toISOString(),
      issues: issues.length > 0 ? issues : undefined,
    };
  },
};

// ─── 3. publish.deploy Operation ──────────────────────────────────────────────

export const publishDeployInputSchema = z.object({
  targetEnvironment: z.enum(['production', 'staging']).optional(),
  target: z.enum(['production', 'staging']).optional(),
  branchId: z.string().optional(),
  force: z.boolean().optional(),
  subdomain: z.string().optional(),
  customDomain: z.string().optional(),
  message: z.string().optional(),
});

export type PublishDeployInput = z.infer<typeof publishDeployInputSchema>;

export const publishDeployOutputSchema = z.object({
  success: z.boolean(),
  deploymentId: z.string(),
  timestamp: z.string(),
  targetEnvironment: z.enum(['production', 'staging']),
  target: z.enum(['production', 'staging']),
  commitHash: z.string(),
  revision: z.number(),
  url: z.string(),
  status: z.enum(['deployed', 'failed', 'building', 'queued']),
  preflightPassed: z.boolean(),
  forced: z.boolean(),
  pageCount: z.number(),
  message: z.string().optional(),
  changes: z.array(z.custom<FileChange>()),
  historyFile: z.string(),
  preflightReport: publishPreflightOutputSchema.optional(),
});

export type PublishDeployOutput = z.infer<typeof publishDeployOutputSchema>;

export const publishDeployOperation: Operation<PublishDeployInput, PublishDeployOutput> = {
  name: 'publish.deploy',
  description:
    'Deploy project revision with strict preflight validation gate, adapter delegation, and persistent deployment history in _meta/deployments.json',
  category: 'publish',
  kind: 'mutation',
  permit: 'write',
  environment: 'service',
  ownerTask: 'T23',
  inputSchema: publishDeployInputSchema,
  outputSchema: publishDeployOutputSchema,
  async execute(snapshot, input, context: OperationContext) {
    const projectId = snapshot.scope?.projectId || 'default-project';
    const targetEnv = input.target || input.targetEnvironment || 'production';
    const force = input.force ?? false;

    // Phase 1: Preflight Enforcement Gate
    const preflight = await executePreflightChecks(snapshot);
    if (!preflight.passed && !force) {
      const failedChecksSummary = preflight.checks
        .filter((c) => c.status === 'fail')
        .map((c) => `[${c.category}] ${c.name}: ${c.message}`)
        .join('; ');
      throw new Error(
        `DEPLOY_PREFLIGHT_BLOCKED (PREFLIGHT_FAILED): Deployment blocked because preflight checks failed (use force: true to bypass). Violations: ${failedChecksSummary}`,
      );
    }

    // Phase 2: Adapter Delegation (if hosting adapter provided)
    const hostingAdapter = (
      context?.adapters as
        | {
            hosting?: {
              deploy?: (args: {
                projectId: string;
                targetEnvironment: 'production' | 'staging';
                target: 'production' | 'staging';
                revision: number;
                snapshot: Snapshot;
                force: boolean;
                subdomain?: string;
                customDomain?: string;
                message?: string;
              }) => Promise<PublishDeployOutput>;
            };
          }
        | undefined
    )?.hosting;
    if (typeof hostingAdapter?.deploy === 'function') {
      const adapterRes = await hostingAdapter.deploy({
        projectId,
        targetEnvironment: targetEnv,
        target: targetEnv,
        revision: snapshot.revision,
        snapshot,
        force,
        subdomain: input.subdomain,
        customDomain: input.customDomain,
        message: input.message,
      });
      return {
        ...adapterRes,
        targetEnvironment: targetEnv,
        target: targetEnv,
        preflightPassed: preflight.passed,
        preflightReport: preflight,
        historyFile: DEPLOYMENTS_STORAGE_PATH,
        changes: adapterRes.changes || [],
      };
    }

    // Phase 3: Headless Local Staging Fallback (_meta/deployments.json)
    const sync = syncPublishSnapshotToProjectFS(snapshot);
    const commitHash = calculateSnapshotHash(snapshot.files);
    const deploymentId = context?.createId
      ? context.createId('dep')
      : `dep-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const timestamp = new Date().toISOString();

    const hostPrefix = input.customDomain
      ? input.customDomain
      : input.subdomain
      ? `${input.subdomain}.${targetEnv === 'production' ? 'revyme.app' : 'staging.revyme.app'}`
      : `${projectId}.${targetEnv === 'production' ? 'revyme.app' : 'staging.revyme.app'}`;
    const url = `https://${hostPrefix}`;

    let pageCount = 0;
    for (const p of snapshot.files.keys()) {
      if (/(^|\/)page(\.client)?\.tsx$/.test(p)) pageCount += 1;
    }

    const record: DeploymentRecord = {
      id: deploymentId,
      deploymentId,
      timestamp,
      targetEnvironment: targetEnv,
      target: targetEnv,
      revision: snapshot.revision ?? 1,
      commitHash,
      url,
      status: 'deployed',
      preflightPassed: preflight.passed,
      forced: force,
      pageCount,
      message: input.message,
    };

    // Load existing deployment records and append chronologically
    const existing = loadDeployments(snapshot);
    const updated = [...existing, record];
    saveDeployments(updated, snapshot);

    const changes = sync.collectChanges();

    return {
      success: true,
      deploymentId,
      timestamp,
      targetEnvironment: targetEnv,
      target: targetEnv,
      commitHash,
      revision: snapshot.revision ?? 1,
      url,
      status: 'deployed',
      preflightPassed: preflight.passed,
      forced: force,
      pageCount,
      message: input.message,
      changes,
      historyFile: DEPLOYMENTS_STORAGE_PATH,
      preflightReport: preflight,
    };
  },
};

// ─── 4. publish.status Operation ──────────────────────────────────────────────

export const publishStatusInputSchema = z.object({
  projectId: z.string().optional(),
  limit: z.number().int().positive().optional(),
});

export type PublishStatusInput = z.infer<typeof publishStatusInputSchema>;

export const publishStatusOutputSchema = z.object({
  latestDeployment: deploymentRecordSchema.nullable(),
  latestProduction: deploymentRecordSchema.nullable(),
  latestStaging: deploymentRecordSchema.nullable(),
  totalDeployments: z.number().int().nonnegative(),
  history: z.array(deploymentRecordSchema),
});

export type PublishStatusOutput = z.infer<typeof publishStatusOutputSchema>;

export const publishStatusOperation: Operation<PublishStatusInput, PublishStatusOutput> = {
  name: 'publish.status',
  description: 'Get current deployment status and history from _meta/deployments.json or hosting adapter',
  category: 'publish',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T23',
  inputSchema: publishStatusInputSchema,
  outputSchema: publishStatusOutputSchema,
  async execute(snapshot, input, context: OperationContext) {
    const hostingAdapter = (
      context?.adapters as
        | {
            hosting?: {
              getStatus?: (args: {
                projectId: string;
                limit?: number;
              }) => Promise<PublishStatusOutput>;
            };
          }
        | undefined
    )?.hosting;
    if (typeof hostingAdapter?.getStatus === 'function') {
      return await hostingAdapter.getStatus({
        projectId: snapshot.scope?.projectId || 'default-project',
        limit: input.limit,
      });
    }

    const records = loadDeployments(snapshot);

    const latestDeployment = records.length > 0 ? records[records.length - 1] : null;
    const latestProduction =
      records.filter((r) => r.targetEnvironment === 'production' || r.target === 'production').slice(-1)[0] ?? null;
    const latestStaging =
      records.filter((r) => r.targetEnvironment === 'staging' || r.target === 'staging').slice(-1)[0] ?? null;
    const history = records.slice(0, input.limit ?? 10);

    return {
      latestDeployment,
      latestProduction,
      latestStaging,
      totalDeployments: records.length,
      history,
    };
  },
};

// ─── Operation Registrations & Aliases ─────────────────────────────────────────

defaultRegistry.register(publishPreflightOperation);
defaultRegistry.register(previewBuildOperation);
defaultRegistry.register(publishDeployOperation);
defaultRegistry.register(publishStatusOperation);

defaultRegistry.registerAlias('preflight.check', 'publish.preflight');
defaultRegistry.registerAlias('publish.check', 'publish.preflight');
defaultRegistry.registerAlias('preflight.run', 'publish.preflight');
defaultRegistry.registerAlias('preflight.validate', 'publish.preflight');

defaultRegistry.registerAlias('build.preview', 'preview.build');
defaultRegistry.registerAlias('preview.generate', 'preview.build');
defaultRegistry.registerAlias('preview.start', 'preview.build');
defaultRegistry.registerAlias('preview.create', 'preview.build');
defaultRegistry.registerAlias('preview.check', 'preview.build');

defaultRegistry.registerAlias('deploy.site', 'publish.deploy');
defaultRegistry.registerAlias('site.publish', 'publish.deploy');
defaultRegistry.registerAlias('publish.site', 'publish.deploy');
defaultRegistry.registerAlias('project.publish', 'publish.deploy');

defaultRegistry.registerAlias('deploy.status', 'publish.status');
defaultRegistry.registerAlias('publish.history', 'publish.status');
