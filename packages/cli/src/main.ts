// packages/cli/src/main.ts
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { defaultRegistry } from '@revyme/automation-core';
import type { Scope } from '@revyme/automation-core';
import { loadConfig, initProjectConfig, findProjectRoot } from './config';
import { AutomationClient } from './client';
import { startStdioServer, createMcpServer } from './mcp';

export * from './config';
export * from './client';
export * from './mcp';

function parseCliTokens(args: string[]): { flags: Record<string, any>; positionals: string[] } {
  const flags: Record<string, any> = {};
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (token.startsWith('--')) {
      const raw = token.slice(2);
      if (raw.includes('=')) {
        const [k, ...v] = raw.split('=');
        flags[k] = v.join('=');
      } else {
        const next = args[i + 1];
        if (raw === 'dry-run' || raw === 'stdin') {
          flags[raw] = true;
        } else if (next !== undefined && !next.startsWith('-')) {
          flags[raw] = next;
          i++;
        } else {
          flags[raw] = true;
        }
      }
    } else if (token.startsWith('-') && token.length > 1) {
      if (token === '-') {
        flags.stdin = true;
      } else {
        const raw = token.slice(1);
        const next = args[i + 1];
        if (next !== undefined && !next.startsWith('-')) {
          flags[raw] = next;
          i++;
        } else {
          flags[raw] = true;
        }
      }
    } else {
      positionals.push(token);
    }
  }

  return { flags, positionals };
}

function coerceInputToSchema(input: Record<string, unknown>, schema: z.ZodType): Record<string, unknown> {
  let properties: Record<string, any>;
  try {
    const jsonSchema = z.toJSONSchema(schema) as { properties?: Record<string, any> };
    properties = jsonSchema.properties ?? {};
  } catch {
    return input;
  }

  return Object.fromEntries(Object.entries(input).map(([key, value]) => {
    if (typeof value !== 'string') return [key, value];
    const property = properties[key];
    const types = new Set<string>([
      ...(typeof property?.type === 'string' ? [property.type] : Array.isArray(property?.type) ? property.type : []),
      ...(property?.anyOf ?? []).map((option: any) => option?.type).filter((type: unknown): type is string => typeof type === 'string'),
      ...(property?.oneOf ?? []).map((option: any) => option?.type).filter((type: unknown): type is string => typeof type === 'string'),
    ]);

    if (types.has('boolean')) {
      if (value === 'true') return [key, true];
      if (value === 'false') return [key, false];
    }
    if (types.has('number') || types.has('integer')) {
      const number = Number(value);
      if (value.trim() !== '' && Number.isFinite(number)) return [key, number];
    }
    if (types.has('object') || types.has('array')) {
      try {
        const parsed = JSON.parse(value);
        if (types.has(Array.isArray(parsed) ? 'array' : 'object')) return [key, parsed];
      } catch {
        // Keep ordinary string values intact; schema validation will explain the mismatch.
      }
    }
    return [key, value];
  }));
}

export interface CliOptions {
  argv?: string[];
  stdout?: (msg: string) => void;
  stderr?: (msg: string) => void;
  stdinData?: string;
}

export async function runCli(options: CliOptions = {}): Promise<number> {
  const argv = options.argv || process.argv.slice(2);
  const printOut = options.stdout || ((msg: string) => console.log(msg));
  const printErr = options.stderr || ((msg: string) => console.error(msg));

  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h' || argv[0] === 'help') {
    printOut(`
Revyme Headless CLI & MCP v2

USAGE:
  revyme <command|tool> [options]

COMMANDS:
  doctor                     Verify environment, paths, config, and API status
  init <projectId>           Link current directory to a Revyme project
  mcp                        Start the Model Context Protocol (MCP) stdio server
  <toolName> [args]          Execute any automation tool directly

OPTIONS:
  --project-id <id>          Target project ID override
  --branch-id <branch>       Target branch ID override (default: main)
  --api <url>                Revyme server API URL (default: http://localhost:3000)
  --input-file <file>        Read JSON input from specified file path
  --stdin, -                 Read JSON input from standard input
  --dry-run                  Generate and validate plan without committing
  --format <json|text>       Output format (default: json)
  -v, --version              Print CLI version
  -h, --help                 Print this help guide

EXAMPLES:
  revyme doctor
  revyme init my-portfolio
  revyme meta.index --category meta
  revyme meta.tools --name pages.create
  revyme pages.create --input-file ./page.json --dry-run
  revyme mcp
`);
    return 0;
  }

  if (argv[0] === '--version' || argv[0] === '-v' || argv[0] === 'version') {
    printOut(JSON.stringify({ name: '@revyme/cli', version: '2.0.0' }, null, 2));
    return 0;
  }

  const firstArg = argv[0];

  // 1. doctor command
  if (firstArg === 'doctor') {
    const projectDir = findProjectRoot();
    const config = loadConfig(projectDir);
    const hasUnicode = /[^\u0000-\u007F]/.test(projectDir);
    const hasSpaces = /\s/.test(projectDir);

    const client = new AutomationClient({ apiUrl: config.apiUrl });
    let apiStatus: { ok: boolean; status?: any; error?: string } = { ok: false };

    if (config.projectId) {
      const res = await client.getStatus({ projectId: config.projectId, branchId: config.branchId });
      apiStatus = {
        ok: res.ok,
        status: res.data,
        error: res.error?.message,
      };
    }

    const report = {
      nodeVersion: process.version,
      projectDir,
      pathChecks: {
        hasUnicode,
        hasSpaces,
        valid: true,
      },
      config: {
        projectId: config.projectId || null,
        branchId: config.branchId,
        apiUrl: config.apiUrl,
        linked: Boolean(config.projectId),
      },
      registry: {
        registeredToolsCount: defaultRegistry.list().length,
      },
      api: apiStatus,
      doctorOk: true,
    };

    printOut(JSON.stringify(report, null, 2));
    return 0;
  }

  // 2. init command
  if (firstArg === 'init') {
    const projectId = argv[1];
    if (!projectId || projectId.startsWith('-')) {
      printErr(JSON.stringify({ ok: false, error: 'Usage: revyme init <projectId> [--branch <branch>]' }, null, 2));
      return 1;
    }
    const config = initProjectConfig(process.cwd(), projectId);
    printOut(JSON.stringify({ ok: true, message: `Project ${projectId} linked successfully`, config }, null, 2));
    return 0;
  }

  // 3. mcp command
  if (firstArg === 'mcp') {
    const config = loadConfig();
    const client = new AutomationClient({ apiUrl: config.apiUrl });
    await startStdioServer({ client, config });
    return 0;
  }

  // 4. Tool execution
  const toolName = firstArg;
  const toolArgs = argv.slice(1);

  const { flags } = parseCliTokens(toolArgs);

  const config = loadConfig(undefined, {
    projectId: flags['project-id'],
    branchId: flags['branch-id'],
    apiUrl: flags.api,
  });

  // Collect input data
  let inputData: Record<string, unknown> = {};

  if (flags['input-file']) {
    const filePath = path.resolve(process.cwd(), flags['input-file']);
    if (!fs.existsSync(filePath)) {
      printErr(
        JSON.stringify(
          {
            ok: false,
            error: {
              code: 'INPUT_FILE_NOT_FOUND',
              message: `Input file not found at: ${filePath}`,
              issues: [{ code: 'FILE_NOT_FOUND', path: ['input-file'], message: `File not found: ${filePath}` }],
            },
            meta: { commitStatus: 'not_committed', revision: 0 },
          },
          null,
          2
        )
      );
      return 1;
    }
    try {
      inputData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err: any) {
      printErr(
        JSON.stringify(
          {
            ok: false,
            error: {
              code: 'INVALID_JSON_INPUT',
              message: `Failed to parse input file JSON: ${err.message}`,
              issues: [{ code: 'JSON_SYNTAX_ERROR', path: ['input-file'], message: err.message }],
            },
            meta: { commitStatus: 'not_committed', revision: 0 },
          },
          null,
          2
        )
      );
      return 1;
    }
  } else if (flags.stdin || toolArgs.includes('-')) {
    let stdinStr = options.stdinData;
    if (stdinStr === undefined) {
      stdinStr = fs.readFileSync(0, 'utf8');
    }
    try {
      inputData = stdinStr.trim() ? JSON.parse(stdinStr) : {};
    } catch (err: any) {
      printErr(
        JSON.stringify(
          {
            ok: false,
            error: {
              code: 'INVALID_JSON_INPUT',
              message: `Failed to parse stdin JSON: ${err.message}`,
              issues: [{ code: 'JSON_SYNTAX_ERROR', path: ['stdin'], message: err.message }],
            },
            meta: { commitStatus: 'not_committed', revision: 0 },
          },
          null,
          2
        )
      );
      return 1;
    }
  } else {
    // Gather key-value arguments from flags
    for (const [key, val] of Object.entries(flags)) {
      if (!['project-id', 'branch-id', 'api', 'input-file', 'stdin', 'dry-run', 'format'].includes(key)) {
        inputData[key] = val;
      }
    }
  }

  const op = defaultRegistry.get(toolName);
  if (!op) {
    const suggestions = defaultRegistry.findNearMatches(toolName);
    printErr(
      JSON.stringify(
        {
          ok: false,
          error: {
            code: 'UNKNOWN_OPERATION',
            message: `Operation "${toolName}" is not registered. Did you mean: ${suggestions.join(', ')}?`,
            issues: [{ code: 'UNKNOWN_OPERATION', path: [], message: `Unknown operation "${toolName}"` }],
          },
          meta: { commitStatus: 'not_committed', revision: 0 },
        },
        null,
        2
      )
    );
    return 1;
  }

  inputData = coerceInputToSchema(inputData, op.inputSchema);

  if (op.category !== 'meta' && !config.projectId) {
    printErr(
      JSON.stringify(
        {
          ok: false,
          error: {
            code: 'MISSING_PROJECT_ID',
            message: `projectId is required to execute "${toolName}". Provide it via --project-id, in .revymelocal/automation.json, or via REVYME_PROJECT_ID.`,
            issues: [{ code: 'MISSING_PROJECT_ID', path: ['project-id'], message: 'Missing project ID' }],
          },
          meta: { commitStatus: 'not_committed', revision: 0 },
        },
        null,
        2
      )
    );
    return 1;
  }

  const scope: Scope = {
    projectId: config.projectId || 'meta-project',
    branchId: config.branchId,
  };

  const client = new AutomationClient({ apiUrl: config.apiUrl });
  const result = await client.execute(scope, toolName, inputData, {
    dryRun: Boolean(flags['dry-run']),
  });

  if (result.ok) {
    printOut(JSON.stringify(result, null, 2));
    return 0;
  } else {
    printErr(JSON.stringify(result, null, 2));
    return 1;
  }
}

// Auto-run if executed directly as entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  runCli().then((code) => {
    if (code !== 0) process.exit(code);
  });
}
