# Архітектура підтримки External API / Headless CMS у Revyme (Rewriteme Fork)

> **Статус документа:** Проєкт архітектури (для погодження та рев'ю)  
> **Версія:** 1.0.0  
> **Авторська концепція:** Rostyslav & Antigravity  
> **Дата:** Жовтень 2026  

---

## 1. Вступ та цілі архітектури

### 1.1. Проблема поточної реалізації
У поточній версії Rewriteme CMS працює за принципом **локальних JSON-файлів**:
* Схеми полів зберігаються у `cms/{slug}.schema.json`.
* Дані записів зберігаються у `cms/{slug}.json`.
* Генератор коду буквально пише `import items from '@/cms/{slug}.json'` у клієнтський компонент `page.client.tsx`.
* **Наслідки:** При зростанні проекту до сотень або тисяч записів розмір репозиторію та клієнтського JS-бандла роздувається; для оновлення контенту з зовнішньої CMS (Directus, Baserow, Strapi) потрібна ручна синхронізація через плагіни; відсутній серверний відбір даних у реальному часі.

### 1.2. Мета
Впровадити **двохрежимну модель CMS (Dual-Mode CMS Architecture)**:
1. **Mode A — Internal (Local JSON):** Існуюча система без бази даних для швидких прототипів, сайтів-візиток або лендінгів (зберігає повну зворотну сумісність).
2. **Mode B — External API (Headless CMS):** Підключення до Directus, Baserow, Strapi або будь-якого REST API. Дані більше не зберігаються у репозиторії, локальне редагування записів вимикається, а сайт фетчить дані **на сервері Next.js (SSR / Hybrid SSG)** з фільтрацією на боці бекенду.

---

## 2. Головна концепція: «Ресурс = Зовнішня Колекція»

На відміну від Webstudio, де «Ресурси» (HTTP-запити) та «Колекції» (візуальні списки) розірвані на дві різні системи, у Rewriteme використовується **уніфікована модель**:

$$\text{API Resource} \equiv \text{Collection with Remote Data Source}$$

Кожен підключений API-ендпоінт реєструється в білдері як повноцінна **Колекція (Collection)**.
Завдяки цьому:
* Зберігаються всі наявні механізми білдера: Drag & Drop елемента `CollectionList`, прив'язка полів до карток (`CmsBoundPill`, `bind_cms_field`), сітки, пагінація.
* Зберігається генерація динамічних сторінок ітема `app/{slug}/[slug]/page.tsx` через `cms-page-ops.ts`.
* Зберігається підтримка маршрутів з кількома слагами (наприклад, `app/gallery/[category]/[place]/page.tsx`).
* Білдер, візуальний канвас і парсер JSX оперують знайомими інтерфейсами `CollectionSchema` та `CollectionItem[]`.

---

## 3. Сховище конфігурації та безпека токенів

### 3.1. Файл метаданих `_meta/cms-api-config.json`
Конфігурація зовнішніх джерел зберігається у службовій директорії `_meta/` (яка автоматично ігнорується експортером вихідного коду):

```json
{
  "mode": "api",
  "collections": {
    "tattoos": {
      "name": "Tattoos",
      "provider": "directus",
      "url": "https://api.tattoozp.com/items/tattoos",
      "method": "GET",
      "headers": {
        "Authorization": "Bearer env:DIRECTUS_TOKEN"
      },
      "cacheMaxAge": 14400,
      "defaultParams": {
        "fields": "*.*"
      },
      "schemaCache": "cms/tattoos.schema.json",
      "previewCache": "cms/tattoos.preview.json"
    },
    "categories": {
      "name": "Categories",
      "provider": "directus",
      "url": "https://api.tattoozp.com/items/categories",
      "method": "GET",
      "headers": {
        "Authorization": "Bearer env:DIRECTUS_TOKEN"
      },
      "cacheMaxAge": 14400
    }
  }
}
```

### 3.2. Безпека ключів авторизації
1. **Заборона клієнтських секретів:** Токени (Bearer, Baserow Database Token, Basic Auth) **ніколи** не вшиваються у вихідні файли `.tsx` чи клієнтські бандли.
2. **Синтаксис `env:VARIABLE_NAME`:** У полі заголовка вказується посилання на змінну середовища (наприклад, `env:DIRECTUS_TOKEN` або `env:BASEROW_TOKEN`).
3. **Генерація `.env.local`:** Під час налаштування ресурсу білдер записує токен у локальний файл `.env.local` проекту.
4. **Виконання у білдері через `/api/proxy`:** Щоб уникнути помилок CORS та витоку ключів у браузер під час тестування у білдері, виклики йдуть через локальний серверний проксі-роут білдера.

---

## 4. Візуальний інтерфейс: підключення та панель CMS

### 4.1. Вкладка CMS у режимі API
Коли у проекті активовано `Mode: API`:
* Секція редагування записів (Spreadsheet, додавання/видалення рядків) приховується або блокується з повідомленням:  
  *«Контент керується у зовнішній системі (Directus / Baserow). Для редагування даних використовуйте панель вашої CMS.»*
* Натомість відображається список підключених API-колекцій з кнопками:
  * **«+ Add API Resource»** (Створити нову API-колекцію).
  * **«Refresh Schema & Data»** (Оновити поля та дані).

### 4.2. Модальне вікно «New API Resource»
Двоколонкова модалка за зразком найкращих практик (Postman / Webstudio):
* **Ліва колонка (Request Configuration):**
  * `Name`: ідентифікатор колекції (наприклад, `tattoos`).
  * `Method`: випадаючий список (`GET`, `POST`).
  * `URL`: поле введення з підтримкою авторозбору cURL та URL-параметрів.
  * `Headers`: таблиця ключ-значення з кнопкою `+` (автодоповнення `Authorization`, пресети для Bearer / Baserow Token).
  * `Default Search Params`: фіксовані параметри бекенду (`user_field_names=true`, `fields=*.*`).
  * `Cache Max Age`: час кешування (наприклад, `14400s` / 4 години).
* **Права колонка (Preview & Schema Inspector):**
  * Кнопка **«Load Data / Test Request»**.
  * Відображення живої відповіді JSON.
  * **Автоматична інтроспекція:** білдер бере перший об'єкт з `data` або `results`, визначає типи колонок (`text`, `number`, `image`, `date`) і генерує `cms/{name}.schema.json` для випадаючих списків дизайнера.
  * Кнопка **«Save as Collection»**.

---

## 5. Панель стилів: `CollectionListTool` та кастомні параметри з `[fx]`

### 5.1. Режим API у `CollectionListTool`
Коли елемент списку на канвасі прив'язаний до API-колекції:
1. Зверху залишається вибір **`Source`** (наприклад, `tattoos`).
2. Стандартні поля внутрішнього клієнтського фільтра, сортування та ліміту приховуються.
3. Розгортається динамічний блок **`Query Parameters`** з кнопкою `+ Add Param`.

### 5.2. Таблиця Query Parameters
Кожен рядок складається з:
* **Parameter Key:** Текстове поле (наприклад, `filter[category][_eq]`, `limit`, `sort`, `order_by`).
* **Value:** Інпут зі статичним значенням АБО кнопкою **`fx`**.
* **Видалення рядка:** Іконка смітника.

### 5.3. Інтеграція існуючого `ExpressionEditorPopup`
При натисканні на кнопку **`fx`** поруч з інпутом значення:
* Відкривається вже створений у Rewriteme комбайн **`ExpressionEditorPopup`** (`Link Expression / Formula`).
* Доступні токени:
  * **Route:** `params.category`, `params.place`, `params.slug`.
  * **Search:** `searchParams.get('q')`.
  * **Page Variables:** `@pageVariables`.
* Підтримуються синтаксичні вирази:
  * `params.category || "all"`
  * `` `/gallery/${params.category}` ``
  * `params.category === 'all' ? '' : params.category`
* При натисканні «Apply Expression» значення поля перетворюється на фіолетовий значок `ExpressionBoundPill` (`[fx] params.category`).

---

## 6. Візуальний канвас (Sandbox Bridge) та прев'ю в реальному часі

### 6.1. Ізоляція Canvas Sandbox
Візуальний редактор Rewriteme працює у sandboxed iframe під керуванням Vite (`vite.sandbox.config.ts`), де немає серверного рантайму Next.js.

### 6.2. Як канвас відображає API-дані та тестує пагінацію:
1. **Повний фетчинг даних для Канвасу:** Під час підключення або оновлення API-ресурсу завантажується повний масив записів (або заданий ліміт колекції без штучного обрізання) і зберігається у `cms/{slug}.json`. Це критично необхідно для того, щоб на канвасі можна було повноцінно протестувати:
   * **Пагінацію** («Load More», Infinite Scroll): перевірка реального `matchingCount` та приховування/показу кнопок пагінації.
   * **Сортування та фільтри**: перевірка реальної поведінки фільтрів на всьому масиві даних.
2. **Передача через Bridge:** Хук `useRendererSync.ts` відправляє ці дані у віртуальний міст `setSandboxCmsCollections({ schemas, data })`.
3. **Динамічне прев'ю параметрів роуту (Preview Route Params):**
   * Якщо сторінка динамічна (`/gallery/[category]/[place]`), у верхній панелі канвасу виставляються тестові параметри (`category = 'japan'`, `place = 'shoulder'`).
   * Якщо на репітері виставлені query-параметри через `[fx]`, білдер підставляє тестові значення, виконує швидкий запит через `/api/proxy` та оновлює канвас реальними відфільтрованими картками.
   * Рендеринг залишається нативним DOM-деревом зі швидкістю 60 FPS.

---

## 7. Генерація коду: Next.js Server Components & Data Layer

### 7.1. Архітектурне розділення `page.tsx` та `page.client.tsx`

```
┌────────────────────────────────────────────────────────┐
│  Next.js Server (Node.js / Edge)                       │
│  app/gallery/[category]/page.tsx (Server Component)    │
│  • Reads params / headers                              │
│  • Compiles URLSearchParams from Query Config          │
│  • Executes fetch() with cache / ISR                   │
│  • Generates Dynamic Metadata (SEO)                    │
│  • Generates Static Params (for Hybrid SSG)            │
└──────────────────────────┬─────────────────────────────┘
                           │ Props: { items, params }
                           ▼
┌────────────────────────────────────────────────────────┐
│  Browser / Canvas Sandbox                              │
│  app/gallery/[category]/page.client.tsx ('use client') │
│  • Pure visual layer (interactive React)               │
│  • Receives pre-fetched filtered items                 │
│  • Zero client-side API requests                       │
│  • Zero leaked API secrets                             │
└────────────────────────────────────────────────────────┘
```

### 7.2. Кодогенерація списку (Collection Repeater)

У серверному файлі `page.tsx`:
```tsx
import PageClient from './page.client';

export default async function Page({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const resolvedParams = await params;

  // Формування параметрів на основі налаштувань CollectionListTool
  const query = new URLSearchParams();
  if (resolvedParams.category) {
    query.set('filter[category][_eq]', resolvedParams.category);
  }
  query.set('limit', '12');
  query.set('sort', '-created_at');

  const res = await fetch(`https://api.tattoozp.com/items/tattoos?${query.toString()}`, {
    headers: {
      Authorization: `Bearer ${process.env.DIRECTUS_TOKEN}`,
    },
    next: { revalidate: 14400 },
  });

  const json = await res.json();
  const items = json.data || [];

  return <PageClient items={items} />;
}
```

У клієнтському файлі `page.client.tsx`:
```tsx
'use client';
import previewTattoos from '@/cms/tattoos.preview.json';

export default function Page({ items: serverItems }: { items?: any[] }) {
  // На сервері — свіжі відфільтровані дані із сервера.
  // У Vite Canvas Sandbox — fallback на тестові дані для безшовного редагування.
  const items = serverItems ?? previewTattoos;

  return (
    <div data-id="grid">
      {items.map((item) => (
        <div key={item.id} data-id="card">
          <h3>{item.name}</h3>
          <img src={`https://api.tattoozp.com/assets/${item.cover}?width=500&format=webp`} alt={item.name} />
        </div>
      ))}
    </div>
  );
}
```

### 7.3. Кодогенерація детальної сторінки (`app/[slug]/page.tsx`)
```tsx
import PageClient from './page.client';
import { notFound } from 'next/navigation';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const res = await fetch(`https://api.tattoozp.com/items/tattoos?filter[slug][_eq]=${encodeURIComponent(slug)}&limit=1`, {
    headers: { Authorization: `Bearer ${process.env.DIRECTUS_TOKEN}` },
    next: { revalidate: 14400 },
  });
  const json = await res.json();
  const item = json.data?.[0];
  if (!item) return { title: 'Not Found' };
  return {
    title: item.seoTitle || item.name,
    description: item.seoDescription,
    openGraph: { images: item.cover ? [`https://api.tattoozp.com/assets/${item.cover}`] : [] },
  };
}

export async function generateStaticParams() {
  const res = await fetch(`https://api.tattoozp.com/items/tattoos?fields=slug&limit=500`, {
    headers: { Authorization: `Bearer ${process.env.DIRECTUS_TOKEN}` },
  });
  const json = await res.json();
  return (json.data || []).filter((i: any) => i.slug).map((i: any) => ({ slug: String(i.slug) }));
}

export const dynamicParams = true;

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const res = await fetch(`https://api.tattoozp.com/items/tattoos?filter[slug][_eq]=${encodeURIComponent(slug)}&limit=1`, {
    headers: { Authorization: `Bearer ${process.env.DIRECTUS_TOKEN}` },
    next: { revalidate: 14400 },
  });
  const json = await res.json();
  const item = json.data?.[0];
  if (!item) notFound();

  return <PageClient item={item} />;
}
```

---

## 8. Врахування нюансів кодової бази Rewriteme

Під час аудиту кодової бази Rewriteme виявлено наступні нюанси, які враховано в цій архітектурі:

1. **Oracle `IMPORT_ALLOWLIST` (`check-file.ts`) та `gate.ts`:**
   * Зараз дозволено імпорт виключно `@/cms/[a-z0-9-]+\.json`.
   * **Рішення:** Збереження повного кешу API-даних у `cms/{slug}.json` та схеми у `cms/{slug}.schema.json` автоматично і на 100% задовольняє всі правила Оракула (`CMS_IMPORT_MISSING` і `IMPORT_ALLOWLIST`) без потреби переписувати валідатор!
3. **Парсер `collectionList` (`parser.ts`):**
   * Парсер розпізнає джерело колекції за викликом `.map()`.
   * **Рішення:** До структури `node.collectionList` додається поле `queryConfig?: { params: Array<{ key: string; value: string; isExpression?: boolean }> }`. Парсер читає ці дані з атрибута контейнера `data-query-config`.
4. **Сумісність із `prepareSiteFiles` (`source-export.ts`):**
   * Експортер уже підтримує прапорець `ssg: true` і вміє зберігати `generateStaticParams`.
   * **Рішення:** При експорті в режимі API експортер генерує файл `.env.example` із шаблоном ключів, які користувач має вказати на сервері Coolify або Vercel.

---

## 9. Деплой-пайплайн: Coolify + Directus Webhooks (Jamstack)

1. **Хостинг:** Next.js додаток та Directus розгортаються у Coolify.
2. **Мережева ізоляція:** Next.js та Directus підключені до однієї приватної Docker-мережі. У змінній `DIRECTUS_URL` сайт використовує внутрішній хост `http://directus:8055`. Порт 8055 не виставляється в публічний інтернет.
3. **Webhook оновлення:**
   * У Coolify копіюється Deploy Webhook URL.
   * У Directus у розділі Webhooks додається тригер на оновлення колекцій: при додаванні чи зміні запису Directus надсилає запит у Coolify.
   * Coolify запускає швидку збірку контейнера (`next build` з Hybrid SSG).
   * Сайт оновлюється без простоїв (Zero-downtime deploy).

---

## 10. План реалізації (Фази)

* **Фаза 1: Сховище конфігурації та UI підключення джерел**
  * Створення модуля керування конфігурацією API-колекцій (`src/code/project/cms-api-config.ts`).
  * Модальне вікно підключення API-ендпоінту з автодетекцією схеми та безпечним збереженням токенів.
* **Фаза 2: Інтеграція `CollectionListTool` та `ExpressionEditorPopup`**
  * Перемикач режиму в `CollectionListTool.tsx`.
  * Таблиця параметрів Key-Value з викликом `ExpressionEditorPopup` через кнопку `fx`.
* **Фаза 3: Візуальний міст прев'ю (Sandbox Bridge)**
  * Прокидання відфільтрованих прев'ю-запитів у канвас відповідно до активного `previewRouteParams`.
* **Фаза 4: Генератор коду серверних компонентів (`page.tsx`)**
  * Генерація серверних викликів `fetch()` із `URLSearchParams` для списків та деталей.
  * Генерація `generateMetadata` та `generateStaticParams`.
* **Фаза 5: Адаптація Oracle, тестування та валідація**
  * Оновлення перевірок у `gate.ts` та `check-file.ts`.
  * E2E та інтеграційні тести зв'язки.
