# Framer Editor Native Transfer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. The user must review this written plan and select execution method before implementation.

**Goal:** Copy source entities from the Framer editor and import them as editable native Revyme pages, components, variants, animations and CMS.

**Architecture:** A new MV3 extension captures the editor's raw model through a versioned read adapter. A separate pure converter in Revyme emits canonical native source. A dedicated `imports.framer.submit` accepts complete generated files and uses the existing validation, CAS, commit and history pipeline.

**Tech Stack:** Existing TypeScript, Babel, Vitest, Playwright, ProjectFS, automation-core/CLI/MCP v2; vanilla MV3 extension modules and Node packaging. No new product dependency is assumed.

**Spec:** `docs/superpowers/specs/2026-11-01-framer-editor-native-transfer.md` — approved by the user, with their explicit clarification allowing dedicated full-file submit for deterministic import.

## Global Constraints

- «raw-дерево редактора + нативний імпорт».
- «Попередній Framer-конвертер, розширення, аудити й їхні заготовки не є джерелом реалізації».
- «Розширення збирає джерело. Revyme виконує конвертацію у своїй актуальній версії».
- «Заборона загального `codeFiles.submit` не поширюється на цю operation» (`imports.framer.submit`).
- «Generated TSX не приймається як доказ повноти source».
- «Непідтримувану семантику не відкидають мовчки».
- «Одна незавантажена залежність робить capture incomplete».
- «Наявна сторінка не видаляється при paste».
- «Значення source='framer' та hashes не є доказом довіреності й не замінюють жодного валідатора».
- Match surrounding source conventions, preserve traces, use shared helpers, respect iframe/ProjectFS boundaries.
- Do not read project source from `data/builds/`; live project reads use `codeFiles.read`.
- Reuse a suitable current checkout. Recheck git status before each task; preserve concurrent changes.

## Review Focus

1. Lazy source definitions or a revision change must produce an incomplete/retry result, never a successful partial export — Tasks 1/2.
2. Empty overrides, deleted properties and changed order must survive inheritance across variants and breakpoints — Tasks 2/3/4.
3. A CMS reference that resolves in the source must resolve after ID remapping; empty and self references must remain intentional — Task 5.
4. A familiar file path or forged provenance must not bypass Oracle, path/kind checks or protected files — Task 7.
5. A stale target, a lost commit response or a second paste must not discard edits or duplicate a transaction — Tasks 7/8/10.

## Shared interfaces and file ownership

New code uses `framer-native` names and a distinct envelope; nothing imports the old Framer converter.

```ts
type TransferMode = 'selection' | 'component' | 'page' | 'project';
interface SourceContext {
  projectId: string; branchId: string; revision: string;
  editorBuild: string; scopeId: string; mode: TransferMode;
}
interface RawDefinition {
  id: string; kind: string; data: Record<string, unknown>;
}
interface NativeTransfer {
  format: 'revyme.framer.native'; version: 1;
  context: SourceContext; rootIds: string[];
  definitions: RawDefinition[];
  assets: Record<string, unknown>[];
  complete: boolean;
  diagnostics: TransferDiagnostic[];
}
interface TransferDiagnostic {
  code: string; sourceId?: string; property?: string; message: string;
}
interface NativeFile { path: string; code: string; }
interface NativeCompileResult {
  files: NativeFile[];
  createdIds: string[];
  identity: Record<string, string>;
  diagnostics: TransferDiagnostic[];
}
```

The transport decoder owns structural/size validation. The source graph owns identity,
dependency closure and inheritance. Emitter modules consume its typed normalized model.
The submit operation accepts only validated native file families and infers file kind from
path/content. The UI owns queue flush and selection synchronization.

### Task 1: Prove a complete live source reader and preserve fresh fixtures

**Files:** Create `extensions/framer-native/source-adapters.mjs`, `capture.mjs`, `test/capture.test.mjs`; create `src/shared/framer-transfer-envelope.mjs`, `.d.mts`, `.test.ts`; create `src/code/import/framer-native/fixtures/manifest.json` and minimal sanitized fixtures.

**Interfaces:**
- `decodeNativeTransfer(value: unknown): NativeTransfer` — throws a structured decode error.
- `captureNativeTransfer(adapter, request, signal): Promise<NativeTransfer>`.
- Reader adapter: `readContext()`, `readScope(id)`, `loadScopes(ids, signal)`, `readDefinitions(ids)`, `readAssets(ids)`; each returns plain data. No writer method is exposed.

- [ ] Record current HEAD/status and the relevant Vitest/typecheck baseline. Copy fresh fixtures from the evidence directory in the spec; strip unrelated records and external identifiers for committed test fixtures. Keep an unmodified local evidence manifest and hashes.
- [ ] Write and run the source-reader contract tests before implementation:

```js
test('does not succeed with an unresolved component scope', async () => {
  const adapter = fakeAdapter({ unresolved: ['master'] });
  const result = await captureNativeTransfer(adapter, pageRequest, new AbortController().signal);
  assert.equal(result.complete, false);
  assert(result.diagnostics.some(x => x.sourceId === 'master'));
});
test('retries a changed revision and never mixes two revisions', async () => {
  const adapter = changingRevisionAdapter(['a', 'b', 'b', 'b']);
  const result = await captureNativeTransfer(adapter, pageRequest, new AbortController().signal);
  assert.equal(result.context.revision, 'b');
  assert(result.definitions.every(x => x.data.captureRevision === 'b'));
});
```

- [ ] Implement envelope validation: reject incorrect format/version, duplicate definition IDs,
  prototype keys, cycles, missing roots and non-plain records. Bound JSON size to 50 MiB,
  definition count to 100000 and nesting depth to 256 with explicit errors.
- [ ] Implement the first source adapter for the observed editor build. Resolve the currently
  loaded engine singleton and verify its project/branch and read API shape. Static evidence
  identifies `chunk-VNJKMZPM.mjs` export `Fc` for the observed build; derive the editor build
  from the current entrypoint and do not treat the export name as universal. Capture raw
  scope definitions, variables, replicas, tokens, collections and source code metadata;
  await unloaded scopes with bounded cancellation and retry a revision change at most twice.
- [ ] Run `node --test extensions/framer-native/test/capture.test.mjs` and
  `npx vitest run src/shared/framer-transfer-envelope.test.ts`.
- [ ] Perform a live diagnostic capture of the user-selected project using the new reader.
  Verify six Underline Link variants, five Project Card variants, declarations for their
  exposed variables, all three page breakpoints, layout slot and 20 CMS records. Compare
  IDs/properties to the independent native Copy fixtures, accounting for renamedIds.
  If the engine cannot provide these, report the exact missing read capability and repair
  this adapter before proceeding; do not substitute the compiled site's component modules.
- [ ] Commit only source-reader/envelope/fixture changes after the proof passes.

### Task 2: Normalize source graph, identity and inheritance

**Files:** Create `src/code/import/framer-native/types.ts`, `decode.ts`, `source-graph.ts`, `source-graph.test.ts`.

**Interfaces:** `buildSourceGraph(transfer): SourceGraph`; `resolveSourceNode(graph, id, stateId?): ResolvedSourceNode`; `allocateTargetIdentity(graph, existingPaths): Record<string,string>`.
`SourceGraph` stores definitions/references by kind and owns source scope/variant/record IDs;
`ResolvedSourceNode` stores `id`, `sourceId`, `kind`, `properties`, `children` and provenance.

- [ ] Write failing tests for transitive component/collection closure, cycles, renamedIds,
  duplicate labels, non-Latin labels, unknown types and deterministic collision handling.

```ts
it('keeps deleted properties deleted and preserves replica child order', () => {
  const graph = buildSourceGraph(replicaFixture());
  const resolved = resolveSourceNode(graph, 'node', 'phone');
  expect(resolved.properties).not.toHaveProperty('minHeight');
  expect(resolved.children).toEqual(['second', 'first']);
});
```

- [ ] Run `npx vitest run src/code/import/framer-native/source-graph.test.ts` and confirm semantic failures.
- [ ] Normalize object maps and arrays explicitly; resolve base + overrides + `_deleted`;
  preserve explicit false/empty/zero; separate render roots from dependency roots. Use
  existing ID/string helpers where appropriate. Preserve unknown source properties and
  issue diagnostics for unsupported semantics instead of dropping entities.
- [ ] Run graph/envelope tests, inspect diagnostics for source IDs and commit this module.

### Task 3: Native frames, text, styles and responsive overrides

**Files:** Create `src/code/import/framer-native/styles.ts`, `text.ts`, `responsive.ts`, their `.test.ts` files; reuse `src/shared/css-utils.ts`, `src/code/generation/generator-styles.ts`, `fit-text-gen.ts`, native typography/token generators.

**Interfaces:** `mapSourceStyles(node, context): Record<string,string>`;
`mapSourceText(node, context): NativeText`; `applyNativeResponsive(code, model, identity): string`.
`NativeText` keeps editable content plus tag/runs/preset/bindings; `context` explicitly
includes parent layout, viewport and resolved source variables.

- [ ] Write failing tests for stacks/grids, fractional/fill/fit sizing, absolute pins,
  active/inactive fills, inherited styles, image fitting, rich-text links, JSX escaping,
  typography presets and responsive visibility/order.

```ts
it('does not activate a serialized disabled gradient', () => {
  expect(mapSourceStyles(disabledGradientFixture(), layoutContext))
    .not.toHaveProperty('backgroundImage');
});
it('keeps literal text editable without changing braces or ampersands', () => {
  const text = mapSourceText(richTextFixture('A & B {draft}'), textContext);
  expect(text.plainText).toBe('A & B {draft}');
});
```

- [ ] Run the new module tests and confirm their failures.
- [ ] Implement typed mapping from observed Framer properties. Use native generators for
  container rules, variant styles, fit-text scaffolds and typography; preserve original
  viewport widths/bands. Emit one responsive tree rather than three duplicated DOM trees.
  Route missing style semantics to structured diagnostics with source property/ID.
- [ ] Run the new tests plus `src/code/generation/fit-text-gen.test.ts`;
  parse emitted JSX and assert original content/order. Commit the completed mapping.

### Task 4: Editable component masters, props, variants and interaction graphs

**Files:** Create `src/code/import/framer-native/components.ts`, `interactions.ts`, their tests; reuse `src/code/generation/create-component-gen.ts`, `generator-styles.ts`, `src/code/variants/connection-config.ts`.

**Interfaces:** `emitNativeComponents(graph, identity): NativeCompileResult`;
`mapSourceConnections(component, identity): Connection[]` using the existing `Connection` type.

- [ ] Write failing tests from the six-state and five-state captures, plus generic renamed
  fixtures, a nested component, slots, exposed variable defaults and child-triggered events.

```ts
it('preserves every state and delayed reset edge', () => {
  const result = emitNativeComponents(underlineGraph, identity);
  const code = result.files.find(x => x.path.endsWith('/UnderlineLink.tsx'))!.code;
  expect(parseVariantConfig(code)).toHaveLength(6);
  expect(parseConnections(code)).toHaveLength(8);
  expect(parseConnections(code).filter(x => x.trigger === 'afterDelay'))
    .toEqual(expect.arrayContaining([expect.objectContaining({ delay: 0.3 }),
      expect.objectContaining({ delay: 0.6 })]));
});
```

- [ ] Run `npx vitest run src/code/import/framer-native/components.test.ts src/code/import/framer-native/interactions.test.ts`.
- [ ] Build canonical masters using `buildCreatedMaster`, then add per-state styles and
  event graphs using `updateVariantStyleInCode` and `addConnectionToCode`. Map primary
  to `default` while preserving labels. Preserve every variant state, layout ternary,
  variable reference, instance override, event source and transition parameter.
  A missing state/action must fail compilation explicitly.
- [ ] Verify every emitted master through Oracle kind `component`, variant/prop/connection
  parsers and a native edit round trip. Ensure nested instances remain instances.
- [ ] Run the focused tests and `src/code/generation/create-component-gen.test.ts`; commit.

### Task 5: Native CMS collections, records, queries and bindings

**Files:** Create `src/code/import/framer-native/cms.ts`, `bindings.ts`, their tests; reuse `src/shared/types.ts`, `src/code/generation/cms-gen.ts`, native CMS query/binding helpers.

**Interfaces:** `emitNativeCms(graph, identity): NativeCompileResult`;
`resolveSourceBinding(value, bindingContext): NativeBinding`.
`NativeBinding` explicitly distinguishes literal, field, variable, reference, transform
and query bindings; it never converts an unresolved value into arbitrary text.

- [ ] Write failing tests for schema/defaults, row dates/status/slug, self references,
  multi-references, empty references, all 31 fixture references, featured filter and
  category component props. Add nested repeaters and nondefault locale cases.

```ts
it('resolves every source reference after target ID allocation', () => {
  const result = emitNativeCms(cmsGraph, identity);
  const rows = parseGeneratedCollections(result.files);
  expect(findUnresolvedReferences(rows)).toEqual([]);
  expect(rows.get('works')).toHaveLength(6);
  expect(rows.get('category')).toHaveLength(6);
  expect(rows.get('services')).toHaveLength(8);
});
```

- [ ] Run the CMS/bindings tests and confirm failures.
- [ ] Allocate collection, field and row identity before resolving cross references. Emit
  canonical `.schema.json`/data files; preserve source row identity mapping, explicit
  null/empty values and field defaults. Preserve dividers as provenance, not fake data fields.
  Convert query/filter/sort/limit and bindings using native CMS generators and validators.
  Translate known computed-value transforms explicitly; reject unsupported transforms.
- [ ] Verify CMS schema/data/reference integrity and parse bindings from emitted native
  JSX. Confirm repeated cards remain data-bound. Run `src/code/generation/cms-gen.test.ts`
  and the new tests; commit.

### Task 6: Pages, templates, assets, effects and source-backed code adapters

**Files:** Create `src/code/import/framer-native/pages.ts`, `assets.ts`, `effects.ts`, `code-adapters.ts`, `compile.ts` and their tests.

**Interfaces:** `compileNativeTransfer(transfer, targetContext): NativeCompileResult`;
target context includes existing paths, target mode, selected parent and unit context.
Emitter modules return source files, stable identity and explicit diagnostics.

- [ ] Write failing tests for server/client page pairs, `@canvas`, template slot/assignment,
  route conflicts/dynamic CMS routes, internal/section/external links, SVG/image/video/font
  assets, enter/scroll/page effects and a source-backed code component.

```ts
it('does not replace the existing Home when importing a page', () => {
  const result = compileNativeTransfer(pageTransfer, targetWithExistingHome);
  expect(result.files.some(x => x.path === 'app/page.client.tsx')).toBe(false);
  expect(result.files.some(x => x.path.endsWith('/page.client.tsx'))).toBe(true);
});
it('reports unavailable source rather than embedding a compiled Framer module', () => {
  const result = compileNativeTransfer(missingCodeSourceTransfer, targetContext);
  expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'CODE_SOURCE_UNAVAILABLE' }));
});
```

- [ ] Run the page/asset/effect/adapter tests and confirm failures.
- [ ] Assemble native files from Tasks 2–5. Preserve route-group semantics and children
  slot. Reuse canonical source emitters for effects/overlays/assets and validate imports
  against the complete candidate set. Map Framer runtime dependencies individually;
  source-backed code receives code-component controls only when it is truly a code component.
  Browser behavior absent from Revyme must be implemented in `@revyme/runtime` with its
  README/export/test checklist before claiming that adapter supported.
- [ ] Run Oracle on all emitted authoring files and native parsers for their features;
  compare the normalized source graph to emitted native semantics. Fail on unknown
  required behavior. Commit when the capture's complete dependency set compiles.

### Task 7: Dedicated deterministic full-file submit operation

**Files:** Create `packages/automation-core/src/operations/framer-import.ts`,
`packages/automation-core/test/capabilities/framer-import.test.ts`;
modify `packages/automation-core/src/index.ts`; extract shared submit helpers only
if actually reused by `operations/code-files.ts`. Keep its existing prohibitions.

**Interfaces:** Registry operation `imports.framer.submit` consumes
`{ files: NativeFile[], sourceManifest, mode, target, expectedRevision }` and
returns `{ changes: FileChange[], createdIds, diagnostics }`. Use the existing
`prepareOperation` → `createPlan` → `validatePlan` → commit/receipt pipeline.

- [x] Write failing tests proving a canonical page+component+CMS bundle is accepted here
  while ordinary `codeFiles.submit` still rejects pages/design masters.

```ts
it('rejects a bad master without modifying the input snapshot or ProjectFS', async () => {
  const before = snapshotFingerprint(snapshot);
  await expect(framerImportSubmitOperation.execute(snapshot, badMasterBundle, context))
    .rejects.toThrow(/ORACLE/);
  expect(snapshotFingerprint(snapshot)).toBe(before);
  expect(projectFS.getSnapshot()).toEqual(projectFsBefore);
});
```

- [x] Test traversal/duplicate paths/protected files, forged source/kind/annotations,
  missing canvas config, relative imports across the bundle, duplicate IDs, invalid
  CMS references, stale revision, existing-file hash conflicts and absent dependencies.
- [x] Run the new test to verify failure before implementation.
- [x] Implement a pure candidate operation: infer every file family, enforce paths and
  modes, compute hashes against snapshot, build projected files, validate correct Oracle
  kinds without a caller-controlled exemption, validate server wrappers/JSON/references,
  return FileChanges. Never perform live ProjectFS writes in this operation. Use existing
  plan validation/CAS/history rather than introducing another commit implementation.
- [x] Run the new tests plus `packages/automation-core/test/capabilities/T20-code.test.ts`
  and relevant server commit tests; verify registry/schema exposure through CLI. Commit.

### Task 8: Native paste integration, queue ordering and one-operation Undo

**Files:** Create `src/canvas/framer-native-paste.ts`, `.test.ts`;
modify `src/canvas/shortcuts.ts` at the clipboard detection route; create a narrow
automation-client integration module only if existing client helpers cannot be reused.

**Interfaces:** `readNativeTransferClipboard(): Promise<NativeTransfer | null>`;
`handleNativeTransferPaste(transfer, target): Promise<ImportReceipt>` where the
receipt identifies operationId, revision, created IDs and affected files.

- [ ] Write failing tests for marker routing, plain clipboard fallback, pending mutations,
  unchanged active file on validation error, CAS retry, lost response/receipt lookup,
  source-context mismatch, repeated paste and one-operation undo/redo.

```ts
it('flushes pending edits before building the candidate snapshot', async () => {
  await handleNativeTransferPaste(transfer, target);
  expect(callOrder.indexOf('flushNow')).toBeLessThan(callOrder.indexOf('snapshot'));
});
it('recovers a committed receipt without submitting the import twice', async () => {
  commitThenLoseResponse();
  const receipt = await handleNativeTransferPaste(transfer, target);
  expect(receipt.operationId).toBe(expectedOperationId);
  expect(commitCount()).toBe(1);
});
```

- [ ] Run `npx vitest run src/canvas/framer-native-paste.test.ts` and confirm failures.
- [ ] Implement decode → flush → fresh snapshot → compile → dedicated submit dry-run →
  validated commit → receipt → source resync → selection. Preserve every existing
  shortcut/import route. Scope operationId to one user paste and reuse it only for
  that transaction's transport retries. Do not mark success until persisted source
  reparses and the receipt is known.
- [ ] Verify failure leaves existing pages/selection unchanged and Undo restores the
  whole import. Run focused paste/history tests and commit.

### Task 9: Extension user flow, transport and installation artifact

**Files:** Create `extensions/framer-native/manifest.json`, `background.mjs`,
`popup.html`, `popup.mjs`, `popup.css`, `README.md`, `test/transport.test.mjs`;
create `scripts/build-framer-native-extension.mjs`.

**Interfaces:** popup selects explicit selection/component/page/project mode and invokes
the Task 1 capture contract. Clipboard and downloaded bundle encode exactly the same
`NativeTransfer`; browser messages have a named operation and response envelope.

- [ ] Write and run failing tests for wrong-origin rejection, wrong-tab/context response,
  capture cancellation, malformed bundle, copy/download parity and an unavailable editor
  build. Keep popup code separate from source discovery and conversion.

```js
test('clipboard and download contain the same source identities', () => {
  const transport = makeTransport(completeTransfer);
  assert.deepEqual(decodeNativeTransfer(transport.clipboard).rootIds,
    decodeNativeTransfer(transport.download).rootIds);
});
```

- [ ] Implement the small popup with clear scope, capture status, Copy and Download actions.
  Never advertise full capture if diagnostics mark it incomplete. Use minimal permissions
  and active-tab-scoped access; keep project data local. No injected floating replacement
  for Framer's ordinary Copy. Show specific source IDs/errors when capture fails.
- [ ] Package only the new extension and its shared envelope module with a deterministic
  local Node build script. Test loading the unpacked artifact in a supported browser;
  user handles any installation permission the current browser cannot delegate.
- [ ] Run Node extension tests and packaging verification; commit source and instructions,
  provide the generated installable archive as an artifact.

### Task 10: Full live acceptance, source parity and usage guide

**Files:** Create `src/code/import/framer-native/integration.test.ts`,
`src/code/import/framer-native/e2e/native-transfer.spec.ts`,
`docs/readme/framer-native-import.md`; update extension README with verified workflow.

**Interfaces:** Exercise shipped capture/compile/submit/paste entrypoints; no alternate
fixture-only converter or special Walker path.

- [ ] Write failing integration assertions for fixture graph parity, six underline states,
  five card states, eight transitions, three responsive bands, 20 CMS records and 31
  references. Add generic renamed/structurally different fixtures to detect hardcoded output.
- [ ] Import into a separate disposable Revyme project/branch using the real receiver.
  Read persisted code through `codeFiles.read`. Verify full native masters/props,
  template slots, repeaters, bindings and routes through normal UI/MCP parsers.
- [ ] Add/run browser acceptance: viewport widths and boundary widths from the source;
  hover/tap/delayed transitions, scroll/overlay behavior, CMS edit propagation,
  native style edit round trip, Undo/Redo and published/exported runtime behavior.
  Capture comparable source and destination screenshots; record measured differences.
- [ ] Run the relevant suite, `npx tsc --noEmit`, required builds and browser tests;
  distinguish baseline failures from introduced failures. Fix source adapter, conversion
  or receiver at the responsible layer and rerun only affected proof after each fix.
- [ ] Document install, source capture, copy/paste, code export, supported source-build
  range, verified mappings and exact unresolved semantics. Include the walkthrough the
  user needs to repeat the transfer independently. Do not claim universal 1:1 if any
  source requirement or acceptance check remains unresolved.
- [ ] Commit verified work, provide extension artifact and proof, and report any remaining
  limitation explicitly. Do not publish or merge unless separately authorized.

## Self-review and execution choice

Task ownership covers the approved spec: capture (1), graph (2), layout/text/responsive
(3), masters/state graphs (4), CMS (5), pages/assets/effects/code (6), allowed full-file
submit (7), native integration/atomicity (8), extension UX/package (9), acceptance/docs
(10). All five Review Focus items have concrete tests above. Source adapter proof is
the first hard dependency; no speculative converter work is a substitute for it.

Recommended execution: **Native** in this session, because source capture, canonical
code generation and validation share interfaces that will be adjusted from live evidence.
A single reviewer at the end can then assess the whole transfer path. Subagent-driven
execution remains an option if the user prefers per-task independent reviews.
