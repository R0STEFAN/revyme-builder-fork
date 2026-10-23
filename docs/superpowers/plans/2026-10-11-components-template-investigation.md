# Компоненти: ширина в шаблоні та переміщення між секціями — звіт і Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дозволити інстансам компонентів змінювати ширину в редакторі шаблону та коректно переносити елементи між кореневими секціями сторінки із застосованим шаблоном після запису й повторного парсингу JSX.

**Architecture:** Розміри залишаються властивостями інстанса у вихідному JSX; запис має працювати з коректною структурою об’єкта `style`. Структурні генератори повинні оперувати тими самими логічними дочірніми вузлами, які бачить парсер, зберігаючи службові обгортки та `{children}`. Синхронний запис розмірів дизайн-інстанса перевіряється перед передачею нового коду в ProjectFS.

**Tech Stack:** TypeScript, React, Babel AST, Jotai, Vitest, Playwright, iframe bridge, ProjectFS.

**Spec:** Цей документ, розділи 1–5: запит користувача, уточнена область проблеми, докази та очікувана поведінка.

**Дата:** 11 жовтня 2026 року. **Гілка:** `main`. **Досліджений commit:** `bcee025caee6f07fec3cf596147b1f796d77df5a`.

## Global Constraints

- «Canvas content renders in a sandboxed iframe.» Геометрію читати через bridge/cache; зміни документа проводити через генератори.
- «Never write ProjectFS directly.» Для відновлення або міграції використовувати `modifyProjectFile`.
- «Empty string means *delete this property*.» Не замінювати семантику видалення на порожній CSS override.
- «One node, many viewports.» Зберігати незалежність primary, responsive bands і component variants.
- «Anything the published site needs lives in `@revyme/runtime`.» Результат повинен працювати в опублікованому JSX.
- «Tests. Every module needs tests.» Запускати відповідні Vitest suites та `npx tsc --noEmit` під час реалізації.
- «Add traces; do not remove them.» Нові суттєві операції й відмови повинні мати `trace.action`/`trace.error`.
- Область цього запиту — дослідження та план у файлі. Виправлення застосунку й збережених проєктів не виконувались.

## Review Focus

1. Перший запис ширини, коли `style` порожній, відсутній або закінчується комою: коректний JSX і записане значення.
2. Flow/Glide на корені та `PageTransitions` навколо `{children}`: позиція з канваса зберігається після повторного парсингу.
3. Компонент `position: fixed`: запис `%` має бути коректним; такий компонент не є звичайним учасником flex-потоку.
4. Template primary/tablet/mobile та сторінка, що використовує template: правильне маршрутизування змін і незалежність breakpoint overrides.
5. AnimatePresence, CMS `.map()`, приховані вузли та `<style>`: структурний запис не дублює `data-id`, не губить умову видимості й не рахує CSS як візуальну секцію.

---

## 1. Що саме досліджувалось

**Проблема A, після останнього уточнення користувача.** Якщо до сторінки застосований шаблон, елементи не вдається розмістити між секціями в корені сторінки: вони падають униз. На сторінці без застосованого шаблону цього збою користувач не спостерігає. Усередині секцій переміщення працює. Йдеться про елементи загалом, а не тільки NavBar. Редагування самого `LayoutClient.tsx` — окрема поверхня; знайдений там дефект `{children}` описано як суміжний, а не як заміну цього сценарію.

**Проблема B, після уточнення користувача.** Зміна ширини інстанса компонента працює на звичайній сторінці. Збій виникає саме під час редагування шаблону сторінки, якщо компонент вставлений у шаблон. NavBar — приклад; необхідно виправити загальний шлях для компонентів, а не конкретний компонент.

Відсоткова ширина інстанса та обмеження одиниць кореня компонента в редакторі master — різні речі. Цей план не вимагає змінювати дозволені одиниці master-кореня. На інстансі `%` має працювати.

## 2. Основні висновки

| Проблема | Підтверджена причина | Доказ | Впевненість |
|---|---|---|---|
| Ширина в template | Додавання нової width/height у `style` завжди додає кому, навіть після кінцевої коми або в порожній об’єкт | Збережений `LayoutClient.tsx` із `top: '0px',, width: '86%'`; точне відтворення генератором | Висока |
| Зникнення шаблону після ширини | `flushNow()` не перевіряє звичайний `updateStyles`, тому пошкоджений JSX може потрапити у flush callback | Тест реального dispatcher: `updateStyles → flushNow → callback` отримує непарсований код | Висока для механізму; точний UI caller синхронного flush під час початкового жесту не записаний |
| Елемент падає вниз у корені сторінки зі шаблоном | Генератор move/add помиляється в логічній позиції за LayoutGroup/Glide; template merge прибирає inline `order`, який на bare page може маскувати неправильний JSX | Однаковий queue move → реальний `seedNodesForCode`: bare `[first, nav, second]`, templated `[first, second, nav]` | Висока для відтвореного Flow/Glide сценарію; повний pointer-жест ще не перевірено |
| Суміжна перестановка в редакторі template | `PageTransitions` без `data-id` класифікується як нерухомий anchor; `{children}` усередині не рахується як окремий логічний slot генератора | `reorderNodeInCode(..., 'root', 0)` залишає `PageTransitions` перед NavBar | Висока для відтвореної форми template |

Це два незалежні шляхи збою з окремими виправленнями. Ширина ламається через синтаксис writer; падіння вниз у відтвореному випадку — через неправильний структурний запис, який template merge робить видимим. Самі `100%` і назва NavBar не є причиною.

## 3. Ширина: докази та шлях збою

### 3.1. Збережений приклад

На початку перевірки локальний проєкт `portfolio-test22` у `data/projects/proj-1791306119633-xwco3m.json` містив у `data.files['app/(main)/LayoutClient.tsx']`:

```tsx
<Navbar data-id="Navbar-muy9pwrf-1" data-name="Navbar" style={{
  position: 'fixed',
  flex: '0 0 auto',
  order: '-1', left: '0px', top: '0px',, width: '86%'
}}></Navbar>
```

Дві сусідні коми є синтаксичною помилкою JavaScript. Babel не може розібрати весь файл, а не лише Navbar.

Для цього ж файлу проведено експеримент у пам’яті:

1. Прибрано тільки вставлене `, width: '86%'`, залишено кінцеву кому після `top`.
2. Перевірено, що відновлений текст парситься.
3. Викликано `setInstanceDimStyleWriteInCode(code, id, 'width', null, '86%')`.
4. На першому прогоні результат збігся з початковим пошкодженим файлом байт у байт.

Під час дослідження живий локальний JSON змінився: ширина була прибрана, додано `alignSelf: 'stretch'`, і текст став коректним. Тому наступні перевірки використовували зафіксовану копію та реконструйований до-записний фрагмент. Не слід вважати, що актуальний проєкт досі містить цю синтаксичну помилку. Агент лише читав збережені JSON; їх не редагував.

На звичайній сторінці того ж проєкту знайдено коректний запис:

```tsx
<Navbar data-id="Navbar-mv3pypwx-1" style={{
  position: 'relative', flex: '0 0 auto', order: '6', width: '100%'
}} />
```

Це узгоджується з уточненням користувача: звичайний інстанс на сторінці працює. Важлива різниця: перед першим додаванням ширини template-інстанс мав кінцеву кому, а page-інстанс — коректне місце вставки.

### 3.2. Дефект генератора

У [instance-auto-size.ts](/home/rost/Документи/revyme/revyme-builder-fork/src/code/features/instance-auto-size.ts:241) функція `writeInstanceStyleDim` додає відсутню властивість так:

```ts
const insertAt = tagSpan.start + span.end;
return code.slice(0, insertAt) + `, ${dim}: ${expr}` + code.slice(insertAt);
```

Перед вставкою не перевіряється, чи об’єкт має властивості й чи останній токен уже є комою.

| Вхідний `style` | Фактичний результат запису `width: '100%'` |
|---|---|
| `style={{}}` | `style={{, width: '100%'}}` — не парситься |
| `style={{ position: 'relative', }}` | `style={{ position: 'relative', , width: '100%'}}` — не парситься |
| Те саме багаторядково | Та сама синтаксична помилка |
| `style={{ position: 'relative' }}` | Парситься, ширина записана |
| Наявна width посеред об’єкта | Парситься, значення замінено |
| Атрибут `style` відсутній | Генератор повертає код без доданої width — окремий пропуск підтримки |

Це загальний writer дизайн-інстансів: мінімальний тест з `Card` відтворює ту саму помилку. `height`, перший запис у пікселях і reset/hug також потребують регресійних перевірок, бо використовують цей writer. Збережений користувацький збій підтверджено саме для `%` у template.

### 3.3. Чому помилка доходить до документа

Шлях запису:

```text
SizeTool → ControlProvider.updateStyle → updateNodeStyles
  → ReplicaContext routing → queueMutation(updateStyles)
  → setInstanceDimStyleWriteInCode → writeInstanceStyleDim
  → flush → ProjectFS → parser → Renderer
```

Template `LayoutClient.tsx` розглядається як template/master для змінних, але як сторінка для responsive style routing: `isComponentFilePath` перевіряє лише `components/`. Це різні свідомі правила; глобально замінювати цю перевірку на `isComponentLikeFilePath` не потрібно.

В [mutation-queue.ts](/home/rost/Документи/revyme/revyme-builder-fork/src/code/mutation/mutation-queue.ts:2474) `updateStyles` виділяє width/height дизайн-інстанса й передає їх hug-aware writer.

Асинхронний `processQueue()` перевіряє згенерований код. Проте [SYNC_SYNTAX_GATED_TYPES](/home/rost/Документи/revyme/revyme-builder-fork/src/code/mutation/mutation-queue.ts:889) не включає `updateStyles`; `flushNow()` для такого batch може передати непарсований текст далі. Окремий queue-тест підтвердив цей пропуск.

Можливий caller синхронного drain: `ensureMasterInstanceSizeOverride` планує `modifyProjectFile`, а той викликає `flushNow` перед записом master. Ця гілка працює лише якщо master ще не підготовлений. Наявних логів недостатньо, щоб стверджувати, що саме вона була caller початкового жесту.

### 3.4. Пояснення наданих логів

`getAllSlotConnections` у [slot-ops.ts](/home/rost/Документи/revyme/revyme-builder-fork/src/code/generation/slot-ops.ts:548) парсить весь активний документ. Його викликають SlotConnectors, SlotConnectionHandle і CodeComponentHost. Пошкодження одного `style` тому викликає повторні `Failed to parse JSX` у кількох місцях. Логи не доводять дефект механізму slots.

`canvas-sandbox:captureElement-failed` походить із [read-handlers.ts](/home/rost/Документи/revyme/revyme-builder-fork/src/canvas-sandbox/sandbox/read-handlers.ts:156): створення зображення через `html-to-image` завершилось помилкою. З цього повідомлення неможливо визначити проблемне зображення. Воно не є доказом причини зламаного JSX; виправлення thumbnail/capture не входить до цього плану.

## 4. Переміщення: чому шаблон змінює результат

### 4.1. Два режими кореня сторінки

На звичайній сторінці inline `order` кореневих елементів залишається в CanvasNode і визначає візуальний порядок flex-дітей. На сторінці зі шаблоном [store.ts](/home/rost/Документи/revyme/revyme-builder-fork/src/code/stores/store.ts:416) об'єднує секції сторінки з шаблоном: template root стає `root`, chrome отримує `layout::`, секції сторінки вставляються на місце `{children}`.

Після цього [store.ts](/home/rost/Документи/revyme/revyme-builder-fork/src/code/stores/store.ts:507) явно задає секціям `order: ''`. Це захист від змішування порядку секцій із template Header/Footer. На primary канвасі їхня послідовність тепер залежить від JSX/`root.children`. Порядок у вихідному page file лишається, тому preview/published flex-контекст може відрізнятися від об'єднаного канваса. Responsive band `order` — окремий шлях, який також потребує перевірки.

Отже, звичайна сторінка може виглядати правильно навіть після неправильного структурного запису: CSS `order` його маскує. Після застосування шаблону ця компенсація зникає.

### 4.2. Порівняльний експеримент на реальній queue і store

Мінімальна сторінка: `first` містить `nav`; на корені також `second`. Для кореня увімкнено Flow/Glide, як у збереженому користувацькому page.client.tsx. Операція — перенести `nav` із секції на root між `first` і `second`.

Використано реальні `queueMutation(move)`, `flushNow`, post-insert Glide normalization і `seedNodesForCode`; шаблон має Header, `{children}`, Footer. Застосовувався **однаковий результуючий JSX** у двох режимах. Тести писали тільки в процесову пам'ять ProjectFS; збережені користувацькі JSON не змінювались.

```ts
queueMutation({ type: 'move', nodeId: 'nav', newParentId: 'root',
  index: 1, insertBeforeId: 'second', styles: { position: 'relative', order: '1' } });
queueMutation({ type: 'updateStyles', nodeId: 'first', styles: { order: '0' } });
queueMutation({ type: 'updateStyles', nodeId: 'second', styles: { order: '2' } });
flushNow();
```

| Режим | Логічні діти після запису | `order` у моделі канваса | Порядок flex-моделі |
|---|---|---|---|
| Без шаблону | `first, second, nav` | `first=0, second=2, nav=1` | **first, nav, second** |
| Із шаблоном | `first, second, nav` | Усі три `''` | **first, second, nav** |

Це підтверджує описану різницю на рівні source → queue → реальний template merge. Таблиця відображає порядок моделі/CSS, а не браузерний вимір геометрії. Контрольний тест **без службових wrappers** дав правильні `first, nav, second` в обох режимах: застосування шаблону саме по собі не ламає кожну структурну вставку.

### 4.3. Де вибирається неправильна позиція

У дослідженій сторінці є:

```tsx
<motion.div data-id="root" data-glide='...'>
  <LayoutGroup>
    <motion.div data-glide-item><section data-id="first" /></motion.div>
    <motion.div data-glide-item><section data-id="second" /></motion.div>
    <motion.div data-glide-item><NavBar data-id="nav" /></motion.div>
  </LayoutGroup>
</motion.div>
```

Парсер у [parser.ts](/home/rost/Документи/revyme/revyme-builder-fork/src/code/parsing/parser.ts:1965) приховує LayoutGroup та `data-glide-item`: канвас бачить `root.children = [first, second, nav]`. Генератори натомість рахують прямі JSX-діти.

- `moveNodeInCode` у [generator-crud.ts](/home/rost/Документи/revyme/revyme-builder-fork/src/code/generation/generator-crud.ts:3298) шукає `insertBeforeId` тільки на прямому дочірньому JSXElement. `second` усередині LayoutGroup не знаходиться. Fallback index рахує LayoutGroup як один елемент, тому вставка в середину логічних секцій стає append.
- `addNodeAST` у [generator-crud.ts](/home/rost/Документи/revyme/revyme-builder-fork/src/code/generation/generator-crud.ts:3598) має схожу проблему: index ≥ 1 за єдиним LayoutGroup означає кінець.
- Post-step `reglideInsertedParents` перепаковує move/addNode у Flow, але вже з неправильною позицією.
- `reorderNodeInCode` класифікує LayoutGroup без `data-id` як anchor. Окрема операція `reorder(nav, root, 0) + clear order` залишає `first, second, nav` та порожню glide-обгортку.

Queue-тест addNode також підтвердив: очікувані `first, inserted, second, nav` перетворюються на `first, second, nav, inserted`.

### 4.4. Перенесення і повна перестановка — різні шляхи

[CanvasDragStrategy.ts](/home/rost/Документи/revyme/revyme-builder-fork/src/canvas/drag/strategies/CanvasDragStrategy.ts:3178) передає move із logical index/anchor, а потім може записати CSS order. Cross-parent гілка [LayoutLiftedStrategy.ts](/home/rost/Документи/revyme/revyme-builder-fork/src/canvas/drag/strategies/LayoutLiftedStrategy.ts:2455) передає move з індексом, без sibling anchor. Обидва шляхи мають узгодити позицію з логічними дітьми кореня.

Натомість same-parent primary reorder на сторінці із шаблоном має спеціальну гілку [LayoutLiftedStrategy.ts](/home/rost/Документи/revyme/revyme-builder-fork/src/canvas/drag/strategies/LayoutLiftedStrategy.ts:2130): вона переставляє **всі** page sections у JSX та прибирає їхні `order`. На bare page основний шлях записує CSS order.

Додатковий тест відтворив **повний** templated batch `nav, first, second`, а не лише одну reorder mutation. Результат: логічний порядок справді став правильним, але всі секції опинилися поза LayoutGroup; порожні `data-glide-item` лишилися всередині. Тому failure одного виклику reorder не можна видавати за доказ, що вся same-parent гілка завжди залишає NavBar унизу. Тут підтверджений окремий дефект збереження Flow wrappers. Для точного користувацького same-parent жесту потрібні browser trace/E2E, особливо якщо Flow вимкнений.

### 4.5. Суміжний дефект редактора шаблону

У самому LayoutClient знайдено `<PageTransitions>{children}</PageTransitions>` перед Navbar/Footer. Канвас представляє slot як `children-slot`, але `reorderNodeInCode` вважає PageTransitions без `data-id` нерухомим anchor. Мінімальна перестановка **relative** інстанса на index=0 залишає його після PageTransitions. Це суміжна помилка logical slot, а не пояснення самої page-with-template merge.

Збережений Navbar у шаблоні має `position: fixed`: він не є учасником flex-потоку. Регресії root flow перевіряються на relative елементах; width — окремо на relative та fixed.

### 4.6. Межі підтвердження

- Усередині звичайної секції діти часто є прямими JSXElement, тому logical/physical порядок збігається.
- Edge magnet і drop-line існують; доведена помилка commit position не вимагає починати із заміни geometry algorithm.
- Повний pointer-жест у живому браузері не відтворювався. Підтверджено template-specific прояв **для збереженої форми сторінки з Flow/Glide**, а не універсальну причину кожного reorder без Flow.
- GitNexus MCP недоступний у цьому сеансі; ланцюжки перевірено пошуком і читанням source.

## 5. Очікувана поведінка після виправлення

1. У template можна вибрати будь-який дизайн-інстанс та встановити `100%`, інший відсоток, px або Fit без пошкодження JSX.
2. `%` означає CSS-відсоток відповідного containing block; для flow-інстанса на корені template це ширина його батька. `100vw` — окрема одиниця; не підміняти `%` на vw або px.
3. Звичайна сторінка, master компонента і responsive variants продовжують працювати з чинними правилами.
4. На сторінці **із застосованим шаблоном** drop-line над/під/між кореневими секціями відповідає позиції після flush, повторного парсингу, reload та undo/redo. Ідентичний сценарій без шаблону залишається коректним.
5. Компонент до і після `{children}` у template залишається з відповідного боку після збереження та на сторінках, що використовують template.
6. Flow/Glide, PageTransitions, AnimatePresence і CMS зберігають свою runtime-поведінку.

## 6. Перевірки, виконані під час дослідження

Запущено:

```bash
npx vitest run \
  src/code/features/component-template-investigation.test.ts \
  src/code/features/instance-auto-size.test.ts \
  src/code/mutation/glide-insert.test.ts \
  src/code/generation/move-fast.test.ts \
  src/canvas/drag/reparent-utils.test.ts \
  --reporter=verbose
```

Підсумок першого завершеного блоку: **5 test files, 81 tests passed**. З них 76 — наявні перевірки, 5 — тимчасові діагностичні тести. Діагностичні тести навмисно підтверджували поточний помилковий результат; їхній PASS не означає, що дефекти виправлені. Матриці варіантів виконувались усередині цих тестів.

Один попередній прогін отримав failure через зміну живого JSON між читаннями. Після фіксації snapshot перевірку повторено успішно. Це не видається за failure продуктового тесту.

Після останнього уточнення користувача додано ще 3 тимчасові діагностики у `src/code/stores/template-root-investigation.test.ts`: однаковий move із/без template через реальний store, повний templated reorder batch і контрольний move без wrappers. Останній прогін:

```bash
npx vitest run src/code/stores/template-root-investigation.test.ts \
  src/code/stores/template-apply-merge.test.ts \
  src/code/features/instance-auto-size.test.ts \
  src/code/mutation/glide-insert.test.ts \
  src/code/generation/move-fast.test.ts \
  src/canvas/drag/reparent-utils.test.ts --reporter=dot
```

**6 test files, 84 tests passed**: 81 наявна перевірка та 3 нові діагностики. Первинна гіпотеза matrix спочатку не підтвердилася через помилки тестової fixture (неправильні назви mutation fields і сигнатура template, що заважала slot detection). Після виправлення fixture перевірено, що merge реально відбувся: template chrome є `layout::`, а секції мають `order: ''`. Це помилка експерименту, а не продуктове виправлення.

Обидва тимчасові TS-тести після дослідження прибрано. Постійна зміна — цей звіт; каталог `docs/` ігнорується Git, тому файл не входить у tracked diff. Повна Vitest suite, tsc, build і браузерні E2E під час дослідження не запускались.

---

## 7. Детальний план реалізації

Порядок: спочатку захист від пошкодження документа й запис розмірів, потім логічні child slots та структурні генератори. Два блоки можна приймати окремо. Реалізацію почати в окремій `codex/` гілці або керованому worktree; дослідження на `main` не є дозволом комітити виправлення в `main`.

### Task 1. Коректний writer розмірів дизайн-інстансів

**Files:** Modify `src/code/features/instance-auto-size.ts`; Test `src/code/features/instance-auto-size.test.ts`.

**Interfaces:** Чинна сигнатура `setInstanceDimStyleWriteInCode(code, nodeId, dim, variant, value): string` зберігається. Width/height залишаються у style channel; legacy prop migration, `HUG='auto'` і `data-size-hug` зберігають значення.

- [ ] Додати regression test, який очікує коректний вихід, для порожнього й відсутнього style, кінцевої коми та multiline formatting. Мінімальний тест:

```ts
test.each([
  'style={{}}',
  "style={{ position: 'relative', }}",
  "style={{\n position: 'relative',\n}}",
  '',
])('first width write parses: %s', attrs => {
  const input = `export default function LayoutClient({children}) {
    return <div data-id="root"><Card data-id="card" ${attrs}/>{children}</div>;
  }`;
  const out = setInstanceDimStyleWriteInCode(input, 'card', 'width', null, '100%');
  expect(() => parse(out, {sourceType:'module', plugins:['jsx','typescript']})).not.toThrow();
  expect(parseJSXToNodes(out).get('card')?.styles.width).toBe('100%');
});
```

Імпортувати `parseJSXToNodes` із `../parsing/parser`; `parse` уже імпортований у наявній suite.

- [ ] Запустити `npx vitest run src/code/features/instance-auto-size.test.ts`; нові тести повинні впасти на поточній реалізації.
- [ ] Переписати низькорівневу вставку `writeInstanceStyleDim` через Babel ObjectExpression: знайти тільки тег із потрібним data-id через `findFirstElementByDataId`; створити style attribute за його відсутності; замінити/додати/видалити потрібний ObjectProperty. Значення expr розібрати як вираз, а не вставляти сирі коми. Для style expression, який не є ObjectExpression, повернути unchanged і trace з причиною; не руйнувати binding/spread expression.

```ts
// Внутрішній контракт writer залишається таким:
function writeInstanceStyleDim(
  code: string, nodeId: string, dim: 'width' | 'height', expr: string | null,
): string;
// expr === null → видалення ObjectProperty;
// expr !== null → parseExpression(expr, {plugins:['typescript']}) як value.
// generate(ast) серіалізує роздільники й екранування.
```

- [ ] Після AST round-trip перевірити reader: `parseDimBranchesFull` повинен читати звичайні string literals у форматі, який видає генератор, зокрема подвійні лапки. Розбирати відомі Literal/ConditionalExpression форми через AST, зберігаючи discriminator `variant`/`initialVariant`; bindings і motion values залишити unowned. Не змінювати сутність branch semantics.
- [ ] Додати цикли `width 100% → 50% → 320px → reset`, width+height у одному batch, Fit із pinned sibling variants, legacy prop migration та CSS selector із тим самим data-id до JSX. Повторно виконати наявні hug/migration тести.
- [ ] Перевірити no-op/idempotency: запис того самого значення вдруге не змінює семантику; reset не залишає порожньої/подвійної коми. Додати trace для фактичного запису й відмови на unowned style.

**Acceptance:** Усі нові форми парсяться; instance має запитаний розмір; наявні hug/variant/legacy тести проходять.

### Task 2. Захист синхронного commit розмірів

**Files:** Modify `src/code/mutation/mutation-queue.ts`; Create `src/code/mutation/instance-dim-sync-validation.test.ts`.

**Interfaces:** `flushNow(): void` та `initMutationQueue` не змінюють API. Чинний `validateGeneratedCode(code): string | null` використовується для batch до callback.

- [ ] Додати тест sync width commit на template: spy `getNodesSnapshot` повертає дизайн-інстанс Card; callback має отримати тільки коректний JSX. Використати `style={{position:'relative',}}` і `width:'100%'`.

```ts
const spy = vi.spyOn(stores, 'getNodesSnapshot').mockReturnValue(
  new Map([['card', {id:'card', componentFile:'components/Card.tsx'} as any]]),
);
try {
  initMutationQueue(input, onFlush);
  queueMutation({type:'updateStyles', nodeId:'card', styles:{width:'100%'}});
  flushNow();
  expect(onFlush).toHaveBeenCalled();
  expect(validateGeneratedCode(onFlush.mock.calls[0][0])).toBeNull();
} finally { spy.mockRestore(); }
```

У тестовому input локально оголосити `Card`, щоб semantic validator не плутав undefined tag з помилкою writer.

- [ ] Окремо тестом ін’єктувати пошкоджений результат writer через Vitest mock і перевірити: `onFlush` не викликається, `getCurrentCode()` дорівнює last-good input, `onError` містить тип mutation і помилку. Цей тест повинен залишатися корисним після Task 1.
- [ ] Обчислити `needsSyntaxGate` **до** застосування batch, поки snapshot ще коректний. До чинної умови додати `updateStyles` з width/height дизайн-інстанса. Не включати всі зміни кольору/позиції під час drag у повний AST validation.

```ts
const needsSyntaxGate = mutations.some(m =>
  SYNC_SYNTAX_GATED_TYPES.has(m.type) ||
  (m.type === 'updateStyles' &&
   (m.styles.width !== undefined || m.styles.height !== undefined) &&
   isDesignInstanceNode(m.nodeId)),
);
```

- [ ] Перевірити UI rollback: після відмови cache і імперативні стилі bridge повинні відновитися з last-good code через наявний render/error lifecycle. Зафіксувати інтеграційним тестом відсутність порожнього канваса й завислого preview.
- [ ] Порівняти async/sync behavior для нового пошкодження і preexisting-invalid документа. Зберегти чинне правило блокування лише нової помилки, але не видавати збережений invalid документ за успішний commit.

**Run:** `npx vitest run src/code/mutation/instance-dim-sync-validation.test.ts src/code/mutation/validate-generated-code.test.ts src/code/mutation/mutation-queue.test.ts`.

**Acceptance:** Новий синтаксично некоректний результат dimension write не доходить до ProjectFS через sync drain.

### Task 3. Єдина модель логічних child slots для генераторів

**Files:** Create `src/code/generation/jsx-child-slots.ts` and `.test.ts`; читати parser wrapper rules і чинні `variantVisibilitySlotPath`, `mapContainerSlotPath`, `slotHoldsNodeId` у generator-crud.

**Interfaces:** Нова pure AST abstraction без ProjectFS, Jotai та DOM:

```ts
import type * as t from '@babel/types';
export type LogicalChildSlot = {
  id: string; // data-id; 'children-slot' для template content
  owner: t.JSXElement | t.JSXFragment;
  node: t.JSXElement | t.JSXExpressionContainer;
};
export function collectLogicalChildSlots(parent: t.JSXElement): LogicalChildSlot[];
export function insertLogicalChild(
  parent: t.JSXElement,
  node: t.JSXElement | t.JSXExpressionContainer,
  index: number,
  insertBeforeId?: string,
): boolean;
```

`owner` — фактичний AST контейнер, `node` — одиниця переміщення. Для Glide це весь `motion.div data-glide-item`, а не тільки внутрішній Card. Для `<PageTransitions>{children}</PageTransitions>` це вся PageTransitions-обгортка з id `children-slot`: template chrome вставляється перед/після неї, а не всередину transition content.

- [ ] Додати тести логічного порядку для plain children, LayoutGroup, Glide wrappers, `{children}`, PageTransitions-wrapped `{children}`, AnimatePresence і CMS `.map()`. `<style>`, `<script>` та JSX comments не займають позиції вставки.
- [ ] Реалізувати traversal від direct children: для прозорої групи LayoutGroup/Fragment/MotionConfig спускатися в дітей, зберігаючи їхній реальний owner; для marker Glide повертати його як slot внутрішнього вузла; для PageTransitions навколо `{children}` повертати цілу обгортку як content slot. Не розгортати довільний React component без data-id.
- [ ] Використати чинні visibility/map правила, щоб `.map()` та conditional render переміщувались як один slot і не дублювалися. Винести потрібні helpers у цей leaf-модуль; уникати імпорту generator-crud назад у helper.
- [ ] Реалізувати вставку: спочатку anchor id, далі логічний index, потім append у фактичний owner відповідної групи. Межі index обмежити `[0, slots.length]`. Якщо структура неоднозначна й не підтримується, повернути `false`, trace і не видаляти вихідний вузол.
- [ ] Додати тести node uniqueness, scope з двома різними батьками й вкладених wrappers. Звірити отримані id із `parseJSXToNodes(code).get(parentId).children`, доповнюючи template placeholder за чинними store rules.

**Run:** `npx vitest run src/code/generation/jsx-child-slots.test.ts`.

**Acceptance:** Генератор і CanvasNode tree мають спільне поняття позиції, без втрати runtime wrappers.

### Task 4. Перестановка і move через логічні slots

**Files:** Modify `src/code/generation/generator-crud.ts`, `src/code/generation/move-fast.ts`, за потреби `src/code/generation/glide-gen.ts` та cross-parent commit у `src/canvas/drag/strategies/LayoutLiftedStrategy.ts`; Create `src/code/generation/reorder-glide-template.test.ts`; extend `move-fast.test.ts` and `src/code/mutation/glide-insert.test.ts`.

**Interfaces:** Чинні move/reorder signatures зберігаються. Task 3 надає `collectLogicalChildSlots` та `insertLogicalChild`. Fast-path повертає `null` для wrapper cases й передає їх AST path.

- [ ] Зафіксувати поточний дефект як **очікування правильного порядку**. У fixture з Task 4 використати локальний Card/NavBar і дві секції з Glide:

```ts
let out = '';
initMutationQueue(glided, code => {out = code;});
queueMutation({type:'reorder', nodeId:'nav', parentId:'root', index:0});
queueMutation({type:'updateStyles', nodeId:'nav', styles:{order:''}});
flushNow();
expect(parseJSXToNodes(out).get('root')?.children).toEqual(['nav','first','second']);
```

- [ ] Відтворити **повний** templated same-parent batch із `LayoutLiftedStrategy`, а не лише окремий reorder. Перевірити і порядок секцій, і що кожна секція лишилась у чинному Flow wrapper; порожніх оболонок немає. Поточний batch дає правильні id, але руйнує wrappers.
- [ ] Додати PageTransitions regression: після перестановки NavBar на index=0 він стоїть у JSX перед PageTransitions; `{children}` залишається всередині PageTransitions рівно один раз.
- [ ] Замінити direct-children content/anchor logic `reorderNodeInCode` на slots. При move/reorder знайти source slot у логічного батька й переносити Glide/visibility wrapper як ціле. Переконатися в наявності target до вилучення source.
- [ ] Cross-parent шлях `LayoutLiftedStrategy` також передає sibling anchor через чинний `computeLayoutInsertAnchorId`; index лишається fallback. Перевірити multiselect і зсув `crossOffset`.
- [ ] Anchor `insertBeforeId` шукати в logical slots, включаючи sibling усередині LayoutGroup. При відсутньому anchor застосувати узгоджений index; не сплайсити довільний direct child.
- [ ] Fast move дозволяти лише коли логічний і фізичний slot збігаються. На indirect wrappers повертати `null`; не додавати ще один string scanner.
- [ ] За потреби включити reorder у Flow synchronization, знявши stale wrapper placement/order після зміни: spec читати чинним `getGlide`, повторно застосовувати `setGlideInCode` до зачеплених source/target батьків один раз на batch. Це супровід правильного slot move, а не заміна виправлення індексу.
- [ ] Тестувати index 0, середину, кінець, move між секцією й root, fixed sibling, hidden sibling, CMS, conditional wrappers. В output не повинно бути empty data-glide-item husks або дублікатів data-id.

**Run:**

```bash
npx vitest run src/code/generation/reorder-glide-template.test.ts \
  src/code/generation/move-fast.test.ts \
  src/code/generation/reorder-variant-wrapped.test.ts \
  src/code/generation/glide-gen.test.ts src/code/mutation/glide-insert.test.ts
```

**Acceptance:** Переміщення NavBar першим і між секціями зберігається у source → parse round-trip, Flow продовжує працювати.

### Task 5. Додавання нового інстанса й узгоджений drop anchor

**Files:** Modify `src/code/generation/generator-crud.ts`, `src/code/mutation/mutation-queue.ts`, `src/shared/types.ts` лише якщо потрібне уточнення типу, `src/canvas/drag/strategies/ToolbarDragStrategy.ts`, `src/canvas/drag/CanvasDragOrchestrator.ts`; extend ToolbarDragStrategy tests; Create `src/code/generation/add-logical-child.test.ts`.

**Interfaces:** Розширити `addNodeInCode(..., index?, insertBeforeId?)`; додати `insertBeforeId?: string` у `Mutation` addNode. PendingUpdate уже має поле anchor для move; використати його й для add. Task 3 виконує кінцеву вставку.

- [ ] Додати тест queue add у Glide root із index=1: логічний результат `['first','inserted','second','nav']`. Поточний результат — inserted останній.
- [ ] Додати plain template fixture `<Header />{children}<Footer />`: index=1 вставляє інстанс перед `{children}`, index=2 — після. Повторити з PageTransitions wrapper і leading `<style>`.
- [ ] Перевести `addNodeAST` із `elementIndices` на `insertLogicalChild`. Append fast-path використовувати лише якщо він еквівалентний append у логічному target owner; Glide та wrapped-slot cases віддати AST path.
- [ ] У toolbar drop обчислити anchor тим самим `computeLayoutInsertAnchorId`, який уже використовує move. Передати його через PendingUpdate → orchestrator → addNode mutation → generator.

```ts
// Новий аргумент addNode dispatcher:
return addNodeInCode(code, mutation.parentId, mutation.node,
  mutation.index, mutation.insertBeforeId);
```

- [ ] Перевірити однакову основу drop-line/index/anchor: hidden/zero-area/out-of-flow children не змінюють обраного сусіда; chrome `layout::` у page view лишається захищеним. На template content slot має бути доступним, навіть коли нема звичайних секцій.
- [ ] Додати trace із parentId, requested index, anchorId і resolved logical sibling. Логувати commit, а не кожен pointer frame.

**Run:** `npx vitest run src/code/generation/add-logical-child.test.ts src/canvas/drag/strategies/ToolbarDragStrategy.test.ts src/canvas/drag/reparent-utils.test.ts`.

**Acceptance:** Новий компонент вставляється в показаний проміжок з першої спроби, а не тільки після додаткової перестановки.

### Task 6. Інтеграція template і browser acceptance

**Files:** Create `src/code/stores/template-instance-size.test.ts`, `src/code/stores/template-page-root-order.test.ts`, `src/canvas/drag/e2e/component-template-order-size.spec.ts`; extend `src/code/stores/template-apply-merge.test.ts` лише для нових merge expectations. Використати чинні E2E seed/bridge helpers із сусідніх specs.

**Interfaces:** Реальні ProjectFS → nodesAtom → iframe renderer; жодної підміни canvas DOM у parent frame. E2E fixtures створюють ізольований тестовий проєкт.

- [ ] Першою регресією зафіксувати matrix з розділу 4.2 через реальний `seedNodesForCode`/nodesAtom: однаковий move із секції на root мусить дати `first, nav, second` із template і без нього. Не прибирати чинне stripping `order` тільки задля зеленого тесту: воно захищає позицію Header/Footer.
- [ ] Інтеграційний size-тест: template із Card та NavBar, master default width=600px; встановити template instance width=100%, перевірити source syntax, wrapper model width та незмінну master width. Повторити 50%, px, Fit і style absence/trailing comma.
- [ ] Перевірити template primary/tablet/mobile: base 100%, tablet 80%, mobile 100%; page view, що використовує template, отримує відповідні значення після merge. Джерело template лишається власником chrome, page-local update не пише в `layout::` node.
- [ ] E2E найточнішого користувацького сценарію: однаковий page source зі шаблоном і без, Flow on/off, звичайний елемент і два дизайн-компоненти; перенос із секції на root та окрема same-parent перестановка. Перевірити primary/tablet/mobile, захищені Header/Footer і trace гілки commit. Якщо case із template та Flow off усе ще падає вниз, спочатку локалізувати його parent/index/anchor/viewport-routing, не приписувати його підтвердженому Glide дефекту.
- [ ] E2E: drag нового інстанса над першою секцією, між двома секціями і після останньої; потім reorder наявного. Повторити з Flow off/on і в template перед/після children-slot. Перевіряти DOM порядок/геометрію в iframe, збережений source та порядок після reload.
- [ ] E2E: зміна одиниці width на `%` у template та введення `100`; перевірити відсутність parse errors, наявність усіх секцій і ширину відносно containing block. Окремо relative і fixed інстанси, два різні компоненти, control case на звичайній сторінці.
- [ ] Перевірити один undo/redo крок для кожного commit; після undo зберігаються попередні ширина й порядок, після redo повертається нове значення. Preview повинен відповідати збереженому JSX.

**Run:**

```bash
npx vitest run src/code/stores/template-instance-size.test.ts \
  src/code/stores/template-page-root-order.test.ts \
  src/code/stores/template-apply-merge.test.ts src/canvas/template-responsive-repro.test.ts
npx playwright test src/canvas/drag/e2e/component-template-order-size.spec.ts --project=chromium
```

**Acceptance:** Візуальний результат, JSX, parser model, reload і undo/redo узгоджені на обох поверхнях.

### Task 7. Відновлення пошкоджених документів і фінальна перевірка

**Files:** Код міграції не потрібен за замовчуванням. Якщо потрібне відновлення конкретного проєкту — операція через `src/code/project/modify-file.ts`; report/release note із переліком виправлених сценаріїв.

**Interfaces:** `modifyProjectFile(path, transform)` із стандартним parse gate; не використовувати `skipParseGate` у генераторі або міграції.

- [ ] Перед відновленням перечитати **актуальний** LayoutClient та створити recoverable snapshot через чинний project version механізм. Початковий файл уже змінювався під час дослідження; не підміняти його старою копією.
- [ ] Якщо конкретний instance style досі містить подвійну кому, виправити тільки підтверджений фрагмент. Глобальна заміна `,,` неприйнятна: це може бути рядок або допустимий пропуск елемента масиву.
- [ ] Якщо документа вже не пошкоджено, recovery step пропустити. Реалізація writer не ремонтує довільний непарсований input автоматично.
- [ ] Перевірити oracle на JSX, який реально генерується після width/order edits. Тут не вводиться новий dialect або runtime feature, тому нове правило oracle чи новий export runtime не є обов’язковими. Нове правило додавати лише якщо реалізація вводить нову форму документа.
- [ ] Після focused suites запустити:

```bash
npx vitest run
npx tsc --noEmit
npm run build:all
```

- [ ] Зафіксувати фактичні результати, known unrelated failures, browser acceptance і перевірку source diff. Не оголошувати повну готовність на підставі діагностичних tests, що очікують старі дефекти.

**Acceptance:** Обидва користувацькі сценарії проходять, зміни обмежені підтвердженими шляхами, актуальні дані проєкту не втрачені.

## 8. Межі плану та ризики реалізації

- AST width writer може змінити форматування цілого файлу. Перевірити час одного commit на великій сторінці; оптимізувати локально тільки після коректної реалізації, з fallback на AST для складного style.
- Найбільший ризик структурного виправлення — винести вузол із visibility/transition wrapper і змінити runtime semantics. Тому source slot переміщується як одиниця, а Frame/CanvasNode identity не змінюється.
- Ширина у `%` може вплинути на flex wrapping і containing block, але це окрема CSS-поведінка. Підтверджений «все зникло» у збереженому template пояснюється непарсованим JSX.
- Code components та icon-set instances мають окремі writers/size hosts. Мінімальні докази стосуються загального шляху **дизайн-компонентів**; E2E control cases для інших типів потрібні, щоб зміна не зламала їхню ширину.
- Якщо на сторінці без Flow/Glide після виправлення лишається падіння вниз, перевірити `canvas-drag:entry-scan-empty`, `entry-best-candidate`, drop parent/index/anchor та responsive order bands. Наявні докази не дозволяють приписати всі можливі drag-сценарії одному wrapper дефекту.

## 9. Самоперевірка плану

- [x] Враховані обидва уточнення: width bug у template; root drag bug на сторінці із застосованим template, bare page — контрольний випадок.
- [x] Порівняно реальний store merge із/без template; окрема reorder mutation не видається за повний same-parent commit.
- [x] Обидві проблеми мають відтворення через чинні генератори; для drag додатково перевірена queue.
- [x] Для ширини наведено первинний дефект writer і окремий пропуск sync validation.
- [x] Підтверджені факти відділені від невідомого caller початкового жесту та ще не виконаних E2E.
- [x] Для кожної теми Review Focus є відповідні test steps у Tasks 1–6.
- [x] Наведено файли, interfaces, регресійні очікування, порядок реалізації й команди перевірок.
- [x] Виправлення користувацьких даних не підміняє виправлення генератора; поточний стан live JSON враховується окремо.
