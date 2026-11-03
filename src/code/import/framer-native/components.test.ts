import { describe, expect, it } from 'vitest';
import capture from './fixtures/captured-components.json';
import { parsePropMeta } from '../../components/prop-meta';
import { updateNodeTextInCode } from '../../generation/generator-crud';
import { updateVariantStyleInCode } from '../../generation/generator-styles';
import { checkFile } from '../../oracle/check-file';
import { parseJSXToNodes } from '../../parsing/parser';
import { parseConnections } from '../../variants/connection-config';
import { parseVariantConfig } from '../../variants/variant-config';
import { allocateTargetIdentity, buildSourceGraph } from './source-graph';
import { emitNativeComponents, nativePropName } from './components';
import { sourceStateNames } from './interactions';
import capturedOverride from './fixtures/captured-override.json';
import { emitNativeCodeOverrides } from './code-adapters';
import { readCodeOverrides } from '../../generation/code-override-gen';
import { parseResponsiveAttr } from '../../generation/responsive-attrs-gen';
import capturedCms from './fixtures/captured-cms.json';

it('preserves removal of a text direction attribute in a component state', () => {
  const data = { id: 'button', __class: 'SmartComponentNode', baseVariantId: 'base', variables: [], children: [
    { id: 'base', __class: 'FrameNode', children: [{ id: 'label', __class: 'RichTextNode', parentid: 'base', html: '<p dir="auto">Submit</p>', children: [] }] },
    { id: 'success', __class: 'FrameNode', children: [], replicaInfo: { master: 'base', overrides: { label: { html: '<p>Sent</p>' } } } },
  ] };
  const graph = buildSourceGraph({ ...capture, rootIds: ['button'], definitions: [{ id: data.id, kind: data.__class, data }] });
  const identity = allocateTargetIdentity(graph, new Set()), names = sourceStateNames({ graph, scopeId: 'button' }, identity);
  const result = emitNativeComponents(graph, identity);
  expect(result.diagnostics).toEqual([]);
  expect(parseResponsiveAttr(result.files[0].code, identity.label, 'dir').byVariant.get(names.success)).toBeNull();
  expect(checkFile(result.files[0].code, { kind: 'component', path: result.files[0].path })).toEqual([]);
});

it.each([true, false])('converts static per-state visibility with base hidden %s into native presence', baseHidden => {
  const data = { id: 'button', __class: 'SmartComponentNode', baseVariantId: 'base', variables: [], children: [
    { id: 'base', __class: 'FrameNode', children: [{ id: 'spinner', __class: 'FrameNode', parentid: 'base', layout: 'stack', visible: !baseHidden, children: [] }] },
    { id: 'loading', __class: 'FrameNode', children: [], replicaInfo: { master: 'base', overrides: { spinner: { visible: baseHidden } } } },
  ] };
  const graph = buildSourceGraph({ ...capture, rootIds: ['button'], definitions: [{ id: data.id, kind: data.__class, data }] });
  const identity = allocateTargetIdentity(graph, new Set()), result = emitNativeComponents(graph, identity);
  expect(result.diagnostics).toEqual([]);
  expect(result.files[0].code).toContain('AnimatePresence');
  expect(checkFile(result.files[0].code, { kind: 'component', path: result.files[0].path })).toEqual([]);
  expect(parseJSXToNodes(result.files[0].code).get(identity.spinner)?.styles.display).toBe('flex');
});
import { parseComponentInfoFromSource } from '../../components/component-registry';
import { decomposeLoopInCode, getLoopAnimate } from '../../generation/generator-motion-loop';

describe('editable native component emission', () => {
  it('retains a component cursor prop as a native editable cursor binding', () => {
    const data = { id: 'cursor-master', __class: 'SmartComponentNode', baseVariantId: 'base', variables: [{ id: 'pointer', type: 'customcursor', name: 'Cursor' }], children: [{ id: 'base', __class: 'FrameNode', width: 100, widthType: 0, height: 100, heightType: 0, customCursorType: { type: 'variableReference', providerId: 'cursor-master', id: 'pointer' }, children: [] }] };
    const graph = buildSourceGraph({ ...capture, rootIds: [data.id], definitions: [{ id: data.id, kind: data.__class, data }] });
    const identity = allocateTargetIdentity(graph, new Set()), result = emitNativeComponents(graph, identity);
    expect(result.diagnostics).toEqual([]);
    const prop = nativePropName(identity, data.id, 'pointer');
    expect(parsePropMeta(result.files[0].code)[prop]).toMatchObject({ type: 'componentCursor' });
    expect(result.files[0].code).toContain(`withCursor(${prop},`);
    expect(checkFile(result.files[0].code, { kind: 'component', path: result.files[0].path })).toEqual([]);
  });
  it('preserves a constant rotation loop on a component child across variants', () => {
    const spinner = { id: 'spinner', __class: 'FrameNode', parentid: 'base', children: [], loopEffectEnabled: true, loopEffectRotate: 360, loopEffectRepeatType: 'loop', loopEffectRepeatDelay: 0, loopEffectTransition: { type: 'tween', duration: 1, delay: 0, ease: [0, 0, 1, 1] } };
    const data = { id: 'animated', __class: 'SmartComponentNode', baseVariantId: 'base', variables: [], children: [{ id: 'base', __class: 'FrameNode', width: 100, widthType: 0, height: 100, heightType: 0, children: [spinner] }, { id: 'other', __class: 'FrameNode', children: [], replicaInfo: { master: 'base', overrides: {} } }] };
    const input = { ...capture, rootIds: [data.id], definitions: [{ id: data.id, kind: data.__class, data }] };
    const graph = buildSourceGraph(input), identity = allocateTargetIdentity(graph, new Set());
    const result = emitNativeComponents(graph, identity);
    expect(result.diagnostics).toEqual([]);
    expect(getLoopAnimate(decomposeLoopInCode(result.files[0].code, identity.spinner), identity.spinner)?.props.rotate).toBe('360');
    expect(checkFile(result.files[0].code, { kind: 'component', path: result.files[0].path })).toEqual([]);
    data.children[1].replicaInfo!.overrides = { spinner: { loopEffectRotate: 180 } };
    expect(emitNativeComponents(buildSourceGraph(input), identity).diagnostics).toContainEqual(expect.objectContaining({ message: expect.stringContaining('loop') }));
  });
  it('keeps filling placeholder and frame children from shrinking in a native stack', () => {
    const data = { id: 'fill-master', __class: 'SmartComponentNode', baseVariantId: 'fill-base', variables: [], children: [{ id: 'fill-base', __class: 'FrameNode', layout: 'stack', stackDirection: 'vertical', width: 200, widthType: 0, height: 100, heightType: 0, children: [
      { id: 'widget', __class: 'CodeComponentNode', parentid: 'fill-base', codeComponentIdentifier: 'module:vendor/save/Widget.js:Widget', heightType: 3, height: 1, children: [] },
      { id: 'image', __class: 'FrameNode', parentid: 'fill-base', heightType: 3, height: 1, children: [] },
    ] }] };
    const graph = buildSourceGraph({ ...capture, rootIds: [data.id], definitions: [{ id: data.id, kind: data.__class, data }] });
    const identity = allocateTargetIdentity(graph, new Set());
    const result = emitNativeComponents(graph, identity);
    expect(result.diagnostics).toEqual([]);
    const file = result.files[0], nodes = parseJSXToNodes(file.code);
    expect(nodes.get(identity.widget)?.styles.flex).toBe('1 0 0px');
    expect(nodes.get(identity.image)?.styles.flex).toBe('1 0 0px');
    expect(checkFile(file.code, { kind: 'component', path: file.path })).toEqual([]);
  });
  it('keeps a controlReference to a file as an editable native file prop', () => {
    const data = { id: 'file-master', __class: 'SmartComponentNode', baseVariantId: 'file-base', variables: [{ id: 'clip', name: 'Video', type: 'controlReference', expectedType: 'file', initialValue: '' }], children: [{ id: 'file-base', __class: 'FrameNode', children: [], width: 100, widthType: 0, heightType: 2 }] };
    const graph = buildSourceGraph({ ...capture, rootIds: [data.id], definitions: [{ id: data.id, kind: data.__class, data }] });
    const identity = allocateTargetIdentity(graph, new Set()), prop = nativePropName(identity, data.id, 'clip');
    const result = emitNativeComponents(graph, identity);
    expect(result.diagnostics).toEqual([]);
    expect(parsePropMeta(result.files[0].code)[prop]).toMatchObject({ type: 'file', label: 'Video' });
  });
  it('preserves a source page link using the allocated destination route', () => {
    const data = { id: 'link-master', __class: 'SmartComponentNode', baseVariantId: 'link-base', variables: [], children: [{ id: 'link-base', __class: 'FrameNode', children: [{ id: 'link-child', __class: 'FrameNode', parentid: 'link-base', children: [], link: { type: 'webPage', webPageId: 'source-home' } }] }] };
    const graph = buildSourceGraph({ ...capture, rootIds: [data.id], definitions: [{ id: data.id, kind: data.__class, data }] });
    const identity = allocateTargetIdentity(graph, new Set());
    const result = emitNativeComponents(graph, identity, { routes: { 'source-home': '/imported-home' } });
    expect(result.diagnostics).toEqual([]);
    expect(parseJSXToNodes(result.files[0].code).get(identity['link-child'])?.attrs.href).toBe('/imported-home');
    expect(emitNativeComponents(graph, identity).files).toEqual([]);
  });
  it('does not discard page-link changes between component variants', () => {
    const data = { id: 'link-master', __class: 'SmartComponentNode', baseVariantId: 'base', variables: [], children: [
      { id: 'base', __class: 'FrameNode', children: [{ id: 'child', __class: 'FrameNode', parentid: 'base', children: [], link: { type: 'webPage', webPageId: 'home' } }] },
      { id: 'other', __class: 'FrameNode', children: [], replicaInfo: { master: 'base', overrides: { child: { link: { type: 'webPage', webPageId: 'about' } } } } },
    ] };
    const graph = buildSourceGraph({ ...capture, rootIds: [data.id], definitions: [{ id: data.id, kind: data.__class, data }] });
    const identity = allocateTargetIdentity(graph, new Set());
    const result = emitNativeComponents(graph, identity, { routes: { home: '/', about: '/about' } });
    expect(result.files).toEqual([]);
    expect(result.diagnostics.some(item => item.message.includes('link'))).toBe(true);
  });
  it('uses the native whole-value image prop contract for a bound image fill', () => {
    const asset = 'data:framer/asset-reference,photo.jpg';
    const data = { id: 'image-master', __class: 'SmartComponentNode', baseVariantId: 'image-base', variables: [{ id: 'photo', type: 'image', initialValue: asset }], children: [{ id: 'image-base', __class: 'FrameNode', children: [{ id: 'image-child', parentid: 'image-base', __class: 'FrameNode', width: 100, height: 80, widthType: 0, heightType: 0, children: [], fillEnabled: true, fillType: 'image', fillImage: { type: 'variableReference', providerId: 'image-master', id: 'photo' } }] }] };
    const graph = buildSourceGraph({ ...capture, rootIds: [data.id], definitions: [{ id: data.id, kind: data.__class, data }] });
    const identity = allocateTargetIdentity(graph, new Set()), prop = nativePropName(identity, data.id, 'photo');
    const result = emitNativeComponents(graph, identity, { assets: { [asset]: '/assets/photo.jpg' } });
    expect(result.diagnostics).toEqual([]);
    const file = result.files[0];
    expect(parseJSXToNodes(file.code).get(identity['image-child'])?.styles.backgroundImage).toBe('url(/assets/photo.jpg)');
    expect(parseJSXToNodes(file.code).get(identity['image-child'])?.styleVariables?.backgroundImage).toBe(prop);
    expect(parseJSXToNodes(file.code, { [prop]: 'url(/assets/other.jpg)' }).get(identity['image-child'])?.styles.backgroundImage).toBe('url(/assets/other.jpg)');
    expect(checkFile(file.code, { kind: 'component', path: file.path })).toEqual([]);
  });
  it('keeps a source boolean visibility prop live and editable instead of baking its preview', () => {
    const data = { id: 'visibility-master', __class: 'SmartComponentNode', baseVariantId: 'visible-base', variables: [{ id: 'shown', name: 'Shown', type: 'boolean', initialValue: false }], children: [{ id: 'visible-base', __class: 'FrameNode', children: [{ id: 'visible-child', parentid: 'visible-base', __class: 'FrameNode', layout: 'stack', children: [], visible: { type: 'variableReference', providerId: 'visibility-master', id: 'shown' } }] }] };
    const graph = buildSourceGraph({ ...capture, rootIds: [data.id], definitions: [{ id: data.id, kind: data.__class, data }] });
    const identity = allocateTargetIdentity(graph, new Set()), prop = nativePropName(identity, data.id, 'shown');
    const result = emitNativeComponents(graph, identity);
    expect(result.diagnostics).toEqual([]);
    const file = result.files[0];
    expect(parseJSXToNodes(file.code).get(identity['visible-child'])?.styles.display).toBe('none');
    expect(parseJSXToNodes(file.code, { [prop]: 'true' }).get(identity['visible-child'])?.styles.display).toBe('flex');
    expect(parseJSXToNodes(file.code).get(identity['visible-child'])?.styleVariables?.display).toBe(prop);
    expect(checkFile(file.code, { kind: 'component', path: file.path })).toEqual([]);
  });
  it('remaps a source reference prop default and retains its collection in native metadata', () => {
    const sourceCollection = buildSourceGraph(capturedCms).nodes.get('DwP_tmnNO')!;
    const variable = { id: 'category', name: 'Category', type: 'collectionreference', dataIdentifier: 'local-module:collection/DwP_tmnNO:default', initialValue: sourceCollection.children[0] };
    const query = { id: 'category-query', __class: 'FrameNode', parentid: 'reference-base', dataIdentifier: variable.dataIdentifier, collectionFilters: { filters: [{ itemKey: 'id', transforms: [{ name: 'equals', value: { type: 'variableReference', providerId: 'reference-master', id: variable.id } }] }] }, children: [{ id: 'category-title', __class: 'RichTextNode', parentid: 'category-query', children: [], html: '<p>Category</p>', textContent: { type: 'variableReference', providerId: 'category-query', id: 'nTU4ZCwmq' } }] };
    const data = { id: 'reference-master', __class: 'SmartComponentNode', name: 'Reference Card', baseVariantId: 'reference-base', variables: [variable], children: [{ id: 'reference-base', __class: 'FrameNode', children: [query], width: 100, widthType: 0, heightType: 2, visible: true }] };
    const graph = buildSourceGraph({ ...capturedCms, rootIds: [data.id], definitions: [...capturedCms.definitions, { id: data.id, kind: data.__class, data }] });
    const identity = allocateTargetIdentity(graph, new Set());
    const result = emitNativeComponents(graph, identity);
    expect(result.diagnostics).toEqual([]);
    const file = result.files[0];
    const prop = nativePropName(identity, data.id, variable.id);
    expect(parsePropMeta(file.code)[prop]).toMatchObject({ type: 'reference', label: 'Category', referenceCollection: identity.DwP_tmnNO.replace(/-/g, '') });
    expect(parseComponentInfoFromSource(file.path, file.code, '')?.props.find(item => item.name === prop)).toMatchObject({ defaultValue: identity[variable.initialValue], varType: 'reference', referenceCollection: identity.DwP_tmnNO.replace(/-/g, '') });
    const nodes = parseJSXToNodes(file.code);
    expect(nodes.get(identity['category-query'])?.collectionList?.filterGroup?.filters[0]).toMatchObject({ field: '_id', valueSource: 'variable', valueVar: prop, value: identity[variable.initialValue] });
    expect(nodes.get(identity['category-title'])?.binding?.field).toBe(identity['["DwP_tmnNO","nTU4ZCwmq"]']);
    expect(checkFile(file.code, { kind: 'component', path: file.path })).toEqual([]);
  });
  it('retains an active original override on a native master and blocks a missing adapter', () => {
    const input = JSON.parse(JSON.stringify(capture));
    input.rootIds = ['f03DgVEM5'];
    const scope = input.definitions.find((item: { id: string }) => item.id === input.rootIds[0])!.data;
    Object.assign(scope.children[0].children[0], capturedOverride.definitions[0].data, { id: scope.children[0].children[0].id, __class: 'RichTextNode', children: [] });
    const transfer = { ...input, codeFiles: capturedOverride.codeFiles, definitions: [...input.definitions, capturedOverride.definitions[1]] };
    const graph = buildSourceGraph(transfer), identity = allocateTargetIdentity(graph, new Set());
    expect(emitNativeComponents(graph, identity).diagnostics.length).toBeGreaterThan(0);
    const adapted = emitNativeCodeOverrides(graph, identity);
    expect(adapted.diagnostics).toEqual([]);
    const result = emitNativeComponents(graph, identity, { overrides: adapted.overrides });
    expect(result.diagnostics).toEqual([]);
    const files = [...result.files, ...adapted.files];
    expect(readCodeOverrides(result.files[0].code, identity[scope.children[0].children[0].id])).toEqual(Object.values(adapted.overrides));
    expect(checkFile(result.files[0].code, { kind: 'component', path: result.files[0].path, projectFiles: new Set(files.map(file => file.path)) })).toEqual([]);
  });
  it('emits the real six-state component with five props and all eight connections', () => {
    const graph = buildSourceGraph({ ...capture, rootIds: ['f03DgVEM5'] });
    const identity = allocateTargetIdentity(graph, new Set());
    const result = emitNativeComponents(graph, identity);
    expect(result.diagnostics).toEqual([]);
    expect(result.files).toHaveLength(1);
    expect(result.createdIds).toEqual([identity.q7dmakjiW]);
    const file = result.files[0];
    expect(parseVariantConfig(file.code).map(state => state.label)).toEqual(['Regular', 'Regular - Line in', 'Regular - Reset', 'Large', 'Large - Line in', 'Large - Reset']);
    expect(parseConnections(file.code)).toHaveLength(8);
    expect(Object.values(parsePropMeta(file.code)).map(prop => prop.label)).toEqual(['Label', 'Color', 'Link', 'New Tab', 'Click']);
    expect(Object.values(parsePropMeta(file.code)).map(prop => prop.type)).toEqual(['plainText', 'color', 'link', 'toggle', 'event']);
    expect(file.code).toContain('[0.62,0.2,0.13,0.93]');
    expect(file.code).not.toContain('local-module:');
    expect(checkFile(file.code, { kind: 'component', path: file.path, projectFiles: new Set(result.files.map(f => f.path)) })).toEqual([]);
    const nodes = parseJSXToNodes(file.code);
    expect(nodes.has(identity.uLUi_cY4A)).toBe(true);
    const edited = updateVariantStyleInCode(file.code, identity.TACvjFc6M, 'default', { width: '4px' });
    expect(checkFile(edited, { kind: 'component', path: file.path })).toEqual([]);
    expect(parseConnections(edited)).toHaveLength(8);
  });
  it('keeps nested components as imported instances and preserves a native content slot', () => {
    const frame = (id: string, children: unknown[] = [], extra = {}) => ({ __class: 'FrameNode', id, children, width: id.endsWith('-base') ? 200 : 100, widthType: 0, heightType: 2, visible: true, ...extra });
    const child = { __class: 'SmartComponentNode', id: 'child', name: 'Кнопка', baseVariantId: 'child-base', variables: [], children: [frame('child-base', [frame('slot', [], { __class: 'SlotNode' })])] };
    const parent = { __class: 'SmartComponentNode', id: 'parent', name: 'Кнопка', baseVariantId: 'parent-base', variables: [], children: [frame('parent-base', [frame('instance', [], { __class: 'CodeComponentNode', codeComponentIdentifier: 'local-module:canvasComponent/child:default' }), frame('instance-two', [], { __class: 'CodeComponentNode', codeComponentIdentifier: 'local-module:canvasComponent/child:default' }), frame('label', [], { __class: 'RichTextNode', html: '<p>Literal {draft}</p>' })])] };
    const graph = buildSourceGraph({ ...capture, rootIds: ['parent'], definitions: [parent, child].map(data => ({ id: data.id, kind: data.__class, data })) });
    const identity = allocateTargetIdentity(graph, new Set());
    const result = emitNativeComponents(graph, identity);
    expect(result.diagnostics).toEqual([]);
    expect(result.files).toHaveLength(2);
    const parentFile = result.files.find(file => file.code.includes(`data-id="${identity.instance}"`))!;
    expect(parentFile.code).toMatch(/import \w+ from ["']@\/components\//);
    expect(result.files.some(file => file.code.includes('{children}'))).toBe(true);
    for (const file of result.files) expect(checkFile(file.code, { kind: 'component', path: file.path, projectFiles: new Set(result.files.map(f => f.path)) })).toEqual([]);
    expect(parseJSXToNodes(updateNodeTextInCode(parentFile.code, identity.label, 'Changed')).get(identity.label)?.textContent).toBe('Changed');
  });
  it('keeps unknown actions explicit and never reports a dropped component as successful', () => {
    const copy = JSON.parse(JSON.stringify(capture));
    copy.rootIds = ['f03DgVEM5'];
    copy.definitions.find((d: { id: string }) => d.id === 'f03DgVEM5').data.children[0].onTap = [{ actionIdentifier: 'framer/unknown' }];
    const graph = buildSourceGraph(copy);
    const result = emitNativeComponents(graph, allocateTargetIdentity(graph, new Set()));
    expect(result.files).toEqual([]);
    expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ sourceId: 'f03DgVEM5', code: 'SOURCE_COMPONENT_UNSUPPORTED' })]));
  });
  it('preserves authored opacity when creating per-state transition entries', () => {
    const copy = JSON.parse(JSON.stringify(capture));
    copy.rootIds = ['f03DgVEM5'];
    const scope = copy.definitions.find((d: { id: string }) => d.id === 'f03DgVEM5').data;
    scope.children[1].replicaInfo.overrides.q7dmakjiW.opacity = 0.2;
    const graph = buildSourceGraph(copy), identity = allocateTargetIdentity(graph, new Set());
    const result = emitNativeComponents(graph, identity);
    const names = sourceStateNames({ graph, scopeId: scope.id }, identity);
    expect(parseJSXToNodes(result.files[0].code).get(identity.q7dmakjiW)?.motionVariants?.[names.yre4NRiTU]?.opacity).toBe('0.2');
  });
  it('preserves a literal text override while keeping the primary text variable bound', () => {
    const copy = JSON.parse(JSON.stringify(capture));
    copy.rootIds = ['f03DgVEM5'];
    const scope = copy.definitions.find((d: { id: string }) => d.id === 'f03DgVEM5').data;
    scope.children[3].replicaInfo.overrides.uLUi_cY4A = { _deleted: ['textContent'], html: '<p dir="auto" data-styles-preset="NdIUbIEjR">Large &amp; {draft}</p>' };
    const graph = buildSourceGraph(copy), identity = allocateTargetIdentity(graph, new Set());
    const result = emitNativeComponents(graph, identity);
    expect(result.diagnostics).toEqual([]);
    const names = sourceStateNames({ graph, scopeId: scope.id }, identity);
    const text = parseJSXToNodes(result.files[0].code).get(identity.uLUi_cY4A)!;
    expect(text.conditionalText?.[names.MUB6b9cRc]).toBe('Large & {draft}');
    expect(text.conditionalTextVariable?.default).toBe(nativePropName(identity, scope.id, 'gerVZF2pu'));
  });
  it('never emits a master from an incomplete source capture', () => {
    const graph = buildSourceGraph({ ...capture, rootIds: ['f03DgVEM5'], complete: false });
    const result = emitNativeComponents(graph, allocateTargetIdentity(graph, new Set()));
    expect(result.files).toEqual([]);
    expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'SOURCE_CAPTURE_INCOMPLETE' })]));
  });
  it('does not silently drop per-state nested instance controls', () => {
    const frame = (id: string, children: unknown[] = [], extra = {}) => ({ id, __class: 'FrameNode', width: 200, widthType: 0, heightType: 2, children, ...extra });
    const child = { id: 'child', __class: 'SmartComponentNode', baseVariantId: 'child-base', variables: [{ id: 'label', type: 'string', initialValue: 'Default' }], children: [frame('child-base')] };
    const instance = frame('instance', [], { __class: 'CodeComponentNode', codeComponentIdentifier: 'local-module:canvasComponent/child:default', '$control__label': { type: 'string', value: 'Base' } });
    const parent = { id: 'parent', __class: 'SmartComponentNode', baseVariantId: 'parent-base', variables: [], children: [frame('parent-base', [instance]), frame('parent-other', [], { replicaInfo: { master: 'parent-base', overrides: { instance: { '$control__label': { type: 'string', value: 'Changed' } } } } })] };
    const graph = buildSourceGraph({ ...capture, rootIds: ['parent'], definitions: [parent, child].map(data => ({ id: data.id, kind: data.__class, data })) });
    const result = emitNativeComponents(graph, allocateTargetIdentity(graph, new Set()));
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ sourceId: 'parent', message: expect.stringMatching(/per-state instance control/i) }));
  });
  it('normalizes a field map through the same identity rules as an array', () => {
    const copy = JSON.parse(JSON.stringify(capture)); copy.rootIds = ['f03DgVEM5'];
    const scope = copy.definitions.find((d: { id: string }) => d.id === 'f03DgVEM5').data;
    scope.variables = Object.fromEntries(scope.variables.map(({ id, ...variable }: { id: string }) => [id, variable]));
    const graph = buildSourceGraph(copy), identity = allocateTargetIdentity(graph, new Set());
    const result = emitNativeComponents(graph, identity);
    expect(result.diagnostics).toEqual([]);
    expect(Object.values(parsePropMeta(result.files[0].code)).map(prop => prop.label)).toEqual(['Label', 'Color', 'Link', 'New Tab', 'Click']);
  });
});
