import { expect, it } from 'vitest';
import captured from './fixtures/captured-underline.json';
import { allocateTargetIdentity, buildSourceGraph } from './source-graph';
import { emitSourceScene } from './scene';
import { mapSourceStyles } from './styles';
import { parseJSXToNodes } from '../../parsing/parser';

function scene(htmlTag: string) {
  const data = { id: 'section', __class: 'FrameNode', htmlTag, name: 'Назва "секції"', children: [{ id: 'text', __class: 'RichTextNode', children: [], html: '<p>Текст &amp; символи</p>' }] };
  const graph = buildSourceGraph({ ...captured, rootIds: [data.id], definitions: [{ id: data.id, kind: data.__class, data }] });
  const identity = allocateTargetIdentity(graph, new Set());
  const result = emitSourceScene(graph, identity, data.id, { graph, diagnostics: [] }, { stylesFor: node => mapSourceStyles(node, { diagnostics: [] }), expressionFor: () => { throw new Error('Unexpected binding'); } });
  return { result, identity };
}
it('preserves semantic Frame tags and editable escaped text in shared scene emission', () => {
  const { result, identity } = scene('section');
  const nodes = parseJSXToNodes(`export default function Page(){ return ${result.jsx}; }`);
  expect(nodes.get(identity.section)?.type).toBe('section');
  expect(nodes.get(identity.text)?.textContent).toBe('Текст & символи');
  expect(result.sourceIds).toEqual(['section', 'text']);
});
it('rejects a Frame tag that requires a separate semantic adapter', () => {
  expect(() => scene('iframe')).toThrow(/tag.*adapter/i);
});
it('omits zero-size or SmoothScroll code components from generated scene and sourceIds', () => {
  const data = {
    id: 'wrapper',
    __class: 'FrameNode',
    children: [
      { id: 'smooth-scroll', __class: 'CodeComponentNode', codeComponentIdentifier: 'module:util/SmoothScroll_Prod.js:default', width: 0, height: 0, children: [] },
      { id: 'valid-text', __class: 'RichTextNode', html: '<p>Hello</p>', children: [] },
    ],
  };
  const graph = buildSourceGraph({ ...captured, rootIds: [data.id], definitions: [{ id: data.id, kind: data.__class, data }] });
  const identity = allocateTargetIdentity(graph, new Set());
  const result = emitSourceScene(graph, identity, data.id, { graph, diagnostics: [] }, { stylesFor: node => mapSourceStyles(node, { diagnostics: [] }), expressionFor: () => { throw new Error('Unexpected binding'); } });
  expect(result.sourceIds).not.toContain('smooth-scroll');
  expect(result.jsx).not.toContain('SmoothScroll');
  expect(result.jsx).not.toContain('Заглушка');
  expect(result.jsx).toContain('Hello');
});
