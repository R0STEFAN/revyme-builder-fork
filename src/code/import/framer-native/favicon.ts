import * as t from '@babel/types';
import { parseJSX } from '../../parsing/ast-utils';
import { trace } from '../../../shared/debug-trace';

/** Patch only a statically identifiable metadata field; preserve all other source verbatim. */
export function updateNativeFavicon(code: string, url: string, darkUrl?: string): string | undefined {
  trace.fn('framer-native.updateFavicon');
  if (darkUrl !== undefined) {
    if (!darkUrl) return undefined;
    const lightCode = updateNativeFavicon(code, url);
    const lightAst = lightCode && parseJSX(lightCode);
    if (!lightCode || !lightAst) return undefined;
    const declaration = lightAst.program.body.flatMap(statement => t.isExportNamedDeclaration(statement) && t.isVariableDeclaration(statement.declaration)
      ? statement.declaration.declarations.filter(decl => t.isIdentifier(decl.id, { name: 'metadata' })) : [])[0];
    if (!t.isObjectExpression(declaration?.init)) return undefined;
    const icons = declaration.init.properties.find(property => t.isObjectProperty(property) && (t.isIdentifier(property.key, { name: 'icons' }) || t.isStringLiteral(property.key, { value: 'icons' })));
    if (!t.isObjectProperty(icons) || !t.isObjectExpression(icons.value) || icons.value.properties.some(property => !t.isObjectProperty(property) || property.computed)) return undefined;
    const otherProp = icons.value.properties.find(property => t.isObjectProperty(property) && (t.isIdentifier(property.key, { name: 'other' }) || t.isStringLiteral(property.key, { value: 'other' })));
    if (otherProp) {
      if (!t.isObjectProperty(otherProp) || !t.isObjectExpression(otherProp.value)) return undefined;
      const start = otherProp.value.start;
      const end = otherProp.value.end;
      if (start == null || end == null) return undefined;
      const updated = lightCode.slice(0, start) + JSON.stringify({ rel: 'icon', url: darkUrl, media: '(prefers-color-scheme: dark)' }) + lightCode.slice(end);
      return parseJSX(updated) ? updated : undefined;
    }
    const end = icons.value.end;
    if (end == null) return undefined;
    const last = icons.value.properties[icons.value.properties.length - 1];
    const separator = !last || /^\s*,/.test(lightCode.slice(last.end!, end - 1)) ? '' : ',';
    const updated = lightCode.slice(0, end - 1) + `${separator} other: ${JSON.stringify({ rel: 'icon', url: darkUrl, media: '(prefers-color-scheme: dark)' })}` + lightCode.slice(end - 1);
    return parseJSX(updated) ? updated : undefined;
  }
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
