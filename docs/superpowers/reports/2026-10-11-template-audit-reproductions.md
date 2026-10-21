# Діагностичні відтворення аудиту template

Ці 23 тести підтверджують **поточні дефекти**, тому PASS не означає правильну поведінку продукту. Під час реалізації потрібно замінити bug expectations на очікувану коректну поведінку та побачити RED до виправлення.

Для повторення відновити fenced source як `src/code/project/template-audit-investigation.test.ts` і виконати:

```bash
npx vitest run src/code/project/template-audit-investigation.test.ts --reporter=verbose
```

Тести записують тільки в InMemoryProjectFS тестового процесу; не в збережені `data/projects/` JSON. Media gates переставляються лише в in-memory diagnostic T11 для ізоляції T05. JSX return у evaluator замінений на локальний snapshot; це не production transform.

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDefaultStore } from 'jotai';
import { parse } from '@babel/parser';
import generate from '@babel/generator';
import * as t from '@babel/types';
import { projectFS, projectVersionAtom, resetProjectFS } from './project-fs';
import { assignTemplate, createTemplate, renameTemplate } from './template-ops';
import { activeFilePathAtom, activeCodeAtom, movePageFile, getLayoutForPage, getVariantBasePage } from './active-file-store';
import { seedNodesForCode } from '../stores/store';
import { checkFile } from '../oracle/check-file';
import { getTemplateRouteValues, parseTemplateRouteMap, setTemplateRouteValueInCode } from '../generation/template-route-gen';
import { renderNodes } from '../../canvas/Renderer';
import { setStyleContext } from '../../canvas/node-ops';
import { modifyProjectFile } from './modify-file';
import { setPageEffectForPage, getEffectsForPage } from './page-effects-ops';
import { buildSourceExport } from './source-export';
vi.mock('@/shared/debug-trace', () => ({ trace: { action: vi.fn(), fn: vi.fn(), dom: vi.fn(), error: vi.fn() }, pauseDOMObserver:vi.fn(),resumeDOMObserver:vi.fn() }));
const PAGE = `export default function Page(){return <div data-id="root" style={{display:'flex',flexDirection:'column',width:'100%'}}><section data-id="one" style={{position:'relative',order:'0',width:'100%',height:'auto',flex:'0 0 auto'}} /></div>;}`;
const LAYOUT = `export default function LayoutClient({ children, color = '#112233' }) { return <div data-id="root" style={{display:'flex',flexDirection:'column',width:'100%'}}><header data-id="header" style={{position:'relative',flex:'0 0 auto',order:'0',color:color}}>Header</header>{children}<footer data-id="footer" style={{position:'relative',flex:'0 0 auto',order:'1'}}>Footer</footer></div>; }`;
const RUNTIME = `export default function LayoutClient({ children, color = 'base', enabled = true, count = 2 }) {
  return <div data-id="root" style={{color}}>{children}</div>;
}`;
const VARS = ['color', 'enabled', 'count'];
function evalRuntime(code: string, route: string, width=1440) {
 const ast=parse(code,{sourceType:'module',plugins:['jsx','typescript']});
 const declarations=ast.program.body.filter(n=>t.isVariableDeclaration(n)&&n.declarations.some(d=>t.isIdentifier(d.id)&&['__templateProps','__matchTemplateRoute'].includes(d.id.name)));
 const fn=ast.program.body.find(n=>t.isExportDefaultDeclaration(n)) as t.ExportDefaultDeclaration;
 const component=fn.declaration as t.FunctionDeclaration;
 const returned=component.body.body.find(n=>t.isReturnStatement(n)) as t.ReturnStatement;
 returned.argument=(parse('({color, enabled, count, displayed: enabled ? \"on\" : \"off\", plusOne: count + 1})').program.body[0] as t.ExpressionStatement).expression;
 const js=declarations.map(n=>generate(n).code).join('\n')+'\n'+generate(fn.declaration).code;
 return new Function('usePathname','useMediaQuery',js+'; return LayoutClient({});')(()=>route,(query:string)=>width<=Number(query.match(/\d+/)![0]));
}
function moveGatesBeforeResolveForDiagnostic(code:string){
 // Only in-memory experimental normalization to isolate responsive fallback; no product edits.
 const ast=parse(code,{sourceType:'module',plugins:['jsx','typescript']});
 const fn=(ast.program.body.find(n=>t.isExportDefaultDeclaration(n)) as t.ExportDefaultDeclaration).declaration as t.FunctionDeclaration;
 const gates=fn.body.body.filter(n=>t.isVariableDeclaration(n)&&n.declarations.some(d=>t.isIdentifier(d.id)&&/^__mq\d+$/.test(d.id.name)));
 fn.body.body=[...gates,...fn.body.body.filter(n=>!gates.includes(n))];
 return generate(ast).code;
}
function setLayout(code: string, path='app/(audit)/page.client.tsx') {
 projectFS.writeFile(path,PAGE);
 projectFS.writeFile('app/(audit)/layout.tsx',`export {default} from './LayoutClient';`);
 projectFS.writeFile('app/(audit)/LayoutClient.tsx',code);
 const store=getDefaultStore(); store.set(activeFilePathAtom,path);store.set(projectVersionAtom,v=>v+1);
 return seedNodesForCode(PAGE);
}
beforeEach(()=>{resetProjectFS();getDefaultStore().set(projectVersionAtom,v=>v+1);});
describe('temporary template audit: confirm current behavior',()=>{
 it('rename can overwrite an organisational group page',()=>{
  createTemplate('old');
  projectFS.writeFile('app/(old)/x/page.client.tsx','SOURCE_CONTENT');
  projectFS.writeFile('app/(archive)/x/page.client.tsx','DESTINATION_CONTENT');
  expect(renameTemplate('old','archive')).toBe(true);
  expect(projectFS.readFile('app/(archive)/x/page.client.tsx')).toBe('SOURCE_CONTENT');
 });
 it('assign on client half ignores collision on server half',()=>{
  createTemplate('audit');
  projectFS.writeFile('app/check/page.client.tsx',PAGE);
  projectFS.writeFile('app/check/page.tsx','SOURCE_METADATA');
  projectFS.writeFile('app/(audit)/check/page.tsx','DESTINATION_METADATA');
  expect(assignTemplate('app/check/page.client.tsx','audit')).toBe('app/(audit)/check/page.client.tsx');
  expect(projectFS.readFile('app/(audit)/check/page.tsx')).toBe('SOURCE_METADATA');
 });
 it('rename leaves active file, comments, variant references and locale imports stale',()=>{
  projectFS.writeFile('i18n/config.json',JSON.stringify({defaultLocale:'en',locales:[{code:'en',label:'English'},{code:'fr',label:'Français'}]}));
  createTemplate('old');assignTemplate('app/page.client.tsx','old');
  const client='app/(old)/page.client.tsx';
  getDefaultStore().set(activeFilePathAtom,client);
  projectFS.writeFile('_meta/comments.json',JSON.stringify([{id:'c',x:0,y:0,filePath:client}]));
  projectFS.writeFile('_revyme/variants/ab/test.json',JSON.stringify({pagePath:client,variants:[{id:'v',template:'old'}]}));
  expect(projectFS.readFile('app/(old)/fr/page.tsx')).toContain('@/app/(old)/page');
  renameTemplate('old','new');
  getDefaultStore().set(projectVersionAtom,v=>v+1);
  expect(getDefaultStore().get(activeFilePathAtom)).toBe(client);
  expect(getDefaultStore().get(activeCodeAtom)).toBe('');
  expect(projectFS.readFile('_meta/comments.json')).toContain(client);
  expect(getVariantBasePage('_revyme/variants/ab/v.tsx')).toBe(client);
  expect(projectFS.readFile('app/(new)/fr/page.tsx')).toContain('@/app/(old)/page');
 });
 it.each([
  ['compact signature',LAYOUT.replace('{ children, color', '{children, color').replace(", color = '#112233'",'').replace('color:color',"color:'#112233'")],
  ['whitespace slot',LAYOUT.replace('{children}','{ children }')],
  ['comment before slot','// slot is {children}\n'+LAYOUT],
 ])('slot detection fails for %s although oracle accepts the slot',(_,code)=>{
  // The compact case must be literally {children}, not {children, …}.
  if(code.includes('{children }'))code=code.replace('{children }','{children}');
  const violations=checkFile(code,{kind:'template',path:'app/(audit)/LayoutClient.tsx'});
  expect(violations.filter(v=>v.code.startsWith('TEMPLATE_CHILDREN_'))).toEqual([]);
  const nodes=setLayout(code);
  console.log('SLOT_CASE',_,JSON.stringify(nodes.get('root')?.children));
  expect(nodes.has('layout::header')).toBe(false);
 });
 it('normal formatting merges the template',()=>{
  expect(setLayout(LAYOUT).has('layout::header')).toBe(true);
 });
 it('boolean false is emitted as a truthy string',()=>{
  const code=setTemplateRouteValueInCode(RUNTIME,'/','enabled','false',VARS);
  const value=evalRuntime(code,'/');
  console.log('BOOLEAN',JSON.stringify(value));
  expect(value.enabled).toBe('false');expect(value.displayed).toBe('on');
 });
 it('numeric override changes addition into string concatenation',()=>{
  const code=setTemplateRouteValueInCode(RUNTIME,'/','count','3',VARS);
  const value=evalRuntime(code,'/');
  expect(value.count).toBe('3');expect(value.plusOne).toBe('31');
 });
 it('first responsive write has a runtime temporal-dead-zone error in real JSX template',()=>{
  const code=setTemplateRouteValueInCode(RUNTIME,'/a','color@768','tablet-a',VARS);
  expect(()=>evalRuntime(code,'/a',375)).toThrow("before initialization");
 });
 it('modifyProjectFile persists the responsive runtime error despite valid syntax',()=>{
  projectFS.writeFile('app/(audit)/LayoutClient.tsx',RUNTIME);
  const code=modifyProjectFile('app/(audit)/LayoutClient.tsx', c=>setTemplateRouteValueInCode(c,'/a','color@768','tablet-a',VARS))!;
  expect(code).toBeTruthy();
  expect(()=>evalRuntime(code,'/a',375)).toThrow("before initialization");
 });
 it('a mobile override on page B changes tablet inheritance on page A after isolating the declaration-order error',()=>{
  let code=setTemplateRouteValueInCode(RUNTIME,'/a','color@768','tablet-a',VARS);
  code=moveGatesBeforeResolveForDiagnostic(code);
  expect(evalRuntime(code,'/a',375).color).toBe('tablet-a');
  code=setTemplateRouteValueInCode(code,'/b','color@375','mobile-b',VARS);
  code=moveGatesBeforeResolveForDiagnostic(code);
  expect(evalRuntime(code,'/a',375).color).toBe('base');
 });
 it('per-page replica variable reaches runtime but not rendered template header',()=>{
  let code=setTemplateRouteValueInCode(LAYOUT,'/','color','#445566',['color']);
  code=setTemplateRouteValueInCode(code,'/','color@768','#abcdef',['color']);
  const nodes=setLayout(code);
  expect(nodes.get('layout::header')?.styles.color).toBe('#445566');
  (globalThis as any).CSS ??= {}; (globalThis as any).CSS.escape ??= (s:string)=>s.replace(/[^a-zA-Z0-9_-]/g,c=>`\\${c}`);
  setStyleContext('app/(audit)/page.client.tsx','desktop',1440);
  const host=document.createElement('div');document.body.appendChild(host);
  try {
   renderNodes(host,nodes,null,()=>{},[{id:'desktop',width:1440,x:0,y:0,isPrimary:true},{id:'tablet',width:768,x:1600,y:0}] as any,PAGE);
   const header=host.querySelector('[data-node-id="tablet-layout::header"]') as HTMLElement;
   expect(header).toBeTruthy();
   console.log('RESPONSIVE_HEADER',header.style.color);
   expect(header.style.color).toBe('rgb(68, 85, 102)');
  } finally {host.remove();}
 });
 it('route-map parser truncates a valid text value containing };',()=>{
  let code=setTemplateRouteValueInCode(RUNTIME,'/','color','text }; example',VARS);
  expect(()=>parse(code,{sourceType:'module',plugins:['jsx','typescript']})).toThrow();
  const valid=`const __templateProps = {\"/\":{\"color\":\"text }; example\"}};\n`+RUNTIME;
  expect(()=>parse(valid,{sourceType:'module',plugins:['jsx','typescript']})).not.toThrow();
  expect(parseTemplateRouteMap(valid)).toEqual({});
 });
 it('supported catch-all page resolves in preview router but template matcher misses deep routes',async()=>{
  const code=setTemplateRouteValueInCode(RUNTIME,'/docs/[...slug]','color','docs',VARS);
  const {buildRouteTable,resolveRoute}=await import('../../preview-sandbox/router');
  const routes=buildRouteTable(new Map([['app/(audit)/docs/[...slug]/page.client.tsx',PAGE]]));
  expect(resolveRoute(routes,'/docs/a/b')).not.toBeNull();
  expect(evalRuntime(code,'/docs/a').color).toBe('docs');
  expect(evalRuntime(code,'/docs/a/b').color).toBe('base');
 });
 it('moving a page to another slug leaves its template overrides at the old URL',()=>{
  createTemplate('audit');
  projectFS.writeFile('app/(audit)/before/page.client.tsx',PAGE);
  projectFS.writeFile('app/(audit)/before/page.tsx','export {default} from "./page.client";');
  const layout=setTemplateRouteValueInCode(LAYOUT,'/before','color','#abcdef',['color']);
  projectFS.writeFile('app/(audit)/LayoutClient.tsx',layout);
  movePageFile('app/(audit)/before/page.client.tsx','app/(audit)/after/page.client.tsx');
  const next=projectFS.readFile('app/(audit)/LayoutClient.tsx')!;
  expect(getTemplateRouteValues(next,'/before')).toEqual({color:'#abcdef'});
  expect(getTemplateRouteValues(next,'/after')).toEqual({});
 });
 it('template editor also misses its slot for a compact signature',()=>{
  const code=LAYOUT.replace("{ children, color = '#112233' }",'{children}').replace('color:color',"color:'#112233'");
  setLayout(code);const store=getDefaultStore();store.set(activeFilePathAtom,'app/(audit)/LayoutClient.tsx');store.set(projectVersionAtom,v=>v+1);
  expect(seedNodesForCode(code).has('children-slot')).toBe(false);
 });
 it('page effect reports success when compact slot injection is rejected by parse gate',()=>{
  const code=LAYOUT.replace("{ children, color = '#112233' }",'{children}').replace('color:color',"color:'#112233'");
  setLayout(code);
  expect(setPageEffectForPage('app/(audit)/page.client.tsx',{preset:'crossfade',target:'all'})).toBe(true);
  expect(projectFS.readFile('app/(audit)/LayoutClient.tsx')).toBe(code);
  expect(getEffectsForPage('app/(audit)/page.client.tsx')).toHaveLength(1);
 });
 it('boolean false renders OFF in the canvas model while generated runtime remains ON',()=>{
  const layout=LAYOUT.replace("color = '#112233'","enabled = true").replace('color:color',"display:enabled ? 'block' : 'none'");
  const code=setTemplateRouteValueInCode(layout,'/','enabled','false',['enabled']);
  expect(setLayout(code).get('layout::header')?.styles.display).toBe('none');
  expect(evalRuntime(setTemplateRouteValueInCode(RUNTIME,'/','enabled','false',VARS),'/').displayed).toBe('on');
 });
 it('a localized route is generated correctly but misses the same page template override',async()=>{
  projectFS.writeFile('i18n/config.json',JSON.stringify({defaultLocale:'en',locales:[{code:'en',label:'English'},{code:'fr',label:'Français'}]}));
  createTemplate('audit');projectFS.writeFile('app/about/page.client.tsx',PAGE);projectFS.writeFile('app/about/page.tsx','export {default} from "./page.client";');
  assignTemplate('app/about/page.client.tsx','audit');
  const {buildRouteTable,resolveRoute}=await import('../../preview-sandbox/router');
  expect(resolveRoute(buildRouteTable(projectFS.getSnapshot()),'/fr/about')).not.toBeNull();
  const code=setTemplateRouteValueInCode(RUNTIME,'/about','color','custom-about',VARS);
  expect(evalRuntime(code,'/about').color).toBe('custom-about');
  expect(evalRuntime(code,'/fr/about').color).toBe('base');
 });
 it('modifyProjectFile refuses the invalid text writer result without corrupting the source',()=>{
  const path='app/(audit)/LayoutClient.tsx';projectFS.writeFile(path,RUNTIME);
  const result=modifyProjectFile(path,c=>setTemplateRouteValueInCode(c,'/','color','text }; example',VARS));
  expect(result).toBeNull();expect(projectFS.readFile(path)).toBe(RUNTIME);
 });
 it('source export preserves the responsive runtime error',async()=>{
  const code=setTemplateRouteValueInCode(RUNTIME,'/a','color@768','tablet-a',VARS);
  const exported=await buildSourceExport({'app/(audit)/LayoutClient.tsx':code},{name:'audit',runtimeRange:'^0.0.28'});
  expect(()=>evalRuntime(exported.files['app/(audit)/LayoutClient.tsx'],'/a',375)).toThrow('before initialization');
 });
 it('oracle treats an organisational route group as templated without checking LayoutClient existence',()=>{
  const path='app/(archive)/page.client.tsx';
  projectFS.writeFile(path,PAGE);expect(getLayoutForPage(path)).toBe('app/layout.tsx');
  const code=PAGE.replace("width:'100%'","width:'100%',backgroundColor:'#000000'");
  expect(checkFile(code,{kind:'page',path}).some(v=>v.code==='TEMPLATED_PAGE_ROOT_STYLED')).toBe(true);
 });

});

```
