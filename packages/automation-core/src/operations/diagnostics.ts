// packages/automation-core/src/operations/diagnostics.ts
import { z } from 'zod';
import type { Operation, Snapshot, OperationContext } from '../contracts';
import { defaultRegistry } from '../registry';
import { checkFile, type FileKind } from '@/code/oracle/check-file';
import { isCodeComponentSource } from '@/code/oracle/checks/shared';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import * as t from '@babel/types';

const traverse = (typeof _traverse === 'function' ? _traverse : (_traverse as any).default) as typeof _traverse;

export const diagnosticsCategorySchema = z.enum([
  'oracle',
  'imports',
  'assets',
  'links',
  'layoutCycles',
  'slots',
  'components',
  'syntax',
]);

export const diagnosticsProjectCheckInputSchema = z.object({
  targetFile: z.string().optional().describe('Optional path to check a single file; omits for full workspace sweep'),
  fileFilter: z.string().optional().describe('Optional path or filter pattern'),
  branchId: z.string().optional().describe('Target branch ID'),
  strict: z.boolean().optional().describe('If true, tier 1-2 drift violations mark clean: false'),
  categories: z.array(diagnosticsCategorySchema).optional().describe('Categories to run; defaults to all'),
});

export const brokenImportIssueSchema = z.object({
  file: z.string(),
  line: z.number().int().positive(),
  importPath: z.string(),
  message: z.string(),
});

export const missingAssetIssueSchema = z.object({
  file: z.string(),
  path: z.string().optional(),
  line: z.number().int().positive().optional(),
  assetPath: z.string(),
  assetRef: z.string().optional(),
  nodeId: z.string().optional(),
  elementId: z.string().optional(),
  message: z.string().optional(),
});

export const brokenLinkIssueSchema = z.object({
  file: z.string().optional(),
  path: z.string(),
  href: z.string(),
  elementId: z.string().optional(),
  line: z.number().int().positive().optional(),
  message: z.string().optional(),
});

export const circularBindingIssueSchema = z.object({
  file: z.string(),
  kind: z.enum(['slot', 'pinned', 'container']),
  cycle: z.array(z.string()),
  message: z.string(),
});

export const unlinkedSlotIssueSchema = z.object({
  file: z.string(),
  componentId: z.string(),
  slotName: z.string().optional(),
  nodeId: z.string().optional(),
  message: z.string(),
});

export const oracleViolationReportSchema = z.object({
  file: z.string(),
  path: z.string().optional(),
  kind: z.string(),
  code: z.string(),
  tier: z.number().int(),
  line: z.number().int().optional(),
  column: z.number().int().optional(),
  elementId: z.string().optional(),
  message: z.string(),
});

export const diagnosticsProjectCheckOutputSchema = z.object({
  clean: z.boolean(),
  passed: z.boolean(),
  totalFiles: z.number().int().nonnegative(),
  totalFilesChecked: z.number().int().nonnegative(),
  cleanFiles: z.number().int().nonnegative(),
  errorFiles: z.number().int().nonnegative(),
  blockingViolationsCount: z.number().int().nonnegative(),
  driftViolationsCount: z.number().int().nonnegative(),
  violationsCount: z.number().int().nonnegative(),
  missingAssetsCount: z.number().int().nonnegative(),
  brokenLinksCount: z.number().int().nonnegative(),
  brokenImports: z.array(brokenImportIssueSchema),
  missingAssets: z.array(missingAssetIssueSchema),
  brokenLinks: z.array(brokenLinkIssueSchema),
  circularBindings: z.array(circularBindingIssueSchema),
  unlinkedSlots: z.array(unlinkedSlotIssueSchema),
  oracleViolations: z.array(oracleViolationReportSchema),
  violations: z.array(oracleViolationReportSchema),
  summary: z.string(),
  suggestedFixes: z.array(z.string()),
});

export type DiagnosticsProjectCheckInput = z.infer<typeof diagnosticsProjectCheckInputSchema>;
export type DiagnosticsProjectCheckOutput = z.infer<typeof diagnosticsProjectCheckOutputSchema>;

function resolveRelativeImport(fromFile: string, relPath: string): string {
  const parts = fromFile.split('/');
  parts.pop(); // remove file name
  const relParts = relPath.split('/');
  for (const p of relParts) {
    if (p === '.') continue;
    if (p === '..') parts.pop();
    else parts.push(p);
  }
  return parts.join('/');
}

const isCanvasEditableSource = (filePath: string) =>
  filePath.startsWith('components/') ||
  (filePath.startsWith('app/') && filePath.endsWith('.client.tsx'));

function detectCyclesInAdjacency(adj: Map<string, string[]>): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const recStack = new Set<string>();

  function dfs(curr: string, path: string[]) {
    visited.add(curr);
    recStack.add(curr);
    path.push(curr);

    const neighbors = adj.get(curr) || [];
    for (const next of neighbors) {
      if (!visited.has(next)) {
        dfs(next, [...path]);
      } else if (recStack.has(next)) {
        const cycleStart = path.indexOf(next);
        cycles.push([...path.slice(cycleStart), next]);
      }
    }

    recStack.delete(curr);
  }

  for (const node of adj.keys()) {
    if (!visited.has(node)) dfs(node, []);
  }
  return cycles;
}

export const diagnosticsProjectCheckOperation: Operation<
  DiagnosticsProjectCheckInput,
  DiagnosticsProjectCheckOutput
> = {
  name: 'diagnostics.projectCheck',
  description: 'Comprehensive project audit across Oracle syntax/dialect rules, missing assets, and broken routes',
  category: 'diagnostics',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T24',
  inputSchema: diagnosticsProjectCheckInputSchema,
  outputSchema: diagnosticsProjectCheckOutputSchema,
  async execute(snapshot: Snapshot, input: DiagnosticsProjectCheckInput, _context: OperationContext) {
    const targetFilter = input.targetFile ?? input.fileFilter;
    const allFiles = Array.from(snapshot.files.keys());
    const filesToCheck = targetFilter
      ? allFiles.filter((f) => f === targetFilter || f.includes(targetFilter))
      : allFiles;

    const oracleViolations: z.infer<typeof oracleViolationReportSchema>[] = [];
    const brokenImports: z.infer<typeof brokenImportIssueSchema>[] = [];
    const missingAssets: z.infer<typeof missingAssetIssueSchema>[] = [];
    const brokenLinks: z.infer<typeof brokenLinkIssueSchema>[] = [];
    const circularBindings: z.infer<typeof circularBindingIssueSchema>[] = [];
    const unlinkedSlots: z.infer<typeof unlinkedSlotIssueSchema>[] = [];

    let checkedCount = 0;
    const filesWithErrors = new Set<string>();

    // 1. Per-file AST and Oracle checks
    for (const filePath of filesToCheck) {
      if (!filePath.endsWith('.tsx') && !filePath.endsWith('.ts')) continue;
      const code = snapshot.files.get(filePath);
      if (!code) continue;
      checkedCount++;

      // Oracle rules describe Builder-editable source, not generated Next wrappers or plugins.
      if (isCanvasEditableSource(filePath)) {
        const kind: FileKind = filePath.includes('/page')
          ? 'page'
          : filePath.includes('/layout') || filePath.includes('/template')
          ? 'template'
          : isCodeComponentSource(code)
          ? 'code-component'
          : 'component';

        try {
          const projectFiles = new Set(projectFS.listFiles());
          const violations = checkFile(code, { kind, path: filePath, projectFiles });
          for (const v of violations) {
            oracleViolations.push({
              file: filePath,
              path: filePath,
              kind,
              code: v.code,
              tier: v.tier,
              line: v.line,
              elementId: v.elementId,
              message: v.message,
            });
            if (v.tier >= 3 || v.code === 'SYNTAX_ERROR' || input.strict) {
              filesWithErrors.add(filePath);
            }
          }
        } catch (err) {
          oracleViolations.push({
            file: filePath,
            path: filePath,
            kind,
            code: 'SYNTAX_ERROR',
            tier: 3,
            line: 1,
            message: err instanceof Error ? err.message : String(err),
          });
          filesWithErrors.add(filePath);
        }
      } else {
        try {
          parse(code, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
        } catch (err) {
          oracleViolations.push({
            file: filePath,
            path: filePath,
            kind: 'source',
            code: 'SYNTAX_ERROR',
            tier: 3,
            line: 1,
            message: err instanceof Error ? err.message : String(err),
          });
          filesWithErrors.add(filePath);
        }
      }

      // B. AST Imports, Assets, and Links Check
      try {
        const ast = parse(code, {
          sourceType: 'module',
          plugins: ['jsx', 'typescript'],
        });

        traverse(ast, {
          ImportDeclaration(pathNode) {
            const src = pathNode.node.source.value;
            const line = pathNode.node.loc?.start.line ?? 1;

            if (src.startsWith('./') || src.startsWith('../')) {
              const resolved = resolveRelativeImport(filePath, src);
              const exists =
                snapshot.files.has(resolved) ||
                snapshot.files.has(`${resolved}.tsx`) ||
                snapshot.files.has(`${resolved}.ts`) ||
                snapshot.files.has(`${resolved}/index.tsx`) ||
                snapshot.files.has(`${resolved}/index.ts`);

              if (!exists) {
                brokenImports.push({
                  file: filePath,
                  line,
                  importPath: src,
                  message: `Relative import "${src}" does not resolve to an existing project file`,
                });
                filesWithErrors.add(filePath);
              }
            } else if (src.startsWith('@/components/')) {
              const compName = src.replace('@/components/', '');
              const expected1 = `components/${compName}.tsx`;
              const expected2 = `components/${compName}/index.tsx`;
              const exists = snapshot.files.has(expected1) || snapshot.files.has(expected2);

              if (!exists) {
                brokenImports.push({
                  file: filePath,
                  line,
                  importPath: src,
                  message: `Component "${compName}" not found at "${expected1}"`,
                });
                filesWithErrors.add(filePath);
              }
            } else if (src.startsWith('@/cms/')) {
              const cmsRel = src.replace('@/', '');
              const exists = snapshot.files.has(cmsRel) || snapshot.files.has(`${cmsRel}.json`);
              if (!exists) {
                brokenImports.push({
                  file: filePath,
                  line,
                  importPath: src,
                  message: `CMS collection "${src}" does not exist in workspace`,
                });
                filesWithErrors.add(filePath);
              }
            }
          },

          JSXElement(pathNode) {
            const opening = pathNode.node.openingElement;
            const line = pathNode.node.loc?.start.line ?? 1;

            let dataId: string | undefined;
            for (const attr of opening.attributes) {
              if (attr.type === 'JSXAttribute' && attr.name.name === 'data-id') {
                if (attr.value?.type === 'StringLiteral') {
                  dataId = attr.value.value;
                }
              }
            }

            // Assets check (<img src=...>, <video poster=...>)
            for (const attr of opening.attributes) {
              if (attr.type === 'JSXAttribute' && (attr.name.name === 'src' || attr.name.name === 'poster')) {
                if (attr.value?.type === 'StringLiteral') {
                  const val = attr.value.value;
                  if (val.startsWith('/') && !val.startsWith('//') && !val.startsWith('http') && !val.startsWith('data:')) {
                    const assetRel = val.replace(/^\//, '');
                    const exists =
                      snapshot.files.has(assetRel) ||
                      snapshot.files.has(`public/${assetRel}`);

                    if (!exists) {
                      missingAssets.push({
                        file: filePath,
                        path: filePath,
                        line,
                        assetPath: val,
                        assetRef: val,
                        nodeId: dataId,
                        elementId: dataId,
                        message: `Referenced local asset "${val}" does not exist in workspace or public folder`,
                      });
                      filesWithErrors.add(filePath);
                    }
                  }
                }
              }
            }

            // Links check (<a href=...> or <Link href=...>)
            for (const attr of opening.attributes) {
              if (attr.type === 'JSXAttribute' && attr.name.name === 'href') {
                if (attr.value?.type === 'StringLiteral') {
                  const href = attr.value.value;
                  if (href.startsWith('/') && !href.startsWith('//') && !href.startsWith('/#') && href !== '/') {
                    const cleanRoute = href.split('?')[0].split('#')[0].replace(/^\//, '');
                    const page1 = `app/${cleanRoute}/page.client.tsx`;
                    const page2 = `app/${cleanRoute}/page.tsx`;
                    const page3 = `app/${cleanRoute}.client.tsx`;
                    const page4 = `app/${cleanRoute}.tsx`;
                    const routeExists =
                      snapshot.files.has(page1) ||
                      snapshot.files.has(page2) ||
                      snapshot.files.has(page3) ||
                      snapshot.files.has(page4);

                    if (!routeExists) {
                      brokenLinks.push({
                        file: filePath,
                        path: filePath,
                        href,
                        elementId: dataId,
                        line,
                        message: `Internal link "${href}" does not match any known route`,
                      });
                    }
                  }
                }
              }
            }
          },
        });
      } catch {
        // Handled by Oracle syntax check
      }
    }

    // 2. Circular Slot Dependencies Across Workspace
    const slotGraph = new Map<string, string[]>();
    for (const [filePath, code] of snapshot.files) {
      if (!filePath.endsWith('.tsx')) continue;
      const cnDecls = code.matchAll(/const\s+(cn_[a-zA-Z0-9_]+)\s*=\s*\(([\s\S]*?)\);/g);
      for (const m of cnDecls) {
        const id = m[1];
        const body = m[2];
        const refs = Array.from(body.matchAll(/\{(cn_[a-zA-Z0-9_]+)\}/g)).map((rm) => rm[1]);
        slotGraph.set(id, refs);
      }
    }

    const slotCycles = detectCyclesInAdjacency(slotGraph);
    for (const c of slotCycles) {
      circularBindings.push({
        file: 'workspace',
        kind: 'slot',
        cycle: c,
        message: `Circular slot dependency detected: ${c.join(' -> ')}`,
      });
    }

    // 3. Overall Statistics & Verdict
    const blockingOracleViolations = oracleViolations.filter((v) => v.tier >= 3 || v.code === 'SYNTAX_ERROR');
    const driftViolations = oracleViolations.filter((v) => v.tier < 3 && v.code !== 'SYNTAX_ERROR');

    const blockingViolationsCount =
      blockingOracleViolations.length +
      brokenImports.length +
      missingAssets.length +
      circularBindings.length;

    const driftViolationsCount = driftViolations.length;
    const totalViolationsCount = blockingViolationsCount + (input.strict ? driftViolationsCount : 0);

    const clean = totalViolationsCount === 0;
    const passed = clean;

    const cleanFiles = Math.max(0, checkedCount - filesWithErrors.size);
    const errorFiles = filesWithErrors.size;

    const summary = clean
      ? 'Project passed all health checks.'
      : `Found ${blockingViolationsCount} blocking issues and ${driftViolationsCount} drift violations across ${checkedCount} files.`;

    const suggestedFixes: string[] = [];
    if (blockingOracleViolations.length > 0) {
      suggestedFixes.push('Resolve syntax and tier 3 Oracle violations before proceeding.');
    }
    if (brokenImports.length > 0) {
      suggestedFixes.push('Fix broken imports: check component and relative file paths.');
    }
    if (missingAssets.length > 0) {
      suggestedFixes.push('Provide missing local assets in public/ directory.');
    }
    if (circularBindings.length > 0) {
      suggestedFixes.push('Eliminate circular slot hoisting dependencies.');
    }

    return {
      clean,
      passed,
      totalFiles: checkedCount,
      totalFilesChecked: checkedCount,
      cleanFiles,
      errorFiles,
      blockingViolationsCount,
      driftViolationsCount,
      violationsCount: totalViolationsCount,
      missingAssetsCount: missingAssets.length,
      brokenLinksCount: brokenLinks.length,
      brokenImports,
      missingAssets,
      brokenLinks,
      circularBindings,
      unlinkedSlots,
      oracleViolations,
      violations: oracleViolations,
      summary,
      suggestedFixes,
    };
  },
};

// ─── Operation Registrations & Aliases ─────────────────────────────────────────

defaultRegistry.register(diagnosticsProjectCheckOperation);

defaultRegistry.registerAlias('project.diagnostics', 'diagnostics.projectCheck');
defaultRegistry.registerAlias('diagnostics.check', 'diagnostics.projectCheck');
defaultRegistry.registerAlias('oracle.check', 'diagnostics.projectCheck');
defaultRegistry.registerAlias('diagnostics.project', 'diagnostics.projectCheck');
defaultRegistry.registerAlias('check_project', 'diagnostics.projectCheck');
defaultRegistry.registerAlias('health.check', 'diagnostics.projectCheck');
