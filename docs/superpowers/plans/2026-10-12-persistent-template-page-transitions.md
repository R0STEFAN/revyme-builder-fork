# Persistent Template Page Transitions — Implementation Plan

> **For agentic workers:** implement task-by-task with `executing-plans`; independent delegation is optional only when explicitly authorized. Every task uses a failing regression test, implementation, and verification.

**Goal:** переходи між сторінками одного шаблону анімують змінний контент, зберігаючи спільну оболонку та її React state. Поведінка має бути узгоджена у preview, export і publish, включно зі старими проєктами.

**Architecture:** явні області content/shared у звичайному JSX, named snapshots View Transitions API, один координатор у кореневому layout. Browser runtime живе в `@revyme/runtime`; згенерований Next adapter відповідає за router і route commit. Наявні per-template `PAGE_EFFECTS` залишаються авторською конфігурацією, кореневий registry лише об'єднує їх для виконання.

**Tech Stack:** React 19, Next App Router 16, TypeScript, Babel AST, ProjectFS/mutation queue, Vitest, Playwright, CSS View Transitions API.

**Spec:** розділ «Контракт рішення» цього документа. Це запропонований план для огляду, а не виконана імплементація.

**Analysis baseline:** 12 жовтня 2026, commit `fad1f11`. Код застосунку й збережені користувацькі проєкти під час аналізу не змінювались.

## Підтверджена причина

- `src/code/generation/page-transitions-gen.ts:258` обгортає `{children}` у `<PageTransitions>`, але компонент повертає Fragment (`:209`). Обгортка не обмежує область браузерного snapshot.
- `src/code/generation/view-transition-css.ts:126` будує всі exit/enter/mask правила для `::view-transition-*(root)`. Це snapshot документа, включно з template chrome.
- `src/code/project/active-file-store.ts:1146` створює справжні вкладені Next layouts, а не Next `template.tsx`. Збереження layout state для sibling routes вже відповідає архітектурі Next.
- Мінімальне відтворення в установленому Chrome із ТОЧНИМ поточним emitted CSS: nav і footer зберегли DOM identity; nav мав `position: fixed` і `view-transition-name: none`; `::view-transition-old(root)` мав `revyme-vt-exit` та ненульовий translate (~64 px після 120 ms). Анімований snapshot рухається навіть коли оригінальний nav нерухомий. Це відтворення механізму, не інспекція конкретного користувацького сайту.
- 7 наявних test files / 96 tests пройшли. Вони перевіряють генерацію, синтаксис, конфігурацію, CSS parity, export, CMS root key і reorder, але не нерухомість chrome під час реальної браузерної анімації.

## Суміжні ризики, видимі з коду

Ці пункти — статичні висновки для тестування, не твердження про окремо відтворені інциденти.

1. `PageTransitions` належить route-group layout. Після виходу з групи він може unmount, а promise у `finishRef` не має cleanup або timeout. Чекання прив'язане лише до `usePathname`.
2. Кожен controller встановлює document click listener. При nested controllers немає єдиного власника transition; швидкі кліки перезаписують один `finishRef`.
3. Capture handler запускається перед React link handlers. Поточний `e.defaultPrevented` ще не враховує майбутню відмову в `onClick`; код також не перевіряє `download`, не передає `replace`/`scroll` і не координується з `data-keep-params`.
4. `resolvePageEffect` виконує точний pathname lookup. CMS pattern `/blog/[slug]`, configured locale prefix, trailing slash і preview session prefix потребують нормалізації.
5. `ensurePageEffectsScaffold` оновлює helpers за `@rt-v2`, але існуючий controller записує лише коли файла немає. `prepareSiteFiles` оновлює controller, але не helpers/маркування областей. Cloud `ServerPreview.buildFiles` не викликає цей prepare pass.
6. Поточний Page Effects runtime дублюється рядком у генераторі. Це виняток із правила AGENTS.md про runtime package; нове рішення має прибрати це дублювання.

## Контракт рішення

### Що означає «нерухомі»

Спільні елементи шаблону не отримують page exit/enter, fade, scale, rotate або mask. Їхні компоненти не remount при навігації в межах того самого layout. Active link, route-dependent template variables, locale text та штатне закриття меню продовжують оновлюватись.

Це не автоматичний `position: fixed`. Звичайний footer залишається в документному потоці й може змінити координати через нову висоту сторінки або scroll reset. Вимога до fixed/sticky navbar — відсутність додаткового переміщення від page effect за однакових layout/scroll умов. При scroll reset sticky state може закономірно змінитися.

Якщо продукт потребує нерухомого footer біля краю екрана та внутрішнього scroll контенту, це окремий app-shell layout режим, який не треба нав'язувати всім сайтам.

### Області та конфігурація

```ts
// Доповнення наявного PageEffect; target продовжує означати URL призначення.
scope?: 'auto' | 'page';

type TransitionRegion = {
  name: string;                 // CSS-safe, унікальне у цьому document
  kind: 'content' | 'shared';
  instanceId: string;
};

type TransitionPlan = {
  mode: 'content' | 'page' | 'instant';
  contentName?: string;
  sharedNames: string[];
};
```

- `scope` відсутній або `auto`: однаковий template/layout chain → content transition зі збереженням chrome. Різні template chains → whole-page transition, оскільки оболонка змінюється. Сторінки без template підтримуються через їхній page root.
- `scope: 'page'`: явний авторський вибір анімації всього документа.
- Якщо для content mode не можна безпечно визначити область або імена дублюються, використати instant navigation і trace причини. Не анімувати root як прихований fallback у межах одного шаблону.
- Попередній UX «Home → All Pages» і precedence `byTarget → source all → __default` зберегти. Врахувати, що конфігурація фізично per-template: централізація controller сама собою не перетворює default однієї групи на default інших.

### Source і layout

Генератор позначає наявний DOM root сторінки як content, а максимальні template subtrees поза content slot — як shared. Орієнтуватись на AST та `{children}`, не на назви Navbar/Footer, semantic tags або CSS position.

```tsx
<div data-id="layout-root">
  <Navbar data-id="nav-instance" data-revyme-transition="shared"
    data-revyme-transition-key="t-main-nav-instance" />
  {children}
  <Footer data-id="footer-instance" data-revyme-transition="shared"
    data-revyme-transition-key="t-main-footer-instance" />
</div>

// Page client file; це його НАЯВНИЙ root, без додаткового layout box.
<main data-id="page-root" data-revyme-transition="content">...</main>
```

Ключ shared залежить від template scope та INSTANCE identity, не від master ID компонента. Для custom code components перевірити передачу data attributes на реальний root. Multi-root/Fragment без однозначного DOM root не обгортати автоматично: результат instant + trace, поки автор не задасть підтримувану область.

Не додавати звичайний `<div>` навколо slot: він змінює flex/grid, direct-child selectors, sizing і canvas/source parity. `display: contents` не використовувати як snapshot surface: він не має власного box.

### CSS і композиція

- Exit/enter presets у content mode адресують named content snapshot; root не має page transform/fade/mask.
- Shared regions мають окремі named groups і не успадковують браузерну crossfade/geometry animation. Для shared snapshot показувати новий стан без подвійного малювання старого; group отримує фінальну геометрію без page animation.
- Не обмежитись `animation: none` на root: окремі content snapshots лежать у transition overlay і можуть закрити fixed navbar. Відтворити порядок шарів, clipping і overlay/menu поведінку відповідно до оригінального layout, включно з transparent navbar. Не піднімати всі shared regions безумовно вище контенту.
- Вимкнути автоматичний browser morph розмірів content group. Не розтягувати screenshot короткої сторінки до висоти довгої. Snapshot object positioning/clip та зміна висоти перевіряються браузерним тестом.
- Визначити relative offset щодо видимої області переходу; у full-page mode зберегти поточну viewport semantics. Не дозволити `100%` перейти непомітно у 100% довгого document content box.
- Зберегти `plus-lighter`/isolation для opacity crossfade і `normal` для overlap transform effects. Не повертати white flash.
- `view-transition-name: none` на navbar не виключає його з root snapshot. Потрібні named regions або інший явний спосіб композиції.

### Навігація та readiness

Один controller живе під `<body>` у root layout, усередині чинних providers, переживає зміну route group і не key-иться pathname. Runtime не імпортує Next; adapter передає callback навігації й сигнал DOM commit.

```ts
type NavigationRequest = {
  href: string;
  replace?: boolean;
  scroll?: boolean;
};

type TransitionAdapter = {
  navigate(request: NavigationRequest): void;
};
```

Координатор має token кожного переходу, один active transition і централізований cleanup. Новий запит завершує/скасовує попередню анімацію та звільняє її promise, не навігує повторно. `ready`, `finished`, route failure, unmount і timeout очищають active styles/temporary names. Timeout очікування commit — 1500 ms; по закінченні відпустити snapshot/skip animation, дозволивши вже розпочатій навігації завершитись.

Не вважати саму зміну pathname доказом готового контенту. Next adapter повідомляє про commit destination root або loading/error boundary; snapshot можна зробити для committed loading UI, не очікуючи безмежно мережу/images/fonts.

Для Next links інтегрувати `onNavigate` через локальний adapter/wrapper, зберігши користувацькі `onClick` і `onNavigate`, Next prefetch, replace та scroll. Для простих `<a>` — узгоджений delegation після користувацьких handlers. Не покладатися на одну capture перехоплюючу функцію для всіх link types. Інтеграцію з чинними keep-params/smooth/hash handlers виконати до dispatch transition request; одна дія → один navigation.

Native back/forward мусить зберігати history/scroll і ніколи не зависати. У першому релізі instant fallback для native history допустимий; анімацію Back/Forward не обіцяти без окремого тесту pre-commit integration. Програмні builder navigations використовують той самий coordinator; довільний авторський `router.push` поза adapter не блокується і може бути instant.

## Global Constraints

- Source залишається truth: тільки JSX/AST generation + mutation queue/modifyProjectFile, без parent-frame DOM mutation.
- Readiness/DOM measurement і snapshot setup виконуються всередині runtime document; canvas доступ лише через bridge.
- Existing files редагувати через `modifyProjectFile`; pure batch prepare працює з копією map і не змінює input.
- Не змінювати author CSS position, display, flex, grid, scroll policy або user IDs заради переходу.
- Shared runtime у `@revyme/runtime`; thin Next adapter у згенерованому source. Не редагувати `node_modules` як імплементацію.
- Runtime repo відсутній як окремий checkout у цьому workspace; доступний installed package `0.0.28`. Перед реалізацією runtime task потрібен його справжній repository та README/export checklist.
- Current exported scaffold: Next `^16`, React `^19`. Не базувати рішення на experimental React ViewTransition або новішому Element.startViewTransition.
- Reduced motion / відсутній API → нормальна навігація без page animation.
- Додати `trace.action/fn/error` для планування області, start/commit/cancel/timeout/fallback/migration; не прибирати наявні traces.

## Review Focus

1. Різна висота сторінок + scroll reset: snapshot не розтягується, footer не перетворюється на fixed.
2. Transparent/sticky navbar та portal menu: правильні paint order, clipping і dismiss, без проходження контенту поверх chrome.
3. Два швидкі кліки, redirect, 404 і зміна template: promises/styles не лишаються і новий URL не відкочується.
4. CMS, locale, session prefix і однакові master components: правильний route match та унікальні instance names.
5. Старий generated scaffold + pending mutation: міграція idempotent, author changes та queue не втрачаються.

## Task 1: Зафіксувати контракт і browser regression

**Files:** Create `src/preview/e2e/page-transitions.spec.ts`; Create fixture helper `src/preview/e2e/page-transition-fixture.ts`; Modify `src/code/generation/page-transitions-gen.test.ts`, `src/code/generation/view-transition-css.test.ts`.

**Deliverable:** реальний snapshot test падає на нинішньому root animation, а відсутність remount вимірюється незалежно.

- [ ] Створити fixture із одним template, fixed navbar, звичайним footer та двома page roots; навбар містить state counter. Додати content slide тривалістю 1 s тільки для тесту.
- [ ] Через Playwright на `ViewTransition.ready` призупинити document animations посередині. Перевірити snapshot transforms/opacity та screenshot області navbar, а не лише `getBoundingClientRect` оригінального DOM.
- [ ] Перевірити, що navbar counter/mount count збережені та content old/new справді рухаються. Окремий test з root animation має показати порушення visual assertion при незмінних DOM rects.
- [ ] Виконати `npx playwright test src/preview/e2e/page-transitions.spec.ts --project=chromium`; очікувати FAIL на chrome persistence.
- [ ] Залишити цей regression failing до Task 3. Не підміняти expected нерухомість перевіркою `position: fixed`.

## Task 2: Pure region planning та source annotation

**Files:** Create `src/code/generation/page-transition-regions.ts` і `.test.ts`; Modify `src/code/generation/page-transitions-gen.ts`, `src/code/project/page-effects-config.ts` і `.test.ts`; use existing `slot-children.ts`, `ast-utils`, `generateNodeId` where applicable.

**Interfaces:** `annotateTransitionRegions(code: string, kind: 'page' | 'template', scopeKey: string): string`; `planTransitionRegions(sourceLayoutChain: readonly string[], destLayoutChain: readonly string[], effectScope: 'auto' | 'page', regions: readonly TransitionRegion[]): TransitionPlan`. Region metadata передає registry; planner не читає ProjectFS або DOM.

- [ ] Написати tests для `{ children }`, comments, existing `<PageTransitions>`, nested flex/grid slot, repeated component masters, malformed/ambiguous slot та idempotency.
- [ ] Test structure: AST element count/tag/style/sibling order до і після рівні; додались лише attrs, не boxes. Source → parser → generator → parser зберігає selectable IDs/content slot.
- [ ] Для absent scope перевірити `auto`; serializer зберігає явний `page`. Залишити target-route semantics без змін.
- [ ] Реалізувати AST-based максимальні shared subtrees поза slot ancestry; page root annotation без remount key. Generated shared name використовує instance ID + sanitized scope namespace.
- [ ] Run `npx vitest run src/code/generation/page-transition-regions.test.ts src/code/generation/page-transitions-gen.test.ts src/code/project/page-effects-config.test.ts src/code/generation/reorder-glide-template.test.ts src/code/stores/template-page-root-order.test.ts`.

## Task 3: Runtime snapshot composition і state machine

**Files:** у справжньому runtime repository Create `src/page-transitions.ts`, `src/page-transition-css.ts`, matching tests; Modify `src/index.ts` за README checklist. У builder Modify `src/code/generation/view-transition-css.ts` і `.test.ts` для нового snapshot target, прибрати mirrored helper emission після adapter migration.

**Interfaces:** runtime CSS builder приймає SideConfig pair + TransitionPlan; coordinator приймає NavigationRequest, adapter та commit token. Типи та CSS logic мають одне джерело в runtime, editor імпортує їх.

- [ ] Написати failing tests: content-target CSS без root transform, shared без crossfade/geometry animation, reduced motion, duplicate names fallback, no API fallback.
- [ ] Написати tests для двох successive requests, timeout 1500 ms, navigate failure, `ready` rejection, `finished` rejection та dispose; кожний promise settled, cleanup exactly once.
- [ ] Реалізувати named content/shared snapshots, stable content group geometry та paint order. Мінімальні CSS markers/styles scoped лише на active transition; відновити попередні author values після finish.
- [ ] Browser fixture: fixed і transparent navbar, menu portal, різна висота сторінок, nested clipping, viewport-relative offsets і маски. Screenshot navbar має збігатись між baseline і mid-transition за незмінного active state; тест іншого active state має показати тільки очікуване оновлення.
- [ ] Перевірити dark crossfade без white flash, push без bright seams; пройти Task 1 regression. Виміряти clickability/overlay blocking під час transition; не обіцяти безперервну інтерактивність тільки через DOM identity.
- [ ] Build/test runtime package й випустити сумісний package version до використання нових exports у builder. Не писати фіктивний version номер у package.json.

## Task 4: Єдиний Next adapter, route registry і navigation integration

**Files:** Create `src/code/generation/page-transition-layout.ts` і `.test.ts`; Create `src/code/generation/page-transition-routes.ts` і `.test.ts`; Modify `page-transitions-gen.ts`, `page-effects-ops.ts`, `metadata-gen.ts`, `template-ops.ts`, `active-file-store.ts`, `providers-gen.ts`; Modify link generation у `generator-styles.ts`, MotionLink/import sync у `mutation-queue.ts`; update corresponding tests.

**Generated files:** `app/page-transition-controller.tsx`, `app/page-transition-routes.ts`, optional `app/page-transition-link.tsx` (Next-aware wrapper). Existing `app/(group)/page-effects.ts` лишаються даними, existing group `PageTransitions` стає no-op compatibility Fragment після міграції.

- [ ] Tests: root adapter mounted once, unchanged template state, cross-template navigation settles, nested groups cannot install competing listeners.
- [ ] Route registry походить із реальної ProjectFS topology: page route, layout chain, content scope; при assign/rename/delete/CMS/locale changes перебудувати його через safe ops.
- [ ] Matcher: exact static route перед dynamic; `[slug]`, `[...slug]`, `[[...slug]]`; configured locales, basePath/session prefix та trailing slash нормалізувати без зняття довільного першого сегмента. Reuse існуючий preview/template matcher після перевірки його контракту, не створювати третю несумісну реалізацію.
- [ ] Root adapter використовує router push/replace і destination commit signal. Loading/error state releases snapshot; shared template не key-иться URL. CMS `key={params.slug}` лишається тільки на page subtree.
- [ ] Next link integration через `onNavigate`, зі збереженням author handlers. Plain anchors та чинні keep-params/smooth handlers використовують той самий final NavigationRequest. Builder links не мусять навігувати вдруге після preventDefault.
- [ ] Tests: canceled handler, download, external link, Cmd/Ctrl/middle click, target, hash-only, query-only, replace, scroll=false, keep-params, smooth cross-page hash, mobile-menu close-on-link. Native back/forward без застрягання; animation fallback явно перевірений.
- [ ] Run targeted generation/project/navigation suites та `npx tsc --noEmit`.

## Task 5: Одна міграція для існуючих проєктів і всіх delivery paths

**Files:** Create `src/code/project/page-transition-upgrade.ts` і `.test.ts`; Modify `src/code/project/project-fs.ts`, `src/code/project/source-export.ts` і `.test.ts`, `src/preview/ServerPreview.tsx`, `src/editor/header/LocalServerDropdown.test.tsx`; перевірити actual cloud publish request та backend prepare path, якого немає у цьому checkout.

**Interface:** `upgradePageTransitions(files: Readonly<Record<string, string>>): Record<string, string>` — pure, deterministic, idempotent, не мутує input. Повертає повний coherent scaffold з runtime version requirement.

- [ ] Tests для legacy controller + v1/v2 helper, missing helper, altered author file, existing scope=page, group без effects, duplicate root mount, repeated upgrade.
- [ ] Визначити ownership за generated markers. Не перезаписувати custom controller або arbitrary layout; використовувати AST targeted annotation/mount. Якщо source не підтримується, лишити його та повернути діагностичний trace, а не зіпсувати layout.
- [ ] Upgrade controller, registry, scopes та imports як єдиний план змін; не оновлювати тільки один generated файл. При load застосувати pure transform до unloaded map; у відкритому editor — safe ops після flush queue, одним history checkpoint.
- [ ] Той самий pure pass використати перед local preview, cloud preview, source export і cloud publish. Session prefix передавати як route-normalization config, не переписувати effect keys випадковими regex.
- [ ] Tests підтверджують, що pending queued edit збережений, custom files не перезаписані, data presets/timing не втрачені, повторна міграція не створює diff.
- [ ] Перевірити runtime availability/version у builder bundle, preview server і published scaffold. Раніше опубліковані статичні builds змінюються після rebuild/republish; оновлення білдера не змінює вже розданий HTML/JS автоматично.

## Task 6: Editor, oracle і sandbox parity

**Files:** Modify `src/editor/tools/PageEffectTool/PageEffectPopup.tsx`; Modify `src/ai/agent/tools/site-motion.ts`; Modify `src/code/oracle/check-file.ts`, `page-transition-dialect.test.ts`; Modify `src/preview-sandbox/main.tsx`, `next-shims.tsx`, `runtime-exports-covered.test.ts`; verify `transparent-tags.ts`, parser, render integrity, slot helpers.

- [ ] UI: додати `Scope: Auto / Entire Page`. Auto пояснює збереження спільного template. Не плутати Scope з існуючим Target, який вибирає destination page.
- [ ] Existing effects без scope читаються як Auto, новий scope round-trips через UI, agent tool, generated data та preview. Для malformed scope oracle дає actionable dialect violation.
- [ ] Оновити oracle guidance: root controller + named content/shared scopes; лишити guard/fallback requirements і заборону authored raw VT CSS. З generated wrappers не створювати фальшиві CanvasNodes.
- [ ] Додати нові runtime exports до явного MODULE_MAP у preview sandbox; LinkShim підтримує onNavigate/replace/scroll. Canvas static rendering не запускає transitions і не отримує нових DOM boxes.
- [ ] Пройти existing slot/reorder/parser/heal/render-integrity tests після віддалення активної відповідальності legacy PageTransitions wrapper.

## Task 7: Перевірка релізу

- [ ] Run `npx vitest run`, `npx tsc --noEmit`, `npm run build:all`.
- [ ] Run browser regression у Chromium; перевірити Firefox/WebKit із встановленими browser binaries та feature fallback. Наявний Playwright config має тільки Chromium — додати окремий preview test project/config, який не змінює режим усіх drag tests.
- [ ] Smoke exported production fixture: реальний `next build` + `next start`, навігація між двома sibling pages, CMS slug, localized page і іншим template. Не заміняти Next production verification jsdom/shim тестом.
- [ ] Re-run legacy fixture через load → preview → export; підтвердити ті самі regions/effects/runtime imports і відсутність stale generated code.
- [ ] Acceptance: в одному template screenshot navbar нерухомий, React state зберігся, лише content виконує preset; footer лишається normal flow; transition не зависає на failures; menu/links/history працюють; старий проєкт отримує виправлення без ручного редагування сторінок.

## Варіанти та рішення

| Варіант | Перевага | Обмеження |
|---|---|---|
| Named content/shared regions + persistent root coordinator — рекомендовано | Чітка модель для editor/source/runtime, збереження layout state, узгоджена міграція | Потрібні browser composition tests і runtime release |
| Залишити root animation, лише виділити shared chrome named snapshots | Менший перший patch | Решта документа далі анімується; shell/background і stacking залишаються неявними; lifecycle/старі scaffold проблеми не вирішені |
| React/Motion exit-enter з подвійним old/new page DOM | Гнучка анімація live UI | Новий routing/rendering механізм, складніша взаємодія з RSC, CMS, focus, duplicate IDs і SEO; не потрібний для цієї задачі |

Перший реліз повинен включати Tasks 1–6 і acceptance Task 7. Motion layouts для зміни геометрії template, shared hero transitions, app-shell internal scroll і повністю анімована native history navigation — окремі майбутні можливості, не prerequisites виправлення navbar.

## Джерела для перевірки контракту

- [Framer: Layout templates](https://www.framer.com/help/articles/using-layout-templates/) — shared navigation/footer та shared transitions; не розкриває внутрішню React identity implementation.
- [Framer Academy: Page Effects](https://www.framer.com/academy/lessons/page-effects) — використання View Transitions API, global/per-route presets та enter/exit.
- [Next: Layouts and Pages](https://nextjs.org/docs/app/getting-started/layouts-and-pages) — persistence layouts.
- [Next: Route Groups](https://nextjs.org/docs/app/api-reference/file-conventions/route-groups) — різні root layouts дають full reload; Revyme group layouts за замовчуванням вкладені, не root.
- [Next: Link onNavigate](https://nextjs.org/docs/app/api-reference/components/link#onnavigate) — cancellable SPA hook, modifiers/external/download semantics.
- [Chrome: Same-document View Transitions](https://developer.chrome.com/docs/web-platform/view-transitions/same-document) — root snapshots, named header та flat pseudo-element composition.
- [MDN: view-transition-name](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/view-transition-name) — name uniqueness та поведінка none.

## Перевірка аналізу, виконана зараз

```sh
npx vitest run src/code/generation/page-transitions-gen.test.ts \
  src/code/generation/view-transition-css.test.ts \
  src/code/project/page-effects-config.test.ts \
  src/code/project/source-export.test.ts \
  src/code/project/cms-page-ops.test.ts \
  src/code/generation/reorder-glide-template.test.ts \
  src/code/oracle/page-transition-dialect.test.ts
```

Результат: **7 files passed / 96 tests passed**. Повний suite/build/typecheck не запускався, оскільки implementation не виконувалась. Browser probe використав installed `/usr/bin/google-chrome-stable` через Playwright; власний bundled Chromium у цьому оточенні відсутній.
