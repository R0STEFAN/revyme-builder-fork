import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import capturedCms from '@/code/import/framer-native/fixtures/captured-cms.json';
import capturedComponents from '@/code/import/framer-native/fixtures/captured-components.json';
import capturedOverride from '@/code/import/framer-native/fixtures/captured-override.json';
import { emitNativeCodeOverrides } from '@/code/import/framer-native/code-adapters';
import { setCodeOverridesInCode } from '@/code/generation/code-override-gen';
import { allocateTargetIdentity, buildSourceGraph } from '@/code/import/framer-native/source-graph';
import { emitNativeCms } from '@/code/import/framer-native/cms';
import { emitNativeComponents } from '@/code/import/framer-native/components';
import { buildCreatedMaster } from '@/code/generation/create-component-gen';
import { projectFS } from '@/code/project/project-fs';
import { createOperationContext, createSnapshot, prepareOperation } from '../../src/session';
import { createPlan } from '../../src/plan';
import { validatePlan } from '../../src/validate';
import { defaultRegistry } from '../../src/registry';
import { codeFilesSubmitOperation } from '../../src/operations/code-files';
import { framerImportSubmitOperation, framerImportSubmitInputSchema } from '../../src/operations/framer-import';

const hash = (code: string) => createHash('sha256').update(code).digest('hex');
const context = createOperationContext();
const target = { projectId: 'target', branchId: 'main' };
const snapshot = (files: Record<string, string> = {}, revision = 0) => createSnapshot(target, revision, files);
const canvas = '/** @canvas { "viewports": [{ "id": "desktop", "label": "Desktop", "width": 1200, "height": "auto", "isPrimary": true, "order": 0 }], "positions": { "desktop": { "x": 0, "y": 0 } } } */';
const page = `'use client';
${canvas}
import ImportedCard from '@/components/ImportedCard';
export default function Page() {
  return <div data-id="root" style={{ position: 'relative', width: '100%', minHeight: '900px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
    <ImportedCard data-id="imported-card" style={{ position: 'relative', width: '200px', height: 'auto', order: '0', flex: '0 0 auto' }} />
  </div>;
}`;
const wrapper = `import PageClient from './page.client';
export const metadata = { title: 'Imported' };
export default function Page() { return <PageClient />; }`;
const built = buildCreatedMaster({ name: 'ImportedCard', props: [], layout: [{ tag: 'p', dataId: 'card-label', text: 'Hello', style: { position: 'relative', fontSize: '16px', lineHeight: '1.2' } }] });
if ('error' in built) throw new Error(built.error);
const master = built.masterCode;
const row = (id: string, extra = {}) => ({ _id: id, _slug: id, _status: 'published', _createdAt: '2026-01-01T00:00:00.000Z', _updatedAt: '2026-01-01T00:00:00.000Z', ...extra });
const jsonFile = (path: string, value: unknown) => ({ path, code: JSON.stringify(value) });
function bundle() {
  return {
    files: [
      { path: 'app/imported/page.client.tsx', code: page },
      { path: 'app/imported/page.tsx', code: wrapper },
      { path: 'components/ImportedCard.tsx', code: master },
      jsonFile('cms/categories.schema.json', { name: 'Categories', slug: 'categories', fields: [{ id: 'title', name: 'Title', type: 'text', required: true }] }),
      jsonFile('cms/categories.json', [row('category-a', { title: 'Category A' })]),
      jsonFile('cms/works.schema.json', { name: 'Works', slug: 'works', fields: [{ id: 'category', name: 'Category', type: 'reference', referenceCollection: 'categories' }] }),
      jsonFile('cms/works.json', [row('work-a', { category: 'category-a' })]),
    ],
    sourceManifest: {
      format: 'revyme.framer.native' as const, version: 1 as const, complete: true as const,
      context: { projectId: 'source', branchId: 'main', revision: 'source-revision', editorBuild: 'observed-build', scopeId: 'source-page', mode: 'project' as const },
      rootIds: ['source-page'],
    },
    mode: 'create' as const, target, expectedRevision: 0,
  };
}
function replaceFile(input: ReturnType<typeof bundle>, path: string, code: string) {
  input.files.find(file => file.path === path)!.code = code;
  return input;
}
const run = (input = bundle(), base = snapshot()) => framerImportSubmitOperation.execute(base, input, context);

describe('deterministic Framer full-file import boundary', () => {
  it.each(['missing-collection', 'missing-record', 'valid'])('validates native reference prop defaults: %s', async kind => {
    const input = bundle();
    const name = kind === 'missing-collection' ? 'missing' : 'categories';
    const initial = kind === 'missing-record' ? 'missing-row' : 'category-a';
    const code = master.replace("'use client';", "'use client';")
      .replace('function ImportedCard({', `function ImportedCard({ category = ${JSON.stringify(initial)},`);
    input.files[2].code = `/** @propMeta {"category":{"type":"reference","referenceCollection":"${name}"}} */\n${code}`;
    if (kind === 'valid') expect((await run(input)).diagnostics).toEqual([]);
    else await expect(run(input)).rejects.toThrow(/CMS_INVALID/);
  });
  it('accepts original-source HOCs and keeps their native editor wrapper', async () => {
    const graph = buildSourceGraph(capturedOverride);
    const emitted = emitNativeCodeOverrides(graph, allocateTargetIdentity(graph, new Set()));
    expect(emitted.diagnostics).toEqual([]);
    const ref = Object.values(emitted.overrides)[0];
    const input = bundle();
    input.files[0].code = setCodeOverridesInCode(page, 'imported-card', [ref]);
    input.files.push(...emitted.files);
    const result = await run(input);
    expect(result.changes).toHaveLength(8);
    expect(result.changes.find(change => change.path === ref.file)?.content).toBe(emitted.files[0].code);
  });
  it.each([
    'export default function withBad(Component) { return props => <Component {...props} /> }',
    'export function withBad() { return { onClick() {} }; }',
    'import { createStore } from "https://framer.com/m/framer/store.js@^1.0.0"; export function withBad(Component) { return props => <Component {...props} />; }',
  ])('validates every native override rather than giving its file family an exemption', async code => {
    const input = bundle();
    input.files.push({ path: 'overrides/withBad.tsx', code });
    await expect(run(input)).rejects.toThrow(/OVERRIDE_/);
  });
  it('prepares a native page, design master and mutually resolved CMS as one ordinary plan', async () => {
    const base = snapshot();
    const result = await run(bundle(), base);
    expect(result.changes).toHaveLength(7);
    expect(result.changes.every(change => change.beforeHash === null)).toBe(true);
    expect(result.createdIds).toEqual(expect.arrayContaining(['root', 'imported-card', 'card-label', 'category-a', 'work-a']));
    expect(result.diagnostics).toEqual([]);
    const plan = createPlan({ scope: base.scope, baseRevision: base.revision, operationId: 'framer-test', changes: result.changes, createdIds: result.createdIds });
    expect(validatePlan(base, plan)).toEqual({ ok: true, issues: [] });
    expect(defaultRegistry.get('imports.framer.submit')).toBe(framerImportSubmitOperation);
    expect((await prepareOperation(base, 'imports.framer.submit', bundle(), context)).ok).toBe(true);
  });
  it('retains the generic submit prohibition for both native pages and design masters', async () => {
    await expect(codeFilesSubmitOperation.execute(snapshot(), { files: [bundle().files[0]] }, context)).rejects.toThrow(/CANVAS_PAGE_SUBMISSION_DISALLOWED/);
    await expect(codeFilesSubmitOperation.execute(snapshot(), { files: [bundle().files[2]] }, context)).rejects.toThrow(/DESIGN_COMPONENT_SUBMISSION_DISALLOWED/);
  });
  it('rejects a bad master without modifying the input snapshot or live ProjectFS', async () => {
    const base = snapshot({ 'public/assets/keep.txt': 'keep' });
    const before = [...base.files];
    const live = projectFS.getSnapshot();
    const input = replaceFile(bundle(), 'components/ImportedCard.tsx', `'use client'; export default function ImportedCard() { return <div>Bad master</div>; }`);
    await expect(run(input, base)).rejects.toThrow(/ORACLE/);
    expect([...base.files]).toEqual(before);
    expect(projectFS.getSnapshot()).toEqual(live);
  });
  it.each(['../outside.tsx', '/tmp/out.tsx', 'C:/outside.tsx', 'components/../X.tsx', 'components\\X.tsx', 'components//X.tsx', ' components/X.tsx', 'components/__proto__/X.tsx'])('rejects unsafe path %s', async path => {
    const input = bundle(); input.files[2].path = path;
    await expect(run(input)).rejects.toThrow(/PATH/);
  });
  it.each(['package.json', '_meta/import.json', 'app/layout.tsx', 'data/builds/x.tsx', 'app/imported/helpers.ts'])('rejects protected or non-native family %s', async path => {
    const input = bundle(); input.files[2].path = path;
    await expect(run(input)).rejects.toThrow(/PROTECTED|FILE_FAMILY/);
  });
  it('rejects duplicate paths even when their bytes are identical', async () => {
    const input = bundle(); input.files.push(input.files[0]);
    await expect(run(input)).rejects.toThrow(/DUPLICATE/);
  });
  it('does not accept a caller-supplied kind exemption or incomplete manifest', () => {
    const input = bundle();
    expect(framerImportSubmitInputSchema.safeParse({ ...input, files: [{ ...input.files[0], kind: 'asset' }] }).success).toBe(false);
    expect(framerImportSubmitInputSchema.safeParse({ ...input, sourceManifest: { ...input.sourceManifest, complete: false } }).success).toBe(false);
  });
  it.each(['/** @controls { "title": { "type": "string" } } */', '/** @name "Form Submit" */\n/** @form-gen v1 */'])('does not trust source annotations as a page validation exemption: %s', async annotation => {
    const input = replaceFile(bundle(), 'app/imported/page.client.tsx', `'use client'; ${canvas}\n${annotation}\nexport default function Page(){ return <div>Missing id</div>; }`);
    await expect(run(input)).rejects.toThrow(/ORACLE|SOURCE_KIND/);
  });
  it('requires the native canvas configuration', async () => {
    await expect(run(replaceFile(bundle(), 'app/imported/page.client.tsx', page.replace(canvas, '')))).rejects.toThrow(/CANVAS_CONFIG_MISSING/);
  });
  it('resolves wrapper relative imports against the entire projected bundle', async () => {
    const input = bundle(); input.files = input.files.filter(file => !file.path.endsWith('page.client.tsx'));
    await expect(run(input)).rejects.toThrow(/UNRESOLVED_IMPORT|WRAPPER/);
  });
  it('keeps the native ban on authoring relative imports', async () => {
    await expect(run(replaceFile(bundle(), 'app/imported/page.client.tsx', page.replace('@/components/ImportedCard', '../../components/ImportedCard')))).rejects.toThrow(/FORBIDDEN_IMPORT/);
  });
  it('rejects absent dependencies even if they are in an allowed import namespace', async () => {
    const input = bundle(); input.files = input.files.filter(file => !file.path.startsWith('components/'));
    await expect(run(input)).rejects.toThrow(/UNRESOLVED_IMPORT|COMPONENT_IMPORT/);
  });
  it('does not let a server wrapper masquerade as a canvas page', async () => {
    await expect(run(replaceFile(bundle(), 'app/imported/page.tsx', `export default function Page(){ return <div>Lost canvas</div>; }`))).rejects.toThrow(/WRAPPER/);
  });
  it('rejects duplicate canvas IDs within a file', async () => {
    await expect(run(replaceFile(bundle(), 'app/imported/page.client.tsx', page.replace('data-id="imported-card"', 'data-id="root"')))).rejects.toThrow(/DUP_DATA_ID|DUPLICATE_DATA_ID/);
  });
  it('allows file-scoped root IDs in independent pages', async () => {
    const input = bundle(); input.files.push({ path: 'app/second/page.client.tsx', code: page }, { path: 'app/second/page.tsx', code: wrapper });
    expect((await run(input)).changes).toHaveLength(9);
  });
  it('validates template bundles against the candidate without reading live ProjectFS', async () => {
    const input = bundle();
    input.files[0] = { path: 'app/(imported)/page.client.tsx', code: page.replace("minHeight: '900px', ", '') };
    input.files[1] = { path: 'app/(imported)/page.tsx', code: wrapper };
    input.files.push(
      { path: 'app/(imported)/LayoutClient.tsx', code: `'use client'; ${canvas}\nexport default function LayoutClient({ children }: { children: React.ReactNode }) { return <div data-id="root" style={{ position: 'relative', width: '100%', minHeight: '900px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>{children}</div>; }` },
      { path: 'app/(imported)/layout.tsx', code: `import LayoutClient from './LayoutClient'; export default function Layout({children}: { children: React.ReactNode }) { return <LayoutClient>{children}</LayoutClient>; }` },
    );
    const liveRead = vi.spyOn(projectFS, 'exists').mockImplementation(() => { throw new Error('Unexpected live ProjectFS read'); });
    try { expect((await run(input)).changes).toHaveLength(9); }
    finally { liveRead.mockRestore(); }
  });
  it.each([
    wrapper.replace("{ title: 'Imported' }", '{ title: unknownIdentifier }'),
    wrapper.replace('<PageClient />', '<PageClient {...runSomething()} />'),
    wrapper.replace('return <PageClient />;', 'const x = runSomething(); return <PageClient />;'),
  ])('rejects malformed structural wrapper content', async code => {
    await expect(run(replaceFile(bundle(), 'app/imported/page.tsx', code))).rejects.toThrow(/WRAPPER/);
  });
  it.each([
    ['cms/works.json', [row('work-a', { category: 'missing' })]],
    ['cms/works.json', [row('work-a', { category: 3 })]],
    ['cms/categories.json', [row('category-a', { title: 'A' }), row('category-a', { title: 'B' })]],
    ['cms/categories.json', [row('category-a', { title: 4 })]],
    ['cms/categories.json', [row('category-a', {})]],
    ['cms/categories.json', [row('category-a', { title: 'A', _status: 'other' })]],
  ])('rejects invalid typed CMS data in %s', async (path, data) => {
    await expect(run(replaceFile(bundle(), path, JSON.stringify(data)))).rejects.toThrow(/CMS/);
  });
  it('resolves references to collections already in the target snapshot', async () => {
    const input = bundle();
    const existing = Object.fromEntries(input.files.filter(file => file.path.startsWith('cms/categories')).map(file => [file.path, file.code]));
    input.files = input.files.filter(file => !file.path.startsWith('cms/categories'));
    expect((await run(input, snapshot(existing))).changes).toHaveLength(5);
  });
  it('accepts the same automatic CMS emitter output from the original capture', async () => {
    const assets: Record<string, string> = {};
    function visit(value: unknown): void {
      if (typeof value === 'string' && value.startsWith('data:framer/asset-reference,')) assets[value] = 'https://fixture.example/asset.jpg';
      else if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') Object.values(value).forEach(visit);
    }
    visit(capturedCms);
    const graph = buildSourceGraph(capturedCms), identity = allocateTargetIdentity(graph, new Set());
    const emitted = emitNativeCms(graph, identity, { assets });
    expect(emitted.diagnostics).toEqual([]);
    const input = bundle(); input.files = emitted.files;
    expect((await run(input)).changes).toHaveLength(6);
  });
  it('accepts the unchanged automatic six-state component output from original source', async () => {
    const graph = buildSourceGraph({ ...capturedComponents, rootIds: ['f03DgVEM5'] });
    const identity = allocateTargetIdentity(graph, new Set());
    const emitted = emitNativeComponents(graph, identity);
    expect(emitted.diagnostics).toEqual([]);
    const input = bundle(); input.files = emitted.files;
    const result = await run(input);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].content).toBe(emitted.files[0].code);
    expect(result.createdIds).toContain(identity.q7dmakjiW);
  });
  it('catches inbound references broken by replacement of an existing collection', async () => {
    const input = bundle();
    const base = snapshot(Object.fromEntries(input.files.filter(file => file.path.startsWith('cms/')).map(file => [file.path, file.code])));
    const code = JSON.stringify([row('replacement', { title: 'Replacement' })]);
    await expect(framerImportSubmitOperation.execute(base, { ...input, mode: 'replace', files: [{ path: 'cms/categories.json', code, baseHash: hash(base.files.get('cms/categories.json')!) }] }, context)).rejects.toThrow(/Dangling reference/);
  });
  it('rejects a mistyped boolean even when its value is an empty string', async () => {
    const input = bundle();
    replaceFile(input, 'cms/works.schema.json', JSON.stringify({ name: 'Works', slug: 'works', fields: [{ id: 'featured', name: 'Featured', type: 'boolean' }] }));
    replaceFile(input, 'cms/works.json', JSON.stringify([row('work-a', { featured: '' })]));
    await expect(run(input)).rejects.toThrow(/Expected boolean/);
  });
  it('rejects missing collection pairs and dangling schema references without rows', async () => {
    const input = bundle(); input.files = input.files.filter(file => file.path !== 'cms/categories.json');
    await expect(run(input)).rejects.toThrow(/CMS/);
    const empty = replaceFile(bundle(), 'cms/works.json', '[]');
    empty.files = empty.files.filter(file => !file.path.startsWith('cms/categories'));
    await expect(run(empty)).rejects.toThrow(/CMS/);
  });
  it('refuses stale revision and target scope before generating changes', async () => {
    await expect(run(bundle(), snapshot({}, 1))).rejects.toThrow(/STALE_REVISION/);
    await expect(run({ ...bundle(), target: { ...target, projectId: 'other' } })).rejects.toThrow(/SCOPE_MISMATCH/);
  });
  it('requires explicit replacement and exact base hashes for existing paths', async () => {
    const base = snapshot({ 'components/ImportedCard.tsx': master });
    await expect(run(bundle(), base)).rejects.toThrow(/ALREADY_EXISTS/);
    const input = { ...bundle(), mode: 'replace' as const };
    await expect(framerImportSubmitOperation.execute(base, input, context)).rejects.toThrow(/BASE_HASH_REQUIRED/);
    const files = input.files.map(file => file.path.startsWith('components/') ? { ...file, baseHash: '0'.repeat(64) } : file);
    await expect(framerImportSubmitOperation.execute(base, { ...input, files }, context)).rejects.toThrow(/CAS_CONFLICT/);
    const valid = files.map(file => file.path.startsWith('components/') ? { ...file, baseHash: hash(master) } : file);
    expect((await framerImportSubmitOperation.execute(base, { ...input, files: valid }, context)).changes.find(change => change.path.startsWith('components/'))?.beforeHash).toBe(hash(master));
  });
  it('limits paste to its target page, preserving its existing node identities', async () => {
    const base = snapshot({ 'app/imported/page.client.tsx': page });
    const input = { ...bundle(), mode: 'paste' as const, target: { ...target, filePath: 'app/imported/page.client.tsx', parentNodeId: 'root' }, files: bundle().files.map(file => file.path.endsWith('page.client.tsx') ? { ...file, baseHash: hash(page) } : file) };
    expect((await framerImportSubmitOperation.execute(base, input, context)).changes).toHaveLength(7);
    const removed = input.files.map(file => file.path.endsWith('page.client.tsx') ? { ...file, code: page.replace('data-id="imported-card"', 'data-id="new-card"') } : file);
    await expect(framerImportSubmitOperation.execute(base, { ...input, files: removed }, context)).rejects.toThrow(/PASTE/);
    await expect(framerImportSubmitOperation.execute(base, { ...input, target: { ...input.target, parentNodeId: 'absent' } }, context)).rejects.toThrow(/PASTE/);
  });
});
