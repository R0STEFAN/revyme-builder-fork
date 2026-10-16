import fs from 'node:fs';
import path from 'node:path';
import { spawn, exec, execSync, type ChildProcess } from 'node:child_process';
import sharp from 'sharp';
import { getDataDirs, getProject, readUploadsMeta } from './storage';
import { OPTIMIZE_IMAGES_SCRIPT, IMAGE_UTILS_TS } from '../src/shared/image-export-constants';

function extractReferencedUploads(files: Record<string, string> | Iterable<string>, allUploadFiles: string[]): Set<string> {
  const referenced = new Set<string>();
  const values = Array.isArray(files)
    ? files
    : (files instanceof Set || files instanceof Map
        ? Array.from(files.values())
        : (typeof (files as any)?.[Symbol.iterator] === 'function'
            ? Array.from(files as any)
            : Object.values(files || {})));

  const regex = /(?:\/api)?\/uploads\/([a-zA-Z0-9_.-]+)/g;
  for (const text of values) {
    if (!text || typeof text !== 'string') continue;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      if (m[1]) {
        const safeName = m[1].split('?')[0].split('#')[0];
        referenced.add(safeName);
      }
    }
  }

  if (allUploadFiles.length > 0) {
    const combinedContent = values.filter((t) => typeof t === 'string').join('\n');
    for (const file of allUploadFiles) {
      if (combinedContent.includes(file)) {
        referenced.add(file);
      }
    }
  }

  return referenced;
}

export type LocalServerState = 'idle' | 'building' | 'running' | 'error' | 'cancelled';

export type BuildStage =
  | 'idle'
  | 'exporting'
  | 'preparing-assets'
  | 'compiling'
  | 'collecting'
  | 'generating'
  | 'optimizing'
  | 'done'
  | 'error'
  | 'cancelled';

export interface BuildProgress {
  stage: BuildStage;
  label: string;
  percent: number;
  buildId?: string;
  startedAt?: number;
  finishedAt?: number | null;
}

export type BuildStatus = BuildProgress;

export interface LocalServerStatus {
  status: LocalServerState;
  port: number | null;
  url: string | null;
  isBuilt: boolean;
  lastBuiltAt: number | null;
  lastError: string | null;
  pid: number | null;
  buildProgress?: BuildProgress | null;
  buildStatus?: BuildStatus | null;
  buildId?: string | null;
  startedAt?: number | null;
  finishedAt?: number | null;
  liveLogs?: string[];
}

export interface LocalServerOptions {
  spawn?: typeof spawn;
  exec?: typeof exec;
  execSync?: typeof execSync;
  startupTimeoutMs?: number;
  publicDir?: string | null;
}

interface ProjectServerRecord {
  status: LocalServerState;
  port: number | null;
  url: string | null;
  isBuilt: boolean;
  lastBuiltAt: number | null;
  lastError: string | null;
  pid: number | null;
  proc: ChildProcess | null;
  isStopping?: boolean;
  buildProgress?: BuildProgress | null;
  buildId?: string | null;
  buildStartedAt?: number | null;
  buildFinishedAt?: number | null;
  liveLogs?: string[];
}

export function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function isIgnoredFile(filepath: string): boolean {
  const normalized = filepath.replace(/\\/g, '/');
  const firstSegment = normalized.split('/')[0] ?? '';
  return normalized.startsWith('_') || firstSegment.startsWith('_');
}

function resolveNextBin(): string {
  try {
    return require.resolve('next/dist/bin/next');
  } catch {
    return path.resolve(process.cwd(), 'node_modules/next/dist/bin/next');
  }
}

function cleanProcessEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NO_COLOR: '1',
    FORCE_COLOR: '0',
    ...extra,
  };
  delete env.NODE_OPTIONS;
  delete env.npm_lifecycle_script;
  delete env.npm_lifecycle_event;
  delete env.INIT_CWD;
  return env;
}

export function stripAnsi(str: string): string {
  return str.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
}

export function parseBuildProgress(
  output: string,
  current?: BuildProgress | null
): BuildProgress {
  const meta = {
    ...(current?.buildId ? { buildId: current.buildId } : {}),
    ...(current?.startedAt ? { startedAt: current.startedAt } : {}),
  };

  if (!output || !output.trim()) {
    return current || { stage: 'compiling', label: 'Preparing build...', percent: 10, ...meta };
  }

  // Parse milestones from most advanced to earliest
  if (/Finalizing page optimization/i.test(output)) {
    return {
      stage: 'optimizing',
      label: 'Finalizing page optimization...',
      percent: Math.max(current?.percent ?? 0, 95),
      ...meta,
    };
  }

  const staticPagesMatch = output.match(/Generating static pages\s*\((\d+)\/(\d+)\)/i);
  if (staticPagesMatch) {
    const done = parseInt(staticPagesMatch[1], 10);
    const total = parseInt(staticPagesMatch[2], 10);
    const pct = total > 0 ? Math.min(92, Math.round(65 + (done / total) * 27)) : 75;
    return {
      stage: 'generating',
      label: `Generating static pages (${done}/${total})...`,
      percent: Math.max(current?.percent ?? 0, pct),
      ...meta,
    };
  }

  if (/Collecting page data/i.test(output)) {
    return {
      stage: 'collecting',
      label: 'Collecting page data...',
      percent: Math.max(current?.percent ?? 0, 60),
      ...meta,
    };
  }

  if (/Compiled successfully|Linting and checking validity of types|Checking validity of types/i.test(output)) {
    return {
      stage: 'compiling',
      label: 'Validating and compiling...',
      percent: Math.max(current?.percent ?? 0, 45),
      ...meta,
    };
  }

  if (/Creating an optimized production build/i.test(output)) {
    return {
      stage: 'compiling',
      label: 'Creating optimized production build...',
      percent: Math.max(current?.percent ?? 0, 20),
      ...meta,
    };
  }

  return current || { stage: 'compiling', label: 'Preparing build...', percent: 10, ...meta };
}

export async function killProcessTree(
  child: ChildProcess,
  pid?: number | null,
  execFn: typeof exec = exec
): Promise<void> {
  const targetPid = pid ?? child.pid;
  if (!targetPid) {
    try {
      child.kill('SIGTERM');
    } catch {
      // ignore
    }
    return;
  }

  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      execFn(`taskkill /pid ${targetPid} /T /F`, () => {
        resolve();
      });
    });
  } else {
    try {
      process.kill(-targetPid, 'SIGTERM');
    } catch {
      try {
        child.kill('SIGTERM');
      } catch {
        // ignore
      }
    }
  }
}

export function killProcessTreeSync(
  child: ChildProcess,
  pid?: number | null,
  execSyncFn: typeof execSync = execSync
): void {
  const targetPid = pid ?? child.pid;
  if (!targetPid) {
    try {
      child.kill('SIGTERM');
    } catch {
      // ignore
    }
    return;
  }

  if (process.platform === 'win32') {
    try {
      execSyncFn(`taskkill /pid ${targetPid} /T /F`, { stdio: 'ignore' });
    } catch {
      // ignore
    }
  } else {
    try {
      process.kill(-targetPid, 'SIGTERM');
    } catch {
      try {
        child.kill('SIGTERM');
      } catch {
        // ignore
      }
    }
  }
}

export const PROTECTED_PORTS = new Set([3333, 5173, 5174, 5175, 8082]);

export async function killProcessOnPort(
  port: number,
  execFn: typeof exec = exec
): Promise<void> {
  if (!port || port <= 0 || PROTECTED_PORTS.has(port)) return;

  if (process.platform === 'win32') {
    return new Promise<void>((resolve) => {
      execFn(`netstat -ano | findstr :${port}`, (err, stdout) => {
        if (err || !stdout) return resolve();
        const lines = String(stdout).split('\n');
        const pids = new Set<string>();
        for (const line of lines) {
          if (!line.includes(`:${port}`)) continue;
          const parts = line.trim().split(/\s+/);
          const pid = parts[parts.length - 1];
          if (pid && /^\d+$/.test(pid) && pid !== '0') {
            pids.add(pid);
          }
        }
        if (pids.size === 0) return resolve();
        let remaining = pids.size;
        for (const pid of pids) {
          execFn(`taskkill /pid ${pid} /T /F`, () => {
            remaining--;
            if (remaining <= 0) resolve();
          });
        }
      });
    });
  } else {
    // Linux / macOS: use fuser or lsof to terminate anything listening on port
    return new Promise<void>((resolve) => {
      execFn(
        `fuser -k -9 ${port}/tcp 2>/dev/null || (lsof -ti :${port} 2>/dev/null | xargs -r kill -9 2>/dev/null) || true`,
        () => {
          resolve();
        }
      );
    });
  }
}

export function killProcessOnPortSync(
  port: number,
  execSyncFn: typeof execSync = execSync
): void {
  if (!port || port <= 0 || PROTECTED_PORTS.has(port)) return;

  if (process.platform === 'win32') {
    try {
      const output = execSyncFn(`netstat -ano | findstr :${port}`, {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const lines = String(output).split('\n');
      for (const line of lines) {
        if (!line.includes(`:${port}`)) continue;
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && /^\d+$/.test(pid) && pid !== '0') {
          try {
            execSyncFn(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // ignore
    }
  } else {
    try {
      execSyncFn(
        `fuser -k -9 ${port}/tcp 2>/dev/null || (lsof -ti :${port} 2>/dev/null | xargs -r kill -9 2>/dev/null) || true`,
        { stdio: 'ignore' }
      );
    } catch {
      // ignore
    }
  }
}

const DEFAULT_NEXT_CONFIG = `/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: { ignoreBuildErrors: true },
};
export default nextConfig;
`;

const DEFAULT_TSCONFIG = `{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": false,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "incremental": true,
    "paths": { "@/*": ["./*"] },
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts", ".next/dev/types/**/*.ts"],
  "exclude": ["node_modules"]
}
`;

const DEFAULT_PACKAGE_JSON = `{
  "name": "revyme-live-site",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "optimize-images": "node scripts/optimize-images.mjs",
    "prebuild": "npm run optimize-images"
  }
}
`;

export class LocalServerManager {
  private readonly buildsDir: string;
  private readonly publicDir: string | null;
  private readonly servers = new Map<string, ProjectServerRecord>();
  private readonly activeBuildProcesses = new Map<string, ChildProcess>();
  private readonly activeBuildControllers = new Map<string, AbortController>();
  private readonly spawnFn: typeof spawn;
  private readonly execFn: typeof exec;
  private readonly execSyncFn: typeof execSync;
  private readonly startupTimeoutMs: number;

  constructor(buildsDir?: string, options?: LocalServerOptions) {
    this.buildsDir = buildsDir || path.join(getDataDirs().root, 'builds');
    this.publicDir = options?.publicDir !== undefined ? options.publicDir : path.resolve(process.cwd(), 'public');
    this.spawnFn = options?.spawn || spawn;
    this.execFn = options?.exec || exec;
    this.execSyncFn = options?.execSync || execSync;
    this.startupTimeoutMs = options?.startupTimeoutMs ?? 15000;

    if (!fs.existsSync(this.buildsDir)) {
      try {
        fs.mkdirSync(this.buildsDir, { recursive: true });
      } catch {
        // ignore if cannot create immediately
      }
    }
  }

  getBuildDir(projectId: string): string {
    const safeId = sanitizeId(projectId);
    return path.join(this.buildsDir, safeId);
  }

  writeSuccessMarker(targetDir: string, buildId: string): void {
    try {
      const nextDir = path.join(targetDir, '.next');
      if (!fs.existsSync(nextDir)) {
        fs.mkdirSync(nextDir, { recursive: true });
      }
      const markerPath = path.join(nextDir, 'revyme-build-success.json');
      fs.writeFileSync(
        markerPath,
        JSON.stringify({
          success: true,
          buildId,
          builtAt: Date.now(),
        }, null, 2),
        'utf-8'
      );
      const failedMarker = path.join(nextDir, 'revyme-build-failed.json');
      if (fs.existsSync(failedMarker)) {
        try { fs.unlinkSync(failedMarker); } catch { /* ignore */ }
      }
    } catch {
      // ignore
    }
  }

  clearSuccessMarker(targetDir: string): void {
    try {
      const nextDir = path.join(targetDir, '.next');
      const markerPath = path.join(nextDir, 'revyme-build-success.json');
      if (fs.existsSync(markerPath)) {
        try { fs.unlinkSync(markerPath); } catch { /* ignore */ }
      }
      if (fs.existsSync(nextDir)) {
        const failedMarker = path.join(nextDir, 'revyme-build-failed.json');
        fs.writeFileSync(
          failedMarker,
          JSON.stringify({
            failed: true,
            failedAt: Date.now(),
          }, null, 2),
          'utf-8'
        );
      }
    } catch {
      // ignore
    }
  }

  checkIsBuilt(safeId: string, targetDir: string): boolean {
    const record = this.servers.get(safeId);
    if (record) {
      if (record.status === 'building' || record.status === 'error' || record.status === 'cancelled') {
        return false;
      }
      if (record.isBuilt) return true;
    }
    const nextDir = path.join(targetDir, '.next');
    if (!fs.existsSync(nextDir)) return false;
    const successMarker = path.join(nextDir, 'revyme-build-success.json');
    if (fs.existsSync(successMarker)) {
      try {
        const marker = JSON.parse(fs.readFileSync(successMarker, 'utf-8'));
        return Boolean(marker.success);
      } catch {
        return false;
      }
    }
    const failedMarker = path.join(nextDir, 'revyme-build-failed.json');
    if (fs.existsSync(failedMarker)) return false;
    const buildIdFile = path.join(nextDir, 'BUILD_ID');
    if (fs.existsSync(buildIdFile)) return true;
    return false;
  }

  private appendLiveLog(record: ProjectServerRecord, chunk: string): void {
    const cleaned = stripAnsi(chunk);
    const lines = cleaned.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (!record.liveLogs) record.liveLogs = [];
    record.liveLogs.push(...lines);
    if (record.liveLogs.length > 200) {
      record.liveLogs.splice(0, record.liveLogs.length - 200);
    }
  }

  private getOrCreateRecord(projectId: string): ProjectServerRecord {
    const safeId = sanitizeId(projectId);
    let record = this.servers.get(safeId);
    if (!record) {
      const buildDir = this.getBuildDir(safeId);
      const isBuilt = this.checkIsBuilt(safeId, buildDir);
      let lastBuiltAt: number | null = null;
      if (isBuilt) {
        try {
          const nextDir = path.join(buildDir, '.next');
          const markerPath = path.join(nextDir, 'revyme-build-success.json');
          if (fs.existsSync(markerPath)) {
            const marker = JSON.parse(fs.readFileSync(markerPath, 'utf-8'));
            lastBuiltAt = marker.builtAt ?? fs.statSync(markerPath).mtimeMs;
          } else {
            lastBuiltAt = fs.statSync(nextDir).mtimeMs;
          }
        } catch {
          lastBuiltAt = null;
        }
      }

      record = {
        status: 'idle',
        port: null,
        url: null,
        isBuilt,
        lastBuiltAt,
        lastError: null,
        pid: null,
        proc: null,
        liveLogs: [],
      };
      this.servers.set(safeId, record);
    }
    return record;
  }

  exportProject(projectId: string, files: Record<string, string>): string {
    const targetDir = this.getBuildDir(projectId);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // Clean up stale files from previous exports that no longer exist in current project files
    const managedPrefixes = ['app', 'components', 'cms', 'i18n', 'messages', 'plugins'];
    const validRelativePaths = new Set(
      Object.keys(files)
        .filter((p) => !isIgnoredFile(p))
        .map((p) => p.replace(/\\/g, '/'))
    );

    for (const prefix of managedPrefixes) {
      const dirPath = path.join(targetDir, prefix);
      if (fs.existsSync(dirPath)) {
        this.cleanStaleFiles(dirPath, targetDir, validRelativePaths);
      }
    }

    // Write all project files, skipping internal metadata paths starting with '_'
    for (const [relativePath, content] of Object.entries(files)) {
      if (isIgnoredFile(relativePath)) {
        continue;
      }
      const fullPath = path.join(targetDir, relativePath);
      const parentDir = path.dirname(fullPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      let fileContent = content;
      if (/\.(tsx|jsx)$/.test(relativePath)) {
        fileContent = fileContent.replace(/(<img\b[^>]*?)(\balt\b)(?!\s*=)([^>]*?>?)/gs, (match) => match.replace(/\balt\b(?!\s*=)/, 'alt=""'));
        fileContent = fileContent.replace(
          /\{item(?:\.|\?\.)([A-Za-z0-9_]+)(?:\.|\?\.)metadata\}/g,
          `{typeof item.$1?.metadata === 'object' ? JSON.stringify(item.$1?.metadata) : (item.$1?.metadata ?? '')}`,
        );
        fileContent = fileContent.replace(
          /\{item(?:\.|\?\.)metadata\}/g,
          `{typeof item?.metadata === 'object' ? JSON.stringify(item?.metadata) : (item?.metadata ?? '')}`,
        );
        fileContent = fileContent.replace(
          /(<(?:p|span|div|h[1-6]|li)\b[^>]*>)\s*\{item(?:\.|\?\.)([A-Za-z0-9_.]+)\}\s*(<\/(?:p|span|div|h[1-6]|li)>)/g,
          (match, openTag, propPath, closeTag) => {
            const primitives = ['title', 'id', 'slug', 'rank', 'date_updated', 'seo_title', 'seo_description', 'deskription', 'alt_text', 'name'];
            if (primitives.includes(propPath)) {
              return `${openTag}{item.${propPath}}${closeTag}`;
            }
            const safePath = 'item?.' + propPath.replace(/\./g, '?.');
            return `${openTag}{typeof ${safePath} === 'object' && ${safePath} !== null ? (${safePath}?.name || ${safePath}?.title || (Array.isArray(${safePath}) ? ${safePath}.map((c: any) => typeof c === 'object' ? (c?.name || c?.title || c?.id || '') : c).filter(Boolean).join(', ') : JSON.stringify(${safePath}))) : (${safePath} ?? '')}${closeTag}`;
          },
        );
      }
      fs.writeFileSync(fullPath, fileContent, 'utf-8');
    }

    // Scaffold defaults if missing
    const nextConfigMjsPath = path.join(targetDir, 'next.config.mjs');
    const nextConfigJsPath = path.join(targetDir, 'next.config.js');
    if (!fs.existsSync(nextConfigMjsPath) && !fs.existsSync(nextConfigJsPath)) {
      fs.writeFileSync(nextConfigMjsPath, DEFAULT_NEXT_CONFIG, 'utf-8');
    }

    const tsconfigPath = path.join(targetDir, 'tsconfig.json');
    if (!fs.existsSync(tsconfigPath)) {
      fs.writeFileSync(tsconfigPath, DEFAULT_TSCONFIG, 'utf-8');
    }

    const packageJsonPath = path.join(targetDir, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      fs.writeFileSync(packageJsonPath, DEFAULT_PACKAGE_JSON, 'utf-8');
    } else if (!files['package.json']) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        if (pkg.name === 'revyme-live-site' && pkg.scripts && pkg.scripts.build) {
          if (!pkg.scripts['optimize-images'] || !pkg.scripts['prebuild']) {
            pkg.scripts['optimize-images'] = 'node scripts/optimize-images.mjs';
            pkg.scripts['prebuild'] = 'npm run optimize-images';
            fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
          }
        }
      } catch {
        fs.writeFileSync(packageJsonPath, DEFAULT_PACKAGE_JSON, 'utf-8');
      }
    }

    const optimizeScriptPath = path.join(targetDir, 'scripts', 'optimize-images.mjs');
    const scriptDir = path.dirname(optimizeScriptPath);
    if (!fs.existsSync(scriptDir)) fs.mkdirSync(scriptDir, { recursive: true });
    fs.writeFileSync(optimizeScriptPath, OPTIMIZE_IMAGES_SCRIPT, 'utf-8');

    const imageUtilsPath = path.join(targetDir, 'lib', 'image-utils.ts');
    const libDir = path.dirname(imageUtilsPath);
    if (!fs.existsSync(libDir)) fs.mkdirSync(libDir, { recursive: true });
    fs.writeFileSync(imageUtilsPath, IMAGE_UTILS_TS, 'utf-8');

    // Ensure uploads are copied into public/api/uploads and public/uploads synchronously (without triggering background image optimization)
    this.syncUploadFiles(targetDir, projectId, files);
    this.syncPublicAssets(targetDir);

    return targetDir;
  }

  private cleanStaleFiles(currentDir: string, targetDir: string, validRelativePaths: Set<string>): void {
    if (!fs.existsSync(currentDir)) return;
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        this.cleanStaleFiles(fullPath, targetDir, validRelativePaths);
        try {
          if (fs.existsSync(fullPath) && fs.readdirSync(fullPath).length === 0) {
            fs.rmdirSync(fullPath);
          }
        } catch {
          // ignore
        }
      } else if (entry.isFile()) {
        const rel = path.relative(targetDir, fullPath).replace(/\\/g, '/');
        if (!validRelativePaths.has(rel)) {
          try {
            fs.unlinkSync(fullPath);
          } catch {
            // ignore
          }
        }
      }
    }
  }

  syncUploadFiles(targetDir: string, projectId?: string, files?: Record<string, string>): void {
    const uploadsDir = getDataDirs().uploadsDir;
    if (!uploadsDir || !fs.existsSync(uploadsDir)) return;

    const safeProjectId = projectId ? sanitizeId(projectId) : '';
    let resolvedFiles = files;
    if (!resolvedFiles && safeProjectId) {
      try {
        const stored = getProject(safeProjectId);
        resolvedFiles = stored?.data?.files;
      } catch {
        // ignore
      }
    }

    const allEntries = fs.readdirSync(uploadsDir, { withFileTypes: true });
    const allFiles = allEntries.filter((e) => e.isFile()).map((e) => e.name);

    let allowedUploads: Set<string>;
    const allowedBaseNames = new Set<string>();

    if (!safeProjectId) {
      allowedUploads = new Set(allFiles);
    } else {
      allowedUploads = new Set<string>();
      const referenced = resolvedFiles ? extractReferencedUploads(resolvedFiles, allFiles) : new Set<string>();
      let meta: Record<string, any> = {};
      try {
        meta = readUploadsMeta();
      } catch {
        meta = {};
      }

      for (const file of allFiles) {
        // Thumbnail handling: only include thumbnails belonging to this project
        if (file.startsWith('thumbnail-')) {
          if (file.startsWith(`thumbnail-${safeProjectId}.`)) {
            allowedUploads.add(file);
          }
          continue;
        }

        // If explicitly referenced in project code/content/CMS:
        if (referenced.has(file)) {
          allowedUploads.add(file);
          continue;
        }

        const fileMeta = meta[file];
        // If tagged for an explicit DIFFERENT project and not referenced, skip it
        if (fileMeta?.projectId && fileMeta.projectId !== safeProjectId && fileMeta.projectId !== 'local') {
          continue;
        }

        allowedUploads.add(file);
      }
    }

    for (const filename of allowedUploads) {
      const ext = path.extname(filename);
      allowedBaseNames.add(ext ? path.basename(filename, ext) : filename);
    }

    const publicDir = path.join(targetDir, 'public');
    const publicApiDir = path.join(publicDir, 'api');
    if (!fs.existsSync(publicApiDir)) {
      fs.mkdirSync(publicApiDir, { recursive: true });
    }

    const targets = [
      path.join(publicApiDir, 'uploads'),
      path.join(publicDir, 'uploads'),
    ];

    const responsiveVariantRe = /^(.+)-(\d+)w\.webp$/;

    for (const targetPath of targets) {
      try {
        let isSymlink = false;
        try {
          isSymlink = fs.lstatSync(targetPath).isSymbolicLink();
        } catch {
          isSymlink = false;
        }

        // Replace any symlinks with real directories containing copied files
        // so that exported production builds and Docker containers are 100% standalone
        // and do not depend on host machine paths or broken symlinks.
        if (isSymlink) {
          try {
            fs.unlinkSync(targetPath);
          } catch {
            // ignore
          }
        }

        if (!fs.existsSync(targetPath)) {
          fs.mkdirSync(targetPath, { recursive: true });
        }

        // 1. Clean stale/foreign files that do not belong to this project
        if (safeProjectId) {
          const existing = fs.readdirSync(targetPath, { withFileTypes: true });
          for (const item of existing) {
            if (!item.isFile()) continue;
            if (allowedUploads.has(item.name)) continue;

            // Check if it's a responsive variant of an allowed file
            const variantMatch = item.name.match(responsiveVariantRe);
            if (variantMatch && allowedBaseNames.has(variantMatch[1])) {
              continue;
            }

            try {
              fs.unlinkSync(path.join(targetPath, item.name));
            } catch {
              // ignore
            }
          }
        }

        // 2. Copy allowed files into targetPath
        for (const file of allowedUploads) {
          const srcFile = path.join(uploadsDir, file);
          const destFile = path.join(targetPath, file);
          try {
            if (!fs.existsSync(destFile) || fs.statSync(srcFile).mtimeMs > fs.statSync(destFile).mtimeMs) {
              fs.copyFileSync(srcFile, destFile);
              try {
                const stat = fs.statSync(srcFile);
                fs.utimesSync(destFile, stat.atime, stat.mtime);
              } catch {
                // ignore
              }
            }
          } catch {
            // ignore
          }
        }
      } catch {
        // ignore errors
      }
    }
  }

  async syncUploads(
    targetDir: string,
    onProgress?: (progress: { processed: number; total: number; filename: string }) => void,
    signal?: AbortSignal,
    projectId?: string,
    files?: Record<string, string>
  ): Promise<void> {
    const resolvedProjectId = projectId || path.basename(targetDir);
    this.syncUploadFiles(targetDir, resolvedProjectId, files);

    const publicDir = path.join(targetDir, 'public');
    const publicApiDir = path.join(publicDir, 'api');

    // Run image optimization on public/uploads, then sync generated variants to public/api/uploads
    // without performing redundant Sharp re-encoding.
    try {
      const pubUploads = path.join(publicDir, 'uploads');
      const pubApiUploads = path.join(publicApiDir, 'uploads');
      await this.optimizeImages(pubUploads, onProgress, signal);
      if (fs.existsSync(pubUploads) && fs.existsSync(pubApiUploads)) {
        this.copyDirFiles(pubUploads, pubApiUploads);
      }
    } catch {
      // ignore
    }
  }

  async optimizeImages(
    uploadsTarget: string,
    onProgress?: (progress: { processed: number; total: number; filename: string }) => void,
    signal?: AbortSignal
  ): Promise<void> {
    if (!fs.existsSync(uploadsTarget) || signal?.aborted) return;

    const widths = [320, 640, 768, 1024, 1280, 1920];
    const imageExts = new Set(['.jpg', '.jpeg', '.png', '.webp']);
    const responsiveVariantRe = /-\d+w\.webp$/;

    try {
      const entries = fs.readdirSync(uploadsTarget, { withFileTypes: true });
      const originalFiles = entries.filter(
        (e) => e.isFile() && imageExts.has(path.extname(e.name).toLowerCase()) && !responsiveVariantRe.test(e.name) && !e.name.startsWith('thumbnail-')
      );
      const totalVariants = originalFiles.length * widths.length;
      let processedVariants = 0;

      for (const entry of originalFiles) {
        if (signal?.aborted) return;
        const ext = path.extname(entry.name).toLowerCase();
        const baseName = entry.name.slice(0, -ext.length);
        const filePath = path.join(uploadsTarget, entry.name);

        let fileStat: fs.Stats;
        try {
          fileStat = fs.statSync(filePath);
        } catch {
          processedVariants += widths.length;
          onProgress?.({ processed: processedVariants, total: totalVariants, filename: entry.name });
          continue;
        }

        const pendingWidths: number[] = [];
        for (const w of widths) {
          const outName = `${baseName}-${w}w.webp`;
          const outPath = path.join(uploadsTarget, outName);

          try {
            if (fs.existsSync(outPath)) {
              const outStat = fs.statSync(outPath);
              if (outStat.mtimeMs >= fileStat.mtimeMs) {
                processedVariants++;
                onProgress?.({ processed: processedVariants, total: totalVariants, filename: entry.name });
                continue;
              }
            }
          } catch {
            // ignore
          }

          pendingWidths.push(w);
        }

        if (pendingWidths.length > 0) {
          await Promise.all(
            pendingWidths.map(async (w) => {
              if (signal?.aborted) return;
              const outName = `${baseName}-${w}w.webp`;
              const outPath = path.join(uploadsTarget, outName);

              try {
                await sharp(filePath, { failOnError: false })
                  .rotate()
                  .resize(w, null, { withoutEnlargement: true })
                  .webp({ quality: 82 })
                  .toFile(outPath);
              } catch {
                // Gracefully ignore individual image resize failures (e.g. invalid image files)
              }
              processedVariants++;
              onProgress?.({ processed: processedVariants, total: totalVariants, filename: entry.name });
            })
          );
        }
      }
    } catch {
      // Gracefully ignore directory read errors
    }
  }

  syncPublicAssets(targetDir: string): void {
    if (!this.publicDir || !fs.existsSync(this.publicDir)) return;

    const targetPublicDir = path.join(targetDir, 'public');
    if (!fs.existsSync(targetPublicDir)) {
      fs.mkdirSync(targetPublicDir, { recursive: true });
    }

    try {
      const entries = fs.readdirSync(this.publicDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === 'api' || entry.name === 'uploads') continue;
        const srcPath = path.join(this.publicDir, entry.name);
        const destPath = path.join(targetPublicDir, entry.name);
        if (entry.isDirectory()) {
          this.copyDirRecursive(srcPath, destPath);
        } else if (entry.isFile()) {
          try {
            if (!fs.existsSync(destPath) || fs.statSync(srcPath).mtimeMs > fs.statSync(destPath).mtimeMs) {
              fs.copyFileSync(srcPath, destPath);
            }
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // ignore
    }
  }

  private copyDirRecursive(srcDir: string, destDir: string): void {
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    try {
      const entries = fs.readdirSync(srcDir, { withFileTypes: true });
      for (const entry of entries) {
        const srcPath = path.join(srcDir, entry.name);
        const destPath = path.join(destDir, entry.name);
        if (entry.isDirectory()) {
          this.copyDirRecursive(srcPath, destPath);
        } else if (entry.isFile()) {
          try {
            if (!fs.existsSync(destPath) || fs.statSync(srcPath).mtimeMs > fs.statSync(destPath).mtimeMs) {
              fs.copyFileSync(srcPath, destPath);
            }
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // ignore
    }
  }

  private copyDirFiles(srcDir: string, destDir: string): void {
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    const entries = fs.readdirSync(srcDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile()) {
        const srcFile = path.join(srcDir, entry.name);
        const destFile = path.join(destDir, entry.name);
        try {
          if (!fs.existsSync(destFile) || fs.statSync(srcFile).mtimeMs > fs.statSync(destFile).mtimeMs) {
            fs.copyFileSync(srcFile, destFile);
            try {
              const stat = fs.statSync(srcFile);
              fs.utimesSync(destFile, stat.atime, stat.mtime);
            } catch {
              // ignore
            }
          }
        } catch {
          // ignore individual copy errors
        }
      }
    }
  }

  async build(
    projectId: string,
    files?: Record<string, string>,
    branchId?: string
  ): Promise<{ success: boolean; log: string }> {
    const safeId = sanitizeId(projectId);
    const record = this.getOrCreateRecord(safeId);

    if (record.status === 'building' || this.activeBuildProcesses.has(safeId)) {
      throw new Error(`Build already in progress for project: ${projectId}`);
    }

    const buildId = `build_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const startedAt = Date.now();
    record.buildId = buildId;
    record.buildStartedAt = startedAt;
    record.buildFinishedAt = null;
    record.status = 'building';
    record.lastError = null;
    record.isBuilt = false;
    record.liveLogs = [];
    record.buildProgress = { stage: 'exporting', label: 'Exporting project files...', percent: 5, buildId, startedAt };

    const abortController = new AbortController();
    this.activeBuildControllers.set(safeId, abortController);

    const targetDir = this.getBuildDir(safeId);
    this.clearSuccessMarker(targetDir);

    try {
      let targetFiles = files;
      if (files) {
        this.exportProject(safeId, files);
      } else {
        const stored = getProject(safeId);
        if (!stored) {
          const errLog = `Project not found: ${projectId}`;
          const finishedAt = Date.now();
          record.buildFinishedAt = finishedAt;
          record.status = 'error';
          record.lastError = errLog;
          record.buildProgress = { stage: 'error', label: errLog, percent: 0, buildId, startedAt, finishedAt };
          return { success: false, log: errLog };
        }
        let exportFiles = stored.data?.files || {};
        if (branchId && stored.data?.branches?.[branchId]?.files) {
          exportFiles = stored.data.branches[branchId].files;
        }
        targetFiles = exportFiles;
        this.exportProject(safeId, exportFiles);
      }

      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      if (abortController.signal.aborted) {
        const finishedAt = Date.now();
        record.buildFinishedAt = finishedAt;
        record.status = 'cancelled';
        record.buildProgress = { stage: 'cancelled', label: 'Build cancelled', percent: 0, buildId, startedAt, finishedAt };
        return { success: false, log: 'Build cancelled' };
      }

      // Preparing assets stage
      record.buildProgress = {
        stage: 'preparing-assets',
        label: 'Preparing and optimizing assets...',
        percent: 10,
        buildId,
        startedAt,
      };

      await this.syncUploads(
        targetDir,
        ({ processed, total, filename }) => {
          if (abortController.signal.aborted) return;
          const pct = total > 0 ? Math.min(18, Math.round(10 + (processed / total) * 8)) : 10;
          record.buildProgress = {
            stage: 'preparing-assets',
            label: `Optimizing assets (${processed}/${total}) ${filename}...`,
            percent: pct,
            buildId,
            startedAt,
          };
        },
        abortController.signal,
        safeId,
        targetFiles
      );

      this.syncPublicAssets(targetDir);

      if (abortController.signal.aborted) {
        const finishedAt = Date.now();
        record.buildFinishedAt = finishedAt;
        record.status = 'cancelled';
        record.buildProgress = { stage: 'cancelled', label: 'Build cancelled', percent: 0, buildId, startedAt, finishedAt };
        return { success: false, log: 'Build cancelled' };
      }

      // Clean stale .next build cache directory before compiling so Next.js does a 100% fresh build
      const nextBuildDir = path.join(targetDir, '.next');
      if (fs.existsSync(nextBuildDir)) {
        try {
          fs.rmSync(nextBuildDir, { recursive: true, force: true });
        } catch {
          // ignore if locked
        }
      }

      const nextBin = resolveNextBin();

      const buildResult = await new Promise<{ success: boolean; log: string }>((resolve) => {
        let output = '';
        const MAX_LAST_ERROR_CHARS = 8000;

        const child = this.spawnFn(process.execPath, [nextBin, 'build'], {
          cwd: targetDir,
          env: cleanProcessEnv({
            NODE_ENV: 'production',
          }),
        });

        this.activeBuildProcesses.set(safeId, child);

        child.stdout?.on('data', (data) => {
          const text = data.toString();
          output += text;
          this.appendLiveLog(record, text);
          record.buildProgress = parseBuildProgress(output, record.buildProgress);
        });

        child.stderr?.on('data', (data) => {
          const text = data.toString();
          output += text;
          this.appendLiveLog(record, text);
          const cleaned = stripAnsi(text).trim();
          if (cleaned) {
            const lines = cleaned.split('\n').map((l) => l.trim()).filter(Boolean);
            const isOnlyWarning = lines.length > 0 && lines.every((l) =>
              l.startsWith('⚠') || l.toLowerCase().startsWith('warn') || l.toLowerCase().startsWith('info')
            );
            if (!isOnlyWarning) {
              const combined = record.lastError ? `${record.lastError}\n${cleaned}` : cleaned;
              record.lastError = combined.length > MAX_LAST_ERROR_CHARS
                ? '...' + combined.slice(combined.length - MAX_LAST_ERROR_CHARS)
                : combined;
            }
          }
        });

        child.on('error', (err) => {
          this.activeBuildProcesses.delete(safeId);
          output += `\n${err.message}`;
          const cleaned = stripAnsi(output);
          const finishedAt = Date.now();
          record.buildFinishedAt = finishedAt;
          record.status = 'error';
          record.lastError = cleaned.length > MAX_LAST_ERROR_CHARS
            ? '...' + cleaned.slice(cleaned.length - MAX_LAST_ERROR_CHARS)
            : cleaned;
          record.isBuilt = false;
          record.buildProgress = { stage: 'error', label: record.lastError, percent: record.buildProgress?.percent ?? 0, buildId, startedAt, finishedAt };
          this.clearSuccessMarker(targetDir);
          resolve({ success: false, log: cleaned });
        });

        child.on('close', (code, signal) => {
          this.activeBuildProcesses.delete(safeId);
          const cleaned = stripAnsi(output);
          const finishedAt = Date.now();
          record.buildFinishedAt = finishedAt;

          if (record.status === 'cancelled' || signal === 'SIGTERM') {
            record.status = 'cancelled';
            record.isBuilt = false;
            record.buildProgress = { stage: 'cancelled', label: 'Build cancelled', percent: 0, buildId, startedAt, finishedAt };
            this.clearSuccessMarker(targetDir);
            resolve({ success: false, log: 'Build cancelled' });
            return;
          }

          if (code === 0) {
            record.isBuilt = true;
            record.lastBuiltAt = Date.now();
            record.status = record.proc ? 'running' : 'idle';
            record.lastError = null;
            record.buildProgress = { stage: 'done', label: 'Build completed successfully', percent: 100, buildId, startedAt, finishedAt };
            this.writeSuccessMarker(targetDir, buildId);
            resolve({ success: true, log: cleaned });
          } else {
            record.status = 'error';
            record.isBuilt = false;
            const rawError = cleaned || record.lastError || `Build failed with exit code ${code}`;
            record.lastError = rawError.length > MAX_LAST_ERROR_CHARS
              ? '...' + rawError.slice(rawError.length - MAX_LAST_ERROR_CHARS)
              : rawError;
            record.buildProgress = {
              stage: 'error',
              label: record.lastError,
              percent: record.buildProgress?.percent ?? 0,
              buildId,
              startedAt,
              finishedAt,
            };
            this.clearSuccessMarker(targetDir);
            resolve({ success: false, log: record.lastError });
          }
        });
      });

      return buildResult;
    } catch (err: any) {
      const finishedAt = Date.now();
      record.buildFinishedAt = finishedAt;
      record.status = 'error';
      record.isBuilt = false;
      const errText = err?.message || String(err);
      record.lastError = errText.length > 8000 ? '...' + errText.slice(errText.length - 8000) : errText;
      record.buildProgress = {
        stage: 'error',
        label: record.lastError,
        percent: record.buildProgress?.percent ?? 0,
        buildId,
        startedAt,
        finishedAt,
      };
      this.clearSuccessMarker(targetDir);
      throw err;
    } finally {
      this.activeBuildProcesses.delete(safeId);
      this.activeBuildControllers.delete(safeId);
    }
  }

  async cancelBuild(projectId: string): Promise<LocalServerStatus> {
    const safeId = sanitizeId(projectId);
    const record = this.servers.get(safeId);
    if (!record || record.status !== 'building') {
      return this.getStatus(safeId);
    }

    record.isStopping = true;
    try {
      if (this.activeBuildControllers.has(safeId)) {
        const controller = this.activeBuildControllers.get(safeId);
        controller?.abort();
        this.activeBuildControllers.delete(safeId);
      }

      if (this.activeBuildProcesses.has(safeId)) {
        const child = this.activeBuildProcesses.get(safeId);
        if (child) {
          await killProcessTree(child, child.pid, this.execFn);
        }
        this.activeBuildProcesses.delete(safeId);
      }

      const finishedAt = Date.now();
      record.buildFinishedAt = finishedAt;
      record.status = 'cancelled';
      record.isBuilt = false;
      record.lastError = 'Build cancelled by user';
      record.buildProgress = {
        stage: 'cancelled',
        label: 'Build cancelled',
        percent: 0,
        buildId: record.buildId || undefined,
        startedAt: record.buildStartedAt || undefined,
        finishedAt,
      };

      const targetDir = this.getBuildDir(safeId);
      this.clearSuccessMarker(targetDir);
    } finally {
      record.isStopping = false;
    }

    return this.getStatus(safeId);
  }

  async start(projectId: string, port = 3000): Promise<LocalServerStatus> {
    const safeId = sanitizeId(projectId);
    const record = this.getOrCreateRecord(safeId);

    // Protected ports check
    if (PROTECTED_PORTS.has(port)) {
      const err = `Port ${port} is reserved for builder/editor services. Please select a different port.`;
      record.status = 'error';
      record.lastError = err;
      return this.getStatus(safeId);
    }

    // If already running on this project and same port, return current status
    if (record.status === 'running' && record.proc && !record.proc.killed && record.port === port) {
      return this.getStatus(safeId);
    }

    // If already running with a process, kill it first
    if (record.proc) {
      const oldChild = record.proc;
      const oldPid = record.pid;
      record.proc = null;
      record.pid = null;
      await killProcessTree(oldChild, oldPid, this.execFn);
    }

    // Force free target port before starting to prevent EADDRINUSE
    await killProcessOnPort(port, this.execFn);
    if (process.env.NODE_ENV !== 'test') {
      await new Promise((r) => setTimeout(r, 200));
    }

    const targetDir = this.getBuildDir(safeId);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // Ensure uploads are synced before starting
    let startFiles: Record<string, string> | undefined;
    try {
      const stored = getProject(safeId);
      startFiles = stored?.data?.files;
    } catch {
      // ignore
    }
    await this.syncUploads(targetDir, undefined, undefined, safeId, startFiles);

    const nextBin = resolveNextBin();

    record.lastError = null;
    record.isStopping = false;
    record.port = port;

    return new Promise<LocalServerStatus>((resolve) => {
      let settled = false;
      let startupLog = '';
      let runtimeErrorLog = '';

      const child = this.spawnFn(process.execPath, [nextBin, 'start', '-p', String(port)], {
        cwd: targetDir,
        env: cleanProcessEnv({
          NODE_ENV: 'production',
          PORT: String(port),
        }),
      });

      record.proc = child;
      record.pid = child.pid ?? null;
      record.port = port;
      record.url = `http://localhost:${port}`;

      const finishReady = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeoutTimer);
          record.status = 'running';
          record.lastError = null;
          resolve(this.getStatus(safeId));
        }
      };

      const finishError = (errorMsg: string) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeoutTimer);
          record.status = 'error';
          record.proc = null;
          record.pid = null;
          record.port = port;
          record.url = null;
          record.lastError = stripAnsi(errorMsg.trim());
          resolve(this.getStatus(safeId));
        }
      };

      // Startup timeout safeguard
      const timeoutTimer = setTimeout(() => {
        if (!settled) {
          if (child && !child.killed) {
            finishReady();
          } else {
            finishError('Server start timed out');
          }
        }
      }, this.startupTimeoutMs);

      const readyPattern = /(?:^|\s)ready(\s+in|\s+on|\b)|\blocal:\s*https?:\/\/|\bstarted server on|\blistening on\b/i;

      child.stdout?.on('data', (data) => {
        const text = data.toString();
        if (!settled) {
          startupLog += text;
        }
        if (readyPattern.test(text)) {
          finishReady();
        }
      });

      child.stderr?.on('data', (data) => {
        const text = data.toString();
        if (!settled) {
          startupLog += text;
        } else {
          runtimeErrorLog += text;
        }
      });

      child.on('error', (err) => {
        if (!settled) {
          finishError(err.message);
        } else if (!record.isStopping && record.proc === child) {
          record.status = 'error';
          record.lastError = stripAnsi(err.message);
        }
      });

      child.on('exit', (code, signal) => {
        if (!settled) {
          finishError(startupLog || `Process exited with code ${code}`);
        } else if (record.proc === child) {
          // Process exited while running
          record.proc = null;
          record.pid = null;
          record.port = null;
          record.url = null;
          if (record.isStopping || code === 0 || signal === 'SIGTERM' || signal === 'SIGKILL') {
            record.status = 'idle';
            record.lastError = null;
          } else {
            record.status = 'error';
            record.lastError = stripAnsi(runtimeErrorLog.trim()) || `Process exited unexpectedly with code ${code}`;
          }
        }
      });
    });
  }

  async stop(projectId: string, port?: number): Promise<LocalServerStatus> {
    const safeId = sanitizeId(projectId);
    const record = this.servers.get(safeId);
    const targetPort = port ?? record?.port ?? null;

    if (record && record.proc) {
      record.isStopping = true;
      const child = record.proc;
      const pid = record.pid;
      record.proc = null;
      record.pid = null;
      record.port = null;
      record.url = null;
      record.status = 'idle';
      record.lastError = null;
      record.buildProgress = null;
      try {
        await killProcessTree(child, pid, this.execFn);
      } finally {
        record.isStopping = false;
      }
    } else if (record) {
      record.status = 'idle';
      record.lastError = null;
      record.buildProgress = null;
      record.proc = null;
      record.pid = null;
      record.port = null;
      record.url = null;
    }

    if (targetPort && !PROTECTED_PORTS.has(targetPort)) {
      await killProcessOnPort(targetPort, this.execFn);
    }

    return this.getStatus(safeId);
  }

  getStatus(projectId: string): LocalServerStatus {
    const safeId = sanitizeId(projectId);
    const targetDir = this.getBuildDir(safeId);
    const isBuilt = this.checkIsBuilt(safeId, targetDir);

    const record = this.servers.get(safeId);

    let lastBuiltAt = record?.lastBuiltAt ?? null;
    if (!lastBuiltAt && isBuilt) {
      try {
        const nextDir = path.join(targetDir, '.next');
        const markerPath = path.join(nextDir, 'revyme-build-success.json');
        if (fs.existsSync(markerPath)) {
          const marker = JSON.parse(fs.readFileSync(markerPath, 'utf-8'));
          lastBuiltAt = marker.builtAt ?? fs.statSync(markerPath).mtimeMs;
        } else {
          lastBuiltAt = fs.statSync(nextDir).mtimeMs;
        }
      } catch {
        lastBuiltAt = null;
      }
    }

    if (record) {
      record.isBuilt = isBuilt;
      if (!record.lastBuiltAt && lastBuiltAt) {
        record.lastBuiltAt = lastBuiltAt;
      }
    }

    const statusObj: LocalServerStatus = {
      status: record?.status ?? 'idle',
      port: record?.port ?? null,
      url: record?.url ?? null,
      isBuilt,
      lastBuiltAt,
      lastError: record?.lastError ?? null,
      pid: record?.pid ?? null,
      buildProgress: record?.buildProgress ?? null,
    };

    if (record?.buildId) {
      statusObj.buildId = record.buildId;
    }
    if (record?.buildStartedAt) {
      statusObj.startedAt = record.buildStartedAt;
    }
    if (record?.buildFinishedAt) {
      statusObj.finishedAt = record.buildFinishedAt;
    }
    if (record?.buildProgress) {
      statusObj.buildStatus = record.buildProgress;
    }
    if (record?.liveLogs && record.liveLogs.length > 0) {
      statusObj.liveLogs = [...record.liveLogs];
    }

    return statusObj;
  }

  dispose(): void {
    for (const [safeId, buildProc] of this.activeBuildProcesses.entries()) {
      killProcessTreeSync(buildProc, buildProc.pid, this.execSyncFn);
    }
    this.activeBuildProcesses.clear();
    for (const controller of this.activeBuildControllers.values()) {
      controller.abort();
    }
    this.activeBuildControllers.clear();

    for (const record of this.servers.values()) {
      if (record.proc) {
        killProcessTreeSync(record.proc, record.pid, this.execSyncFn);
        record.proc = null;
        record.pid = null;
      }
      if (record.port && !PROTECTED_PORTS.has(record.port)) {
        killProcessOnPortSync(record.port, this.execSyncFn);
        record.port = null;
      }
      record.url = null;
      record.status = 'idle';
      record.lastError = null;
      record.buildProgress = null;
    }
    this.servers.clear();
  }
}

export const localServerManager = new LocalServerManager();

