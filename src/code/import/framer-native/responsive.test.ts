import { describe, expect, it } from 'vitest';
import { parseCanvasConfig } from '../../project/canvas-config';
import { applyNativeResponsive, sourceViewports } from './responsive';
import { allocateTargetIdentity, buildSourceGraph } from './source-graph';
import captured from './fixtures/captured-underline.json';

function fixture() {
  const copy = JSON.parse(JSON.stringify(captured));
  const scope = copy.definitions[0].data;
  scope.__class = copy.definitions[0].kind = 'WebPageNode';
  scope.children = scope.children.slice(0, 3);
  scope.children[0].width = 1400;
  scope.children[1].replicaInfo.overrides.q7dmakjiW.width = 900;
  scope.children[2].replicaInfo.overrides.q7dmakjiW.width = 430;
  scope.children[2].replicaInfo.overrides.uLUi_cY4A = { visible: false };
  return buildSourceGraph(copy);
}
describe('native responsive source mapping', () => {
  it('preserves custom design widths and infers adjacent responsive bands', () => {
    const graph = fixture();
    expect(sourceViewports(graph, 'f03DgVEM5').map(v => [v.width, v.designWidth, v.isPrimary])).toEqual([[1400, 1400, true], [1399, 900, false], [899, 430, false]]);
  });
  it('writes responsive rules and canvas configuration onto one existing tree', () => {
    const graph = fixture();
    const identity = allocateTargetIdentity(graph, new Set());
    const code = `"use client"; export default function Page(){return <div data-id="${identity.q7dmakjiW}"><p data-id="${identity.uLUi_cY4A}">Label</p></div>}`;
    const diagnostics: import('./types').TransferDiagnostic[] = [];
    const output = applyNativeResponsive(code, { graph, scopeId: 'f03DgVEM5', context: { diagnostics } }, identity);
    expect(parseCanvasConfig(output)?.viewports.map(v => v.designWidth ?? v.width)).toEqual([1400, 900, 430]);
    expect(output.match(/<p /g)).toHaveLength(1);
    expect(output).toContain('max-width: 899px');
    expect(output).toContain('min-width: 899.02px');
    expect(output).toContain('display: none');
  });
  it('resets deleted constraints and emits sibling order without copying the subtree', () => {
    const graph = fixture();
    graph.nodes.get('q7dmakjiW')!.raw.minHeight = 100;
    const info = graph.nodes.get('acBGhQqLi')!.raw.replicaInfo as { overrides: Record<string, Record<string, unknown>> };
    info.overrides.q7dmakjiW._deleted = ['minHeight'];
    info.overrides.q7dmakjiW.itemsOrder = ['MhIYRayaq', 'uLUi_cY4A'];
    const identity = allocateTargetIdentity(graph, new Set());
    const code = `"use client"; export default function Page(){return <div data-id="${identity.q7dmakjiW}"><p data-id="${identity.uLUi_cY4A}">Label</p><div data-id="${identity.MhIYRayaq}" /></div>}`;
    const output = applyNativeResponsive(code, { graph, scopeId: 'f03DgVEM5', context: { diagnostics: [] } }, identity);
    expect(output).toContain('min-height: auto');
    expect(output).toContain(`[data-id="${identity.uLUi_cY4A}"] {`);
    expect(output).toContain('order: 1');
    expect(output.match(/>Label<\/p>/g)).toHaveLength(1);
  });
});
