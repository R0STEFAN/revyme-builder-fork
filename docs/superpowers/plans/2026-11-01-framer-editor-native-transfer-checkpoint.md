# Framer native transfer — continuation checkpoint, 2026-11-02

## Resumed work on November 2

The user explicitly resumed work and clarified that third-party code components
must remain code components. Work is ACTIVE, not paused. Tasks 1/2/3/7 are complete;
Tasks 4/5/6 remain partial; 8/9 final transport/10 are pending. The historical
pause notes below describe the starting checkpoint only.

New commits: `107716b` original HOC adapter; `dfaed63` live native variable CMS
filters; `8dc7785` two typing repairs to intervening commit 45f3800;
`1cd9950` native CMS reference props/pickers and nested component queries;
`66a0979` source-backed third-party code components and reader 0.1.2.

New source files: `code-adapters.ts` handles original local override HOCs;
`code-components.ts` handles original local or external React render functions,
converts supported scalar property controls and validates native code files.
External components have their own identity per source export/version and remain
imported instances inside generated design masters. Unsupported controls, imports,
or unreadable source produce diagnostics, never placeholder frames. Original
Fragment returns and defaultProps are now retained inside a native outer host.
The adapter's React body/props/callback/style, strict TS and dedicated submit have
automated proof; NO live third-party source capture has been received yet.

Reader 0.1.2 is copied to `/home/rost/Документи/Framer-Native-Reader`. An asynchronous
question asks the user to reload it and save a fresh project JSON or report the
error. Do not ask for the same action again while pending. Latest verified input
is still the 0.1.1 Downloads file below. Old source capture has no external code.

CMS now supports strict variable-driven equality/set membership, typed preview
defaults and overrides, native filter-panel editing, responsive upgrade/downgrade,
reference props and their CMS picker, rename/duplicate metadata preservation and
reference-default validation at submit. Nested component query/text bindings emit
through native generators. Dynamic outer-field predicates and per-state query
changes still need adapters. Full Project Card still needs Video, visibility,
image-prop and other integration; do not mark it complete.

New static page emitter shares scene/instance emission with native masters,
retains semantic Frame tags, native typography breakpoints, route conflicts and
third-party instances through the real dedicated submit. It blocks unresolved
templates, CMS page context, actions and per-breakpoint control changes. This is
a foundation, not a complete page/compiler implementation. Live boolean visibility
and whole-value image props now round-trip in masters; instance image domains
still require an adapter. Active masks/effects/forms/cursors diagnose until mapped;
static scale, sticky offset and userSelect are preserved.

Latest focused converter/import validation: 176 tests passed in 16 files; reader:
26 tests passed; `npx tsc --noEmit` passed. Earlier reference/registry/mutation/picker
run: 244 tests passed. Logs `/tmp/framer-thirdparty-*` and the local SDD ledger.

CUA browser2/tab1 is signed in to Framer, currently Project Card with Video selected.
Current DOM script entry is STILL web.D7IYYINP.mjs. The canvas sandbox's different
app hash is not an editor-entry change. Video panel confirms Playing Yes, Poster
Yes, Loop Yes, Controls Hide, Muted Yes, Cover, Radius 0, Start Time 0%; editor DOM
has autoplay=false but Playing Yes is its runtime control. No source project edits.
New tab was marked for handoff.

The full suite found 58 failures in 16 modules. A read-only git-archive mirror of
resume baseline 45f3800 reproduced the EXACT same 58 test names: currentOnly=[],
baselineOnly=[] (resume-baseline-comparison.json). Do not claim the suite green.
An additional asynchronous history error exposed PagesSeoSection test mock/cleanup
defects; its mock now implements getSnapshot and afterEach seals pending history,
RED then GREEN 5/5. Full-suite cleanup needs re-verification. No Revyme page has been imported in this resumed run.

Next: inspect the fresh capture if the user provides it; complete Card/image and
visibility/native code adapters, then assemble pages/templates/effects in a pure
compiler and wire the existing validated submit into paste/history. Do not build
another commit engine or use rejected old converters.

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
