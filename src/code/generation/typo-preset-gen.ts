// typo-preset-gen.ts — source rewrites for typography presets that go beyond
// a single node's style write.
//
// A preset lives as `--typo-<group>-<suffix>` tokens; APPLYING it writes a
// `var(--typo-<group>-<suffix>)` into the text's inline style for every token
// the preset has at that moment. The text STROKE is optional — a preset can
// gain one long after it was applied, and the texts already using it hold no
// reference to the new tokens, so they would never show the stroke that the
// panel says the preset has. `bindPresetStrokeInCode` gives them one.

import * as t from '@babel/types';
import { parseJSX, traverse } from '../parsing/ast-utils';
import { generate } from './generator-utils';
import { trace } from '@/shared/debug-trace';

const STROKE_KEYS = ['WebkitTextStroke', 'WebkitTextStrokeWidth', 'WebkitTextStrokeColor'];

const keyName = (p: t.ObjectProperty): string | null =>
  t.isIdentifier(p.key) ? p.key.name : t.isStringLiteral(p.key) ? p.key.value : null;

/**
 * Every element in `code` using preset `groupName` — its inline style says
 * `fontFamily: 'var(--typo-<group>-font)'`, the same marker the Text Style
 * panel detects a preset by — gets the stroke longhands bound to the preset:
 *   WebkitTextStrokeWidth: 'var(--typo-<group>-stroke-width)'
 *   WebkitTextStrokeColor: 'var(--typo-<group>-stroke-color)'
 * An element that already sets any stroke of its own is left alone (that's an
 * override). Pure string → string; unchanged code when nothing uses the preset.
 */
export function bindPresetStrokeInCode(code: string, groupName: string): string {
  if (!code.includes(`--typo-${groupName}-font`)) return code;
  const ast = parseJSX(code);
  if (!ast) return code;
  const marker = new RegExp(`^var\\(\\s*--typo-${groupName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-font\\s*[,)]`);
  let bound = 0;
  traverse(ast, {
    JSXAttribute(path) {
      if (!t.isJSXIdentifier(path.node.name, { name: 'style' })) return;
      const v = path.node.value;
      if (!t.isJSXExpressionContainer(v) || !t.isObjectExpression(v.expression)) return;
      const props = v.expression.properties.filter((p): p is t.ObjectProperty => t.isObjectProperty(p));
      const font = props.find((p) => keyName(p) === 'fontFamily');
      if (!font || !t.isStringLiteral(font.value) || !marker.test(font.value.value.trim())) return;
      if (props.some((p) => STROKE_KEYS.includes(keyName(p) ?? ''))) return;
      v.expression.properties.push(
        t.objectProperty(t.identifier('WebkitTextStrokeWidth'), t.stringLiteral(`var(--typo-${groupName}-stroke-width)`)),
        t.objectProperty(t.identifier('WebkitTextStrokeColor'), t.stringLiteral(`var(--typo-${groupName}-stroke-color)`)),
      );
      bound++;
    },
  });
  if (bound === 0) return code;
  try {
    const out = generate(ast, { retainLines: true }, code).code;
    trace.action('typo-preset-gen:bind-stroke', { groupName, bound });
    return out;
  } catch (err) {
    trace.error('typo-preset-gen:bind-stroke-failed', { groupName, error: err instanceof Error ? err.message : String(err) });
    return code;
  }
}
