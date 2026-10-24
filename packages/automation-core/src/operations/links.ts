// packages/automation-core/src/operations/links.ts
import { z } from 'zod';
import type { Operation, FileChange } from '../contracts';
import { defaultRegistry } from '../registry';
import { changeTagInCode, convertToMotionLinkInCode, updateHtmlAttrsInCode } from '@/code/generation/generator-attrs';
import { scanTagAttrs, readTagAttr } from '@/code/components/jsx-tag-attrs';
import { findJSXDataIdIndex, findTagClose } from '@/code/generation/generator-utils';
import { isCodeComponentSource } from '@/code/oracle/checks/shared';

function ensureNextLinkImport(code: string): string {
  if (/import\s+Link\s+from\s+['"]next\/link['"]/.test(code)) return code;
  const importLine = `import Link from 'next/link';`;
  const lastImportMatch = Array.from(code.matchAll(/^import\s+[^;]+;(?:\r?\n)?/gm)).pop();
  if (lastImportMatch && lastImportMatch.index !== undefined) {
    const insertPos = lastImportMatch.index + lastImportMatch[0].length;
    return code.slice(0, insertPos) + importLine + '\n' + code.slice(insertPos);
  }
  const clientDirective = code.match(/^(\uFEFF?[ \t]*(['"])use client\2;?[ \t]*)(\r?\n|$)/);
  if (clientDirective) {
    const insertPos = clientDirective[0].length;
    const separator = clientDirective[3] || '\n';
    return code.slice(0, insertPos) + (separator ? '' : '\n') + importLine + '\n' + code.slice(insertPos);
  }
  return importLine + '\n' + code;
}

function clearLinkAttributes(code: string, nodeId: string, targetFile: string): string {
  if (!targetFile.startsWith('components/')) {
    const idIndex = findJSXDataIdIndex(code, nodeId);
    const tagStart = idIndex === -1 ? -1 : code.lastIndexOf('<', idIndex);
    const tagName = tagStart === -1 ? null : code.slice(tagStart + 1).match(/^([\w.]+)/)?.[1] ?? null;
    if (tagName === 'Link') code = changeTagInCode(code, nodeId, 'a');
  }
  return updateHtmlAttrsInCode(code, nodeId, {
    href: '',
    target: '',
    rel: '',
    prefetch: '',
  });
}

// 1. links.get
export const linksGetOperation: Operation<
  {
    targetFile: string;
    nodeId: string;
  },
  {
    nodeId: string;
    url: string | null;
    newTab: boolean;
    rel: string | null;
    prefetch: boolean | null;
  }
> = {
  name: 'links.get',
  description: 'Read link destination and options on an element',
  category: 'navigation',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T10',
  inputSchema: z.object({
    targetFile: z.string().min(1),
    nodeId: z.string().min(1),
  }),
  async execute(snapshot, input) {
    const code = snapshot.files.get(input.targetFile);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Target file "${input.targetFile}" not found in project`);
    }

    const idIndex = findJSXDataIdIndex(code, input.nodeId);
    if (idIndex === -1) {
      throw new Error(`NODE_NOT_FOUND: Node with data-id "${input.nodeId}" not found in "${input.targetFile}"`);
    }

    const tagStart = code.lastIndexOf('<', idIndex);
    const tagEnd = findTagClose(code, idIndex);
    if (tagStart === -1 || tagEnd === -1) {
      throw new Error(`TAG_NOT_FOUND: Could not locate tag boundaries for "${input.nodeId}"`);
    }

    const tagStr = code.slice(tagStart, tagEnd + 1);
    const hrefAttr = readTagAttr(tagStr, 'href');
    const targetAttr = readTagAttr(tagStr, 'target');
    const relAttr = readTagAttr(tagStr, 'rel');
    const prefetchAttr = readTagAttr(tagStr, 'prefetch');

    const attrToString = (attr: ReturnType<typeof readTagAttr>): string | null => {
      if (!attr) return null;
      if (attr.kind === 'string') return attr.text;
      if (attr.kind === 'expr') return attr.source;
      return '';
    };

    const url = attrToString(hrefAttr);
    const target = attrToString(targetAttr);
    const rel = attrToString(relAttr);
    const prefetch = prefetchAttr
      ? prefetchAttr.kind === 'expr'
        ? prefetchAttr.source === 'true'
        : prefetchAttr.kind === 'bare'
      : null;

    return {
      nodeId: input.nodeId,
      url,
      newTab: target === '_blank',
      rel,
      prefetch,
    };
  },
};

// 2. links.set
export const linksSetOperation: Operation<
  {
    targetFile: string;
    nodeId: string;
    url: string;
    newTab?: boolean;
    rel?: string;
    prefetch?: boolean;
  },
  {
    changes: FileChange[];
  }
> = {
  name: 'links.set',
  description: 'Configure link navigation on an element (url, new tab, rel, prefetch; empty url removes link)',
  category: 'navigation',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T10',
  inputSchema: z.object({
    targetFile: z.string().min(1),
    nodeId: z.string().min(1),
    url: z.string(),
    newTab: z.boolean().optional(),
    rel: z.string().optional(),
    prefetch: z.boolean().optional(),
  }),
  async execute(snapshot, input) {
    let code = snapshot.files.get(input.targetFile);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Target file "${input.targetFile}" not found in project`);
    }

    const idIndex = findJSXDataIdIndex(code, input.nodeId);
    if (idIndex === -1) {
      throw new Error(`NODE_NOT_FOUND: Node with data-id "${input.nodeId}" not found in "${input.targetFile}"`);
    }

    // Invariant 3: empty url removes link attributes
    if (input.url === '') {
      code = clearLinkAttributes(code, input.nodeId, input.targetFile);
    } else {
      const isDesignComponent = input.targetFile.startsWith('components/') && !isCodeComponentSource(code);
      const isExternal = /^(https?:\/\/|mailto:|tel:)/i.test(input.url);

      if (isDesignComponent) {
        // Design components animate layout/variants, so a raw <a> is both
        // invalid for Next navigation and invisible to the Motion graph.
        code = convertToMotionLinkInCode(code, input.nodeId);
        code = ensureNextLinkImport(code);
      } else if (!input.targetFile.startsWith('components/')) {
        // Pages/templates use Next Link for internal navigation; external
        // destinations remain native anchors, which is the correct browser
        // behavior and the dialect's explicit exception.
        code = changeTagInCode(code, input.nodeId, isExternal ? 'a' : 'Link');
        if (!isExternal) code = ensureNextLinkImport(code);
      }

      const attrs: Record<string, string> = {
        href: input.url,
      };

      if (input.newTab !== undefined) {
        attrs.target = input.newTab ? '_blank' : '';
      }
      if (input.rel !== undefined) {
        attrs.rel = input.rel;
      } else if (input.newTab) {
        attrs.rel = 'noopener noreferrer';
      }
      if (input.prefetch !== undefined) {
        attrs.prefetch = input.prefetch ? 'true' : 'false';
      }

      code = updateHtmlAttrsInCode(code, input.nodeId, attrs);
    }

    return {
      changes: [
        {
          path: input.targetFile,
          beforeHash: null,
          content: code,
        },
      ],
    };
  },
};

// 3. links.remove
export const linksRemoveOperation: Operation<
  {
    targetFile: string;
    nodeId: string;
  },
  {
    changes: FileChange[];
  }
> = {
  name: 'links.remove',
  description: 'Remove link navigation from an element',
  category: 'navigation',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T10',
  inputSchema: z.object({
    targetFile: z.string().min(1),
    nodeId: z.string().min(1),
  }),
  async execute(snapshot, input) {
    let code = snapshot.files.get(input.targetFile);
    if (!code) {
      throw new Error(`FILE_NOT_FOUND: Target file "${input.targetFile}" not found in project`);
    }

    const idIndex = findJSXDataIdIndex(code, input.nodeId);
    if (idIndex === -1) {
      throw new Error(`NODE_NOT_FOUND: Node with data-id "${input.nodeId}" not found in "${input.targetFile}"`);
    }

    code = clearLinkAttributes(code, input.nodeId, input.targetFile);

    return {
      changes: [
        {
          path: input.targetFile,
          beforeHash: null,
          content: code,
        },
      ],
    };
  },
};

defaultRegistry.register(linksGetOperation);
defaultRegistry.register(linksSetOperation);
defaultRegistry.register(linksRemoveOperation);
