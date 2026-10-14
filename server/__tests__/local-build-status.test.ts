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
    expect(status.lastError).toContain('audit compiler waiting on resource');
  });
});
