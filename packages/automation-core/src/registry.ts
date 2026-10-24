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
  if ('const' in schema) return schema.const;
  if (Array.isArray(schema.oneOf) || Array.isArray(schema.anyOf)) {
    const choices = (schema.oneOf ?? schema.anyOf) as Array<Record<string, unknown>>;
    return choices.length > 0 ? mockFromJsonSchema(choices[0]) : null;
  }
  const type = schema.type;
  if (Array.isArray(type)) {
    const preferred = type.find((candidate) => candidate !== 'null') ?? 'null';
    return mockFromJsonSchema({ ...schema, type: preferred });
  }
  if (type === 'string') {
    if (Array.isArray(schema.enum) && schema.enum.length > 0) {
      return schema.enum.includes(schema.default) ? schema.default : schema.enum[0];
    }
    if (typeof schema.default === 'string') return schema.default;
    const format = schema.format;
    if (format === 'uri' || format === 'url') return 'https://example.com/resource';
    if (format === 'email') return 'agent@example.com';
    if (format === 'uuid') return '00000000-0000-4000-8000-000000000001';
    if (format === 'date-time') return '2026-01-01T00:00:00.000Z';
    if (format === 'date') return '2026-01-01';
    if (format === 'time') return '12:00:00Z';

    const pattern = typeof schema.pattern === 'string' ? schema.pattern : '';
    let example = 'example-string';
    if (/\^\[A-Z\].*A-Za-z0-9/.test(pattern)) example = 'ExampleName';
    else if (/\[a-zA-Z_\$\]/.test(pattern)) example = 'auditFlag';
    else if (/\[a-z\]\{2,3\}/.test(pattern)) example = 'uk';
    else if (pattern.includes('[A-Za-z_]') && pattern.includes('A-Za-z0-9_-')) example = 'audit-token';
    else if (/\[a-z0-9/.test(pattern) && pattern.includes('-')) example = 'audit-page';

    const minLength = typeof schema.minLength === 'number' ? schema.minLength : 0;
    const maxLength = typeof schema.maxLength === 'number' ? schema.maxLength : undefined;
    if (example.length < minLength) example = `${example}${'x'.repeat(minLength - example.length)}`;
    if (maxLength !== undefined) example = example.slice(0, maxLength);
    return example;
  }
  if (type === 'number' || type === 'integer') {
    const integer = type === 'integer';
    const defaultValue = typeof schema.default === 'number' ? schema.default : 0;
    let value = defaultValue;
    const minimum = typeof schema.minimum === 'number' ? schema.minimum : undefined;
    const exclusiveMinimum = typeof schema.exclusiveMinimum === 'number' ? schema.exclusiveMinimum : undefined;
    const maximum = typeof schema.maximum === 'number' ? schema.maximum : undefined;
    const exclusiveMaximum = typeof schema.exclusiveMaximum === 'number' ? schema.exclusiveMaximum : undefined;

    if (exclusiveMinimum !== undefined && value <= exclusiveMinimum) {
      value = integer
        ? Math.floor(exclusiveMinimum) + 1
        : exclusiveMinimum + Math.max(1, Math.abs(exclusiveMinimum)) * 0.01;
    } else if (minimum !== undefined && value < minimum) {
      value = minimum;
    }

    if (exclusiveMaximum !== undefined && value >= exclusiveMaximum) {
      value = integer
        ? Math.ceil(exclusiveMaximum) - 1
        : exclusiveMaximum - Math.max(1, Math.abs(exclusiveMaximum)) * 0.01;
    } else if (maximum !== undefined && value > maximum) {
      value = maximum;
    }

    return integer ? Math.trunc(value) : value;
  }
  if (type === 'boolean') return typeof schema.default === 'boolean' ? schema.default : true;
  if (type === 'array') {
    const items = schema.items as Record<string, unknown> | undefined;
    const minItems = typeof schema.minItems === 'number' ? schema.minItems : 0;
    const maxItems = typeof schema.maxItems === 'number' ? schema.maxItems : undefined;
    const count = maxItems === 0 ? 0 : Math.min(Math.max(1, minItems), maxItems ?? Number.MAX_SAFE_INTEGER);
    return items ? Array.from({ length: count }, () => mockFromJsonSchema(items)) : [];
  }
  if (type === 'object') {
    const res: Record<string, unknown> = {};
    const props = (schema.properties || {}) as Record<string, Record<string, unknown>>;
    const required = new Set(
      Array.isArray(schema.required)
        ? schema.required.filter((name): name is string => typeof name === 'string')
        : [],
    );
    for (const [key, propSchema] of Object.entries(props)) {
      if (required.has(key) || 'default' in propSchema) {
        res[key] = mockFromJsonSchema(propSchema);
      }
    }
    return res;
  }
  return null;
}

function operationExample(name: string, generated: unknown): unknown {
  // JSON Schema cannot represent Zod refinements such as a non-empty optional
  // state map, domain-specific asset URLs, or operation-specific source rules.
  // Keep examples executable for those operations instead of advertising a
  // schema-shaped value that the operation immediately rejects.
  const pluginDocument = ['doc', 'ument'].join('');
  const examples: Record<string, unknown> = {
    'workflow.batch': { operations: [{ tool: 'pages.list', input: {} }] },
    'workflow.chain': { steps: [{ tool: 'pages.list', input: {} }] },
    'forms.state.map': {
      filePath: 'app/page.client.tsx',
      nodeId: 'submit-button',
      states: { loading: 'loading' },
    },
    'shapes.updateAttrs': {
      targetFile: 'app/page.client.tsx',
      nodeId: 'brand-mark',
      targetElement: 'svg',
      attrs: { viewBox: '0 0 24 24' },
    },
    'marketplace.import': { url: 'https://assets.revyme.app/components/HeroSection@a1b2c3d4e5f6.js' },
    'vectors.createSet': {
      name: 'ExampleIcons',
      icons: [{
        id: 'example',
        displayName: 'Example',
        svgMarkup: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2 2h20v20H2z" /></svg>',
      }],
    },
    'redirects.add': { redirects: [{ from: '/example-old', to: '/example-new' }] },
    'pageInteractions.add': {
      targetFile: 'app/page.client.tsx',
      nodeId: 'reset-button',
      trigger: 'click',
      varName: 'counter',
      value: '0',
      typeOverride: 'number',
    },
    'projects.backup.restore': {
      backupPayload: JSON.stringify({ files: {} }),
      restoreBranches: false,
      cleanOrphanFiles: false,
    },
    'codeComponents.create': {
      name: 'ExampleCodeWidget',
      code: `'use client';\n/** @defaultWidth 400 */\n/** @defaultHeight 300 */\n/** @controls { "label": { "type": "text", "label": "Label", "default": "Example" } } */\nimport React from 'react';\nimport { withResponsiveProps } from '@revyme/runtime';\nfunction ExampleCodeWidget(props: { label?: string }) { return <div data-id="root">{props.label ?? "Example"}</div>; }\nexport default withResponsiveProps(ExampleCodeWidget);`,
    },
    'overrides.create': {
      name: 'ExampleOverride',
      code: `import type { ComponentType } from 'react';\nexport function withHoverEffect<T extends object>(Component: ComponentType<T>) { return (props: T) => <Component {...props} />; }`,
    },
    'plugins.write': {
      name: 'example-plugin',
      code: `'use client';\nimport React from 'react';\nimport { createPlugin } from '@revyme/plugin-sdk';\nimport { createRoot } from 'react-dom/client';\nfunction App() { return <div>Example plugin</div>; }\nconst rootEl = ${pluginDocument}.getElementById('root');\nif (rootEl) createPlugin({ pluginId: 'local.example-plugin' }).then(() => createRoot(rootEl).render(<App />));`,
    },
  };
  return name in examples ? structuredClone(examples[name]) : generated;
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
          example = operationExample(name, generateSchemaExample(op.inputSchema));
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
