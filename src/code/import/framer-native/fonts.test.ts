import { expect, it } from 'vitest';
import { parseSourceGoogleFont, sourceGoogleFontRequests } from './fonts';
import type { SourceNode } from './types';
it('reads static, italic and exact variable Google font requirements without resolving font files', () => {
  expect(parseSourceGoogleFont('GF;Zalando Sans-800italic')).toEqual({ family: 'Zalando Sans', axes: { wght: 800, ital: 1 } });
  expect(parseSourceGoogleFont('GF;Zalando Sans-variable-regularVF=IndkdGgiIDEwMCwgIndnaHQiIDQ1MA==')).toEqual({ family: 'Zalando Sans', axes: { wght: 450, wdth: 100 } });
  expect(parseSourceGoogleFont('GF;Instrument Sans-variable-regular', { wdth: 100, wght: 450 })).toEqual({ family: 'Instrument Sans', axes: { wght: 450, wdth: 100 } });
  expect(parseSourceGoogleFont('Inter-Bold')).toBeUndefined();
  expect(parseSourceGoogleFont('GF;Zalando Sans-variable-regularVF=invalid')).toBeUndefined();
});
it('deduplicates inline and preset requirements while skipping custom code internals', () => {
  const nodes: SourceNode[] = [
    { id: 'text', kind: 'RichTextNode', raw: { font: 'GF;Zalando Sans-800', html: '<p style="--font-selector: R0Y7WmFsYW5kbyBTYW5zLTgwMA==;">Text</p>' }, children: [] },
    { id: 'input', kind: 'FormPlainTextInputNode', raw: { formInputFontSelector: 'GF;Instrument Sans-variable-regular', formInputVariationAxes: { wdth: 100, wght: 450 } }, children: [] },
    { id: 'custom', kind: 'CodeComponentNode', raw: { codeComponentIdentifier: 'module:external/save/Component.js:default', font: 'GF;Unused-regular' }, children: [] },
  ];
  const result = sourceGoogleFontRequests({ nodes: new Map(nodes.map(node => [node.id, node])), reachable: new Set(nodes.map(node => node.id)) });
  expect(result.diagnostics).toEqual([]);
  expect(result.requests).toEqual([{ family: 'Instrument Sans', axes: { wght: 450, wdth: 100 } }, { family: 'Zalando Sans', axes: { wght: 800 } }]);
});
