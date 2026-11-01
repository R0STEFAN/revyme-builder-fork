import { parseExpression } from '@babel/parser';
import * as t from '@babel/types';
import { cmsPropBindingExpression, type CmsPropBinding } from '@/shared/cms-prop-bindings';
import { trace } from '@/shared/debug-trace';

function memberPath(node: t.Node | null | undefined, itemVar: string): string | null {
  if (t.isIdentifier(node, { name: itemVar })) return '';
  if (!t.isMemberExpression(node) && !t.isOptionalMemberExpression(node)) return null;
  const parent = memberPath(node.object, itemVar);
  const key = !node.computed && t.isIdentifier(node.property) ? node.property.name : node.computed && t.isStringLiteral(node.property) ? node.property.value : null;
  if (parent === null || !key || !/^[A-Za-z_$][\w$]*$/.test(key)) return null;
  return parent ? `${parent}.${key}` : key;
}

/** Only recognize the native presence expression when EVERY field reference agrees. */
export function readCmsPropBindingExpression(
  node: t.Node, itemVar: string,
  readFieldPath: (node: t.Node | null | undefined, itemVar: string) => string | null = memberPath,
): Omit<CmsPropBinding, 'prop'> | null {
  const field = readFieldPath(node, itemVar);
  if (field) return { field };
  if (t.isTemplateLiteral(node) && node.expressions.length === 1) {
    const inner = readFieldPath(node.expressions[0], itemVar);
    if (inner && node.quasis[0].value.raw.trimStart().toLowerCase().startsWith('url(') && node.quasis[1].value.raw.trimEnd() === ')') return { field: inner, urlWrap: true };
  }
  if (!t.isConditionalExpression(node) || !t.isCallExpression(node.test)) return null;
  const target = readFieldPath(node.test.arguments[0], itemVar);
  if (!target || !/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(target)) return null;
  const binding = { field: target, transform: 'isSet' as const };
  if (t.isNodesEquivalent(node, parseExpression(cmsPropBindingExpression(itemVar, binding)))) {
    trace.action('parser:computed-prop-binding', { field: target, transform: binding.transform });
    return binding;
  }
  return null;
}
