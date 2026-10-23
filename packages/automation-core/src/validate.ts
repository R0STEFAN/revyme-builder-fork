import { parse } from '@babel/parser';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Snapshot, Plan, Issue } from './contracts';
import { checkFile } from '@/code/oracle/check-file';
import { isCodeComponentSource } from '@/code/oracle/checks/shared';

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
      } else {
        const hash = createHash('sha256').update(existing).digest('hex');
        if (change.beforeHash !== hash) {
          issues.push({
            code: 'BEFORE_HASH_MISMATCH',
            path: [filePath],
            message: `File ${filePath} beforeHash mismatch: expected ${change.beforeHash}, got ${hash}`,
          });
        }
      }
    }

    if (change.content === null) {
      // Deletion is valid
      continue;
    }

    // Only validate JSX/TSX syntax and rules for JS/TS/JSX/TSX files
    if (/\.(tsx|jsx|ts|js)$/.test(filePath)) {
      const isLayout = /(^|\/)layout\.(tsx|ts)$/.test(filePath);
      const isProvider = /(^|\/)providers\.(tsx|ts)$/.test(filePath);
      const isCodeComp = filePath.startsWith('components/') && isCodeComponentSource(change.content);

      validateSourceCode(filePath, change.content, projectedFiles, issues, isCodeComp || isLayout || isProvider);

      // Run Oracle check for TSX/JSX authoring files (client pages, components, templates)
      const isServerPageEntry = /(^|\/)page\.(tsx|ts)$/.test(filePath) && !filePath.includes('.client.');
      if (/\.(tsx|jsx)$/.test(filePath) && !isLayout && !isProvider && !isServerPageEntry) {
        let kind: 'page' | 'component' | 'code-component' | 'template' = 'page';
        if (filePath.startsWith('components/')) {
          kind = isCodeComp ? 'code-component' : 'component';
        } else if (filePath.includes('template')) {
          kind = 'template';
        }

        try {
          const oracleViolations = checkFile(change.content, { kind, path: filePath })
            .filter((v) => v.code !== 'CANVAS_CONFIG_MISSING');
          for (const v of oracleViolations) {
            issues.push({
              code: v.code,
              path: [filePath, ...(v.elementId ? [v.elementId] : [])],
              message: v.message,
              source: { file: filePath, line: v.line ?? 1 },
            });
          }
        } catch (err: any) {
          issues.push({
            code: 'ORACLE_CHECK_FAILED',
            path: [filePath],
            message: err?.message || String(err),
          });
        }
      }
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
  issues: Issue[],
  exemptFromDataId = false
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

    // Check relative and alias imports
    if (node.type === 'ImportDeclaration') {
      const specifier = node.moduleSpecifier?.value ?? node.source?.value;
      if (typeof specifier === 'string') {
        let candidatePath: string | null = null;
        if (specifier.startsWith('.')) {
          candidatePath = path.normalize(path.join(path.dirname(filePath), specifier));
        } else if (specifier.startsWith('@/')) {
          candidatePath = specifier.slice(2);
        }

        if (candidatePath) {
          // Check extensions: .tsx, .ts, .jsx, .js, /index.tsx, etc.
          const extensions = ['', '.tsx', '.ts', '.jsx', '.js', '/index.tsx', '/index.ts'];
          const found = extensions.some(
            (ext) => allFiles.has(candidatePath! + ext) || allFiles.has('src/' + candidatePath! + ext)
          );
          if (!found) {
            issues.push({
              code: 'UNRESOLVED_IMPORT',
              path: [filePath],
              message: `Unresolved import "${specifier}" in ${filePath}`,
              source: { file: filePath, line: node.loc?.start?.line ?? 1 },
            });
          }
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

      if (!exemptFromDataId && !dataId && !isInline && tagName) {
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
