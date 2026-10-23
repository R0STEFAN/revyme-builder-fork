import { describe, expect, it } from 'vitest';
import { parse } from '@babel/parser';
import { traverse } from './shared';
import { isSafeCmsText } from './cms-safe-text';
import * as t from '@babel/types';

const formatter = `typeof item.title === 'object' && item.title !== null ? (typeof item.title.name === 'string' ? item.title.name : typeof item.title.title === 'string' ? item.title.title : typeof item.title.label === 'string' ? item.title.label : typeof item.title.value === 'string' || typeof item.title.value === 'number' ? String(item.title.value) : JSON.stringify(item.title)) : String(item.title ?? '')`;

function recognized(source: string, detail = false): boolean {
  const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
  let result = false;
  traverse(ast, { JSXElement(path) {
    const child = path.node.children.find(t.isJSXExpressionContainer);
    if (child) result = isSafeCmsText(child.expression, path, detail);
  } });
  return result;
}

describe('CMS safe text formatter', () => {
  it('accepts the exact generated formatter in detail and map scopes', () => {
    expect(recognized(`const page = <p>{${formatter}}</p>`, true)).toBe(true);
    expect(recognized(`const page = rows.map(item => <p>{${formatter}}</p>)`)).toBe(true);
  });
  it('does not allow unscoped or modified expressions', () => {
    expect(recognized(`const page = <p>{${formatter}}</p>`)).toBe(false);
    expect(recognized(`const page = <p>{${formatter.replace('JSON.stringify(item.title)', 'item.title')}}</p>`, true)).toBe(false);
    expect(recognized('const page = <p>{item.title ? "yes" : "no"}</p>', true)).toBe(false);
  });
});
