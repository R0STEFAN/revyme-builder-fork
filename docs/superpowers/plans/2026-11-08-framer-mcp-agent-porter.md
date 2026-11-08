# План реалізації: Інтерактивний MCP-портер Framer → Revyme (Agentic Transfer)

> **Для агентів-виконавців:** Необхідно дотримуватися методології Spec-Driven Development. Кожен крок позначається чекбоксом (`- [ ]`). Вносити зміни слід поетапно з обов'язковим проходженням тестів на кожному етапі.

**Мета:** Створити систему ітеративного перенесення проєктів із Framer у Revyme за допомогою набору MCP-інструментів запиту моделі Framer (`framer.*`) та інтелектуального агента-верстальника, замінивши крихкий монолітний компілятор на керований і покроковий процес зі 100% збереженням точності (Pixel-Perfect) та відсутністю фатальних збоїв білду.

**Специфікація:** `docs/superpowers/specs/2026-11-08-framer-mcp-agent-porter.md`

---

## 1. Загальні обмеження та правила розробки

1. **Не ламати існуючий код**: Усі існуючі модулі в `src/code/import/framer-native/` (`styles.ts`, `fonts.ts`, `cms.ts`, `source-graph.ts` тощо) залишаються чинними і використовуються як надійні функції-мапери.
2. **Розширення Framer Reader недоторканне**: Розширення `extensions/framer-native` уже формує валідний `revyme.framer.native` конверт версії 1. Його змінювати не потрібно.
3. **Автоматичні `data-id`**: Агент генерує чистий семантичний JSX; `fragments.insert` і `autoInjectMissingDataIds` самостійно інжектують необхідні для Revyme `data-id`.
4. **Сувора типізація та тести**: Новий код супроводжується Vitest-тестами (`npx vitest run`) та перевіркою типів TypeScript (`npx tsc --noEmit`).
5. **Debug Traces**: Усі нові сервіси та операції містять структуровані трейси `trace.action` / `trace.error`.

---

## 2. Покроковий план виконання

### Етап 1: Сервіс зрізів та екстракції Framer (`agent-slice.ts`)

Створення ядра для швидкого і компактного читання моделі Framer без надсилання гігантського JSON в контекст моделі.

**Файли для створення:**
- `src/code/import/framer-native/agent-slice.ts` — сервіс вилучення зведення, токенів, CMS та секцій/компонентів.
- `src/code/import/framer-native/agent-slice.test.ts` — модульні тести на основі наявних fixtures (`captured-underline.json`, `captured-components.json`, `captured-cms.json`).

**Інтерфейси:**
```ts
export interface FramerProjectSummary {
  provenance: { projectId: string; revision: string; editorBuild: string; mode: string };
  pages: Array<{ id: string; name: string; route: string; breakpoints: string[] }>;
  sections: Array<{ id: string; name: string; width: number; height: number; childCount: number }>;
  components: Array<{ id: string; name: string; variantCount: number; variants: string[] }>;
  tokens: { colors: number; typography: number; fonts: number };
  cms: Array<{ id: string; name: string; slug: string; itemCount: number }>;
  assets: { images: number; videos: number; vectors: number; fonts: number };
}

export interface FramerSemanticSlice {
  id: string;
  name: string;
  tag: 'section' | 'header' | 'footer' | 'nav' | 'button' | 'h1' | 'h2' | 'h3' | 'p' | 'div' | 'span';
  styles: Record<string, string>;
  text?: string;
  media?: { type: 'image' | 'video' | 'vector'; url?: string; svg?: string };
  link?: { href: string; target?: string };
  children: FramerSemanticSlice[];
  responsive?: Record<'tablet' | 'phone', Record<string, string>>;
}
```

- [x] **Крок 1.1:** Написати тести `agent-slice.test.ts`, що перевіряють екстракцію зведення, токенів і окремого вузла на фікстурах `captured-underline.json` та `captured-components.json`.
- [x] **Крок 1.2:** Реалізувати функцію `inspectNativeTransfer(transfer)` у `agent-slice.ts` з використанням `buildSourceGraph`.
- [x] **Крок 1.3:** Реалізувати функцію `extractTransferTokens(transfer)` з викликом `sourceGoogleFontRequests` та розбором палітри.
- [x] **Крок 1.4:** Реалізувати функцію `extractTransferSlice(transfer, nodeId, options)` з викликом `mapSourceStyles` та очищенням від внутрішнього шуму Framer.
- [x] **Крок 1.5:** Реалізувати функцію `extractTransferCms(transfer)` на базі `emitNativeCms`.
- [x] **Крок 1.6:** Запустити тести `npx vitest run src/code/import/framer-native/agent-slice.test.ts` і переконатися в 100% проходженні.

---

### Етап 2: Нові MCP-операції `framer.*` у `packages/automation-core`

Реєстрація інструментів запиту Framer у стандартному реєстрі операцій Revyme.

**Файли для створення / редагування:**
- `packages/automation-core/src/operations/framer-query.ts` — Zod-схеми та реалізація 4 операцій: `framer.inspect`, `framer.tokens`, `framer.slice`, `framer.cms`.
- `packages/automation-core/src/operations/framer-query.test.ts` — інтеграційні тести операцій через `defaultRegistry`.
- `packages/automation-core/src/operations/index.ts` (або `registry.ts`) — підключення нових операцій.

**Операції:**
- [x] **Крок 2.1:** Створити `packages/automation-core/src/operations/framer-query.ts` зі схемами Zod для кожної операції (`framerInspectInputSchema`, `framerTokensInputSchema`, `framerSliceInputSchema`, `framerCmsInputSchema`).
- [x] **Крок 2.2:** Реалізувати кешування завантаженого файлу (щоб при послідовних запитах `framer.slice` файл не читався і не парсився щосекунди заново).
- [x] **Крок 2.3:** Зареєструвати операції у `defaultRegistry`.
- [x] **Крок 2.4:** Написати тести `packages/automation-core/src/operations/framer-query.test.ts` і перевірити коректність викликів через реєстр.
- [x] **Крок 2.5:** Перевірити типи та білд `automation-core`.

---

### Етап 3: Створення Скіла для Агента (`framer-porter`)

Опис поведінки агента, шаблонів перекладу Framer $\to$ Revyme JSX та правил взаємодії з валідаторами.

**Файли для створення:**
- `.agents/skills/framer-porter/SKILL.md` — повна інструкція для ШІ-агента.
- Оновлення `.agents/skills/revyme-director/SKILL.md` з додаванням посилання на новий скіл.

**Зміст скіла:**
- [x] **Крок 3.1:** Описати покроковий алгоритм агента (Phase 1: Inspect & Plan $\to$ Phase 2: Tokens $\to$ Phase 3: CMS $\to$ Phase 4: Sections via `fragments.insert` $\to$ Phase 5: Components $\to$ Phase 6: Visual Audit).
- [x] **Крок 3.2:** Описати правила мапінгу компонування: перетворення Stacks у `flex flex-col` / `flex-row`, обробка `gap`, захист від `flex-shrink` колапсів, оптимізація картинок через `<img className="..." />` або Next.js Image.
- [x] **Крок 3.3:** Описати правила самолікування помилок: що робити при Oracle-діагностиках, помилках імпортів чи розбіжностях у розмірах.

---

### Етап 4: Наскрізне тестування та валідація (End-to-End Verification)

Перевірка повного циклу на тестовому проєкті без ручного втручання в компілятор.

- [x] **Крок 4.1:** Створити тестовий скріпт або тест повного циклу: імпорт `captured-underline.json` через послідовність викликів нових MCP-операцій $\to$ `tokens.set` $\to$ `fragments.insert`.
- [x] **Крок 4.2:** Перевірити проходження Oracle Gate (`check-file`) — 0 помилок, відсутність збоїв Babel.
- [x] **Крок 4.3:** Запустити повний тест-сьют: `npx vitest run` і перевірити відсутність регресій.
- [x] **Крок 4.4:** Перевірити типи у всьому проєкті через `npx tsc --noEmit`.

---

## 3. Критерії успішності (Definition of Done)

1. Будь-який збережений JSON із розширення `framer-native-reader` можна завантажити через `framer.inspect` та отримати чітку розмітку проєкту менш ніж за 500 мс.
2. Агент може викликати `framer.slice(sectionId)` і отримати чисту структуру без гігантських обсягів службового сміття Framer.
3. Кожна перенесена секція через `fragments.insert` успішно компілюється в Revyme та відображається на канвасі без падінь Babel.
4. Усі тексти, шрифти, відступи, кольори та радіуси переносяться з розрахованих значень Framer, забезпечуючи 100% Pixel-Perfect відповідність.
5. Жоден існуючий тест репозиторію не зламано.
