// packages/automation-core/test/capabilities/T22-extensions.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import type { Snapshot } from '../../src/contracts';
import { createSnapshot, createOperationContext } from '../../src/session';
import { defaultRegistry } from '../../src/registry';
import '../../src/index';
import {
  skillsListOperation,
  skillsSaveOperation,
  SKILL_NAME_REGEX,
} from '../../src/operations/project-skills';
import {
  pluginsListOperation,
  pluginsWriteOperation,
  pluginsDataGetOperation,
  pluginsDataSetOperation,
  pluginsSecretsRequestOperation,
  xorDecrypt,
  assertValidPluginId,
} from '../../src/operations/plugins';
import {
  marketplaceBrowseOperation,
  marketplaceImportOperation,
  marketplacePublishListingOperation,
  ASSET_SHARE_URL_REGEX,
  CANONICAL_MARKETPLACE_ITEMS,
  LISTINGS_STORAGE_PATH,
} from '../../src/operations/marketplace';
import { projectFS } from '@/code/project/project-fs';
import { SKILLS_FILE_PATH, SKILL_CONTENT_MAX } from '@/code/project/skills-config';

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function createMockSnapshot(files: Record<string, string>, revision = 1): Snapshot {
  return createSnapshot({ projectId: 'test-project', branchId: 'main' }, revision, files);
}

const VALID_PLUGIN_SOURCE = `'use client';
import React from 'react';
import { createPlugin } from '@revyme/plugin-sdk';
import { createRoot } from 'react-dom/client';

function App() {
  return <div>Plugin Content</div>;
}

const rootEl = document.getElementById('root');
if (rootEl) {
  createPlugin({ pluginId: 'local.test-plugin' }).then(() => {
    createRoot(rootEl).render(<App />);
  });
}
`;

describe('T22: Plugins, Marketplace, Project Skills & Service Access', () => {
  const context = createOperationContext();

  beforeEach(() => {
    projectFS.loadSnapshot(new Map());
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Group 1: Registry Registration & Compatibility Aliases
  // ───────────────────────────────────────────────────────────────────────────
  describe('1. Registry Registration & Aliases', () => {
    const requiredOps = [
      'plugins.list',
      'plugins.write',
      'plugins.data.get',
      'plugins.data.set',
      'plugins.secrets.request',
      'marketplace.browse',
      'marketplace.import',
      'marketplace.publishListing',
      'skills.list',
      'skills.save',
    ];

    it('registers all 10 canonical T22 operations with ownerTask="T22"', () => {
      for (const name of requiredOps) {
        const op = defaultRegistry.get(name);
        expect(op, `Operation "${name}" should be registered`).toBeDefined();
        expect(op?.name).toBe(name);
        expect(op?.ownerTask).toBe('T22');
      }
    });

    it('resolves all compatibility aliases', () => {
      const aliasMap: Record<string, string> = {
        'list_plugins': 'plugins.list',
        'plugins.listPlugins': 'plugins.list',
        'plugin.list': 'plugins.list',
        'plugins.get': 'plugins.list',
        'write_plugin': 'plugins.write',
        'plugins.writePlugin': 'plugins.write',
        'plugin.write': 'plugins.write',
        'plugins.dataGet': 'plugins.data.get',
        'plugins.getData': 'plugins.data.get',
        'plugin.data.get': 'plugins.data.get',
        'plugins.dataSet': 'plugins.data.set',
        'plugins.setData': 'plugins.data.set',
        'plugin.data.set': 'plugins.data.set',
        'plugins.secretsRequest': 'plugins.secrets.request',
        'plugins.requestSecret': 'plugins.secrets.request',
        'plugins.setSecret': 'plugins.secrets.request',
        'marketplace.search': 'marketplace.browse',
        'marketplace.list': 'marketplace.browse',
        'marketplace.install': 'marketplace.import',
        'marketplace.importAsset': 'marketplace.import',
        'marketplace.publish': 'marketplace.publishListing',
        'marketplace.share': 'marketplace.publishListing',
        'marketplace.createListing': 'marketplace.publishListing',
        'project-skills.list': 'skills.list',
        'project-skills.save': 'skills.save',
        'skills.create': 'skills.save',
      };

      for (const [alias, canonical] of Object.entries(aliasMap)) {
        const op = defaultRegistry.get(alias);
        expect(op, `Alias "${alias}" should resolve`).toBeDefined();
        expect(op?.name).toBe(canonical);
      }
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Group 2: Plugins Lifecycle, Data & Secrets
  // ───────────────────────────────────────────────────────────────────────────
  describe('2. Plugins Lifecycle & Data', () => {
    it('plugins.list: returns empty array when no plugins exist', async () => {
      const snap = createMockSnapshot({});
      const res = await pluginsListOperation.execute(snap, {}, context);
      expect(res.plugins).toEqual([]);
    });

    it('plugins.list: discovers plugin files with @name or fallback to filename', async () => {
      const pluginWithAnnotation = `/** @name "Custom Color Tool" */\n` + VALID_PLUGIN_SOURCE;
      const snap = createMockSnapshot({
        'plugins/ColorTool.tsx': pluginWithAnnotation,
        'plugins/PlainTool.tsx': VALID_PLUGIN_SOURCE,
        'components/Unrelated.tsx': `'use client'; export default function Unrelated() { return null; }`,
      });

      const res = await pluginsListOperation.execute(snap, {}, context);
      expect(res.plugins).toHaveLength(2);
      expect(res.plugins[0].name).toBe('ColorTool');
      expect(res.plugins[0].displayName).toBe('Custom Color Tool');
      expect(res.plugins[0].display_name).toBe('Custom Color Tool');
      expect(res.plugins[1].name).toBe('PlainTool');
      expect(res.plugins[1].displayName).toBe('PlainTool');
    });

    it('plugins.write: validates TSX, imports, and writes to plugins/<Name>.tsx', async () => {
      const snap = createMockSnapshot({});
      const res = await pluginsWriteOperation.execute(
        snap,
        { name: 'test-plugin', code: VALID_PLUGIN_SOURCE },
        context,
      );

      expect(res.file).toBe('plugins/TestPlugin.tsx');
      expect(res.name).toBe('TestPlugin');
      expect(res.replaced).toBe(false);
      expect(res.changes).toHaveLength(1);
      expect(res.changes[0].path).toBe('plugins/TestPlugin.tsx');
      expect(res.changes[0].beforeHash).toBeNull();
      expect(res.changes[0].content).toBe(VALID_PLUGIN_SOURCE);
    });

    it('plugins.write: updates existing plugin tracking replaced: true and beforeHash', async () => {
      const initialSnapshot = createMockSnapshot({
        'plugins/TestPlugin.tsx': VALID_PLUGIN_SOURCE,
      });

      const updatedCode = VALID_PLUGIN_SOURCE.replace('Plugin Content', 'Updated Plugin Content');
      const res = await pluginsWriteOperation.execute(
        initialSnapshot,
        { name: 'TestPlugin', code: updatedCode },
        context,
      );

      expect(res.file).toBe('plugins/TestPlugin.tsx');
      expect(res.name).toBe('TestPlugin');
      expect(res.replaced).toBe(true);
      expect(res.changes).toHaveLength(1);
      expect(res.changes[0].beforeHash).toBe(sha256(VALID_PLUGIN_SOURCE));
      expect(res.changes[0].content).toBe(updatedCode);
    });

    it('plugins.write: rejects non-TSX or malformed plugins', async () => {
      const snap = createMockSnapshot({});
      await expect(
        pluginsWriteOperation.execute(
          snap,
          { name: 'broken', code: 'const a = <div broken' },
          context,
        ),
      ).rejects.toThrow(/TSX/i);
    });

    it('plugins.write: rejects missing @revyme/plugin-sdk or createPlugin call', async () => {
      const snap = createMockSnapshot({});
      const codeWithoutSdk = `'use client';
import React from 'react';
import { createRoot } from 'react-dom/client';
createRoot(document.getElementById('root')).render(<div>App</div>);
`;
      await expect(
        pluginsWriteOperation.execute(
          snap,
          { name: 'no-sdk', code: codeWithoutSdk },
          context,
        ),
      ).rejects.toThrow(/@revyme\/plugin-sdk/i);
    });

    it('plugins.write: rejects missing createRoot or root mounting', async () => {
      const snap = createMockSnapshot({});
      const codeWithoutRoot = `'use client';
import { createPlugin } from '@revyme/plugin-sdk';
createPlugin({ pluginId: 'local.my-plugin' });
`;
      await expect(
        pluginsWriteOperation.execute(
          snap,
          { name: 'no-root', code: codeWithoutRoot },
          context,
        ),
      ).rejects.toThrow(/createRoot/i);
    });

    it('plugins.write: rejects missing or invalid pluginId format', async () => {
      const snap = createMockSnapshot({});
      const codeBadPluginId = VALID_PLUGIN_SOURCE.replace('local.test-plugin', 'invalid_id_format');
      await expect(
        pluginsWriteOperation.execute(
          snap,
          { name: 'bad-plugin-id', code: codeBadPluginId },
          context,
        ),
      ).rejects.toThrow(/pluginId/i);
    });

    it('plugins.write: rejects export default in plugin files', async () => {
      const snap = createMockSnapshot({});
      const codeWithDefaultExport = VALID_PLUGIN_SOURCE + '\nexport default App;\n';
      await expect(
        pluginsWriteOperation.execute(
          snap,
          { name: 'with-export', code: codeWithDefaultExport },
          context,
        ),
      ).rejects.toThrow(/default export/i);
    });

    it('plugins.write: rejects relative and @/ imports', async () => {
      const snap = createMockSnapshot({});
      const invalidCode1 = VALID_PLUGIN_SOURCE + '\nimport { helper } from "./helper";';
      await expect(
        pluginsWriteOperation.execute(
          snap,
          { name: 'rel-import', code: invalidCode1 },
          context,
        ),
      ).rejects.toThrow(/not allowed/i);

      const invalidCode2 = VALID_PLUGIN_SOURCE + '\nimport { util } from "@/code/utils";';
      await expect(
        pluginsWriteOperation.execute(
          snap,
          { name: 'alias-import', code: invalidCode2 },
          context,
        ),
      ).rejects.toThrow(/not allowed/i);
    });

    it('plugins.write: rejects deprecated SDK methods', async () => {
      const snap = createMockSnapshot({});
      const deprecatedMethods = [
        'plugin.revyme.variables.get("var")',
        'plugin.revyme.variables.set("var", 1)',
        'plugin.revyme.assets.setImage("id", "url")',
        'plugin.revyme.components.addDetachedComponentLayers()',
        'plugin.revyme.codeFiles.lint("path")',
        'plugin.revyme.codeFiles.typecheck("path")',
        'plugin.revyme.codeFiles.getVersions("path")',
      ];

      for (const call of deprecatedMethods) {
        const invalidCode = VALID_PLUGIN_SOURCE.replace('<div>Plugin Content</div>', `<div>${call}</div>`);
        await expect(
          pluginsWriteOperation.execute(
            snap,
            { name: 'deprecated-plugin', code: invalidCode },
            context,
          ),
          `Should reject deprecated SDK method: ${call}`,
        ).rejects.toThrow(/NOT_IMPLEMENTED/i);
      }
    });

    it('plugins.data: sets and gets key-value data under _meta/plugin-data/', async () => {
      const snap = createMockSnapshot({});
      const setRes = await pluginsDataSetOperation.execute(
        snap,
        { pluginId: 'local.my-plugin', key: 'theme', value: { mode: 'dark', accent: '#0055ff' } },
        context,
      );
      expect(setRes.key).toBe('theme');
      expect(setRes.changes).toHaveLength(1);
      expect(setRes.changes[0].path).toBe('_meta/plugin-data/local.my-plugin.json');

      const getRes = await pluginsDataGetOperation.execute(
        snap,
        { pluginId: 'local.my-plugin', key: 'theme' },
        context,
      );
      expect(getRes.key).toBe('theme');
      expect(getRes.value).toEqual({ mode: 'dark', accent: '#0055ff' });
    });

    it('plugins.data: preserves sibling keys on sequential updates', async () => {
      const snap = createMockSnapshot({});
      await pluginsDataSetOperation.execute(
        snap,
        { pluginId: 'local.multi-key', key: 'key1', value: 'value1' },
        context,
      );
      await pluginsDataSetOperation.execute(
        snap,
        { pluginId: 'local.multi-key', key: 'key2', value: 42 },
        context,
      );

      const res1 = await pluginsDataGetOperation.execute(
        snap,
        { pluginId: 'local.multi-key', key: 'key1' },
        context,
      );
      const res2 = await pluginsDataGetOperation.execute(
        snap,
        { pluginId: 'local.multi-key', key: 'key2' },
        context,
      );
      expect(res1.value).toBe('value1');
      expect(res2.value).toBe(42);
    });

    it('plugins.data: returns null for non-existent key or missing file', async () => {
      const snap = createMockSnapshot({});
      const res = await pluginsDataGetOperation.execute(
        snap,
        { pluginId: 'local.non-existent', key: 'missing' },
        context,
      );
      expect(res.key).toBe('missing');
      expect(res.value).toBeNull();
    });

    it('plugins.data: isolates data between distinct plugins', async () => {
      const snap = createMockSnapshot({});
      await pluginsDataSetOperation.execute(
        snap,
        { pluginId: 'local.plugin-a', key: 'sharedKey', value: 'Alpha' },
        context,
      );
      await pluginsDataSetOperation.execute(
        snap,
        { pluginId: 'local.plugin-b', key: 'sharedKey', value: 'Beta' },
        context,
      );

      const a = await pluginsDataGetOperation.execute(
        snap,
        { pluginId: 'local.plugin-a', key: 'sharedKey' },
        context,
      );
      const b = await pluginsDataGetOperation.execute(
        snap,
        { pluginId: 'local.plugin-b', key: 'sharedKey' },
        context,
      );
      expect(a.value).toBe('Alpha');
      expect(b.value).toBe('Beta');
    });

    it('plugins.data & secrets: rejects path traversal in pluginId', async () => {
      const snap = createMockSnapshot({});
      const invalidPluginIds = ['../../evil', 'local/traversal', 'plugin\\slash', 'local\0null'];
      for (const pluginId of invalidPluginIds) {
        expect(() => assertValidPluginId(pluginId)).toThrow(/INVALID_PLUGIN_ID/i);
        await expect(
          pluginsDataGetOperation.execute(snap, { pluginId, key: 'k' }, context),
        ).rejects.toThrow();
        await expect(
          pluginsDataSetOperation.execute(snap, { pluginId, key: 'k', value: 'v' }, context),
        ).rejects.toThrow();
        await expect(
          pluginsSecretsRequestOperation.execute(snap, { pluginId, secretName: 's', value: 'v' }, context),
        ).rejects.toThrow();
      }
    });

    it('plugins.secrets.request: configures encrypted secret with zero plaintext leakage', async () => {
      const snap = createMockSnapshot({});
      const secretPlaintext = 'super-secret-api-key-98765';

      let traceLogCalls: Array<Record<string, unknown>> = [];
      const tracingContext = {
        ...context,
        trace: (_event: string, data: Record<string, unknown>) => {
          traceLogCalls.push(data);
        },
      };

      const res = await pluginsSecretsRequestOperation.execute(
        snap,
        { pluginId: 'local.my-plugin', secretName: 'STRIPE_KEY', value: secretPlaintext },
        tracingContext,
      );

      expect(res.secretName).toBe('STRIPE_KEY');
      expect(res.configured).toBe(true);

      // 1. Result does NOT contain the secret plaintext
      expect(JSON.stringify(res)).not.toContain(secretPlaintext);

      // 2. Traces do NOT log the secret plaintext
      for (const call of traceLogCalls) {
        expect(JSON.stringify(call)).not.toContain(secretPlaintext);
      }

      // 3. File in ProjectFS contains encrypted cipher, decryptable with xorDecrypt
      const secretFile = projectFS.readFile('_meta/secrets/local.my-plugin.json');
      expect(secretFile).toBeDefined();
      expect(secretFile).not.toContain(secretPlaintext);

      const parsed = JSON.parse(secretFile!);
      expect(parsed.STRIPE_KEY).toBeDefined();
      expect(xorDecrypt(parsed.STRIPE_KEY)).toBe(secretPlaintext);
    });

    it('plugins.secrets.request: delegates to context.adapters.credentials when provided', async () => {
      const snap = createMockSnapshot({});
      let delegatedSecret: { pluginId: string; name: string; value: string } | null = null;
      const adapterContext = {
        ...context,
        adapters: {
          credentials: {
            setSecret: (pluginId: string, name: string, value: string) => {
              delegatedSecret = { pluginId, name, value };
            },
          },
        },
      };

      const res = await pluginsSecretsRequestOperation.execute(
        snap,
        { pluginId: 'local.delegated', secretName: 'OAUTH_TOKEN', value: 'token-xyz' },
        adapterContext,
      );

      expect(res.secretName).toBe('OAUTH_TOKEN');
      expect(res.configured).toBe(true);
      expect(delegatedSecret).toEqual({
        pluginId: 'local.delegated',
        name: 'OAUTH_TOKEN',
        value: 'token-xyz',
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Group 3: Marketplace Operations
  // ───────────────────────────────────────────────────────────────────────────
  describe('3. Marketplace Integration', () => {
    it('marketplace.browse: queries available items and returns all canonical items', async () => {
      const snap = createMockSnapshot({});
      const res = await marketplaceBrowseOperation.execute(snap, {}, context);
      expect(res.items).toHaveLength(CANONICAL_MARKETPLACE_ITEMS.length);
      expect(res.items.map((i) => i.id)).toEqual(CANONICAL_MARKETPLACE_ITEMS.map((i) => i.id));
    });

    it('marketplace.browse: filters by kind (component, vector, template)', async () => {
      const snap = createMockSnapshot({});
      const comps = await marketplaceBrowseOperation.execute(snap, { kind: 'component' }, context);
      expect(comps.items.every((i) => i.kind === 'component')).toBe(true);
      expect(comps.items.length).toBeGreaterThan(0);

      const vecs = await marketplaceBrowseOperation.execute(snap, { kind: 'vector' }, context);
      expect(vecs.items.every((i) => i.kind === 'vector')).toBe(true);
      expect(vecs.items.length).toBeGreaterThan(0);

      const tpls = await marketplaceBrowseOperation.execute(snap, { kind: 'template' }, context);
      expect(tpls.items.every((i) => i.kind === 'template')).toBe(true);
      expect(tpls.items.length).toBeGreaterThan(0);
    });

    it('marketplace.browse: filters by text query across name and description', async () => {
      const snap = createMockSnapshot({});
      const res = await marketplaceBrowseOperation.execute(snap, { query: 'pricing' }, context);
      expect(res.items.some((i) => i.name === 'PricingTable')).toBe(true);
      expect(res.items.every((i) => i.name.toLowerCase().includes('pricing') || i.description.toLowerCase().includes('pricing'))).toBe(true);
    });

    it('marketplace.browse: delegates to context.adapters.marketplaceClient if present', async () => {
      const snap = createMockSnapshot({});
      const customItem = {
        id: 'custom-1',
        name: 'CustomCard',
        kind: 'component',
        url: 'https://assets.revyme.app/components/CustomCard@1234.js',
        description: 'Custom card',
        pricingType: 'free',
      };
      const customContext = {
        ...context,
        adapters: {
          marketplaceClient: {
            browse: async () => ({ items: [customItem] }),
          },
        },
      };

      const res = await marketplaceBrowseOperation.execute(snap, {}, customContext);
      expect(res.items).toEqual([customItem]);
    });

    it('marketplace.import: validates URL and creates proxy component under components/remote/', async () => {
      const snap = createMockSnapshot({});
      const validUrl = 'https://assets.revyme.app/components/HeroSection@a1b2c3d4e5f6.js';
      const res = await marketplaceImportOperation.execute(snap, { url: validUrl }, context);

      expect(res.componentName).toBe('HeroSection');
      expect(res.localPath).toBe('components/remote/HeroSection.tsx');
      expect(res.versionHash).toBe('a1b2c3d4e5f6');
      expect(res.changes).toHaveLength(1);
      expect(res.changes[0].path).toBe('components/remote/HeroSection.tsx');
      expect(res.changes[0].beforeHash).toBeNull();

      const writtenCode = projectFS.readFile('components/remote/HeroSection.tsx');
      expect(writtenCode).toContain("'use client';");
      expect(writtenCode).toContain('/** @name "HeroSection" */');
      expect(writtenCode).toContain(`import RemoteComponent from '${validUrl}';`);
      expect(writtenCode).toContain('export default withResponsiveProps(HeroSection);');
    });

    it('marketplace.import: creates vector proxy with name prop default for vectors category', async () => {
      const snap = createMockSnapshot({});
      const vectorUrl = 'https://assets.revyme.app/vectors/FeatherIcons@f6a1b2c3d4e5.js';
      const res = await marketplaceImportOperation.execute(snap, { url: vectorUrl }, context);

      expect(res.componentName).toBe('FeatherIcons');
      expect(res.localPath).toBe('components/remote/FeatherIcons.tsx');
      expect(res.versionHash).toBe('f6a1b2c3d4e5');

      const writtenCode = projectFS.readFile('components/remote/FeatherIcons.tsx');
      expect(writtenCode).toContain('RemoteVector');
      expect(writtenCode).toContain("name = 'icon-1'");
    });

    it('marketplace.import: converts kebab-case raw name to PascalCase', async () => {
      const snap = createMockSnapshot({});
      const kebabUrl = 'https://assets.revyme.app/components/hero-pricing-card@b2c3d4e5f6a1.js';
      const res = await marketplaceImportOperation.execute(snap, { url: kebabUrl }, context);

      expect(res.componentName).toBe('HeroPricingCard');
      expect(res.localPath).toBe('components/remote/HeroPricingCard.tsx');
    });

    it('marketplace.import: supports custom targetPath with validation', async () => {
      const snap = createMockSnapshot({});
      const validUrl = 'https://assets.revyme.app/components/NavbarFloating@c3d4e5f6a1b2.js';
      const res = await marketplaceImportOperation.execute(
        snap,
        { url: validUrl, targetPath: 'components/custom/CustomNavbar.tsx' },
        context,
      );

      expect(res.localPath).toBe('components/custom/CustomNavbar.tsx');
      expect(projectFS.exists('components/custom/CustomNavbar.tsx')).toBe(true);
    });

    it('marketplace.import: rejects invalid domains, http protocols, and path traversal in targetPath', async () => {
      const snap = createMockSnapshot({});
      const invalidUrls = [
        'http://assets.revyme.app/components/Hero@1234.js',
        'https://evil.com/components/Hero@1234.js',
        'https://assets.revyme.app/invalid/Hero@1234.js',
        'https://assets.revyme.app/components/HeroMissingHash.js',
      ];

      for (const url of invalidUrls) {
        expect(ASSET_SHARE_URL_REGEX.test(url)).toBe(false);
        await expect(
          marketplaceImportOperation.execute(snap, { url }, context),
        ).rejects.toThrow();
      }

      await expect(
        marketplaceImportOperation.execute(
          snap,
          {
            url: 'https://assets.revyme.app/components/Hero@1234abcd.js',
            targetPath: '../evil.tsx',
          },
          context,
        ),
      ).rejects.toThrow(/SECURITY_ERROR/i);
    });

    it('marketplace.publishListing: creates draft listing in _meta/marketplace-listings.json', async () => {
      const componentSource = `'use client';
import React from 'react';
export default function MyCard() {
  return <div data-id="root">Card</div>;
}
`;
      const snap = createMockSnapshot({
        'components/MyCard.tsx': componentSource,
      });

      const res = await marketplacePublishListingOperation.execute(
        snap,
        {
          path: 'components/MyCard.tsx',
          name: 'MyCard',
          kind: 'component',
          description: 'A clean card component',
          pricingType: 'free',
          publish: false,
        },
        context,
      );

      expect(res.listingId).toBeDefined();
      expect(res.status).toBe('draft');
      expect(res.action).toBe('created');
      expect(res.versionHash).toBe(sha256(componentSource).slice(0, 16));
      expect(res.componentUrl).toContain('https://assets.revyme.app/components/MyCard@');

      const storage = projectFS.readFile(LISTINGS_STORAGE_PATH);
      expect(storage).toBeDefined();
      const parsed = JSON.parse(storage!);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].name).toBe('MyCard');
      expect(parsed[0].status).toBe('draft');
    });

    it('marketplace.publishListing: updates existing listing in place preserving id and createdAt', async () => {
      const componentSource = `'use client'; export default function Card() { return <div data-id="root" />; }`;
      const initialListing = [
        {
          id: 'lst-existing-1',
          name: 'Card',
          path: 'components/Card.tsx',
          kind: 'component',
          description: 'Original description',
          pricingType: 'free',
          status: 'draft',
          componentUrl: 'https://assets.revyme.app/components/Card@123.js',
          versionHash: '123',
          createdAt: '2026-10-01T00:00:00.000Z',
          updatedAt: '2026-10-01T00:00:00.000Z',
        },
      ];
      const snap = createMockSnapshot({
        'components/Card.tsx': componentSource,
        [LISTINGS_STORAGE_PATH]: JSON.stringify(initialListing),
      });

      const res = await marketplacePublishListingOperation.execute(
        snap,
        {
          path: 'components/Card.tsx',
          name: 'Card',
          description: 'Updated description',
        },
        context,
      );

      expect(res.listingId).toBe('lst-existing-1');
      expect(res.action).toBe('updated');

      const listings = JSON.parse(projectFS.readFile(LISTINGS_STORAGE_PATH)!);
      expect(listings).toHaveLength(1);
      expect(listings[0].id).toBe('lst-existing-1');
      expect(listings[0].createdAt).toBe('2026-10-01T00:00:00.000Z');
      expect(listings[0].description).toBe('Updated description');
    });

    it('marketplace.publishListing: transitions to pending review when publish=true with thumbnailUrl', async () => {
      const componentSource = `'use client'; export default function Nav() { return <nav data-id="root" />; }`;
      const snap = createMockSnapshot({
        'components/Nav.tsx': componentSource,
      });

      const res = await marketplacePublishListingOperation.execute(
        snap,
        {
          path: 'components/Nav.tsx',
          name: 'Nav',
          publish: true,
          thumbnailUrl: 'https://assets.revyme.app/thumbs/nav.png',
        },
        context,
      );

      expect(res.status).toBe('pending');
    });

    it('marketplace.publishListing: keeps status as draft when publish=true but thumbnailUrl is missing', async () => {
      const componentSource = `'use client'; export default function Nav() { return <nav data-id="root" />; }`;
      const snap = createMockSnapshot({
        'components/Nav.tsx': componentSource,
      });

      const res = await marketplacePublishListingOperation.execute(
        snap,
        {
          path: 'components/Nav.tsx',
          name: 'Nav',
          publish: true,
          // No thumbnailUrl provided
        },
        context,
      );

      expect(res.status).toBe('draft');
    });

    it('marketplace.publishListing: rejects paid listing with zero or missing priceCents', async () => {
      const componentSource = `'use client'; export default function PaidComp() { return <div data-id="root" />; }`;
      const snap = createMockSnapshot({
        'components/PaidComp.tsx': componentSource,
      });

      await expect(
        marketplacePublishListingOperation.execute(
          snap,
          {
            path: 'components/PaidComp.tsx',
            name: 'PaidComp',
            pricingType: 'paid',
            // priceCents omitted
          },
          context,
        ),
      ).rejects.toThrow(/VALIDATION_ERROR/i);

      await expect(
        marketplacePublishListingOperation.execute(
          snap,
          {
            path: 'components/PaidComp.tsx',
            name: 'PaidComp',
            pricingType: 'paid',
            priceCents: 0,
          },
          context,
        ),
      ).rejects.toThrow(/VALIDATION_ERROR/i);
    });

    it('marketplace.publishListing: rejects non-existent component file', async () => {
      const snap = createMockSnapshot({});
      await expect(
        marketplacePublishListingOperation.execute(
          snap,
          {
            path: 'components/DoesNotExist.tsx',
            name: 'DoesNotExist',
          },
          context,
        ),
      ).rejects.toThrow(/not found/i);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Group 4: Project Skills
  // ───────────────────────────────────────────────────────────────────────────
  describe('4. Project Skills', () => {
    it('skills.list: lists skills from _meta/skills.json', async () => {
      const initialSkills = {
        version: 1,
        skills: [
          {
            name: 'brand-voice',
            description: 'Brand Voice Rules',
            content: '- Keep sentences short.\n- Avoid exclamation marks.',
            alwaysApply: true,
            createdAt: 1000,
            updatedAt: 2000,
          },
        ],
      };
      const snap = createMockSnapshot({
        [SKILLS_FILE_PATH]: JSON.stringify(initialSkills),
      });

      const res = await skillsListOperation.execute(snap, {}, context);
      expect(res.skills).toHaveLength(1);
      expect(res.skills[0]).toEqual({
        name: 'brand-voice',
        description: 'Brand Voice Rules',
        alwaysApply: true,
        charCount: initialSkills.skills[0].content.length,
      });
    });

    it('skills.list: discovers skills with frontmatter from .agents/skills/', async () => {
      const skillMd = `---
name: design-tokens
description: Design token consistency rules
alwaysApply: false
---
# Rules
Always use CSS variables for colors.
`;
      const directSkillMd = `---
name: direct-skill
description: Direct markdown skill
alwaysApply: true
---
Direct body content.
`;
      const snap = createMockSnapshot({
        '.agents/skills/design-tokens/SKILL.md': skillMd,
        '.agents/skills/direct-skill.md': directSkillMd,
      });

      const res = await skillsListOperation.execute(snap, {}, context);
      expect(res.skills.some((s) => s.name === 'design-tokens')).toBe(true);
      expect(res.skills.some((s) => s.name === 'direct-skill')).toBe(true);

      const tokenSkill = res.skills.find((s) => s.name === 'design-tokens');
      expect(tokenSkill?.description).toBe('Design token consistency rules');
      expect(tokenSkill?.alwaysApply).toBe(false);
      expect(tokenSkill?.charCount).toBeGreaterThan(0);

      const directSkill = res.skills.find((s) => s.name === 'direct-skill');
      expect(directSkill?.description).toBe('Direct markdown skill');
      expect(directSkill?.alwaysApply).toBe(true);
    });

    it('skills.list: reconciles _meta/skills.json and .agents/skills/ with precedence', async () => {
      const metaSkills = {
        version: 1,
        skills: [
          {
            name: 'common-skill',
            description: 'Explicit Project Description',
            content: 'Project specific instruction',
            alwaysApply: true,
            createdAt: 1000,
            updatedAt: 2000,
          },
        ],
      };
      const workspaceSkillMd = `---
name: common-skill
description: Workspace Description
alwaysApply: false
---
Workspace instruction
`;
      const snap = createMockSnapshot({
        [SKILLS_FILE_PATH]: JSON.stringify(metaSkills),
        '.agents/skills/common-skill/SKILL.md': workspaceSkillMd,
      });

      const res = await skillsListOperation.execute(snap, {}, context);
      const skill = res.skills.find((s) => s.name === 'common-skill');
      expect(skill?.description).toBe('Explicit Project Description');
      expect(skill?.alwaysApply).toBe(true);
    });

    it('skills.save: creates a new skill in _meta/skills.json with FileChange', async () => {
      const snap = createMockSnapshot({});
      const res = await skillsSaveOperation.execute(
        snap,
        {
          name: 'seo-audit',
          description: 'SEO check before publish',
          content: 'Ensure each page has a single h1 and meta tags.',
          alwaysApply: true,
        },
        context,
      );

      expect(res.name).toBe('seo-audit');
      expect(res.alwaysApply).toBe(true);
      expect(res.changes).toHaveLength(1);
      expect(res.changes[0].path).toBe(SKILLS_FILE_PATH);
      expect(res.changes[0].beforeHash).toBeNull();

      const savedJson = JSON.parse(res.changes[0].content!);
      expect(savedJson.version).toBe(1);
      expect(savedJson.skills).toHaveLength(1);
      expect(savedJson.skills[0].name).toBe('seo-audit');
      expect(savedJson.skills[0].alwaysApply).toBe(true);
    });

    it('skills.save: updates an existing skill in place preserving createdAt', async () => {
      const initialSkills = {
        version: 1,
        skills: [
          {
            name: 'seo-audit',
            description: 'Initial description',
            content: 'Initial content',
            alwaysApply: false,
            createdAt: 12345,
            updatedAt: 12345,
          },
        ],
      };
      const snap = createMockSnapshot({
        [SKILLS_FILE_PATH]: JSON.stringify(initialSkills),
      });

      const res = await skillsSaveOperation.execute(
        snap,
        {
          name: 'seo-audit',
          description: 'Updated description',
          content: 'Updated content with more rules',
          alwaysApply: true,
        },
        context,
      );

      expect(res.name).toBe('seo-audit');
      expect(res.alwaysApply).toBe(true);

      const savedJson = JSON.parse(res.changes[0].content!);
      expect(savedJson.skills[0].createdAt).toBe(12345);
      expect(savedJson.skills[0].updatedAt).toBeGreaterThanOrEqual(12345);
      expect(savedJson.skills[0].description).toBe('Updated description');
    });

    it('skills.save: renames an existing skill with previousName', async () => {
      const initialSkills = {
        version: 1,
        skills: [
          {
            name: 'old-name',
            description: 'My skill',
            content: 'My content',
            alwaysApply: false,
            createdAt: 1000,
            updatedAt: 1000,
          },
        ],
      };
      const snap = createMockSnapshot({
        [SKILLS_FILE_PATH]: JSON.stringify(initialSkills),
      });

      const res = await skillsSaveOperation.execute(
        snap,
        {
          name: 'new-name',
          previousName: 'old-name',
          description: 'My skill renamed',
          content: 'My content',
        },
        context,
      );

      expect(res.name).toBe('new-name');
      const savedJson = JSON.parse(res.changes[0].content!);
      expect(savedJson.skills.some((s: any) => s.name === 'old-name')).toBe(false);
      expect(savedJson.skills.some((s: any) => s.name === 'new-name')).toBe(true);
    });

    it('skills.save: rejects rename if previousName does not exist or new name already exists', async () => {
      const initialSkills = {
        version: 1,
        skills: [
          {
            name: 'skill-a',
            description: 'Skill A',
            content: 'Content A',
            alwaysApply: false,
            createdAt: 1000,
            updatedAt: 1000,
          },
          {
            name: 'skill-b',
            description: 'Skill B',
            content: 'Content B',
            alwaysApply: false,
            createdAt: 1000,
            updatedAt: 1000,
          },
        ],
      };
      const snap = createMockSnapshot({
        [SKILLS_FILE_PATH]: JSON.stringify(initialSkills),
      });

      await expect(
        skillsSaveOperation.execute(
          snap,
          {
            name: 'new-skill',
            previousName: 'non-existent',
            description: 'D',
            content: 'C',
          },
          context,
        ),
      ).rejects.toThrow(/SKILL_NOT_FOUND/i);

      await expect(
        skillsSaveOperation.execute(
          snap,
          {
            name: 'skill-b',
            previousName: 'skill-a',
            description: 'D',
            content: 'C',
          },
          context,
        ),
      ).rejects.toThrow(/SKILL_EXISTS/i);
    });

    it('skills.save: rejects invalid skill names failing regex /^[a-z0-9-]+$/', async () => {
      const snap = createMockSnapshot({});
      const invalidNames = ['Brand Voice', 'BrandVoice', 'brand_voice', 'brand.voice', 'brand!', ''];
      for (const name of invalidNames) {
        expect(SKILL_NAME_REGEX.test(name)).toBe(false);
        await expect(
          skillsSaveOperation.execute(
            snap,
            { name, description: 'Test', content: 'Instructions' },
            context,
          ),
          `Should reject invalid name "${name}"`,
        ).rejects.toThrow();
      }
    });

    it('skills.save: rejects content exceeding 8000 characters', async () => {
      const snap = createMockSnapshot({});
      const oversizedContent = 'a'.repeat(SKILL_CONTENT_MAX + 1);
      await expect(
        skillsSaveOperation.execute(
          snap,
          { name: 'oversized', description: 'Test', content: oversizedContent },
          context,
        ),
      ).rejects.toThrow();
    });

    it('skills.save: enforces maximum project skills limit (40 skills)', async () => {
      const skills = Array.from({ length: 40 }, (_, i) => ({
        name: `skill-${i + 1}`,
        description: `Description ${i + 1}`,
        content: `Instructions ${i + 1}`,
        alwaysApply: false,
        createdAt: 1000,
        updatedAt: 1000,
      }));
      const snap = createMockSnapshot({
        [SKILLS_FILE_PATH]: JSON.stringify({ version: 1, skills }),
      });

      await expect(
        skillsSaveOperation.execute(
          snap,
          { name: 'skill-41', description: '41st skill', content: 'Should fail' },
          context,
        ),
      ).rejects.toThrow(/limit/i);
    });
  });
});
