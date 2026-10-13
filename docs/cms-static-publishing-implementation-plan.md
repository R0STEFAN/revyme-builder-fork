# Реалізація статичних CMS-сайтів Revyme: GitHub, пагінація та публікація

Дата: 12 жовтня 2026 року. Статус: план реалізації, код функціональності ще не змінено.

## 1. Очікувана поведінка простими словами

Колекції та шаблони сторінок зберігаються в GitHub. Після зміни сервер отримує webhook, забирає конкретну версію проєкту, створює готові сторінки й публікує їх. Відвідувач отримує готову сторінку каталогу або конкретного запису.

Якщо в каталозі ввімкнено «Load More» або нескінченний скрол, готова сторінка містить першу порцію. Наступні порції також підготовлені під час публікації: браузер завантажує їх як статичні файли. Сервер не звертається до CMS і не виконує пошук у колекції для кожного такого кліку.

На сторінку одного запису передаються його поля, необхідні сусідні посилання та потрібні дані додаткових списків. Решта колекції лишається поза початковим завантаженням браузера.

Пошук користувача працює по всіх доступних записах, навіть якщо вони ще не показані. Для цього при першій потребі завантажується спеціальний індекс із полями для пошуку/фільтрації; картки результатів підвантажуються окремо. Довільні пошукові запити не потребують створення окремої HTML-сторінки на сервері.

Нову версію включають лише після перевірки. Якщо збірка не вдалася, старий сайт продовжує працювати.

```mermaid
flowchart LR
    A[Зміна колекції у GitHub] --> B[Webhook і черга]
    B --> C[Знімок конкретного commit]
    C --> D[Підготовка сторінок і порцій CMS]
    D --> E[Next.js: готовий HTML для всіх адрес]
    E --> F[Перевірка нової версії]
    F --> G[Перемикання сайту й оновлення кешу]
    G --> H[Відвідувачі отримують готовий сайт]
```

## 2. Перевірений стан кодової бази

План спирається на поточні генератори та тести цього checkout. Під час цього аудиту пройшли **206 тестів у 9 файлах**: CMS generation, pagination, responsive lists, search field, localization, pages, SEO, locale routes і source export. Це перевірка наявної логіки, а не перевірка ще не реалізованої архітектури.

| Механізм | Поточна реалізація | Вимога до нової реалізації |
| --- | --- | --- |
| Detail | `cms-page-ops.ts`: `useParams()` + import колекції + `.find(...) ?? collection[0]` | Server selection, мінімальні props, справжній 404 |
| Index | Звичайна page pair із `.map()`; `@cmsPage kind:index` не обов'язковий і поточний scaffold його не ставить | Знаходити всі CMS-списки через AST/imports, не лише annotation |
| Detail SEO | `cms-seo.ts`: `generateMetadata`, той самий JSON; немає `generateStaticParams` | Єдиний resolver для body, SEO та переліку routes |
| Load More | `cms-pagination-gen.ts`: `useState(perPage)` → `.slice(0, visibleCount)` | Та сама зовнішня поведінка, але наступні rows надходять із chunks |
| Infinite Scroll | `IntersectionObserver` збільшує visibleCount; sentinel зі Spinner | Observer запускає контрольоване підвантаження, має loading/error/end стани |
| Pagination marker | `data-pagination="loadMore:N"` / `"infinite:N"` | Зберегти source contract і прив'язку UI до конкретного списку |
| Limit / Offset | `buildChainCode`: без pagination — `.slice(offset, offset+limit)`; з pagination limit/offset ігноруються | Зберегти пріоритети та не трактувати limit як page size |
| Filters | AND/OR, static/searchField/dateField/routeParam; deep relations | Використовувати всю групу predicates в правильному порядку |
| Sort | Кілька ключів, tie → наступний ключ; original order за рівних ключів | Детермінований порядок, однаковий у compile і runtime |
| Responsive lists | `cms-responsive-gen.ts`: base → viewport → variant, partial overrides | Окремі query plans для ефективних конфігурацій |
| Localization | `localizeRows`: `_i18n[locale]` поверх base, пустий string не замінює base | Localize до filter/sort, зберегти fallback semantics |
| CMS navigation | `map-gen.ts`: self/row/prev/next; prev/next шукають у всій колекції | Обчислити URLs наперед і прибрати цей browser import |
| Root CMS | `cms-root-mount.ts`: одна колекція може займати `app/[slug]` | Врахувати static routes, locale prefixes, root collisions |
| Locale routes | `locale-route-ops.ts`: wrappers переекспортують лише default | Генерувати locale-aware params, body, SEO і route config |
| Схема | `_id`, `_slug`, `_status`, `_layout`, `_publishAt`, `_i18n`; reference/multi-reference | Validation та publication policy до створення artifacts |
| Export/local build | `prepareSiteFiles` викликається для browser export та local UI build | Єдиний versioned compiler, який доступний і без редактора |
| GitHub workflow | `.github/workflows/deploy.yml` публікує Vite-білдер | Новий site webhook/job; це інший pipeline |

Cloud backend і окремий source repository runtime у цьому checkout відсутні. Їхні integration points треба додати у відповідних репозиторіях. Не припускати, що поточний cloud publish уже використовує новий compiler або що наявний workflow перебудовує сайти користувачів.

## 3. Рішення, які зафіксувати до реалізації

1. **Режим першої версії:** snapshot CMS, усі підтримувані CMS routes готуються під час публікації; довільний запит відвідувача не створює новий CMS route. ISR/live CMS — окремий майбутній режим.
2. **Хостинг першої версії:** Next.js production server із prerendered routes і статичними CMS chunks. Глобальний `output:'export'` не вмикається. Повністю файловий хостинг — другий target після compatibility audit.
3. **Пагінація:** наявні `loadMore` та `infinite` зберігаються. Нумерованої пагінації зараз немає; вона не є умовою першої версії і не додається приховано.
4. **Оптимізація даних:** detail — один запис; list — лише необхідні rows і поля. Пошук — окремий lazy index. Зменшення browser data не вважати автоматичним наслідком SSG.
5. **Джерело:** конкретний Git commit із source/templates/schema/data. Усі записи одного release походять із цього snapshot. Жодного читання «найновішої CMS» посеред збірки.
6. **Редактор:** canonical JSX залишається редагованим у поточному форматі. Production transform виконується на копії, не переписує ProjectFS і не повертає artifacts у Git.
7. **Оновлення:** спочатку повна логічна публікація snapshot. Точкові rebuilds — після dependency tracking; Next build cache не вважати гарантією перебудови лише змінених сторінок.
8. **Сумісність:** режими `legacy` і `static-cms-v1`. У strict static mode непідтримуваний route блокує новий release з конкретною причиною. Перехід на SSR/whole-collection browser payload не має відбуватися мовчки.

Повний список params дозволяє prerender CMS detail; `dynamicParams:false` обмежує доступ адресами snapshot. Це впроваджувати для зафіксованої версії Next, з перевіркою route manifests. [Next generateStaticParams](https://nextjs.org/docs/app/api-reference/functions/generate-static-params).

## 4. Архітектура compiler і artifacts

### 4.1. Спільна pure-бібліотека

Пропоноване нове місце — `src/code/publishing/` з pure analysis/compile модулями. Назви нижче — майбутні модулі, не наявні API.

| Модуль | Відповідальність |
| --- | --- |
| `cms-source-analysis.ts` | Imports, scope/bindings, detail context, lists, dependencies, unsupported constructs |
| `cms-snapshot.ts` | Schema/data validation, publication state, stable identities |
| `cms-route-plan.ts` | Route groups, static/dynamic segments, locale, route collisions, param domains |
| `cms-query-plan.ts` | Фільтри, sort, pagination, viewport/variant/default values, залежності від relations |
| `cms-projection.ts` | Поля, потрібні body/SEO/filter/sort/navigation/code components |
| `cms-static-data.ts` | Bootstrap, ordered chunks, query indices, projected record buckets |
| `cms-page-transform.ts` | Production AST rewrite сторінок і залежних components/templates |
| `cms-build-report.ts` | Expected URLs, modes, omitted fields, payload sizes, unsupported reasons |

Pure compiler не імпортує editor atoms, ProjectFS, DOM або browser trace transport. Input — immutable files + explicit config; output — artifacts + diagnostics. Existing helpers з browser imports не переносити в CLI без відділення pure частини.

Snapshot validation і Node filesystem/media/job orchestration — окремі adapters. Compile tests використовують synthetic projects без сервера.

Серверний compiler не повинен викликати `localizeRows` через поточний client-marked root entry `@revyme/runtime`. Виділити pure helper у server-safe subpath/спільну pure бібліотеку та перевірити Next production import; наявність функції в пакеті не робить root entry придатним для Server Components.

### 4.2. Compiler повинен запускатися на сервері після Git-змін

Недостатньо виконати transform один раз під час експорту: наступний commit із новими CMS даними зробить artifacts застарілими.

Пакувати pure compiler і CLI у версіонований інструмент для exported site. Конкретний спосіб поставки — pinned package або bundled CLI зі scaffold — зафіксувати в першому PR. API має дозволяти `prepare-site` перед `next build`; не покладатися на відкриту вкладку редактора, Vite aliases чи root `node_modules` білдера.

`package.json`, compiler/runtime/Next versions і lockfile є частиною source release contract. `latest` та різні випадково встановлені версії на editor/server прибрати для цього режиму. Існуючий source export зберігає custom package/config, тому додавання build hook для таких проєктів має бути явною, ідемпотентною міграцією.

Єдина послідовність: source snapshot → наявні сумісні prepare transforms → CMS compiler → generated site directory → Next build. Compile artifact не використовується як canonical input наступного commit. Зберегти повторюваність та не подвоювати transformations шрифтів/overlays.

### 4.3. Три різні набори даних

- **Server-only snapshot:** повні опубліковані дані, schema і indexes для compile/SEO. Ніколи не копіюються цілком у `public` і не імпортуються reachable client module.
- **Bootstrap конкретного route/layout:** перший набір cards, detail item, counts, query descriptors, nav URLs, release ID. Входить у prerendered HTML/RSC props.
- **Public continuation files:** лише опубліковані projected rows/chunks і потрібний query index; immutable URLs містять release/content version.

Копія whole JSON у public «для зручності» зруйнує і економію, і publication filtering. Lazy search index також публічний: у ньому не повинно бути draft/private fields.

Приклад URL для static assets: `/cms-data/<release-id>/<view-id>/<locale>/<query-hash>/chunk-0002.<content-hash>.json`. Це proposal, який треба узгодити з basePath/hosting adapter; root `_revyme/` metadata не використовувати як public artifact path.

## 5. Validation та правила публікації колекції

### 5.1. Дані, редаговані напряму в GitHub

Перевіряти JSON structure, відповідність schema, типи, required fields, dates, `_id`, `_slug`, references і `_i18n`. Не покладатися на `cms-ops.addCollectionItem`, який нормалізує записи тільки в редакторі.

Duplicate `_id` або slug у одному route domain — build error із collection/file/record. Не додавати suffix під час compile: адреси між релізами стали б непередбачуваними. Legacy rows без identity мігрувати в source явним migration tool; не генерувати random ID на кожній збірці.

Slug визначає URL, `_id` — стабільну identity. Підтримати Unicode/URL encoding без подвійного decode, відхилити traversal, slash у single segment, порожні/reserved paths. Перевірити case/Unicode normalization collisions за обраною URL policy, не змінювати існуючі адреси мовчки.

Schema change також запускає повну підготовку: field rename/delete може впливати на body, sort/filter, relation, search і SEO. Невідома прив'язка отримує diagnostic із місцем у source; missing required runtime field — error, optional field — узгоджений fallback.

### 5.2. Published/draft/scheduled

Snapshot береться з явним `publicationCutoff` у UTC. У public artifacts входять `_status:'published'` і записи, для яких `_publishAt` відсутній або настав. Invalid status/date не трактувати як автоматично published. Для legacy записів без `_status` потрібна окрема документована compatibility policy та migration report.

Однаковий доступний набір використовувати для detail routes, lists, counts, search index, relations, prev/next і sitemap. Draft не може лишитися в lazy index або кнопці Next після того, як його прибрали з HTML.

В поточній моделі поля publication є, але читання generated `.map()`/`.find()` саме по собі не забезпечує їх фільтрацію. Це нова explicit production policy з перевіркою впливу на старі проєкти; preview редактора може показувати drafts.

Запланована дата не створює Git push. Для автоматичної появи потрібен delayed publish job на найближчий `_publishAt`; інакше запис з'явиться лише після наступної ручної публікації/commit. Job повторно перевіряє актуальний snapshot і не включає стару видалену schedule. `releaseId` враховує cutoff/видимий content hash, а не лише commit SHA.

### 5.3. Relations

Використовувати `referenceCollection` зі schema, а inference names із поточних generators — лише versioned legacy fallback. Окремі tests мають фіксувати поточні ID/slug/object/string comparisons.

Виявляти cycles/depth, missing targets і посилання на draft. Не розгортати всю пов'язану колекцію; включати потрібні relation fields або готові href/labels. Список, що фільтрується по relation, потребує query dependency навіть тоді, коли relation не показана у картці.

## 6. Побудова route manifest

Сканувати реальні app routes, templates і imports; не виводити URL з назви колекції. Detail може бути в route group, під іншим prefix, у root `[slug]` або в localized wrapper. Generated CMS index може бути звичайною сторінкою без `@cmsPage`.

Для кожної адреси зберігати `routeId`, file path, URL pattern, dynamic parameter names, locale, template chain, CMS owner, expected record ID, source dependencies. Static literal routes мають пріоритет над root dynamic route, але конфлікт CMS slug із ними report-ити як недоступний запис/помилку strict mode.

Для `[slug]` domain — усі валідні доступні slugs відповідної колекції. Для `[category]/[place]` потрібне явне зіставлення параметрів зі schema/relations або generated route bindings; генерувати лише реальні tuple combinations. Не будувати Cartesian product усіх категорій і places.

Невідомий param, catch-all або custom route без finite domain позначати unsupported. Автор може надати route-param mapping у build config; ручний SSR режим — explicit opt-out із strict-static target, а не silent fallback.

Manifest має включати порожню колекцію, locale collisions, root reserved names, moved templates і кілька CMS-списків на route. Встановити ліміти routes × locales × query variants і пояснювати перевищення, не обрізати контент.

Поле `_layout` не означає, що compiler може самостійно вибрати будь-який template для запису. Перевірити його фактичний контракт у source/preview; використовувати лише наявне або явно додане mapping record → layout. Unknown layout і зміна template chain потребують diagnostic та tests.

### 6.1. Генерований server wrapper detail

Для зафіксованої Next 16.2.x поведінки створювати:

```tsx
export const dynamicParams = false;

export function generateStaticParams() {
  return routeSnapshot.params;
}

export async function generateMetadata({ params }) {
  const resolved = await params;
  return metadataForRoute(resolved);
}

export default async function Page({ params }) {
  const resolved = await params;
  const bootstrap = cmsBootstrapForRoute(resolved);
  if (!bootstrap) notFound();
  return <PageClient cmsBootstrap={bootstrap} />;
}
```

Це схема нового API; resolvers мають бути server-only, без runtime network fetch або поточного часу. Додатково strict route guard (`dynamic:'error'` за сумісної Next config) і перевірка output не дозволяють непомітно перейти на request-time rendering. Не використовувати `force-static` для маскування несумісних `cookies/headers/searchParams`.

`generateStaticParams` достатньо лише для відомих routes зі статичними dependencies; request-dependent layout теж перевіряється. Порожня колекція не повинна генерувати fake record або падати через `.find() ?? rows[0]`; реальні requests мають повертати 404. Окремий fixture перевіряє empty params саме на pinned Next config.

## 7. Мінімальні detail-дані та AST rewrite

Визначити всі reads поточного item: текст, attributes, styles, props, richtext, conditional rendering, expressions і computed href. Додати identity/route fields, використані навігацією. SEO-only поля залишаються на server side.

Згенерувати `PageClient({cmsBootstrap})`, де `item` береться з bootstrap. `useParams` залишити лише там, де він ще потрібен іншим expressions; використовувати serialized resolved params для compileable route filters. Видаляти CMS import тільки після аналізу всіх його uses у module/import graph.

`item[fieldName]`, spreading item у custom component або виклик невідомої функції може потребувати всіх **полів одного запису**. Це допустимий projection fallback із report; він не дає дозволу передавати всю колекцію. Якщо custom code реально читає довільні інші записи, класифікувати його окремо.

Пошук `.find` замінювати за Babel scope/binding, не за назвою `item`: nested map і related list мають свої записи. Не змінювати markup, стилі, order, data-id, motions, refs і interaction handlers.

### 7.1. Self, row, prev/next

Поточний `cmsNavHrefExpr` створює prev/next через collection `.findIndex`. Compiler обчислює сусідні URLs у snapshot по опублікованому collection order і передає `nav.self/prev/next`.

Перевірити boundary behavior: зараз відсутній сусід веде на collection root. Зберегти цей default або явно мігрувати на disabled link; не змінювати поведінку приховано. Для root-mounted collection boundary веде до site root. Locale prefix і реальний route mapping застосовуються до всіх URLs.

Row links у lazy chunks отримують canonical detail href. Related-list navigation order не підміняє detail prev/next order. Зміна order/публікації сусіда інвалідує відповідні nav artifacts.

## 8. Єдина модель query: filters, sort, locale та slicing

Порядок обчислень:

1. Вибрати доступні для production записи snapshot.
2. Застосувати CMS field localization з поточними fallback rules.
3. Визначити effective config: base → viewport partial override → variant partial override.
4. Підставити відомі route params і значення dynamic variables.
5. Застосувати всю AND/OR filter group.
6. Стабільно відсортувати за всіма sort keys.
7. Застосувати наявну limit/offset або pagination semantics.
8. Вибрати projected fields і сформувати bootstrap/chunks.

Sort має працювати на копії array. За рівних ключів зберігати source order/ordinal; stable ID використовується для dedupe, а не як новий tie-breaker, який змінить поточний дизайн.

Поточні inline predicates, responsive interpreter і canvas evaluator мають різні гілки, зокрема для coercion та deep relations. Перед оптимізацією створити semantic conformance fixtures. Перевага — відділити shared pure evaluator для compile/runtime/canvas; не виправляти неоднозначні semantics одночасно з pagination transport без versioned migration.

Date-only comparisons зберігають календарний `YYYY-MM-DD`, number/null/empty та case handling — поточний задокументований dialect. Expressions поза дозволеною AST grammar не запускати через `eval` у webhook worker; або лишати legacy, або повідомляти unsupported strict compile.

## 9. Реалізація наявної пагінації

### 9.1. Без пагінації, Limit та Start Offset

Якщо автор показує весь список, HTML містить весь обраний список. Compiler не додає pagination самостійно. Якщо задано `offset=5`, `limit=10`, потрібні записи 5…14 після localization/filter/sort; це одна статична selection.

`limit=0`/відсутній limit у поточному chain не означає порожній список. Offset без limit пропускає початок і показує решту. З pagination numeric limit/offset зараз ігноруються; зберегти це і показувати report, щоб приховане старе значення не стало новим cap.

Точна проєкція може лишити великий payload, якщо шаблон картки показує всі richtext fields. Compiler має виміряти та пояснити це, не видаляти author content.

### 9.2. Load More

Для `data-pagination="loadMore:20"` і 53 matching records підготувати bootstrap із 20 rows, chunk 2 із 20, chunk 3 із 13. У bootstrap — `total=53`, `loadedCount=20`, continuation descriptor.

Зберегти existing `LoadMore` master, його styles, label, variants, cursor та event prop. Production transform замінює generated increment-handler на `loadNext()`. Custom additional handler треба compose/зберегти; якщо він неможливий для безпечного rewrite — diagnostic.

Послідовність runtime: idle → loading → append verified rows → idle/end. Під час loading повторний click не стартує інший page request. Visible count збільшується тільки після успішного fetch. Error лишає вже показані rows, дає retry тієї самої порції; не ховає кнопку як при end.

`hasMore` залежить від matching count і continuation цього query, не raw collection length. Остання неповна порція, 0/1/N/2N records, source change і edited perPage мають окремі tests. Production server не обчислює наступну порцію на цей click: chunk уже існує.

Після завантаження перевіряти HTTP status, JSON/schema, release/query IDs, очікувану порцію та row identities. HTML error response не перетворювати на empty/end. Додати timeout/AbortController; cache chunk за versioned URL, dedupe concurrent reads, не prefetch-ити всі порції. У `map((item, idx) => ...)` idx відповідає повному visible array, а не локальному індексу окремого bucket; author keys і animation staggering зберігаються.

`perPage` має бути додатним цілим. Поточний числовий input може прийняти більше за 100, хоча plus/minus має max=100; max UI не вважати абсолютним наявним обмеженням source. Production safety limit задається explicit config і повертає diagnostic, не обрізає число мовчки.

### 9.3. Infinite Scroll

Той самий transport/state machine, trigger — observer sentinel. Не створювати другий pagination engine. Existing Spinner залишається; його видимість має залежати від фактичного loading, а не від вічного `hasMore`.

Вимоги: один active request; observer cleanup на unmount/query change; reobserve після append; коротка перша порція може потребувати послідовних loads, поки sentinel лишається видимим; не запускати fetch-loop після error або end. Hidden variant copy не повинна підвантажувати rows.

Помилка показує доступний Retry/Load More fallback. Keyboard/screen-reader користувач має мати спосіб отримати наступну порцію; scroll position і focus зберігаються. Virtualization не вводити в першому релізі, бо вона змінює DOM і поведінку анімацій.

### 9.4. Кілька списків, компоненти та інстанси

Bootstrap/chunk descriptor ключувати за file + list node + component instance scope + route params + locale + query config + release. `data-id` одного master недостатньо: два instances можуть показувати різні дані.

Кожен список має незалежні counts/loading/query generation. Shared cached chunk можна reuse для однакового view, але click в одному списку не збільшує visibleCount іншого. Copy/paste, Make Component і move не повинні переносити чужий continuation key.

### 9.5. Зміна запиту

Повний query key включає filters, sort, locale, variant, viewport bucket, route context, dynamic values і release. Після зміни запиту старий request скасовується або його результат ігнорується за generation token. Append із попереднього query заборонений.

Для optimized mode зафіксувати policy reset до першої порції після зміни filter/search/locale/variant. Це поведінкова зміна від plain visibleCount; тестувати й позначити versioned mode. Альтернативне збереження кількості доступне тільки як явно підтримувана policy з refetch/clamp, не як випадковий наслідок старого state.

## 10. Пошук і динамічні фільтри без runtime CMS API

### 10.1. Статичні та змінні умови

Static filter/route params із finite domain обчислюються під час compile. SearchField, dateField і page variables, які змінюються від користувача, мають runtime query path по підготовлених даних.

Для AND можна звузити candidate set доведеними static conditions. Для OR не можна просто відфільтрувати candidates статичною частиною: запис може відповідати лише dynamic branch. Використовувати гарантований superset для всіх можливих значень або залишати весь опублікований domain у query index. Порожній search у поточному generator може робити predicate true — це також впливає на OR.

### 10.2. Два рівні static data

- **Query index:** stable ID/source ordinal + точні dependencies filter/sort/search/relations. Завантажується при взаємодії або активному URL query.
- **Projected rows:** fields для render карток, розкладені в immutable buckets; ID → bucket mapping дозволяє завантажити лише buckets із першою порцією результатів.

Runtime обчислює ordered matching IDs по всьому query domain, бере N IDs, завантажує необхідні buckets, відновлює правильний порядок і показує rows. Подальший Load More/Infinite працює по тому самому result ID set. Пошук не обмежується вже завантаженими картками й не обчислюється після `.slice`.

Звичайний static query може читати послідовні page chunks і обходитися без whole-domain index. Не додавати query index до initial props усім спискам.

### 10.3. Точність пошуку

Поточні deep/array predicates іноді перевіряють `JSON.stringify` relation/object. Якщо для еквівалентної поведінки потрібні додаткові поля, index має містити ці semantics-preserving search values. Не замінювати такий пошук лише `title` і не claim-ити довільний індекс завжди маленьким.

Для великих індексів застосовувати debounce, відкладений import, budget report і за потреби Worker. Якщо довільний substring search потребує багато тексту, цей текст доведеться передати браузеру після пошуку; повністю статична схема не усуває цю потребу. Remote search service — окремий explicit режим, поза першим static release.

Query dependencies не завжди display dependencies: приховане в картці поле може бути потрібне фільтру. Projection видаляє лише доведено невикористані поля. Schema-defined непублічні поля не повинні ставати searchable без explicit policy.

### 10.4. URL query та history

Search Field зберігає `queryParam` у page variable config. План не припускає, що вся URL ↔ state синхронізація вже гарантована поточним generator: перевірити її та покрити tests.

Статичний HTML показує default query. Після hydration runtime читає URL і завантажує відповідний index/result pages. Зберегти інші query params, back/forward, clear search, кілька inputs і shareable URL. Значення з URL проходять type normalization; вони не є filesystem paths.

Не читати довільний `searchParams` на server page для такого режиму, бо це робить результат request-dependent. Якщо використовується Next `useSearchParams`, ізолювати його у вузькому Suspense boundary; не ховати весь initial list за loader. [Next useSearchParams](https://nextjs.org/docs/app/api-reference/functions/use-search-params).

## 11. Responsive lists, variants і templates

Для finite viewport/variant configs підготувати descriptor кожного distinct effective query; identical queries дедуплікувати. Зміна ширини в межах bucket не створює новий query. Runtime merge має зберегти inheritance: override filter не видаляє sort.

Сервер не знає точну ширину екрана користувача. Для першої версії bootstrap містить default/base query, і перший client render використовує той самий bootstrap. Після hydration обрати effective query і замінити rows. Не відтворювати initializer, який одразу бере `window.innerWidth` і створює інше дерево на першій client-render фазі.

Якщо mobile query радикально відрізняється, document/report має показувати pre-hydration limitation. Наступний рівень — pre-rendered CSS-selected copies тільки first portions із строгим контролем дублювання, як у variant SSR. Не використовувати mobile UA detection/CDN vary без окремої архітектури та перевірки кешу.

Variants можуть змінюватися по hover/click; query plan мусить охопити всі скінченні підтримані variants. Приховані SSR copies не запускають queries/observers. Existing animation/layout refs мають залишитися на тих самих DOM roots.

Проаналізувати весь page/template import graph. Global header/footer може мати власні CMS lists; він не повинен лишитися з whole JSON import після оптимізації page body.

Generated server layout передає bootstrap своєму LayoutClient; page entry передає власний page bootstrap. Спільний runtime data context/props adapter може merge-ити scoped дані без зміни DOM. Root layout не отримує автоматично dynamic params нижчих сегментів: route-dependent template list потребує adapter на сегменті, де params доступні, або explicit unsupported report до такої підтримки. Не отримувати pathname через request headers лише заради compiler.

Nested CMS lists, related items, slots/code overrides і повторно використані masters потребують scope-aware projections. Field use передається через props; невідомий custom component отримує консервативну projection або блокування оптимізації конкретної залежності.

## 12. Локалізовані routes та metadata

Будувати snapshot views для default locale без prefix і кожної фізичної locale route. У generated wrappers explicit locale передається server resolvers; не покладатися на client `usePathname` для server projection.

`localizeRows` зараз накладає непорожні string translations поверх base. Спочатку зберегти саме цю поведінку; chained locale fallback або переклад чисел/slug не вводити випадково. Після localization застосовуються filters/sort — результати й порядок різних мов можуть відрізнятися.

Не передавати всі `_i18n` у initial item/list props. Для client-only locale switch на unprefixed URL потрібні locale-specific continuation/record files або переведення на існуючі locale routes за explicit migration. Перемикання контексту без заміни rows дало б стару мову на новому URL.

Для localized detail створити wrappers із власними `generateStaticParams`, `dynamicParams:false`, default page і `generateMetadata`, або безпечно re-export-ити locale-bound helpers. Поточний `export {default}` не переносить решту named exports. Не експортувати одночасно `metadata` та `generateMetadata`.

Body і metadata отримують один і той самий запис/locale/publication policy. Зберегти fallback SEO, canonical, OpenGraph, Twitter, robots і locale alternates. Sitemap містить тільки доступні detail URLs і реально підтримані SEO pagination paths. Вимоги до повного Twitter metadata API перевірити на pinned Next types.

Під час SSG перевіряти Providers/theme/navigation: locale loader і `lang/dir` мають зберігати prerender і однаковий hydration output. Client localStorage preference не підміняє URL-prefixed locale.

## 13. SEO для Load More та Infinite

У first HTML є перша порція, всі detail URLs присутні в sitemap. Наступні chunks JSON самі по собі не є HTML-сторінками для пошукового індексу.

Якщо потрібно, щоб усі сторінки списку мали доступні crawler URLs, додати **окремий opt-in SEO pagination режим**: наприклад `/blog/page/2`, `/blog/page/3`, із готовими HTML-порціями й звичайними anchor links. Load More/Infinite UI при цьому може залишитися.

Не створювати numbered pagination, яку автор не вмикав, у звичайному першому релізі. Для нового режиму перевірити конфлікт `/blog/[slug]` зі slug `page`, locale paths, page 1 alias, canonical кожної порції та last page 404. Не canonical-ити всі порції на першу автоматично.

Для кількох lists на одній page не будувати Cartesian product їхніх номерів. Explicit SEO owner list або незалежні route mappings — частина opt-in config. Arbitrary search queries не створюють мільйони sitemap URLs.

## 14. Webhook, GitHub та черга публікації

Новий deployment service/adapter приймає push лише для налаштованого repository ID і deploy ref. Repository → site mapping задається серверною конфігурацією, не довільним URL payload.

Перевіряти HMAC SHA-256 підпис `X-Hub-Signature-256` по raw body до JSON parsing, event/ref та delivery ID. Поставити job у durable queue й повернути 2xx швидко; сам build не виконується в HTTP handler. [GitHub signature validation](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries), [Webhook delivery practices](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks).

Job містить site/repository/ref/commit SHA, compiler version, trigger, cutoff, sequence і idempotency key. Повторна delivery не створює паралельний release, але failed delivery/job можна явно повторити. Durable states: received → queued → preparing → building → validating → activating → cache-refresh → live/failed/superseded.

Checkout саме потрібного commit у новому release workspace; не `git pull` у директорії live процесу. Один active publisher на site. Для швидких A/B/C pushes можна згорнути queued jobs до останнього бажаного ref state; старий job, що закінчився пізніше, не має перезаписати новіший live. Перевіряти publish sequence/current desired commit перед activation; force-push не визначати простим порівнянням SHA або timestamp.

Editor publish і webhook використовують одну чергу/locking policy. Окремо визначити source of truth: для Git-managed mode production збирається з committed Git snapshot; unsaved editor зміни не підмішуються. Git commit автора і builder-push не повинні взаємно запускати нескінченний autosync loop.

Changed-files filtering — оптимізація після правильності: data, schema, templates, code components, locale dictionaries/config, assets, runtime/Next lockfile і build config можуть впливати на release. Не пропускати rebuild лише тому, що `cms/*.json` не змінився.

External CMS/import/plugin sync за цією схемою має спочатку створити той самий versioned Git snapshot або інший explicit immutable snapshot; build не змішує Git data з рухомою зовнішньою колекцією.

Credentials для Git/Cloudflare живуть у deployment service, не у client/public artifacts. Site builds запускаються як jobs без доступу до секретів інших сайтів; source code/package hooks виконують код, тому isolation і limits є частиною multi-site worker.

## 15. Worker, перевірка статичності та готовності release

1. Підготувати workspace конкретного snapshot і встановити pinned dependencies із lockfile.
2. Прочитати/validate data + source, зібрати route/query dependency plans.
3. Застосувати compiler на копії; створити bootstrap/chunks/indices та build report.
4. Запустити реальний production Next build із потрібним environment.
5. Зіставити expected route manifest з actual prerender output. Статичність перевіряти по результату, не лише наявності `generateStaticParams` у source.
6. Запустити candidate release на internal адресу/порту; перевірити routes, links, HTML, metadata, chunk loading і 404.
7. Перевірити reachable browser bundles/RSC props: немає full raw collection/all-locale `_i18n`, якщо їх не потребує explicit legacy dependency. AST audit доповнюється byte/content assertions на контрольних fixtures.
8. Активувати release лише після checks; trace/report прив'язати до release ID і commit.

Звітувати окремо: optimized CMS routes, legacy/unsupported routes, кількість опублікованих записів, prerender URLs, query plans/chunks, initial/lazy bytes, missing dependencies. Якщо strict snapshot-static route лишився dynamic, job failed із причиною.

Не ігнорувати type errors нових generated modules через існуючий `ignoreBuildErrors:true`. Compiler-owned output проходить окремий typecheck; compatibility findings handwritten source класифікуються явно. Publish oracle/SSR preflight також потрібний у headless worker, бо webhook обходить editor publish button.

## 16. Атомарна активація, Cloudflare та старі сесії

Candidate build і live process/artifacts мають різні каталоги. Поточний `LocalServerManager` пише у той самий target і видаляє `.next`; його не використовувати як production rolling publisher без release isolation. Це вимога безперервності сайту, не оптимізація швидкості build.

Спочатку зробити доступними hashed assets/chunks нового release, потім переключити origin traffic/pointer, після цього очищати HTML/RSC cache. Не видаляти старі static chunks відразу: відкрита вкладка старої версії продовжує Load More з її release ID.

`releaseId`/asset namespace включає content, cutoff, compiler/runtime/build config і deploy generation. Commit SHA окремо записується в report. Rollback повертає той самий snapshot/artifacts і повторно оновлює mutable route cache.

Version key обчислювати зі snapshot inputs до вставки власних URLs, щоб уникнути self-referential hash. Кожен manifest/chunk містить contract version, і runtime відхиляє несумісний descriptor. Mutable «latest manifest» не використовувати як continuation старої вкладки.

Cloudflare default не кешує HTML; caching rules для публічних CMS routes налаштовуються окремо. Next HTML і RSC navigation responses мають різні cache identities; не змішувати їх і не видаляти `_rsc`/важливі cache inputs. [Cloudflare default cache](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/), [Next CDN caching](https://nextjs.org/docs/app/guides/cdn-caching), [Cloudflare Next variants](https://developers.cloudflare.com/cache/advanced-configuration/serve-tailored-content/).

Immutable versioned CMS files/JS/CSS/fonts/images — довгий cache. HTML і route navigation — policy з explicit invalidation/TTL. Query chunks залежать від locale/query/release і не потребують invalidation при появі іншого release.

Purge plan включає added/changed/deleted URLs, index/list routes, prev/next neighbours, locale versions, metadata/OG/sitemap та потрібні HTML/RSC cache variants. Зміна filter/sort/publication може пересунути записи між усіма порціями списку; invalidation не обмежується URL зміненого detail.

Cloudflare purge failure після activation — окремий статус із retry і bounded stale TTL. Успішний Next build не дорівнює успішному cache refresh. За custom cache key purge має враховувати його варіанти. [Cloudflare purge-by-file](https://developers.cloudflare.com/cache/how-to/purge-cache/purge-by-single-file/).

Для Next navigation між релізами перевірити deployment/version-skew handling і зберігати старі hashed assets. Повне reload може бути потрібним, якщо client префетчив old navigation payload. [Next self-hosting](https://nextjs.org/docs/app/guides/self-hosting).

## 17. Зміни, видалення, slug та порожні колекції

| Зміна | Що перевірити/перегенерувати |
| --- | --- |
| Новий запис | Detail route, relevant list chunks/counts/index, sitemap, neighbours |
| Body/title/image edit | Detail body/SEO/media refs, projected cards і query dependencies |
| Зміна sort/filter field | Усі affected ordered list selections, chunks і dynamic indices |
| Translation edit | Відповідний locale view/body/SEO; fallback consumers також можуть змінитися |
| Зміна relation | Dependent lists/detail projections, route params domain, search і counts |
| Draft/unpublish/delete | Прибрати route, chunks/index references/sitemap/nav; очистити старий route cache |
| Slug rename | New URL + old URL 404; optional explicit redirect by stable `_id` |
| Template/component change | Усі importing routes/instances, query/projection plans і assets |
| PerPage/limit/offset edit | First HTML, continuation chunk partitioning/counts; legacy priorities |
| Видалення останнього запису | Empty list state, no Load More/sentinel, all removed details 404 |

Slug redirects — explicit migration policy, не automatic permanent redirect для кожного випадку. Compare snapshots за stable `_id`; якщо slug змінився і `_id` теж, не можна достовірно вважати це rename. HTTP redirects виконуються hosting adapter; JS-only redirect не рівнозначний. Для static-export target потрібна host-level redirect конфігурація.

Старий cached HTML може лишатися до purge/TTL; старі вкладки можуть показувати свій snapshot. Це допустимо в межах policy, але не має створювати broken chunks. Draft withdrawal вимоги до швидкості видалення визначити явно: public immutable artifacts не підходять для матеріалів, які повинні миттєво втрачати доступ.

## 18. Редактор, parser, oracle та міграції

Canonical source не змінюється від production compile, тому поточні `.map`, `.find`, annotations, `data-pagination`, LoadMore/Spinner, copy/paste і previews зберігаються. Всі нові persisted settings вводити через generator + parser + panels + oracle tests; mutations використовують queue/`modifyProjectFile`.

Новий runtime pagination/controller/shared query evaluator живе в окремому `@revyme/runtime`, з exports, typings, Node-import-safe pure helpers та coverage preview-sandbox runtime mappings. Installed `node_modules` не є місцем реалізації.

Production client `.map` callbacks мають залишити author DOM і animation bindings. Непотрібні generated hooks/imports прибираються scope-aware, не глобальним пошуком setter імені. Existing `paginationStateVar` може мати sanitized-name collision; новий instance identity не будувати лише з цього імені.

Generated LoadMore/Spinner master міграції мають зберегти авторські edits. Не підміняти весь master default компонентом заради loading prop; додати adapter/optional controls або нову версію контракту з marker.

Pilot migration: analyze-only report → opt-in static-cms-v1 на кількох fixtures → production artifacts порівняти з legacy → увімкнути для підтриманих generated проєктів. Custom source/settings явно відмічаються; mode rollback доступний на рівні release config.

Повністю static file target після першого релізу потребує окремої перевірки images loader, redirects, headers, dynamic routes, request APIs/server actions та custom components. [Next static export limitations](https://nextjs.org/docs/app/guides/static-exports).

## 19. Послідовність PR та точки приймання

| PR | Зміст | Основні точки інтеграції | Acceptance |
| --- | --- | --- | --- |
| 1 | Analysis/report + fixtures, versioned build config | новий `code/publishing`, existing CMS tests | знаходить detail/index/components/unsupported без source mutations |
| 2 | Snapshot validation, publication policy, shared semantics | schema/types, pure evaluator, runtime/canvas adapters | semantic corpus збігається, draft не public |
| 3 | Route manifest, locale/static params, 404 | `cms-seo.ts`, `locale-route-ops.ts`, production AST compiler | усі expected detail URLs prerendered, unknown URL 404 |
| 4 | Detail projections, nav та related dependencies | `cms-page-ops`, `map-gen`, scoped AST graph | у detail browser payload немає whole collection |
| 5 | Static lists bootstrap/chunks, limit/offset | `cms-gen`, `cms-projection`, output emitter | правильні first rows/count/order для всіх static selections |
| 6 | Runtime Load More transport | runtime repo, production pagination transform | append N, retry/no duplicates, existing UI/styles збережені |
| 7 | Infinite trigger та multiple-instance lifecycle | runtime, `cms-pagination-gen` compatibility tests | cleanup/backpressure/hidden copies/end/error працюють |
| 8 | Dynamic search/date/query URLs, relations indices | `cms-search-field-gen`, page variables, shared evaluator | знаходить незавантажений запис, AND/OR/coercion точні |
| 9 | Responsive/variant/template/locale integration | `cms-responsive-gen`, providers/layout adapters | query switch без stale append/hydration mismatch |
| 10 | CLI/export/local/cloud integration | `source-export`, server adapters, новий CLI/scaffold | Git checkout без редактора створює такий самий prepared site |
| 11 | Webhook queue, release isolation, activation/rollback | deployment service/backend, окремий site workflow | duplicate/rapid push/restart/build failure без втрати live |
| 12 | Cloudflare refresh, deletion/rename/schedule, operational tests | hosting adapter, deploy scheduler | new/removed URLs і старі вкладки проходять сценарії |

PR 3–4 можна спочатку перевіряти на detail-only fixtures, але не називати весь сайт optimized, поки imports templates/list/navigation не проаналізовані. Search/responsive features включати тільки після відповідних PR; непідтримуваний strict-static проєкт отримує report до запуску build.

Перший завершений продукт: стандартні static detail + static list + Load More/Infinite без dynamic filters, локаль-aware route manifest, CLI і безпечний deployment. Наступний — повна підтримка dynamic filters/responsive lists. Перед загальним default потрібно пройти всі перелічені feature classes.

## 20. Матриця тестів

### Дані та route generation

0/1/19/20/21/40/53/1000 records; duplicate IDs/slugs; malformed JSON/schema; Unicode slug; draft/scheduled; missing fields; root-mounted; static route collision; route groups; moved prefix; nested dynamic tuples; unknown/deleted slug; empty collection; localized route exports.

### Pagination та runtime

Load More/infinite, perPage 1/3/20 і upper-bound validation; numeric limit/offset без pagination і stale limit/offset при pagination; last partial chunk; counts після filters; click двічі; observer кілька разів; request failure/retry; route unmount; query change during fetch; cached response; source/perPage edit; two lists; two master instances; nested/related list; hidden variant; copy/paste/Make Component/remove pagination regression.

### Query semantics

Усі operators; AND/OR; empty/nonempty search; date-only/timezone; null/undefined/boolean/number/string coercion; multiple sort keys і ties; search по запису в останній порції; array/object/reference/multi-reference; source order; default values; routeParam; fields із дефісом; locale fallback; viewport/variant partial inheritance; URL query/back-forward/clear; unknown custom expression diagnostic.

### Visual та SSR

Порівняти legacy/optimized HTML і screenshots на desktop/mobile: перша порція, item body, fonts/images, styling, overlays, Appear/Scroll, layout refs, custom LoadMore/Spinner styles. First client render збігається з server bootstrap. JS-disabled показує detail і першу порцію; continuation має доступний fallback за обраною SEO policy.

### Production artifact

Реальний `prepare + next build + next start` на pinned Next/runtime. Assertions по prerender manifest й expected params; direct request, refresh, Next Link navigation/prefetch, metadata, canonical/hreflang, 404, chunks. Browser bundle і RSC props не містять sentinel secret/draft/unrelated item/full raw collection. Lazy files перевіряються також, не лише initial payload.

### Публікація

Webhook invalid signature/ref/repo; repeated delivery; missed delivery/retry; A/B/C rapid pushes; force-push; worker restart/lock recovery; dependency/build/typecheck failure; candidate smoke failure; activation race; Cloudflare purge failure/retry; rollback; scheduled publication без commit; Git-managed editor conflict; old tab Load More після нового release; old prefetch/navigation; removed record/renamed slug/cache TTL.

Vitest та TypeScript checks запускати за змінами; lifecycle/network сценарії — browser tests; webhook/deploy worker — integration tests. Наявні 206 tests залишаються regression базою, а нові tests перевіряють transport/SSG guarantees, яких у поточних generators немає.

## 21. Критерії завершення

- Для strict snapshot-static CMS site усі очікувані detail routes створені до першого відвідувача; unknown routes не генеруються на запит.
- Detail початково отримує лише свій запис, потрібні nav URLs і first portions своїх списків.
- Load More/Infinite спочатку отримують N matching cards і потім static continuation files; full collection не потрібна для звичайного static query.
- Dynamic search знаходить записи поза видимими/завантаженими cards, з точними filter/sort semantics.
- Limit/offset/pagination, locales, variants, templates, related lists і CMS links зберігають погоджену поведінку та редакторську сумісність.
- Додавання/редагування/видалення запису в GitHub запускає одну керовану публікацію immutable snapshot; schema/template зміни також враховуються.
- Failed build зберігає live site; cache-refresh failure помітний і повторюється; rollback та старі sessions не мають broken assets.
- Report показує actual route modes та payload budgets. Немає прихованого whole-collection або SSR fallback під назвою static optimization.
- Виміряно скорочення initial data/main-thread costs на fixtures; точні Lighthouse/CWV результати не обіцяються без вимірювань.
