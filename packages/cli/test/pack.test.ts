// packages/cli/test/pack.test.ts
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startStandaloneServer } from '../../../server/automation/standalone';

describe('T05: npm pack and standalone installed binary smoke', () => {
  it('installs the packed binary and commits through real stdio MCP and HTTP', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'revyme-pack-test-'));
    const cliDir = path.resolve(__dirname, '..');
    let server: Awaited<ReturnType<typeof startStandaloneServer>> | undefined;
    let client: Client | undefined;
    let failed = false;

    try {
      // 1. Build dist/main.js
      execSync('node build.cjs', { cwd: cliDir, stdio: 'pipe' });

      // 2. npm pack into tmpDir
      const packOutput = execSync(`npm pack --pack-destination "${tmpDir}"`, {
        cwd: cliDir,
        encoding: 'utf8',
      }).trim();
      const tarballName = packOutput.split('\n').pop()!.trim();
      const tarballPath = path.join(tmpDir, tarballName);
      expect(fs.existsSync(tarballPath)).toBe(true);

      // 3. Extract tarball
      const extractDir = path.join(tmpDir, 'extracted');
      fs.mkdirSync(extractDir, { recursive: true });
      execSync(`tar -xzf "${tarballPath}" -C "${extractDir}"`, { stdio: 'pipe' });

      const packageDir = path.join(extractDir, 'package');
      expect(fs.existsSync(path.join(packageDir, 'bin', 'revyme.mjs'))).toBe(true);
      expect(fs.existsSync(path.join(packageDir, 'dist', 'main.js'))).toBe(true);

      // Install only the published manifest dependencies, outside the workspace.
      execSync('npm install --ignore-scripts --omit=dev --package-lock=false --no-audit --no-fund --prefer-offline', {
        cwd: packageDir, stdio: 'pipe', timeout: 120000,
      });

      // 5. Execute bin with plain node (no tsx, no vite)
      const binPath = path.join(packageDir, 'bin', 'revyme.mjs');

      // Test --version
      const versionOutput = execSync(`node "${binPath}" --version`, {
        cwd: packageDir,
        encoding: 'utf8',
      });
      const parsedVersion = JSON.parse(versionOutput);
      expect(parsedVersion.name).toBe('@revyme/cli');
      expect(parsedVersion.version).toBe('2.0.0');

      // Test doctor
      const doctorOutput = execSync(`node "${binPath}" doctor`, {
        cwd: packageDir,
        encoding: 'utf8',
      });
      const parsedDoctor = JSON.parse(doctorOutput);
      expect(parsedDoctor.doctorOk).toBe(true);
      expect(parsedDoctor.registry.registeredToolsCount).toBeGreaterThanOrEqual(6);

      // Test meta.guide
      const guideOutput = execSync(`node "${binPath}" meta.guide --topic general`, {
        cwd: packageDir,
        encoding: 'utf8',
      });
      const parsedGuide = JSON.parse(guideOutput);
      expect(parsedGuide.ok).toBe(true);
      expect(parsedGuide.data.topic).toBe('general');

      const dataDir = path.join(tmpDir, 'data');
      fs.mkdirSync(path.join(dataDir, 'projects'), { recursive: true });
      const projectFile = path.join(dataDir, 'projects', 'packed-fixture.json');
      fs.writeFileSync(projectFile, JSON.stringify({ id: 'packed-fixture', revision: 1,
        data: { format: 'revyme-v1', files: {} } }));
      server = await startStandaloneServer(0, dataDir);
      const port = (server.server.address() as { port: number }).port;
      client = new Client({ name: 'packed-regression', version: '1.0.0' });
      await client.connect(new StdioClientTransport({ command: process.execPath,
        args: [binPath, 'mcp'], cwd: packageDir,
        env: { REVYME_API_URL: `http://127.0.0.1:${port}`, REVYME_PROJECT_ID: 'packed-fixture' },
      }));
      const created = await client.callTool({ name: 'pages.create', arguments: { slug: 'about', title: 'About' } });
      expect(created.isError).toBe(false);
      const persisted = JSON.parse(fs.readFileSync(projectFile, 'utf8'));
      expect(persisted.revision).toBe(2);
      expect(persisted.data.files['app/about/page.client.tsx']).toBeDefined();
      const dryRun = await client.callTool({ name: 'pages.create', arguments: { slug: 'preview', title: 'Preview', dryRun: true } });
      expect(dryRun.isError).toBe(false);
      expect(JSON.parse(fs.readFileSync(projectFile, 'utf8')).revision).toBe(2);
      const copied = await client.callTool({ name: 'projects.duplicate', arguments: { targetName: 'Packed Copy', targetProjectId: 'packed-copy' } });
      expect(copied.isError).toBe(false);
      const duplicate = JSON.parse(fs.readFileSync(path.join(dataDir, 'projects', 'packed-copy.json'), 'utf8'));
      expect(duplicate.data.files['app/about/page.client.tsx']).toEqual(persisted.data.files['app/about/page.client.tsx']);
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      await client?.close();
      await server?.close();
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
      } catch (error) {
        // On Windows a timed-out npm child can temporarily retain the folder.
        // Keep the original test failure visible instead of masking it.
        if (!failed) throw error;
      }
    }
  }, 180000);
});
