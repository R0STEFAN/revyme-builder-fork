// packages/automation-core/src/operations/components.ts
import { z } from 'zod';
import * as t from '@babel/types';
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
import { parseJSX, traverse } from '@/code/parsing/ast-utils';
import { generate } from '@/code/generation/generator-utils';
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

  const useClientMatch = code.match(/^\s*['"]use client['"];?\r?\n?/);
  if (useClientMatch && useClientMatch[0]) {
    const insertPos = useClientMatch.index! + useClientMatch[0].length;
    return code.slice(0, insertPos) + '\n' + importLine + '\n' + code.slice(insertPos);
  }

  return importLine + '\n' + code;
}

export function pruneComponentImport(code: string, componentName: string): string {
  const regex = new RegExp(`^import\\s+[A-Za-z_$][\\w$]*\\s+from\\s+['"]@/components/${componentName}(?:\\.tsx)?['"];?\\r?\\n?`, 'm');
  return code.replace(regex, '');
}

function componentInstanceSpans(code: string, componentName: string): Array<{ start: number; end: number }> {
  const ast = parseJSX(code);
  if (!ast) return [];
  const importedNames = new Set([componentName]);
  traverse(ast, {
    ImportDeclaration(path) {
      const source = path.node.source.value;
      if (!source.endsWith(`/components/${componentName}`) && source !== `@/components/${componentName}`) return;
      for (const specifier of path.node.specifiers) {
        if (t.isImportDefaultSpecifier(specifier)) importedNames.add(specifier.local.name);
      }
    },
  });
  const spans: Array<{ start: number; end: number }> = [];
  traverse(ast, {
    JSXElement(path) {
      const tag = path.node.openingElement.name;
      if (!t.isJSXIdentifier(tag) || !importedNames.has(tag.name)) return;
      if (typeof path.node.start === 'number' && typeof path.node.end === 'number') {
        spans.push({ start: path.node.start, end: path.node.end });
      }
    },
  });
  // An outer instance removal subsumes any nested instances in its subtree.
  const outermost: Array<{ start: number; end: number }> = [];
  for (const span of spans.sort((a, b) => a.start - b.start || b.end - a.end)) {
    if (!outermost.some((parent) => span.start >= parent.start && span.end <= parent.end)) outermost.push(span);
  }
  return outermost;
}

function removeComponentInstances(code: string, componentName: string): string {
  let next = code;
  for (const span of componentInstanceSpans(code, componentName).sort((a, b) => b.start - a.start)) {
    next = next.slice(0, span.start) + next.slice(span.end);
  }
  return next;
}

function findComponentInstanceName(code: string, nodeId: string): string | null {
  const ast = parseJSX(code);
  if (!ast) return null;
  let name: string | null = null;
  traverse(ast, {
    JSXElement(path) {
      const id = path.node.openingElement.attributes.find((attr) => t.isJSXAttribute(attr)
        && t.isJSXIdentifier(attr.name, { name: 'data-id' }));
      if (!id || !t.isJSXAttribute(id) || !t.isStringLiteral(id.value) || id.value.value !== nodeId) return;
      if (t.isJSXIdentifier(path.node.openingElement.name) && /^[A-Z]/.test(path.node.openingElement.name.name)) {
        name = path.node.openingElement.name.name;
        path.stop();
      }
    },
  });
  return name;
}

function referencedNamesInNode(node: t.Node): Set<string> {
  const statement = t.isStatement(node)
    ? t.cloneNode(node, true) as t.Statement
    : t.expressionStatement(t.cloneNode(node, true) as t.Expression);
  const ast = t.file(t.program([statement]));
  const names = new Set<string>();
  const addTagRoot = (name: t.JSXIdentifier | t.JSXMemberExpression | t.JSXNamespacedName) => {
    let current: t.JSXIdentifier | t.JSXMemberExpression | t.JSXNamespacedName = name;
    while (t.isJSXMemberExpression(current)) current = current.object;
    if (t.isJSXIdentifier(current)) names.add(current.name);
  };
  traverse(ast, {
    Identifier(path) {
      if (path.isReferencedIdentifier()) names.add(path.node.name);
    },
    JSXElement(path) {
      addTagRoot(path.node.openingElement.name);
    },
  });
  return names;
}

function detachedDependencySource(code: string, masterAst: ReturnType<typeof parseJSX>, inlineNode: t.Node): string {
  if (!masterAst) return code;
  const imports = new Map<string, { source: string; specifier: t.ImportSpecifier | t.ImportDefaultSpecifier | t.ImportNamespaceSpecifier }>();
  const declarations = new Map<string, { node: t.Statement; order: number }>();
  for (const statement of masterAst.program.body) {
    if (t.isImportDeclaration(statement) && statement.importKind !== 'type') {
      for (const specifier of statement.specifiers) {
        if (t.isImportSpecifier(specifier) && specifier.importKind === 'type') continue;
        imports.set(specifier.local.name, { source: statement.source.value, specifier });
      }
      continue;
    }
    const declaration = t.isExportNamedDeclaration(statement) || t.isExportDefaultDeclaration(statement)
      ? statement.declaration
      : statement;
    if (!declaration) continue;
    if (t.isVariableDeclaration(declaration)) {
      for (const declarator of declaration.declarations) {
        if (!t.isIdentifier(declarator.id)) continue;
        const singleDeclaration = t.variableDeclaration(declaration.kind, [t.cloneNode(declarator, true)]);
        declarations.set(declarator.id.name, { node: singleDeclaration, order: statement.start ?? 0 });
      }
    } else if ((t.isFunctionDeclaration(declaration) || t.isClassDeclaration(declaration)) && declaration.id) {
      declarations.set(declaration.id.name, { node: t.cloneNode(declaration, true), order: statement.start ?? 0 });
    }
  }

  const pageAst = parseJSX(code);
  if (!pageAst) throw new Error('INVALID_PAGE: Could not parse page while collecting detach dependencies');
  const existingImports = new Map<string, string>();
  const existingLocals = new Set<string>();
  for (const statement of pageAst.program.body) {
    if (t.isImportDeclaration(statement)) {
      for (const specifier of statement.specifiers) {
        existingImports.set(specifier.local.name, statement.source.value);
        existingLocals.add(specifier.local.name);
      }
    } else {
      const declaration = t.isExportNamedDeclaration(statement) || t.isExportDefaultDeclaration(statement)
        ? statement.declaration
        : statement;
      if (t.isVariableDeclaration(declaration)) {
        for (const item of declaration.declarations) if (t.isIdentifier(item.id)) existingLocals.add(item.id.name);
      } else if ((t.isFunctionDeclaration(declaration) || t.isClassDeclaration(declaration)) && declaration.id) {
        existingLocals.add(declaration.id.name);
      }
    }
  }

  const pending = [...referencedNamesInNode(inlineNode)];
  const neededImports = new Map<string, { source: string; specifier: t.ImportSpecifier | t.ImportDefaultSpecifier | t.ImportNamespaceSpecifier }>();
  const neededDeclarations = new Map<string, { node: t.Statement; order: number }>();
  while (pending.length) {
    const name = pending.pop()!;
    const imported = imports.get(name);
    if (imported) {
      const existingSource = existingImports.get(name);
      if (existingSource === imported.source) continue;
      if (existingLocals.has(name)) {
        throw new Error(`DETACH_NAME_CONFLICT: Cannot import "${name}" from "${imported.source}" because the page already declares that name`);
      }
      neededImports.set(name, imported);
      continue;
    }
    const declaration = declarations.get(name);
    if (!declaration || neededDeclarations.has(name)) continue;
    if (existingLocals.has(name)) {
      throw new Error(`DETACH_NAME_CONFLICT: Cannot inline "${name}" because the page already declares that name`);
    }
    neededDeclarations.set(name, declaration);
    pending.push(...referencedNamesInNode(declaration.node));
  }

  const importLines = Array.from(neededImports.entries()).map(([local, item]) => {
    const source = JSON.stringify(item.source);
    const specifier = item.specifier;
    if (t.isImportDefaultSpecifier(specifier)) return `import ${local} from ${source};`;
    if (t.isImportNamespaceSpecifier(specifier)) return `import * as ${local} from ${source};`;
    const importedName = t.isIdentifier(specifier.imported) ? specifier.imported.name : specifier.imported.value;
    return `import { ${importedName === local ? importedName : `${importedName} as ${local}`} } from ${source};`;
  });
  const declarationLines = Array.from(neededDeclarations.values())
    .sort((a, b) => a.order - b.order)
    .map(({ node }) => generate(node).code);
  const insertLines = [...importLines, ...declarationLines];
  if (insertLines.length === 0) return code;

  let insertionPoint = 0;
  for (const statement of pageAst.program.body) {
    if (t.isImportDeclaration(statement) && typeof statement.end === 'number') insertionPoint = Math.max(insertionPoint, statement.end);
  }
  if (insertionPoint === 0) {
    const directive = pageAst.program.directives.find((item) => item.value.value === 'use client');
    if (directive && typeof directive.end === 'number') insertionPoint = directive.end;
  }
  return code.slice(0, insertionPoint) + `\n${insertLines.join('\n')}\n` + code.slice(insertionPoint);
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
  async execute(snapshot, input, context) {
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

    // Replace the exact AST span, not a regex through the first closing tag.
    // The regex could stop at a nested </h2> and leave the extracted wrapper's
    // closing </div> behind, producing invalid page JSX.
    const sourceAst = parseJSX(sourceCode);
    if (!sourceAst) {
      throw new Error(`COMPONENT_EXTRACT_ERROR: Could not parse "${input.sourceFile}"`);
    }
    let targetSpan: { start: number; end: number } | null = null;
    traverse(sourceAst, {
      JSXElement(path) {
        const id = path.node.openingElement.attributes.find((attr) => t.isJSXAttribute(attr)
          && t.isJSXIdentifier(attr.name, { name: 'data-id' }));
        if (!id || !t.isJSXAttribute(id) || !t.isStringLiteral(id.value) || id.value.value !== input.nodeId) return;
        if (typeof path.node.start === 'number' && typeof path.node.end === 'number') {
          targetSpan = { start: path.node.start, end: path.node.end };
          path.stop();
        }
      },
    });
    const extractedSpan = targetSpan as { start: number; end: number } | null;
    if (!extractedSpan) {
      throw new Error(`NODE_NOT_FOUND: Node "${input.nodeId}" not found in "${input.sourceFile}"`);
    }

    // Build replacement instance tag
    const instanceTag = `<${input.name} data-id="${input.nodeId}" />`;
    let nextSourceCode = sourceCode.slice(0, extractedSpan.start) + instanceTag + sourceCode.slice(extractedSpan.end);
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

    const previousComponentName = findComponentInstanceName(code, input.nodeId);
    let nextCode = replaceComponentInstanceInCode(code, {
      nodeId: input.nodeId,
      newTag: input.newComponentName,
      newDisplayName: input.newComponentName,
    });

    nextCode = ensureComponentImport(nextCode, input.newComponentName);
    if (previousComponentName && previousComponentName !== input.newComponentName
      && !new RegExp(`<${previousComponentName}(?=[\\s/>])`).test(nextCode)) {
      nextCode = pruneComponentImport(nextCode, previousComponentName);
    }

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
  async execute(snapshot, input, context) {
    const code = snapshot.files.get(input.targetFile);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Target file "${input.targetFile}" not found in project`);
    }

    // Locate the instance as a complete JSX node. A tag regex stops at `>` inside
    // an expression and can accidentally select a nested/partial instance.
    const pageAst = parseJSX(code);
    if (!pageAst) throw new Error(`INVALID_PAGE: Could not parse "${input.targetFile}"`);
    let instanceNode: t.JSXElement | null = null;
    let compName: string | null = null;
    traverse(pageAst, {
      JSXElement(path) {
        const opening = path.node.openingElement;
        const id = opening.attributes.find((attr) => t.isJSXAttribute(attr)
          && t.isJSXIdentifier(attr.name, { name: 'data-id' }));
        if (!id || !t.isJSXAttribute(id) || !t.isStringLiteral(id.value) || id.value.value !== input.nodeId) return;
        if (!t.isJSXIdentifier(opening.name) || !/^[A-Z]/.test(opening.name.name)) return;
        instanceNode = path.node;
        compName = opening.name.name;
        path.stop();
      },
    });
    const foundInstance = instanceNode as unknown as t.JSXElement | null;
    const foundComponentName = compName as string | null;
    if (!foundInstance || !foundComponentName) {
      throw new Error(`INSTANCE_NOT_FOUND: Component instance with data-id "${input.nodeId}" not found in "${input.targetFile}"`);
    }

    const compPath = `components/${foundComponentName}.tsx`;
    const masterCode = snapshot.files.get(compPath);
    if (!masterCode) {
      throw new Error(`MASTER_NOT_FOUND: Component master file "${compPath}" not found`);
    }

    // Read the rendered JSX and the component's destructured defaults together;
    // detach must not leave identifiers that used to be component props behind.
    const masterAst = parseJSX(masterCode);
    if (!masterAst) {
      throw new Error(`INVALID_MASTER: Could not extract render body from "${compPath}"`);
    }
    let inlineNode: t.JSXElement | t.JSXFragment | null = null;
    const propDefaults = new Map<string, t.Expression>();
    traverse(masterAst, {
      ReturnStatement(path) {
        if (inlineNode || !path.node.argument
          || (!t.isJSXElement(path.node.argument) && !t.isJSXFragment(path.node.argument))) return;
        inlineNode = t.cloneNode(path.node.argument, true);
        const componentFn = path.getFunctionParent();
        const propsParam = componentFn?.node.params[0];
        if (propsParam && t.isObjectPattern(propsParam)) {
          for (const property of propsParam.properties) {
            if (!t.isObjectProperty(property) || property.computed) continue;
            const key = t.isIdentifier(property.key) ? property.key.name
              : t.isStringLiteral(property.key) ? property.key.value : null;
            if (!key) continue;
            if (t.isAssignmentPattern(property.value)) {
              propDefaults.set(key, t.cloneNode(property.value.right, true) as t.Expression);
            } else {
              propDefaults.set(key, t.identifier('undefined'));
            }
          }
        }
      },
    });
    const renderedNode = inlineNode as unknown as t.JSXElement | t.JSXFragment | null;
    if (!renderedNode) throw new Error(`INVALID_MASTER: Could not extract render body from "${compPath}"`);

    const instanceAttrs = foundInstance.openingElement.attributes;
    const instanceProps = new Map<string, t.Expression>();
    let instanceStyle: t.Expression | null = null;
    for (const attr of instanceAttrs) {
      if (!t.isJSXAttribute(attr) || !t.isJSXIdentifier(attr.name)) continue;
      const name = attr.name.name;
      if (name === 'data-id' || name === 'data-name' || name === 'key') continue;
      let value: t.Expression | null = null;
      if (t.isStringLiteral(attr.value)) value = t.stringLiteral(attr.value.value);
      else if (t.isJSXExpressionContainer(attr.value) && t.isExpression(attr.value.expression)) {
        value = t.cloneNode(attr.value.expression, true);
      } else if (attr.value === null) value = t.booleanLiteral(true);
      if (!value) continue;
      if (name === 'style') instanceStyle = value;
      else instanceProps.set(name, value);
    }
    const effectiveProps = new Map(propDefaults);
    for (const [name, value] of instanceProps) effectiveProps.set(name, value);

    const inlineFile = t.file(t.program([t.expressionStatement(renderedNode)]));
    let hasMasterIds = false;
    traverse(inlineFile, {
      JSXAttribute(path) {
        if (t.isJSXIdentifier(path.node.name, { name: 'data-id' })) hasMasterIds = true;
      },
      Identifier(path) {
        if (path.node.name === 'style' || !path.isReferencedIdentifier()) return;
        const replacement = effectiveProps.get(path.node.name);
        if (replacement) path.replaceWith(t.cloneNode(replacement, true));
      },
    });

    // Expand `{...style}` after prop substitution so instance expressions are
    // not accidentally interpreted as master-component prop references.
    let rootIdAssigned = false;
    traverse(inlineFile, {
      JSXElement(path) {
        const opening = path.node.openingElement;
        const idAttr = opening.attributes.find((attr) => t.isJSXAttribute(attr)
          && t.isJSXIdentifier(attr.name, { name: 'data-id' }));
        if (idAttr && t.isJSXAttribute(idAttr) && t.isStringLiteral(idAttr.value)) {
          idAttr.value = t.stringLiteral(rootIdAssigned ? context.createId('detach') : input.nodeId);
          rootIdAssigned = true;
        } else if (!hasMasterIds && !rootIdAssigned) {
          opening.attributes.push(t.jsxAttribute(t.jsxIdentifier('data-id'), t.stringLiteral(input.nodeId)));
          rootIdAssigned = true;
        }

        for (const attr of [...opening.attributes]) {
          if (!t.isJSXAttribute(attr) || !t.isJSXIdentifier(attr.name, { name: 'style' })) continue;
          if (t.isJSXExpressionContainer(attr.value) && t.isObjectExpression(attr.value.expression)) {
            const styleObject = attr.value.expression;
            const nextProperties: Array<t.ObjectMethod | t.ObjectProperty | t.SpreadElement> = [];
            for (const property of styleObject.properties) {
              if (t.isSpreadElement(property) && t.isIdentifier(property.argument, { name: 'style' })) {
                if (instanceStyle && t.isObjectExpression(instanceStyle)) {
                  nextProperties.push(...instanceStyle.properties.map((p) => t.cloneNode(p, true)));
                } else if (instanceStyle) {
                  nextProperties.push(t.spreadElement(t.cloneNode(instanceStyle, true)));
                }
              } else {
                nextProperties.push(property);
              }
            }
            styleObject.properties = nextProperties;
            if (styleObject.properties.length === 0 && !instanceStyle) {
              opening.attributes.splice(opening.attributes.indexOf(attr), 1);
            }
          } else if (t.isJSXExpressionContainer(attr.value)
            && t.isIdentifier(attr.value.expression, { name: 'style' })) {
            if (instanceStyle) attr.value.expression = t.cloneNode(instanceStyle, true);
            else opening.attributes.splice(opening.attributes.indexOf(attr), 1);
          }
        }
      },
    });

    const replacement = generate(renderedNode).code;
    const start = foundInstance.start;
    const end = foundInstance.end;
    if (typeof start !== 'number' || typeof end !== 'number') {
      throw new Error(`INVALID_INSTANCE: Component instance "${input.nodeId}" has no source span`);
    }
    let nextCode = code.slice(0, start) + replacement + code.slice(end);

    // Prune import if no other instances exist
    if (!nextCode.includes(`<${foundComponentName}`)) {
      nextCode = pruneComponentImport(nextCode, foundComponentName);
    }
    nextCode = detachedDependencySource(nextCode, masterAst, renderedNode);

    return {
      changes: [
        {
          path: input.targetFile,
          beforeHash: null,
          content: nextCode,
        },
      ],
      detachedComponent: foundComponentName,
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

    // Only current source JSX counts as a live usage; `_meta/history.json` and
    // documents can mention old component code but cannot render it.
    const usedFiles: string[] = [];
    for (const [p, content] of snapshot.files.entries()) {
      if (p === compPath || !/\.(?:tsx|jsx)$/.test(p)) continue;
      if (componentInstanceSpans(content, input.name).length > 0) {
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

    const sourceFiles = Array.from(snapshot.files.entries()).filter(([p]) => p !== compPath && /\.(?:tsx|jsx)$/.test(p));
    for (const [p, original] of sourceFiles) {
      let fileCode = input.force ? removeComponentInstances(original, input.name) : original;
      fileCode = pruneComponentImport(fileCode, input.name);
      if (fileCode !== original) {
        changes.push({ path: p, beforeHash: null, content: fileCode });
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
