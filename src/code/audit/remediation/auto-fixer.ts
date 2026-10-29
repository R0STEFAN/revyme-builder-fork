// src/code/audit/remediation/auto-fixer.ts
// Automated codegen remediation dispatcher for fixable audit findings.

import type { AuditFinding } from '../core/types';
import { FIX_REGISTRY, canRemediateFinding } from './fix-registry';
import { trace } from '@/shared/debug-trace';

/**
 * Apply a remediation fix for a single finding to a code string.
 */
export function applySingleFindingFix(
  code: string,
  finding: AuditFinding
): string | null {
  trace.fn('applySingleFindingFix', { ruleId: finding.ruleId, nodeId: finding.location.nodeId });
  const handler = FIX_REGISTRY[finding.ruleId];
  if (!handler) {
    return null;
  }
  try {
    const updated = handler(code, finding);
    return updated !== code ? updated : null;
  } catch (err) {
    trace.error('applySingleFindingFix:failed', { ruleId: finding.ruleId, err });
    return null;
  }
}

/**
 * Apply all fixable findings for a single file's code.
 */
export function applyAutoFixesToCode(
  initialCode: string,
  findings: AuditFinding[]
): { code: string; remediated: AuditFinding[] } {
  let currentCode = initialCode;
  const remediated: AuditFinding[] = [];

  for (const finding of findings) {
    if (!finding.canAutoFix || !canRemediateFinding(finding.ruleId)) {
      continue;
    }

    const nextCode = applySingleFindingFix(currentCode, finding);
    if (nextCode && nextCode !== currentCode) {
      currentCode = nextCode;
      remediated.push(finding);
    }
  }

  return { code: currentCode, remediated };
}

/**
 * Apply auto-fixes across multiple project files.
 */
export function applyAutoFixesToProject(
  files: Record<string, string>,
  findings: AuditFinding[],
  modifyProjectFileFn?: (path: string, transform: (code: string) => string) => any
): { files: Record<string, string>; remediated: AuditFinding[] } {
  trace.fn('applyAutoFixesToProject', { findingCount: findings.length });
  const updatedFiles = { ...files };
  const remediated: AuditFinding[] = [];

  // Group findings by pagePath
  const byPath = new Map<string, AuditFinding[]>();
  for (const f of findings) {
    let p = f.location.pagePath;
    if (!p) continue;
    // Route SEO metadata fixes to server page.tsx if companion exists
    if (f.scope === 'seo' && p.endsWith('page.client.tsx')) {
      const serverPath = p.replace(/\/?page\.client\.tsx$/, (m) => m.replace('page.client.tsx', 'page.tsx'));
      if (files[serverPath] !== undefined || modifyProjectFileFn) {
        p = serverPath;
      }
    }
    const list = byPath.get(p) || [];
    list.push(f);
    byPath.set(p, list);
  }

  for (const [path, pathFindings] of byPath.entries()) {
    const original = updatedFiles[path];
    if (original === undefined && !modifyProjectFileFn) continue;

    if (modifyProjectFileFn) {
      modifyProjectFileFn(path, (code) => {
        const res = applyAutoFixesToCode(code, pathFindings);
        remediated.push(...res.remediated);
        updatedFiles[path] = res.code;
        return res.code;
      });
    } else if (original) {
      const res = applyAutoFixesToCode(original, pathFindings);
      updatedFiles[path] = res.code;
      remediated.push(...res.remediated);
    }
  }

  return { files: updatedFiles, remediated };
}
