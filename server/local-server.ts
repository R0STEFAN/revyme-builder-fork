import fs from 'node:fs';
import path from 'node:path';
import { spawn, exec, execSync, type ChildProcess } from 'node:child_process';
import { getDataDirs, getProject } from './storage';

export type LocalServerState = 'idle' | 'building' | 'running' | 'error';

export interface LocalServerStatus {
  status: LocalServerState;
  port: number | null;
  url: string | null;
  isBuilt: boolean;
  lastBuiltAt: number | null;
  lastError: string | null;
  pid: number | null;
}

export interface LocalServerOptions {
  spawn?: typeof spawn;
  exec?: typeof exec;
  execSync?: typeof execSync;
  startupTimeoutMs?: number;
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
    "start": "next start"
  }
}
`;

export class LocalServerManager {
  private readonly buildsDir: string;
  private readonly servers = new Map<string, ProjectServerRecord>();
  private readonly spawnFn: typeof spawn;
  private readonly execFn: typeof exec;
  private readonly execSyncFn: typeof execSync;
  private readonly startupTimeoutMs: number;

  constructor(buildsDir?: string, options?: LocalServerOptions) {
    this.buildsDir = buildsDir || path.join(getDataDirs().root, 'builds');
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

  private getOrCreateRecord(projectId: string): ProjectServerRecord {
    const safeId = sanitizeId(projectId);
    let record = this.servers.get(safeId);
    if (!record) {
      const buildDir = this.getBuildDir(safeId);
      const nextDir = path.join(buildDir, '.next');
      const isBuilt = fs.existsSync(nextDir);
      let lastBuiltAt: number | null = null;
      if (isBuilt) {
        try {
          lastBuiltAt = fs.statSync(nextDir).mtimeMs;
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
      fs.writeFileSync(fullPath, content, 'utf-8');
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
    }

    // Ensure uploads are synced/linked into public/api/uploads and public/uploads
    this.syncUploads(targetDir);

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

  syncUploads(targetDir: string): void {
    const uploadsDir = getDataDirs().uploadsDir;
    if (!uploadsDir || !fs.existsSync(uploadsDir)) return;

    const publicDir = path.join(targetDir, 'public');
    const publicApiDir = path.join(publicDir, 'api');
    if (!fs.existsSync(publicApiDir)) {
      fs.mkdirSync(publicApiDir, { recursive: true });
    }

    const targets = [
      path.join(publicApiDir, 'uploads'),
      path.join(publicDir, 'uploads'),
    ];

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

        this.copyDirFiles(uploadsDir, targetPath);
      } catch {
        // ignore errors
      }
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

    if (files) {
      this.exportProject(safeId, files);
    } else {
      const stored = getProject(safeId);
      if (!stored) {
        const errLog = `Project not found: ${projectId}`;
        record.status = 'error';
        record.lastError = errLog;
        return { success: false, log: errLog };
      }
      let exportFiles = stored.data?.files || {};
      if (branchId && stored.data?.branches?.[branchId]?.files) {
        exportFiles = stored.data.branches[branchId].files;
      }
      this.exportProject(safeId, exportFiles);
    }

    const targetDir = this.getBuildDir(safeId);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    record.status = 'building';
    record.lastError = null;

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

    return new Promise<{ success: boolean; log: string }>((resolve) => {
      let output = '';

      const child = this.spawnFn(process.execPath, [nextBin, 'build'], {
        cwd: targetDir,
        env: cleanProcessEnv({
          NODE_ENV: 'production',
        }),
      });

      child.stdout?.on('data', (data) => {
        output += data.toString();
      });

      child.stderr?.on('data', (data) => {
        output += data.toString();
      });

      child.on('error', (err) => {
        output += `\n${err.message}`;
        const cleaned = stripAnsi(output);
        record.status = 'error';
        record.lastError = cleaned;
        resolve({ success: false, log: cleaned });
      });

      child.on('close', (code) => {
        const cleaned = stripAnsi(output);
        if (code === 0) {
          record.isBuilt = true;
          record.lastBuiltAt = Date.now();
          record.status = record.proc ? 'running' : 'idle';
          record.lastError = null;
          resolve({ success: true, log: cleaned });
        } else {
          record.status = 'error';
          record.lastError = cleaned || `Build failed with exit code ${code}`;
          resolve({ success: false, log: record.lastError });
        }
      });
    });
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
    this.syncUploads(targetDir);

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
      try {
        await killProcessTree(child, pid, this.execFn);
      } finally {
        record.isStopping = false;
      }
    } else if (record) {
      record.status = 'idle';
      record.lastError = null;
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
    const nextDir = path.join(targetDir, '.next');
    const diskBuilt = fs.existsSync(nextDir);

    const record = this.servers.get(safeId);
    const isBuilt = Boolean(record?.isBuilt || diskBuilt);

    let lastBuiltAt = record?.lastBuiltAt ?? null;
    if (!lastBuiltAt && diskBuilt) {
      try {
        lastBuiltAt = fs.statSync(nextDir).mtimeMs;
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

    return {
      status: record?.status ?? 'idle',
      port: record?.port ?? null,
      url: record?.url ?? null,
      isBuilt,
      lastBuiltAt,
      lastError: record?.lastError ?? null,
      pid: record?.pid ?? null,
    };
  }

  dispose(): void {
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
    }
    this.servers.clear();
  }
}

export const localServerManager = new LocalServerManager();

