# Архітектурна пропозиція: Модернізація MCP Revyme для AI-дизайну нового рівня (v2.0)

> **Статус:** Оновлена архітектурна пропозиція та інженерний план  
> **Дата:** 20 жовтня 2026 р.  
> **Версія:** 2.0 (з урахуванням нативних систем ховерів, варіантів Revyme, фізики з `motion-framer` та скілів Webstudio)  
> **Автор:** Antigravity AI Assistant & Engineering Team  
> **Цільова аудиторія:** Розробники ядра Revyme, AI-інженери, дизайн-інженери  

---

## 1. Вступ та контекст дослідження

Під час тестування роботи AI-агентів у двох веб-білдерах — **Revyme** (`revyme-builder-fork`) та **Webstudio** (`D:\webstudio-ai-agent\webstudio-ai-agent`) — за **ідентичним дизайн-промптом** було виявлено помітну різницю в результатах:
* Сайти у **Webstudio** виходять візуально багатшими, мають тонко налаштовану типографіку, гармонійні відтінені кольори, органічну анімацію скролу та інтерактивні ховер-ефекти на всіх картках і кнопках.
* Сайти в **Revyme** частіше виходять більш пласкими, статичними («дерев'яними»), з простішою структурою та дефолтними кольорами, навіть якщо агент використовує офіційний MCP-міст.

При цьому Revyme має фундаментальну архітектурну перевагу: **його джерелом правди є чистий Next.js/React код (TSX)**, тоді як Webstudio тримає проект у закритій пропрієтарній внутрішній JSON-схемі (`.webstudio/data.json`).

Повторний глибокий аналіз кодової бази білдера Revyme виявив критичний факт: **рушій генерації Revyme вже містить практично всі необхідні низькорівневі механізми (включно з генерацією нативного CSS ховеру `<style>`, варіантами компонентів та деревами вузлів `AddNodeDef`)**, але вони або не виведені в публічний шар AI-агентів (MCP / `src/ai/agent/tools`), або агент не навчений їх правильному синтаксису.

Цей документ формулює вичерпну архітектуру модернізації MCP Revyme, нативної взаємодії, правил ховерів, варіантів компонентів та синергії зі скілами дизайну та фізики анімацій (`motion-framer`).

---

## 2. Чому Webstudio зараз видає кращий дизайн (Детальний аналіз причин)

Порівняльний аналіз показав, що візуальна перевага Webstudio зумовлена не «розумом» нейромереж, а системними факторами архітектури та конфігурації:

### 2.1. Спеціалізовані скіли арт-директора та дизайн-директив
У репозиторії Webstudio встановлено пакет висококласних дизайн-скілів:
1. **`impeccable` (v4.1.2)** — розгорнутий скіл арт-директора:
   - Встановлює жорсткий **«Craft Floor»** (мінімальний рівень якості) та **прямо забороняє типові AI-кліше**: 3 однакові картки в ряд, фіолетові градієнти на темному фоні, центровані hero-секції з розмитими плямами, емодзі замість векторних іконок, плоский сірий текст на темному фоні.
   - Вимагає від'ємний трекінг для великих заголовків (`letter-spacing: -0.02em...-0.03em`), підфарбовування нейтральних кольорів відтінком бренду (tinted neutrals), оптичні компенсації відступів і обмеження довжини рядків (`65-75ch`).
2. **`design-taste-frontend`**:
   - Накладає **Anti-Default Discipline** (забороняє заїжджені дефолти на кшталт `Inter + slate-900`).
   - Вимагає від агента перед генерацією формулювати *Design Read* (настрій, цільова аудиторія, художній референс).
3. **`frontend-design`**:
   - Навчає агента діяти як провідний дизайнер бутікової студії («клієнт платить за унікальність — зроби один обґрунтований художній ризик»).

**У Revyme:** До цього моменту був наявний лише технічний скіл `revyme-mcp`, який описував технічні інструменти, але не містив жодного художнього чи типографічного стандарту. Тепер ці скіли перенесені безпосередньо в `.agents/skills/` Revyme.

---

### 2.2. Рівень абстракції MCP: «Кладка цеглин» vs «Монтаж готових секцій»
* **Webstudio MCP (`insert-fragment`):**
  Агент одним викликом інструменту вставляє повноцінний UI-фрагмент (складну Hero-секцію або Bento-grid із 20–40 елементами, бейджами та кнопками). За 4–5 викликів агент збирає цілу сторінку.
* **Поточний стан Revyme MCP (`add_node`, `set_styles`, `set_text`):**
  Інструменти атомарні й пласкі. Щоб зібрати таку ж Hero-секцію, агенту потрібно виконати **25–35 послідовних викликів MCP**.
  - *Наслідок:* Агент вичерпує ліміт кроків/уваги або свідомо спрощує верстку до примітивного примітиву («контейнер + заголовок + 1 кнопка»), оминаючи деталі, підкладки та декоративні шари.

---

### 2.3. Архітектурне відкриття: Як насправді працює ховер у Revyme
У початковій версії документа припускалося, що в Revyme взагалі немає підтримки ховеру через інлайн-стилі. **Аналіз вихідного коду показав інше:**
1. У генераторі стилів [`src/code/generation/generator-styles.ts`](file:///d:/revyme-fork/revyme-builder-fork/src/code/generation/generator-styles.ts) **вже реалізовано:**
   - `updateHoverStyleInCode(code, nodeId, styles)`: записує в тег `<style>` сторінки правило `[data-id="${nodeId}"]:hover { ... !important; }`.
   - `updatePseudoStyleInCode(code, nodeId, pseudo, styles)`: записує правила для `:focus`, `:checked`, `::before`, `::after`, `::placeholder`.
2. У черзі мутацій [`src/code/mutation/mutation-queue.ts`](file:///d:/revyme-fork/revyme-builder-fork/src/code/mutation/mutation-queue.ts) **вже є типи:**
   ```ts
   case 'updateHoverStyle':
     return updateHoverStyleInCode(code, mutation.nodeId, mutation.styles);
   case 'updatePseudoStyle':
     return updatePseudoStyleInCode(code, mutation.nodeId, mutation.pseudo, mutation.styles);
   ```
3. **Чому це не працювало в ШІ-агентів?**
   У файлі інструментів агента [`src/ai/agent/tools/semantic-property.ts`](file:///d:/revyme-fork/revyme-builder-fork/src/ai/agent/tools/semantic-property.ts) інструмент `set_styles` викликає **лише** `updateStyles` або `updateContainerStyle`! Жодного інструменту `set_hover_styles` чи параметра `state: 'hover'` у семантичному API агентів **не було виведено взагалі**!

Крім того, Revyme має потужну нативну систему **Варіантів компонентів** (`variantConfig`), яка ідеально підходить для інтерактивних елементів.

---

## 3. Нативні способи анімацій ховеру та інтеракцій у Revyme (100% GUI-Parity)

> [!CRITICAL]
> **Фундаментальний принцип білдера (The Round-Trip Invariant):**  
> Все, що створює або змінює AI-агент через MCP, **зобов'язане на 100% підтримуватися та візуально редагуватися у графічному інтерфейсі (GUI) білдера Revyme**!
>
> **Чому чистий CSS Hover категорично заборонений в MCP:**
> 1. **Втрата двостороннього редагування:** Якщо агент запише CSS-правило в `<style>`, білдер не покаже його на панелі *Effects* інспектора. Користувач не побачить цей ефект і не зможе візуально змінити його параметри повзунками.
> 2. **Конфлікт із рушієм канвасу:** Як зафіксовано в коді білдера ([`HoverPopup.tsx`](file:///d:/revyme-fork/revyme-builder-fork/src/editor/tools/AnimationTool/popups/HoverPopup.tsx#L13)): *«CSS hover was removed: CSS transform can't override motion's inline projection.»* CSS `transform` у `:hover` ламає FLIP-проєкцію координат під час перетягування та ресайзу на канвасі.
>
> Тому в Revyme існують **тільки 2 легітимні візуальні парадигми ховеру**:

```
                  Дві візуальні парадигми ховеру в Revyme (100% GUI-Parity)
                  
 ┌─────────────────────────────────────────────────┬─────────────────────────────────────────────────┐
 │       Парадигма 1: Framer Motion Hover          │         Парадигма 2: Component Variants         │
 │     (Для звичайних елементів сторінки)          │             (Для Design Components)             │
 ├─────────────────────────────────────────────────┼─────────────────────────────────────────────────┤
 │ • Візуально додається через: Effects → + Hover  │ • Візуально додається через: Variants → + Hover │
 │ • Синтаксис: <motion.tag whileHover={...} />    │ • Синтаксис: variantConfig + mouseEnter         │
 │ • Повністю інтегровано з панеллю Effects:       │ • Повністю інтегровано з панеллю Variants:      │
 │   користувач бачить картку Hover і повзунки     │   користувач перемикає стани на канвасі         │
 │ • Підтримує пружинну фізику (Spring Physics)    │ • Змінює будь-які стилі, структуру та іконки    │
 └─────────────────────────────────────────────────┴─────────────────────────────────────────────────┘
```

---

### Парадигма 1: Framer Motion Hover для елементів сторінки (Effects Panel)

Це головний нативний спосіб для кнопок, карток, бейджів і посилань на сторінках. Він дає миттєвий результат, ідеально працює на канвасі та відображається в панелі інспектора білдера.

#### Як це викликає ШІ-агент через MCP:
```json
{
  "tool": "set_motion",
  "input": {
    "node_id": "cta-btn",
    "effect": "hover",
    "targets": {
      "scale": 1.025,
      "y": -4,
      "boxShadow": "0 20px 25px -5px rgba(0, 0, 0, 0.2)"
    },
    "transition": {
      "type": "spring",
      "stiffness": 350,
      "damping": 25
    }
  }
}
```

#### Як це виглядає в згенерованому TSX-файлі:
```tsx
<motion.button
  data-id="cta-btn"
  whileHover={{ scale: 1.025, y: -4, boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)' }}
  transition={{ type: 'spring', stiffness: 350, damping: 25 }}
  style={{
    backgroundColor: '#4338ca',
    color: '#ffffff',
    padding: '12px 24px',
    borderRadius: '10px'
  }}
>
  Get Started
</motion.button>
```

---

### Парадигма 2: Варіанти компонентів (`variantConfig` у Design Components)

Коли елемент є багаторазовим **Design Component** (у каталозі `components/<Name>.tsx`), Revyme використовує власну систему варіантів. Це дозволяє дизайнеру перемикати стан у панелі варіантів білдера, а на канвасі бачити стан наведення.

#### Точний синтаксис Design Component з ховер-варіантом:
```tsx
/** @name "InteractiveCard" */
'use client';

import React, { useState } from 'react';
import { withResponsiveProps } from '@revyme/runtime';

export const variantConfig = [
  { name: 'default', label: 'Default', x: 0, y: 0 },
  { 
    name: 'default-hover', 
    label: 'Card - Hover', 
    x: 0, 
    y: 200, 
    interactionType: 'hover', 
    parentVariant: 'default' 
  },
  { 
    name: 'pressed', 
    label: 'Card - Pressed', 
    x: 0, 
    y: 400, 
    interactionType: 'pressed', 
    parentVariant: 'default' 
  }
];

export const variantConnections = [
  { from: 'default', to: 'default-hover', trigger: 'mouseEnter' },
  { from: 'default-hover', to: 'default', trigger: 'mouseLeave' },
  { from: 'default-hover', to: 'pressed', trigger: 'clickStart' },
  { from: 'pressed', to: 'default-hover', trigger: 'click' }
];

export const transitions = {
  'default-hover': { transition: { duration: 0.25, ease: [0.16, 1, 0.3, 1] } },
  'pressed': { transition: { duration: 0.1 } }
};

interface CardProps {
  title?: string;
  description?: string;
  initialVariant?: string;
}

function InteractiveCard({
  title = "Scalable Architecture",
  description = "Engineered for high-throughput visual editing.",
  initialVariant = 'default'
}: CardProps) {
  const [variant, setVariant] = useState(initialVariant);

  const isHovered = variant === 'default-hover';

  return (
    <div
      data-id="card-root"
      onMouseEnter={() => setVariant(variant === 'default' ? 'default-hover' : variant)}
      onMouseLeave={() => setVariant(variant === 'default-hover' ? 'default' : variant)}
      style={{
        padding: '28px',
        borderRadius: '16px',
        backgroundColor: isHovered ? 'rgba(255, 255, 255, 0.06)' : 'rgba(255, 255, 255, 0.02)',
        border: isHovered ? '1px solid rgba(255, 255, 255, 0.2)' : '1px solid rgba(255, 255, 255, 0.08)',
        transform: isHovered ? 'translateY(-4px)' : 'translateY(0px)',
        boxShadow: isHovered ? '0 20px 30px -10px rgba(0, 0, 0, 0.3)' : 'none',
        transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
        cursor: 'pointer'
      }}
    >
      <h3 data-id="card-title" style={{ fontSize: '20px', fontWeight: '600', color: isHovered ? '#ffffff' : '#e2e8f0' }}>
        {title}
      </h3>
      <p data-id="card-desc" style={{ fontSize: '14px', color: '#94a3b8', marginTop: '8px' }}>
        {description}
      </p>
    </div>
  );
}

export default withResponsiveProps(InteractiveCard);
```

---

### Парадигма 3: Фізичні мікроінтеракції через `set_motion` (Framer Motion)

Коли потрібна плавна фізична пружина (Spring), елевація з відскоком або складний жест перетягування:
* Використовувати семантичний інструмент `set_motion`.
* Вказувати `effect: "hover"`.
* Задавати параметри трансформації `y`, `scale`, `boxShadow` та параметри пружини `stiffness`, `damping`.

```json
{
  "tool": "set_motion",
  "input": {
    "node_id": "bento-card-1",
    "effect": "hover",
    "targets": {
      "y": -5,
      "scale": 1.02,
      "boxShadow": "0 24px 38px -10px rgba(0, 0, 0, 0.25)"
    },
    "transition": {
      "type": "spring",
      "stiffness": 320,
      "damping": 22
    }
  }
}
```

---

## 4. Принципи та патерни анімацій (Синтез із `motion-framer`)

На основі детального вивчення скіла `motion-framer` сформульовано фундаментальні правила руху для всіх проектів білдера Revyme:

### 4.1. Фізика пружин (Spring Physics) замість штучних таймінгів
Linear анімації виглядають дешево. Анімації на основі тривалості (`duration`) часто відчуваються неприродно. Справжній інтерфейсний преміум-дизайн використовує фізичні пружини.

#### 4 стандартні пресети пружин для Revyme:
1. **Snappy / Interactive** (`stiffness: 350–400, damping: 25–28`):
   - Призначення: Кнопки, перемикачі, кліки (`whileTap: { scale: 0.96 }`), ховер на дрібних елементах.
   - Відчуття: Миттєва реакція без запізнення, мінімальний пружний відгук.
2. **Gentle / Surface** (`stiffness: 240–300, damping: 22–24`):
   - Призначення: Картки Bento-grid, спливаючі модальні вікна, дропдауни.
   - Відчуття: М'який органічний підйом, плавна зупинка.
3. **Bouncy / Delight** (`stiffness: 380, damping: 15–18`):
   - Призначення: Бейджі повідомлень, успішне завершення дії, іконки привернення уваги.
   - Відчуття: Грайливий, виразний відскок.
4. **Slow Momentum** (`stiffness: 50–70, damping: 18–20`):
   - Призначення: Фоновий паралакс, великі фонові сфери, м'яка поява секцій.
   - Відчуття: Вагомість, кінематографічність.

---

### 4.2. Правило апаратного прискорення GPU (Hardware Acceleration Rule)
> [!CAUTION]
> **Сувора заборона:** Ніколи не анімувати `width`, `height`, `top`, `left`, `margin`, `padding` під час ховеру чи скролу. Це викликає перерахунок геометрії DOM (Layout Thrashing) та призводить до просідання FPS на мобільних пристроях.

* **Дозволені властивості:** Тільки властивості композитингу:
  - `transform` (`x`, `y`, `scale`, `rotate`)
  - `opacity`
  - `filter` (`backdrop-filter`, `blur`) — помірно

---

### 4.3. Калібрування мікроінтеракцій (Subtle Scale & Shadow Bloom)
* **Ховер-масштаб:** Ніколи не робити `scale: 1.1` або `1.2` для карток — це ламає верстку і виглядає непрофесійно. Правильне значення: **`scale: 1.015...1.03`**.
* **Елевація (Y-offset):** Підйом картки в діапазоні **`-3px...-6px`**.
* **Shadow Bloom (Розквіт тіні):** У спокійному стані тінь легка або відсутня (`0 4px 6px -1px rgba(...)`), а при ховері розсіюється у глибину: `0 20px 30px -10px rgba(0, 0, 0, 0.15)`.

---

### 4.4. Каскадна поява контенту (Staggered Orchestration)
Коли користувач доскролює до секції з картками або фічами, вони не повинні з'являтися одночасно одним суцільним блоком:
* Базовий інтервал каскаду: **`0.08s–0.12s`** між елементами.
* Напрямок: знизу вгору (`from: { opacity: 0, y: 24 }` до `{ opacity: 1, y: 0 }`).
* Viewport Trigger: `viewport={{ once: true, amount: 0.2, margin: "-50px" }}` — анімація спрацьовує, коли елемент зайшов на 20% в область видимості, і фіксується назавжди.

---

## 5. Архітектура оновлень MCP Revyme

Щоб надати ШІ-агенту доступ до цих можливостей без ручного написання десятків AST-мутацій, впроваджуються такі оновлення в MCP:

```
                           Новий стек інструментів MCP Revyme
                           
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │                         Високорівневий набір MCP                            │
 ├────────────────────────────────┬────────────────────────────────────────────┤
 │  insert_fragment               │ Вставка складних UI-секцій з whileHover    │
 │  manage_component_variant      │ Створення/зв'язування hover-варіантів      │
 │  apply_motion_preset           │ Пружинні пресети появи та мікроінтеракцій  │
 │  make_responsive               │ Каскадні контейнерні/медіа запити          │
 └────────────────────────────────┴────────────────────────────────────────────┘
```

---

### 5.1. Інструмент `insert_fragment` (Секції та компоненти за 1 виклик)

Використовує наявний у ядрі `generator-crud.ts` рекурсивний тип `AddNodeDef` та функцію `buildNodeJSX`.
Будь-який блок `hover` трансформується у нативний `<motion.tag whileHover={...} transition={...} />`, що гарантує 100% відображення в панелі *Effects* білдера.

#### Схема інструменту:
```json
{
  "name": "insert_fragment",
  "description": "Insert a complete tree of UI elements (Hero, Bento Grid, Navigation, Pricing) in a single atomic transaction. Automatically generates unique semantic data-ids, compiles inline styles, attaches Framer Motion whileHover properties, and passes Oracle validation.",
  "parameters": {
    "parent_id": "root",
    "fragment": {
      "tag": "section",
      "name": "Features Bento",
      "styles": {
        "display": "flex",
        "flexDirection": "column",
        "gap": "32px",
        "padding": "96px 24px",
        "maxWidth": "1200px",
        "margin": "0 auto"
      },
      "children": [
        {
          "tag": "div",
          "name": "Header Block",
          "styles": { "display": "flex", "flexDirection": "column", "gap": "12px", "alignItems": "center" },
          "children": [
            {
              "tag": "span",
              "text": "PRECISION CRAFT",
              "styles": { "fontSize": "12px", "fontWeight": "700", "letterSpacing": "0.1em", "color": "#6366f1" }
            },
            {
              "tag": "h2",
              "text": "Engineered for Velocity",
              "styles": { "fontSize": "48px", "fontWeight": "700", "letterSpacing": "-0.03em", "color": "#ffffff" }
            }
          ]
        },
        {
          "tag": "div",
          "name": "Cards Grid",
          "styles": { "display": "flex", "flexDirection": "row", "gap": "20px", "width": "100%" },
          "children": [
            {
              "tag": "div",
              "id": "bento-card-1",
              "name": "Card 1",
              "styles": {
                "flex": "1",
                "padding": "32px",
                "borderRadius": "16px",
                "backgroundColor": "rgba(255, 255, 255, 0.03)",
                "border": "1px solid rgba(255, 255, 255, 0.08)"
              },
              "hover": {
                "scale": 1.025,
                "y": -5,
                "boxShadow": "0 20px 30px -10px rgba(0, 0, 0, 0.3)"
              },
              "transition": {
                "type": "spring",
                "stiffness": 320,
                "damping": 22
              },
              "children": [
                { "tag": "h3", "text": "Sub-millisecond Render", "styles": { "fontSize": "20px", "color": "#fff" } },
                { "tag": "p", "text": "Direct ProjectFS synchronization with zero overhead.", "styles": { "fontSize": "14px", "color": "#94a3b8" } }
              ]
            }
          ]
        }
      ]
    }
  }
}
```

#### Що робить виконавець на рівні ядра:
1. Рекурсивно перевіряє вузли; якщо `id` не задано — генерує стабільний семантичний `data-id`.
2. Вузли з блоком `hover` конвертує в `<motion.<tag> whileHover={hover} transition={transition} />`.
3. Викликає `addNodeInCode(code, parentId, nodeDef)`.
4. Записує результат через чергу мутацій `queueToolMutation`.
5. Валідує код через Oracle Rules. Елемент миттєво стає інтерактивним на канвасі та редагованим у панелі Effects!

---

### 5.2. Інструмент `manage_component_variant` (Для Design Components)

Дозволяє агенту створювати варіанти та зв'язувати інтеракції без ручного маніпулювання AST:

```json
{
  "tool": "manage_component_variant",
  "input": {
    "file": "components/InteractiveButton.tsx",
    "action": "add_interaction",
    "type": "hover",
    "parent_variant": "default",
    "styles": {
      "backgroundColor": "#4338ca",
      "transform": "translateY(-2px)",
      "boxShadow": "0 10px 20px -5px rgba(67, 56, 202, 0.4)"
    },
    "transition": {
      "duration": 0.2,
      "ease": "easeOut"
    }
  }
}
```

Викликає внутрішню функцію ядра [`src/code/variants/variant-ops.ts:addVariant`](file:///d:/revyme-fork/revyme-builder-fork/src/code/variants/variant-ops.ts), яка автоматично генерує конфіг, зв'язки `mouseEnter`/`mouseLeave` та обробники в коді.

---

### 5.4. Інструмент `apply_motion_preset` (Готові фізичні патерни)

```json
{
  "tool": "apply_motion_preset",
  "input": {
    "node_id": "hero-features",
    "preset": "stagger-children",
    "physics": "gentle",
    "options": {
      "stagger": 0.09,
      "y": 24
    }
  }
}
```

Підтримувані пресети:
* `fade-up`: Поява зі зсувом знизу та пружиною.
* `stagger-children`: Послідовна поява нащадків.
* `lift-on-hover`: М'яка елевація при наведенні (`y: -5`, `scale: 1.02`).
* `text-split-reveal`: Кінематографічна поява заголовка по літерах/словах (`set_text_effect`).
* `smooth-scroll`: Увімкнення Lenis з налаштованою інерцією (`set_smooth_scroll`).

---

## 6. Екосистема та синергія скілів (Пайплайн агента-дизайнера)

Завдяки скопійованим скілам із Webstudio та інтегрованому скілу `motion-framer`, агент у Revyme тепер має чіткий 5-етапний процес проектування:

```
                          Пайплайн роботи AI-дизайнера в Revyme
                          
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │ 1. АРТ-ДИРЕКТУРА (impeccable + design-taste-frontend)                       │
 │    • Перевірка за «Craft Floor» (заборона 3 однакових карток, дефолтів)     │
 │    • Формулювання Design Read (типографіка, палітра з відтінком бренду)     │
 ├─────────────────────────────────────────────────────────────────────────────┤
 │ 2. СТРУКТУРНА ГЕНЕРАЦІЯ (insert_fragment)                                   │
 │    • Збірка повноцінних секцій (Hero, Bento, CTA) за 1-2 виклики            │
 │    • Автоматичне призначення semantic data-id та чистих flex/grid макетів   │
 ├─────────────────────────────────────────────────────────────────────────────┤
 │ 3. НАТИВНИЙ ХОВЕР ТА СТИЛІ (set_hover_styles / variantConfig)               │
 │    • Сторінкові елементи: нативні правила [data-id]:hover у <style>         │
 │    • Компоненти: нативні варіанти default-hover через variantConnections    │
 ├─────────────────────────────────────────────────────────────────────────────┤
 │ 4. ФІЗИКА РУХУ ТА СКРОЛУ (motion-framer + set_motion)                       │
 │    • Пресети пружин (Snappy для кнопок, Gentle для карток)                  │
 │    • Staggered-поява списків і сіток (0.08–0.1s)                            │
 │    • Апаратне прискорення (виключно transform та opacity)                   │
 ├─────────────────────────────────────────────────────────────────────────────┤
 │ 5. ВАЛІДАЦІЯ ТА АУДИТ (Oracle Rules + npm run build)                        │
 │    • Перевірка відсутності заборонених тегів (ul/li)                        │
 │    • Чистий білд Next.js без помилок                                        │
 └─────────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Порівняльна таблиця можливостей

| Параметр | Попередній стан Revyme MCP | Після модернізації Revyme MCP | Webstudio MCP |
| :--- | :--- | :--- | :--- |
| **Кількість викликів для Hero-секції** | 20–35 атомарних викликів | **1–2 виклики (`insert_fragment`)** | 1 виклик (`insert-fragment`) |
| **Нативні ховери на сторінці** | Тільки ручний Framer Motion | **Нативний CSS у `<style>` (`set_hover_styles`)** | CSS-токени (`:hover`) |
| **Ховери в компонентах** | Складне ручне написання AST | **Нативні варіанти (`manage_component_variant`)** | Немає концепту Design Component |
| **Фізика анімацій** | Ручне написання `whileHover` | **Калібровані пружини з `motion-framer`** | Fixed duration keyframes |
| **Художній рівень агента** | Відсутній (дефолти) | **Високий (`impeccable`, `design-taste`)** | Високий (`impeccable`) |
| **Джерело даних проекту** | **Чистий Next.js / React (TSX)** | **Чистий Next.js / React (TSX)** | Замкнений JSON (`data.json`) |
| **Автономність коду** | 100% експорт на Vercel / GitHub | **100% експорт на Vercel / GitHub** | Тільки хостинг Webstudio |

---

## 8. План впровадження в кодову базу (Action Plan)

1. **Реалізація інструментів у `src/ai/agent/tools/`:**
   - Створити `src/ai/agent/tools/insert-fragment.ts` (використовує `addNodeInCode` + `updateHoverStyleInCode`).
   - Створити `src/ai/agent/tools/set-hover-styles.ts` (прокидає `updateHoverStyle` у чергу мутацій).
   - Оновити `src/ai/agent/tools/registry.ts` для експорту нових інструментів.
2. **Оновлення моста MCP `server/mcp-bridge.ts`:**
   - Додати нові методи у `ListToolsRequestSchema` (`insert_fragment`, `set_hover_styles`, `apply_motion_preset`).
3. **Оновлення скіла `revyme-mcp`:**
   - Додати правила вибору між CSS-ховером, варіантами компонентів та Framer Motion.
   - Закріпити пресети пружин та правила каскадної появи.
4. **Оновлення головного `AGENTS.md`:**
   - Додати директиву обов'язкового завантаження скілів `impeccable` та `design-taste-frontend` перед будь-якою генерацією дизайну в білдері.
