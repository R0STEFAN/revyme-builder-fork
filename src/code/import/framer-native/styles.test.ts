import { describe, expect, it } from 'vitest';
import { mapSourceStyles } from './styles';
import type { ResolvedSourceNode, TransferDiagnostic } from './types';

const node = (properties: Record<string, unknown>): ResolvedSourceNode => ({ id: 'box', sourceId: 'box', kind: 'FrameNode', properties, children: [], provenance: ['box'] });
const context = (extra = {}) => ({ diagnostics: [] as TransferDiagnostic[], ...extra });

describe('editor source styles', () => {
  it('retains static scale, sticky offset and text selection', () => {
    expect(mapSourceStyles(node({ position: 'sticky', positionStickyTop: 120, scale: 2, rotation: 10, userSelect: 'none' }), context())).toMatchObject({ top: '120px', transform: 'rotate(10deg) scale(2)', userSelect: 'none' });
    expect(mapSourceStyles(node({ scale: 0 }), context()).transform).toBe('scale(0)');
  });
  it('reports active masks, effects, forms and custom cursors until their native adapters exist', () => {
    const c = context();
    mapSourceStyles(node({ masks: [{ maskType: 'image' }], enterEffectEnabled: true, isFormContainer: true, customCursorSmartComponentId: 'cursor' }), c);
    expect(c.diagnostics.map(item => item.property)).toEqual(expect.arrayContaining(['masks', 'enterEffectEnabled', 'isFormContainer', 'customCursorSmartComponentId']));
    const inactive = context();
    mapSourceStyles(node({ masks: [], enterEffectEnabled: false, enterEffectOpacity: 0, isFormContainer: false }), inactive);
    expect(inactive.diagnostics).toEqual([]);
  });
  it('maps stacks, wrapping and main/cross axis fill weights', () => {
    const styles = mapSourceStyles(node({ layout: 'stack', stackDirection: 'horizontal', stackAlignment: 'center', stackDistribution: 'space-between', stackWrapEnabled: true, gap: '20px', width: 2, widthType: 3, height: 1, heightType: 3 }), context({ parent: node({ layout: 'stack', stackDirection: 'horizontal' }) }));
    expect(styles).toMatchObject({ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', flexGrow: '2', flexBasis: '0px', height: '100%' });
  });
  it('maps fixed, percentage, fit, viewport and fit-image dimensions distinctly', () => {
    expect(mapSourceStyles(node({ widthType: 0, width: 0, heightType: 1, height: 0.5 }), context())).toMatchObject({ width: '0px', height: '50%' });
    expect(mapSourceStyles(node({ widthType: 2, heightType: 4, height: 0.8 }), context())).toMatchObject({ width: 'min-content', height: '80vh' });
    expect(mapSourceStyles(node({ widthType: 0, width: 300, heightType: 5, fillImagePixelWidth: 1200, fillImagePixelHeight: 800 }), context())).toMatchObject({ aspectRatio: '1.5', height: 'auto' });
  });
  it('maps grid columns, row height and child spans', () => {
    expect(mapSourceStyles(node({ layout: 'grid', gridColumnCount: 6, gridRowHeightType: 'fit', gap: '12px 20px' }), context())).toMatchObject({ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gridAutoRows: 'min-content', gap: '12px 20px' });
    expect(mapSourceStyles(node({ gridItemColumnSpan: 3, gridItemRowSpan: 2 }), context({ parent: node({ layout: 'grid' }) }))).toMatchObject({ gridColumn: 'span 3', gridRow: 'span 2' });
  });
  it('ignores canvas coordinates for flow items and preserves absolute pins', () => {
    expect(mapSourceStyles(node({ left: 100, top: 200 }), context({ parent: node({ layout: 'stack' }) }))).not.toHaveProperty('left');
    expect(mapSourceStyles(node({ position: 'absolute', left: 0, right: 0, top: 4, bottom: null }), context())).toMatchObject({ position: 'absolute', left: '0px', right: '0px', top: '4px' });
  });
  it('does not activate disabled or inactive gradient/image fills', () => {
    expect(mapSourceStyles(node({ fillEnabled: false, fillType: 'linearGradient', fillLinearGradient: 'linear-gradient(red, blue)' }), context())).not.toHaveProperty('backgroundImage');
    expect(mapSourceStyles(node({ fillEnabled: true, fillType: 'color', fillColor: 'red', fillLinearGradient: 'linear-gradient(red, blue)' }), context())).toMatchObject({ backgroundColor: 'red' });
    expect(mapSourceStyles(node({ fillEnabled: true, fillType: 'color', fillColor: 'red', fillImage: 'stale' }), context())).not.toHaveProperty('backgroundImage');
  });
  it('resolves original assets, image fit, borders, padding and corners', () => {
    expect(mapSourceStyles(node({ fillEnabled: true, fillType: 'image', fillImage: 'asset:photo', fillImageResize: 'fit', paddingPerSide: true, paddingTop: 0, paddingBottom: 12, paddingLeft: 4, paddingRight: 4, radiusPerCorner: true, radiusTopLeft: 3, borderEnabled: true, borderWidth: 1, borderStyle: 'solid', borderColor: 'black' }), context({ assets: { 'asset:photo': '/assets/photo.jpg' } }))).toMatchObject({ backgroundImage: 'url("/assets/photo.jpg")', backgroundSize: 'contain', paddingTop: '0px', paddingBottom: '12px', borderTopLeftRadius: '3px', border: '1px solid black' });
  });
  it('keeps bindings as native prop references and reports unresolved values', () => {
    const ref = { type: 'variableReference', providerId: 'component', id: 'color' };
    expect(mapSourceStyles(node({ fillEnabled: true, fillType: 'color', fillColor: ref }), context({ variables: { 'component:color': '{color}' } })).backgroundColor).toBe('{color}');
    const c = context();
    mapSourceStyles(node({ fillEnabled: true, fillType: 'color', fillColor: ref, widthType: 99 }), c);
    expect(c.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: 'box', property: 'fillColor', code: 'SOURCE_VALUE_UNRESOLVED' }),
      expect.objectContaining({ sourceId: 'box', property: 'widthType', code: 'SOURCE_STYLE_UNSUPPORTED' }),
    ]));
  });
  it('maps the observed auto grid rows and active conic gradients, without activating stale linear fills', () => {
    const styles = mapSourceStyles(node({ layout: 'grid', gridColumnCount: 2, gridRowHeightType: 'auto', fillEnabled: true, fillType: 'conic-gradient', fillConicGradient: { alpha: 1, angle: 20, centerAnchorX: 0.25, centerAnchorY: 0.5, stops: [{ position: 0, value: 'red' }, { position: 1, value: 'blue' }] } }), context());
    expect(styles.gridAutoRows).toBe('auto');
    expect(styles.backgroundImage).toBe('conic-gradient(from 20deg at 25% 50%, red 0%, blue 100%)');
  });
});
