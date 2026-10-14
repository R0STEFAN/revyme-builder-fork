// Permanent regression suite for local server build status and error handling.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import path from 'node:path';
import fs from 'node:fs';
import { LocalServerManager } from '../local-server';

const TEST_DIR = path.resolve(process.cwd(), '.test-local-server', 'build-status-regression');

describe('local build status regression', () => {
  beforeEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it('clears building state when preparation fails before spawning Next', async () => {
    const manager = new LocalServerManager(TEST_DIR, { publicDir: null });
    vi.spyOn(manager, 'exportProject').mockImplementation(() => { throw new Error('audit preparation failure'); });
    await expect(manager.build('api-cms-audit', {})).rejects.toThrow('audit preparation failure');
    expect(manager.getStatus('api-cms-audit').status).toBe('error');
  });

  it('makes compiler stderr visible to status polling while a build is still running', async () => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() });
    const manager = new LocalServerManager(TEST_DIR, { publicDir: null, spawn: vi.fn(() => child) as any });
    vi.spyOn(manager, 'exportProject').mockReturnValue('');
    vi.spyOn(manager, 'syncUploads').mockResolvedValue(undefined);
    vi.spyOn(manager, 'syncPublicAssets').mockReturnValue(undefined);
    const build = manager.build('api-cms-audit', {});
    await Promise.resolve();
    child.stderr.write('audit compiler waiting on resource');
    const status = manager.getStatus('api-cms-audit');
    child.emit('close', 1);
    await build;
    expect(status.lastError ?? '').toContain('audit compiler waiting on resource');
  });

  it('rejects concurrent build for the same project while build is active', async () => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() });
    const manager = new LocalServerManager(TEST_DIR, { publicDir: null, spawn: vi.fn(() => child) as any });
    vi.spyOn(manager, 'exportProject').mockReturnValue('');
    vi.spyOn(manager, 'syncUploads').mockResolvedValue(undefined);
    vi.spyOn(manager, 'syncPublicAssets').mockReturnValue(undefined);

    const build1 = manager.build('parallel-proj', {});
    await Promise.resolve();

    await expect(manager.build('parallel-proj', {})).rejects.toThrow('Build already in progress');

    child.emit('close', 0);
    await build1;
  });

  it('cancels active build and transitions status to cancelled', async () => {
    const child = Object.assign(new EventEmitter(), {
      pid: 99999,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(),
    });
    const mockExec = vi.fn((cmd: string, cb: any) => { cb?.(null, '', ''); return {} as any; });
    const manager = new LocalServerManager(TEST_DIR, {
      publicDir: null,
      spawn: vi.fn(() => child) as any,
      exec: mockExec as any,
    });
    vi.spyOn(manager, 'exportProject').mockReturnValue('');
    vi.spyOn(manager, 'syncUploads').mockResolvedValue(undefined);
    vi.spyOn(manager, 'syncPublicAssets').mockReturnValue(undefined);

    const build = manager.build('cancel-proj', {});
    await Promise.resolve();

    const cancelStatus = await manager.cancelBuild('cancel-proj');
    expect(cancelStatus.status).toBe('cancelled');
    expect(cancelStatus.isBuilt).toBe(false);

    child.emit('close', 0, 'SIGTERM');
    const result = await build;
    expect(result.success).toBe(false);
    expect(manager.getStatus('cancel-proj').status).toBe('cancelled');
  });

  it('does not mark project as isBuilt if build fails with exit code 1', async () => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() });
    const manager = new LocalServerManager(TEST_DIR, { publicDir: null, spawn: vi.fn(() => child) as any });
    vi.spyOn(manager, 'exportProject').mockReturnValue('');
    vi.spyOn(manager, 'syncUploads').mockResolvedValue(undefined);
    vi.spyOn(manager, 'syncPublicAssets').mockReturnValue(undefined);

    const build = manager.build('failed-build-marker', {});
    await Promise.resolve();

    // Partial .next directory created by compiler during build
    const targetDir = manager.getBuildDir('failed-build-marker');
    const nextDir = path.join(targetDir, '.next');
    if (!fs.existsSync(nextDir)) fs.mkdirSync(nextDir, { recursive: true });
    fs.mkdirSync(path.join(nextDir, 'server'), { recursive: true });

    child.emit('close', 1);
    const result = await build;
    expect(result.success).toBe(false);

    const status = manager.getStatus('failed-build-marker');
    expect(status.status).toBe('error');
    expect(status.isBuilt).toBe(false);
  });

  it('marks project as isBuilt and writes success marker when build completes with code 0', async () => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() });
    const manager = new LocalServerManager(TEST_DIR, { publicDir: null, spawn: vi.fn(() => child) as any });
    vi.spyOn(manager, 'exportProject').mockReturnValue('');
    vi.spyOn(manager, 'syncUploads').mockResolvedValue(undefined);
    vi.spyOn(manager, 'syncPublicAssets').mockReturnValue(undefined);

    const build = manager.build('success-build-marker', {});
    await Promise.resolve();

    const targetDir = manager.getBuildDir('success-build-marker');
    const nextDir = path.join(targetDir, '.next');
    if (!fs.existsSync(nextDir)) fs.mkdirSync(nextDir, { recursive: true });
    fs.writeFileSync(path.join(nextDir, 'BUILD_ID'), 'test-build-id');

    child.emit('close', 0);
    const result = await build;
    expect(result.success).toBe(true);

    const status = manager.getStatus('success-build-marker');
    expect(status.status).toBe('idle');
    expect(status.isBuilt).toBe(true);
    expect(fs.existsSync(path.join(nextDir, 'revyme-build-success.json'))).toBe(true);
  });
});
