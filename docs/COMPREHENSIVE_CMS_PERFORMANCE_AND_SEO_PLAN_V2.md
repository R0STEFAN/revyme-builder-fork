# Комплексний план CMS, продуктивності та SEO — v2

Дата: 15 жовтня 2026 року. Аудит checkout: `2de9cb7`.

Статус: **план до реалізації**. Цей документ уточнює `COMPREHENSIVE_CMS_PERFORMANCE_AND_SEO_PLAN.md`; виконання пунктів нижче ще не розпочате. Початковий файл збережено.

## 1. Мета, межі та підтвердження

Зберегти чотири напрями v1: SEO-формули, CMS із SSR/ISR та webhook-оновленням, responsive CMS images, швидка навігація. Спочатку забезпечити правильність даних, безпечність серверного виконання і збереження source, потім оптимізувати доставку.

У v1 недостатньо враховано режими кешування, регенерацію wrapper-файлів, серверні дані для вкладених компонентів, локалі, видалення контенту, доступ до CMS через публічний relay та перевірку результату в production Next.js. Сам порядок чотирьох AST-проходів цих проблем не усуває.

Проаналізовано чотири документи, на які посилається v1, відповідні генератори, CMS config/accessors, SEO UI, expression popup, overlay effects, preview API/shims, source export, local build та наявні тести. Додатково враховано `nextjs-site-performance-plan-v2.md` і попередній API CMS аудит. Статуси старих документів не вважаються доказом поточного стану коду.

Під час цього аудиту:

- `npx vitest run src/code/project/cms-seo.test.ts src/code/project/cms-seo.api.test.ts src/code/project/source-export.test.ts src/code/project/__tests__/source-export-modes.test.ts src/code/project/__tests__/source-export-clean.test.ts src/code/project/__tests__/cms-config-migration.test.ts src/shared/image-utils.test.ts src/code/generation/overlay-gen.test.ts` — **8 файлів, 225 тестів пройшли**.
- `npx tsc --noEmit` — **exit code 0**.
- Локально встановлені Node.js `24.18.0`, Next.js `16.2.10`, `@revyme/runtime` `0.0.28`. Source scaffold експортує `next: '^16'`, React `'^19'`; білдер працює через Vite.
- Нові production fixtures, webhook-сценарії, CWV і навантаження під час цього аудиту **не запускалися**. Прохід наявних тестів не підтверджує майбутні можливості v2.
- Cloud backend build/export не представлений у цьому checkout. Його кеші, CDN, підтримка ISR та deploy-поведінка потребують окремої перевірки перед cloud rollout.

## 2. Що вже реалізовано і що треба змінити

Посилання нижче — на поточний код, а не на запропоновані нові модулі.

| Підтверджений стан | Де | Наслідок для v2 |
| --- | --- | --- |
| `ApiCollectionConfig` оголошено в `src/code/project/cms-api-config.ts`, а не в `shared/types.ts` | `cms-api-config.ts:12` | Не створювати другий однойменний тип; винести чисті DTO лише за потреби спільного server/browser використання |
| API detail вже має `generateStaticParams`, `dynamicParams = true`, fetch TTL | `cms-seo.ts:184` | Розширити наявну реалізацію, не описувати її як повністю відсутню |
| Hybrid discovery уже підтримує декілька параметрів, але робить Cartesian product | `cms-seo.ts:453`, `cms-seo.ts:613` | Потрібні зв'язки між параметрами та бюджет prerender; усі комбінації не обов'язково існують |
| Dynamic export переважно прибирає `generateStaticParams`; fetch-генератори залишають TTL | `source-export.ts:584`, `cms-page-ops.ts:939` | Це не контракт «дані свіжі на кожен запит» |
| API detail lookup прив'язаний до `slug`; discovery запитує `fields=slug&limit=500` | `cms-seo.ts:212` | Узгодити `slugField`, `idField`, provider-specific filters, pagination та custom REST |
| Метадані й тіло detail отримують item окремими fetch-блоками | `cms-seo.ts:268`, `cms-seo.ts:324` | Спільний loader і однакове трактування помилок/404; не покладатися лише на неявну дедуплікацію fetch |
| API metadata error fallback повертає плоский `seoDefaults`; Twitter використовує `image` | `cms-seo.ts:279`, `cms-seo.ts:314` | Нормалізувати всі return branches до Next Metadata; перевіряти реальні теги |
| Local detail client при відсутньому slug бере перший запис | `cms-page-ops.ts:527` | Вирішувати відсутність запису серверним `notFound()`, не публікувати чужу сторінку під невідомим URL |
| Config sync повторно генерує detail із defaults/bindings; expressions поки немає | `cms-page-ops.ts:1254` | Додати expressions до кожного шляху регенерації, інакше наступне редагування API config їх втратить |
| SEO save повністю перебудовує detail wrapper | `src/cloud/settings/PagesSeoSection.tsx:416` | Не втрачати layout, datasets, cache policy, route context та інші згенеровані блоки |
| Expression popup, shared evaluator та query evaluators уже використовують `new Function` | `ExpressionEditorPopup.tsx:111`, `cms-accessor.ts:164`, `cms-api-config.ts:241`, `cms-page-ops.ts:910` | Винятки обробляються, але sandbox немає; не переносити такий механізм у server SEO |
| `/api/cms/query` уже генерується; входи приймають `collection`, а не `source` | `source-export.ts:301` | Використати наявний протокол і посилити його, не створювати несумісний другий endpoint |
| Relay повертає upstream items і дозволяє клієнту перезаписувати query params | `source-export.ts:357` | При привілейованому токені потрібні обмеження полів, фільтрів і published scope до розширення live queries |
| `prepareSiteFiles` та export домішують global ProjectFS config до вхідного snapshot | `source-export.ts:518`, `source-export.ts:805` | Усунути неявну залежність від відкритого проєкту/гілки; перевірити `mode: local` |
| Source export уже має upload srcSet, font transform, overlay healing і API orchestration | `source-export.ts:498` | Новий pipeline має зберегти ці проходи; v1 не охоплює весь фактичний порядок |
| Local UI передає prepared files, але `LocalServerManager` також може будувати persisted raw files | `LocalServerDropdown.tsx:282`, `server/local-server.ts:917` | Підготовку гарантувати для кожної build entry point, не лише кнопки в UI |
| Local export безумовно переписує `lib/image-utils.ts` та optimize script | `server/local-server.ts:617` | CMS helper, доданий лише в export pass, може бути затертий; потрібен спільний emitter |
| `useRouter().prefetch` уже є no-op у preview | `src/preview-sandbox/next-shims.tsx:145` | Перевірити сумісність, а не додавати дубль; canvas і preview — окремі середовища |
| Dynamic locale wrappers не експортують metadata | `locale-route-ops.ts:52` | Нові SEO-формули в базовій сторінці самі не забезпечать locale canonical/hreflang |

Це також пояснює, чому 225 зелених тестів недостатньо: багато перевірок доводять форму згенерованого рядка або поведінку mock, а не кешування та HTML запущеного Next.js сайту.

## 3. Архітектурні правила

1. Source лишається джерелом істини. Зміни JSX — через mutation queue / `modifyProjectFile`, без обходу parse gate. Для багатофайлової регенерації потрібні узгоджені flush, branch context, autosave та повідомлення про відмову запису. Наявні прямі записи у CMS sync не копіювати в нові шляхи.
2. Canvas iframe читаємо через bridge/cache. DOM, до якого звертається згенерований overlay runtime **всередині опублікованої сторінки**, — інший контекст; це не дозвіл читати iframe DOM із батьківського редактора.
3. Кожне налаштування має read → edit → write → read round trip. Зберігати `data-id`, CMS bindings, responsive overrides, variants, refs та підтримуваний oracle dialect.
4. `metadata` і `generateMetadata` не експортуються одночасно. Для locale wrappers це правило також діє. Не прибирати `'use client'` механічно з довільного файла: hooks не стають серверними від видалення директиви.
5. Нову перевикористовувану браузерну поведінку оформлювати в `@revyme/runtime` із тестами та export checklist його репозиторію. Server-only fetch/credentials не імпортувати через клієнтський entry point. Якщо потрібен новий pure/server export, включити його реліз у залежності плану; правка `node_modules` не є реалізацією.
6. Підготовка сайту працює з копією переданого snapshot та явним context. Однаковий input/context дає однаковий output; повторна підготовка не дублює imports/hooks/attributes і не накопичує старий конфіг.
7. Генератори не мають мовчки замінювати авторські файли на згенеровані. Для власних synthetic files — marker, schema/generator version і міграція. Для конфлікту з custom file — зрозуміла діагностика.
8. Додавати `trace.action/fn/error` для save, migration, transform skips, запитів та revalidation без секретів і повних приватних payloads. Значення `''` для видалення стилю не змінюється.

## 4. Контракт режимів і свіжості

Нормалізувати legacy `ssg`, `buildMode: 'ssg'`, `'hybrid'`, `'dynamic'` в один внутрішній контракт. Суперечливі аргументи не можуть одночасно увімкнути Dynamic і Hybrid, як зараз дозволяють незалежні boolean-перевірки. Значення за замовчуванням задокументувати і протестувати.

| Режим | Початкові дані | Кеш і нові URL | Що потребує rebuild |
| --- | --- | --- | --- |
| Dynamic SSR | Сервер отримує дані до HTML; інтерактивні наступні запити йдуть через relay | CMS fetch явно `no-store`; маршрути перевіряються на запит; немає обіцянки ISR-кешу | Зміни source, schema/code contracts та local JSON |
| Hybrid SSG + ISR | Частина валідних маршрутів prerender, інші — on demand | Явні TTL/tags і runtime fallback; фактичний ISR підтверджує production fixture | Зміни коду; local JSON без зовнішнього runtime джерела |
| Local CMS snapshot | Дані з проєктних JSON | Revalidation не може створити нові дані в імпортованому build artifact | Зміна JSON потребує нового deploy |
| Static-only hosting | HTML/assets, сформовані під час build | Немає вбудованого server relay, webhook handler, ISR або невідомих dynamic URLs | Зміни контенту; зовнішній API можливий лише як окрема інтеграція з власним контрактом |

Static-only — capability constraint, а не обіцянка створити новий export backend у першому релізі. Існуючий `buildMode: 'static'` не слід вважати завершеним `output: 'export'`. Несумісні опції мають давати preflight-помилку. Обмеження підтверджує [Next.js static export](https://nextjs.org/docs/app/guides/static-exports).

`dynamicParams = true` дозволяє обробити невідомий параметр, але сам по собі не гарантує існування контенту або його ISR-кешування. `generateStaticParams` не запускається повторно при ISR. Це перевіряти на підтримуваній версії, з урахуванням того, чи ввімкнено Cache Components. Початковий scope: **Next 16 App Router без автоматичного ввімкнення Cache Components**; невідомі custom cache-конфігурації — окремий compatibility check. Див. [generateStaticParams](https://nextjs.org/docs/app/api-reference/functions/generate-static-params).

Оновлення CMS розділити на чотири моменти: commit у CMS → прийнятий webhook → наступна свіжа server response → оновлення вже відкритого browser UI. Не називати їх одним «миттєвим оновленням». Browser Router Cache, client query cache, Next Data/Full Route cache та CDN потребують окремої політики. Числа 0–20 ms, 30–50 ms і «zero layout shift» з попередніх планів не є гарантіями.

## 5. Цільова структура

Послідовність: snapshot + нормалізовані options → validated config → route/query manifest → server loaders і wrapper emission → client data adaptation → delivery transforms → synthetic files → validation → ZIP/local/cloud adapter.

Manifest містить route template, локалі, параметри та їх джерела, query identity, CMS dependencies, required fields, правила видимості контенту, cache tags, prerender budget і спосіб побудови canonical. Він не містить секретів у browser-частині. Це спільна основа для SEO, даних, sitemap та invalidation.

`prepareSiteFiles` може лишитися синхронним pure transform. Live discovery/pagination, якщо потрібні перед генерацією, виконуються в окремій async build phase або у згенерованому `generateStaticParams`, з явним бюджетом. Не намагатися робити network fetch усередині синхронного AST pass.

Порядок трансформацій уточнюється за залежностями: спочатку визначення query/route scope, потім перенесення даних, потім image/link delivery, наприкінці synthetic imports/files і валідація. Кожен pass читає останню версію файла. Зберегти font transforms, overlay healing, locale handling та legacy repairs. Сам по собі порядок «images → links → components» не є інваріантом.

## 6. Етап A — baseline, build contract і fixtures

Пріоритет **P0**. Передує решті етапів.

Файли: `source-export.ts`, `LocalServerDropdown.tsx`, `export-project.ts`, `server/local-server.ts`, `server/api-plugin.ts`, backend client DTO; відповідні тести. Нові policy/manifest модулі розміщувати поруч із project/export code, чисті DTO — у shared лише за реальною потребою.

- [ ] Зафіксувати підтримувані Next/React/runtime версії для fixtures і локального build. `'^16'` у ZIP не гарантує тотожності з локально встановленим Next; додати compatibility policy/lockfile policy та версію в build report.
- [ ] Ввести єдину нормалізацію build options, явні capabilities хостингу і cache policy; протестувати пропущені та суперечливі legacy options.
- [ ] Зробити preparation незалежною від global ProjectFS, включно з fallback-викликами `getApiCollection()` у нижчих генераторах. Не змішувати конфіги різних branches/projects; поважати `mode: local`.
- [ ] Гарантувати спільну preparation для ZIP, local UI build і persisted/server build. Не імпортувати browser/Jotai залежності у Node backend заради повторного використання: виділити pure core.
- [ ] Створити production fixtures: local CMS, Directus, provider mock; detail/index, вкладений Navbar з CMS, 2 lists однієї collection з різними filters, `/gallery/[category]/[place]`, 2 локалі, понад 500 records, small/large/signed images, custom files.
- [ ] Зберегти baseline HTML, HTTP statuses, server request counters, JS/data/image bytes, TTFB/LCP і navigation timing. Для кожного режиму окремо cold request, warm request, client navigation.

Готовність: однакові snapshot/options дають еквівалентні потрібні файли в усіх доступних build paths; запущений fixture показує фактичний SSR/SSG режим. Немає залежності від того, який проєкт відкрито в редакторі.

## 7. Етап B — спільний CMS loader і безпечний query relay

Пріоритет **P0**. Залежить від A; передує live components та webhook rollout.

Файли: `cms-api-config.ts`, `cms-seo.ts`, `cms-page-ops.ts`, `source-export.ts:buildCmsQueryRouteHandler`, `shared/cms-accessor.ts`, query types/tests. Перевірити чинний pagination runtime у `cms-pagination-gen.ts` перед зміною протоколу.

- [ ] Визначити provider adapter contract: list/detail/discovery request, pagination/cursor, fields projection, publish filter, sort, response extraction, error mapping. Підтримати custom `slugField`, `idField`, вкладений `itemsKey`; не застосовувати Directus query syntax до кожного REST API.
- [ ] Нормалізувати ідентичність через наявні accessors. Визначити поведінку duplicate/empty slug, Unicode, encoded segments, custom slug path та missing item. Не перетворювати довільну строку на URL без encode/validation.
- [ ] Public visibility contract поширюється і на local CMS: узгодити `_status`/draft/published у detail lookup, lists, static params, sitemap і exported JSON. Preview може показувати draft лише за окремим editor/preview context; production snapshot не повинен ненавмисно включати приватні поля або чернетки.
- [ ] Metadata й Page використовують спільний item loader з однаковим route context. Для GET використати сумісну request memoization; для інших методів визначити її явно. Перевіряти counters у fixture, а не припускати дедуплікацію POST/різних request options.
- [ ] Ввести однозначний результат: success із масивом, success із порожнім масивом, not found, forbidden, timeout, upstream error. Schema mismatch не маскувати як `[]` або успішний порожній SEO.
- [ ] Для transient errors не кешувати успішний порожній результат. Hybrid regeneration має зберігати останній успішний стан; видалення/unpublish обробляти окремо від timeout. Додати bounded timeouts/retries тільки для ідемпотентних операцій, concurrency limit і контроль 429.
- [ ] Relay приймає лише налаштовані public query IDs/collections. Server config визначає mandatory published filters, допустимі параметри, поля відповіді, максимальний limit, довжину payload і query complexity. Клієнт не може прибрати published filter або запросити `fields=*.*` всупереч policy.
- [ ] Query params не можуть змінювати upstream host/URL або розширювати доступ. Redirect destinations і зовнішні URLs перевіряти в межах дозволених CMS origins, якщо relay може звертатись до них. Не перетворювати endpoint на відкритий proxy.
- [ ] Credentials — server-only environment references; не дублювати raw tokens у runtime config, client bundles, RSC props, URLs, trace або ZIP example. Відсутній env дає конфігураційну помилку. Передавати в браузер лише потрібні публічні поля, а не всю upstream row.
- [ ] Узгодити `collection`/query ID protocol з існуючими pagination consumers. Додати валідацію finite integer для page/offset/limit, bounded responses і throttling на підтримуваному deployment layer; CORS не вважати авторизацією.

Готовність: query з приватним полем або override publish filter відхиляється; законний pagination query працює; 401/429/timeout відрізняються від пустої collection; SEO і тіло отримують узгоджений item.

## 8. Етап C — SEO-формули з визначеною мовою виконання

Пріоритет **P0** для server execution. Залежить від A/B.

Файли: `cms-seo.ts`, `cms-accessor.ts`, `cms-api-config.ts`, `cms-page-ops.ts`, `ExpressionEditorPopup.tsx`, expression tests; новий чистий validator/evaluator. Інтеграцію з oracle визначити за фактичними FileKind.

- [ ] Ввести typed `SeoSlot` для 9 полів: title, description, canonical, OG title/description/image, Twitter title/description/image. `CmsSeoExpressions` — `Partial<Record<SeoSlot, string>>`, не `Record<string, string>` без обмеження ключів.
- [ ] Перший підтримуваний grammar: literals, дозволений property access у `item`/`params`, template strings, concatenation, `??`/`||`, conditional expression, обмежений перелік pure helper functions за потреби. Заборонити довільні calls, constructors, assignment, statements, import, доступ до prototype/constructor/globalThis/process/fetch та інші виходи з контексту. Встановити ліміти довжини, глибини і кількості операцій.
- [ ] Парсити AST і виконувати дозволені вузли в interpreter або компілювати лише перевірений grammar. `new Function` плюс `try/catch`, `with`, чи Node `vm` не називати безпечним sandbox. Не запускати невідомий код для preview прямо під час друку.
- [ ] Один grammar та набір fixtures для popup preview, server SEO і query expressions. Preview context явно показує sample item/params; токени collection names не пропонуються, якщо server context їх не підтримує. Старі довільні JSX expressions не переписувати мовчки: надати compatibility diagnostics і явну міграцію.
- [ ] Зберігати формулу як JSON-escaped string у згенерованому config block; parser відновлює її без виконання. Перевірити backticks, `${...}`, лапки, newlines, Unicode і рядок `};`.
- [ ] Fallback: валідний непорожній expression result → field binding → static default → визначений fallback slot/site default. Порожній/невалідний результат і `0`/`false` мають явні правила за типом поля. Objects дозволені лише для відомої media shape; не генерувати `[object Object]`.
- [ ] SEO і query expressions не отримують server secrets, globals або всі collection snapshots як неявні змінні. Media object нормалізується через provider-aware resolver з B/I, а не `/assets/${id}` на домені сайту.

Готовність: parse → generate → parse зберігає формулу; preview/server дають однаковий результат на однакових fixtures; спроби доступу до globals/prototype і дорогі вирази відхиляються до виконання.

## 9. Етап D — SEO UI та збереження при всіх регенераціях

Пріоритет **P1**. Залежить від C.

Файли: `PagesSeoSection.tsx`, `ExpressionEditorPopup.tsx`, `ExpressionBoundPill.tsx`, `cms-seo.ts`, `cms-page-ops.ts`, locale/page operations та metadata tests.

- [ ] Додати `filePath`/route context для вибраної в Settings сторінки, незалежно від active canvas file. Route parser використовувати спільний із manifest; врахувати `[id]`, nested params, catch-all arrays або показувати явну непідтримку без хибних токенів.
- [ ] Додати fx/pill до всіх 9 полів; передавати collection context і schema, розрізняти binding/formula/static fallback. Підтримати keyboard/focus, clear/unbind, cancel, validation error і preview error.
- [ ] На ordinary/multi-param pages без CMS detail `params.*` доступні, а `item.*` — лише якщо є item source. Не замінювати таку сторінку hardcoded `[slug]` detail wrapper заради формули.
- [ ] Узгодити dirty/save/immediate-binding-save. При зміні сторінки не застосовувати стару формулу до нової; при зовнішній зміні source не перезатирати мовчки незбережену форму. Помилка/refused `modifyProjectFile` не показує успішне збереження.
- [ ] Усі emitters беруть спільну read model: defaults, bindings, expressions, robots, route/cache policy, datasets, layouts та version. Перевірити create detail, SEO save, API config edit, local→API migration, locale sync, duplicate/move та повторний export.
- [ ] У `syncAffectedCmsPageWrappers` додати parse/preserve expressions. У SEO save не втрачати orchestrated queries і custom wrappers. Авторські server files змінювати консервативно з діагностикою unsupported shape.
- [ ] Після save: reload проєкту та повторне відкриття Settings відновлюють той самий стан. Перевірити save з pending canvas mutation і неактивною сторінкою.

Готовність: формула переживає редагування connection config, перемикання build mode, locale sync та reopen. Layout і datasets лишаються функціональними; немає одночасного metadata/generateMetadata export.

## 10. Етап E — коректні metadata, URL та індексація

Пріоритет **P1**. Залежить від B–D; частково паралельний з F.

- [ ] Єдиний mapper із flat SEO settings у Next `Metadata` для success та fallback branches. Виправити `twitter.image` на `twitter.images`; зберегти robots, OG/Twitter fallbacks і parent metadata там, де потрібно.
- [ ] Визначити публічний `siteUrl`/`metadataBase` і route URL resolver. Canonical за замовчуванням — URL конкретного item та locale; не один canonical collection для всіх detail pages. Нормалізувати basePath/trailing slash/query policy, не брати canonical origin зі стороннього request header.
- [ ] Canonical expression може задавати свідомий cross-domain canonical, але проходить URL validation. OG/Twitter images отримують абсолютні public URLs, правильні asset origin/base path і без server credential. Соціальні preview images не використовують вузький thumbnail srcSet.
- [ ] Додати locale-aware `generateMetadata`/delegation у dynamic locale wrappers. Рендерений контент, canonical та hreflang мають посилатись на ту саму локаль/реально наявний переклад; не рекламувати неіснуючі переклади. Перевірити, що static locale wrappers не гублять title/description основної сторінки.
- [ ] Серверні not-found правила для API та local detail; невідомий slug не показує перший item. Відрізняти неіснуючий item від тимчасової помилки CMS. Зважати на можливий streaming status: перевіряти HTTP status і noindex фактично запущеного маршруту.
- [ ] Manifest використовувати для `app/sitemap.ts` та `app/robots.ts` або сумісних generated routes. Sitemap включає тільки published canonical URLs, має pagination/sharding при потребі та коректний lastmod. Нові/видалені items і локалі оновлюють його через той самий cache contract.
- [ ] Політика search/filter/pagination: які URL indexable, які noindex, який canonical; не canonical-ити автоматично всі paginated pages на першу. Load more має доступні crawlable links там, де потрібна індексація наступних сторінок.
- [ ] Визначити rename slug: старий→новий URL, видалення старого із sitemap та stale cache. Якщо потрібний постійний 301/308 redirect, джерело history/mapping має працювати runtime без rebuild; відсутність history — явне обмеження.
- [ ] JSON-LD для Article/Product/Breadcrumb — окремий **P2** opt-in із schema mapping і безпечним escaping; не блокувати ним основний реліз 9 SEO-полів.

Поля Next Metadata перевірені за [офіційною документацією](https://nextjs.org/docs/app/api-reference/functions/generate-metadata). Приймання — по реально зрендерених `<title>`, canonical, robots, OG/Twitter та hreflang, включно з crawler user agent, а не тільки по JS object у unit test.

## 11. Етап F — bounded prerender і dependency-aware revalidation

Пріоритет **P1**. Залежить від A/B та manifest; використовує E для sitemap/locales.

- [ ] Замінити hardcoded `fields=slug&limit=500` на adapter discovery з pagination/cursor, stable order, дедуплікацією, published scope і configurable бюджетом. Понад 500 records — обов'язковий fixture, а не прихований upper limit.
- [ ] Для multi-param routes збирати валідні tuple з relations/query/source mapping. Link crawler — допоміжна евристика. Cartesian product дозволити тільки явно для незалежних facets із maxRoutes/time/concurrency budget; не генерувати тисячі порожніх сторінок.
- [ ] Для Hybrid підтримати «top N + решта on demand». Для static-only потрібен повний набір або зрозумілий отказ unsupported target. Зафіксувати, які catch-all/optional/colliding routes підтримуються; не удавати підтримку через regex.
- [ ] Усі кешовані list/detail/query/metadata/navigation/sitemap loads отримують узгоджені tags, наприклад `cms:<collection>`, плюс item/route tags за потреби. Query key включає collection, filters, locale, route params і pagination; filters однієї collection не змішуються.
- [ ] Генерувати `/api/revalidate` лише для server-capable output із налаштованим webhook mode. POST, обов'язковий secret у header або provider signature; відсутній secret — fail closed. Жодного default token і секрету в query string.
- [ ] Валідувати event type, collection, item ID, payload size; обмежити частоту/burst. Provider payload перетворюється в нормалізовану подію. Повторна доставка безпечна; retries/logging не містять secret. Якщо є replay protection, timestamp/event ID policy документується для provider.
- [ ] Payload не задає довільний path/tag для масового purge: invalidation targets виводяться з дозволеного manifest. Для update/delete/rename врахувати list, detail, relation-dependent pages, navigation, локалі, sitemap, старий і новий slug. Якщо старого slug немає, інвалідувати відомий route pattern/collection dependency, а не вигадувати URL.
- [ ] Для Next 16 явно вибрати `revalidateTag(tag, 'max')` для stale-while-revalidate або `{ expire: 0 }` для блокувальної наступної перевірки, коли stale content неприпустимий. Не використовувати deprecated однопараметровий виклик; `updateTag` не переносити у webhook Route Handler. Див. [revalidateTag](https://nextjs.org/docs/app/api-reference/functions/revalidateTag).
- [ ] Для `revalidatePath` route pattern передавати потрібний `type`. Webhook позначає стан для наступного звернення; це не гарантія завершеної регенерації всіх сторінок у момент відповіді endpoint. Див. [revalidatePath](https://nextjs.org/docs/app/api-reference/functions/revalidatePath).
- [ ] TTL — резервний шлях при втраченому webhook. Визначити retry/delivery diagnostics і policy warmup для важливих URL. Self-hosted multi-instance deployments потребують узгодженого shared cache/invalidation; перевірити CDN окремо. Див. [Next self-hosting](https://nextjs.org/docs/app/guides/self-hosting).
- [ ] `.env.example` збирати також зі згенерованих required env dependencies, не лише з input snapshot: зараз `generateEnvExample(input)` не побачить новий revalidation secret, що з'явився лише в emitted route.

Готовність: create/update/delete/unpublish/rename доходять до потрібних публічних representations без rebuild у Hybrid; невідомий реальний URL працює on demand; raw local JSON не обіцяє таких оновлень. Невалідний webhook не змінює cache state.

## 12. Етап G — CMS у reusable components та відкритому браузері

Пріоритет **P1**. Залежить від B/F та runtime delivery contract.

- [ ] Аналізувати collections у components, templates/layouts, variants, overlays і вкладеному графі imports, а не лише `page.client.tsx`. Встановити ownership query scopes, щоб однаковий компонент у різних route params не отримував чужий dataset.
- [ ] Для першого HTML передавати серверний dataset до клієнтського CMS provider/component props. Dynamic SSR не підміняти порожнім `useState([])` + `useEffect(fetch)`: інакше меню та контент з'являються лише після JS і другого network trip.
- [ ] Hybrid використовує server data як initial state; build snapshot допускається тільки як явно обмежений fallback із public projection. Client refresh не робить hardcoded snapshot актуальним server SEO або sitemap.
- [ ] Заміна imports враховує scope, aliases, multiple exports, hoisted JSX, design/code components і rules of hooks. Не вставляти hooks на module scope чи всередині умов/циклів. Невідомий custom shape дає діагностику, не silent corruption.
- [ ] У runtime: query key, dedup/cache, error/empty/loading states, AbortController/sequence guard, cleanup, query identity при переході, reset pagination при зміні filters, initial cursor/offset. Старий запит не перезаписує новий route.
- [ ] Визначити bounded freshness відкритої вкладки: наприклад refresh при відкритті меню за TTL, focus/reconnect та explicit invalidate. Webhook не доставляє push у браузер сам по собі. Якщо потрібна live push модель — SSE/WebSocket і auth є окремим обсягом.
- [ ] Узгодити оновлення client datasets із prefetched RSC/Router Cache. `router.refresh` не викликати на кожному render або глобально без потреби. При overlay late fetch нові links також потрапляють у prefetch policy H.
- [ ] Зберегти focus і поведінку меню при зміні даних, unique stable keys, reserved geometry за потреби; міряти CLS. Не обіцяти нульовий CLS для довільної зміни контенту.

Готовність: вкладений Navbar має справжні links у початковому HTML, бачить новий item за визначеною freshness policy і відкриває його без rebuild; дві різні query/list однієї collection ізольовані.

## 13. Етап H — керований prefetch та feedback переходу

Пріоритет **P2**, після правильності data/cache. Частину базових loading/error states можна впровадити раніше.

`prefetch={true}` всюди не є безумовною оптимізацією: static routes уже можуть prefetch-итися повністю; примусове завантаження сотень detail routes витрачає мережу, сервер і CMS requests. Поведінку визначає route type і Next configuration. Див. [Next prefetching](https://nextjs.org/docs/app/guides/prefetching) та [Link API](https://nextjs.org/docs/app/api-reference/components/link).

- [ ] Policy: default Next behavior для звичайних links, intent/focus для дорогих або численних routes, selective eager для короткого основного меню, off для downloads/non-navigation. Авторське `prefetch={false}` зберігається. Нові user-visible policy options додавати лише за потреби, із round trip.
- [ ] AST відстежує справжній `next/link` import та підтримуваний MotionLink wrapper/alias. Не змінювати custom component лише через ім'я `Link`; підтримати відомі dynamic href без глобального `prefetch=true`.
- [ ] Нормалізувати URL через спільний resolver: relative, same-origin absolute, locale/basePath, query/hash. Виключити external/protocol-relative, hash-only, download, `target` і службові endpoints; враховувати explicit opt-out.
- [ ] Intent охоплює pointer і keyboard focus. Об'єднувати існуючі handlers зі збереженням їхньої поведінки. Bounded queue, dedup, TTL і concurrency; початковий кандидат — до 4 eager links/menu та 2 concurrent tasks, остаточні значення підтвердити вимірами.
- [ ] Обмежити спекуляцію на `saveData`/повільній мережі, якщо Network Information API доступний; без цього API працює консервативний fallback. Перевірити, що prefetch не запускає побічних дій на server render.
- [ ] Overlay scan виконується після появи DOM, поза resize/scroll positioning loop, і обмежується конкретним instance root. Для links, що з'являються після API refresh, потрібен data-change trigger або вузький observer із cleanup. Не робити необмежений scan усієї сторінки.
- [ ] Додати hooks/imports з урахуванням bindings і scopes; не створювати duplicate router declaration і stale dependencies. Create/heal/remove paths працюють однаково. Поточний signature `buildFixedOverlayRuntimeEffect(id, scoped = false)` приймає boolean: приклад v1 із `'isOpen'` як другим аргументом непридатний.
- [ ] Перевірити canvas renderer і preview окремо; існуючий preview no-op достатній лише для свого контексту. Генерація/repair не повинні запускати справжні Next network prefetch у sandbox.
- [ ] Додати route-level loading/Suspense та error feedback, коли переходу все одно потрібен network request; не приховувати актуальний контент зайвим full-screen overlay.

Готовність: production navigation швидша на контрольних сценаріях без неприйнятного зростання speculative bytes, CMS/server requests і погіршення LCP/INP. Результат звітується окремо для cold/warm cache та відкритого overlay.

## 14. Етап I — CMS image pipeline

Пріоритет **P1** для public Directus assets; Cloudflare/custom engines — окремі **P2** адаптери після базового контракту. Залежить від B і manifest.

Файли: `shared/image-utils.ts`, **наявний** `shared/image-utils.test.ts`, `image-export-constants.ts`, `lib/image-utils.ts`, `source-export.ts`, `cms-api-config.ts`, `ApiResourceModal.tsx`, `server/local-server.ts`, image binding/preview tests. Не створювати другий набір тестів тільки через помилковий шлях у v1.

- [ ] Оголосити image optimization config в одному canonical DTO. Валідовані engine/quality/widths/format, public asset origin/path, provider capabilities; widths — finite positive sorted unique values з лімітом кількості та максимуму. Невідомий engine вимикає transform із діагностикою.
- [ ] Спільний resolver приймає string, Directus file object/ID та відомі provider media shapes і повертає public URL + intrinsic dimensions, якщо відомі. CMS origin визначати явно; не виводити його лише з поточного image hostname. Різні collections одного CMS можуть мати різні policies, тому потрібний binding/query provenance.
- [ ] Directus transform будувати через URL/searchParams зі збереженням допустимих query params, crop/focal point і cache version. Не робити `src.split('?')[0]`: це видаляє signature, access/version або існуючий transform. Signed URLs трансформувати лише за гарантованої сумісності, інакше залишати original.
- [ ] Provider transform capability перевіряти: Directus може обмежувати довільні transforms presets/policy, а підтримка формату залежить від інсталяції. Налаштування `auto`/explicit format проходить connection probe або документований fallback. Див. [Directus transforms](https://directus.com/docs/guides/files/transform).
- [ ] Cloudflare/custom перевіряють zone/origin allowlist, коректне кодування source URL і всі повторні placeholders, не створюють transform recursion. Private media безпечним не стає від CDN URL; auth/signed media — окремий adapter contract. Див. [Cloudflare image transforms](https://developers.cloudflare.com/images/optimization/features/).
- [ ] Не застосовувати bitmap pipeline до SVG/data/blob/невідомих/animated assets без визначеної підтримки. Не переписувати авторські picture/source/srcSet/sizes або Next Image loader вдруге. Окремо визначити CSS backgrounds; наявний `<img>` pass їх не оптимізує.
- [ ] URL candidates мають правдиві `w` descriptors. Наявний local Sharp pipeline використовує `withoutEnlargement`, але називає всі результати запитаною шириною; для малого оригіналу це може дати неправдиві 1280w/1920w. Потрібні manifest/actual dimensions, пропуск завеликих candidates або коректна зміна descriptors.
- [ ] `sizes` спочатку авторський, потім обґрунтований responsive layout hint. `50%` усередині container не дорівнює `50vw`; `width=1000` із `maxWidth=500` не означає слот 1000px. Врахувати breakpoints/grid/container або дати conservative fallback і user override.
- [ ] Зберегти width/height чи aspect-ratio для CLS, alt для доступності, eager/fetchPriority лише для визначеного LCP image; below-fold — lazy/async decode за підтримуваним source contract. Не lazy-load-ити hero автоматично.
- [ ] AST transform не дублює обчислення side-effectful src expression; піднімати обчислення в безпечний scope або пропускати unsupported shape. Alias imports і collisions helper names перевіряються.
- [ ] Helper source не дрейфує між shared, emitted `IMAGE_UTILS_TS`, root `lib/` та local server. Прибрати безумовне стирання custom/generated helper старою версією. Додати parity tests на виконання однакових fixtures у editor та emitted utility.
- [ ] Config UI валідовує числа/URL/template перед save, не скидає інші collection fields, показує реальний optimized preview/test URL без credential. Перевірити JSON round trip і збереження expressions під час wrapper sync.
- [ ] На export генерувати лише browser-safe config; CSP/CDN origins та cache versioning задокументувати. Замінений asset на тому самому ID не повинен безстроково лишатися старим у CDN.

Готовність: mobile завантажує правильний варіант, desktop має достатню якість, small original не має хибних descriptors, signed/private source не ламається і не розкриває секрет, local build та ZIP використовують той самий helper.

## 15. Етап J — валідація generated output і міграції

Пріоритет **P0/P1** за відповідним ризиком; виконується разом з етапами, не лише наприкінці.

- [ ] Після кожного pass output залишається валідним TSX/TS; зміни deterministic/idempotent. Невідомий AST shape не повертає успішний порожній сайт. Діагностика має file/node/query і причину пропуску.
- [ ] Додати oracle rules для source dialect нових attributes/config/expressions там, де є FileKind. Server wrappers та route handlers зараз не покриває звичайний oracle: потрібен окремий generated-server validator перед export/build, а не тільки нове правило для client pages.
- [ ] Перевіряти unresolved imports, client/server boundary, unsupported cache mode, конфлікт metadata exports, дублікати synthetic routes, недоступні runtime exports, leaked env values і malformed query definitions.
- [ ] Не спиратися на `next build` як на typecheck: обидва scaffold configs зараз мають `typescript.ignoreBuildErrors: true`. Для контрольних exported fixtures — окремий strict `tsc --noEmit` та production build/run.
- [ ] Версіонувати generated blocks/helper/config; оновлювати існуючі generated files при зміні connection/policy, навіть якщо файл уже існує. Наявне `if (!files[path]) emit` не мігрує старий endpoint.
- [ ] Зберегти sample rollback snapshot, початковий v1-compatible режим та перемикач rollout на рівні feature. При migration failure не лишати половину нового wrapper/data contract.

## 16. Матриця приймання

| Сценарій | Обов'язкова перевірка |
| --- | --- |
| Local CMS detail | Відомий URL має правильний item/SEO; невідомий не віддає перший запис; JSON update потребує rebuild |
| Dynamic SSR | Повторний request після CMS update читає актуальне джерело; серверний HTML уже містить дані |
| Hybrid build | Відомі top N routes prerender; валідний новий URL працює on demand; warm request використовує cache |
| Create/update webhook | Змінюються body, metadata, list, menu, sitemap та потрібні локалі за визначеною policy |
| Delete/unpublish | Item зникає з публічних datasets/sitemap; direct URL коректно not-found; stale cache не віддається поза policy |
| Rename slug | Новий URL валідний; старий проходить узгоджений redirect/404 contract, його cache invalidated |
| Multi-param/locale | Лише валідні tuples; правильні params, locale body, canonical/hreflang; немає Cartesian вибуху |
| Query relay | User не може розширити fields/visibility, обійти mandatory filters чи задати необмежений limit |
| Expressions | Всі 9 полів, fallback, missing data, parse round trip, blocked grammar, preview/server parity |
| Wrapper regeneration | SEO save → API config edit → locale sync → export не губить expressions/layout/datasets/cache policy |
| Reusable CMS component | Дані присутні у першому HTML; пізнє оновлення меню та URL працюють без rebuild |
| Pagination/races | Окремі lists/filters ізольовані; route change скасовує/ігнорує старий response; немає дубльованого load more |
| Images | String/object/dynamic src, upload/remote/signed/small input, custom sizes, breakpoint layout, real Content-Type/dimensions |
| Prefetch | Fixed/relative/late-data overlays, keyboard focus, opt-out, bounded traffic, cleanup, sandbox safety |
| Pipeline | Два exports та повторна preparation не змінюють семантику; project A config не потрапляє в branch/project B |
| Build paths | ZIP/local UI/persisted build проходять однаковий core; server не стирає helpers; cloud має окремий gate |
| Hosting | Static-only capability errors; single server ISR; multi-instance cache/CDN contract, якщо цей target заявлено |

Порядок перевірок: focused unit tests після зміни модуля → integration fixtures на межах parser/generator/export → `npx tsc --noEmit` → повний `npx vitest run` перед злиттям → production exported fixture strict typecheck/build/start → HTTP/browser/webhook сценарії. Не запускати всю suite після кожного checkbox без нової причини, але завершити required checks перед релізом.

Browser-тести виконувати на production build: `next dev` не доводить prefetch/ISR поведінку. Для SEO використовувати також запити без JS і crawler UA. Для caches перевіряти окремо browser cache, client query state, Router Cache, server cache і CDN.

## 17. Вимірювання результату

Мета — вимірюване покращення без зміни дизайну та контентних регресій. Спершу baseline, потім числові бюджети для конкретного fixture/hosting.

- Початковий перегляд: TTFB, LCP і його resource/render delay, CLS, JS/data/image transfer bytes, hydration errors. План v2 доповнює, а не замінює загальний `nextjs-site-performance-plan-v2.md` щодо Appear, fonts, heavy widgets та client bundle.
- Навігація: click → початок feedback → завершення корисного контенту, cold/warm route, cache hit rate, speculative bytes, server/CMS request count. П'ять лабораторних повторів із медіаною та розкидом на зафіксованих CPU/network settings.
- CMS freshness: commit→webhook acknowledgment, next-request freshness, час оновлення відкритого меню, кількість retries/errors. Не змішувати швидкість endpoint з часом регенерації.
- Prerender: discovered/selected/skipped routes, причина пропуску, API calls, build duration і peak memory. Контролювати 1k+ records та multi-param cardinality.
- Media: source/candidate bytes, actual width/format, CDN hit/miss, transform errors, visual crop/quality на mobile/desktop.

RUM за потреби — opt-in із route/device aggregates, без форм, credentials і приватного контенту. Не додавати аналітичний запит на кожен prefetch чи повторний render.

## 18. Послідовність поставки та межі першого релізу

1. **A → B**: чистий build context, policy режимів, provider/data/error contract та public relay. Це фундамент.
2. **C → D → E**: безпечні формули, збереження при регенераціях, правильні metadata/404/locales.
3. **F → G**: bounded prerender, server invalidation, live reusable components та browser freshness.
4. **I** можна розробляти після A/B окремо, але перевіряти разом із CMS wrappers/export. Спочатку public Directus, потім Cloudflare/custom/private media adapters.
5. **H** після data/cache correctness і baseline. **J** та матриця приймання супроводжують кожну поставку.

Перший реліз: Dynamic SSR + Hybrid ISR на server-capable Next 16 target, 9 SEO-полів, public CMS query contract, підтримувані detail/multi-param routes, local CMS snapshot compatibility, базова Directus image optimization. Окремі наступні поставки: JSON-LD, push-to-browser updates, новий static-only backend, Cache Components, складні custom/private media engines і hosting adapters, які не підтверджені fixtures.

Перед cloud rollout потрібні доступ до backend pipeline та підтвердження, що він використовує ці manifest/policy/helper versions. Локальний успіх не є доказом cloud готовності.

Коміти робити за завершеними поведінковими змінами з відповідними тестами. Порожній «release complete» commit із v1 не потрібен. Завершення плану означає виконані acceptance checks та зафіксовані обмеження, а не тільки наявність коду або зелені string assertions.
