# Framer у Revyme Повний аудит конвертації та план виправлення

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Кроки виконання позначено `- [ ]`. Цей документ фіксує дослідження і не дозволяє автоматично починати реалізацію.

**Goal:** Переносити вибрані сутності Framer у відповідні редаговані сутності Revyme зі збереженням структури, назв, стилів, залежностей і поведінки; усунути підміну контенту та небезпечну вставку.

**Architecture:** Розширення збирає raw snapshot вибраного обсягу та залежності. Один конвертер будує типізовану проміжну модель і план Revyme; валідатори перевіряють його до атомарного commit. Clipboard, popup і floating widget є транспортами одного протоколу, а не різними конвертерами.

**Tech Stack:** Поточне Chrome MV3 розширення, TypeScript/React/Next.js у Revyme, Babel AST, ProjectFS, automation-core/MCP v2, Oracle, Vitest, Playwright.

**Spec:** Вимоги власника та критерії приймання в цьому документі. Дата аудиту: 1 листопада 2026 року. Новий аудит доповнює, а не замінює історичні факти зі [старого плану](./2026-11-01-framer-import-recovery.md).

## 1 Висновок

Поточне розширення ще не є загальним конвертером Framer. Воно поєднує часткове перетворення raw дерева з великою кількістю заготовленого коду Walker. Тому навіть код без порушень Oracle може містити інший дизайн, неправильні компоненти, зниклі зв’язки або вигаданий контент.

Проблеми є на обох сторонах: розширення змінює зміст і губить семантику, а приймач Revyme записує bundle до валідації та може видалити Home навіть у режимі звичайної вставки. Виправити лише розширення недостатньо: контракт і commit у `src/canvas/framer-paste.ts` теж потребують змін.

Підтверджені результати:

- Отримано штатний raw clipboard Framer для Home Desktop, Global Navigation template та вибраних дочірніх шарів компонента. Початкові дані доступні навіть після встановлення розширення.
- Перевірено встановлене розширення у браузері: кнопка з відкритого Underline Link знову експортує `WalkerPage` і цілу Home, а не вибраний компонент. Кнопка за своїм кодом є full-project export; окремого робочого selection route зараз немає.
- У наданому актуальному clipboard 131 вузол з унікальними ID і bundle із 17 файлів. У вузлах немає жодного `attrs`, `componentFile`, `motionProps`, `responsiveBands`.
- Реальний bundle має 16 Oracle-порушень tier 2 у трьох editable TSX-файлах. Це не ті самі 32 порушення зі старого експорту: частину попередніх проблем уже усунуто.
- У CMS 31 reference/multi-reference значення не збігається з жодним `_id` цільових записів відповідних колекцій.
- У sandbox-тесті невдала вставка залишає записаний невалідний файл. Інший тест підтвердив видалення обох файлів Home при `mode:'paste'`, після якого повертається `false`.
- 10 наявних Framer-тестів у репозиторії проходять, але перевіряють переважно окремі заготовки. Окремі 5 діагностичних тестів цього аудиту перевірили фактичний payload, object-map presets, generic conversion та побічні ефекти приймача.
- Через CLI/MCP registry прочитано 282 актуальні операції та їхні schemas. Це інвентаризація API, не твердження, що всі 282 операції виконано або що вони забезпечують повний Framer parity.

**Головний критерій:** потрібні дві незалежні перевірки — сумісність із редактором Revyme та відповідність джерелу Framer. Oracle перевіряє першу частину; він не знає, що у Framer було шість варіантів, інший підпис або інший порядок карток.

## 2 Межі доказів та джерела

### 2.1 Що досліджено наживо

У браузері відкрито проект Walker copy. Штатним Copy отримано HTML із `data-framer-pasteboard`, без запуску довільного коду всередині Framer. Потім використано кнопку встановленого користувачем розширення. Вихідний код проекту Framer не редагувався.

| Зразок | Фактичні дані | Що доводить |
|---|---|---|
| Home Desktop native copy | 130738 символів HTML; `layers`, `assets`, `sourceProjectId` | Реальний clipboard protocol і дерево вибраної сторінки |
| Global Navigation native copy | 158925 символів HTML; root `KttVumVuH`, 3 children | Реальні header/body slot/footer, overlay та залежності layout |
| Multiple selection у Underline Link | Roots `uLUi_cY4A` Label і `MhIYRayaq` Underline | Selection може містити кілька незалежних roots; це не експорт усіх variants |
| Underline Link у UI | Regular, Regular Line in, Regular Reset, Large, Large Line in, Large Reset | Шість станів; експортовані два — неповний набір |
| Project Card у UI | Desktop, Desktop Hover, Desktop Leave, Mobile, Mobile Pressed | П’ять станів; експортовані два — неповний набір |
| Assets у UI | 8 smart components, Global Navigation, 8 основних text styles, 9 color styles | Перевірка бібліотек і назв, зокрема двох різних Black |
| Вихід розширення | 131 nodes, 17 files; повторно з іншого контексту 122 nodes при незмінному TSX | Clipboard і TSX не є одним стабільним представленням джерела |

Кількість вкладених gradient-об’єктів у raw не означає, що градієнт активний: Framer може серіалізувати дефолти для неактивного fill. Статус конкретної властивості визначається enabled/type/override, а не лише наявністю ключа.

### 2.2 Що прочитано локально

- Розширення: `/home/rost/Документи/framer-to-revyme-extension/`, зокрема `content.js` близько 2520 рядків, `popup.js`, `revyme-injector.js`, `manifest.json`, `README.md`.
- Новий результат: `/home/rost/.codex/attachments/ef5a6dbe-f3ce-4e6a-99ec-202b94adae86/Вставлений текст.txt`.
- Старий raw: `/home/rost/Завантажене/Walker__copy_-full-site.json`. Використаний для зіставлення ID, master definitions і повного старішого списку variants; він не оголошується новим live export.
- Builder: `src/canvas/framer-paste.ts`, `src/canvas/shortcuts.ts`, `src/code/import/framer/`, paste engine, CMS/types, generators/parsers, Oracle checks, automation operations.
- Інструкції: [revyme-mcp SKILL.md](/home/rost/Документи/revyme/revyme-builder-fork/.agents/skills/revyme-mcp/SKILL.md). Актуальні schemas перевірено через CLI, а не через застарілі назви MCP v1 із прикладів skill.

### 2.3 Що не оголошується перевіреним

Один Walker не містить усіх можливих об’єктів усіх Framer-проектів. Матриця нижче є повним переліком доменів для реалізації й тестування, а не заявою про вже доведений універсальний імпорт. Непредставлені в проекті функції позначено як потребу окремої fixture. Довільні code components, бізнес-логіка overrides, недоступні залежності та закриті інтеграції не мають гарантованої автоматичної конвертації.

Живий проект Revyme `proj-1793538289429-al6out`, branch `main`, перевірено read-only: `diagnostics.projectCheck --strict true` повернув clean, 0 violations, revision 4. Вставлення або replace в ньому під час аудиту не виконувалось. Небезпечні сценарії перевірялися лише в InMemoryProjectFS у Vitest.

## 3 Контракт даних які реально надає Framer

### 3.1 Секції native clipboard

| Секція | Призначення | Як обробляти |
|---|---|---|
| `layers.tree.version` | У зразку 128 | Версіонований decoder; невідому версію не інтерпретувати мовчки |
| `layers.tree.root.children` | Вибрані roots та залежні сутності; у Desktop також Works, Category, Services | Відділити render roots від dependency roots; колекції не вставляти як div |
| `originalFrames` | Додатковий контекст початкових frames | Зберігати provenance; у зразку порожній, потрібна окрема fixture |
| `masters` | Metadata master/primary | Це не обов’язково повний master source; перевірити shape, не вважати кожне значення деревом |
| `replicas` | Контекст успадкування | Резолвити base + overrides; не створювати порожню копію |
| `renamedIds` | Таблиця зміни ідентифікаторів | Застосувати до ВСІХ посилань у graph, не лише `id` |
| `webPagePathByWebPageId` | Page ID → path | Відновити внутрішні посилання; у конкретному Desktop порожній — знадобиться dependency read |
| `webPagePropsForCopiedBreakpoint` | Props сторінки для breakpoint | Пов’язати з правильним source page/context |
| `breakpointOverrides` | У зразку записи для 810, 390 та 1200 | Зберегти також `itemsOrder`, `_deleted`, visibility, variant overrides |
| `variableValueInfo` | Scope і provider values | Резолвити значення з урахуванням provider, instance і CMS row |
| `stylePresetNodes` | У live зразку OBJECT map з 8 записами | Нормалізувати через values; не припускати array |
| `colorTokenNodes` | OBJECT map стилів кольору | Зберегти source ID, назву, тему й usage references |
| `stylePathByStyleId` | Ієрархія/папки стилів | Відновити папки й labels; slug не замінює source identity |
| `moduleData` | Module identifiers, import/export descriptors | Замкнути залежності; не плутати module descriptor з доступним source code |
| `assets` | Пов’язані asset descriptors | Type-aware resolver, hashes, media metadata, локалізація через asset API |
| `sourceProjectId` | Походження clipboard | Ключ namespace/cache/mapping; не ідентифікатор проекту-призначення |

### 3.2 Спостережені класи

| Internal class | Desktop | Template | Правильна категорія |
|---|---:|---:|---|
| RootNode | 1 | 1 | Транспортний контейнер, не canvas layer |
| FrameNode | 14 | 29 | Frame/layout/semantic element; іноді breakpoint або variant |
| CodeComponentNode | 5 | 20 | INSTANCE: може бути і design, і code component залежно від identifier |
| RichTextNode | 2 | 5 | Rich text із inline стилями та preset links |
| OverlayNode | 0 | 1 | Окремий overlay graph із runtime/trigger semantics |
| SlotNode | 0 | 1 | Body slot template, не порожній div |
| CollectionNode | 3 | 0 | CMS schemas/records, dependency graph |
| CollectionItemNode | 20 | 0 | CMS data, не render layer |
| TextStylePresetNode | 8 | 12 | Залежні typography styles; кількість не дорівнює кількості основних стилів у Assets |
| ColorStyleTokenNode | 2 | 3 | Залежні color styles |
| ConicGradient LinearGradient RadialGradient | по 1 | 0 | Paint values; перевірити активний fill |
| GradientColorStop | 6 | 0 | Впорядковані stops активного градієнта |
| ExportOptions PreviewSettings | по 1 | 0 | Editor/export metadata; не переносити як видимий HTML |

Public Framer Plugin API називає текст `TextNode`, а instance — `ComponentInstanceNode`; internal clipboard має інші назви. Public [ComponentInstanceNode](https://www.framer.com/developers/reference/plugins-component-instance-node) представляє code або design component. Тип не можна визначати правилом «CodeComponentNode завжди code component».

### 3.3 Важливі поля та правила значень

- Identity: `id`, `parentid`, `originalid`, `duplicatedFrom`, `name`, children order. Source IDs потрібні для provenance; target IDs генеруються окремо. `data-name` — label шару, текстовий child — його вміст, HTML `label` — семантика форми. Це три різні поняття.
- Geometry: width/height плюс widthType/heightType, min/max, aspectRatio, intrinsic size, grid spans, anchors, position, zIndex. Значення `width:1` саме по собі не означає 1 px. Відомі з цього проекту Fixed/Fill/Fit потрібно зафіксувати fixture; решту enum значень підтвердити UI/даними, не вгадувати.
- Layout: stack/grid, direction, alignment, distribution, wrapping, gap, per-side padding, grid tracks, row sizing, item fill/span/alignment, itemsOrder.
- Paint: fillEnabled/fillType, color/token/image/gradient, radius per corner, borders per side, opacity, rotation, overflow. Не переносити неактивний fill поверх активного.
- Content: HTML, semantic tag, inline rich styles, paragraphSpacing, preset IDs для конкретного H1–H6/p/span/link, text fit metrics, selections та links.
- Behavior: enter/exit/styleAppear effects, `variantTransition`, `$control__*`, `onTap`, link/new-tab, visibility conditions, overlays/backdrop/scroll lock, overrides.
- References: змінювати source IDs у зв’язках тільки через registry mapping. `false`, `0`, `''`, `null`, missing і explicit delete — різні стани. `||` не є коректним resolver для них.

## 4 Підтверджені дефекти поточної реалізації

Серйозність: P0 — ризик втрати/підміни проекту; P1 — втрата змісту або редагованості; P2 — відсутня можливість/візуальна неточність; P3 — editor metadata або зручність.

### F01 P0 Вставлення змінює проект до валідації

У [framer-paste.ts](/home/rost/Документи/revyme/revyme-builder-fork/src/canvas/framer-paste.ts:221) обробка `incomingFiles` стоїть до перевірки mode, nodes, Oracle та завершення операції. Використано raw writeFile. При templated page видаляються `app/page.client.tsx` і `app/page.tsx`, змінюється active file; це відбувається і в `mode:'paste'`.

Доказ із sandbox: clipboard із нульовою кількістю nodes + невалідний component файл повертає `false`, але файл залишається. Clipboard з нульовими nodes + `app/(audit)/page.client.tsx` повертає `false`, але обидва файли Home вже видалені. Це не гіпотетичний ризик і не перевірка в живому проекті.

**Виправлення:** окремі selection/page modes; prepare/validate без writes; один snapshot/history/commit для всіх змін; відмова без змін; existing files через safe operations. `paste selection` ніколи не перепризначає Home.

### F02 P0 Bundle може перекрити чужі файли без scoped mapping

Фіксовані `components/Logo.tsx`, `app/globals.css`, `cms/works.json`, route group global-navigation записуються поверх збігів. Немає target project/branch/revision, conflict policy, namespace, before-hash або rollback. Фільтр `!path.includes('app/page.')` не є моделлю дозволених destinations.

**Виправлення:** план destination mapping із collision detection; merge tokens/styles; reuse лише за source identity/hash, не за basename; candidate paths нормалізовані та обмежені project namespace. Не змінювати глобальний reset/шрифти проекту лише тому, що вставляється одна кнопка.

### F03 P1 TSX генерується із заготовки Walker

[extractAndGenerateComponents](/home/rost/Документи/framer-to-revyme-extension/content.js:892) і [extractAndGeneratePageTsx](/home/rost/Документи/framer-to-revyme-extension/content.js:1759) містять готові тексти/компоненти/структуру. Page generator не використовує tree для побудови JSX. При двох різних вхідних деревах і однакових collections отримано ідентичний TSX. За відсутності masters усе одно генеруються Logo, ProjectCard, UnderlineLink, OpacityLink, NavigationBar, GlobalNavigation і template.

У заготовці змінено footer: замість оригінальних Made by Hvade/Back to top з’являються Privacy Policy/Terms of Service. Це вигаданий контент, а не допустима нормалізація.

**Виправлення:** прибрати source-specific IDs/назви/контент з generic converter; допустимі лише загальні adapters для відомого ТИПУ модуля. Walker залишається regression fixture, а не шаблоном для будь-якого проекту.

### F04 P1 Native Copy і кнопка є різними нееквівалентними маршрутами

`processPayload` оголошено, але у поточному `content.js` немає реєстрації clipboard hooks/copy listener, що його викликають. README обіцяє автоматичне перехоплення Ctrl+C. Наживо після встановлення розширення штатне Copy все одно повертає native Framer pasteboard. Кнопка робить full-project export, вибирає першу Home/перший Desktop та ігнорує поточну selection.

[Builder converter](/home/rost/Документи/revyme/revyme-builder-fork/src/code/import/framer/convert.ts:68) і extension converter використовують `for...of rawPresets`, але native clipboard надає OBJECT map. На shape, отриманому з live payload, обидва падають з `TypeError: rawPresets is not iterable`.

**Виправлення:** один decoder для map/array; явний `scope: selection|page|library`; Ctrl+C залишається штатним, окрема Copy for Revyme дія не має ламати інші формати. Якщо automatic intercept зберігається, протестувати обидва browser clipboard API й синхронний copy event без async race.

### F05 P1 Три повідомлення та фальшивий success

[revyme-injector.js](/home/rost/Документи/framer-to-revyme-extension/revyme-injector.js:181) послідовно робить direct call, CustomEvent і postMessage. Revyme слухає обидва events. Injector ISOLATED не бачить MAIN window function; два event routes лишаються активними. Popup використовує ще один варіант виклику. Жоден UI не перевіряє завершений durable receipt; boolean false також може показуватися як успіх.

**Виправлення:** один requestId, один канал, schema version, bounded dedupe/in-flight cache, response після commit; timeout/error/partial-result відображати чесно. Перевірити source/origin і explicit project/branch. Посилання на direct API використовувати тільки в тому самому execution world.

### F06 P1 MAIN storage не має isolated relay

Extractor працює в MAIN, але прямо викликає extension `chrome.storage.local` і приховує failure. Popup може записати storage сам після executeScript, тому маршрути поводяться по-різному. У manifest немає Framer isolated relay. UI заявляє «скопійовано» незалежно від фактичного `copiedOk`.

**Виправлення:** MAIN extractor → валідований isolated relay → extension storage. Clipboard permission/user gesture — окремий результат, а не припущення. Повернути raw export/debug download як діагностичну можливість.

### F07 P1 Один payload описує два різні документи

131 ClipboardNode є flattened primitives, а files/tsx описують native-looking component page. Усі 131 nodes без componentFile/attrs/motion/responsive metadata. Після відкриття Underline Link повторний export дав 122 nodes замість 131, але `tsx` лишився ідентичним; у другому graph зникли 9 descendants двох links і navbar logo. Причину залежності graph від поточного engine state потрібно окремо локалізувати; не вважати її доведеною лише за різницею counts.

Bundle із 17 файлів дублюється в `files`, `bundle.files`, `data.files`, `data.bundle.files`; page TSX теж повторюється. Це роздуття та ризик розсинхронізації версій.

**Виправлення:** одна normalized model; єдиний files table і manifest references. Різні режими можуть мати різний обсяг, але однаковий зміст спільних сутностей.

### F08 P1 Втрачаються masters variants props і зв’язки

В актуальному output ProjectCard має 2 states проти 5 у живому Framer; UnderlineLink 2 проти 6; OpacityLink 1 проти 2 у старішому raw. Navigation Link, Underline Link Line In, Form Button із бібліотеки взагалі не мають відповідних output master файлів. Логотип частково відтворено жорстко заданим текстом WALKER.

Generic unwrap уже краще за попередню версію: remaps descendants, копіює widthType/heightType, шукає variant за ID та обходить nested clone. Але props досі прив’язані до конкретних назв, source IDs та control IDs Walker; selected root instance не проходить той самий resolver, а власні width/height/placement overrides не копіюються повністю. Scope cache keyed лише scopeId, без project/branch/revision.

**Виправлення:** import master graph + ВСІ variants + typed props + nested instance refs + connections; labels і stable IDs окремі. Підтримка одного скопійованого instance означає master/dependencies closure, а не всю Home або всі невикористані компоненти проекту.

### F09 P1 CMS має зламані references та неправильну семантику списків

Нові rows мають `_id:'item_<sourceId>'`, але category/services/next_projects зберігають старі source IDs. У наданому bundle 31 таке значення не резолвиться. Reference schemas не мають `referenceCollection`. Enum/URL/color/date/metadata options ігноруються або зводяться до text; timestamps замінено поточним часом.

`expandRepeaters` бере `children[0]`, `collectionLimit || 4`, `items.slice(0,limit)` та примусово задає 2 колонки й gap 32. Filters/sort/source repeated item/visibility не виконуються. `collectionLimit:0` перетворюється на чотири записи — відтворено тестом. Native source має 4 featured із 6 Works, але це не загальне правило для всіх списків.

**Виправлення:** two-pass IDs/references, typed schemas, справжній query/list plan та bindings. Static snapshot — лише явний fallback; не називати його редагованим CMS repeater.

### F10 P1 Посилання виглядають як links але не переходять

У generated UnderlineLink і OpacityLink є prop `href`, але в JSX немає ані `Link`/`a`/`MotionLink`, ані прив’язаного href: це motion.div + motion.p. Page instances не передають початкові `/contact` і `/works`. Перевірка Oracle цих компонентів проходить, але семантика навігації втрачена.

**Виправлення:** переносити semantic link entity, href/page target/anchor/newTab/rel. Internal dynamic href — відповідний Next Link dialect; literal external/mailto/tel — нативна підтримувана форма. Не перетворювати every visual link на p із cursor:pointer.

### F11 P1 Назви та literal text пошкоджуються

Clipboard `name` може зберегтися, але `generateRevymeJsx` не виводить `data-name`. Raw htmlTag також не зберігається для звичайних frames. `JSON.stringify(text).slice(1,-1)` не є escaping JSX child: `A < B & {price}` породжує синтаксичну помилку. Regex HTML strip губить spans, breaks, entities, inline marks та links. Усі heading tags вибирають Heading1 preset, а не власний H1–H6.

**Виправлення:** AST literal children; DOM/HTML parser для rich text; окремі identity/name/content/semantic tag; нормалізовані text presets без довільної підміни тегів.

### F12 P1 Не зберігаються source animations і overlay graph

У live template знайдено OverlayNode `X4UGyYdbv`: dismissible backdrop, transitions 1/1.4 s, zIndex 7, blockDocumentScrolling. У bundle немає native overlay markers, connections, split-text markers або video tag. Жорстко створені hover/variant handlers не доводять перенесення початкової поведінки. Body slot імітується за відомим ID `BSzLGVDiP`; це не загальний slot resolver.

**Виправлення:** explicit effect/overlay/connection/slot entities; mapping source trigger IDs до target IDs; generated dialect/runtime та parse-back check. Параметри, яких немає в публічному MCP schema, не вигадувати — використати native generator у planner або додати вузьку операцію.

### F13 P1 Пресети не є повноцінними shared styles

`extractAndGeneratePresets` примусово застосовує Zalando Sans до всіх text styles, бере перший CSS rule, групує однойменні styles за порядком як desktop/md/sm та задає власні breakpoint thresholds. Стилі з різними source IDs/папками можуть мати однаковий slug; Unicode names можуть зійтися в `preset`. Dark colors та всі typography tiers не зберігаються.

**Виправлення:** ID registry і source style graph. TextStyle → typography preset, ColorStyle → token із darkValue. Revyme border/shadow/radius/spacing presets не можна вигадувати як нібито готові Framer entities: переносити існуючі значення; compound preset створювати лише коли source містить відповідну shared definition або окремо узгоджене правило виведення.

### F14 P2 Geometry і responsive overrides частково hardcoded

Видаляється будь-який node із name Spacer; для відомих IDs примусово змінюються layout, grid, margins і text. Position завжди relative; opacity/transform/visibility, wrapping, advanced sizing та anchors неповні. Responsive style blocks у canned page не читають source breakpointOverrides, `_deleted` та itemsOrder. Порожні children replica не означають порожню сторінку.

**Виправлення:** source layout resolver із parent axis, numeric type semantics, inherited overrides і explicit deletion. Дозволити справжній 1px layer; не виправляти Fill heuristic за самим числом 1. `''` у target styles — видалення властивості, а не raw порожній рядок для всіх source значень.

### F15 P2 Нестабільне завантаження та asset pipeline

`timeout(c.load(),300)` може завершитися без loaded даних, failure приховується; collector не доводить dependency completeness. Root snapshot береться до preload, не завжди повторно після завантаження scopes. Cache не містить provenance/revision.

Assets локалізуються regex лише для частини `/images/*` extensions, без videos/files/fonts/srcSet, без загального content hash registry. Завантажені URLs замінюються у files/tsx, але не у clipboard nodes. Upload виконується ще до остаточного підтвердження валідності import. Помилка може залишити orphan uploads.

**Виправлення:** explicit loaded/missing/error, bounded retry/cancel, fresh snapshot після closure, asset plan із stable hashes та cleanup на невдачу. Жодного false success при недоступному font/module/image.

## 5 Що вже виправлено порівняно зі старою версією

Потрібно зберегти: унікальні descendant IDs у поточному зразку; `data-id=root` та `@canvas` у generated page; envelope pass-through у builder; variant lookup by ID; часткове parent-axis Fill mapping; recursive nested unwrap; окремі CMS files; token/typography CSS; template file bundle. Ці покращення не скасовують defects F01–F15 і не повинні регресувати при видаленні Walker hardcode.

## 6 Матриця конвертації

Позначення поточного стану: **частк** — загальний mapping неповний; **макет** — створюється заготовка Walker, не перенесення source; **немає** — немає загального шляху; **дефект** — підтверджено неправильну обробку; **fixture** — функція відсутня у досліджених source зразках і потребує окремої перевірки. Наявність target API означає доступний механізм Revyme, не автоматичний 1:1 parity.

У колонці «Revyme» названо чинні MCP v2 operations або прямо вказано native generator. Власні нові operation names не видаються за існуючий API.

### 6.1 Identity і структура

| ID | Framer | Початкові дані | Revyme | Зараз | Перевірка |
|---|---|---|---|---|---|
| I01 | Один frame або група | FrameNode children | nodes.create, fragments.insert | частк | Тип, порядок, geometry, source provenance після reopen |
| I02 | Кілька вибраних roots | selection roots | fragments.insert, paste engine | дефект | Два roots лишаються двома, жодного first-root-only |
| I03 | Ім’я шару | name | nodes.update, data-name | дефект | Українські, Unicode, slash і однакові labels з різними IDs |
| I04 | Текстовий вміст і label форми | html, text, form attributes | text.set, forms.field.update | частк | Назва шару не підміняє текст і accessible label |
| I05 | Семантичний tag | htmlTag, actual text tag | fragments.insert, nodes.update | дефект | header/nav/main/footer/h1–h6/button зберігаються |
| I06 | ID parent children references | id, parentid, children | native ID registry та parser | частк | No duplicates, cycles, orphan refs; repeat paste із новими instance IDs |
| I07 | Locked та editor hidden | locked, visible | native node metadata та visibility dialect | частк | Lock не стає display:none; inherited visibility перевіряється окремо |
| I08 | Editor-only settings | guides, exportOptions, previewSettings | guides.set або provenance metadata | fixture | Не породжувати видимий HTML із службових записів |
| I09 | Папки library | asset paths, stylePathByStyleId | folders.create, folders.moveItem, presets.folders.create | немає | Відновлення ієрархії без slug collisions |

### 6.2 Розміри layout і paint

| ID | Framer | Початкові дані | Revyme | Зараз | Перевірка |
|---|---|---|---|---|---|
| L01 | Fixed width і height | value плюс sizing type | styles.set, layout.set | частк | Не переносити size без його type; custom instance size зберегти |
| L02 | Fit Hug content | widthType heightType та intrinsic | native Fit dialect, styles.set | частк | Ріст від контенту без 0px collapse або штучного px |
| L03 | Fill по main axis | parent flex direction, fill weight | layout.set та native flex helpers | частк | Пропорційні 1fr/2fr, не width:100% у кожного sibling |
| L04 | Fill по cross axis | alignment, stretch, fill cell | styles.set | частк | Column width Fill не змінює flex-basis висоти |
| L05 | Relative percentage | relative sizing enum/value | styles.set | fixture | 25%/50%/100% зберігають parent dependency |
| L06 | Viewport units | viewport mode, vh/vw | styles.set та root-size Oracle | fixture | Viewport height на section, не на artboard root |
| L07 | Min Max constraints | minWidth/maxWidth/minHeight/maxHeight | styles.set | немає | Поведінка при resize та невідомі enum значення |
| L08 | Aspect ratio | aspectRatio, intrinsic media | styles.set | частк | Ratio з image/video та independent width/height |
| L09 | Horizontal і vertical stack | stackDirection alignment distribution | layout.set | частк | Усі align/distribution modes, baseline і stretch |
| L10 | Wrap і gap | stackWrapEnabled, gap | layout.set, styles.set | немає | Wrapping, row/column gap, px та двозначний gap |
| L11 | Padding margin по сторонах | paddingPerSide, edge values | styles.set | частк | Shorthand/longhand не суперечать Oracle |
| L12 | Grid tracks і rows | grid counts, minmax, fixed/auto rows | layout.set, styles.set | макет | Source tracks, не завжди repeat(2,1fr) |
| L13 | Grid spans та alignment | rowSpan, columnSpan, fillCell, item align | styles.set | немає | Довільний span і reorder без зміни source layout |
| L14 | Порядок flow children | itemsOrder, children order | nodes.reorder та quoted CSS order | частк | Різний порядок на breakpoint/variant |
| L15 | Absolute і anchors | position, left/right/top/bottom, centers | styles.set та pinned dialect | дефект | Позиція після drag/reopen не змінює anchor |
| L16 | Fixed і sticky | position, scroll context | native positioning generators | немає | Урахувати заборону fixed усередині component master |
| L17 | Z index stacking context | zIndex, transforms, overlays | styles.set та overlay runtime | немає | Overlay не ховається під iframe/clipping parent |
| L18 | Solid і themed fill | fillEnabled, fillType, ColorStyle | tokens.set, styles.set | частк | Enabled/type і darkValue збережені |
| L19 | Linear radial conic gradient | gradient geometry, stops | styles.set та gradient helpers | немає | Stops offset/alpha/angle, не неактивні defaults |
| L20 | Image fill | image asset, resize, focal point | media.image.set або background styles | частк | Cover/contain/focal/repeat та source type |
| L21 | Radius | per-corner, relative radius | styles.set, presets.set | частк | Кожен corner та percentage відносно правильної box |
| L22 | Border | enabled, per-side, width/color/style | styles.set, presets.set та border-overlay generator | частк | Outside/inside overlay і side differences |
| L23 | Shadow blur filters | multiple shadows, filters | styles.set, presets.set | немає | Inset/multiple shadow, opacity та backdropFilter |
| L24 | Transform і opacity | rotation scale skew origins | styles.set, motion.set | немає | Не плутати static transform з animated values |
| L25 | Overflow clipping scrolling | overflow visible/hidden/clip/scroll | styles.set | частк | Clip не підміняється scroll container; content доступний |
| L26 | Spacer як справжній елемент | name та geometry | nodes.create | дефект | Layer із name Spacer не видаляється за назвою |

### 6.3 Текст типографіка та shared styles

| ID | Framer | Початкові дані | Revyme | Зараз | Перевірка |
|---|---|---|---|---|---|
| T01 | Plain і rich text | html, rawHtml | text.set та native rich-text dialect | дефект | Entities, braces, angle brackets, quotes, newline |
| T02 | Inline spans links marks | HTML runs, bold/italic/underline | text.set та parser-compatible rich text | немає | Незалежні стилі runs лишаються редагованими |
| T03 | Semantic heading styles | H1–H6 та p preset IDs | typography.set, typography.apply | дефект | H2 не прив’язується до Heading1 |
| T04 | TextStyle як shared preset | TextStylePresetNode, source ID | typography.set, typography.apply | частк | Один preset керує всіма usages; збережені labels/папки |
| T05 | Typography breakpoints | minWidth, style breakpoints | typography.set responsiveTiers | дефект | Семантика source tiers; більше target tiers потребує explicit policy |
| T06 | Font family source | font descriptor, font selector | fonts.import, fonts.workspace.add | дефект | Inter та власний font не замінюються Zalando Sans |
| T07 | Font weight variation axes | font metadata, VF axes | native font/typography helpers | частк | Variable weight, width, italic, bold variants |
| T08 | Custom font faces | font files, format, weight range | fonts.workspace.add, fonts.preload | fixture | Asset доступний після publish, немає silent fallback |
| T09 | Line height і letter spacing | unit/value та actual font size | typography.set та line-height normalization | частк | em/px/%/normal, не strip suffix для всіх одиниць |
| T10 | Paragraph text alignment | paragraphSpacing, alignment, transform | typography.set, styles.set | частк | Lists, vertical align, balance/wrap, no-wrap |
| T11 | Fit Text | textFitScale, viewBoxSize | native fit-text-gen.ts | макет | Exact editable Fit contract, не довільний clamp WALKER |
| T12 | OpenType features | feature tags, selectors | styles.set та typography supported values | немає | Лігатури/features не губляться через regex |
| T13 | ColorStyle light/dark | ColorStyleTokenNode, light, dark | tokens.set darkValue | частк | Два Black з різними IDs не зливаються |
| T14 | Style/token usage refs | variableReference, token IDs | tokens.set, typography.apply, presets.apply | частк | Редагування token оновлює usage, без зайвих baked overrides |
| T15 | Border shadow radius spacing presets | source shared definition або per-node values | presets.set, presets.apply | fixture | Не видавати inferred compound preset за source entity |
| T16 | Token rename та collisions | source IDs, names, folders | tokens.rename та import namespace | немає | Unicode names і повторні imports зберігають identity |

### 6.4 Сторінки шаблони та responsive

| ID | Framer | Початкові дані | Revyme | Зараз | Перевірка |
|---|---|---|---|---|---|
| P01 | Поточна page і path | page ID, publish path | pages.create, pages.update | дефект | Не завжди перша Home; /works і /contact відрізняються |
| P02 | Page pair server/client | client body і metadata | pages.create та page generators | частк | Зберегти metadata server wrapper при replace client |
| P03 | Artboard root та config | primary breakpoint width/height | viewports.setOverride, canvas-config serializer | частк | root, @canvas та фактичні source widths |
| P04 | Template / Layout | LayoutTemplateNode, layout chain | templates.create, templates.assign | макет | Template reuse, children slot і page inheritance |
| P05 | Template props | Footer Visible, page overrides | template/component prop dialect | макет | False не підміняється true; кожна page має свої props |
| P06 | Body slot | SlotNode та slot identity | template children або slots.connect | частк | Template body slot відрізняється від code-component slot |
| P07 | Nested templates | parent layout chain | templates.create та native route groups | fixture | Не брати перший layout з Object.values |
| P08 | Breakpoint replicas | replicaInfo, breakpointOverrides | viewports.setOverride та native band resolver | макет | Base inheritance, null/delete, range boundaries |
| P09 | Responsive order/visibility/variant | itemsOrder, visible, control variant override | native responsive/variant generators | немає | Перестановка і Mobile Pressed не губляться |
| P10 | Page metadata SEO | webMetadata, social images, language | metadata.update, seo.setSchemaOrg | немає | Title/description/noindex/OG/path зберігаються |
| P11 | Page transition | globalPageEffect, page override | siteEffects.pageTransition.set | немає | From/to, duration/ease, native transition contract |
| P12 | CMS detail page | collection identifier, route field | cms.pages.createDetail, cms.pages.seo | немає | Dynamic route resolvable; не лише статична Home |
| P13 | Site settings redirects | settings/custom code/redirects | redirects.add, customCode.set | fixture | Окремий project scope, не побічний ефект selection paste |

### 6.5 Компоненти props variants і slots

| ID | Framer | Початкові дані | Revyme | Зараз | Перевірка |
|---|---|---|---|---|---|
| C01 | Design master | SmartComponentNode / ComponentNode | components.create та native master emitter | макет | Реальний master tree, не canned Logo/Card |
| C02 | Instance master reference | canvasComponent identifier | components.instance.create | дефект | Instance лишається компонентом, без expanded children у clipboard |
| C03 | Окремий root instance | selected CodeComponentNode | components.instance.create та dependency collector | дефект | Одна вибрана кнопка не стає порожнім div або цілою Home |
| C04 | Nested design instances | master dependency graph | components.instance.create, slots.connect | частк | Topological import, cycles відхиляються до commit |
| C05 | Всі component variants | IDs, labels, primary, inheritance | variants.create, variants.rename | дефект | Six source states лишаються шістьма, labels не є IDs |
| C06 | Hover pressed interaction variants | gesture state parent | variants.create interaction, connections.create | макет | Mobile Pressed і leave/reset зберігаються |
| C07 | Instance initial variant | control variant ID | components.instance.props.set | частк | Mapping source ID → target name, після refresh |
| C08 | Layout differences між variants | width,height,padding,order,visibility | native inline variant ternaries | частк | Parser читає усі branches; layout не в motion paint object |
| C09 | Paint differences між variants | opacity,color,shadow,transform | motion.set та variant paint objects | макет | motion tags, complete state entries, правильний transition |
| C10 | Typed props та friendly labels | variables, controls, metadata | components.variables.create, components.instance.props.set | частк | Name/type/default/options/min/max/step та UI editability |
| C11 | False zero empty null | provider value resolution | typed resolver та native prop binding | дефект | false,0,empty string не стають unresolved objects |
| C12 | Enum та variant choices | enum options, custom labels | prop-meta та variant metadata | частк | Невідомий option має warning, не перший варіант |
| C13 | Image file link color props | typed $control values | components.instance.props.set та media/links operations | частк | Value type і dependency references зберігаються |
| C14 | Connections state machine | onTap, control event handlers | connections.create, connections.list | немає | Trigger source/from/to/delay/gated setter round-trip |
| C15 | Code components | external/local module descriptor | codeComponents.create, codeFiles.submit | немає | Adapter або supported self-contained source, не виконання arbitrary module |
| C16 | Code property controls | Framer Property Controls | @controls та codeComponents.create | fixture | Types/defaults/arrays/groups/fonts/slots, без silent omission |
| C17 | Slots і passed children | slot definitions/content/connectors | slots.list, slots.connect, slots.reorder | немає | Два slots, порядки, native dependency IDs |
| C18 | Overrides | codeOverrideEnabled, module export | overrides.create, overrides.set | немає | Окремий override contract; довільна логіка не гарантовано portable |
| C19 | Library unavailable master | remote source module, unloaded scope | dependency report та adapter policy | дефект | Missing master блокує точний import, не fallback на чужий cache |
| C20 | Cache та повторний import | source project branch revision | source manifest hash/mapping | немає | Однакові scopeIds у різних проектах не змішуються |

### 6.6 Анімації ефекти та оверлеї

| ID | Framer | Початкові дані | Revyme | Зараз | Перевірка |
|---|---|---|---|---|---|
| A01 | Appear enter | enterEffect enabled/from/transition | motion.set initial/whileInView/transition | немає | Threshold/once/delay та viewport context перевірити окремо |
| A02 | Exit | exitEffect, lifecycle | motion.set exit та AnimatePresence dialect | немає | Exit має mount/unmount semantics, не просто записаний object |
| A03 | Hover tap animations | gesture targets | motion.set whileHover/whileTap | макет | Source values, а не стандартний hover scale для всіх |
| A04 | Tween spring transitions | ease bezier, mass, damping, stiffness | motion.set transition та native serializer | частк | Не всі поля є у публічному schema; жодних вигаданих args |
| A05 | Scroll appear direction replay | styleAppearEffect fields | native scroll generators та motion dialect | немає | Direction/threshold/once/source section resolution |
| A06 | Scroll transforms parallax | scroll progress, ranges, offsets | native generator-motion-scroll-fx.ts | fixture | MCP motion.set не є повним scroll timeline API |
| A07 | Loop repeat reverse | repeat, delay, loop descriptor | native data-loop dialect, motion generators | fixture | Native marker, cleanup і reduced motion |
| A08 | Text effects chars words lines full | text effect settings | textEffects.set | немає | Split/mask/stagger/from/replay зберігаються |
| A09 | Text effects scroll/section | section refs, scroll range | textEffects.set та text-anim-gen.ts | fixture | Public schema не охоплює кожен внутрішній config key |
| A10 | Stagger child sequences | child index/order, effect delays | native motion/text effect generators | немає | Sequence targets і timing не стають однаковими |
| A11 | Smooth scroll | known module plus controls | siteEffects.smoothScroll.set | немає | Параметри і page scope, native publish runtime |
| A12 | Custom cursor | cursor component refs, controls | siteEffects.cursor.set | fixture | Курсор component dependency, size/offset/visibility |
| A13 | Glide/inertia | glide effect configuration | siteEffects.glide.set | fixture | Конвертувати лише відповідну source semantics, не за назвою |
| A14 | Fixed modal overlay | OverlayNode backdrop/scroll lock | overlays.create, overlays.update | немає | Trigger, escape/outside dismiss, stacking, scroll lock |
| A15 | Relative popover/dropdown | trigger anchor, placement/collision | overlays.create type relative | fixture | Side/align/offset, collision і responsive config |
| A16 | Overlay enter/exit backdrop | separate transitions, fill enabled | native overlay-gen.ts та motion operations | немає | Неактивний backdrop не стає видимою заливкою |
| A17 | Overlay close actions | close button/outside/escape/delay | overlays.close, connections.create | немає | Доступність, focus return, nested overlays |
| A18 | Animation reduced motion | site setting/user preference | native runtime reduced-motion handling | fixture | Не запускати постійний loop при reduced motion |

### 6.7 CMS media navigation forms та інші домени

| ID | Framer | Початкові дані | Revyme | Зараз | Перевірка |
|---|---|---|---|---|---|
| D01 | CMS collections schemas | CollectionNode variables | cms.schema.create, cms.field.add | частк | Усі типи, options, required/default, referenceCollection |
| D02 | CMS records identity/status | CollectionItemNode, created/updated | cms.items.create, cms.items.update | частк | Preserve data і source timestamps, не змінювати статус усім |
| D03 | Reference multi-reference | collection target, record IDs | two-pass CMS mapping | дефект | 31 dangling references у Walker мають зникнути |
| D04 | Repeater template і query | collectionRepeatedItemId, filters/sort/limit | cms.list.create, cms.list.configure | дефект | Correct template, limit 0, sort, AND/OR, empty results |
| D05 | CMS text/media/component bindings | provider field refs, row context | cms.field.bind | частк | Однаковий master із різними row values |
| D06 | Computed values expressions | computedValue transforms/isSet | expressions.bind та supported expression dialect | дефект | Type-aware false/0/null, supported AST only |
| D07 | Pagination search filters | list config, input bindings | cms.list.paginate, cms.api.searchField.setVariable | fixture | State/input/query синхронні, source limits |
| D08 | CMS API/fetch data | source request descriptor | cms.api.collection.set, cms.api.queryConfig.set | fixture | Credentials не переносити як public source literals |
| D09 | Raster images | assets metadata, alt, dimensions | assets.upload, media.image.set | частк | Asset bytes/hash/alt/srcSet/objectFit |
| D10 | Video poster/audio | file controls, visibility | media.video.set; audio adapter/native element | немає | Studio Altera має video/poster, не випадкове фото |
| D11 | SVG vectors icons | SVGNode, markup, paths, viewBox | shapes.addChild, shapes.replaceInner, vectors.createSet | fixture | Унікальні SVG IDs, attributes vs CSS, paths editable |
| D12 | Drawing animations | stroke progress/path animation | drawing.sketchAnim.set | fixture | Лише сумісна native semantics, не підміна SVG screenshot |
| D13 | Lottie embeds custom modules | known module controls | catalog.place або explicit code adapter | fixture | Окремий capability entry для кожного module type |
| D14 | Links routes anchors external | link, new tab, page path map | links.set | дефект | mailto/tel/anchors/internal route і history navigation |
| D15 | Forms inputs selects buttons | Form nodes, destinations, states | forms.create, forms.field.add, forms.destination.set | немає | Labels/name/validation/required/type; не div замість form |
| D16 | Form loading success error | variants, submit state transitions | forms.submitButton.add, forms.state.map | немає | Form Button 7 states зберігають native submission lifecycle |
| D17 | Localization RTL | locales, translated text/styles/props | locales.add, translations.set, translations.instanceProp.set | fixture | Default і locale refs не bake в одну мову |
| D18 | Page variables bindings | variables and values | variables.create, variables.bind | немає | Typed defaults та explicit uses після round-trip |
| D19 | Page interactions | event → supported state/action | pageInteractions.add | fixture | Зберігати лише supported native actions |
| D20 | Comments rulers guides | editor metadata | comments.create, guides.set | fixture | Окремий opt-in editor scope, не візуальні nodes |
| D21 | Breakpoints за межами Walker | custom range count/design width | native breakpoint ladder та viewports.setOverride | fixture | Actual ladder, не завжди 1200/810/390 |
| D22 | External integration/custom logic | module source/network behavior | adapter або explicit unsupported report | немає | Немає обіцянки автоматичної конвертації довільного React |


### 6.8 Додаткові нюанси які легко пропустити

| ID | Framer | Початкові дані | Revyme | Зараз | Перевірка |
|---|---|---|---|---|---|
| L27 | Masks та clip paths | Mask geometry, image/gradient mask | styles.set та native Mask/ClipPath controls | fixture | Source mask не стає просто overflow:hidden; зберегти SVG defs |
| L28 | Blend modes та isolation | mixBlendMode, stacking backdrop | styles.set та style preflight | fixture | difference має явне target обмеження; не підміняти його solid fill мовчки |
| L29 | 3D perspective backface | perspective, rotate3d, origins | native styles/motion transform dialect | fixture | Порядок transform functions, canvas/preview parity |
| L30 | Кілька paint layers | Fill stacks, overlays, gradients/images | native styles або explicit supported decomposition | fixture | Зберегти paint order/alpha; unsupported complex fill позначити |
| T17 | Text stroke та gradient text | stroke width/color, background clip | native text/styles controls і Oracle | fixture | Semantic text лишається текстом, не baked bitmap |
| D23 | Accessibility | aria, role, tabindex, labels, alt | semantic fragment/attributes/forms dialect | немає | Keyboard navigation, accessible name, не лише visual label |
| D24 | Carousel ticker marquees | Known module, items, slots, controls | catalog.place, slots.connect та native ticker-gen.ts | fixture | Source order, loop/direction/pause, не звичайний flex row |
| D25 | Dynamic date/year values | Variable/expression/module override | variables.bind, expressions.bind або explicit adapter | fixture | Copyright year не заморожувати довільно; зберегти source semantics |
| A19 | Drag та складні gestures | Gesture constraints/snap/state | native supported interaction або code adapter | fixture | Відсутній generic MCP trigger не означає дозвіл на arbitrary handler |
| A20 | Scroll sections snap anchors | Section refs, scroll target, snapping | links.set та native scroll generators | fixture | BackToTop/section target існує після remap |
| P14 | Robots sitemap redirects | Site/page settings, localized routes | seo.setRobots, seo.syncSitemap, redirects.add | fixture | Окремий project scope, не змінювати при selection copy |
| C21 | Transitive module dependencies | Local/remote imports та exports | native component dependency bundle або unsupported | частк | Missing imports, cycles, runtime exports та publish build перевірено |

Матриця містить **136 сценаріїв**. Кожен потребує власного capability status і regression fixture; count підтриманих сценаріїв не можна визначати кількістю згенерованих файлів.
## 7 Цільовий протокол і проміжна модель

### 7.1 Одна авторитетна source модель

Наведені нижче інтерфейси — запропонований контракт реалізації, не назви вже наявних функцій.

```ts
type CopyScope = 'selection' | 'page' | 'library';
interface FramerSourceEnvelope {
  format: 'framer-source';
  version: 1;
  copyId: string;
  scope: CopyScope;
  source: {
    projectId: string;
    branchId: string;
    revision?: string;
  };
  selection: { rootIds: string[]; pageId?: string };
  rawSnapshot: unknown;
  resources: {
    masters: Record<string, unknown>;
    templates: Record<string, unknown>;
    collections: Record<string, unknown>;
    styles: Record<string, unknown>;
    assets: Record<string, unknown>;
  };
  completeness: { complete: boolean; missingIds: string[] };
}
interface ConversionDiagnostic {
  severity: 'error' | 'warning' | 'info';
  code: string;
  sourceId?: string;
  sourcePath: string;
  message: string;
}
interface PlannedFile {
  path: string;
  content: string | null;
  beforeHash: string | null;
  kind: 'page' | 'template' | 'design' | 'code' | 'server' | 'data' | 'css';
}
interface FramerConversionPlan {
  sourceSnapshotHash: string;
  targetProjectId: string;
  targetBranchId: string;
  baseRevision: number;
  files: PlannedFile[];
  diagnostics: ConversionDiagnostic[];
  entityMap: Record<string, string>;
  lossyConversions: string[];
}
```

Transport request обгортає envelope: `{type:"REVYME_IMPORT_FRAMER",requestId,targetScope,source}`. `copyId` ідентифікує незмінний clipboard artifact; `requestId` створюється для кожного окремого paste gesture. Доставка одного gesture кількома каналами/повтор після timeout використовує той самий requestId; навмисне друге Ctrl+V має новий requestId і повторює вставку того самого copyId.

`unknown` дозволено на source boundary, але після decoder кожен підтримуваний домен має discriminated union/typed representation. Це не дозвіл поширювати `any` до generators. Для старого `{revymeClipboard:1,...}` потрібен explicit legacy decoder і строгий graph/file validation; його не проганяти повторно як raw tree.

Нормалізована модель містить окремі namespaces: nodes, render roots, pages, templates, design masters, code modules, variants, connections, slots, overlays, color styles, typography, CMS schemas/items/queries/bindings, assets та effects. Source-to-target mapping keyed `(sourceProjectId, sourceBranchId, sourceEntityId, entityKind)`; label не є ключем identity.

### 7.2 Послідовність конвертації

1. Розпізнати формат, версію і scope. Зберегти незмінний raw snapshot/debug export.
2. Відокремити render selection від dependency roots. Замкнути лише потрібні dependencies; full library — окремий scope.
3. Нормалізувати arrays/maps, values, inheritance, providers, replicas й `_deleted` без втрати provenance.
4. Виділити всі сутності та source references. Побудувати dependency DAG; відхилити нерозв’язні цикли.
5. Виділити target IDs/paths для всіх сутностей до генерації. Розв’язати collisions і references двома проходами.
6. Згенерувати tokens/fonts/presets/CMS/masters, потім templates/pages/instances, потім зв’язки та ефекти через native systems.
7. Виконати syntax, Oracle за kind, import/reference/schema/graph/capability перевірки на projected tree.
8. Перепарсити результат і порівняти його normalized semantics із source: labels, values, variants, records, connections, effects.
9. Підготувати atomic commit із перевіркою target project/branch/base revision; assets завантажувати/фіналізувати в керованій операції.
10. Commit, read-back, selection/UI update, receipt. При failure — unchanged project і жодного success toast.

### 7.3 Правила fallback

- **Faithful native:** повна відповідність у підтримуваному editable dialect; основний режим.
- **Declared approximation:** задокументована різниця з конкретним sourceId/feature, без прихованого видалення. Користувач бачить її до commit.
- **Static snapshot:** явний окремий результат; втрата masters/CMS/behavior не називається native import.
- **Unsupported:** відмова для відповідної сутності або всього faithful import, збережений raw і пояснення. Не вставляти порожній div із повідомленням про успіх.

Перелік capability records: source feature, extraction route, normalization rule, target mechanism, validator, fixture ID, статус `verified/partial/unsupported/unobserved`. Новий невідомий class або активний непідтримуваний field додає diagnostic, а не непомітно ігнорується.

## 8 Валідація і межі MCP

### 8.1 Перевірений registry

Використано чинний CLI, який виконує ті самі registered operations, що MCP v2. `meta.index` має 282 записи на 3 сторінках; `meta.tools` повернув schemas усіх 282. Для read-only викликів задано явні project/branch IDs.

Основні доступні домени: pages/templates/nodes/layout/text/styles/viewports; tokens/presets/typography/fonts; components/variants/connections/slots; overlays; media/assets/vectors/shapes/drawing; motion/textEffects/siteEffects; CMS schemas/items/bindings/pages/API; variables/expressions/pageInteractions; localization/forms; diagnostics/observe/verify; workflow.batch/plans.commit/history.

**Не плутати рівні підтримки:** `components.create` schema підтримує props string/number/boolean/color/image, але не довільний Framer property control. `motion.set` дозволяє сім motion props і string-valued values, а не будь-який scroll timeline. `textEffects.set` schema не експонує всі поля внутрішнього TextAnimConfig. Overlay API також має менше полів, ніж внутрішній responsive overlay config. Для gap потрібен підтримуваний native generator у planner або вузьке доповнення операції, а не вигаданий JSON argument.

Перед реалізацією використовувати `meta.tools --name <operation>`, а не лише назви з цього документа. `fragments.insert` — native layout insertion; codeFiles.submit не є обходом для довільного page code. Для багатофайлового plan можна перевикористати preparation/validation mechanisms automation-core і workflow.batch; мережевий MCP server не обов’язково повинен бути runtime dependency browser extension.

### 8.2 Перевірки за типом файла

| Вид файла | Перевірка | Не застосовувати |
|---|---|---|
| Editable page client | `checkFile(kind:'page', path, projectFiles)` + page root/canvas/template rules | Code-component exemptions |
| Template LayoutClient | `checkFile(kind:'template', ...)` + children slot і assignments | Вимогу, що це звичайна page |
| Design master | `checkFile(kind:'component', ...)` + variants/connections/props parse-back | Black-box code-component fallback для простого layout |
| Code component | Власний code component dialect, @controls, imports/runtime | Page root/data-id на всіх внутрішніх елементах без урахування виду |
| Server page/layout | TSX syntax, Next server imports, metadata/children delegation | Canvas data-id/root/variant правила |
| CMS schema/data | Typed fields/options/references/record status та IDs | Oracle як заміну JSON schema і relational validation |
| CSS/tokens/fonts | CSS parse, token references, themes, preset compatibility | Просту перевірку на наявність `:root` |
| Assets/modules | MIME/bytes/hash/URLs, dependency availability, supported adapter | Виконання невідомого source module для «перевірки» |

### 8.3 Реальний результат Oracle над новим bundle

| Файл | Порушень | Коди |
|---|---:|---|
| `components/NavigationBar.tsx` | 14 | COMPONENT_FIXED_PROHIBITION 1; PIN_VALUE_NOT_PX 3; BARE_ANIMATE_OBJECT 1; FORBIDDEN_INDIRECT_VARIANT_CHECK 1; FLEX_CHILD_MISSING_ORDER 3; FLEX_CHILD_SHRINKS 3; CONDITIONAL_RENDER_UNSUPPORTED 1; TEXT_STYLE_ON_FRAME 1 |
| `app/(global-navigation)/LayoutClient.tsx` | 1 | CONDITIONAL_RENDER_UNSUPPORTED |
| `app/(global-navigation)/page.client.tsx` | 1 | TEMPLATED_PAGE_ROOT_STYLED |
| Решта 5 editable component TSX | 0 | Це підтверджує dialect, не source fidelity |

Усі 16 тут tier 2; tier 3 у цьому новому зразку не зафіксовано. Server wrappers перевірено на syntax окремо. CSS/JSON не зараховано як «пройшли Oracle»: для них потрібні власні перевірки, і CMS reference перевірка вже знайшла 31 проблему.

Додатково статичний пошук у 36 non-test TypeScript файлах Oracle виявив 229 різних literal значень `code:`. Це інвентаризація явно записаних diagnostic codes, а не гарантована кількість усіх runtime правил. Число 216 в skill не слід використовувати як актуальний coverage denominator.

### 8.4 Перевірки відповідності джерелу

Oracle не ловить автоматично: вигаданий footer; шість source variants замість двох target; href prop без справжнього link; втрачені source names; неправильно вибраний page; default master props замість instance; altered CMS filter; source color themes; нову непов’язану сторінку замість selection.

Потрібні окремі semantic assertions. Наявні `framer-oracle.test.ts` містять копії великих code strings. Після зміни emitter ці тести можуть залишитися зеленими. Тести мають викликати actual extractor/converter над fixtures, потім перевіряти його реальний output, парсер і Oracle. Source snapshot і expected результат не обчислюються тим самим mapper.

## 9 Файлова карта реалізації

### Extension

- `content.js`: залишити entrypoint/збирання browser context; прибрати canned TSX і конкретні Walker IDs.
- Новий `framer-source.js`: generic scope/selection extractor і serialized raw envelope.
- Новий `framer-relay.js`: ISOLATED storage/message relay, не змішувати з MAIN engine access.
- `manifest.json`: правильні execution worlds і порядок classic scripts; не розширювати permissions без потреби.
- `popup.js`, `revyme-injector.js`: один request/response client, чесні statuses, scope selector і raw export.
- Нові `tests/source.test.cjs`, `tests/transport.test.cjs`: фактичні entrypoint functions у VM/browser harness. Додати один простий test command; не вимагати нового framework заради існуючих vanilla scripts.

### Revyme

Під `src/code/import/framer/` створити: `payload.ts`, `normalize.ts`, `identity.ts`, `styles.ts`, `text-styles.ts`, `components.ts`, `effects.ts`, `cms.ts`, `media-links.ts`, `page-plan.ts`, `commit.ts`, доменні `.test.ts` та fixtures. Це межі відповідальності, не вимога окремого файлу для кожного з 136 рядків.

`src/canvas/framer-paste.ts` стає тонким UI adapter; `src/canvas/shortcuts.ts` лише розпізнає/передає payload. Не тримати другу конвертацію raw у UI файлі. Поточний `convert.ts` — сумісний facade над одним domain converter.

Повторно використати: native generators/parsers; `create-component-gen.ts`, `variant-config.ts`, `connection-config.ts`, `prop-meta.ts`, `fit-text-gen.ts`, `text-anim-gen.ts`, `overlay-gen.ts`, CMS/template/preset ops, component import helpers, `modifyProjectFile`, history snapshots, automation plan validation. Якщо helper обмежує nested instances/props, обмеження обходити спеціалізованим перевіреним emitter, а не спотворенням source.

## 10 Покроковий план впровадження

Кожна задача завершується власними tests і окремим reviewable commit. Загальний порядок: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11. Не вважати задачі 1–4 завершенням універсального importer.

### Task 1 Заблокувати небезпечний commit і дублювання дій

**Files:** `src/canvas/framer-paste.ts`, нові `commit.ts`/`commit.test.ts`; extension injector/popup/relay/manifest.
**Contract:** `prepareFramerImport(input, targetScope)` повертає лише план; `commitFramerImport(plan)` повертає receipt/result після всіх writes. Selection paste не створює/перемикає page. Протокол requestId один для всіх транспортів.

- [ ] Відтворити red tests F01/F02: invalid empty clipboard + attached file; templated page у selection paste; existing Logo/globals collision; failure посеред multi-file commit; revision conflict.
- [ ] Додати transport tests: одна дія через два events створює один request; false/timeout не success; MAIN не пише chrome.storage напряму; listener очищається при unmount.
- [ ] Перенести writes за validation, розмежувати modes; використати snapshot/history/rollback та safe existing-file writes; перевірити target scope і paths. При refusal snapshot до/після однаковий.
- [ ] Один Undo/Redo відновлює/видаляє всі files/entities; активна page та queue синхронізовані. До цього не тестувати імпорт у цінному проекті.

```ts
it('refuses without writing a single file', async () => {
  const before = projectFS.getSnapshot();
  const result = await prepareAndCommit(invalidSelectionEnvelope, targetScope);
  expect(result.ok).toBe(false);
  expect(projectFS.getSnapshot()).toEqual(before);
});
```

`prepareAndCommit` у цьому тесті — public test entrypoint нової commit pipeline; `invalidSelectionEnvelope` є fixture з empty nodes і attached template page із F01.

### Task 2 Уніфікувати decoder і версіонований source envelope

**Files:** `payload.ts`, `normalize.ts`, facade `convert.ts`, browser source/debug export.
**Contract:** `decodeFramerInput(value:unknown)` розрізняє native pasteboard, FramerSourceEnvelope та legacy Revyme envelope; не викликає generators до успішного decoder.

- [ ] Red tests для native object maps `stylePresetNodes`, color maps, assets, malformed HTML marker, single/double quotes/entities; зберегти всі roots.
- [ ] Пройти legacy envelope без повторної raw-конвертації; duplicate file locations із різним content відхиляти, а не вибирати перший непомітно.
- [ ] Нормалізувати map/array та зберігати version/provenance. DOM-based HTML marker parsing з discriminator, щоб не перехопити Figma/інший Revyme payload.
- [ ] Додати raw JSON export/debug download без модифікації source. Статус copied залежить від реального browser clipboard result.

```ts
it('accepts native preset maps', () => {
  const decoded = decodeFramerInput(nativeDesktopFixture);
  expect(decoded.styles.text.size).toBe(8);
  expect(decoded.renderRootIds).toEqual(['WQLkyLRf1']);
  expect(decoded.collections.size).toBe(3);
});
```

### Task 3 Зібрати залежності та правильний scope

**Files:** extension `framer-source.js`, source tests; Revyme dependency normalization.
**Contract:** `collectSource({scope,rootIds,pageId})` повертає fresh snapshot і completeness; source extraction залишається readonly.

- [ ] Fixtures: one frame, multiple selection, selected root instance, /works, Home, template, library, missing/lazy-loaded master, cyclic deps, disconnected engine.
- [ ] Завантажувати selected page/template/master/style/asset/CMS dependencies до замикання, дочекатися loaded state, потім повторно отримати snapshot. Timeout є diagnostic, не успіх.
- [ ] Відокремити layout SlotNode від component slot; резолвити actual page layout identifier, не `B1BOPR7cc` або перший layout.
- [ ] Cache keyed project/branch/revision/scope. Повторне відкриття майстра без зміни source не змінює normalized graph/hash.
- [ ] Видалити generic правила, що знають Walker IDs/text. Повторити live сценарій component page → Copy for Revyme: результатом є component selection, а не WalkerPage.

### Task 4 Відновити identity labels та generic layout

**Files:** `identity.ts`, `styles.ts`, їхні tests; refs у normalize.
**Contract:** `allocateTargetIds(model, targetSnapshot)` передує writes; `mapLayout(node, parentContext)` не виводить видимий контент за назвою source layer.

- [ ] Red fixtures I01–I09, L01–L26: duplicate labels, two instances, Unicode, spacer, fixed/relative/fill/hug/viewport, both axes, grid spans/wrap, anchors, overflow, themed fills/gradients/borders/shadows.
- [ ] Реалізувати source graph і namespace maps; semantic tag, `data-name`, explicit order і complete reference remap.
- [ ] Резолвити source type enums тільки на підтверджених fixtures; unknown enum повертає diagnostic. Перенести inherited breakpoints/itemsOrder/visibility/explicit deletion.
- [ ] Перепарсити generated nodes і порівняти semantic styles/labels, не точний формат JSON.stringify.

### Task 5 Типографіка fonts tokens і presets

**Files:** `text-styles.ts`, `text-styles.test.ts`, native typography/font/preset helpers.
**Contract:** style source ID → stable target preset/token name; inline overrides лишаються overrides, shared styles лишаються linked.

- [ ] Red fixtures: H1–H6, rich spans, entities, literal braces, links, fit-text, two fonts, custom font, variable axes, duplicate Black, themed color, same style name у різних folders, responsive tiers.
- [ ] Реалізувати HTML/AST literal text. Рядок `A < B & {price}` має відрендеритися буквально і пройти parse.
- [ ] Використати actual font metadata і native Fit, не clamp WALKER. Line height unit normalization обчислювати за source unit/fontSize, не strip усіх suffixes.
- [ ] Typography/token operations merge у globals, не замінюють увесь CSS. Після редагування preset у GUI змінюються всі зв’язані тексти; після detach — лише вибраний.

### Task 6 Design components і повний variant graph

**Files:** `components.ts`, `components.test.ts`, native master/variant/connection helpers.
**Contract:** кожен source design master має один target master; instance references не містять його expanded implementation; variants мають stable ID mapping і readable labels.

- [ ] Red fixtures із двома незалежними instances і різними props, nested instances, scope unavailable, six-state UnderlineLink та five-state ProjectCard.
- [ ] Згенерувати всі source states, inheritance, gesture states, placement overrides і typed props. Values беруться з instance/row/provider, потім defaults; `false/0/''` зберігаються.
- [ ] Зв’язки та triggers створювати через native connection dialect; layout ternaries і paint variants не змішуються. Перевірити `connections.list`, parsed conditional styles та Variables panel.
- [ ] Code component — окремий шлях із @controls і explicit adapter. Непідтримуваний module не породжує canned component із схожою назвою.

```ts
it('keeps the complete Project Card state graph', () => {
  const result = convertDesignMaster(projectCardSourceFixture);
  expect(result.sourceVariantMap.size).toBe(5);
  expect(result.labels).toEqual([
    'Desktop','Desktop Hover','Desktop Leave','Mobile','Mobile Pressed'
  ]);
});
```

### Task 7 Анімації text effects overlays і slots

**Files:** `effects.ts`, `effects.test.ts`, page-plan; native motion/text/overlay/slot generators.
**Contract:** effects є entities з source references і typed config, не довільними style strings.

- [ ] Red fixtures A01–A18: tween/spring, source bezier, enter/exit, hover/tap, replay, scroll range, repeat, split modes/mask, sequence, reduced motion.
- [ ] Перенести actual OverlayNode `X4UGyYdbv` у native overlay graph: trigger mapping, backdrop enabled/disabled, scroll lock, transitions, close/dismiss, stacking.
- [ ] Розрізнити full-screen modal і relative popover, page template body та component slots. Перевірити slot ordering і цикли.
- [ ] Для API gaps додати вузький native planner adapter і parser proof. Не розширювати source expressions до довільного eval.
- [ ] Browser QA перевіряє поведінку, timing і dismiss; Oracle/static tests самі по собі не доводять animation parity.

### Task 8 CMS schemas records references queries і bindings

**Files:** `cms.ts`, `cms.test.ts`, `page-plan.ts`; native CMS generators/ops.
**Contract:** `sourceCollectionId/sourceItemId/sourceFieldId` мають окремі target maps; query plan і source record identity не губляться.

- [ ] Red tests на 31 dangling reference нового bundle, multi-reference order, required/options/defaults, false/0/empty, timestamps/statuses, duplicate field names, non-Latin names.
- [ ] Двома проходами створити schemas/records і переписати reference values; кожному reference додати actual target collection.
- [ ] Резолвити repeated item, filters/sort/limit/pagination, per-row props і computed values. `limit:0` не означає чотири записи.
- [ ] Перенести dynamic CMS page paths і categories; повторне редагування CMS оновлює UI без повторного імпорту.
- [ ] Semantic test очікує 4 featured Works із конкретної fixture, але converter не hardcode count 4. Всі resolved references існують після reopen.

### Task 9 Media navigation та збереження assets

**Files:** `media-links.ts`, `media-links.test.ts`, asset plan у commit.
**Contract:** asset source identity → hosted target URL; link target → правильний semantic element/action.

- [ ] Red tests image/video/poster/file/font/SVG, focal/fit/alt/srcSet, repeated asset, upload failure, same name/different bytes, dynamic internal href, mailto/tel/anchor/newTab.
- [ ] Локалізувати assets один раз за hash у керованому plan; однаково переписати files, nodes, CMS і props. Зберегти failed/unsupported status; не залишати orphan uploads.
- [ ] Studio Altera використовує video/poster із source, не запасне stock фото. SVG IDs/defs та paths проходять native validation.
- [ ] UnderlineLink/OpacityLink мають справжній link і прив’язаний href. Перевірити `/contact`, `/works`, social URLs і BackToTop adapter.

### Task 10 Forms localization і непредставлені можливості

**Files:** доменні adapters у `src/code/import/framer/`, capability registry та fixtures; native forms/localization/variables integrations.
**Contract:** кожен із 136 сценаріїв має explicit support record; unsupported не masquerade as verified.

- [ ] Зібрати окремі source fixtures для form fields/destinations/states, locale/RTL, custom fonts, SVG, drawing, loop, cursor, Lottie, nested templates, custom breakpoint ladders.
- [ ] Реалізувати відповідні native adapters для заявленого обсягу. Form Button states прив’язати до native submit lifecycle; labels, validation і accessibility не замінювати декоративним UI.
- [ ] Недоступні module internals/credentials/actions повертають typed unsupported report. Source raw зберігається для ручного adapter; відсутні дані не вигадуються.
- [ ] Для майбутніх Framer classes/fields додати unknown-feature tests, які примушують оновити capability registry.

### Task 11 Єдині acceptance gates та документація

**Files:** actual-emitter regression suites замість duplicated canned strings; `src/code/import/framer/e2e/*.spec.ts`; extension README і schema version notes.

- [ ] Для кожного scope перевірити native Copy, Copy for Revyme, popup, floating widget, repeat paste, selection, page replace. Кожна дія має один request і один receipt.
- [ ] Перевірити syntax → Oracle за kind → imports/CMS refs/assets → semantic source parity → parse-back → GUI edit → preview/publish parity.
- [ ] При Desktop 1200 порівняти original і target за однакових loaded fonts/media та масштабу. Потім source Tablet/Phone і custom ranges, не лише три preset розміри.
- [ ] Variant/property/preset/CMS edits у GUI переживають reparse, Undo/Redo і reopen. Окремо перевірити overlay lifecycle і animation/reduced-motion.
- [ ] Запустити targeted suites, `npx tsc --noEmit`, повний `npx vitest run` перед інтеграцією; unrelated failures звірити з baseline та явно зафіксувати.
- [ ] README описує фактичні scopes, guarantees, supported modules, raw export і відмови; не обіцяє автоматичний Ctrl+C, якщо handler відсутній.

## 11 Критерії готовності

### Безпека і транспорт

- [ ] Selection import не змінює active route, globals, інші pages або невикористані CMS/masters.
- [ ] Invalid, incomplete або failed import залишає project source/snapshot незмінним.
- [ ] Один requestId не може створити два imports; success означає committed/read-back result.
- [ ] Pending mutations, target branch switch і revision conflict не можуть перекрити нову або чужу роботу.
- [ ] Один Undo і Redo охоплюють увесь import, включно з новими masters/templates/CMS.

### Відповідність Framer

- [ ] Немає вигаданих Walker/default labels,/footer links або запасних source images у generic path.
- [ ] Labels, semantic tags, text runs, shared styles, values, links, asset types, variants і connections відповідають source inventory.
- [ ] У Walker збережено всі 6 Underline Link і 5 Project Card states, 4 featured Works, реальний Global Navigation/slot/overlay, logo fit text, source typography та navigation.
- [ ] Усі 31 проблемні reference values нового bundle мають коректні target references.
- [ ] Неактивні defaults та editor metadata не перетворюються на нові видимі елементи.

### Відповідність Revyme

- [ ] Немає Oracle/import/schema/reference/graph errors і drift у claimed-native output.
- [ ] Token/preset/component/CMS/variant/overlay залишаються native entities і доступні відповідним панелям.
- [ ] Усі active source features мають mapping або explicit loss/unsupported report.
- [ ] Матриця 136 сценаріїв містить fixture і evidence для кожного сценарію, який оголошується verified. Неперевірені випадки не включаються у відсоток підтримки.

## 12 Відтворювані команди та докази

Read-only registry і проект:

```bash
node packages/cli/dist/main.js meta.index --api http://localhost:3333 --project-id proj-1793538289429-al6out --branch-id main --page-size 100 --page 1
node packages/cli/dist/main.js meta.tools --api http://localhost:3333 --project-id proj-1793538289429-al6out --branch-id main
node packages/cli/dist/main.js codeFiles.list --api http://localhost:3333 --project-id proj-1793538289429-al6out --branch-id main
node packages/cli/dist/main.js diagnostics.projectCheck --api http://localhost:3333 --project-id proj-1793538289429-al6out --branch-id main --strict true
npx vitest run src/code/import/framer/convert.test.ts src/code/import/framer/framer-oracle.test.ts
```

Під час майбутнього запуску підставити фактичний target project/branch; не використовувати наведений ID як універсальний default.

Діагностика цього аудиту знаходиться у `/tmp/framer-complete-audit/`: `audit.test.ts`, `audit.config.mjs`, `bundle-audit.json`, `cms-reference-audit.json`, `meta-tools.json`, `meta-index-page1.json`–`meta-index-page3.json`, `project-files.json`, `project-diagnostics.json`, `oracle-rule-inventory.json`. Це тимчасові файли, не постійні репозиторні fixtures. Для реалізації перенести потрібні анонімізовані fixtures/tests у вказані вище постійні paths.

```bash
npx vitest run --config /tmp/framer-complete-audit/audit.config.mjs
```

5 діагностичних тестів проходять, оскільки вони підтверджують наявні дефекти; зелений diagnostic run НЕ означає виправлений importer. До implementation перетворити потрібні assertions на очікувану безпечну поведінку й побачити red.

Raw live clipboard Desktop/template/multiple selection досліджувався безпосередньо через browser clipboard; старий локальний full-site JSON не підміняє ці зразки. Для постійної regression corpus у Task 2 потрібен raw export. Наданий converted attachment є постійним локальним зразком фактичного output.

## 13 Офіційні довідники і технічні обмеження

- [Framer nodes](https://www.framer.com/developers/nodes): public node/replica model. Internal clipboard class names не є стабільним public API.
- [FrameNode reference](https://www.framer.com/developers/reference/plugins-frame-node): frame properties, layout/paint/geometry.
- [TextNode reference](https://www.framer.com/developers/reference/plugins-text-node): plain/rich text та properties.
- [ComponentNode reference](https://www.framer.com/developers/reference/plugins-component-node): masters/variants/variables.
- [ComponentInstanceNode reference](https://www.framer.com/developers/reference/plugins-component-instance-node): design/code instance identity.
- [Framer styles](https://www.framer.com/developers/styles): text/color styles, light/dark, typography breakpoints і fonts. Документовані source API не означають, що всі runtime effects доступні через Plugin API.
- [Framer CMS](https://www.framer.com/developers/cms): collection/schema/item semantics.
- [Property Controls](https://www.framer.com/developers/property-controls): source control types, не готова сумісність з Revyme @controls.
- [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts) і [ExecutionWorld](https://developer.chrome.com/docs/extensions/reference/api/scripting#type-ExecutionWorld): MAIN/ISOLATED boundaries і relay.

Спочатку вбудований браузер відхилив відкриття `chrome://extensions` через URL policy. Встановлення не обходилося іншим технічним шляхом; користувач сам встановив розширення, після чого його кнопку було перевірено. Остаточне обмеження дослідження — не встановлення, а неможливість довести універсальну feature parity на одному проекті та без запуску mutating paste у живому Revyme.

Реалізаційний висновок: почати з Task 1, далі прибрати подвійні моделі та Walker hardcode. Потім закривати domain matrix реальними fixtures й native generators; не додавати нові source-specific if-умови, щоб ще раз наблизити лише один скріншот.

### Ідентифікатори досліджених версій

SHA256 для звірення після наступних виправлень:

```text
content.js        d24540c61840fbc4f5709f060502d2b3811fe714e98fd6e4acf7780e2439f236
manifest.json     753243336a3b5bdffffe90ca8f28aa5912ec36c95bab5dd5bbbd5b29948f6c21
framer-paste.ts   2d5bac8bdbe260d4115e3cdba5e6853304df56579eac1079f53514859d4bd543
converted input   e5556e9dbc164ece5f1541398fdc55894bef13b855e8585ef3cc6cb523dec34b
```
