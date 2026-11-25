# MCP Errors Journal — Revyme Builder

Журнал помилок/gotchas MCP `revyme-builder`, що виникали під час збірки сайту.
Кожен запис: що сталося → причина → фікс → коміт.

## 2026-11-23 — Сесія: збірка сайту для `proj-1795460366845-85f949`

### [MCP-001] `projectId` з `.revymelocal/automation.json` ігнорується після старту MCP-сервера
- **Що сталося:** після зміни `.revymelocal/automation.json` на `proj-1795460366845-85f949`
  `observe.screenshot` без аргументів все ще захоплював скріншоти зі старого проєкту
  `proj-1794658551528-jjgs43` (див. `filePath` у відповіді), тоді як `pages.list` повертав дані нового проєкту.
- **Причина:** `packages/cli/src/mcp.ts` резолвить config один раз на старті сервера
  (`config?.projectId` fallback), а `loadConfig()` з файлу не перечитується на кожен call для цього шляху.
- **Фікс/обхід:** завжди передавати `projectId` явним аргументом у кожному tool call
  (`{ projectId: 'proj-1795460366845-85f949', ... }`) — `rawArgs.projectId` має найвищий пріоритет
  (mcp.ts:507-509). Перевірено: `observe.screenshot({ projectId: PID })` → файл
  `proj-1795460366845-85f949-desktop-root.png`, `pages.list` → `revision: 3` (новий проєкт).
- **Статус:** обхід задокументовано, баг не фіксився (це очікувана поведінка per-call override).
- **Коміт:** — (без змін коду)

### [MCP-002] `workflow.batch` ігнорував per-step `projectId` і мовчки писав у чужий проєкт ⚠️ (виправлено)
- **Що сталося:** `workflow.batch({ operations: [{ tool, input: { projectId: 'proj-1795460366845-85f949', ... } }] })`
  застосував увесь batch до **іншого** проєкту `proj-1794658551528-jjgs43` (ответ: `projectId: "proj-1794658551528-jjgs43"`,
  `revision: 3489`, `changedFiles: ["app/smooth-scroll.ts", "app/page.client.tsx"]`).
- **Причина:** `workflowBatchOperation.execute` (`packages/automation-core/src/plan.ts`) крутить кроки через
  `prepareOperation(currentSnapshot, step.tool, step.input, context)`, але scope фіксований на старті batch —
  `step.input.projectId` ніде не враховувався і мовчки ігнорувався.
- **Фікс:** у `plan.ts` додано guard: якщо `step.input.projectId` заданий і != `snapshot.scope.projectId` —
  batch падає з `BATCH_PROJECT_MISMATCH` (projectId треба передавати на верхньому рівні `workflow.batch`);
  per-step `projectId` видаляється зі step input перед виконанням.
- **Відкат шкоди:** чужий проєкт `proj-1794658551528-jjgs43` відновлено через `history.undo({ projectId })` → `revision: 3490`, `undone: true`.
- **Урок:** у batch завжди передавати `projectId` верхнім аргументом, а не всередині `operations[i].input`.
- **Коміт:** `00b763fe fix(automation-core): reject cross-project steps in workflow.batch`

### [MCP-003] `textEffects.remove` лишає висячий `import { RevymeSplitText } from '@revyme/runtime'`
- **Що сталося:** після `textEffects.set` + `textEffects.remove` на h1, у `app/page.client.tsx`
  залишився імпорт `RevymeSplitText` без жодного використання (`splitUsage: 0`).
  `fragments.replace` і повторний set/remove імпорт не прибирають. Немає операції prune unused imports
  для canvas-сторінок (`codeFiles.submit` для `page.client.tsx` forbidden).
- **Вплив:** cosmetic — імпорт валідний, `diagnostics.projectCheck` clean, рендер не падає.
- **Статус:** не фікситься (немає дозволеного write-шляху для page.client.tsx поза fragments/styles);
  записано як відомий drift.
- **Коміт:** — (journal only)

### [MCP-004] `observe.screenshot` перший кадр після змін може бути порожнім (флейк capture)
- **Що сталося:** одразу після мутацій `observe.screenshot` іноді повертає білий кадр (`waitedMs: 1` —
  знімок до завершення рендеру). Повторний запит дає коректний кадр. `observe.layout` при цьому показує
  всі 86 нод visible — тобто сторінка жива, це глюк capture, не рендера.
- **Обхід:** завжди робити «прогрівальний» screenshot перед контрольним.
- **Коміт:** — (journal only)

### [MCP-005] Auto-Healer при `fragments.replace` h1/h2 з `<br/>` знову розмазує typography-пресет на дочірні span
- **Що сталося:** після `fragments.replace(h1, '<h1>Structure<br/>…</h1>')` дочірні span отримали
  `var(--typo-label-*)` (label-пресет замість наслідування від h1) — текст став дрібним.
- **Обхід:** batch `styles.set` з `''` на ці span (`span-11, span-13, span-3, span-5, span-10, span-12`)
  → span лишається з одним `position: 'relative'`, стилі наслідуються від h1/h2. rev 120, projectCheck clean.
- **Коміт:** — (дані проєкту, не код)

## 2026-11-25 — Сесія: нова сторінка `/process` у проєкті `proj-1794658551528-jjgs43`

### [MCP-006] `fragments.insert` перезаписував явні стилі (зокрема `color: 'var(--color-accent)'`) при матчингу typography-пресета ⚠️ (виправлено)
- **Що сталося:** при вставці фрагмента через `fragments.insert` у `<span style={{ fontFamily: 'var(--typo-h2-fluid-font)', color: 'var(--color-accent)' }}>РЕЗУЛЬТАТУ</span>`, колір тексту перезаписався на `var(--typo-h2-fluid-color)` (`#09090b`), і слово стало чорним замість акцентного `#ff3300`.
- **Причина:** у `packages/automation-core/src/operations/fragments.ts` (`ingestedToNodeDef`) після резолву пресета через `resolvePresetForNode` усі typography-властивості (`fontFamily`, `fontSize`, `fontWeight`, `color`, `lineHeight`, `letterSpacing`, `textTransform`, `textDecoration`, `textShadow`) безумовно присвоювались значеннями з `--typo-<name>-*`, затираючи будь-які явні override-стилі, передані у фрагменті.
- **Фікс:** у `fragments.ts` додано перевірки `if (!styles.<prop>)` перед записом дефолтних `--typo-<name>-*` токенів, щоб заповнювати лише незадані властивості та зберігати явні override-и (як-от `color: 'var(--color-accent)'`). Додано регресійний тест у `packages/automation-core/test/capabilities/fragments-insert.test.ts`, перезібрано `packages/cli/dist/main.js`.
- **Коміт:** `daffc7a3`

### [MCP-007] `components.variables.rename` і `components.variables.create` не оновлювали TypeScript-сигнатуру пропсів ⚠️ (виправлено)
- **Що сталося:** після `components.extract` + `components.variables.rename` (`p23` → `year`) та `components.variables.create` (`image`, `yearColor`) у `components/ProjectRow.tsx` деструктуризовані параметри оновилися, а inline TS-анотація типу параметра (`: { p23?: string; ... }`) залишилася зі старими іменами та без нових пропсів.
- **Причина:** у `src/code/features/variable-ops.ts` `renameComponentVariableInCode` та `addPropToParams` змінювали лише `ObjectPattern`, не торкаючись `firstParam.typeAnnotation` (`TSTypeLiteral`).
- **Фікс:** `renameComponentVariableInCode` тепер синхронно перейменовує `TSPropertySignature` у `typeAnnotation`, а `addPropToParams` додає опціональну сигнатуру `propName?: string|number|boolean` (перед index signature `[key: string]: any`, якщо є). Додано юніт-тест у `src/code/features/variable-ops.test.ts`.
- **Коміт:** `057fdf1b`

### [MCP-008] `variants.visibility.set` не додавав `layout={true}` на root-контейнер компонента при умовному рендері in-flow дитини ⚠️ (виправлено)
- **Що сталося:** після `variants.visibility.set` на in-flow дитині (`div-29`) `diagnostics.projectCheck` видавав drift-порушення `VARIANT_REVEAL_ROOT_SHELL` на кореневому `motion.div` (`div-19`), оскільки він не мав `layout={true}` для плавного FLIP-переходу висоти.
- **Причина:** `setVariantVisibilityInCode` (`src/code/generation/variant-visibility-gen.ts`) додавав `layout={true}` лише самому `target`-елементу (`ensureVisibilityMotionScaffold`), але не кореневому елементу компонента (який містить `...style` spread).
- **Фікс:** у `setVariantVisibilityInCode` для in-flow елементів (не `data-overlay`, не `absolute`/`fixed`) додатково викликається `ensureVisibilityMotionScaffold` на кореневому елементі компонента. Додано тест у `src/code/generation/variant-visibility-gen.test.ts`.
- **Коміт:** `057fdf1b`

### [MCP-009] FLIP `layout={true}` при розширенні висоти/ширини в дизайн-компонентах стискав/викривляв заголовки та зображення всередині картки ⚠️ (виправлено)
- **Що сталося:** при hover-розгортанні елементів у дизайн-компоненті (`ProjectRow`, зміна висоти `div-36` з `0px` на `380px`) кореневий `motion.div` з `layout={true}` застосовував FLIP-трансформацію `scaleY(0.23 → 1.0)`. Усі звичайні дочірні елементи (`div-20`, `div-21`, рік, заголовок, перший тег, кнопка-стрілка, прев'ю-зображення `img-37`) сплющувалися по вертикалі під час руху, тоді як лише `div-29` (`FRONTEND`), що вже мав `layout={true}` від `AnimatePresence`, залишався 1:1 і «від'їжджав» у повітрі.
- **Причина:** Framer Motion FLIP автоматично інвертує `scaleX/scaleY` лише для тих дочірніх елементів, які самі є `<motion.*>` із `layout`/`layout="position"` у спільному `<LayoutGroup>`. Генератори `setConditionalStyleInCode` (`src/code/generation/generator-styles.ts`) та `setVariantVisibilityInCode` (`src/code/generation/variant-visibility-gen.ts`) додавали `layout={true}` лише на змінений елемент і root, залишаючи структурні обгортки, хедери та медіа без `<LayoutGroup>` і `layout="position"`.
- **Фікс:** додано модуль `src/code/generation/flip-layout-protection.ts` (`ensureFlipLayoutCounterScale`), який викликається з `setConditionalStyleInCode` та `setVariantVisibilityInCode`: обгортає дизайн-компонент у `<LayoutGroup>` (якщо відсутній) і автоматично промоутить структурні та контентні елементи всередині scaling FLIP-контейнерів (і вздовж spine-обгорток перед умовним ресайзом) у `<motion.* layout="position">`, залишаючи ресайз-контейнери з `layout={true}`. Додано тести у `src/code/generation/flip-layout-protection.test.ts` (`158/158` vitest, `tsc --noEmit` чистий), перезібрано `packages/cli/dist/main.js`.
- **Коміт:** `206e020e`

### [MCP-010] Кодогенератор зв'язків відкидав root-переходи з `sourceNode: <rootId>`, якщо поруч були зв'язки без `sourceNode` ⚠️ (виправлено)
- **Що сталося:** після редагування `delay`/взаємодій на елементі `div-19` у `ProjectRow` зв'язки `default ⇄ default-hover` записалися з `sourceNode: 'div-19'`, тоді як `single-tag ⇄ single-tag-hover` лишилися без `sourceNode`. На сторінці `ProjectRow` почали спрацьовувати при наведенні «через один»: рядки `1` і `3` (`initialVariant="default"`) перестали розкриватися, а рядки `2` і `4` (`initialVariant="single-tag"`) продовжували працювати.
- **Причина:** у `src/code/variants/connection-config.ts` групування `(sourceNode, trigger)` (`const key = `${c.sourceNode ?? ROOT_KEY}|${c.trigger}``) розносило `unset` і `sourceNode === rootId` в два окремі бакети для того самого DOM-тегу кореня (`div-19`). Перший бакет записував `onHoverStart` / `onHoverEnd` (лише для `single-tag`), а другий бакет на тому самому root-тезі зупинявся захистом від дублікатів в `insertPropAtTag` (`First writer wins`), мовчки відкидаючи переходи для `default`.
- **Фікс:** у `generateConnectionCode` (`src/code/variants/connection-config.ts`) додано нормалізацію `const rootId = findVariantRootId(result)` та об'єднання `!c.sourceNode || (rootId && c.sourceNode === rootId)` в один `ROOT_KEY`-бакет, щоб усі root-зв'язки одного тригера завжди об'єднувалися в єдиний `onHoverStart` / `onHoverEnd` / `onTap` обробник. Додано регресійний тест у `src/code/variants/connection-config.test.ts` (`72/72` vitest, `tsc --noEmit` чистий), перезібрано `packages/cli/dist/main.js`.
- **Коміт:** `7d968d48`

### [MCP-011] Видалення Glide у UI / `glide-gen` могло залишати `layout`, `data-glide="..."`, порожні обгортки або скасовані `updateGlide` мутації ⚠️ (виправлено)
- **Що сталося:** після застосування та видалення Glide у UI на рядках `ProjectRow` у коді `app/projects/page.client.tsx` залишалися атрибути `data-glide`, `layout`, `transition`, а також `AddEffectDropdown` дозволяв вішати Glide напряму на інстанси компонентів.
- **Причина:**
  1. У `src/code/generation/glide-gen.ts` (`cleanNodeTag`) перевірка `\s\blayout(?=[\s/>])` не спрацьовувала, якщо `layout` або `layout={true}` стояли в самому кінці відкриваючого тегу перед `>` (`getOpeningTag` обрізає тег до `>`), а `hasGlide`/`cleanNodeTag`/`glidedNodeIds` шукали лише одинарні лапки `data-glide='...'`.
  2. У `removeGlide` не чистилися порожні `data-glide-item` обгортки (`sweepEmptyGlideWrappers`) і зайвий перенос рядка після видалення єдиного `import { LayoutGroup } from 'framer-motion';`.
  3. У `src/code/mutation/mutation-queue.ts` `removeGlide` не скидав відкладену (`deferredAnim`) мутацію `updateGlide` для того самого `nodeId`.
  4. У `src/editor/tools/AnimationTool/AddEffectDropdown.tsx` Glide помилково пропонувався на інстансах дизайн-компонентів (`isComponentInstance`), хоча інстанси на сторінці не мають дочірніх елементів.
- **Фікс:**
  - У [`glide-gen.ts`](src/code/generation/glide-gen.ts) оновлено регулярні вирази на `(?=[\s/>]|$)` та `data-glide=(?:'[^']*'|"[^"]*")`, збалансовану зачистку `transition`, `sweepEmptyGlideWrappers` і чисте прибирання порожнього рядка імпорту `LayoutGroup`.
  - У [`mutation-queue.ts`](src/code/mutation/mutation-queue.ts) `removeGlide` тепер відфільтровує відкладені `updateGlide` для того ж `nodeId`.
  - У [`AddEffectDropdown.tsx`](src/editor/tools/AnimationTool/AddEffectDropdown.tsx) Glide приховано для `isComponentInstance`.
  - Додано 3 регресійні тести в [`glide-gen.test.ts`](src/code/generation/glide-gen.test.ts) (`76/76` vitest, `tsc --noEmit` чистий), перезібрано `packages/cli/dist/main.js`.
- **Коміт:** буде зафіксовано локальним комітом одразу після верифікації.
