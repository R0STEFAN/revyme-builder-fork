# Revyme MCP v2: повне покриття створення сайтів

Дата: 21 жовтня 2026. Ціль змінена користувачем: завершений MCP охоплює всі наявні можливості створення та супроводу сайту в Revyme; вузький page/card MVP є лише внутрішнім checkpoint і не є завершенням роботи.

Уточнення користувача: production-проєктів немає. Старий зовнішній MCP прибирається після фіксації baseline на початку реалізації, без його ремонту та compatibility/cutover modes. Browser transport внутрішнього агента та інші shared modules зберігаються за actual dependencies. До готовності нового зовнішній MCP може бути недоступний.

## Джерела та межі доказів

Статична інвентаризація поточного working tree дала **172 унікальні зареєстровані agent tools, 175 типів Mutation, 114 SDK method declarations, 33 public MCP tools та 14 іменованих bridge methods** з їхніми action values. Це різні поверхні з перетинами, їхня сума не є кількістю незалежних features. Runtime correctness цих операцій цією інвентаризацією не доведена.

- Реєстр: `src/ai/agent/tools/index.ts`; scopes/schemas відстежено AST без запуску editor.
- Mutations: `src/code/mutation/mutation-queue.ts`, union `Mutation`.
- Додаткові API: `src/plugins/sdk-impl/*.ts`, `src/ai/mcp/bridge-client.ts`.
- UI: `src/editor/tools/`, `src/editor/left-toolbar/panels/`, `src/editor/header/`, code/project configs.
- Повторюваний inventory: `../research/2026-10-21-build-capability-inventory.cjs`.
- Поіменний machine-readable baseline: `../research/2026-10-21-revyme-capability-inventory.json`. Кожний tool і mutation має owner task T01–T25 та acceptance ID; усі statuses зараз `planned`.

UI-only можливості додано матрицею нижче. Перша implementation task перевіряє фактичні поля/enum/режими кожного control та розкладає їх на leaf capabilities; один пройдений tool не дорівнює покриттю всіх його action/enum branches. Автоматичний inventory доповнюється UI/API рев'ю, а не підміняє його.

## Визначення готовності

Готовий MCP дозволяє агенту створювати, перевіряти, редагувати, експортувати і, за явною командою та доступним deployment adapter, публікувати повний landing page з усіма підтримуваними Revyme конструкціями. Потім користувач продовжує роботу в GUI без повторного створення структури.

Покриття визначається **можливостями поточного Revyme**, а не обіцянкою довільного React/npm application. Нову відсутню feature не треба винаходити для оголошення parity. Наявна authoring feature не виключається лише тому, що її старий agent tool не мав.

Headless authoring обов'язковий: files, components, CMS, animation/config та інші source mutations не залежать від відкритої вкладки. Вимірювання, preview і GUI-only plugin UI виконуються через окремі adapters, явно позначені в discovery. Credentials, browser/GPU або remote service readiness повідомляються як prerequisites; `unavailable` не зараховується як виконана операція.

## Матриця покриття

Усі рядки нижче — обов'язковий обсяг реалізації, за винятком явно позначених retired/поза authoring scope можливостей у наступному розділі. Тестові IDs C01–C37 розгортаються у leaf cases у T01. Власники Txx відповідають основному плану.

| ID | Можливості та необхідні дії | Наявна основа | Owner | Доказ приймання |
|---|---|---|---|---|
| C01 | Discovery, focused schemas/examples, context, permissions, workflow plan/batch/chain, progress/cancel | tool-manifest, registry, bridge-tools, batch/chain | T01,T03,T05 | Клієнт знаходить потрібну schema, виправляє input одним targeted issue, не отримує false success |
| C02 | File list/read/search/create/edit/rename/delete, diff, guarded multi-file submit | whole-file, bridge-client, sdk code-files, file-kind/gate | T20,T21 | Protected paths/closed-source policy збережені; changes валідні й persisted |
| C03 | Project list/create/open/rename/duplicate/delete/import backup, project settings | server/storage, api-plugin, backend/types, SelfHostDashboard | T21 | Lifecycle не губить source/assets/branches; delete має явну authorization policy |
| C04 | Pages CRUD/duplicate/homepage/slugs/folders, page activation/context | active-file-store, pages-more, page-folders | T06 | Routes працюють після reload і в export; нема remap у випадкову active page |
| C05 | Templates/shared layouts, assign/unassign, children slots, folders | template-ops, template-route-gen, providers-gen | T06 | Header/footer shared, content slot рівно один, перехід шаблону не втрачає контент |
| C06 | Site/page metadata, SEO/social/favicon, canonical config, CMS SEO/dynamic routes | metadata-gen, pages-more, cms-seo | T06,T16,T23 | Metadata і dynamic route params перевірені у build/output |
| C07 | Nodes CRUD/move/reorder/duplicate/wrap/unfold, cross-page copy/paste з dependencies, free canvas, grouping, child order | generator-crud, layout-more, canvas-config, paste-engine | T07 | Structure свіжого parser збігається з intent; GUI Layers/reorder працюють; paste зберігає effects/bindings і remap IDs |
| C08 | Breakpoint CRUD/widths, style/text/attr/prop overrides, order, reset | breakpoint-ladder*, responsive-*-gen, viewports | T07,T09,T15 | Нестандартні widths і primary breakpoint, inheritance та reset round-trip |
| C09 | Flex/grid/size/position/pins/hug/fit, all Style controls: fill/gradient/border/radius/shadow/filter/mask/clip/transform/3D/pseudo/visibility/pointer/overflow | generator-styles, StylesTool, PositionTool, SizeTool, LayoutTool | T07 | Кожна leaf property/state має set/read/remove test; effect не губиться при GUI edit |
| C10 | Text/rich text/inline marks, typography/fit/stroke/font/link, responsive text | semantic-property, TextStyleTool, fit-text-gen, text-override-gen | T07,T08 | Rich text/links/marks та різний текст на breakpoint переживають save/export |
| C11 | Tokens/presets: create/update/remove/rename/references/folders; dark theme; typography/borders/assets; Google/local/workspace/variable fonts | preset-ops, preset-gen, next-font-gen, library presets, backend fonts | T08 | References коректні; fonts packaged/loaded; theme без destroyed overrides |
| C12 | Design components create/extract/edit/replace/detach, props/defaults/types/labels/options/ranges, instances | create-component-gen, component-ops, controls/parser | T09 | Inspector читає props; internals editable; master+instances консистентні |
| C13 | Component variables: text/formatted/link/color/style/image/cursor/transition/typed variables, hoist, rename/delete/cascade, responsive props | variable-ops, component spec, Mutation variants | T09,T15 | Кожний supported variable type і dependency cleanup проходить GUI/source round-trip |
| C14 | Variants CRUD/visibility/position/size/overrides; states/connections/event parameters/delays | variant-ops, variant-config, components-more, instance-event-gen | T10 | Desktop/mobile та click/hover transitions працюють; dangling reference не commits |
| C15 | Overlays/menu/modal/drawer/tooltip, triggers/position/close/delay, form-state mappings | overlay-gen, close-overlay-gen, InteractionsTool | T10,T19 | Open/close/keyboard/focus/scroll behavior і GUI controls перевірені |
| C16 | Links: route/section/URL/params/slug/target/rel/prefetch/smooth anchor, CMS nav | links, LinkTool, generator-attrs, cms nav | T10,T16 | Коректні href/rel, anchor і routing без клієнтських navigation errors |
| C17 | Увесь current built-in catalog, section blueprints, install/place/configure, slot connect/disconnect/reorder | project-fs built-in registry, sections-library, slot-ops | T11 | Catalog-driven coverage; усі required parts/slots і runtime imports працюють |
| C18 | Assets search/upload/import/replace/delete/reference audit, image optimization/alt, fills, video/audio/background video, supported embeds/3D controls | assets/media panel, Image/Video/Audio tools, generator-video, backend asset APIs | T12 | Реальні bytes packaged/loaded; references і permissions перевірені; no broken placeholders |
| C19 | Icons/vector sets/SVG shapes/path edits/attributes/viewBox/fills/masks, active drawing/sketch animation | icons, svg mutations, Sketch/Path tools, sketch-anim-gen | T13 | Vector edits лишаються selectable; draw animation/runtime verified; retired sketch sets не відновлюються |
| C20 | Motion hover/tap/appear/loop/scroll transforms/speed/direction/variants, instance FX, text effects, keyframes/transitions | generator-motion*, text-anim-gen, AnimationTool, keyframe-ops | T14 | Catalog/parameter coverage з read/update/remove, runtime і responsive/reduced-motion checks |
| C21 | Smooth scroll, page transitions, custom cursor, Glide, page effect masks/presets | smooth-scroll*, page-transitions-gen, cursor-gen, glide-gen | T14 | Shared layout wiring та publish runtime present; no overlay/frame drift |
| C22 | Page variables/defaults/scopes, fx expressions for text/style/src/href/props, responsive bindings, interactions | page-variables-gen, expression-gen, responsive vars, page-interactions-gen | T15 | Type/scope/read-write intent і dependency cleanup validated |
| C23 | CMS collections/fields/items CRUD/order/duplicate/translations, lists/bind/unbind/props/styles/filters/sort/limit/pagination, detail/index pages/slugs | cms-ops, cms-gen, cms-page-ops, cms-more | T16 | Schema→list→detail→item edit→reload→export; no orphan imports/bindings |
| C24 | CMS external API mode, collection URL/method/headers/itemsKey, query expressions/search/page params, server fetch/revalidation/image config | cms-api-config, bridge manageCms, cms-page-ops | T17 | Fixture API pagination/filter/search/error/reload працює; credentials не витікають |
| C25 | Locales/default/fallback/RTL/routes, texts/attrs/props/SEO/CMS translations, switcher | locale-ops, translation-ops, i18n/locale-gen, locale-route-ops | T18 | Два locales + fallback + RTL; translated form/CMS/navigation працюють |
| C26 | Forms supported field types/select options/defaults/validation/labels, destinations, submit, honeypot, loading/success/error states | form-fields/gen/submit/state, Input/Form tools | T19 | Форма реально надсилає fixture endpoint, states/error recovery і accessible labels verified |
| C27 | Code components @controls, custom code overrides, full-file edits, global head/body code, redirects | code-component-runtime/controls-parser, code-override-gen, sdk custom-code/redirects | T20 | Compile/control defaults/export; redirect order/global injection; native/code classification explicit |
| C28 | Component/template/vector/plugin/preset/page folders, library ordering/sharing/usage | *-folder-ops, LibraryPanel, sdk presets | T21,T22 | Move/rename/delete не ламає imports, IDs і published URLs |
| C29 | Branch CRUD/diff/review/apply/merge/conflict, history/undo/redo/checkpoints/backups/restore | branches tools, project-fs v2, mutation/history, backend versions | T21 | MAIN/export truth збережено; apply/restore — нова revision; conflicts не clobber |
| C30 | Comments/replies/anchors, ruler guides, selection/viewport observer, collaboration-aware sync/roles | comments-config, ruler-guides-config, collab, canvas bridge | T21,T24 | Comments/config persisted; stale UI save refused; observations exact project/branch/revision |
| C31 | Plugins create/edit/install/launch/permissions/pluginData, supported SDK method semantics, subscription/event lifecycle | plugins, plugin-editor, sdk-impl | T22 | Реальний fixture plugin у sandbox, RPC contract і scoped permissions; UI calls browser adapter |
| C32 | Marketplace browse/import/update/link/share/publish listing, reusable assets/components | marketplace-client, bridge publishListing/insertMarketplaceComponent, library share | T22 | Versioned remote dependencies/import/export; publish only on explicit request |
| C33 | External providers/access: workspace fonts/media search/upload, role/closed-source policy, plugin secrets/network | backend/types, sdk secrets/network/permissions, service adapters | T12,T22 | Real configured-adapter acceptance для заявленого profile, fail-closed on missing access |
| C34 | Export current supported formats/source/SSG, asset bundling, remote imports, runtime range/build/preview | source-export, export-project, local-server | T23 | Ізольований exported project builds/serves без editor; unsupported format позначений |
| C35 | Publish/update/staging/backups/domain/subdomain/status на наявному service contract | RightHeader/LiveDropdown, WebsiteMeta, cloud API references | T23 | Explicit action publishes selected revision; status/live snapshot/domain result verified |
| C36 | Source/static/GUI/build/render verification, screenshots/layout/computed styles/audit/trace/effect verdict | read/audit/screenshot/verify-effect, debug-trace, publish-preflight | T24 | Evidence revision matched; unavailable не clean; diagnostics відтворювані |
| C37 | Повний landing workflow, atomic sections/recipes, focused guides, repair loop, CLI/MCP parity та launch readiness | новий registry/workflow поверх усіх domains | T25 | Наскрізний landing suite та coverage report без невизначених authoring gaps |

## Що не слід помилково оголошувати активними можливостями

1. `src/plugins/sdk-impl/sketches.ts` прямо каже, що **sketch sets видалені**. Active path/sketch drawing та animation у C19 зберігаються; retired SDK compatibility не стає новою product feature.
2. `animations.listGsap` збережено як compatibility stub; GSAP видалений із продукту. Покриваємо supported motion/keyframes, не відновлюємо retired engine.
3. Export `tailwind` у `src/editor/header/export-project.ts` має service-side 501/coming-soon path. Discovery не обіцяє цей формат без фактично готового server adapter і build test.
4. SDK `ui.*` містить editor UI/no-op compatibility. Це browser/plugin lifecycle surface, не headless site-authoring capability; повний MCP надає коректний статус/adapter замість удаваного screenshot success.
5. Billing/payment/admin provisioning та AI model/provider implementation не є authoring operations цього плану. Наявні role, credits/plan readiness reads можуть бути доступні як diagnostics; їх не можна використовувати для обходу service permissions.
6. Mouse drag/pan/zoom — UI gestures. Source-equivalent move/resize/reorder обов'язкові; live selection/zoom за потреби виконується observer/UI adapter. Не емулювати drag як умову source write.

## Authoring contract

Агент має три підтримувані способи: typed semantic operations, static JSX fragment із mechanical normalization та explicit code component/full-file editing. Усі сходяться в одному планувальнику та commit service.

- IDs/imports/known shorthand/component boilerplate генерує білдер.
- `rem/em` зберігаються там, де controls підтримують їх. У px-only областях lowering має explicit unit policy, source location та report; не припускати 16px для будь-якого root/font.
- List recipe зберігає roles, marker content і reading order; unknown CSS/expressions не виконуються й не виправляються здогадкою.
- Component kind не змінюється потай. `@controls` — реальна schema з defaults, не спосіб обійти Oracle.
- Недоступні для GUI ділянки code component явно описані; підтримувані props і slots залишаються editable.
- Oracle gate перевіряє canonical bytes, imports/references, runtime compatibility та declared postconditions. Legacy diagnostics не приховують нових порушень.

## Обов'язкові acceptance-сайти

**L01 — повний маркетинговий landing:** tokens/fonts/theme; shared Navbar з desktop links і mobile drawer; hero з image/video та CTA; logo marquee; features grid із reusable cards; metrics; pricing variants; testimonials carousel зі slots; FAQ accordion; contact form з destination/states; footer/links; metadata/social/favicon; desktop/tablet/mobile.

**L02 — динамічний двомовний landing:** L01 плюс local CMS case studies, detail routes, external API listing/search/pagination, locale switcher/RTL/fallback, localized props/attrs/CMS/SEO, page variables і bindings.

**L03 — visual/runtime coverage:** representative current built-ins, vectors/path drawing, code component controls, overrides, custom cursor, smooth scroll, page transitions, text/scroll effects та overlays. Каталог тестується параметризовано; не треба вставляти всі ефекти одночасно у L01.

**L04 — lifecycle:** duplicate/import/export, branch edits/apply/conflict, history/restore, stale editor save, failure/retry/cancel, readonly viewer, optional configured plugin/marketplace/cloud publish flows.

Кожен acceptance містить source/static check, GUI read-edit-save-reload, build/export, interaction tests та rendered evidence на трьох widths з exact revision. L01 мусить бути якісно організованим landing page, а не демонстрацією всіх controls в одній колонці. Visual quality оцінюється окремо від валідності коду.

## Release gates

- 100% active authoring leaf capabilities мають implemented canonical operation або documented semantic equivalent, contract test, source round trip і відповідний GUI/runtime test.
- Кожен із 172 baseline tools та 175 mutation types має mapping або явне обґрунтування internal/retired/UI-only; rename/merge операцій дозволений, silent drop заборонений.
- Internal healer mutations покриваються invariant tests; їх не треба рекламувати як окремі public tools.
- Усі C01–C37 мають completion evidence; позначка `unsupported` для активної authoring feature не закриває coverage.
- Local та cloud adapters мають окремий evidence profile. Local completion не доводить cloud publish/marketplace/credentials readiness. Cloud parity не оголошується завершеним до integration acceptance у configured test environment; mock response недостатній.
- Old external MCP видаляється в T02 після inventory/shared-caller перевірки; full coverage gate визначає готовність нового, не час видалення старого. Compatibility modes/old writer fallback не додаються. In-app agent/observer dependencies і test/demo project data зберігаються.
- Код продукту в цьому дослідницькому завданні не реалізується; результат — spec, інвентаризація та повний implementation plan.
