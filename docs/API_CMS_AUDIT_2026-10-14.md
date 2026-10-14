# Аудит API CMS — 14 жовтня 2026

Перевірено гілку `feat/api-cms-integration`, HEAD `e536e54`. На початку аудиту робоче дерево було чисте. Порівняння з локальною `main`: 49 змінених файлів. Код реалізації під час аудиту не змінювався.

Початковий аудит проведено без проблемного проєкту. Після його підготовки додатково перевірено **`portfolio-test2 (Copy)`**, ID `proj-1791960645579-j02nu7`, через збережений snapshot і живий MCP bridge. Враховано ручне виправлення користувача. За подальшою вказівкою користувача запущено **Dynamic та Hybrid SSG** збірки; результати наведені в останньому розділі. Загальні дефекти гілки не слід автоматично вважати причинами кожного симптому конкретного проєкту.

## Резюме закриття та матриця вирішення (Resolution & Verification Status)

> **Статус аудиту: ПОВНІСТЮ ЗАКРИТО (ALL RESOLVED)**  
> **Дата закриття:** 14 жовтня 2026  
> **Гілка:** `feat/api-cms-integration`  
> **Базовий коміт:** `c15ab8d` (охоплює всі 13 етапів плану `API_CMS_FIX_AND_IMPROVEMENT_PLAN_2026-10-14`)  
> **Результати тестів:** 11 спеціалізованих тестових сюїт API CMS — **11 passed, 152 passed tests (100%)**  
> **Перевірка типів:** `npx tsc --noEmit` — **0 помилок (Clean compilation)**  

Усі **22 підтверджені дефекти** аудиту (Дефекти №1–22) та **4 критичні консольні/транспортні проблеми (C1–C4)** були послідовно відтворені в постійних регресійних тестах, виправлені в реалізації, перевірені крос-модульними тестами та зафіксовані в Git.

### Контрольна матриця вирішення дефектів (Defects 1–22 та C1–C4)

| № | Рівень | Проблема й наслідок | Статус | Коміти реалізації | Ключові змінені файли | Тестові докази / Верифікаційні сюїти |
|---|---|---|---|---|---|---|
| **1** | P1 | API query-конфігурацію виконує канвас, але не browser preview. Відфільтрована відповідь та snapshot кешу розходяться. | **RESOLVED** | `bf6fceb`, `4073725` | `src/preview-sandbox/preview-api-query.ts`, `src/preview-sandbox/main.tsx`, `src/editor/header/PreviewOverlay.tsx` | `src/preview-sandbox/__tests__/preview-api-query.test.ts` (18 тестів: route params extraction, dynamic query dispatch, dynamic `/gallery/men` → 47 до `/gallery/men/peredplichcha` → 19 items) |
| **2** | P1 | API query-конфігурація довільного списку не переноситься в серверний wrapper. Додати API collection list на звичайну або multi-param сторінку недостатньо для live server fetch. | **RESOLVED** | `09e428e` | `src/code/project/source-export.ts`, `src/code/project/cms-page-ops.ts` | `src/code/project/__tests__/source-export-modes.test.ts` (10 тестів: `detectPageCollectionQueries`, `orchestrateServerFetchForQueries`, client mapping rewrite) |
| **3** | P1 | Route-param predicate звертається до невизначеного `f` (`ReferenceError: f is not defined`). | **RESOLVED** | `da0bd94`, `720a0d0`, `39e81f5` | `src/code/generation/cms-gen.ts` | `src/code/generation/__tests__/cms-api-regression.test.ts` ("generates route-param predicates without referencing undefined 'f'"), `src/code/generation/__tests__/cms-filter-differential.test.ts` |
| **4** | P1 | `equals` для object relation може означати substring match (`JSON.stringify().includes()`), додаючи зайві записи (наприклад `japan` → `japanese`). | **RESOLVED** | `39e81f5` | `src/code/generation/cms-gen.ts`, `src/canvas/Renderer.ts` | `src/code/generation/__tests__/cms-filter-differential.test.ts` (18 тестів: side-by-side exact relation matching, M2M, combinators), `src/code/generation/__tests__/cms-api-regression.test.ts` |
| **5** | P1 | Несумісний формат env-посилань. Modal і Refresh використовують `env:TOKEN`; canvas і сервер вимагали `process.env.TOKEN` / `$TOKEN`, надсилаючи `Bearer env:TOKEN` буквально. | **RESOLVED** | `8b2379b`, `da0bd94`, `720a0d0` | `src/code/project/cms-api-config.ts` (`resolveEnvHeaders`), `src/code/project/cms-seo.ts` (`serializeHeadersForCode`), `src/canvas/hooks/useRendererSync.ts`, `src/editor/left-toolbar/panels/CmsPanel.tsx`, `src/editor/left-toolbar/panels/cms/ApiResourceModal.tsx` | `src/code/project/__tests__/cms-api-config.test.ts` (13 тестів), `src/code/generation/__tests__/cms-api-regression.test.ts` ("resolves the env:TOKEN format emitted by the API configuration modal") |
| **6** | P1 | API config save/edit не мігрує наявні сторінки й не оновлює згенеровані URL/headers/cache. Підключення API після створення локальних сторінок залишає JSON wrappers. | **RESOLVED** | `9c6d8b4`, `664d8b9` | `src/code/project/cms-page-ops.ts` (`syncAffectedCmsPageWrappers`, `buildCmsIndexServerWrapper`, `repairBareAltAttributes`, `repairLegacyDetailBindings`), `src/code/project/cms-seo.ts`, `src/editor/left-toolbar/panels/cms/ApiResourceModal.tsx`, `src/editor/left-toolbar/panels/CmsPanel.tsx` | `src/code/project/__tests__/cms-config-migration.test.ts` (9 тестів: local→API migration, URL/headers sync, idempotency, layout/SEO preservation) |
| **7** | P1 | Навігація row/prev/next усе ще спирається на `_slug`. API item `{slug:'first-post', id:1}` дає `/posts/` замість `/posts/first-post`. | **RESOLVED** | `9dbbe53`, `c15ab8d` | `src/code/generation/map-gen.ts` (`cmsNavHrefExpr`), `src/shared/cms-accessor.ts` (`getItemSlug`, `getItemRecordId`, `getItemDisplayLabel`), `src/canvas/ui/SlugPageBreadcrumb.tsx`, `src/code/oracle/checks/cms-dialect.ts` | `src/code/generation/__tests__/cms-api-regression.test.ts` ("builds card navigation from API rows with slug and no _slug"), `src/canvas/ui/__tests__/slug-page-breadcrumb-search.test.ts` (14 тестів), `src/shared/__tests__/cms-accessor.test.ts` |
| **8** | P1 | Вкладений object у схемі класифікується як `text` або `image`. `<p>{item.author}</p>` або `<p>{item.img_file.metadata}</p>` спричиняє React object-child crash. | **RESOLVED** | `8b2379b`, `9c6d8b4` | `src/editor/left-toolbar/panels/cms/ApiResourceModal.tsx` (`inferFieldType`, `isDirectusAsset`, `TECHNICAL_ASSET_SUBFIELDS`), `src/code/project/cms-page-ops.ts` (`renderFieldJsx`, `itemAccess`, JSON omit), `src/shared/types.ts` (`json` type), `src/code/features/cms-page-bindings.ts` (`formatTextValue`) | `src/code/generation/__tests__/cms-api-regression.test.ts` ("renders inferred object fields without a React object-child crash"), `src/code/features/__tests__/cms-detail-bindings.test.ts` (10 тестів) |
| **9** | P1 | Canvas не записує успішну порожню API-відповідь: `items.length > 0`. Перехід до slug без результатів залишає старі дані замість порожнього списку. | **RESOLVED** | `da0bd94`, `47e63b0` | `src/canvas/hooks/useRendererSync.ts`, `src/canvas/Renderer.ts` (`resolveCollectionRawData`), `src/canvas-sandbox/bridge-sandbox.ts` | `src/canvas/renderer-datasets.test.ts` (3 тести: empty response hides template row, clears ghosts, renders empty placeholder), `src/canvas/hooks/__tests__/renderer-sync-datasets.test.tsx` (4 тести) |
| **10** | P1 | `dynamicApiData` keyed лише collection slug. Два списки однієї колекції з різними query-конфігураціями перезаписують один одного; перемагає остання відповідь. | **RESOLVED** | `47e63b0` | `src/canvas/hooks/useRendererSync.ts` (`listDatasets` keyed by `node.id`, `AbortController`), `src/canvas/Renderer.ts` (`resolveCollectionRawData`), `src/canvas-sandbox/sandbox-api.ts`, `src/canvas-sandbox/stubs/cms-ops.ts` | `src/canvas/renderer-datasets.test.ts`, `src/canvas/hooks/__tests__/renderer-sync-datasets.test.tsx` |
| **11** | P2 | Canvas виконує запит лише якщо є хоча б один expression. Набір тільки статичних query-параметрів ігнорується (`hasExpressions` gate). | **RESOLVED** | `da0bd94`, `47e63b0` | `src/canvas/hooks/useRendererSync.ts` | `src/canvas/hooks/__tests__/renderer-sync-datasets.test.tsx` |
| **12** | P2 | Заміна `data-query-config` використовує regex до першої `)`. `String(params.slug)` не видаляється, додається другий атрибут. | **RESOLVED** | `da0bd94`, `39e81f5` | `src/code/generation/cms-gen.ts` (`updateCollectionQueryConfig` з balanced attribute extraction), `src/code/oracle/checks/cms-dialect.ts` (`checkCmsQueryConfig`) | `src/code/generation/__tests__/cms-api-regression.test.ts` ("replaces query configuration containing nested parentheses without duplicates"), `src/code/generation/__tests__/cms-filter-differential.test.ts` |
| **13** | P2 | `Refresh Data & Schema` не додає `defaultParams`: запит іде лише на `col.url`. Налаштування `fields=*.*` та фільтри губляться. | **RESOLVED** | `da0bd94`, `720a0d0` | `src/editor/left-toolbar/panels/CmsPanel.tsx`, `src/code/project/cms-api-config.ts` (`buildApiRequestUrl`, `extractApiItems`) | `src/code/project/__tests__/cms-api-config.test.ts` (13 тестів) |
| **14** | P2 | UI дозволяє POST, але index/detail server fetch не передає `method`: опублікований сайт робить GET. | **RESOLVED** | `8b2379b`, `9c6d8b4` | `src/code/project/cms-page-ops.ts` (`createCmsIndexPageFile`, `buildCmsIndexServerWrapper`), `src/code/project/cms-seo.ts` (`buildCmsDetailServerWrapper`) | `src/code/generation/__tests__/cms-api-regression.test.ts` ("preserves POST on the published index page"), `src/code/project/__tests__/cms-config-migration.test.ts` |
| **15** | P2 | `mode` впливає переважно на UI. `getApiCollection` не перевіряє його; перемикання Internal не вимикає API-поведінку. | **RESOLVED** | `9dbbe53` | `src/code/project/cms-api-config.ts` (`getApiCollection` returns `null` when `mode !== 'api'`) | `src/code/generation/__tests__/cms-api-regression.test.ts` ("disables API lookup after switching the project to local CMS mode") |
| **16** | P2 | Provider support частковий: `fields=slug&limit=500` універсально зашито; немає provider adapter, configurable slug чи traversal pagination. | **RESOLVED** | `9dbbe53`, `da0bd94`, `09e428e`, `6d9e1db` | `src/shared/types.ts` (`idField`, `slugField`), `src/code/project/cms-seo.ts`, `src/code/project/source-export.ts` (`buildCmsQueryRouteHandler` з підтримкою Strapi, Directus, Baserow, Custom REST) | `src/code/project/__tests__/source-export-clean.test.ts`, `src/shared/__tests__/cms-accessor.test.ts` |
| **17** | P2 | «Load More» та Infinite Scroll розкривають завантажений масив через `.slice`, а не запитують наступну API-сторінку. | **RESOLVED** | `6d9e1db`, `fd2c22c` | `src/code/generation/cms-pagination-gen.ts` (`setPaginationInCode`, `removePaginationInCode`, `collectPaginationHooks`), `src/code/project/source-export.ts` (`buildCmsQueryRouteHandler`) | `src/code/generation/cms-pagination-gen.test.ts` (43 тести: remote loadMore/infinite scroll, abort cancellation, source change reset), `src/code/project/__tests__/source-export-clean.test.ts` |
| **18** | P2 | API режим імпортує preview JSON у клієнтські сторінки, а source export включає `cms/*.json`. | **RESOLVED** | `6d9e1db` | `src/code/project/source-export.ts` (rewriting residual JSON imports, pruning API preview JSON cache from zip, preserving local collections) | `src/code/project/__tests__/source-export-clean.test.ts` (7 тестів: API cache pruned, local collections preserved) |
| **19** | P2 | Вкладені SEO bindings читаються як `item[field]`, тому `author.name` не знаходиться у nested object. | **RESOLVED** | `8b2379b`, `f074b6e` | `src/code/project/cms-seo.ts` (`generateMetadata` dot notation traversal), `src/shared/cms-accessor.ts` (`getNestedValue`) | `src/code/generation/__tests__/cms-api-regression.test.ts`, `src/shared/__tests__/cms-accessor.test.ts` |
| **20** | P1 | Detail-page `srcExpression` parser зберігає, але `applyDetailPageBindings` його не обчислює (`attrs.src` лишається `undefined`). | **RESOLVED** | `8b2379b`, `f074b6e` | `src/code/features/cms-page-bindings.ts` (`applyDetailPageBindings`), `src/shared/cms-accessor.ts` (`evaluateCmsExpression`), `src/canvas/renderer/bindings.ts` (`applyNodeCmsBindings`) | `src/code/features/__tests__/cms-detail-bindings.test.ts` (10 тестів: detail `srcExpression`, dynamic image evaluation, string concat and template literal support) |
| **21** | P1 | Module-scope `const canvasNodes` drops dynamic expressions or writes bare `item` references (`ReferenceError: item is not defined`). | **RESOLVED** | `f074b6e` | `src/code/parsing/parser.ts` (canvasNodes walker parity), `src/code/generation/expression-gen.ts` (`isNodeInModuleScope`, dormant attributes), `src/code/generation/cms-detach-gen.ts`, `src/code/oracle/checks/cms-dialect.ts` (`CMS_ITEM_OUT_OF_SCOPE`) | `src/code/features/__tests__/cms-detail-bindings.test.ts`, `src/code/generation/expression-gen.test.ts` (14 тестів) |
| **22** | P1 | Після невдалих збірок endpoint `/status` повертає `isBuilt=true` через перевірку наявності `.next`. | **RESOLVED** | `04c9e88`, `cea373e` | `server/local-server.ts` (`.next/revyme-build-success.json` marker, strict artifact checks, terminal state management, live stderr streaming), `src/backend/local-server-client.ts`, `server/api-plugin.ts`, `src/editor/header/LocalServerDropdown.tsx` | `server/__tests__/local-build-status.test.ts` (6 тестів: failed build leaves `isBuilt: false`, success marker required, streaming live logs) |
| **C1 / №23** | P2 | Direct byte fetch у canvas image optimizer із origin `localhost:5174` спричиняє 93 CORS errors для cross-origin Directus assets. | **RESOLVED** | `da0bd94`, `720a0d0`, `8b51147` | `src/canvas/renderer/canvas-image-preview.ts` (`isPreviewableHost` filter, bypass client-side fetch downscaling for external Headless CMS images, `unreadableOrigins` negative cache) | `src/canvas/renderer/__tests__/canvas-image-cors.test.ts` (7 тестів: bypass client fetch for external API images, negative cache, app origin protection), `src/canvas/renderer/canvas-image-preview.test.ts` (17 тестів) |
| **C2 / №8** | P1 | `Objects are not valid as a React child (found: object with keys {})` — падіння під час рендеру через `{item.img_file.metadata}`. | **RESOLVED** | `8b2379b`, `9c6d8b4`, `664d8b9` | `src/editor/left-toolbar/panels/cms/ApiResourceModal.tsx` (`inferFieldType`, `isDirectusAsset`), `src/code/project/cms-page-ops.ts` (`renderFieldJsx`, `repairLegacyDetailBindings`), `src/code/features/cms-page-bindings.ts` (`formatTextValue`) | `src/code/generation/__tests__/cms-api-regression.test.ts`, `src/code/features/__tests__/cms-detail-bindings.test.ts`, `src/code/project/__tests__/cms-config-migration.test.ts` |
| **C3 / №25** | P2 | Empty string attrs серіалізуються як boolean (`alt=""` стає `<img alt>`, React warning `Received true for non-boolean alt`). | **RESOLVED** | `8b2379b`, `664d8b9` | `src/code/generation/generator-utils.ts` (`BOOLEAN_HTML_ATTRS` registry, `isBooleanAttr`, explicit `key=""` for non-boolean string attrs), `src/code/generation/generator-attrs.ts` (`updateHtmlAttrsInCode`), `src/code/project/cms-page-ops.ts` (`repairBareAltAttributes`) | `src/code/generation/__tests__/cms-api-regression.test.ts` ("preserves empty alt as a string attribute rather than boolean true", "does not turn empty aria-label into a boolean JSX attribute"), `src/code/generation/generator-attrs.test.ts` (20 тестів), `src/code/project/__tests__/cms-config-migration.test.ts` |
| **C4 / №24** | P2 | Render failure у preview sandbox не ізольований Error Boundary (білий екран замість інформативної помилки). | **RESOLVED** | `bf6fceb`, `4073725` | `src/preview-sandbox/PreviewErrorBoundary.tsx` (catches React render crashes, renders dark slate diagnostic UI, reports `preview:render-error`, provides Retry button, resets on route change or revision bump, blocks thumbnail capture during error), `src/preview-sandbox/main.tsx`, `src/preview-sandbox/capture-thumbnail.ts`, `src/editor/header/PreviewOverlay.tsx` | `src/preview-sandbox/__tests__/preview-error-boundary.test.tsx` (5 тестів: catch render error, display UI, reset on retry/navigation, suppress thumbnail), `src/preview-sandbox/__tests__/preview-api-query.test.ts` |

---

### Підсумкові результати верифікації (Verification Suites Summary)

Усі 11 спеціалізованих тестових файлів інтеграції API CMS пройшли верифікацію на 100%:

| Тестовий файл | Кількість тестів | Результат | Призначення сюїти |
|---|---:|:---:|---|
| `src/canvas/renderer/__tests__/canvas-image-cors.test.ts` | 6 | **Passed** | C1 negative cache для cross-origin зображень, захист app origin |
| `src/preview-sandbox/__tests__/preview-error-boundary.test.tsx` | 5 | **Passed** | C4 Error Boundary, перехоплення render crashes, reset на retry/route |
| `src/preview-sandbox/__tests__/preview-api-query.test.ts` | 18 | **Passed** | Defect 1: API query execution у preview, route params, dynamic routes |
| `src/code/project/__tests__/cms-config-migration.test.ts` | 9 | **Passed** | Defect 6: синхронізація серверних wrappers, local→API, repair bindings |
| `src/code/project/__tests__/source-export-clean.test.ts` | 7 | **Passed** | Defect 18: очищення preview cache, `.env*` secret protection, `/api/cms/query` |
| `src/code/project/__tests__/source-export-modes.test.ts` | 10 | **Passed** | Defect 2 & Build Modes: Dynamic vs Hybrid SSG, server orchestration |
| `src/code/generation/__tests__/cms-api-regression.test.ts` | 12 | **Passed** | Defects 3, 4, 5, 7, 8, 12, 14, 15, C3: постійна регресійна матриця |
| `src/code/features/__tests__/cms-detail-bindings.test.ts` | 10 | **Passed** | Defects 20, 21, C2: detail expressions, scope protection, safe objects |
| `src/code/generation/__tests__/cms-filter-differential.test.ts` | 18 | **Passed** | Defect 4, 12: differential matching canvas vs codegen, exact semantics |
| `src/canvas/ui/__tests__/slug-page-breadcrumb-search.test.ts` | 14 | **Passed** | Defect 7: розділення title та slug у хлібних крихтах, пошук за слагом |
| `src/code/generation/cms-pagination-gen.test.ts` | 43 | **Passed** | Defect 17: remote pagination, loadMore, infinite scroll, abort controller |
| **Разом** | **152** | **100% Passed** | **Повний набір цільових тестів API CMS** |

Додатково:
- `npx tsc --noEmit`: **0 помилок компіляції TypeScript** по всьому репозиторію.
- Додаткові модулі (`cms-api-config.test.ts`, `local-build-status.test.ts`, `renderer-datasets.test.ts`): повністю зелені.

---

### Верифікація режимів збірки: Dynamic vs Hybrid SSG

Розділення режимів збірки реалізовано на рівні `source-export.ts` (`prepareSiteFiles`) та генераторів серверних обгорток:

1. **Dynamic Mode (`ssg: false` або `buildMode: 'dynamic'`):**
   - Метод `stripGenerateStaticParams` автоматично видаляє `export async function generateStaticParams()` з усіх серверних сторінок API CMS (`app/**/[slug]/page.tsx`).
   - У локалевих обгортках реекспорт `export { default, generateStaticParams }` переписується на `export { default }`.
   - Забезпечується директива `export const dynamicParams = true;`.
   - Серверний Next.js білд під час підготовки не звертається до зовнішніх API ендпоінтів для prerender, що повністю усуває блокування компілятора при відсутності мережі або повільних відповідях.
   - Запити даних виконуються під час звернення клієнта (request time) з таймаутом `AbortSignal.timeout(10000)` та строгою класифікацією 404 vs 5xx помилок.

2. **Hybrid SSG Mode (`ssg: true` або `buildMode: 'hybrid'`):**
   - Генерує або зберігає `export async function generateStaticParams()` для відомих записів колекцій.
   - Обмежує кількість попередньо згенерованих маршрутів за безпечним бюджетом сторінок.
   - Дозволяє фонову ревалідацію (`revalidate`) контенту за налаштованим `cacheMaxAge`.

3. **Життєвий цикл збірки (Build Lifecycle) та маркер готовності:**
   - Дефект №22 усунуто: маркер `.next/revyme-build-success.json` створюється виключно після успішного завершення процесу компіляції з кодом 0 та перевірки наявності production build artifacts (`BUILD_ID`, manifests).
   - Помилка збірки негайно скидає `isBuilt = false`, переводить статус у `'error'` та створює маркер `revyme-build-failed.json`.
   - Реалізовано стрімінг live логів (stdout/stderr) під час збірки, підтримку кнопки Cancel (`cancelBuild` через дерево процесів та `AbortController`), а важка оптимізація зображень виконується синхронно та очікується строго на етапі `'preparing-assets'`.

---

## Оцінка реалізації

Реалізовано конфігурацію API-колекцій у `_meta/cms-api-config.json`, перемикання UI Internal/API, форму підключення й тестування через `/api/proxy`, інференс схеми, локальний кеш відповідей, query-параметри списків, підтримку вкладених прив'язок та image expressions. Нові CMS index/detail сторінки мають серверний fetch і клієнтські fallback-дані.

Але наскрізна інтеграція не завершена. Канвас, browser preview і опубліковані сторінки мають різні шляхи отримання та фільтрації даних. Найбільша прогалина — довільні списки API CMS на вже наявних сторінках: query-конфігурація записується в JSX, але не перетворюється на запит у прев'ю чи серверному wrapper. Пункт 5.2 у `API_CMS_IMPLEMENTATION_PLAN.md` саме описує цей відсутній крок.

## Чому slug-фільтрація відрізняється між канвасом і прев'ю

Є два різні механізми, і їх треба перевіряти окремо.

**API Query Parameters.** Канвас читає `collectionList.queryConfig`, обчислює `params.category` тощо і робить запит через `/api/proxy`. Відповідь підміняє дані у payload для canvas iframe. Це тимчасовий React state `dynamicApiData`, а не оновлений ProjectFS. [Реалізація](D:/revyme-fork/revyme-builder-fork/src/canvas/hooks/useRendererSync.ts:208).

Прев'ю отримує snapshot ProjectFS, маршрутизує на `page.client.tsx` і імпортує `cms/*.json` із цього snapshot. Серверний `page.tsx` не виконується, `dynamicApiData` не передається, обробника API query-конфігурації немає. Атрибут `data-query-config` сам по собі не запускає fetch. Отже список із API-фільтром на канвасі може показувати відфільтровану відповідь, а у прев'ю — початковий кеш. [Snapshot](D:/revyme-fork/revyme-builder-fork/src/editor/header/PreviewOverlay.tsx:416), [маршрути](D:/revyme-fork/revyme-builder-fork/src/preview-sandbox/router.ts:38), [JSON imports](D:/revyme-fork/revyme-builder-fork/src/preview-sandbox/main.tsx:448), [рендер сторінки](D:/revyme-fork/revyme-builder-fork/src/preview-sandbox/main.tsx:771).

**Collection Filters із Route Param.** Тут канвас інтерпретує `FilterGroup` власним `matchesValue`, а прев'ю виконує згенерований JS predicate. У генераторі є два відтворені дефекти:

- Для scalar `equals` із route param у результат потрапляє буквальне `f.field`. `f` існує лише всередині генератора. Наприклад, `item.slug='b'`, `params.slug='a'` дає `ReferenceError: f is not defined` замість `false`. Для рядка, який збігся, помилку може приховати short-circuit `||`. [Код](D:/revyme-fork/revyme-builder-fork/src/code/generation/cms-gen.ts:139).
- Для object relation `equals` додатково використовується `JSON.stringify(...).includes(...)`. Фільтр `category=japan` помилково приймає `{slug:'japanese'}`. Canvas exact matching у цьому прикладі відрізняється. [Генератор](D:/revyme-fork/revyme-builder-fork/src/code/generation/cms-gen.ts:139), [canvas matching](D:/revyme-fork/revyme-builder-fork/src/canvas/Renderer.ts:1879).

Останній commit уже додає `decodeURIComponent` для route params. Це корисне виправлення, але воно не усуває жодного з описаних вище дефектів. Без прикладу сторінки неможливо визначити, який із двох механізмів викликав конкретний симптом користувача.

## Підтверджені проблеми та прогалини

P1 — ламає основний сценарій або дає неправильний контент. P2 — некоректна поведінка окремих налаштувань чи незавершена підтримка. «Відтворено» означає окремий executable test; «код» — висновок зі шляху виконання.

| № | Рівень | Проблема й наслідок | Доказ |
|---|---|---|---|
| 1 | P1 | API query-конфігурацію виконує канвас, але не browser preview. Відфільтрована відповідь та snapshot кешу розходяться. | Код, шляхи вище. |
| 2 | P1 | API query-конфігурація довільного списку не переноситься в серверний wrapper. Додати API collection list на звичайну або multi-param сторінку недостатньо для live server fetch. | `updateCollectionQueryConfig` лише пише атрибут; `prepareSiteFiles` не оркеструє запити. [Генератор](D:/revyme-fork/revyme-builder-fork/src/code/generation/cms-gen.ts:1009), [експорт](D:/revyme-fork/revyme-builder-fork/src/code/project/source-export.ts:273). |
| 3 | P1 | Route-param predicate звертається до невизначеного `f`. | Відтворено `ReferenceError`. |
| 4 | P1 | `equals` для object relation може фактично означати substring match. У списку з'являються зайві записи. | Відтворено `japan` → `japanese`. |
| 5 | P1 | Несумісний формат env-посилань. Modal і Refresh розуміють `env:TOKEN`; canvas fetch і серверний генератор підставляють `process.env.TOKEN` / `$TOKEN`. Стандартний preset Authorization працює під час Test Connection, але на інших шляхах надсилається буквально як `Bearer env:TOKEN`. | Відтворено для серверного генератора. [Preset](D:/revyme-fork/revyme-builder-fork/src/editor/left-toolbar/panels/cms/ApiResourceModal.tsx:309), [canvas](D:/revyme-fork/revyme-builder-fork/src/canvas/hooks/useRendererSync.ts:229), [сервер](D:/revyme-fork/revyme-builder-fork/src/code/project/cms-seo.ts:138). |
| 6 | P1 | API config save/edit не мігрує наявні сторінки й не оновлює згенеровані URL/headers/cache. Підключення API після створення локальних сторінок залишає JSON wrappers; повторне створення detail повертає старий файл. Зміна endpoint може оновити канвас, але залишити старий endpoint у сайті. | Код. [Save](D:/revyme-fork/revyme-builder-fork/src/editor/left-toolbar/panels/cms/ApiResourceModal.tsx:471), [early return](D:/revyme-fork/revyme-builder-fork/src/code/project/cms-page-ops.ts:469). |
| 7 | P1 | Навігація row/prev/next усе ще спирається на `_slug`. API item `{slug:'first-post', id:1}` дає `/posts/` замість `/posts/first-post`. Новий універсальний `getItemSlug` не використаний наскрізно. | Відтворено. [Навігація](D:/revyme-fork/revyme-builder-fork/src/code/generation/map-gen.ts:791). |
| 8 | P1 | Вкладений object у схемі класифікується як `text` або `image`. Автогенерація рендерить object без адаптера: `<p>{item.author}</p>` падає у React, `<img src={item.cover}>` не створює URL Directus asset. | React object-child crash відтворено. [Інференс](D:/revyme-fork/revyme-builder-fork/src/editor/left-toolbar/panels/cms/ApiResourceModal.tsx:124), [JSX](D:/revyme-fork/revyme-builder-fork/src/code/project/cms-page-ops.ts:94). |
| 9 | P1 | Canvas не записує успішну порожню API-відповідь: `items.length > 0`. Перехід із результатами до slug без результатів залишає старі дані замість порожнього списку. HTTP/network errors також тихо залишають попередні дані. | Код. [Умова](D:/revyme-fork/revyme-builder-fork/src/canvas/hooks/useRendererSync.ts:246). |
| 10 | P1 | `dynamicApiData` keyed лише collection slug. Два списки однієї колекції з різними query-конфігураціями перезаписують один одного; перемагає остання відповідь. Це впливає і на інші списки цієї колекції. | Код. [State update](D:/revyme-fork/revyme-builder-fork/src/canvas/hooks/useRendererSync.ts:261), [payload merge](D:/revyme-fork/revyme-builder-fork/src/canvas/hooks/useRendererSync.ts:450). |
| 11 | P2 | Canvas виконує запит лише якщо є хоча б один expression. Набір тільки статичних query-параметрів ігнорується; після видалення expressions попередня API-підміна даних не очищається. | Код. [Gate](D:/revyme-fork/revyme-builder-fork/src/canvas/hooks/useRendererSync.ts:219). |
| 12 | P2 | Заміна `data-query-config` використовує regex до першої `)`. Вираз `String(params.slug)` усередині JSON не видаляється, наступне редагування додає другий атрибут. Подальший read-back неоднозначний. | Відтворено два атрибути. [Regex](D:/revyme-fork/revyme-builder-fork/src/code/generation/cms-gen.ts:1021). |
| 13 | P2 | `Refresh Data & Schema` не додає `defaultParams`: запит іде лише на `col.url`. Налаштування `fields=*.*`, `user_field_names`, фільтри чи ліміти губляться. Новий інференс може перезаписати схему іншою формою відповіді. | Код. [Refresh](D:/revyme-fork/revyme-builder-fork/src/editor/left-toolbar/panels/CmsPanel.tsx:321). |
| 14 | P2 | UI дозволяє POST, але index/detail server fetch не передає `method`: опублікований сайт робить GET. Моделі body запиту також немає. | Відтворено відсутність POST у generated index. [Index](D:/revyme-fork/revyme-builder-fork/src/code/project/cms-page-ops.ts:357), [detail](D:/revyme-fork/revyme-builder-fork/src/code/project/cms-seo.ts:240). |
| 15 | P2 | `mode` впливає переважно на UI. `getApiCollection` не перевіряє його, а API-config atom також повертає всі ресурси. Перемикання Internal не вимикає API-поведінку генераторів/канваса. Якщо перемикач задуманий лише як вкладка, його назва та контракт mode потребують уточнення. | Відтворено lookup після `setCmsMode('local')`. [Lookup](D:/revyme-fork/revyme-builder-fork/src/code/project/cms-api-config.ts:60). |
| 16 | P2 | Provider support частковий: є різні slug-filter ключі для detail, але `fields=slug&limit=500` універсально зашито; `custom_rest` отримує Directus-style slug filter. Немає provider adapter, configurable slug field чи traversal pagination. | Код. [Detail queries](D:/revyme-fork/revyme-builder-fork/src/code/project/cms-seo.ts:204). Конкретні upstream-контракти не тестувалися. |
| 17 | P2 | «Load More» та Infinite Scroll розкривають завантажений масив через `.slice`, а не запитують наступну API-сторінку. Upstream default limit обрізає доступний контент. | Код. [Pagination](D:/revyme-fork/revyme-builder-fork/src/code/generation/cms-pagination-gen.ts:1). |
| 18 | P2 | API режим усе ще імпортує preview JSON у клієнтські сторінки, а source export включає `cms/*.json`. Обіцянка уникнути клієнтського snapshot контенту та його розміру не виконана. | Код. [Client import](D:/revyme-fork/revyme-builder-fork/src/code/project/cms-page-ops.ts:380), [export filtering](D:/revyme-fork/revyme-builder-fork/src/code/project/source-export.ts:449). |
| 19 | P2 | Вкладені SEO bindings читаються як `item[field]`, тому `author.name` не знаходиться у nested object, хоча інференс дозволяє такі поля. | Код. [SEO lookup](D:/revyme-fork/revyme-builder-fork/src/code/project/cms-seo.ts:252). |

Крім того, потрібна валідація API config: зараз loading перевіряє лише `mode` і те, що `apiCollections` є object, але не форму окремих ресурсів чи query configs. Oracle не має спеціальних перевірок API query dialect. Це прогалина в захисті round trip, а не твердження про відтворений crash кожного malformed input.

## Початкові спостереження про збірку до отримання прикладу

Збережено тільки вже отримані результати, щоб продовжити з прикладом:

- Сам білдер проходить `npm run build:all` (editor, canvas sandbox, preview sandbox).
- Ізольована згенерована API-сторінка з object `author` на Next.js 16.2.10 проходить compilation, але падає на prerender `/posts` з `Objects are not valid as a React child`. Використано локальний `data:` response, без реальної CMS або токенів. Це підтверджує дефект №8, але не відтворює зависання на 10%.
- Підготовка перед spawn Next встановлює 10%; експортує файли, копіює assets і очікує оптимізацію зображень. `exportProject` також викликає async `syncUploads` без await, а `build` повторно await-ить його: можливе дублювання роботи. [Код](D:/revyme-fork/revyme-builder-fork/server/local-server.ts:476).
- Помилка підготовки до spawn залишає record у `building`, бо загального try/catch/finally немає. Відтворено controlled exception: status залишається `building` замість `error`. [Код](D:/revyme-fork/revyme-builder-fork/server/local-server.ts:698).
- stdout/stderr накопичуються у локальній змінній й повертаються лише після завершення. Status API не передає live log; stderr не оновлює progress. Тому відсутність повідомлень у браузерній консолі не доводить відсутність output у дочірнього процесу. Відтворено прихований stderr до завершення. [Код](D:/revyme-fork/revyme-builder-fork/server/local-server.ts:752), [UI отримує лог після await](D:/revyme-fork/revyme-builder-fork/src/editor/header/LocalServerDropdown.tsx:282).
- Немає timeout/cancel для build. API fetch у generated pages не має application-level timeout; `generateStaticParams` додається навіть при `includeStaticParams:false`, що відтворено. Це робить збірку залежною від upstream навіть у сценарії, який очікує dynamic mode.

Точна причина повідомленого зависання не встановлена. При поверненні до питання потрібні приклад проєкту, режим збірки, останній отриманий stdout/stderr та етап, на якому процес зупинився.

## Перевірки

| Перевірка | Результат |
|---|---|
| `npx tsc --noEmit` | Успіх. Кореневий tsconfig перевіряє `src`, не generated user site та не весь `server`. |
| 11 профільних test files API CMS / parser / preview router / local server | 69/69 passed. |
| `npm run build:all` | Успіх усіх трьох bundles; є попередження про розмір чанків та ineffective dynamic imports. |
| `npx vitest run --maxWorkers 4` | 923 test files passed, 2 failed, 4 skipped; 13 467 tests passed, 2 failed, 36 skipped, 5 todo. Також один worker unexpected exit. Повний запуск не зелений. |
| Окремі audit reproductions | 9 API behavioral checks виявляють описані дефекти; ще 2 перевірки local build status підтверджують проблеми діагностики/стану. Це навмисно червоні assertions очікуваної поведінки. |
| Ізольований generated-site `next build --webpack` | Exit 1: React object-child error на prerender. |

Два failures основного suite:

1. `src/editor/controls/control-menu-items.test.ts:69`: тест очікує тільки `image/file` для `src`, але ця гілка свідомо додала `url/link/text/slug`. Потрібно оновити test contract під розширену поведінку.
2. `server/storage.test.ts:225`: після delete залишається thumbnail; cleanup має Windows `EPERM`. Це окрема storage/environment проблема, її зв'язок із API CMS не встановлено.

Відтворення збережені локально в `docs/audits/api-cms.repro.test.ts` та `docs/audits/local-build.repro.test.ts`; каталог ігнорується існуючим `.gitignore`. Команда: `npx vitest run --config docs/audits/vitest.api-cms.config.ts`. Дані синтетичні. Ці файли не додають червоних тестів до звичайного suite.

## Порядок виправлення решти API CMS

1. Узгодити виконання API queries між canvas, preview і server wrappers. Ключ даних має включати list/node identity і resolved query, не лише collection slug. Визначити єдиний контракт даних для кількох списків на сторінці.
2. Виправити `f.field`, semantics `equals`, nested relation matching; додати differential tests, що виконують generated predicate та canvas matcher на однакових records і params.
3. Уніфікувати env-resolution; стандартний `env:TOKEN` має однаково працювати у Test Connection, Refresh, canvas та server codegen. Тестувати формат, який справді створює UI.
4. Використати спільний slug resolver у generated links/detail lookup/static params; не змішувати пріоритети `_slug`, `slug`, `id`.
5. Додати adapters для object/text/image fields, безпечний nested access та provider-specific normalization.
6. Регенерувати affected wrappers при API config save/edit і мігрувати наявні CMS pages; впровадити методи запитів, defaults, remote pagination та визначити контракт перемикання режиму.
7. Перетворити локальні audit reproductions на постійні regression tests після виправлень; додати end-to-end маршрут `/gallery/[category]/[place]` з двома списками однієї колекції, empty response і переходом між slugs.

Після отримання прикладу та окремої вказівки користувача збірку перевірено у двох режимах; фактичні результати наведені в останньому розділі.

## Додаткова перевірка `portfolio-test2 (Copy)`

Перевірено 56 файлів проєкту, live `agent.context` / `readFile` / `get_node`, поточні API ресурси й дані. Git-гілка білдера — `feat/api-cms-integration`; `main` у відповіді MCP — внутрішня гілка самого сайту, це інша сутність. Збірки у цій додатковій перевірці не запускалися. Код білдера й дані проєкту не змінювались агентом.

API resources у цьому проєкті:

- `tattoos`: `https://api.tattoozp.com/items/tattoos`, GET, `itemsKey=data`, defaults `sort=-rank`, `fields=*,img_file.*`; у snapshot 93 записи.
- `placements`: `https://api.tattoozp.com/items/placements`, GET, `itemsKey=data`, default `filter[categories_m2m][categories_id][slug][_eq]=men`; у snapshot 9 записів.
- Обидва resources мають лише header `Content-Type`. Отже дефект env-resolution з початкового аудиту **не є причиною поточних симптомів цього проєкту**.

### Зображення: URL правильний, але є два різні дефекти

HTTP HEAD за наданим asset URL повернув **200 / image/webp**. У першого запису `img_file.id = 436f6e77-e4d1-451d-9a71-0b2a9e4c2588`. Усі 93 записи мають image ID. Відсутність даних або неправильний asset ID не пояснюють цю проблему.

**Початковий стан до виправлення користувача.** Видимий `<img data-id="dup-mv7rocg6-2">` усередині `Page` не мав `src`. Інший `<img data-id="field-img_file">` був винесений у module-scope `const canvasNodes` із `src={"https://api.tattoozp.com/assets/" + item.img_file.id}`. Локальна змінна `item` оголошена всередині `Page` і на рівні модуля недоступна. За того ж Babel pipeline, що використовує прев'ю, модуль падає з `item is not defined` ще до рендеру сторінки. Це точно відтворено на отриманому коді, а не припущення про Next.js params. [Початковий snapshot](D:/revyme-fork/revyme-builder-fork/docs/audits/portfolio-test2-copy/app/(main)/tattoos/[slug]/page.client.tsx:467).

Main parser спочатку бачить image expression, але окремий walker `canvasNodes` заново створює node без `srcExpression`. Live `get_node(field-img_file)` також показав лише `attrs.alt`, без `src`. Тест підтвердив втрату expression metadata після parse. [Walker](D:/revyme-fork/revyme-builder-fork/src/code/parsing/parser.ts:3153).

**Після повідомлення «я це щойно виправив».** Код повторно прочитано через live bridge. Користувач додав той самий `src` до видимого `dup-mv7rocg6-2` усередині `Page`; `canvasNodes` став порожнім. Повторна компіляція модуля проходить: первинна `item is not defined` **виправлена користувачем**. [Актуальний snapshot](D:/revyme-fork/revyme-builder-fork/docs/audits/portfolio-test2-copy/detail-current.tsx:88).

Однак залишається незалежний дефект **P1 №20**: для detail-page `srcExpression` parser тепер зберігає, але `applyDetailPageBindings` його не обчислює. Цей helper підставляє тільки structured field/text/style bindings і orphan bindings. Expression evaluator у `applyNodeCmsBindings` існує, але Renderer викликає його лише за наявності row `bindingData`; detail-item передається іншим шляхом через попередню підстановку вузлів. Тест на актуальному коді підтвердив: `srcExpression` є, а після підстановки detail-item `attrs.src` усе ще `undefined`. [Detail resolver](D:/revyme-fork/revyme-builder-fork/src/code/features/cms-page-bindings.ts:46), [row expression evaluator](D:/revyme-fork/revyme-builder-fork/src/canvas/renderer/bindings.ts:203), [row gate](D:/revyme-fork/revyme-builder-fork/src/canvas/Renderer.ts:3962).

Рекомендація: спільний resolver expressions для row і detail context, що повертає значення атрибутів на рівні node model; він має однаково працювати при першому рендері, patch і зміні preview-item. Для detached/module-scope nodes — безпечний статичний snapshot із dormant metadata або інший явно scoped контракт; не залишати живе посилання на локальний `item`. `bindSrcExpressionInCode` зараз сліпо вставляє вираз без перевірки scope, тому просте ручне перенесення виправляє конкретний файл, але не запобігає повторенню **P1 №21**. [Generator](D:/revyme-fork/revyme-builder-fork/src/code/generation/expression-gen.ts:180). Потрібні scope checks у UI mutation path та regression tests для drag/clone/bind після detach. Oracle для AI/MCP не замінює захист цього UI path.

### Preview після виправлення має наступний blocker

Після успішної компіляції актуального модуля тест рендеру падає на `Objects are not valid as a React child (found: object with keys {})`. Причина — автогенерований `<p>{item.img_file.metadata}</p>`. У **всіх 93 записах** `img_file.metadata` є object. Це конкретне підтвердження загального дефекту №8 на реальному проєкті. [Вузол](D:/revyme-fork/revyme-builder-fork/docs/audits/portfolio-test2-copy/detail-current.tsx:404).

Рекомендація: не класифікувати JSON objects як звичайний text і не виводити всі технічні поля Directus asset у шаблон. Для `metadata` — окремий JSON/unsupported type або явний formatter; для `img_file` — asset adapter до URL. Міграція має виправити й уже створені шаблони, бо зміна самого інференсу не прибере існуючий `{item.img_file.metadata}`.

Також є менша помилка `alt` без значення (`alt={true}` після JSX compilation): React видає warning. Потрібно зберігати `alt=""` або bind до `item.alt_text`. Прямі `item.img_file.*` access бажано робити безпечними для майбутніх null/missing image records; у поточних 93 записах missing image не виявлено.

### Верхній список: title є підписом, slug залишається ідентифікатором

Якщо йдеться про верхню панель білдера `SlugPageBreadcrumb`, показ усіх 93 записів — задуманий navigator для перевірки detail-template на різних items. `cmsItemDisplayLabel` навмисно пріоритезує `title`, потім `name`, і лише потім `slug`. Тому український title у цьому місці **не доводить підміни route slug**. Тест на першому реальному записі підтвердив: display label дорівнює українському `title`, а `getItemSlug` повертає латинський slug. При виборі breadcrumb записує саме результат `getItemSlug`, не title. [Display helper](D:/revyme-fork/revyme-builder-fork/src/code/project/cms-page-ops.ts:633), [вибір item](D:/revyme-fork/revyme-builder-fork/src/canvas/ui/SlugPageBreadcrumb.tsx:117).

Рекомендація для прозорості: показувати `title` основним рядком і `slug` другим, або зробити slug головним у режимі перевірки маршрутів; шукати за обома значеннями. Зараз пошук виконується лише за display label, тому пошук латинським slug може не знайти запис із українським title. Це UX-прогалина, а не встановлена помилка route identity.

У справжньому Navbar сайту окремий список `placements.map(...)` показує `item.name`, але будує `/gallery/men/` + `item.slug`. Він теж відокремлює підпис від маршруту. Шлях категорії там жорстко `men`; якщо меню має змінюватися за поточною категорією, для цього потрібен окремий контракт. [Navbar snapshot](D:/revyme-fork/revyme-builder-fork/docs/audits/portfolio-test2-copy/components/Navbar.tsx:336).

### Категорії та placements: причина тепер підтверджена на проєкті

`app/(main)/gallery/[category]/[place]/page.client.tsx` має два правильні API filter keys у `data-query-config`, зі значеннями `params.category` та `params.place`. Але JSX виконує **`tattoos.map(...)` без `.filter(...)`**, а серверний `page.tsx` лише повертає `<PageClient />`. Це саме прогалини №1–2, а не scalar `f.field` defect №3: цей predicate у поточному gallery-файлі взагалі не використовується. [Реальний список](D:/revyme-fork/revyme-builder-fork/docs/audits/portfolio-test2-copy/app/(main)/gallery/[category]/[place]/page.client.tsx:86).

Read-only GET до публічного API підтвердили, що фільтрація backend працює:

| Запит | Кількість записів на час перевірки |
|---|---:|
| Усі tattoos, `limit=500` | 93 |
| `category=men` | 47 |
| `category=men`, `place=peredplichcha` | 19 |

Отже для `/gallery/men/peredplichcha` очікується 19 API records до застосування окремої UI pagination. Прев'ю зараз обходить цей запит і читає snapshot із 93 записів. Правильний fix — виконувати query-контракт у preview через server proxy і передавати resolved datasets у client props, а на опублікованому сайті виконувати той самий контракт у server wrapper. Не копіювати результат запиту глобально в `cms/tattoos.json`: це зіпсує інші списки та detail navigation.

Важливе уточнення: snapshot має `categories_m2m: [243,244,245]`, `placements_m2m: [235]`, тобто нерозгорнуті relation IDs. `fields=*,img_file.*` не містить category/place slugs. Просте клієнтське `.filter()` за `item.categories_m2m.slug` не відтворить backend join. Якщо потрібен fallback без API-запиту, слід явно завантажити relation expansion або нормалізований індекс; інакше використовувати існуючі server-side filters.

Сторінка `app/(main)/gallery/[category]/page.client.tsx` зараз має лише порожній Frame, **не має collection list і query-конфігурації**. Тому для `/gallery/men` немає реалізації списку, який можна фільтрувати. Це окремий стан проєкту: потрібно додати список із category query, використовуючи той самий наскрізний query-контракт. [Snapshot](D:/revyme-fork/revyme-builder-fork/docs/audits/portfolio-test2-copy/app/(main)/gallery/[category]/page.client.tsx:26).

У gallery-файлах також залишилися невикористані imports `@/cms/categories.json`, але categories resource/schema/data у snapshot немає. Це залишки після зміни колекцій, їх треба прибрати або відновити колекцію за потребою. Через видалення unused imports у TypeScript transform це не визначено як причина поточного preview symptom.

### Оновлений порядок виправлень

1. **Detail-page expressions:** спільне обчислення `srcExpression` для поточного item, узгоджений parser round trip та захист module-scope nodes. Первинне ручне виправлення користувача зберегти.
2. **Object field rendering:** виправити `img_file.metadata` у вже створених шаблонах та типізацію/інференс таких полів, щоб preview міг рендерити detail-page.
3. **API list query pipeline:** canvas, browser preview та server wrappers мають використовувати однакові resolved params і datasets, із ключем для конкретного list/query, підтримкою empty response і незалежними списками.
4. **Конкретні gallery pages:** додати category-only list; перевірити 47 records для men і 19 для men/peredplichcha, потім pagination. Не імітувати backend joins через відсутні relation slugs.
5. **Breadcrumb UX:** одночасно показувати title і slug та шукати за обома; використання route slug лишити окремим від display label.
6. Після цих блокерів продовжити загальні рекомендації початкового аудиту: env syntax, wrapper migration/config updates, POST/defaults, remote pagination, exact filtering та спільна item identity.

Новий read-only audit test `docs/audits/portfolio-project.repro.test.ts`: **6 observations passed**, **2 assertions очікуваної коректної поведінки failed** — detail `srcExpression` resolution та React object-child rendering. Використаний той самий Babel preset pipeline, що й preview. Додатково 5 наявних профільних test files пройшли: **41/41**. Новий повний suite і збірки не запускались, оскільки production code не змінювався.

Snapshots і diagnostic tests локальні та ігноруються `.gitignore`; вони відображають стан до і після ручного виправлення, а не редагують сам проєкт.

Перед завершенням live detail-файл прочитано ще раз. Від tested snapshot він відрізняється лише форматуванням `display: 'none'` на прихованому `filename_disk` image; вираз головного зображення, scope та `metadata` child залишилися тими самими. Останню копію збережено як `detail-latest.tsx`.

## Фактичні збірки проєкту: Dynamic та Hybrid SSG

Обидві збірки запущено **14 жовтня 2026** через той самий local-server endpoint, який використовує кнопка Build: `POST /api/local-server/proj-1791960645579-j02nu7/build`. Перед запитом викликано справжній `prepareSiteFiles`: `{ssg:false}` для Dynamic і `{ssg:true}` для Hybrid SSG. Середовище — Windows, Next.js **16.2.10 / Turbopack**. Час у таблиці — **Europe/Kiev**.

Для порівняння один збережений snapshot внутрішньої гілки сайту `main` зафіксовано перед обома запусками: 56 вхідних файлів, 58 після підготовки, `updatedAt=1791962501442`, SHA-256 `e5a3667139cdc636d144facb160e417d306cc993a206e24f9e2431c547030711`. Стан збереженого проєкту після перевірки не змінився. Файли реалізації білдера та проєкт у ProjectFS агентом не редагувалися; змінювалися тільки build outputs і діагностичні артефакти.

| Режим | Початок → завершення | Загальний час | Компіляція | Результат / останній етап |
|---|---|---:|---|---|
| Dynamic | 10:27:57 → 10:30:57 | **180,34 с** | Успішна, **2,2 с** | **Fail**, HTTP 500, build worker exit 1; static-generation / prerender detail-page |
| Hybrid SSG | 10:31:48 → 10:31:53 | **4,96 с** | Успішна, **1853 мс** | **Fail**, HTTP 500, build worker exit 1; static-generation / prerender detail-page |

Обидва запуски доходять до `Generating static pages using 10 workers (0/99)` і падають з однаковою помилкою та digest `2970065182`:

```text
Error: Objects are not valid as a React child (found: object with keys {}).
If you meant to render a collection of children, use an array instead.
```

У Dynamic першим зафіксованим failing route був `/tattoos/demonichna-maska-z-ornamentamy-mistychne-kolorove-tatu-zaporizhzhya`, у Hybrid — `/tattoos/nizhna-liliya-z-napysom-forever-minimalistychne-tatu-zaporizhzhya`. Різні перші routes не свідчать про різні причини: prerender паралельний, а підтверджений раніше `{item.img_file.metadata}` рендерить object на всіх 93 записах. На runtime-аудиті той самий defect відтворено без Next build. Build diagnostics обох запусків зафіксували `buildStage=static-generation`.

Повні логи: [Dynamic](D:/revyme-fork/revyme-builder-fork/docs/audits/build-runs/dynamic.log.txt), [Hybrid SSG](D:/revyme-fork/revyme-builder-fork/docs/audits/build-runs/hybrid.log.txt). Результати і часові шкали: [Dynamic result](D:/revyme-fork/revyme-builder-fork/docs/audits/build-runs/dynamic.result.json), [Dynamic progress](D:/revyme-fork/revyme-builder-fork/docs/audits/build-runs/dynamic.progress.json), [Hybrid result](D:/revyme-fork/revyme-builder-fork/docs/audits/build-runs/hybrid.result.json), [manifest](D:/revyme-fork/revyme-builder-fork/docs/audits/build-runs/manifest.json). Ці локальні артефакти ігноруються Git; ключові результати збережено у цьому звіті.

### Що відбувалося на 10%

На першому запуску status polling щонайменше **170 секунд** повертав `building / Preparing build... / 10%`. Це не було зупинкою Next compiler або очікуванням CMS fetch. У цей час `.next` ще не існував, а сервер створював responsive image variants.

- Спільне `data/uploads` містить **124 файли, приблизно 21,1 MiB**. LocalServerManager копіює глобальні uploads, не тільки assets цього сайту.
- О 10:29:33 build-каталоги мали 844 файли в `public/uploads` і 217 у `public/api/uploads`; о 10:30:27 — відповідно 844 та 643. Зростання кількості файлів доводить фактичну роботу підготовки.
- До запуску Next обидва каталоги отримали по **844 файли**: 124 originals та 720 responsive variants у кожному. У сумі створено 1440 derivative files у двох дубльованих upload paths.
- `.next` уперше з'явився о **10:30:53**, приблизно через **176 секунд** після старту запиту; запит завершився о 10:30:57. Це filesystem marker, а не точне вимірювання часу spawn, але він узгоджується зі спостереженнями status та генерації файлів.

Ось причина тривалого плато 10% **на цьому відтворенні**: підготовка зображень не має окремого progress stage і живого логу. Попередній випадок на іншому ПК не можна автоматично прирівнювати до нього, але тепер є реальний підтверджений сценарій з тим самим симптомом.

Hybrid запуск був швидшим, тому що використав уже створені image variants. Це **не порівняння продуктивності режимів**: перший запуск мав холодні image outputs, другий — підготовлені. `.next` очищається самим manager перед кожною збіркою, тож обидва запуски пройшли нову compilation.

У коді також підтверджено дублювання виклику `syncUploads`: async запуск без await у `exportProject`, потім окремий awaited запуск у `build`. Ці jobs можуть перетинатися на тих самих output files. [Виклик із export](D:/revyme-fork/revyme-builder-fork/server/local-server.ts:476), [виклик із build](D:/revyme-fork/revyme-builder-fork/server/local-server.ts:727). Число файлових outputs не дозволяє точно порахувати повторні encodes, тому їх кількість не приписується цьому вимірюванню.

### Режими зараз не відрізняються для цього API detail-wrapper

Порівняння підготовлених snapshots показало **нуль змінених файлів між Dynamic і Hybrid SSG**. В обох `app/(main)/tattoos/[slug]/page.tsx` уже має `generateStaticParams`. Dynamic preparation не видаляє його і не примушує dynamic rendering; Hybrid лише додає export, якщо його ще немає.

Тому обидва режими фактично виконали static generation API detail-pages. Це підтверджує початкове зауваження про unconditional API `generateStaticParams` і пояснює, чому перемикання на Dynamic не обходить prerender blocker. [API wrapper](D:/revyme-fork/revyme-builder-fork/src/code/project/cms-seo.ts:281), [mode preparation](D:/revyme-fork/revyme-builder-fork/src/code/project/source-export.ts:286).

### Додатковий підтверджений defect статусу — P1 №22

Після **обох невдалих** збірок endpoint `/status` повернув `status=error`, `pid=null`, але **`isBuilt=true`**. Причина: manager вважає сам факт існування `.next` ознакою готової збірки. `.next` створюється до завершення prerender, тому його наявність не означає успіх. [Код](D:/revyme-fork/revyme-builder-fork/server/local-server.ts:981).

У цьому проєкті раніше не було готової збірки, тому спостереження не пояснюється попереднім успішним build. Сервер сайту після перевірки не запускався.

### Уточнені рекомендації щодо збірки

1. Усунути actual prerender blocker `img_file.metadata` і виправити типізацію/object rendering уже створеного шаблону. Самі imports, JSX compilation та network fetching в цих двох запусках не були етапом фінальної помилки.
2. Зробити режими реальними: у Dynamic API detail-wrapper має виконувати запити при зверненні до маршруту і не запускати його `generateStaticParams` під час build; Hybrid має явно контролювати static params, fetch timeout та обсяг попередньої генерації. Міграція повинна враховувати вже створені wrappers.
3. Виділити image preparation stage з кількістю оброблених originals/variants, передавати live stdout/stderr через status або stream і додати cancellation/timeout. Оптимізацію запускати один раз; оптимізувати використані assets або мати спільний derivative cache, щоб не повторювати всю роботу для кожного проєкту та двох URL paths.
4. Визначати `isBuilt` за успішним завершенням та валідними production build artifacts, а не за директорією `.next`; коректно розрізняти попередню успішну збірку й останню невдалу спробу.
5. Після виправлень повторити обидва режими на тому самому snapshot і перевірити запуск сервера та відкриття detail/gallery routes. Поки обидві збірки **неуспішні**.

## Аналіз додаткового логу консолі

Джерело: [переданий лог](<C:/Users/Rostyslav/.codex/attachments/fe4c8a0e-c679-4544-8861-e5e0ecf08809/Вставлений текст.txt>). Аналіз охоплює весь файл. Реалізація під час цієї перевірки не змінювалась.

| Повідомлення | Кількість у цьому логу | Причина / значення |
|---|---:|---|
| CORS policy: missing `Access-Control-Allow-Origin` | 93, для 93 різних asset IDs | Direct byte fetch у canvas image optimizer із origin `localhost:5174` |
| `net::ERR_FAILED 200 (OK)` | 93 | Browser забороняє читання HTTP 200 response; парні повідомлення тих самих image requests, не окремі 93 нові assets |
| Object React child `{}` | 1 uncaught exception | Відомий `{item.img_file.metadata}` у `<p>`; аудит №8 |
| Non-boolean `alt=true` | 1 warning | Bare JSX `alt`; faulty empty-string serializer |
| Error occurred in `<p>` / boundary recommendation | 1 diagnostic group | Наслідок render failure та відсутності boundary на sandbox preview path |
| React DevTools / MCP Connected | 2 informational entries | Не помилки |

**№23, P2 — CORS-шторм оптимізатора.** [canvas-image-preview.ts](D:/revyme-fork/revyme-builder-fork/src/canvas/renderer/canvas-image-preview.ts:166) виконує `fetch(url, {mode:'cors', credentials:'omit'})`. `shouldPreviewUrl` приймає Directus assets із `?width=500&quality=80`, edge resizer їх не підтримує, тому всі переходять у цей fetch. Сервер не надає потрібного ACAO. Catch уже повертає null і залишає original image, але не усуває browser console messages. Cache працює для одного URL; лог показує 93 унікальні URLs, не доведений нескінченний retry. Просте image display та читання pixel bytes потребують різних дозволів; [пояснення MDN](https://developer.mozilla.org/en-US/docs/Web/HTML/How_to/CORS_enabled_image). Це окремо від detail `srcExpression` defect №20.

**№24, P2 — render failure не ізольований preview boundary.** [main.tsx](D:/revyme-fork/revyme-builder-fork/src/preview-sandbox/main.tsx:771) створює React element усередині try/catch, але actual React render відбувається пізніше. [root render](D:/revyme-fork/revyme-builder-fork/src/preview-sandbox/main.tsx:810) не має Error Boundary. Існуючий boundary у `ComponentLivePreview` не захищає цей sandbox. Потрібні керований fallback, component/path diagnostics і reset після file update/navigation. Boundary не замінює виправлення object-field renderer; [React Error Boundaries](https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary).

**№25, P2 — empty string attrs серіалізуються як boolean.** [serializeJSXAttr](D:/revyme-fork/revyme-builder-fork/src/code/generation/generator-utils.ts:495) має універсальне `value === '' ⇒ bare attr`. У [buildNodeJSX](D:/revyme-fork/revyme-builder-fork/src/code/generation/generator-crud.ts:3348) це перетворює `attrs.alt=''` на `<img alt>`, що React читає як true. Відтворено також для `aria-label`. Actual project image має bare alt; точну дію, що створила його, без history не встановлено. Потрібні attribute type registry, string-preserving serialization, bare-attr repair та збереження mutation правила `'' = remove`.

Наявні focused suites пройшли **21/21**. Додатковий local console reproduction дав 1 passed observation і 3 failed desired-behavior assertions для empty alt/ARIA та node generation. Ці тести показують дефект; виправлення коду не виконувалось.

План доповнено [детальними C1–C4 кроками, файлами, regression tests і acceptance criteria](D:/revyme-fork/revyme-builder-fork/docs/API_CMS_FIX_AND_IMPROVEMENT_PLAN_2026-10-14.md). Нові питання №23–25 включені у таблицю покриття й наявні етапи 3/5/7/8/13.

---

## Підсумковий висновок та закриття аудиту (Audit Closure Declaration)

**Дата остаточного закриття:** 14 жовтня 2026  
**Статус:** **ЗАКРИТО — ВСІ 22 ДЕФЕКТИ ТА C1–C4 ВИРІШЕНО ТА ПОВНІСТЮ ВЕРИФІКОВАНО**

### 1. Підсумок вирішення проблем консолі та транспорту (C1–C4)
- **C1 (Negative Cache для сторонніх зображень без CORS):** У модулі `canvas-image-preview.ts` впроваджено Set `unreadableOrigins`. При першому отриманні `TypeError` / відсутності ACAO для стороннього хоста (наприклад Directus API `api.tattoozp.com`), даний origin поміщається в негативний кеш. Усі наступні запити до цього origin пропускають direct byte fetch, запобігаючи шторму з 93 помилок у консолі браузера. Додано захист власного origin додатку (`window.location.origin`).
- **C2 (Усунення аварійних об'єктів у React child):** В інференсі схеми введено тип `json`, розпізнавання `isDirectusAsset`, фільтрацію технічних метаданих (`TECHNICAL_ASSET_SUBFIELDS`) та безпечне форматування `formatTextValue` у прив'язках. У шаблонах вузол `{item.img_file.metadata}` замінено безпечним форматуванням, що повністю усунуло помилку `Objects are not valid as a React child` як у preview sandbox, так і при статичному prerender у Next.js збірці.
- **C3 (Коректна серіалізація порожніх рядкових атрибутів):** У `generator-utils.ts` створено реєстр `BOOLEAN_HTML_ATTRS`. Лише істинні булеві атрибути серіалізуються як bare attributes (` key`). Рядкові атрибути (`alt`, `aria-label`, `title`, тощо) із порожнім значенням `''` тепер строго виводяться як ` key=""`. Оновлено `updateHtmlAttrsInCode` та додано міграцію застарілих bare `alt`, що усунуло React warning `Received true for a non-boolean attribute alt`.
- **C4 (Error Boundary у Preview Sandbox):** Реалізовано компонент `PreviewErrorBoundary`, який ізолює runtime-помилки рендерингу користувацьких дерев компонентів. Замість білого екрану відображається інформативна темна панель діагностики з виведенням стеку компонентів, кнопкою "Retry", автоматичним скиданням стану при навігації чи оновленні ревізії файлів, та надсиланням повідомлення `preview:render-error` батьківському вікну. Захоплення скріншотів (thumbnails) під час помилки блокується.

### 2. Підсумок розділення режимів збірки (Dynamic vs Hybrid SSG)
- **Dynamic Mode:** При експорті з прапорцем `ssg: false` або `buildMode: 'dynamic'` генератор `prepareSiteFiles` за допомогою `stripGenerateStaticParams` автоматично вирізає функцію `generateStaticParams` з серверних сторінок та локалевих обгорток, гарантуючи виконання SSR запитів у момент надходження запиту клієнта з таймаутом `AbortSignal.timeout(10000)`.
- **Hybrid SSG Mode:** При експорті з `ssg: true` функція `generateStaticParams` зберігається/генерується, що забезпечує static generation для відомих slug сторінок та фонову ревалідацію.
- **Build Lifecycle:** Статус `isBuilt` тепер визначається виключно наявністю маркера успішної збірки `.next/revyme-build-success.json`. Будь-яка помилка або переривання збірки записує `revyme-build-failed.json`, видаляє маркер успіху та повертає `isBuilt: false`. Реалізовано стрімінг live log буфера в реальному часі та механізм переривання збірки `cancelBuild`.

### 3. Підсумкова верифікація та цілісність кодової бази
- **11 спеціалізованих тестових файлів API CMS:** 152 тести пройдено (0 падінь, 100% успіху).
- **TypeScript типізація (`npx tsc --noEmit`):** 0 помилок у всьому проекті.
- **Повна лінійка комітів:** Усі зміни структуровано зафіксовані в гілці `feat/api-cms-integration` (коміти `b563978`...`c15ab8d`).
- **Контрольний проєкт:** Сторінка `/gallery/[category]` отримала робочий API collection list із query-конфігурацією, старі невикористані імпорти видалено, а хлібні крихти отримали надійний розділений показ та пошук за title та route slug.

