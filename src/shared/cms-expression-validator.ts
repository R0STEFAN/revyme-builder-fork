import { parseExpression } from '@babel/parser';

const DISALLOWED_IDENTIFIERS = new Set([
  'process', 'require', 'global', 'globalThis', 'window', 'document',
  'Function', 'eval', 'import',
]);

const DISALLOWED_PROPERTIES = new Set([
  'constructor', '__proto__', 'prototype',
]);

export function validateCmsExpression(expr: string): { valid: boolean; error?: string } {
  if (!expr || !expr.trim()) return { valid: true };
  const clean = expr.trim().replace(/^\{|\}$/g, '').trim();

  try {
    const ast = parseExpression(clean, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
    });

    let hasViolation = false;
    let violationMsg = '';

    function walk(node: any) {
      if (!node || typeof node !== 'object' || hasViolation) return;

      // Disallow assignments & mutations
      if (node.type === 'AssignmentExpression' || node.type === 'UpdateExpression') {
        hasViolation = true;
        violationMsg = 'Mutations and assignments are not allowed in expressions.';
        return;
      }

      // Check member access: forbid .constructor, .__proto__, .prototype
      if (node.type === 'MemberExpression') {
        const prop = node.property;
        if (!node.computed && prop.type === 'Identifier' && DISALLOWED_PROPERTIES.has(prop.name)) {
          hasViolation = true;
          violationMsg = `Access to "${prop.name}" is forbidden.`;
          return;
        }
        if (node.computed && prop.type === 'StringLiteral' && DISALLOWED_PROPERTIES.has(prop.value)) {
          hasViolation = true;
          violationMsg = `Access to "${prop.value}" is forbidden.`;
          return;
        }
      }

      // Check identifiers: forbid process, require, window, etc.
      if (node.type === 'Identifier' && DISALLOWED_IDENTIFIERS.has(node.name)) {
        hasViolation = true;
        violationMsg = `Access to global identifier "${node.name}" is forbidden.`;
        return;
      }

      for (const key of Object.keys(node)) {
        if (key === 'loc' || key === 'range') continue;
        const val = node[key];
        if (Array.isArray(val)) {
          for (const child of val) walk(child);
        } else if (val && typeof val === 'object') {
          walk(val);
        }
      }
    }

    walk(ast);

    if (hasViolation) return { valid: false, error: violationMsg };
    return { valid: true };
  } catch (err: any) {
    return { valid: false, error: err?.message || 'Invalid JavaScript expression syntax' };
  }
}
