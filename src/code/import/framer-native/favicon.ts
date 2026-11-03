import * as t from '@babel/types';
import { parseJSX } from '../../parsing/ast-utils';
import { trace } from '../../../shared/debug-trace';

/** Patch only a statically identifiable metadata field; preserve all other source verbatim. */
export function updateNativeFavicon(code: string, url: string): string | undefined {
  trace.fn('framer-native.updateFavicon');
  const ast = parseJSX(code);
  if (!ast || !url) return undefined;
  const declarations = ast.program.body.flatMap(statement => t.isExportNamedDeclaration(statement) && t.isVariableDeclaration(statement.declaration)
    ? statement.declaration.declarations.filter(decl => t.isIdentifier(decl.id, { name: 'metadata' })) : []);
  if (declarations.length !== 1 || !t.isObjectExpression(declarations[0].init)) return undefined;
  const metadata = declarations[0].init;
  const find = (object: t.ObjectExpression, key: string) => {
    if (object.properties.some(p => !t.isObjectProperty(p) || p.computed)) return undefined;
    const found = object.properties.filter((p): p is t.ObjectProperty => t.isObjectProperty(p) && (t.isIdentifier(p.key, { name: key }) || t.isStringLiteral(p.key, { value: key })));
    return found.length > 1 ? undefined : found[0] ?? null;
  };
  const icons = find(metadata, 'icons');
  if (icons === undefined) return undefined;
  const separator = (object: t.ObjectExpression) => {
    const last = object.properties[object.properties.length - 1];
    return !last || /^\s*,/.test(code.slice(last.end!, object.end! - 1)) ? '' : ',';
  };
  let start: number | null | undefined, end: number | null | undefined, text: string;
  if (icons === null) {
    start = end = metadata.end! - 1;
    text = `${separator(metadata)} icons: { icon: ${JSON.stringify(url)} }`;
  } else {
    if (!t.isObjectExpression(icons.value)) return undefined;
    const icon = find(icons.value, 'icon');
    if (icon === undefined) return undefined;
    if (icon === null) {
      start = end = icons.value.end! - 1;
      text = `${separator(icons.value)} icon: ${JSON.stringify(url)}`;
    } else {
      start = icon.value.start; end = icon.value.end; text = JSON.stringify(url);
    }
  }
  if (start == null || end == null) return undefined;
  const updated = code.slice(0, start) + text + code.slice(end);
  return parseJSX(updated) ? updated : undefined;
}
