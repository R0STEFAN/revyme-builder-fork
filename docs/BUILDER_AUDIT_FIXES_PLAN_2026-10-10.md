# Builder audit fixes — implementation plan

> **For agentic workers:** Use subagent-driven-development, TDD and verification-before-completion. Execute only your assigned task. Do not spawn agents. The coordinator owns integration and commits.

**Goal:** Correct all 17 findings in BUILDER_UI_UX_AUDIT_2026-10-10.md, preserve the user's latest Insert changes, and leave locally committed rollback points.

**Architecture:** Keep ProjectFS/source as truth. Use existing mutation, AST, history and bridge interfaces. Serialize persistence, distinguish failed load from an empty project, and restore behavior in the appropriate preview/rendering context. Repair existing templates and controls rather than introducing an unrelated framework.

**Tech stack:** TypeScript, React/Jotai, Babel AST, Vitest/Testing Library, Vite, ProjectFS, Three/Spline optional modules.

**Spec:** docs/BUILDER_UI_UX_AUDIT_2026-10-10.md (all 17 groups and their acceptance scenarios).

## Global constraints

- Base is `69ef9b2707ea46f14002f8f31b4a4b3fec5ebdb0`, including the user's new built-in registrations, Insert descriptions/tooltips and preview icons. Never reset those changes.
- Worktree: `/home/rost/.codex/worktrees/builder-audit-fixes/revyme-builder-fork`; branch `codex/builder-audit-fixes`. No push, publication or merge to main.
- Every production change needs a failing behavior test first and a passing test afterward. Test desired behavior, not the audit's intentionally broken assertions.
- Read AGENTS.md. No parent-frame canvas DOM reads. Use modifyProjectFile for existing project files; flush the queue before structural transactions. Preserve traces.
- Human code-editor saves may use skipParseGate for unfinished source; generated structural changes must remain parseable.
- One implementer at a time. Model routing: GPT-6 Sol for integration tasks; GPT-6 Luna for local mechanical tasks. All agents receive isolated context.
- Implementers do not commit: report exact files and checks; coordinator independently verifies, dispatches review, then commits each task as a local stage checkpoint.
- node_modules is reused from the main checkout. Do not install packages into that shared directory. If dependencies must change, notify coordinator before installation.
- Existing audit fixtures are available under docs/audits/2026-10-10 (ignored). Move durable regression cases to src alongside the responsible module. Do not retain assertions that require the bug.
- Each task report records coverage for every assigned AUD ID, test commands/results, RED evidence, risks and any contract changes.

## Review focus

1. A new edit during an in-flight save must remain dirty until the newest snapshot is acknowledged; hold, cancellation, HMR and leader election must not reintroduce stale writes.
2. Failed hydration or persistence must never produce a successful Save/Publish indication or write a scaffold over an existing project.
3. Valid handwritten TSX must survive aliases, quote styles, nested expressions, strings/comments containing braces, and component-root deletion.
4. Async template loads must reject stale completions, apply the latest props, release resources, and remain correct under StrictMode/remount/resize.
5. Controls must preserve 0, structured list/transition values and nested defaults; cloning must preserve user metadata while generating distinct identifiers.

## Stages and rollback

| Stage | Tasks | AUD coverage | Local checkpoints |
|---|---|---|---|
| 0 | Plan and baseline | latest commit reconciliation | docs commit |
| 1 | 1–2 | 00, 01, 02, 11, 13 | persistence; component editor |
| 2 | 3 | 03, 04 | AST editing |
| 3 | 4–5 | 05, 12, 06, 07 | responsive/dependency graph; preview/compiler |
| 4 | 6–9 | 08, 09, 10, 16, 14, 15 | templates; controls; optional 3D; duplication |

Use `git revert <checkpoint>` for a reversible rollback; do not rewrite the user's history. Run full Vitest, TypeScript and all builds after integration. Each task runs its related suites and TypeScript before acceptance. Update this plan's tracked completion log at every checkpoint.

### Task 1: Safe loading and serialized, truthful persistence

**Model:** gpt-6-sol, high. **Stage:** 1. **IDs:** AUD-00, AUD-01, AUD-02, AUD-11.

**Files:** Modify src/backend/revyme-backend.ts, autosave.ts, local-backend.ts, types.ts/save-store.ts only if the result contract requires it, src/ProjectLoader.tsx and save UI call sites as necessary. Tests beside these modules; read docs/audits/2026-10-10/{autosave,backend,loader}.test.*. Existing autosave hold/unload/branch suites must pass.

**Interfaces:** Preserve `loadProject(id): Promise<ProjectData | null>`: null means a successfully confirmed empty snapshot, errors reject. Preserve `flushSaveNow(opts?): Promise<void>`: resolution means current files were persisted; explicit failures reject. `triggerAutosave` remains non-throwing and debounced. A background save must catch its own rejected Promise. Metadata belongs to the save that consumes it, not an older in-flight operation.

- [ ] Write failing tests: GET 503/network/malformed row JSON rejects and ProjectLoader renders Retry without hydrating or saving scaffold; successful `{json:'{}'}` remains empty; unknown format with valid files still loads.
- [ ] Write deferred-Promise tests: A starts, B edit occurs, debounce expires; maximum concurrent writes is 1, A's completion cannot mark B saved; final persisted snapshot is B. A completion during B's debounce preserves unload protection. Two concurrent flush calls serialize and acknowledge current content. Manual 503 rejects flush; retry remains bounded and has no unhandled rejection. Held saves do not persist. Cancel invalidates pending obsolete follow-up work.
- [ ] Write LocalBackend tests: quota + PUT 500 rejects; quota + PUT success succeeds; local success + server failure is accurately reported, and reload cannot prefer an older server snapshot over known unsynced local work. If the existing void interface cannot express local-only success, conservatively reject server failure while preserving local recovery and retry, rather than inventing a false Saved.
- [ ] Run the new tests before edits and record expected failures.
- [ ] Replace autosave concurrency with a single tracked Promise and monotonically increasing dirty revision. Capture revision/data/meta per write; clear dirty only when acknowledgement matches current revision. Retry attaches to pending dirty work. All timer entry points catch errors; explicit flush propagates them and waits through newer revisions.

```ts
// Intended persistence contract, asserted by tests:
await expect(flushSaveNow({ source: 'manual' })).rejects.toThrow();
expect(store.get(saveStatusAtom)).toBe('error');
// With deferred saves: saveProject.mock.calls.length === 1 until A settles.
// After B settles: persisted.files[pagePath] === latestCode, status === 'saved'.
```

- [ ] Throw traced cloud load errors, reuse the existing ProjectLoader error UI, and protect hydration/held state. Check SaveButton, CodeEditor and RightHeader catches: no success toast, dirty clearing or publish request after failure.
- [ ] Verify related backend/ProjectLoader/save UI suites and `npx tsc --noEmit`. Return changes uncommitted for independent review.

### Task 2: Component editor commits participate in history and autosave

**Model:** gpt-6-sol, medium. **Stage:** 1. **ID:** AUD-13.

**Files:** src/editor/component-editor/ComponentEditorOverlay.tsx; create commit helper/test beside it if needed; use src/code/project/modify-file.ts and src/code/mutation/history.ts. Reuse docs/audits/2026-10-10/editor-persistence.test.tsx fixture and existing history-ui-location tests.

**Interfaces:** Before-agent hooks are synchronous; do not turn them into async network waits. Commit buffer synchronously to ProjectFS, preserving human WIP, then trigger persistence. No codeAtom/queue sync for inactive master files. UI baseline only advances when the safe file commit succeeds.

- [ ] Write failing tests for Save on a nonactive component master: file changed, one undoable history operation, backend eventually sees the change. Undo/redo restores file and overlay location. Repeat for close/Escape and runBeforeAgentTurn. Unedited overlay must not overwrite an external update.
- [ ] Run RED. Read actual history APIs and initialization; capture a prechange snapshot and finalize one explicit operation using existing APIs, not a second history implementation.
- [ ] Centralize Save/close/before-turn writes through the same safe commit helper. Flush queue, use `modifyProjectFile(path, () => buffer, {skipParseGate:true})`, finalize history/version only on a changed successful commit, then `triggerAutosave({force:true})`. Preserve busy refusal and external sync behavior.

```ts
expect(projectFS.readFile(masterPath)).toContain('LOCAL CHANGE');
expect(canUndo()).toBe(true);
await vi.advanceTimersByTimeAsync(3000);
expect(saveProject).toHaveBeenCalled();
```

- [ ] Run overlay/lifecycle/history regression suites and TypeScript. No commit; report for review.

### Task 3: AST component deletion and exact instance identity

**Model:** gpt-6-sol, high. **Stage:** 2. **IDs:** AUD-03, AUD-04.

**Files:** src/code/components/component-ops.ts (delete), src/editor/tools/ComponentPropsTool/instance-props.ts (locator/read/write), related callers if return/error handling changes. Create focused AST deletion tests; extend instance-props.test.ts. Audit fixture: core.test.ts.

**Interfaces:** Keep public instance read/write/remove signatures. Match actual data-id string value, including single quotes and expression string literals. If ID is absent or ambiguous, return no match rather than mutating a different instance. Preserve an unambiguous legacy fallback only when demonstrably safe. Keep deleteComponent's modified-path result; safely report refusal with trace/caller UI if planning fails.

- [ ] RED tests: removing sole returned Card produces valid `return null`; aliased Tile import resolves by path; arrow props containing `>` and nested same-name JSX remove correctly; namespace/named/reexport/reference shapes are either supported safely or refuse the whole delete. A malformed dependent file cannot allow partial deletion. Pending queued canvas changes survive delete. One history step restores master/dependents.
- [ ] RED identity tests: second Card with single-quoted ID is read/edited; expression string ID; missing/ambiguous ID leaves both cards unchanged; duplicate IDs refuse writes.
- [ ] Build a pure AST deletion plan for all dependent source files before mutation. Resolve imports relative to containing file (including @/components and extension variants), use local binding, replace JSX expression roots with null, remove JSX children via AST, remove import specifiers, verify parseable output. Refuse unresolved non-JSX uses rather than leave dangling names.
- [ ] Commit the prepared transaction only after validation and queue flush; use safe writes and existing history/autosave. Delete master last. No regex-balanced JSX removal.
- [ ] Replace tag identity text heuristic with AST source ranges so existing formatting can be preserved by range replacement.

```ts
expect(() => parseJSX(projectFS.readFile(pagePath)!)).not.toThrow();
expect(readInstanceProps(code, componentName, secondId)).toMatchObject({ title: 'B' });
// Adapt assertions to the existing exported function names; do not change public APIs just for tests.
```

- [ ] Related component-ops/instance-props/mutation suites + TypeScript, then review.

### Task 4: Responsive cascade and reusable preview dependencies

**Model:** gpt-6-luna, high. **Stage:** 3. **IDs:** AUD-05, AUD-12.

**Files:** src/canvas/renderer/responsive.ts, src/preview/ComponentLivePreview.tsx and focused tests. Fixtures: core.test.ts responsive case, preview-deps.test.tsx.

**Interfaces:** Preserve exported responsive setters/resolver and ComponentLivePreview props. Resolver follows the source order for supported equal-specificity builder selectors, matching real CSS; banded ranges and component-master behavior remain unchanged. Child compilation is cached per root compilation, with a separate recursion stack for true cycles.

- [ ] RED: tablet rule then mobile rule => mobile12 at375; reverse source order => tablet24; equal bounds use last rule; fractional widths parse; nonoverlap bands preserve behavior. Pin-width behavior and component master remain covered.
- [ ] RED: Root→Left/Right→Shared renders both Shared instances; source edit Shared updates both; real cycle terminates without stack overflow and presents an actionable error.
- [ ] Remove width sorting that changes native source cascade; parse numeric fractional max widths. Preserve scope exclusions.
- [ ] Use a local import iterator/AST list before recursion, a visiting Set with finally cleanup, and a completed map. A shared dependency uses its completed result; only an active recursion path is cyclic.

```ts
setResponsiveBreakpoints(parseResponsiveBreakpoints(css));
expect(getResponsiveOverridesForNode('n', 375).fontSize).toBe('12px');
expect(screen.getAllByText('Shared content')).toHaveLength(2);
```

- [ ] Run responsive and preview dependency suites + TypeScript, then review.

### Task 5: Preview interactivity and syntactically safe canvas restrictions

**Model:** gpt-6-sol, high. **Stage:** 3. **IDs:** AUD-06, AUD-07.

**Files:** src/canvas/code-component-runtime.ts, runtime tests, src/editor/component-editor/ComponentPreviewPane.tsx and preview isolation/context only as needed. Reproductions: components.test.tsx CopyButton and brace cases. Preserve all existing runtime modules/shims.

**Interfaces:** `compileCodeComponent(...,{previewMode:true})` retains live handlers. Canvas mode removes only intended pointer/click handlers. Preview next-themes must expose working state/provider behavior rather than noop; avoid global effects leaking into editor where isolation is needed. Both modes parse valid TSX containing braces in strings/comments/templates.

- [ ] RED tests: CopyButton updates label/clipboard in preview, Accordion opens with click/keyboard, pointer/listener handlers remain in preview; canvas handlers are suppressed. Theme toggle changes preview state without corrupting editor theme. Strings `'}'`, escaped quotes, templates, comments and nested functions compile in both modes.
- [ ] Replace strip scanner/global regex rewrites with Babel visitor transforms in static mode. Remove intended JSXAttributes and listener call statements without invalid leftover expressions. Keep hook behavior and other event types intact. Avoid repeatedly parsing/generating code if the existing Babel transform can host the visitor.

```ts
const Preview = compileCodeComponent(COPY_BUTTON_COMPONENT, 'CopyButton', { previewMode: true });
render(React.createElement(Preview!));
fireEvent.click(screen.getByRole('button'));
expect(navigator.clipboard.writeText).toHaveBeenCalled();
expect(compileCodeComponent(validBracesSource, 'Demo')).not.toBeNull();
```

- [ ] Keep optional dependency work out of this task; Task 8 owns it. Run compiler/preview suites and template inventory in both modes; TypeScript, then review.

### Task 6: ImageSequence and ModelViewer lifecycle correctness

**Model:** gpt-6-sol, high. **Stage:** 4. **IDs:** AUD-08, AUD-09.

**Files:** src/code/project/default-code-components/ImageSequence.ts, ModelViewer.ts, ParticleField.ts (newly exposed oracle compliance); tests compile actual exported template strings with fake Image/Canvas/Three, as in audit components.test.tsx. Reuse an existing template-test harness or extract one focused helper if necessary.

**Interfaces:** Published template source remains self-contained React code importing @revyme/runtime and supported libraries. ImageSequence preserves folder and legacy pipe-list inputs and accepts a single uploaded URL (http/data/blob/image-extension path) without appending a filename. Structured arrays may be additionally supported without breaking legacy instances.

- [ ] RED frames: A→B redraws B, single URL requests exactly that URL, stale A callbacks cannot mark B ready; all-failed images show error; partial failures choose available frames; empty input clears previous image. Resize and all manual/data-frame/scroll draws honor contain/cover/fill.
- [ ] RED model: async init applies initial camera/distance/rotation and autoRotate; props changed while loading are the values applied; lighting/background update without reload; resize updates camera aspect; autoRotate=false stops after several frames; replacement/unmount disposes late-loaded geometry/materials/textures and loops.
- [ ] One draw function handles fit/current frame and resize; reset load readiness per revision, detach callbacks on cleanup, publish ready revision only for current generation. Set callbacks before src for cached images; count successful vs failed frames.
- [ ] ModelViewer uses latest-props refs/controller ready handling. Apply props after resources exist; one tracked animation loop reads latest autoRotate rather than a second leaking loop. Observe container size, guard zero height, dispose all owned GPU resources and late results. Empty/error/loading states reset on model replacement.

```ts
expect(requestedUrls).toEqual(['https://cdn.example/frame.webp']);
expect(lastDrawnImage.src).toContain('/B/');
expect(camera.position.z).not.toBe(0);
expect(activeSpinCallbacks).toHaveLength(0); // after disabling and advancing frames
```

- [ ] Latest commit baseline additionally fails oracle for ImageSequence (STATIC_FALLBACK, CANVAS_FILL_FEEDBACK), ModelViewer (STATIC_FALLBACK), ParticleField (CANVAS_FILL_FEEDBACK). Add genuine static canvas fallback and explicit fill canvas sizing according to the existing oracle rules; preserve runtime/live behavior and do not weaken oracle. Run `npx vitest run src/code/oracle/check-file.test.ts` after Task 8 fixes Spline too.
- [ ] Run template lifecycle regressions and all template compilation inventory + TypeScript, then review.

### Task 7: Component editor control parity and structured defaults

**Model:** gpt-6-luna, high. **Stage:** 4. **ID:** AUD-10.

**Files:** src/editor/component-editor/ComponentPropsPanel.tsx, ComponentEditorOverlay.tsx defaults helper; reuse src/editor/tools/ComponentPropsTool editors and controls-parser types. Add control panel/defaults tests. Fixture controls.test.tsx.

**Interfaces:** ComponentPropsPanel still consumes controls/values/onChange. Reuse existing ObjectList/ImageList/Font controls rather than a second implementation. Slot is a canvas relationship: provide an honest disabled explanation if it cannot be edited in master preview. All other supported metadata types expose controls.

- [ ] RED tests: slider/ranged number zero stays zero in slider and input; finite negatives preserved; Accordion Questions & Answers renders and changes list; imageList reorder and font selection forward values; uploadSource=sequence and batch totalFrames propagate; nested group defaults flatten into real props; transition object becomes valid JSON, never `[object Object]`.
- [ ] Replace truthiness numeric fallback with finite parsing. Render objectList/imageList/font through existing controls. Preserve raw structured values and serialize only where existing child controls require strings. Pass uploadSource/onBatchComplete; update frame count in one batch callback. Flatten defaults recursively and preserve already-set values including false/0/empty strings.

```ts
expect(sliderValue).toBe(0);
expect(screen.getByText('Questions & Answers')).toBeTruthy();
expect(JSON.parse(transitionValue)).toEqual({ duration: 0.3 });
```

- [ ] Verify related controls/overlay/defaults suites and TypeScript; review.

### Task 8: Optional 3D dependencies and honest Spline controls

**Model:** gpt-6-sol, high. **Stage:** 4. **IDs:** AUD-16, AUD-14.

**Files:** src/canvas/code-component-runtime.ts; optional-module registry helper/tests; src/preview-sandbox compiler resolver and canvas/preview import maps if required by selected approach; SplineScene.ts. Inspect actual bundling entry points before choosing resolver. Do not alter exporter outside this repository or claim it verified.

**Interfaces:** Static and dynamic three/Spline imports use the same async registry; Promise cache deduplicates, failure evicts for retry, no ready flag before success. Register Three + GLTFLoader coherently. Keep preview and canvas errors visible with Retry. Supported published-source imports must remain standard imports, with installed/pinned dependencies or verified import maps appropriate to their execution host.

- [ ] RED tests: dynamic import('three'), GLTFLoader and Spline resolve through the registry; concurrent requests share one load; failed request can retry; static dependency compilation waits/mounts after ready; absent library produces visible error; preview sandbox shares support. Tests mock network module importer, not the whole compiler.
- [ ] Inspect dependency host resolution. Prefer bundled lazy imports with declared pinned package versions, rewritten eval-code import expressions calling an injected async module resolver. If adding npm dependencies is required, ask coordinator to prepare worktree-local node_modules; never mutate shared node_modules. Native dynamic imports in published TSX remain supported by corresponding build dependency configuration.
- [ ] Make preload/compile readiness explicit via a wrapper that awaits dependencies and renders loading/error/retry, or keep built-ins' await import through injected registry with controlled error/retry. Remove premature loaded flags/fire-and-forget loaders.
- [ ] For Spline cameraX/Y, only implement against a verified public runtime API. If no supported per-camera API is available, remove these two controls/destructured no-op props, preserving sceneUrl and styling. This is the report's approved fallback; do not invent API calls. Test that visible controls all affect behavior or are removed.
- [ ] Spline must also satisfy the newly exposed CANVAS_FILL_FEEDBACK oracle rule using explicit fill canvas sizing. Do not weaken oracle. Spline load replacement/unmount must dispose pending/failed Application instances; add Retry and fixture tests. Run optional-loader/compiler/sandbox/Spline/template tests, TypeScript and all builds; review.

### Task 9: Working Library duplication

**Model:** gpt-6-sol, medium. **Stage:** 4. **ID:** AUD-15.

**Files:** src/editor/left-toolbar/panels/LibraryPanel/sections/ComponentsSection.tsx, src/code/components/component-ops.ts or a focused duplicate helper; tests beside helper/UI. Reuse existing naming/ID/metadata helpers.

**Interfaces:** Both design/code Duplicate actions create a new distinct Library master, preserve source/metadata/variants/slots and dependencies, choose a unique file/internal name, and reveal/select the new copy using existing Library/editor navigation. Design node IDs are remapped consistently inside JSX and associated variant/slot/style references. No overwrite of existing files.

- [ ] RED helper/UI tests: code/design menu click creates new master; duplicate twice produces unique names; design IDs and internal references remap; metadata/variants/slots remain valid; dependencies still import; one undo removes copy and redo restores; backend sees copy after debounce/reload.
- [ ] Search for existing clone/name/ID APIs; assemble duplicate transform using AST/shared helpers. Flush queue before reading source; validate generated design TSX before writing new file; use existing project create transaction/history/autosave and clear caches/version. Replace both TODO handlers with this operation, catch refusal and show existing error UI.

```ts
expect(projectFS.exists(copyPath)).toBe(true);
expect(new Set(originalIds).intersection(new Set(copyIds)).size).toBe(0);
// Use a portable Set overlap assertion if the TS target lacks intersection().
expect(canUndo()).toBe(true);
```

- [ ] Related Library/component/history suites + TypeScript; review. Coordinator then runs full suite/builds and whole-branch review and records final checkpoint SHAs.

## Completion log

- Stage 0: plan created against latest user commit; TypeScript passes. Baseline: 12,992 tests pass; one oracle inventory test fails for the four newly registered components. This is explicitly assigned to Tasks 6 and 8; oracle stays strict.
- Task 1–9: pending.
