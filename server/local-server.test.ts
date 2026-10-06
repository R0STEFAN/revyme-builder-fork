import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { LocalServerManager, sanitizeId } from './local-server';
import { saveProject } from './storage';

const TEST_DIR = path.resolve(process.cwd(), '.test-local-server');
const TEST_BUILDS_DIR = path.join(TEST_DIR, 'builds');
const TEST_STORAGE_DIR = path.join(TEST_DIR, 'storage');

interface MockChildProcess extends EventEmitter {
  pid: number;
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
  killed?: boolean;
}

function createMockChild(pid = 12345): MockChildProcess {
  const child = new EventEmitter() as MockChildProcess;
  child.pid = pid;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn((signal?: string) => {
    child.killed = true;
    child.emit('exit', 0, signal || 'SIGTERM');
    child.emit('close', 0);
    return true;
  });
  return child;
}

describe('LocalServerManager', () => {
  let manager: LocalServerManager;
  let mockSpawn: ReturnType<typeof vi.fn>;
  let mockExec: ReturnType<typeof vi.fn>;
  let mockExecSync: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSpawn = vi.fn();
    mockExec = vi.fn((cmd: string, cb: any) => {
      cb?.(null, '', '');
      return {} as any;
    });
    mockExecSync = vi.fn();

    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(TEST_BUILDS_DIR, { recursive: true });

    manager = new LocalServerManager(TEST_BUILDS_DIR, {
      spawn: mockSpawn as any,
      exec: mockExec as any,
      execSync: mockExecSync as any,
      startupTimeoutMs: 1000,
    });
  });

  afterEach(() => {
    manager.dispose();
    vi.restoreAllMocks();
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('Configuration & Initialization', () => {
    it('uses provided builds directory and sanitizes project id', () => {
      expect(manager.getBuildDir('my-site$123')).toBe(
        path.join(TEST_BUILDS_DIR, 'my-site_123')
      );
      expect(sanitizeId('project/name with spaces')).toBe('project_name_with_spaces');
    });

    it('returns initial idle status with isBuilt: false when .next does not exist', () => {
      const status = manager.getStatus('site-1');
      expect(status).toEqual({
        status: 'idle',
        port: null,
        url: null,
        isBuilt: false,
        lastBuiltAt: null,
        lastError: null,
        pid: null,
      });
    });

    it('detects existing .next build on disk in getStatus', () => {
      const buildDir = manager.getBuildDir('site-built');
      const nextDir = path.join(buildDir, '.next');
      fs.mkdirSync(nextDir, { recursive: true });

      const status = manager.getStatus('site-built');
      expect(status.isBuilt).toBe(true);
      expect(typeof status.lastBuiltAt).toBe('number');
      expect(status.status).toBe('idle');
    });
  });

  describe('exportProject', () => {
    it('writes project files to build directory and skips files with leading underscore', () => {
      const files: Record<string, string> = {
        'app/page.tsx': 'export default function Page() { return <div>Home</div>; }',
        'public/favicon.ico': 'fake-icon',
        '_meta/project.json': '{"internal": true}',
        '_revyme/canvas.json': '{"nodes": []}',
        '_secret.txt': 'super-secret',
      };

      const targetDir = manager.exportProject('test-export', files);
      expect(targetDir).toBe(manager.getBuildDir('test-export'));

      // Check included files
      expect(fs.existsSync(path.join(targetDir, 'app/page.tsx'))).toBe(true);
      expect(fs.readFileSync(path.join(targetDir, 'app/page.tsx'), 'utf-8')).toContain('Home');
      expect(fs.existsSync(path.join(targetDir, 'public/favicon.ico'))).toBe(true);

      // Check skipped files
      expect(fs.existsSync(path.join(targetDir, '_meta/project.json'))).toBe(false);
      expect(fs.existsSync(path.join(targetDir, '_revyme/canvas.json'))).toBe(false);
      expect(fs.existsSync(path.join(targetDir, '_secret.txt'))).toBe(false);

      // Check auto-generated boilerplates
      expect(fs.existsSync(path.join(targetDir, 'next.config.mjs'))).toBe(true);
      expect(fs.existsSync(path.join(targetDir, 'tsconfig.json'))).toBe(true);
      expect(fs.existsSync(path.join(targetDir, 'package.json'))).toBe(true);

      const pkg = JSON.parse(fs.readFileSync(path.join(targetDir, 'package.json'), 'utf-8'));
      expect(pkg.name).toBe('revyme-live-site');
      expect(pkg.scripts.build).toBe('next build');
    });

    it('does not overwrite existing next.config.mjs, tsconfig.json or package.json', () => {
      const customPkg = JSON.stringify({ name: 'custom-site', version: '2.0.0' });
      const customNextConfig = 'export default { custom: true };';
      const customTsConfig = JSON.stringify({ custom: 'ts' });

      const files: Record<string, string> = {
        'package.json': customPkg,
        'next.config.mjs': customNextConfig,
        'tsconfig.json': customTsConfig,
      };

      const targetDir = manager.exportProject('custom-configs', files);

      expect(fs.readFileSync(path.join(targetDir, 'package.json'), 'utf-8')).toBe(customPkg);
      expect(fs.readFileSync(path.join(targetDir, 'next.config.mjs'), 'utf-8')).toBe(customNextConfig);
      expect(fs.readFileSync(path.join(targetDir, 'tsconfig.json'), 'utf-8')).toBe(customTsConfig);
    });
  });

  describe('build', () => {
    it('executes next build with Node and updates status on success', async () => {
      const mockChild = createMockChild(1111);
      mockSpawn.mockImplementation(() => {
        setTimeout(() => {
          mockChild.stdout.emit('data', Buffer.from('Creating an optimized production build...\nCompiled successfully'));
          mockChild.emit('close', 0);
        }, 10);
        return mockChild;
      });

      const files = { 'app/page.tsx': 'export default () => <h1>Hello</h1>;' };
      const buildPromise = manager.build('build-ok', files);

      // Verify status is building while running
      expect(manager.getStatus('build-ok').status).toBe('building');

      const result = await buildPromise;
      expect(result.success).toBe(true);
      expect(result.log).toContain('Compiled successfully');

      const status = manager.getStatus('build-ok');
      expect(status.status).toBe('idle');
      expect(status.isBuilt).toBe(true);
      expect(typeof status.lastBuiltAt).toBe('number');
      expect(status.lastError).toBeNull();

      expect(mockSpawn).toHaveBeenCalledTimes(1);
      const [cmd, args, opts] = mockSpawn.mock.calls[0];
      expect(cmd).toBe(process.execPath);
      expect(args[1]).toBe('build');
      expect(opts?.cwd).toBe(manager.getBuildDir('build-ok'));
    });

    it('updates status and captures log on build error', async () => {
      const mockChild = createMockChild(2222);
      mockSpawn.mockImplementation(() => {
        setTimeout(() => {
          mockChild.stderr.emit('data', Buffer.from('SyntaxError: Unexpected token'));
          mockChild.emit('close', 1);
        }, 10);
        return mockChild;
      });

      const files = { 'app/page.tsx': 'bad syntax' };
      const result = await manager.build('build-fail', files);

      expect(result.success).toBe(false);
      expect(result.log).toContain('SyntaxError');

      const status = manager.getStatus('build-fail');
      expect(status.status).toBe('error');
      expect(status.lastError).toContain('SyntaxError');
    });

    it('builds from storage if files argument is not provided', async () => {
      saveProject('proj-stored', {
        files: { 'app/page.tsx': 'export default () => <p>Stored</p>;' }
      }, 'Stored Project', TEST_STORAGE_DIR);

      const mockChild = createMockChild(3333);
      mockSpawn.mockImplementation(() => {
        setTimeout(() => {
          mockChild.stdout.emit('data', Buffer.from('Compiled successfully'));
          mockChild.emit('close', 0);
        }, 10);
        return mockChild;
      });

      const prevEnv = process.env.REVYME_DATA_DIR;
      process.env.REVYME_DATA_DIR = TEST_STORAGE_DIR;

      try {
        const result = await manager.build('proj-stored');
        expect(result.success).toBe(true);
        const targetDir = manager.getBuildDir('proj-stored');
        expect(fs.existsSync(path.join(targetDir, 'app/page.tsx'))).toBe(true);
      } finally {
        process.env.REVYME_DATA_DIR = prevEnv;
      }
    });

    it('returns error if project does not exist in storage and no files provided', async () => {
      const result = await manager.build('non-existent');
      expect(result.success).toBe(false);
      expect(result.log).toContain('Project not found');
      expect(manager.getStatus('non-existent').status).toBe('error');
    });
  });

  describe('start & stop lifecycle', () => {
    it('spawns next start and detects ready status from stdout', async () => {
      const mockChild = createMockChild(4444);
      mockSpawn.mockImplementation(() => {
        setTimeout(() => {
          mockChild.stdout.emit('data', Buffer.from('- Local: http://localhost:3000\n✓ Ready in 150ms'));
        }, 10);
        return mockChild;
      });

      const status = await manager.start('start-ok', 3000);

      expect(status.status).toBe('running');
      expect(status.port).toBe(3000);
      expect(status.url).toBe('http://localhost:3000');
      expect(status.pid).toBe(4444);

      expect(mockSpawn).toHaveBeenCalledTimes(1);
      const [cmd, args, opts] = mockSpawn.mock.calls[0];
      expect(cmd).toBe(process.execPath);
      expect(args[1]).toBe('start');
      expect(args).toContain('-p');
      expect(args).toContain('3000');
      expect(opts?.cwd).toBe(manager.getBuildDir('start-ok'));

      // Calling start again while running returns current status without re-spawning
      const secondStatus = await manager.start('start-ok', 3000);
      expect(secondStatus.status).toBe('running');
      expect(mockSpawn).toHaveBeenCalledTimes(1);
    });

    it('handles unexpected process exit by updating status', async () => {
      const mockChild = createMockChild(5555);
      mockSpawn.mockImplementation(() => {
        setTimeout(() => {
          mockChild.stdout.emit('data', Buffer.from('✓ Ready in 50ms'));
        }, 10);
        return mockChild;
      });

      await manager.start('exit-test', 3005);
      expect(manager.getStatus('exit-test').status).toBe('running');

      // Simulate child process unexpected exit
      mockChild.emit('exit', 1, null);

      const statusAfterExit = manager.getStatus('exit-test');
      expect(statusAfterExit.status).toBe('error');
      expect(statusAfterExit.pid).toBeNull();
      expect(statusAfterExit.port).toBeNull();
      expect(statusAfterExit.url).toBeNull();
    });

    it('stops a running server and cleans up state', async () => {
      const mockChild = createMockChild(6666);
      mockSpawn.mockImplementation(() => {
        setTimeout(() => {
          mockChild.stdout.emit('data', Buffer.from('✓ Ready'));
        }, 10);
        return mockChild;
      });

      await manager.start('stop-test', 3010);
      expect(manager.getStatus('stop-test').status).toBe('running');

      const stoppedStatus = await manager.stop('stop-test');
      expect(stoppedStatus.status).toBe('idle');
      expect(stoppedStatus.port).toBeNull();
      expect(stoppedStatus.url).toBeNull();
      expect(stoppedStatus.pid).toBeNull();

      if (process.platform === 'win32') {
        expect(mockExec).toHaveBeenCalledWith(
          expect.stringContaining('taskkill /pid 6666 /T /F'),
          expect.any(Function)
        );
      } else {
        expect(mockChild.kill).toHaveBeenCalled();
      }
    });

    it('handles start failure if process exits before becoming ready', async () => {
      const mockChild = createMockChild(7777);
      mockSpawn.mockImplementation(() => {
        setTimeout(() => {
          mockChild.stderr.emit('data', Buffer.from('Port 3000 is already in use'));
          mockChild.emit('exit', 1, null);
        }, 10);
        return mockChild;
      });

      const status = await manager.start('fail-start', 3000);
      expect(status.status).toBe('error');
      expect(status.lastError).toContain('Port 3000 is already in use');
    });
  });

  describe('dispose', () => {
    it('stops all running servers on dispose', async () => {
      const child1 = createMockChild(8001);
      const child2 = createMockChild(8002);

      let count = 0;
      mockSpawn.mockImplementation(() => {
        count++;
        const child = count === 1 ? child1 : child2;
        setTimeout(() => {
          child.stdout.emit('data', Buffer.from('✓ Ready'));
        }, 10);
        return child;
      });

      await manager.start('site-1', 4001);
      await manager.start('site-2', 4002);

      expect(manager.getStatus('site-1').status).toBe('running');
      expect(manager.getStatus('site-2').status).toBe('running');

      manager.dispose();

      expect(manager.getStatus('site-1').status).toBe('idle');
      expect(manager.getStatus('site-2').status).toBe('idle');

      if (process.platform === 'win32') {
        expect(mockExecSync).toHaveBeenCalledWith(
          expect.stringContaining('taskkill /pid 8001 /T /F'),
          expect.anything()
        );
        expect(mockExecSync).toHaveBeenCalledWith(
          expect.stringContaining('taskkill /pid 8002 /T /F'),
          expect.anything()
        );
      }
    });
  });
});
