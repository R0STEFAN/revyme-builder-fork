// packages/automation-core/src/operations/components.ts
import { z } from 'zod';
import type { Operation, FileChange, Snapshot } from '../contracts';
import { defaultRegistry } from '../registry';
import {
  buildCreatedMaster,
  type CreateComponentSpec,
  type CreateLayoutNode,
} from '@/code/generation/create-component-gen';
import {
  buildExtractedMaster,
} from '@/code/generation/extract-component-gen';
import {
  replaceComponentInstanceInCode,
} from '@/code/generation/replace-component-gen';
import { parseComponentFile, type ComponentInfo } from '@/code/components/component-registry';
import { parseVariantConfig } from '@/code/variants/variant-config';
import { parsePropMeta } from '@/code/components/prop-meta';
import { parseJSXToNodes } from '@/code/parsing/parser';
import { parseJSX, traverse } from '@/code/parsing/ast-utils';
import { findInstanceTag } from '@/code/components/instance-prop-overrides';
import { scanTagAttrs } from '@/code/components/jsx-tag-attrs';
import { simpleHash } from '@/shared/hash-utils';

export function ensureComponentImport(code: string, componentName: string): string {
  const importRegex = new RegExp(`import\\s+${componentName}\\s+from\\s+['"]@/components/${componentName}['"]`);
  if (importRegex.test(code)) return code;

  const importLine = `import ${componentName} from '@/components/${componentName}';`;
  const lastImportMatch = Array.from(code.matchAll(/^import\s+[^;]+;(?:\r?\n)?/gm)).pop();
  if (lastImportMatch && lastImportMatch.index !== undefined) {
    const insertPos = lastImportMatch.index + lastImportMatch[0].length;
    return code.slice(0, insertPos) + importLine + '\n' + code.slice(insertPos);
  }
  return importLine + '\n' + code;
}

export function pruneComponentImport(code: string, componentName: string): string {
  const regex = new RegExp(`^import\\s+${componentName}\\s+from\\s+['"]@/components/${componentName}['"];?\\r?\\n?`, 'm');
  return code.replace(regex, '');
}

// 1. components.list
export const componentsListOperation: Operation<
  Record<string, never>,
  {
    components: Array<{
      name: string;
      filePath: string;
      props: ComponentInfo['props'];
      variants: Array<{ name: string; label: string; isPrimary?: boolean }>;
      isCodeComponent: boolean;
    }>;
  }
> = {
  name: 'components.list',
  description: 'List all design and code components in the project with prop definitions and variants',
  category: 'components',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T09',
  inputSchema: z.object({}),
  async execute(snapshot) {
    const results: Array<{
      name: string;
      filePath: string;
      props: ComponentInfo['props'];
      variants: Array<{ name: string; label: string; isPrimary?: boolean }>;
      isCodeComponent: boolean;
    }> = [];

    for (const [filePath, content] of snapshot.files.entries()) {
      if (!filePath.startsWith('components/') || !filePath.endsWith('.tsx')) continue;

      const hash = simpleHash(content);
      const parsed = parseComponentFile(filePath, content, hash);
      if (!parsed) continue;

      const variants = parseVariantConfig(content);

      results.push({
        name: parsed.name,
        filePath,
        props: parsed.props,
        variants: variants.map((v) => ({
          name: v.name,
          label: v.label || v.name,
          isPrimary: v.isPrimary,
        })),
        isCodeComponent: parsed.controlsMeta !== null,
      });
    }

    return { components: results };
  },
};

// 2. components.get
export const componentsGetOperation: Operation<
  { name: string },
  {
    component: {
      name: string;
      filePath: string;
      props: ComponentInfo['props'];
      variants: Array<{ name: string; label: string; isPrimary?: boolean }>;
      propMeta: Record<string, unknown>;
      isCodeComponent: boolean;
    } | null;
  }
> = {
  name: 'components.get',
  description: 'Get component metadata, variants, prop types, and default values by name',
  category: 'components',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T09',
  inputSchema: z.object({
    name: z.string().min(1),
  }),
  async execute(snapshot, input) {
    const filePath = `components/${input.name}.tsx`;
    const content = snapshot.files.get(filePath);

    if (!content) {
      return { component: null };
    }

    const hash = simpleHash(content);
    const parsed = parseComponentFile(filePath, content, hash);
    if (!parsed) {
      return { component: null };
    }

    const variants = parseVariantConfig(content);
    const propMeta = parsePropMeta(content);

    return {
      component: {
        name: parsed.name,
        filePath,
        props: parsed.props,
        variants: variants.map((v) => ({
          name: v.name,
          label: v.label || v.name,
          isPrimary: v.isPrimary,
        })),
        propMeta,
        isCodeComponent: parsed.controlsMeta !== null,
      },
    };
  },
};

// 3. components.create
export const componentsCreateOperation: Operation<
  {
    name: string;
    props: Array<{
      name: string;
      type: 'string' | 'number' | 'boolean' | 'color' | 'image';
      default: unknown;
    }>;
    variants?: Array<{
      name: string;
      label?: string;
    }>;
    from?: string;
    sourceFile?: string;
    layout?: CreateLayoutNode[];
  },
  {
    changes: FileChange[];
    componentPath: string;
    props: Array<{ name: string; type: string; defaultLiteral: string }>;
  }
> = {
  name: 'components.create',
  description: 'Author a new design component master file in components/<Name>.tsx with typed props and variants',
  category: 'components',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T09',
  inputSchema: z.object({
    name: z.string().regex(/^[A-Z][A-Za-z0-9]*$/, 'Component name must be PascalCase'),
    props: z.array(
      z.object({
        name: z.string().min(1),
        type: z.enum(['string', 'number', 'boolean', 'color', 'image']),
        default: z.unknown(),
      }),
    ),
    variants: z
      .array(
        z.object({
          name: z.string().min(1),
          label: z.string().optional(),
        }),
      )
      .optional(),
    from: z.string().optional(),
    sourceFile: z.string().optional(),
    layout: z
      .array(
        z.object({
          tag: z.string().min(1),
          text: z.string().optional(),
          style: z.record(z.string(), z.string()).optional(),
          children: z.array(z.any()).optional(),
          dataId: z.string().optional(),
        }),
      )
      .optional(),
  }),
  async execute(snapshot, input) {
    const componentPath = `components/${input.name}.tsx`;

    if (snapshot.files.has(componentPath)) {
      throw new Error(`COMPONENT_ALREADY_EXISTS: Component "${input.name}" already exists at "${componentPath}"`);
    }

    const sourceCode = input.sourceFile ? snapshot.files.get(input.sourceFile) : undefined;
    const spec: CreateComponentSpec = {
      name: input.name,
      props: input.props,
      variants: input.variants,
      from: input.from,
      layout: input.layout,
    };

    const built = buildCreatedMaster(spec, { sourceCode });
    if ('error' in built) {
      throw new Error(`COMPONENT_BUILD_ERROR: ${built.error}`);
    }

    return {
      changes: [
        {
          path: componentPath,
          beforeHash: null,
          content: built.masterCode,
        },
      ],
      componentPath,
      props: built.props,
    };
  },
};

// 4. components.extract
export const componentsExtractOperation: Operation<
  {
    name: string;
    sourceFile: string;
    nodeId: string;
  },
  {
    changes: FileChange[];
    componentPath: string;
    extractedProps: Array<{ name: string; defaultValue: string; dataId: string }>;
  }
> = {
  name: 'components.extract',
  description: 'Extract a JSX subtree from a page into a standalone component master and replace it with an instance',
  category: 'components',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T09',
  inputSchema: z.object({
    name: z.string().regex(/^[A-Z][A-Za-z0-9]*$/, 'Component name must be PascalCase'),
    sourceFile: z.string().min(1),
    nodeId: z.string().min(1),
  }),
  async execute(snapshot, input) {
    const sourceCode = snapshot.files.get(input.sourceFile);
    if (!sourceCode) {
      throw new Error(`FILE_NOT_FOUND: Source file "${input.sourceFile}" not found in project`);
    }

    const componentPath = `components/${input.name}.tsx`;
    if (snapshot.files.has(componentPath)) {
      throw new Error(`COMPONENT_ALREADY_EXISTS: Component "${input.name}" already exists at "${componentPath}"`);
    }

    const built = buildExtractedMaster(sourceCode, input.nodeId, input.name);
    if ('error' in built) {
      throw new Error(`COMPONENT_EXTRACT_ERROR: ${built.error}`);
    }

    // Replace the extracted subtree in sourceFile with <Name data-id="${nodeId}" />
    // Locate the tag opening and closing span for the extracted node
    const nodes = parseJSXToNodes(sourceCode);
    const targetNode = nodes.get(input.nodeId);
    if (!targetNode) {
      throw new Error(`NODE_NOT_FOUND: Node "${input.nodeId}" not found in "${input.sourceFile}"`);
    }

    // Build replacement instance tag
    const instanceTag = `<${input.name} data-id="${input.nodeId}" />`;
    const regex = new RegExp(`<[^>]*data-id="${input.nodeId}"[\\s\\S]*?<\\/[^>]+>|<[^>]*data-id="${input.nodeId}"[^>]*\\/>`);
    let nextSourceCode = sourceCode.replace(regex, instanceTag);
    nextSourceCode = ensureComponentImport(nextSourceCode, input.name);

    return {
      changes: [
        {
          path: componentPath,
          beforeHash: null,
          content: built.masterCode,
        },
        {
          path: input.sourceFile,
          beforeHash: null,
          content: nextSourceCode,
        },
      ],
      componentPath,
      extractedProps: built.props,
    };
  },
};

// 5. components.replace
export const componentsReplaceOperation: Operation<
  {
    targetFile: string;
    nodeId: string;
    newComponentName: string;
  },
  {
    changes: FileChange[];
    replacedTag: string;
  }
> = {
  name: 'components.replace',
  description: 'Swap a component instance in place with a different component, retaining id, dimensions and layout placement',
  category: 'components',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T09',
  inputSchema: z.object({
    targetFile: z.string().min(1),
    nodeId: z.string().min(1),
    newComponentName: z.string().regex(/^[A-Z][A-Za-z0-9]*$/, 'Component name must be PascalCase'),
  }),
  async execute(snapshot, input) {
    const code = snapshot.files.get(input.targetFile);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Target file "${input.targetFile}" not found in project`);
    }

    const componentPath = `components/${input.newComponentName}.tsx`;
    if (!snapshot.files.has(componentPath)) {
      throw new Error(`COMPONENT_NOT_FOUND: Target component "${input.newComponentName}" does not exist`);
    }

    let nextCode = replaceComponentInstanceInCode(code, {
      nodeId: input.nodeId,
      newTag: input.newComponentName,
      newDisplayName: input.newComponentName,
    });

    nextCode = ensureComponentImport(nextCode, input.newComponentName);

    return {
      changes: [
        {
          path: input.targetFile,
          beforeHash: null,
          content: nextCode,
        },
      ],
      replacedTag: input.newComponentName,
    };
  },
};

// 6. components.detach
export const componentsDetachOperation: Operation<
  {
    targetFile: string;
    nodeId: string;
  },
  {
    changes: FileChange[];
    detachedComponent: string;
  }
> = {
  name: 'components.detach',
  description: 'Detach a component instance, inlining its master JSX structure into the page with current prop overrides baked in',
  category: 'components',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T09',
  inputSchema: z.object({
    targetFile: z.string().min(1),
    nodeId: z.string().min(1),
  }),
  async execute(snapshot, input) {
    const code = snapshot.files.get(input.targetFile);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Target file "${input.targetFile}" not found in project`);
    }

    // Find instance tag
    const tagMatch = code.match(new RegExp(`<([A-Z][A-Za-z0-9]*)[^>]*data-id="${input.nodeId}"[^>]*>`));
    if (!tagMatch) {
      throw new Error(`INSTANCE_NOT_FOUND: Component instance with data-id "${input.nodeId}" not found in "${input.targetFile}"`);
    }

    const compName = tagMatch[1];
    const compPath = `components/${compName}.tsx`;
    const masterCode = snapshot.files.get(compPath);
    if (!masterCode) {
      throw new Error(`MASTER_NOT_FOUND: Component master file "${compPath}" not found`);
    }

    // Extract return JSX body from masterCode using AST with regex fallback
    let inlinedJsx: string | null = null;
    try {
      const ast = parseJSX(masterCode);
      traverse(ast, {
        ReturnStatement(path) {
          if (path.node.argument && !inlinedJsx) {
            const start = path.node.argument.start;
            const end = path.node.argument.end;
            if (typeof start === 'number' && typeof end === 'number') {
              inlinedJsx = masterCode.slice(start, end).trim();
            }
          }
        },
      });
    } catch {
      // fallback
    }

    if (!inlinedJsx) {
      const bodyMatch = masterCode.match(/return\s*(?:\(\s*([\s\S]*?)\s*\)|([<][\s\S]*?[>]))\s*;\s*\}/);
      if (bodyMatch) {
        inlinedJsx = (bodyMatch[1] || bodyMatch[2]).trim();
      }
    }

    if (!inlinedJsx) {
      throw new Error(`INVALID_MASTER: Could not extract render body from "${compPath}"`);
    }

    // Scan instance tag attributes
    const instanceAttrs = scanTagAttrs(tagMatch[0]) ?? [];
    const attrValues: Record<string, string> = {};
    for (const a of instanceAttrs) {
      if (a.name === 'data-id' || a.name === 'data-name') continue;
      if (a.value.kind === 'string') attrValues[a.name] = a.value.text;
      else if (a.value.kind === 'expr') attrValues[a.name] = a.value.source;
    }

    // Substitute prop variables in inlined JSX
    for (const [propName, val] of Object.entries(attrValues)) {
      if (propName === 'style') continue;
      const propRegex = new RegExp(`\\{${propName}\\}`, 'g');
      inlinedJsx = inlinedJsx.replace(propRegex, val);
    }

    // Replace instance tag with inlined JSX
    const instanceSpanRegex = new RegExp(`<${compName}[^>]*data-id="${input.nodeId}"[^>]*\\/>|<${compName}[^>]*data-id="${input.nodeId}"[^>]*>[\\s\\S]*?<\\/${compName}>`);
    let nextCode = code.replace(instanceSpanRegex, inlinedJsx);

    // Prune import if no other instances exist
    if (!nextCode.includes(`<${compName}`)) {
      nextCode = pruneComponentImport(nextCode, compName);
    }

    return {
      changes: [
        {
          path: input.targetFile,
          beforeHash: null,
          content: nextCode,
        },
      ],
      detachedComponent: compName,
    };
  },
};

// 7. components.remove
export const componentsRemoveOperation: Operation<
  {
    name: string;
    force?: boolean;
  },
  {
    changes: FileChange[];
    removedComponent: string;
  }
> = {
  name: 'components.remove',
  description: 'Delete a component master file with usage checks and instance pruning',
  category: 'components',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T09',
  inputSchema: z.object({
    name: z.string().min(1),
    force: z.boolean().optional().default(false),
  }),
  async execute(snapshot, input) {
    const compPath = `components/${input.name}.tsx`;
    if (!snapshot.files.has(compPath)) {
      throw new Error(`FILE_NOT_FOUND: Component file "${compPath}" not found`);
    }

    // Check for usages across project
    const usedFiles: string[] = [];
    for (const [p, content] of snapshot.files.entries()) {
      if (p === compPath) continue;
      if (content.includes(`<${input.name}`) || content.includes(`from '@/components/${input.name}'`)) {
        usedFiles.push(p);
      }
    }

    if (usedFiles.length > 0 && !input.force) {
      throw new Error(
        `COMPONENT_IN_USE: Cannot delete component "${input.name}" because it is used in ${usedFiles.length} file(s) (e.g. ${usedFiles[0]}). Set force: true to delete anyway.`,
      );
    }

    const changes: FileChange[] = [
      {
        path: compPath,
        beforeHash: null,
        content: null, // deletion
      },
    ];

    if (input.force) {
      for (const p of usedFiles) {
        let fileCode = snapshot.files.get(p)!;
        fileCode = pruneComponentImport(fileCode, input.name);
        changes.push({
          path: p,
          beforeHash: null,
          content: fileCode,
        });
      }
    }

    return {
      changes,
      removedComponent: input.name,
    };
  },
};

// Register component operations
defaultRegistry.register(componentsListOperation);
defaultRegistry.register(componentsGetOperation);
defaultRegistry.register(componentsCreateOperation);
defaultRegistry.register(componentsExtractOperation);
defaultRegistry.register(componentsReplaceOperation);
defaultRegistry.register(componentsDetachOperation);
defaultRegistry.register(componentsRemoveOperation);
