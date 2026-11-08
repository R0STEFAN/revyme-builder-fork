# Специфікація: Інтерактивний MCP-портер Framer → Revyme (Agentic Transfer)

**Дата:** 8 листопада 2026 року  
**Статус:** Специфікація на узгодженні (Spec-Driven Development)  
**Контекст:** Рефакторинг пайплайну перенесення сайтів із Framer у Revyme на базі MCP-інструментів та LLM-агента  

---

## 1. Контекст та передумови

Поточна реалізація імпорту з Framer спирається на:
1. **Chrome-розширення `extensions/framer-native` (`framer-native-reader-0.1.9`)**, яке зчитує сире немініфіковане дерево Framer (формат `revyme.framer.native`, дерево версії 128) з усіма властивостями, токенами, шрифтами та CMS.
2. **Монолітний компілятор `src/code/import/framer-native/compile.ts` (`compileNativeTransfer`)**, який намагається детерміновано за один крок згенерувати повний комплект із 30+ файлів Next.js.

### Проблема:
Монолітний компілятор є надзвичайно крихким:
- Будь-який непередбачений елемент верстки Framer (хафтони, складні SVG-маски, duotone-фільтри, flex-розгортання, специфічні CMS-референси) ламає або весь імпорт, або викликає помилки синтаксису Babel (`Identifier '...' has already been declared`), або призводить до колапсу верстки (flex collapse).
- Виправлення кожного окремого шаблону (Nara, Walker тощо) перетворюється на нескінченний цикл регресій у коді компілятора на десятки тисяч рядків.

### Рішення:
Перехід від сліпого монолітного транспайлінгу до **двоетапного ітеративного Agentic Transfer через MCP**:
- **Розширення Framer Reader** залишається джерелом 100% точних немініфікованих даних.
- **Новий набір MCP-операцій (`framer.*`)** локально парсить збережений JSON і надає агенту компактні, очищені зрізи (токени, CMS, конкретні секції та компоненти) із уже розрахованими через існуючі мапери стилями.
- **Агент** бере точні дані з MCP і за допомогою перевіреного інструментарію Revyme MCP v2 (`tokens.set`, `typography.set`, `fragments.insert`, `components.extract`) покроково переносить сайт у проєкт.
- **Oracle Gate та валідатори Revyme** (`check-file`, TypeScript AST, `observe.screenshot`) забезпечують замкнений цикл зворотного зв'язку: якщо виникає помилка чи нестиковка, агент бачить діагностику і миттєво адаптує код секції.

---

## 2. Межі системи та архітектура

```
┌────────────────────────────────────────────────────────┐
│             Framer Editor (Chrome Extension)           │
│         framer-native-reader (Дерево версії 128)       │
└────────────────────────────────────────────────────────┘
                            │
                            │ Зберігає capture.json
                            ▼
┌────────────────────────────────────────────────────────┐
│           Framer Inspector (Revyme MCP Ops)            │
│  - decodeNativeTransfer()       (src/shared/)          │
│  - buildSourceGraph()           (framer-native/)       │
│  - mapSourceStyles()            (framer-native/styles) │
│  - emitNativeCms()              (framer-native/cms)    │
│  - sourceGoogleFontRequests()   (framer-native/fonts)  │
└────────────────────────────────────────────────────────┘
                            │
      framer.inspect / framer.tokens / framer.slice
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│                    Coding Agent                        │
│            (Skill: framer-porter / director)           │
│                                                        │
│  Крок 1: Токени й шрифти                               │
│  Крок 2: CMS-колекції                                  │
│  Крок 3: Секції сторінки (fragments.insert)            │
│  Крок 4: Компоненти й варіанти (components.extract)    │
│  Крок 5: Візуальна звірка (observe.screenshot)         │
└────────────────────────────────────────────────────────┘
                            │
     Revyme MCP v2 (fragments, tokens, components, observe)
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│             Revyme Project & Canvas                    │
│   (Live Next.js/React .tsx files + Oracle Gate)        │
└────────────────────────────────────────────────────────┘
```

---

## 3. Специфікація нових MCP-операцій (`framer.*`)

Усі операції реєструються в `packages/automation-core/src/registry.ts` за стандартом платформи Revyme, підтримують Zod-схеми та повертають типізовані дані.

### 3.1. `framer.inspect`
**Призначення:** Завантажує та валідує `capture.json`, повертає деревовидне зведення проєкту без передачі гігантського сирого JSON у контекст моделі.
* **Вхідні параметри:**
  * `filePath` (string): шлях до збереженого файлу (наприклад, `data/framer-captures/project.json`).
  * `captureJson` (string, optional): сирий вміст, якщо передається напряму.
* **Результат:**
  * `provenance`: projectId, revision, editorBuild, rootIds.
  * `pages`: список сторінок і маршрутів (Desktop, Tablet, Phone брейкпоінти).
  * `sections`: список кореневих фреймів секцій із їхніми назвами, розмірами та ідентифікаторами.
  * `components`: список Smart-компонентів, їхні варіанти та пропси.
  * `tokensSummary`: кількість кольорів, гарнітур, типографічних стилів.
  * `cmsSummary`: перелік колекцій і кількість записів у кожній.
  * `assetsCount`: кількість зображень, відео, векторів, шрифтів.

### 3.2. `framer.tokens`
**Призначення:** Витягує точні токени, готові для прямих викликів `tokens.set`, `fonts.transformNextFont` та `typography.set`.
* **Вхідні параметри:**
  * `scopeId` (string, optional): ідентифікатор сесії capture.
* **Результат:**
  * `colors`: масив `{ name, value, dark?, oklch? }`.
  * `fonts`: масив Google Fonts та локальних `.woff2` з вагами та стилями.
  * `typography`: масив пресетів `{ name, fontSize, lineHeight, letterSpacing, fontWeight, fontFamily }`.

### 3.3. `framer.slice`
**Призначення:** Повертає компактне дерево конкретної секції або компонента з уже обчисленими стилями (`mapSourceStyles`), очищене від службових полів Framer.
* **Вхідні параметри:**
  * `nodeId` (string): ідентифікатор вузла (фрейму або компонента).
  * `viewport` (enum: `'desktop' | 'tablet' | 'phone'`, default: `'desktop'`).
  * `includeChildren` (boolean, default: `true`).
  * `depth` (number, optional, default: `10`): обмеження глибини вкладеності.
* **Результат:**
  * `node`:
    * `id`: оригінальний id Framer.
    * `name`: назва шару ("Hero", "CTA Button", "ReviewCard").
    * `tag`: рекомендований семантичний тег (`section`, `header`, `button`, `h1`, `p`, `div`).
    * `styles`: об'єкт чистих CSS-стилів (display, gap, padding, border, radius, background, width, height, flex-налаштування).
    * `text`: текстовий вміст для RichText/TextNode.
    * `media`: посилання на ассети (зображення, SVG, відео).
    * `children`: масив дочірніх зрізів.
    * `responsiveOverrides`: різниці стилів для брейкпоінтів `tablet` та `phone`.

### 3.4. `framer.cms`
**Призначення:** Витягує колекції та записи, готові для створення через `cms.schema.create` та `cms.items.create`.
* **Вхідні параметри:**
  * `collectionId` (string, optional): якщо потрібно отримати лише одну колекцію.
* **Результат:**
  * `collections`: масив схем `{ id, name, slug, fields: [{ id, name, type, required }] }`.
  * `items`: масив записів `{ id, collectionId, slug, fieldData }`.

---

## 4. Специфікація воркфлоу Агента (`framer-porter` Skill)

Агент діє за суворим ітеративним алгоритмом із гарантією валідності на кожному кроці:

```
[ Крок 1: Ініціалізація та Аналіз ]
   ├── framer.inspect(path)
   └── Формування плану робіт (Checklist у чаті)
   ↓
[ Крок 2: Базова дизайн-система ]
   ├── framer.tokens() ──> tokens.set (палітра)
   ├── fonts.transformNextFont (підключення шрифтів у layout)
   └── typography.set (створення пресетів: display-hero, body тощо)
   ↓
[ Крок 3: CMS (якщо присутня) ]
   ├── framer.cms()
   ├── cms.schema.create (створення схем)
   └── cms.items.create (наповнення даними)
   ↓
[ Крок 4: Секція за секцією (Покрокова збірка сторінки) ]
   ├── framer.slice(sectionId)
   ├── Генерація чистого семантичного React/JSX (з класами, Tailwind, пресетами)
   ├── fragments.insert(target: 'app/page.client.tsx', jsx)
   ├── Валідація: якщо Oracle/Babel повертає помилку -> автокорекція JSX
   └── observe.screenshot() -> порівняння з рендером
   ↓
[ Крок 5: Виділення компонентів (Top-Down Modularization) ]
   ├── components.extract (кнопки, картки, навігація)
   └── variants.create (варіанти стану: Hover, Active, Mobile)
   ↓
[ Крок 6: Фінальний аудит ]
   ├── diagnostics.projectCheck (перевірка 0 помилок у проекті)
   └── Звіт користувачеві
```

---

## 5. Інваріанти та гарантії надійності

1. **Жодних ручних `data-id`**: Агент генерує чистий семантичний JSX; рушій Revyme (`fragments.insert` та `autoInjectMissingDataIds`) автоматично генерує та лікує `data-id`.
2. **Незмінність вихідного коду розширення**: Розширення `extensions/framer-native` не потребує переробки — воно вже генерує повний `revyme.framer.native` конверт.
3. **Збереження існуючих парсерів**: Усі функції з `src/code/import/framer-native/` (`mapSourceStyles`, `sourceGoogleFontRequests`, `emitNativeCms` тощо) імпортуються як чисті хелпери в нові MCP-операції.
4. **Ізоляція помилок**: Падіння однієї секції не ламає весь проект. Агент виправляє тільки збійний фрагмент JSX.
5. **Pixel-Perfect відповідність**: Стилі беруться з розрахованого `mapSourceStyles` з урахуванням flex/grid правил, а фінальний результат підтверджується через `observe.screenshot`.
