// packages/automation-core/src/operations/templates.ts
import { z } from 'zod';
import type { Operation, FileChange, Snapshot, OperationContext } from '../contracts';
import { defaultRegistry } from '../registry';
import { normalizeSlug, parsePageFromPath, getPagePaths } from './pages';

export interface TemplateInfo {
  name: string;
  clientPath: string;
  layoutPath: string;
  assignedPages: string[];
}

export function listTemplatesFromSnapshot(snapshot: Snapshot): TemplateInfo[] {
  const templates: TemplateInfo[] = [];

  for (const filePath of snapshot.files.keys()) {
    const m = filePath.match(/^app\/\(([^)]+)\)\/LayoutClient\.tsx$/);
    if (m) {
      const name = m[1];
      const clientPath = filePath;
      const layoutPath = `app/(${name})/layout.tsx`;

      // Find assigned pages
      const prefix = `app/(${name})/`;
      const assignedPages: string[] = [];
      for (const pagePath of snapshot.files.keys()) {
        if (pagePath.startsWith(prefix) && pagePath.endsWith('page.client.tsx')) {
          const parsed = parsePageFromPath(pagePath);
          if (parsed) {
            assignedPages.push(parsed.slug || '/');
          }
        }
      }

      templates.push({
        name,
        clientPath,
        layoutPath,
        assignedPages,
      });
    }
  }

  return templates;
}

// 1. templates.list operation
export const templatesListOperation: Operation<
  Record<string, never>,
  { templates: TemplateInfo[] }
> = {
  name: 'templates.list',
  description: 'List all route-group templates and their assigned pages',
  category: 'templates',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T06',
  inputSchema: z.object({}),
  async execute(snapshot) {
    return {
      templates: listTemplatesFromSnapshot(snapshot),
    };
  },
};

// 2. templates.create operation
export const templatesCreateOperation: Operation<
  {
    name: string;
    headerContent?: string;
    footerContent?: string;
  },
  {
    template: TemplateInfo;
    changes: FileChange[];
  }
> = {
  name: 'templates.create',
  description: 'Create a new route group template with LayoutClient and server layout',
  category: 'templates',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T06',
  inputSchema: z.object({
    name: z.string().min(1),
    headerContent: z.string().optional(),
    footerContent: z.string().optional(),
  }),
  async execute(snapshot, input, context) {
    const cleanName = input.name.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
    const clientPath = `app/(${cleanName})/LayoutClient.tsx`;
    const layoutPath = `app/(${cleanName})/layout.tsx`;

    if (snapshot.files.has(clientPath)) {
      throw new Error(`TEMPLATE_ALREADY_EXISTS: Template "${cleanName}" already exists`);
    }

    const rootId = context.createId('template-root');
    const headerId = context.createId('header');
    const mainId = context.createId('main');
    const footerId = context.createId('footer');

    const clientCode = `'use client';

/* @canvas { single: true } */

import React from 'react';

export default function LayoutClient({ children }: { children: React.ReactNode }) {
  return (
    <div data-id="${rootId}" data-name="Template ${cleanName}" style={{
      position: 'relative', width: '100%', minHeight: '100vh',
      display: 'flex', flexDirection: 'column'
    }}>
      <header data-id="${headerId}" data-name="Header" style={{
        width: '100%', padding: '16px 24px', borderBottom: '1px solid #e5e7eb',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center'
      }}>
        ${input.headerContent || `<div data-id="${context.createId('logo')}">Logo</div>`}
      </header>
      <main data-id="${mainId}" data-name="Content" style={{ flex: '1 0 auto', width: '100%' }}>
        {children}
      </main>
      <footer data-id="${footerId}" data-name="Footer" style={{
        width: '100%', padding: '24px', borderTop: '1px solid #e5e7eb',
        textAlign: 'center'
      }}>
        ${input.footerContent || `<p data-id="${context.createId('copy')}">© ${cleanName}</p>`}
      </footer>
    </div>
  );
}
`;

    const layoutCode = `import LayoutClient from './LayoutClient';

export default function Layout({ children }: { children: React.ReactNode }) {
  return <LayoutClient>{children}</LayoutClient>;
}
`;

    const changes: FileChange[] = [
      {
        path: clientPath,
        beforeHash: null,
        content: clientCode,
      },
      {
        path: layoutPath,
        beforeHash: null,
        content: layoutCode,
      },
    ];

    const template: TemplateInfo = {
      name: cleanName,
      clientPath,
      layoutPath,
      assignedPages: [],
    };

    return { template, changes };
  },
};

// 3. templates.update operation
export const templatesUpdateOperation: Operation<
  {
    name: string;
    newName?: string;
  },
  {
    template: TemplateInfo;
    changes: FileChange[];
  }
> = {
  name: 'templates.update',
  description: 'Update template name and re-point all assigned page routes',
  category: 'templates',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T06',
  inputSchema: z.object({
    name: z.string().min(1),
    newName: z.string().min(1).optional(),
  }),
  async execute(snapshot, input) {
    const cleanName = input.name.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
    const oldClientPath = `app/(${cleanName})/LayoutClient.tsx`;

    if (!snapshot.files.has(oldClientPath)) {
      throw new Error(`TEMPLATE_NOT_FOUND: Template "${cleanName}" not found`);
    }

    const changes: FileChange[] = [];
    let finalName = cleanName;

    if (input.newName && input.newName !== cleanName) {
      finalName = input.newName.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
      const newPrefix = `app/(${finalName})/`;
      const oldPrefix = `app/(${cleanName})/`;

      if (snapshot.files.has(`${newPrefix}LayoutClient.tsx`)) {
        throw new Error(`TEMPLATE_ALREADY_EXISTS: Template "${finalName}" already exists`);
      }

      // Move all files in old route group to new route group
      for (const [filePath, content] of snapshot.files.entries()) {
        if (filePath.startsWith(oldPrefix)) {
          const newPath = `${newPrefix}${filePath.slice(oldPrefix.length)}`;
          changes.push({
            path: filePath,
            beforeHash: null,
            content: null,
          });
          changes.push({
            path: newPath,
            beforeHash: null,
            content,
          });
        }
      }
    }

    const template: TemplateInfo = {
      name: finalName,
      clientPath: `app/(${finalName})/LayoutClient.tsx`,
      layoutPath: `app/(${finalName})/layout.tsx`,
      assignedPages: [],
    };

    return { template, changes };
  },
};

// 4. templates.assign operation
export const templatesAssignOperation: Operation<
  {
    pageSlug: string;
    templateName: string | null;
  },
  {
    pageSlug: string;
    template: string | null;
    changes: FileChange[];
  }
> = {
  name: 'templates.assign',
  description: 'Assign or unassign a page to a route group template',
  category: 'templates',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T06',
  inputSchema: z.object({
    pageSlug: z.string(),
    templateName: z.string().nullable(),
  }),
  async execute(snapshot, input) {
    const cleanSlug = normalizeSlug(input.pageSlug);
    const targetTemplate = input.templateName ? input.templateName.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase() : null;

    if (targetTemplate && !snapshot.files.has(`app/(${targetTemplate})/LayoutClient.tsx`)) {
      throw new Error(`TEMPLATE_NOT_FOUND: Target template "${targetTemplate}" does not exist`);
    }

    // Locate current page files
    let currentClientPath: string | null = null;
    let currentServerPath: string | null = null;
    let clientContent = '';
    let serverContent = '';

    for (const [filePath, content] of snapshot.files.entries()) {
      if (filePath.endsWith('page.client.tsx')) {
        const parsed = parsePageFromPath(filePath);
        if (parsed && (parsed.slug === cleanSlug || (cleanSlug === '' && parsed.route === '/'))) {
          currentClientPath = filePath;
          currentServerPath = parsed.serverPath;
          clientContent = content;
          serverContent = snapshot.files.get(parsed.serverPath) || '';
          break;
        }
      }
    }

    if (!currentClientPath || !currentServerPath) {
      throw new Error(`PAGE_NOT_FOUND: Page "${input.pageSlug}" not found`);
    }

    const { clientPath: targetClientPath, serverPath: targetServerPath } = getPagePaths(
      cleanSlug,
      targetTemplate || undefined
    );

    if (targetClientPath === currentClientPath) {
      // Already assigned to this template
      return {
        pageSlug: cleanSlug,
        template: targetTemplate,
        changes: [],
      };
    }

    const changes: FileChange[] = [
      {
        path: currentClientPath,
        beforeHash: null,
        content: null,
      },
      {
        path: currentServerPath,
        beforeHash: null,
        content: null,
      },
      {
        path: targetClientPath,
        beforeHash: null,
        content: clientContent,
      },
      {
        path: targetServerPath,
        beforeHash: null,
        content: serverContent,
      },
    ];

    return {
      pageSlug: cleanSlug,
      template: targetTemplate,
      changes,
    };
  },
};

// 5. templates.remove operation
export const templatesRemoveOperation: Operation<
  {
    name: string;
    unassignPages?: boolean;
  },
  {
    name: string;
    unassignedPagesCount: number;
    changes: FileChange[];
  }
> = {
  name: 'templates.remove',
  description: 'Remove a template and optionally unassign all pages back to root',
  category: 'templates',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T06',
  inputSchema: z.object({
    name: z.string().min(1),
    unassignPages: z.boolean().optional().default(true),
  }),
  async execute(snapshot, input) {
    const cleanName = input.name.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
    const clientPath = `app/(${cleanName})/LayoutClient.tsx`;
    const layoutPath = `app/(${cleanName})/layout.tsx`;

    if (!snapshot.files.has(clientPath)) {
      throw new Error(`TEMPLATE_NOT_FOUND: Template "${cleanName}" not found`);
    }

    const changes: FileChange[] = [];
    const prefix = `app/(${cleanName})/`;
    let unassignedCount = 0;

    for (const [filePath, content] of snapshot.files.entries()) {
      if (filePath.startsWith(prefix)) {
        if (filePath === clientPath || filePath === layoutPath) {
          changes.push({
            path: filePath,
            beforeHash: null,
            content: null,
          });
        } else if (filePath.endsWith('page.client.tsx') || filePath.endsWith('page.tsx')) {
          const subPath = filePath.slice(prefix.length);
          const rootTarget = `app/${subPath}`;

          changes.push({
            path: filePath,
            beforeHash: null,
            content: null,
          });
          changes.push({
            path: rootTarget,
            beforeHash: null,
            content,
          });
          if (filePath.endsWith('page.client.tsx')) {
            unassignedCount++;
          }
        }
      }
    }

    return {
      name: cleanName,
      unassignedPagesCount: unassignedCount,
      changes,
    };
  },
};

// Register template operations
defaultRegistry.register(templatesListOperation);
defaultRegistry.register(templatesCreateOperation);
defaultRegistry.register(templatesUpdateOperation);
defaultRegistry.register(templatesAssignOperation);
defaultRegistry.register(templatesRemoveOperation);
