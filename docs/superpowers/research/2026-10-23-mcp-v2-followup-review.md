# MCP v2: повторний review після виправлень R1–R11

Дата: 2026-10-23. Гілка: `feature/mcp-v2`, HEAD `35c3887`, перевірений fix-коміт `3772b67`.

**Висновок: реалізація ще не відповідає acceptance/release gates погодженого плану.** Частина попередніх дефектів виправлена, але залишаються втрата змін після recovery, змішування проєктів у singleton ProjectFS, непрацездатність CLI на Windows і прогалини canonical executor/validation. Заява про закриття всіх R1–R11 не підтверджується.

Джерела вимог: [implementation plan](../plans/2026-10-21-revyme-cli-mcp-v2.md), [full coverage spec](../specs/2026-10-21-revyme-mcp-full-coverage.md), [первинний review R1–R11](2026-10-23-mcp-v2-code-review.md), diff `3772b67`. Історичні MVP/architecture-reference не трактувалися як звуження scope.

## Підтверджені findings

### F1 — P1: recovery reload знову дозволяє перезаписати новіші MCP-зміни

Місця: `src/backend/local-backend.ts:118–124`, `server/storage.ts:184–195`.

Звичайний stale save тепер правильно дає 409, але перед цим зберігає unsynced recovery copy. Після reload `baseRevision` знову null. `loadProject()` обирає recovery-копію та повертається до `setLoadedRevision()`. Наступний save не передає baseRevision; storage перевіряє CAS лише коли вона задана.

Відтворення: load revision 1 → MCP пише revision 2 з текстом Agent → GUI save отримує 409 → reload із recovery → наступний GUI save успішно записує revision 3 **без Agent**. Це реальна втрата змін; R3 виправлено лише для сценарію без reload.

Потрібно зберігати base revision разом із recovery copy та відхиляти blind replacement revisioned проєкту. Не можна просто привласнити recovery-копії поточну revision сервера: це також легалізує stale overwrite.

### F2 — P1: headless backup змішує файли різних проєктів

Місця: `packages/automation-core/src/operations/projects.ts:27–51`, `:213–218`.

`syncProjectSnapshotToProjectFS()` читає глобальний ProjectFS і додає зі snapshot лише відсутні шляхи. Наявний файл не оновлюється, чужі файли не прибираються. `projects.backup.export` потім експортує цей singleton, а не scoped snapshot.

Відтворення в одному процесі: export A з `only-a.txt` та `common.txt=A`, потім export B з `only-b.txt` та `common.txt=B`. Backup B містить `only-a.txt` і старий `common.txt=A`. У stdio MCP процес довгоживучий, отже перемикання projectId може повернути чужий source і зіпсувати backup/restore. У probe також видно початкові demo-файли singleton.

Це порушує explicit scope і заборону singleton у T01/T21. Аналогічний helper використовують branches/history; їхня ізоляція потребує окремого доведення. Потрібна операційна модель зі scoped snapshot/envelope без глобального editor ProjectFS.

### F3 — P1: встановлений CLI/MCP не запускається на Windows

Місце: `packages/cli/bin/revyme.mjs:11` (аналогічно `:15`).

`import(distMain)` отримує абсолютний Windows path `C:\...`, який ESM сприймає як URL із протоколом `c:`. Pack-тест після дозволу доступу до npm cache падає на `--version` з `ERR_UNSUPPORTED_ESM_URL_SCHEME`. До CLI dispatcher або stdio transport виконання не доходить.

Потрібен `pathToFileURL(...).href` для dynamic import та Windows packed-bin smoke test. Додавання Babel dependencies у R5 цього не виправило. Крім того, pack-тест досі під'єднує весь repo node_modules, а manifest залежить від private automation-core; справжній install dependency closure цим тестом не доведений.

### F4 — P1: Windows validator відхиляє коректні relative imports

Місце: `packages/automation-core/src/validate.ts:155`.

Virtual project paths мають `/`, але `path.normalize(path.join(...))` використовує Windows `\`. Тому пошук `app\about\page.client.tsx` у map із ключем `app/about/page.client.tsx` провалюється.

Відтворено через справжні AutomationClient → HTTP → CommitService: `pages.create({slug:'about',title:'About'})` повертає `PLAN_VALIDATION_FAILED / UNRESOLVED_IMPORT ./page.client`; revision залишається 1. Існуючий regression test R1/R2 теж падає саме тут. Потрібен POSIX resolver для virtual paths, незалежний від host OS.

### F5 — P1: server commit не перевіряє відповідність planHash фактичним bytes

Місця: `server/automation/commit-service.ts:47–49`, `:99`; `packages/automation-core/src/validate.ts:23`.

Hash обчислюється у createPlan, але сервер йому довіряє. Probe створює plan із `notes.txt=reviewed`, змінює content на `changed after review` без перерахунку hash і викликає public CommitService. Відповідь — committed revision 2 із hash початкового payload.

Це ламає exact-byte identity та idempotency: receipt описує інший payload, а retry lookup відбувається до будь-якої перевірки bytes. Потрібно runtime-validate Plan та перераховувати canonical hash до lookup/commit, відхиляючи невідповідність. Наявна перевірка hash у fallback `plans.commit.execute()` не захищає HTTP commit, який викликає service напряму.

### F6 — P1: workflow.chain не записує результати успішних кроків

Місця: `packages/automation-core/src/plan.ts:191–236`, `packages/cli/src/client.ts:328–336`.

Chain оновлює лише тимчасову Map і повертає `{completed,receipts}`. Клієнт не бачить top-level changes/plan, трактує результат як read output і не викликає commit.

Відтворено через HTTP client: chain із `styles.set(color:red)` повертає `ok:true`, `completed:1`, step `status:ok`, але `commitStatus:not_committed`, revision на диску залишається 1, стилю немає. Потрібне виконання chain через durable executor із receipt кожного записаного кроку, як вимагає T03.

### F7 — P2: dry-run не запускає validation, ingestion не підключений до спільного шляху

Місця: `packages/cli/src/client.ts:340–350`, `packages/automation-core/src/session.ts:111–115`.

Probe `styles.set(padding:'1.5rem')`: dry-run повертає `ok:true`, порожні issues/normalizations; звичайний commit тих самих змін відхиляється Oracle з `SPACING_UNIT_NOT_PX`. Клієнт має validatePlan(), але execute() не викликає його перед поверненням dry-run.

prepareOperation лишився wrapper над op.execute; ingestion helpers не викликаються canonical planner. R6 додав Oracle gate, але не normalization/report/contextual-unit pipeline, який вимагали план і первинний review. Потрібні спільні normalization → final validation для dry-run та commit; для невідомого unit context — targeted issue, без припущення root=16px.

### F8 — P2: видалення dependency проходить validation та ламає кінцевий проєкт

Місця: `packages/automation-core/src/validate.ts:46`, `:70–73`.

Validator обходить лише changed files, deletion одразу пропускає. Probe: `lib/a.ts` імпортує `./b`, plan видаляє `lib/b.ts`; CommitService повертає committed, хоча кінцевий file set містить unresolved import. Потрібно перевіряти залежні незмінені файли/кінцевий dependency graph, а не лише новий текст змінених файлів. Це незакрита частина R6/T03.

### F9 — P2: R11 не виправлено — verified/100% Passing досі літеральні

Місця: `scripts/automation-inventory.cjs:267` та решта C01–C37, `:609`; `e2e/automation-v2/L01-landing.spec.ts:8`; `playwright.config.ts:29`.

Coverage generator досі ставить `verified` без test-run evidence та друкує `100% Passing` у template. L01–L04 імпортують Vitest і викликають operations напряму; Playwright discovery має testDir `./src` і не запускає ці файли як браузерні acceptance.

Це не доводить GUI edit/save/reload, runtime interactions, Next export build або configured cloud readiness. Потрібні чесні evidence-derived statuses та справжні acceptance за T24/T25; зелений mapping/unit suite не закриває ці gates.

## Повторна оцінка R1–R11

| Старий finding | Результат повторної перевірки |
|---|---|
| R1 — snapshot wire contract | Snapshot тепер читається реальним клієнтом. `/status` та `/plan` ще повертають top-level payload замість заявленого Result/data/meta; повної runtime schema parity немає. |
| R2 — output → Plan | Wrapper для changes та nested plan додано; Windows pages.create блокує F4, chain не persisted (F6), dry-run не validated (F7). |
| R3 — GUI revision | Початковий stale save і звичайний reload/save regression проходять. Recovery reload знову втрачає зміни (F1). |
| R4 — cache перед disk write | Регресія rename failure проходить: cache оновлюється після rename. Cross-process durability/concurrency цим не доведені. |
| R5 — packaging | Babel dependencies додано, package typechecks проходять. Installed Windows launcher падає (F3); isolated install не доведений. |
| R6 — ingestion/Oracle/hash/imports | Oracle і non-null beforeHash comparison додано. F4/F5/F7/F8 лишають canonical pipeline неповним; null beforeHash досі пропускає existing-file check. |
| R7 — built-in source | Regression для Marquee source та validatePlan проходить. Увесь каталог, dependency closure, GUI controls і export build не перевірені. |
| R8 — fake deployed | Прямий regression без adapter проходить: success:false/status:unavailable; реальна service acceptance не виконувалася. |
| R9 — retry | Повтор того самого plan через CommitService повертає receipt; transport exception тепер unknown; hash authenticity лишається F5. |
| R10 — receipts після GUI save | Regression із новим repository instance проходить: persisted receipt збережений. |
| R11 — release evidence | Не виправлено, F9. |

## Виконані перевірки та межі

Windows, Node `v24.18.0`, Vitest `4.1.6`; залежності вже були у workspace, reinstall не виконувався.

- `npx vitest run packages/automation-core/test/capabilities --reporter=dot`: **36 suites, 663 passed**.
- `npx vitest run packages/automation-core/test/review-runtime-probes.test.ts server/automation packages/cli/test --reporter=dot`: **38 passed, 2 failed**. Один failure — Windows pages.create (F4), інший спочатку npm cache sandbox restriction.
- Окремий pack-test повторено з дозволом запису npm cache: pack успішний, binary `--version` падає з `ERR_UNSUPPORTED_ESM_URL_SCHEME` (F3). Це вже помилка реалізації, не sandbox.
- `npx tsc --noEmit -p packages/cli/tsconfig.json`: exit 0.
- `npx tsc --noEmit -p packages/automation-core/tsconfig.json`: exit 0.
- Сім незалежних regression probes із правильними очікуваннями: **7 failed**, кожний відтворює F1/F2/F4/F5/F6/F7/F8. Це докази дефектів, не positive acceptance.

Повний root suite, браузерні GUI flows, справжній stdio round-trip, isolated npm install, Next export build, cloud/service acceptance та агентний benchmark не виконувалися. Packed-bin failure блокує Windows stdio launcher ще до запуску transport. Review не претендує на перевірку кожного leaf усіх C01–C37; перевірено критичний спільний шлях і закриття попередніх findings.

Evidence: [probe source](2026-10-23-mcp-v2-followup-evidence/followup-review.test.ts.txt), [probe output](2026-10-23-mcp-v2-followup-evidence/probes.txt), [capability suite output](2026-10-23-mcp-v2-followup-evidence/capabilities.txt). Для повтору скопіювати probe source у `packages/automation-core/test/followup-review.test.ts` та запустити Vitest для цього файла. Тести працюють із тимчасовими project directories та локальним HTTP server. Збережений source переміщено з test directory у evidence, щоб не додавати навмисно червоні тести до звичайного suite.

Production source не змінювався. Додано лише review/evidence; build-тест згенерував ignored CLI dist. Наявні user-owned untracked files не змінювалися.

Пріоритет виправлень: F1/F2 (дані та scope), F3/F4 (Windows execution), F5/F6/F7/F8 (спільний executor і validation), потім F9 зі справжнім vertical CLI/MCP → persisted reread → GUI → export acceptance. Переписування на третю архітектуру не потрібне.
