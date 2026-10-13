# План оптимізації швидкості опублікованих сайтів Revyme — v2

Дата аудиту: 12 жовтня 2026 року.

Цей план стосується **швидкості готового сайту для відвідувача**: першого відображення, завантаження медіа, реакції на дії, переходів між сторінками та плавності. Час виконання `next build`, швидкість редактора і час створення ZIP не є цілями цього плану.

Основна рекомендація: спочатку усунути затримки показу першого екрана та зайві завантаження, потім зменшувати клієнтський код і дані. Зміни `next.config` самі по собі не вирішують головних проблем поточної архітектури.

## 1. Межі та достовірність аудиту

Прочитано початковий `docs/nextjs-performance-plan.md`, шляхи експорту та локального запуску, генератори providers, локалізованих маршрутів, CMS, шрифтів, smooth scroll, композиції анімацій, шаблони медіакомпонентів та відповідні тести. Додатково перевірено встановлений `@revyme/runtime` 0.0.28 і приклад згенерованого сайту в `data/builds/local`.

Cloud-публікація викликає зовнішній backend через `/api/websites/:id/publish`. Код згаданих у коментарях `backend/src/services/build-project.ts` та `export-project.ts` відсутній у цьому checkout. Тому налаштування production CDN, серверного кешу та фактичну поведінку cloud-збірки потрібно перевірити окремо. Висновки про локальні генератори не є доказом конфігурації хмарного хостингу.

Поточні значення LCP, INP, CLS, обсягів JavaScript та частоти кадрів **не виміряні**. Числа «до» з початкового документа не використовуються як baseline. Пріоритети нижче спираються на структуру коду; величину ефекту має підтвердити етап вимірювань.

Під час аудиту пройшли 78 наявних тестів у 7 файлах: source export, next/font, smooth scroll, providers, locale routes, CMS SEO та local server. Це перевірка поточної логіки, а не вимірювання продуктивності та не підтвердження успішного production build конкретного сайту.

## 2. Що реально є в коді

| Факт | Де перевірено | Наслідок для швидкості сайту |
| --- | --- | --- |
| Типова сторінка — серверна обгортка навколо `page.client.tsx` | `src/code/project/project-fs.ts`, `cms-page-ops.ts` | HTML може бути попередньо відрендерений, але великий клієнтський модуль збільшує JS і роботу гідрації |
| Експорт зазвичай переносить source без поділу на серверні та клієнтські частини | `src/code/project/source-export.ts` | Додавання серверного `page.tsx` саме по собі не зменшує клієнтське дерево |
| Статичні зображення редактора використовують `div + backgroundImage` | `src/code/oracle/checks/layout-rules.ts:646`, `ImageControl.tsx` | Немає автоматичного `srcset`, `sizes` та оптимізації через `next/image` |
| Динамічні/CMS `<img src={...}>` дозволені | та сама oracle-перевірка, `cms-page-ops.ts` | Потрібні окремі правила оптимізації для background і контентних зображень |
| Композиція Appear + Scroll стартує з `useMotionValue(0)` та запускається через effect | `src/code/generation/generator-motion-compose.ts:200` | Видимість критичного контенту може залежати від JS і запуску анімації |
| Providers статично імпортують словники всіх локалей | `src/code/project/providers-gen.ts` | Зайві дані інших мов можуть потрапляти в клієнтський граф залежностей |
| Providers також реалізують тему, link behavior і зміну локалі | той самий файл | Не можна просто видалити Providers або i18n-контекст |
| Локалізовані маршрути — фізичні `/fr/.../page.tsx` wrappers | `src/code/project/locale-route-ops.ts` | Оптимізація i18n має зберегти route-first SSR і структуру templates |
| CMS detail імпортує весь JSON і знаходить запис через `useParams()` | `src/code/project/cms-page-ops.ts:484` | Відвідувач однієї статті отримує дані всієї колекції |
| CMS server wrapper генерує metadata, але не `generateStaticParams` | `src/code/project/cms-seo.ts` | Немає явного переліку CMS detail URLs для статичної генерації |
| Google Fonts уже переводяться з CSS `@import` у `next/font/google` | `src/code/generation/next-font-gen.ts` | Це вже реалізована оптимізація; потрібні перевірка коректності та зменшення зайвих шрифтів |
| Font transform сканує CSS і додає всі знайдені сімейства в root layout | той самий файл | Ризик зайвих preload; окремо перевірити inline `fontFamily` у TSX |
| Lenis не запускається для disabled-конфігурації та reduced motion | `src/code/generation/smooth-scroll-gen.ts` | Частина необхідних захистів уже є |
| Touch smoothing Lenis вимкнений за замовчуванням | `smooth-scroll-config.ts`, `smooth-scroll-gen.ts` | Суцільне вимкнення `syncTouch` повторює default і ламає явний вибір автора |
| Lenis статично імпортується в controller | `smooth-scroll-gen.ts` | Навіть runtime early return не гарантує відсутності бібліотеки в початковому JS |
| Google Maps уже має `loading="lazy"`, YouTube/Vimeo — ще ні | `default-code-components/*Embed.ts` | Maps не потребує повторного додавання lazy; відео потребує |
| ModelViewer/Spline вже мають `import()`, але запускають його після mount | `ModelViewer.ts`, `SplineScene.ts` | Поділ bundle є; відкладення завантаження до видимості ще потрібне |
| Runtime має один публічний entry point із `'use client'` | встановлений `node_modules/@revyme/runtime/package.json`, `dist/index.js` | Потрібен аналіз реального bundle перед зміною пакування |
| Responsive variants можуть SSR-render кілька копій, які потім скорочуються | runtime `withResponsiveProps.tsx`, `variant-ssr-copies.ts` | Ризик зайвого DOM, гідрації та запуску важких прихованих компонентів |
| Sharp зараз використовується для gallery thumbnails 240×240 | `server/storage.ts:616` | Це не pipeline оптимізованих зображень опублікованого сайту |

## 3. Що виправити в початковому плані

1. **Прибрати гарантовані 95–100 балів, 1.2–1.8 s LCP і стабільні 120 FPS.** Результат залежить від контенту, пристрою, мережі, хостингу й сторонніх інтеграцій. Оцінка Lighthouse — додатковий сигнал, а не універсальна гарантія.
2. **`compress: true` не є новою gzip-оптимізацією.** Next.js уже стискає відповіді при `next start`; Brotli потрібно перевіряти та налаштовувати на хостингу/CDN. [Документація Next.js](https://nextjs.org/docs/app/api-reference/config/next-config-js/compress).
3. **`images.formats` не конвертує CSS backgrounds.** Потрібно реально використовувати image loader або створювати похідні файли й переписувати посилання. [Next.js Image](https://nextjs.org/docs/app/api-reference/components/image).
4. **`image-set` із різними форматами не вирішує responsive width.** Без варіантів розміру телефон усе одно може отримати великий файл. Для background потрібні правила по breakpoint і, за потреби, щільності пікселів; для контентних зображень — `picture/srcset/sizes`.
5. **Preload не є полем SEO metadata.** Ресурсні hints генерувати окремо через підтримуваний React/Next механізм. Не визначати LCP як «перше зображення в JSX» і не preload-ити весь hero. [Рекомендації щодо LCP](https://web.dev/articles/optimize-lcp).
6. **CSS fade-in від `opacity: 0` також може затримати показ важливого контенту.** CSS-first прибирає очікування JS, але не сам час анімації. Для LCP-кандидата базовий стан має бути видимим; рух без приховування або зміна ефекту — явне рішення автора.
7. **`optimizePackageImports` — експеримент, а не універсальне tree-shaking.** `lucide-react` уже оптимізується Next.js за замовчуванням. Спочатку виміряти імпорти; застосовувати додаткову конфігурацію лише після перевірки конкретного пакета й версії. [Документація](https://nextjs.org/docs/app/api-reference/config/next-config-js/optimizePackageImports).
8. **`syncTouch: false` уже є default.** Змінювати політику завантаження/запуску Lenis, а не просто повторювати default. Infinite/horizontal сценарії потребують окремої перевірки. [Lenis](https://github.com/darkroomengineering/lenis).
9. **`transform/opacity` — переважні властивості, але не гарантія GPU-only виконання.** JS-driven scroll лишається роботою main thread; blur може спричиняти paint, а не обов'язково layout. Профілювати конкретний ефект замість загальної заборони дизайну.
10. **`minimumCacheTTL` на рік без версіонування небезпечний для оновлення медіа.** Довгий immutable cache застосовувати до URLs із content hash. [Next.js Image caching](https://nextjs.org/docs/app/api-reference/components/image#minimumcachettl).
11. **Не додавати `suppressHydrationWarning` на body за замовчуванням і не видаляти його механічно зі всіх custom-code блоків.** Зберігати лише обґрунтовані випадки, перевіряти тему та зовнішні скрипти.
12. **Не видаляти `'use client'` за текстовою евристикою.** Потрібен аналіз hooks, handlers, browser APIs, імпортів і даних. Клієнтський provider із серверними `children` не перетворює автоматично всі ці children на клієнтські компоненти. [Межі Server/Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components).

## 4. Архітектура впровадження

Оптимізації розділити на два механізми, щоб зберегти редагованість сайту.

**Налаштування, що змінюють поведінку дизайну**, зберігати в source через звичайні генератори: критичне зображення, політика Appear, режим віджета, медіа-alt, reduced motion. Панель, parser, canvas, preview та runtime повинні однаково їх розуміти. Для source updates використовувати mutation queue / `modifyProjectFile`; DOM canvas не є джерелом істини.

**Оптимізації доставки**, що зберігають дизайн, виконувати на копії source: медіа-manifest, адреси похідних зображень, серверні маршрути, безпечне відділення static content. Розширити або виділити pure prepare pipeline поруч із `prepareSiteFiles`; мати однакову логіку для export і локального production server, а для cloud — інтегрувати її з backend після отримання його коду. Generated markers і версія pipeline дозволяють мігрувати лише згенеровані файли.

JS, потрібний опублікованому сайту, оформлювати у відповідному `@revyme/runtime` пакеті з його тестами й export checklist. Встановлений `node_modules` тут — матеріал аудиту; правки в ньому не є реалізацією рішення.

Зберегти `data-id`, порядок DOM, responsive overrides, CMS bindings, variants, refs, overlays і форму source, яку читають редактор та oracle. Невідомі code components і рукописні файли оптимізувати консервативно. У звіті вказувати причину пропуску; не виконувати приховану зміну дизайну.

## 5. Етап 0 — відтворюваний baseline і контроль регресій

**Пріоритет P0.** Спочатку визначити, що саме гальмує кожен тип сайту.

Підготувати невеликі еталонні проєкти:

- простий landing із hero-image та H1;
- landing з Appear + Scroll, split text, menu/overlay;
- CMS: 100 і 1000 записів, index/detail/search/pagination;
- 1, 3 та 10 локалей, довгі словники, RTL;
- YouTube/Maps/3D нижче першого екрана;
- responsive navigation/variants, зокрема приховані важкі компоненти.

Вимірювати **production site** через `next build` + `next start` або production hosting, не через Vite canvas і не через `next dev`. Зберегти версії Next/React/runtime, route, viewport, network/CPU profile та хостинг.

Для ключових маршрутів зробити щонайменше 5 лабораторних запусків із холодним browser cache; звітувати медіану й розкид. Окремо перевіряти повторний візит і client navigation. Для статичного контенту перевірити HTML та знімок із вимкненим JS.

Збирати: LCP element і його URL, TTFB, resource load delay/duration, element render delay, JS/CSS/font/image transfer bytes, parse/evaluate time, long tasks, TBT, DOM nodes, hydration errors, запити сторонніх сервісів. Для INP виконувати сценарії menu, form, locale switch, search/filter та pagination; TBT не замінює INP.

За потреби додати opt-in RUM на `web-vitals` із маршрутом і типом пристрою, без вмісту форм та персональних даних. Агрегувати p75 окремо mobile/desktop, оцінювати достатність вибірки. [Core Web Vitals](https://web.dev/articles/vitals).

**Готовність:** є baseline-звіт і відтворюваний набір fixtures; у жодної наступної зміни немає лише «візуального відчуття, що стало швидше».

## 6. Етап 1 — швидкий і видимий перший екран

**Пріоритет P1; очікуваний основний ефект — LCP і обсяг медіа.**

### 6.1. Реальний pipeline зображень

Створити manifest із source URL/content hash, intrinsic dimensions, форматами та варіантами ширини. Похідні файли для локальних assets генерувати серверним image processor; існуючий Sharp можна використати, але gallery thumbnail не є production image.

Початковий набір ширин, наприклад 480/768/1280/1920, є конфігурацією для fixtures, а не обов'язковим набором для кожного asset. Не збільшувати оригінал. WebP — базовий modern format; AVIF додавати, коли він дає виміряне зменшення при прийнятній якості. Зберегти SVG, прозорість, анімацію GIF/WebP та special media; не перетворювати їх на статичне зображення автоматично.

Для backgrounds на першому етапі зберегти `div` і редакторську crop-модель: переписувати статичні URL на оптимізовані variants у відповідних breakpoint rules. Врахувати DPR, background cover/contain, mobile art direction, gradient layers, masks та dynamic expressions. `image-set` використовувати лише разом із реальними похідними файлами й fallback, не як декоративну заміну `url()`.

Для CMS/content `<img>` додати `srcset`, коректний `sizes`, `width/height` або зарезервований aspect ratio, `alt`. Нижче першого екрана використовувати lazy loading; LCP image не робити lazy. Можливий `next/image` adapter для Node/CDN target, але не масова заміна всіх canvas images.

Не починати з вставки `<img>` у кожен background frame: це змінює модель вузла, crop, stacking, pointer events і parser/oracle contract. У майбутньому окремий ImageFrame runtime можливий тільки після перевірки всього round trip.

Для зовнішніх і dynamic URLs використовувати погоджений image CDN/loader або зберігати оригінал із попередженням у звіті. Не припускати, що будь-яку адресу можна безпечно завантажити та перекодувати. Для чистого static hosting потрібні готові variants/custom loader: default Next Image Optimization server там недоступний. [Static exports](https://nextjs.org/docs/app/guides/static-exports).

### 6.2. Критичний ресурс і preload

Додати явну політику `auto / critical / lazy` для image node, яку можна прочитати назад у редакторі. `auto` — консервативний default; використовувати вимірювання LCP і явну підказку автора. AST-порядок не показує реальну видимість, особливо з templates, variants і responsive rules.

Генерувати hint для підтвердженого критичного ресурсу конкретного маршруту, а не всього сайту. Для mobile/desktop art direction — взаємовиключні media conditions. Hint має вказувати саме файл/набір, який реально обере браузер, інакше виникне подвійне завантаження.

Для `next/image` використовувати API за зафіксованою версією: у Next 16 `priority` deprecated, є `preload`; не комбінувати його механічно з усіма іншими hints. Для CSS backgrounds — окремий ресурсний preload. Не preload-ити нижні секції чи приховані variants. [Next.js Image preload](https://nextjs.org/docs/app/api-reference/components/image#preload).

### 6.3. Appear без блокування контенту

Ввести explicit performance policy для критичних вузлів. H1, основний текст і LCP image повинні мати читабельний початковий HTML/CSS і не чекати hydration для показу. Для них пропонувати видимий resting state і, за згодою автора через налаштування, короткий transform-only ефект.

Не переписувати всі `useMotionValue(0)` на `1`: це ламає композицію Appear + Scroll, множення opacity/scale, variants та viewport triggers. Генератор має змінювати лише відповідну Appear-гілку з можливістю parse-back.

Для простих некритичних ефектів можна генерувати CSS animation, але підтримати `prefers-reduced-motion`, відсутність JS і одноразовий запуск. Складні springs, stagger, text split і scroll composition залишити runtime. Не анімувати один transform одночасно через CSS і Motion без узгодженої композиції.

**Готовність етапу:** критичний контент видимий до hydration; mobile отримує менший asset; preload не дублює запит; screenshots і crop збігаються; LCP покращено в baseline-профілі.

## 7. Етап 2 — прибрати зайві дані CMS та локалізації

**Пріоритет P1 для CMS/багатомовних сайтів; ефект — JS, hydration, INP та TTFB.**

### 7.1. CMS

Детальна реалізація snapshot-публікації GitHub → webhook → статичні routes із наявними Load More/Infinite, пошуком і responsive lists описана в [окремому плані](./cms-static-publishing-implementation-plan.md).

Для generated detail pages читати колекцію в Server Component, знаходити потрібний запис на сервері, передавати лише потрібні серіалізовані поля в клієнтську частину. Збереження всього JSON у server module саме по собі не проблема; його імпорт у browser bundle або передавання всієї колекції через props — проблема.

Для статичних snapshots генерувати `generateStaticParams` із валідних унікальних slugs. Локалізовані wrappers повинні зберігати необхідні exports/metadata та params. Для невідомого slug — `notFound()` у статичному generated маршруті; поточний fallback на перший запис не переносити як production-поведінку. Preview і старі рукописні маршрути можуть потребувати режиму сумісності.

Для index відображати серверну сторінку/порцію записів; інтерактивний search/filter/pagination отримує мінімальні потрібні дані. Якщо автор обрав пошук по всій локальній колекції, сформувати компактний search index і завантажувати його при потребі. Сам поділ JSON на chunk не виправляє зайве відображення 1000 карток.

Стратегія route-specific: статичні snapshots — prerender/CDN, live CMS — явний SSR/ISR режим із перевіреною інвалідацією. Не вмикати `output: 'export'` для всього проєкту. Визначити ліміт prerender routes і політику великих колекцій.

Залежність: зараз редактор очікує import JSON та `.find/.map` у source. Починати з AST-transform підтриманих generated конструкцій на копії для production: detail визначати через `@cmsPage`, а index і списки у звичайних сторінках/components — через CMS imports та scope-aware AST, бо поточний index scaffold не ставить обов'язковий marker. Persist новий формат лише після розширення parser/preview. Невідомі custom expressions лишати в compatibility mode.

**Перевірка:** на detail колекції із 1000 записів у browser bundle/RSC payload немає всіх 1000 записів; прямий URL, refresh, client navigation, локаль, SEO та 404 працюють однаково.

### 7.2. i18n

Розділити server message loader і client Providers. Сервер визначає локаль із generated route structure та передає лише активний словник. Спочатку прибрати інші локалі; потім, для відомих статичних namespaces, передавати лише page/template/widget namespaces. Динамічний ключ — fallback на повний словник **активної** мови.

Зберегти route-first SSR, default locale без префікса, locale-change event у preview і поточні правила localStorage. URL-prefixed locale не повинна підмінятися persisted preference. Для unprefixed URL потрібна явна сумісна політика: server default + lazy dictionary для збереженої client locale, або переведення switcher на locale routes.

Вибір нової локалі має завантажувати її дані перед перемиканням контексту; потрібен захист від racing requests. Статичні переклади можна поступово рендерити серверно, а словники залишати тільки інтерактивним островам. Не викликати client-context `useTranslations` у Server Component; потрібен підтримуваний server API чи generated server strings. [next-intl Server/Client Components](https://next-intl.dev/docs/environments/server-client-components).

Не робити root layout request-dynamic через `headers/cookies` лише заради локалі. Для поточних фізичних locale routes спочатку спроєктувати locale-aware layouts/route entries, які зберігають templates, серверний `lang/dir` та статичність. Це міграція кількох генераторів, а не заміна підпису `Providers`.

**Перевірка:** initial load однієї мови не завантажує словники інших; SSR HTML перекладений; немає hydration mismatch, втрати link behavior, теми, RTL чи shared header translation.

## 8. Етап 3 — скоротити обсяг клієнтського React

**Пріоритет P2 для простих сторінок і P1 після підтвердження великої вартості hydration; складність висока.**

Ціль: статична основа сторінки на сервері; client islands для menu, forms, accordion, carousel, variants, animations, code overrides та інших інтерактивних блоків.

Почати з opt-in pilot для простого generated landing. Побудувати AST/dependency classifier: hooks, event handlers, browser APIs, context use, imports, dynamic expressions, refs і замикання визначають мінімальну безпечну клієнтську межу. Якщо залежності не можна серіалізувати чи відділити, зберегти більшу межу.

Окремо перевірити `LayoutClient` templates: серверний body не дасть бажаного ефекту, якщо layout продовжує імпортувати весь static header/footer як client subtree. Передавати серверні фрагменти через `children`/slots там, де це сумісно; це підтримуваний Next pattern, але client contexts не доступні всередині server fragments. [Next.js composition](https://nextjs.org/docs/app/getting-started/server-and-client-components).

Не називати SSR «нульовою гідрацією»: потрібний React/runtime усе одно залишається для інтерактивних меж, а HTML та RSC payload теж мають вагу. Порівнювати browser JS, main-thread time і сумарну передачу, не лише кількість рядків `.client.tsx`.

Паралельно проаналізувати production chunks runtime. Поточний entry point збирає responsive props, cursors, split text, sketch draw та overrides. `withResponsiveProps` сам імпортує Motion, тому лише нові subpath exports не гарантують усунення Motion. При підтвердженій вартості виділити легкий responsive path і motion adapter; optional sketch path не має вимагати `perfect-freehand` на простій сторінці.

LazyMotion/`m` і optimize imports — окремі вимірювані експерименти: generators/runtime повинні підтримати усі реально використані hooks, layout/gestures і dynamic feature loading. Не змінювати глобально всі `motion.*` без feature audit.

**Готовність:** pilot зберігає редагованість і всі сценарії, має менші JS та hydration/evaluate time; потім підтримку розширюють класами компонентів, а не одним глобальним regex transform.

## 9. Етап 4 — віджети, responsive copies та витрати під час скролу

**Пріоритет P1 для сайтів із video/3D, P2 для решти.**

YouTube/Vimeo: додати `loading="lazy"` для некритичних embeds. Для сильнішого ефекту — poster/facade із завантаженням iframe після click. Зберегти controls, autoplay, mute та loop; autoplay hero потребує іншої політики. Фасад повинен мати доступну кнопку й зарезервований розмір. Google Maps уже lazy; для нього facade — наступний, окремий рівень оптимізації.

ModelViewer/Spline: викликати існуючий `import()` тільки після підтвердження видимості або явної дії. `rootMargin`, наприклад 200 px, — початковий tuning параметр. Не використовувати `ssr:false` для всього блока: SSR placeholder/poster зберігає layout. Видимий hero може відразу показувати poster і підвантажувати 3D за політикою автора.

RAF/WebGL/canvas ефекти мають зупинятися поза viewport і коли `document.hidden`, поважати reduced motion, очищати listeners/observers/resources. Для 3D — обмежувати DPR та складність на мобільних за preset; resize не повинен створювати новий renderer. Зберегти окрему поведінку `useStaticCanvas` для редактора.

SSR copies responsive variants не прибирати механічно: вони запобігають появі mobile navigation лише після JS. Виміряти кількість копій, DOM і запити; гарантувати, що приховані копії не запускають import/iframe/video/RAF. Поступово відділяти спільну статичну структуру від variant-specific частин, зберігати відповідність SSR та першого client render.

Lenis: зберегти native touch default, reduced-motion guard і авторські налаштування. Завантажувати бібліотеку динамічно лише для enabled route; коли на сайті взагалі немає smooth scroll, не додавати controller в production output. Захистити import від гонки при navigation; cleanup повинен прибирати інстанс і global reference. Не виявляти телефон лише за `ontouchstart`: hybrid devices також мають touch.

Додати performance diagnostics для важких scroll blur, layout properties, дуже великих layers і постійного `will-change`. Це попередження/профіль, а не заборона всіх ефектів. Обмежувати `will-change` у часі та кількості; не додавати `translateZ(0)` на кожен вузол.

**Готовність:** нижні віджети не завантажуються на initial viewport; приховані variants не створюють зайві WebGL/iframe; interactions і scroll profiles не мають нових long tasks чи візуальних регресій.

## 10. Етап 5 — шрифти, стилі та сторонній код

**Пріоритет P1 для font correctness, P2 для подальшого зменшення ресурсів.**

Перевірити існуючий next/font pipeline у браузері. Він переписує CSS, але не inline TSX `fontFamily`; у прикладі `data/builds/local` layout містить loaders, а page має `fontFamily: "'Sora', sans-serif"`. Це підтверджена прогалина трансформації, але фактичний fallback/зайві запити потрібно перевірити через rendered fonts і Network.

Зв'язувати потрібні font-family expressions із generated CSS variables без зміни інших рядків коду. Для наступної реалізації використовувати AST для TSX і CSS parser для CSS; покрити custom fonts, italic, variable axes, кілька `family=` в URL, weights/subsets та fallback fonts. Не оголошувати існуючий regex універсальним font parser.

Робити font usage manifest по маршруту/template. Спільні шрифти лишати в shared layout, рідкісні — біля потрібного route. Preload лише необхідних для першого екрана faces/subsets; не втрачати кирилицю чи RTL заради економії. `next/font/local`/self-hosted WOFF2 для custom fonts, якщо assets доступні. Перевіряти реальне застосування font variables і CLS при підміні fallback.

Статичні повторювані стилі можна поступово переносити в route-scoped CSS, зберігаючи dynamic/Motion style values inline. Почати з exact duplicate static declarations, а не всіх style objects. Перевіряти cascade, media order, CSS variables, pseudo-elements та component instance selectors.

Inline `<style>` мінімізувати CSS parser/minifier, а не regex видаленням пробілів: `calc()`, custom properties, strings і data URLs мають залишатися коректними. Critical CSS тримати компактним; решту кешувати як окремі CSS assets, якщо це зменшує сумарну вартість. Next уже оптимізує звичайні CSS imports; custom JSX style strings потребують окремої перевірки.

Custom head/body, analytics та marketing scripts включити в report: що завантажено, на якому етапі, які long tasks спричинено. Для відомих інтеграцій використовувати підтримувані script strategies після hydration/interaction; не міняти порядок довільного author script без explicit policy. Початковий app package містить редакторські залежності, але їх наявність там не доводить їх присутності у bundle сайту — перевіряти фактичний import graph.

**Готовність:** правильний шрифт використовується до/після hydration, немає зайвих font preloads, стилі та custom integrations зберігають поведінку, HTML/CSS transfer зменшується.

## 11. Етап 6 — доставка на production hosting

**Пріоритет P1 після вимірювання високого TTFB або слабкого кешування.**

Для статичних сторінок використовувати prerender і CDN cache; для динамічних визначити SSR/ISR та інвалідацію. Перевірити route output реальної Next версії: `'use client'` сам по собі не означає request-time SSR, а Server Component сам по собі не гарантує статичний маршрут.

Content-hashed JS/CSS/fonts/image variants — довгий `Cache-Control: immutable`. HTML/RSC — відповідна Next/host caching policy, а не глобальний річний cache. CDN повинен правильно працювати з locale routes, RSC headers/Vary, prefetch і client navigation.

Перевірити `Content-Encoding`, Brotli/gzip, HTTP cache і delivery географію на опублікованому домені. `public/api/uploads` у Next site — статичний каталог, а не локальний editor upload endpoint; cache headers із `server/api-plugin.ts` автоматично не переносяться на хостинг сайту.

Додати перевірку повторної публікації: нові assets отримують новий hash, HTML не застрягає на старому snapshot, route transition не посилається на вже видалені chunks. Зберігати попередні hashed assets на час, потрібний старим сесіям.

Не вважати `poweredByHeader:false`, `output:'standalone'` чи зміну TypeScript flags оптимізаціями браузерного JS. Їх можна мати з інших причин; у performance plan зараховувати лише виміряний ефект на доставку/рендер.

**Готовність:** відомі фактичні TTFB/cache/encoding характеристики production target; repeat visits дешевші, а оновлення контенту й assets не застрягають у кеші.

## 12. Порядок робіт і точки приймання

Це рекомендована послідовність невеликих змін. На сайті з високим TTFB hosting роботу потрібно підняти раніше; на CMS/3D — відповідні етапи робити одразу після baseline.

| Крок | Зміна | Основні точки коду | Доказ готовності |
| --- | --- | --- | --- |
| 1 | Production fixtures + baseline | новий performance harness, існуючі export tests | повторюваний report по маршрутах |
| 2 | Image variants + media manifest | `server/storage.ts`/новий processor, `source-export.ts`, `export-project.ts` | менший mobile transfer, правильний crop |
| 3 | Critical image policy + hints | новий pure resource-hints transform, page wrappers, media controls/oracle | один правильний critical request, без double download |
| 4 | Видимий critical Appear | motion generators, animation parsing, runtime, editor policy | hero доступний без JS, композиція збережена |
| 5 | Font correctness та preload usage | `next-font-gen.ts` | rendered font правильний, немає зайвих faces |
| 6 | Lazy video/3D/hidden effects | `default-code-components`, runtime | важкі ресурси відсутні до visibility/interaction |
| 7 | CMS single-record/SSG | `cms-page-ops.ts`, `cms-seo.ts`, locale wrappers, production transform | немає whole-collection browser payload |
| 8 | Active-locale messages | `providers-gen.ts`, `locale-route-ops.ts`, `locale-ops.ts`, layouts | інші словники відсутні на initial load |
| 9 | Client islands pilot + runtime audit | production AST pipeline, templates, окремий runtime repo | менші JS/main-thread costs, round trip збережений |
| 10 | CSS дедуплікація, Lenis delivery, production cache | generators, runtime, CDN/backend | додаткове покращення за baseline, коректна republish |

Кроки 3–4, 7–9 потребують нового source/runtime контракту і міграцій. Не оцінювати їх як правку одного файлу. Feature flag, versioned markers, compatibility fallback та поетапний rollout потрібні для старих проєктів.

## 13. Цілі та перевірки

Офіційні польові цілі на p75: **LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1**, окремо mobile і desktop. [Web Vitals](https://web.dev/articles/vitals). Для контрольних fixtures можна встановити суворіші бюджети після baseline: LCP ≤ 2 s, CLS ≤ 0.05 і лабораторний TBT ≤ 150 ms. Ці бюджети — пропозиція для узгодженого тестового профілю, а не обіцянка для довільного дизайну.

JS/media/font budgets задавати після вимірювання окремо для простого landing, CMS та rich-media сайту. Рахувати transferred compressed bytes по маршруту та main-thread time. Кількість installed packages або raw bundle size не замінює ці показники.

Для кожної зміни потрібні:

- unit tests pure transforms: AST output, idempotence, preservation і conservative fallback;
- перевірка production fixture build/start та потрібних routes;
- screenshot/behavior comparison на desktop/mobile, templates, variants, overlays, forms;
- SSR/JS-disabled перевірка критичного контенту та hydration console;
- network assertions: critical asset, lazy widgets, locale dictionaries, CMS payload;
- Lighthouse/interaction профіль у тому самому середовищі, що baseline;
- round-trip перевірка parser → canvas → source для persisted нових можливостей;
- відповідні Vitest тести та TypeScript перевірка змінених модулів/runtime; повні required checks перед merge.

Плавність оцінювати через frame time і long frames на реальних пристроях: бюджети 16.7 ms для 60 Hz і 8.3 ms для 120 Hz є часовими орієнтирами, не гарантією. Перевіряти touch scrolling, reduced motion, background tab, nested scroll і route transitions.

Performance warnings додавати в oracle/report як рекомендації, якщо source лишається коректним. Фатальні помилки resource resolution, SSR/runtime або некоректного transform блокують випуск optimized artifact; сам по собі важкий author design не повинен втрачати можливість публікації.

## 14. Перше практичне впровадження

Для першого релізу оптимізації вибрати **baseline → image variants і правильний critical request → видимий hero → font correctness → відкладення video/3D**. Це дає змогу покращувати швидкість без негайної перебудови всіх компонентів на RSC.

Наступний реліз — CMS/i18n data boundaries. Server/client islands і runtime package split робити після вимірювання їхньої реальної вартості та pilot. Саме вони можуть дати найбільше скорочення JS на складних сторінках, але мають найвищий ризик для редакторської сумісності.
