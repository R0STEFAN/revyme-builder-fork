# Аудит Revyme Builder: UI/UX та вбудовані компоненти

Дата: **10 жовтня 2026 року**. Версія коду: `150c572d527414aa8302f473031c05a6ec0a7621`.

Виявлено **17 груп дефектів**: 7 з пріоритетом P1, 8 — P2, 2 — P3. Для 14 груп підготовлено **21 виконуване відтворення**; ще 3 підтверджені аналізом коду та конфігурації. Найнебезпечніші проблеми стосуються завантаження і збереження проєкту, видалення компонентів та редагування неправильного екземпляра.

Поточні перевірки успішні, але не покривають ці сценарії: TypeScript — без помилок; основний Vitest-набір — **12 983 passed, 36 skipped, 5 todo**; збірки editor, canvas sandbox і preview sandbox — успішні. Окремий аудит — **120 passed**: 21 відтворення дефектів та 99 перевірок шаблонів компонентів. Кожен із 99 шаблонів компілюється для canvas і preview. Це перевірка компіляції, а не гарантія працездатності інтерактивності чи зовнішніх сервісів.

## Межі та метод

Аудит простежує критичні шляхи: завантаження → ProjectFS → панелі → генератори → mutation queue → parser → iframe renderer → code components → preview → autosave/history. Перевірені також правила видалення компонентів, визначення JSX-екземплярів, responsive-стилі та доступність контролів вбудованих компонентів.

Проведено огляд структури підсистем і детальне читання ключових модулів. Це не построкова перевірка кожного файлу репозиторію. У п'яти основних підсистемах інвентаризація нарахувала 1 150 файлів без unit-тестів та e2e-каталогів: editor — 433, code — 405, canvas — 208, canvas-sandbox — 30, shared — 74.

Відтворення виконані через Vitest, React Testing Library, Babel і jsdom. Мережа, Three.js та Canvas 2D у відповідних тестах замінені керованими fixtures; алгоритми завантаження, збереження, JSX-трансформацій і React lifecycle залишені реальними. Не змінено production-код. Не виконано browser E2E, GPU-профілювання або публікацію реального сайту; для них у звіті наведені сценарії приймання. PAL MCP, передбачений навичкою sc-analyze, у цій сесії недоступний; багатомодельна перевірка не проводилася.

P1 означає термінове виправлення: ризик втрати роботи, пошкодження сторінки або зміни неправильного об'єкта. P2 — суттєво зламана функція чи розбіжність canvas/preview. P3 — локальна неточність інтерфейсу. P0 не присвоєно: безумовну втрату всіх проєктів чи загальну недоступність не встановлено.

## Черга виправлень — від найкритичніших

| № | ID | Пріоритет | Дефект | Доказ |
|---|---|---|---|---|
| 1 | AUD-00 | P1 | Помилка cloud load відкриває порожній проєкт | Backend + React-відтворення |
| 2 | AUD-01 | P1 | Autosave допускає паралельні записи та хибний Saved | 2 відтворення |
| 3 | AUD-13 | P1 | Save code-компонента обходить autosave й undo | React + реальний lifecycle |
| 4 | AUD-03 | P1 | Delete Component пошкоджує JSX / залишає зламані імпорти | 3 відтворення |
| 5 | AUD-02 | P1 | Невдале збереження не зупиняє Publish та success-повідомлення | Promise-відтворення + виклики |
| 6 | AUD-11 | P1 | LocalBackend приховує відмову обох сховищ | Відтворення |
| 7 | AUD-04 | P1 | Панель редагує перший екземпляр замість вибраного | Read/write-відтворення |
| 8 | AUD-05 | P2 | Ширший responsive breakpoint перезаписує вужчий | Відтворення resolver |
| 9 | AUD-06 | P2 | Інтерактивні handlers видаляються навіть у component preview | Реальний CopyButton |
| 10 | AUD-12 | P2 | Спільна залежність компонентів помилково вважається циклом | React-відтворення |
| 11 | AUD-07 | P2 | Валідний handler зі строкою `"}"` ламає компіляцію | Відтворення compiler |
| 12 | AUD-16 | P2 | 3D-компоненти не мають робочого шляху завантаження dependencies | Код + npm/import maps |
| 13 | AUD-09 | P2 | ModelViewer пропускає initial props та не зупиняє autoRotate | 2 lifecycle-відтворення |
| 14 | AUD-08 | P2 | ImageSequence не оновлює кадри після заміни та ламає один URL | 2 lifecycle-відтворення |
| 15 | AUD-10 | P2 | Component editor: відсутні list-контроли, нуль показується як default | 2 UI-відтворення |
| 16 | AUD-14 | P3 | Camera X / Y у SplineScene не використовуються | Аналіз коду |
| 17 | AUD-15 | P3 | Duplicate у Library нічого не робить | Аналіз двох handlers |

## 1. AUD-00 — помилка завантаження cloud-проєкту сприймається як порожній сайт

**Код:** [RevymeBackend.loadProject](/home/rost/Документи/revyme/revyme-builder-fork/src/backend/revyme-backend.ts:48), [ProjectLoader](/home/rost/Документи/revyme/revyme-builder-fork/src/ProjectLoader.tsx:313).

`loadProject()` повертає `null` і при HTTP-помилці, і при exception, і при невалідному JSON. Той самий результат означає справді новий сайт без файлів. `ProjectLoader` у cloud mode завантажує `createEmptyProject()` і монтує редактор. Захист від такої ситуації є тільки в standalone mode.

**Прояв:** користувач відкриває існуючий сайт; один GET snapshot отримує 503, а паралельний запит ролі успішно повертає owner/editor. Замість повідомлення про помилку з'являється чистий canvas. Перехід 503 → порожній редактор підтверджений інтеграційним тестом.

**Ризик втрати:** подальше збереження цього scaffold може перезаписати справжній сайт, якщо сервер приймає його як звичайний snapshot. Цей запис у production DB не виконувався. Якщо запит ролі також провалиться, fallback viewer обмежить редагування; якщо template prompt активний, autosave тимчасово held. Обидва випадки не усувають неправильну класифікацію load error; при вже закритому prompt захисного hold немає.

**Виправлення:** розрізнити `loaded`, підтверджений `empty` і `error`. HTTP 5xx, network errors та пошкоджений JSON мають вести до вже наявного load-error UI з Retry. Порожній scaffold створювати лише після успішного отримання справді порожнього проєкту. Заборонити autosave до успішної hydration.

**Приймання:** окремі тести 503, timeout, невалідного JSON та нового сайту; backend save не викликається після невдалого load.

## 2. AUD-01 — паралельні autosave можуть повернути проєкт до старої версії

**Код:** [performSave/startSave](/home/rost/Документи/revyme/revyme-builder-fork/src/backend/autosave.ts:71), [triggerAutosave](/home/rost/Документи/revyme/revyme-builder-fork/src/backend/autosave.ts:191).

`startSave()` не перевіряє вже активний save. Таймер нового редагування запускає другий запис навіть тоді, коли перший ще триває. Кожне успішне завершення безумовно ставить `pendingSave = false` і статус `saved`.

**Підтверджено:** snapshot A запускається першим; користувач створює B; запускається другий save. Якщо B завершується раніше A, fixture-сховище зрештою містить A, а UI — `Saved`. Другий тест підтверджує інший дефект: завершення A після нового редагування B, але до його debounce, прибирає dirty flag. Unload handler тоді не запускає захисний save, хоча B ще не збережено.

Фактичний порядок записів у cloud DB залежить від сервера; клієнтського захисту немає. Dirty-flag defect встановлено незалежно від server ordering.

**Виправлення:** одна активна операція save; нові зміни накопичуються для наступного проходу. Ввести revision для snapshot та останньої підтвердженої версії; `Saved` дозволений лише коли acknowledged revision відповідає поточній. Для багатоклієнтського запису — додатково server-side revision check. `flushSaveNow()` повинен чекати збереження актуальної ревізії, а не лише останньої Promise.

**Приймання:** deferred Promises, кілька редагувань під час save, помилка старого save після нового редагування, unload у debounce-вікні.

## 3. AUD-13 — Save у редакторі code-компонента зберігає тільки в пам'яті

**Код:** [ComponentEditorOverlay.handleSave](/home/rost/Документи/revyme/revyme-builder-fork/src/editor/component-editor/ComponentEditorOverlay.tsx:139), [відкриття overlay](/home/rost/Документи/revyme/revyme-builder-fork/src/editor/left-toolbar/panels/LibraryPanel/index.tsx:180).

Overlay відкривається без зміни активної canvas-сторінки. Save робить прямий `projectFS.writeFile`, bump version і `setSavedCode`, але не викликає autosave або history. Закриття overlay та save перед agent turn використовують аналогічні прямі записи.

**Підтверджено:** змінений файл уже містить локальну правку, Save більше не dirty, але після трьох секунд backend не викликано і `canUndo` залишається false. Тест монтує реальний `useMutationQueueLifecycle`: це не просто відсутність hook у тестовій оболонці. Змінюється неактивний файл, тому sync активного `codeAtom` не створює запис history.

**Прояв:** відредагувати вбудований компонент через Library → Edit Code → Save і перезавантажити вкладку, не зробивши інших дій, що запускають autosave. Зміни ризикують зникнути; Ctrl+Z їх також не повертає. Загальний Save або штатний вихід через Dashboard може окремо flush-нути весь проєкт і врятувати правку.

**Виправлення:** один helper для commit buffer на Save, close та before-agent-turn: flush черги, безпечний запис із дозволом human WIP, окремий history step, запуск autosave. UI має розрізняти «записано в ProjectFS» і «підтверджено сховищем».

**Приймання:** reload після Save без canvas-edit; undo/redo зміни master-файлу; кілька збережень поспіль; зовнішня зміна файлу при локальному буфері.

## 4. AUD-03 — Delete Component може зробити сторінки непридатними до рендеру

**Код:** [deleteComponent](/home/rost/Документи/revyme/revyme-builder-fork/src/code/components/component-ops.ts:2503).

Видалення використовує regex за назвою файлу/тегу та прямо записує результат. Воно не враховує локальні import aliases і повну структуру JSX. Parse gate відсутній, master-файл видаляється без перевірки всіх залежних файлів.

**Три підтверджені сценарії:**

1. Сторінка повертає лише `<Card />` у дужках. Після видалення утворюється `return ();` — Babel не може розпарсити файл.
2. `import Tile from '@/components/Card'` не збігається з очікуваним `import Card`. Master видалений, import та `<Tile />` залишаються.
3. `<Card onClick={() => ...} />` не видаляється: `[^>]*` зупиняється на `>` у `=>`. Master знову зникає, instance залишається.

**UX:** після звичайної команди Delete пропадають залежні сторінки або preview показує missing component. Пошкодження виходить за межі одного елемента Library.

**Виправлення:** AST-трансформація за resolved import path і локальним binding. При видаленні кореневого JSX повертати валідний `null` або порожню root-оболонку. Попередньо підготувати й перевірити весь набір змін; master видаляти тільки після успішної перевірки. Для записів використати `modifyProjectFile`, додати один history step та autosave.

**Приймання:** alias, multiline attrs, arrow handlers, вкладені однакові компоненти, root return, видалення з іншої активної сторінки, undo всього видалення.

## 5. AUD-02 — Save повідомляє про успіх, а Publish продовжується після save failure

**Код:** [performSave.catch](/home/rost/Документи/revyme/revyme-builder-fork/src/backend/autosave.ts:80), [saveProjectNow](/home/rost/Документи/revyme/revyme-builder-fork/src/editor/header/SaveButton.tsx:31), [Publish](/home/rost/Документи/revyme/revyme-builder-fork/src/editor/header/RightHeader.tsx:242), [CodeEditor save](/home/rost/Документи/revyme/revyme-builder-fork/src/editor/CodeEditor.tsx:373).

`performSave()` ловить помилку, встановлює error та retry, але завершується успішно як `Promise<void>`. Через це `await flushSaveNow()` теж успішний. Виклики вище показують success toast, позначають буфер saved або переходять до POST publish.

**Підтверджено:** mock backend відмовляє з 503, `saveStatusAtom` стає error, але Promise `flushSaveNow()` resolve-иться. Подальший Publish може збирати старий snapshot із DB, якщо його endpoint доступний; реальну публікацію під час аудиту не виконували.

**Виправлення:** background retry і явний flush мають різний контракт. Background save може планувати retry; manual save/publish повинні отримувати помилку або явний результат `{ ok: false }`. Публікація дозволена лише після підтвердження актуального snapshot. Success toast і dirty-state очищати тільки при `ok`.

**Приймання:** failing backend → відсутній success toast, відсутній POST publish, буфер залишається dirty; успішний retry оновлює статус коректно.

## 6. AUD-11 — LocalBackend не повідомляє, що ніде не зберіг дані

**Код:** [LocalBackend.saveProject](/home/rost/Документи/revyme/revyme-builder-fork/src/backend/local-backend.ts:77).

Помилка `localStorage.setItem` ігнорується; результат server PUT не перевіряється через `res.ok`; network error також ігнорується. Метод може завершитися без помилки, коли обидва сховища відмовили.

**Підтверджено:** `QuotaExceededError` у localStorage та HTTP 500 server PUT → Promise все одно resolve. Навіть після виправлення AUD-02 цей backend самостійно продовжить створювати хибний Saved.

**UX:** великі локальні проєкти можуть показувати успішне збереження і втрачати останню версію після reload. Якщо localStorage успішний, але server PUT провалився, правка доступна лише локально, а server/version history відстає.

**Виправлення:** перевіряти статус обох операцій та повертати точний результат. Якщо жодне сховище не підтвердило запис — throw. Якщо fallback допустимий — явно показати «збережено локально, сервер недоступний» і повторювати server save; не маскувати його загальним Saved.

**Приймання:** quota + offline, quota + HTTP 500, тільки local success, тільки server success, повторне завантаження з відсталого сервера.

## 7. AUD-04 — властивості вибраного instance застосовуються до іншого

**Код:** [findInstanceTag](/home/rost/Документи/revyme/revyme-builder-fork/src/editor/tools/ComponentPropsTool/instance-props.ts:28).

Пошук за ID підтримує лише `data-id="..."`. Для валідного `data-id='...'` пошук провалюється, після чого fallback безумовно бере перший тег компонента. Так само поводиться неоднозначний fallback без знайденого ID.

**Підтверджено:** є Card A та Card B з одинарними лапками. Читання props для B повертає title A. Запис title для B змінює A; B залишається незмінним.

**Прояв:** користувач вставив/відредагував валідний TSX у code editor, вибрав другу картку і змінив її колір чи текст. Панель читає та змінює іншу картку, хоча selection правильний. Формат з одинарними лапками допустимий JSX; проблема в locator, а не в React.

**Виправлення:** визначати тег через AST і фактичне значення `data-id`, незалежно від формату literal. При кількох тегах і невідомому ID не виконувати fallback-write у перший. Heal missing IDs до редагування і застосовувати спільний точний locator для read/write/remove/conditional props.

**Приймання:** double/single/expression string IDs; кілька екземплярів; props із вкладеним JSX; відсутній ID → контрольована відмова без чужої правки.

## 8. AUD-05 — mobile-стиль програє ширшому breakpoint

**Код:** [getResponsiveOverridesForNode](/home/rost/Документи/revyme/revyme-builder-fork/src/canvas/renderer/responsive.ts:123), [використання у Renderer](/home/rost/Документи/revyme/revyme-builder-fork/src/canvas/Renderer.ts:2525).

Breakpoints сортуються за зростанням `maxWidth`, а кожна наступна matching rule перезаписує попередню. Тому ширша rule застосовується останньою, всупереч власному коментарю про перевагу вужчої.

**Підтверджено:** CSS містить tablet ≤768: 24px, потім mobile ≤375: 12px. Resolver для 375 повертає 24px. У звичайному CSS з такою послідовністю правил mobile declaration була б останньою.

**Межа:** дефект стосується overlapping max-width rules. Свіжі banded rules із взаємовиключними min/max не перетинаються і не демонструють цей сценарій. Ризик стосується legacy та авторського CSS; не всі responsive-правки зламані.

**Виправлення:** визначити один контракт cascade між parser, CSS та resolver. Для builder max-width dialect — застосовувати ширші правила раніше вужчих; якщо дозволено довільний авторський CSS — враховувати source order/specifity, а не лише сортування. Кешувати підготовлену послідовність на render pass.

**Приймання:** overlapping rules, min/max bands, однакові межі, fractional widths, перевірка canvas проти реального CSS.

## 9. AUD-06 — component preview втрачає кліки та pointer-взаємодії

**Код:** [безумовне очищення handlers](/home/rost/Документи/revyme/revyme-builder-fork/src/canvas/code-component-runtime.ts:331), [ComponentPreviewPane](/home/rost/Документи/revyme/revyme-builder-fork/src/editor/component-editor/ComponentPreviewPane.tsx:41).

Compiler видаляє JSX mouse/pointer/click handlers і глобальні mouse/pointer listeners незалежно від `previewMode`. Режим preview змінює `useStaticCanvas`, але не цей етап. Для preview також залишається canvas-stub `next-themes` із noop `setTheme`.

**Підтверджено на вбудованому CopyButton:** з `previewMode: true` клік не викликає clipboard і не змінює label на Copied. Аналогічний шлях прибирає onClick Accordion та кнопок Carousel. Сторінковий preview sandbox має інший compiler; висновок не означає, що кліки видаляються і на опублікованому сайті.

**UX:** користувач перевіряє компонент у «живому» preview і бачить його як несправний, хоча live-site source містить handlers. Частина поведінки на canvas і component preview стає невідрізненною.

**Виправлення:** canvas restrictions застосовувати тільки у static canvas mode. Preview запускати з нормальними handlers і provider/shim-контекстами; для ізоляції глобальних ефектів використати preview iframe. Не передавати canvas-noop ThemeProvider у live preview.

**Приймання:** CopyButton click, Accordion click/keyboard, Carousel next/prev/pause, pointer effects; паралельний тест, що canvas selection лишається стабільним.

## 10. AUD-12 — shared component dependency помилково визначається як цикл

**Код:** [compileWithDependencies](/home/rost/Документи/revyme/revyme-builder-fork/src/preview/ComponentLivePreview.tsx:21).

Один `visited` Set використовується для всього обходу та ніколи не очищається після повернення з рекурсії. Друге використання вже скомпільованої залежності повертає `null`, хоча справжнього циклу немає. Додатково один global RegExp з mutable `lastIndex` повторно використовується в рекурсії.

**Підтверджено:** Root містить Left і Right; обидва імпортують Shared. У component preview немає Shared content, натомість ErrorBoundary отримує `Element type is invalid`.

**UX:** звичайна композиція повторно використовуваних карток, кнопок чи іконок ламає preview master-компонента. У графі немає циклу; відмова штучна.

**Виправлення:** окремі `visiting` для поточного recursion stack і `compiled` cache для завершених файлів. Повторна завершена залежність береться з cache; тільки повторна visiting — цикл. Imports збирати до рекурсії через локальний iterator або AST; не ділити один `lastIndex` між stack frames.

**Приймання:** diamond graph, кілька siblings із shared child, справжній цикл, повторне використання після редагування Shared.

## 11. AUD-07 — видалення handlers пошкоджує валідний JavaScript

**Код:** [stripJsxMouseHandlers](/home/rost/Документи/revyme/revyme-builder-fork/src/canvas/code-component-runtime.ts:262).

Сканер рахує всі `{` і `}`, включно з тими, що знаходяться у strings/comments. Він не відстежує лексичний контекст. Це не brace-balanced parser для JavaScript, попри коментар.

**Підтверджено:** `<button onClick={() => console.log("}")}>Demo</button>` — валідний JSX, але `compileCodeComponent()` повертає null після очищення handler.

**UX:** code-компонент із валідним handler зникає з canvas або показує Compilation returned null. Користувач отримує помилку компіляції у коді, який сам по собі правильний.

**Виправлення:** видаляти потрібні `JSXAttribute` та listener calls через Babel AST. Якщо текстовий scanner тимчасово залишиться, він має обробляти quotes, escapes, comments та template literals. Preview взагалі не має виконувати це очищення, відповідно до AUD-06.

**Приймання:** braces у quoted strings, escaped quotes, templates, comments, nested arrow functions; джерело після очищення залишається синтаксично валідним.

## 12. AUD-16 — ModelViewer/SplineScene не мають завершеного dependency loading

**Код:** [optional dependency loaders](/home/rost/Документи/revyme/revyme-builder-fork/src/canvas/code-component-runtime.ts:207), [їх запуск](/home/rost/Документи/revyme/revyme-builder-fork/src/canvas/code-component-runtime.ts:310), [ModelViewer dynamic import](/home/rost/Документи/revyme/revyme-builder-fork/src/code/project/default-code-components/ModelViewer.ts:44), [SplineScene](/home/rost/Документи/revyme/revyme-builder-fork/src/code/project/default-code-components/SplineScene.ts:31), [sandbox import map](/home/rost/Документи/revyme/revyme-builder-fork/src/canvas-sandbox/index.html:27).

У поточній інсталяції `npm ls three @splinetool/runtime --depth=0` повертає empty. Пакети не оголошені у кореневому package.json; import maps sandbox/preview не містять їх. Шаблони виконують native `import('three')` та `import('@splinetool/runtime')` у коді, що компілюється в runtime.

Наявні `ensureThree/ensureSpline` запускаються лише при пошуку статичного `from '...'`, тоді як самі built-ins використовують dynamic import. Вони також fire-and-forget, і прапорець loaded встановлюється до успішного завантаження. Навіть просте встановлення npm dependency не забезпечує browser-resolution для eval-коду.

**Статус:** підтверджена незавершеність wiring у цьому checkout; реальний browser network failure окремо не відтворювався. Компіляційний inventory проходить, бо import виконується пізніше, у effect.

**Виправлення:** явний async dependency registry з Promise-cache та awaiting перед mount; перетворювати static/dynamic imports на один підтриманий resolver або додати перевірені browser import-map entries. Dependency failure показувати у component UI з Retry. Прапорець ready встановлювати після успіху. Перевірити окремо exporter/deployer у репозиторії, який його реалізує.

**Приймання:** fresh install → додати 3D component → asset завантажується без unresolved specifier; повільна мережа, перша відмова і retry.

## 13. AUD-09 — ModelViewer не застосовує initial camera/rotation та має незупинний RAF

**Код:** [async init](/home/rost/Документи/revyme/revyme-builder-fork/src/code/project/default-code-components/ModelViewer.ts:39), [effects camera/rotation](/home/rost/Документи/revyme/revyme-builder-fork/src/code/project/default-code-components/ModelViewer.ts:124), [autoRotate cleanup](/home/rost/Документи/revyme/revyme-builder-fork/src/code/project/default-code-components/ModelViewer.ts:140).

Камера та модель створюються після await/loader callback. Їхні окремі effects на першому mount бачать порожні refs і завершуються. Заповнення ref не запускає effects повторно, тому initial camera position/rotateY/autoRotate пропускаються. Основний effect залежить лише від modelPath: зміни `envIntensity`, `bgColor` і розмірів не оновлюють renderer. ResizeObserver відсутній.

Окремо spin loop планує наступні RAF без збереження їхніх IDs. Cleanup скасовує тільки ID першого кадру. Після його виконання наступний кадр залишається активним.

**Підтверджено fixtures:** початкова camera position — `(0,0,0)` при cameraDistance 5; зміна lighting/background не змінює renderer; після вимкнення autoRotate наступний spin RAF усе ще запланований. Візуальна якість реальної GLB-сцени не оцінювалася.

**Виправлення:** після async init/load застосувати актуальні props до готових objects; ready/state або один controller з актуальними refs. Додати effects для background/lights і ResizeObserver для renderer size/camera aspect. Зберігати актуальний spin RAF та cancelled flag; очищати model refs і GPU-ресурси на заміну/unmount.

**Приймання:** initial camera/rotation; autoRotate=true до load; toggle після кількох кадрів; resize; заміна моделі під час завантаження.

## 14. AUD-08 — ImageSequence залишає попередні кадри після нового upload

**Код:** [load effect](/home/rost/Документи/revyme/revyme-builder-fork/src/code/project/default-code-components/ImageSequence.ts:25), [draw dependencies](/home/rost/Документи/revyme/revyme-builder-fork/src/code/project/default-code-components/ImageSequence.ts:70), [формат upload](/home/rost/Документи/revyme/revyme-builder-fork/src/editor/controls/UploadControl.tsx:88).

При зміні folder/totalFrames `loaded` не скидається. Друге завантаження викликає `setLoaded(true)` поверх уже true; draw effect не залежить від folder/версії набору, тому не запускається. Крім того, URL-list розпізнається лише за символом `|`; один upload URL стає «папкою».

**Підтверджено:** після завантаження A та заміни на B `drawImage` усе ще викликаний тільки для A. Один URL `https://cdn.example/frame.webp` перетворюється на `.../frame.webp/frame-001.webp`.

**Додатково видно у коді:** scroll/data-frame draw paths ігнорують Fit та малюють stretch; manual frame draw не має реакції на resize; старі image callbacks не скасовуються. Ці додаткові наслідки не перевірені окремими browser-тестами.

**Виправлення:** ready revision для кожного набору; cancellation/generation token; явний array URLs замість delimiter-евристики. Усі три draw paths повинні використовувати одну fit-функцію. ResizeObserver має перемальовувати поточний кадр. Неуспішне завантаження всіх frames показувати як error, а не як loaded.

**Приймання:** перший та повторний upload, один файл, різні counts, швидка заміна, failed frame, resize, contain/cover при scroll.

## 15. AUD-10 — контролі component editor не відповідають власній metadata

**Код:** [numeric fallback](/home/rost/Документи/revyme/revyme-builder-fork/src/editor/component-editor/ComponentPropsPanel.tsx:82), [unrendered controls](/home/rost/Документи/revyme/revyme-builder-fork/src/editor/component-editor/ComponentPropsPanel.tsx:145).

Панель підтримує тільки частину типів `@controls`. `objectList`, `imageList`, `font` потрапляють у default і зникають. Це не лише slot, для якого відсутність editor equivalent могла б бути очікуваною. У numeric sliders використано `parseFloat(value) || default`: валідний 0 замінюється nonzero default.

**Підтверджено:** у Accordion editor відсутній Questions & Answers, хоча його metadata має objectList. При Radius=0 текстове поле показує 0, а slider — 16. Користувач бачить два різних значення однієї властивості.

**Виправлення:** повторно використати editors для list/font із Properties panel або спільний control registry. Для числа — перевіряти `Number.isFinite`, а не truthiness. Upload має передавати `uploadSource` і обробляти `onBatchComplete` для узгодження totalFrames. Group defaults треба розгортати у flat props; transition objects серіалізувати як JSON, а не `[object Object]`.

Останні metadata-деталі встановлені читанням коду; два основні UI-дефекти перевірені тестами.

**Приймання:** parity для всіх CONTROL_TYPES, нуль/від'ємне число/порожнє поле, Accordion list edits, imageList reorder, font selection, transition round-trip.

## 16. AUD-14 — Camera X / Y у SplineScene є неактивними налаштуваннями

**Код:** [SplineScene](/home/rost/Документи/revyme/revyme-builder-fork/src/code/project/default-code-components/SplineScene.ts:11).

Обидва props оголошені в metadata і destructuring функції, але далі не використовуються. Немає camera update effect або виклику Spline API.

**Прояв:** slider змінюється і записує значення, а сцена не реагує. Це створює очікування функції, яку компонент не реалізує. Статус — аналіз коду, без підключення зовнішньої сцени.

**Виправлення:** реалізувати camera update через підтверджений API використаної версії runtime і тест із camera fixture; якщо runtime не надає потрібної можливості — прибрати ці контролі до її реалізації. Зміни camera не повинні повністю перевантажувати сцену.

## 17. AUD-15 — Duplicate у Library є порожньою дією

**Код:** [design row menu](/home/rost/Документи/revyme/revyme-builder-fork/src/editor/left-toolbar/panels/LibraryPanel/sections/ComponentsSection.tsx:151), [code row menu](/home/rost/Документи/revyme/revyme-builder-fork/src/editor/left-toolbar/panels/LibraryPanel/sections/ComponentsSection.tsx:194).

В обох меню активний Duplicate має handler `() => { /* TODO */ }`. Натискання нічого не змінює і не пояснює стан.

**Виправлення:** додати clone operation: унікальний file/internal name, remap внутрішніх node IDs для design-компонента, clone metadata, один history step, autosave та виділення нової копії. До реалізації приховати або disabled-позначити команду. Не достатньо просто скопіювати TSX без перевірки IDs та залежностей.

**Приймання:** design/code duplicate, кілька копій поспіль, variants/slots metadata, undo/redo, reload.

## Пропозиція реалізації

| Етап | Що виправляти | Умова завершення |
|---|---|---|
| 1 — захист роботи | AUD-00, 01, 02, 11, 13 | Load failure не монтує scaffold; save серіалізований; false success неможливий; master Save переживає reload і undo |
| 2 — цілісність JSX | AUD-03, 04, 07 | AST-based delete/locator/handler stripping; результати parseable; відсутні чужі правки |
| 3 — відповідність preview | AUD-05, 06, 12 | Responsive-результат відповідає CSS; handlers працюють у preview; shared dependencies не ламають композицію |
| 4 — built-ins | AUD-16, 09, 08, 10, 14, 15 | 3D load, lifecycle cleanup, frames reload, parity controls, кожна видима команда виконує обіцяну дію |

Спільний напрям: запровадити єдину операцію commit для ProjectFS з mutation flush, history, autosave та перевіркою результату. Різні UI-екрани зараз по-різному трактують «збережено». Для JSX-ідентифікації та structural transforms використовувати AST; текстові regex залишати тільки для некритичних quick checks. Static canvas, component preview та page preview повинні мати явно визначені, перевірені контракти поведінки.

Нові regression-тести слід переносити у відповідні `src/...` suites та змінювати assertions на бажану поведінку під час виправлення. Поточні аудит-тести навмисно перевіряють існування дефекту; їхній зелений статус не означає, що дефекти виправлені.

## Відтворення та артефакти

Тести: [каталог аудиту](/home/rost/Документи/revyme/revyme-builder-fork/docs/audits/2026-10-10/vitest.config.ts).

Команда з кореня репозиторію:

```bash
npx vitest run --config docs/audits/2026-10-10/vitest.config.ts
```

Валідація базового стану:

```bash
npx tsc --noEmit
npx vitest run
npm run build:all
```

Логи перевірок збережено поруч із відтвореннями у `docs/audits/2026-10-10/`. Збірки мають попередження про великі chunks; jsdom-набір має warnings про unsupported media/canvas API. Вони не трактовані як доведені UX-дефекти. Два runtime-source-dependent suites виключаються базовою конфігурацією, коли немає sibling runtime repo; повний unit-звіт також містить інші skipped/todo.

Головний звіт — звичайний Markdown-файл. Каталог `docs/audits/` ігнорується поточним `.gitignore`: відтворення та логи залишаються локальними артефактами; для перенесення у CI їх потрібно явно включити або перемістити у тестові каталоги. Production-файли не змінювались.
