// packages/cli/test/pack.test.ts
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('T05: npm pack and standalone installed binary smoke', () => {
  it('builds, packs and executes packed bin without tsx or browser dependencies', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'revyme-pack-test-'));
    const cliDir = path.resolve(__dirname, '..');
    const rootNodeModules = path.resolve(__dirname, '../../../node_modules');

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

      // 4. Link node_modules so dependencies like @modelcontextprotocol/sdk and zod resolve
      fs.symlinkSync(rootNodeModules, path.join(packageDir, 'node_modules'), 'junction');

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
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
