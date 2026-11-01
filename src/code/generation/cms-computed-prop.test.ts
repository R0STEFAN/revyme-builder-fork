import { describe, expect, it, vi } from 'vitest';
import { applyCmsPropBinding, cmsPropBindingExpression } from '@/shared/cms-prop-bindings';
import { parseJSXToNodes } from '../parsing/parser';
import { checkFile } from '../oracle/check-file';
import { bakeCmsOrphanValuesInCode, dormantizeCloneAttrBindings, dormantizeCmsBindings, rehydrateCmsBindings } from './cms-detach-gen';
import { resolveCmsRowValues } from './cms-row-resolve';

vi.mock('@/code/project/cms-ops', () => ({
  getCollectionData: () => [{ _id: 'row-a', image: '', flag: false }],
  getCollectionSchema: () => null,
}));

// Observed editor source: chunk-AUCM2KXG.mjs, L1. false and 0 ARE set;
// empty arrays, empty strings, null and undefined are not. This is not Boolean().
const expression = (iter = 'item', field = 'image') => `Array.isArray(${iter}.${field}) ? ${iter}.${field}.length > 0 : ${iter}.${field} != null && ${iter}.${field} !== ''`;
const page = (expr = expression()) => `'use client';
/** @canvas { "viewports": [{ "id": "desktop", "label": "Desktop", "width": 1200, "isPrimary": true, "order": 0 }], "positions": { "desktop": { "x": 0, "y": 0 } } } */
import works from '@/cms/works.json';
import Card from '@/components/Card';
export default function Page() { return <div data-id="root" style={{position:'relative',width:'100%',height:'auto'}}>
  <div data-id="list" style={{position:'relative',width:'100%',height:'auto'}}>
    {works.map(item => <Card key={item._id} data-id="card" showImage={${expr}} style={{position:'relative',width:'200px',height:'auto'}} />)}
  </div>
</div>; }`;

describe('native computed CMS prop bindings', () => {
  it.each([[false, true], [0, true], ['', false], [null, false], [undefined, false], [[], false], [['x'], true], ['false', true]])('retains presence semantics for %j', (value, expected) => {
    expect(applyCmsPropBinding(value, { transform: 'isSet' })).toBe(expected);
  });
  it('parses an editable computed binding and passes the native page Oracle', () => {
    const code = page();
    expect(parseJSXToNodes(code).get('card')?.propBindings).toContainEqual({ prop: 'showImage', field: 'image', transform: 'isSet' });
    expect(checkFile(code, { kind: 'page', path: 'app/page.client.tsx', projectFiles: new Set(['cms/works.json', 'components/Card.tsx']) })).toEqual([]);
  });
  it('does not misclassify a different ternary as presence', () => {
    expect(parseJSXToNodes(page(expression().replace('item.image.length', 'other.image.length'))).get('card')?.propBindings?.some(binding => binding.prop === 'showImage')).toBeFalsy();
  });
  it('retains the transform when detaching, baking an empty value and re-entering a different row scope', () => {
    const detached = dormantizeCmsBindings(page(), 'card', 'item');
    expect(detached).toContain('showImage:image:isSet');
    expect(detached).not.toContain('showImage={Array');
    const baked = bakeCmsOrphanValuesInCode(detached, 'card', { image: '' });
    expect(baked).toContain('showImage={false}');
    const reentered = rehydrateCmsBindings(baked.replace('works.map(item =>', 'works.map(row =>'), 'card');
    expect(parseJSXToNodes(reentered).get('card')?.propBindings).toContainEqual({ prop: 'showImage', field: 'image', transform: 'isSet' });
    expect(reentered).toContain('Array.isArray(row.image)');
    expect(reentered).not.toContain('data-cms-orphan');
  });
  it('keeps the transform in clone and parser orphan metadata', () => {
    const attrs = dormantizeCloneAttrBindings(undefined, [{ prop: 'showImage', field: 'image', transform: 'isSet' }], undefined);
    expect(attrs?.['data-cms-orphan']).toBe('showImage:image:isSet');
    const nodes = parseJSXToNodes(`<Card data-id="card" data-cms-orphan="${attrs!['data-cms-orphan']}" />`);
    expect(nodes.get('card')?.orphanBindings).toContainEqual({ prop: 'showImage', field: 'image', transform: 'isSet' });
  });
  it('resolves the transformed boolean for the row currently shown on canvas', () => {
    const nodes = parseJSXToNodes(page()), card = nodes.get('card')!;
    expect(resolveCmsRowValues(card, nodes)).toMatchObject({ showImage: 'false' });
    card.propBindings = [{ prop: 'flagSet', field: 'flag', transform: 'isSet' }];
    expect(resolveCmsRowValues(card, nodes)).toMatchObject({ flagSet: 'true' });
  });
  it('emits the canonical expression using the actual lexical iterator', () => {
    expect(cmsPropBindingExpression('row', { field: 'image', transform: 'isSet' })).toBe(expression('row'));
  });
});
