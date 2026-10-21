// packages/automation-core/src/operations/sections.ts
import { z } from 'zod';
import type { Operation, FileChange, Snapshot } from '../contracts';
import { defaultRegistry } from '../registry';
import {
  SECTION_BLUEPRINTS,
  getSectionBlueprint,
  type SectionBlueprint,
} from '@/shared/sections-library';
import { findJSXDataIdIndex, findMatchingCloseTagIndex } from '@/code/generation/generator-utils';

function insertSectionJsx(code: string, parentId: string, sectionJsx: string, insertIndex?: number): string {
  const idIdx = findJSXDataIdIndex(code, parentId);
  if (idIdx === -1) {
    throw new Error(`PARENT_NOT_FOUND: Parent element "${parentId}" not found in file`);
  }

  const beforeId = code.lastIndexOf('<', idIdx);
  if (beforeId === -1) throw new Error('MALFORMED_PARENT: Cannot find opening tag for parent');
  const tagMatch = code.slice(beforeId + 1, idIdx).match(/^(\w+)/);
  if (!tagMatch) throw new Error('MALFORMED_PARENT: Cannot extract tag name for parent');
  const tagName = tagMatch[1];

  const openingEnd = code.indexOf('>', idIdx);
  if (openingEnd === -1) throw new Error('MALFORMED_PARENT: Cannot find end of opening tag');

  const closeIdx = findMatchingCloseTagIndex(code, tagName, openingEnd + 1);
  if (closeIdx === -1) throw new Error('MALFORMED_PARENT: Cannot find closing tag for parent');

  // Insert before closing tag
  return code.slice(0, closeIdx) + '\n' + sectionJsx + '\n' + code.slice(closeIdx);
}

// 1. sections.list
export const sectionsListOperation: Operation<
  { category?: string },
  {
    sections: Array<{
      id: string;
      name: string;
      category: string;
      description?: string;
      fonts: string[];
    }>;
  }
> = {
  name: 'sections.list',
  description: 'List all available pre-designed section blueprints (headers, heroes, footers, etc.)',
  category: 'sections',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T11',
  inputSchema: z.object({
    category: z.string().optional(),
  }),
  async execute(_snapshot, input) {
    const list = SECTION_BLUEPRINTS.filter((b) => !input.category || b.category === input.category).map((b) => ({
      id: b.id,
      name: b.name,
      category: b.category,
      description: b.description,
      fonts: b.fonts,
    }));

    return { sections: list };
  },
};

// 2. sections.get
export const sectionsGetOperation: Operation<
  { id: string },
  {
    section: {
      id: string;
      name: string;
      category: string;
      description?: string;
      fonts: string[];
      source: string;
    } | null;
  }
> = {
  name: 'sections.get',
  description: 'Get full blueprint specification and JSX source of a section',
  category: 'sections',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T11',
  inputSchema: z.object({
    id: z.string().min(1),
  }),
  async execute(_snapshot, input) {
    const bp = getSectionBlueprint(input.id);
    if (!bp) return { section: null };

    return {
      section: {
        id: bp.id,
        name: bp.name,
        category: bp.category,
        description: bp.description,
        fonts: bp.fonts,
        source: bp.source,
      },
    };
  },
};

// 3. sections.insert
export const sectionsInsertOperation: Operation<
  {
    targetFile: string;
    blueprintId: string;
    parentId?: string;
    insertIndex?: number;
  },
  {
    changes: FileChange[];
    sectionRootId: string;
    fonts: string[];
  }
> = {
  name: 'sections.insert',
  description: 'Insert a pre-designed section blueprint into a page or layout, generating unique IDs and injecting fonts',
  category: 'sections',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T11',
  inputSchema: z.object({
    targetFile: z.string().min(1),
    blueprintId: z.string().min(1),
    parentId: z.string().optional(),
    insertIndex: z.number().int().nonnegative().optional(),
  }),
  async execute(snapshot, input, context) {
    let code = snapshot.files.get(input.targetFile);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Target file "${input.targetFile}" not found in project`);
    }

    const bp = getSectionBlueprint(input.blueprintId);
    if (!bp) {
      throw new Error(`BLUEPRINT_NOT_FOUND: Section blueprint "${input.blueprintId}" not found in library`);
    }

    // Remap all data-ids in blueprint source to unique ids
    const idMap = new Map<string, string>();
    let sectionJsx = bp.source.replace(/data-id="([^"]+)"/g, (_, oldId) => {
      let fresh = idMap.get(oldId);
      if (!fresh) {
        fresh = context.createId(oldId);
        idMap.set(oldId, fresh);
      }
      return `data-id="${fresh}"`;
    });

    const rootMatch = bp.source.match(/data-id="([^"]+)"/);
    const sectionRootId = rootMatch ? (idMap.get(rootMatch[1]) ?? rootMatch[1]) : context.createId('sec');

    // Find parentId
    let effectiveParentId = input.parentId;
    if (!effectiveParentId) {
      // Look for page root element
      const pageRootMatch = code.match(/data-id="([^"]*(?:root|page)[^"]*)"/i) || code.match(/return\s*\(\s*<[A-Za-z0-9_.]+\s+[^>]*data-id="([^"]+)"/);
      if (pageRootMatch) {
        effectiveParentId = pageRootMatch[1];
      } else {
        throw new Error('NO_PARENT_SPECIFIED: Could not automatically detect a root container in target file');
      }
    }

    code = insertSectionJsx(code, effectiveParentId, sectionJsx, input.insertIndex);

    const changes: FileChange[] = [
      {
        path: input.targetFile,
        beforeHash: null,
        content: code,
      },
    ];

    // If blueprint specifies fonts, check if globals.css needs @import
    const cssPath = 'app/globals.css';
    let css = snapshot.files.get(cssPath);
    if (css && bp.fonts.length > 0) {
      let cssUpdated = false;
      for (const fontName of bp.fonts) {
        const escaped = fontName.replace(/ /g, '\\+');
        if (!css.includes(escaped)) {
          const importLine = `@import url('https://fonts.googleapis.com/css2?family=${fontName.replace(/ /g, '+')}:wght@400;500;600;700&display=swap');`;
          css = importLine + '\n' + css;
          cssUpdated = true;
        }
      }
      if (cssUpdated) {
        changes.push({
          path: cssPath,
          beforeHash: null,
          content: css,
        });
      }
    }

    return {
      changes,
      sectionRootId,
      fonts: bp.fonts,
    };
  },
};

defaultRegistry.register(sectionsListOperation);
defaultRegistry.register(sectionsGetOperation);
defaultRegistry.register(sectionsInsertOperation);
