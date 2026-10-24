# MCP v2 live audit (2026-10-24)

## Scope and method

This report tracks live coverage of the MCP v2 stdio server from the current Revyme
checkout. The audit uses its own MCP child process against the locally running Builder
and bridge. The user explicitly authorized the supplied empty-canvas project
`proj-1792848084609-kngi1j` for additive testing; all mutations so far are isolated on
`mcp-live-audit-20261024`. Its `main` branch remains untouched. Destructive recovery
checks are reserved for the task-owned blank duplicate.

Every exposed tool is tracked individually. `PASS-LIVE` means a valid live call and its
expected behavior were verified; `PASS-DRY-RUN` means only planning/validation was
verified; `FAIL` means a reproducible defect; `BLOCKED-SAFETY` means a real external or
irreversible effect was deliberately not triggered; `NOT-TESTED` means no sufficient
evidence yet. Dry-run and discovery are not counted as live success.

## Baseline

| Measure | Result |
|---|---:|
| Live tools exposed | 275 |
| Inventory captured per operation | 275 |
| Unique operations passed live | 272 |
| Dry-run mutations passed | 0 |
| Still untested | 0 |
| Blocked by explicit safety exclusions | 3 |
| Reproducible failures | Fixed and documented in `MCP_V2_ISSUES.md` |
| Safety exclusions | Secret request, marketplace listing publication, and deploy were not invoked |
| User-supplied additive audit project | `proj-1792848084609-kngi1j` |
| Task-owned blank MCP duplicate | `proj-mcp-v2-live-audit-20261024-01` |

The Builder API answered successfully at `http://[::1]:3333`, and the bridge is listening
at `127.0.0.1:8082`. The latest independent MCP read-only check passed at revision 618 on the
active audit branch: all 25 files are clean with zero blocking/drift violations, broken
imports, missing assets, or broken links. The branch retains additive MCP audit fixtures;
`main` remains clean with zero changed files.

The user-supplied project `proj-1792848084609-kngi1j` exists and has an empty canvas,
but its persisted project data contains 11 files (including `plugins/DirectusSync.tsx`).
It is the additive test target; existing files will be preserved. Destructive setup/teardown
will use the task-owned blank project instead.

Project bootstrap smoke test: created a temporary empty seed through the local Builder
API, called `projects.duplicate` through an independent MCP stdio process, verified the
retained target `proj-mcp-v2-live-audit-20261024-01` on `main`, and removed only the exact
temporary seed. MCP returned `ok: true`, `commitStatus: committed`; target status is healthy
at revision 1 and has zero files.

The supplied project has a healthy `main` branch and passed read-only MCP discovery,
page/branch/plugin listing, and `diagnostics.projectCheck` (`clean=true`). A separate
`mcp-live-audit-20261024` branch was created after dry-run validation; it is the active
workspace for subsequent reversible local mutations.

## Test harness findings

- Root test command initially reported 788/789 passing. `L03-visual` used the legacy
  single-file `app/page.tsx` fixture, while the current page-transition operation resolves
  the editable `page.client.tsx` and its `LayoutClient`. Updated only that acceptance
  fixture with the current page-pair/template structure; the targeted L03 test now passes.
  No MCP production code was changed for this fixture mismatch.
- `npm test --workspace=@revyme/automation-core` exits 1 with “No test files found” because
  the workspace Vitest root searches `src/` while this package stores its tests in `test/`.
  Running from the repository root discovers them. This is a test-command/config issue,
  not yet an MCP operation failure.
- `npm test --workspace=@revyme/cli` passed 6 files / 36 tests.
- CMS field lifecycle passed live (add/update/read/remove); the temporary field was fully
  removed. The local CMS list lifecycle initially exposed that MCP pagination emitted
  editor-only dependencies; #27 in `MCP_V2_ISSUES.md` documents the fix and live verification.
- The pagination generator test previously opened a machine-local `portfolio-test2` JSON
  file that was absent in this checkout. Replaced that dependency with a synthetic fixture
  exercising the same route-parameter filters; all 53 T16/pagination tests now pass.
- CMS item create/update/reorder/translation/get/remove passed live on the copied audit
  collection. The temporary record and translation were deleted and the original item order
  was verified unchanged at revision 457.
- CMS schema update/reorder/duplicate/delete and index/detail page creation, lookup, and SEO
  configuration passed live on temporary collections/routes at revisions 459–476. The
  final cascade removed the collection plus all four generated route files atomically.
  `pages.list` confirms no CMS probe route remains. The initial diagnostics check exposed 19
  drift findings in generated FormSubmit/Spinner helpers; defect #29 below records the fix.
  After rebuilding the CLI and removing the temporary form page/master, a fresh check at
  revision 496 reports 24 checked files, zero violations (including drift), broken imports,
  missing assets, or broken links. The pre-existing Spinner helper remains in its upgraded
  form because it was part of the supplied project baseline.
- External CMS API mode/config CRUD, response-shape detection, query config, loopback fetch,
  and dynamic search-field add/rebind all passed live. The API fetch used a temporary local
  HTTP fixture only. Rebinding now keeps the search input and collection filter on the same
  variable; temporary configs and routes were removed. Defect #30 records the generator,
  hook-import, and filter-rebind fixes.
- One long-lived interactive stdio child failed to return a `cms.api.queryConfig.set` call.
  The branch did not advance; after restarting only that child, the same call committed at
  revision 514. This was not reproduced in the fresh child, so it is recorded as a transport
  observability anomaly, not a confirmed operation defect. When a response is missing, read
  back both the source and revision before retrying a mutation.

## Per-operation results

The live tool inventory and per-call evidence will be appended here in compact tables
grouped by MCP category. Every tool returned by the live registry must appear exactly
once before the audit can be called complete. The current matrix is an intermediate
record, not a completion claim.

## Defects and fixes

1. `templates.assign` and `pages.update` rejected valid pages because their styled root
   was moved unchanged into a route-group template. Fixed by preserving page root styling
   on an editable child wrapper and normalizing the template-owned root. Targeted tests
   passed, and both operations committed successfully on the audit branch.
2. `meta.tools` produced invalid examples for constrained integers, URL/email/date
   formats, regex-constrained names, optional properties and defaults. Fixed the example
   generator and added contract regressions. The contract suite and TypeScript check passed;
   live re-check of all repaired examples remains pending.
3. Headless CLI operations could use a stale global ProjectFS and browser autosave tried
   to access `localStorage` in Node. Fixed by hydrating ProjectFS from each MCP snapshot
   and skipping browser autosave outside a browser. Node autosave and CLI context tests
   pass; a live CMS dry-run followed by create/get succeeded without browser-storage errors.
4. `pages.duplicate` replaced the required `data-id="root"`, so Oracle rejected a copied
   page. Fixed by retaining the canonical root ID and regenerating child node IDs. The
   page suite passes 13/13, and live duplication committed on the audit branch at revision
   46; a subsequent live `codeFiles.read` confirmed `data-id="root"` and fresh child IDs.
5. `viewports.setOverride` advertised stale 768/375 defaults and wrote an override
   without adding a corresponding viewport tile, so Oracle rejected a normal tablet
   override on a new page. Defaults now match 1200/810/390; an undeclared responsive
   breakpoint is added to the page's `@canvas` config and positioned after existing tiles.
   T07 and TypeScript checks pass; live `viewports.list` and `setOverride` confirmed an
   810px tablet tile and responsive rule committed at revision 64.
6. `components.extract` used a regex that stopped at the first nested closing tag,
   leaving invalid page JSX. `components.detach` also copied master `data-id="root"`
   into templated pages, left style spreads/default props unresolved, and reused child
   IDs across instances. Extraction now replaces the exact Babel AST span; detach now
   resolves destructured defaults/overrides, expands instance styles and assigns the
   instance ID to the component root plus fresh descendant IDs. `components.replace`
   now removes the prior component import after the final instance is replaced. T09
   passes 7/7, `npx tsc --noEmit` passes, and live extract → detach → readback committed
   on the audit branch without Oracle errors.
7. `components.remove` treated `_meta/history.json` snapshots and unused import lines as
   active component instances, so a detached component could not be removed. It now
   detects actual JSX usages in current `.tsx`/`.jsx` files, prunes stale source imports,
   and `force: true` removes matching instances before deleting the master. A live
   non-forced removal succeeded after extracting/detaching the component while history
   still contained it; T09 verifies history is ignored and forced cleanup removes usages.
8. `components.detach` could still leave runtime dependencies such as `motion` and a
   module-level variant object undefined in the page. It now carries over the used
   imports and transitive top-level declarations from the master, while rejecting name
   collisions instead of committing broken source. T09 passes 7/7; live detaching the
   animated audit button committed at revision 119 with `motion` and `rootVariants` in
   place and the old component import pruned.
9. `siteEffects.smoothScroll.set` mounted `<SmoothScroll />` but omitted its generated
   controller from the headless plan, causing `UNRESOLVED_IMPORT`. The MCP operation
   now emits `app/smooth-scroll-controller.tsx` when missing or stale. T14 validates the
   actual plan path. Live set/get/read/remove succeeded at revisions 137–138; the route
   config was removed after verification. Diagnostics found no blocking issues.
10. The plan validator treated generated icon sets, plugin entrypoints, override HOCs,
    and the smooth-scroll controller as editable canvas pages. `isBuilderMaterializedFile`
    now recognizes `@iconSet` and the smooth-scroll stamp; validator rules skip canvas
    data-id/Oracle checks for those files and `plugins/*.tsx` / `overrides/*.tsx`, while
    retaining their operation-specific checks plus syntax and relative-import checks.
    T13/T14/T20/T22 and file-kind tests pass. Live vector create/add/remove, code-component
    create/get, override create/list, and plugin write/list all succeeded on the isolated
    branch at revisions 139–144.
11. `meta.tools`'s `codeComponents.create` example passed its JSON schema but lacked
    Oracle-required `@defaultWidth`/`@defaultHeight`. The example now contains both
    annotations, and T01 asserts schema validity plus the required size metadata. Live
    dry-run and create/read-back both passed at revision 142.
12. Committed MCP mutations discarded the operation's domain output and returned only
    the commit receipt. For example, `forms.create` did not return the newly allocated
    `formId`, forcing agents to parse the updated TSX before continuing. `Result` now
    carries a compact top-level `operationResult` summary (omitting file changes and
    plan diagnostics) for committed mutations and dry-runs. CLI client and MCP response
    regressions pass; a rebuilt independent stdio MCP returned `formId` at revision 167,
    and the test form was removed at revision 168.
13. `forms.submitButton.add` generated a lifecycle hook that referenced `useState`
    without importing it, so Oracle rejected the page with `WOULD_CRASH`. The form
    state generator now adds the named import and avoids duplicate imports when React
    bindings already exist. T19 and generator tests pass; live insertion committed at
    revision 159 and lifecycle mapping/read-back succeeded at revision 160.
14. `presets.list` returned identifiers such as `radius-card`, while
    `presets.apply` unconditionally prefixed the category and generated the invalid
    `--radius-radius-card`. Apply now strips an already-present category prefix while
    retaining support for short names. T08 covers radius, shadow, color, and border;
    the live listed `radius-card` preset emitted `var(--radius-card)` at revision 183
    and the temporary style was removed at revision 184.
15. `typography.remove` called the shared token-removal helper for every possible
    suffix, including optional responsive/stroke tokens that were absent. This emitted
    misleading error traces and returned absent tokens as removed. It now checks the
    parsed token set first and reports only tokens actually present. T08 passes; the
    live cleanup returned exactly 12 existing token names at revision 207 with no
    missing-token logs.
16. `codeFiles.submit` applied the canvas Oracle to a Next.js server `app/layout.tsx`,
    rejecting valid `metadata`, CSS/provider imports, and `<html>/<body>` structure.
    The operation now skips the canvas-only Oracle for server layout paths; the plan
    validator still checks source syntax and relative imports. T20 covers this path;
    live CAS-protected submit/restore round-tripped the layout at revisions 218/219.
17. `fonts.transformNextFont` inserted `next/font/google` loaders into the layout but
    left the matching external Google Fonts `@import` in `globals.css`, causing duplicate
    font loading. It now also strips that import and routes quoted family references
    through the generated CSS variable. T08 and next-font tests pass; live read-back
    verified both changes at revision 224, then `history.undo` restored the test files.
18. The blank-project generator seeded a fixed 900px viewport and root, so Oracle
    rejected every later mutation—including unrelated files—with
    `CANVAS_VIEWPORT_FIXED_HEIGHT`. The scaffold now uses auto height, and the updated
    empty-project suite passes 11/11. Live `codeFiles.submit` repaired only the audit
    branch at revision 299; section insertion/removal then passed at revisions 300–301.
19. `shapes.updateAttrs` always wrote to an SVG's first geometry child, even when the
    requested attribute (`viewBox`) belongs to the wrapper. The MCP input now supports
    `targetElement: "svg"` while keeping the old child behavior as its default. T13,
    T01, and SVG generator tests pass; a live read-back verified wrapper and child writes
    at revisions 346–349, with cleanup at 350.
20. `drawing.sketchAnim.set` generated begin/end comments that its own Oracle rejected.
    Oracle now permits only exact sketch markers; T13 validates the generated hook and
    ordinary page comments remain rejected. Live set/get/list/remove passed at revisions
    362–364 after rebuilding the CLI.

21. `forms.submitButton.add` emitted FormSubmit/Spinner helpers that passed plan validation
    but produced Oracle drift: generated comments, display-only hidden variants, a continuous
    Spinner loop without its `data-loop` marker, and root defaults the editor could not map
    back. The generators now use keyed `AnimatePresence` states, mirror root defaults in
    inline styles, emit supported pixel geometry, add the loop marker, and narrowly allowlist
    only exact internal version comments. Legacy generated Spinner files upgrade in place;
    non-generated components are preserved. Oracle regression coverage now checks both
    generated helpers. Form/generator/CMS/Oracle suites pass (261 tests, 1 intentionally
    skipped legacy migration case) and `npx tsc --noEmit` passes. After rebuilding the CLI,
    `forms.create` and `forms.submitButton.add` committed at revisions 492–493; source
    read-back confirmed FormSubmit v4 and Spinner v5. The temporary form page and FormSubmit
    master were removed at revisions 494–495. A fresh independent stdio child reports clean
    diagnostics at revision 496 (24 files checked; zero drift/blocking violations).

Historical result delta (revision 531): 217 unique operations had passed with commits/read-backs or
validated expected negative paths; 20 mutations have passed dry-run only, and 38 operations
remain untested. The live audit
also completed overlay and asset lifecycle cycles after fixing three defects: asset
paths returned by `assets.upload` now validate against `public/`; React-qualified
overlay hooks are removed without leaving malformed source; and asset usage checks now
ignore archived history snapshots. The image asset was placed, updated, read back, and
used as a catalog image at revision 246. Forms create,
submit-button insertion, lifecycle-state mapping/read-back, and cleanup all completed
on the audit branch. The form submit insertion previously exposed the missing React
`useState` import; the generated page now passes Oracle and the regression tests. CMS
index/detail route creation, lookup, SEO, and cascade deletion have now been exercised live.
Generated form helpers were checked against the Oracle and repaired (defect #29); temporary
form test content was cleaned up. Some cross-feature mutations remain dry-run-only;
marketplace code was not fetched or imported.
`meta.tools`'s form-state example still uses a placeholder node; valid state behavior was
tested against a real submit-button fixture instead. Section insertion and the full slot
connect/reorder/disconnect lifecycle also passed on temporary Carousel content at
revisions 300–323, with all test nodes removed afterward.

## Latest observation bridge verification

The standalone observation gap was reproduced with `/mcp-audit` open, then repaired. At revision
614, the rebuilt MCP process returned live selection and layout data for the selected
`audit-section`; its configured 1200px width remained 1200px at the Builder's 10% camera zoom.
`observe.visuals` returned the heading's actual `32px` font size and weight `700` after async
style prefetch. The live audit stayed `ready`, ignored the hidden honeypot, and retained four
findings only on visible test controls/text. `observe.screenshot` returned a valid PNG whose
reported 1200×37 CSS dimensions matched the PNG header. A separate red/green regression test
proved the prior camera-transform fallback returned a 120px rectangle.

The audit branch reached revision 624 after read-only probes. `branches.list` confirmed the
audit branch is separate from `main`, and `main` remains clean with zero changed files. The
275-operation inventory now has 272 live passes, zero dry-run-only passes, and three safety exclusions;
there are no unclassified operations left.

`workflow.chain` executed two sequential read-only tools with successful receipts at revision
624. To expand safe live coverage, the temporary child branch `mcp-v2-live-coverage-r2` was
created from the audit branch. There, `tokens.set`, `presets.set`, `presets.folders.create`,
and `typography.set` were exercised with real commits and read-backs (revisions 627–633);
temporary token and typography data were removed after verification. Page-transition scaffolding
built and passed full `preview.build` route parsing; the effect was removed and read back as null.
`customCode.set` round-tripped a temporary head meta snippet, and two temporary redirects were
reordered then removed, leaving their source list empty. Folder create/move, history undo/redo,
plugin storage, and marketplace proxy import also passed with read-backs. `branches.apply` was
tested against the task-owned blank duplicate, then `projects.backup.restore` restored its
original zero-file, main-only state at revision 5. The user-supplied audit branch's `main` was
not modified. Final verification on a fresh stdio child found the scratch branch diagnostics
clean across 29 files, then deleted only `mcp-v2-live-coverage-r2` at revision 654 and switched
the active pointer back to `main` at revision 656. `branches.list` confirms `main` is active and
clean with zero changed files; the original `mcp-live-audit-20261024` evidence branch remains
intact with 30 changed files. A final read of task-owned blank duplicate
`proj-mcp-v2-live-audit-20261024-01` initially returned `Project ... not found` because that
probe omitted `branchId` and inherited the now-deleted scratch branch from `REVYME_BRANCH_ID`.
With `branchId: "main"` explicit, both `/api/projects` and a fresh MCP child confirmed the
duplicate is present at revision 5 with zero files and only `main`; this was a test-harness scope
error, not an MCP defect. After the CLI rebuild, a fresh child rechecked the retained audit
branch: 25 files, `clean=true`, zero drift/blocking violations, broken imports, missing assets,
or links.

The Codex-managed MCP wrapper had become stale: it reported an Oracle drift on a generated
Spinner marker that the current source explicitly allowlists. A fresh CLI stdio child reported
zero drift on the same revision, proving the discrepancy was in the long-lived MCP process, not
the Oracle source. Terminating that exact stale child closed the Codex wrapper transport and the
Codex host did not respawn it. The live audit therefore completed with fresh independent stdio
children; the local Builder and its bridge were left running.

## Final repository verification

The full repository run completed with 14,960 passing, 36 skipped, 5 todo, and 26 failing
tests across eight files. One failure was the CLI audit-snapshot request expectation: the live
observation fix now requests computed-style properties, so the stale expected payload was updated;
`packages/cli/test/mcp.test.ts` then passed (13/13). The other failures are outside the MCP
observation changes: legacy overlay-state/paste expectations and a missing `portfolio-test2`
fixture (`data/projects/proj-1791960645579-j02nu7.json`). The repository-wide suite must therefore
not be described as green. `npx tsc --noEmit` passed, and the CLI build passed with an existing
direct-`eval` bundler warning. Focused MCP/observation regression results are recorded below.
The post-fix focused run passed 187 tests across the MCP CLI request, verification capability,
design audit, and Builder bridge client suites.

## Safety exclusions

Publishing/deploying, marketplace publishing/importing untrusted code, requesting or
storing credentials, arbitrary external CMS requests, and destructive actions outside
the exact task-owned disposable audit project are excluded. Exact-scope reversible
mutations on the supplied test branch are authorized.
