// packages/automation-core/src/operations/export.ts
import { z } from 'zod';
import { createHash } from 'node:crypto';
import type { Operation, OperationContext } from '../contracts';
import { defaultRegistry } from '../registry';
import { projectFS, MAIN_BRANCH_ID } from '@/code/project/project-fs';
import {
  prepareSiteFiles,
  buildPackageJson,
  buildReadme,
  exportSlug,
  isBuilderMetadataPath,
  isSecretEnvFile,
  generateEnvExample,
  localizeUrlImports,
  NEXT_CONFIG,
  TSCONFIG,
  GITIGNORE,
  type ModuleFetch,
} from '@/code/project/source-export';
import { buildZip, type ZipEntry } from '@/shared/zip';
import { runPublishPreflight, type PreflightIssue } from '@/code/oracle/publish-preflight';
import { OPTIMIZE_IMAGES_SCRIPT, IMAGE_UTILS_TS } from '@/shared/image-export-constants';

// ─── Pure Asset Extraction Utilities (Headless - Zero UI Dependency) ─────────

export function extractUploadFilenames(files: Iterable<string>): string[] {
  const filenames = new Set<string>();
  const regex = /(?:\/api)?\/uploads\/([a-zA-Z0-9_.-]+)/g;
  for (const text of files) {
    if (!text || typeof text !== 'string') continue;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      if (m[1]) {
        const safeName = m[1].split('?')[0].split('#')[0];
        filenames.add(safeName);
      }
    }
  }
  return Array.from(filenames);
}

export function extractPublicAssetPaths(files: Iterable<string>): string[] {
  const assetPaths = new Set<string>();
  const regex = /(?:['"`(\s])\/(fonts|images)\/([a-zA-Z0-9_.-]+)/g;
  for (const text of files) {
    if (!text || typeof text !== 'string') continue;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      if (m[1] && m[2]) {
        const safeName = m[2].split('?')[0].split('#')[0];
        assetPaths.add(`${m[1]}/${safeName}`);
      }
    }
  }
  return Array.from(assetPaths);
}

// ─── 1. export.formats Operation ──────────────────────────────────────────────

export const exportFormatCapabilitiesSchema = z.object({
  serverComponents: z.boolean(),
  dynamicRouting: z.boolean(),
  apiRoutes: z.boolean(),
  imageOptimization: z.boolean(),
  clientHydration: z.boolean(),
  offlineRunnable: z.boolean(),
  standaloneSupported: z.boolean(),
  fontOptimization: z.boolean(),
  localization: z.boolean(),
  cmsRelay: z.boolean(),
  pureStaticOutput: z.boolean().optional(),
});

export type ExportFormatCapabilities = z.infer<typeof exportFormatCapabilitiesSchema>;

export const exportFormatDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  aliases: z.array(z.string()),
  label: z.string(),
  description: z.string(),
  sublabel: z.string(),
  target: z.string(),
  extension: z.string(),
  mimeType: z.string(),
  defaultFilename: z.string(),
  minPlan: z.enum(['free', 'pro', 'studio']),
  status: z.enum(['supported', 'experimental', 'unsupported']),
  unsupportedReason: z.string().optional(),
  ssgSupported: z.boolean(),
  capabilities: z.array(z.string()),
  capabilityFlags: exportFormatCapabilitiesSchema.optional(),
  supportedOptions: z.array(z.string()),
});

export type ExportFormatDefinition = z.infer<typeof exportFormatDefinitionSchema>;

export const exportFormatsInputSchema = z.object({
  projectId: z.string().optional(),
  status: z.enum(['all', 'supported', 'experimental', 'unsupported']).optional(),
  planTier: z.enum(['free', 'pro', 'studio']).optional(),
});

export type ExportFormatsInput = z.infer<typeof exportFormatsInputSchema>;

export const exportFormatsOutputSchema = z.object({
  formats: z.array(exportFormatDefinitionSchema),
  defaultFormat: z.literal('nextjs'),
});

export type ExportFormatsOutput = z.infer<typeof exportFormatsOutputSchema>;

export const KNOWN_EXPORT_FORMATS: ExportFormatDefinition[] = [
  {
    id: 'nextjs',
    name: 'Next.js (App Router)',
    aliases: ['source', 'nextjs-dynamic', 'next'],
    label: 'Next.js (App Router)',
    description: 'Full runnable Next.js 16 project with dynamic routing, server components, and API route handlers',
    sublabel: 'Full runnable Next.js 16 project with dynamic routing, server components, and API route handlers',
    target: 'nextjs',
    extension: '.zip',
    mimeType: 'application/zip',
    defaultFilename: 'nextjs-project.zip',
    minPlan: 'free',
    status: 'supported',
    ssgSupported: false,
    capabilities: [
      'dynamic-routes',
      'server-components',
      'serverComponents',
      'dynamicRouting',
      'apiRoutes',
      'imageOptimization',
      'clientHydration',
      'offlineRunnable',
      'standaloneSupported',
      'fontOptimization',
      'localization',
      'cmsRelay',
    ],
    capabilityFlags: {
      serverComponents: true,
      dynamicRouting: true,
      apiRoutes: true,
      imageOptimization: true,
      clientHydration: true,
      offlineRunnable: true,
      standaloneSupported: true,
      fontOptimization: true,
      localization: true,
      cmsRelay: true,
    },
    supportedOptions: [
      'projectName',
      'branchId',
      'runtimeRange',
      'outputType',
      'archiveType',
      'outputDirectory',
      'strictPreflight',
      'strictAssets',
      'includeAssets',
      'includeScaffold',
      'includeEnvExample',
      'clean',
    ],
  },
  {
    id: 'ssg',
    name: 'Next.js (Static Site Generation)',
    aliases: ['source-ssg', 'nextjs-ssg', 'static-site'],
    label: 'Next.js (Static Site Generation)',
    description: 'Pre-rendered HTML pages with static parameters discovery and client hydration',
    sublabel: 'Pre-rendered HTML pages with static parameters discovery and client hydration',
    target: 'ssg',
    extension: '.zip',
    mimeType: 'application/zip',
    defaultFilename: 'ssg-project.zip',
    minPlan: 'free',
    status: 'supported',
    ssgSupported: true,
    capabilities: [
      'static-export',
      'pureStaticOutput',
      'dynamic-routes',
      'serverComponents',
      'dynamicRouting',
      'apiRoutes',
      'imageOptimization',
      'clientHydration',
      'offlineRunnable',
      'standaloneSupported',
      'fontOptimization',
      'localization',
    ],
    capabilityFlags: {
      serverComponents: true,
      dynamicRouting: true,
      apiRoutes: true,
      imageOptimization: true,
      clientHydration: true,
      offlineRunnable: true,
      standaloneSupported: true,
      fontOptimization: true,
      localization: true,
      cmsRelay: false,
      pureStaticOutput: true,
    },
    supportedOptions: [
      'projectName',
      'branchId',
      'runtimeRange',
      'pureStatic',
      'outputType',
      'archiveType',
      'outputDirectory',
      'strictPreflight',
      'strictAssets',
      'includeAssets',
      'includeScaffold',
      'includeEnvExample',
      'clean',
    ],
  },
  {
    id: 'static',
    name: 'Static HTML + CSS Archive',
    aliases: ['html-zip', 'html', 'html-css'],
    label: 'Static HTML + CSS Archive',
    description: 'Zero-runtime static HTML and CSS export for immediate hosting on static servers',
    sublabel: 'Zero-runtime static HTML and CSS export for immediate hosting on static servers',
    target: 'static',
    extension: '.zip',
    mimeType: 'application/zip',
    defaultFilename: 'static-site.zip',
    minPlan: 'free',
    status: 'supported',
    ssgSupported: true,
    capabilities: [
      'static-html',
      'css',
      'offlineRunnable',
      'imageOptimization',
      'standaloneSupported',
      'fontOptimization',
      'localization',
    ],
    capabilityFlags: {
      serverComponents: false,
      dynamicRouting: false,
      apiRoutes: false,
      imageOptimization: true,
      clientHydration: false,
      offlineRunnable: true,
      standaloneSupported: true,
      fontOptimization: true,
      localization: true,
      cmsRelay: false,
    },
    supportedOptions: [
      'projectName',
      'branchId',
      'outputType',
      'archiveType',
      'outputDirectory',
      'strictPreflight',
      'strictAssets',
      'includeAssets',
      'includeScaffold',
      'clean',
    ],
  },
  {
    id: 'vite',
    name: 'Vite Project',
    aliases: ['vite-react'],
    label: 'Vite Project',
    description: 'Client-rendered React SPA using Vite bundler',
    sublabel: 'Client-rendered React SPA using Vite bundler',
    target: 'vite',
    extension: '.zip',
    mimeType: 'application/zip',
    defaultFilename: 'vite-project.zip',
    minPlan: 'free',
    status: 'experimental',
    ssgSupported: false,
    capabilities: [
      'clientHydration',
      'offlineRunnable',
      'standaloneSupported',
    ],
    capabilityFlags: {
      serverComponents: false,
      dynamicRouting: false,
      apiRoutes: false,
      imageOptimization: false,
      clientHydration: true,
      offlineRunnable: true,
      standaloneSupported: true,
      fontOptimization: false,
      localization: false,
      cmsRelay: false,
    },
    supportedOptions: ['projectName', 'outputType', 'archiveType'],
  },
  {
    id: 'tailwind',
    name: 'Tailwind CSS Project',
    aliases: ['nextjs-tailwind'],
    label: 'Tailwind CSS Project',
    description: 'Next.js project with Tailwind CSS utility classes',
    sublabel: 'Next.js project with Tailwind CSS utility classes',
    target: 'tailwind',
    extension: '.zip',
    mimeType: 'application/zip',
    defaultFilename: 'tailwind-project.zip',
    minPlan: 'pro',
    status: 'unsupported',
    unsupportedReason: 'Tailwind conversion requires the Revyme Cloud compiler service (501 / Phase 2).',
    ssgSupported: false,
    capabilities: [],
    capabilityFlags: {
      serverComponents: true,
      dynamicRouting: true,
      apiRoutes: true,
      imageOptimization: true,
      clientHydration: true,
      offlineRunnable: false,
      standaloneSupported: false,
      fontOptimization: true,
      localization: true,
      cmsRelay: true,
    },
    supportedOptions: [],
  },
];

export const exportFormatsOperation: Operation<ExportFormatsInput, ExportFormatsOutput> = {
  name: 'export.formats',
  description: 'List supported source export targets, capabilities, and packaging options',
  category: 'export',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T23',
  inputSchema: exportFormatsInputSchema,
  outputSchema: exportFormatsOutputSchema,
  async execute(_snapshot, input, _context: OperationContext) {
    let list = KNOWN_EXPORT_FORMATS;
    if (input.status && input.status !== 'all') {
      list = list.filter((f) => f.status === input.status);
    }
    if (input.planTier === 'free') {
      list = list.filter((f) => f.minPlan === 'free');
    }
    return {
      formats: list,
      defaultFormat: 'nextjs',
    };
  },
};

// ─── 2. export.generate Operation ─────────────────────────────────────────────

export const exportManifestEntrySchema = z.object({
  path: z.string(),
  bytes: z.number().int().nonnegative(),
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string(),
  category: z.enum(['page', 'component', 'style', 'asset', 'scaffold', 'cms', 'config', 'other']),
  isBinary: z.boolean().optional(),
});

export type ExportManifestEntry = z.infer<typeof exportManifestEntrySchema>;

export const exportGenerateInputSchema = z.object({
  format: z
    .enum([
      'nextjs',
      'ssg',
      'static',
      'html-zip',
      'source',
      'source-ssg',
      'nextjs-dynamic',
      'next',
      'nextjs-ssg',
      'static-site',
      'html',
      'html-css',
      'vite',
      'tailwind',
    ])
    .optional(),
  projectName: z.string().optional(),
  branchId: z.string().optional(),
  runtimeRange: z.string().optional(),
  pureStatic: z.boolean().optional(),
  clean: z.boolean().optional(),
  outputType: z.enum(['archive', 'fileMap', 'directory', 'both', 'files', 'zip', 'base64']).optional(),
  archiveType: z.enum(['zip', 'files', 'base64', 'archive']).optional(),
  outputDirectory: z.string().optional(),
  outputPath: z.string().optional(),
  strictPreflight: z.boolean().optional(),
  strictAssets: z.boolean().optional(),
  includeAssets: z.boolean().optional(),
  includeScaffold: z.boolean().optional(),
  includeEnvExample: z.boolean().optional(),
});

export type ExportGenerateInput = z.infer<typeof exportGenerateInputSchema>;

export const exportGenerateOutputSchema = z.object({
  format: z.string(),
  filename: z.string(),
  totalFiles: z.number().int().nonnegative(),
  fileCount: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  byteCount: z.number().int().nonnegative(),
  archiveBase64: z.string().optional(),
  files: z.record(z.string(), z.string()).optional(),
  outputPath: z.string().optional(),
  manifest: z.array(exportManifestEntrySchema),
  scaffoldIncluded: z.boolean(),
  durationMs: z.number().int().nonnegative(),
  diagnostics: z.object({
    preflightClean: z.boolean(),
    preflightIssues: z.array(
      z.object({
        path: z.string(),
        code: z.string(),
        line: z.number().optional(),
        message: z.string(),
      }),
    ),
    downloadedRemoteComponents: z.array(z.string()),
    failedRemoteComponents: z.array(z.string()),
    referencedAssets: z.array(z.string()),
    missingAssets: z.array(z.string()),
  }),
});

export type ExportGenerateOutput = z.infer<typeof exportGenerateOutputSchema>;

export function categorizeFilePath(path: string): ExportManifestEntry['category'] {
  if (path.startsWith('app/') && (path.includes('page.') || path.includes('layout.'))) return 'page';
  if (path.startsWith('components/')) return 'component';
  if (path.endsWith('.css')) return 'style';
  if (path.startsWith('public/') || path.startsWith('assets/')) return 'asset';
  if (path.startsWith('cms/')) return 'cms';
  if (
    path === 'package.json' ||
    path === 'next.config.mjs' ||
    path === 'next.config.js' ||
    path === 'tsconfig.json' ||
    path === '.gitignore' ||
    path === 'README.md' ||
    path.startsWith('scripts/') ||
    path.startsWith('lib/')
  ) {
    return 'scaffold';
  }
  if (path.startsWith('.env') || path.endsWith('.config.json') || path.endsWith('.json')) return 'config';
  return 'other';
}

export function normalizeExportFormat(formatInput: string): 'nextjs' | 'ssg' | 'static' | 'vite' | 'tailwind' {
  const norm = formatInput.toLowerCase().trim();
  if (norm === 'nextjs' || norm === 'source' || norm === 'nextjs-dynamic' || norm === 'next') return 'nextjs';
  if (norm === 'ssg' || norm === 'source-ssg' || norm === 'nextjs-ssg' || norm === 'static-site') return 'ssg';
  if (norm === 'static' || norm === 'html-zip' || norm === 'html' || norm === 'html-css') return 'static';
  if (norm === 'vite' || norm === 'vite-react') return 'vite';
  if (norm === 'tailwind' || norm === 'nextjs-tailwind') return 'tailwind';
  throw new Error(`UNSUPPORTED_EXPORT_FORMAT: Format "${formatInput}" is not supported for standalone export.`);
}

export const exportGenerateOperation: Operation<ExportGenerateInput, ExportGenerateOutput> = {
  name: 'export.generate',
  description: 'Assemble and generate a runnable Next.js source project, SSG bundle, or static HTML archive',
  category: 'export',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T23',
  inputSchema: exportGenerateInputSchema,
  outputSchema: exportGenerateOutputSchema,
  async execute(snapshot, input, context: OperationContext) {
    const startTime = performance.now();
    const format = normalizeExportFormat(input.format || 'nextjs');

    if (format === 'tailwind') {
      throw new Error('UNSUPPORTED_EXPORT_FORMAT: Tailwind conversion requires the Revyme Cloud compiler service (501 / Phase 2).');
    }

    const slug = exportSlug(input.projectName || snapshot?.scope?.projectId || 'revyme-site');
    const isSsg = format === 'ssg';

    // 1. Synchronize snapshot to ProjectFS and gather raw files
    const rawFiles: Record<string, string> = {};
    if (snapshot?.files && snapshot.files.size > 0) {
      for (const [path, content] of snapshot.files) {
        rawFiles[path] = content;
        if (projectFS.readFile(path) !== content) {
          projectFS.writeFile(path, content);
        }
      }
    } else {
      const branchFiles = projectFS.readBranchFiles(input.branchId || MAIN_BRANCH_ID, { shared: true });
      if (branchFiles) {
        for (const [path, content] of branchFiles) {
          rawFiles[path] = content;
        }
      }
    }

    // 2. Preflight Oracle validation sweep
    const preflightIssues: PreflightIssue[] = runPublishPreflight();
    const preflightClean = preflightIssues.length === 0;
    if (input.strictPreflight && !preflightClean) {
      const msg = preflightIssues.map((i) => `${i.path}:${i.line ?? '?'} [${i.code}] ${i.message}`).join('\n');
      throw new Error(`EXPORT_PREFLIGHT_FAILED: The project contains fatal syntax or runtime errors:\n${msg}`);
    }

    // 3. Prepare site files using AST transformers
    const prepared = prepareSiteFiles(rawFiles, { ssg: isSsg, buildMode: isSsg ? 'ssg' : 'dynamic' });

    // 4. Localize remote marketplace components
    const customFetch: ModuleFetch = async (url) => {
      const r = await fetch(url, { signal: context.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const text = await r.text();
      if (text.trimStart().startsWith('<')) throw new Error('HTML response');
      return text;
    };

    const { files: localized, downloaded, failed: failedImports } = await localizeUrlImports(
      prepared,
      customFetch,
    ).catch(() => ({ files: prepared, downloaded: [], failed: [] }));

    // 5. Filter out builder metadata and secret env files
    const finalFiles: Record<string, string> = {};
    for (const [path, content] of Object.entries(localized)) {
      if (isBuilderMetadataPath(path) || isSecretEnvFile(path)) continue;
      finalFiles[path] = content;
    }

    // 6. Generate .env.example
    if (input.includeEnvExample !== false && !finalFiles['.env.example']) {
      const envExample = generateEnvExample(rawFiles);
      if (envExample) finalFiles['.env.example'] = envExample;
    }

    // 7. Inject Scaffolds
    if (input.includeScaffold !== false) {
      if (!finalFiles['package.json']) {
        finalFiles['package.json'] = buildPackageJson(slug, input.runtimeRange || 'latest', new Date());
      }
      if (!finalFiles['next.config.mjs'] && !finalFiles['next.config.js']) {
        if (isSsg) {
          finalFiles['next.config.mjs'] = NEXT_CONFIG.replace(
            'const nextConfig = {',
            "const nextConfig = {\n  output: 'export',\n  images: { unoptimized: true },",
          );
        } else {
          finalFiles['next.config.mjs'] = NEXT_CONFIG;
        }
      }
      if (!finalFiles['tsconfig.json']) {
        finalFiles['tsconfig.json'] = TSCONFIG;
      }
      if (!finalFiles['.gitignore']) {
        finalFiles['.gitignore'] = GITIGNORE;
      }
      if (!finalFiles['README.md']) {
        finalFiles['README.md'] = buildReadme(input.projectName || slug);
      }
      if (!finalFiles['scripts/optimize-images.mjs']) {
        finalFiles['scripts/optimize-images.mjs'] = OPTIMIZE_IMAGES_SCRIPT;
      }
      if (!finalFiles['lib/image-utils.ts']) {
        finalFiles['lib/image-utils.ts'] = IMAGE_UTILS_TS;
      }
    }

    // 8. Bundle Binary Assets
    const referencedUploads = extractUploadFilenames(Object.values(rawFiles));
    const referencedPublicAssets = extractPublicAssetPaths(Object.values(rawFiles));
    const allReferencedAssets = [...referencedUploads.map((u) => `uploads/${u}`), ...referencedPublicAssets];
    const missingAssets: string[] = [];

    const zipEntries: ZipEntry[] = [];
    for (const [path, content] of Object.entries(finalFiles)) {
      zipEntries.push({ path, data: content });
    }

    if (input.includeAssets !== false) {
      for (const assetRel of referencedPublicAssets) {
        const candidatePaths = [assetRel, `public/${assetRel}`];
        let found = false;
        for (const cp of candidatePaths) {
          if (rawFiles[cp]) {
            zipEntries.push({ path: `public/${assetRel}`, data: rawFiles[cp] });
            found = true;
            break;
          }
        }
        if (!found) {
          missingAssets.push(assetRel);
        }
      }
      for (const uploadName of referencedUploads) {
        const candidatePaths = [`api/uploads/${uploadName}`, `uploads/${uploadName}`, `public/uploads/${uploadName}`];
        let found = false;
        for (const cp of candidatePaths) {
          if (rawFiles[cp]) {
            zipEntries.push({ path: `public/uploads/${uploadName}`, data: rawFiles[cp] });
            zipEntries.push({ path: `public/api/uploads/${uploadName}`, data: rawFiles[cp] });
            found = true;
            break;
          }
        }
        if (!found) {
          missingAssets.push(`uploads/${uploadName}`);
        }
      }
    }

    if (input.strictAssets && missingAssets.length > 0) {
      throw new Error(`MISSING_EXPORT_ASSETS: The following referenced assets could not be resolved:\n${missingAssets.join('\n')}`);
    }

    // 9. Generate Manifest
    const manifest: ExportManifestEntry[] = zipEntries.map((e) => {
      const bytes = typeof e.data === 'string' ? Buffer.byteLength(e.data, 'utf8') : e.data.byteLength;
      const hash = createHash('sha256')
        .update(typeof e.data === 'string' ? Buffer.from(e.data, 'utf8') : Buffer.from(e.data))
        .digest('hex');
      return {
        path: e.path,
        bytes,
        sizeBytes: bytes,
        sha256: hash,
        category: categorizeFilePath(e.path),
        isBinary: typeof e.data !== 'string',
      };
    });

    // 10. Packaging & Output Assembly
    const filename = `${slug}-${format}.zip`;
    let archiveBase64: string | undefined;
    let totalBytes = manifest.reduce((acc, curr) => acc + curr.bytes, 0);

    const isArchiveRequested =
      input.outputType === 'archive' ||
      input.outputType === 'both' ||
      input.outputType === 'zip' ||
      input.outputType === 'base64' ||
      input.archiveType === 'zip' ||
      input.archiveType === 'base64' ||
      input.archiveType === 'archive' ||
      (!input.outputType && !input.archiveType);

    if (isArchiveRequested) {
      const zipBytes = await buildZip(zipEntries);
      archiveBase64 = Buffer.from(zipBytes).toString('base64');
      totalBytes = zipBytes.byteLength;
    }

    const isFilesRequested =
      input.outputType === 'fileMap' ||
      input.outputType === 'both' ||
      input.outputType === 'files' ||
      input.archiveType === 'files' ||
      (!input.outputType && !input.archiveType);

    let filesMap: Record<string, string> | undefined;
    if (isFilesRequested) {
      filesMap = {};
      for (const e of zipEntries) {
        filesMap[e.path] = typeof e.data === 'string' ? e.data : Buffer.from(e.data).toString('base64');
      }
    }

    const durationMs = Math.round(performance.now() - startTime);

    return {
      format,
      filename,
      totalFiles: zipEntries.length,
      fileCount: zipEntries.length,
      totalBytes,
      byteCount: totalBytes,
      archiveBase64,
      files: filesMap,
      outputPath: input.outputPath || input.outputDirectory,
      manifest,
      scaffoldIncluded: input.includeScaffold !== false,
      durationMs,
      diagnostics: {
        preflightClean,
        preflightIssues: preflightIssues.map((i) => ({
          path: i.path,
          code: i.code,
          line: i.line,
          message: i.message,
        })),
        downloadedRemoteComponents: downloaded,
        failedRemoteComponents: failedImports,
        referencedAssets: allReferencedAssets,
        missingAssets,
      },
    };
  },
};

// ─── Default Registry Registration & Compatibility Aliases ────────────────────

defaultRegistry.register(exportFormatsOperation);
defaultRegistry.register(exportGenerateOperation);

defaultRegistry.registerAlias('export.listFormats', 'export.formats');
defaultRegistry.registerAlias('export.list_formats', 'export.formats');
defaultRegistry.registerAlias('export.getFormats', 'export.formats');
defaultRegistry.registerAlias('export.targets', 'export.formats');
defaultRegistry.registerAlias('formats.list', 'export.formats');
defaultRegistry.registerAlias('export.availableFormats', 'export.formats');

defaultRegistry.registerAlias('project.export', 'export.generate');
defaultRegistry.registerAlias('export.project', 'export.generate');
defaultRegistry.registerAlias('export.bundle', 'export.generate');
defaultRegistry.registerAlias('export.site', 'export.generate');
defaultRegistry.registerAlias('export.build', 'export.generate');
defaultRegistry.registerAlias('export.source', 'export.generate');
defaultRegistry.registerAlias('export.create', 'export.generate');
defaultRegistry.registerAlias('export.zip', 'export.generate');
