import type * as t from '@babel/types';
import * as babelTypes from '@babel/types';
import { trace } from '@/shared/debug-trace';

const tNode = babelTypes;

export type LogicalChildSlot = {
  id: string; // data-id; 'children-slot' for template content
  owner: t.JSXElement | t.JSXFragment;
  node: t.JSXElement | t.JSXExpressionContainer;
};

/** Get the data-id string attribute value from a JSXElement, if present. */
export function getDataId(el: t.JSXElement): string | null {
  for (const attr of el.openingElement.attributes) {
    if (attr.type === 'JSXAttribute' && attr.name.name === 'data-id') {
      if (attr.value?.type === 'StringLiteral') return attr.value.value;
      if (attr.value?.type === 'JSXExpressionContainer' && attr.value.expression.type === 'StringLiteral') {
        return attr.value.expression.value;
      }
    }
  }
  return null;
}

function hasAttribute(el: t.JSXElement, name: string): boolean {
  return el.openingElement.attributes.some(
    (a) => a.type === 'JSXAttribute' && a.name.name === name,
  );
}

function isTagName(el: t.JSXElement, name: string): boolean {
  const openingName = el.openingElement.name;
  if (tNode.isJSXIdentifier(openingName)) return openingName.name === name;
  if (tNode.isJSXMemberExpression(openingName)) {
    return (
      tNode.isJSXIdentifier(openingName.object) &&
      tNode.isJSXIdentifier(openingName.property) &&
      `${openingName.object.name}.${openingName.property.name}` === name
    );
  }
  return false;
}

/** Check if a node is an invisible container whose children should flatten into parent's slot list. */
export function isTransparentGroup(node: t.JSXElement | t.JSXFragment): boolean {
  if (tNode.isJSXFragment(node)) return true;
  if (!tNode.isJSXElement(node)) return false;
  // Authored elements with data-id are never transparent
  if (getDataId(node) !== null) return false;
  return (
    isTagName(node, 'LayoutGroup') ||
    isTagName(node, 'MotionConfig') ||
    isTagName(node, 'Fragment') ||
    isTagName(node, 'React.Fragment') ||
    isTagName(node, 'RevymeSplitText')
  );
}

/** Checks whether a node holds `{children}` identifier expression. */
function holdsChildrenExpr(node: any): boolean {
  if (!node || typeof node !== 'object') return false;
  if (
    tNode.isJSXExpressionContainer(node) &&
    tNode.isIdentifier(node.expression) &&
    node.expression.name === 'children'
  ) {
    return true;
  }
  if (Array.isArray(node.children)) {
    return node.children.some(holdsChildrenExpr);
  }
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'type') continue;
    if (node[key] && typeof node[key] === 'object' && holdsChildrenExpr(node[key])) {
      return true;
    }
  }
  return false;
}

/** <PageTransitions>{children}</PageTransitions> wrapper in templates. */
function isPageTransitionsSlot(el: t.JSXElement): boolean {
  if (getDataId(el) !== null) return false;
  if (!isTagName(el, 'PageTransitions')) return false;
  return holdsChildrenExpr(el);
}

/** Glide Flow item wrapper <motion.div data-glide-item> */
function isGlideItem(el: t.JSXElement): boolean {
  return hasAttribute(el, 'data-glide-item');
}

/** AnimatePresence wrapper around conditional JSX */
function isAnimatePresence(el: t.JSXElement): boolean {
  return getDataId(el) === null && isTagName(el, 'AnimatePresence');
}

/** Non-content elements (<style>, <script>) that render no visual node */
function isNonContentElement(el: t.JSXElement): boolean {
  if (getDataId(el) !== null) return false;
  return isTagName(el, 'style') || isTagName(el, 'script');
}

/** Find first descendant data-id inside a wrapper node */
export function findFirstDataId(node: any): string | null {
  if (!node || typeof node !== 'object') return null;
  if (tNode.isJSXElement(node)) {
    const id = getDataId(node);
    if (id !== null) return id;
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      const id = findFirstDataId(child);
      if (id !== null) return id;
    }
  }
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'type') continue;
    if (node[key] && typeof node[key] === 'object') {
      const id = findFirstDataId(node[key]);
      if (id !== null) return id;
    }
  }
  return null;
}

/**
 * Collect all logical child slots of an AST parent element.
 * Transparent wrappers (LayoutGroup, fragments) are traversed transparently;
 * Glide items, AnimatePresence, and CMS map containers are returned as single unit slots.
 */
export function collectLogicalChildSlots(parent: t.JSXElement): LogicalChildSlot[] {
  const slots: LogicalChildSlot[] = [];

  function traverseContainer(container: t.JSXElement | t.JSXFragment) {
    const children = container.children;
    for (const child of children) {
      if (tNode.isJSXElement(child)) {
        if (isNonContentElement(child)) {
          continue;
        }
        if (isPageTransitionsSlot(child)) {
          slots.push({
            id: 'children-slot',
            owner: container,
            node: child,
          });
          continue;
        }
        if (isTransparentGroup(child)) {
          traverseContainer(child);
          continue;
        }
        if (isGlideItem(child)) {
          const innerId = findFirstDataId(child);
          if (innerId !== null) {
            slots.push({
              id: innerId,
              owner: container,
              node: child,
            });
          }
          continue;
        }
        if (isAnimatePresence(child)) {
          const innerId = findFirstDataId(child);
          if (innerId !== null) {
            slots.push({
              id: innerId,
              owner: container,
              node: child,
            });
          }
          continue;
        }
        const dataId = getDataId(child);
        if (dataId !== null) {
          slots.push({
            id: dataId,
            owner: container,
            node: child,
          });
          continue;
        }
      } else if (tNode.isJSXFragment(child)) {
        traverseContainer(child);
      } else if (tNode.isJSXExpressionContainer(child)) {
        if (tNode.isJSXEmptyExpression(child.expression)) {
          // Comment {/* ... */}
          continue;
        }
        if (holdsChildrenExpr(child)) {
          slots.push({
            id: 'children-slot',
            owner: container,
            node: child,
          });
          continue;
        }
        const innerId = findFirstDataId(child.expression);
        if (innerId !== null) {
          slots.push({
            id: innerId,
            owner: container,
            node: child,
          });
        }
      }
    }
  }

  traverseContainer(parent);
  return slots;
}

/** Find a specific logical child slot under parent. */
export function findLogicalChildSlot(parent: t.JSXElement, nodeId: string): LogicalChildSlot | null {
  const slots = collectLogicalChildSlots(parent);
  return slots.find((s) => s.id === nodeId) ?? null;
}

/** Remove a logical child slot from parent, returning its AST node. */
export function removeLogicalChild(parent: t.JSXElement, nodeId: string): t.JSXElement | t.JSXExpressionContainer | null {
  const slot = findLogicalChildSlot(parent, nodeId);
  if (!slot) return null;
  const children = slot.owner.children;
  const idx = children.indexOf(slot.node);
  if (idx !== -1) {
    children.splice(idx, 1);
    if (idx > 0 && idx <= children.length) {
      const prev = children[idx - 1];
      if (prev?.type === 'JSXText' && prev.value.trim() === '') {
        children.splice(idx - 1, 1);
      }
    }
    trace.action('jsx-child-slots:remove-slot', {
      parentId: getDataId(parent),
      nodeId,
      slotType: slot.node.type,
    });
    return slot.node;
  }
  return null;
}

/**
 * Insert a node into parent at the logical position specified by insertBeforeId or index.
 * Routes into the correct owner container (e.g. LayoutGroup) if transparent wrappers are present.
 */
export function insertLogicalChild(
  parent: t.JSXElement,
  node: t.JSXElement | t.JSXExpressionContainer,
  index: number,
  insertBeforeId?: string,
): boolean {
  const slots = collectLogicalChildSlots(parent);

  const getDefaultTargetOwner = (): t.JSXElement | t.JSXFragment => {
    for (const child of parent.children) {
      if ((tNode.isJSXElement(child) || tNode.isJSXFragment(child)) && isTransparentGroup(child)) {
        return child;
      }
    }
    return parent;
  };

  // 1. ANCHOR FIRST: insertBeforeId
  if (insertBeforeId) {
    const targetSlot = slots.find((s) => s.id === insertBeforeId);
    if (targetSlot) {
      const children = targetSlot.owner.children;
      const childIdx = children.indexOf(targetSlot.node);
      if (childIdx !== -1) {
        children.splice(childIdx, 0, tNode.jsxText('\n    '), node);
        trace.action('jsx-child-slots:insert-anchor', {
          parentId: getDataId(parent),
          insertBeforeId,
          ownerType: targetSlot.owner.type,
        });
        return true;
      }
    }
    trace.action('jsx-child-slots:anchor-missing', {
      parentId: getDataId(parent),
      insertBeforeId,
      fallbackIndex: index,
    });
  }

  // 2. LOGICAL INDEX
  const clampedIndex = Math.max(0, Math.min(index, slots.length));

  if (slots.length === 0) {
    const owner = getDefaultTargetOwner();
    owner.children.push(tNode.jsxText('\n    '), node, tNode.jsxText('\n'));
    trace.action('jsx-child-slots:insert-empty', {
      parentId: getDataId(parent),
      ownerType: owner.type,
    });
    return true;
  }

  if (clampedIndex < slots.length) {
    const targetSlot = slots[clampedIndex];
    const children = targetSlot.owner.children;
    const childIdx = children.indexOf(targetSlot.node);
    const insertPos = childIdx !== -1 ? childIdx : 0;
    children.splice(insertPos, 0, tNode.jsxText('\n    '), node);
    trace.action('jsx-child-slots:insert-index-before-slot', {
      parentId: getDataId(parent),
      index: clampedIndex,
      targetSlotId: targetSlot.id,
    });
    return true;
  }

  // clampedIndex === slots.length: append after the last slot
  const lastSlot = slots[slots.length - 1];
  const children = lastSlot.owner.children;
  const childIdx = children.indexOf(lastSlot.node);
  const insertPos = childIdx !== -1 ? childIdx + 1 : children.length;
  children.splice(insertPos, 0, tNode.jsxText('\n    '), node);
  trace.action('jsx-child-slots:insert-index-after-last', {
    parentId: getDataId(parent),
    lastSlotId: lastSlot.id,
  });
  return true;
}
