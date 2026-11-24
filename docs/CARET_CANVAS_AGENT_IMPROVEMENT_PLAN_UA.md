# План покращення взаємодії AI-агента з канвасом у Revyme (на основі аналізу `caret-desktop`)

**Дата:** 2026-11-24  
**Джерело референсу:** [`precious112/caret-desktop`](https://github.com/precious112/caret-desktop)  
**Цільова система:** Revyme Website Builder (`src/ai/`, `src/canvas/`, `src/canvas-sandbox/`, `src/editor/agent/`, `src/code/`)

---

## 1. Контекст і мета

У Revyme вже реалізовано сильну AST/code-first архітектуру:
- Двосторонній цикл `ProjectFS` ↔ `CanvasNode` (`src/code/parsing/parser.ts`) ↔ ізольований iframe (`src/canvas/Renderer.ts`, `src/canvas-sandbox/bridge-host.ts`) ↔ черги мутацій та чисті генератори (`src/code/mutation/`, `src/code/generation/`).
- Послідовність спостережень із захистом від застарілого кешу (`src/ai/agent/tools/observation-epoch.ts`: `renderSeq`, `projectVersionAtFill`, 100% покриття вузлів у `waitForRender` / `settleObservation`).
- Функціональна перевірка інтерактивності (`src/ai/agent/tools/verify-effect.ts`) та рендер-лінтер (`src/ai/agent/tools/design-audit.ts`).
- Контекстно-залежні поверхні (`src/ai/agent/surface.ts`), проєктні скіли (`src/code/project/skills-config.ts`, `src/ai/agent/tools/project-skills.ts`), гілки `ProjectFS` (`src/ai/agent/tools/branches.ts`), єдиний undo-чекпоінт на ран (`src/ai/agent/checkpoint.ts`) і дзеркалювання зовнішніх MCP-ранів (`src/editor/agent/external-run.ts`).

Головна прогалина, яку добре вирішує `caret-desktop` — **швидкий візуальний цикл прямо на канвасі**: запуск правок без переключення уваги в сайдбар-чат, виділення довільної області з передачею точної геометрії елементів, замкнена пост-редендерна перевірка геометрії, очищення контраст-аудиту від анімацій та накопичення звичок користувача в правила й токени.

Цей документ описує покроковий план перенесення найкращих патернів `caret-desktop` у Revyme з дотриманням п'яти архітектурних інваріантів із `AGENTS.md`:
1. Усі читання DOM канвасу й скріншоти — тільки через `canvas/node-ops.ts` та `canvas/canvas-bridge.ts` (`captureElement`, `rectCache`, `computedCache`), без прямих викликів `getBoundingClientRect()` / `getComputedStyle()` із батьківського фрейму.
2. Усі записи у файли проєкту — через `modifyProjectFile` / `queueMutation` / інструменти агента й `TurnCheckpoint` (1 undo-крок на ран) із дотриманням `agent-run-lock-store.ts`.
3. Порожній рядок `""` означає видалення CSS-властивості.
4. Responsive-мутації завжди прив'язані до активного `vpId` / `vpPrefix`.
5. Усе, що потрібно опублікованому сайту в рантаймі, живе в `@revyme/runtime`.

---

## 2. Дорожня карта по фазах

| Фаза | Назва | Статус / Пріоритет | Основний ефект |
|---|---|---|---|
| **Фаза 0** | **Збагачення контексту в `Copy to MCP` та `AgentCommentPopover` / `AgentChat`** | **✅ Виконано** | Агент одразу бачить `styles`, `computed`, `rect`, `parentId`, `children`, `bindings`, `insideComponentInstance` і `branch` — без зайвого `get_node` |
| **Фаза 1** | **Inline Canvas Edit Lane + Canvas Edit Pill + Tool Scoping** | P0 (високий ROI) | Запуск і контроль AI-правок прямо на канвасі за 1 крок без засмічення `AgentChat`, з вузьким набором тулів і локальним JSX-патчем |
| **Фаза 2** | **Покращення аудиту та скріншотів (`design-audit.ts`, `screenshot.ts`, `canvas-sandbox`)** | P0 (високий ROI) | Зняття хибних помилок контрасту на анімаціях, нові механічні перевірки slop-артефактів, тайлені full-res скріншоти |
| **Фаза 3** | **Region Lasso (`overlay-edit`) + Crop-Local геометрія + Verify Loop** | P1 | Точне виділення будь-якої ділянки сторінки з піксельною арифметикою замість вгадування на око й пост-перевірка результату |
| **Фаза 4** | **Навчання з ручних правок (Correction Mining) + Explore «3 Takes»** | P2 | Автоматична пропозиція оновити токени / зберегти `ProjectSkill`; паралельне порівняння 2–3 дизайн-варіантів |

---

## 3. Детальний план робіт

### Фаза 0. Збагачення контексту для `Copy to MCP` і `Comment for Agent` (✅ Виконано)

**Мотивація з аналізу `caret-desktop`:**
У `caret-desktop` агент знає, що змінювати з першого ходу, тому що канвас перед викликом передає не просто `caretId`, а повний локальний зріз стану елемента (`context-builder.ts`). У Revyme `buildMcpReference()` (`src/canvas/ui/mcp-reference.ts`) раніше віддавав лише адресу (`filePath`, `nodeId`, `type`, `viewport`), через що агент перед `styles.set` змушений був викликати `nodes.get` / `observe.tree`.

**Що реалізовано:**
- У `src/canvas/ui/mcp-reference.ts` розширено `buildMcpReference()` (без порожнього шуму — пусті об'єкти, тривіальні дефолти й гілка `'main'` опускаються):
  - `styles` (актуальні inline-стилі з `CanvasNode.styles` без видалених `""` значень);
  - `computed` (`MCP_COMPUTED_STYLE_PROPS` із `findNodeComputedStyles`, без дублікатів `styles` і тривіальних значень);
  - `rect` (`{ x, y, width, height }` у px із `findNodeRect`);
  - `parentId`, `children` (до 15 елементів `{ nodeId, type, name }` + `childrenTotal`);
  - `insideComponentInstance`, `isComponentRoot`, `isMotionElement`;
  - `bindings` (`styleVariables`, `textVariable`, `textExpression`, `hrefExpression`, `srcExpression`, `ariaLabelExpression`, `translationKey`);
  - `branch` (тільки коли не `'main'`).
- У `src/canvas/ui/ContextMenu.tsx` виділено спільний `buildContextMcpRef()` для `Copy to MCP` і `Comment for Agent`.
- У `src/code/stores/agent-chat-store.ts` та `src/editor/agent/AgentChat.tsx` розширено `AgentAttachedNode` та `formatAttachedContextLines()`, тож ці самі поля автоматично потрапляють у промпти `[Target Element]` та `[Staged Tasks]`.

---

### Фаза 1. Inline Canvas Edit Lane + Canvas Edit Pill + Tool Scoping

**Референс у `caret-desktop`:**
- `src/core/design/agent/edit-lane.ts` (`EditLaneBridge`, `EditStatus`)
- `src/core/design/rendering-shell/canvas-template.ts` (`generateEditPill`, `ackEdit`)
- `desktop/main/agent-service.ts` (`editConversation` окремо від `conversation`)
- `src/core/design/visual-editing/context-builder.ts` (правило не зашивати неіснуючі імена тулів у user-промпт)

**Проблема в Revyme зараз:**
- `AgentCommentPopover` (`src/canvas/ui/AgentCommentPopover.tsx`) лише додає задачу в `agentStagedTasksAtom` (`src/code/stores/agent-chat-store.ts`) або відкриває панель `vibe`, а контекстне меню (`src/canvas/ui/ContextMenu.tsx`) заповнює `agentAttachedNodeAtom` і переводить користувача в ліву панель `AgentChat` (`src/editor/agent/AgentChat.tsx`).
- При швидких точкових змінах (колір, бордер, відступи, перестановка елемента) переривається поточний діалог у сайдбарі, а модель бачить у схемі всі ~60+ інструментів із `ALL_TOOLS` (`src/ai/agent/tools/index.ts`), включно з CMS, SEO, i18n та плагінами.

**Архітектурне рішення для Revyme:**
1. **Двошвидкісна стратегія запису (Semantic Tools + Локальний JSX-патч, а не `whole-file`):**
   - *Чому не «прямий перезапис коду всього файлу»:* у Revyme сторінка в `apply_file_edit` (`src/ai/agent/tools/whole-file.ts`) — це 400–1200 рядків TSX (10–25 с генерації), окремі responsive-правила в `<style>`, захист розгорнутих інстансів компонентів (`semantic-property.ts`) і суворі правила оракла (`gate.ts`). Навіть `caret-desktop` додав `get_params` / `set_param` як швидший шлях поверх прямих файлових правок.
   - *Швидкі стилі й текст (за замовчуванням):* завдяки Фазі 0 модель уже має `styles`, `computed`, `rect` і `bindings` у старт-контексті, тож викликає **`set_styles` / `set_text` / `set_link`** за 1 крок (< 0.5 с) без попереднього `get_node`.
   - *Структурні зміни піддерева:* додати легкий проміжний інструмент **`patch_node_jsx` / `replace_node_jsx`** (заміна лише конкретного `node_id` або малого JSX-піддерева замість усього файлу через `apply_file_edit`), який автоматично проганяє патч через `autoInjectMissingDataIds`, `healMotionTags` і `gateTurnFiles` у межах поточного `TurnCheckpoint` (і працює також на гілках `ProjectFS`).
2. **Tool Scoping для Inline Edit Lane:**
   - При запуску з канвасу (`AgentCommentPopover` / `Region Lasso`) обмежувати список доступних інструментів фокусним профілем (~8–10 тулів: `get_node`, `set_styles`, `set_text`, `set_link`, `insert_fragment`, `replace_fragment`, `patch_node_jsx`, `get_layout`, `get_screenshot`, `tokens`), прибираючи CMS, SEO, i18n, плагіни та керування сторінками.
   - У промпті формулювати *ціль* і *передані дані*, не нав'язуючи неперевірених імен інструментів (урок `context-builder.ts` із `caret-desktop`).
3. **Незалежний стан Edit Lane (`src/code/stores/agent-edit-lane-store.ts` або секція в `agent-chat-store.ts`):**
   - Окремий `editLaneStatusAtom`:
     ```ts
     export interface CanvasEditPillState {
       runId: string;
       phase: 'working' | 'done' | 'failed' | 'cancelled';
       instruction: string;
       targetNodeIds: string[];
       filePath: string;
       detail?: string;        // останній активний tool label із prompts/tool-labels.ts
       error?: string;
       startedAt: number;
     }
     ```
   - Запускається окремий `streamAgentTurn` (`src/ai/agent/agent-client.ts`) з власним тимчасовим `chatId` (наприклад, `inline-edit-<timestamp>`), щоб не перезаписувати `agentConversationAtom` і не переривати активну вкладку `AgentChat`.
   - Захист від гонок: одночасно активний лише **один** inline-edit (другий запит повертає зрозуміле повідомлення в pill, поки перший не завершено або не натиснуто Cancel), а `lockBranch` (`src/code/stores/agent-run-lock-store.ts`) і `TurnCheckpoint` працюють за тим самим контрактом, що й основний чат.
4. **Миттєвий UI-відгук у `AgentCommentPopover.tsx` та `CanvasEditPill.tsx`:**
   - У `AgentCommentPopover` додати дві дії:
     - **Enter / «Apply now»** — миттєво закриває поповер, локально показує `CanvasEditPill` у фазі `'working'` (< 50 мс, до старту HTTP/SSE), підсвічує цільовий вузол пульсуючим контуром поверх канвасу (у батьківському overlay-шарі редактора по координатах із `findNodeRect`, без мутації DOM усередині iframe).
     - **«Stage for Chat»** — зберігає поточну поведінку (`agentStagedTasksAtom`) для пакетної відправки кількох коментарів разом.
   - У `CanvasEditPill` (фіксований знизу по центру канвас-області):
     - показує спінер + скорочений текст інструкції + поточний крок (`tool_call.label`);
     - кнопку `×` (`AbortController.abort()` + `agentRunAbort()` у `src/ai/agent/bridge-tools.ts`);
     - фінальний стан `'done'` («Edit applied» + кнопка «Undo» через існуючий `TurnCheckpoint`) з автоприховуванням через ~2.5 с, або `'failed'` із зрозумілим текстом помилки (`humanizeFailure` з `src/editor/agent/humanize-failure.ts`).
5. **Узгодження з `external-run.ts`:**
   - Опційно записувати завершені inline-едити в окремий лог/історію (або в компактний рядок історії проєкту), не змішуючи їх із поточним стрімом `AgentChat`.

**Файли до змін / створення:**
- `src/code/stores/agent-edit-lane-store.ts` (новий)
- `src/editor/agent/edit-lane-runner.ts` (новий — обгортка навколо `streamAgentTurn` + `AbortController`)
- `src/canvas/ui/CanvasEditPill.tsx` (новий)
- `src/canvas/ui/AgentCommentPopover.tsx` (додати «Apply now» як основну дію, залишити «Stage» та «Add & Open Chat»)
- `src/ai/agent/tools/` (новий `patch_node_jsx` + фільтрація тулів для `edit-lane` профілю)
- Тести: unit-тест життєвого циклу `edit-lane-runner.test.ts` (миттєвий `ack`, abort, error, блокування паралельного запуску) + компонентний тест `CanvasEditPill.test.tsx`.

---

### Фаза 2. Підсилення `design-audit.ts`, `screenshot.ts` і стабілізація анімацій

**Референс у `caret-desktop`:**
- `desktop/main/page-settle.ts` (`settleScript`, `finishMotionScript`)
- `src/core/design/design-checks.ts` (`BUILTIN_CHECKS`, `DESIGN_CHECKS_DOM_SCRIPT`, `shouldFeedBack`)
- `desktop/main/design-checks.ts` (`DesignChecksService`, `fedActivities`)
- `desktop/main/mcp/tools.ts` (`get_screenshot` із 900px тайлами та ведучим текстовим мета-блоком)

**Проблема в Revyme зараз:**
1. `computedCache` у `src/canvas-sandbox/` може зафіксувати проміжну прозорість/трансформацію (`opacity < 1`), якщо вхідна Framer Motion / CSS-анімація ще не завершилася, через що `auditContrast` у `design-audit.ts` або `get_screenshot` бачить неправдивий стан сторінки.
2. У `design-audit.ts` немає перевірок на розтягнуті растрові картинки (`IMAGE_UPSCALED`), дубльований «рибний» текст у картках (`IDENTICAL_CARDS`) та надмірне обрамлення всіх контейнерів (`BORDER_ON_EVERYTHING`).
3. `getScreenshotTool` (`src/ai/agent/tools/screenshot.ts`) знімає весь `'root'` одним зображенням — на довгих сторінках (> 2500px) деталі тексту й вирівнювання стають нерозбірливими для vision-моделей.

**Конкретні покращення:**
1. **Завершення скінченних анімацій перед заміром/скріншотом у `canvas-sandbox`:**
   - Додати в `SandboxApi` (`src/canvas-sandbox/sandbox-api.ts`) та `bridge-sandbox.ts` метод або опцію `settleVisualState()` (перед `captureElement` і перед форсованим `settleObservation` у `wait-for-render.ts`):
     - чекати `document.fonts.ready` та завершення видимих `<img>` (`complete`);
     - для `document.getAnimations()` викликати `anim.finish()` лише на скінченних анімаціях (`timing.iterations !== Infinity`), не чіпаючи нескінченних ambient-ефектів.
   - Увага: для `captureElement` не змінювати стан у реальній сесії користувача назавжди (або робити м'яке очікування/restore, якщо анімація вхідна).
2. **Нові механічні правила в `src/ai/agent/tools/design-audit.ts`:**
   - Доповнити `AuditNode` або sandbox-snapshot метаданими для `<img>`: `naturalWidth`, `naturalHeight`, `hasAlt` (або передавати через `attrs` + легке поле в `computedCache`).
   - Додати чисті правила (кожне з власним фікстурним тестом у `design-audit.test.ts`):
     - **`IMAGE_UPSCALED`**: `img` із `naturalWidth > 0`, `rect.width >= 48` і `rect.width / naturalWidth > 1.5` (і аналогічно по висоті при спотворенні `object-fit`).
     - **`IDENTICAL_CARDS`**: контейнер із `>= 3` дочірніми елементами, де >= 2 сусіди мають ідентичний нормалізований текст довжиною `> 24` символів (ознака згенерованих карток-клонів).
     - **`BORDER_ON_EVERYTHING`** *(severity: warning / info)*: коли `>= 8` великих блоків (`>= 48×48px`) і `> 60%` з них мають `borderWidth > 0`.
3. **Тайлена нарізка довгих скріншотів у `src/ai/agent/tools/screenshot.ts`:**
   - Розширити схему `get_screenshot` опційними параметрами:
     - `sliceHeight?: number` (напр., дефолт `900` або `1200`, коли висота `'root'` > `1600px`, або вмикається параметром `tiled: true` для зворотної сумісності);
     - `part?: number` (1-based номер батча фреймів, напр. по 3–4 кадри за виклик).
   - У `bridge-sandbox.ts` (`captureElement`) підтримати кроп по `clipRect: { x, y, width, height }` при рендері, або нарізку canvas-поверхні в тайли.
   - Повертати перед кожним `{ type: 'image' }` текстовий маркер `"Frame 1 of 4 — y 0–900px (1440px wide)"` — це також гарантує чесну деградацію для не-vision клієнтів.
4. **Захист від зациклення авто-аудиту:**
   - Якщо аудит або `batch`-фідбек повертає помилки, зберігати ліміт (максимум 1 автоматичний коригувальний крок на один тип перевірки в межах ходу, розділяючи жорсткі `error` і м'які `warning`).

**Файли до змін:**
- `src/canvas-sandbox/sandbox-api.ts`, `src/canvas-sandbox/bridge-sandbox.ts`, `src/canvas-sandbox/bridge-host.ts`
- `src/ai/agent/tools/design-audit.ts`, `src/ai/agent/tools/design-audit.test.ts`
- `src/ai/agent/tools/screenshot.ts`, `src/ai/agent/tools/screenshot.test.ts`
- `src/ai/agent/tools/wait-for-render.ts`

---

### Фаза 3. Region Lasso (`overlay-edit`) + Crop-Local геометрія + Verify Loop

**Референс у `caret-desktop`:**
- `src/core/design/rendering-shell/canvas-template.ts` (рядки 2130–2228: виділення прямокутником, `filter` UI-оверлеїв при `domToCanvas`, сортування елементів по площі перетину)
- `src/core/design/visual-editing/context-builder.ts` (`describeMeasuredElements`, `visualCenterLine`)
- `src/core/design/visual-editing/verify-script.ts` (`geometryStable`, `formatVerifyPrompt`)
- `desktop/main/overlay-verify.ts` (`OverlayVerifyService`, `MAX_ROUNDS = 2`, `CROP_PAD = 48`)

**Проблема в Revyme зараз:**
- При запитах на кшталт *«вирівняй бейдж по центру кнопки»*, *«зменш відступ між цими двома блоками»* або *«перероби ось цю праву частину шапки»* користувач мусить або вибирати один конкретний `nodeId`, або пояснювати словами в чаті. Навіть із повним скріншотом модель погано оцінює точні піксельні зсуви.

**Архітектурне рішення для Revyme:**
1. **Canvas Region Lasso Tool (`src/canvas/ui/AgentRegionOverlay.tsx`):**
   - Активація з тулбару / хоткеєм (наприклад, `Cmd/Ctrl + Shift + E` або кнопка біля Agent Chat).
   - Користувач тягне прямокутник поверх канвасу → під прямокутником відкривається компактний інпут інструкції.
2. **Збір чистого кропу + crop-local геометрії (без порушення інваріанта iframe):**
   - Конвертуємо екранний прямокутник виділення у координати активного viewport-контейнера (`root`) через `findNodeRect('root', vpId)` та масштаб камери канвасу.
   - Через `getCanvasBridge().captureElement('root', vpPrefix, { ... })` (з параметром `region` / `crop` у iframe-space) знімаємо чистий PNG-кроп — усередині iframe немає хендлів виділення редактора й `CanvasEditPill`, тому в картинку гарантовано потрапляє лише реальний контент сайту.
   - Пробігаємо по `getNodesSnapshot()` та `findNodeRect(nodeId, vpId)`: відбираємо до 12 видимих вузлів, що перетинаються з `region`, сортуємо за площею перетину і переводимо їхні `rect` у **локальні координати кропу** (`x - region.x`, `y - region.y`, `width`, `height`, `cx`, `cy`, `tag`, `src` для `<img>`).
3. **Передача в агентський контекст (`src/ai/agent/region-context.ts`):**
   - Форматуємо перелік виміряних елементів у єдиному форматі з прозорим правилом:
     - звертатися до елементів за `data-id`, а не шукати по `src` картинки;
     - для задач вирівнювання/позиціювання **обчислювати різницю в пікселях арифметикою** з переданих `box` і `center`.
   - Прикріплюємо PNG-кроп як зображення до повідомлення користувача (`AgentTurnImage` / `AgentMessageOut`).
4. **Замкнений геометричний Verify Loop (`src/editor/agent/region-verify.ts`):**
   - Запускається лише для ходів, ініційованих із **Region Lasso**, і лише якщо хід змінив файли (`turn_changes.length > 0`).
   - Кроки після завершення першого `streamAgentTurn`:
     1. Викликає `settleObservation({ nodeIds, vpId })` (вже є в Revyme!), щоб дочекатися свіжого `renderSeq` і `projectVersionAtFill === projectVersionNow`.
     2. Знову читає `findNodeRect` для тих самих `nodeId` у crop/viewport координатах.
     3. Порівнює з попередніми вимірами:
        - якщо всі цільові `nodeId` видалені/замінені → стоп;
        - якщо геометрія не змінилася в межах `2px` (`geometryStable`) → стоп;
        - інакше (максимум **`MAX_VERIFY_ROUNDS = 1..2`**) робить один короткий follow-up turn у тій самій `conversationId` з новими числами + свіжим кропом (`CROP_PAD = 48px`) і інструкцією: *«Якщо поточна геометрія задовольняє запит — відповідай DONE без правок; інакше обчисли залишкову дельту та внеси одне коригування»*.
   - **Важливий запобіжник**: увесь Verify Loop працює в межах того ж `TurnCheckpoint` (якщо інтегровано в єдиний run) або групується так, щоб користувач міг відкотити результат однією дією, і миттєво переривається при натисканні `Stop` на `CanvasEditPill`.

**Файли до змін / створення:**
- `src/canvas/ui/AgentRegionOverlay.tsx` (новий)
- `src/canvas-sandbox/sandbox-api.ts` + `bridge-sandbox.ts` (додати підтримку `clipRect` у `captureElement`)
- `src/ai/agent/region-context.ts` (новий — чиста функція `describeMeasuredNodes` та `geometryStable` із unit-тестами)
- `src/editor/agent/region-verify.ts` (новий — контролер verify-раундів поверх `edit-lane-runner` + `settleObservation`)

---

### Фаза 4. Навчання з правок (Correction Mining) та Explore «3 Takes»

#### 4.1. Детерміністичний Correction Mining → Токени й `ProjectSkill`
**Референс у `caret-desktop`:**
- `src/core/design/corrections.ts` (`mineCorrections`, `TOKEN_SIGNAL_THRESHOLD = 2`, `RULE_SIGNAL_THRESHOLD = 3`)
- `src/core/design/promoted-rules.ts` (`addPromotedRule`)

**Як інтегрувати в Revyme (без винаходження нового сховища):**
- У Revyme вже є:
  - `_meta/skills.json` і `saveProjectSkill` (`src/code/stores/project-skills-store.ts`, `src/ai/agent/tools/project-skills.ts`) з прапором `alwaysApply: boolean`;
  - пресетні токени (`getPresetTokens`, `src/ai/agent/tools/tokens.ts`).
- Що додати:
  1. Легкий локальний журнал сигналів (у `localStorage` або `_meta/.corrections-signals.json`, виключений із публікації), куди пишуться:
     - **ручні відхилення від токенів** (користувач через панель стилів/кольорів змінює стиль ноди, де раніше стояв `var(--token)` або колір токена, на інший hex);
     - **повторювані короткі інструкції** з `AgentCommentPopover` / `AgentRegionOverlay` / `AgentChat` (нормалізований текст ≥ 8 символів).
  2. Чистий майнер `src/code/project/correction-miner.ts`:
     - **Сигнал токена** (поріг `>= 2` однакових замін `tokenName → newValue`): показати неінтрузивний тост/бейдж *"Оновити токен `brand` на `#...` у всіх N місцях?"* → виклик існуючого оновлення токена.
     - **Сигнал правила** (поріг `>= 3` однакових нормалізованих інструкцій, які не були dismissed): показати пропозицію *"Ви просили це вже 3 рази. Зберегти як постійний Project Skill (`/name`, `alwaysApply: true`)?"* → збереження через `saveProjectSkill`.

#### 4.2. Режим порівняння варіантів «3 Takes» поверх `ProjectFS` Branches
**Референс у `caret-desktop`:**
- `src/core/design/agent/explore-lane.ts` (`ExploreLane`, `EXPLORE_CONCURRENCY = 3`)
- `src/core/design/variants.ts` (`VARIANT_ANGLES`, `ANGLE_LABELS`, `createExploration`, `applyLeaf`)

**Як інтегрувати в Revyme (використовуючи вже готові гілки `ProjectFS`):**
- У `src/ai/agent/tools/branches.ts` уже є ізольовані гілки проєкту (`createBranchAndSwitch`, `applyBranch`, `deleteBranch`, `reviewBranch`).
- Можна додати режим **«Explore (3 variants)»** для вибраної секції або сторінки:
  1. Створювати 3 тимчасові гілки з префіксом `explore-<id>-v1..v3` (або 3 тимчасові копії цільового компонента/сторінки), не перемикаючи основний канвас користувача для кожної по черзі.
  2. Запускати до 3 паралельних агентних запитів із лінзами:
     - `v1`: *Restrained* (стримане, чисте покращення без зміни структури);
     - `v2`: *Bolder* (виразніша типографіка, контраст, візуальний акцент);
     - `v3`: *Structural* (перекомпонування сітки/ієрархії секції).
  3. Показувати галерею порівняння 3 рендерів (через існуючі прев'ю-маршрути або headless snapshot/iframe preview).
  4. Вибір переможця застосовує `applyBranch` (через oracle-gate) і видаляє інші тимчасові гілки в один клік.

*(Примітка: `Explore` варто робити після Фаз 1–3, оскільки для паралельних сесій у `ai-generator` треба переконатися, що сервер і `bridge-client.ts` коректно розводять 3 одночасні `runId` / branch-scoped мутації без блокування єдиним `active` слотом у `bridge-tools.ts`.)*

---

## 4. Архітектурні уточнення та ризики

1. **Єдиний `active` run у `src/ai/agent/bridge-tools.ts`:**
   - Зараз `bridge-tools.ts` тримає один модульний `let active: ActiveRun | null = null`.
   - Для **Фази 1** (одночасний inline-edit поки чат не стрімить) цього достатньо, але якщо користувач запустить inline-edit *під час* активного діалогу в `AgentChat` або для **Фази 4.2** (паралельні takes), `bridge-tools.ts` потрібно перевести з одиночного `active` на `Map<runId, ActiveRun>` із per-branch lock (`lockBranch` уже підтримує `Map<branchId, count>`!).
2. **Асиметрія з `caret-desktop` по системі стилів:**
   - У `caret-desktop` сторінки пишуться в Tailwind v4 класах, тому його `token-colors.ts` шукає класи `bg-brand-500`. У Revyme жорсткий інваріант — **тільки inline `style={{ ... }}` і CSS-токени пресетів** (див. `.agents/skills/revyme-mcp/SKILL.md`). Отже, в Revyme відстеження токенів та їх promotion (Фаза 4.1) мають оперувати `PresetToken` / CSS custom properties та `CanvasNode.styles`, а не Tailwind-класами.
3. **Запобігання нескінченним петлям Verify / Audit:**
   - Кожен цикл пост-перевірки повинен мати жорстку стелю (`MAX_ROUNDS = 2` для геометрії, `1` фідбек-раунд на активність для `design-audit`), зупинятися при `filesChanged === 0` або `geometryStable(..., 2px)` і не запускати аудит на самому коригувальному ході.
4. **Пряме редагування коду vs семантичні MCP-тули (`set_styles` / `patch_node_jsx`):**
   - Оракл Revyme (`src/code/oracle/gate.ts`) уже виконує авто-лікування (`autoInjectMissingDataIds`, `healMotionTags`, `migrateFileToStartBreakpoints`), але повний перезапис сторінки (`apply_file_edit` у `whole-file.ts`) для точкових правок на кшталт бордера надто повільний (сотні рядків проти 15 токенів у `set_styles`), ризикує втратити `@media`-перекриття, не працює всередині інстансів компонентів і відмовляє на гілках.
   - Оптимальний компроміс: **семантичні тули + preloaded контекст (Фаза 0) + вузький тулсет (Фаза 1)** для швидких правок властивостей, і **локальний `patch_node_jsx`** через `gateTurnFiles` лише для складних змін піддерева.

---

## 5. Критерії приймання (Definition of Done)

Для кожної реалізованої фази обов'язкові:
1. **Typecheck:** `npx tsc --noEmit` без помилок.
2. **Unit & Integration тести:** `npx vitest run` для нових і змінених модулів:
   - Фаза 0 (**✅ виконано**): тести `mcp-reference.test.ts`, `AgentCommentPopover.test.tsx`, `AgentChat.chats.test.tsx` + `npx tsc --noEmit`.
   - Фаза 1: тести `edit-lane-runner`, `CanvasEditPill`, `AgentCommentPopover` (inline launch + abort + undo checkpoint), `patch_node_jsx` через `gateTurnFiles`.
   - Фаза 2: фікстурні тести в `design-audit.test.ts` на `IMAGE_UPSCALED`, `IDENTICAL_CARDS`, `BORDER_ON_EVERYTHING`; тести пагінації/тайлінгу в `screenshot.test.ts`; тести фінішу скінченних анімацій у сандбоксі.
   - Фаза 3: чисті тести `region-context` (crop-local координати, фільтр позаобласних вузлів) та `region-verify` (`geometryStable`, `MAX_ROUNDS`, stop on no-op).
   - Фаза 4: чисті тести `correction-miner` (пороги 2/3, нормалізація інструкцій, ігнорування AI-правок при майнінгу смаку користувача).
3. **Traceability:** дотримання `trace.action` / `trace.fn` / `trace.error` у всіх нових потоках стану та DOM/bridge операціях (згідно `AGENTS.md`).
