// oracle/checks/code-component-style.ts — validates that code components
// accept and apply style/props to their root element and spread in correct order.

import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import { traverse, type OracleViolation } from './shared';

/**
 * Validates that every Code Component in components/*.tsx (or kind === 'code-component'):
 * 1. Accepts `style` or `props` in its function signature.
 * 2. Applies `style` or `props.style` to its root JSX element (or spreads `props`).
 * 3. Spreads `style` / `props.style` LAST in its style object so canvas and responsive
 *    overrides take precedence (CODE_COMPONENT_STYLE_SPREAD_ORDER).
 */
export function checkCodeComponentRootStyle(
  ast: t.File,
  code: string,
  v: OracleViolation[],
): void {
  // 1. Identify the default-exported component name or inline function node
  let exportedName: string | null = null;
  let inlineCompFnPath: NodePath<
    t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression
  > | null = null;

  traverse(ast, {
    ExportDefaultDeclaration(path: NodePath<t.ExportDefaultDeclaration>) {
      const decl = path.node.declaration;
      if (t.isCallExpression(decl)) {
        const firstArg = decl.arguments[0];
        if (t.isIdentifier(firstArg)) {
          exportedName = firstArg.name;
        } else if (
          t.isFunctionExpression(firstArg) ||
          t.isArrowFunctionExpression(firstArg)
        ) {
          inlineCompFnPath = path.get('declaration.arguments.0') as any;
        }
      } else if (t.isIdentifier(decl)) {
        exportedName = decl.name;
      } else if (t.isFunctionDeclaration(decl)) {
        if (decl.id) exportedName = decl.id.name;
        else inlineCompFnPath = path.get('declaration') as any;
      } else if (
        t.isFunctionExpression(decl) ||
        t.isArrowFunctionExpression(decl)
      ) {
        inlineCompFnPath = path.get('declaration') as any;
      }
    },
  });

  // 2. Locate the component function path
  function findComponentPath(): NodePath<
    t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression
  > | null {
    if (inlineCompFnPath) return inlineCompFnPath;
    let found: NodePath<
      t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression
    > | null = null;

    if (exportedName) {
      traverse(ast, {
        FunctionDeclaration(path: NodePath<t.FunctionDeclaration>) {
          if (path.node.id && path.node.id.name === exportedName) {
            found = path;
          }
        },
        VariableDeclarator(path: NodePath<t.VariableDeclarator>) {
          if (
            t.isIdentifier(path.node.id, { name: exportedName! }) &&
            path.node.init &&
            (t.isFunctionExpression(path.node.init) ||
              t.isArrowFunctionExpression(path.node.init))
          ) {
            found = path.get('init') as any;
          }
        },
      });
    }

    if (!found) {
      traverse(ast, {
        FunctionDeclaration(path: NodePath<t.FunctionDeclaration>) {
          if (!found && path.parentPath.isProgram()) {
            found = path;
            if (path.node.id) exportedName = path.node.id.name;
          }
        },
      });
    }

    return found;
  }

  const compFnPath = findComponentPath();
  if (!compFnPath) return;

  const compFnNode = compFnPath.node;
  const compName = exportedName || (compFnNode as any).id?.name || 'Component';

  // 3. Inspect parameters: must accept `props` or destructure `style` or rest `...props`
  const params = compFnNode.params;
  let acceptsPropsOrStyle = false;
  const propsIdentNames = new Set<string>(['props']);
  const styleIdentNames = new Set<string>(['style']);

  if (params.length > 0) {
    const p0 = params[0];
    if (t.isIdentifier(p0)) {
      acceptsPropsOrStyle = true;
      propsIdentNames.add(p0.name);
    } else if (t.isObjectPattern(p0)) {
      for (const prop of p0.properties) {
        if (t.isObjectProperty(prop)) {
          const keyName = t.isIdentifier(prop.key)
            ? prop.key.name
            : t.isStringLiteral(prop.key)
              ? prop.key.value
              : null;
          if (keyName === 'style') {
            acceptsPropsOrStyle = true;
            if (t.isIdentifier(prop.value)) {
              styleIdentNames.add(prop.value.name);
            }
          }
        } else if (t.isRestElement(prop)) {
          acceptsPropsOrStyle = true;
          if (t.isIdentifier(prop.argument)) {
            propsIdentNames.add(prop.argument.name);
          }
        }
      }
    } else if (t.isAssignmentPattern(p0) && t.isIdentifier(p0.left)) {
      acceptsPropsOrStyle = true;
      propsIdentNames.add(p0.left.name);
    }
  }

  if (!acceptsPropsOrStyle) {
    v.push({
      code: 'CODE_COMPONENT_ROOT_MISSING_STYLE',
      tier: 2,
      line: compFnNode.loc?.start.line,
      message: `Code component "${compName}" does not accept a "style" or "...props" parameter (line ${compFnNode.loc?.start.line}). Code components must accept "style" or "...props" in their signature (e.g. \`function ${compName}({ style, ...props })\`) and apply it to their outermost element so the visual builder can position and style them.`,
    });
    return;
  }

  // 4. Collect local variable initializers inside the component function
  const varInits = new Map<string, t.Expression>();
  compFnPath.traverse({
    VariableDeclarator(path: NodePath<t.VariableDeclarator>) {
      if (
        path.scope.block === compFnNode &&
        t.isIdentifier(path.node.id) &&
        path.node.init
      ) {
        varInits.set(path.node.id.name, path.node.init);
      }
    },
  });

  // Helper to determine if an expression spreads / forwards style or props.style
  function exprAppliesStyle(expr: t.Node | null | undefined, visited = new Set<string>()): boolean {
    if (!expr) return false;

    // style={style}
    if (t.isIdentifier(expr)) {
      if (styleIdentNames.has(expr.name)) return true;
      if (visited.has(expr.name)) return false;
      visited.add(expr.name);
      const init = varInits.get(expr.name);
      return init ? exprAppliesStyle(init, visited) : false;
    }

    // style={props.style} or style={props?.style}
    if (t.isMemberExpression(expr) || t.isOptionalMemberExpression(expr)) {
      if (t.isIdentifier(expr.property, { name: 'style' })) {
        if (t.isIdentifier(expr.object)) {
          if (propsIdentNames.has(expr.object.name)) return true;
        }
        return true;
      }
    }

    // style={props.style || {}}
    if (t.isLogicalExpression(expr)) {
      return exprAppliesStyle(expr.left, visited) || exprAppliesStyle(expr.right, visited);
    }

    // style={cond ? props.style : defaultStyle}
    if (t.isConditionalExpression(expr)) {
      return exprAppliesStyle(expr.consequent, visited) || exprAppliesStyle(expr.alternate, visited);
    }

    // style={Object.assign({}, props.style, ...)}
    if (t.isCallExpression(expr)) {
      for (const arg of expr.arguments) {
        if (exprAppliesStyle(arg, visited)) return true;
      }
    }

    // style={{ ...defaultStyles, ...props.style }} or { ...style } or { ...(props.style || {}) }
    if (t.isObjectExpression(expr)) {
      for (const prop of expr.properties) {
        if (t.isSpreadElement(prop)) {
          if (exprAppliesStyle(prop.argument, visited)) return true;
        }
      }
    }

    return false;
  }

  // Helper to check if a spread is directly spreading the incoming style prop
  function isDirectStyleSpread(arg: t.Node | null | undefined): boolean {
    if (!arg) return false;
    if (t.isIdentifier(arg) && styleIdentNames.has(arg.name)) return true;
    if (t.isMemberExpression(arg) || t.isOptionalMemberExpression(arg)) {
      if (t.isIdentifier(arg.property, { name: 'style' })) return true;
    }
    if (t.isLogicalExpression(arg)) {
      return isDirectStyleSpread(arg.left) || isDirectStyleSpread(arg.right);
    }
    return false;
  }

  // 5. Check style spread order in style objects (where style / props.style is spread directly)
  function checkStyleSpreadOrder(entries: Array<t.Node | t.SpreadElement>) {
    const firstSpreadIdx = entries.findIndex((p) =>
      t.isSpreadElement(p) && isDirectStyleSpread(p.argument),
    );
    if (firstSpreadIdx !== -1) {
      // Every property after the first style spread must also be a style spread
      // (e.g. `...style, ...props.style` is valid; defaults followed by spread is valid;
      // but any default written AFTER a style spread overrides instance placement).
      const offender = entries.slice(firstSpreadIdx + 1).find((p) =>
        !(t.isSpreadElement(p) && isDirectStyleSpread(p.argument)),
      );
      if (offender) {
        v.push({
          code: 'CODE_COMPONENT_STYLE_SPREAD_ORDER',
          tier: 2,
          line: offender.loc?.start.line ?? entries[firstSpreadIdx].loc?.start.line,
          message: `...props.style must be the LAST entry of the style object (line ${offender.loc?.start.line ?? entries[firstSpreadIdx].loc?.start.line}) — the instance's page placement (position/width/height) must override the code component's defaults. Spread-first looks right on the canvas but the PUBLISHED site renders the code component's own values and the layout diverges. Move the spread to the end: style={{ <defaults>, ...props.style }}.`,
        });
      }
    }
  }

  compFnPath.traverse({
    JSXAttribute(path: NodePath<t.JSXAttribute>) {
      if (!t.isJSXIdentifier(path.node.name, { name: 'style' })) return;
      const val = path.node.value;
      if (!t.isJSXExpressionContainer(val) || !t.isObjectExpression(val.expression)) return;
      checkStyleSpreadOrder(val.expression.properties);
    },
    // Also check variable declarations like `const style = { ...props.style, width: '100%' }`
    VariableDeclarator(path: NodePath<t.VariableDeclarator>) {
      if (path.scope.block === compFnNode && path.node.init && t.isObjectExpression(path.node.init)) {
        checkStyleSpreadOrder(path.node.init.properties);
      }
    },
  });

  // 6. Inspect return statements belonging directly to the component function
  const returnNodes: Array<{ argument: t.Expression | null | undefined; line: number }> = [];

  if (t.isArrowFunctionExpression(compFnNode) && compFnNode.body.type !== 'BlockStatement') {
    returnNodes.push({
      argument: compFnNode.body as t.Expression,
      line: compFnNode.loc?.start.line ?? 1,
    });
  } else {
    compFnPath.traverse({
      ReturnStatement(retPath: NodePath<t.ReturnStatement>) {
        if (retPath.getFunctionParent() === compFnPath) {
          returnNodes.push({
            argument: retPath.node.argument,
            line: retPath.node.loc?.start.line ?? 1,
          });
        }
      },
    });
  }

  // Helper to inspect returned element/call
  function checkReturnedElement(arg: t.Expression | null | undefined, line: number) {
    if (!arg) return;

    // Skip literals (null, false, true, undefined, 0) - early return / guard
    if (
      t.isNullLiteral(arg) ||
      t.isBooleanLiteral(arg) ||
      t.isIdentifier(arg, { name: 'undefined' })
    ) {
      return;
    }

    // Parenthesized expression unwrap
    if (t.isParenthesizedExpression(arg)) {
      checkReturnedElement(arg.expression, line);
      return;
    }

    // Conditional ternary: both branches returned
    if (t.isConditionalExpression(arg)) {
      checkReturnedElement(arg.consequent, line);
      checkReturnedElement(arg.alternate, line);
      return;
    }

    // JSX Fragment as root is forbidden
    if (t.isJSXFragment(arg)) {
      v.push({
        code: 'CODE_COMPONENT_ROOT_MISSING_STYLE',
        tier: 2,
        line: arg.loc?.start.line ?? line,
        message: `Code component "${compName}" returns a JSX Fragment (<>...</>) as its root (line ${arg.loc?.start.line ?? line}). Code components must return a single DOM element (such as <div style={{ ...props.style }}>) so canvas positioning, sizing, and flex order work.`,
      });
      return;
    }

    // React.createElement(...) call
    if (t.isCallExpression(arg)) {
      const isCreateElement =
        (t.isMemberExpression(arg.callee) &&
          t.isIdentifier(arg.callee.object, { name: 'React' }) &&
          t.isIdentifier(arg.callee.property, { name: 'createElement' })) ||
        t.isIdentifier(arg.callee, { name: 'createElement' });

      if (isCreateElement && arg.arguments.length >= 2) {
        const propsArg = arg.arguments[1];
        if (exprAppliesStyle(propsArg)) return;
        // If propsArg is Object.assign({}, props, ...)
        if (t.isCallExpression(propsArg)) {
          for (const a of propsArg.arguments) {
            if (exprAppliesStyle(a)) return;
            if (t.isIdentifier(a) && propsIdentNames.has(a.name)) return;
          }
        }
      }
      return;
    }

    // JSX Element
    if (t.isJSXElement(arg)) {
      const attrs = arg.openingElement.attributes;
      let applied = false;

      // 1. Check style attribute
      const styleAttr = attrs.find(
        (a): a is t.JSXAttribute =>
          t.isJSXAttribute(a) && t.isJSXIdentifier(a.name, { name: 'style' }),
      );

      if (styleAttr && t.isJSXExpressionContainer(styleAttr.value)) {
        if (exprAppliesStyle(styleAttr.value.expression)) {
          applied = true;
        }
      }

      // 2. Check spread props (e.g. <div {...props} />)
      // Only valid if there is NO subsequent style attribute that overrides style without spreading it
      if (!applied) {
        let hasSpreadProps = false;
        let lastAttrWasStyle = false;

        for (const a of attrs) {
          if (t.isJSXSpreadAttribute(a) && t.isIdentifier(a.argument)) {
            if (propsIdentNames.has(a.argument.name)) {
              hasSpreadProps = true;
              lastAttrWasStyle = false;
            }
          } else if (
            t.isJSXAttribute(a) &&
            t.isJSXIdentifier(a.name, { name: 'style' })
          ) {
            lastAttrWasStyle = true;
          }
        }

        if (hasSpreadProps && !lastAttrWasStyle) {
          applied = true;
        }
      }

      if (!applied) {
        v.push({
          code: 'CODE_COMPONENT_ROOT_MISSING_STYLE',
          tier: 2,
          line: arg.loc?.start.line ?? line,
          message: `Code component "${compName}" does not apply "style" or "props.style" to its root element (line ${arg.loc?.start.line ?? line}). Code components must spread "style" onto their outermost element (e.g. style={{ ...defaultStyles, ...style }} or ...props.style) so visual canvas positioning, responsive sizing, and flex order work correctly.`,
        });
      }
    }
  }

  for (const ret of returnNodes) {
    checkReturnedElement(ret.argument, ret.line);
  }
}
