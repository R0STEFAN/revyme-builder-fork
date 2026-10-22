// packages/automation-core/test/capabilities/T22-adversarial.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createSnapshot, createOperationContext } from '../../src/session';
import { defaultRegistry } from '../../src/registry';
import '../../src/index';
import {
  pluginsListOperation,
  pluginsWriteOperation,
  pluginsDataGetOperation,
  pluginsDataSetOperation,
  pluginsSecretsRequestOperation,
  checkPluginSource,
  assertValidPluginId,
  xorEncrypt,
  xorDecrypt,
} from '../../src/operations/plugins';
import {
  marketplaceBrowseOperation,
  marketplaceImportOperation,
  marketplacePublishListingOperation,
} from '../../src/operations/marketplace';
import {
  skillsListOperation,
  skillsSaveOperation,
} from '../../src/operations/project-skills';
import { projectFS } from '@/code/project/project-fs';
import { checkFile } from '@/code/oracle/check-file';

describe('Milestone T22 Adversarial & Stress Testing', () => {
  const context = createOperationContext();

  beforeEach(() => {
    projectFS.loadSnapshot(new Map());
  });

  describe('1. Adversarial Plugins & checkPluginSource AST Invariants', () => {
    const VALID_PLUGIN = `'use client';
import React from 'react';
import { createPlugin } from '@revyme/plugin-sdk';
import { createRoot } from 'react-dom/client';

function App() {
  return <div data-id="root">App</div>;
}

const root = document.getElementById('root');
if (root) {
  createPlugin({ pluginId: 'local.my-adv-tool' }).then(() => {
    createRoot(root).render(<App />);
  });
}
`;

    it('rejects attempt to smuggle default export even if disguised', () => {
      const disguised = VALID_PLUGIN + '\n// export default foo;\n';
      // The strict regex flags any export default
      const problems = checkPluginSource(disguised);
      expect(problems.some((p) => p.includes('default export'))).toBe(true);
    });

    it('rejects forbidden import specifiers', () => {
      const forbidden = [
        `import foo from './local-util';`,
        `import bar from '../parent-util';`,
        `import baz from '@/code/stores';`,
        `import abs from '/absolute/path';`,
      ];
      for (const spec of forbidden) {
        const code = VALID_PLUGIN + '\n' + spec + '\n';
        const problems = checkPluginSource(code);
        expect(problems.some((p) => p.includes('not allowed')), `Should flag: ${spec}`).toBe(true);
      }
    });

    it('allows valid bare npm packages and standard libraries', () => {
      const validImports = [
        `import lodash from 'lodash';`,
        `import clsx from 'clsx';`,
        `import { motion } from 'framer-motion';`,
        `import { useState } from 'react';`,
      ];
      for (const spec of validImports) {
        const code = spec + '\n' + VALID_PLUGIN;
        const problems = checkPluginSource(code);
        expect(problems, `Should not flag valid import: ${spec}`).toEqual([]);
      }
    });

    it('rejects deprecated SDK methods regardless of invocation prefix', () => {
      const calls = [
        'variables.get("k")',
        'variables.set("k", "v")',
        'assets.setImage("id", "url")',
        'components.addDetachedComponentLayers()',
        'codeFiles.lint("p")',
        'codeFiles.typecheck("p")',
        'codeFiles.getVersions("p")',
      ];
      for (const c of calls) {
        const code = VALID_PLUGIN.replace('return <div data-id="root">App</div>;', `return <div>{${c}}</div>;`);
        const problems = checkPluginSource(code);
        expect(problems.some((p) => p.includes('marked [NOT_IMPLEMENTED]')), `Should flag deprecated call: ${c}`).toBe(true);
      }
    });

    it('neutralizes path traversal attempts in plugin name during write', async () => {
      const snap = createSnapshot({ projectId: 'test', branchId: 'main' }, 1, {});
      const maliciousName = '../../../../etc/malicious-plugin';
      const res = await pluginsWriteOperation.execute(
        snap,
        { name: maliciousName, code: VALID_PLUGIN },
        context,
      );
      // toPascalCase converts punctuation/slashes to clean PascalCase
      expect(res.file).toBe('plugins/EtcMaliciousPlugin.tsx');
      expect(res.file.includes('..')).toBe(false);
      expect(projectFS.exists('plugins/EtcMaliciousPlugin.tsx')).toBe(true);
    });

    it('rejects path traversal and illegal characters in assertValidPluginId', () => {
      const illegal = [
        '../escaped',
        'sub/dir',
        'test\\slash',
        'name with spaces',
        'plugin\0null',
        'plugin@special!',
      ];
      for (const id of illegal) {
        expect(() => assertValidPluginId(id)).toThrow(/INVALID_PLUGIN_ID/i);
      }
    });

    it('prevents prototype pollution in plugins.data.set and get', async () => {
      const snap = createSnapshot({ projectId: 'test', branchId: 'main' }, 1, {});
      await pluginsDataSetOperation.execute(
        snap,
        { pluginId: 'local.proto-test', key: '__proto__', value: { polluted: true } },
        context,
      );
      const res = await pluginsDataGetOperation.execute(
        snap,
        { pluginId: 'local.proto-test', key: '__proto__' },
        context,
      );
      // Normal object prototype should NOT be mutated globally
      expect(({} as any).polluted).toBeUndefined();
    });
  });

  describe('2. Adversarial Secrets Isolation & Non-Leakage', () => {
    it('never leaks secret in return value, snapshot files plaintext, or traces', async () => {
      const snap = createSnapshot({ projectId: 'test', branchId: 'main' }, 1, {});
      const secret = 'SUPER_CONFIDENTIAL_KEY_12345!@#$%';
      const traces: any[] = [];
      const traceContext = {
        ...context,
        trace: (event: string, data: any) => traces.push({ event, data }),
      };

      const res = await pluginsSecretsRequestOperation.execute(
        snap,
        { pluginId: 'local.vault', secretName: 'AWS_SECRET', value: secret },
        traceContext,
      );

      // Return object check
      expect(JSON.stringify(res)).not.toContain(secret);
      expect(res.secretName).toBe('AWS_SECRET');
      expect(res.configured).toBe(true);

      // Traces check
      expect(JSON.stringify(traces)).not.toContain(secret);

      // Snapshot files check
      const secretFilePath = '_meta/secrets/local.vault.json';
      const stored = projectFS.readFile(secretFilePath);
      expect(stored).toBeDefined();
      expect(stored).not.toContain(secret);

      // Encryption verification
      const parsed = JSON.parse(stored!);
      expect(parsed.AWS_SECRET).toBeDefined();
      expect(xorDecrypt(parsed.AWS_SECRET)).toBe(secret);
    });

    it('handles multiple sequential secret additions without clobbering', async () => {
      const snap = createSnapshot({ projectId: 'test', branchId: 'main' }, 1, {});
      await pluginsSecretsRequestOperation.execute(
        snap,
        { pluginId: 'local.multi', secretName: 'KEY_ONE', value: 'secret-1' },
        context,
      );
      await pluginsSecretsRequestOperation.execute(
        snap,
        { pluginId: 'local.multi', secretName: 'KEY_TWO', value: 'secret-2' },
        context,
      );

      const stored = JSON.parse(projectFS.readFile('_meta/secrets/local.multi.json')!);
      expect(xorDecrypt(stored.KEY_ONE)).toBe('secret-1');
      expect(xorDecrypt(stored.KEY_TWO)).toBe('secret-2');
    });
  });

  describe('3. Adversarial Marketplace & Oracle Invariants', () => {
    it('generates remote component and vector proxies that cleanly pass Oracle checkFile', async () => {
      const snap = createSnapshot({ projectId: 'test', branchId: 'main' }, 1, {});
      
      // Test Component
      const compRes = await marketplaceImportOperation.execute(
        snap,
        { url: 'https://assets.revyme.app/components/MegaNav@abcdef123456.js' },
        context,
      );
      const compCode = projectFS.readFile(compRes.localPath)!;
      const compViolations = checkFile(compCode, { kind: 'code-component', path: compRes.localPath });
      const compBlockers = compViolations.filter((v) => v.tier === 1 || v.tier === 3);
      expect(compBlockers).toEqual([]);

      // Test Vector
      const vecRes = await marketplaceImportOperation.execute(
        snap,
        { url: 'https://assets.revyme.app/vectors/BrandIcons@123456abcdef.js' },
        context,
      );
      const vecCode = projectFS.readFile(vecRes.localPath)!;
      const vecViolations = checkFile(vecCode, { kind: 'code-component', path: vecRes.localPath });
      const vecBlockers = vecViolations.filter((v) => v.tier === 1 || v.tier === 3);
      expect(vecBlockers).toEqual([]);
    });

    it('rejects malicious targetPath with path traversal or illegal characters in marketplace.import', async () => {
      const snap = createSnapshot({ projectId: 'test', branchId: 'main' }, 1, {});
      const maliciousPaths = [
        '../evil.tsx',
        '/root/evil.tsx',
        'components/../../escaped.tsx',
        'components/null\0byte.tsx',
      ];
      for (const p of maliciousPaths) {
        await expect(
          marketplaceImportOperation.execute(
            snap,
            { url: 'https://assets.revyme.app/components/Safe@123456abcdef.js', targetPath: p },
            context,
          ),
        ).rejects.toThrow(/SECURITY_ERROR/i);
      }
    });

    it('rejects marketplace.publishListing for non-component files and illegal prices', async () => {
      const snap = createSnapshot(
        { projectId: 'test', branchId: 'main' },
        1,
        { 'components/Button.tsx': `'use client'; export default function Button() { return <div data-id="root" />; }` },
      );

      // Rejects negative price
      await expect(
        marketplacePublishListingOperation.execute(
          snap,
          {
            path: 'components/Button.tsx',
            name: 'Button',
            pricingType: 'paid',
            priceCents: -500,
          },
          context,
        ),
      ).rejects.toThrow();

      // Rejects zero price for paid
      await expect(
        marketplacePublishListingOperation.execute(
          snap,
          {
            path: 'components/Button.tsx',
            name: 'Button',
            pricingType: 'paid',
            priceCents: 0,
          },
          context,
        ),
      ).rejects.toThrow(/VALIDATION_ERROR/i);

      // Rejects non-existent file
      await expect(
        marketplacePublishListingOperation.execute(
          snap,
          {
            path: 'components/Ghost.tsx',
            name: 'Ghost',
          },
          context,
        ),
      ).rejects.toThrow(/File not found/i);
    });
  });

  describe('4. Adversarial Project Skills Edge Cases', () => {
    it('handles skills without frontmatter gracefully', async () => {
      const snap = createSnapshot(
        { projectId: 'test', branchId: 'main' },
        1,
        {
          '.agents/skills/clean-code.md': '# Clean Code Rules\nWrite concise tests.\nKeep components modular.',
        },
      );

      const res = await skillsListOperation.execute(snap, {}, context);
      const skill = res.skills.find((s) => s.name === 'clean-code');
      expect(skill).toBeDefined();
      expect(skill?.name).toBe('clean-code');
      expect(skill?.description).toContain('Clean Code Rules');
      expect(skill?.alwaysApply).toBe(false);
      expect(skill?.charCount).toBeGreaterThan(0);
    });

    it('ignores non-markdown or nested sub-files in .agents/skills/', async () => {
      const snap = createSnapshot(
        { projectId: 'test', branchId: 'main' },
        1,
        {
          '.agents/skills/notes.txt': 'Some text notes',
          '.agents/skills/tool/helper.ts': 'export const helper = 1;',
          '.agents/skills/valid/SKILL.md': '---\nname: valid-skill\ndescription: Valid\n---\nBody',
        },
      );

      const res = await skillsListOperation.execute(snap, {}, context);
      expect(res.skills).toHaveLength(1);
      expect(res.skills[0].name).toBe('valid-skill');
    });

    it('allows updating an existing skill when skill count is already at the maximum (40 skills)', async () => {
      const initialSkills = Array.from({ length: 40 }, (_, i) => ({
        name: `skill-${i + 1}`,
        description: `Skill ${i + 1}`,
        content: `Instructions ${i + 1}`,
        alwaysApply: false,
        createdAt: 1000,
        updatedAt: 1000,
      }));
      const snap = createSnapshot(
        { projectId: 'test', branchId: 'main' },
        1,
        { '_meta/skills.json': JSON.stringify({ version: 1, skills: initialSkills }) },
      );

      // Updating skill-1 should succeed even though count is 40
      const res = await skillsSaveOperation.execute(
        snap,
        {
          name: 'skill-1',
          description: 'Updated Skill 1',
          content: 'Updated instructions for skill 1',
          alwaysApply: true,
        },
        context,
      );

      expect(res.name).toBe('skill-1');
      expect(res.alwaysApply).toBe(true);

      const updated = JSON.parse(projectFS.readFile('_meta/skills.json')!);
      expect(updated.skills).toHaveLength(40);
      expect(updated.skills[0].description).toBe('Updated Skill 1');
      expect(updated.skills[0].alwaysApply).toBe(true);
    });
  });
});
