// packages/automation-core/src/ingestion/jsx.ts
import { parse } from '@babel/parser';
import type { IngestionReporter } from './report';
import { IdManager } from './ids';
import type { IngestedNode } from './tree';
import { normalizeStyles } from './styles';
import type { UnitContext } from './units';
import { healSvgSubtree } from './svg-heal';

export function ingestJSXNodes(
  code: string,
  idManager: IdManager = new IdManager(),
  unitContext: UnitContext = {},
  reporter?: IngestionReporter
): IngestedNode[] {
  const trimmed = code.trim();
  if (!trimmed) return [];

  // Wrap in a fragment to allow multiple sibling elements
  const wrapped = `const _f = (<>${trimmed}</>);`;
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
    return [];
  }

  const decl = ast.program.body[0]?.declarations?.[0]?.init;
  if (!decl || (decl.type !== 'JSXElement' && decl.type !== 'JSXFragment')) {
    reporter?.recordIssue(
      'INVALID_JSX_ROOT',
      [],
      'Root of fragment must be a valid JSX element or fragment.'
    );
    return [];
  }

  const nodes: IngestedNode[] = [];
  collectNodesFromBabel(decl, idManager, unitContext, reporter, nodes);
  return nodes;
}

export function ingestJSXFragment(
  code: string,
  idManager: IdManager = new IdManager(),
  unitContext: UnitContext = {},
  reporter?: IngestionReporter
): IngestedNode | null {
  const nodes = ingestJSXNodes(code, idManager, unitContext, reporter);
  return nodes[0] || null;
}

const INLINE_TEXT_RUN_TAGS = new Set([
  'span',
  'strong',
  'em',
  'b',
  'i',
  'u',
  's',
  'small',
  'mark',
  'sub',
  'sup',
  'br',
]);

function collectNodesFromBabel(
  node: any,
  idManager: IdManager,
  unitContext: UnitContext,
  reporter: IngestionReporter | undefined,
  out: IngestedNode[]
): void {
  if (node.type === 'JSXElement') {
    const converted = convertBabelJSX(node, idManager, unitContext, reporter);
    if (converted) out.push(converted);
  } else if (node.type === 'JSXFragment') {
    for (const child of node.children) {
      if (child.type === 'JSXElement' || child.type === 'JSXFragment') {
        collectNodesFromBabel(child, idManager, unitContext, reporter, out);
      }
    }
  }
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
    } else if (
      opening.name.type === 'JSXMemberExpression' &&
      opening.name.object?.name &&
      opening.name.property?.name
    ) {
      tagName = `${opening.name.object.name}.${opening.name.property.name}`;
    }

    let existingId: string | undefined;
    let existingName: string | undefined;
    const styles: Record<string, any> = {};
    const props: Record<string, any> = {};

    for (const attr of opening.attributes) {
      if (attr.type === 'JSXAttribute') {
        const attrName = attr.name.name;
        if (attrName === 'data-id') {
          if (attr.value?.type === 'StringLiteral') {
            existingId = attr.value.value;
          }
        } else if (attrName === 'data-name') {
          if (attr.value?.type === 'StringLiteral') {
            existingName = attr.value.value;
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
                } else if (prop.value.type === 'Identifier') {
                  styles[key] = `var:${prop.value.name}`;
                }
              }
            }
          }
        } else if (attr.value === null) {
          // Shorthand boolean prop: <button disabled /> or <TagPill active />
          props[attrName] = 'true';
        } else if (attr.value?.type === 'StringLiteral') {
          props[attrName] = attr.value.value;
        } else if (attr.value?.type === 'JSXExpressionContainer') {
          if (attr.value.expression.type === 'BooleanLiteral') {
            props[attrName] = String(attr.value.expression.value);
          } else if (attr.value.expression.type === 'NumericLiteral') {
            props[attrName] = String(attr.value.expression.value);
          } else if (attr.value.expression.type === 'StringLiteral') {
            props[attrName] = attr.value.expression.value;
          }
        }
      }
    }

    const hasElementChildren = node.children.some(
      (child: any) => child.type === 'JSXElement' || child.type === 'JSXFragment'
    );

    const transpiledTag = transpileUnsupportedHtmlTag(tagName, styles, hasElementChildren);
    if (transpiledTag !== tagName) {
      reporter?.recordNormalization('TRANSPILE_UNSUPPORTED_TAG', existingId ?? tagName, tagName, transpiledTag);
      tagName = transpiledTag;
    }

    // Auto-heal: If a <div> contains direct text and no block children (only text or inline runs like <span>),
    // automatically transform it into a semantic <p> so Revyme visual canvas treats it as a real text node.
    if (tagName === 'div') {
      const hasBlockChildren = node.children.some((child: any) => {
        if (child.type === 'JSXElement') {
          const childName = child.openingElement?.name?.name;
          return childName && !INLINE_TEXT_RUN_TAGS.has(childName);
        }
        return false;
      });

      const hasDirectText = node.children.some((child: any) => {
        if (child.type === 'JSXText') return child.value.trim() !== '';
        if (child.type === 'JSXExpressionContainer') {
          return child.expression?.type === 'StringLiteral' && child.expression.value.trim() !== '';
        }
        return false;
      });

      if (!hasBlockChildren && hasDirectText) {
        tagName = 'p';
        reporter?.recordNormalization('TRANSPILE_DIV_TEXT_TO_P', existingId ?? 'div', 'div', 'p');
      }
    }

    const { id } = idManager.ensureNodeId(existingId, tagName, reporter);
    const normalizedStyles = normalizeStyles(styles, unitContext, reporter, id);

    let textContent = '';
    const children: IngestedNode[] = [];

    if (!hasElementChildren) {
      for (const child of node.children) {
        if (child.type === 'JSXText') {
          const text = child.value.trim();
          if (text) textContent += (textContent ? ' ' : '') + text;
        } else if (
          child.type === 'JSXExpressionContainer' &&
          child.expression?.type === 'StringLiteral'
        ) {
          const text = child.expression.value.trim();
          if (text) textContent += (textContent ? ' ' : '') + text;
        }
      }
    } else {
      for (const child of node.children) {
        if (child.type === 'JSXText') {
          const text = child.value.trim();
          if (text) {
            const { id: spanId } = idManager.ensureNodeId(undefined, 'span', reporter);
            children.push({
              id: spanId,
              tag: 'span',
              text,
            });
          }
        } else if (
          child.type === 'JSXExpressionContainer' &&
          child.expression?.type === 'StringLiteral'
        ) {
          const text = child.expression.value.trim();
          if (text) {
            const { id: spanId } = idManager.ensureNodeId(undefined, 'span', reporter);
            children.push({
              id: spanId,
              tag: 'span',
              text,
            });
          }
        } else if (child.type === 'JSXElement') {
          const childNode = convertBabelJSX(child, idManager, unitContext, reporter);
          if (childNode) children.push(childNode);
        } else if (child.type === 'JSXFragment') {
          collectNodesFromBabel(child, idManager, unitContext, reporter, children);
        }
      }
    }

    const nodeObj: IngestedNode = {
      id,
      tag: tagName,
      name: existingName,
      styles: Object.keys(normalizedStyles).length > 0 ? normalizedStyles : undefined,
      props: Object.keys(props).length > 0 ? props : undefined,
      text: textContent || undefined,
      children: children.length > 0 ? children : undefined,
    };

    if (tagName.replace(/^motion\./, '').toLowerCase() === 'svg') {
      healSvgSubtree(nodeObj, idManager, reporter);
    }

    const syncedProps = (nodeObj.props as Record<string, any>) ?? props;
    autoHealNodeAndSubtree(
      nodeObj.id,
      nodeObj.tag,
      normalizedStyles,
      syncedProps,
      textContent,
      nodeObj.children ?? [],
      reporter
    );

    nodeObj.styles = Object.keys(normalizedStyles).length > 0 ? normalizedStyles : undefined;
    nodeObj.props = Object.keys(syncedProps).length > 0 ? syncedProps : undefined;

    return nodeObj;
  }

  return null;
}

const AUTO_FLEX_FRAME_TAGS = new Set([
  'div',
  'section',
  'article',
  'aside',
  'main',
  'header',
  'footer',
  'nav',
  'ul',
  'ol',
  'li',
  'form',
  'figure',
  'figcaption',
]);

const PADDING_STYLE_KEYS = [
  'padding',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'paddingBlock',
  'paddingInline',
  'paddingBlockStart',
  'paddingBlockEnd',
  'paddingInlineStart',
  'paddingInlineEnd',
];

const CONTAINER_REDIRECT_TAGS = new Set([
  'table',
  'thead',
  'tbody',
  'tfoot',
  'dl',
  'details',
  'dialog',
  'menu',
]);

function transpileUnsupportedHtmlTag(
  tagName: string,
  styles: Record<string, any>,
  hasElementChildren: boolean
): string {
  if (CONTAINER_REDIRECT_TAGS.has(tagName)) {
    return 'div';
  }
  if (tagName === 'tr') {
    if (styles.display === undefined) styles.display = 'flex';
    if (styles.display === 'flex' && styles.flexDirection === undefined) {
      styles.flexDirection = 'row';
    }
    return 'div';
  }
  if (tagName === 'td' || tagName === 'th') {
    if (styles.width === undefined && styles.flex === undefined) {
      styles.width = '100%';
    }
    if (tagName === 'th' && styles.fontWeight === undefined) {
      styles.fontWeight = '600';
    }
    return 'div';
  }
  if (tagName === 'dt' || tagName === 'dd' || tagName === 'summary') {
    return hasElementChildren ? 'div' : 'p';
  }
  return tagName;
}

const INHERITED_TEXT_STYLE_KEYS = [
  'fontFeatureSettings',
  'fontVariationSettings',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'lineHeight',
  'letterSpacing',
  'textTransform',
  'textAlign',
  'textDecoration',
  'textDecorationLine',
  'textDecorationStyle',
  'textDecorationColor',
  'textDecorationThickness',
  'textUnderlineOffset',
  'textShadow',
  'whiteSpace',
  'textOverflow',
  'wordBreak',
  'textIndent',
  'color',
  'WebkitTextStroke',
  'WebkitTextStrokeWidth',
  'WebkitTextStrokeColor',
  'WebkitTextFillColor',
];

const TEXT_OR_INTERACTIVE_TAGS = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'span',
  'a',
  'input',
  'textarea',
  'select',
  'option',
  'label',
  'strong',
  'em',
  'b',
  'i',
  'u',
  's',
  'small',
  'mark',
  'del',
  'ins',
  'sub',
  'sup',
  'code',
  'pre',
  'kbd',
  'samp',
  'var',
  'q',
  'blockquote',
  'cite',
  'abbr',
  'time',
  'address',
  'caption',
  'legend',
]);

const VOID_OR_VECTOR_TAGS = new Set([
  'svg',
  'path',
  'circle',
  'rect',
  'line',
  'polyline',
  'polygon',
  'ellipse',
  'g',
  'defs',
  'use',
  'clipPath',
  'linearGradient',
  'radialGradient',
  'stop',
  'img',
  'video',
  'audio',
  'iframe',
  'canvas',
  'hr',
  'br',
]);

function hasNonZeroPaddingStyle(styles: Record<string, any>): boolean {
  for (const key of PADDING_STYLE_KEYS) {
    const val = styles[key];
    if (val === undefined || val === null || val === '') continue;
    const str = String(val).trim();
    if (str !== '' && str !== '0' && str !== '0px' && str !== '0rem' && str !== '0em' && str !== '0%') {
      return true;
    }
  }
  return false;
}

function cascadeInheritedTextProps(
  nodes: IngestedNode[],
  inherited: Record<string, string | number>,
  reporter?: IngestionReporter
): void {
  for (const child of nodes) {
    if (VOID_OR_VECTOR_TAGS.has(child.tag)) {
      continue;
    }

    const isTextOrControl = Boolean(child.text) || TEXT_OR_INTERACTIVE_TAGS.has(child.tag);
    if (isTextOrControl) {
      let applied = false;
      for (const [prop, val] of Object.entries(inherited)) {
        if (!child.styles) child.styles = {};
        if (child.styles[prop] === undefined) {
          child.styles[prop] = val;
          applied = true;
        }
      }
      if (applied) {
        reporter?.recordNormalization('CASCADE_TEXT_STYLES', child.id, '', Object.keys(inherited).join(','));
      }
      if (child.children && child.children.length > 0) {
        const nextInherited: Record<string, string | number> = { ...inherited };
        if (child.styles) {
          for (const key of INHERITED_TEXT_STYLE_KEYS) {
            if (child.styles[key] !== undefined) {
              nextInherited[key] = child.styles[key];
            }
          }
        }
        cascadeInheritedTextProps(child.children, nextInherited, reporter);
      }
    } else if (child.children && child.children.length > 0) {
      cascadeInheritedTextProps(child.children, inherited, reporter);
    }
  }
}

function autoHealNodeAndSubtree(
  id: string,
  tagName: string,
  normalizedStyles: Record<string, any>,
  props: Record<string, any>,
  textContent: string,
  children: IngestedNode[],
  reporter?: IngestionReporter
): void {
  // 1. Default frame tags with element children or non-zero padding to flex-column
  if (
    AUTO_FLEX_FRAME_TAGS.has(tagName) &&
    normalizedStyles.display === undefined &&
    (children.length > 0 || hasNonZeroPaddingStyle(normalizedStyles))
  ) {
    normalizedStyles.display = 'flex';
    reporter?.recordNormalization('AUTO_FLEX_CONTAINER', id, '', 'flex');
    if (normalizedStyles.flexDirection === undefined) {
      normalizedStyles.flexDirection = 'column';
      reporter?.recordNormalization('AUTO_FLEX_DIRECTION', id, '', 'column');
    }
  } else if (tagName === 'button' && children.length > 0 && normalizedStyles.display === undefined) {
    normalizedStyles.display = 'flex';
    reporter?.recordNormalization('AUTO_FLEX_CONTAINER', id, '', 'flex');
    if (normalizedStyles.alignItems === undefined) {
      normalizedStyles.alignItems = 'center';
    }
  }

  // 2. Cascade inherited text props from pure wrapper frames down to leaf text/controls
  if (!textContent && children.length > 0 && !TEXT_OR_INTERACTIVE_TAGS.has(tagName)) {
    const cascaded: Record<string, string | number> = {};
    for (const key of INHERITED_TEXT_STYLE_KEYS) {
      if (normalizedStyles[key] !== undefined) {
        cascaded[key] = normalizedStyles[key];
        delete normalizedStyles[key];
      }
    }
    if (Object.keys(cascaded).length > 0) {
      reporter?.recordNormalization('STRIP_WRAPPER_TEXT_STYLES', id, Object.keys(cascaded).join(','), '');
      cascadeInheritedTextProps(children, cascaded, reporter);
    }
  }

  // 3. Ensure position: 'absolute' nodes carry data-pinned="true"
  if (normalizedStyles.position === 'absolute' && props['data-pinned'] === undefined) {
    props['data-pinned'] = 'true';
    reporter?.recordNormalization('AUTO_ADD_DATA_PINNED', id, '', 'true');
  }

  // 4. Default unsized <img> elements so they always render cleanly in flex/grid frames
  if (tagName === 'img') {
    const hadWidth = normalizedStyles.width !== undefined;
    const hadHeight = normalizedStyles.height !== undefined;
    if (!hadWidth) {
      normalizedStyles.width = '100%';
      reporter?.recordNormalization('AUTO_SIZE_IMAGE', `${id}.width`, '', '100%');
    }
    if (!hadHeight) {
      normalizedStyles.height = 'auto';
      reporter?.recordNormalization('AUTO_SIZE_IMAGE', `${id}.height`, '', 'auto');
    }
    if (!hadWidth && !hadHeight && normalizedStyles.objectFit === undefined) {
      normalizedStyles.objectFit = 'cover';
      reporter?.recordNormalization('AUTO_SIZE_IMAGE', `${id}.objectFit`, '', 'cover');
    }
  }

  // 5. Flex row children with width: '100%' and no px maxWidth become flex: '1 0 0px'
  if (
    normalizedStyles.display === 'flex' &&
    (!normalizedStyles.flexDirection || normalizedStyles.flexDirection === 'row') &&
    normalizedStyles.flexWrap !== 'wrap' &&
    children.length >= 2
  ) {
    for (const child of children) {
      if (child.styles && child.styles.width === '100%') {
        const mw = child.styles.maxWidth;
        const hasPxMaxWidth = mw !== undefined && /^\s*-?[\d.]+\s*px\s*$/i.test(String(mw));
        if (!hasPxMaxWidth) {
          delete child.styles.width;
          if (child.styles.flex === undefined) {
            child.styles.flex = '1 0 0px';
          }
          reporter?.recordNormalization(
            'NORMALIZE_FLEX_ROW_CHILD_WIDTH',
            child.id,
            'width: 100%',
            `flex: ${child.styles.flex}`
          );
        }
      }
    }
  }

  // 6. Enforce Revyme flex/grid flow-child invariants (no flex-shrink & explicit string order)
  const display = normalizedStyles.display;
  const isFlexContainer = display === 'flex' || display === 'inline-flex';
  const isGridContainer = display === 'grid' || display === 'inline-grid';
  if (isFlexContainer || isGridContainer) {
    const inFlowChildren = children.filter(
      (c) => c.styles?.position !== 'absolute' && c.styles?.position !== 'fixed'
    );
    inFlowChildren.forEach((child, idx) => {
      if (!child.styles) child.styles = {};
      if (isFlexContainer && child.styles.flex === undefined && child.styles.flexShrink === undefined) {
        child.styles.flex = '0 0 auto';
        reporter?.recordNormalization('AUTO_FLEX_NO_SHRINK', child.id, '', '0 0 auto');
      }
      if (inFlowChildren.length >= 2 && child.styles.order === undefined) {
        child.styles.order = String(idx);
        reporter?.recordNormalization('AUTO_CHILD_ORDER', child.id, '', String(idx));
      }
    });
  }
}
