import { parseJSX, traverse, findAttribute, getAttributeValue } from '@/code/parsing/ast-utils';
import { resolveImportPath } from '@/code/components/import-resolver';
import type { CanvasNode } from '@/code/parsing/parser';
import * as t from '@babel/types';

/** Prove the selected wrapper's local JSX name against its import and parsed source identity. */
export function resolveSelectedInstanceTag(code: string, filePath: string, node: CanvasNode | null): string | null {
  if (!node?.componentFile || !(node.isComponentInstance || node.isCodeComponent)) return null;
  const ast = parseJSX(code);
  if (!ast) return null;
  let identityCount = 0;
  let matchedTag: string | null = null;
  let legacyCount = 0;
  let legacyTag: string | null = null;
  traverse(ast, {
    JSXOpeningElement(path) {
      const opening = path.node;
      const idAttr = findAttribute(opening, 'data-id');
      const isExact = !!idAttr && getAttributeValue(idAttr) === node.id;
      const isLegacy = !idAttr && /^auto_\d+$/.test(node.id);
      if (!isExact && !isLegacy) return;
      if (isExact) identityCount++;
      if (!t.isJSXIdentifier(opening.name) || opening.name.name !== node.type) return;
      const binding = path.scope.getBinding(node.type);
      if (!binding || !(binding.path.isImportDefaultSpecifier()
        || (binding.path.isImportSpecifier() && t.isIdentifier(binding.path.node.imported, { name: 'default' })))) return;
      const declaration = binding.path.parentPath;
      if (!declaration?.isImportDeclaration()) return;
      const source = declaration.node.source.value;
      const importedFile = source.startsWith('http') ? source : resolveImportPath(source, filePath);
      if (importedFile !== node.componentFile) return;
      if (isExact) matchedTag = node.type;
      else { legacyCount++; legacyTag = node.type; }
    },
  });
  if (identityCount > 0) return identityCount === 1 ? matchedTag : null;
  return legacyCount === 1 ? legacyTag : null;
}
