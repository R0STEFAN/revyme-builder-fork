import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDefaultStore } from 'jotai';
import { parse } from '@babel/parser';
import generate from '@babel/generator';
import * as t from '@babel/types';
import { projectFS, projectVersionAtom, resetProjectFS } from './project-fs';
import { assignTemplate, createTemplate, renameTemplate } from './template-ops';
import {
  activeFilePathAtom,
  activeCodeAtom,
  movePageFile,
  getLayoutForPage,
  getVariantBasePage,
} from './active-file-store';
import { seedNodesForCode } from '../stores/store';
import { checkFile } from '../oracle/check-file';
import {
  getTemplateRouteValues,
  parseTemplateRouteMap,
  setTemplateRouteValueInCode,
} from '../generation/template-route-gen';
import { renderNodes } from '../../canvas/Renderer';
import { setStyleContext } from '../../canvas/node-ops';
import { modifyProjectFile } from './modify-file';
import { setPageEffectForPage, getEffectsForPage } from './page-effects-ops';
import { buildSourceExport } from './source-export';

vi.mock('@/shared/debug-trace', () => ({
  trace: { action: vi.fn(), fn: vi.fn(), dom: vi.fn(), error: vi.fn() },
  pauseDOMObserver: vi.fn(),
  resumeDOMObserver: vi.fn(),
}));

const PAGE = `export default function Page(){return <div data-id="root" style={{display:'flex',flexDirection:'column',width:'100%'}}><section data-id="one" style={{position:'relative',order:'0',width:'100%',height:'auto',flex:'0 0 auto'}} /></div>;}`;
const LAYOUT = `export default function LayoutClient({ children, color = '#112233' }) { return <div data-id="root" style={{display:'flex',flexDirection:'column',width:'100%'}}><header data-id="header" style={{position:'relative',flex:'0 0 auto',order:'0',color:color}}>Header</header>{children}<footer data-id="footer" style={{position:'relative',flex:'0 0 auto',order:'1'}}>Footer</footer></div>; }`;
const RUNTIME = `export default function LayoutClient({ children, color = 'base', enabled = true, count = 2 }) {
  return <div data-id="root" style={{color}}>{children}</div>;
}`;
const VARS = ['color', 'enabled', 'count'];

function evalRuntime(code: string, route: string, width = 1440) {
  const ast = parse(code, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
  const declarations = ast.program.body.filter(
    (n) =>
      t.isVariableDeclaration(n) &&
      n.declarations.some(
        (d) => t.isIdentifier(d.id) && ['__templateProps', '__matchTemplateRoute'].includes(d.id.name),
      ),
  );
  const fn = ast.program.body.find((n) => t.isExportDefaultDeclaration(n)) as t.ExportDefaultDeclaration;
  const component = fn.declaration as t.FunctionDeclaration;
  const returned = component.body.body.find((n) => t.isReturnStatement(n)) as t.ReturnStatement;
  returned.argument = (
    parse('({color, enabled, count, displayed: enabled ? "on" : "off", plusOne: count + 1})').program.body[0] as t.ExpressionStatement
  ).expression;
  const js = declarations.map((n) => generate(n).code).join('\n') + '\n' + generate(fn.declaration).code;
  return new Function(
    'usePathname',
    'useMediaQuery',
    js + '; return LayoutClient({});',
  )(() => route, (query: string) => width <= Number(query.match(/\d+/)![0]));
}

function setLayout(code: string, path = 'app/(audit)/page.client.tsx') {
  projectFS.writeFile(path, PAGE);
  projectFS.writeFile('app/(audit)/layout.tsx', `export {default} from './LayoutClient';`);
  projectFS.writeFile('app/(audit)/LayoutClient.tsx', code);
  const store = getDefaultStore();
  store.set(activeFilePathAtom, path);
  store.set(projectVersionAtom, (v) => v + 1);
  return seedNodesForCode(PAGE);
}

beforeEach(() => {
  resetProjectFS();
  getDefaultStore().set(projectVersionAtom, (v) => v + 1);
});

describe('Template Audit Regression Suite — T01 through T12', () => {
  it('T01: rename rejects overwrite of organisational group pages and preserves content', () => {
    createTemplate('old');
    projectFS.writeFile('app/(old)/x/page.client.tsx', 'SOURCE_CONTENT');
    projectFS.writeFile('app/(archive)/x/page.client.tsx', 'DESTINATION_CONTENT');

    expect(renameTemplate('old', 'archive')).toBe(false);
    expect(projectFS.readFile('app/(archive)/x/page.client.tsx')).toBe('DESTINATION_CONTENT');
    expect(projectFS.readFile('app/(old)/x/page.client.tsx')).toBe('SOURCE_CONTENT');
  });

  it('T02: assign preflights server half and refuses to overwrite existing destination', () => {
    createTemplate('audit');
    projectFS.writeFile('app/check/page.client.tsx', PAGE);
    projectFS.writeFile('app/check/page.tsx', 'SOURCE_METADATA');
    projectFS.writeFile('app/(audit)/check/page.tsx', 'DESTINATION_METADATA');

    expect(assignTemplate('app/check/page.client.tsx', 'audit')).toBe('app/check/page.client.tsx');
    expect(projectFS.readFile('app/(audit)/check/page.tsx')).toBe('DESTINATION_METADATA');
    expect(projectFS.readFile('app/check/page.tsx')).toBe('SOURCE_METADATA');
  });

  it('T03: rename maintains active file, comments, A/B manifests and regenerates locale imports', () => {
    projectFS.writeFile(
      'i18n/config.json',
      JSON.stringify({
        defaultLocale: 'en',
        locales: [
          { code: 'en', label: 'English' },
          { code: 'fr', label: 'Français' },
        ],
      }),
    );
    createTemplate('old');
    assignTemplate('app/page.client.tsx', 'old');
    const oldClient = 'app/(old)/page.client.tsx';
    const newClient = 'app/(new)/page.client.tsx';
    getDefaultStore().set(activeFilePathAtom, oldClient);
    projectFS.writeFile('_meta/comments.json', JSON.stringify([{ id: 'c', x: 0, y: 0, filePath: oldClient }]));
    projectFS.writeFile(
      '_revyme/variants/ab/test.json',
      JSON.stringify({ pagePath: oldClient, variants: [{ id: 'v', template: 'old' }] }),
    );
    expect(projectFS.readFile('app/(old)/fr/page.tsx')).toContain('@/app/(old)/page');

    expect(renameTemplate('old', 'new')).toBe(true);
    getDefaultStore().set(projectVersionAtom, (v) => v + 1);

    expect(getDefaultStore().get(activeFilePathAtom)).toBe(newClient);
    expect(getDefaultStore().get(activeCodeAtom)).not.toBe('');
    expect(projectFS.readFile('_meta/comments.json')).toContain(newClient);
    expect(projectFS.readFile('_meta/comments.json')).not.toContain(oldClient);
    expect(getVariantBasePage('_revyme/variants/ab/v.tsx')).toBe(newClient);
    expect(projectFS.readFile('app/(new)/fr/page.tsx')).toContain('@/app/(new)/page');
  });

  it.each([
    ['compact signature', LAYOUT.replace('{ children, color', '{children, color').replace(", color = '#112233'", '').replace('color:color', "color:'#112233'")],
    ['whitespace slot', LAYOUT.replace('{children}', '{ children }')],
    ['comment before slot', '// slot is {children}\n' + LAYOUT],
  ])('T07: slot detection succeeds for %s and oracle accepts the slot', (_, code) => {
    if (code.includes('{children }')) code = code.replace('{children }', '{children}');
    const violations = checkFile(code, { kind: 'template', path: 'app/(audit)/LayoutClient.tsx' });
    expect(violations.filter((v) => v.code.startsWith('TEMPLATE_CHILDREN_'))).toEqual([]);
    const nodes = setLayout(code);
    expect(nodes.has('layout::header')).toBe(true);
  });

  it('T07: normal formatting merges the template correctly', () => {
    expect(setLayout(LAYOUT).has('layout::header')).toBe(true);
  });

  it('T04: boolean false is emitted as a typed boolean literal', () => {
    const code = setTemplateRouteValueInCode(RUNTIME, '/', 'enabled', 'false', VARS);
    const value = evalRuntime(code, '/');
    expect(value.enabled).toBe(false);
    expect(value.displayed).toBe('off');
  });

  it('T04: numeric override preserves arithmetic addition', () => {
    const code = setTemplateRouteValueInCode(RUNTIME, '/', 'count', '3', VARS);
    const value = evalRuntime(code, '/');
    expect(value.count).toBe(3);
    expect(value.plusOne).toBe(4);
  });

  it('T05: first responsive write does not throw temporal-dead-zone error', () => {
    const code = setTemplateRouteValueInCode(RUNTIME, '/a', 'color@768', 'tablet-a', VARS);
    expect(() => evalRuntime(code, '/a', 375)).not.toThrow();
    expect(evalRuntime(code, '/a', 375).color).toBe('tablet-a');
  });

  it('T05: modifyProjectFile persists responsive code that runs cleanly', () => {
    projectFS.writeFile('app/(audit)/LayoutClient.tsx', RUNTIME);
    const code = modifyProjectFile('app/(audit)/LayoutClient.tsx', (c) =>
      setTemplateRouteValueInCode(c, '/a', 'color@768', 'tablet-a', VARS),
    )!;
    expect(code).toBeTruthy();
    expect(() => evalRuntime(code, '/a', 375)).not.toThrow();
    expect(evalRuntime(code, '/a', 375).color).toBe('tablet-a');
  });

  it('T11: mobile override on page B preserves tablet inheritance on page A', () => {
    let code = setTemplateRouteValueInCode(RUNTIME, '/a', 'color@768', 'tablet-a', VARS);
    expect(evalRuntime(code, '/a', 375).color).toBe('tablet-a');
    code = setTemplateRouteValueInCode(code, '/b', 'color@375', 'mobile-b', VARS);
    expect(evalRuntime(code, '/a', 375).color).toBe('tablet-a');
    expect(evalRuntime(code, '/b', 375).color).toBe('mobile-b');
  });

  it('T06: per-page replica variable reaches rendered template header', () => {
    let code = setTemplateRouteValueInCode(LAYOUT, '/', 'color', '#445566', ['color']);
    code = setTemplateRouteValueInCode(code, '/', 'color@768', '#abcdef', ['color']);
    const nodes = setLayout(code);
    expect(nodes.get('layout::header')?.styles.color).toBe('#445566');
    (globalThis as any).CSS ??= {};
    (globalThis as any).CSS.escape ??= (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
    setStyleContext('app/(audit)/page.client.tsx', 'desktop', 1440);
    const host = document.createElement('div');
    document.body.appendChild(host);
    try {
      renderNodes(
        host,
        nodes,
        null,
        () => {},
        [
          { id: 'desktop', width: 1440, x: 0, y: 0, isPrimary: true },
          { id: 'tablet', width: 768, x: 1600, y: 0 },
        ] as any,
        PAGE,
      );
      const header = host.querySelector('[data-node-id="tablet-layout::header"]') as HTMLElement;
      expect(header).toBeTruthy();
      expect(header.style.color).toBe('rgb(171, 205, 239)');
    } finally {
      host.remove();
    }
  });

  it('T08: route-map parser handles valid text value containing };', () => {
    const code = setTemplateRouteValueInCode(RUNTIME, '/', 'color', 'text }; example', VARS);
    expect(() => parse(code, { sourceType: 'module', plugins: ['jsx', 'typescript'] })).not.toThrow();
    expect(parseTemplateRouteMap(code)).toEqual({
      '/': { color: 'text }; example' },
    });
    const valid = `const __templateProps = {"/":{"color":"text }; example"}};\n` + RUNTIME;
    expect(() => parse(valid, { sourceType: 'module', plugins: ['jsx', 'typescript'] })).not.toThrow();
    expect(parseTemplateRouteMap(valid)).toEqual({
      '/': { color: 'text }; example' },
    });
  });

  it('T10: supported catch-all page matches deep routes at runtime', async () => {
    const code = setTemplateRouteValueInCode(RUNTIME, '/docs/[...slug]', 'color', 'docs', VARS);
    const { buildRouteTable, resolveRoute } = await import('../../preview-sandbox/router');
    const routes = buildRouteTable(new Map([['app/(audit)/docs/[...slug]/page.client.tsx', PAGE]]));
    expect(resolveRoute(routes, '/docs/a/b')).not.toBeNull();
    expect(evalRuntime(code, '/docs/a').color).toBe('docs');
    expect(evalRuntime(code, '/docs/a/b').color).toBe('docs');
  });

  it('T09: moving a page to another slug migrates its template overrides', () => {
    createTemplate('audit');
    projectFS.writeFile('app/(audit)/before/page.client.tsx', PAGE);
    projectFS.writeFile('app/(audit)/before/page.tsx', 'export {default} from "./page.client";');
    const layout = setTemplateRouteValueInCode(LAYOUT, '/before', 'color', '#abcdef', ['color']);
    projectFS.writeFile('app/(audit)/LayoutClient.tsx', layout);

    expect(movePageFile('app/(audit)/before/page.client.tsx', 'app/(audit)/after/page.client.tsx')).toBe(true);
    const next = projectFS.readFile('app/(audit)/LayoutClient.tsx')!;
    expect(getTemplateRouteValues(next, '/before')).toEqual({});
    expect(getTemplateRouteValues(next, '/after')).toEqual({ color: '#abcdef' });
  });

  it('T07: template editor detects slot for compact signature', () => {
    const code = LAYOUT.replace("{ children, color = '#112233' }", '{children}').replace('color:color', "color:'#112233'");
    setLayout(code);
    const store = getDefaultStore();
    store.set(activeFilePathAtom, 'app/(audit)/LayoutClient.tsx');
    store.set(projectVersionAtom, (v) => v + 1);
    expect(seedNodesForCode(code).has('children-slot')).toBe(true);
  });

  it('T07: page effect injects PageTransitions on compact signature', () => {
    const code = LAYOUT.replace("{ children, color = '#112233' }", '{children}').replace('color:color', "color:'#112233'");
    setLayout(code);
    expect(setPageEffectForPage('app/(audit)/page.client.tsx', { preset: 'crossfade', target: 'all' })).toBe(true);
    expect(projectFS.readFile('app/(audit)/LayoutClient.tsx')).toContain('PageTransitions');
    expect(getEffectsForPage('app/(audit)/page.client.tsx')).toHaveLength(1);
  });

  it('T04: canvas model and generated runtime agree on boolean values', () => {
    const layout = LAYOUT.replace("color = '#112233'", 'enabled = true').replace('color:color', "display:enabled ? 'block' : 'none'");
    const code = setTemplateRouteValueInCode(layout, '/', 'enabled', 'false', ['enabled']);
    expect(setLayout(code).get('layout::header')?.styles.display).toBe('none');
    expect(evalRuntime(setTemplateRouteValueInCode(RUNTIME, '/', 'enabled', 'false', VARS), '/').displayed).toBe('off');
  });

  it('T10: localized routes inherit template override from canonical route', async () => {
    projectFS.writeFile(
      'i18n/config.json',
      JSON.stringify({
        defaultLocale: 'en',
        locales: [
          { code: 'en', label: 'English' },
          { code: 'fr', label: 'Français' },
        ],
      }),
    );
    createTemplate('audit');
    projectFS.writeFile('app/about/page.client.tsx', PAGE);
    projectFS.writeFile('app/about/page.tsx', 'export {default} from "./page.client";');
    assignTemplate('app/about/page.client.tsx', 'audit');
    const { buildRouteTable, resolveRoute } = await import('../../preview-sandbox/router');
    expect(resolveRoute(buildRouteTable(projectFS.getSnapshot()), '/fr/about')).not.toBeNull();

    const code = setTemplateRouteValueInCode(RUNTIME, '/about', 'color', 'custom-about', VARS);
    expect(evalRuntime(code, '/about').color).toBe('custom-about');
    expect(evalRuntime(code, '/fr/about').color).toBe('custom-about');
  });

  it('T08: modifyProjectFile persists text containing }; without corruption', () => {
    const path = 'app/(audit)/LayoutClient.tsx';
    projectFS.writeFile(path, RUNTIME);
    const result = modifyProjectFile(path, (c) => setTemplateRouteValueInCode(c, '/', 'color', 'text }; example', VARS));
    expect(result).toBeTruthy();
    expect(parseTemplateRouteMap(projectFS.readFile(path)!)).toEqual({
      '/': { color: 'text }; example' },
    });
  });

  it('T05: source export produces executable responsive template code', async () => {
    const code = setTemplateRouteValueInCode(RUNTIME, '/a', 'color@768', 'tablet-a', VARS);
    const exported = await buildSourceExport({ 'app/(audit)/LayoutClient.tsx': code }, { name: 'audit', runtimeRange: '^0.0.28' });
    expect(() => evalRuntime(exported.files['app/(audit)/LayoutClient.tsx'], '/a', 375)).not.toThrow();
    expect(evalRuntime(exported.files['app/(audit)/LayoutClient.tsx'], '/a', 375).color).toBe('tablet-a');
  });

  it('T12: oracle does not treat organisational route group as templated without LayoutClient', () => {
    const path = 'app/(archive)/page.client.tsx';
    projectFS.writeFile(path, PAGE);
    expect(getLayoutForPage(path)).toBe('app/layout.tsx');
    const code = PAGE.replace("width:'100%'", "width:'100%',backgroundColor:'#000000'");
    expect(checkFile(code, { kind: 'page', path }).some((v) => v.code === 'TEMPLATED_PAGE_ROOT_STYLED')).toBe(false);
  });
});
