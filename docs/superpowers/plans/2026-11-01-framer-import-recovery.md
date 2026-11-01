# Framer to Revyme Import Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Цей документ є планом; реалізація ним не запускається.

**Goal:** Імпортувати вибрану сторінку Walker повністю, з власними значеннями компонентів, чотирма CMS-картками, layout і редагованими компонентами Revyme, без пошкодження проекту.

**Architecture:** Розширення збирає початкові дані Framer та замкнений набір залежностей. Єдиний конвертер у Revyme готує файли сторінки, компонентів, CMS і template у пам’яті; перевірений результат записується через наявні операції проекту. Clipboard, popup і floating widget використовують той самий адаптер та підтвердження результату.

**Tech Stack:** Chrome MV3 JavaScript; TypeScript; Babel AST; React/Next.js; ProjectFS, mutation queue, Oracle; Vitest та Playwright.

**Spec:** Вимоги та докази наведено нижче у розділах «Висновок», «Підтверджені причини» і «Критерії приймання». Дата дослідження 1 листопада 2026 року.

## Global Constraints

- Змінювати вихідний код під час цього дослідження не дозволено; створено лише цей план і документ звіту.
- ProjectFS source є правдою. Canvas DOM не виправляти вручну; вимірювання canvas читати через bridge.
- Наявні файли ProjectFS змінювати через `modifyProjectFile`; спочатку flush, потім свіжа база, потім запис і синхронізація queue.
- Не читати `data/builds/`. Початкові дані і fixtures не містять файлів із build cache.
- Зберігати `trace.action` / `trace.fn` / `trace.error`; не приховувати втрати порожнім `catch`.
- Файли сторінки, master і template мають пройти `checkFile` з правильним `kind` перед записом.
- Не виконувати довільні Framer module URLs; непідтримувані модулі мають явну діагностику.
- Не називати імпорт повним, якщо CMS, layout або потрібний master не завантажено.
- Використовувати наявні helpers та генератори. Новий runtime потрібен тільки для поведінки, що має працювати після публікації.

## Review Focus

1. Два екземпляри одного master з різними props не мають спільних instance ID; редагування одного не змінює інший.
2. Один requestId, доставлений двічі, виконує одну операцію; відсутній receiver не дає статус «успішно».
3. Порожній lazy-loaded layout, відсутній nested master або цикл залежностей не перетворюються на тихо обрізану сторінку.
4. Чотири featured CMS-записи мають власні тексти, фото/відео й категорії; дефолт master не підміняє row context.
5. Помилка в одному з підготовлених файлів і pending mutation не залишають частково імпортований проект; Undo/Redo відновлює весь набір.

## Висновок

Основна втрата відбувається до вставлення: конвертер розширення видає неповне і семантично некоректне дерево. Revyme отримує вже спрощений результат. Виправлення тільки приймача, ширин або способу вставлення не поверне відсутні CMS-записи, component props та layout.

Надані `Walker__copy_-revyme-clipboard (5).json` і `Walker__copy_ (4).tsx` — вже результати перетворення, а не початковий Framer pasteboard. Поруч знайдено `Walker__copy_-full-site.json`; його дерево містить ті самі ID. Повторний запуск актуального `content.js` у Node VM із lookup master із цього дерева відтворив усі 41 ClipboardNode побайтово на рівні `JSON.stringify(node)`. Це підтверджує причини для конкретного прикладу Walker, а не лише припущення за скріншотом.

Початковий знімок показує великий WALKER, чотири проекти, меню, контактний блок і нижній WALKER. Після імпорту лишилися малий WALKER, заголовок без типографіки, `Underline Link` і порожні ділянки. Нижче наведено прямі відповідності між цими симптомами й даними.

## Підтверджені причини

### 1 Компоненти розгортаються у звичайні div і втрачають дані екземпляра

`content.js:145–178` знаходить `canvasComponent/<scopeId>`, бере variant master і копіює лише `id`, `parentid`, `name`, `width`, `height`. Поля `$control__*`, widthType/heightType, position, anchors і інші instance overrides не застосовуються. `convertNodeToRevyme` взагалі не створює master-файлів Revyme або `ClipboardData.components`.

Для `PlNx_eCBE` raw instance має `$control__gerVZF2pu.value = "Let’s work together"`, а експорт містить `Underline Link`. Для `Xzo6ccR1l` raw має `→ See all work`, але експорт знову містить `Underline Link`. Значення береться з HTML master, а не з props конкретного екземпляра.

`$control__variant.value` містить ID `MUB6b9cRc`, а пошук порівнює його з `v.name`. Через це запитаний variant Large стає Regular. Cache fallback завжди бере першого нащадка і теж ігнорує variant.

Дві додаткові помилки: `unwrapComponents` обробляє тільки `children`, тому окремо скопійований CodeComponentNode як root лишається порожнім div; після підміни виконується `continue`, тому вкладені компоненти всередині вставленого clone не розгортаються. Модулі `module:.../Video.js:Video` та SmoothScroll взагалі не мають адаптера й стають порожніми div. SmoothScroll — невізуальна поведінка, його відсутність сама по собі не пояснює пропажу зображень.

### 2 CMS перетворюється на один шаблон без записів

`KA22dhnUZ` у raw має `dataIdentifier = local-module:collection/E5RT5hQRC:default`, `collectionRepeatedItemId = wxmzC1QHS` і filter по `DBADIc0Pr`. Колекція Works містить шість записів, із них чотири featured: Broken Alternatives, Elevated People, Studio Altera, High Society Club. Саме чотири картки видно в оригіналі.

Конвертер обходить children лише один раз; collection source, filters, records та bindings ігноруються. У результаті лишається один Project Card, та ще й із дефолтами master: Hybrid Culture і дефолтне фото `wqgvfFKBAD6qjRCseAxaWl0938.jpg`. Навіть якщо збільшити ширину цієї картки, чотири потрібні роботи не з’являться.

`globalVarMap` заповнюється лише з variables безпосередніх children root. Це не CMS row context. Посилання instance на колекцію, computedValue/isSet і типізовані props не резолвляться у значення конкретного запису. Для asset references поточний resolver завжди будує `/images/`, що непридатно для відео.

### 3 Шапка і футер належать layout який не експортується

Raw root містить `layoutTemplateIdentifier = local-module:layoutTemplate/B1BOPR7cc:default`. Scope `B1BOPR7cc`, Global Navigation, має `baseVariantId = KttVumVuH`, але `children: []`.

`preloadAllScopes` завантажує тільки SmartComponent і WebPage. LayoutTemplate не завантажується. `convertTreeToRevyme` вибирає лише перший Desktop першої Home і не обходить layout chain. Тому ці дані не потрапляють ні в JSON, ні в TSX. Чинного збереженого raw недостатньо для точного відновлення шапки та футера: потрібен новий export після завантаження layout scope. Зі скріншота підтверджено відсутність цих областей; вміст порожнього scope не можна достовірно вигадувати.

### 4 Геометрія компонентів перетворює Fill на 1 px

У instance логотипа `eirQL7LRt` та Project Card `jQNOhKL1R` ширина `1` поєднується з `widthType: 3`, тобто Fill. Master цих компонентів має `widthType: 0`. Після clone код копіює `width = 1`, але лишає widthType master. Конвертер читає це як Fixed і записує `width: '1px'`.

Отримано вузький логотип і картку з `overflow: hidden`, у якій фото фактично обрізане до смуги. Це пряма причина невидимої роботи на скріншоті; URL зображення присутній у JSON.

Ще три grid-контейнери, `XlenHI0pg`, `KA22dhnUZ`, `YwtMjmyMs`, мають `layout: 'grid'`, але конвертер реалізує тільки stack. Втрачаються 12 колонок hero, 2 колонки projects, spans, row sizes і gaps grid.

`widthType === 3` завжди дає і `width: '100%'`, і `flex: '1 0 0px'`, незалежно від осі parent. У вертикальному stack flex-basis керує висотою, а не шириною. Position примусово стає relative; anchors, absolute overlay, sticky/fixed, zIndex, visibility і constraints не зберігаються. Для media це дає два 100% елементи поряд замість правильного image/video шару.

### 5 Типографіка логотипа і заголовка губиться

`extractTextAndTag` видаляє весь HTML і inline styles. У raw логотип має Zalando Sans 800, fontSize приблизно 279.10 px, lineHeight 0.8em, letterSpacing -0.06em і `textFitViewBoxSize = 1124.745855223101 × 223`. В експорті лишається голий `p` із текстом WALKER без fontFamily/fontSize/fontWeight. Розмір логотипа на скріншоті відповідає цій втраті.

Для H1 raw HTML посилається на preset `hu17yxpMN`: 64px, lineHeight 1.075em, letterSpacing -0.04em, variable weight 450. Код спочатку вибирає `stylePresetParagraph = xK1Cyz18Y`, якого немає у preset map, та не доходить до Heading1. Експортований H1 не має жодного fontSize.

Line height із preset має переводитися в безрозмірний ratio Revyme. Зараз виводиться `1.4em`, що відхиляється Oracle. HTML entities, rich inline spans/links, line breaks та font loading теж потребують явного mapping. Текст у TSX інтерполюється без escaping: `A < B & {price}` перетворюється на синтаксис JSX/вирази, а не гарантовано літеральний текст.

### 6 ID master повторюються між екземплярами

У JSON 41 запис, але лише 37 унікальних ID. Двічі зустрічаються `uLUi_cY4A`, `MhIYRayaq`, `TACvjFc6M`, `tLD0ypvQg` — нащадки двох екземплярів одного Underline Link.

`generateRevymeJsx` створює Map по ID: останній запис перезаписує перший, тому різні instances посилаються на ті самі children. Парсер Revyme отримує лише 37 вузлів із цього TSX. Paste builder, навпаки, шукає children за parentId, тож для спільного parent ID забирає children обох екземплярів. Модель цього обходу дає 45 створюваних визначень із 41 запису. Це дві різні форми пошкодження того самого графа.

Простий dedupe масиву не є виправленням: він видалить один екземпляр. Потрібні локальні ID master плюс унікальні instance IDs; у flattened fallback — namespace всіх нащадків по шляху instance.

### 7 Транспорт має кілька несумісних маршрутів і неправдивий успіх

`content.js` працює у MAIN world і намагається записувати `chrome.storage.local`. Extension API там не є надійно доступним каналом; в manifest немає окремого isolated relay для Framer. Popup export частково обходить проблему: отримує результат через `chrome.scripting.executeScript` і сам записує storage. Автоматичний Ctrl+C такого шляху не має.

Floating widget викликає direct API, потім CustomEvent, потім postMessage без взаємовиключення. Revyme слухає обидва events. У штатному ISOLATED injector direct window API не видно; залишаються два повідомлення для однієї дії. Popup використовує інший шлях і також не аналізує boolean результат імпорту. Обидва UI показують успіх без підтвердження запису.

HTML marker розширення — `data-revyme-import`, а Framer reader шукає `data-revyme-framer-import`. Існуючий Figma reader також використовує `data-revyme-import`, тож новий reader має перевіряти source/type, не перехоплюючи чужий payload. Plain JSON envelope зараз може дійти через пізніший generic `revymeClipboard` fallback у shortcuts; стверджувати, що Ctrl+V завжди не працює, неправильно. Якщо одночасно лишився старий `data-framer-pasteboard`, Framer route спрацьовує раніше і використовує інший, спрощений converter без unwrap master.

`convertFramerPayload(envelope)` і `convertFramerPayload(envelope.data)` обидва повертають 0 вузлів: ця функція приймає тільки raw tree, а не готовий clipboard envelope. Це окремий contract case для адаптера, не доказ того, що кожен поточний UI route саме так викликає converter.

Довідка щодо розділення execution worlds та спілкування content scripts: [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts), [Chrome scripting ExecutionWorld](https://developer.chrome.com/docs/extensions/reference/api/scripting#type-ExecutionWorld).

### 8 Replace записує невалідний для Revyme TSX поза безпечним циклом

`src/canvas/framer-paste.ts:133–149` спочатку викликає `projectFS.writeFile`, потім `store.set(codeAtom, ...)`, і лише після цього `flushNow()`. Pending mutations можуть застосуватися до старої бази й перекрити новий імпорт. Oracle не викликається; існуючі viewport config, page root, template contract і Undo для всіх файлів не забезпечені цим шляхом.

TSX розширення не має `data-id="root"` та `@canvas`. Генератор бере лише `rootNodeIds[0]`, тому при multi-selection TSX губить інші roots, хоча JSON їх містить. Атрибути `name` не переносяться в `data-name`.

Oracle над наданим файлом повернув 32 порушення: 5 LINE_HEIGHT_FORMAT, 4 DUP_DATA_ID, 12 FLEX_CHILD_MISSING_ORDER, 7 FLEX_CHILD_SHRINKS, 1 FLEX_ROW_CHILD_FULL_WIDTH, 1 CANVAS_CONFIG_MISSING, 1 PAGE_ROOT_REQUIRED, 1 WOULD_CRASH. Останні два — tier 3. Отже, синтаксично валідний React-код не дорівнює валідному документу Revyme.

## Результати перевірок

- Зіставлено обидва надані файли, розширення, raw full-site, приймач Revyme і обидва скріншоти.
- Відтворення converter у VM з engine lookup: 41/41 ClipboardNode збігаються зі збереженим JSON; 37 unique IDs.
- Raw root component у VM стає порожнім div; запитаний variant Large стає Regular.
- Перевірено `parseJSXToNodes`: 37 вузлів. Перевірено `convertFramerPayload` з готовим envelope/data: 0 вузлів.
- `npx vitest run src/code/import/framer/convert.test.ts`: 2/2 пройшли. Ці тести перевіряють базовий stack і 21 raw node, не instances/CMS/layout/Oracle. Один тест залежить від абсолютного шляху Downloads і тихо повертається, коли fixture відсутня.
- Окремий тимчасовий Vitest diagnostic у `/tmp/framer-revyme-audit` підтвердив 4 DUP_DATA_ID, PAGE_ROOT_REQUIRED та CANVAS_CONFIG_MISSING; повний Oracle список має 32 порушення. Це перевірка існування дефектів, а не тест виправлення.
- Не виконувалися жива вставка у Framer/Revyme, перевірка мережевої доступності asset URLs, публікація чи відтворення анімацій. Скриншоти — надані користувачем; геометричний pixel diff по них не вимірювався.

## Рекомендований обсяг виправлення

Перший реліз має підтримувати саме залежності сторінки Walker: smart components Logo, Underline Link, Project Card; реальні дані Works/Category; Global Navigation layout; grid, fit-text, image/video; правильний bridge і безпечний запис. Це цілісний результат, а не проголошення універсальної підтримки Framer.

Статичне розгортання instances допустиме як діагностичний fallback із повідомленням про втрату редагованості. Воно не є фінальним виправленням запиту на перенесення компонентів. Невідомі code modules не повинні тихо зникати; для Video і SmoothScroll потрібні явні адаптери до нативної можливості Revyme або діагностика.

Нижче нові функції та файли — запропоновані інтерфейси, а не твердження, що вони вже існують. Існуючі функції названі окремо як точки повторного використання.

## Task 1 Зберегти fixtures та додати вхідний контракт

**Files:**
- Create: `src/code/import/framer/payload.ts`, `payload.test.ts`.
- Create: `src/code/import/framer/fixtures/walker-source.json`, `walker-broken-clipboard.json`, `walker-broken.tsx`.
- Modify: `src/code/import/framer/convert.test.ts` для перенесення fixture з Downloads у репозиторій.

**Interfaces:**
- Consumes: raw Framer tree, raw pasteboard, `{revymeClipboard:1,data}`, ClipboardData.
- Produces: `decodeFramerInput(input: unknown): DecodedFramerInput`; union `{kind:'clipboard',data:ClipboardData}` або `{kind:'raw',envelope:FramerSourceEnvelope}`.
- `FramerSourceEnvelope` має `source:'framer-extension'`, `version:1`, `scope:'selection'|'page'`, `pageId?:string`, `selectedIds:string[]`, `tree:unknown`, `dependenciesComplete:boolean`, `missingScopeIds:string[]`.

- [ ] **Step 1:** Додати failing contract-тести, включно з передаванням готового JSON без повторної конвертації.

```ts
it('keeps native clipboard envelopes out of raw conversion', () => {
  const decoded = decodeFramerInput(walkerClipboard);
  expect(decoded.kind).toBe('clipboard');
  if (decoded.kind === 'clipboard') {
    expect(decoded.data.nodes).toHaveLength(41);
  }
});
it('does not call an empty layout complete', () => {
  expect(walkerSource.root.children.find(n => n.id === 'B1BOPR7cc').children).toEqual([]);
});
```

- [ ] **Step 2:** `npx vitest run src/code/import/framer/payload.test.ts` — спочатку FAIL через відсутній decoder.
- [ ] **Step 3:** Реалізувати вузький decoder; unsupported version/invalid shape повертає типізовану помилку. Готовий clipboard зберігати як clipboard, але валідувати його граф перед імпортом.
- [ ] **Step 4:** Прибрати залежність тесту від Downloads і silent `return`; перезапустити весь `src/code/import/framer`.
- [ ] **Step 5:** Окремий commit із fixtures і contract. Fixture має бути обрізана до потрібних scope/колекцій без сторонніх LocalModule payloads, а expected IDs/records мають зберегтися.

## Task 2 Зібрати повну сторінку та надійно доставити один запит

**Files:**
- Modify extension: `manifest.json`, `content.js`, `popup.js`, `revyme-injector.js`.
- Create extension: `framer-relay.js` у ISOLATED world; `tests/transport.test.cjs`, `tests/scopes.test.cjs` через `node:test` і VM mocks.
- Modify builder: `src/canvas/framer-paste.ts`.
- Create builder: `src/code/import/framer/bridge.test.ts`.

**Interfaces:**
- Consumes: selected Framer page/selection, engine scopes і FramerSourceEnvelope із Task 1.
- Produces: `collectFramerSource({scope,pageId,selectedIds}, engine): Promise<FramerSourceEnvelope>` у MAIN; message `{type:'REVYME_IMPORT_FRAMER',requestId,payload}`; response `{type:'REVYME_IMPORT_FRAMER_RESULT',requestId,ok,errors:string[],warnings:string[]}`.
- Receiver `receiveFramerRequest(request): Promise<FramerImportResult>`; completion cache для requestId з обмеженим розміром. `FramerImportResult` має `ok`, `errors`, `warnings`.

- [ ] **Step 1:** Написати red-тести: MAIN → relay → storage; request duplicate; відсутній receiver; receiver `ok:false`; missing template; selected root component; два roots; pageId замість першої Home.

```ts
it('commits a repeated request once', async () => {
  const request = { type:'REVYME_IMPORT_FRAMER', requestId:'same', payload:validInput };
  await Promise.all([receiver(request), receiver(request)]);
  expect(commit).toHaveBeenCalledTimes(1);
});
it('refuses a full page with an unloaded required layout', async () => {
  const source = await collectFramerSource({scope:'page',pageId:'augiA20Il',selectedIds:[]}, engineWithMissingTemplate);
  expect(source.dependenciesComplete).toBe(false);
  expect(source.missingScopeIds).toContain('B1BOPR7cc');
});
```

- [ ] **Step 2:** Запустити builder bridge tests через Vitest і extension tests через `node --test tests/*.test.cjs`; підтвердити потрібні FAIL.
- [ ] **Step 3:** MAIN лише читає engine/clipboard. ISOLATED relay валідовує source/event, пише extension storage. Collector повторює dependency walk до замикання: selected page, base/replica scopes, layout chain, nested smart masters, required CMS/variables/presets/assets. Відвідані scopeId й stack захищають від циклів. `loadScopes` використовувати лише після перевірки фактичної engine API; при неможливості завантаження повний режим повертає missing dependencies.
- [ ] **Step 4:** Усі UI використовують один request/response маршрут; прибрати послідовну відправку трьома каналами. У receiver перевіряти source/origin, schema, requestId; success лише після commit. Timeout є помилкою, `ok:false` відображається як помилка. Новий HTML marker має source/version discriminator і DOM-based parsing із повторним використанням підходу Figma.
- [ ] **Step 5:** Виконати нові тести та browser smoke на завантаженому extension. Зробити новий raw export: `B1BOPR7cc.children` більше не порожній; зберегти його як layout fixture. Окремий commit.

## Task 3 Правильно перенести masters variants та instance props

**Files:**
- Create builder: `src/code/import/framer/components.ts`, `components.test.ts`, `graph.ts`, `graph.test.ts`.
- Modify builder: `src/code/import/framer/convert.ts`.
- Modify extension `content.js`: прибрати авторитетну генерацію Revyme styles/TSX; source export залишається.
- Reuse: `src/code/generation/create-component-gen.ts`, `src/code/variants/variant-config.ts`, `src/code/components/prop-meta.ts`, `src/cloud/components/cross-project-paste.ts`.

**Interfaces:**
- Consumes: complete FramerSourceEnvelope і index scopeId → node.
- Produces: `resolveFramerInstance(instance, scopeIndex, context): ResolvedInstance`; поля `masterId`, `variantId`, `props`, `placement`.
- Produces: `compileFramerComponents(source): {components:ClipboardComponentMaster[];instances:ClipboardNode[];diagnostics:string[]}`. Master ID локальний у власному файлі; instance отримує окремий унікальний ID.
- `validateClipboardGraph(data:ClipboardData): string[]` перевіряє uniqueness, відсутні посилання, відповідність parent/children і цикли; не виправляє граф видаленням дубльованих nodes.

- [ ] **Step 1:** Написати semantic tests на реальні IDs.

```ts
it('keeps each instance override and selects variant by id', () => {
  const link = resolveFramerInstance(instanceSeeAll, scopes, {});
  expect(link.variantId).toBe('MUB6b9cRc');
  expect(link.props.Label).toBe('→ See all work');
  expect(link.placement.widthType).toBe(2);
});
it('rejects the broken Walker clipboard without deduping it', () => {
  expect(validateClipboardGraph(walkerClipboard.data).join(' ')).toContain('uLUi_cY4A');
});
it('preserves two link instances as distinct instances', () => {
  const result = compileFramerComponents(completeSource);
  const ids = result.instances.map(n => n.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(result.components.some(c => c.kind==='design')).toBe(true);
});
```

- [ ] **Step 2:** `npx vitest run src/code/import/framer/components.test.ts src/code/import/framer/graph.test.ts` — FAIL до реалізації.
- [ ] **Step 3:** Резолвити values у порядку row context → instance overrides → master defaults, з type-aware resolver для string/image/link/boolean/controlReference. Variant шукати по ID, з name fallback тільки для старих payload. Root і nested instances проходять той самий resolver; dependency cycles повертають diagnostics.
- [ ] **Step 4:** Smart components генерувати як design masters з variables/prop-meta/variantConfig і instance tags. Прості masters створювати через `buildCreatedMaster`; його чинні обмеження на nested instances/link props поважати. Для складніших master додати вузький emitter поверх наявних AST/variant helpers і перевірити `checkFile(kind:'component')`; не розширювати глобальний generator без окремої потреби. Component name має збігатися з basename файла. Не додавати expanded children до instance clipboard tag.
- [ ] **Step 5:** Зробити explicit adapters для Video, SmoothScroll та інших фактично виявлених модулів. Unknown module повертає diagnostic із source ID; не перетворювати його тихо на порожній div. Запустити component/graph tests і Oracle для згенерованих masters; окремий commit.

## Task 4 Відновити grid sizing типографіку та media

**Files:**
- Create: `src/code/import/framer/styles.ts`, `text.ts`, `styles.test.ts`, `text.test.ts`.
- Modify: `src/code/import/framer/convert.ts`, `components.ts`.
- Reuse: `src/shared/css-utils.ts`, `src/shared/flex-helpers.ts`, `src/code/generation/fit-text-gen.ts`, `src/shared/font-loader.ts`, `src/code/project/preset-ops.ts`.

**Interfaces:**
- Consumes: resolved node/instance, parent layout+axis, source presets, rich HTML, font metadata.
- Produces: `mapFramerStyles(node,parent): Record<string,string>`; `resolveFramerText(node,presets): {tag:string;text:string;styles:Record<string,string>;fit?:{width:number;height:number}}`.

- [ ] **Step 1:** Написати тести, що прив’язані до втрат зі скріншотів.

```ts
it('does not freeze fill card width to one pixel', () => {
  const style = mapFramerStyles(resolvedProjectCard, projectGrid);
  expect(style.width).not.toBe('1px');
});
it('finds the H1 preset from its actual HTML tag', () => {
  const result = resolveFramerText(rawHeading, presets);
  expect(result.styles.fontSize).toBe('64px');
  expect(result.styles.lineHeight).toBe('1.075');
});
it('preserves fit text metrics and literal JSX text', () => {
  expect(resolveFramerText(rawLogoText,presets).fit).toEqual({width:1124.745855223101,height:223});
  const generated = emitLiteralText('A < B & {price}');
  expect(generated).toBe('{"A < B & {price}"}');
});
```

- [ ] **Step 2:** Запустити styles/text tests; переконатися, що вони падають на значеннях, а не на помилці fixture.
- [ ] **Step 3:** Mapping sizing враховує axis parent: Fill на main axis → flex, на cross axis → stretch/relative width без помилкового flex-basis. Grid має columns/rows/gaps/spans; не додавати flex props grid children. Зберегти position/anchors/visibility, overlay images/videos і clipping. Sequential CSS `order` у flow children — quoted string; Fixed/Hug flex children не shrink. Не застосовувати «width 1 → 100%» як глобальне правило: 1 px може бути справжньою лінією.
- [ ] **Step 4:** Rich HTML розбирати як HTML, не regex strip. Preset вибирати за data-styles-preset/tag; відсутній Paragraph не блокує H1. Перенести inline `--framer-*` font values, декодувати entities, `font-weight`/variable axes, em/px line-height → ratio. Fit-text переносити через чинний `wrapInFitSVGInCode` і його editable contract. `emitLiteralText(text:string):string` повертає JSX expression із `JSON.stringify(text)`. Assets резолвити типізовано: image/video/file; зіставити з hosted media і await fonts перед geometry QA.
- [ ] **Step 5:** Запустити нові тести та `npx vitest run src/code/generation/fit-text-gen.test.ts src/code/import/framer`; окремий commit.

## Task 5 Перенести чотири CMS картки та layout як залежності сторінки

**Files:**
- Create: `src/code/import/framer/page-plan.ts`, `page-plan.test.ts`.
- Modify: `src/code/import/framer/convert.ts`, `components.ts`.
- Reuse: `src/code/project/cms-ops.ts`, `src/code/generation/cms-paste-gen.ts`, `src/code/project/template-ops.ts`, `src/code/project/canvas-config.ts`, чинні CMS query/binding generators.

**Interfaces:**
- Consumes: complete source, native component bundle, styles/text mapping.
- Produces: `buildFramerPagePlan(source): FramerPagePlan`; `FramerPagePlan` має `files:Array<{path:string;content:string;kind:'page'|'component'|'template'|'data'}>`, `pagePath`, `componentNames:string[]`, `featuredWorkTitles:string[]`, `diagnostics:string[]`.
- Жодних ProjectFS writes у builder функції.

- [ ] **Step 1:** Написати red-тести на чотири records, per-row props, media та template.

```ts
it('keeps all featured Works records', () => {
  const plan = buildFramerPagePlan(completeSource);
  expect(new Set(plan.featuredWorkTitles)).toEqual(new Set([
    'Broken Alternatives','Elevated People','Studio Altera','High Society Club'
  ]));
});
it('cannot claim a complete page without layout content', () => {
  const plan = buildFramerPagePlan(sourceWithEmptyLayout);
  expect(plan.diagnostics.join(' ')).toContain('B1BOPR7cc');
});
```

- [ ] **Step 2:** `npx vitest run src/code/import/framer/page-plan.test.ts` — очікуваний FAIL до реалізації.
- [ ] **Step 3:** Перенести Works/Category schemas і records у нативний CMS. Зіставити variable IDs із stable field names, source row ID з target row ID. Зберегти filter featured, source порядок та bindings card props. Не hardcode загальне правило «рівно чотири»: це очікування конкретної fixture. Image/video visible обчислювати з row context; Studio Altera має video або валідний poster.
- [ ] **Step 4:** Після нового export побудувати native template з Global Navigation, children slot і correct page assignment; використати createTemplate/assignTemplate semantics. Власне page file має canonical root, `@canvas` із фактичною шириною Desktop 1200, resolved responsive overrides. Tablet/Phone children у raw порожні — резолвити replica/base overrides, а не створювати порожні сторінки. Unknown breakpoint semantics явно відображати в diagnostics.
- [ ] **Step 5:** Перевірити, що plan містить файли CMS, masters, template, page pair; Oracle не має порушень на TSX. Окремий commit.

## Task 6 Єдиний безпечний commit та однаковий результат усіх UI

**Files:**
- Create: `src/code/import/framer/commit.ts`, `commit.test.ts`.
- Modify: `src/canvas/framer-paste.ts`, `src/canvas/shortcuts.ts`.
- Reuse: `modifyProjectFile`, `flushNow`, `src/code/mutation/history.ts`, `src/cloud/components/cross-project-paste.ts`, `src/code/features/paste-engine/execute-from-ui.ts`.

**Interfaces:**
- Consumes: decoded ClipboardData або validated FramerPagePlan, import mode, target page.
- Produces: `commitFramerPlan(plan,targetPage): Promise<FramerImportResult>` із Task 2; result після запису й синхронізації queue.

- [ ] **Step 1:** Написати failing integration tests для pending mutations, Oracle rejection, master import, multi-root, rollback, Undo/Redo та однакового payload через clipboard/widget/popup.

```ts
it('does not write any plan file when validation fails', async () => {
  const before = projectFS.getSnapshot();
  const result = await commitFramerPlan(invalidPlan,targetPage);
  expect(result.ok).toBe(false);
  expect(projectFS.getSnapshot()).toEqual(before);
});
```

Для history використовувати наявні `captureHistoryFileOpBefore` / `pushHistoryFileOp` і snapshot restore semantics.

- [ ] **Step 2:** Запустити commit integration tests; зафіксувати FAIL через обхід validation/flush ordering.
- [ ] **Step 3:** Спочатку flush old queue, потім валідувати candidate TSX за kind і graph/import references. Побудувати всі candidate files до запису. Чинний snapshot/history механізм має охопити весь import; при write failure відновити snapshot і queue. Існуючі файли — тільки через modifyProjectFile; нові — через штатні create operations. Не змінювати server metadata довільно при replace client body.
- [ ] **Step 4:** Для selection paste підготувати local masters/imports через чинні component import helpers ДО low-level engine: нинішній прямий engineExecutePaste цього не робить. Для full-page import використати page plan і canonical root; не застосовувати selection-dependent target rules до всієї сторінки. TSX download генерувати з тієї ж validated model; для набору залежностей віддавати bundle, а не обіцяти самодостатній один TSX.
- [ ] **Step 5:** Після commit перепарсити source, синхронізувати active file/queue, перевірити created IDs, тоді selection і success response. Окремий commit після проходження tests.

## Task 7 Перевірити кінцевий Walker та зафіксувати підтримуваний обсяг

**Files:**
- Create: `src/code/import/framer/walker.integration.test.ts`.
- Create: `src/code/import/framer/e2e/framer-import.spec.ts` (чинний Playwright testDir `./src`, testMatch `**/e2e/**/*.spec.ts`).
- Modify: extension `README.md` — реальні підтримувані типи, mode selection/page, warnings.

**Interfaces:**
- Consumes: final importer і новий complete Walker fixture; browser Framer reference 1200 px.
- Produces: semantic regression suite, browser screenshots при однаковій ширині, доказ редагованості й Undo/Redo.

- [ ] **Step 1:** Перед реалізацією acceptance E2E має показати current failures: 4 картки відсутні, великий logo відсутній, template відсутній.
- [ ] **Step 2:** При 1200 px й 100% масштабу зіставити original, builder canvas і preview. Зображення/шрифти мають завершити завантаження. Порівняти 2 колонки, 4 картки, logo, hero, links, footer; screenshot overlay і bounding boxes доповнюють semantic assertions. Для основних контейнерів ціль — різниця не більш як 2 CSS px після завантаження однакових шрифтів; для screenshot diff дозволити тільки текстове згладжування й контрольовану media animation.
- [ ] **Step 3:** Перевірити native Library masters, незалежність props двох instances, зміни variant, CMS edit, repeated paste, selected root component, multiple selection, replica breakpoints, export/reopen. Один Undo прибирає весь імпорт; Redo відновлює всі залежності.
- [ ] **Step 4:** Виконати targeted suites і `npx tsc --noEmit`. Повний `npx vitest run` — перед інтеграцією. При незв’язаних existing failures окремо зафіксувати їх і baseline, не оголошувати всю гілку зеленою.
- [ ] **Step 5:** Окремий commit acceptance tests/docs і review фактичного diff. Не розширювати заявлену підтримку до всіх Framer modules чи всіх анімацій без fixtures/браузерної перевірки.

## Критерії приймання

1. Великий WALKER має правильний fit text, шрифт і вагу. H1 64 px на source Desktop із правильним line-height.
2. Hero і Works використовують grid; видно чотири featured роботи з реальними даними, не Hybrid Culture за замовчуванням.
3. Підписи `Let’s work together` та `→ See all work` правильні; посилання зберігають href/target, variant Large не стає Regular.
4. Header/menu/contact/footer присутні після нового export із завантаженим Global Navigation.
5. Smart components є masters/instances Revyme; зміни в props і variant доступні панелям. Невідомий code module має named warning, не пустий div.
6. Немає duplicate ID, orphan refs, циклів, невідомих imports, некоректного root або missing @canvas; Oracle не повертає violations.
7. JSON paste, popup, widget і full-page import використовують той самий converter; один click/request не дублює content, success чекає commit.
8. Undo/Redo/reopen/preview не втрачають дані; pending mutation не перезаписує import.
9. На Tablet/Phone збережено існуючі source overrides; відсутні lazy-loaded дані не підмінено порожнім дизайном.

## Послідовність і межі

Task 1 → 2 → 3 → 4 → 5 → 6 → 7. Task 2 потрібен до повного layout fixture; Tasks 3–4 можна перевіряти на вже збережених raw masters. Відновлення layout неможливо завершити зі старого raw з `children: []`.

Анімації, hover connections, smooth scrolling та нестандартні code modules додавати після геометрії, даних і native компонентів. Це окрема перевірка поведінки; її не приховувати під загальним написом «валідний код».

## Карта джерел

**Extension root:** `/home/rost/Документи/framer-to-revyme-extension/`.
- `manifest.json` — MAIN extractor та ISOLATED Revyme injector.
- `content.js:70–94` preload; `139–188` unwrap; `191–335` styles; `338–382` JSX; `386–460` roots/envelope; `575–661` clipboard hooks.
- `popup.js:66–110` insert/replace; `167–201` MAIN export → extension storage.
- `revyme-injector.js:181–218` три канали; `233–261` replace; `277–294` storage listener.

**Builder root:** `/home/rost/Документи/revyme/revyme-builder-fork/`.
- `src/canvas/framer-paste.ts` — receiver, reader, unsafe replace, low-level paste.
- `src/canvas/shortcuts.ts:543–565` Framer before Figma; `604–620` native envelope fallback.
- `src/code/import/framer/convert.ts` — другий, неповний converter; `convert.test.ts:57–71` абсолютна fixture і очікування 21 вузла.
- `src/code/features/paste-engine/core/node-creator.ts:211–245` child lookup by parentId.
- `src/code/features/paste-engine/execute-from-ui.ts` — existing component materialization/import flow.
- `src/code/oracle/check-file.ts` — Oracle validation; `src/code/project/modify-file.ts` — safe write.
- `src/code/generation/create-component-gen.ts`, `fit-text-gen.ts`, `src/code/project/template-ops.ts`, `cms-ops.ts` — existing native systems.

**Input files:**
- `/home/rost/Завантажене/Walker__copy_-revyme-clipboard (5).json`.
- `/home/rost/Завантажене/Walker__copy_ (4).tsx`.
- `/home/rost/Завантажене/Walker__copy_-full-site.json`.
- Screenshot after import `/tmp/codex-clipboard-a904dbc3-058f-475f-81d6-ba24623fe46a.png`.
- Screenshot original `/tmp/codex-clipboard-2e6dc3e9-fcee-454f-a8a7-f2efba20ee0e.png`.

**Official references:**
- https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
- https://developer.chrome.com/docs/extensions/reference/api/scripting#type-ExecutionWorld
