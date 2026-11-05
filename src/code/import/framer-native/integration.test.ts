import { expect, it } from 'vitest';
import capturedComponents from './fixtures/captured-components.json';
import { compileNativeTransfer } from './compile';
import { framerImportSubmitOperation } from '../../../../packages/automation-core/src/operations/framer-import';
import { createOperationContext, createSnapshot } from '../../../../packages/automation-core/src/session';
import { parseVariantConfig } from '../../variants/variant-config';
import { parseConnections } from '../../variants/connection-config';
import { nativeComponentName } from './components';
import { parsePropMeta } from '../../components/prop-meta';

it('sends a captured six-state design component through the shipped compiler and native receiver', async () => {
  const sourceTransfer = { ...capturedComponents, rootIds: [capturedComponents.rootIds[0]] };
  const compiled = compileNativeTransfer(sourceTransfer, { existingFiles: new Map(), mode: 'create' });
  expect(compiled.diagnostics).toEqual([]);
  const underlinePath = `components/${nativeComponentName(compiled.identity, capturedComponents.rootIds[0])}.tsx`;
  const component = compiled.files.find(file => file.path === underlinePath)!;
  expect(component).toBeDefined();
  const variants = parseVariantConfig(component.code);
  expect(variants).toHaveLength(6);
  expect(parseConnections(component.code)).toHaveLength(8);
  expect(Object.keys(parsePropMeta(component.code))).toHaveLength(5);
  const source = capturedComponents.context;
  const scope = { projectId: 'integration-destination', branchId: 'main' };
  const prepared = await framerImportSubmitOperation.execute(createSnapshot(scope, 1, {}), {
    files: compiled.files,
    mode: 'create', target: scope, expectedRevision: 1,
    sourceManifest: { format: 'revyme.framer.native', version: 1, complete: true,
      context: { projectId: source.projectId, branchId: source.branchId, revision: source.revision, editorBuild: source.editorBuild, scopeId: source.scopeId, mode: 'selection' },
      rootIds: sourceTransfer.rootIds },
  }, createOperationContext());
  expect(prepared.diagnostics).toEqual([]);
  expect(prepared.createdIds.length).toBeGreaterThan(0);
  expect(prepared.createdIds.every(id => component.code.includes(`data-id="${id}"`))).toBe(true);
});
