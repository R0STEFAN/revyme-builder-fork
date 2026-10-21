// packages/automation-core/src/validate.ts
import { parse } from '@babel/parser';
import path from 'node:path';
import type { Snapshot, Plan, Issue } from './contracts';

const TRANSPARENT_INLINE_TAGS = new Set([
  'span',
  'strong',
  'b',
  'em',
  'i',
  'u',
  'code',
  'small',
  'sub',
  'sup',
  'br',
  'wbr',
]);

export function validatePlan(snapshot: Snapshot, plan: Plan): { ok: boolean; issues: Issue[] } {
  const issues: Issue[] = [...plan.issues];

  // 1. Revision freshness check
  if (plan.baseRevision !== snapshot.revision) {
    issues.push({
      code: 'STALE_REVISION',
      path: ['baseRevision'],
      message: `Plan base revision ${plan.baseRevision} does not match snapshot revision ${snapshot.revision}`,
    });
  }

  // 2. Build map of all projected files
  const projectedFiles = new Map<string, string>(snapshot.files);
  for (const ch of plan.changes) {
    if (ch.content === null) {
      projectedFiles.delete(ch.path);
    } else {
      projectedFiles.set(ch.path, ch.content);
    }
  }

  // 3. Validate each changed file
  for (const change of plan.changes) {
    const filePath = change.path;

    // Check beforeHash
    if (change.beforeHash) {
      const existing = snapshot.files.get(filePath);
      if (existing === undefined) {
        issues.push({
          code: 'BEFORE_HASH_MISMATCH',
          path: [filePath],
          message: `File ${filePath} expected beforeHash but file does not exist in base snapshot`,
        });
      }
    }

    if (change.content === null) {
      // Deletion is valid
      continue;
    }

    // Only validate JSX/TSX syntax and rules for JS/TS/JSX/TSX files
    if (/\.(tsx|jsx|ts|js)$/.test(filePath)) {
      validateSourceCode(filePath, change.content, projectedFiles, issues);
    }
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}

function validateSourceCode(
  filePath: string,
  content: string,
  allFiles: Map<string, string>,
  issues: Issue[]
): void {
  let ast: any;
  try {
    ast = parse(content, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
    });
  } catch (err: any) {
    issues.push({
      code: 'SYNTAX_ERROR',
      path: [filePath],
      message: `Syntax error in ${filePath}: ${err.message}`,
      source: { file: filePath, line: err.loc?.line ?? 1 },
    });
    return;
  }

  const seenIds = new Set<string>();

  function walk(node: any) {
    if (!node || typeof node !== 'object') return;

    // Check relative imports
    if (node.type === 'ImportDeclaration') {
      const specifier = node.moduleSpecifier?.value ?? node.source?.value;
      if (typeof specifier === 'string' && specifier.startsWith('.')) {
        const resolvedBase = path.normalize(path.join(path.dirname(filePath), specifier));
        // Check extensions: .tsx, .ts, .jsx, .js, /index.tsx, etc.
        const extensions = ['', '.tsx', '.ts', '.jsx', '.js', '/index.tsx', '/index.ts'];
        const found = extensions.some((ext) => allFiles.has(resolvedBase + ext));
        if (!found) {
          issues.push({
            code: 'UNRESOLVED_IMPORT',
            path: [filePath],
            message: `Unresolved relative import "${specifier}" in ${filePath}`,
            source: { file: filePath, line: node.loc?.start?.line ?? 1 },
          });
        }
      }
    }

    // Check JSX elements for data-id and duplicate data-id
    if (node.type === 'JSXElement') {
      const opening = node.openingElement;
      let tagName = '';
      if (opening.name.type === 'JSXIdentifier') {
        tagName = opening.name.name;
      }

      const isInline = TRANSPARENT_INLINE_TAGS.has(tagName.toLowerCase());

      let dataId: string | undefined;
      for (const attr of opening.attributes) {
        if (attr.type === 'JSXAttribute' && attr.name.name === 'data-id') {
          if (attr.value?.type === 'StringLiteral') {
            dataId = attr.value.value;
          }
        }
      }

      if (!dataId && !isInline && tagName) {
        // UpperCase tags can be custom component instances or icons;
        // Standard structural tags (div, section, main, header, footer, button, etc.) require data-id
        const isStandardTag = /^[a-z]/.test(tagName);
        if (isStandardTag) {
          issues.push({
            code: 'MISSING_DATA_ID',
            path: [filePath],
            message: `Element <${tagName}> in ${filePath} is missing required data-id attribute`,
            source: { file: filePath, line: opening.loc?.start?.line ?? 1 },
          });
        }
      }

      if (dataId) {
        if (seenIds.has(dataId)) {
          issues.push({
            code: 'DUPLICATE_DATA_ID',
            path: [filePath, dataId],
            message: `Duplicate data-id "${dataId}" detected in ${filePath}`,
            source: { file: filePath, line: opening.loc?.start?.line ?? 1 },
          });
        } else {
          seenIds.add(dataId);
        }
      }
    }

    for (const key of Object.keys(node)) {
      if (key !== 'loc') {
        const child = node[key];
        if (Array.isArray(child)) {
          for (const c of child) walk(c);
        } else if (child && typeof child === 'object') {
          walk(child);
        }
      }
    }
  }

  walk(ast.program);
}
