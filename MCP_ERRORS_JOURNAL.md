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
- **Коміт:** див. git log — `fix(automation-core): reject cross-project steps in workflow.batch`
