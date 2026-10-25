// packages/cli/src/config.ts
import fs from 'node:fs';
import path from 'node:path';

export interface ProjectConfig {
  projectId?: string;
  branchId: string;
  apiUrl: string;
  projectDir: string;
}

const SENSITIVE_KEY_PATTERNS = [/token/i, /secret/i, /password/i, /key/i, /auth/i, /credential/i];

export function sanitizeConfig(raw: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(raw)) {
    const isSensitive = SENSITIVE_KEY_PATTERNS.some((pat) => pat.test(key));
    if (!isSensitive) {
      clean[key] = val;
    }
  }
  return clean;
}

export function findProjectRoot(startDir?: string): string {
  let current = path.resolve(startDir || process.cwd());
  const root = path.parse(current).root;

  while (current && current !== root) {
    if (
      fs.existsSync(path.join(current, '.revymelocal')) ||
      fs.existsSync(path.join(current, 'app')) ||
      fs.existsSync(path.join(current, 'revyme.config.json')) ||
      fs.existsSync(path.join(current, 'package.json'))
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return path.resolve(startDir || process.cwd());
}

export function loadConfig(cwd?: string, overrides?: Partial<ProjectConfig>): ProjectConfig {
  const projectDir = findProjectRoot(cwd);
  let fileConfig: Record<string, unknown> = {};

  const candidateFiles = [
    path.join(projectDir, '.revymelocal', 'automation.json'),
    path.join(projectDir, '.revymelocal', 'config.json'),
    path.join(projectDir, 'revyme.config.json'),
  ];

  for (const file of candidateFiles) {
    if (fs.existsSync(file)) {
      try {
        const content = fs.readFileSync(file, 'utf8');
        fileConfig = JSON.parse(content);
        break;
      } catch {
        // Ignore unparseable config file
      }
    }
  }

  const cleanFileConfig = sanitizeConfig(fileConfig);

  const projectId =
    overrides?.projectId ||
    process.env.REVYME_PROJECT_ID ||
    (typeof cleanFileConfig.projectId === 'string' ? cleanFileConfig.projectId : undefined);

  const branchId =
    overrides?.branchId ||
    process.env.REVYME_BRANCH_ID ||
    (typeof cleanFileConfig.branchId === 'string' ? cleanFileConfig.branchId : 'main');

  const apiUrl =
    overrides?.apiUrl ||
    process.env.REVYME_API_URL ||
    (typeof cleanFileConfig.apiUrl === 'string' ? cleanFileConfig.apiUrl : 'http://localhost:3333');

  return {
    projectId,
    branchId,
    apiUrl,
    projectDir: overrides?.projectDir || projectDir,
  };
}

export function saveConfig(cwd: string, config: Partial<ProjectConfig>): string {
  const projectDir = findProjectRoot(cwd);
  const localDir = path.join(projectDir, '.revymelocal');
  if (!fs.existsSync(localDir)) {
    fs.mkdirSync(localDir, { recursive: true });
  }

  const configPath = path.join(localDir, 'automation.json');
  const safeData = sanitizeConfig(config as Record<string, unknown>);

  fs.writeFileSync(configPath, JSON.stringify(safeData, null, 2), 'utf8');
  return configPath;
}

export function initProjectConfig(
  cwd: string,
  projectId: string,
  branchId = 'main',
  apiUrl = 'http://localhost:3333'
): ProjectConfig {
  const projectDir = findProjectRoot(cwd);
  const config: ProjectConfig = {
    projectId,
    branchId,
    apiUrl,
    projectDir,
  };
  saveConfig(projectDir, config);
  return config;
}
