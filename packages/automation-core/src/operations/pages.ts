// packages/automation-core/src/operations/pages.ts
import { z } from 'zod';
import type { Operation, FileChange, Snapshot, OperationContext } from '../contracts';
import { defaultRegistry } from '../registry';
import * as t from '@babel/types';
import { parseJSX, traverse } from '@/code/parsing/ast-utils';
import { generate } from '@/code/generation/generator-utils';

const TEMPLATE_PAGE_ROOT_STYLE = {
  position: 'relative',
  width: '100%',
  height: 'auto',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
} as const;

function isCanonicalTemplateRootStyle(attribute: t.JSXAttribute): boolean {
  if (!t.isJSXExpressionContainer(attribute.value) || !t.isObjectExpression(attribute.value.expression)) {
    return false;
  }

  const values = new Map<string, string>();
  for (const property of attribute.value.expression.properties) {
    if (!t.isObjectProperty(property)) return false;
    const key = t.isIdentifier(property.key) ? property.key.name
      : t.isStringLiteral(property.key) ? property.key.value
      : null;
    if (!key || !t.isStringLiteral(property.value)) return false;
    values.set(key, property.value.value);
  }

  const expected = Object.entries(TEMPLATE_PAGE_ROOT_STYLE);
  return values.size === expected.length && expected.every(([key, value]) => values.get(key) === value);
}

/**
 * Move an existing page-root style onto an editable inner wrapper before the
 * page joins a route-group template. The template owns the outer root; keeping
 * the former style on a new child preserves the page's authored presentation.
 */
export function preparePageForTemplate(
  code: string,
  createId: (prefix?: string) => string,
): string {
  const ast = parseJSX(code);
  if (!ast) return code;

  let changed = false;
  traverse(ast, {
    JSXElement(path) {
      const opening = path.node.openingElement;
      const rootId = opening.attributes.find((attribute) =>
        t.isJSXAttribute(attribute) &&
        t.isJSXIdentifier(attribute.name, { name: 'data-id' }) &&
        t.isStringLiteral(attribute.value, { value: 'root' }),
      );
      if (!rootId) return;

      const styleAttribute = opening.attributes.find((attribute): attribute is t.JSXAttribute =>
        t.isJSXAttribute(attribute) && t.isJSXIdentifier(attribute.name, { name: 'style' }),
      );
      if (styleAttribute && isCanonicalTemplateRootStyle(styleAttribute)) {
        path.stop();
        return;
      }

      const canonicalStyle = t.jsxAttribute(
        t.jsxIdentifier('style'),
        t.jsxExpressionContainer(t.objectExpression(
          Object.entries(TEMPLATE_PAGE_ROOT_STYLE).map(([key, value]) =>
            t.objectProperty(t.identifier(key), t.stringLiteral(value)),
          ),
        )),
      );

      if (styleAttribute) {
        const pageNameAttribute = opening.attributes.find((attribute) =>
          t.isJSXAttribute(attribute) && t.isJSXIdentifier(attribute.name, { name: 'data-name' }),
        );
        const pageName = pageNameAttribute && t.isJSXAttribute(pageNameAttribute) && t.isStringLiteral(pageNameAttribute.value)
          ? pageNameAttribute.value.value
          : 'Page';
        const wrapper = t.jsxElement(
          t.jsxOpeningElement(t.jsxIdentifier('div'), [
            t.jsxAttribute(t.jsxIdentifier('data-id'), t.stringLiteral(createId('page-content'))),
            t.jsxAttribute(t.jsxIdentifier('data-name'), t.stringLiteral(`${pageName} Content`)),
            t.cloneNode(styleAttribute, true),
          ]),
          t.jsxClosingElement(t.jsxIdentifier('div')),
          path.node.children,
        );
        path.node.children = [wrapper];
        const styleIndex = opening.attributes.indexOf(styleAttribute);
        opening.attributes.splice(styleIndex, 1, canonicalStyle);
      } else {
        opening.attributes.push(canonicalStyle);
      }

      changed = true;
      path.stop();
    },
  });

  return changed ? generate(ast, { retainLines: true }, code).code : code;
}

function regeneratePageNodeIds(code: string, createId: (prefix?: string) => string): string {
  const ast = parseJSX(code);
  if (!ast) return code;

  let changed = false;
  traverse(ast, {
    JSXOpeningElement(path) {
      for (const attribute of path.node.attributes) {
        if (!t.isJSXAttribute(attribute) || !t.isJSXIdentifier(attribute.name, { name: 'data-id' })) continue;
        if (!t.isStringLiteral(attribute.value) || attribute.value.value === 'root') continue;
        attribute.value.value = createId('node');
        changed = true;
      }
    },
  });

  return changed ? generate(ast, { retainLines: true }, code).code : code;
}

export interface PageInfo {
  slug: string;
  route: string;
  clientPath: string;
  serverPath: string;
  template?: string;
  title?: string;
  isHomepage: boolean;
}

export function normalizeSlug(raw: string): string {
  const trimmed = raw.trim().replace(/^\/+|\/+$/g, '');
  if (!trimmed) return '';
  return trimmed;
}

export function getPagePaths(slug: string, template?: string): {
  clientPath: string;
  serverPath: string;
  route: string;
} {
  const cleanSlug = normalizeSlug(slug);
  const baseDir = template ? `app/(${template})` : 'app';
  if (cleanSlug === '') {
    return {
      clientPath: `${baseDir}/page.client.tsx`,
      serverPath: `${baseDir}/page.tsx`,
      route: '/',
    };
  }
  return {
    clientPath: `${baseDir}/${cleanSlug}/page.client.tsx`,
    serverPath: `${baseDir}/${cleanSlug}/page.tsx`,
    route: `/${cleanSlug}`,
  };
}

export function parsePageFromPath(clientPath: string): {
  slug: string;
  route: string;
  template?: string;
  serverPath: string;
} | null {
  const m = clientPath.match(/^app\/(?:\(([^)]+)\)\/)?(?:(.+)\/)?page\.client\.tsx$/);
  if (!m) return null;
  const template = m[1];
  const slug = m[2] || '';
  const route = slug ? `/${slug}` : '/';
  const serverPath = clientPath.replace(/page\.client\.tsx$/, 'page.tsx');
  return { slug, route, template, serverPath };
}

export function extractPageTitle(serverCode?: string): string | undefined {
  if (!serverCode) return undefined;
  const match = serverCode.match(/title:\s*['"]([^'"]+)['"]/);
  return match ? match[1] : undefined;
}

export function findPageInSnapshot(
  snapshot: Snapshot,
  slugOrRoute: string
): { page: PageInfo; clientContent: string; serverContent: string } | null {
  const clean = normalizeSlug(slugOrRoute);
  const targetRoute = clean ? `/${clean}` : '/';

  for (const [path, content] of snapshot.files.entries()) {
    if (path.endsWith('page.client.tsx')) {
      const parsed = parsePageFromPath(path);
      if (parsed && (parsed.slug === clean || parsed.route === targetRoute || path === slugOrRoute)) {
        const serverContent = snapshot.files.get(parsed.serverPath) || '';
        return {
          page: {
            slug: parsed.slug,
            route: parsed.route,
            clientPath: path,
            serverPath: parsed.serverPath,
            template: parsed.template,
            title: extractPageTitle(serverContent),
            isHomepage: parsed.route === '/',
          },
          clientContent: content,
          serverContent,
        };
      }
    }
  }
  return null;
}

// 1. pages.list operation
export const pagesListOperation: Operation<
  { template?: string },
  { pages: PageInfo[] }
> = {
  name: 'pages.list',
  description: 'List all pages in the project with routes, templates, and titles',
  category: 'pages',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T06',
  inputSchema: z.object({
    template: z.string().optional(),
  }),
  async execute(snapshot, input) {
    const pages: PageInfo[] = [];

    for (const [filePath, content] of snapshot.files.entries()) {
      if (filePath.endsWith('page.client.tsx')) {
        const parsed = parsePageFromPath(filePath);
        if (parsed) {
          if (input.template && parsed.template !== input.template) {
            continue;
          }
          const serverContent = snapshot.files.get(parsed.serverPath);
          pages.push({
            slug: parsed.slug,
            route: parsed.route,
            clientPath: filePath,
            serverPath: parsed.serverPath,
            template: parsed.template,
            title: extractPageTitle(serverContent),
            isHomepage: parsed.route === '/',
          });
        }
      }
    }

    // Sort: homepage first, then alphabetical by route
    pages.sort((a, b) => {
      if (a.isHomepage) return -1;
      if (b.isHomepage) return 1;
      return a.route.localeCompare(b.route);
    });

    return { pages };
  },
};

// 2. pages.create operation
export const pagesCreateOperation: Operation<
  {
    slug: string;
    title?: string;
    template?: string;
    content?: string;
  },
  {
    page: PageInfo;
    changes: FileChange[];
  }
> = {
  name: 'pages.create',
  description: 'Create a new Next.js page pair (page.tsx and page.client.tsx)',
  category: 'pages',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T06',
  inputSchema: z.object({
    slug: z.string(),
    title: z.string().optional(),
    template: z.string().optional(),
    content: z.string().optional(),
  }),
  async execute(snapshot, input, context) {
    const { clientPath, serverPath, route } = getPagePaths(input.slug, input.template);

    // Collision check
    if (snapshot.files.has(clientPath)) {
      throw new Error(`PAGE_ALREADY_EXISTS: Page already exists at ${clientPath}`);
    }

    // Route collision check across templates
    const cleanSlug = normalizeSlug(input.slug);
    const targetRoute = cleanSlug ? `/${cleanSlug}` : '/';
    for (const existingPath of snapshot.files.keys()) {
      if (existingPath.endsWith('page.client.tsx')) {
        const parsed = parsePageFromPath(existingPath);
        if (parsed && parsed.route === targetRoute) {
          throw new Error(`ROUTE_COLLISION: Route "${targetRoute}" is already defined by ${existingPath}`);
        }
      }
    }

    const changes: FileChange[] = [];
    const rootId = context.createId('root');
    const pageName = input.title || (cleanSlug ? cleanSlug.replace(/-/g, ' ') : 'Home');
    // A templated page shares the canvas node map with LayoutClient, so both
    // roots use data-id="root". Keep the page root bare; the shared template
    // owns background, clipping, padding, and viewport sizing.
    const rootStyle = input.template
      ? "position: 'relative', width: '100%', height: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center'"
      : "position: 'relative', width: '100%', minHeight: '900px', backgroundColor: '#ffffff'";

    const serverCode = `import PageClient from './page.client';

export const metadata = {
  title: ${JSON.stringify(pageName)},
};

export default function Page() {
  return <PageClient />;
}
`;

    const clientCode = `'use client';

/** @canvas { "viewports": [ { "id": "desktop", "label": "Desktop", "width": 1200, "height": "auto", "isPrimary": true, "order": 0 } ], "positions": { "desktop": { "x": 0, "y": 0 } } } */

import React from 'react';

export default function Page() {
  return (
    <div data-id="root" data-name="${pageName}" style={{ ${rootStyle} }}>
      ${input.content ? input.content : ''}
    </div>
  );
}
`;

    changes.push({
      path: serverPath,
      beforeHash: null,
      content: serverCode,
    });

    changes.push({
      path: clientPath,
      beforeHash: null,
      content: clientCode,
    });

    // Ensure root layout exists if missing
    if (!snapshot.files.has('app/layout.tsx')) {
      const layoutCode = `export const metadata = {
  title: 'Revyme Site',
  description: 'Built with Revyme',
};

export const siteConfig = {
  language: 'en',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang={siteConfig.language || 'en'}>
      <body>{children}</body>
    </html>
  );
}
`;
      changes.push({
        path: 'app/layout.tsx',
        beforeHash: null,
        content: layoutCode,
      });
    }

    const page: PageInfo = {
      slug: cleanSlug,
      route,
      clientPath,
      serverPath,
      template: input.template,
      title: pageName,
      isHomepage: route === '/',
    };

    return { page, changes };
  },
};

// 3. pages.update operation
export const pagesUpdateOperation: Operation<
  {
    slug: string;
    newSlug?: string;
    title?: string;
    template?: string | null;
  },
  {
    page: PageInfo;
    changes: FileChange[];
  }
> = {
  name: 'pages.update',
  description: 'Update page slug, title, or template assignment',
  category: 'pages',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T06',
  inputSchema: z.object({
    slug: z.string(),
    newSlug: z.string().optional(),
    title: z.string().optional(),
    template: z.string().nullable().optional(),
  }),
  async execute(snapshot, input, context) {
    const existing = findPageInSnapshot(snapshot, input.slug);
    if (!existing) {
      throw new Error(`PAGE_NOT_FOUND: Page "${input.slug}" not found`);
    }

    const changes: FileChange[] = [];
    const targetSlug = input.newSlug !== undefined ? normalizeSlug(input.newSlug) : existing.page.slug;
    const targetTemplate = input.template !== undefined ? (input.template || undefined) : existing.page.template;

    const { clientPath: nextClientPath, serverPath: nextServerPath, route: nextRoute } = getPagePaths(
      targetSlug,
      targetTemplate
    );

    let updatedServerContent = existing.serverContent;
    if (input.title !== undefined) {
      if (/title:\s*['"][^'"]*['"]/.test(updatedServerContent)) {
        updatedServerContent = updatedServerContent.replace(
          /title:\s*['"][^'"]*['"]/,
          `title: ${JSON.stringify(input.title)}`
        );
      } else {
        updatedServerContent = updatedServerContent.replace(
          /export const metadata = \{/,
          `export const metadata = {\n  title: ${JSON.stringify(input.title)},`
        );
      }
    }

    const pathChanged =
      nextClientPath !== existing.page.clientPath || nextServerPath !== existing.page.serverPath;
    const clientContent = targetTemplate
      ? preparePageForTemplate(existing.clientContent, context.createId)
      : existing.clientContent;

    if (clientContent !== existing.clientContent) {
      context.trace('pages:update:template-root-normalized', {
        slug: targetSlug,
        template: targetTemplate,
      });
    }

    if (pathChanged) {
      // Check collision
      if (snapshot.files.has(nextClientPath) && nextClientPath !== existing.page.clientPath) {
        throw new Error(`TARGET_PATH_COLLISION: Target path "${nextClientPath}" already exists`);
      }

      // Delete old paths
      changes.push({
        path: existing.page.clientPath,
        beforeHash: null,
        content: null,
      });
      changes.push({
        path: existing.page.serverPath,
        beforeHash: null,
        content: null,
      });

      // Write new paths
      changes.push({
        path: nextClientPath,
        beforeHash: null,
        content: clientContent,
      });
      changes.push({
        path: nextServerPath,
        beforeHash: null,
        content: updatedServerContent,
      });
    } else if (input.title !== undefined) {
      changes.push({
        path: existing.page.serverPath,
        beforeHash: null,
        content: updatedServerContent,
      });
    }

    const page: PageInfo = {
      slug: targetSlug,
      route: nextRoute,
      clientPath: nextClientPath,
      serverPath: nextServerPath,
      template: targetTemplate,
      title: input.title !== undefined ? input.title : existing.page.title,
      isHomepage: nextRoute === '/',
    };

    return { page, changes };
  },
};

// 4. pages.duplicate operation
export const pagesDuplicateOperation: Operation<
  {
    slug: string;
    newSlug: string;
    title?: string;
  },
  {
    page: PageInfo;
    changes: FileChange[];
  }
> = {
  name: 'pages.duplicate',
  description: 'Duplicate an existing page with new IDs and fresh paths',
  category: 'pages',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T06',
  inputSchema: z.object({
    slug: z.string(),
    newSlug: z.string(),
    title: z.string().optional(),
  }),
  async execute(snapshot, input, context) {
    const existing = findPageInSnapshot(snapshot, input.slug);
    if (!existing) {
      throw new Error(`PAGE_NOT_FOUND: Source page "${input.slug}" not found`);
    }

    const targetSlug = normalizeSlug(input.newSlug);
    const { clientPath, serverPath, route } = getPagePaths(targetSlug, existing.page.template);

    if (snapshot.files.has(clientPath)) {
      throw new Error(`PAGE_ALREADY_EXISTS: Target page "${clientPath}" already exists`);
    }

    const newTitle = input.title || `${existing.page.title || 'Page'} (Copy)`;

    // Keep the required page root ID, but give copied descendants fresh IDs.
    let newClientContent = regeneratePageNodeIds(existing.clientContent, context.createId);
    newClientContent = newClientContent.replace(
      /data-name="[^"]*"/,
      `data-name="${newTitle}"`
    );

    let newServerContent = existing.serverContent;
    if (/title:\s*['"][^'"]*['"]/.test(newServerContent)) {
      newServerContent = newServerContent.replace(
        /title:\s*['"][^'"]*['"]/,
        `title: ${JSON.stringify(newTitle)}`
      );
    }

    const changes: FileChange[] = [
      {
        path: clientPath,
        beforeHash: null,
        content: newClientContent,
      },
      {
        path: serverPath,
        beforeHash: null,
        content: newServerContent,
      },
    ];

    const page: PageInfo = {
      slug: targetSlug,
      route,
      clientPath,
      serverPath,
      template: existing.page.template,
      title: newTitle,
      isHomepage: route === '/',
    };

    return { page, changes };
  },
};

// 5. pages.remove operation
export const pagesRemoveOperation: Operation<
  {
    slug: string;
    force?: boolean;
  },
  {
    removedSlug: string;
    changes: FileChange[];
  }
> = {
  name: 'pages.remove',
  description: 'Remove a page from the project by slug',
  category: 'pages',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T06',
  inputSchema: z.object({
    slug: z.string(),
    force: z.boolean().optional(),
  }),
  async execute(snapshot, input) {
    const existing = findPageInSnapshot(snapshot, input.slug);
    if (!existing) {
      throw new Error(`PAGE_NOT_FOUND: Page "${input.slug}" not found`);
    }

    if (existing.page.isHomepage && !input.force) {
      throw new Error('CANNOT_REMOVE_HOMEPAGE: The homepage cannot be removed without force flag');
    }

    const changes: FileChange[] = [
      {
        path: existing.page.clientPath,
        beforeHash: null,
        content: null,
      },
      {
        path: existing.page.serverPath,
        beforeHash: null,
        content: null,
      },
    ];

    return {
      removedSlug: existing.page.slug,
      changes,
    };
  },
};

// Register pages operations
defaultRegistry.register(pagesListOperation);
defaultRegistry.register(pagesCreateOperation);
defaultRegistry.register(pagesUpdateOperation);
defaultRegistry.register(pagesDuplicateOperation);
defaultRegistry.register(pagesRemoveOperation);
