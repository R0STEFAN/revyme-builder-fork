# Покроковий план виправлення й покращення API CMS

Дата: **14 жовтня 2026**. Робоча Git-гілка: **`feat/api-cms-integration`**. Основа: [аудит API CMS](D:/revyme-fork/revyme-builder-fork/docs/API_CMS_AUDIT_2026-10-14.md), включно з реальним проєктом `portfolio-test2 (Copy)` і двома фактичними збірками.

Доповнено аналізом переданого логу консолі: image-preview CORS, React object child, неправильна серіалізація `alt` та відсутність render error boundary. Детальні кроки й критерії наведено в розділі 6; вони включені у відповідні етапи нижче.

Статус: **план, реалізацію ще не виконано**. Чекбокси позначають майбутню роботу. Нові назви модулів нижче є пропозиціями; перед створенням перевірити, чи потрібний helper уже існує. Усі етапи виконувати невеликими змінами з відповідними тестами, зберігаючи працездатність local JSON CMS.

## 1. Очікуваний результат

Канвас, browser preview і сайт на Next.js повинні виконувати однаковий CMS-контракт: однакові route params, API request, нормалізація відповіді, field bindings та ідентифікація item. Кожен список має власні дані й loading/error/empty стани. Налаштування ресурсу повинні впливати на всі три середовища та на вже створені сторінки.

Dynamic і Hybrid SSG мають реально відрізнятися. Збірка повинна показувати підготовку assets і живий лог, завершуватися визначеним станом і не вважати незавершений `.next` готовим сайтом.

Перші практичні критерії для `portfolio-test2 (Copy)`:

- Detail-page показує правильне зображення після вибору будь-якого item; preview не падає на `item` чи `img_file.metadata`.
- Для контрольного snapshot API повертає 93 tattoos загалом, 47 для `men`, 19 для `men/peredplichcha`. Канвас, preview і сервер використовують відповідні datasets; UI pagination може показувати лише їх частину.
- `/gallery/[category]` має справжній список із category query.
- Обидва build modes проходять; сервер відкриває detail/gallery routes після production build.
- Звичайне відкриття detail/gallery не створює CORS-шторм від оптимізатора зображень, warning `alt={true}` чи uncaught React render error. Навмисна помилка користувацького компонента показує керовану діагностику і допускає відновлення preview.

Ці кількості — baseline конкретного snapshot. Для постійних тестів використати зафіксовані fixtures; при live перевірці звірятися зі свіжою відповіддю API, оскільки CMS може змінитися.

## 2. Обов'язкові правила реалізації

1. Джерело правди — JSX/TSX та ProjectFS. Зміни існуючих файлів проводити через `modifyProjectFile` після flush mutations; не лікувати source defects прямими змінами canvas DOM. Нові файли створювати через наявний project-operation шлях.
2. DOM усередині iframe читати й оновлювати через bridge/cache APIs. Resolving даних і expressions має відбуватися на рівні моделі або спільного runtime, а не через обхід iframe boundary.
3. Зберегти семантику `''`: видалення властивості. Відрізняти її від успішної порожньої колекції `[]` і від відсутності відповіді.
4. Розрізняти page detail-item і row вкладеного списку. Row binding не повинен випадково використовувати detail-item чи навпаки.
5. Генератор → parser → canvas → preview → published runtime перевіряти як один round trip. Runtime, потрібний браузеру опублікованого сайту, має бути в `@revyme/runtime`; editor helpers з Jotai/ProjectFS не імпортувати у site source.
6. Додавати `trace.action/fn/error` для request lifecycle, migrations, scope decisions і build stages. Не включати у traces токени або resolved Authorization.
7. Міграції робити ідемпотентними, з history/checkpoint і збереженням custom JSX, route groups, locales та shared components. Не перегенеровувати клієнтську сторінку цілком заради одного binding.
8. HTTP 401/403, timeout та malformed response мають бути помилками даних, а не успішним порожнім списком чи 404 item. Справжній empty response обробляти окремо.

## 3. Послідовність і залежності

| Етап | Результат | Залежить від |
|---|---|---|
| 0 | Відтворюваний baseline і regression fixtures | — |
| 1 | Спільні контракти даних, identity, режимів | 0 |
| 2 | Надійна діагностика збірки й assets pipeline | 0; узгодження типів з 1 |
| 3 | Безпечні object/image fields та ремонт шаблонів | 1 |
| 4 | Detail expressions і захист scope | 1, 3 |
| 5 | Єдиний HTTP request/provider/env layer | 1 |
| 6 | Правильні filters і query round trip | 1, 5 |
| 7 | Незалежні API datasets на канвасі | 4, 5, 6 |
| 8 | API queries у browser preview | 5, 6, 7 |
| 9 | Server codegen та реальні Dynamic/Hybrid modes | 3, 5, 6, 8 |
| 10 | Міграція існуючих проєктів і config updates | 3–9 |
| 11 | Remote pagination та очищений source export | 7–10 |
| 12 | Breadcrumb UX і завершення прикладу проєкту | 4, 8–10 |
| 13 | Наскрізна перевірка й закриття аудиту | 0–12 |

Етап 2 потрібен до контрольних збірок: він дозволить відрізняти реальну помилку від довгої підготовки. Повну переробку кешу зображень можна завершувати окремою зміною після виправлення status/log pipeline.

## Етап 0. Зафіксувати baseline і перенести відтворення у постійні тести

**Кроки**

- [ ] Зберегти checkpoint `portfolio-test2 (Copy)`, поточний source hash, API configs без секретних значень і контрольні route params. Залишити ручне виправлення користувача: основний `src` усередині `Page`.
- [ ] Витягти з локальних `docs/audits/*.repro.test.*` мінімальні fixtures і перенести behavioral assertions до відповідних `src/**` / `server/**` suites. Не прив'язувати постійні тести до локального project ID або ігнорованих snapshots.
- [ ] Додати контрольні відповіді: expanded Directus asset, relation ID arrays, expanded junction objects, empty list, missing image, JSON metadata, API error, дві різні query-відповіді однієї колекції.
- [ ] Додати console baseline: 93 CORS messages для 93 різних asset IDs, 93 paired `ERR_FAILED 200 (OK)`, один object-child crash і один alt warning. Browser fixture має віддавати image з іншого origin без ACAO; jsdom alone не перевіряє CORS policy.
- [ ] Зберегти baseline логів Dynamic 180,34 с / Hybrid 4,96 с та пояснення cold/warm assets. Не використовувати ці цифри як speed target або порівняння режимів.
- [ ] Окремо зафіксувати failures основного suite: застаріле очікування типів `src`, storage thumbnail cleanup/Windows EPERM, unexpected worker exit. Дослідити причини; не позначати їх автоматично регресіями API CMS.

**Перевірка:** тести відтворюють точні дефекти аудиту: `f is not defined`, wrong relation equality, duplicate query attr, wrong API href, object child, detail src expression, preparation error state. Відомі червоні тести виправляються на своїх етапах; не послаблювати assertions заради зеленого запуску.

**Критерій завершення:** кожен confirmed defect має незалежне від локального проєкту відтворення або чітку інтеграційну перевірку.

## Етап 1. Визначити єдиний контракт даних, identity та режимів

**Файли:** `src/shared/types.ts`, `cms-api-config.ts`, `cms-store.ts`, `cms-page-store.ts`, `cms-page-ops.ts`, `map-gen.ts`; перевірити existing helpers у `src/shared/`, `cms-row-resolve.ts`, `cms-binding-scope.ts`, `scoped-expr.ts`.

**Кроки**

- [ ] Відділити local item зі службовими `_id/_slug/_status` від API record, для якого ці поля можуть бути відсутні. Типи мають відображати реальну відповідь, не приховувати невідповідність через `as CollectionItem[]`.
- [ ] Ввести спільну item identity: canonical record ID, route slug, display label. Для наявних колекцій зберегти поточний пріоритет `_slug ?? slug ?? id ?? _id`; не змінювати чинні URLs мовчки. Для API resource дозволити явний `slugField` та `idField`.
- [ ] Додати pure nested-value accessor із safe access; підтримати nested paths і literal keys із крапкою за явно визначеним правилом. Використати його для text/attrs/styles/SEO, не створювати різні lookup helpers.
- [ ] Описати `CmsQueryResult`: `items`, optional `total/nextCursor/hasMore`, request metadata без секретів. Описати loading/error/empty/success окремо від даних.
- [ ] Визначити dataset identity з project/branch, page або component scope, instance/list node ID, viewport/variant коли вони змінюють query, route params, resource config revision, resolved query та pagination position. Request-cache key і адреса споживача можуть відрізнятися: однакові requests можна deduplicate без об'єднання state двох списків.
- [ ] Рекомендований контракт `mode`: `local` вимикає використання API configs, але зберігає їх; `api` активує налаштовані ресурси, а локальні колекції лишаються локальними. Якщо Internal/API задумано лише як UI tabs, відокремити tab selection від source policy до міграції; не залишати двозначне поле `mode`.
- [ ] Визначити canonical query expressions і scope: підтримувані `params.*`, bracket access, дозволені conversions/fallbacks; валідувати їх AST. Не називати unrestricted `new Function` безпечним evaluator. Legacy expressions інвентаризувати й мігрувати без непомітної зміни значення.

**Перевірка:** локальні records, API slug/id-only records, zero/empty identifiers, unicode slug, nested null, два instances одного component із різними params. Тести generated navigation мають виконувати результат генератора.

**Критерій завершення:** один документований контракт, який можна використати без editor dependencies у site runtime; global mode та UI semantics узгоджені.

## Етап 2. Виправити lifecycle збірки, статус, лог і image preparation

**Файли:** `server/local-server.ts`, `server/api-plugin.ts`, `src/backend/local-server-client.ts`, `src/editor/header/LocalServerDropdown.tsx`, їхні тести; `src/shared/image-export-constants.ts` для узгодження export optimization.

**Кроки**

- [ ] Обгорнути весь build lifecycle, включно з export/assets/cleanup/spawn, у керування terminal state. Будь-який exception preparation переводить job у `error`, записує причину, прибирає progress і звільняє locks.
- [ ] Додати `buildId`, explicit mode, started/finished timestamps, окремі stages `exporting`, `preparing-assets`, `compiling`, `collecting`, `generating`, `done/error/cancelled`. Оновити server/client/UI типи разом.
- [ ] Зберігати обмежений live log із stdout і stderr; status polling повертатиме tail або cursor-based chunks. Не чекати завершення POST, щоб показати діагностику. UI відображає поточний етап, elapsed time та останній output.
- [ ] Прибрати fire-and-forget `syncUploads` з export path; залишити один awaited assets pipeline. Обробляти progress preparation за кількістю originals/variants, не приписувати їй compiler percentage.
- [ ] Заборонити паралельні builds одного project/build directory. Визначити відповідь на повторний Build; старі події job не повинні перезаписувати стан нового.
- [ ] Додати timeout/cancel із завершенням саме build child process tree та скасуванням pending asset tasks. Зберігати PID build process окремо від PID site server; stop server не повинен випадково керувати іншою job.
- [ ] Замінити `.next exists ⇒ isBuilt` на підтверджений successful build marker і перевірку production artifacts. Розділити `lastAttempt` та `lastSuccessfulBuild`; після очищення старого output не рекламувати його як придатний до запуску.
- [ ] Перевіряти restart behavior: successful build marker після перезапуску manager, incomplete `.next`, failed latest attempt, старий успішний output, який уже очищено.
- [ ] Ввести derivative cache за source content hash, encoder settings/version та width. Один encode на ключ; materialize outputs для `/uploads` та `/api/uploads` без повторного resize. У standalone export не покладатися на host-specific symlinks.
- [ ] До оптимізації визначати використовувані assets. Для динамічних refs зберегти conservative fallback, щоб не прибрати потрібне зображення. Не оптимізувати весь глобальний upload store для кожного сайту, коли dependencies відомі.

**Перевірка:** preparation exception, stdout/stderr під час job, повторний build, cancel/timeout, worker exit, missing artifact, cold/warm assets, Windows cleanup. У тесті на fixtures порахувати encodes: warm run не виконує зайві; змінений source або quality invalidates тільки відповідні keys.

**Критерій завершення:** довга підготовка має видимий прогрес; failure/cancel ніколи не лишає `building`; failed-only project має `isBuilt=false`; success дозволяє реальний production start.

## Етап 3. Безпечний schema inference, object/text/image rendering і перший ремонт шаблону

**Файли:** `ApiResourceModal.tsx`, `cms-page-ops.ts`, `cms-page-bindings.ts`, `src/canvas/renderer/bindings.ts`, `cms-seo.ts`, schema types та контролі полів.

**Кроки**

- [ ] Відділити JSON/object, relation і image asset від text. Mixed samples та null не повинні довільно змінювати раніше погоджений тип. Refresh зберігає ручні schema overrides.
- [ ] Для Directus image object створити asset adapter: configured asset base URL + asset ID, optional transformations; не використовувати `filename_disk` або UUID як готовий URL. Для інших providers адаптувати їхній shape через capabilities.
- [ ] Встановити безпечні default renderers: primitives — text; arrays — явно визначене відображення; object — JSON formatter лише якщо користувач обрав його, або omitted unsupported field. Не вставляти bare object як React child.
- [ ] Автогенерувати редакційні поля, не всі технічні поля `img_file.*`. Metadata, upload IDs і internal storage properties можуть бути доступні в schema, але не повинні автоматично створювати десятки елементів шаблону.
- [ ] Зробити nested access optional-safe та обробити missing image/item. Для неіснуючого production slug — справжній notFound; для HTTP failure — typed error, а не перший item або notFound.
- [ ] Виправити nested SEO lookup через контракт етапу 1; metadata fallback має бути валідною Next Metadata shape.
- [ ] На checkpoint-копії проєкту точково мігрувати auto-generated `field-img_file.metadata` і подібні object-bound nodes, зберігши стилі та custom content. Зберегти правильний `src`, який користувач уже переніс до `Page`. Виправити bare `alt` на string binding/default.
- [ ] Виправити `serializeJSXAttr` у `generator-utils.ts`: empty string не означає boolean для всіх атрибутів. Для `alt`, `title`, `aria-*`, `data-*` serializer зберігає string; bare JSX дозволяється тільки для справжніх boolean attrs за registry. Перевірити `buildNodeJSX`, canvas-node creation, clone/paste і ремонт вже збережених bare string attrs — докладніше C3 у розділі 6.
- [ ] Не змінювати глобальний mutation контракт `'' = remove`: розрізнити команду видалення й serialization існуючого порожнього string value. При empty update bare legacy `alt` має коректно видалятись; при nonempty update — замінюватись, а не лишати duplicate `alt`.

**Перевірка:** React renderToString на поточному detail fixture; images як object/UUID/URL/null; nested SEO; refresh із порожнім response; повторна міграція без змін.

**Критерій завершення:** detail module та React render проходять; жоден object не рендериться як text випадково; уже створений шаблон виправлений, а не тільки майбутній codegen.

## Етап 4. Спільний expression resolver і захист function/module scope

**Файли:** `cms-page-bindings.ts`, `src/canvas/renderer/bindings.ts`, `expression-gen.ts`, `parser.ts`, `cms-detach-gen.ts`, `cms-row-resolve.ts`, `mutation-queue.ts`, `ImageTool.tsx`; existing scope helpers.

**Кроки**

- [ ] Винести pure expression resolving для `src/href/text` із явним context. Використати його у detail substitution і row renderer, щоб обидва шляхи підтримували ті самі expressions.
- [ ] Визначати lexical binding для `item/row/collectionItem/params`, не підставляти будь-який доступний record за ім'ям `item`. У detail page із related list зберігати розділені contexts.
- [ ] Перед bind mutation перевіряти scope вузла. На module-scope `canvasNodes` не записувати live reference до локального `item`; зберігати static snapshot плюс dormant expression/binding metadata з явним owner context.
- [ ] Для missing context показувати керований missing binding стан; не генерувати malformed source і не знищувати binding intent. При поверненні node до правильного scope відновлювати binding.
- [ ] Узгодити main parser і canvasNodes walker: один extraction helper для expression metadata або shared dormant metadata parser. Повторне створення node не повинно губити `srcExpression`.
- [ ] Розширити detach/clone/paste на nested fields та expressions, не тільки `item.simpleField`. Перевірити re-entry, copy між сторінками та aliases map iterator.
- [ ] Додати validation в UI mutation path і відповідний Oracle check для AI/MCP. Перевірка Oracle сама по собі не захищає звичайні UI edits.

**Перевірка:** current image `"https://api.tattoozp.com/assets/" + item.img_file.id` працює при build/patch, зміні item, viewport; detach → compile preview без undefined identifier; re-entry відновлює expression. Включити detail page з nested related list.

**Критерій завершення:** зображення на канвасі відповідає обраному item; source з UI не може відтворити первинний module-scope crash.

## Етап 5. Єдиний API request builder, env resolution та provider adapters

**Файли:** `cms-api-config.ts`, `ApiResourceModal.tsx`, `CmsPanel.tsx`, `useRendererSync.ts`, `cms-seo.ts`, `cms-page-ops.ts`, `server/api-plugin.ts`. Нові pure/request/server modules — лише після перевірки shared helpers.

**Кроки**

- [ ] Зібрати canonical request descriptor: endpoint, provider, method, defaults, list overrides, body, response extraction, cache policy, timeout і identity fields. Query merge через URL API; list params перевизначають defaults без duplicate keys.
- [ ] Визначити missing/empty query policy. Не прирівнювати `0`/`false` до відсутності; порожній dynamic param має явно означати skip/default/error згідно field contract.
- [ ] Стандарт env syntax — `env:TOKEN`. Додати сумісний parser для наявних `process.env.TOKEN` / `$TOKEN` і міграцію. У server source генерувати escaped AST expressions, не небезпечні template-string replacements.
- [ ] Missing env variable дає зрозумілу помилку конфігурації. Той самий результат headers має бути у Test Connection, Refresh, canvas, preview backend і generated server fetch. Не передавати resolved credentials до preview iframe.
- [ ] Реально передавати GET/POST; для POST додати schema/контролі body і content type. Retry за замовчуванням лише для idempotent сценаріїв; не повторювати POST без визначеної policy.
- [ ] Єдиний response extractor: root array, configured/nested itemsKey, typed malformed response. Відрізняти `[]` від неправильного JSON shape.
- [ ] Визначити provider capabilities: slug filtering, asset URL, pagination, totals, selecting fields, response normalization. Directus-specific query keys не застосовувати автоматично до custom REST.
- [ ] Для Custom REST дати configurable detail lookup/filter template; для Baserow/Strapi звірити чинні офіційні API contracts під час реалізації й додати representative fixtures. Не оголошувати підтримку повною лише через provider dropdown.
- [ ] Refresh використовує descriptor з defaultParams, не naked `col.url`; помилка refresh не перезаписує схему/кеш успішним порожнім значенням.
- [ ] Для canvas image optimization визначити readable-bytes transport окремо від простого image display: через trusted host/server для CORS-нечитабельного origin або skip optimization зі збереженням оригіналу. Cloud `fetchMediaBytes` уже має proxy path, local backend робить direct fetch; перевірити й узгодити обидва, а не лише викликати однаковий метод. Докладніше C1 у розділі 6.
- [ ] Валідувати config/query schema на load/save з versioned upgrade path. Не мовчки скидати malformed API config у local mode без diagnostics.

**Перевірка:** URL із existing query, defaults/overrides, три env syntaxes, missing env, literal `$` у header, POST body, timeout, invalid JSON, nested extraction, provider detail lookup, Refresh із `fields`/filters.

**Критерій завершення:** один resolved descriptor використовується на всіх HTTP paths; UI-created Authorization preset працює у server codegen.

## Етап 6. Виправити filters і query-config round trip

**Файли:** `cms-gen.ts`, `parser.ts`, `cms-filter-utils.ts`, `Renderer.ts`, `CollectionListTool.tsx`, Oracle CMS checks; existing AST/tag helpers.

**Кроки**

- [ ] Прибрати literal `f.field` із generated predicate; generated scalar mismatch має повернути false, а не кинути exception.
- [ ] Описати semantics усіх operators для scalar/object/array/relation. `equals` — equality значень обраного поля; `contains` — explicit substring. Не використовувати substring JSON як fallback для equals.
- [ ] Узгодити canvas matcher, codegen і published responsive-list runtime. Нерозгорнуті Directus junction IDs не трактувати як category IDs або slugs; відсутність relation data не повинна давати вигаданий match.
- [ ] Замінити stripping `data-query-config` regex на existing balanced tag helper або AST transform. Зберігати рівно один атрибут, включно з expressions із `String(...)`, ternary, quotes і template literals.
- [ ] Перевірити round trip params→JSX→parser→panel→edit→JSX. Invalid expressions/keys мають мати diagnostics і не губити попередній валідний config.
- [ ] Додати Oracle checks для duplicate query attributes, unsupported expression scope та несумісного query shape.

**Перевірка:** differential tests виконують generated predicates і canvas matcher на однакових cases: japan/japanese, null, IDs, unicode/URI decoding, equals/not_equals/contains/in, AND/OR, dates, nested paths. Не обмежуватися `toContain` emitted code.

**Критерій завершення:** parser round trip стабільний; filters дають однакові результати в editor та runtime.

## Етап 7. Незалежні API datasets і lifecycle на канвасі

**Файли:** `useRendererSync.ts`, CMS stores, `src/canvas-sandbox/protocol.ts`, `src/canvas-sandbox/stubs/cms-ops.ts`, `Renderer.ts`, canvas bridge; query contract етапів 1/5.

**Кроки**

- [ ] Замінити глобальний override `dynamicApiData[source]` на адресовані list datasets. Local collection map лишається базовим сховищем; response одного списку не змінює всі ghosts тієї колекції.
- [ ] Request key включає resolved params і config revision; consumer key — page/component/list instance. Deduplicate однакові HTTP requests без змішування pagination/loading state.
- [ ] Виконувати статичні й динамічні query configs. Видалення config, зміна resource/page/project/branch очищає відповідний override і pending jobs.
- [ ] Завжди записувати успішний `[]`. Для errors показувати error state; якщо використовується last-known data, явно позначати stale, не видавати його за новий успішний результат.
- [ ] Додати AbortController і generation/request ID. Пізня відповідь старого route не повинна перемагати новий route або переноситися до іншого проєкту.
- [ ] Синхронізувати datasets через typed iframe protocol; Renderer розв'язує конкретний list owner, а не slug колекції.
- [ ] Узгодити per-viewport/variant config і shared component instances. Loading не має ламати selection/drag або генерувати зайві data IDs.
- [ ] Додати traces start/finish/error/cancel, кількість records і non-secret query identity; обмежити повторні fetch під час не пов'язаних layout edits.
- [ ] Узгодити image-preview policy, negative cache і observer lifecycle: не робити 93 direct byte fetch для known unreadable API origin. Переоптимізація DOM не змінює ProjectFS URL; fallback не видаляє справжній image src.

**Перевірка:** два списки tattoos з різними filters; повільна стара/швидка нова відповідь; 19→0→47; static-only params; config removal; project switch; повторні component instances.

**Критерій завершення:** кожен список незалежний; empty/error/race scenarios не залишають неправильний контент.

## Етап 8. API query execution у browser preview

**Файли:** `PreviewOverlay.tsx`, `src/preview-sandbox/main.tsx`, `router.ts`, preview protocol/message handling і server-side proxy path.

**Кроки**

- [ ] Після route resolution зібрати list descriptors з page та layout/component dependencies. Прев'ю має знати params із поточного URL, не тільки початкові canvas params.
- [ ] Виконувати requests через builder host/proxy. Для iframe на окремому origin використати request/result bridge з request ID, revision та перевіркою origin; secrets залишаються на trusted host/server side.
- [ ] Передавати datasets як явні props/context згідно спільного published contract. Не переписувати глобальний JSON import на response одного списку.
- [ ] Перекомпіляція snapshot і route navigation invalidates лише потрібні requests. Initial load, client-side переходи та reload повинні дати той самий результат.
- [ ] Не передавати `.env*`, resolved auth або секретний `_meta` payload у preview snapshot. Передавати тільки public code/data та необхідні non-secret resource identities.
- [ ] Відобразити loading/empty/error й відокремити compile error від render error і API error. Не залишати білу сторінку або мовчазний cached list.
- [ ] Додати Error Boundary навколо routed user page/layout tree; reset за project revision і URL, reporting до editor та recovery після file update/navigation. Наявний `try/catch` навколо `<Page />` не ловить exception під час React render. Існуючий `ComponentLivePreview` boundary є прикладом, але зараз не захищає `preview-sandbox/main.tsx` — докладніше C4 у розділі 6.

**Перевірка:** пряме відкриття та перехід `/gallery/men/peredplichcha`; зміна category/place через links; shared Navbar list; два lists одного source; API timeout/error; preview reload. У fixtures контролювати 93/47/19 до UI pagination.

**Критерій завершення:** preview використовує той самий request/result contract, що канвас, і реально фільтрує після переходу між routes.

## Етап 9. Server codegen для довільних списків і справжні build modes

**Файли:** `cms-page-ops.ts`, `cms-seo.ts`, `source-export.ts`, generators/mutations list configs, `PagesSeoSection.tsx`, locale route wrappers. Published server helper, наприклад `lib/revyme-cms.server.ts`, — запропонований generated artifact.

**Кроки**

- [ ] Побудувати dependency analysis page→layouts/components→API lists. Збирати static/dynamic params із конкретного list і resolved route, а не тільки detail collection annotation.
- [ ] Генерувати server request orchestration і client dataset props для index/detail/regular/multi-param pages. Для layout-owned lists визначити provider/context ownership; headers не потрапляють у client component.
- [ ] Оновити parser до нового client map source (`datasets[listId]` або іншого обраного контракту), зберігши collection source identity і field bindings. Не створювати JSX, який published runtime читає, а parser більше не розуміє.
- [ ] У detail fetch виконувати configurable slug lookup, provider response normalization і nested SEO. Невідомий slug не повинен показувати перший item; API outage не маскувати як 404.
- [ ] Ввести явний buildMode у generation/preparation/server build request. Він має застосовуватись і до вже наявного wrapper, а не лише при створенні нової сторінки.
- [ ] **Dynamic:** API routes не виконують `generateStaticParams` у build; page data запитується на сервері при зверненні. Політику route rendering і fetch caching розділити; перевірити її integration test на встановленій версії Next. Не ставити global `force-dynamic` усім unrelated local pages.
- [ ] **Hybrid SSG:** generateStaticParams обходить provider pagination за configurable budget, а не hardcoded Directus `fields=slug&limit=500`; наступні items лишаються доступними за визначеною dynamicParams policy.
- [ ] Для multi-param pre-render генерувати валідні комбінації params із configured sources/relations. Не створювати безконтрольний декартів добуток категорій і placements; без такого mapping маршрут може лишатися runtime-rendered у hybrid.
- [ ] Додати application-level fetch timeout, request dedup для metadata/page та явну build failure policy. Невдала авторизація не повинна непомітно створювати «успішний» сайт без CMS routes.
- [ ] Узгодити mode policy з SEO save та locale wrappers, щоб повторне збереження metadata не повертало unconditional static params.

**Перевірка:** порівняння prepared snapshots показує очікувані mode differences; mock API недоступний під час Dynamic build не блокує саме API routes, але runtime request повертає керовану помилку. Hybrid має реальні static params; новий item доступний за обраною policy. Додатково Next build/start перевіряють GET/POST, metadata і multi-param routes.

**Критерій завершення:** Dynamic і Hybrid мають різні підтверджені режими рендерингу; звичайні API списки працюють на опублікованому сайті; builder source лишається editable.

## Етап 10. Versioned migration та синхронізація config updates

**Файли:** `cms-api-config.ts`, `cms-ops.ts`, `cms-page-ops.ts`, project migration/operation helpers, mutation queue, `ApiResourceModal.tsx`, `CmsPanel.tsx`, `source-export.ts`.

**Кроки**

- [ ] Додати versioned migration registry і індекс resource→affected pages/layouts/components/server artifacts. Включити namespace/owner metadata, щоб відрізняти generated wrappers від user-owned server code.
- [ ] Save/edit endpoint, headers, method, defaults, slug field, itemsKey і cache policy оновлюють runtime config та affected wrappers. Не лишати старий endpoint у сайті після нового успішного Test Connection.
- [ ] При local→API підключенні мігрувати існуючі index/detail pages, навіть якщо `findCmsPageFile` повертає вже наявний файл. Зберегти routes, IDs, JSX, responsive bindings та SEO settings.
- [ ] Застосувати погоджену mode policy. Перемикання source і видалення resource invalidates datasets/requests; не видаляти shared collection data або schema без залежнісної перевірки.
- [ ] Міграція object fields, source imports, navigation identity та query attributes має бути точковою. Перевіряти diff, validate/parse before write; malformed/user-owned shapes показувати як конфлікт з конкретним repair step.
- [ ] Виконувати writes через project operations із fresh reads і history checkpoint. При частковій помилці не зберігати напівмігрований проєкт; визначити rollback transaction.
- [ ] Оновити конфлікти branch/shared metadata за правилами ProjectFS. Зміни джерела однієї гілки не повинні непомітно міняти іншу.

**Перевірка:** old local project→API; API config edit→generated URLs updated; mode switch; SEO save after migration; repeat migration produces no diff; undo/redo; route groups/locales; custom wrapper conflict.

**Критерій завершення:** існуючі проєкти отримують fix без ручного пересоздання сторінок; migration не губить дизайн чи користувацький код.

## Етап 11. Remote pagination і source export без preview-cache imports

**Файли:** `cms-pagination-gen.ts`, `CollectionListTool.tsx`, runtime package, request/provider contracts, preview runtime, `source-export.ts`, export scaffold. Runtime репозиторію немає у поточному checkout; для його змін потрібне джерело окремого пакета та README/export checklist.

**Кроки**

- [ ] API Load More / Infinite Scroll запитують наступну page/cursor, а не тільки збільшують `.slice`. Local JSON pagination зберігає наявну поведінку.
- [ ] Додати hasMore/loading/error/retry, stable-ID dedup, reset cursor при зміні filters, cancellation і незалежний pagination state кожного consumer.
- [ ] Для remote filtered lists серверне сортування/limit/offset застосовувати до повного набору перед paging. Client filter після першої API page не повинен видавати неповний набір за повний результат.
- [ ] Генерувати server-owned endpoint або еквівалентний transport для published client pagination: allowlisted resource/query descriptor, headers/credentials тільки на сервері. Обробити існуючі user API routes без overwrite.
- [ ] Browser-side published component/helper додати в `@revyme/runtime`, оновити exports/types/version та canvas/preview bridges. Перевірити `runtime-exports-covered` і сумісність підтримуваних runtime ranges.
- [ ] Прибрати preview JSON imports із API client code через узгоджений renderer/provider contract. Editor/preview fallback data доставляти окремим каналом; локальні CMS imports лишаються.
- [ ] Exporter прибирає API preview cache лише після dependency analysis і rewrite усіх його client references. Не видаляти `cms/*.json` загальним правилом: там можуть бути local collections і custom dependencies.
- [ ] Секретні `.env*` та `_meta` files не потрапляють у export/preview; env.example містить тільки назви. Перевірити всі secret env filenames, не лише `.env` та `.env.local`. Runtime server artifacts і non-secret config лишаються в export.

**Перевірка:** більше records, ніж upstream page size; cursor/offset providers; empty final page; duplicate records; retry; concurrent lists; query reset; exported client bundle не містить API preview dataset чи tokens; local CMS export працює.

**Критерій завершення:** pagination доходить до всього доступного набору; exported API site отримує актуальні дані, не покладаючись на editor cache.

## Етап 12. Breadcrumb UX і завершення контрольного проєкту

**Файли:** `SlugPageBreadcrumb.tsx`, `cmsItemDisplayLabel`, `cms-page-store.ts`, expression/binding UI; конкретні проєктні сторінки через ProjectFS operations.

**Кроки**

- [ ] У navigator показувати human label і route slug окремо; пошук виконується за title/name/slug/id. Вибір записує canonical slug, ніколи display label.
- [ ] Зберегти доступ до всіх items для перевірки detail-template; не фільтрувати navigator поточним slug так, що користувач не може перемикатися між записами.
- [ ] На checkpoint-копії `portfolio-test2 (Copy)` додати category-only collection list на `/gallery/[category]` із query `params.category`. Наявний порожній Frame сам по собі не є помилкою filter engine.
- [ ] Перевірити query на `/gallery/[category]/[place]` і images/links, не підміняти backend joins фільтрацією нерозгорнутих junction IDs у JSON.
- [ ] Прибрати stale unused `categories.json` imports або відновити потрібну collection згідно реальних dependencies. Не створювати порожню categories collection, щоб тільки заглушити import.
- [ ] Звірити intention Navbar: зараз men placements links містять literal `/gallery/men/`. Якщо Navbar має слідувати поточній category, винести category в явний prop/context; якщо це меню Men, зберегти його як окремий розділ. Це продуктова поведінка, а не доведена помилка slug identity.

**Перевірка:** пошук латинським slug для українського title, вибір другого item, category-only route, мен/жіночі links, route transitions і reload.

**Критерій завершення:** контрольний проєкт демонструє всі виправлені сценарії; title/slug не плутаються у UI.

## Етап 13. Контрольна матриця, обидві збірки й закриття аудиту

**Кроки**

- [ ] Запустити focused suites за зміненими модулями; meaningful integration tests виконують generated code, не тільки перевіряють його текст.
- [ ] Запустити `npx tsc --noEmit`, `npx vitest run --maxWorkers 4`, `npm run build:all`. Для server та generated site додати окремі typechecks, бо root tsconfig охоплює лише `src`; `ignoreBuildErrors:true` не є перевіркою типів.
- [ ] Виконати browser E2E для canvas↔preview↔navigation; доповнити `src/canvas/drag/e2e/slug-page-cms-binding.spec.ts` і додати API list/route fixtures з mock HTTP server.
- [ ] Додати console/network assertions для C1–C4: readonly external image без ACAO, valid empty alt після clone, controlled child render crash→boundary→file-update recovery. Після source fixes звичайні routes не мають uncaught render errors; informational React DevTools/MCP messages не рахувати failures.
- [ ] На одному зафіксованому snapshot запустити Dynamic та Hybrid SSG. Зберегти mode, hash, elapsed/stage timings, log, exit code, generated static routes, cold/warm asset state. Performance порівнювати тільки за однакових cache conditions.
- [ ] Dynamic build не звертається до API за static params; після start detail route має server fetch і коректний image/text/SEO. Hybrid pre-renders визначені params, підтримує погоджені нові slugs і revalidation.
- [ ] Після production start відкрити known/unknown tattoo slug, `/gallery/men`, `/gallery/men/peredplichcha`, empty filter route та remote pagination. Порівняти з прямою API-відповіддю.
- [ ] Перевірити API config update без пересоздання клієнтської сторінки, migration undo/redo, mixed local/API collections, source zip/install/build і відсутність preview cache/secrets у client output.
- [ ] Оновити аудит: issue status, реалізація/посилання, test evidence, migration version. Окремі baseline storage/worker failures мають бути виправлені або досліджені з доказом окремої причини; їх не приховувати через exclude.

**Мінімальна acceptance matrix**

| Сценарій | Канвас | Preview | Production Dynamic | Production Hybrid |
|---|---|---|---|---|
| API detail: normal/null image, nested text/SEO | Правильний current item | Без module/render error | Server lookup; unknown slug 404 | Prerender/runtime згідно mode |
| men / men+peredplichcha | Fixture 47 / 19 | Ті самі datasets | Той самий backend filter | Той самий filter у відповідному rendering path |
| Два lists одного source | Незалежні data/state | Незалежні data/state | Окремі consumer props | Окремі consumer props |
| Старий request завершується після нового | Ігнорується | Ігнорується | Cache/query identity коректна | Cache/query identity коректна |
| Empty result / API failure | Empty і error відрізняються | Так само | Немає fake first item або fake 404 outage | Build/runtime policy явна |
| Remote pagination | Нові pages/cursors | Нові pages/cursors | Дані через server transport | Дані через server transport |
| Local JSON collection | Старі bindings/pagination працюють | Працює | Працює | Працює |
| Build preparation/failure/cancel | UI status/log | — | Реальний mode, terminal state | Реальний mode, terminal state |

**Критерій завершення:** підтверджені дефекти закриті regression evidence; обидва режими не тільки компілюються, а й проходять runtime route checks. Test success, successful build і successful server start записуються окремо.

## 4. Покриття пунктів аудиту

| Пункт | Що виправляється | Етапи |
|---|---|---|
| 1 | Preview не виконує API query | 5, 7, 8 |
| 2 | Довільні списки не мають server orchestration | 8, 9 |
| 3 | Undefined `f` у scalar route filter | 6 |
| 4 | Object equals підмінено substring | 1, 6 |
| 5 | Несумісний env syntax | 5, 10, 11 |
| 6 | Config edits/local→API не оновлюють wrappers | 9, 10 |
| 7 | API links очікують `_slug` | 1, 9, 10, 12 |
| 8 | Object/image inference та bare React object | 3, 10 |
| 9 | Empty API response зберігає старі data | 7, 8 |
| 10 | Два списки перезаписують source dataset | 1, 7–9 |
| 11 | Static-only query і cleanup overrides | 5, 7 |
| 12 | Duplicate query attributes після edit | 6, 10 |
| 13 | Refresh губить defaults/schema overrides | 3, 5 |
| 14 | POST не потрапляє в server fetch | 5, 9 |
| 15 | Двозначний global mode | 1, 10 |
| 16 | Partial provider contracts/static traversal | 5, 9, 11 |
| 17 | Pagination розкриває лише cached array | 11 |
| 18 | Preview JSON потрапляє у client/export | 8, 9, 11 |
| 19 | Nested SEO lookup | 1, 3, 9 |
| 20 | Detail не обчислює `srcExpression` | 4 |
| 21 | UI bind допускає out-of-scope item | 4, 6 |
| 22 | Failed `.next` позначено `isBuilt=true` | 2 |
| 23 / C1 | Direct CORS byte fetch у canvas image optimizer | 3, 5, 7, 13; розділ 6 |
| 24 / C4 | Child render errors не ізольовані preview boundary | 8, 13; розділ 6 |
| 25 / C3 | Empty string attrs серіалізуються як boolean | 3, 10, 13; розділ 6 |
| Build observations | 10% assets plateau, duplicate preparation, hidden logs, failure lifecycle | 2, 13 |
| Mode observations | Dynamic і Hybrid не відрізнялися | 9, 10, 13 |
| Validation gap | Config/query schema та Oracle dialect | 1, 5, 6 |
| Project/UX observations | Category-only page, title/slug, stale imports, Navbar intent | 12 |

## 5. Рекомендовані контрольні точки виконання

1. **Після етапів 0–4:** diagnostics збірки працює; repaired detail preview рендериться, image змінюється з item; source не містить scope crashes.
2. **Після етапів 5–8:** API query і filters узгоджені; canvas/preview показують ті самі datasets, включно з empty/errors та двома lists.
3. **Після етапів 9–10:** generated server source та mode migration перевірені; локальні/API проєкти зберігають дизайн і працюють після config edits.
4. **Після етапів 11–12:** remote pagination, export і UX завершені; контрольний проєкт покриває всі routes.
5. **Після етапу 13:** повний набір доказів, дві successful builds, production route checks і оновлений аудит. Лише тоді позначати інтеграцію завершеною.

Повторні широкі тести й реальні збірки запускати на цих контрольних точках або після нових failures/змін; між ними достатньо цільових перевірок. Не переносити відомий crash із build у runtime й не називати це виправленням.

## 6. Доповнення: причини console errors та конкретний план виправлення

Проаналізовано весь наданий `Вставлений текст.txt`, а не тільки перші stack traces. Підрахунок стосується цього логу, не всіх можливих помилок білдера.

| Позначення | Повідомлення | Висновок |
|---|---|---|
| C1 / №23 | 93 CORS messages та 93 `ERR_FAILED 200 (OK)` для 93 унікальних asset IDs | Одна системна проблема image optimizer, 93 різні requests; не 186 різних assets і не доведений нескінченний retry |
| C2 / №8 | `Objects are not valid as a React child (found: object with keys {})` | Вже відтворений bare `{item.img_file.metadata}`; fatal render error |
| C3 / №25 | `Received true for a non-boolean attribute alt` | Bare `<img alt>` у шаблоні; генератор відтворювано перетворює `alt=''` на boolean JSX |
| C4 / №24 | `An error occurred in the <p> component`, порада додати boundary | Наслідок C2 і відсутність механізму ізоляції render failure у preview sandbox |
| Info | React DevTools download / MCP Bridge connected successfully | Нормальні development/connection повідомлення; виправлення не потрібні |

### C1. External image display та readable bytes — різні операції

**Причина.** `canvas-image-preview.ts:166` виконує `fetch(url, {mode:'cors', credentials:'omit'})` із canvas iframe `http://localhost:5174`. API assets не повертають потрібний `Access-Control-Allow-Origin`, що явно вказано в логу. `shouldPreviewUrl` приймає ці extensionless URLs; `edgeResizeUrl` повертає null для `api.tattoozp.com`, тому кожен переходить у direct client downscale. Лише після читання bytes модуль перевіряє image dimensions.

HTTP 200 означає відповідь сервера, але не дозвіл JavaScript прочитати її. Просте відображення foreign image і pixel/byte reading мають різні правила. `catch` уже існує і повертає null, зберігаючи original URL; він не прибирає browser network diagnostics. Тому C1 не можна автоматично вважати причиною всіх порожніх images: detail-expression defect №20 залишається окремим. Пояснення browser constraints: [MDN — cross-origin images and canvas](https://developer.mozilla.org/en-US/docs/Web/HTML/How_to/CORS_enabled_image).

**Файли:** `src/canvas/renderer/canvas-image-preview.ts` та tests; sandbox transport/protocol, `src/backend/types.ts`, `local-backend.ts`, `revyme-backend.ts`, `server/api-plugin.ts`, sandbox/preview hosting configs.

**Покроково**

1. [ ] Визначити policy для кожного origin/provider: original display, upstream transformed image, same-origin readable bytes, explicit CORS-readable bytes або trusted server proxy. Для unknown/unreadable origin не запускати speculative direct fetch для кожного URL.
2. [ ] Перший fallback fix: skip client downscale для known unreadable origins, зберегти src/backgroundImage і працездатний native image display. Не лікувати CORS через `mode:'no-cors'`: opaque response не дає потрібних bytes для цього pipeline. Додавання `crossOrigin='anonymous'` саме по собі теж не додає server ACAO.
3. [ ] Якщо оптимізація потрібна, отримувати bytes через trusted host/server. Перевірити наявний proxy transport: cloud adapter використовує `/api/media/proxy`, local adapter зараз fetch-ить напряму; self-host plugin має загальний `/api/proxy`, але не cloud media endpoint. Не припускати, що endpoint cloud існує локально.
4. [ ] Для iframe bridge повертати bytes і створювати Blob URL усередині sandbox. Не передавати secrets або покладатися на blob URL чужого origin. Перевірити dev `3333/5174/5175` та production hosting: dev Vite proxy не доводить доступність маршруту в production.
5. [ ] До byte fetch пропускати вже достатньо малі завантажені images або гарантовані provider thumbnails. Параметр `width=500` сам по собі не є доказом, що довільний сервер виконав resize; спиратись на capabilities чи реальні intrinsic dimensions усередині iframe.
6. [ ] Зберегти pending-job dedup і bounded concurrency; додати policy/negative caching за origin/config revision. Поточний null cache уже обмежує повтори одного URL, але не 93 різних URLs. Cache invalidates після зміни доступу/transport; одна відмова не повинна назавжди вимкнути валідний origin.
7. [ ] Логувати одну агреговану diagnostic reason для skip/failure, не дублювати stack на кожен asset. Не підміняти console.error глобально: browser CORS messages прибираються усуненням невдалих requests.
8. [ ] За потреби контролю над Directus/nginx підготувати окрему server CORS configuration для потрібних origins. Це optional deployment work; builder fallback має працювати й без права змінити зовнішню CMS.

**Перевірки:** реальний browser fixture із двома origins і image без ACAO; valid native display без direct optimizer request; readable CORS origin; proxy path; 93 assets, re-render/route switch; transformed small image; src change під час job; збереження original URL у source.

**Готово, коли:** normal API gallery не створює CORS-шторм від optimizer, original images залишаються видимими, а оптимізовані previews працюють через дозволений transport. Для async errors є керований fallback, не unhandled promise.

### C2. Object child: усунути джерело, а не тільки перехопити exception

**Причина.** `img_file.metadata` — object `{}` у всіх 93 snapshot records; generated `<p>{item.img_file.metadata}</p>` непридатний для React text rendering. Лог підтверджує той самий дефект, що runtime reproduction та обидві Next builds. Додавання boundary саме по собі не виправляє data binding.

- [ ] Виконати етап 3: schema classification, explicit object formatter/omit, repair існуючого node зі збереженням custom content.
- [ ] Перевірити React client render і production prerender після ремонту; compile-only success недостатній.
- [ ] Зберегти diagnostic field path/node ID, щоб наступний object-binding error одразу вказував на джерело.

**Готово, коли:** звичайний detail render більше не кидає object-child exception; не тільки показує fallback boundary.

### C3. Empty string attributes помилково стають boolean

**Причина.** `serializeJSXAttr` у `generator-utils.ts:500` має `if (value === '') return \` ${key}\`` незалежно від типу атрибута. `buildNodeJSX` та canvas node creation використовують цей serializer. Відтворено: `serializeJSXAttr('alt','')` → ` alt`, node generation → `<img ... alt ...>`, також `aria-label=''` → bare aria-label. У наданому project snapshot actual image має bare `alt`. Без history не можна встановити конкретну gesture, що створила його, але faulty generation path відтворений.

**Файли:** `generator-utils.ts`, `generator-crud.ts`, `generator-attrs.ts`, `parser.ts`, image/clone/paste paths і HTML attribute controls.

1. [ ] Використати shared HTML attribute type registry: boolean attrs, string attrs, React/property aliases. Bare JSX генерується лише для справжнього boolean true, не через універсальний empty-string heuristic.
2. [ ] Для existing string value `''` зберігати `alt=""`, `aria-label=""`, `data-*=""`; зберегти escaping, `var:` bindings і expressions.
3. [ ] У mutation API зберегти `'' = remove`. Якщо UI має задавати explicit empty decorative alt, запровадити окрему дію/representation; не міняти значення empty style/property mutations глобально.
4. [ ] В `updateHtmlAttrsInCode` обробити bare legacy attr при remove/update. Наявні regex шукають `key=...`; bare `alt` може лишитися або доповнитися другим `alt`.
5. [ ] Мігрувати відомі bare string attrs AST transform, не convert-ити справжні boolean `controls/muted/...` на strings. Зберегти user-authored dynamic alt bindings.
6. [ ] Додати serializer→parser→clone→render regression tests для alt/title/ARIA/data і справжніх boolean attrs. На React render assert відсутність non-boolean warning для normal image.

**Готово, коли:** node clone і canvas detach не змінюють тип атрибута; bare legacy alt ремонтується; звичайна detail/gallery не видає alt warning.

### C4. Error Boundary для preview sandbox і відновлення після виправлення

**Причина.** `main.tsx` ловить compilation/module-evaluation exception під час створення `tree=<Page .../>`. Сам component render відбувається пізніше у React, тому цей try/catch не ловить помилку `<p>`. Обидва paths `rerender` викликають `root.render(<PreviewApp />)` без boundary. Boundary у `ComponentLivePreview.tsx` належить іншому preview path. React описує цей механізм у [офіційній документації Error Boundaries](https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary).

**Файли:** `src/preview-sandbox/main.tsx`, запропонований sandbox boundary module/tests, `PreviewOverlay.tsx`, thumbnail capture та error reporting protocol.

1. [ ] Додати boundary навколо user page/layout render tree; зберегти routing/UI diagnostic shell працездатними при child exception.
2. [ ] Розділити `compile/module error`, `render error` та `API error`. Передавати до parent editor категорію, path/URL і component stack без secrets.
3. [ ] Reset boundary при новій project revision, file update або navigation; не скидати його на кожен render, інакше виникне error loop. Надати явний Retry/Reload.
4. [ ] У fallback показати зрозумілу помилку й source context. Не заміняти пошкоджений source автоматично й не видавати fallback за успішний site render.
5. [ ] Не запускати успішний thumbnail capture для error fallback, щоб не перезаписати project thumbnail скріном помилки.
6. [ ] Runtime API/effect/event errors, які boundary не покриває, обробляти відповідним request/effect lifecycle; boundary не є універсальним try/catch для всіх async tasks.
7. [ ] Перевірити injected child-render crash, layout crash, route change і file fix після failure. Один controlled diagnostic report замість unhandled root error; normal source після C2 fix має рендеритися без error fallback.

**Готово, коли:** broken user component не залишає preview білим, error видно в editor, виправлення файлу відновлює preview без перезапуску білдера. У development контрольовані React diagnostics можуть лишатися; не ставити ціль «ніколи жодного console message».

### Порядок застосування доповнення

Спочатку C2 та C3 у етапі 3, потім C1 transport/policy у етапах 5/7 і C4 boundary у етапі 8. Мінімальний skip optimization для known unreadable origin можна впровадити раніше, разом із C3, не очікуючи повного proxy layer. Повторити normal detail/gallery console capture та E2E на етапі 13. React DevTools і успішне MCP connection не приховувати як «помилки».

Наявні три suites image-preview / preview fixes / thumbnail пройшли **21/21**, але не покривають реальний CORS transport чи empty-attr serialization. Локальні diagnostic reproductions `docs/audits/console.repro.test.ts` підтвердили direct-preview admission і три червоні assertions очікуваної поведінки для serializer/node generation. Виправлення реалізації ще не виконані.
