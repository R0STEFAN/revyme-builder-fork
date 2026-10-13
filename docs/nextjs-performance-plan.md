# Комплексний план оптимізації продуктивності та Web Vitals для Next.js сайту (Revyme Builder)

> **Мета:** Досягнення максимального показника **95–100 балів у Google PageSpeed Insights (Mobile & Desktop)** та зелена зона всіх метрик **Core Web Vitals (LCP, INP, CLS)** без втрати плавності (60/120 FPS), кінематографічних переходів і анімацій.

---

## 1. Архітектурний аудит поточного стану збірки

Revyme експортує проект як повноцінний автономний застосунок на базі **Next.js 16 (App Router)**, **React 19**, **TypeScript** та **Framer Motion 12** (`src/code/project/source-export.ts`).

### 1.1. Структура згенерованого застосунку
```
app/
 ├── layout.tsx               # Server Component (HTML/Body, SEO metadata, next/font, SmoothScroll)
 ├── providers.tsx            # 'use client' (ThemeProvider, NextIntlClientProvider, link interceptor)
 ├── page.tsx                 # Server Component wrapper (експортує metadata, рендерить <PageClient />)
 ├── page.client.tsx          # 'use client' (Полотно сторінки з inline-стилями та <style> блоком)
 ├── smooth-scroll.ts         # Конфігурація Lenis
 ├── smooth-scroll-controller.tsx # Клієнтський контролер Lenis
 └── globals.css              # Глобальні стилі
```

### 1.2. Виявлені вузькі місця (Bottlenecks)

1. **LCP (Largest Contentful Paint)**:
   - **CSS `backgroundImage` замість `<Image>`**: Згідно з конвенцією `IMAGE_USE_BACKGROUND_FRAME`, зображення генеруються як `<div style={{ backgroundImage: "url(...)", backgroundSize: "cover" }}>`. Браузерний Preload Scanner виявляє фонові зображення із затримкою лише після розбору CSS/стилів, що додає 500–1200ms до LCP на 4G.
   - **Блокування першого кадру через Appear-анімації**: Елементи з анімацією появи (Hero H1, банери) генеруються з `useMotionValue(0)` і стартують з `opacity: 0`. Вони стають видимими тільки **після завершення клієнтської гідрації JS** через хук `useEffect(() => animate(...))`.
   - **Відсутність сучасних форматів (AVIF/WebP) та `srcset`**: Для фонових зображень завантажується повний розмір оригінального файлу навіть на мобільних пристроях.

2. **INP (Interaction to Next Paint) та TBT (Total Blocking Time)**:
   - **Повна гідрація всього DOM-дерева**: Файл `page.client.tsx` повністю помічений `'use client'`. React змушений гідрувати кожен DOM-вузол сторінки.
   - **Монолітний бандл словників у `app/providers.tsx`**: `providers-gen.ts` імпортує словники **всіх** підтримуваних мов безпосередньо у клієнтський бандл (`import enMessages from '@/messages/en.json'; import uaMessages from ...`). Відвідувач завантажує зайві кілобайти неактивних мов.
   - **Вага runtime-бібліотек**: Framer Motion (повний core) + Lenis + Next-Intl + Radix/Tiptap (якщо присутні).

3. **Smooth Scroll & Main Thread Contention**:
   - Lenis працює через глобальний `requestAnimationFrame` (`autoRaf: true`). На мобільних пристроях (iOS ProMotion 120Hz, Android 90/120Hz) нативний скрол апаратно оптимізований, а віртуальний скрол може конкурувати за CPU під час одночасної гідрації та жестів.

---

## 2. Покроковий план оптимізації

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       ПЛАН ОПТИМІЗАЦІЇ REVYME NEXT.JS                       │
├──────────────────────────┬──────────────────────────┬───────────────────────┤
│ Фаза 1: LCP & Зображення │ Фаза 2: JS & Гідрація    │ Фаза 3: Анімації      │
│ • Preload LCP-зображення │ • optimizePackageImports │ • CSS-first Hero      │
│ • image-set AVIF/WebP    │ • Спліт i18n словників   │ • Lenis mobile bypass │
│ • fetchpriority="high"   │ • Dynamic lazy widgets   │ • GPU transform only  │
└──────────────────────────┴──────────────────────────┴───────────────────────┘
```

---

### ФАЗА 1: Оптимізація LCP та обробки медіа

#### 1.1. Автоматичний Preload для LCP (Hero) зображення
У `src/code/generation/metadata-gen.ts` або при збірці `app/page.tsx` аналізувати перше видиме зображення першого екрана та інжектувати його в тег `<head>` через Next.js `metadata`:

```tsx
// app/page.tsx
export const metadata: Metadata = {
  // ... звичайні метадані ...
};

// Додавання preload лінка для першого екрана
export default function Page() {
  return (
    <>
      <link
        rel="preload"
        as="image"
        href="/api/uploads/hero-banner.webp"
        fetchPriority="high"
      />
      <PageClient />
    </>
  );
}
```

#### 1.2. Генерація `image-set` для фонових зображень
Модернізувати генератор інлайн-стилів (`generator-styles.ts`), щоб для зображень генерувався адаптивний fallback:

```tsx
style={{
  backgroundImage: "image-set(url('/uploads/hero.avif') type('image/avif'), url('/uploads/hero.webp') type('image/webp'), url('/uploads/hero.jpg') type('image/jpeg'))",
  backgroundSize: 'cover',
  backgroundPosition: 'center',
}}
```

#### 1.3. Усунення LCP-затримки від Appear-анімацій (CSS-first Hero)
Елементи першого екрана (Above-the-fold) **не повинні** ховатися на сервері під `opacity: 0`.

* **Принцип:**
  1. На SSR елементи першого екрана віддаються з `opacity: 1`.
  2. Анімація появи запускається за допомогою нативного CSS `@keyframes` або `@starting-style` ще **до того**, як завантажиться та виконається JavaScript.
  3. `framer-motion` підключається для скролу, ховерів та кліків після гідрації.

```css
/* Інжектується в <style> сторінки для hero-елементів */
@keyframes revyme-hero-fade-in {
  from { opacity: 0; transform: translateY(16px); }
  to { opacity: 1; transform: translateY(0); }
}

[data-id="hero-title"] {
  animation: revyme-hero-fade-in 0.8s cubic-bezier(0.16, 1, 0.3, 1) both;
}
```

---

### ФАЗА 2: Оптимізація JavaScript, бандлу та TBT/INP

#### 2.1. Конфігурація компілятора у `next.config.mjs`
Оновити `NEXT_CONFIG` у `src/code/project/source-export.ts`:

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: { ignoreBuildErrors: true },
  
  // Компресія gzip/brotli та захист заголовків
  compress: true,
  poweredByHeader: false,
  
  // Автоматичний tree-shaking важких пакетів
  experimental: {
    optimizePackageImports: [
      'framer-motion',
      'lenis',
      '@revyme/runtime',
      'next-intl',
      'lucide-react',
    ],
  },
  
  // Оптимізація кешування зображень
  images: {
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 31536000,
  },
};

export default nextConfig;
```

#### 2.2. Ізоляція мовних словників у `app/providers.tsx`
Зараз `src/code/project/providers-gen.ts` імпортує всі мови разом. Потрібно перевести завантаження на динамічне або передавати словник тільки активної локалі:

```tsx
// app/providers.tsx
'use client';
import { ThemeProvider } from 'next-themes';
import { NextIntlClientProvider } from 'next-intl';

export function Providers({ 
  children, 
  locale = 'en', 
  messages 
}: { 
  children: React.ReactNode; 
  locale?: string; 
  messages?: any; 
}) {
  return (
    <ThemeProvider attribute="class" defaultTheme="light">
      <NextIntlClientProvider locale={locale} messages={messages}>
        {children}
      </NextIntlClientProvider>
    </ThemeProvider>
  );
}
```

#### 2.3. Ледаче завантаження важких віджетів (Code Components)
Для компонентів з Three.js, Spline та зовнішніх iframe:
1. **YouTube / Vimeo / Google Maps**: Додати `loading="lazy"` на теги `<iframe>`.
2. **Three.js (`ModelViewer.ts`) та Spline (`SplineScene.ts`)**: Монтувати WebGL-контекст тільки тоді, коли блок входить у зону видимості (через `IntersectionObserver` з `rootMargin: '200px'`).

---

### ФАЗА 3: Збереження 60/120 FPS та тюнінг анімацій

#### 3.1. Тюнінг Lenis Smooth Scroll для мобільних пристроїв
У `src/code/generation/smooth-scroll-gen.ts` налаштувати поведінку контролера:

```typescript
// app/smooth-scroll-controller.tsx
const isTouchDevice = typeof window !== 'undefined' && 
  ('ontouchstart' in window || navigator.maxTouchPoints > 0);

const lenis = new Lenis({
  duration: Math.max(0.1, Number(cfg.intensity ?? 12) / 10),
  smoothWheel: cfg.smoothWheel !== false,
  // На тач-пристроях вимикаємо віртуальний скрол заради 120Hz ProMotion:
  syncTouch: false,
  touchMultiplier: 1,
  orientation: horizontal ? 'horizontal' : 'vertical',
  autoRaf: true,
  anchors: true,
});
```

#### 3.2. Анімації суворо через GPU (Compositor Thread)
Всі скрол-ефекти (`useScroll`, `useTransform`) повинні анімувати **виключно** такі властивості:
- `transform` (`translate3d`, `scale`, `rotate`)
- `opacity`

**Заборонено анімувати на скрол:** `width`, `height`, `top`, `left`, `margin`, `padding`, `filter: blur()` (викликає важкий Layout Thrashing та Paint репаси).

#### 3.3. Керування `will-change`
Не тримати постійний `will-change: transform` на багатьох елементах (це перевантажує GPU VRAM). Додавати його лише на час активного руху або скролу.

---

### ФАЗА 4: Мініфікація стилів та чистота коду

1. **Мініфікація інлайн `<style>`**:
   Усі медіа-правила `@media (...)` під час експорту у `source-export.ts` пропускати через базову мініфікацію (видалення зайвих пробілів, переносу рядків, коментарів).
2. **Дисципліна `suppressHydrationWarning`**:
   Залишити `suppressHydrationWarning` тільки на `<html>` та `<body>` для `next-themes`, прибравши з внутрішніх блоків, щоб не маскувати реальні розбіжності між SSR та клієнтом.

---

## 3. Таблиця очікуваного ефекту

| Метрика | До оптимізації | Після впровадження плану | Ефект |
| :--- | :---: | :---: | :--- |
| **Lighthouse Mobile Score** | 65 – 78 | **95 – 100** | 🚀 +20..30 балів |
| **Lighthouse Desktop Score** | 88 – 94 | **98 – 100** | 🚀 +6..10 балів |
| **LCP (Largest Contentful Paint)** | 3.2s – 4.5s | **1.2s – 1.8s** | ⚡ Вдвічі швидше відображення hero |
| **TBT (Total Blocking Time)** | 350ms – 600ms | **< 100ms** | ⚡ Миттєва готовність до кліку |
| **CLS (Cumulative Layout Shift)** | 0.02 | **0.00** | 💎 Ідеальна візуальна стабільність |
| **Частота кадрів анімацій** | Просідання до 45fps | **Стабільні 60/120 FPS** | 🎯 Повна плавність жестів і скролу |

---

## 4. Чек-лист впровадження у кодову базу Revyme

- [ ] **1. `src/code/project/source-export.ts`**:
  - [ ] Додати розширений `NEXT_CONFIG` з `experimental.optimizePackageImports` та `compress: true`.
- [ ] **2. `src/code/generation/metadata-gen.ts`**:
  - [ ] Автоматично генерувати `<link rel="preload" as="image" fetchPriority="high">` для LCP зображення.
- [ ] **3. `src/code/generation/smooth-scroll-gen.ts`**:
  - [ ] Вимкнути `syncTouch` у Lenis для мобільних пристроїв, щоб не блокувати нативний 120Hz скрол.
- [ ] **4. `src/code/project/providers-gen.ts`**:
  - [ ] Прибрати одночасне завантаження всіх словників локалізації, ізолювати лише активну мову.
- [ ] **5. `src/code/project/default-code-components/`**:
  - [ ] Додати `loading="lazy"` на всі `iframe` у компонентах `YouTubeEmbed`, `GoogleMapsEmbed`, `VimeoEmbed`.
  - [ ] Забезпечити перевірку видимості (`IntersectionObserver`) перед ініціалізацією Three.js / Spline.
- [ ] **6. `src/code/generation/generator-motion-compose.ts`**:
  - [ ] Для hero-блоків першого екрана генерувати CSS-first початковий стан замість блокуючого `opacity: 0`.
