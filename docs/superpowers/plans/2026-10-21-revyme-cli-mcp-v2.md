# Revyme CLI/MCP v2 — повний Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement task-by-task. Цей документ замінює вузький MVP-план. Проміжний page/card flow не є завершенням. Поточне завдання — планування; реалізація продукту ще не починалася.

**Goal:** Готовий CLI/MCP охоплює всі активні можливості Revyme для створення, редагування, перевірки та випуску повноцінних landing pages і сайтів у підтримуваних середовищах.

**Architecture:** Один headless operation registry/planner поверх наявних parser/generators/Oracle/runtime, explicit project/branch/file scope, deterministic ingestion і revisioned commit service. CLI та stdio MCP — adapters того самого executor. Browser потрібен для preview/GUI observation/plugin UI; source authoring працює без відкритої вкладки. Existing editor saves та in-app agent використовують спільний durable revision contract.

**Tech Stack:** TypeScript, Node >=22, наявні Babel/Zod/MCP SDK, Node `util.parseArgs`, Vitest, Playwright та поточні export/build/runtime dependencies. Не створювати новий scene graph або другий React runtime. Нові бібліотеки додаються лише після перевірки наявних helpers.

**Spec:** `../specs/2026-10-21-revyme-mcp-full-coverage.md` — актуальна spec та матриця C01–C37. Поіменний baseline: `../research/2026-10-21-revyme-capability-inventory.json`. Аудит: `../research/2026-10-21-webstudio-revyme-mcp-audit.md`. Попередні `*-mvp-reference.md` і `*-architecture-reference.md` історичні й не обмежують цей scope.

## Global Constraints

- TSX — джерело істини; візуальна модель похідна й не стає окремим persisted scene graph.
- Canvas DOM не є write API. Existing editor mutations використовують queue/modifyProjectFile; headless mutations — новий shared commit service.
- Headless authoring не читає active-tab atoms, DOM caches або singleton ProjectFS. Кожна operation має явні project/branch/file та revision.
- Порожній style string означає видалення. Breakpoints беруться з проєкту. Published behavior використовує `@revyme/runtime`.
- IDs/imports/component wrappers/variant scaffold обслуговує білдер. Ingestion не змінює semantics, component kind, CSS cascade чи accessibility здогадкою.
- Кандидат нормалізується до перевірки; commit записує exact validated bytes. Multi-file зміни атомарні, operationId повторюється без дублювання.
- Зберегти traces, manual edits і наявні незакомічені зміни користувача. Результати наявного аудиту звірити з baseline під час реалізації.
- Source validity, durable commit, GUI editability, build result і visual evidence — окремі статуси. Unavailable не означає passed.
- Production-проєктів і вимоги підтримувати старих зовнішніх MCP клієнтів немає. Після збереження baseline прибрати старий external MCP без correctness fixes, compatibility aliases, подвійного writer mode чи поступового cutover. Спільний transport внутрішнього агента зберегти до його окремої адаптації.
- Cloud/service capabilities мають configured-adapter acceptance. Local/mock tests не доводять cloud readiness; permissions і closed-source policy не обходяться.
- Publish/deploy/listing publication/реальні зовнішні submissions виконуються лише за прямою командою користувача; acceptance використовує власні fixture endpoints.
- Завершення вимагає покриття всіх active authoring capabilities C01–C37. `UNSUPPORTED_CAPABILITY` не закриває активну feature у фінальному coverage report.

## Review Focus

1. Дві вкладки, CLI та in-app agent пишуть stale snapshot: один revision authority, відмова від clobber — T02,T04,T21,T25.
2. Commit відбувся, transport упав: receipt/idempotency/recovery без duplicate або false failure success — T04,T05,T25.
3. Variants/slots/CMS/locales/code controls виглядають правильно, але GUI не може їх редагувати: кожна feature має read-edit-save-reload і runtime acceptance — T09–T20,T24.
4. Нормалізація змінила units/cascade/list semantics чи старі IDs: preservation/fixed-point tests і contextual diagnostics — T03,T07,T25.
5. Зовнішні assets/fonts/API, browser/GPU або runtime не готові: provenance/revision/readiness, без удаваних screenshots/placeholder success — T08,T11–T14,T17,T22–T24.

## Обсяг і контроль повноти

На дату плану інвентаризовано **172 unique registered agent tools, 175 Mutation types, 114 SDK method declarations, 33 public MCP tools і 14 named bridge methods**. Це поверхні з перетинами; не рекламувати їх суму як кількість features. Кожний baseline запис має ownerTask у JSON; tools/mutations також мають acceptanceId, bridge methods — action inventory. Додаткові UI-only можливості охоплено матрицею C01–C37 у spec.

У T01 додати leaf entries для всіх actions/enum values/prop types/control modes/viewport scopes. Для кожного рядка вести `planned → implemented → contract_verified → gui_verified → runtime_verified`. Conditional environment окреме поле; failed/unavailable не перетворюється на verified. Public operations можна об'єднувати; приховано викидати можливості заборонено.

Видалені sketch sets/GSAP та фактично неготові export formats не відновлювати автоматично. Active vector/path/sketch animation лишаються у scope. Pure UI gestures мають semantic equivalent або UI adapter. Account billing/admin provisioning не входять у site-authoring scope; існуючі access/readiness reads зберігаються.

## Файлова карта

| Шлях | Відповідальність |
|---|---|
| `packages/automation-core/src/{contracts,registry,session,plan,validate}.ts` | Runtime schemas, explicit snapshots, candidate files, final validation |
| `packages/automation-core/src/ingestion/` | Tree/static JSX adapters, IDs/styles/units/list recipes, report/source map |
| `packages/automation-core/src/operations/` | Domain operations T06–T22 поверх shared pure transforms |
| `packages/automation-core/test/{fixture,coverage}.ts` | Fixture seed factories, contract/source assertions, coverage reporter |
| `packages/automation-core/test/capabilities/Txx-*.test.ts` | Тести кожного domain і leaf cases |
| `server/automation/{project-repository,commit-service,api,standalone}.ts` | Atomic revisioned persistence та API без Vite/browser |
| `server/automation/adapters/` | Assets/fonts/CMS/plugin/network/cloud/export/preview providers |
| `packages/cli/src/{main,client,config,mcp}.ts` | CLI і stdio SDK поверх одного API/registry |
| `packages/cli/test/` | Protocol/CLI parity, packed binary, cancellation, recovery |
| `e2e/automation-v2/` | GUI round-trip, interactions, acceptance sites L01–L04 |
| `evaluations/automation-v2/` | Scenario briefs, deterministic validators, metrics/evidence |

Не копіювати всі старі tools у `operations/`: виділяти потрібні чисті transforms і зберігати сумісні старі exports. Stateful browser wrappers залишаються wrappers над спільними функціями.

## Спільні інтерфейси

```ts
type Scope = { projectId: string; branchId: string; filePath?: string };
type Snapshot = { scope: Scope; revision: number; files: ReadonlyMap<string,string>; config: Readonly<Record<string,unknown>> };
type FileChange = { path: string; beforeHash: string | null; content: string | null };
type Issue = { code: string; path: Array<string|number>; message: string; source?: { file: string; line: number } };
type Plan = {
  scope: Scope; baseRevision: number; operationId: string;
  changes: FileChange[]; createdIds: string[]; policyVersion: string;
  planHash: string; issues: Issue[]; normalizations: Array<{ rule: string; target: string; before: string; after: string }>;
};
type Receipt = { operationId: string; projectId: string; branchId: string; revision: number; planHash: string; changedFiles: string[] };
type Operation<I,O> = {
  name: string; inputSchema: unknown; outputSchema: unknown;
  kind: 'read'|'mutation'|'observation'|'service';
  permit: string; environment: 'headless'|'browser'|'service';
  execute(snapshot: Snapshot, input: I, context: OperationContext): Promise<O>;
};
type OperationContext = {
  createId(kind:string):string; signal:AbortSignal;
  trace(event:string,data:Record<string,unknown>):void;
  adapters: Readonly<Record<string,unknown>>;
};
type Result<T> = {
  ok: boolean; data?: T; error?: { code:string; message:string; issues:Issue[] };
  meta: { commitStatus:'not_committed'|'committed'|'unknown'; revision:number; receipt?:Receipt };
};
```

Під час реалізації `inputSchema/outputSchema` типізувати Zod generics; domain adapters — окремими typed interfaces. `prepare(snapshot,name,input,context)` виконує supported operation у candidate map; `validate(before,plan)` перевіряє фінальні bytes; `commit(plan)` — лише durable write; `status(projectId,operationId)` уточнює ambiguous commit. File mutations вимагають filePath; project-wide operations — declared read/write scope. Нема implicit active-file fallback.

T01 створює `runCase({seed,steps,expect})` у `test/fixture.ts`: seed=`empty|landing|complete`, steps містять `{tool,input}`, expect — literal source/parsed values, issues, revisionDelta та unchanged paths. Helper читає persisted snapshot заново, запускає parser і порівнює очікування. Він не mock-ає generator/Oracle. Для negative cases перевіряється незмінність усіх project files. Browser/service cases мають окремі adapters/evidence, не видають Node fixture за GUI test.

## Порядок робіт

T01 зберігає baseline; T02 прибирає старий external MCP. T03–T05 — ingestion, persistence, нові CLI/MCP. T06–T23 — обов'язкові domain slices з власними acceptance. T24 працює інкрементально після появи кожного domain. T25 закриває full parity та launch readiness нового MCP. Кожен task завершується targeted tests, typecheck і окремим commit. До production release застосовуються всі фінальні gates, навіть якщо проміжний landing уже виглядає готовим.

## T01: Інвентаризація, leaf coverage та operation contracts

**Files:** New core package/config, `src/{contracts,registry,session}.ts`, `test/{fixture,coverage}.ts`, `test/capabilities/T01-contracts.test.ts`; `scripts/automation-inventory.cjs`, `docs/automation/coverage.json`; modify root package/test/tsconfig discovery.

**Consumes/produces:** Consume inventory baseline/spec C01–C37; produce versioned registry, canonical names/feature-equivalence mapping, typed Snapshot/OperationContext, coverage data і `runCase`. Baseline фіксується до видалення old external implementation; mapping потрібний для повноти можливостей, а не backward-compatible API.

- [ ] Написати tests для registry uniqueness, input/output schema equality із published discovery, all 172 tools/175 mutations mapped, missing owner/test leaf → coverage failure. SDK retired/UI-only classifications потребують source-backed reason.
- [ ] Розкласти UI/API actions і enums на leaf cases: усі styles controls, props types, motion scopes, form destinations, CMS fields/config, export formats. Перевірити fields у sources, не покладатися лише на tool name.
- [ ] Реалізувати `meta.index`, `meta.tools`, `meta.guide`, schema-derived examples/pagination/compact output. Unknown tool дає near matches; schema issue містить точний input path.
- [ ] Node entrypoint не імпортує editor/canvas/store singletons; dependency-boundary test перевіряє транзитивний graph. Logger/ID factory injected.
- [ ] Run: `npx vitest run packages/automation-core/test/capabilities/T01-contracts.test.ts`; core build/typecheck. Expected: schema mismatch і unmapped new source entry блокують check. Commit T01.

## T02: Прибрати старий external MCP без його ремонту

**Files:** Remove old external launchers `server/mcp-server.ts`, `server/run-mcp.sh`, `scripts/mcp-bridge-server.ts`, public dispatcher/schemas/help у `server/mcp-bridge.ts` та `server/mcp-help.ts`; update `server/api-plugin.ts`, root package scripts/README/repository MCP registrations і відповідні tests. Зміни `src/ai/mcp/bridge-client.ts`, `src/ai/agent/bridge-tools.ts` лише після перевірки shared callers.

**Consumes/produces:** T01 inventory + archived probes + caller map → old external MCP disabled/removed, shared editor/in-app functionality preserved. Жодних нових bug fixes чи features у старому зовнішньому API.

- [ ] Перед видаленням зберегти source inventory, dependency/caller map, probe outcomes і test fixtures як історичний baseline у Git/docs. Наявні source changes користувача не відкидати через reset; переглянути diff і зберегти потрібні shared зміни.
- [ ] Test old stdio launcher/public tools registration більше не доступні; dev/preview server не запускає старий external MCP port чи public dispatcher. Прибрати відповідні imports/hooks у `server/api-plugin.ts`, зберігши project storage/local-server API.
- [ ] Відокремити зовнішній MCP від transport, потрібного `src/ai/agent/agent-client.ts`: in-app service виконує tools через browser bridge. Зберегти потрібні `agent.*` callbacks, run/checkpoint/history/Stop і observer; за необхідності винести їх у внутрішній adapter без public MCP tool surface. Private in-app transport не рекламується як готовий v2 MCP.
- [ ] Не ремонтувати старі `isError`, broadcast чи screenshot wrappers: їхні failure cases перенести в acceptance нового executor/MCP/observer T04,T05,T24. Старий `create_navbar` не переносити у v2; його safe recipe реалізує T10. Якщо цей tool лишається доступний in-app, окремо закрити shared direct-write invariant без відновлення old external API.
- [ ] До T05 зовнішній MCP може бути недоступний — це свідомий development interval, а не привід тримати другий writer. Після T05 новий інтерфейс оголошує фактично готові capabilities; full-ready claim лише після T25.
- [ ] Run API/plugin startup, project storage, internal bridge/run lifecycle/observer tests та removal assertions. Expected: external MCP прибраний, editor та внутрішній агент не втратили своїх dependencies. Commit T02.

## T03: Candidate planner, ingestion та незалежна валідація

**Files:** Core `src/{plan,validate}.ts`, `src/ingestion/{tree,jsx,ids,styles,units,lists,report}.ts`, `test/capabilities/T03-ingestion.test.ts`; adapt pure parser/generation/oracle/shared helper exports.

**Consumes/produces:** Snapshot+typed intent/static JSX → exact-byte Plan, source map, generated IDs, mechanical normalization report.

- [ ] Failing cases: missing IDs safe nodes, transparent wrappers/rich-text, duplicate explicit IDs, wrong parent, unknown component, unresolved import, old/new identical diagnostic code на різних elements.
- [ ] Test units: fixed root16 `1.5rem→24px`, root20→30px, unknown root→context issue; element vs parent font для em. Shorthand order/empty deletion/responsive layers/complex values не змінюють intent.
- [ ] List lowering має roles/markers/nesting/ordered list semantics або targeted refusal всього recipe; no partial conversion. JS expressions не виконуються ingestion; component kind не перевизначається.
- [ ] Final import sync/normalization перед Oracle; normalization idempotent і з bounded passes. IDs стабільні при retry; незмінені files byte-identical. Перевірити created IDs і values fresh parser, runtime imports і dependency closure.
- [ ] `workflow.batch` планує atomic file set; `workflow.chain` має explicit per-step receipts і status. Compensation не відновлює старий snapshot поверх сторонньої новішої revision; зовнішні side effects не обіцяються rollback-able.
- [ ] Run: `npx vitest run packages/automation-core/test/capabilities/T03-ingestion.test.ts` та changed parser/Oracle/helper suites. Commit T03.

## T04: Canonical repository, CAS/idempotency та editor save

**Files:** New `server/automation/{project-repository,commit-service,api,standalone}.ts` і tests; adapt `server/{storage,api-plugin}.ts`, `src/backend/{types,local-backend,autosave,save-revision}.ts` і cloud adapter boundary.

**Consumes/produces:** Validated Plan → durable Receipt; common revision authority для CLI/editor/in-app agent. ProjectData main/branches envelope зберігається.

- [ ] Tests: concurrent base7 commits → один rev8 і conflict; repeat same operationId/hash → same receipt; different hash → conflict; stale plan → no write; crash до/після rename → whole old/new record.
- [ ] Receipt/source/revision committed разом; bounded retention має tombstone/expired response без повторного execution. Read/status після lost reply не створюють new IDs.
- [ ] Project/branch permissions, protected paths, asset staged references, scoped lock, atomic durable replace. Commit не змінює validated bytes. Restore/branch apply створюють нову revision.
- [ ] Editor loaded7 → CLI saved8 → old editor autosave refused зі local recovery copy. Усі project-source replacement endpoints мігрують на CAS; старі writers не мають blind-save bypass.
- [ ] Local і cloud repository implementations мають однакові contracts; cloud backend відсутній тут — реалізація/перевірка adapter в потрібному repo обов'язкова перед cloud readiness claim.
- [ ] Run repository/API/fault-injection tests та existing storage/backend/autosave suites. Commit T04; не включати v2 writes на project із немігрованим writer.

## T05: Packed CLI та stdio MCP зі спільним executor

**Files:** New `packages/cli/{package.json,tsconfig.json,bin/revyme.mjs}`, `src/{main,client,config,mcp}.ts`, `test/{cli,mcp,parity,pack,recovery}.test.ts`, `docs/automation/cli.md`.

**Consumes/produces:** Registry/API → `revyme <tool> --input-file`, `revyme mcp`, identical structured results.

- [ ] Tests: init/project link, doctor/version/capabilities, paths із кирилицею/spaces, JSON stdin/file, invalid flags/input, stdout JSON і nonzero failure. Credentials не серіалізуються у source/config artifacts.
- [ ] `--dry-run` повертає plan/diff; `plans.commit` застосовує незмінний planHash/baseRevision. No-op/dry-run явно not_committed. Names aliases one-to-one, schema recursion підтримана.
- [ ] Official SDK in-memory та stdio tests: error flags/structuredContent, paged discovery, progress logging/cancel, two projects, timeout/status і resumed session. Жодного silent fallback у legacy `/rpc`.
- [ ] `npm pack` installed-bin smoke поза repo/root node_modules/tsx із temporary API і без browser. Registry schemas/help/examples однакові в CLI/MCP.
- [ ] Run CLI tests, package build/typecheck і pack smoke. Commit T05.

## T06: Pages, templates, routes, metadata та SEO

**Files:** Core `src/operations/{pages,templates,metadata}.ts`, `test/capabilities/T06-pages.test.ts`; reuse `active-file-store`, `template-ops`, `page-folders`, `metadata-gen`, `template-route-gen`, providers.

**Interfaces:** `pages.list/create/update/duplicate/remove`, `templates.list/create/update/assign/remove`, `metadata.read/update`; delete/replace за intent, без active page remap.

- [ ] Case: create `/` і `/about`, shared layout, header/footer, assign/unassign, change slug/title/social/favicon, duplicate і remove page. Assert exact files/routes і `{children}` slot рівно один.
- [ ] Tests route/group/folder collisions, homepage/default layout preservation, import path updates, locale/CMS route dependencies. Metadata не зберігається у випадковому JSX node.
- [ ] GUI Pages/Template panels читають результат і редагують його; export routes/metadata відповідають source. Run `npx vitest run packages/automation-core/test/capabilities/T06-pages.test.ts` плюс page/template regression. Commit T06.

## T07: Structure, layout, responsive, text та всі Style controls

**Files:** Core `src/operations/{nodes,layout,styles,text,viewports}.ts`, `test/capabilities/T07-layout.test.ts`; reuse generator-crud/styles/attrs, breakpoint-ladder, responsive attrs/text, layout/grid/position helpers і pure paste-engine dependency/ID mapping.

**Interfaces:** Nodes CRUD/move/reorder/duplicate/wrap/free-canvas; layout/size/pins; style read/set/remove; rich text; viewport CRUD і overrides.

- [ ] Case: 100-node hero/grid, mobile reordering/text override, absolute/sticky child, hug/fit/fixed sizes, grid areas, move/duplicate/remove. Assert fresh parsed tree, source values і unchanged siblings.
- [ ] Параметризувати весь StylesTool control inventory: fills/gradients/borders/pseudo, shadows/filters/masks/clip, transforms/3D, visibility/overflow/pointer. Кожен leaf: set→read→GUI edit→remove у base/breakpoint/variant, де підтримано.
- [ ] Test responsive start/end mapping зі custom widths, primary viewport, override/reset inheritance; зберегти `''` deletion і CSS declaration order.
- [ ] Cross-page copy/paste переносить component/assets/effects/bindings dependencies, remap-ить потрібні IDs/references і не дублює shared master. Paste integration tests із CMS/variables/locales/motion додаються при готовності відповідних domains перед T25 gate.
- [ ] Rich text marks/links/inline runs не стають випадковими structural nodes. Run `npx vitest run packages/automation-core/test/capabilities/T07-layout.test.ts` та generator/parser tests. Commit T07.

## T08: Tokens, presets, themes, typography та fonts

**Files:** `src/operations/{tokens,presets,fonts,typography}.ts`, `test/capabilities/T08-design-system.test.ts`; reuse preset-ops/gen, typo-preset-gen, font-preload, next-font-gen, library preset/folder helpers; font adapter.

**Interfaces:** Token/preset CRUD/rename/usage, dark values, typography presets/apply, font catalog/import/apply, theme config.

- [ ] Case: brand tokens + heading/body presets, light/dark, variable font weights, fit/stroke/line-height, renamed token updates references. No unknown var references; removing used token requires explicit replacement/refusal.
- [ ] Tests color/typography/border/asset presets, folders, theme inheritance, workspace/local/Google fonts, failed downloads. Font bytes/weights/license metadata availability виходять із provider, не вигадуються.
- [ ] GUI controls/Inspector і export bundled fonts перевірені. Run `npx vitest run packages/automation-core/test/capabilities/T08-design-system.test.ts`, preset/typography regressions. Commit T08.

## T09: Design components, props/variables та instances

**Files:** `src/operations/{components,component-props}.ts`, `test/capabilities/T09-components.test.ts`; reuse create/extract/replace-component-gen, component-ops/spec/controls-parser, variable-ops і responsive instance props.

**Interfaces:** Component create/extract/update/replace/detach, instance create/props, prop schemas/defaults/labels/options/ranges, component variables/hoist/rename/delete/cascade.

- [ ] `buildCreatedMaster` генерує variantConfig/defaults/propMeta/IDs/export. Case Card з title/image/link/price + два instances; зміна master і instance overrides не руйнує іншого.
- [ ] Параметризувати всі supported prop/variable types: text/formatted/color/image/link/cursor/style/transition/typed values та responsive bindings. Label/description/enum/range і defaults збігаються з Inspector.
- [ ] Extract/detach/replace, rename/remove/hoist variable оновлюють залежності, imports і variant branches. Наявний master не overwrite-иться create; kind не downgrade-иться потай.
- [ ] Atomic master+consumer failure leaves no files. Run `npx vitest run packages/automation-core/test/capabilities/T09-components.test.ts`, component/variable regressions і GUI read-edit-save-reload. Commit T09.

## T10: Variants, connections, overlays та navigation

**Files:** `src/operations/{variants,connections,overlays,links}.ts`, `test/capabilities/T10-interactions.test.ts`; reuse variant-ops/config, instance-event-gen, overlay/close-overlay-gen, links/attrs.

**Interfaces:** Variant CRUD/visibility/state overrides, typed connections/events/delays, overlay create/update/trigger/close, link route/anchor/params/target/rel/prefetch.

- [ ] Case Navbar desktop/mobile + drawer variants, click open/close, nested link, delay і escape/focus handling. Recipe використовує shared operations, без privileged raw Navbar write.
- [ ] Test hover/tap/click state transitions, event prop connections, invalid/deleted target cleanup, responsive state overrides, tooltip/modal position і top-level portal rules.
- [ ] Зберегти links smooth anchor, slug/query params, rel/new-tab/prefetch і CMS nav refs. Run `npx vitest run packages/automation-core/test/capabilities/T10-interactions.test.ts` та browser interaction tests. Commit T10.

## T11: Увесь built-in catalog, sections та slots

**Files:** `src/operations/{catalog,built-ins,sections,slots}.ts`, `test/capabilities/T11-catalog.test.ts`; extract pure descriptors/templates з project-fs і sections-library, reuse slot-children/slot-ops.

**Interfaces:** Focused catalog find/get, install/place/configure, section recipes, slot list/connect/disconnect/reorder.

- [ ] Registry-driven tests для кожного current built-in entry: install потрібних files/imports, valid defaults/controls, placement і supported slot structure. Не покладатися на приблизну кількість у коментарях.
- [ ] Case testimonials Carousel/Marquee з required items як slots; connect/reorder/disconnect відображається однаково у canvas/export. Generic inline children для slot-only component відхиляються до commit з recipe.
- [ ] GPU/network-dependent entries мають явний test profile/readiness; unavailable не вважається runtime-verified. Run `npx vitest run packages/automation-core/test/capabilities/T11-catalog.test.ts`, catalog GUI/runtime smoke. Commit T11.

## T12: Media, assets, search, uploads та fills

**Files:** `src/operations/{assets,media}.ts`, server `adapters/{assets,media-search}.ts`, `test/capabilities/T12-assets.test.ts`; reuse backend asset APIs, image-utils/export constants, generator-video.

**Interfaces:** Asset list/search/upload/import/replace/delete/reference audit, image/alt/fit/crop/optimization, video/audio/poster/background fills, supported embed/3D props.

- [ ] Case реальна local image + hero video poster/background + audio/embed instance. Validate bytes/hash/MIME/dimensions, stable project URL і packaged references; failed fetch не створює broken placeholder.
- [ ] Delete/replace used asset має ref checks; multi-upload staged до source commit, unused staging cleanup окремо. Scoped credentials/closed-source/role policy збережені.
- [ ] Test object-fit/position, srcset/image sizes, CMS image config, playback flags/fallback і Image/Video/Audio GUI controls. Run `npx vitest run packages/automation-core/test/capabilities/T12-assets.test.ts` плюс provider/asset packaging tests. Commit T12.

## T13: Vectors, SVG shapes, path і active drawing

**Files:** `src/operations/{vectors,shapes,drawing}.ts`, `test/capabilities/T13-vectors.test.ts`; reuse code/icons, svg mutations, shape/sketch helpers, sketch-anim-gen.

**Interfaces:** Icon search/import, vector-set CRUD/items/variants/order, SVG attrs/path/viewBox/fill/stroke/masks, supported drawing/path transforms і draw animation.

- [ ] Case custom icon set + editable SVG/path + sketch draw effect. Source має stable shape IDs; group/child fills/viewBox/fit і path edit працюють у GUI/export.
- [ ] Tests remove/rename icon refs, vector folder/import/export, masks/clipping/shape hierarchy та animation cleanup. Retired sketch-set RPC зберігає retirement reason, не удавану create success.
- [ ] Run `npx vitest run packages/automation-core/test/capabilities/T13-vectors.test.ts`, svg/icon/sketch regressions і targeted shape E2E. Commit T13.

## T14: Повне motion/scroll/text/site effects покриття

**Files:** `src/operations/{motion,text-effects,site-effects}.ts`, `test/capabilities/T14-motion.test.ts`; reuse generator-motion*, text-anim-gen, scroll-variant-gen, instance-fx/event helpers, smooth-scroll/page-transitions/cursor/glide generators.

**Interfaces:** Motion set/get/remove за trigger/scope/breakpoint/variant, transitions/keyframes/presets, text effects; smooth scroll, page effects/masks, cursor, Glide.

- [ ] Catalog-driven cases для hover/tap/appear/loop/scroll transform/speed/direction/variant, instance FX і text presets. Read/update/remove та combinatorial scope checks не гублять іншого effect.
- [ ] Case hero appear + card hover + metrics counter + scroll text + cursor + smooth scroll + template page transition. Не застосовувати всі effects до одного node для формального coverage.
- [ ] Export/runtime wiring, layout/provider/cursor portals, reduced-motion policy, breakpoint/variant semantics і cleanup після remove перевірені. Retired GSAP не відновлюється.
- [ ] Run `npx vitest run packages/automation-core/test/capabilities/T14-motion.test.ts`, motion regression та interaction/scroll screenshots із exact revision. Commit T14.

## T15: Page variables, expressions, bindings та page interactions

**Files:** `src/operations/{variables,expressions,page-interactions}.ts`, `test/capabilities/T15-bindings.test.ts`; reuse page-variables/interactions-gen, expression-gen, responsive style/text/props bindings.

**Interfaces:** Page variable CRUD/default/type, fx bind/unbind text/style/src/href/props, responsive base/override, page interactions/scopes.

- [ ] Case shared CTA label/url variable, computed price/title, responsive text/style binding і click-driven variable update. Fresh parser/Variables panel значення збігаються.
- [ ] Tests undefined scope/type, variant/form/CMS context, name collision, rename/delete cascading, orphan cleanup і literal-vs-expression meaning. No evaluated arbitrary authoring JS.
- [ ] Run `npx vitest run packages/automation-core/test/capabilities/T15-bindings.test.ts`, page-variable/expression/interaction regressions і published behavior. Commit T15.

## T16: Local CMS, schema/items/lists/detail pages

**Files:** `src/operations/{cms-schema,cms-items,cms-bindings,cms-pages}.ts`, `test/capabilities/T16-cms.test.ts`; reuse cms-ops/gen/page-ops/root-mount/seo/field configuration.

**Interfaces:** Collections/fields/items CRUD/order/duplicate, local translations, list source/bind/unbind text/image/link/props/styles, filters/sort/limit/pagination, index/detail pages/slugs.

- [ ] Case case-studies collection з усіма current field types, 5 items, filter/sort/pagination, cards → detail routes і SEO. CMS item edit через UI змінює persisted source/data й preview після reload.
- [ ] Tests rename/remove field/collection cascade, empty/missing values, date/image semantics, translated item, responsive list settings, CMS nav, page route conflicts і orphan cleanup.
- [ ] All file/schema/data changes atomic; detail static params/export dataset references правильні. Run `npx vitest run packages/automation-core/test/capabilities/T16-cms.test.ts` і CMS UI/build acceptance. Commit T16.

## T17: External API CMS, query/search/revalidation

**Files:** `src/operations/cms-api.ts`, server `adapters/cms-api.ts`, `test/capabilities/T17-cms-api.test.ts`; reuse cms-api-config, cms-page-ops server fetch/export transforms, list query/search generation.

**Interfaces:** Local/API mode, API collection CRUD URL/method/headers/itemsKey/query expressions, pagination/search/filter params, image/revalidation config.

- [ ] Own fixture API повертає nested data + pagination; case list search/query expressions → page navigation → reload/export/preview з тим самим результатом.
- [ ] Test timeout/auth failure/schema mismatch/empty response/item key detection/credential redaction. Unknown response не «ремонтується» hardcoded mock content.
- [ ] Local→API→local transitions зберігають explicit source і field schema; server-only credentials не потрапляють у shipped client code. Run `npx vitest run packages/automation-core/test/capabilities/T17-cms-api.test.ts` і fixture API build test. Commit T17.

## T18: Локалізація, locale routes, RTL і fallback

**Files:** `src/operations/{locales,translations}.ts`, `test/capabilities/T18-i18n.test.ts`; reuse locale/translation-ops, i18n/locale-gen, locale-route-ops, CMS locale helpers.

**Interfaces:** Locale CRUD/default/fallback/direction, text/attr/prop/SEO/CMS translations, locale routes і switcher.

- [ ] Case Ukrainian/English landing + RTL test locale, translated placeholders/alt/CTA/component props/CMS item/page metadata, shared layout і language switcher.
- [ ] Test missing locale/fallback, default switch/remove, existing route collision, responsive localized overrides і branch isolation. Не підміняти перекладом code variable names.
- [ ] Run `npx vitest run packages/automation-core/test/capabilities/T18-i18n.test.ts`, localization regressions та three-locale GUI/export routing acceptance. Commit T18.

## T19: Forms, inputs, destinations і states

**Files:** `src/operations/{forms,form-fields,form-states}.ts`, server `adapters/forms.ts`, `test/capabilities/T19-forms.test.ts`; reuse form fields/gen/submit/state та Form/Input config.

**Interfaces:** Form create/config, усі supported field types/options/labels/defaults/validation, destination CRUD, submit button/handler, state mappings.

- [ ] Case contact form name/email/select/message із accessible labels, required rules, own fixture destination, loading/success/error UI, honeypot і retry recovery.
- [ ] Параметризувати реальні destination/field types з чинного config; не обіцяти file upload/provider, якого product не підтримує. Select caret/icon source і CSS config узгоджені.
- [ ] Перевірити form handler/runtime route, payload, double-submit behavior і translated labels/states; реальні листи/зовнішні submissions не надсилати в tests.
- [ ] Run `npx vitest run packages/automation-core/test/capabilities/T19-forms.test.ts` та browser submit/destination/state acceptance. Commit T19.

## T20: Code components, overrides, raw files, global code і redirects

**Files:** `src/operations/{code-components,code-files,overrides,custom-code,redirects}.ts`, `test/capabilities/T20-code.test.ts`; reuse controls-parser/runtime compile adapter, code-override-gen, sdk custom-code/redirects storage semantics і source gate.

**Interfaces:** Explicit code component create/update, valid controls/schema/defaults, full-file guarded changes/search, override author/apply/list/remove, global injection locations, redirect CRUD/order.

- [ ] Case controlled interactive widget із typed props + override applied to native node; Inspector змінює кожен control/default і values зберігаються. Kind і editable internals report явні.
- [ ] Test malformed controls/import/export/render, unsupported dependencies, closed-source/protected path policy і batch dependency resolution. `@controls` не є gate bypass.
- [ ] Global custom code/head/body locations і redirects order/locales мають export/runtime fixtures. Redirect loops/unsafe path conflicts не приховуються, existing script content не губиться.
- [ ] Run `npx vitest run packages/automation-core/test/capabilities/T20-code.test.ts`, code/override compile і standalone exported runtime tests. Commit T20.

## T21: Project lifecycle, files/folders, branches, history, comments і guides

**Files:** `src/operations/{projects,folders,branches,history,comments,guides}.ts`, server repo/version adapters, `test/capabilities/T21-projects.test.ts`; reuse ProjectData v2, branch tools, file-diff/history, *-folder-ops, comments/ruler configs.

**Interfaces:** Project lifecycle/import/backup, organization, branch CRUD/review/apply, snapshots/undo/redo/restore, comment/thread anchors і guide config.

- [ ] Case duplicate/import project with assets/branches, move library items між folders, branch change/review/apply, backup/restore і source diff. MAIN лишається export truth; stable IDs/imports збережені.
- [ ] Undo/restore є новим versioned commit; якщо після agent operation є чужий edit, CAS conflict або scoped inverse plan, без rewind цілого чужого snapshot.
- [ ] Test merge conflict, viewer role, deletion references, open document changes, comment replies/anchor orphan state, guides persistence та collab stale-save behavior. Third-party team/admin provisioning не входить сюди.
- [ ] Run `npx vitest run packages/automation-core/test/capabilities/T21-projects.test.ts`, branch/history/backend regressions і multi-client scenario. Commit T21.

## T22: Plugins, marketplace, project skills і service access

**Files:** `src/operations/{plugins,marketplace,project-skills,access}.ts`, server `adapters/{plugins,marketplace,credentials}.ts`, `test/capabilities/T22-extensions.test.ts`; reuse plugin host/SDK/permissions, marketplace-client, library share, skills-config.

**Interfaces:** Plugin CRUD/install/launch/config/permissions/pluginData, current SDK contract mapping, marketplace find/import/update/link/share/listing actions, skills read/write, role/provider readiness.

- [ ] Own fixture plugin виконує scoped source operations через shared executor; UI methods/subscribe events мають browser adapter і lifecycle cleanup. Не обходити commit service через pluginData/codeFiles/assets SDK paths.
- [ ] Test network/secrets request/use/list/revoke/permissions: values не витікають у prompts/logs/source; server adapters виконують service policy. Mock suffices contract, configured service fixture потрібний для integration claim.
- [ ] Marketplace import pin/hash/version і remote dependency packaging; failed fetch не commits reference. Share/publish listing — explicit action, no automatic publication під час створення landing.
- [ ] Skills persist і discovery інтегровані; user/account read-only context не надає admin/billing permissions. Run `npx vitest run packages/automation-core/test/capabilities/T22-extensions.test.ts`, SDK/marketplace integration і fixture plugin E2E. Commit T22.

## T23: Export/build/preview/publish/domain/staging adapters

**Files:** `src/operations/{export,publish}.ts`, server `adapters/{source-export,preview,deployment}.ts`, `test/capabilities/T23-release.test.ts`; reuse source-export, export-project helpers, local-server, publish-preflight і existing cloud HTTP contracts.

**Interfaces:** Export supported formats/assets, build/serve preview, publish selected revision/update/status, staging/backup selection і domain metadata/config через supported service adapter.

- [ ] Case source export і source-SSG з runtime/fonts/media/remote components/CMS/locales/redirects/custom code; installed exported project builds/serves поза editor/source repo.
- [ ] Discovery formats випливають із фактичних readiness/plan permissions; Tailwind/service 501 не стає success. Export asset fetch failure має affected refs і failed status, а не ZIP з broken images.
- [ ] Publish preflight читає committed revision; own configured test deployment підтверджує live snapshot/build ID/domain/staging URL. Якщо cloud implementation поза repo — додати та перевірити той adapter там до cloud-ready gate, не емулювати вигаданий endpoint.
- [ ] Run `npx vitest run packages/automation-core/test/capabilities/T23-release.test.ts`, isolated build/SSG smoke і explicitly configured deployment acceptance. Commit T23. Реальна публікація користувацького сайту потребує прямої команди.

## T24: Observation, screenshots, GUI/runtime evidence і diagnostics

**Files:** `src/operations/{observe,verify,diagnostics}.ts`, server `adapters/{browser-observer,render-verifier}.ts`, `test/capabilities/T24-verification.test.ts`, `e2e/automation-v2/roundtrip.spec.ts`; reuse bridge caches/protocol і publish/static audit helpers.

**Interfaces:** Selection/rect/computed/layout/composition/audit/screenshot/effect checks, static/build/render reports, debug traces; exact project/branch/revision/viewport evidence.

- [ ] Read-only browser observer не має authoring allowlist. Parent frame не читає iframe DOM напряму; measurements через bridge або isolated preview runner.
- [ ] Tests: no browser, wrong project/revision, stale/partial coverage, fonts/assets pending, browser crash/GPU unavailable → pending/unavailable/failed без «layout clean».
- [ ] Кожний domain T06–T23 додає GUI read-edit-save-reload і applicable runtime test; звірити controls values та persisted source, не лише screenshot. Restore test values після control acceptance.
- [ ] Diagnostics artifacts містять source hashes/revision, canonical operation/input shape, codes і trace references; secrets/customer content не публікуються автоматично.
- [ ] Run `npx vitest run packages/automation-core/test/capabilities/T24-verification.test.ts`, targeted E2E на desktop/tablet/mobile і actual build smoke. Commit T24.

## T25: Повний landing, agent evaluations, документація та launch readiness

**Files:** `evaluations/automation-v2/{fixtures,runner,metrics,validate}.ts`, `e2e/automation-v2/{L01-landing,L02-dynamic,L03-visual,L04-lifecycle}.spec.ts`, `docs/automation/{coverage,cli,recipes}.md`, updated skill/README/new launchers/removal-regression tests.

**Interfaces:** Registry-driven workflows/recipes складаються з тих самих atomic operations, без другого writer. Acceptance L01–L04/spec C01–C37 та machine baseline визначають release.

- [ ] L01 побудувати через CLI і через MCP: fonts/theme/tokens; desktop Navbar/mobile drawer; hero з CTA/media; logo marquee; reusable feature cards; metrics; pricing variants; testimonials slots; FAQ; contact form; footer/SEO/social; три widths. Після цього користувач може змінити кожну intended editor-owned field.
- [ ] L02 додає local+API CMS/search/detail pages, locale switcher/translations/RTL/fallback/page variables; L03 закриває built-in/motion/vector/code controls catalog; L04 — project/branch/history/plugin/cloud profiles і failure recovery.
- [ ] Coverage gate: all active leaf rows implemented+verified, 172 tool entries/175 mutations mapped, all active SDK authoring surfaces covered. Internal/retired/UI classifications мають evidence; missing/unsupported active feature не зараховується як full parity.
- [ ] Deterministic gates: нуль wrong-project writes/partial commits/duplicate retries/false success/semantic preservation regressions. CLI/MCP plans/results equivalent за deterministic context.
- [ ] Agent evaluation 12 briefs × 3 runs на зафіксованій model/effort; окремий bounded ingestion on/off subset. Для порівняння використовувати історичний baseline, а за потреби old code — лише isolated historical checkout, без повернення його в основний runtime. Record first-pass accepted completion, bounces/repairs/tokens/time і visual/GUI/runtime outcomes. Target ≥90% first-pass і ≥95% після максимум двох corrections; counts/intervals і витрати явні, без обіцянки «будь-який сайт без помилок». Paid model runs — окремо погоджений execution budget.
- [ ] Короткий bootstrap `doctor → meta.index → exact schemas → plan/commit → verify`, examples generated/tested registry. Browser/plugin/service prerequisites видно одразу. Scope/capability changes versioned.
- [ ] Перевірити, що old external launchers/dispatcher/manual schemas/help вже видалені в T02, нові repository docs/configs посилаються тільки на v2 і немає hidden fallback. Personal client configs не змінювати без прямої вказівки користувача.
- [ ] In-app tools/renderer/history/observer залишаються, використовують shared save protocol; незалежного старого зовнішнього writer немає. Recovery нового MCP зберігає source/revision і не вмикає старий MCP автоматично.
- [ ] Final commands: `npx vitest run`, `npx tsc --noEmit`, package typechecks/builds, isolated `npm pack` smoke, full automation-v2 E2E, export/SSG builds, configured service acceptance. Pre-existing failures recorded separately; потрібні failure regressions не waive-яться.
- [ ] Зберегти release evidence і capability report. Package/deployment publication — окрема явна дія, не автоматична частина планування.

## Рішення щодо старого MCP

1. Уточнення користувача: production-проєктів немає. Потреби ремонтувати та підтримувати old external MCP на час переходу немає.
2. T01 фіксує inventory/evidence; T02 прибирає старий зовнішній MCP і repository registrations. До готовності нового допустимий період без зовнішнього MCP.
3. Не створювати `legacy|v2` project modes, compatibility aliases, fallback або migration framework. Existing test/demo project data не видаляються й формати ProjectData зберігаються.
4. Спільні parser/generators/Oracle/in-app tools, browser transport внутрішнього агента та canvas bridge не видаляються за назвою `mcp`; залишаються або відокремлюються за фактичними dependencies.
5. T25 перевіряє повне покриття нового MCP та відсутність повернення old dispatcher, а не відкладає його видалення до release. Незакомічені user changes зберігаються; remote/client settings поза repo не змінюються мовчки.

## Формула завершення

**Усі активні capabilities покриті + повний landing створюється CLI/MCP + GUI може продовжувати редагування + export/runtime підтверджені + старий external MCP прибраний без поломки спільних dependencies.** Working demo, schema-valid tool list або красивий screenshot окремо цього не доводять.

## Самоперевірка

- [x] Scope розширено з MVP до всіх active site-authoring можливостей Revyme.
- [x] Є поіменний baseline agent tools/mutations/SDK і додаткова UI/API матриця.
- [x] Усі owner tasks T01–T25 визначені; full parity не підміняється unavailable response.
- [x] Ingestion та component-specific scaffolding включені зі збереженням semantics/GUI editability.
- [x] Local/cloud readiness і retired feature boundaries явні.
- [x] Landing L01, dynamic L02, visual L03 та lifecycle L04 мають завершальні gates.
- [x] Код продукту ще не змінюється; результат цього етапу — повний план/spec/inventory.
