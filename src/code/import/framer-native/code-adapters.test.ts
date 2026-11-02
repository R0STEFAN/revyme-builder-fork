import { describe, expect, it, vi } from 'vitest';
import ts from 'typescript';
import * as React from 'react';
import captured from './fixtures/captured-override.json';
import { allocateTargetIdentity, buildSourceGraph } from './source-graph';
import { emitNativeCodeOverrides } from './code-adapters';
import { readCodeOverrides, setCodeOverridesInCode } from '../../generation/code-override-gen';

const originalIdentifier = 'local-module:codeFile/cMyUSqf:BackToTop';
const emit = (input = captured) => {
  const graph = buildSourceGraph(input);
  return emitNativeCodeOverrides(graph, allocateTargetIdentity(graph, new Set()));
};

describe('original code override adapter', () => {
  it('adapts an external override only from the exact captured module and pinned save', () => {
    const input = structuredClone(captured);
    const identifier = 'module:vendor/save/Override.tsx:BackToTop';
    input.definitions[0].data.codeOverrideIdentifier = identifier;
    input.codeFiles[0] = { ...input.codeFiles[0], sourceId: 'vendor', moduleId: 'vendor', saveId: 'save', path: 'Override.tsx' };
    const result = emit(input);
    expect(result.diagnostics).toEqual([]);
    expect(result.overrides[identifier]?.name).toBe('withBackToTop');
    input.codeFiles[0].saveId = 'different';
    expect(emit(input).diagnostics).toContainEqual(expect.objectContaining({ code: 'CODE_SOURCE_UNAVAILABLE' }));
  });
  it('does not invent an override when Framer enables the empty override picker by default', () => {
    const input = structuredClone(captured);
    delete (input.definitions[0].data as Record<string, unknown>).codeOverrideIdentifier;
    expect(emit(input)).toMatchObject({ files: [], overrides: {}, diagnostics: [] });
  });
  it('preserves the captured HOC callback order and smooth scrolling through native wrapping', () => {
    const result = emit();
    expect(result.diagnostics).toEqual([]);
    expect(result.files).toHaveLength(1);
    const ref = result.overrides[originalIdentifier];
    expect(ref.name).toBe('withBackToTop');
    expect(ref.file).toBe(result.files[0].path);
    const native = setCodeOverridesInCode(`'use client'; export default function Page() { return <div data-id="button" />; }`, 'button', [ref]);
    expect(readCodeOverrides(native, 'button')).toEqual([ref]);
    const js = ts.transpileModule(result.files[0].code, {
      fileName: 'override.tsx', compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
    }).outputText;
    const exports: Record<string, any> = {};
    const order: string[] = [];
    const scrollTo = vi.fn((options: unknown) => { expect(options).toEqual({ top: 0, left: 0, behavior: 'smooth' }); order.push('scroll'); });
    new Function('require', 'exports', 'React', 'window', js)((id: string) => {
      expect(id).toBe('react'); return React;
    }, exports, React, { scrollTo });
    const wrapped = exports[ref.name]('button');
    const event = { type: 'click' };
    const element = wrapped.render({ onClick: (received: unknown) => { expect(received).toBe(event); order.push('existing'); }, title: 'Preserved' }, null);
    element.props.onClick(event);
    expect(element.props.title).toBe('Preserved');
    expect(order).toEqual(['existing', 'scroll']);
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });
  it('adapts renamed HOCs without depending on Walker labels or source IDs', () => {
    const input = structuredClone(captured);
    input.codeFiles[0].code = input.codeFiles[0].code.replace(/BackToTop/g, 'JumpElsewhere');
    input.definitions[0].data.codeOverrideIdentifier = originalIdentifier.replace('BackToTop', 'JumpElsewhere');
    const result = emit(input);
    expect(result.diagnostics).toEqual([]);
    expect(Object.values(result.overrides)[0].name).toBe('withJumpElsewhere');
  });
  it('preserves helper bindings and avoids colliding with an existing native HOC name', () => {
    const input = structuredClone(captured);
    input.codeFiles[0].code = `import React from 'react';
      const withHighlight = 'existing';
      export const helper = () => withHighlight;
      export const Highlight = Component => props => <Component {...props} title={helper()} />;`;
    input.definitions[0].data.codeOverrideIdentifier = originalIdentifier.replace('BackToTop', 'Highlight');
    const result = emit(input);
    expect(result.diagnostics).toEqual([]);
    expect(Object.values(result.overrides)[0].name).toBe('withHighlight2');
  });
  it('leaves disabled overrides inactive without requiring their source', () => {
    const input = structuredClone(captured);
    input.definitions[0].data.codeOverrideEnabled = false;
    input.codeFiles = [];
    expect(emit(input)).toMatchObject({ files: [], overrides: {}, diagnostics: [] });
  });
  it.each([false, true])('emits strict TypeScript for the original and direct HOC forms (direct=%s)', direct => {
    const input = structuredClone(captured);
    if (direct) input.codeFiles[0].code = 'export function BackToTop(Component) { return props => <Component {...props} />; }';
    const file = emit(input).files[0];
    const path = `${process.cwd()}/${file.path}`;
    const options: ts.CompilerOptions = { strict: true, noEmit: true, skipLibCheck: true, jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, target: ts.ScriptTarget.ES2020, types: ['react'] };
    const host = ts.createCompilerHost(options);
    const read = host.getSourceFile.bind(host);
    host.getSourceFile = (name, version, onError, create) => name === path ? ts.createSourceFile(name, file.code, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TSX) : read(name, version, onError, create);
    const program = ts.createProgram([path], options, host);
    expect(ts.getPreEmitDiagnostics(program).map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))).toEqual([]);
  });
  it.each(['missing', 'stale', 'used-framer-import', 'legacy-object', 'external'])('fails closed for %s source', kind => {
    const input = structuredClone(captured);
    if (kind === 'missing') input.codeFiles = [];
    if (kind === 'stale') input.codeFiles[0].saveId = 'another-save';
    if (kind === 'used-framer-import') input.codeFiles[0].code = input.codeFiles[0].code.replace('return forwardRef', 'randomColor(); return forwardRef');
    if (kind === 'legacy-object') input.codeFiles[0].code = 'export function BackToTop() { return { onClick() {} }; }';
    if (kind === 'external') input.definitions[0].data.codeOverrideIdentifier = 'module:external/version/Override.js:BackToTop';
    const result = emit(input);
    expect(result.files).toEqual([]);
    expect(result.overrides).toEqual({});
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
