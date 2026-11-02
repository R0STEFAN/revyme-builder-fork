# Framer Native → Revyme — source reader 0.1.4

Це перша діагностична частина нового імпортера. Вона захоплює оригінальну модель
редактора; конвертація й вставка в Revyme ще не підключені.

## Збирання

З кореня репозиторію:

```sh
node scripts/build-framer-native-extension.mjs /absolute/path/framer-native-reader
node --test extensions/framer-native/test/*.test.mjs
npx vitest run src/shared/framer-transfer-envelope.test.ts
```

## Встановлення і перший доказ

1. У Chrome відкрий сторінку керування розширеннями та увімкни Developer mode.
2. Обери Load unpacked і вкажи зібрану директорію з `manifest.json`.
3. Відкрий свій Framer project у цьому Chrome та онови вкладку після встановлення.
4. Відкрий потрібну сторінку або визначення компонента.
5. У popup нового розширення обери потрібний scope і натисни «Захопити дерево».
6. Збережи JSON. Перевірка повноти та перелік діагностик містяться в самому файлі.

Браузер надає доступ тільки поточній вкладці через activeTab. Reader читає вже
завантажений engine редактора і може штатно завантажувати інші source scopes.
Він не змінює шари, не публікує сайт і не читає cookies, токени або історію браузера.
Captured definitions включають повні declarations проєкту; `rootIds` окремо
визначає обрані render roots для майбутнього конвертера.

Версія 0.1.1 також читає оригінальні `codeFile` через accessor `files.source`,
зберігає точний module/save pointer і додає нативні URL ресурсів через helper
редактора. Незбережений код або недоступний оригінал робить capture неповним;
скомпільований `moduleContent` не використовується як заміна.

Версія 0.1.2 додає читання оригінальних сторонніх code components через той
самий `files.source` accessor з точним module/save pointer. Для page/component
scope сторонні source files читаються за залежностями обраного дерева;
недоступне стороннє джерело дає `SOURCE_CODE_UNAVAILABLE`. Цей шлях має
автоматичні тести; живий capture зовнішнього коду ще не підтверджений.

Версія 0.1.3 уточнює `EDITOR_BUILD_UNSUPPORTED`: повідомлення містить фактичні
editor entry URLs із document scripts та окремо спостережені resource entries.
Query/hash, сторонні script URLs і вміст проєкту в цю діагностику не потрапляють.
Resource entries використовуються лише для діагностики, без автоматичного вибору
адаптера. Нову збірку редактора треба окремо перевірити; обмеження не вимкнено.

Версія 0.1.4 додає адаптер для `web.D5JMWQLK.mjs`: singleton та оригінальний
source accessor перевірені за модулями цієї збірки. Native URL для SVG отримується
через helper редактора, а растрові файли зберігають оригінальний file URL.
Повний live capture цієї версії ще потребує перевірки.

Перший adapter прив'язаний до спостереженого editor entrypoint
`https://app.framerstatic.com/web.D7IYYINP.mjs` і source tree version 128.
Невідома версія завершується явною помилкою. Дерево версії 0.1.0 перевірене
на живому проєкті й незалежному native clipboard. Live capture 0.1.1 також
підтвердив оригінальний Overrides.tsx та URL всіх 526 asset descriptors.
Доступність самих ресурсів і повна конвертація перевіряються окремо.

У поточній діагностичній версії JSON не містить згенерованого Revyme-коду.
Не вставляй його через старий Framer import handler.
