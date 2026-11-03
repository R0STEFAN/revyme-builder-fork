import * as t from '@babel/types';
import { trace } from '@/shared/debug-trace';
import { parseJSX, findFirstElementByDataId } from '../parsing/ast-utils';
import { ensureNamedImport, generate } from './generator-utils';

/** An ordinary editable frame owns placement and presence; its instance fills the frame. */
export function wrapInstanceForPresence(code: string, nodeId: string): { code: string; contentId: string } {
  trace.fn('instance-presence.wrap', { nodeId });
  const ast = parseJSX(code);
  if (!ast) throw new Error('INSTANCE_PRESENCE_INVALID_SOURCE');
  let contentId = `${nodeId}-content`, suffix = 1;
  const exists = (id: string) => { let found = false; findFirstElementByDataId(ast, id, () => { found = true; }); return found; };
  while (exists(contentId)) contentId = `${nodeId}-content-${suffix++}`;
  let wrapped = false;
  findFirstElementByDataId(ast, nodeId, (path, element) => {
    const tag = element.openingElement.name;
    if (!t.isJSXIdentifier(tag) || !/^[A-Z]/.test(tag.name)) throw new Error('INSTANCE_PRESENCE_REQUIRES_COMPONENT');
    const id = element.openingElement.attributes.find(attr => t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name, { name: 'data-id' })) as t.JSXAttribute;
    const style = element.openingElement.attributes.find(attr => t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name, { name: 'style' }));
    if (!id || !t.isJSXAttribute(style)) throw new Error('INSTANCE_PRESENCE_REQUIRES_PLACEMENT');
    const placement = t.cloneNode(style, true);
    id.value = t.stringLiteral(contentId);
    style.value = t.jsxExpressionContainer(t.objectExpression([
      t.objectProperty(t.identifier('position'), t.stringLiteral('relative')),
      t.objectProperty(t.identifier('width'), t.stringLiteral('100%')),
      t.objectProperty(t.identifier('height'), t.stringLiteral('100%')),
    ]));
    const name = t.jsxMemberExpression(t.jsxIdentifier('motion'), t.jsxIdentifier('div'));
    const outer = t.jsxElement(t.jsxOpeningElement(name, [t.jsxAttribute(t.jsxIdentifier('data-id'), t.stringLiteral(nodeId)), placement]), t.jsxClosingElement(t.cloneNode(name)), [element]);
    path.replaceWith(outer); path.skip(); wrapped = true;
  });
  if (!wrapped) throw new Error('INSTANCE_PRESENCE_TARGET_MISSING');
  return { code: ensureNamedImport(generate(ast).code, 'framer-motion', ['motion']), contentId };
}
