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

    return targetDir;
  }

  async build(projectId: string, files?: Record<string, string>): Promise<{ success: boolean; log: string }> {
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
      this.exportProject(safeId, stored.data?.files || {});
    }

    const targetDir = this.getBuildDir(safeId);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    record.status = 'building';
    record.lastError = null;

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

    // If already running on this project, return current status
    if (record.status === 'running' && record.proc && !record.proc.killed) {
      return this.getStatus(safeId);
    }

    const targetDir = this.getBuildDir(safeId);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const nextBin = resolveNextBin();

    return new Promise<LocalServerStatus>((resolve) => {
      let settled = false;
      let startupLog = '';

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
          record.port = null;
          record.url = null;
          record.lastError = errorMsg;
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
        startupLog += text;
        if (readyPattern.test(text)) {
          finishReady();
        }
      });

      child.stderr?.on('data', (data) => {
        startupLog += data.toString();
      });

      child.on('error', (err) => {
        finishError(err.message);
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
          if (code === 0 || signal === 'SIGTERM' || signal === 'SIGKILL') {
            record.status = 'idle';
          } else {
            record.status = 'error';
            record.lastError = startupLog || `Process exited unexpectedly with code ${code}`;
          }
        }
      });
    });
  }

  async stop(projectId: string): Promise<LocalServerStatus> {
    const safeId = sanitizeId(projectId);
    const record = this.servers.get(safeId);

    if (record && record.proc) {
      await killProcessTree(record.proc, record.pid, this.execFn);
      record.proc = null;
      record.pid = null;
      record.port = null;
      record.url = null;
      record.status = 'idle';
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
        record.port = null;
        record.url = null;
        record.status = 'idle';
      }
    }
    this.servers.clear();
  }
}

export const localServerManager = new LocalServerManager();

