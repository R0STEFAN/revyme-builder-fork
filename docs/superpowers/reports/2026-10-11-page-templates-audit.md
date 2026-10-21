# Аудит шаблонів сторінок Revyme

**Дата:** 11 жовтня 2026 року. **Гілка:** `main`. **Commit:** `bcee025caee6f07fec3cf596147b1f796d77df5a`.

**Область:** створення й генерація шаблонів, застосування/зняття, перейменування/видалення, редагування, змінні, responsive, content slot, locale/CMS routes, A/B references, preview/source export, історія та захист запису. Це аудит і рекомендації; код застосунку та збережені проєкти не виправлялись.

## 1. Основний висновок

Підтверджено **12 нових груп дефектів**, додатково до попередніх width/order проблем. Найвищий пріоритет мають перезапис файлів при конфліктах, цілісність посилань після rename та типи template variables. В інфраструктурі responsive route values знайдено окремі помилки виконання і відображення.

Крихкість виникає на переходах між кількома моделями: файловий route group, об'єднаний CanvasNode root, AST документа, текстові regex-readers, JavaScript runtime values та URL. Happy-path тести проходять, але ці моделі не завжди мають спільні правила.

Важливе обмеження: дефекти **T05, T06, T11** стосуються route keys `variable@width`. Генератор підтримує цей формат і має тести, але поточний `TemplatePicker.setVar` пише base key і не використовує `viewportVarKey`. Це підтверджені **латентні дефекти підтримуваного генераторного механізму**, а не твердження, що звичайний клік у поточному picker завжди запускає ці три баги. У двох знайдених локальних template snapshots таких ключів немає.

## 2. Реєстр проблем

P1 — можлива втрата/перезапис даних або поломка runtime/поведінки. P2 — неправильний результат, розбіжність поверхонь, відмова редагування або обмежений сценарій. Пріоритет враховує також доступність шляху з чинного UI.

| ID | Пріоритет | Проблема | Статус доказу |
|---|---|---|---|
| T01 | P1 | Rename шаблону може перезаписати сторінку в organisational group | Реальний ProjectFS + rename |
| T02 | P1 | Assign перевіряє лише одну половину page pair; друга може бути перезаписана | Реальний assign + movePageFile |
| T03 | P1 | Rename лишає старі locale imports, A/B page/template references, comments та active path | Реальні ops + generated locale wrapper; UI caller прочитаний |
| T04 | P1 | Boolean/number overrides зберігаються як рядки: `false` стає truthy, `3 + 1` дає `31` | Виконання згенерованого resolver + реальний canvas model |
| T05 | P1, латентний | Responsive resolver читає `__mqN` до оголошення і падає | Генератор → modifyProjectFile → виконання; source export |
| T06 | P2, латентний | `variable@width` не застосовується до template chrome на replica канвасі | Реальний store + renderNodes DOM |
| T07 | P2 | Content slot залежить від форматування/коментарів; Page Effect може повідомити success без injection | Реальний store, oracle, effect setter і parse gate |
| T08 | P2 | Текст `};` у variable value ламає regex route-map reader/writer | Генератор, Babel parse, реальний parse gate |
| T09 | P2 | Зміна URL сторінки не переносить її template overrides | Реальний movePageFile + route-map reader |
| T10 | P2 | Template route matcher не враховує locale prefix і багатосегментний catch-all | Реальний preview router/locale generation + emitted matcher |
| T11 | P2, латентний | Mobile override іншої сторінки змінює responsive fallback поточної | Виконання resolver після ізоляції T05 тільки в пам'яті |
| T12 | P2 | Oracle вважає organisational route group шаблоном без LayoutClient | Реальний FS/layout resolver + oracle |

Діагностичні тести перевіряють **поточний помилковий результат**. Їхній PASS підтверджує відтворення дефектів, а не їх виправлення.

## 3. Детальні знахідки

### T01. Перезапис файлів при перейменуванні шаблону

**Сценарій:** існує шаблон `(old)` зі сторінкою `x` та organisational group `(archive)` з власною сторінкою `x`, але без `LayoutClient.tsx`. Перейменувати `old` у `archive`.

[renameTemplate](/home/rost/Документи/revyme/revyme-builder-fork/src/code/project/template-ops.ts:202) перевіряє лише `templateExists(clean)`. Organisational group не є template, тому перевірка пропускає конфлікт. Далі кожний файл переміщується без перевірки destination. [ProjectFS.moveFile](/home/rost/Документи/revyme/revyme-builder-fork/src/code/project/project-fs.ts:381) записує в Map через `set`, замінюючи старий вміст.

**Відтворений результат:** `DESTINATION_CONTENT` замінено на `SOURCE_CONTENT`; rename повертає `true`. Це підтверджений механізм втрати даних на тестових файлах; користувацькі файли не переміщувались.

**Виправлення:** preflight повного переліку destination paths до першого move; при будь-якому конфлікті відмовити всій операції. Структурована помилка має дійти до rename modal. Операція потребує єдиного history checkpoint і перевірки, що жоден файл не змінився при відмові.

### T02. Конфлікт тільки у server half page pair

**Сценарій:** `app/check/page.client.tsx` і `page.tsx` переміщуються у template. У destination вже є `page.tsx`, але немає `page.client.tsx`.

[assignTemplate](/home/rost/Документи/revyme/revyme-builder-fork/src/code/project/template-ops.ts:126) перевіряє тільки `newPath`, який UI передає як client half. [movePageFile](/home/rost/Документи/revyme/revyme-builder-fork/src/code/project/active-file-store.ts:986) переносить обидві половини без додаткового conflict gate.

**Результат:** старий destination server wrapper/metadata перезаписується. Зворотний випадок при server-path input також потребує тесту.

**Виправлення:** у спільному primitive перевіряти client + server destinations та існування source. Повертати результат move, а не припускати успіх. Перевірити assign/remove, bulk apply і Pages/FileExplorer drag, оскільки вони використовують той самий primitive. DeleteTemplate уже має перевірку обох destination halves — її позитивну поведінку зберегти.

### T03. Rename не підтримує цілісність залежних посилань

Rename переносить файли через raw `moveFile`, обходячи retargeting і locale regeneration, що є у `movePageFile`.

**Підтверджено одним сценарієм:**

- Після `old → new` файл `app/(new)/fr/page.tsx` лишається з `export ... from '@/app/(old)/page'`; імпорт посилається на вже відсутній шлях.
- `test.json.pagePath` A/B-тесту лишається старим; `variants[].template = 'old'` також не змінюється.
- Comments лишаються прив'язаними до старої `filePath`.
- Active file atom лишається старим; після bump `activeCodeAtom` повертає порожній рядок.

[Library handleRename](/home/rost/Документи/revyme/revyme-builder-fork/src/editor/left-toolbar/panels/LibraryPanel/sections/TemplatesSection.tsx:131) не перевіряє return value і не перемикає active file. Окрема browser click перевірка цього modal ще не виконана; стан atom/файлів відтворено, caller прочитано.

**Виправлення:** централізований file-path mapping для всієї транзакції: active file/queue path, breadcrumbs, comments, A/B manifests, generated locale wrappers. Окремо звірити template folder metadata та інші path-keyed індекси — їх несправність тут ще не відтворена. Locale wrappers краще регенерувати чинним `syncLocaleRoutes`, а не масово замінювати рядки. Зберегти URL сторінок і relative imports допоміжних файлів.

### T04. Типи змінних у route map

[coerceRouteValue](/home/rost/Документи/revyme/revyme-builder-fork/src/code/generation/template-route-gen.ts:246) обробляє object-JSON для transition, але boolean та number input повертає рядками. [TemplatePicker](/home/rost/Документи/revyme/revyme-builder-fork/src/editor/TemplatePicker.tsx:243) передає ці рядки без інформації про literal kind.

```js
// Param default: enabled = true; count = 2
const __templateProps = {"/":{"enabled":"false","count":"3"}};
enabled = __tp.enabled ?? enabled; // 'false' — truthy
count = __tp.count ?? count;       // '3'
```

**Результат:** toggle OFF виконує ON-гілку. Numeric variable у арифметиці дає `'31'` замість `4`. Для boolean layout fixture канвас показав `display: none`, а виконання emitted resolver — ON: статичний parser використовує string truthiness із `false` як OFF, JavaScript runtime вважає непорожній рядок true.

**Виправлення:** зберігати typed values з урахуванням AST/default kind або metadata variable. Не перетворювати кожне схоже на число/boolean текстове значення автоматично: text `'false'`, телефони та `'0012'` мають лишитись текстом. Узгодити типи RouteMap, picker value serialization, parser та runtime, включаючи responsive keys і reset.

### T05. Runtime crash після responsive route value

**Сценарій:** генератор отримує `color@768 = 'tablet-a'` у звичайному JSX LayoutClient.

```tsx
const __tp = __matchTemplateRoute(usePathname());
color = (__mq0 ? __tp['color@768'] : undefined) ?? __tp.color ?? color;
const __mq0 = useMediaQuery('(max-width: 768px)');
return <div>{children}</div>;
```

**Результат:** `Cannot access '__mq0' before initialization`. Цей код синтаксично коректний: `modifyProjectFile` записує його, а source export зберігає цей порядок.

Причина у [ensureResolveBlock](/home/rost/Документи/revyme/revyme-builder-fork/src/code/generation/template-route-gen.ts:161): regex для пошуку останнього gate використовує `[^)]*`, але `)` є **всередині рядка query**. Declaration не знаходиться і resolve block вставляється на початок body. При заміні наявного block також немає гарантії, що нові gates стоять раніше.

**Виправлення:** AST insertion у body саме LayoutClient: declarations gates перед consumers, route lookup перед використанням variables. Потрібні runtime-тести first responsive write, base → responsive, додавання другого breakpoint, reset і Babel reformat. Синтаксичного `parses(out)` тут недостатньо. Латентний шлях `@width` — див. розділ 1.

### T06. Responsive value не доходить до replica канваса

**Сценарій:** route map містить base color `#445566` і `color@768 = '#abcdef'`; Header у template використовує `style={{ color }}`.

**Результат:** реальний `seedNodesForCode → renderNodes` показав tablet Header `rgb(68, 85, 102)`, тобто base color. Width-specific значення в Map є, але replica не отримує його. Це перевірка DOM styles у jsdom, не browser geometry.

[store](/home/rost/Документи/revyme/revyme-builder-fork/src/code/stores/store.ts:379) передає parser лише base keys, а кінцеві overrides розраховує одним набором для merged layout. `variable@width` не є назвою JSX binding `variable`. Шлях доставки звичайної template `@media` CSS працює, але це інший механізм.

**Виправлення:** єдиний resolver ефективних route values для конкретного viewport, shared правила з runtime. Перевірити direct style/text bindings, props у вкладених компонентах, root bindings та scroll variants. Не підміняти variable route overrides CSS overrides. Латентний шлях `@width` — див. розділ 1.

### T07. Content slot залежить від буквального рядка

Store шукає `code.indexOf('{children}')` у template editor та page merge: [store.ts](/home/rost/Документи/revyme/revyme-builder-fork/src/code/stores/store.ts:283), [merge](/home/rost/Документи/revyme/revyme-builder-fork/src/code/stores/store.ts:387).

**Три валідні форми, які відтворили failure:**

```tsx
function LayoutClient({children}) { /* … */ } // перший збіг — destructured param
<div data-id="root">{ children }</div>         // буквального збігу немає
// slot is {children}                          // перший збіг — коментар
```

Для кожної форми oracle не повідомляє `TEMPLATE_CHILDREN_*` порушення: AST бачить один правильний slot. Але real page store не додає `layout::header/footer`; у template editor compact signature також не створює `children-slot`. Контрольна conventional formatting fixture працює.

[injectPageTransitionsInCode](/home/rost/Документи/revyme/revyme-builder-fork/src/code/generation/page-transitions-gen.ts:258) має такий самий пошук. На compact signature він пробує вставити JSX у параметри; parse gate захищає файл і відмовляє. Проте [setPageEffectForPage](/home/rost/Документи/revyme/revyme-builder-fork/src/code/project/page-effects-ops.ts:59) ігнорує цю відмову, зберігає effect map і повертає `true`. У тесті effect існує, controller у LayoutClient відсутній.

**Виправлення:** один AST helper для JSXExpressionContainer із Identifier `children`, його logical parent і transparent wrappers. Використовувати у store, transition injection та структурних generators. Дія повертає успіх лише після успішного потрібного запису. Семантична slot validation має працювати й для ручних code edits/системних генераторів, не тільки AI gate.

### T08. Рядок `};` ламає route-map операції

[MAP_RE](/home/rost/Документи/revyme/revyme-builder-fork/src/code/generation/template-route-parse.ts:15) читає об'єкт до першого `};`, не враховуючи рядкові літерали.

**Сценарій:** template text value `text }; example`. `ensureMatcher` знаходить кінець map усередині text і вставляє matcher туди. Вихід генератора має unterminated string. Читання коректного hand-authored map із цим текстом повертає `{}`.

**Захист, який працює:** `modifyProjectFile` відмовляє новому некоректному результату, старий файл не змінюється. Для поточного picker симптом — незбережене значення/повернення попереднього стану; це не підтвердження, що цей UI шлях зберігає пошкоджений документ. Сам caller не перевіряє `null` і не показує причини відмови.

**Виправлення:** читати initializer `__templateProps` через AST або наявний string-aware balanced scanner; вставляти declarations за AST boundaries. Зберігати quotes, gradients, multiline text і object transitions. Surface write failure, без мовчазного успіху.

### T09. URL rename губить зв'язок із template override

**Сценарій:** `/before` має власний template color; page pair переміщується в `/after` через чинний `movePageFile`, який також використовує [FileExplorer rename](/home/rost/Документи/revyme/revyme-builder-fork/src/editor/FileExplorer.tsx:1709).

**Результат:** route map лишається `{ '/before': { color: '#abcdef' } }`; `/after` повертає `{}` і користується defaults. Файли сторінки при цьому перенесені правильно.

**Виправлення:** при зміні URL, а не лише фізичного шляху, переносити route-map entry з conflict policy. При template-only move URL лишається тим самим: це інший випадок, який не повинен випадково перейменовувати ключ. Page Effects source/target route maps також потребують тієї самої policy; їх відмову після URL rename тут додатково не відтворювали.

### T10. Locale та catch-all routes не збігаються з matcher

[Generated matcher](/home/rost/Документи/revyme/revyme-builder-fork/src/code/generation/template-route-gen.ts:59) використовує exact URL та замінює кожний bracket segment на `[^/]+`.

**Відтворено:**

- `/about` отримує custom value. Реально згенерований locale wrapper маршрутизується як `/fr/about`, але цей самий template resolver повертає default. Preview `usePathname` теж повертає `location.pathname` без canonicalization.
- Catch-all сторінка `/docs/[...slug]` у real preview router відкриває `/docs/a/b`. Template matcher застосовує override до `/docs/a`, але для `/docs/a/b` повертає default.

**Виправлення:** спільні route rules з router: canonical page route, locale prefix із config, звичайні dynamic segments і catch-all. Додати specificity tests для перетину patterns та trailing-slash policy. Не вирізати довільний дволітерний URL segment як locale без config. Зберегти можливість свідомого locale-specific override, якщо її вводити.

### T11. Responsive fallback залежить від іншої сторінки

Ширини для resolver збираються з **усіх** routes. Найменший активний gate обирає branch навіть тоді, коли на поточному route немає відповідного key.

**Експеримент:** route `/a` має тільки `color@768`. На ширині 375 отримує tablet value. Після додавання `/b.color@375` той самий `/a` на 375 отримує base default: branch `__mq375` повертає undefined, і `?? base` обходить доступний tablet override.

Цей другий дефект відтворено після **перестановки declarations тільки в пам'яті тесту**, щоб runtime crash T05 не маскував результат. Виправлення застосунку не робилось. Латентний шлях `@width` — див. розділ 1.

**Виправлення:** обирати найконкретніший matching override, який дійсно існує для поточного route, потім ширший matching override, потім base/default. Налаштування `/b` не має змінювати `/a`. Узгодити getter панелі, canvas resolver і emitted runtime; перевірити sparse maps/reset.

### T12. Oracle плутає route group із template

[Oracle rule](/home/rost/Документи/revyme/revyme-builder-fork/src/code/oracle/check-file.ts:1559) визначає templated page через дужки у path. При цьому `listTemplates` і move normalization розрізняють organisational groups без LayoutClient.

**Результат:** для сторінки `(archive)` без LayoutClient real layout resolver знаходить тільки root `app/layout.tsx`, але oracle видає `TEMPLATED_PAGE_ROOT_STYLED` за background на її власному root. AI/API gate може відхилити легітимний standalone page style.

**Виправлення:** передавати в oracle project-aware факт застосованого template, включаючи A/B override; не робити FS-dependent core rule глобальним singleton. Додати cases: bare page, organisational group, реальний template, LayoutClient, variant inherit/none/custom.

## 4. Що працює та які припущення не підтвердились

- Створення стандартної layout/LayoutClient пари, базове apply/remove та повторне застосування мають наявні тести, які пройшли.
- DeleteTemplate зберігає page pairs і переносить generated locale wrappers у перевірених сценаріях; conflict cases залишають page content. Старий описаний у коді Wisp delete-data-loss не видається за новий дефект.
- Основний create-and-apply undo/redo тест проходить. Це не доводить цілісність усіх metadata при rename.
- Template chrome захищене у page view; PropertiesPanel приховує Layout/Styles/Overlays на merged root. Підозра, що ці звичайні root controls пишуть у чужий файл, не підтвердилась.
- Template `@media` CSS доходить до page replica через renderer sync; відповідні два empirical tests проходять. T06 стосується іншого route-variable механізму.
- `PageTransitions` реально повертає Fragment: позначення його transparent wrapper у parser/oracle відповідає runtime.
- Parse gate `modifyProjectFile` захищає від T07 injection і T08 new syntax corruption; `syncImports` додає потрібні hook imports. Відсутність imports у сирому проміжному генераторі не видана за окремий production bug.
- Synthetic template preview routes із placeholder page pairs мають тести. Повний живий preview/publish переходів і Next.js build конкретного користувацького сайту не виконувались.

## 5. Попередні width/order проблеми

Цей аудит доповнює [попередній звіт і план](/home/rost/Документи/revyme/revyme-builder-fork/docs/superpowers/plans/2026-10-11-components-template-investigation.md), не замінює його.

1. **Width design instance у template:** comma-blind вставка в style object, відсутній style не підтримано; sync updateStyles gate не гарантує parse validation. Дефект не залежить від назви NavBar або самого `%`.
2. **Root move сторінки із застосованим template:** hidden Flow/Glide wrappers порушують logical index/anchor; merge прибирає CSS order, який маскує неправильний JSX на bare page. Повний reorder batch може відновити id order, але лишає порожні Flow wrappers. Без-Flow pointer сценарій лишається окремим browser acceptance case.

У цьому аудиті ці два дефекти повторно не рахувались серед 12 нових груп.

## 6. Результати перевірок

| Перевірка | Фактичний результат |
|---|---|
| Початковий focused run: `vitest run template preview layout-transform transform-template slot-children active-file-store` | 27 files, 317 passed |
| `npx tsc --noEmit` до діагностик і після їх прибирання | Обидва прогони Exit 0 |
| `npm run build:all` | Exit 0; editor + sandbox + preview bundles; є chunk-size warnings |
| `npx vitest run --maxWorkers=4 --reporter=dot` | 898 files passed, 4 skipped; 13 193 tests passed, 36 skipped, 5 todo; 247.25 s |
| Фінальні діагностичні scenarios | 1 file, 23 passed; 3.42 s |

Повний run містив **16 початкових діагностик**, що очікують чинні дефекти; 7 додаткових scenarios запущено у фінальному focused run. Числа не підсумовуються як кількість унікальних нових продуктово-коректних перевірок. Full suite PASS не означає відсутність описаних дефектів.

Runtime tests виконують actual emitted declarations/function body з контрольованими `usePathname`/media-query значеннями; JSX return замінений тільки в пам'яті на snapshot локальних values. Це перевіряє JS ordering/type/fallback semantics, а не React hydration. Render test використовує actual store/renderNodes у jsdom, а не готовий вручну скопійований merge algorithm.

Read-only огляд локальних snapshots: 97 JSON прочитано без помилок; у 2 проєктах знайдено 2 route-group LayoutClient, обидва з layout partner. У цих двох route maps не знайдено `@width` keys чи string false. Це вузька перевірка поточного збереженого набору, не доказ відсутності runtime дефектів.

GitNexus/PAL tools у сеансі недоступні; source tracing виконано через `rg`, читання callers і executable tests. Browser pointer E2E та backend/cloud deploy не запускались. `build:all` збирає builder, не доводить успіх `next build` кожного користувацького сайту.

[Відтворення: 23 діагностичні тести](/home/rost/Документи/revyme/revyme-builder-fork/docs/superpowers/reports/2026-10-11-template-audit-reproductions.md) збережені окремо для реалізації regression coverage. Тимчасовий test file у `src/` після аудиту прибраний. Report directory ігнорується Git; звіти не staged і не committed.

## 7. Рекомендований порядок виправлення

1. **File integrity:** T01/T02 preflight і відмова без часткових moves; T03 rename mapping та UI handling. Tests: conflicting half-pair, organisational destination, active template/page, comments, locale wrappers, A/B inherit/custom.
2. **Безпечні writers:** попередній width writer + targeted sync parse guard; T04 typed route values; T08 AST map read/write і surfaced write failures. Tests мають перевіряти persisted result, runtime values та незмінний старий документ при відмові.
3. **Спільний AST slot:** T07 helper для content slot; використати його у store, transition injection і генераторах logical child slots попереднього order плану. Check missing/duplicate/conditional slot, formatting, comments, transparent wrappers і failure status.
4. **Route lifecycle:** T09 migrate canonical URL entries, T10 locale/dynamic/catch-all resolver, T12 project-aware oracle context. Окремо визначити policy перенесення overrides між різними шаблонами; це не автоматично має копіювати всі старі variables в новий template.
5. **Responsive route feature до подальшого розширення UI:** T05 declaration order, T06 per-viewport canvas propagation, T11 sparse-map fallback. Додати parity matrix desktop/tablet/mobile × дві сторінки × reset × typed variables. Не підключати `@width` picker поверх чинного resolver без цих виправлень.
6. **Browser acceptance:** ізольований тестовий проєкт; apply/remove/rename/delete/undo/reload, logical order із Flow on/off, component dimensions усіх одиниць, template variables, locale routes і preview. Порівнювати source, CanvasNode, iframe DOM та runtime. На завершення — `next build` експортованого fixture сайту, не тільки Vite builder build.

Не потрібне негайне повне переписування шаблонів. Потрібні спільні правила для path transactions, slots, typed values і routes, плюс regression tests на межах підсистем. Найпершими варто усунути шляхи, здатні перезаписувати дані; потім вирівняти canvas та runtime.
