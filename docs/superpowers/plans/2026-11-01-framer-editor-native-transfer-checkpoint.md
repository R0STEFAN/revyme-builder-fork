# Framer native transfer — continuation checkpoint, 2026-11-02

## Active implementation

The user explicitly resumed, approved Native inline execution and clarified that
third-party code components must remain code components. Work is ACTIVE. Tasks
1/2/3/7 are complete; 4/5/6 are partial; 8/9 final transport/10 are pending.
The pause instructions in the historical section are superseded by the resume.
No complete page/project has been persisted in Revyme or claimed 1:1.

Commits since the starting checkpoint: 107716b original override HOCs; dfaed63
live variable CMS predicates; 8dc7785 intervening baseline typing fixes; 1cd9950
native reference props/pickers/query bindings; 66a0979 source-backed third-party
code components/reader 0.1.2; 328488d SEO test history cleanup; cfdcdc4 shared
scenes, native hosts/visibility/image props and static native page pairs.
The current checkpoint additionally contains template closure/slot assignment,
pure compiler assembly and the live-capture regressions described below.

## Working conversion and explicit gaps

- Original local HOCs retain their callback body/order through native overrides.
  Generic original local/external React functions retain their source bodies,
  Fragments, runtime defaultProps and scalar property controls inside a native
  outer host. Every file passes native Oracle and dedicated submit tests.
  Runtime Framer APIs, unadapted controls/imports and unavailable original code
  diagnose; compiled Framer modules never substitute for original source.
- CMS has strict live variable equality/membership, typed preview defaults,
  responsive upgrade/downgrade, reference prop metadata/pickers and submit
  validation, rename/duplicate preservation, and nested query/text bindings.
- Shared scene/instance emission handles masters, static pages and templates.
  Page pairs preserve fluid responsive trees, typography and route conflicts.
  Static templates without variables become native route groups/Layouts with
  exactly one direct children slot and page assignment. Inherited template
  closure excludes unrelated sibling pages. Native template root/outlet IDs are
  canonical file-scoped root/children-slot identities allocated centrally.
- Whole-value CSS image props and boolean visibility round-trip in masters.
  Nested image domains, controlReference file props, per-state instance controls,
  richer data predicates, template/page variable declarations and CMS detail
  wrappers still require adapters. Full Project Card is NOT complete.
- compileNativeTransfer is pure and deterministic, joins assets/CMS/original
  code/masters/pages, checks the projected native file set and returns NO files
  on any diagnostic. Only create context is implemented; replace/paste diagnose
  until their native placement/CAS adapter exists. The clipboard/history path is
  not connected. There is no second commit engine.
- Unsupported active masks/effects/forms/cursors and fonts/tokens/document
  metadata remain explicit blockers. Unadapted relocated href/link-prop defaults
  block to avoid linking back to an existing Home. Static scale, sticky offsets,
  text selection and inline native line-height ratios are preserved.

## Latest live capture and remaining source dependencies

Reader 0.1.6 is installed at /home/rost/Документи/Framer-Native-Reader.
It recognizes compatible editor builds from their active static imports and
checks the source engine and tree version. The user captured project source at
`/home/rost/Завантажене/framer-native-2wu2XMOUbTCMJbRRQrOz (2).json`.
SHA-256: 19351f9af560b64d561174dae06a6d450903fa8ed66f78e0291448180ab77688.
It is complete per reader, with 25 definitions, 526 assets and four original
code files: Overrides.tsx, Video.js, SmoothScroll_Prod.js, Copyright_Year.js.
Definitions, root IDs and asset descriptors match capture 0.1.4 exactly; the new
capture adds Copyright_Year. Reader 0.1.6 live build discovery is confirmed.

The generic original-code adapter emits both HOCs, including Copyright_Year.
The actual captured copyright HOC was transpiled and executed in a local test:
it replaces YYYY with the current year and retains unrelated props. The probe
and diagnostics are recorded in live-compile-0.1.6-report.json in the ignored
SDD workspace. No destination project file was persisted. No asset payloads
were supplied to that probe, so its 19 asset-content diagnostics are expected;
18 originals are cached and the native Spinner SVG URL returned 404.

Video.js needs native Framer runtime APIs and imports a separate module at
framerusercontent.com/modules/G4IfyjvwmaeSBpdb4TWu/OIjZRBmWDcIE2B6qgG1j/index.js;
the original source of that dependency has not been captured. SmoothScroll
needs withCSS and lenis. Both currently fail closed with explicit diagnostics;
do not use their compiled dependency as original source or claim parity.
Original `webPage` references now resolve to allocated static page routes in
pages and design masters; unresolved destinations and per-state link changes
fail closed. controlReference expectedType=file maps to a native file prop.

## Verification and next work

Full runs and exact baseline comparisons live in the ignored SDD workspace.
The initial full run had 58 failures in 16 modules; ALL 58 exact test names also
fail at resume baseline 45f3800. The subsequent full run had 15,541 passed,
58 baseline failures and no unhandled errors. Its comparison reports
currentOnly=[], baselineOnly=[], unhandledErrors=false. The final full run after
the native conditional-style/line-height fixes has 15,548 passed and exactly the
same 58 baseline failures, no unhandled errors (resume-verified-suite.log and
resume-verified-baseline-comparison.json). The suite is NOT green.
Latest reader validation: 36 Node tests passed. Latest focused converter/native
submit validation: 16 files / 194 tests passed (/tmp/framer-016-final-focused.log).
Typecheck: /tmp/framer-016-final-types.log. The previous 325-test combined run
covered native styles as well; no partial task is complete from unit tests alone.

Next: capture original source for transitive module dependencies and finish
source-backed code/runtime adapters, variable/image domains, CMS dynamic pages,
template props/effects/fonts/tokens/metadata; then native paste/CAS/receipt/Undo,
extension transport and full semantic/editability/visual parity. Preserve the
existing full-file submit boundary and generic codeFiles.submit prohibitions.

CUA browser2/tab1 is signed in to Framer, currently Project Card/Video selected.
The latest captured editor entry is web.D5A5JTQ5.mjs. No original source edits were made.
Chrome extension-management navigation was explicitly blocked; never bypass it
through CDP or another surface. Tools cannot operate the extension popup here.

## Historical pause checkpoint

Paused explicitly at the user's request because their usage limits are running out.
Do not resume work until the user asks. Implementation is roughly 40%; the full
one-click import and 1:1 parity are NOT complete. This is an automatic converter,
not a hand-recreated Walker site.

## Current state

Approved plan: `2026-11-01-framer-editor-native-transfer.md`.
Completed tasks: 1 (live reader), 2 (source graph/inheritance/identity),
3 (styles/text/responsive foundations), 7 (dedicated native full-file submit).
Tasks 4, 5 and 6 have substantial checkpoints but remain pending completion.
Tasks 8, 9 (final transport) and 10 remain pending. The diagnostic popup from
Task 9 was brought forward into Task 1; final paste transport is not connected.

Recent commits before this checkpoint: `c0f5bcd` (pure import candidate boundary)
and `2707218` (native computed CMS prop bindings).

The new reader is installed at `/home/rost/Документи/Framer-Native-Reader`,
version 0.1.1. It now reads original code files via
`modulesStore.getSourceContentForModuleSave` (files.source, not moduleContent),
guards unsaved code, and records URLs using the observed native asset helper.

## Latest live capture and evidence

User file: `/home/rost/Завантажене/framer-native-2wu2XMOUbTCMJbRRQrOz.json`.
Size 5,161,417 bytes; SHA-256
`724eb5692ecd8703454f464a2a2cd4de8a235e5c0935c5be9e3ed1eeefca3009`.
Complete=true, diagnostics=[], 25 definitions, 526 asset descriptors with native
URLs, one ORIGINAL code file. All raw definitions exactly match the earlier
capture independently verified against native Copy; asset metadata matches after
removing the new URL field.

Evidence directory:
`/home/rost/.codex/visualizations/2026/11/01/01a1976e-b7aa-72d0-a8d8-fa84592c31a8/framer-editor-research`.
It contains `live-editor-source-0.1.1.json`, `live-source-proof-0.1.1.json`,
`native-reader-source-access-proof.json`, and 18 downloaded original assets.
Do not substitute any rejected old converter, extension or audits.

Original `Overrides.tsx`: codeFile/cMyUSqf, module Ahsoj5mDqyAM4TE56NaM,
save 2uySDHv3gHpSQ2Ss8ueh, 777 bytes. SHA-256
`fab182a967aab640b4edf6c6699682c17b4de68f0bde3379d1c030ebded5dc8d`.
BackToTop is a React forwardRef HOC: it calls the existing props.onClick first,
then window.scrollTo({top:0,left:0,behavior:'smooth'}). It imports createStore and
randomColor from Framer utility URLs but does not use either binding. A generic
source-backed native override adapter is the next useful code adapter; do not
hand-author a replacement just for this function name. Native override exports
use withX names. No code-adapters.ts implementation exists yet.

## What the checkpoint adds

- Native CMS computed presence props retain exact source isSet semantics:
  false/0 are set; []/null/undefined/empty string are not. Parser, preview,
  clone/detach/orphan metadata and rehydration retain the transform.
- `bindSourcePropInCode` converts original field, variable, reference and supported
  computed prop bindings. Existing String(field ?? '') and URL-wrapped fallback
  prop parsing is preserved by an explicit regression.
- `emitSourceQueryInCode` emits static predicates, native sorts, offsets and
  limits with unique lexical iterators. Dynamic predicates, reverse and explicit
  zero-limit currently fail with an adapter diagnostic; they are NOT supported.
- Native in/not_in predicate parsing now round-trips literal reference arrays.
  Sorted native queries copy the shared source array, including responsive
  downgrade, and the parser does not mistake a copying .slice() for a limit.
- Asset identities are allocated centrally with sourceAssetKey. Pure asset
  planning/emission validates metadata, URLs, MIME/base64 payloads and conflicts;
  it emits no partial bundle on an error. Network acquisition is separate.
- Per-state nested instance control changes now explicitly fail instead of
  silently retaining only the base state. Their actual conditional-prop adapter
  remains to be implemented.
- Dedicated submit also accepts the real automatically generated six-state
  Underline master unchanged. Generic codeFiles.submit prohibitions stay intact.

## Asset issue and browser state

The full source closure currently plans 19 distinct resource payloads. 18 were
downloaded, totaling 344,770,275 bytes (several originals are ~50 MB).
Original assets are cached under the evidence directory's `original-assets/`.
Do not re-download them unnecessarily. Large asset transport/staging needs to be
addressed before sending a giant base64 project bundle into the live editor.

The remaining asset is Spinner Mask.svg, key pGiXYozQ3mE4cilNOItfe2L2fUA.
Its generic native /assets URL returns 403. The VERIFIED live editor mask URL is
`https://framerusercontent.com/images/pGiXYozQ3mE4cilNOItfe2L2fUA.svg`, with no
bitmap resize query parameters; that exact URL returns 404. Do not invent SVG
bytes or silently omit the mask. The current compatibility rule for reader 0.1.1
uses the observed image helper's service origin/path for SVG masks; it does not
make this missing source resource available. Full-project asset proof is pending.

`verify-cms-assets.ts` in the evidence directory is an exploratory live verifier,
not product code. It currently aborts on that unavailable SVG and has NOT produced
a successful native-cms-assets.bundle.json/proof. A CMS-only source closure can be
checked separately, clearly labelled as a subset; do not claim full-project proof.

The live Framer tab is now in Form Button definition. Its rendered Loading mask
DOM confirms the exact URL above. Current CUA browser ID is 4 (previous ID 2 was
disconnected); framerTab is rebound to tab 1. Revyme is tab 2 at
http://localhost:3333/builder/proj-1793542942247-5lkzxf. Read current browser docs
when resuming. Chrome extension-management navigation was previously explicitly
blocked; never work around it through CDP or another surface.

## Verification and resume order

Latest large focused run: 18 files / 427 tests passed. Reader: 22 Node tests passed.
Later focused fallback/parser/computed-binding run: 155 passed; later SVG asset
tests passed. A full typecheck passed before the latest small parser/SVG edits;
rerun `npx tsc --noEmit` on resume before claiming the final checkpoint is typed.
Logs are in `.superpowers/sdd/2026-11-01-framer-editor-native-transfer/` and
`/tmp/framer-*.log`. The five original T20 CODE_COMPONENT_ROOT_MISSING_STYLE fixture
failures remain baseline failures; the repository-wide suite is not claimed green.

Resume by checking git status and this checkpoint, running the focused validation,
then completing dynamic CMS/reference props and source-backed code adapters,
assembling pages/templates/effects in a pure compileNativeTransfer, and finally
connecting paste/CAS/Undo and extension transport. Native file submit is already
available; do not build another commit engine. Full source/semantic/visual parity
must still be demonstrated, and no actual complete page has been imported yet.
