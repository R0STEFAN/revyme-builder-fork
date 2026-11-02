import { parse } from '@babel/parser';
import * as t from '@babel/types';
import { trace } from '../../shared/debug-trace';

export type OverrideFunction = t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression;

/** The native wrapper accepts a HOC, not Framer's legacy props-object override. */
export function overrideRenderFunction(fn: OverrideFunction, ast: t.File): t.FunctionExpression | t.ArrowFunctionExpression | null {
  if (fn.async || fn.generator || fn.params.length !== 1 || !t.isIdentifier(fn.params[0])) return null;
  const returns = t.isBlockStatement(fn.body) ? fn.body.body.filter(t.isReturnStatement) : [];
  const value = t.isBlockStatement(fn.body) ? returns.length === 1 ? returns[0].argument : null : fn.body;
  let render = t.isFunctionExpression(value) || t.isArrowFunctionExpression(value) ? value : null;
  if (t.isCallExpression(value) && value.arguments.length === 1) {
    const callee = value.callee;
    const reactImports = ast.program.body.filter((node): node is t.ImportDeclaration => t.isImportDeclaration(node) && node.source.value === 'react');
    const forwardRef = reactImports.some(node => node.specifiers.some(spec =>
      t.isImportSpecifier(spec) && t.isIdentifier(spec.imported, { name: 'forwardRef' }) && t.isIdentifier(callee, { name: spec.local.name }) ||
      (t.isImportNamespaceSpecifier(spec) || t.isImportDefaultSpecifier(spec)) && t.isMemberExpression(callee) && !callee.computed && t.isIdentifier(callee.object, { name: spec.local.name }) && t.isIdentifier(callee.property, { name: 'forwardRef' })));
    if (forwardRef && (t.isFunctionExpression(value.arguments[0]) || t.isArrowFunctionExpression(value.arguments[0]))) render = value.arguments[0];
  }
  if (!render || render.async || render.generator) return null;
  const component = fn.params[0].name;
  let wrapsComponent = false;
  t.traverseFast(render.body, node => {
    if (t.isJSXOpeningElement(node) && t.isJSXIdentifier(node.name, { name: component })) wrapsComponent = true;
  });
  return wrapsComponent ? render : null;
}

export function exportedOverrideFunctions(ast: t.File): Map<string, OverrideFunction> {
  const functions = new Map<string, OverrideFunction>();
  for (const statement of ast.program.body) {
    if (!t.isExportNamedDeclaration(statement)) continue;
    const node = statement.declaration;
    if (t.isFunctionDeclaration(node) && node.id) functions.set(node.id.name, node);
    if (t.isVariableDeclaration(node)) for (const declaration of node.declarations) {
      if (t.isIdentifier(declaration.id) && (t.isArrowFunctionExpression(declaration.init) || t.isFunctionExpression(declaration.init))) functions.set(declaration.id.name, declaration.init);
    }
  }
  return functions;
}

/** Dedicated full-file imports must validate override files even without a canvas Oracle kind. */
export function validateNativeOverrideSource(code: string): void {
  trace.fn('code-overrides.validateSource');
  const ast = parse(code, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  const functions = exportedOverrideFunctions(ast);
  if (!functions.size) throw new Error('OVERRIDE_EXPORT_REQUIRED');
  for (const statement of ast.program.body) {
    if (t.isExportDefaultDeclaration(statement) || t.isExportAllDeclaration(statement)) throw new Error('OVERRIDE_EXPORT_INVALID');
    if (t.isExportNamedDeclaration(statement)) {
      const declaration = statement.declaration;
      const names = t.isFunctionDeclaration(declaration) && declaration.id ? [declaration.id.name] :
        t.isVariableDeclaration(declaration) ? declaration.declarations.map(item => t.isIdentifier(item.id) ? item.id.name : '') : [];
      if (!names.length || names.some(name => !/^with[A-Z_$]/.test(name) || !functions.has(name))) throw new Error('OVERRIDE_EXPORT_INVALID');
    }
    if (t.isImportDeclaration(statement) && !['react', 'framer-motion', '@revyme/runtime'].includes(statement.source.value) && !/^@\/(?:components|overrides)\//.test(statement.source.value)) throw new Error('OVERRIDE_IMPORT_UNSUPPORTED');
  }
  for (const fn of functions.values()) if (!overrideRenderFunction(fn, ast)) throw new Error('OVERRIDE_HOC_REQUIRED');
}
