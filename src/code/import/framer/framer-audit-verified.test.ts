import { test, expect } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
import { parse } from '@babel/parser';
import { checkFile } from '@/code/oracle/check-file';
import { convertFramerPayload } from '@/code/import/framer/convert';

test('native clipboard object presets decode cleanly without throwing', () => {
  expect(() => convertFramerPayload({
    layers: {
      stylePresetNodes: { p: { id: 'p' } },
      tree: { root: { children: [{ id: 'frame', __class: 'FrameNode', children: [] }] } }
    }
  })).not.toThrow();
});

test('extension converters generate dynamic AST without hardcoded walker templates', async () => {
  let source = fs.readFileSync('/home/rost/Документи/framer-to-revyme-extension/content.js', 'utf8');
  const end = source.lastIndexOf('})();');
  source = source.slice(0, end) + 'window.audit={extractAndGeneratePageTsx,extractAndGenerateComponents,extractAndGeneratePresets,extractAndGenerateCms,convertNodeToRevyme,generateRevymeJsx,expandRepeaters,unwrapComponents,convertTreeToRevyme,setVars:v=>{globalVarMap=v},resolveValue};' + source.slice(end);

  const storage = new Map();
  const box: any = {
    window: { addEventListener() {} },
    document: { readyState: 'loading', querySelectorAll() { return []; } },
    navigator: {},
    localStorage: { getItem: (k: string) => storage.get(k) || null, setItem: (k: string, v: any) => storage.set(k, v) },
    console: { log() {} },
    setTimeout: () => 0,
    clearTimeout() {},
    requestAnimationFrame() {},
    Blob
  };
  vm.createContext(box);
  vm.runInContext(source, box);
  const a = box.window.audit;

  const outputA = a.extractAndGeneratePageTsx({ id: 'A', name: 'Original A' }, {});
  const outputB = a.extractAndGeneratePageTsx({ id: 'B', name: 'Unrelated B' }, {});

  // Page output must be dynamic, not hardcoded Walker
  expect(outputA === outputB).toBe(false);
  expect(outputA.includes('WALKER')).toBe(false);

  // Oracle checks on generated page must be clean
  const pageViolations = checkFile(outputA, { kind: 'page', path: 'app/(nav)/page.client.tsx' });
  expect(pageViolations.filter((v: any) => v.tier >= 2)).toHaveLength(0);

  // With no masters, no component files should be fabricated
  const emptyMasters = a.extractAndGenerateComponents({}, {});
  expect(emptyMasters).toHaveLength(0);

  // Literal text with special characters is escaped without syntax errors
  const special = [{ id: 'special', type: 'p', styles: {}, children: [], textContent: 'A < B & {price}' }];
  const specialJsx = a.generateRevymeJsx(special, 'special', 0);
  let syntaxErr: any = null;
  try {
    parse(specialJsx, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
  } catch (e) {
    syntaxErr = e;
  }
  expect(syntaxErr).toBeNull();
  expect(specialJsx).toContain('&lt;');
  expect(specialJsx).toContain('&#123;');

  // Repeater limit 0 respects 0 count
  const collectionTree = {
    id: 'root',
    children: [{
      id: 'list',
      dataIdentifier: 'local-module:collection/C:default',
      collectionLimit: 0,
      children: [{ id: 'item', children: [] }]
    }]
  };
  a.expandRepeaters(collectionTree, {
    C: { items: [{ id: '1' }, { id: '2' }] }
  });
  expect(collectionTree.children[0].children).toHaveLength(0);
});

test('selection paste mode protects ProjectFS on failure', async () => {
  const fsModule = await import('@/code/project/project-fs');
  const { handleFramerImport } = await import('@/canvas/framer-paste');
  fsModule.resetProjectFS(fsModule.createEmptyProject());
  const projectFS = fsModule.projectFS;

  const beforeCount = projectFS.listFiles().length;
  const ok = await handleFramerImport({
    mode: 'paste',
    clipboard: { version: 1, timestamp: 1, nodes: [] },
    files: [{ path: 'components/AuditSentinel.tsx', kind: 'component', content: 'invalid tsx' }]
  });

  expect(ok).toBe(false);
  expect(projectFS.exists('components/AuditSentinel.tsx')).toBe(false);
  expect(projectFS.listFiles().length).toBe(beforeCount);
});

test('selection paste mode never deletes Home for incoming templated page', async () => {
  const fsModule = await import('@/code/project/project-fs');
  const { handleFramerImport } = await import('@/canvas/framer-paste');
  fsModule.resetProjectFS(fsModule.createEmptyProject());
  const projectFS = fsModule.projectFS;

  const page = "'use client';\nexport default function Page(){return <div data-id=\"root\"/>;}";
  const ok = await handleFramerImport({
    mode: 'paste',
    clipboard: { version: 1, timestamp: 1, nodes: [] },
    files: [{ path: 'app/(audit)/page.client.tsx', kind: 'page', content: page }]
  });

  expect(ok).toBe(false);
  expect(projectFS.exists('app/page.client.tsx')).toBe(true);
});
