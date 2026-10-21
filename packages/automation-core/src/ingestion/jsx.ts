// packages/automation-core/src/ingestion/jsx.ts
import { parse } from '@babel/parser';
import type { IngestionReporter } from './report';
import { IdManager } from './ids';
import type { IngestedNode } from './tree';
import { normalizeStyles } from './styles';
import type { UnitContext } from './units';

export function ingestJSXFragment(
  code: string,
  idManager: IdManager = new IdManager(),
  unitContext: UnitContext = {},
  reporter?: IngestionReporter
): IngestedNode | null {
  const wrapped = `const _f = (${code.trim()});`;
  let ast: any;
  try {
    ast = parse(wrapped, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
    });
  } catch (err: any) {
    reporter?.recordIssue(
      'JSX_PARSE_ERROR',
      [],
      `Failed to parse static JSX fragment: ${err.message}`
    );
    return null;
  }

  const decl = ast.program.body[0]?.declarations?.[0]?.init;
  if (!decl || (decl.type !== 'JSXElement' && decl.type !== 'JSXFragment')) {
    reporter?.recordIssue(
      'INVALID_JSX_ROOT',
      [],
      'Root of fragment must be a valid JSX element or fragment.'
    );
    return null;
  }

  return convertBabelJSX(decl, idManager, unitContext, reporter);
}

function convertBabelJSX(
  node: any,
  idManager: IdManager,
  unitContext: UnitContext,
  reporter?: IngestionReporter
): IngestedNode | null {
  if (node.type === 'JSXElement') {
    const opening = node.openingElement;
    let tagName = 'div';
    if (opening.name.type === 'JSXIdentifier') {
      tagName = opening.name.name;
    }

    let existingId: string | undefined;
    const styles: Record<string, any> = {};
    const props: Record<string, any> = {};

    for (const attr of opening.attributes) {
      if (attr.type === 'JSXAttribute') {
        const attrName = attr.name.name;
        if (attrName === 'data-id') {
          if (attr.value?.type === 'StringLiteral') {
            existingId = attr.value.value;
          }
        } else if (attrName === 'style' && attr.value?.type === 'JSXExpressionContainer') {
          const expr = attr.value.expression;
          if (expr.type === 'ObjectExpression') {
            for (const prop of expr.properties) {
              if (prop.type === 'ObjectProperty') {
                const key = prop.key.name || prop.key.value;
                if (prop.value.type === 'StringLiteral') {
                  styles[key] = prop.value.value;
                } else if (prop.value.type === 'NumericLiteral') {
                  styles[key] = prop.value.value;
                }
              }
            }
          }
        } else if (attr.value?.type === 'StringLiteral') {
          props[attrName] = attr.value.value;
        } else if (attr.value?.type === 'JSXExpressionContainer') {
          if (attr.value.expression.type === 'BooleanLiteral') {
            props[attrName] = attr.value.expression.value;
          } else if (attr.value.expression.type === 'NumericLiteral') {
            props[attrName] = attr.value.expression.value;
          }
        }
      }
    }

    const { id } = idManager.ensureNodeId(existingId, tagName, reporter);
    const normalizedStyles = normalizeStyles(styles, unitContext, reporter, id);

    let textContent = '';
    const children: IngestedNode[] = [];

    for (const child of node.children) {
      if (child.type === 'JSXText') {
        const text = child.value.trim();
        if (text) textContent += (textContent ? ' ' : '') + text;
      } else if (child.type === 'JSXElement') {
        const childNode = convertBabelJSX(child, idManager, unitContext, reporter);
        if (childNode) children.push(childNode);
      }
    }

    return {
      id,
      tag: tagName,
      styles: Object.keys(normalizedStyles).length > 0 ? normalizedStyles : undefined,
      props: Object.keys(props).length > 0 ? props : undefined,
      text: textContent || undefined,
      children: children.length > 0 ? children : undefined,
    };
  }

  return null;
}
