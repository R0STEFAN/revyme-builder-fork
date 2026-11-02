# Framer editor → native Revyme transfer

Дата: 1 листопада 2026 року. Статус: нова специфікація для review; реалізацію не розпочато.

## Намір і погоджений напрям

Користувач хоче копіювати сторінку або компонент безпосередньо з редактора Framer,
вставляти у Revyme та отримувати повноцінний редагований код Revyme: дерево шарів,
компоненти, варіанти, responsive overrides, анімації, CMS і пов'язані ресурси.
Візуальна відповідність має супроводжуватися збереженням редагованості.

Користувач явно відкинув попередні документи та конвертер і погодив новий напрям:
**raw-дерево редактора + нативний імпорт**. Ця специфікація спирається на нові
живі захоплення і на чинний код Revyme. Попередній Framer-конвертер, розширення,
аудити й їхні заготовки не є джерелом реалізації. Наявні незакомічені зміни залишаються
поза цією роботою, за винятком мінімальних погоджених точок інтеграції.

Окреме уточнення користувача: для цього імпорту можна створити окремий аналог
`codeFiles.submit`, який дозволятиме submit сторінок і компонентів. Це уточнення
прийнято: нова operation `imports.framer.submit` приймає цілі згенеровані native
files. Заборона загального `codeFiles.submit` не поширюється на цю operation.

## Нові докази

Зразки, оригінальний HTML, декодований JSON, контрольні суми та релевантний код
редактора збережено окремо від репозиторію:

`/home/rost/.codex/visualizations/2026/11/01/01a1976e-b7aa-72d0-a8d8-fa84592c31a8/framer-editor-research/`

`manifest.json` описує шість фактичних захоплень. Дані отримані штатним Copy у
внутрішньому браузері з відкритого користувачем проєкту Walker copy.

| Захоплення | Фактичний результат |
|---|---|
| Home Desktop | 130738 символів HTML; render tree і три CMS-колекції |
| Home, явне виділення Desktop–Phone | 240712 символів; три дерева брейкпойнтів із дочірніми вузлами |
| Global Navigation, три брейкпойнти | 415891 символ; navigation, slot, footer, overlays |
| Ctrl+A всередині Underline Link | Label і Underline; визначення всіх варіантів відсутні |
| Явне виділення шести варіантів Underline Link | Усі шість коренів, replicas та вісім переходів між ними |
| Явне виділення п'яти варіантів Project Card | Усі п'ять коренів і залежна колекція Category |

Перевірено у нових даних: tree version 128; унікальність ID всередині кожного
зразка; усі 31 CMS reference/multi-reference значення існують у відповідних
колекціях; усі вісім переходів Underline Link мають захоплені target variants.
У живій CMS підтверджено Works: 6, Category: 6, Services: 8.

Статичний аналіз саме коду **редактора**, а не згенерованих компонентів сайту, встановив:

- `application/x-framer-layers` пакується в HTML через `data-framer-pasteboard`
  та `data-framer-pasteboard-type`; запис використовує ClipboardEvent або
  `navigator.clipboard.write`. Секретного окремого clipboard-транспорту в цьому шляху немає.
- Native Copy готує копію дерева, styles, tokens, replicas, variable context,
  module descriptors та CMS dependencies. Module descriptor не є визначенням компонента.
- У поточному editor entrypoint є імпорт singleton engine. У завантаженому модулі
  `chunk-VNJKMZPM.mjs` export `Fc` посилається на singleton, створений `shared()`.
  У TreeStore є `getRawDataTree()`, а також окремі processed tree і lazy-loading APIs.
- Це статичний доказ кандидата на source adapter. Живий виклик engine, повнота
  його raw serialization та scope loading ще мають пройти окрему перевірку.
- Мережеві запити під час Copy у внутрішньому браузері не захоплено. Сам код
  clipboard-серіалізації не доводить відсутність запитів інших підсистем.

Офіційний Plugin API документує читання canvas, CMS і локальних code files,
але його повнота для всіх smart-component definitions та interactions тут не
підтверджена. Він залишається можливим додатковим read adapter:
[Nodes](https://www.framer.com/developers/nodes),
[getCollections](https://www.framer.com/developers/reference/plugins-get-collections),
[CodeFile](https://www.framer.com/developers/reference/plugins-code-file).

## Межі системи

```text
Framer editor model
  → extension source adapter
  → versioned transfer bundle + provenance
  → Revyme decoder / dependency graph
  → typed native import intent
  → Revyme pure generators / native source emitters
  → isolated candidate snapshot
  → Oracle + graph + fidelity checks
  → one validated commit / history operation
  → normal ProjectFS → parser → canvas loop
```

Розширення збирає джерело. Revyme виконує конвертацію у своїй актуальній версії,
щоб розширення не містило другої незалежної копії генераторів і валідаторів.
Результат імпорту — звичайні source files Revyme, доступні для штатного export.

### 1. Нове браузерне розширення

Окрема директорія `extensions/framer-native/`, жодних imports зі старого розширення.
MV3, локально упакований код. Потрібні лише дозволи для поточної вкладки,
ін'єкції локального reader, clipboard write, локального збереження/завантаження.
Глобального збору трафіку, cookies або токенів немає.

Source reader працює в контексті сторінки редактора та читає його модель.
Він перевіряє project ID, branch, active scope, editor build і форму engine.
Для першого доведеного editor build допускається явний version adapter з
відомим ESM export уже завантаженого редактором модуля. Мінімізоване ім'я `Fc`
не стає загальною евристикою для інших версій. Невідомий build або невідповідна
форма engine дає зрозумілу помилку; згенерований React сайту не стає fallback.

Перший implementation gate: довести живим захопленням, що adapter отримує
scope definitions, property declarations, усі variants та залежності без
редагування документа. Поки це не доведено, source adapter не позначається готовим.

Для page/component/selection scope збирається транзитивне замикання залежностей.
Project scope збирає всі сторінки та їхні залежності. Context і scope mode
записуються явно: відкритий компонент не може мовчки експортувати Home.

Lazy scopes завантажуються лише штатними read/loading методами; очікується
їхня фактична готовність. Одна незавантажена залежність робить capture incomplete.
Project/branch/revision звіряються до і після capture. Зміна документа під час
збирання викликає повторне захоплення з обмеженою кількістю спроб або помилку.

Native clipboard зберігається як незалежний контрольний зразок. Порівняння
враховує його renamedIds і materialized replicas; байтова рівність з raw model
не очікується. Звичайний Copy не перезаписується непомітно.

### 2. Transfer bundle

Окремий marker і version; старий Framer-paste контракт не перевикористовується.
Bundle містить source build/version, project/branch/revision, scope mode та IDs,
raw entity definitions, assets, references, completeness diagnostics і hashes.
Усі невідомі source properties залишаються в raw provenance для діагностики.

Generated TSX не приймається як доказ повноти source. Вхідні об'єкти проходять
перевірку структури, розміру, глибини, типів та ID; prototype keys і цикли відхиляються.
Посилання мають явні типи, щоб collection dependency не перетворилася на div.

### 3. Незалежний конвертер у Revyme

Нова директорія `src/code/import/framer-native/`. Межі модулів: decode,
source graph, normalize, native intent, fidelity diagnostics. Функції до commit
не пишуть у ProjectFS і не мутують canvas DOM.

Source ID зіставляється з target ID окремо для nodes, components, variants,
variables, pages, collections, fields, records, styles та assets. Одна таблиця
identity використовується всіма посиланнями. Назви не замінюють identity.
Rename collisions вирішуються детерміновано; імена Walker та його ID не потрапляють
у продуктову логіку.

Обов'язкові відображення:

- Frames/stacks/grids: sizing, constraints, alignment, gaps, padding, order,
  positioning, overflow, transforms та реально активні fills/borders/shadows.
- Text: редагований rich text, typography presets, локальні overrides, links,
  tokens і fit text через чинні механізми Revyme; текст не переписується.
- Components: окремі native masters, typed props, default values, instances,
  slots і overrides; локальні smart components не flatten-яться.
- Variants: первинний native ID `default` з оригінальним label; повна таблиця
  source IDs; усі states, deletion overrides, visibility та order.
- Interactions: trigger/source/target/delay, source-node targeting і transition
  parameters. Послідовність hover → intermediate → delayed reset зберігається
  як graph; не замінюється двома довільними hover-станами.
- Responsive: вихідні ширини artboards та діапазони правил, base + overrides,
  visibility, order, component variant overrides. Три render trees не стають
  трьома незалежними копіями DOM сторінки.
- Layout templates: окремий шаблон, children slot, assignments та overlays.
- CMS: schema, field identity/defaults, записи, slugs/status/dates,
  reference/multi-reference, query/filter/sort/limit, repeaters і bindings.
  Усі linked records зберігаються; rendered cards не замінюють CMS.
- Assets/styles: fonts, image/video/file descriptors, alt text, fitting,
  typography/color tokens та usage references через штатні системи Revyme.
  Google Fonts підключаються через наявний механізм Revyme за сімейством,
  вагою, курсивом і точними variable axes; їхні файли не завантажуються в
  медіатеку. Завантаження font-файлів потрібне лише для власних шрифтів.
  За уточненням користувача від 2 листопада 2026 року вставка завантажує
  растрові зображення, конвертує їх у WebP і додає через upload Revyme.
  Прив'язки елементів, властивостей компонентів та CMS використовують отримані
  URL завантажень. Розміри й прозорість зберігаються; SVG-маски зберігають
  векторну форму. Анімоване зображення не можна мовчки перетворювати на кадр.
- Routes/links: page identity → target path, dynamic CMS routes, section targets
  та зовнішні URL; конфлікти маршрутів не руйнують наявні сторінки.
- Code components: за уточненням користувача від 2 листопада 2026 року кожен
  кастомний компонент із коду перетворюється на позначену редаговану заглушку
  зі збереженням розмірів, розташування та responsive стилів. Його код, props,
  внутрішні slots і поведінка не виконуються. Нативні design components Framer
  залишаються окремими редагованими masters та instances.
- Code overrides на інших вузлах: доступний оригінальний source аналізується
  окремо. Непереносний source відображається як конкретна перешкода.

За винятком явно погоджених заглушок, непідтримувану семантику не відкидають
мовчки. Strict import завершується
діагностикою до commit. Розширення Revyme для відсутньої browser behavior
додається у `@revyme/runtime`, якщо воно потрібне published site.

### 4. Нативний import / commit

Нова operation `imports.framer.submit` приймає набір згенерованих source files,
source manifest, явний import mode і target scope. На відміну від загального
`codeFiles.submit`, вона дозволяє цілі native client/server pages, layouts,
templates і design masters разом із CMS та ресурсами. Відсутній `kind` або
значення `other` не дозволяє пропустити перевірку editable TSX.

Operation використовує стандартні dry-run Plan, validation, CAS revision та
receipt. Побудова candidate snapshot відбувається окремо від живого ProjectFS.
Вона повертає FileChanges для чинного plan/commit pipeline; не записує файли
напряму у живий проєкт зі свого execute handler.

Базові building blocks: `pages.*`, `templates.*`, `components.create`,
`components.instance.*`, `variants.*`, `connections.*`, `styles.*`, `cms.*`,
а також їхні чинні pure generators. Наявні semantic operations залишаються
джерелом canonical прикладів і building blocks; імпорт не зобов'язаний
відтворювати цілу сторінку сотнями MCP-викликів. Source-dependent gaps
реалізуються через ті самі native generators і перевірені source emitters.

Спільні helpers для path checks, CAS і підготовки candidate files повторно
використовуються за потреби; весь `codeFiles.submit` не копіюється як друга
незалежна реалізація validation. Окрема import operation перевіряє всі шляхи,
дублікати, конфлікти та допустимі native file families. Її цільовий дозвіл на
pages/design masters не дає дозволу змінювати package.json, credentials,
infrastructure metadata, cache directories чи довільні файли поза import plan.
Загальний `codeFiles.submit` зберігає поточну поведінку.

Oracle викликається з правильним inferred file kind для кожного editable TSX;
native canvas config не пропускається. Server wrappers перевіряються як
структурні Next.js entrypoints із замкненими imports. CMS JSON перевіряється за
schema, усі references — на projected snapshot. Значення source='framer' та
hashes не є доказом довіреності й не замінюють жодного валідатора.
Не допускаються raw writes у build cache.

Перед snapshot/commit UI flush-ить чергу поточних редагувань. Після validation
одна транзакція записує зміни та history. Помилка validation залишає документ
незмінним; помилка запису має гарантований rollback або визначений commit status
із receipt lookup. Повторний запит з operationId не дублює імпорт.

Наявна сторінка не видаляється при paste. Page/project import створює нові сутності
з перевіркою конфліктів. Selection paste вставляє під явно визначений target.
Повторний імпорт і route collisions показуються до commit; заміна наявної
сторінки потребує явного replace mode. Undo повертає весь імпорт, а не один файл.

Інтеграція Ctrl+V додає окремий новий marker route у `src/canvas/shortcuts.ts`;
наявні локальні зміни та старі import handlers зберігаються. Старий
`src/canvas/framer-paste.ts` не використовується як commit engine.

## Перевірка результату

Є три незалежні критерії: source completeness, відповідність native dialect,
та фактична поведінка/вигляд. Один clean Oracle не доводить інші два.

1. Source capture: усі потрібні definitions/variants/dependencies і стабільний revision;
   звірка з native Copy та видимою CMS. Жодних credentials у bundle.
2. Unit/contract: decoder versions, ID remapping, inheritance + `_deleted`,
   cyclic dependencies, computed values, CMS references, route collisions,
   Unicode/escaping, unknown entities і limits. Мінімальні fixtures походять
   від нових capture; privacy data не комітяться випадково.
3. Native round trip: generated source → Oracle → parser → generators → повторний
   parser. Перевірка masters/props/variants/connections/repeaters у редакторі.
4. Transaction: pending edits, validation rejection, CAS conflict, mid-write failure,
   operationId retry, undo/redo; усі без втрати сторонніх змін.
5. Live Walker acceptance: три ширини Home, layout/overlays, шість станів Underline
   Link, п'ять станів Project Card, точні CMS записи/посилання, filters/bindings,
   assets і fonts. Зміна CMS record має оновлювати пов'язані instances.
6. Visual/behavior QA: source vs Revyme screenshots на однакових viewport,
   hover/tap/scroll/delayed transitions, responsive boundaries та reduced motion.
   Відхилення вимірюються й пояснюються; не позначаються довільно як «1:1».
7. Після реалізації: релевантні Vitest тести, `npx tsc --noEmit`, потрібні build/e2e.
   Спочатку зафіксувати baseline наявної робочої копії.

## Критерій завершення

Працює шлях install → відкрити свій Framer project → обрати page/component →
copy → paste у Revyme → редагувати native nodes, components, animations і CMS →
опублікувати штатним способом. Підтверджено round trip, visual/behavior acceptance
та atomic Undo. Інструкція встановлення й користування входить у результат.

Поточний результат — дослідження і ця специфікація. Extension, source reader,
converter та live import ще не реалізовані. Перший ризик, який має зняти
implementation plan: живе читання повного raw scope через versioned editor adapter.
