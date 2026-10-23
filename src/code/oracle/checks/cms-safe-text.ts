// Recognize the builder's editable CMS text formatter in its CMS scope.
import * as t from '@babel/types';
import type { NodePath } from '@babel/traverse';

export function isSafeCmsText(expr: t.Node, path: NodePath, detailPage: boolean): boolean {
  if (!t.isConditionalExpression(expr) || !t.isCallExpression(expr.alternate) ||
      !t.isIdentifier(expr.alternate.callee, { name: 'String' }) || expr.alternate.arguments.length !== 1) return false;
  const fallback = expr.alternate.arguments[0];
  if (!t.isLogicalExpression(fallback, { operator: '??' }) || !t.isStringLiteral(fallback.right, { value: '' }) ||
      !(t.isMemberExpression(fallback.left) || t.isOptionalMemberExpression(fallback.left))) return false;
  const field = fallback.left;
  let root: t.Node = field;
  while (t.isMemberExpression(root) || t.isOptionalMemberExpression(root)) {
    if (root.computed && !t.isStringLiteral(root.property)) return false;
    root = root.object;
  }
  if (!t.isIdentifier(root)) return false;
  const rootName = root.name;
  const inMap = path.findParent(p => {
    if (!p.isArrowFunctionExpression() || !t.isIdentifier(p.node.params[0], { name: rootName })) return false;
    const parent = p.parentPath;
    return !!parent && parent.isCallExpression() && t.isMemberExpression(parent.node.callee) &&
      t.isIdentifier(parent.node.callee.property, { name: 'map' }) && !parent.node.callee.computed;
  });
  if (!(detailPage && rootName === 'item') && !inMap) return false;
  const f = () => t.cloneNode(field, true);
  const prop = (name: string) => t.memberExpression(f(), t.identifier(name));
  const typeIs = (value: t.Expression, type: string) => t.binaryExpression('===', t.unaryExpression('typeof', value), t.stringLiteral(type));
  const call = (name: string, value: t.Expression) => t.callExpression(t.identifier(name), [value]);
  const value = t.conditionalExpression(
    t.logicalExpression('||', typeIs(prop('value'), 'string'), typeIs(prop('value'), 'number')),
    call('String', prop('value')),
    t.callExpression(t.memberExpression(t.identifier('JSON'), t.identifier('stringify')), [f()]),
  );
  const label = t.conditionalExpression(typeIs(prop('label'), 'string'), prop('label'), value);
  const title = t.conditionalExpression(typeIs(prop('title'), 'string'), prop('title'), label);
  const name = t.conditionalExpression(typeIs(prop('name'), 'string'), prop('name'), title);
  const expected = t.conditionalExpression(
    t.logicalExpression('&&', typeIs(f(), 'object'), t.binaryExpression('!==', f(), t.nullLiteral())),
    name, call('String', t.logicalExpression('??', f(), t.stringLiteral(''))),
  );
  // Babel's builders populate optional fields with null, while its parser
  // leaves those same fields undefined. Normalize before comparing shapes.
  const normalize = (node: t.Node) => {
    for (const key of Object.keys(t.NODE_FIELDS[node.type] ?? {})) {
      if ((node as any)[key] == null) delete (node as any)[key];
    }
    for (const key of t.VISITOR_KEYS[node.type] ?? []) {
      const value = (node as any)[key];
      if (Array.isArray(value)) value.forEach((child: t.Node | null) => child && normalize(child));
      else if (value && typeof value === 'object') normalize(value);
    }
  };
  const actual = t.cloneNode(expr, true);
  normalize(actual);
  normalize(expected);
  return t.isNodesEquivalent(actual, expected);
}
