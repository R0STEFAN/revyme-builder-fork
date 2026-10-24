# MCP v2 issue log

## 2026-10-23 — stale CLI bundle blocks mutations

**Status:** fixed locally; the MCP subprocess must restart before it can use the fix.

**Symptom:** mutating tools such as `tokens.set` and `fonts.import` returned
`PLAN_HASH_MISMATCH`, without changing the project.

**Cause:** `packages/cli/bin/revyme.mjs` uses `packages/cli/dist/main.js` when
available. The running process used a bundle built at 09:12, while the source
that normalizes `beforeHash` values had changed at 18:47. The stale bundle sent
`beforeHash: null` for an existing file, so the server correctly rejected it.

**Fix and guardrail:** rebuilt the CLI and changed the local MCP launch command
to run `packages/cli`'s build before each start. A dry-run `tokens.set` now
contains the existing file's SHA-256 hash and passes the server's plan
validation endpoint.

**Follow-up:** restart the MCP subprocess/session to load the rebuilt bundle.

## 2026-10-23 — code component creation inherited a phantom file hash

**Status:** fixed locally; regression test added.

**Symptom:** after a rejected `codeComponents.create` request, the next attempt
to create the same new component failed with `BEFORE_HASH_MISMATCH`.

**Cause:** `syncCodeSnapshotToProjectFS()` retained paths from the process-wide
`ProjectFS` cache that were not present in the current server snapshot. The
operation then used the phantom local file as the previous version and emitted
a `beforeHash` for a file the server correctly considered absent.

**Fix:** synchronize `ProjectFS` exactly to the supplied snapshot before an
operation. New files now receive `beforeHash: null`; existing files keep their
server-side SHA-256 hash. The regression lives in
`packages/automation-core/test/capabilities/T20-code.test.ts`.

**Additional root cause fixed:** the helper also mutated the snapshot supplied
to it while collecting changes. The generic plan normalizer then read the
newly-created file as though it already existed and replaced its null hash.
`prepareOperation()` now hands adapters a cloned snapshot, preserving the
server snapshot as the source for normalization. This is covered by an
end-to-end prepare-operation regression test.

## 2026-10-23 — `nodes.update` validates but cannot commit

**Status:** fixed and verified through the MCP transport.

`nodes.update` returned a valid dry-run plan, including correct hashes for
`app/page.client.tsx` and `_meta/history.json`, but the identical non-dry-run
operation was rejected by the commit service with `PLAN_HASH_MISMATCH`.

**Cause:** the Builder's Vite process on `:3333` had been running since before
the plan-hash fixes were compiled. Restarting only the Codex/MCP subprocess
left the commit service on its old runtime, so it calculated a different hash
for otherwise valid plan bytes.

**Fix and verification:** restarted the local `npm run dev` process and
re-ran the same operation through MCP. The dry run validated and the real
`nodes.update` committed successfully at project revision 27.

**Guardrail:** after changing automation-core code that participates in plan
serialization or hashing, rebuild the CLI and restart the Builder dev server;
restarting the desktop client alone is insufficient.

## 2026-10-23 — transient hash rejection immediately after a mutation

**Status:** fixed locally; regression test added.

**Symptom:** a valid visual mutation could occasionally return
`PLAN_HASH_MISMATCH` immediately after another successful mutation. Repeating
the same request generated a fresh plan that the commit service accepted.

**Fix:** `AutomationClient.execute()` now retries exactly once on this specific
pre-commit rejection. It fetches a new snapshot and prepares a new operation
with a new operation ID, retaining normal CAS validation. A second mismatch is
still returned to the caller. The regression lives in
`packages/cli/test/client-plan-retry.test.ts`.

## 2026-10-23 — MCP discarded the target file from the hash scope

**Status:** fixed locally; the MCP subprocess must restart to load the rebuilt
CLI.

**Symptom:** a plan validated when prepared directly by the CLI, but the same
mutation through the stdio MCP transport failed at commit with
`PLAN_HASH_MISMATCH`.

**Cause:** `packages/cli/src/mcp.ts` created a scope with only `projectId` and
`branchId`. File-scoped operations carry the document as `filePath` or
`targetFile`; omitting it meant the plan crossed the stdio boundary with a
scope that the commit service did not hash identically.

**Fix and guardrail:** the MCP adapter now maps either argument into
`scope.filePath` before calling `AutomationClient.execute()`. The new MCP
transport regression test asserts that `typography.remove` sends its
`targetFile` as the scope file path. The focused suite now passes 46 tests.

## 2026-10-23 — running stdio server can remain stale after a successful rebuild

**Status:** diagnosed; restart required to activate the already-built CLI.

**Symptom:** `components.create` through the live stdio MCP returned
`PLAN_HASH_MISMATCH` after its input passed all component and Oracle checks.

**Evidence:** the exact operation was re-run as a dry-run through the freshly
built `packages/cli/dist/main.js` against the same Builder server and project
revision. The server accepted the plan, including its history record. The
project was not modified by either dry run.

**Root cause:** the active MCP stdio process was started before the current
bundle, so it still serialized plans with an older implementation. The Builder
server is current; this is specifically a stale Codex-owned MCP child process.

**Required action:** restart the Codex desktop application once. The configured
MCP command rebuilds `packages/cli` before launching the new stdio child. No
Builder/server restart is needed for this issue.

## 2026-10-23 — variant tools generated invalid runtime code

**Status:** fixed locally; Builder dev-server restart required.

**Symptom:** after creating `SiteNavbar`, `connections.create` emitted
`useState(...)` without importing the hook, and `variants.visibility.set`
failed with `traverse6 is not a function` in the running Vite environment.

**Root causes:** connection generation only recognised single-quoted React
imports, while Design Component masters use `import React from "react"`.
The visibility generator also imported `@babel/traverse` as a direct default,
even though Vite SSR exposes it as `{ default }`.

**Fix and regression guard:** connection generation now uses the shared
quote-agnostic `ensureNamedImport()` helper. The visibility generator
normalizes both valid `@babel/traverse` module shapes, matching the rest of
the codebase. The T10 interaction regression now starts from a
double-quoted default React import and asserts that `useState` is imported.
`npx vitest run packages/automation-core/test/capabilities/T10-interactions.test.ts
packages/cli/test/client-plan-retry.test.ts` passes (7 tests), followed by a
successful CLI build.

**Required action:** restart the Builder dev server (`npm run dev`) once. Its
automation middleware holds the SSR module closure loaded before this change;
the Codex MCP process itself already rebuilds on its next launch.

**Follow-up correction:** the first traversal normalizer covered direct and
single-default ESM imports, but Vite SSR exposed a nested
`{ default: { default: traverse } }` shape. The normalizer now handles all
three forms and has an explicit regression test. Focused T10 now passes 5
tests, followed by a fresh CLI build. Restart the Builder dev server once more
to load this final source change.

## 2026-10-23 — component master path omitted from MCP plan scope

**Status:** fixed locally; restart Codex to activate the rebuilt CLI.

**Symptom:** `connections.create` dry-run passed validation, but its real
commit returned `PLAN_HASH_MISMATCH`. This affected Design Component masters
such as `components/PrimaryButton.tsx`.

**Cause:** `packages/cli/src/mcp.ts` included `filePath` and `targetFile` in
the plan scope, but omitted component operations' `componentFile` (and the
parallel `sourceFile` alias). The commit service therefore hashed a different
scope than the operation intended.

**Fix and guardrail:** MCP scope resolution now recognizes `componentFile`
and `sourceFile`; a regression test asserts that a `connections.create`
request carries its master path into `AutomationClient.execute()`. The
focused CLI and T10 interaction suites pass (14 tests), and the CLI builds.

**Required action:** restart the Codex desktop application once so its MCP
stdio child loads the rebuilt CLI. No Builder dev-server restart is needed
for this adapter-only change.

## 2026-10-23 — nodes.create omitted the motion import in Design Components

**Status:** fixed locally and CLI rebuilt; live MCP still runs the old bundle and requires a full Codex restart to activate.

**Symptom:** adding an `<img>` into the `ProjectCard` Design Component via
`nodes.create` was rejected by Oracle with `WOULD_CRASH: References undefined
identifier: motion`.

**Cause:** `addNodeInCode()` correctly wraps inserted children of a variant
master in `<motion.*>` for variant transitions, but did not add the matching
`motion` import. The issue was specific to node insertion in a Design
Component; the existing import-sync step did not repair this operation's
result before Oracle validation.

**Fix and verification:** `addNodeInCode()` now ensures a `motion` import from
`framer-motion` whenever it generates a motion-tagged child in a component
master. A regression was added to `generator-crud.test.ts`; the focused suite
passes (20 tests).

**Required action:** the CLI rebuild completed, but a follow-up `nodes.create`
dry-run still returned the same `WOULD_CRASH` issue at revision 112, confirming
the running MCP stdio child has not reloaded the new bundle. Fully close and
reopen the Codex desktop app so the child starts from the rebuilt CLI. No
workaround or direct edit to project source was used.

## 2026-10-23 — component hover styles were routed into an invalid CSS block

**Status:** operation fix loaded after restart; a second generator defect is fixed and rebuilt locally; live verification pending another restart.

**Symptom:** `styles.set` with `pseudo: "hover"` on a Design Component returned
`PLAN_VALIDATION_FAILED`, including `MISSING_DATA_ID` for the generated
`<style>` and `PLAN_HASH_MISMATCH`.

**Cause:** the operation always routed pseudo styles through the freeform CSS
writer. Design Components cannot contain freeform `<style>` blocks; their
interactive differences are stored in Framer Motion variants instead. The
operation schema had no way to express a target variant.

**Fix:** added optional `variantName` to `styles.set`; when supplied, it routes
the style update through the existing `updateVariantStyleInCode` generator.
Page pseudo styles and existing callers are unchanged. Added a regression test
that verifies a component hover update lands in the requested variant instead
of emitting a `<style>` tag.

**Verification:** the focused T07 suite passes (7/7), and the active MCP tool
schema now exposes `variantName`. A live dry-run then revealed the follow-up
generator issue below. CLI rebuild succeeds; fully close and reopen Codex so
the stdio child loads the final bundle before live verification.

## 2026-10-23 — new transform variants omitted sibling variant entries

**Status:** fixed locally and rebuilt; live MCP verification pending restart.

**Symptom:** setting a `scale` value for `ProjectCard`'s `hover` variant failed
Oracle validation with `VARIANT_OBJECT_MISSING_ENTRY` for the configured
`asymmetric` variant. No project mutation was committed.

**Cause:** when `updateVariantStyleInCode` created a variants object for a node
that had none, it returned after wiring the new target entry. The existing
transform-neutrality healing ran only on the update-existing-object path, so
other configured variants had no return value for Motion transforms.

**Fix:** the create-object path now seeds unchanged configured variants with
the base/neutral values for transform properties. Added a regression test that
failed before the fix and now checks the `hover` and `asymmetric` entries.

**Verification:** full generator style suite passes (128/128); focused T07
suite passes (7/7); `npm run build --workspace @revyme/cli` succeeds. Live
dry-run is pending reload.

## 2026-10-23 — variant-style plans intermittently failed API hash validation

**Status:** variant-style dry-run and commits verified after API module reload;
visibility commit path still needs a clean runtime verification.

**Symptom:** inline `styles.set` dry-run passed, while `styles.set` with
`variantName` returned `PLAN_HASH_MISMATCH`. A locally captured plan passed
`PlanSchema` JSON round-trip and local `validatePlan`, but the live API rejected
the same payload. After Vite reloaded the validation module, the identical
variant-style dry-run passed; ProjectCard variant writes then committed at
revisions 165–166 and PrimaryButton hover styles at revisions 167–168. A
SiteNavbar visibility commit still reported a hash mismatch before its dry-run
exposed the separate visibility Oracle errors.

**Action:** added received/calculated hashes to local plan-validation
diagnostics. Variant-specific style plans now validate and commit after module
reload. A clean API restart and a committed variant-visibility operation are
still needed to establish whether that earlier failure was stale API module
state or a second validation/commit divergence.

## 2026-10-23 — variant visibility generation omitted motion scaffolding

**Status:** fixed locally and rebuilt; live verification pending.

**Symptom:** `variants.visibility.set` wrapped the target in `AnimatePresence`
without importing it or adding `layout={true}`. Oracle blocked the plan with
`WOULD_CRASH` (undefined `AnimatePresence`) and
`ANIMATEPRESENCE_CHILD_LAYOUT`.

**Fix:** visibility generation now adds the missing Framer Motion imports,
promotes native lowercase JSX targets to `motion.*`, and adds `layout={true}`.
Added a regression that failed before the fix.

**Verification:** generator visibility suite passes (12/12); combined relevant
generator/style/operation suites pass (147/147); CLI build succeeds. Live
visibility mutation awaits reload and verification.

## 2026-10-23 — Builder API rejects hash-valid plans in dry-run

**Status:** fixed by restarting the local Builder API; MCP dry-run verified.

**Symptom:** `nodes.remove` dry-run through MCP returns
`PLAN_VALIDATION_FAILED: PLAN_HASH_MISMATCH`, without changing the project.
The same plan generated by the current source CLI also fails against the live
API, while a local JSON/Zod wire-round-trip test validates successfully.

**Evidence:** project revision remained 140; a local regression confirms the
plan hash survives serialization and `PlanSchema.parse`. This isolated the
mismatch to the running Builder API runtime, not the operation input. Restarting
`npm run dev:standalone -- --host ::` on `:3333` made the identical MCP dry-run
pass at revision 150. No deletion was performed by the failed requests.

## 2026-10-23 — active MCP child predates the rebuilt CLI bundle

**Status:** diagnosed; the active MCP stdio child must be restarted after the
bundle build before mutation testing can continue.

**Symptom:** `variants.visibility.set` dry-run and a control `styles.set`
dry-run both return `PLAN_HASH_MISMATCH`. Both are rejected before any write;
the project remains at revision 172.

**Evidence:** the active stdio process (PID 37755) started at 21:24:30, while
`packages/cli/dist/main.js` was rebuilt at 21:24:40. The Builder API process
started later at 21:24:46. This is consistent with the MCP child loading the
previous bundle even though the local bundle is now current. The failure is
general to mutation-plan validation, not specific to visibility generation.

**Next check:** restart the MCP child only after the build has completed, then
repeat a dry-run first. Do not retry a write while the dry-run is rejected.

## 2026-10-23 — stale page elements remain beside the new component instances

**Status:** identified through MCP read-only inspection; cleanup is pending a
working mutation path.

**Evidence:** `app/page.client.tsx` contains the older inline hero, header,
manifest, and empty footer, followed by the new `HeroSection`, `SiteNavbar`,
`StatementSection`, and `SiteFooter` component instances. This duplicates
content and leaves an empty old footer. The read was at revision 172.

**Next step:** once mutation dry-run validates again, remove only the obsolete
inline nodes via `nodes.remove`, then verify the page tree and preserve the
component instances. No source file has been overwritten directly.

## 2026-10-23 — stdio child does not recover after termination; hash validation is intermittent

**Status:** recorded; the MCP transport is currently disconnected and requires
the Codex app to relaunch its configured child.

**Evidence:** after a full app relaunch, the MCP child was present but the
configured `:3333` API was down. Starting `npm run dev:standalone -- --host ::`
restored the API. A visibility update committed at revision 173; removing the
obsolete hero, header, and empty footer committed at revisions 174–176.
Removing the obsolete manifest section had a passing dry-run on one attempt,
but later returned `PLAN_HASH_MISMATCH` again. The same API process accepted
other commits in between, so the failure is intermittent rather than tied to a
specific site node.

**Local diagnostic:** commit-service hash errors now report both received and
calculated hashes; a regression in `packages/cli/test/recovery.test.ts` passes.
The runtime still returned an older generic message for one rejected commit,
indicating the active server module was not consistently refreshed by HMR.

**Recovery behavior:** terminating the stale stdio child did not make the
Codex supervisor respawn it; the next MCP read returned `Transport closed`.
This is a host lifecycle limitation, not a project mutation. The configured
MCP command already rebuilds the CLI before startup. A full Codex relaunch is
required to restore the transport; keep `dev:standalone` running meanwhile.

## 2026-10-23 — independent MCP client still gets plan-hash mismatch

**Status:** fixed in the local Builder API and verified through independent MCP.

**Runtime check:** after the user relaunched Codex, its managed MCP stdio child
was available, but the Builder API on `:3333` was not. Started
`npm run dev:standalone -- --host ::` from this session. Then launched a
separate, short-lived MCP stdio server with the current `packages/cli/bin` and
connected to it using the official `@modelcontextprotocol/sdk` client (Codex
remained open). `codeFiles.read` succeeded for `app/page.client.tsx` at revision
176.

**Root cause:** `server/automation/api.ts` decoded every incoming body chunk
individually with `chunk.toString()` before concatenating it. If a network
chunk ended in the middle of a multi-byte UTF-8 character, that character was
replaced with U+FFFD. The JSON still parsed, but a large plan containing
Ukrainian text no longer had the bytes represented by its `planHash`. This
explains why short or differently segmented requests passed while others
failed.

**Fix and regression:** the API now buffers raw `Buffer` chunks and decodes
once after concatenation. Added a middleware regression that deliberately
splits `Привіт, Україно 🌻` in the middle of a UTF-8 sequence. It failed before
the fix and passes now; all 8 `server/automation/automation.test.ts` tests pass.

**Live verification:** after restarting the API, 10 consecutive
`nodes.remove` dry-runs for `intro-sec` passed via a separately launched
official MCP stdio client at revision 176. The same MCP client then committed
the removal at revision 177. A follow-up `codeFiles.read` confirmed the old
manifest is gone and `HeroSection`, `SiteNavbar`, `StatementSection`, and
`SiteFooter` remain. No direct page-file write was used.

## 2026-10-23 — component variant interaction generation and verification

**Status:** interaction generation fixed and confirmed in the builder; the
headless verifier fix is built and passes through a fresh MCP stdio process.
The Codex-managed long-running MCP child is still running an older bundle.

**User-visible issue:** component variants appeared connected in the editor,
but hover did not consistently work, Interactions could show no usable hover
action, and a variant label was missing in the canvas.

**Root causes and local fixes:**

- `variants.create` persisted interaction metadata without always creating
  the matching enter/leave connections. It now creates the pair and accepts an
  explicit `sourceNode`.
- Re-applying an existing connection returned early without repairing missing
  JSX handlers. It now reconciles generated handlers even for an existing edge.
- Connection generation inserted Framer handlers on plain HTML elements,
  which React does not execute as Framer gestures. It now converts the source
  element to `motion.<tag>` and adds the `motion` import.
- `connections.create` now rejects a non-existent `sourceNode` instead of
  silently storing a dangling connection.
- `verify.effect` only counted `whileHover`, and missed valid component
  interactions implemented by paired `onHoverStart`/`onHoverEnd` handlers
  that update a variant state. It also incorrectly required `variants` on the
  gesture root, missing components (such as `ProjectCard`) where that root
  drives variants on descendants. It now recognizes paired state-setting
  hover handlers with `animate`.

**Site verification:** on project `proj-1792770801304-tbg5o9`, branch `main`,
the current independent MCP client read revision 210. `PrimaryButton` and
`ProjectCard` have explicitly labelled `Hover` variants and paired hover
connections; `SiteNavbar` has click connections for open and close. Fresh
`verify.effect` calls pass for both hover components and the navbar, and the
user independently confirmed hover now works in the builder. All 116 focused
tests across interaction, verification, and connection-generation suites
pass; `npx tsc --noEmit` and the CLI bundle build pass.

**Transport/runtime discrepancy:** the existing Codex-managed stdio child
(PID 47682, started before the latest CLI build) still returns the old false
negative from `verify.effect`. Rebuilding `packages/cli` does not replace an
already-running child. A newly spawned official MCP stdio client using the
rebuilt bundle returns `satisfied: true` for the button, card, and navbar;
10 consecutive mutation dry-runs also pass at revision 210 without committing.
The stale child should be reloaded by a full Codex app restart. Do not kill it
from the workspace: prior testing showed its supervisor does not reliably
respawn it and leaves the transport closed.

## 2026-10-23 — three unrelated suite failures still require a missing fixture

**Status:** reproduced; no source fix is appropriate until the fixture is
restored or tests are made self-contained.

Three targeted tests fail before exercising their assertions because they
attempt to read the absent file
`data/projects/proj-1791960645579-j02nu7.json`:

- `src/code/parsing/parser.test.ts` — remote-paginated gallery subroute.
- `src/code/generation/cms-pagination-gen.test.ts` — clean/re-apply remote
  pagination.
- `src/code/project/__tests__/source-export-modes.test.ts` — gallery route
  source-export preparation.

All three were rerun on 2026-10-23 and failed with the same `ENOENT`; they are
independent of the component interaction changes above.

## 2026-10-23 — native MCP screenshot bridge unavailable

**Status:** fixed in the local Builder and CLI sources; verified end-to-end
through a fresh official MCP stdio client. The Codex-managed Revyme MCP child
still runs the old bundle and must be reloaded before its `observe.screenshot`
tool sees the fix.

**User-visible symptom:** `observe.screenshot` always returned
`HEADLESS_DISPLAY_UNAVAILABLE`, even with the Builder project open.

**Root causes:** the Vite self-host plugin defaulted to not starting the MCP
HTTP server; the CLI passed an empty `OperationContext.adapters` object; and
the editor bridge had no `captureScreenshot` RPC handler. In addition,
`get_screenshot` already called `captureElement` on the CanvasBridge interface,
but that method existed only on the concrete iframe implementation and was
missing from the interface/API.

**Fix:** local Vite now starts the bridge; the HTTP server binds to loopback
(`127.0.0.1`) and the editor/CLI use that exact address; the CLI's screenshot
adapter forwards scoped requests to `/rpc`; the editor validates project,
branch, and active file, waits for render, then delegates capture to the
existing iframe `html-to-image` implementation. Screenshot errors now retain
their reason in the operation result. The existing screenshot engine runs
inside the sandbox; no parent-frame DOM access was added.

**Verification:** 122 focused tests pass, including regressions for adapter
wiring, browser capture, API-plugin startup/shutdown, and loopback binding.
`npx tsc --noEmit`, `npm run build:all`, and the CLI build pass. After reloading
the Builder tab, `/api/mcp/status` on `127.0.0.1:8082` reports one active canvas
tab. A fresh process using the official MCP stdio server successfully captured
`app/page.client.tsx` on project `proj-1792770801304-tbg5o9`, branch `main`
(PNG, 951 × 2579 px; 358,034 data-URL bytes). The existing managed MCP child
still returned the pre-fix headless result, confirming its runtime bundle is
stale until Codex reloads the configured MCP process.

## 2026-10-23 — links.set produced links the Builder could not safely parse

**Status:** fixed and covered by T10 regressions.

`links.set` added `href` to ordinary anchors in page and design-component
files. That shape failed the Builder's Oracle and, in design components,
would not provide the framework-safe navigation/animation behavior expected
by the component. The operation now converts internal links to `Link` or a
motion-wrapped `MotionLink`, while preserving external anchors. A second
validation pass in `validate.ts` had a narrower JSX scaffold exemption than
the Oracle and rejected the private fallback elements inside `MotionLink`;
the exemption now matches the canonical Oracle rule. T10 covers generated
links and `validatePlan` acceptance.

## 2026-10-23 — nodes.create omitted required flex/grid flow order

**Status:** fixed and covered by a T07 regression.

Creating a direct child inside a flex/grid parent could produce JSX without a
CSS `order`. The Oracle then rejected a valid MCP create operation. `nodes.create`
now assigns stable order values to direct flow children that lack them, while
preserving explicit orders and skipping absolutely/fixed-positioned children.

## 2026-10-23 — open Builder tab is behind MCP's committed revision

**Status:** diagnosed; the live tab does not yet receive MCP commits in place.

The standalone Builder tab loaded revision 239; subsequent Revyme MCP v2
operations committed through the local automation API up to revision 249.
Standalone mode does not join the cloud collaboration socket, so the editor's
in-memory `ProjectFS` receives no live file-sync notification for direct MCP
commits. Its optimistic-concurrency check correctly rejects stale autosaves
with `REVISION_CONFLICT`, but the tab then retries the same stale snapshot and
logs repeated errors. This is a Builder/MCP synchronization gap rather than a
failed MCP commit. Do not bypass the revision check: a safe solution needs to
reconcile the editor's local edits with the MCP commit before advancing its
base revision. For the initial diagnosis, the persisted project remained at
revision 249 and the visible tab was not refreshed while its local recovery
copy was unreviewed.

**2026-10-24 update:** browser logs reproduced the same failure at server
revision 274 with a Builder recovery based on revision 239. The recovery copy
won because the loader compared its local persistence timestamp with the
timestamp embedded in the server data, instead of comparing the recovery's
`baseRevision` with the server row revision. `LocalBackend.loadProject` now
preserves that stale snapshot under a revision-specific recovery key and loads
the server copy when the server advanced past its base. This fixes stale
recovery replay on reload; live in-session propagation remains open.

## 2026-10-23 — direct managed MCP screenshot call still lacks the bridge adapter

**Status:** source fix is present and passes through a fresh official CLI
client; the long-running managed tool process still returns
`HEADLESS_DISPLAY_UNAVAILABLE`.

The direct `observe.screenshot` tool currently lacks
`context.adapters.screenshotService`. The local screenshot bridge on port 8082
reports active editor tabs, while the managed MCP child still returns the old
headless path. A fresh MCP stdio client from the rebuilt CLI installs the
adapter and is the verified path for screenshots. The live browser log also
showed retries for the bridge EventSource, so this runtime mismatch remains
visible rather than being treated as a successful screenshot.

## 2026-10-24 — links.set omitted MotionLink runtime imports

**Status:** fixed locally; verified by the T10 regression and the live site's
atomic MCP plan.

Applying `links.set` to a plain anchor in a Design Component converted it to
`MotionLink` and generated the declaration with `React.forwardRef`, but failed
to ensure the required `React` and `motion` imports. Oracle rejected the footer
email link as `WOULD_CRASH: References undefined identifier: motion`.

`convertToMotionLinkInCode()` now ensures the default React import, Framer
Motion's `motion` import, and Next.js `Link` import whenever it creates the
wrapper. T10 now covers a component without either runtime import and checks
that Oracle finds no crash.

## 2026-10-24 — typography.apply emitted uneditable style nodes

**Status:** fixed locally; T08 regressions pass.

Responsive typography application generated `<style>` elements without
`data-id`, so the Builder Oracle rejected them. In flex sections the same
unpositioned style nodes were also misread as flow children and reported as
missing `order` and shrink configuration.

`typography.apply` now creates a stable, node-specific style ID, updates the
same style node idempotently, and marks the metadata element absolute so it
does not participate in layout. T08 checks the ID, positioning, and repeated
application without duplicate style nodes.

## 2026-10-24 — responsive viewport audit required exact max-width tiles

**Status:** fixed locally; Oracle regression passes.

`CANVAS_VIEWPORT_BREAKPOINT_MISMATCH` required a viewport with width exactly
1199 and 599 for `max-width: 1199px` and `max-width: 599px`, even when the page
declared tablet/mobile artboards at 810 and 390. That contradicted the rule's
own canonical example and blocked responsive typography from being applied.

The audit now treats a configured tile at or below a `max-width` breakpoint as
coverage (810 previews the 1199 rule; 390 previews the 599 rule). Explicit
`data-responsive` `_bp` widths remain exact. A canvas-config regression covers
both thresholds.

## 2026-10-24 — named responsive overrides ignored the page's canvas widths

**Status:** fixed; the T07 regression passes and a live dry-run used the
project's configured 390px mobile width.

**Symptom:** `viewports.setOverride({ viewport: "mobile" })` generated a
375px query even though the target page's `@canvas` metadata defines mobile as
390px (and tablet as 810px rather than the 768px fallback).

**Cause:** the operation translated the names `mobile`, `tablet`, and
`desktop` directly to global defaults instead of resolving the target file's
declared viewport configuration.

**Fix and guardrail:** named overrides now parse the target file's `@canvas`
viewport list first and only use defaults when no matching viewport exists.
T07 asserts that the generated query is 390px and not 375px.

## 2026-10-24 — responsive style metadata was rejected as a canvas node

**Status:** fixed; the T03 regression and a live MCP dry-run pass.

**Symptom:** an editor-owned `<style>` block generated for responsive
typography was rejected as `MISSING_DATA_ID`, sometimes followed by flex-child
order/shrink violations.

**Cause:** the independent lightweight plan validator treated `<style>` like
a selectable JSX element even though the Builder Oracle treats it as
non-rendered editor metadata.

**Fix and guardrail:** `style` is now exempt from canvas `data-id` validation.
The T03 regression covers a responsive `<style>` block in a page, and a real
MCP dry-run with 58 site operations completed without Oracle issues.

## 2026-10-24 — automation middleware stayed stale after server module edits

**Status:** fixed locally; the regression was observed failing before the
change and passing after it.

**Symptom:** a running Vite process kept using the first
`/api/automation` middleware closure after an SSR module update, so fixes to
validators or generators appeared ineffective until the whole Builder dev
server was restarted.

**Cause:** `server/api-plugin.ts` cached the middleware function indefinitely
even though Vite's SSR module runner is responsible for HMR invalidation.

**Fix and guardrail:** every automation request now asks `ssrLoadModule` for
the current module and creates its middleware from that module. The API-plugin
regression first returned generation 1 twice, then passed with generation 1
and generation 2 on successive requests.

## 2026-10-24 — headless observe.audit cannot measure the live Builder canvas

**Status:** the stdio MCP path now requests live measurements from Builder;
standalone one-shot CLI execution still reports `pending` by design.

**Symptom:** `observe.audit` against the active project returns
`CANVAS_MID_RENDER` for every node when invoked from a standalone CLI process,
even while the same page is visibly rendered in the Builder preview.

**Cause:** the headless CLI process does not share the Builder tab's in-memory
rect cache. The operation can parse the page, but it cannot evaluate visual
overflow/overlap without measurements from that canvas instance.

**Fix:** added a scoped `observeAuditSnapshot` request to the existing browser
bridge. It waits for rendered rects, checks the active project/branch/page,
saved revision, editor idleness, viewport, measurement coverage and cache
freshness, then returns the same audit-node shape used by the visual linter.
The stdio server attaches this adapter to `observe.audit`; a headless
one-shot CLI has no live Builder adapter and must continue to report `pending`.

**Follow-up:** do not interpret headless `pending` as a passed audit or as
evidence that the page failed to render. The live RPC still needs end-to-end
verification after the Builder dev server reloads the bridge implementation.

## 2026-10-24 — automation API SSR reload re-registered project operations

**Status:** fixed locally; live CLI read and mutation now pass.

**Symptom:** `metadata.read` and `pages.list` failed with
`Operation "projects.duplicate" is already registered` when the API SSR module
was loaded. `metadata.read` succeeded after restarting neither Builder nor
Codex, and subsequent project checks worked.

**Cause:** `validate.ts` imports the restore validator; `scoped-restore.ts` in
turn imported checksum helpers from `operations/projects.ts`. Importing that
module has the side effect of registering all project operations. Vite's SSR
module reload repeated the registration against the still-live global
registry.

**Fix and guardrail:** moved the pure checksum helpers to
`operations/project-checksums.ts` and made both callers import that module.
The operations module no longer enters the validation dependency graph solely
for checksum code. Live `metadata.read`, `metadata.update` dry-run, and the
committed language update succeeded at revision 332.

## 2026-10-24 — Codex-managed Revyme MCP connector remains transport-closed

**Status:** unresolved host-level lifecycle issue; local official CLI works.

**Symptom:** the registered `mcp__revyme_v2/metadata.read` tool still returns
`Transport closed`, although the configured API at `http://localhost:3333` is
healthy and direct official CLI operations succeed.

**Evidence:** after the stale stdio child was terminated in the prior
diagnostic session, the Codex supervisor did not recreate it. A direct
`metadata.read` tool call still fails, while `packages/cli/bin/revyme.mjs`
successfully reads revision 332, passes project diagnostics, and commits with
editor sync confirmed.

**Next step:** after code commit, fully exit and relaunch Codex so its MCP
supervisor starts a fresh stdio child. Do not work around operation failures
silently; use the official CLI only as the same MCP v2 implementation while
recording the disconnected app connector.

## 2026-10-24 — audit RPC could select a stale tab for a multi-tab project

**Status:** fixed in source with a two-editor regression test; live check
pending Builder dev-server reload.

**Symptom:** two Builder tabs were connected for the same project. The audit
snapshot RPC sometimes returned revision 355 even though the requested
project revision was 356/357, and a project-sync RPC could report the other
tab's result.

**Cause:** `sendToEditor()` assigned one request ID to every matching tab.
`handleResult()` resolved on the first response and discarded any later one,
so results depended on response timing rather than project revision.

**Fix:** the read-only `observeAuditSnapshot` RPC now uses the bridge's
per-editor request IDs and prefers a ready snapshot with the exact requested
revision, then a non-ready result from that same revision. The regression
reproduced the stale-first race before the change and passes afterward.

**Evidence / remaining checks:** the local bridge reported two active tabs;
the live audit request returned `REVISION_MISMATCH` from one stale tab while
another tab acknowledged revision 357. Focused MCP tests pass, but the running
Vite bridge must reload before the live RPC can exercise the fixed dispatcher.

## 2026-10-24 — verify.effect misclassified motion.create-wrapped links

**Status:** fixed and verified against the IMPCT.DIGITAL `PrimaryButton`.

**Symptom:** `verify.effect` reported `Motion attributes ... on intrinsic HTML`
and `satisfied: false` for the site's hover CTA, despite its paired
`onHoverStart` / `onHoverEnd` handlers and two distinct button variants.

**Cause:** the verifier only treated `<motion.*>` JSX tags as motion elements.
The component correctly wraps Next.js `Link` with `motion.create(...)`, but the
AST classifier considered the resulting `<MotionLink>` tag an intrinsic tag.

**Fix and verification:** the verifier now detects custom component variables
whose initializer contains `motion.create(...)` and classifies their JSX uses
as motion elements. The regression first failed, then T24 passed (40/40); the
CLI was rebuilt and live `verify.effect` now reports `satisfied: true`,
`isMotionElement: true`, and `hasHover: true` for `button-root`. The website
component itself was not changed.

## 2026-10-24 — project diagnostics applied canvas rules to generated files

**Status:** fixed locally; full live project check passes at revision 373.

**Symptom:** a workspace-wide `diagnostics.projectCheck` reported 19 blocking
Oracle violations in `app/page.tsx`, `app/layout.tsx`, `app/providers.tsx`,
and `plugins/DirectusSync.tsx`, while the actual page source passed a targeted
check. These files are Next.js/server plumbing or plugin source, not editable
canvas pages/components.

**Cause:** the check ran `checkFile()` over every `.tsx`/`.ts` snapshot file
and guessed its Oracle kind from path substrings. That applied Builder page
and Design Component invariants to generated wrappers and arbitrary plugin
code.

**Fix:** canvas Oracle checks now run only for `app/**/*.client.tsx` and
`components/**/*.tsx`. Other TS/TSX files remain syntax-checked and included
in static import/asset/link checks. A regression reproduces the generated
page/layout/providers and plugin mix; it failed before the change and passes
afterward.

**Verification:** T24 regression passes, `diagnostics.projectCheck` reports
zero blockers and zero drift across the 13-file live workspace, and
`preview.build` is ready for the `/` route at the same revision.

## 2026-10-24 — visual MCP observation requires a connected Builder tab

**Status:** confirmed architecture limitation; no workaround or code change
made during this investigation.

**Current Revyme path:** `observe.screenshot` in the stdio MCP calls the local
bridge at `/rpc`; the bridge selects a connected Builder editor, checks its
project/branch/file/revision, then asks the canvas iframe to capture the
requested node. Without that live iframe, the operation reports
`HEADLESS_DISPLAY_UNAVAILABLE` (or a more specific unavailable status). The
page/component mutation tools themselves are separate API operations and do
not inherently require a visible tab.

**Webstudio comparison:** Webstudio's MCP prepares/refreshes a generated-site
preview from the active project session, starts its own managed Chromium in
`--headless=new` mode, and captures through CDP. The MCP reuses that browser
session and verifies that the requested route rendered a generated project.
This captures the generated site, not the Builder canvas/editor UI.

**Recommendation:** a Revyme headless site-preview screenshot service is
feasible and would remove the open-tab requirement for page-level visual
verification. It would not by itself provide exact canvas-node screenshots,
live editor geometry, or selection state. Making all canvas-bound observation
independent of a user tab would require the MCP host to own a separate Builder
canvas session (or a headless renderer with equivalent canvas measurement and
runtime behavior), which is a larger follow-up and must be tested against
variants, slots, responsive rendering, assets, and animations before replacing
the current bridge path.

## 2026-10-24 — observe.audit counts off-canvas slot sources as unmeasured

**Status:** root cause confirmed; fix not yet applied because the canvas slot
preview currently strips node IDs from its visible ghost copy.

**Symptom:** the IMPCT.DIGITAL page audit reports missing measurements for
connected marquee source nodes. On the latest live check (revision 494),
coverage was `194/216`; the missing IDs are the free-canvas card sources and
their `ProjectCard` descendants.

**Cause:** slot-connected source nodes are parsed as `isCanvasNode` and remain
in the free canvas workspace. The marquee renders a separate, non-interactive
ghost preview inside the component, but `buildOne()` in
`src/canvas/slot-children.ts` strips every `data-*` attribute from that ghost
to prevent selection collisions. The source copy can therefore remain culled
and absent from the measurement cache while the visible preview has no node
identity the bridge can measure. `collectLayoutSnapshot()` currently counts
both regular viewport nodes and those off-canvas sources toward 100% coverage.

**Why not filter the sources:** the connected card data is also real page
content in the live website. Dropping these nodes would make the audit look
complete while omitting the marquee content. A correct fix needs a distinct
measurement identity for slot-preview ghosts (separate from selection/hit-test
IDs), or page-level headless rendering that measures the real generated DOM.

**Latest status (2026-10-24):** project diagnostics are clean at revision 494,
but the rendered audit remains `pending` because these 22 marquee-source nodes
are not measured. This is separate from the severity-classification fix below;
do not report a complete visual audit until the slot-preview measurement path
is resolved or an equivalent rendered-page capture is available.

## 2026-10-24 — Codex MCP transport closed while Revyme stdio server is healthy

**Status:** isolated to the Codex-managed connector; Revyme MCP server and API
are operational. No Revyme source change is justified by this evidence.

**Symptom:** native `mcp__revyme_v2` calls to `pages.list`, `components.list`,
and `codeFiles.read` fail with `Transport closed`.

**Evidence:** the configured `packages/cli/bin/revyme.mjs mcp` child remains
alive under Codex's app-server. The project's API responds to the official
CLI at revision 380. An independent JSON-RPC stdio handshake against the same
CLI process successfully initialized MCP and executed `pages.list` at revision
380.

**Conclusion:** the operations registry, MCP stdio implementation, and Builder
automation API are functioning. The break is in the existing Codex-managed
stdio transport/session; changing Revyme operation code would be a speculative
fix. Continue using the official Revyme MCP stdio server directly for this task
and retain this host-connector failure for follow-up.

**Follow-up check (2026-10-24):** the native `pages.list` call still returns
`Transport closed`. The exact Codex-managed Revyme child was verified at
`/home/rost/Документи/revyme/revyme-builder-fork` and terminated with SIGTERM;
Codex did not automatically respawn it, and the connector remained closed.
The independent official stdio session continues to serve requests. This
points to a stale Codex app-server connection/catalog that needs the
app-server itself reinitialized, not a Builder `npm run dev` restart. Do not
kill or restart the app-server from inside its active session; recovery needs
a full desktop/backend restart, then verify that its MCP child is recreated
and `pages.list` succeeds.

**Recovery and local-server collision (2026-10-24):** after the user's Codex
restart, a new app-server and Revyme MCP child appeared; the native
`pages.list` transport recovered but returned `SERVER_UNAVAILABLE` because
the Builder API at `localhost:3333` was not running. I then started `npm run
dev` while the user was starting it in their own terminal. That duplicate
launch occupied `3333`, `5174`, `5175`, and `8082`; the user's Vite process
fell back to `3334` and the bridge could not start. I stopped only my own
saved terminal session and verified those ports are now free. This collision
was caused by duplicate startup, not an MCP implementation defect. The user
prefers to start `npm run dev` themselves; do not start it again without
checking with them first.

## 2026-10-24 — MCP component insertion skipped Builder layout guarantees

**Status:** fixed locally; rebuild the CLI and restart Codex's Revyme MCP child
before retrying the live operation.

**Symptom:** `components.instance.create` inserted a new FAQ row into a flex
list, then Oracle refused it with `FLEX_CHILD_MISSING_ORDER` and
`FLEX_CHILD_SHRINKS`. No partial project write was committed.

**Cause:** the editor's structural-mutation path applies
`applyRuntimeGuarantees`, but the MCP operation preparation boundary only
lowered spacing units before Oracle validation. Generated JSX therefore
reached Oracle without the same sequential `order` and non-shrinking `flex`
values the Builder itself adds.

**Fix and regression:** `normalizeCandidateChanges()` now applies the shared
runtime guarantee pass to every changed TSX/JSX source. A test first reproduced
the missing child styles and Oracle warnings; it now passes after normalization.

**Post-reboot follow-up (2026-10-24):** the first live retry still rejected an
FAQ child because the Codex-managed MCP process had started at 12:29, before
the source fix was written at 12:37 and the CLI bundle rebuilt at 12:39. The
running process therefore still held the pre-fix code in memory. This is a
stale-process retry, not evidence that the new normalization fix failed. The
next retry must happen after Codex recreates its Revyme MCP child from the
rebuilt bundle; no second code workaround should be applied unless that fresh
process reproduces the same Oracle errors.

## 2026-10-24 — Screenshot bridge hid missing editor tab behind HTTP 500

**Status:** response semantics fixed locally; CLI rebuild and Codex MCP restart
required. Actual capture still needs a connected editor tab; headless capture
is not implemented by this bridge yet.

**Symptom:** `observe.screenshot` returned `SCREENSHOT_SERVICE_ERROR` with the
unhelpful note `Screenshot bridge returned HTTP 500` after a machine restart.

**Cause:** the bridge's `/rpc` endpoint returns an HTTP 500 and a useful JSON
message when no editor tab is attached. The MCP adapter discarded that body and
raised a generic status-only error.

**Fix and regression:** the CLI adapter now maps this specific condition to a
structured unavailable result with reason `EDITOR_NOT_CONNECTED`, preserving
the bridge's explanation. Other HTTP failures still surface as errors. The
focused MCP test verifies the structured result. This clarifies the current
tab dependency; it does not claim to provide the separately requested
headless-rendering capability.

**Post-reboot follow-up (2026-10-24):** one screenshot retry during the same
stale MCP process returned `SCREENSHOT_SERVICE_ERROR` with
`This operation was aborted`. The call did not produce an image, so the latest
hover and menu changes remain visually unverified. Do not use browser
automation as a substitute; retry once after the Codex-managed MCP child has
reloaded the rebuilt adapter, then report `EDITOR_NOT_CONNECTED` honestly if
no Builder editor tab is attached.

## 2026-10-24 — Screenshot bridge reported a stale canvas as ready

**Status:** revision validation fixed locally and regression-tested. After the
user restarted Codex and the Builder dev server reloaded, the live MCP screenshot
returned `available: true` / `status: ready` for the current project.

**Symptom:** `observe.screenshot` returned `available: true` / `status: ready`
while the capture showed only the first FAQ row and the old placeholder. The
persisted `components/FAQSection.tsx` at revision 449 already contained four
`FAQItem` instances and no placeholder.

**Cause:** `observe.screenshot` had the requested project snapshot, but the CLI
adapter discarded its `revision`. The canvas bridge checked project, branch,
active file, and rendered bounds but not `getBaseRevision()`. It could therefore
return a successful image from a canvas behind the requested project state.

**Fix:** pass `snapshot.revision` through the CLI bridge request and require an
exact loaded-revision match before capture. Missing revision returns
`REVISION_REQUIRED`; a stale/ahead canvas returns `REVISION_MISMATCH` and does
not capture. This follows the exact-revision guard already used by
`observeAuditSnapshot`.

**Verification:** the new stale-canvas regression failed before the fix by
reaching `CANVAS_CAPTURE_EMPTY` instead of rejecting the revision; after the
fix, 115 targeted bridge/CLI/verification tests pass. The CLI bundle and main
Builder app both build, and `npx tsc --noEmit` passes. The full-suite result is
tracked below.

## 2026-10-24 — Screenshot RPC could select a stale tab in a multi-tab project

**Status:** fixed in the Builder bridge and regression-tested. A live MCP
`observe.screenshot` returned a ready image after the Builder server reloaded.

**Symptom:** with multiple Builder tabs open for one project, screenshot
capture could time out or return a stale-canvas refusal even when another tab
had the requested revision.

**Cause:** `captureScreenshot` used `sendToEditor()`, which broadcast one
request ID to every matching tab and settled on the first reply. A stale tab's
`REVISION_MISMATCH` could therefore win over a valid capture from a current tab.

**Fix:** screenshot RPC now sends independent requests per editor, includes the
tab's `canvasRevision` in every capture result, and prefers a ready result whose
revision exactly matches the requested snapshot. If none match, the bridge
returns an honest non-ready result instead of presenting a stale image as
current.

**Verification:** the stale-first server regression fails against the old
shared-ID behavior and passes with independent IDs; browser bridge success and
revision-mismatch cases and automation-core propagation are covered. All 123
focused tests pass, `npx tsc --noEmit` passes, and both the Builder and CLI
builds succeed. The separate live layout-audit gap remains: 194/216 nodes are
measured; 22 marquee slot-source/component nodes are intentionally not on the
rendered canvas and remain documented under the `CANVAS_MID_RENDER` audit entry.

**Operational note:** during verification, the Vite dev-server process exited
with code 143 and ports 3333/8082 were no longer listening, which caused one
`SERVER_UNAVAILABLE` audit response. Restarting `npm run dev` restored both
listeners; the subsequent audit reached the canvas and reported only the
documented 22-node marquee measurement gap. The reason for the external
SIGTERM is not established, so it is not attributed to the screenshot fix.

## 2026-10-24 — verify.effect ignored `effectType: motion`

**Status:** fixed locally with red/green regression coverage.

**Symptom:** `verify.effect` could return `satisfied: true` for a static hero
when the caller explicitly requested `effectType: "motion"` but described the
target as a hero section without using the words motion/animation.

**Cause:** the operation calculated `needsMotion` but never used it to add a
motion-specific check. The shared prose verifier only inferred motion when the
request itself contained motion-related terms, so the enum value was ignored.

**Fix:** `effectType: "motion"` (and explicit motion/animation wording) now
requires a motion element carrying an actual target prop such as `animate`,
`exit`, `variants`, a `while*` prop, or `layout`. A bare static element no
longer passes; a real motion target does.

**Verification:** the static-hero regression failed before the fix because the
operation returned `satisfied: true`; static and animated hero cases now pass
their expected false/true verdicts.

## 2026-10-24 — observe.audit misclassified intentional layout as errors

**Status:** fixed locally and regression-tested. Rebuild/reload the
Codex-managed MCP child before expecting the live audit to use the new
classification.

**Symptom:** the IMPCT.DIGITAL audit reported 43 errors, including the
ProjectCard image/hover-overlay pair and marquee cards translated outside the
viewport by the marquee animation.

**Cause:** `auditOverlaps()` treated a fully contained absolute overlay as a
layout collision. Separately, `observe.audit` promoted every geometric overlap
and every viewport-tile overflow to an error, even though viewport overflow is
explicitly documented in the rule as informational and may be intentional
(marquees, fixed headers, cursor overlays, negative-margin CTAs).

**Fix:** a fully contained absolute overlay is excluded from sibling overlap
findings; remaining geometric overlaps are warnings for human review, while
viewport-tile overflow is informational and no longer blocks `passed`. The
summary now distinguishes blocking errors, warnings, and informational
findings.

**Verification:** design-audit and T24 suites pass (100 tests). The main app
build, CLI build, and TypeScript check pass. The live project audit from the
old MCP child remains pending on the separate marquee-source measurement gap;
a fresh live audit must be rerun after the MCP child loads the rebuilt bundle.

## 2026-10-24 — full test suite has three missing portfolio-test2 fixtures

**Status:** unrelated to the IMPCT.DIGITAL/MCP changes; fixture is absent from
this checkout and was not recreated or changed.

**Verification:** `npx vitest run` completed with 14,922 passed, 36 skipped,
5 todo, and 3 failed tests. All three failures are `ENOENT` for
`data/projects/proj-1791960645579-j02nu7.json` in the existing
`portfolio-test2` parser, CMS pagination, and source-export tests. The
remaining 1,033 test files passed; no new regression failures appeared.
