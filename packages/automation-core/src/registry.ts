// packages/automation-core/src/registry.ts
import { z } from 'zod';
import type {
  Operation,
  OperationKind,
  OperationEnvironment,
  Issue,
  Snapshot,
  OperationContext,
} from './contracts';

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const d: number[][] = [];
  for (let i = 0; i <= m; i++) d[i] = [i];
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    }
  }
  return d[m][n];
}

export function generateSchemaExample(schema: z.ZodTypeAny): unknown {
  try {
    const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
    return mockFromJsonSchema(jsonSchema);
  } catch {
    return {};
  }
}

function mockFromJsonSchema(schema: Record<string, unknown>): unknown {
  if (!schema) return null;
  const type = schema.type;
  if (type === 'string') {
    if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];
    return 'example-string';
  }
  if (type === 'number' || type === 'integer') return 0;
  if (type === 'boolean') return true;
  if (type === 'array') {
    const items = schema.items as Record<string, unknown> | undefined;
    return items ? [mockFromJsonSchema(items)] : [];
  }
  if (type === 'object') {
    const res: Record<string, unknown> = {};
    const props = (schema.properties || {}) as Record<string, Record<string, unknown>>;
    for (const [key, propSchema] of Object.entries(props)) {
      res[key] = mockFromJsonSchema(propSchema);
    }
    return res;
  }
  return null;
}

export class OperationRegistry {
  private operations = new Map<string, Operation<any, any>>();
  private aliases = new Map<string, string>();

  register<I, O>(operation: Operation<I, O>): void {
    if (this.operations.has(operation.name)) {
      throw new Error(`Operation "${operation.name}" is already registered`);
    }
    this.operations.set(operation.name, operation);
  }

  registerAlias(alias: string, canonicalName: string): void {
    if (!this.operations.has(canonicalName)) {
      throw new Error(`Cannot register alias "${alias}": canonical operation "${canonicalName}" does not exist`);
    }
    this.aliases.set(alias, canonicalName);
  }

  get(name: string): Operation<any, any> | undefined {
    const canonical = this.aliases.get(name) ?? name;
    return this.operations.get(canonical);
  }

  has(name: string): boolean {
    const canonical = this.aliases.get(name) ?? name;
    return this.operations.has(canonical);
  }

  list(): Operation<any, any>[] {
    return Array.from(this.operations.values());
  }

  findNearMatches(name: string, limit = 3): string[] {
    const names = Array.from(this.operations.keys());
    return names
      .map((n) => ({ name: n, distance: levenshtein(name.toLowerCase(), n.toLowerCase()) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, limit)
      .map((item) => item.name);
  }

  validateInput(name: string, input: unknown): { ok: true; data: unknown } | { ok: false; issues: Issue[] } {
    const op = this.get(name);
    if (!op) {
      return {
        ok: false,
        issues: [
          {
            code: 'UNKNOWN_OPERATION',
            path: [],
            message: `Operation "${name}" is not registered. Did you mean: ${this.findNearMatches(name).join(', ')}?`,
          },
        ],
      };
    }
    const result = op.inputSchema.safeParse(input);
    if (!result.success) {
      const issues: Issue[] = result.error.issues.map((err) => ({
        code: err.code,
        path: err.path as Array<string | number>,
        message: err.message,
      }));
      return { ok: false, issues };
    }
    return { ok: true, data: result.data };
  }
}

// Global registry instance
export const defaultRegistry = new OperationRegistry();

// Built-in meta tools implementation
export const metaIndexOperation: Operation<
  { category?: string; kind?: OperationKind; environment?: OperationEnvironment; page?: number; pageSize?: number },
  {
    operations: Array<{
      name: string;
      description: string;
      category: string;
      kind: OperationKind;
      environment: OperationEnvironment;
      ownerTask: string;
    }>;
    pagination: { page: number; pageSize: number; total: number; totalPages: number };
  }
> = {
  name: 'meta.index',
  description: 'List all registered operations with optional filtering and pagination',
  category: 'meta',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T01',
  inputSchema: z.object({
    category: z.string().optional(),
    kind: z.enum(['read', 'mutation', 'observation', 'service']).optional(),
    environment: z.enum(['headless', 'browser', 'service']).optional(),
    page: z.number().int().positive().optional().default(1),
    pageSize: z.number().int().positive().max(100).optional().default(50),
  }),
  async execute(_snapshot, input, _context) {
    let list = defaultRegistry.list();
    if (input.category) list = list.filter((op) => op.category === input.category);
    if (input.kind) list = list.filter((op) => op.kind === input.kind);
    if (input.environment) list = list.filter((op) => op.environment === input.environment);

    const total = list.length;
    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? 50;
    const totalPages = Math.ceil(total / pageSize) || 1;
    const start = (page - 1) * pageSize;
    const paged = list.slice(start, start + pageSize);

    return {
      operations: paged.map((op) => ({
        name: op.name,
        description: op.description,
        category: op.category,
        kind: op.kind,
        environment: op.environment,
        ownerTask: op.ownerTask,
      })),
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
      },
    };
  },
};

export const metaToolsOperation: Operation<
  { names?: string[]; name?: string; includeSchemas?: boolean },
  {
    tools: Array<{
      name: string;
      description: string;
      category: string;
      kind: OperationKind;
      environment: OperationEnvironment;
      inputSchema?: Record<string, unknown>;
      example?: unknown;
    }>;
    unresolved?: string[];
    suggestions?: Record<string, string[]>;
  }
> = {
  name: 'meta.tools',
  description: 'Inspect schemas, descriptions, and examples for registered operations',
  category: 'meta',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T01',
  inputSchema: z.object({
    names: z.array(z.string()).optional(),
    name: z.string().optional(),
    includeSchemas: z.boolean().optional().default(true),
  }),
  async execute(_snapshot, input, _context) {
    const requestedNames = input.name ? [input.name] : input.names ?? [];
    const tools: Array<{
      name: string;
      description: string;
      category: string;
      kind: OperationKind;
      environment: OperationEnvironment;
      inputSchema?: Record<string, unknown>;
      example?: unknown;
    }> = [];
    const unresolved: string[] = [];
    const suggestions: Record<string, string[]> = {};

    const targetOps = requestedNames.length > 0 ? requestedNames : defaultRegistry.list().map((op) => op.name);

    for (const name of targetOps) {
      const op = defaultRegistry.get(name);
      if (!op) {
        unresolved.push(name);
        suggestions[name] = defaultRegistry.findNearMatches(name);
        continue;
      }
      let jsonSchema: Record<string, unknown> | undefined;
      let example: unknown;
      if (input.includeSchemas !== false) {
        try {
          jsonSchema = z.toJSONSchema(op.inputSchema) as Record<string, unknown>;
          example = generateSchemaExample(op.inputSchema);
        } catch {
          // Schema conversion error fallback
        }
      }
      tools.push({
        name: op.name,
        description: op.description,
        category: op.category,
        kind: op.kind,
        environment: op.environment,
        inputSchema: jsonSchema,
        example,
      });
    }

    return {
      tools,
      ...(unresolved.length > 0 ? { unresolved, suggestions } : {}),
    };
  },
};

export const metaGuideOperation: Operation<
  { topic?: string },
  {
    topic: string;
    overview: string;
    recommendedWorkflow: string[];
    recipes: Array<{ title: string; steps: string[] }>;
  }
> = {
  name: 'meta.guide',
  description: 'Task-oriented guidance, bootstrapping instructions, and domain recipes',
  category: 'meta',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T01',
  inputSchema: z.object({
    topic: z.string().optional().default('general'),
  }),
  async execute(_snapshot, input, _context) {
    return {
      topic: input.topic ?? 'general',
      overview:
        'Revyme Automation v2 empowers CLI and MCP agents to author, inspect, and release complete Next.js landing pages headlessly with exact source parity.',
      recommendedWorkflow: [
        '1. doctor: Verify environment, dependencies, and project scope',
        '2. meta.index: Discover available tools for the domain',
        '3. meta.tools: Inspect exact JSON schemas and parameter examples',
        '4. plan: Construct or review intended atomic mutations',
        '5. commit: Commit verified byte changes through the durable revision service',
        '6. observe/verify: Check rendering, layout overflow, and visual evidence',
      ],
      recipes: [
        {
          title: 'Bootstrap Landing Page',
          steps: [
            'tokens.set: Configure brand tokens and color palette',
            'fonts.import: Preload Google or workspace typography',
            'pages.create: Create root layout and landing page route',
            'catalog.place: Place Navbar, Hero, and Sections from built-ins',
            'forms.set: Connect contact form with accessible inputs and destination',
            'metadata.update: Set SEO title, description, favicon, and social cards',
          ],
        },
      ],
    };
  },
};

// Register meta operations in defaultRegistry
defaultRegistry.register(metaIndexOperation);
defaultRegistry.register(metaToolsOperation);
defaultRegistry.register(metaGuideOperation);
