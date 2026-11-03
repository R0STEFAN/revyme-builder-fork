import { expect, it } from 'vitest';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import * as motionRuntime from 'framer-motion';
import { withResponsiveProps } from '@revyme/runtime';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react';
import ts from 'typescript';
import { compileNativeTransfer } from './compile';
import { parseJSXToNodes } from '../../parsing/parser';
import { parseOverlayCalls, parseOverlayTriggerCalls } from '../../parsing/overlay-parser';
import { parseCloseOverlayForNode } from '../../generation/close-overlay-gen';
import { nativePropName } from './components';
import { checkFile } from '../../oracle/check-file';
import type { NativeTransfer } from './types';

function input(): NativeTransfer {
  const overlay = { id: 'menu', __class: 'OverlayNode', parentid: 'button', visible: true, backdropDismissible: true, backdropFillEnabled: false, backdropFill: 'black', blockDocumentScrolling: true, zIndex: 7, backdropTransitionLocked: false, backdropEnterTransition: { type: 'tween', duration: 1, delay: 0, ease: [0.6, 0.2, 0, 1] }, backdropExitTransition: { type: 'tween', duration: 1.4, delay: 0, ease: [0.6, 0.2, 0, 1] }, children: [{ id: 'menu-text', __class: 'RichTextNode', parentid: 'menu', html: '<p>Close menu</p>', children: [], onTap: [{ actionIdentifier: 'framer/useDismissOverlay', controls: {} }] }] };
  const button = { id: 'button', __class: 'FrameNode', parentid: 'desktop', width: 120, widthType: 0, height: 40, heightType: 0, onTap: [{ actionIdentifier: 'framer/useShowOverlay', controls: { overlay: { type: 'string', value: 'menu' } } }], children: [overlay] };
  const desktop = { id: 'desktop', __class: 'FrameNode', parentid: 'home', width: 1200, widthType: 0, heightType: 2, children: [button] };
  const page = { id: 'home', __class: 'WebPageNode', parentid: 'document', baseVariantId: 'desktop', children: [desktop] };
  const root = { id: 'document', __class: 'RootNode', homePageNodeId: 'home', children: [] };
  return { format: 'revyme.framer.native', version: 1, context: { projectId: 'overlay-fixture', branchId: 'main', revision: '1', editorBuild: 'fixture', scopeId: 'home', mode: 'page' }, complete: true, diagnostics: [], rootIds: ['home'], definitions: [page, root].map(data => ({ id: data.id, kind: data.__class, data })), assets: [] };
}
function nodes(source: NativeTransfer) {
  const desktop = (source.definitions[0].data.children as any[])[0], button = desktop.children[0];
  return { desktop, button, overlay: button.children[0] };
}
const compile = (source: NativeTransfer) => compileNativeTransfer(source, { mode: 'create', existingFiles: new Map() });

it('imports a fixed overlay with native click, dismiss, scroll lock and separate transitions', () => {
  const result = compile(input());
  expect(result.diagnostics).toEqual([]);
  const code = result.files.find(file => file.path.endsWith('page.client.tsx'))!.code;
  expect(parseOverlayCalls(code)).toMatchObject([{ overlayId: result.identity.menu, config: { type: 'fixed', triggerId: result.identity.button, fill: 'rgba(0, 0, 0, 0)', dismissible: true, pageScroll: 'block', zIndex: 7, easingLinked: false, enterTransition: { type: 'tween', duration: '1', ease: '[0.6,0.2,0,1]' }, exitTransition: { type: 'tween', duration: '1.4' } } }]);
  expect(parseOverlayTriggerCalls(code)).toMatchObject([{ triggerId: result.identity.button, config: { targetId: result.identity.menu, trigger: 'click' } }]);
  expect(parseCloseOverlayForNode(code, result.identity['menu-text'])).toMatchObject([{ trigger: 'click', overlayId: result.identity.menu, delay: 0 }]);
  const tree = parseJSXToNodes(code);
  expect(tree.get(result.identity['menu-text'])?.textContent).toBe('Close menu');
  expect(tree.get(result.identity.menu)?.parentId).not.toBe(result.identity.button);
});

it('binds a design component event and its native on-open variant instead of passing source action arrays', async () => {
  const source = input(), { button } = nodes(source);
  Object.assign(button, { __class: 'CodeComponentNode', codeComponentIdentifier: 'local-module:canvasComponent/navigation:default', $control__open: { type: 'eventhandler', value: button.onTap }, $control__deletedEvent: { type: 'eventhandler', value: [{ actionIdentifier: 'framer/useShowOverlay', controls: { overlay: { type: 'string', value: 'deleted-overlay' } } }] }, whileOpenEffectEnabled: true, whileOpenEffectVariant: 'expanded' });
  delete button.onTap;
  const master = { id: 'navigation', __class: 'SmartComponentNode', baseVariantId: 'closed', variables: [{ id: 'open', type: 'eventhandler', name: 'Open menu' }], children: [{ id: 'closed', __class: 'FrameNode', width: 120, height: 40, children: [], onTap: [{ actionIdentifier: 'framer/useTriggerEvent', controls: { id: { type: 'string', value: 'open' } } }] }, { id: 'expanded', __class: 'FrameNode', children: [], replicaInfo: { master: 'closed', overrides: { closed: { fillEnabled: true, fillType: 'color', fillColor: 'red' } } } }] };
  source.definitions.push({ id: master.id, kind: master.__class, data: master });
  const result = compile(source);
  expect(result.diagnostics).toEqual([]);
  const code = result.files.find(file => file.path.endsWith('page.client.tsx'))!.code;
  expect(parseOverlayTriggerCalls(code)[0]?.config).toMatchObject({ trigger: 'event', eventName: nativePropName(result.identity, 'navigation', 'open') });
  expect(parseOverlayCalls(code)[0]?.config.onOpenVariant).toBe(result.identity.expanded);
  expect(code).not.toContain('framer/useShowOverlay');
  expect(code).not.toContain('deleted-overlay');
  expect(code).toMatch(/initialVariant=\{[^}]*Open\s*\?/);
  (source.definitions[0].data.children as any[]).push({ id: 'phone', __class: 'FrameNode', parentid: 'home', children: [], replicaInfo: { master: 'desktop', overrides: { desktop: { width: 390 }, button: { whileOpenEffectVariant: 'closed', $control__variant: { type: 'variant', value: 'expanded' } } } } });
  const responsive = compile(source);
  expect(responsive.diagnostics).toEqual([]);
  const responsiveCode = responsive.files.find(file => file.path.endsWith('page.client.tsx'))!.code;
  expect(parseOverlayCalls(responsiveCode)[0]?.config.responsive?.['1199']?.onOpenVariant).toBe('default');
  expect(JSON.parse(parseJSXToNodes(responsiveCode).get(responsive.identity.button)!.attrs['data-responsive'])['1199'].initialVariant).toBe(responsive.identity.expanded);
  expect(checkFile(responsiveCode.replace('window.innerWidth <= 1199', 'window.innerWidth <= 1198'), { kind: 'page' }).map(item => item.code)).toContain('RESPONSIVE_JS_HANDWRITTEN');
  const eventName = nativePropName(responsive.identity, 'navigation', 'open');
  const Probe = withResponsiveProps((props: any) => React.createElement('button', { onClick: props[eventName] }, props.initialVariant));
  const executable = ts.transpileModule(responsiveCode, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const exports: { default?: React.ComponentType } = {};
  new Function('exports', 'require', executable)(exports, (name: string) => {
    if (name === 'react') return React;
    if (name === 'react/jsx-runtime') return jsxRuntime;
    if (name === 'framer-motion') return motionRuntime;
    if (name.startsWith('@/components/')) return { __esModule: true, default: Probe };
    throw new Error(`Unexpected imported overlay dependency ${name}`);
  });
  const oldWidth = window.innerWidth;
  Object.defineProperty(window, 'innerWidth', { value: 700, configurable: true, writable: true });
  try {
    const view = render(React.createElement(exports.default!));
    expect(view.getByRole('button').textContent).toBe(responsive.identity.expanded);
    fireEvent.click(view.getByRole('button'));
    await waitFor(() => expect(view.getByRole('button').textContent).toBe('default'));
    fireEvent.click(view.getByRole('button'));
    await waitFor(() => expect(view.getByRole('button').textContent).toBe(responsive.identity.expanded));
  } finally { cleanup(); Object.defineProperty(window, 'innerWidth', { value: oldWidth, configurable: true, writable: true }); }
});

it('diagnoses missing overlay targets, conflicting triggers and unsupported responsive behavior', () => {
  const missing = input();
  nodes(missing).button.onTap[0].controls.overlay.value = 'missing';
  expect(compile(missing).diagnostics).toContainEqual(expect.objectContaining({ message: expect.stringMatching(/overlay.*missing/i) }));
  const responsive = input(), { desktop } = nodes(responsive);
  (responsive.definitions[0].data.children as any[]).push({ id: 'phone', __class: 'FrameNode', parentid: 'home', children: [], replicaInfo: { master: 'desktop', overrides: { desktop: { width: 390 }, menu: { backdropDismissible: false } } } });
  expect(compile(responsive).diagnostics).toContainEqual(expect.objectContaining({ message: expect.stringMatching(/responsive overlay/i) }));
  const conflict = input(), base = nodes(conflict);
  base.desktop.children.push({ id: 'second', __class: 'FrameNode', parentid: 'desktop', children: [], onTap: base.button.onTap });
  expect(compile(conflict).diagnostics).toContainEqual(expect.objectContaining({ message: expect.stringMatching(/multiple.*overlay|overlay.*multiple/i) }));
});

it('executes the converted click and close actions with the native overlay runtime', async () => {
  const source = input(), { overlay } = nodes(source);
  overlay.backdropEnterTransition = overlay.backdropExitTransition = { type: false };
  const result = compile(source);
  expect(result.diagnostics).toEqual([]);
  const code = result.files.find(file => file.path.endsWith('page.client.tsx'))!.code;
  const executable = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports: { default?: React.ComponentType } = {};
  new Function('exports', 'require', executable)(exports, (name: string) => {
    if (name === 'react') return React;
    if (name === 'react/jsx-runtime') return jsxRuntime;
    if (name === 'framer-motion') return motionRuntime;
    throw new Error(`Unexpected imported overlay dependency ${name}`);
  });
  try {
    const view = render(React.createElement(exports.default!));
    expect(view.queryByText('Close menu')).toBeNull();
    fireEvent.click(view.container.querySelector(`[data-id="${result.identity.button}"]`)!);
    expect(view.getByText('Close menu')).toBeTruthy();
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.click(view.getByText('Close menu'));
    await waitFor(() => expect(view.queryByText('Close menu')).toBeNull());
    expect(document.body.style.overflow).not.toBe('hidden');
  } finally { cleanup(); }
});

it('keeps template overlays in their native layout beside the content slot', () => {
  const source = input(), { desktop, button } = nodes(source);
  const template = { id: 'navigation', __class: 'LayoutTemplateNode', parentid: 'document', baseVariantId: 'template-desktop', children: [{ ...desktop, id: 'template-desktop', parentid: 'navigation', children: [button, { id: 'slot', __class: 'SlotNode', parentid: 'template-desktop', children: [] }] }] };
  button.parentid = 'template-desktop';
  desktop.children = [{ id: 'body', __class: 'RichTextNode', parentid: 'desktop', html: '<p>Page content</p>', children: [] }];
  source.definitions[1].data.layoutTemplateIdentifier = 'local-module:layoutTemplate/navigation:default';
  source.definitions.push({ id: template.id, kind: template.__class, data: template });
  const result = compile(source);
  expect(result.diagnostics).toEqual([]);
  const layout = result.files.find(file => file.path.endsWith('LayoutClient.tsx'))!.code;
  expect(parseOverlayCalls(layout)).toHaveLength(1);
  expect(layout).toContain('{children}');
  expect(result.files.find(file => file.path.endsWith('page.client.tsx'))!.code).not.toContain('data-overlay');
});
