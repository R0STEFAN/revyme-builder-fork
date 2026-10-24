import { parse } from '@babel/parser';
import _traverse, { type NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import { normalizeBabelTraverse } from '../parsing/ast-utils';
import { getDataId, isTransparentGroup } from './jsx-child-slots';

// The automation server loads this module through Vite SSR, which may wrap the
// CommonJS Babel traverse export in one or two `default` properties.
const traverse = normalizeBabelTraverse(_traverse);

export interface ContentSlotInfo {
  start: number;
  end: number;
  parentDataId: string | null;
  siblingIndex: number;
  isWrappedInPageTransitions: boolean;
}

/**
 * Robust AST-based locator for the template `{children}` content slot.
 * Unlike substring `.indexOf('{children}')`, this:
 * 1. Never matches function parameter signatures like `function LayoutClient({children})`
 * 2. Never matches comments like `// slot is {children}`
 * 3. Handles any whitespace like `{ children }`
 * 4. Correctly identifies transparent wrappers like `<PageTransitions>`
 * 5. Returns parent data-id and logical sibling index
 */
export function findContentSlot(code: string): ContentSlotInfo | null {
  try {
    const ast = parse(code, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
    let result: ContentSlotInfo | null = null;

    traverse(ast, {
      JSXExpressionContainer(path) {
        if (result) return;
        if (t.isIdentifier(path.node.expression, { name: 'children' })) {
          const start = path.node.start ?? 0;
          const end = path.node.end ?? 0;

          let isWrappedInPageTransitions = false;
          let currentParentPath: NodePath<t.Node> | null = path.parentPath;

          // Check if immediate parent is <PageTransitions>
          if (currentParentPath && currentParentPath.isJSXElement()) {
            const el = currentParentPath.node;
            const opening = el.openingElement.name;
            if (t.isJSXIdentifier(opening, { name: 'PageTransitions' })) {
              isWrappedInPageTransitions = true;
              currentParentPath = currentParentPath.parentPath ?? null;
            }
          }

          // Walk up to find nearest JSXElement with data-id or root
          let parentDataId: string | null = null;
          let ownerElement: t.JSXElement | null = null;

          while (currentParentPath) {
            if (currentParentPath.isJSXElement()) {
              const el = currentParentPath.node;
              const dataId = getDataId(el);
              if (dataId) {
                parentDataId = dataId;
                ownerElement = el;
                break;
              }
              if (!ownerElement) {
                ownerElement = el;
              }
            }
            currentParentPath = currentParentPath.parentPath ?? null;
          }

          // Count siblings with data-id before this slot in ownerElement
          let siblingIndex = 0;
          if (ownerElement) {
            for (const child of ownerElement.children) {
              if (child === path.node) break;
              if (isWrappedInPageTransitions && t.isJSXElement(child) && t.isJSXIdentifier(child.openingElement.name, { name: 'PageTransitions' })) {
                break;
              }
              if (t.isJSXElement(child)) {
                if (getDataId(child) !== null) {
                  siblingIndex++;
                } else if (isTransparentGroup(child)) {
                  // Count transparent group children
                  for (const grandChild of child.children) {
                    if (t.isJSXElement(grandChild) && getDataId(grandChild) !== null) {
                      siblingIndex++;
                    }
                  }
                }
              }
            }
          }

          result = {
            start,
            end,
            parentDataId,
            siblingIndex,
            isWrappedInPageTransitions,
          };
        }
      },
    });

    return result;
  } catch {
    return null;
  }
}
