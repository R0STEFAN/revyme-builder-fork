// packages/cli/test/cli.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runCli } from '../src/main';
import { AutomationClient } from '../src/client';
import { loadConfig, saveConfig, sanitizeConfig } from '../src/config';

describe('T05: Revyme CLI Command Line Interface', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'revyme-cli-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('prints version information on --version', async () => {
    const outputs: string[] = [];
    const code = await runCli({
      argv: ['--version'],
      stdout: (msg) => outputs.push(msg),
    });

    expect(code).toBe(0);
    const parsed = JSON.parse(outputs.join(''));
    expect(parsed.name).toBe('@revyme/cli');
    expect(parsed.version).toBe('2.0.0');
  });

  it('prints usage guide on --help', async () => {
    const outputs: string[] = [];
    const code = await runCli({
      argv: ['--help'],
      stdout: (msg) => outputs.push(msg),
    });

    expect(code).toBe(0);
    const text = outputs.join('');
    expect(text).toContain('Revyme Headless CLI & MCP v2');
    expect(text).toContain('doctor');
    expect(text).toContain('init');
  });

  it('initializes and links a project via init command', async () => {
    const outputs: string[] = [];
    const origCwd = process.cwd();
    try {
      process.chdir(tmpDir);
      const code = await runCli({
        argv: ['init', 'my-custom-project'],
        stdout: (msg) => outputs.push(msg),
      });

      expect(code).toBe(0);
      const parsed = JSON.parse(outputs.join(''));
      expect(parsed.ok).toBe(true);
      expect(parsed.config.projectId).toBe('my-custom-project');

      const saved = loadConfig(tmpDir);
      expect(saved.projectId).toBe('my-custom-project');
      expect(saved.branchId).toBe('main');
    } finally {
      process.chdir(origCwd);
    }
  });

  it('strips credentials and sensitive tokens from config files', () => {
    const dirty = {
      projectId: 'safe-proj',
      branchId: 'main',
      apiUrl: 'http://localhost:3000',
      authToken: 'secret_jwt_123',
      apiKey: 'xyz-secret-key',
      databasePassword: 'super_secret_pwd',
    };

    const clean = sanitizeConfig(dirty);
    expect(clean.projectId).toBe('safe-proj');
    expect(clean.apiUrl).toBe('http://localhost:3000');
    expect(clean.authToken).toBeUndefined();
    expect(clean.apiKey).toBeUndefined();
    expect(clean.databasePassword).toBeUndefined();

    saveConfig(tmpDir, dirty as any);
    const savedContent = fs.readFileSync(path.join(tmpDir, '.revymelocal', 'automation.json'), 'utf8');
    expect(savedContent).not.toContain('secret_jwt_123');
    expect(savedContent).not.toContain('xyz-secret-key');
    expect(savedContent).not.toContain('super_secret_pwd');
  });

  it('runs doctor and correctly validates unicode and space paths', async () => {
    const unicodeDir = path.join(tmpDir, 'Папка з Пробілами та Кирилицею');
    fs.mkdirSync(unicodeDir, { recursive: true });

    const origCwd = process.cwd();
    try {
      process.chdir(unicodeDir);
      const outputs: string[] = [];
      const code = await runCli({
        argv: ['doctor'],
        stdout: (msg) => outputs.push(msg),
      });

      expect(code).toBe(0);
      const report = JSON.parse(outputs.join(''));
      expect(report.doctorOk).toBe(true);
      expect(report.pathChecks.hasUnicode).toBe(true);
      expect(report.pathChecks.hasSpaces).toBe(true);
      expect(report.pathChecks.valid).toBe(true);
      expect(report.registry.registeredToolsCount).toBeGreaterThanOrEqual(6);
    } finally {
      process.chdir(origCwd);
    }
  });

  it('executes meta.index and returns registered tools list', async () => {
    const outputs: string[] = [];
    const code = await runCli({
      argv: ['meta.index', '--category', 'meta'],
      stdout: (msg) => outputs.push(msg),
    });

    expect(code).toBe(0);
    const result = JSON.parse(outputs.join(''));
    expect(result.ok).toBe(true);
    expect(result.data.operations.length).toBeGreaterThanOrEqual(3);
    expect(result.data.operations.every((op: any) => op.category === 'meta')).toBe(true);
  });

  it('accepts tool arguments via --input-file with Cyrillic path', async () => {
    const inputDir = path.join(tmpDir, 'Конфігурація');
    fs.mkdirSync(inputDir, { recursive: true });
    const inputFile = path.join(inputDir, 'параметри.json');
    fs.writeFileSync(inputFile, JSON.stringify({ topic: 'general' }), 'utf8');

    const outputs: string[] = [];
    const code = await runCli({
      argv: ['meta.guide', '--input-file', inputFile],
      stdout: (msg) => outputs.push(msg),
    });

    expect(code).toBe(0);
    const result = JSON.parse(outputs.join(''));
    expect(result.ok).toBe(true);
    expect(result.data.topic).toBe('general');
    expect(result.data.overview).toContain('Revyme Automation');
  });

  it('accepts tool arguments via standard input', async () => {
    const outputs: string[] = [];
    const code = await runCli({
      argv: ['meta.guide', '--stdin'],
      stdinData: JSON.stringify({ topic: 'recipes' }),
      stdout: (msg) => outputs.push(msg),
    });

    expect(code).toBe(0);
    const result = JSON.parse(outputs.join(''));
    expect(result.ok).toBe(true);
    expect(result.data.topic).toBe('recipes');
  });

  it('coerces typed flags from the operation schema', async () => {
    const execute = vi.spyOn(AutomationClient.prototype, 'execute').mockResolvedValue({
      ok: true,
      data: {},
      meta: { commitStatus: 'not_committed', revision: 1 },
    } as any);
    const outputs: string[] = [];

    try {
      const code = await runCli({
        argv: [
          'diagnostics.projectCheck',
          '--project-id', 'test-project',
          '--branch-id', 'main',
          '--api', 'http://localhost:3333',
          '--strict', 'true',
          '--targetFile', 'components/SiteNavbar.tsx',
        ],
        stdout: (msg) => outputs.push(msg),
      });

      expect(code).toBe(0);
      expect(execute).toHaveBeenCalledWith(
        { projectId: 'test-project', branchId: 'main' },
        'diagnostics.projectCheck',
        { strict: true, targetFile: 'components/SiteNavbar.tsx' },
        { dryRun: false },
      );

      execute.mockClear();
      await runCli({
        argv: [
          'codeFiles.read',
          '--project-id', 'test-project',
          '--branch-id', 'main',
          '--api', 'http://localhost:3333',
          '--path', 'components/SiteNavbar.tsx',
          '--toLine', '120',
        ],
        stdout: (msg) => outputs.push(msg),
      });
      expect(execute).toHaveBeenCalledWith(
        { projectId: 'test-project', branchId: 'main' },
        'codeFiles.read',
        { path: 'components/SiteNavbar.tsx', toLine: 120 },
        { dryRun: false },
      );
    } finally {
      execute.mockRestore();
    }
  });

  it('fails with nonzero exit code and structured error on unknown tool', async () => {
    const errors: string[] = [];
    const code = await runCli({
      argv: ['meta.unknown_tool'],
      stderr: (msg) => errors.push(msg),
    });

    expect(code).toBe(1);
    const errObj = JSON.parse(errors.join(''));
    expect(errObj.ok).toBe(false);
    expect(errObj.error.code).toBe('UNKNOWN_OPERATION');
    expect(errObj.error.message).toContain('meta.unknown_tool');
    expect(errObj.meta.commitStatus).toBe('not_committed');
  });

  it('fails with nonzero exit code when non-meta tool lacks projectId', async () => {
    const errors: string[] = [];
    const origCwd = process.cwd();
    try {
      process.chdir(tmpDir); // directory without config
      const code = await runCli({
        argv: ['workflow.batch'],
        stderr: (msg) => errors.push(msg),
      });

      expect(code).toBe(1);
      const errObj = JSON.parse(errors.join(''));
      expect(errObj.ok).toBe(false);
      expect(errObj.error.code).toBe('MISSING_PROJECT_ID');
    } finally {
      process.chdir(origCwd);
    }
  });

  it('correctly parses --input-file - and passes stdinData to operation execution', async () => {
    const outputs: string[] = [];
    const execute = vi.spyOn(AutomationClient.prototype, 'execute').mockResolvedValue({
      ok: true,
      data: { success: true },
      meta: { commitStatus: 'committed', revision: 5 },
    } as any);

    try {
      const code = await runCli({
        argv: [
          'assets.upload',
          '--project-id', 'test-project',
          '--branch-id', 'main',
          '--api', 'http://localhost:3333',
          '--input-file', '-',
        ],
        stdinData: JSON.stringify({
          fileName: 'grain.svg',
          content: '<svg></svg>',
          encoding: 'utf-8',
          folder: 'public/assets',
        }),
        stdout: (msg) => outputs.push(msg),
      });

      expect(code).toBe(0);
      expect(execute).toHaveBeenCalledWith(
        { projectId: 'test-project', branchId: 'main' },
        'assets.upload',
        {
          fileName: 'grain.svg',
          content: '<svg></svg>',
          encoding: 'utf-8',
          folder: 'public/assets',
        },
        { dryRun: false },
      );
    } finally {
      execute.mockRestore();
    }
  });

  it('maps kebab-case CLI flags to camelCase schema properties and coerces types', async () => {
    const outputs: string[] = [];
    const execute = vi.spyOn(AutomationClient.prototype, 'execute').mockResolvedValue({
      ok: true,
      data: { nodeId: 'hero-heading', viewport: 'tablet' },
      meta: { commitStatus: 'committed', revision: 33 },
    } as any);

    try {
      const code = await runCli({
        argv: [
          'viewports.setOverride',
          '--project-id', 'test-project',
          '--branch-id', 'main',
          '--api', 'http://localhost:3333',
          '--node-id', 'hero-heading',
          '--viewport', 'tablet',
          '--styles', '{"fontSize":"42px"}',
        ],
        stdout: (msg) => outputs.push(msg),
      });

      expect(code).toBe(0);
      expect(execute).toHaveBeenCalledWith(
        { projectId: 'test-project', branchId: 'main' },
        'viewports.setOverride',
        {
          nodeId: 'hero-heading',
          viewport: 'tablet',
          styles: { fontSize: '42px' },
        },
        { dryRun: false },
      );
    } finally {
      execute.mockRestore();
    }
  });
});
