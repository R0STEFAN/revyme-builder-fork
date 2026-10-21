# Webstudio та Revyme MCP: архітектурний аудит

Дата: 21 жовтня 2026. Автор: Codex. Це дослідження локального коду, а не порівняльний запуск двох агентів у production.

**Актуальна ціль після уточнення користувача:** основний план `../plans/2026-10-21-revyme-cli-mcp-v2.md` охоплює повне покриття active site-authoring capabilities Revyme, 25 tasks і landing acceptance L01–L04. Scope визначає `../specs/2026-10-21-revyme-mcp-full-coverage.md`; baseline — 172 registered tools, 175 Mutation types, 114 SDK declarations. Вузький `*-mvp-reference.md` є лише історичним внутрішнім checkpoint. Production-проєктів немає: old external MCP прибирається на початку реалізації після inventory, без ремонту й compatibility modes. Shared transport внутрішнього агента зберігається; full gate стосується готовності нового MCP.

## Висновок

Перевагу Webstudio пояснює не саме слово CLI, а спільний рушій операцій, явна сесія проєкту, машинні контракти, планування змін до запису та перевірки результату. Revyme має сильні генератори, Oracle, batch/chain, history та branch isolation, але локальний MCP не об'єднує їх у настільки ж надійний контракт. Частина захистів існує всередині редактора, а зовнішній агент отримує іншу, іноді хибну інтерпретацію результату.

Найважливіші підтверджені дефекти: втрата зовнішнього MCP `isError`, broadcast записів у кілька вкладок, повідомлення про чистий layout без доступних вимірювань. Саме ці дефекти дозволяють агенту продовжувати будівництво поверх невдалих або неперевірених кроків.

Вислів «Webstudio завжди без помилок» не доведений. Наявні п'ять збережених agent evaluation звітів успішні, але це обмежені сценарії, а не гарантія для довільного сайту чи поточної production-версії.

## Межі дослідження

- Webstudio: `/home/rost/Документи/webstudio-source/webstudio`, HEAD `6350169f1`; working tree чистий на початку дослідження.
- Revyme: `/home/rost/Документи/revyme/revyme-builder-fork`, HEAD `9ad4ec8`, плюс наявні незакомічені зміни користувача у MCP, skills, fragment, chain, structure та component tools. Висновки стосуються саме цього стану, а не лише HEAD.
- Production service `ai-generator` згадується у Revyme як окремий bridge. Його реалізацію в цих двох репозиторіях не досліджено. Висновок про broadcast стосується `server/mcp-bridge.ts`, а не всіх можливих production bridge.
- Проєкти користувача не змінювалися. Діагностичні виклики використовували in-memory MCP transport та підставлені відповіді редактора.
- Webstudio CLI не запустився: `node packages/cli/local.js --help` → `Cannot find module 'tsx'`. Залежності не встановлювалися. Його поведінку в цьому дослідженні оцінено за кодом, тестами та наявними evaluation artifacts.
- Порівняльний end-to-end benchmark однакової моделі з однаковим brief не проводився. Частоту реальних помилок та естетичну якість сайтів не виміряно.
- Звіт, план і probe збережено локально у `docs/superpowers/`. Цей каталог виключений чинним `.gitignore` (`docs/*`); правила ignore і staging не змінювалися.

## Шляхи виконання

### Webstudio

```text
webstudio <operation> / webstudio mcp
  → MCP core / operation registry
  → typed input + explicit project session
  → snapshot + semantic operation
  → planned BuilderPatchTransaction
  → dry-run OR commit(projectId, buildId, baseVersion, transactionId)
  → persisted session / refreshed state
  → structuredContent { ok, data | error, meta }
```

Ключові файли, відносно кореня Webstudio:

| Файл | Що підтверджує |
|---|---|
| `packages/cli/package.json` | Справжній CLI package з `bin.webstudio` та `bin.webstudio-cli`; це не `sdk-cli` |
| `packages/cli/local.js` | Запуск з локального source tree, щоб не користуватися застарілим compiled binary |
| `packages/cli/src/commands/mcp.ts` | Stdio MCP, one-shot виклики, batch runner, підключення session та preview |
| `packages/project-build/src/runtime/registry.ts:63` | Схема входу/виходу, read/write/invalidate namespaces, retry та permissions у контракті операції |
| `packages/project-build/src/runtime/registry.ts:135` | Виконувана валідація входу; contract використовується не лише для документації |
| `packages/project-build/src/runtime/mutation.ts:61` | Накопичення patch-змін у кандидатному стані |
| `packages/project-build/src/project-session.ts:1378` | Планування, no-op, dry-run, versioned commit, оновлення сесії |
| `packages/project-build/src/project-session.ts:669` | Уточнення неоднозначного commit повторенням того самого transaction ID |
| `packages/cli/src/project-session.ts:568` | Збереження session snapshot з expected revision та атомарним записом |
| `packages/project-build/src/runtime/jsx/fragment.server.ts:34` | JSX перевіряється і перетворюється у WebstudioFragment, а не записується як довільний React application |
| `packages/project-build/src/runtime/components.ts:1307` | Семантична вставка фрагмента з перевіркою цілі, templates та конфліктів tokens |
| `packages/project-build/src/mcp.ts:9242` | Стабільний error code, issues, `structuredContent.ok=false` і зовнішній `isError=true` |
| `packages/project-build/src/mcp.ts:3160` | Focused discovery: `meta.index`, `meta.guide`, exact schemas |
| `packages/cli/evaluations/high-impact/` | Вимірювання реальної поведінки агента, tool failures, usage та результату fixture |

Webstudio зберігає структуровані дані builder. JSX для `insert-fragment` є контрольованим вхідним синтаксисом, що компілюється у ці дані. Це менший простір допустимих станів, ніж довільний Next.js/React source. Але він також має обмеження синтаксису, компонентів та content models — їх забезпечує код, а не лише prompt.

### Revyme

```text
MCP client
  → server/mcp-bridge.ts: вручну описаний public tool
  → HTTP/SSE → відкрита вкладка редактора
  → bridge-client.ts / agentToolCall
  → Jotai active file / viewport / branch + ProjectFS
  → generator / mutation queue / gate
  → render та autosave у браузері
  → вкладена tool-відповідь → зовнішній текстовий MCP result
```

Revyme принципово складніший: записаний TSX мусить одночасно працювати у parser, canvas, GUI controls і published runtime. Валідний React не обов'язково є валідним Revyme-документом. Наприклад, inline children slot-компонента можуть працювати на опублікованій сторінці й залишатися невидимими на canvas; `@controls` відділяє code component від design component; responsive styles потребують правильних breakpoint keys.

Цю складність не можна прибрати перейменуванням transport у CLI. Потрібен компілятор обмежених намірів у правильний TSX та перевірка повного round trip.

## Причини та докази

### 1. Зовнішній MCP губить семантику помилки — підтверджено виконанням

`agentToolCall` правильно повертає `{ isError:true, content:[...] }`. Але `server/mcp-bridge.ts:1432` завжди формує новий успішний `content`, серіалізуючи `result` у текст. Вкладений `isError` не стає зовнішнім MCP `isError`.

Те саме відбувається з `submitFiles`, що повертає `{ committed:false, violations:[...] }`: зовнішній transport не позначає відмову як tool error. Уважна модель може прочитати вкладену помилку, але MCP client, retries, UI та agent loop не отримують надійного статусу.

Наслідок: агент може використати node ID або component, який попередній крок насправді не створив; наступні помилки стають каскадом.

### 2. Один запис розсилається всім canvas-вкладкам — підтверджено виконанням

`sendToEditor`, `server/mcp-bridge.ts:93`, фільтрує лише `role !== dashboard`. На рядку 182 той самий request відправляється всім canvas clients. `websiteId` із browser query у цьому локальному bridge не використовується для маршрутизації. `handleResult` завершує pending request за першим отриманим результатом.

Діагностичний сценарій з двома SSE клієнтами `websiteId=project-a` і `websiteId=project-b` отримав ідентичний mutation request в обох клієнтах. Це доводить fan-out; запис у реальні проєкти не запускався.

Наслідок: зміна не того проєкту, дубльована робота або відповідь від вкладки, яка не є задумуваною ціллю.

### 3. Відсутність вимірювання перетворюється на «layout чистий» — підтверджено виконанням

`server/mcp-bridge.ts:1186` починає з `horizontalOverflow=false`, ковтає audit exceptions і формує `Layout fits cleanly within viewport width.`. Відсутній screenshot не заважає цьому висновку.

Водночас внутрішній `audit_design` у `src/ai/agent/tools/read.ts:735` уже вміє розрізняти `ready`, `pending`, `unavailable`, epoch та coverage. Обгортка втрачає цю інформацію. Успішний аудит одного viewport також не доводить справність усіх breakpoint або published site.

Наслідок: агент завершує роботу без доказів, що mobile layout узагалі виміряний.

### 4. Описаний контракт і виконуваний контракт розходяться — підтверджено кодом і discovery

Public schemas вручну дублюються у `server/mcp-bridge.ts`, а справжні Zod schemas живуть у `src/ai/agent/tools/*`. `revyme_insert_fragment.fragment.children.items` публікується як голий `{type:"object"}`, без рекурсивного контракту. Через `revyme_agent_tool` передається довільний `input` без схеми конкретної операції у зовнішньому tool.

Всередині вже є правильний початок: `src/ai/agent/tool-manifest.ts:31` генерує manifest зі справжніх Zod schemas. Проблема — зовнішній MCP використовує ще одну вручну підтримувану поверхню, а не лише цей контракт.

Інструкції також суперечать одна одній: public MCP/skill вимагають спершу master для кожної кнопки або картки, а `create_component` у `action-layer-rich.ts:845` рекомендує залишати одиничний статичний елемент inline. Це не доказ конкретного production crash, але конкретна суперечність маршруту роботи агента.

1515 рядків поточного MCP skill і великий текст public descriptions збільшують обсяг правил, які агент має одночасно пам'ятати. Причинний вплив обсягу на якість без benchmark не виміряно. Саму кількість tools не слід оголошувати проблемою: у збереженому Webstudio evaluation каталог також має 196 tools.

### 5. Захисти є, але не утворюють єдиного commit-протоколу — підтверджено кодом

- `submitFiles` має stale-read guard, Oracle gate й очікує `flushSaveNow` перед поверненням.
- `batch` має snapshot rollback; `chain` має compensation. Не можна стверджувати, що Revyme зовсім не має транзакційних механізмів.
- `workspace.ts` уже підтримує явний workspace, але `executeToolCall` у `bridge-tools.ts:361` передає лише checkpoint, viewport та signal. Звичайний MCP шлях бере файл із active-file atom, а nodes — зі спільного snapshot.
- `flushTool` повертає `void`; `insert_fragment` повідомляє перелік створених IDs після flush, не отримуючи typed durable commit receipt. Перевірка існування кожного ID після запису у цьому tool відсутня.
- `flushNow` у `mutation-queue.ts:1330` має вузький synchronous syntax gate для частини mutations; gesture-hot `addNode` свідомо виключено з цього вузького gate. Це рішення для latency редактора, яке не варто успадковувати headless agent operation.
- `oracleReport`, `bridge-tools.ts:405`, перевіряє результат уже після write і не робить rollback. Baseline порівнюється лише за code: якщо старий вузол уже мав порушення X, новий вузол з X може не потрапити у introduced. Це статичний висновок із алгоритму, без окремого runtime reproduction.
- `commitTurnFiles`, `gate.ts:295–297`, викликає `modifyProjectFile`, але додає шлях у `written` незалежно від його поверненого значення. `modifyProjectFile` може повернути `null` при відмові parse gate. Це ризик хибного receipt, підтверджений кодом; конкретний проєкт для відтворення не будувався.
- `commitTurnFiles` перевіряє частину post-normalization drift лише як trace; після нього `modifyProjectFile` ще робить import sync. Немає одного immutable набору фінальних bytes, який був валідований, а потім без змін committed.

### 6. Наявні незакомічені navbar-зміни додають обхід основного шляху

`create_navbar` у `action-layer-rich.ts:1639` прямо викликає `projectFS.writeFile('components/Navbar.tsx', navbarCode)` без перевірки наявного master. Checkpoint починається пізніше, лише при розміщенні інстансу, і при відсутньому root повертається success message про розміщення без створеного instance ID.

Це відрізняється від сусіднього `create_component`, який використовує gate, перевіряє наявний master та branch path. Зовнішній post-write Oracle може помітити частину проблем, але не повертає втрачену попередню версію. Це приклад того, чому нові «розумні» tools без загального executor збільшують ризик. Це не твердження, що саме цей незакомічений tool спричинив усі попередні помилки користувача.

### 7. Atomic storage не дорівнює optimistic concurrency

`server/storage.ts:146` атомарно замінює JSON через temp + rename. Але локальний `PUT /api/projects/:id`, `server/api-plugin.ts:796`, не порівнює expected project revision перед `saveProject`. Atomic rename запобігає частково записаному JSON, але не перезапису актуальних даних старим snapshot.

Revyme вже має `src/backend/save-revision.ts` для іншого save-контракту та recovery revisions у local backend. Їх наявність не доводить, що локальний storage API виконує CAS. Новому CLI потрібен CAS на серверній стороні, спільний із browser save, інакше стара вкладка зможе перетерти правильну CLI-зміну.

## Що перевірено виконанням

Команда:

```sh
./node_modules/.bin/vitest run server/mcp-bridge.test.ts src/ai/agent/bridge-tools.test.ts src/ai/agent/tools/insert-fragment.test.ts src/ai/agent/tools/batch.test.ts src/ai/agent/tools/chain.test.ts --reporter=dot
```

Результат: **5 файлів, 95 тестів пройшли**, 18.97 s. Це підтверджує стан цих suites, але не відсутність знайдених дефектів: вони переважно перевіряють інші контракти; fragment suite mock-ає queue і flush.

Окрема відтворювана перевірка:

```sh
./node_modules/.bin/tsx docs/superpowers/research/2026-10-21-mcp-contract-probes.ts
```

Результат: усі diagnostic assertions підтвердили поточні дефекти. Скрипт навмисно проходить, коли виявляє стару проблемну поведінку; це characterization probe, а не regression gate нового MCP. Під час реалізації відповідні assertions необхідно інвертувати й перенести у постійні tests.

Webstudio збережені evaluation reports, не запущені мною заново:

| Fixture | Outcome | Tool calls | Failed calls |
|---|---|---:|---:|
| authenticated-page-v1 | passed | 5 | 0 |
| design-input-v1 | passed | 11 | 0 |
| font-assets-v1 | passed | 6 | 0 |
| markdown-blog-v1 | passed | 16 | 0 |
| markdown-references-discovery-v1 | passed | 20 | 0 |

Не запускалися: повний suite Revyme, повний TypeScript check, Webstudio tests, production publish, browser visual comparison та paid model evaluations.

## Варіанти нового інструмента

| Варіант | Перевага | Обмеження |
|---|---|---|
| CLI-обгортка над існуючим `/rpc` | Найшвидший proof of concept | Зберігає залежність від вкладок, активного файлу й неоднозначного збереження; не розв'язує основної причини |
| Новий headless automation core + CLI + тонкий MCP adapter | Один контракт, explicit state, dry-run, durable commits; зберігає TSX формат | Потрібні відділення browser dependencies і спільний CAS для editor/CLI |
| Перейти на Webstudio-подібний persisted scene graph | Зменшує простір допустимих документів | Змінює фундамент Revyme та вимагає переписування editor/parser/export; не відповідає поточній архітектурі |

Рекомендовано другий варіант. «З нуля» стосується зовнішнього automation API, executor і transports; перевірені parsers, generators, runtime exports та pure Oracle rules треба використати повторно, а не переписувати паралельно.

## Архітектурний brief

Мета: агент створює та редагує GUI-editable сайти Revyme через shell або MCP без відкритої вкладки; кожен запис прив'язаний до project/branch/file, перевірений на фінальних bytes і підтверджений durable receipt. Помилки мають машинний код та шлях входу; відсутність вимірювання ніколи не виглядає як успішна перевірка.

Обмеження: TSX залишається джерелом істини; scene graph не додається. Canvas DOM не є write API. Порожній style string зберігає значення delete. Breakpoints беруться з проєкту. Published behavior використовує `@revyme/runtime`. Наявні проєкти й ручні зміни зберігаються. Автоматизація не публікує сайт без окремої команди користувача.

Перший release: pages, semantic fragments, styles/text/attrs, responsive overrides, design components/instances, tokens та assets; static validation, export/build smoke і обмежений rendered verification. CMS, slots, variants/connections, motion та code components — наступні явні capability slices перед повною міграцією зі старого MCP. Відсутня можливість повертає `UNSUPPORTED_CAPABILITY`, а не обходиться raw write.

Критерій «бездоганно»: не обіцянка відсутності всіх LLM-помилок, а відсутність тихого пошкодження, неправдивого success та неконтрольованого повторного commit, плюс виміряна висока успішність на відкритому benchmark. Повний план і критерії приймання: `../plans/2026-10-21-revyme-cli-mcp-v2.md`.

## Доповнення після рев'ю: ingestion та когнітивне навантаження агента

Початковий план недостатньо розрізняв «коректно відхилити неправильний запис» та «допомогти агенту не робити десятки механічних виправлень». Власне normalization у ньому була, але не було явного шару natural authoring → canonical Revyme dialect, його правил і метрик. Це суттєва прогалина для agent UX, незалежна від знайдених transport defects.

Перевірка коду підтвердила підстави зауваження:

- `src/code/oracle/preflight-validation.ts:49` явно відхиляє `ul/ol/li` на користь frames; на рядку 213 відхиляє відносні одиниці в px-only spacing.
- `src/code/parsing/heal-data-ids.ts` вже лікує missing IDs PascalCase instances, свідомо не штампуючи lowercase rich-text і transparent wrappers. `insert_fragment` теж уже генерує IDs. Отже, механізми існують частково, але не як єдиний ingestion contract.
- `src/shared/css-utils.ts` містить `resolveSpacingSides`, `healSpacingShorthand`, `SHORTHAND_LONGHANDS`, `mergeStyleLayers`. Їх слід використати, перевіривши придатність для конкретного CSS синтаксису, замість regex-конвертера всіх shorthands.
- `src/code/generation/create-component-gen.ts:495`, `buildCreatedMaster`, уже генерує design-component boilerplate, props metadata та IDs.
- `src/code/oracle/check-file.ts:418` та наступні checks очікують валідний JSON controls schema; сам marker `@controls` не доводить придатність Inspector і не ремонтує довільну сторонню логіку.

Рекомендацію оновлено: ingestion/desugarer входить у tasks 2 та 5 й MVP. Він автоматично нормалізує безпечні конструкції, scaffold-ить явно визначений тип компонента і повертає report. Oracle перевіряє вже canonical result і залишається незалежним gate. Перетворення відносних одиниць потребує явного unit context; list recipe зберігає доступність і markers; component kind не змінюється потай. «Framer-модель» у цьому доповненні — назва запропонованого принципу, а не результат дослідження коду Framer.

У tasks 6 та 10 додано design/code scaffolding, у task 11 — paired ingestion on/off evaluation: Oracle bounces, repair calls, tokens, first-pass acceptance і preservation failures. Твердження «швидше або надійніше за Webstudio» до цих порівнянь залишається гіпотезою.
