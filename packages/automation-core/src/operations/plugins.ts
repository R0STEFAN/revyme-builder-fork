// packages/automation-core/src/operations/plugins.ts
import { z } from 'zod';
import type { Operation, FileChange, Snapshot, OperationContext } from '../contracts';
import { FileChangeSchema } from '../contracts';
import { defaultRegistry } from '../registry';
import { projectFS } from '@/code/project/project-fs';
import { parseJSX } from '@/code/parsing/ast-utils';
import { parseComponentName } from '@/code/components/component-ops';
import { syncCodeSnapshotToProjectFS } from './code-components';

export const PLUGINS_DIR = 'plugins/';
export const PLUGIN_EXT = '.tsx';
export const PLUGIN_DATA_DIR = '_meta/plugin-data/';
export const SECRETS_DIR = '_meta/secrets/';

export function isPluginFilePath(path: string): boolean {
  return path.startsWith(PLUGINS_DIR) && path.endsWith(PLUGIN_EXT);
}

export function pluginPathToName(path: string): string {
  return path.replace(/^plugins\//, '').replace(/\.tsx$/, '');
}

export function assertValidPluginId(pluginId: string): void {
  const clean = pluginId.trim();
  if (!clean) {
    throw new Error('INVALID_PLUGIN_ID: pluginId cannot be empty.');
  }
  if (
    clean.includes('..') ||
    clean.includes('/') ||
    clean.includes('\\') ||
    clean.includes('\0') ||
    !/^[a-zA-Z0-9_.-]+$/.test(clean)
  ) {
    throw new Error(`INVALID_PLUGIN_ID: pluginId "${clean}" contains invalid characters or path traversal.`);
  }
}

export function toPascalCase(input: string): string {
  const words = input
    .replace(/[^a-zA-Z0-9_-]+/g, ' ')
    .trim()
    .split(/[\s-_]+/);
  if (words.length === 0 || !words[0]) return 'Plugin';
  return words
    .map((w) => {
      if (w.length > 1 && /[A-Z]/.test(w.slice(1)) && !/^[A-Z]+$/.test(w)) {
        return w.charAt(0).toUpperCase() + w.slice(1);
      }
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join('');
}

export function checkPluginSource(code: string, _expectedName?: string): string[] {
  const problems: string[] = [];

  // 1. TSX Parse
  const ast = parseJSX(code);
  if (!ast) {
    problems.push('The file does not parse as TSX');
    return problems;
  }

  // 2. @revyme/plugin-sdk and createPlugin
  const hasSdkImport = /from\s+['"]@revyme\/plugin-sdk['"]/.test(code);
  const hasCreatePluginCall = /\bcreatePlugin\s*\(/.test(code);
  if (!hasSdkImport || !hasCreatePluginCall) {
    problems.push("Must import { createPlugin } from '@revyme/plugin-sdk' and call `createPlugin({ pluginId })`");
  }

  // 3. react-dom/client and createRoot
  const hasReactDomImport = /from\s+['"]react-dom\/client['"]/.test(code);
  const hasCreateRoot = /\bcreateRoot\s*\(/.test(code);
  const mountsToRoot =
    /createRoot\s*\(\s*document\.getElementById\(\s*['"]root['"]\s*\)\s*\)/.test(code) ||
    (hasCreateRoot && /document\.getElementById\(\s*['"]root['"]\s*\)/.test(code));
  if (!hasReactDomImport || !hasCreateRoot || !mountsToRoot) {
    problems.push("Must import { createRoot } from 'react-dom/client' and render the App into document.getElementById('root')");
  }

  // 4. pluginId: local.<name>
  const pluginIdMatch = code.match(/pluginId\s*:\s*['"](local\.[a-z0-9-]+)['"]/);
  if (!pluginIdMatch) {
    problems.push('createPlugin needs { pluginId: "local.<lower-kebab-name>" }');
  }

  // 5. No default export
  if (/export\s+default\b/.test(code)) {
    problems.push('A plugin file has no default export — it mounts itself with createRoot(...).render(...)');
  }

  // 6. No relative or @/ imports
  for (const m of code.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)) {
    const spec = m[1];
    if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('@/')) {
      problems.push(`Import "${spec}" is not allowed — a plugin is ONE self-contained file; only bare npm packages resolve (esm.sh) plus react, react-dom/client, @revyme/plugin-sdk`);
    }
  }

  // 7. No deprecated SDK methods
  const DEPRECATED_METHODS_REGEX = /(?:plugin\.revyme\.|revyme\.)?(variables\.(get|set)|assets\.setImage|components\.addDetachedComponentLayers|codeFiles\.(lint|typecheck|getVersions))\b/;
  if (DEPRECATED_METHODS_REGEX.test(code)) {
    problems.push('Uses an SDK method marked [NOT_IMPLEMENTED] in the plugin manual — it throws at runtime');
  }

  return problems;
}

// ─── 1. plugins.list ──────────────────────────────────────────────────────────

export const pluginsListInputSchema = z.object({});
export type PluginsListInput = z.infer<typeof pluginsListInputSchema>;

export interface PluginListItem {
  file: string;
  name: string;
  displayName: string;
  display_name?: string;
}

export const pluginsListOutputSchema = z.object({
  plugins: z.array(
    z.object({
      file: z.string(),
      name: z.string(),
      displayName: z.string(),
      display_name: z.string().optional(),
    }),
  ),
});
export type PluginsListOutput = z.infer<typeof pluginsListOutputSchema>;

export const pluginsListOperation: Operation<PluginsListInput, PluginsListOutput> = {
  name: 'plugins.list',
  description: 'List project editor plugins with their file paths, internal names, and display names',
  category: 'plugins',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T22',
  inputSchema: pluginsListInputSchema,
  outputSchema: pluginsListOutputSchema,
  async execute(snapshot, _input, context: OperationContext) {
    syncCodeSnapshotToProjectFS(snapshot);
    const files = projectFS.listFiles().filter(isPluginFilePath).sort();
    const plugins: PluginListItem[] = files.map((file) => {
      const name = pluginPathToName(file);
      const code = projectFS.readFile(file) ?? '';
      const displayName = parseComponentName(code) || name;
      return {
        file,
        name,
        displayName,
        display_name: displayName,
      };
    });

    context?.trace?.('plugins.list', { count: plugins.length });

    return { plugins };
  },
};

// ─── 2. plugins.write ─────────────────────────────────────────────────────────

export const pluginsWriteInputSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
});
export type PluginsWriteInput = z.infer<typeof pluginsWriteInputSchema>;

export const pluginsWriteOutputSchema = z.object({
  file: z.string(),
  name: z.string(),
  replaced: z.boolean(),
  changes: z.array(FileChangeSchema),
});
export type PluginsWriteOutput = z.infer<typeof pluginsWriteOutputSchema>;

export const pluginsWriteOperation: Operation<PluginsWriteInput, PluginsWriteOutput> = {
  name: 'plugins.write',
  description: 'Author or replace a self-contained editor plugin file under plugins/<Name>.tsx with validation',
  category: 'plugins',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T22',
  inputSchema: pluginsWriteInputSchema,
  outputSchema: pluginsWriteOutputSchema,
  async execute(snapshot, rawInput, context: OperationContext) {
    const input = pluginsWriteInputSchema.parse(rawInput);
    const sync = syncCodeSnapshotToProjectFS(snapshot);
    const name = toPascalCase(input.name.trim());
    const code = input.code;

    const problems = checkPluginSource(code, name);
    if (problems.length > 0) {
      throw new Error(`VALIDATION_ERROR: The plugin was not written:\n- ${problems.join('\n- ')}`);
    }

    const filePath = `${PLUGINS_DIR}${name}${PLUGIN_EXT}`;
    const existed = projectFS.exists(filePath);

    projectFS.writeFile(filePath, code);
    context?.trace?.('plugins.write', { filePath, replaced: existed, bytes: code.length });

    return {
      file: filePath,
      name,
      replaced: existed,
      changes: sync.collectChanges(),
    };
  },
};

// ─── 3. plugins.data.get ──────────────────────────────────────────────────────

export const pluginsDataGetInputSchema = z.object({
  pluginId: z.string().min(1),
  key: z.string().min(1),
});
export type PluginsDataGetInput = z.infer<typeof pluginsDataGetInputSchema>;

export const pluginsDataGetOutputSchema = z.object({
  key: z.string(),
  value: z.unknown(),
});
export type PluginsDataGetOutput = z.infer<typeof pluginsDataGetOutputSchema>;

export const pluginsDataGetOperation: Operation<PluginsDataGetInput, PluginsDataGetOutput> = {
  name: 'plugins.data.get',
  description: 'Read a plugin storage key from _meta/plugin-data/<pluginId>.json',
  category: 'plugins',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T22',
  inputSchema: pluginsDataGetInputSchema,
  outputSchema: pluginsDataGetOutputSchema,
  async execute(snapshot, rawInput, context: OperationContext) {
    const input = pluginsDataGetInputSchema.parse(rawInput);
    syncCodeSnapshotToProjectFS(snapshot);
    assertValidPluginId(input.pluginId);

    const filePath = `${PLUGIN_DATA_DIR}${input.pluginId}.json`;
    const content = projectFS.readFile(filePath);

    context?.trace?.('plugins.data.get', { pluginId: input.pluginId, key: input.key });

    if (!content) {
      return { key: input.key, value: null };
    }

    try {
      const data = JSON.parse(content);
      const val = data && typeof data === 'object' && input.key in data ? data[input.key] : null;
      return { key: input.key, value: val };
    } catch {
      return { key: input.key, value: null };
    }
  },
};

// ─── 4. plugins.data.set ──────────────────────────────────────────────────────

export const pluginsDataSetInputSchema = z.object({
  pluginId: z.string().min(1),
  key: z.string().min(1),
  value: z.unknown(),
});
export type PluginsDataSetInput = z.infer<typeof pluginsDataSetInputSchema>;

export const pluginsDataSetOutputSchema = z.object({
  key: z.string(),
  changes: z.array(FileChangeSchema),
});
export type PluginsDataSetOutput = z.infer<typeof pluginsDataSetOutputSchema>;

export const pluginsDataSetOperation: Operation<PluginsDataSetInput, PluginsDataSetOutput> = {
  name: 'plugins.data.set',
  description: 'Write a plugin storage key to _meta/plugin-data/<pluginId>.json',
  category: 'plugins',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T22',
  inputSchema: pluginsDataSetInputSchema,
  outputSchema: pluginsDataSetOutputSchema,
  async execute(snapshot, rawInput, context: OperationContext) {
    const input = pluginsDataSetInputSchema.parse(rawInput);
    const sync = syncCodeSnapshotToProjectFS(snapshot);
    assertValidPluginId(input.pluginId);

    const filePath = `${PLUGIN_DATA_DIR}${input.pluginId}.json`;
    const existingContent = projectFS.readFile(filePath);

    let data: Record<string, unknown> = {};
    if (existingContent) {
      try {
        const parsed = JSON.parse(existingContent);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          data = parsed;
        }
      } catch {
        data = {};
      }
    }

    data[input.key] = input.value;
    const serialized = JSON.stringify(data, null, 2);

    projectFS.writeFile(filePath, serialized);
    context?.trace?.('plugins.data.set', { pluginId: input.pluginId, key: input.key });

    return {
      key: input.key,
      changes: sync.collectChanges(),
    };
  },
};

// ─── 5. plugins.secrets.request ───────────────────────────────────────────────

export const pluginsSecretsRequestInputSchema = z.object({
  pluginId: z.string().min(1),
  secretName: z.string().min(1),
  value: z.string().min(1),
});
export type PluginsSecretsRequestInput = z.infer<typeof pluginsSecretsRequestInputSchema>;

export const pluginsSecretsRequestOutputSchema = z.object({
  secretName: z.string(),
  configured: z.boolean(),
});
export type PluginsSecretsRequestOutput = z.infer<typeof pluginsSecretsRequestOutputSchema>;

const VAULT_KEY_BYTES = 'revyme-vault-rotate-on-publish';

export function xorEncrypt(plain: string): string {
  let out = '';
  for (let i = 0; i < plain.length; i++) {
    out += String.fromCharCode(plain.charCodeAt(i) ^ VAULT_KEY_BYTES.charCodeAt(i % VAULT_KEY_BYTES.length));
  }
  return Buffer.from(out, 'binary').toString('base64');
}

export function xorDecrypt(cipher: string): string {
  try {
    const raw = Buffer.from(cipher, 'base64').toString('binary');
    let out = '';
    for (let i = 0; i < raw.length; i++) {
      out += String.fromCharCode(raw.charCodeAt(i) ^ VAULT_KEY_BYTES.charCodeAt(i % VAULT_KEY_BYTES.length));
    }
    return out;
  } catch {
    return '';
  }
}

export const pluginsSecretsRequestOperation: Operation<
  PluginsSecretsRequestInput,
  PluginsSecretsRequestOutput
> = {
  name: 'plugins.secrets.request',
  description: 'Store encrypted/redacted plugin secret in secrets store or metadata without leaking secrets to code/logs',
  category: 'plugins',
  kind: 'service',
  permit: 'write',
  environment: 'service',
  ownerTask: 'T22',
  inputSchema: pluginsSecretsRequestInputSchema,
  outputSchema: pluginsSecretsRequestOutputSchema,
  async execute(snapshot, rawInput, context: OperationContext) {
    const input = pluginsSecretsRequestInputSchema.parse(rawInput);
    syncCodeSnapshotToProjectFS(snapshot);
    assertValidPluginId(input.pluginId);

    // SECURITY: Do not log or expose raw secret value in traces or results
    context?.trace?.('plugins.secrets.request', {
      pluginId: input.pluginId,
      secretName: input.secretName,
      configured: true,
    });

    const credentialsAdapter = context?.adapters?.credentials as
      | { setSecret?(pluginId: string, name: string, value: string): Promise<void> | void }
      | undefined;
    if (typeof credentialsAdapter?.setSecret === 'function') {
      await credentialsAdapter.setSecret(input.pluginId, input.secretName, input.value);
      return { secretName: input.secretName, configured: true };
    }

    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(`revyme:secrets:${input.pluginId}:${input.secretName}`, xorEncrypt(input.value));
    }

    const secretFilePath = `${SECRETS_DIR}${input.pluginId}.json`;
    let secrets: Record<string, string> = {};
    const existing = projectFS.readFile(secretFilePath);
    if (existing) {
      try {
        const parsed = JSON.parse(existing);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          secrets = parsed;
        }
      } catch {
        secrets = {};
      }
    }

    secrets[input.secretName] = xorEncrypt(input.value);
    const serialized = JSON.stringify(secrets, null, 2);
    projectFS.writeFile(secretFilePath, serialized);
    if (snapshot?.files && 'set' in snapshot.files) {
      (snapshot.files as Map<string, string>).set(secretFilePath, serialized);
    }

    return {
      secretName: input.secretName,
      configured: true,
    };
  },
};

// ─── Default Registry Registration & Aliases ──────────────────────────────────

defaultRegistry.register(pluginsListOperation);
defaultRegistry.register(pluginsWriteOperation);
defaultRegistry.register(pluginsDataGetOperation);
defaultRegistry.register(pluginsDataSetOperation);
defaultRegistry.register(pluginsSecretsRequestOperation);

defaultRegistry.registerAlias('list_plugins', 'plugins.list');
defaultRegistry.registerAlias('plugins.listPlugins', 'plugins.list');
defaultRegistry.registerAlias('plugin.list', 'plugins.list');
defaultRegistry.registerAlias('plugins.get', 'plugins.list');

defaultRegistry.registerAlias('write_plugin', 'plugins.write');
defaultRegistry.registerAlias('plugins.writePlugin', 'plugins.write');
defaultRegistry.registerAlias('plugin.write', 'plugins.write');

defaultRegistry.registerAlias('plugins.dataGet', 'plugins.data.get');
defaultRegistry.registerAlias('plugins.getData', 'plugins.data.get');
defaultRegistry.registerAlias('plugin.data.get', 'plugins.data.get');

defaultRegistry.registerAlias('plugins.dataSet', 'plugins.data.set');
defaultRegistry.registerAlias('plugins.setData', 'plugins.data.set');
defaultRegistry.registerAlias('plugin.data.set', 'plugins.data.set');

defaultRegistry.registerAlias('plugins.secretsRequest', 'plugins.secrets.request');
defaultRegistry.registerAlias('plugins.requestSecret', 'plugins.secrets.request');
defaultRegistry.registerAlias('plugins.setSecret', 'plugins.secrets.request');
