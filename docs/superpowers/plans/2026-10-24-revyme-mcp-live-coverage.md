# Revyme MCP v2 live coverage audit

## Goal

Exercise every operation exposed by the MCP v2 stdio server against a newly created,
isolated live test project. Reproduce and repair MCP defects using failing tests first,
document findings, and leave the test project available for inspection.

## Safety and environment

- Use a fresh stdio MCP child process for every test batch; do not depend on Codex's
  connected MCP process or restart Codex.
- Keep the existing Builder/Vite server process under this task's control and use the
  local API at `http://[::1]:3333` plus bridge `http://127.0.0.1:8082`.
- Do not touch the user's production/design project `proj-1792770801304-tbg5o9`.
- Use the user-supplied audit project `proj-1792848084609-kngi1j` for additive tests,
  preserving its pre-existing 11 files (including `plugins/DirectusSync.tsx`). Use the
  task-owned blank duplicate for any operation requiring destructive setup/teardown.
- Bootstrap a blank seed through the Builder's local project API, then create the
  retained audit project using MCP `projects.duplicate`; clean up only the exact seed.
- Never publish/deploy, spend money, upload to user storage, expose secrets, execute
  arbitrary authored code, or destructively mutate external systems. Use dry-run or
  record an explicit exclusion where a live side effect cannot be safely tested.
- Do not commit or reset the pre-existing dirty worktree.

## Execution plan

1. Inventory the live `tools/list` surface, pagination, schemas, and operation metadata.
   Reconcile the 275 exposed names with the source registry and existing tests.
2. Create and verify an isolated blank seed and MCP-duplicated test project on `main`.
   Keep the test project, remove only the exact temporary seed after the duplicate is
   verified.
3. Create a valid fixture through MCP calls (pages/nodes and the design/CMS state needed
   by downstream tools), recording every call, result, revision, and side effect.
4. Exercise every exposed tool by category. Read operations must be invoked with valid
   inputs; local mutations must be dry-run checked and, where safe, committed on the
   disposable project. Verify read-after-write and cleanup for each stateful sequence.
5. Mark externally destructive, credential-gated, unavailable-browser, or publish
   operations as safely excluded only after testing their schema/validation/dry-run path
   where applicable. Do not count excluded operations as live-success.
6. For each defect: capture the request/result and root cause; add a regression test and
   observe it fail; make the minimal fix; run the focused test, package tests, CLI build,
   then retest through a fresh standalone MCP process. Record the issue and evidence.
7. Re-run the final inventory and coverage report. Leave the audit project and report in
   place; summarize verified, failed, excluded, and untested operations separately.

## Coverage rules

- Every tool name returned by the live registry must end in one of these statuses:
  `PASS-LIVE`, `PASS-DRY-RUN`, `FAIL`, `BLOCKED-SAFETY`, or `NOT-TESTED`.
- A successful `tools/list` entry alone is not proof the operation works.
- A successful operation must have a valid response envelope and expected state effect
  (or an explicitly expected no-op), with no unexpected files, branches, or external
  side effects.
- A dry-run validates planning only and is never reported as a live mutation pass.

## Progress

- [x] Read repository guidance and applicable test/debugging workflows.
- [x] Confirm the independently managed local Builder and MCP bridge are listening.
- [x] Confirm live MCP `tools/list` currently exposes 275 tools.
- [ ] Capture exact operation inventory and per-tool baseline status.
- [x] Create isolated live audit project via MCP v2 and verify its `main` branch.
- [ ] Exercise every safely testable operation and document exclusions.
- [ ] Fix reproducible defects using TDD and retest through standalone MCP.
- [ ] Run final verification and publish the coverage report.

## Current environment snapshot

- Date: 2026-10-24 (Europe/Kyiv)
- Builder: `http://[::1]:3333`
- MCP bridge: `http://127.0.0.1:8082`
- MCP stdio tool count: 275
- User project excluded from testing: `proj-1792770801304-tbg5o9`
- User-supplied additive audit project: `proj-1792848084609-kngi1j` (`test all mcp`,
  11 pre-existing files; canvas root is empty)
- Task-owned blank MCP duplicate: `proj-mcp-v2-live-audit-20261024-01` (0 files)
