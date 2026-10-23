// evaluations/automation-v2/validate.ts
/**
 * Conformance and invariant validators for evaluation benchmarks.
 */

import { checkFile, type OracleViolation } from '@/code/oracle/check-file';
import { parseJSXToNodes } from '@/code/parsing/parser';

export interface ValidationReport {
  valid: boolean;
  violations: OracleViolation[];
  nodeCount: number;
  identifiedElements: boolean;
  invariantViolations: string[];
}

export function validateGeneratedSource(filePath: string, code: string): ValidationReport {
  const violations = checkFile(code, { kind: 'page', path: filePath });
  const invariantViolations: string[] = [];

  // 1. Invariant 1: Source parseability
  let nodeCount = 0;
  let identifiedElements = true;
  try {
    const nodes = parseJSXToNodes(code);
    nodeCount = nodes.size;
    for (const [id] of nodes.entries()) {
      if (!id || id.trim() === '') {
        identifiedElements = false;
        invariantViolations.push(`Node without id found in ${filePath}`);
      }
    }
  } catch (err: any) {
    invariantViolations.push(`Failed to parse JSX: ${err.message}`);
  }

  // 2. Oracle tier 1-3 violations
  if (violations.length > 0) {
    for (const v of violations) {
      invariantViolations.push(`Oracle Error: ${v.code} - ${v.message}`);
    }
  }

  return {
    valid: invariantViolations.length === 0,
    violations,
    nodeCount,
    identifiedElements,
    invariantViolations,
  };
}
