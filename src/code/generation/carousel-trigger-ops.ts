// carousel-trigger-ops.ts — AST operations for Embla Carousel external triggers.
// Manages `data-carousel-target` and `data-carousel-action` attributes on JSX elements.

import * as t from '@babel/types';
import { trace } from '@/shared/debug-trace';
import {
  parseJSX,
  findFirstElementByDataId,
  findAttribute,
  getAttributeValue,
  traverse,
} from '@/code/parsing/ast-utils';
import { generate } from './generator-utils';

function setOrUpdateAttribute(el: t.JSXElement, name: string, value: string): void {
  const existing = el.openingElement.attributes.find(
    (attr): attr is t.JSXAttribute =>
      attr.type === 'JSXAttribute' &&
      attr.name.type === 'JSXIdentifier' &&
      attr.name.name === name,
  );
  if (existing) {
    existing.value = t.stringLiteral(value);
  } else {
    el.openingElement.attributes.push(
      t.jsxAttribute(t.jsxIdentifier(name), t.stringLiteral(value)),
    );
  }
}

/**
 * Set or update carousel trigger attributes (`data-carousel-target` and `data-carousel-action`)
 * on the JSX element with `data-id === targetNodeId`.
 */
export function setCarouselTriggerInCode(
  code: string,
  targetNodeId: string,
  carouselId: string,
  action: 'prev' | 'next',
): string {
  trace.fn('carousel-trigger-ops:setCarouselTriggerInCode', { targetNodeId, carouselId, action });
  const ast = parseJSX(code);
  if (!ast) return code;

  let found = false;
  findFirstElementByDataId(ast, targetNodeId, (_path, el) => {
    found = true;
    setOrUpdateAttribute(el, 'data-carousel-target', carouselId);
    setOrUpdateAttribute(el, 'data-carousel-action', action);
  });

  if (!found) {
    trace.action('carousel-trigger-ops:target-not-found', { targetNodeId });
    return code;
  }

  trace.action('carousel-trigger-ops:set', { targetNodeId, carouselId, action });
  return generate(ast).code;
}

/**
 * Remove carousel trigger attributes (`data-carousel-target` and `data-carousel-action`)
 * from the JSX element with `data-id === targetNodeId`.
 */
export function removeCarouselTriggerInCode(
  code: string,
  targetNodeId: string,
): string {
  trace.fn('carousel-trigger-ops:removeCarouselTriggerInCode', { targetNodeId });
  const ast = parseJSX(code);
  if (!ast) return code;

  let changed = false;
  findFirstElementByDataId(ast, targetNodeId, (_path, el) => {
    const origCount = el.openingElement.attributes.length;
    el.openingElement.attributes = el.openingElement.attributes.filter(attr => {
      if (attr.type === 'JSXAttribute' && attr.name.type === 'JSXIdentifier') {
        const name = attr.name.name;
        if (name === 'data-carousel-target' || name === 'data-carousel-action') {
          return false;
        }
      }
      return true;
    });
    if (el.openingElement.attributes.length !== origCount) {
      changed = true;
    }
  });

  if (!changed) {
    trace.action('carousel-trigger-ops:no-change', { targetNodeId });
    return code;
  }

  trace.action('carousel-trigger-ops:removed', { targetNodeId });
  return generate(ast).code;
}

/**
 * Find all trigger node IDs targeting a specific carousel ID, grouped by action ('prev' | 'next').
 */
export function getCarouselTriggers(
  code: string,
  carouselId: string,
): { prevIds: string[]; nextIds: string[] } {
  trace.fn('carousel-trigger-ops:getCarouselTriggers', { carouselId });
  const ast = parseJSX(code);
  if (!ast) return { prevIds: [], nextIds: [] };

  const prevIds: string[] = [];
  const nextIds: string[] = [];

  traverse(ast, {
    JSXElement(path) {
      const opening = path.node.openingElement;
      const targetAttr = findAttribute(opening, 'data-carousel-target');
      if (!targetAttr) return;

      const targetVal = getAttributeValue(targetAttr);
      if (targetVal !== carouselId) return;

      const idAttr = findAttribute(opening, 'data-id');
      const nodeId = idAttr ? getAttributeValue(idAttr) : null;
      if (!nodeId) return;

      const actionAttr = findAttribute(opening, 'data-carousel-action');
      const actionVal = actionAttr ? getAttributeValue(actionAttr) : null;

      if (actionVal === 'prev') {
        prevIds.push(nodeId);
      } else if (actionVal === 'next') {
        nextIds.push(nodeId);
      }
    },
  });

  trace.action('carousel-trigger-ops:found', {
    carouselId,
    prevCount: prevIds.length,
    nextCount: nextIds.length,
  });

  return { prevIds, nextIds };
}
