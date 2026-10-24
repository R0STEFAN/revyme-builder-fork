import { parse } from '@babel/parser';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Snapshot, Plan, Issue } from './contracts';
import { checkFile } from '@/code/oracle/check-file';
import { isBuilderMaterializedFile } from '@/code/oracle/file-kind';
import { isCodeComponentSource } from '@/code/oracle/checks/shared';
import { calculatePlanHash } from './session';
import { validateBranchAction } from './operations/scoped-branches';
import { safeProjectPath, validateRestoreAction } from './operations/scoped-restore';

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
  // Responsive CSS is editor-owned metadata, not a selectable canvas node.
  'style',
]);

export function validatePlan(snapshot: Snapshot, plan: Plan): { ok: boolean; issues: Issue[] } {
  const issues: Issue[] = [...plan.issues];
  const calculatedPlanHash = calculatePlanHash(plan.scope, plan.baseRevision, plan.operationId, plan.changes, plan);
  if (calculatedPlanHash !== plan.planHash) {
    issues.push({ code: 'PLAN_HASH_MISMATCH', path: ['planHash'], message: `Plan bytes do not match planHash (received ${plan.planHash}, calculated ${calculatedPlanHash})` });
  }
  if (plan.scope.projectId !== snapshot.scope.projectId || plan.scope.branchId !== snapshot.scope.branchId) {
    issues.push({ code: 'SCOPE_MISMATCH', path: ['scope'], message: 'Plan scope does not match snapshot' });
  }
  if (plan.projectAction) {
    const error = plan.projectAction.kind === 'project.restore'
      ? validateRestoreAction(snapshot, plan.projectAction)
      : plan.projectAction.kind === 'project.duplicate'
      ? (!/^[A-Za-z0-9_-]{1,120}$/.test(plan.projectAction.id) || plan.projectAction.id === snapshot.scope.projectId || !plan.projectAction.name.trim() || plan.projectAction.name !== plan.projectAction.name.trim() ? 'Invalid duplicate project name or id.' : null)
      : validateBranchAction(snapshot, plan.projectAction);
    if (error || plan.changes.length) issues.push({ code: 'INVALID_PROJECT_ACTION', path: ['projectAction'],
      message: error ?? 'Project actions cannot be combined with file changes' });
    if (!error && !plan.changes.length && (plan.projectAction.kind === 'branch.apply' || plan.projectAction.kind === 'project.restore')) {
      const mainSnapshot: Snapshot = { ...snapshot, scope: { ...snapshot.scope, branchId: 'main' }, files: new Map(Object.entries(snapshot.mainFiles ?? {})) };
      const mainPlan: Plan = { ...plan, scope: mainSnapshot.scope, changes: plan.projectAction.mainChanges,
        projectAction: undefined, issues: [], planHash: '' };
      mainPlan.planHash = calculatePlanHash(mainPlan.scope, mainPlan.baseRevision, mainPlan.operationId, mainPlan.changes, mainPlan);
      issues.push(...validatePlan(mainSnapshot, mainPlan).issues);
      if (plan.projectAction.kind === 'project.restore' && plan.projectAction.branches) {
        for (const [id, value] of Object.entries(plan.projectAction.branches)) {
          const branch = value as { files: Record<string, string> };
          const old = (snapshot.branches?.[id] as { files?: Record<string, string> } | undefined)?.files ?? {};
          const files = new Map(Object.entries(old));
          const changes = [...new Set([...Object.keys(old), ...Object.keys(branch.files)])].sort()
            .filter(path => old[path] !== branch.files[path])
            .map(path => ({ path, beforeHash: Object.prototype.hasOwnProperty.call(old, path) ? createHash('sha256').update(old[path]).digest('hex') : null,
              content: Object.prototype.hasOwnProperty.call(branch.files, path) ? branch.files[path] : null }));
          const branchSnapshot: Snapshot = { ...snapshot, scope: { ...snapshot.scope, branchId: id }, files };
          const branchPlan: Plan = { ...mainPlan, scope: branchSnapshot.scope, changes, planHash: '' };
          branchPlan.planHash = calculatePlanHash(branchPlan.scope, branchPlan.baseRevision, branchPlan.operationId, changes, branchPlan);
          issues.push(...validatePlan(branchSnapshot, branchPlan).issues.map(issue => ({ ...issue, path: ['branches', id, ...issue.path] })));
        }
      }
    }
  }

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
  const seenPaths = new Set<string>();
  for (const change of plan.changes) {
    const filePath = change.path;
    if (!safeProjectPath(filePath)) {
      issues.push({ code: 'INVALID_PATH', path: [filePath], message: `Invalid project file path: ${filePath}` });
    }
    if (seenPaths.has(filePath)) {
      issues.push({ code: 'DUPLICATE_FILE_CHANGE', path: [filePath], message: `Plan contains more than one change for ${filePath}` });
    }
    seenPaths.add(filePath);

    // Check beforeHash
    {
      const existing = snapshot.files.get(filePath);
      if (change.beforeHash === null && existing !== undefined) {
        issues.push({ code: 'BEFORE_HASH_MISMATCH', path: [filePath],
          message: `File ${filePath} already exists but the plan expects it to be absent` });
      } else if (change.beforeHash !== null) {
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
    }

    if (change.content === null) {
      // Deletion is valid
      continue;
    }

    // Only validate JSX/TSX syntax and rules for JS/TS/JSX/TSX files
    if (/\.(tsx|jsx|ts|js)$/.test(filePath)) {
      const isLayout = /(^|\/)layout\.(tsx|ts)$/.test(filePath);
      const isTemplateClient = /^app\/\([^)]+\)\/LayoutClient\.tsx$/.test(filePath);
      const isProvider = /(^|\/)providers\.(tsx|ts)$/.test(filePath);
      const isCodeComp = filePath.startsWith('components/') && isCodeComponentSource(change.content);
      const isBuilderMaterialized = isBuilderMaterializedFile(change.content);
      const isPluginSource = /^plugins\/.+\.tsx$/.test(filePath);
      const isOverrideSource = /^overrides\/.+\.tsx?$/.test(filePath);
      // This generated controller is an internal App Router helper, not an
      // editable page. Its runtime DOM/animation code must not be interpreted
      // as canvas-authored JSX by the page dialect Oracle.
      const isGeneratedPageTransitionsRuntime =
        /^app\/(?:\([^)]+\)\/)?page-transitions\.tsx$/.test(filePath) &&
        change.content.includes('@rt-v9');
      validateSourceCode(
        filePath,
        change.content,
        projectedFiles,
        issues,
        isCodeComp || isLayout || isProvider || isGeneratedPageTransitionsRuntime || isBuilderMaterialized || isPluginSource || isOverrideSource,
      );

      // Run Oracle check for TSX/JSX authoring files (client pages, components, templates)
      const isServerPageEntry = /(^|\/)page\.(tsx|ts)$/.test(filePath) && !filePath.includes('.client.');
      if (/\.(tsx|jsx)$/.test(filePath) && !isLayout && !isProvider && !isServerPageEntry && !isGeneratedPageTransitionsRuntime && !isBuilderMaterialized && !isPluginSource && !isOverrideSource) {
        let kind: 'page' | 'component' | 'code-component' | 'template' = 'page';
        if (filePath.startsWith('components/')) {
          kind = isCodeComp ? 'code-component' : 'component';
        } else if (isTemplateClient) {
          kind = 'template';
        }

        try {
          const oracleViolations = checkFile(change.content, {
            kind,
            path: filePath,
            projectFiles: new Set(projectedFiles.keys()),
          })
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

  // Deletions and renames can break imports in files which were not edited.
  // Report newly broken dependencies without making legacy diagnostics a save blocker.
  const changedPaths = new Set(plan.changes.map((change) => change.path));
  for (const [filePath, content] of projectedFiles) {
    if (changedPaths.has(filePath) || !/\.(tsx|jsx|ts|js)$/.test(filePath)) continue;
    const before: Issue[] = [];
    const after: Issue[] = [];
    validateSourceCode(filePath, content, new Map(snapshot.files), before, true);
    validateSourceCode(filePath, content, projectedFiles, after, true);
    const oldImports = new Set(before.filter((i) => i.code === 'UNRESOLVED_IMPORT').map((i) => i.message));
    issues.push(...after.filter((i) => i.code === 'UNRESOLVED_IMPORT' && !oldImports.has(i.message)));
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

  function walk(node: any, insideMotionLinkScaffold = false) {
    if (!node || typeof node !== 'object') return;
    // MotionLink's module-scope forwardRef adapter contains a private <Link>
    // and fallback <div>. These are implementation plumbing, not authored
    // canvas nodes; keep this lightweight pass aligned with checkFile's
    // needsDataId exemption so generated components pass both validation layers.
    const inMotionLinkScaffold = insideMotionLinkScaffold || (
      node.type === 'VariableDeclarator' &&
      node.id?.type === 'Identifier' &&
      node.id.name === 'MotionLink'
    );

    // Check relative and alias imports
    if (node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') {
      const specifier = node.moduleSpecifier?.value ?? node.source?.value;
      if (typeof specifier === 'string') {
        let candidatePath: string | null = null;
        if (specifier.startsWith('.')) {
          candidatePath = path.posix.normalize(path.posix.join(path.posix.dirname(filePath), specifier));
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

      if (!exemptFromDataId && !inMotionLinkScaffold && !dataId && !isInline && tagName) {
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
          for (const c of child) walk(c, inMotionLinkScaffold);
        } else if (child && typeof child === 'object') {
          walk(child, inMotionLinkScaffold);
        }
      }
    }
  }

  walk(ast.program);
}
