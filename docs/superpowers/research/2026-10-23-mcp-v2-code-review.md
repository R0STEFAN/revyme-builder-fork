# Review `feature/mcp-v2` — 2026-10-23

**Висновок: не приймати гілку як завершений, готовий до використання CLI/MCP.** Є відтворені блокери в реальному HTTP-шляху, порушення збереження даних і хибні підтвердження успіху. Це не означає, що весь доданий код слід викинути. Але заяви «T01–T25 завершені» та «37/37 verified» наявні докази не підтверджують.

- Перевірена гілка: `feature/mcp-v2`.
- HEAD: `c9018d071efb8e675e61e52f5bcb2b6bc128ce2c`.
- Merge base з `main`: `ca1129c1343349c1ac56f3b86b59a2173d2f08dc`.
- Diff: 183 файли, 66 660 доданих і 2 217 видалених рядків.
- Обсяг review: архітектура executor/transport/persistence, критичні операції для landing, packaging, достовірність acceptance та відповідність фінальним вимогам плану. Це не построковий аудит усіх 66 тисяч рядків і не підтвердження всіх capabilities.

## Перевірки

| Перевірка | Результат |
|---|---|
| Нові core/CLI/server automation та `e2e/automation-v2` через Vitest | 50 файлів, 701 тест пройшов |
| Вибрані існуючі storage/API/internal bridge/backend/generators та evaluation тести | 10 файлів, 246 тестів пройшли |
| Кореневий `tsc --noEmit` після видалення тимчасових probes | Пройшов |
| `tsc -p packages/cli/tsconfig.json --noEmit` | Exit 2: зокрема немає resolution для `@/…` у залежному source graph |
| `tsc -p packages/automation-core/tsconfig.json --noEmit` | Exit 2: зокрема не підключені потрібні `ImportMeta`/Vite та ambient типи |
| CLI bundle поза repo з доступними лише задекларованими direct dependencies | Exit 1, `ERR_MODULE_NOT_FOUND: @babel/parser`, навіть для `--version` |
| Незалежні characterization probes | 9 тестів успішно відтворили небажану поведінку; це докази дефектів, а не 9 позитивних acceptance |

Кореневий TypeScript config включає `src`, `packages/*/src`, `packages/*/test`, але не є окремою перевіркою всього server/E2E/evaluation коду. Помилки package typecheck не слід механічно трактувати як усі нові помилки в прикладному коді: частину спричиняє конфігурація нових package projects при імпорті наявних модулів. Однак передбачений планом package gate зараз не проходить.

Не виконувалися повний root Vitest suite, браузерна GUI acceptance, реальний export/Next build та приймання налаштованого hosting/cloud service. Їхню успішність цей review не стверджує.

## Підтверджені findings

### R1 — P1: реальний HTTP snapshot несумісний із CLI/MCP клієнтом

**Місце:** [client.ts:64](/home/rost/Документи/revyme/revyme-builder-fork/packages/cli/src/client.ts:64), [api.ts:72](/home/rost/Документи/revyme/revyme-builder-fork/server/automation/api.ts:72).

Сервер повертає `{ ok: true, snapshot: { scope, revision, files, config } }`. Клієнт читає `json.data.scope`, `json.data.revision` та `json.data.files`. Тому успішна відповідь сервера перетворюється на `SERVER_UNAVAILABLE` із `Cannot read properties of undefined (reading 'scope')`.

Відтворено через справжній `startStandaloneServer(0, temporaryDataDir)` і `AutomationClient.getSnapshot()`, без mock HTTP. Більшість project operations у CLI і MCP починаються з цього виклику, отже не доходять до виконання.

**Виправлення:** один runtime-validated wire contract для server/client; integration test саме клієнта проти справжнього сервера. Аналогічно узгодити `/plan` і `/status`: останній очікує `operationId`, але `client.getStatus()` надсилає лише project/branch і очікує інший результат.

### R2 — P1: mutation result помилково вважається готовим Plan

**Місце:** [client.ts:304](/home/rost/Документи/revyme/revyme-builder-fork/packages/cli/src/client.ts:304), [session.ts:113](/home/rost/Документи/revyme/revyme-builder-fork/packages/automation-core/src/session.ts:113), [pages.ts:273](/home/rost/Документи/revyme/revyme-builder-fork/packages/automation-core/src/operations/pages.ts:273).

`prepareOperation()` повертає звичайний результат `op.execute()`. Наприклад, `pages.create` повертає `{ page, changes }`, а не `{ scope, baseRevision, operationId, planHash, … }`. Клієнт робить TypeScript cast `prep.data as Plan` і надсилає це у commit service. Cast не перетворює об'єкт.

Після підміни **лише читання snapshot** на справжній snapshot repository, щоб обійти R1, виклик `client.execute(scope, 'pages.create', { slug: 'about', title: 'About' })` отримав `Cannot read properties of undefined (reading 'projectId')`. Revision на диску залишилася 1. Це окремий блокер після виправлення R1. `workflow.batch` також повертає wrapper `{ success, plan }`, тому простий cast не є універсальним рішенням.

**Виправлення:** canonical prepare/executor має перетворювати domain output на exact-byte Plan, виконувати ingestion та validation і лише тоді commit. Read/service outputs повинні мати явний контракт. Dry-run має повертати той самий валідований Plan, який буде записано, без durable side effects.

### R3 — P1: GUI використовує recovery timestamp як CAS revision; можливі втрата змін і хибний конфлікт

**Місце:** [local-backend.ts:121](/home/rost/Документи/revyme/revyme-builder-fork/src/backend/local-backend.ts:121), [storage.ts:128](/home/rost/Документи/revyme/revyme-builder-fork/server/storage.ts:128).

Новий `setLoadedRevision(server.revision)` отримує `revision`, яка формується вище з `json.data.__revymePersistenceRevision`. Це timestamp локальної recovery-системи, а не новий лічильник `record.revision` commit service. `getProject()` при цьому не повертає `record.revision`.

Відтворено дві послідовності через справжні `LocalBackend`, `getProject`, `saveProject`, `LocalProjectRepository`; fetch лише маршрутизує запити до цих storage функцій:

1. GUI завантажує проект без recovery timestamp → base revision `null`; MCP записує revision 2; GUI зберігає завантажені старі bytes без `baseRevision` → сервер приймає revision 3 і **затирає зміни агента**.
2. GUI успішно зберігає проект і перезавантажує його → base стає timestamp приблизно `1.79e12`, тоді як сервер має revision 2; наступний звичайний save завершується `REVISION_CONFLICT` без стороннього редагування.

**Виправлення:** відокремити recovery ordering token від server revision; повертати та завантажувати справжню revision із project row; не допускати blind replacement уже revisioned проекту. Перевірити реальний сценарій «GUI завантажив 7 → CLI записав 8 → GUI stale save відхилено зі збереженою recovery copy», а також звичайний reload/save без конфлікту.

### R4 — P1: receipt потрапляє в cache до успішного запису на диск

**Місце:** [project-repository.ts:184](/home/rost/Документи/revyme/revyme-builder-fork/server/automation/project-repository.ts:184).

`receiptsCache.set()` виконується перед `writeFileSync` та `renameSync`. Якщо durable replace падає, cache вже містить receipt успіху. Наступний `applyPlan()` знаходить його та повертає без повторного запису. Status використовує той самий cache.

Fault injection: один `renameSync` кидає `simulated disk failure`; після відновлення rename retry повертає receipt revision 2, але файл на диску все ще має revision 1 і старий source:

```json
{"receiptRevision":2,"diskRevision":1}
```

**Виправлення:** публікувати/cache-увати receipt лише після підтвердженого durable commit; status після збою не повинен стверджувати committed без committed record. Додати fault tests через public commit/status шлях, включно зі restart.

### R5 — P1: production bundle не має задекларованих Babel залежностей

**Місце:** [build.cjs:49](/home/rost/Документи/revyme/revyme-builder-fork/packages/cli/build.cjs:49), [package.json:15](/home/rost/Документи/revyme/revyme-builder-fork/packages/cli/package.json:15), [pack.test.ts:36](/home/rost/Документи/revyme/revyme-builder-fork/packages/cli/test/pack.test.ts:36).

Build позначає `@babel/*` external, а runtime bundle імпортує ці пакети. У CLI dependencies їх немає. Smoke test симлінкує **весь кореневий `node_modules`**, тому не перевіряє реальну автономність пакета.

Незалежна перевірка скопіювала `bin`, `dist`, `package.json` у `/tmp` і надала тільки задекларовані direct dependencies. Навіть `node bin/revyme.mjs --version` завершився `ERR_MODULE_NOT_FOUND: Cannot find package '@babel/parser'`. Це контрольована перевірка dependency closure, а не виконаний registry install. Окремо потрібно визначити distribution model для залежності на `private: true` automation-core.

**Виправлення:** bundle або належні runtime dependencies для всіх external imports; справжній pack/install/bin test без root node_modules та без repo aliases. Окремі package typechecks також мають проходити.

### R6 — P1: ingestion існує як бібліотека, але не підключений до canonical authoring path; commit gate обходить Oracle

**Місце:** [session.ts:111](/home/rost/Документи/revyme/revyme-builder-fork/packages/automation-core/src/session.ts:111), [validate.ts:64](/home/rost/Документи/revyme/revyme-builder-fork/packages/automation-core/src/validate.ts:64).

`ingestJSXFragment`/normalizers експортуються і тестуються окремо, але `prepareOperation()` та CLI не запускають їх. `validatePlan()` реалізує окремий обмежений Babel walk, а не фінальну Oracle/round-trip перевірку.

Відтворення: Plan з `padding: '1.5rem'` прийнято `validatePlan()` як `{ ok: true, issues: [] }`; `checkFile()` тих самих bytes повертає `SPACING_UNIT_NOT_PX` і `CANVAS_CONFIG_MISSING`. Деякі окремі file/code-component operations викликають Oracle самі, але це не захищає всі mutation/`plans.commit` шляхи і не дає єдиної політики.

Додатково validator перевіряє лише relative imports, а не `@/components/…`; `beforeHash` перевіряє існування файла, але не порівнює його hash. Це не відповідає заявленій незалежній перевірці точних фінальних bytes.

**Виправлення:** спочатку безпечна deterministic normalization зі збереженням семантики та звітом, потім незалежні Oracle/parser/import/dependency checks фінального file set. Неприпустимо просто дозволити більше bytes або повернути агенту всі 80 правил без normalization. Для `rem/em` потрібен відомий контекст; неоднозначні зміни мають давати targeted issue. Commit має перевіряти Plan, а не покладатися на те, яким domain tool його сформовано.

### R7 — P1: built-in insertion додає import компонента, якого немає у проекті

**Місце:** [catalog.ts:259](/home/rost/Документи/revyme/revyme-builder-fork/packages/automation-core/src/operations/catalog.ts:259), [components.ts:25](/home/rost/Документи/revyme/revyme-builder-fork/packages/automation-core/src/operations/components.ts:25).

`catalog.place` для uppercase tag додає `import Marquee from '@/components/Marquee'`, але повертає лише зміну сторінки. Джерело built-in компонента не встановлюється.

У порожньому проекті зі сторінкою операція для `itemId: 'cs-marquee'` створила рівно одну зміну — `app/page.client.tsx`; `components/Marquee.tsx` відсутній. `validatePlan()` прийняв цей file set. У звичайному Next export такий import не резолвиться.

**Виправлення:** використовувати наявний install/insert pipeline built-in template, включати component source та всі залежності в одну atomic зміну; для невідомого catalog item відмовляти цілеспрямовано. Перевірити саме новий проект без попередньо встановленого компонента, canvas controls і export build.

### R8 — P1: `publish.deploy` повідомляє про deployment без публікації

**Місце:** [publish.ts:924](/home/rost/Документи/revyme/revyme-builder-fork/packages/automation-core/src/operations/publish.ts:924).

За відсутності hosting adapter fallback лише додає локальний deployment record, конструює `https://<projectId>.revyme.app` і повертає `success: true`, `status: 'deployed'`. У звичайному CLI context adapters порожні.

Незалежний виклик із порожніми adapters і `force: true`, який пропускає тільки preflight, отримав:

```json
{"status":"deployed","url":"https://review-fixture.revyme.app","networkCalls":0}
```

Fetch spy не зафіксував жодного запиту, hosting adapter не був наданий. `force` не означає «імітувати публікацію». Наявні тести навіть очікують такий `deployed`, тому зелений suite тут закріплює неправильний контракт.

**Виправлення:** без service adapter повертати чіткий unavailable/prerequisite failure. Локальна підготовка може бути окремим явно названим результатом, але не `deployed`. Публікацію та URL підтверджує лише hosting service з durable idempotent receipt.

### R9 — P2: retry вже виконаного commit відхиляється до перевірки idempotency

**Місце:** [commit-service.ts:63](/home/rost/Документи/revyme/revyme-builder-fork/server/automation/commit-service.ts:63).

Commit service спершу валідовує base revision і тільки потім викликає repository, де знаходиться receipt lookup. Після першого commit 1→2 повтор **того самого** operationId/hash із base 1 отримує `REVISION_CONFLICT` і `not_committed`, хоча receipt існує. Прямий repository test idempotency не перевіряє public service ordering.

Ситуацію погіршує [client.ts:125](/home/rost/Документи/revyme/revyme-builder-fork/packages/cli/src/client.ts:125): транспортний збій commit позначається `not_committed`, хоча відповідь могла загубитися після запису; `getStatus()` не передає потрібний `operationId`.

**Виправлення:** receipt/hash lookup перед freshness rejection, чіткий `unknown` при неоднозначній доставці, доступний operation status і retry з незмінними IDs. Перевіряти через public API, а не тільки repository.

### R10 — P2: звичайний editor save видаляє durable receipts

**Місце:** [storage.ts:197](/home/rost/Документи/revyme/revyme-builder-fork/server/storage.ts:197).

Automation repository зберігає `record.receipts`, але `saveProject()` реконструює project record без цього поля. Після одного успішного MCP commit і звичайного editor save новий екземпляр repository вже не знаходить receipt. Це відтворено з коректною `baseRevision: 2`, тобто дефект незалежний від R3.

**Виправлення:** один repository/transaction contract для source, revision і receipts; GUI replacement не має втрачати operation journal. Перевірити «MCP commit → GUI save → process restart → status/retry».

### R11 — P2: заявлене E2E/100% verified покриття не перевіряє продуктову готовність

**Місце:** [L01-landing.spec.ts:8](/home/rost/Документи/revyme/revyme-builder-fork/e2e/automation-v2/L01-landing.spec.ts:8), [automation-inventory.cjs:267](/home/rost/Документи/revyme/revyme-builder-fork/scripts/automation-inventory.cjs:267).

`e2e/automation-v2/*.spec.ts` імпортують Vitest і викликають `operation.execute()` напряму. Root Playwright має `testDir: './src'`, отже ці файли не є його браузерними сценаріями. Розширений core acceptance L01 теж вручну застосовує changes до Map і singleton ProjectFS та вручну збільшує revision. Він не проходить CLI/HTTP/CommitService.

Саме тому R1–R4 залишаються непоміченими попри зелені acceptance. Там також немає перевірки GUI controls/edit/save/reload, фактичного Navbar/FAQ/form interaction на трьох ширинах та export build, яких вимагають T24/T25.

Генератор coverage ставить `status: 'verified'` літерально для C01–C37 та друкує `100% Passing` у Markdown template, не читаючи результати виконаних acceptance. Mapping рядка до імені операції не доводить поведінкової еквівалентності.

**Виправлення:** залишити ці тести як корисні unit/integration тести з відповідними назвами; додати реальні CLI і stdio MCP сценарії зі справжнім сервером, persisted reread та браузером. Verified-статус виводити з evidence конкретного HEAD/profile/test run. До цього capabilities мають чесні рівні implemented/unverified/unavailable. Наявність evaluation runner сама по собі не є результатом агентного benchmark 12 briefs × 3 runs.

## Що з виконаного зберегти

- Межу `automation-core` / CLI / server repository можна використати як основу, але її фактичний загальний executor потрібно довести до робочого стану.
- Domain schemas, wrappers над наявними generators, ingestion helpers та більша частина unit тестів — матеріал для доведення реалізації, а не привід писати ще один MCP з нуля.
- Видалення старих external launchers відповідає погодженому рішенню: production клієнтів немає. Зелений internal bridge suite є корисною перевіркою збереження внутрішнього transport, хоча не доводить весь in-app GUI lifecycle.
- Старий зовнішній MCP не слід повертати як fallback. Спільні parser/generators/Oracle/runtime та внутрішній bridge залишаються.

## Порядок доведення до приймання

1. **Один вертикальний сценарій:** виправити packaging і HTTP contract; `installed CLI → pages.create → validated Plan → commit → fresh HTTP snapshot`, потім той самий сценарій через справжній stdio MCP. У цих tests не mock-ати AutomationClient або repository.
2. **Збереження даних:** спільний server revision, GUI stale save, receipts, retry/lost reply, fault injection; заборона хибного `committed`/`deployed`.
3. **Реальний authoring pipeline:** deterministic ingestion → exact final bytes → Oracle/parser/import closure → atomic persistence; перевірити dry-run і batch без side effects.
4. **Мінімально повний landing:** новий проект, built-ins із dependencies, reusable design component, variants, responsive Navbar/drawer, FAQ, форма. Перевірити GUI controls, edit/save/reload і Next export build на desktop/tablet/mobile.
5. **Решта C01–C37:** кожний active leaf отримує runtime/GUI/service evidence, а не тільки registration/schema/unit coverage. Уточнити unavailable profiles. Після цього оновити coverage і виконати погоджений агентний benchmark.

Не потрібно починати третю архітектуру чи ремонтувати legacy MCP. Треба виправити спільний шлях у цій гілці й замінити декларативні release gates реальними перевірками.

## Відтворення та артефакти

- [Джерело 9 незалежних probes](/home/rost/Документи/revyme/revyme-builder-fork/docs/superpowers/research/2026-10-23-mcp-v2-review-evidence/review-runtime-probes.test.ts.txt).
- [Їхній raw output](/home/rost/Документи/revyme/revyme-builder-fork/docs/superpowers/research/2026-10-23-mcp-v2-review-evidence/runtime-probes.txt).
- [Команди та результати перевірок](/home/rost/Документи/revyme/revyme-builder-fork/docs/superpowers/research/2026-10-23-mcp-v2-review-evidence/checks.txt).
- [Ізольована dependency-closure перевірка CLI](/home/rost/Документи/revyme/revyme-builder-fork/docs/superpowers/research/2026-10-23-mcp-v2-review-evidence/standalone-pack-probe.py).

Щоб повторити probes, тимчасово скопіювати `.test.ts.txt` у `packages/automation-core/test/review-runtime-probes.test.ts`, виконати `vitest run packages/automation-core/test/review-runtime-probes.test.ts --reporter=verbose`, потім прибрати тимчасовий файл. Вони навмисно очікують дефектну поведінку для reviewed HEAD; після виправлень їх потрібно перетворити на regression tests з правильними очікуваннями.

Review не змінює implementation. Тимчасовий тест із production test directory прибрано; залишено лише цей звіт та evidence. User-owned `.agents/teamwork/` не змінювався.
