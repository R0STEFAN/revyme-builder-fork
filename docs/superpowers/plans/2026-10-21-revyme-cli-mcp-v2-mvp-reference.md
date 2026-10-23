> **Статус: історичний внутрішній MVP checkpoint.** Користувач розширив ціль до повного покриття Revyme. Актуальні scope, tasks і release gates у `2026-10-21-revyme-cli-mcp-v2.md` та `../specs/2026-10-21-revyme-mcp-full-coverage.md`. Цей вузький план не визначає завершення нового MCP.

# Revyme CLI/MCP v2 — практичний план реалізації та заміни legacy MCP

> **For agentic workers:** Use superpowers:executing-plans to implement task-by-task. Поточне завдання — написати план; зміни коду продукту ще не починалися. Кожен етап: failing regression test → мінімальна реалізація → перевірка → окремий commit без сторонніх змін користувача.

**Goal:** Новий CLI та MCP створюють редаговані сайти через наявні генератори Revyme без залежності запису від відкритої вкладки.

**Architecture:** Один невеликий headless executor із явним project/branch/file. CLI й MCP використовують один registry Zod contracts. Операції будують кандидатні TSX-файли через наявні pure transforms; перевірений кандидат записується одним revisioned commit service, спільним із editor save. Наявні parser, generators, Oracle і runtime використовуються повторно.

**Tech Stack:** TypeScript, Node >=22, наявні Babel/Zod/MCP SDK, Node `util.parseArgs`, Vitest і Playwright. Новий React runtime, scene graph, універсальний React importer та зовнішня черга не потрібні першому релізу.

**Spec:** `../research/2026-10-21-webstudio-revyme-mcp-audit.md`. Попередня розширена архітектура: `2026-10-21-revyme-cli-mcp-v2-architecture-reference.md`. Цей практичний план має пріоритет щодо обсягу і послідовності: static JSX ingestion — наступний крок після working tree authoring; full capability parity не блокує rollout підтримуваних операцій.

## Рішення щодо старого MCP

**Залишити тимчасово, припинити розширення, мінімально виправити підтверджені дефекти, поступово вимкнути його зовнішні writes.** Нові authoring capabilities розробляються лише у v2. Старий MCP не стає foundation нового.

| Частина | Рішення |
|---|---|
| `server/mcp-bridge.ts`, старий зовнішній MCP/RPC | Мінімальні correctness fixes у Task 1; далі compatibility maintenance до заміни |
| `server/mcp-server.ts`, `server/run-mcp.sh`, `scripts/mcp-bridge-server.ts` | Тимчасові launchers; після cutover — thin launcher v2 або видалення після міграції всіх конфігурацій |
| `src/code/generation/*`, parser, pure Oracle checks | Залишаються основою; винести потрібні pure dependencies, не копіювати реалізації |
| `src/ai/agent/tools/*` | Не видаляти пакетом: їх використовує внутрішній агент; зовнішні schemas беруться з нового registry |
| `src/ai/agent/bridge-tools.ts`, `src/ai/mcp/bridge-client.ts` | Спочатку inventory callers. Зберегти plumbing, потрібний in-app agent, run lifecycle, history та observation |
| Screenshot/measurements через браузер | Окремий read-only observer adapter; потрібен exact project/revision і чесний status |
| Старі manuals/skill | Після rollout один v2 bootstrap. Legacy documentation позначити явно, не подавати два суперечливих основних маршрути |

**Не переносити в legacy:** новий desugarer, нові component recipes, нові CMS/motion tools, нову копію schemas чи новий великий prompt. Не виправляти одночасно весь старий агентний стек.

## Global Constraints

- TSX — джерело істини; візуальна модель похідна й не стає окремим persisted scene graph.
- Canvas DOM не є write API. Editor mutations зберігають чинний queue/modifyProjectFile path.
- Headless writes проходять commit service, не raw ProjectFS; їхні виходи не залежать від active tab, atom або canvas cache.
- Порожній style string означає видалення; breakpoints беруться з проєкту; published behavior використовує `@revyme/runtime`.
- Зберегти traces та незакомічені зміни користувача. Під час реалізації звірити актуальний baseline із аудитом.
- Механічне оформлення — IDs, imports, wrappers, component boilerplate — виконує білдер. Агент не відтворює його вручну.
- Недоступна перевірка не означає успіх. Завершений commit не означає автоматично підтверджену візуальну якість.
- Відносні одиниці, списки та code-component classification не змінюються здогадкою. Context-dependent lowering потребує явної policy; довгостроково native support має пріоритет над втратним перетворенням.
- Жодного автоматичного publish/deploy або встановлення платних зовнішніх сервісів.

## Review Focus

1. Невдалий editor/tool result не маскується зовнішнім MCP success — Task 1 і Task 6.
2. Дві вкладки/проєкти не отримують той самий mutation; legacy та v2 не пишуть паралельно в один проєкт — Tasks 1, 3, 8.
3. Stale editor autosave не перезаписує CLI commit; timeout retry не створює дубль — Task 3.
4. Component master і consumer page або записуються разом, або не змінюються; GUI може редагувати створені props/children — Tasks 4, 5, 7.
5. Ingestion не змінює IDs, CSS cascade, accessibility чи component kind потай; unavailable render не стає passed — Tasks 4, 7.

## MVP: що агент зможе робити

- `project.inspect`: files/pages, IDs, components, tokens, breakpoints і revision; компактний default output.
- `pages.create`: валідна сторінка з правильним scaffold.
- `nodes.insert`: одна секція/дерево за один виклик, automatic IDs і responsive styles.
- `nodes.update`: text, attributes, styles та видалення style values.
- `components.create`: design master через `buildCreatedMaster`, declared props та variants у підтримуваному ним обсязі.
- `components.instantiate`: інстанс master з props та placement styles.
- `project.verify`: static diagnostics і підтверджені postconditions; build/render status окремо.

Службові: `meta.index`, `meta.tools`, `plans.commit`, `operations.status`. Tokens/built-ins читаються discovery; нові token/asset mutations додаються наступними slices. До цього використовуються наявні tokens/assets проєкту, без тихого відхилення від запиту.

**Перший input:** recursive declarative tree та component declaration, як у вже наявних tools. **Другий input:** зручний static JSX adapter до того самого intent. Не будувати два незалежні engines. Довільні TSX application files, hooks, CMS та third-party logic не обіцяються як повністю GUI-editable MVP input.

```text
CLI / MCP → operation registry → explicit snapshot
          → existing generators + narrow ingestion
          → final-byte validation + parse postconditions
          → dry-run plan / revisioned durable commit
```

## Файлова карта та спільні інтерфейси

| Нові файли | Відповідальність |
|---|---|
| `packages/automation-core/src/{contracts,registry,session}.ts` | Zod inputs/results, capabilities, explicit snapshot |
| `packages/automation-core/src/{plan,validate}.ts` | Candidate files, generated IDs, postconditions, final bytes/hash |
| `packages/automation-core/src/operations/{project,pages,nodes,components}.ts` | Невеликий MVP operation set поверх pure transforms |
| `packages/automation-core/src/ingestion/{ids,styles,jsx}.ts` | IDs/style helpers спочатку; static JSX adapter наступним slice |
| `server/automation/{project-repository,commit-service,api,standalone}.ts` | Canonical storage, CAS/idempotency, API без browser/Vite |
| `packages/cli/src/{main,client,config,mcp}.ts` | Shell і stdio adapters одного API/registry |
| `e2e/automation-v2-roundtrip.spec.ts` | CLI → editor → saved source → export |

```ts
type Scope = { projectId: string; branchId: string; filePath: string };
type Plan = {
  scope: Scope; baseRevision: number; operationId: string;
  files: Array<{ path: string; beforeHash: string | null; content: string }>;
  createdNodeIds: string[]; hash: string;
};
type Receipt = {
  operationId: string; projectId: string; branchId: string;
  revision: number; planHash: string; changedFiles: string[];
};
type Issue = { code: string; path: Array<string | number>; message: string };
type Result<T> = {
  ok: boolean; data?: T;
  error?: { code: string; message: string; issues: Issue[] };
  meta: { revision: number; commitStatus: 'not_committed' | 'committed' | 'unknown'; receipt?: Receipt };
};
```

`readProject(scope)` повертає fresh files/config/revision; `prepare(session, operation, input)` повертає plan або issues; `commit(plan)` повертає receipt; `status(projectId,operationId)` уточнює неоднозначний результат. Це цільові нові API. Для project-wide reads filePath не потрібний; для file mutations обов'язковий. MVP не має arbitrary file deletion/import escape hatch.

## Task 1: Обмежені виправлення legacy перед переходом

**Files:** `server/mcp-bridge.ts`, `server/mcp-bridge.test.ts`; за потреби зовнішнього write guard — `src/ai/mcp/bridge-client.ts` і його tests. Не переписувати всі agent tools.

- [ ] Перенести сценарії з `../research/2026-10-21-mcp-contract-probes.ts` у regression tests з правильними очікуваннями: nested `isError:true` або `committed:false` → outer MCP `isError:true`; screenshot/audit unavailable → unavailable без «clean layout».
- [ ] При більш ніж одній canvas-вкладці та відсутності перевіреної однозначної прив'язки відхиляти editor-scoped calls як `AMBIGUOUS_EDITOR`, а не broadcast. Це мінімальний guard, не новий multi-tab session framework. Test доводить: жодного dispatched mutation до відмови.
- [ ] На зовнішньому MCP boundary тимчасово блокувати відомий небезпечний `create_navbar` direct-write path, включно з generic `revyme_agent_tool` alias та вкладеним викликом у chain/batch; повернути явну причину й підтримуваний component workflow. Перевірка має діяти до першого write, а не лише за public tool name. Альтернатива лише якщо менша за guard: виправити його через existing gate/checkpoint/branch path із regression test. Не перезаписувати незакомічену реалізацію користувача без аналізу diff.
- [ ] Не додавати legacy функціональності. Запустити bridge/bridge-client suites та окремий failure-result/multiple-tabs regression. Вихід: старий інтерфейс чесніше повідомляє failures під час будівництва v2.

## Task 2: Мінімальний headless core та fixture

**Files:** Create `packages/automation-core/{package.json,tsconfig.json}`, `src/{contracts,registry,session,plan,validate}.ts`, `test/{fixture,core,headless}.test.ts`; додати package/test scripts у root `package.json`, `vitest.config.ts` та відповідні tsconfig.

- [ ] Fixture: один валідний page template з existing root, tokens, custom breakpoints та revision=7; взяти source із чинних tests. `makeFixture()` повертає новий readonly snapshot для кожного тесту.
- [ ] Задати operation schema один раз у Zod: з неї runtime validation, discovery JSON Schema та help. Missing scope/unknown operation мають path-specific issues; невідомі fields не ковтаються.
- [ ] Написати тест Node import без `window`, `document`, Jotai editor initialization або singleton ProjectFS. Відділити лише dependencies генераторів, потрібних першому page slice. Зберегти існуючі exports/callers; не копіювати модулі в нову паралельну реалізацію.
- [ ] `prepare` працює в candidate map, не пише project. IDs і file bytes незмінні після finalize; import sync/normalization відбуваються перед Oracle. Check fresh parse та declared postconditions; no-op generator при missing target → `TARGET_NOT_FOUND`.
- [ ] Tests: invalid source/import, ID collision, missing parent, repeated normalization, untouched files byte-identical. Існуючі diagnostics не приховують нові на іншому element. Запустити core tests, package build/typecheck та regression suites змінених pure helpers.

## Task 3: Durable commit та спільний захист від stale save

**Files:** New `server/automation/{project-repository,commit-service,api,standalone}.ts` і відповідні tests; adapt `server/storage.ts`, `server/api-plugin.ts`, `src/backend/{types,local-backend,autosave,save-revision}.ts` та їх tests.

- [ ] `readProject` читає canonical local record, а не CLI cache. Для existing records мігрувати revision=0 без зміни source files. Metadata/idempotency receipt зберігати разом із source в одному atomic record.
- [ ] Tests: два commits base=7 → один revision=8, другий conflict; одна operationId/planHash повторно → той самий receipt; та сама operationId/інший planHash → conflict. Bounded receipt retention має expired response без повторного execution.
- [ ] Застосувати project lock, fresh revision check і atomic durable replace. Втрата процесу до/після rename лишає цілий старий або новий snapshot; не partial master/page. `plans.commit` перевіряє hash/base revision й не запускає transforms повторно.
- [ ] Browser autosave передає expected revision. Test: editor rev7 → CLI rev8 → editor save rev7 відхиляється й зберігає recovery copy; remote bytes не перезаписані. Старий writer без revision після міграції отримує upgrade/conflict response.
- [ ] Провести всі endpoints, що можуть замінити project source, через той самий contract. CLI не активувати на existing project, доки його browser/legacy writer не переведений або заблокований. Один лише atomic rename цієї гарантії не дає.
- [ ] Запустити new repository/API tests, storage/local-backend/autosave/save-revision suites. Вихід: standalone API працює без відкритого редактора; timeout retry безпечний.

## Task 4: Перший вертикальний зріз — сторінка та секція

**Files:** New `src/operations/{project,pages,nodes}.ts`, `src/ingestion/{ids,styles}.ts` у core та `test/{pages,nodes,styles}.test.ts`; reuse `src/code/generation/{generator-crud,generator-styles}.ts`, parser, `src/shared/{id-utils,css-utils}.ts` і pure Oracle checks.

- [ ] Реалізувати `project.inspect`, `pages.create`, `nodes.insert`, `nodes.update`, `project.verify`. Один insert приймає ціле дерево секції; агенту не потрібно викликати tool для кожного child.
- [ ] Білдер створює IDs, page scaffold, imports та breakpoint CSS. Не stamp-ити transparent wrappers/rich-text runs. Existing IDs зберігаються. У result повернути created IDs і компактну tree summary.
- [ ] Styles використовують project breakpoints, `''` видаляє значення. Підтримувані shorthand нормалізуються existing helpers із cascade tests. Відносні одиниці конвертуються тільки за explicit project unit policy; невідомий root не означає 16px.
- [ ] Test сценарій: create page → 100-node section tree → responsive update → dry-run без запису → commit → повторний read/fresh parse містить IDs, text, styles; missing target ніколи не виглядає як success.
- [ ] Перевірити імпорт у чинний editor fixture, Layers і text edit. Не відкривати новий повний JSX-importer проєкт для цього етапу. Вихід: перший реально придатний headless authoring flow.

## Task 5: Design components через наявний генератор

**Files:** New `src/operations/components.ts`, `test/components.test.ts` у core; reuse/adapt `src/code/generation/create-component-gen.ts`, `src/code/components/component-registry.ts` і потрібні pure instance transforms.

- [ ] `components.create` використовує `buildCreatedMaster` для layout declaration + declared props/defaults + підтримуваних variant specs. Система генерує variantConfig, propMeta, IDs, imports і export. Не вимагати цих деталей від агента.
- [ ] `components.instantiate` перевіряє master/props і генерує editable instance. Наявний master не перезаписується при create; ambiguous source не перекласифіковується автоматично у code component.
- [ ] Test master + consumer candidate: invalid prop/import → нуль writes; success → два instances з різними title props. Відкриття component у редакторі дає editable internals; Inspector змінює props після save/reload.
- [ ] Не додавати сюди CMS, slots, arbitrary hooks чи автоматичні interaction connections. Відсутні можливості відображаються у capabilities. Вихід: агент може створити reusable UI без ручного Revyme boilerplate.

## Task 6: CLI package, потім тонкий MCP adapter

**Files:** New `packages/cli/{package.json,tsconfig.json,bin/revyme.mjs}`, `src/{main,client,config,mcp}.ts`, `test/{cli,mcp,parity,pack}.test.ts`; `docs/automation-cli.md`.

- [ ] Реалізувати `revyme init`, `doctor`, `meta.index`, operation shortcuts, `--input-file`, `--dry-run`, `--project`, `--branch`, `--operation-id`. `.revyme/config.json` містить link, credentials зберігаються через обраний credential adapter й не потрапляють у repo/output.
- [ ] CLI використовує Tasks 2–5, не `/rpc` і не old SSE write path. `doctor` перевіряє endpoint/contract/capabilities. stdout — JSON; progress/trace — stderr; failure — nonzero exit.
- [ ] Stdio MCP формує tools/list із того самого registry і викликає той самий client/executor. Error → outer `isError:true`, `structuredContent.ok:false`; dry-run success явно `not_committed`. One-to-one protocol name mapping перевіряє collisions.
- [ ] Official SDK tests порівнюють CLI/MCP normalized inputs, plans, errors, receipts; дві sessions не змішують проєкти. Timeout зберігає operationId і робить status lookup, без нової insertion.
- [ ] `npm pack` isolated smoke встановлює package поза source tree, без root node_modules/tsx/browser; page/component create працюють проти temporary headless server. Окремо package build/typecheck.

## Task 7: Перевірка round trip та наступний ingestion slice

**Files:** `e2e/automation-v2-roundtrip.spec.ts`, `evaluations/automation-v2/{fixtures,validate}.ts`; наступним commit — core `src/ingestion/jsx.ts`, `test/ingestion-jsx.test.ts`. Preview/export adapter використовує чинний `src/code/project/source-export.ts` після відділення browser dependencies.

- [ ] Playwright acceptance: CLI створює сторінку → hero/grid/cards із двома instances → editor reload → select/text/style/prop edit у GUI → save/reload → export/build. Перевірити desktop/mobile і custom breakpoint.
- [ ] Static checker, build smoke і rendered evidence повертають окремі статуси. Missing browser/assets/fonts, stale revision або incomplete measurement → unavailable/pending, без «clean layout».
- [ ] Додати deterministic failure scenarios: wrong project, missing parent, duplicate explicit ID, stale save, lost response, invalid component, failed audit. Усі доводять відсутність partial writes/false success.
- [ ] Після working tree/component MVP додати static JSX adapter до того самого intent. Тест natural fragment без IDs не потребує ручного boilerplate; unsupported dynamic JS не виконується і має одну targeted issue із source location.
- [ ] List recipe та unit conversion мають явні semantics: roles/markers/reading order, root/font context, responsive states; existing controls/IDs не переписуються. Повторний ingestion стабільний. Не включати всі 80+ можливих repairs перед випуском.
- [ ] Вимірювати first-pass completion, Oracle bounces, repair calls і source/visual preservation на тих самих briefs. Model eval запускається окремо в погодженому обсязі; не приписувати технічним tests естетичну оцінку.

## Task 8: Cutover, сумісність і видалення старого зовнішнього MCP

**Files:** `server/mcp-bridge.ts`, `server/mcp-server.ts`, `server/run-mcp.sh`, `scripts/mcp-bridge-server.ts`, `server/api-plugin.ts`, `.agents/skills/revyme-mcp/SKILL.md`, README та launcher/cutover tests. Видалення залежить від caller inventory.

- [ ] Додати explicit automation mode per project: `legacy` або `v2`. Для `v2` old external mutation entrypoints відмовляють (`LEGACY_WRITE_DISABLED`) або делегують один раз у v2 за точним scope. Не retry-ити mutation через legacy після v2 error/timeout. Reads повертають source/revision і не беруть довільну вкладку.
- [ ] Перевірити, як відрізняються external MCP calls і in-app agent service calls. Browser autosave/in-app writes мають спільний CAS; без такої атрибуції не блокувати весь `agent.tool` навмання. Виявлена неоднозначність caller identity блокує cutover, а не дозволяє bypass.
- [ ] Переключити основний documented launcher/config на `revyme mcp`. Наявні користувацькі client configs не змінювати мовчки. Legacy launchers можуть тимчасово запускати v2 після явної міграції link/config.
- [ ] Додати старі tool aliases тільки за повної відповідності входів/результатів. Непідтримуваний tool повертає capability/migration error; не викликає старий writer у фоні. Користувач може явно обрати legacy mode для проєкту з необхідними старими можливостями, завершивши поточну v2 session.
- [ ] Після успішного MVP запити на CMS/slots/motion/code components додаються окремими slices у v2. Саме ці capability gaps визначають, яким проєктам ще потрібен legacy mode; не підтримувати дві реалізації нових функцій.
- [ ] Observation відокремити у read-only adapter з exact project/branch/revision. Старий `revyme_capture_screenshot` wrapper із false-clean behavior не вважати готовим observer. Жодних authoring methods у його allowlist.
- [ ] Видалити старий external dispatcher, schemas/help і непотрібні launchers лише коли: усі потрібні workflows мігровані; inventory не має callers старого entrypoint; client configurations переведені; rollback протестований. Спільні in-app tools, history, runtime і canvas bridge лишаються.
- [ ] Rollback не відкочує source/revision: завершити in-flight operation, зберегти snapshot, вимкнути v2 external writes, явно переключити режим. Якщо legacy не розуміє нові capabilities, лишити проєкт read-only до ремонту, без unsafe overwrite.
- [ ] Перед default rollout виконати full Vitest, root/package typechecks, build/pack smoke і targeted E2E. Зафіксувати pre-existing failures окремо. Немає автоматичної публікації package/deployment в межах цього плану.

## Критерії завершення

1. CLI/MCP створює page + reusable component + instances без відкритої browser-вкладки.
2. Результат редагується через чинні Layers/Inspector і переживає save/reload/export.
3. Немає wrong-project write, partial commit, duplicate timeout retry або false success у regression scenarios.
4. Агент працює з компактними schemas та операціями; IDs/imports/component scaffold обслуговує білдер.
5. Відомо, які capabilities ще потребують legacy mode; для v2-проєкту старий зовнішній writer не активний.

## Що робити першим

**Task 1 → Tasks 2–4 → Task 5 → Task 6 → Task 7 → Task 8.** Core перевіряється без CLI fixtures спочатку; потім додаються shell/MCP adapters. Перший демонстраційний сайт: page + hero + grid із двома параметризованими Card instances та responsive styles.

Не починати з переписування всього editor, всіх agent tools або universal React import. Не додавати нові можливості в старий MCP. Перший release має один перевірений наскрізний шлях і чесні capability boundaries.

## Самоперевірка плану

- [x] Legacy minimal fixes, feature freeze, per-project cutover і removal criteria визначені.
- [x] Shared in-app tools відокремлені від зовнішнього legacy transport; видалення пакетами не планується.
- [x] Збережені TSX truth, iframe boundary, style deletion, breakpoints, runtime та traces.
- [x] Page/component MVP використовує існуючі generators; JSX ingestion має окремий наступний slice.
- [x] Safe persistence і editor stale-save protection входять до активації v2 writes.
- [x] Перевірки відрізняють committed source, GUI editability, rendered evidence та agent success.
