# MCP v2 live tool matrix — 2026-10-24

Source: independent stdio MCP process against the local Builder. The live `tools/list` pages and `meta.index` agree on **275 unique operations**; duplicates: 0; absent from index: 0.

Execution coverage: **272 PASS-LIVE**, 0 PASS-DRY-RUN, 0 FAIL, 0 NOT-TESTED, and 3 BLOCKED-SAFETY. The only exclusions are external deployment, marketplace publishing, and credential requests/storage.

Status key: `PASS-LIVE`, `PASS-DRY-RUN`, `FAIL`, `BLOCKED-SAFETY`, `NOT-TESTED`.

## meta (3)

| Operation | Kind / environment | Status | Evidence |
|---|---|---|---|
| `meta.index` | read / headless | PASS-LIVE | 3 pages returned 275 entries; matches tools/list |
| `meta.tools` | read / headless | PASS-LIVE | schemas/examples returned for selected operations |
| `meta.guide` | read / headless | PASS-LIVE | general workflow returned 6 steps |

## workflow (2)

| Operation | Kind / environment | Status | Evidence |
|---|---|---|---|
| `workflow.batch` | mutation / headless | PASS-LIVE | Valid pages.list step planned atomically; no commit |
| `workflow.chain` | mutation / headless | PASS-LIVE | Executed pages.list and codeFiles.list sequentially with two successful receipts at revision 624 |

## plans (1)

| Operation | Kind / environment | Status | Evidence |
|---|---|---|---|
| `plans.commit` | mutation / headless | PASS-LIVE | Committed the validated batch plan at revision 176; token read-back verified and removal cleaned it at 177 |

## pages (5)

| Operation | Kind / environment | Status | Evidence |
|---|---|---|---|
| `pages.list` | read / headless | PASS-LIVE | homepage route / returned from supplied project |
| `pages.create` | mutation / headless | PASS-LIVE | Created `/mcp-audit-update` on audit branch, revision 40 |
| `pages.update` | mutation / headless | PASS-LIVE | Renamed and assigned page to template; revision 41; root normalization verified |
| `pages.duplicate` | mutation / headless | PASS-LIVE | Fixed root ID regression; duplicated templated route at revision 46; read-back confirmed canonical root and fresh child IDs |
| `pages.remove` | mutation / headless | PASS-LIVE | Removed disposable audit page at revision 189; pages.list confirmed it was gone |

## templates (5)

| Operation | Kind / environment | Status | Evidence |
|---|---|---|---|
| `templates.list` | read / headless | PASS-LIVE | Listed template and assigned pages after update |
| `templates.create` | mutation / headless | PASS-LIVE | Created `mcp-audit-shell` on audit branch |
| `templates.update` | mutation / headless | PASS-LIVE | Renamed shell and re-pointed page routes; revision 42 |
| `templates.assign` | mutation / headless | PASS-LIVE | Assigned styled page after normalization fix; revision 21 |
| `templates.remove` | mutation / headless | PASS-LIVE | Removed a newly-created empty audit template at revision 191; templates.list confirmed absence |

## metadata (2)

| Operation | Kind / environment | Status | Evidence |
|---|---|---|---|
| `metadata.read` | read / headless | PASS-LIVE | Read SEO metadata and siteConfig before/after update and restoration |
| `metadata.update` | mutation / headless | PASS-LIVE | Temporary title/description and siteConfig committed at 192, restored at 193; no temporary values remain |

## nodes (8)

| Operation | Kind / environment | Status | Evidence |
|---|---|---|---|
| `nodes.get` | read / headless | PASS-LIVE | Read root and descendants from the cloned page, including after mutations |
| `nodes.create` | mutation / headless | PASS-LIVE | Created button under nested page wrapper; revision 49 |
| `nodes.update` | mutation / headless | PASS-LIVE | Updated node name and style; revision 54 |
| `nodes.move` | mutation / headless | PASS-LIVE | Moved duplicate into nested section; revision 57 |
| `nodes.reorder` | mutation / headless | PASS-LIVE | Reordered duplicate among siblings; revision 56 |
| `nodes.duplicate` | mutation / headless | PASS-LIVE | Duplicated test button with a fresh ID; revision 55 |
| `nodes.wrap` | mutation / headless | PASS-LIVE | Wrapped the test button in a div; revision 58 |
| `nodes.remove` | mutation / headless | PASS-LIVE | Removed only the duplicate test node; revision 59 |

## layout (1)

| Operation | Kind / environment | Status | Evidence |
|---|---|---|---|
| `layout.set` | mutation / headless | PASS-LIVE | Set flex layout properties on test button; revision 52 |

## styles (3)

| Operation | Kind / environment | Status | Evidence |
|---|---|---|---|
| `styles.get` | read / headless | PASS-LIVE | Read supported inline styles on test button |
| `styles.set` | mutation / headless | PASS-LIVE | Supported border radius committed at revision 53; Oracle correctly rejected unsupported `transition` CSS |
| `styles.remove` | mutation / headless | PASS-LIVE | Removed a specific inline property; revision 50 |

## text (2)

| Operation | Kind / environment | Status | Evidence |
|---|---|---|---|
| `text.get` | read / headless | PASS-LIVE | Read text before and after update |
| `text.set` | mutation / headless | PASS-LIVE | Updated button text; read-back matched; revision 51 |

## viewports (2)

| Operation | Kind / environment | Status | Evidence |
|---|---|---|---|
| `viewports.list` | read / headless | PASS-LIVE | Returned desktop 1200 / tablet 810 / mobile 390 |
| `viewports.setOverride` | mutation / headless | PASS-LIVE | Fixed missing canvas tile metadata; 810px tablet override committed at revision 64 |

## tokens (7)

| Operation | Kind / environment | Status | Evidence |
|---|---|---|---|
| `tokens.list` | read / headless | PASS-LIVE | Listed tokens |
| `tokens.get` | read / headless | PASS-LIVE | Read token by supplied example/default key |
| `tokens.set` | mutation / headless | PASS-LIVE | Added `color-mcp-audit-temp` at rev 627; get returned `#123456`; removed and get returned null at rev 628 on disposable branch |
| `tokens.rename` | mutation / headless | PASS-LIVE | Renamed a temporary color token and rewrote its page reference at revision 196; cleanup completed |
| `tokens.remove` | mutation / headless | PASS-LIVE | Removed temporary tokens created by direct plan commit and live workflow.batch at revisions 177 and 179 |
| `tokens.usage` | read / headless | PASS-LIVE | Returned token usage report |
| `tokens.validate` | read / headless | PASS-LIVE | Completed token validation |

## presets (5)

| Operation | Kind / environment | Status | Evidence |
|---|---|---|---|
| `presets.list` | read / headless | PASS-LIVE | Listed available presets |
| `presets.set` | mutation / headless | PASS-LIVE | Created radius preset associated with a folder at rev 630; presets.list and tokens.get read back `12px` |
| `presets.apply` | mutation / headless | PASS-LIVE | Applied the exact `radius-card` name returned by presets.list; emitted `var(--radius-card)` at revision 183, then cleaned the test style at 184 |
| `presets.folders.list` | read / headless | PASS-LIVE | Listed preset folders |
| `presets.folders.create` | mutation / headless | PASS-LIVE | Created `MCP Live Audit` radius folder at rev 629; presets.folders.list returned its generated ID |

## typography (6)

| Operation | Kind / environment | Status | Evidence |
|---|---|---|---|
| `typography.list` | read / headless | PASS-LIVE | Listed typography presets |
| `typography.get` | read / headless | PASS-LIVE | Read typography preset using schema example |
| `typography.set` | mutation / headless | PASS-LIVE | Created responsive `mcp-audit-type` h2 preset at rev 632; get confirmed fluid size and md/sm tiers; remove verified null at rev 633 |
| `typography.apply` | mutation / headless | PASS-LIVE | Applied an isolated audit preset to `update-heading` at revision 201 |
| `typography.detach` | mutation / headless | PASS-LIVE | Detached at revision 202; read-back showed literal values and no preset binding |
| `typography.remove` | mutation / headless | PASS-LIVE | Removed the audit preset after detach at 203; rebuilt cleanup at 207 returned only 12 tokens actually present |

## fonts (6)

| Operation | Kind / environment | Status | Evidence |
|---|---|---|---|
| `fonts.catalog` | read / headless | PASS-LIVE | Returned font catalog results with valid limit |
| `fonts.import` | mutation / headless | PASS-LIVE | Imported Playfair Display at revisions 212 and 223; transformNextFont later converted and removed the CSS request |
| `fonts.workspace.add` | mutation / headless | PASS-LIVE | Added and read back a custom font face at revision 210 using a reserved `.invalid` URL |
| `fonts.workspace.remove` | mutation / headless | PASS-LIVE | Removed the exact temporary family at revision 211; read-back confirmed absence |
| `fonts.preload` | read / headless | PASS-LIVE | Completed preload read/check |
| `fonts.transformNextFont` | mutation / headless | PASS-LIVE | Added next/font loader and removed Google CSS import at revision 224; `history.undo` restored test changes at 225/226 |

## components (13)

| Operation | Kind / environment | Status | Evidence |
|---|---|---|---|
| `components.list` | read / headless | PASS-LIVE | Listed both audit components on the isolated branch |
| `components.get` | read / headless | PASS-LIVE | Returned `McpAuditButton` props and variants |
| `components.create` | mutation / headless | PASS-LIVE | Created `McpAuditButton` and `McpAuditBadge` masters |
| `components.extract` | mutation / headless | PASS-LIVE | Extracted an existing section, read the master, then detached it; live round trip committed |
| `components.replace` | mutation / headless | PASS-LIVE | Replaced Button with Badge and confirmed old import was pruned |
| `components.detach` | mutation / headless | PASS-LIVE | Inlined Badge defaults/styles and Button `motion`/`rootVariants` dependencies; preserved instance root ID, regenerated child IDs, pruned old imports; live revisions 99, 102, 119 |
| `components.remove` | mutation / headless | PASS-LIVE | Removed unused extracted component despite historical snapshot reference; in-use check rejects without force. Also removed temporary FormSubmit master at revision 495 while preserving the upgraded pre-existing Spinner |
| `components.instance.create` | mutation / headless | PASS-LIVE | Added instances to templated audit page; revisions 82 and 100 |
| `components.instance.props.get` | read / headless | PASS-LIVE | Read `label` override before/after update |
| `components.instance.props.set` | mutation / headless | PASS-LIVE | Updated `label` override; revision 83 |
| `components.variables.create` | mutation / headless | PASS-LIVE | Bound root color to a component prop; revision 84 |
| `components.variables.rename` | mutation / headless | PASS-LIVE | Renamed prop and cascaded instance overrides; revision 85 |
| `components.variables.remove` | mutation / headless | PASS-LIVE | Removed binding and prop from master; revision 89 |

## variants (8)

| Operation | Kind / environment | Status | Evidence |
|---|---|---|---|
| `variants.list` | read / headless | PASS-LIVE | Returned default/hover/pressed variants and refreshed final set |
| `variants.create` | mutation / headless | PASS-LIVE | Added pressed variant; revision 71 |
| `variants.rename` | mutation / headless | PASS-LIVE | Renamed variant; revision 72 |
| `variants.remove` | mutation / headless | PASS-LIVE | Removed pressed variant and its links; revision 78 |
| `variants.visibility.set` | mutation / headless | PASS-LIVE | Hid then restored absolute child visibility; revisions 80–81 |
| `connections.list` | read / headless | PASS-LIVE | Listed generated and authored pointer connections |
| `connections.create` | mutation / headless | PASS-LIVE | Added mouse enter/leave links to hover; revisions 73–74 |
| `connections.remove` | mutation / headless | PASS-LIVE | Removed both hover links; revisions 76–77 |

## overlays (4)

| Operation | Kind / environment | Status | Evidence |
|---|---|---|---|
| `overlays.create` | mutation / headless | PASS-LIVE | Fixed overlay created and read back at revision 276; generated React state/effect imports present |
| `overlays.update` | mutation / headless | PASS-LIVE | Config changed and read back at revisions 273 and 277 |
| `overlays.close` | mutation / headless | PASS-LIVE | Close action attached to a real button and read back at revisions 274 and 278 |
| `overlays.remove` | mutation / headless | PASS-LIVE | Both test overlays removed at revisions 275 and 279; no state, broken `React.` fragment, or close handler remained |

## navigation (3)

| Operation | Kind / environment | Status | Evidence |
|---|---|---|---|
| `links.get` | read / headless | PASS-LIVE | Read audit-button link configuration |
| `links.set` | mutation / headless | PASS-LIVE | Set/get/remove round-trip passed on audit page at revisions 241–242 |
| `links.remove` | mutation / headless | PASS-LIVE | Set/get/remove round-trip passed on audit page at revisions 241–242 |

## catalog (3)

| Operation | Kind / environment | Status | Evidence |
|---|---|---|---|
| `catalog.list` | read / headless | PASS-LIVE | Listed catalog entries |
| `catalog.get` | read / headless | PASS-LIVE | Returned a catalog item lookup |
| `catalog.place` | mutation / headless | PASS-LIVE | Built-in button/video placement passed (revisions 233/236); after the asset Oracle fix, image placement using `/assets/mcp-audit-proof.svg` passed at revision 246 |

## sections (3)

| Operation | Kind / environment | Status | Evidence |
|---|---|---|---|
| `sections.list` | read / headless | PASS-LIVE | Listed section blueprints |
| `sections.get` | read / headless | PASS-LIVE | Returned section lookup |
| `sections.insert` | mutation / headless | PASS-LIVE | Inserted `hero-typewall` at revision 300; removed its exact root at 301 and read back absent |

## slots (4)

| Operation | Kind / environment | Status | Evidence |
|---|---|---|---|
| `slots.list` | read / headless | PASS-LIVE | Read the audit page's empty connections, then verified connected, reordered, and disconnected states |
| `slots.connect` | mutation / headless | PASS-LIVE | Connected two temporary canvas nodes to Carousel; read-back order matched at revisions 313–323 |
| `slots.disconnect` | mutation / headless | PASS-LIVE | Disconnected first then last slot child; read-back returned one then zero connections |
| `slots.reorder` | mutation / headless | PASS-LIVE | Reordered two connected children from A/B to B/A; `slots.list` confirmed |

## assets (4)

| Operation | Kind / environment | Status | Evidence |
|---|---|---|---|
| `assets.list` | read / headless | PASS-LIVE | Listed project assets and read back the audit SVG |
| `assets.upload` | mutation / headless | PASS-LIVE | Uploaded `public/assets/mcp-audit-proof.svg`; returned `/assets/mcp-audit-proof.svg` at revision 232 |
| `assets.delete` | mutation / headless | PASS-LIVE | Active source reference was safely refused; after exact node cleanup, an unused audit SVG re-uploaded/deleted without force at revision 291 despite history snapshots |
| `assets.audit` | read / headless | PASS-LIVE | History-only asset classified as unused with no broken refs at revision 290; after delete, audit was empty at revision 291 |

## media (4)

| Operation | Kind / environment | Status | Evidence |
|---|---|---|---|
| `media.image.get` | read / headless | PASS-LIVE | Returned URL and attributes for the audit image at revision 247 |
| `media.image.set` | mutation / headless | PASS-LIVE | Updated image source/alt/loading/sizes at revision 247 and read back |
| `media.video.set` | mutation / headless | PASS-LIVE | Video props updated at revision 249 and read back |
| `media.video.remove` | mutation / headless | PASS-LIVE | Video source removed at revision 250 and read back |

## vectors (6)

| Operation | Kind / environment | Status | Evidence |
|---|---|---|---|
| `vectors.list` | read / headless | PASS-LIVE | Listed `McpAuditIcons` after live create/add/remove cycle |
| `vectors.createSet` | mutation / headless | PASS-LIVE | Created `icons/McpAuditIcons.tsx` at revision 139; fixed generated-file validation |
| `vectors.addVariant` | mutation / headless | PASS-LIVE | Added alternate audit icon at revision 140 |
| `vectors.removeVariant` | mutation / headless | PASS-LIVE | Removed only the added alternate at revision 141; primary remains |
| `vectors.searchIcons` | read / headless | PASS-LIVE | Returned icon search results with positive limit |
| `vectors.retiredSketches` | read / headless | PASS-LIVE | Listed retired sketch assets |

## shapes (5)

| Operation | Kind / environment | Status | Evidence |
|---|---|---|---|
| `shapes.get` | read / headless | PASS-LIVE | Read SVG root `viewBox`/`role` and child path attributes at revisions 332–350 |
| `shapes.updateAttrs` | mutation / headless | PASS-LIVE | Added explicit `targetElement: svg` for container attrs; default shape mode still updates child geometry/style; read-back passed at 346–349 |
| `shapes.addChild` | mutation / headless | PASS-LIVE | Added valid path children; Oracle correctly rejected non-path circle geometry; temporary paths cleaned up at 339 |
| `shapes.removeChild` | mutation / headless | PASS-LIVE | Removed child index 1 and confirmed absent at revision 337 |
| `shapes.replaceInner` | mutation / headless | PASS-LIVE | Replaced inner markup with a valid path and confirmed read-back at revision 338 |

## drawing (4)

| Operation | Kind / environment | Status | Evidence |
|---|---|---|---|
| `drawing.sketchAnim.set` | mutation / headless | PASS-LIVE | In-view draw config committed at revision 362 after narrowly exempting generated marker comments |
| `drawing.sketchAnim.get` | read / headless | PASS-LIVE | Read config after set; returned null after removal at revision 363 |
| `drawing.sketchAnim.remove` | mutation / headless | PASS-LIVE | Removed hook at revision 363; list/read-back empty, SVG cleaned at 364 |
| `drawing.sketchAnim.list` | read / headless | PASS-LIVE | Listed animated SVG after set and empty list after removal at revisions 362–363 |

## motion (18)

| Operation | Kind / environment | Status | Evidence |
|---|---|---|---|
| `motion.set` | mutation / headless | PASS-LIVE | Applied `whileHover`; read-back confirmed motion element and target at revision 368 |
| `motion.get` | read / headless | PASS-LIVE | Read props, motion-element state, and scrollFx across lifecycle at revisions 368–373 |
| `motion.remove` | mutation / headless | PASS-LIVE | Removed hover/transition and scrollFx; read-back confirmed cleared state at revisions 370–373 |
| `motion.preset.apply` | mutation / headless | PASS-LIVE | scale-on-hover and fade-up both read back, then were cleared at revisions 369/372 |
| `textEffects.set` | mutation / headless | PASS-LIVE | Applied char split then updated to word without duplicate wrappers at revisions 376–377 |
| `textEffects.get` | read / headless | PASS-LIVE | Read both configs; returned false/null after removal at revision 378 |
| `textEffects.remove` | mutation / headless | PASS-LIVE | Removed runtime wrapper/spec and restored original page at revisions 378–379 |
| `siteEffects.smoothScroll.set` | mutation / headless | PASS-LIVE | Generated controller was missing from MCP plan; now committed config/controller/layout at revision 137 |
| `siteEffects.smoothScroll.get` | read / headless | PASS-LIVE | Read enabled/intensity 22; returned null after removal |
| `siteEffects.smoothScroll.remove` | mutation / headless | PASS-LIVE | Removed route config at revision 138 |
| `siteEffects.pageTransition.set` | mutation / headless | PASS-LIVE | Applied crossfade to `/mcp-audit` → `/mcp-audit-assigned` at rev 635; route-group runtime scaffold added; get confirmed opacity 0 both sides; preview routes ready; removed at 636 and get returned null |
| `siteEffects.pageTransition.get` | read / headless | PASS-LIVE | Read page-transition state |
| `siteEffects.pageTransition.remove` | mutation / headless | PASS-LIVE | Removed the exact temporary crossfade at rev 636; pageTransition.get returned null |
| `siteEffects.cursor.set` | mutation / headless | PASS-LIVE | Rebuilt MCP committed `withCursor` and required root `<CursorPortal />` together at revision 387; read-back verified both |
| `siteEffects.cursor.remove` | mutation / headless | PASS-LIVE | Removed cursor spread/import at revisions 388; shared root portal intentionally remains for other pages |
| `siteEffects.glide.set` | mutation / headless | PASS-LIVE | Multi-child section wrapped in one LayoutGroup and five `data-glide-item` wrappers; configured duration/bounce read back at 390 and 395 |
| `siteEffects.glide.get` | read / headless | PASS-LIVE | Read glide state on audit-heading |
| `siteEffects.glide.remove` | mutation / headless | PASS-LIVE | Removed node metadata and all wrappers at revisions 391/396; subsequent get returned `hasGlide:false` |

## variables (6)

| Operation | Kind / environment | Status | Evidence |
|---|---|---|---|
| `variables.list` | read / headless | PASS-LIVE | Listed empty state and the created/renamed variable; after cleanup list was empty again |
| `variables.create` | mutation / headless | PASS-LIVE | Created a color variable with default/query-param/description at 404; also re-tested numeric create at 409 after Babel interop fix |
| `variables.update` | mutation / headless | PASS-LIVE | Renamed variable and updated default/query-param/description at 405/410; list read-back matched |
| `variables.remove` | mutation / headless | PASS-LIVE | Removed the renamed variable after unbinding and verified an empty list at 420 |
| `variables.bind` | mutation / headless | PASS-LIVE | Bound `opacity` to a numeric page variable at 406/411; cleanup restored page fixture |
| `variables.unbind` | mutation / headless | PASS-LIVE | Unbound `opacity` with fallback at 418; cleanup restored page fixture |

## expressions (3)

| Operation | Kind / environment | Status | Evidence |
|---|---|---|---|
| `expressions.bind` | mutation / headless | PASS-LIVE | Text and video-src expressions committed/read back at 413/415; href committed/read back on valid Next `<Link>` at 423 (raw `<a>` was correctly Oracle-rejected) |
| `expressions.unbind` | mutation / headless | PASS-LIVE | Text, href, and src returned to static fallbacks at 414/416/417/424 |
| `expressions.get` | read / headless | PASS-LIVE | Read text/href/src expressions and returned no expression after unbinding |

## page-interactions (3)

| Operation | Kind / environment | Status | Evidence |
|---|---|---|---|
| `pageInteractions.list` | read / headless | PASS-LIVE | Read generated click→set-variable interaction with the expected value |
| `pageInteractions.add` | mutation / headless | PASS-LIVE | Numeric reset `setAuditClicks(0)` committed at 412; non-empty color-string setter was rejected by HANDLER_CONTENT_STATE as designed |
| `pageInteractions.remove` | mutation / headless | PASS-LIVE | Removed the click interaction at 419; fixture restored afterward |

## cms-schema (10)

| Operation | Kind / environment | Status | Evidence |
|---|---|---|---|
| `cms.schema.list` | read / headless | PASS-LIVE | Read both audit collections from selected branch |
| `cms.schema.get` | read / headless | PASS-LIVE | Read back copied collection schema; field lifecycle verified |
| `cms.schema.create` | mutation / headless | PASS-LIVE | Created audit collection at revision 26 |
| `cms.schema.update` | mutation / headless | PASS-LIVE | Temporary collection display name updated and read back at revisions 459–465 |
| `cms.schema.duplicate` | mutation / headless | PASS-LIVE | Temporary collection duplicated, read back, then only the duplicate removed at revisions 459–465 |
| `cms.schema.delete` | mutation / headless | PASS-LIVE | Deleted temporary schema; cascade removed CMS index/detail server+client routes atomically at revision 476; read-back confirmed absence |
| `cms.field.add` | mutation / headless | PASS-LIVE | Added temporary field to `mcp-audit-records-copy`; revision 431 |
| `cms.field.update` | mutation / headless | PASS-LIVE | Updated field name/type/required; read-back revision 432 |
| `cms.field.remove` | mutation / headless | PASS-LIVE | Removed temporary field; schema restored at revision 433 |
| `cms.field.reorder` | mutation / headless | PASS-LIVE | Reordered temporary schema fields and restored their original order at revisions 459–465 |

## cms-items (8)

| Operation | Kind / environment | Status | Evidence |
|---|---|---|---|
| `cms.items.list` | read / headless | PASS-LIVE | Original copied-collection item/order confirmed after cleanup |
| `cms.items.get` | read / headless | PASS-LIVE | Read updated temporary item at revision 454 |
| `cms.items.create` | mutation / headless | PASS-LIVE | Temporary item created with returned ID at 452; removed at 457 |
| `cms.items.update` | mutation / headless | PASS-LIVE | Title/status and derived slug read back at 453–454 |
| `cms.items.remove` | mutation / headless | PASS-LIVE | Removed only temporary item; original list restored at 457 |
| `cms.items.reorder` | mutation / headless | PASS-LIVE | Temporary item moved then original ordering restored at 455–456 |
| `cms.items.setTranslation` | mutation / headless | PASS-LIVE | Ukrainian translation round-trip on temporary item; item removed at 457 |
| `cms.items.getTranslation` | read / headless | PASS-LIVE | Read the Ukrainian temporary translation |

## cms-bindings (6)

| Operation | Kind / environment | Status | Evidence |
|---|---|---|---|
| `cms.list.create` | mutation / headless | PASS-LIVE | Created collection repeater on audit fixture; revision 442 |
| `cms.list.configure` | mutation / headless | PASS-LIVE | Filter/sort/limit config committed and read through pagination; revision 444 |
| `cms.list.paginate` | mutation / headless | PASS-LIVE | Load More + infinite set/read/unpaginate; revisions 445–449; #27 fixed |
| `cms.list.unpaginate` | mutation / headless | PASS-LIVE | Removed both pagination modes; revisions 446 and 449 |
| `cms.field.bind` | mutation / headless | PASS-LIVE | Bound repeated title to CMS field; revision 443 |
| `cms.field.unbind` | mutation / headless | PASS-LIVE | Restored static fallback; revision 447 |

## cms-pages (4)

| Operation | Kind / environment | Status | Evidence |
|---|---|---|---|
| `cms.pages.createIndex` | mutation / headless | PASS-LIVE | Temporary index server/client route created and found, then cascade-deleted at revisions 468–476 |
| `cms.pages.createDetail` | mutation / headless | PASS-LIVE | Temporary detail server/client route created and found, then cascade-deleted at revisions 469–476 |
| `cms.pages.find` | read / headless | PASS-LIVE | Located both temporary CMS route kinds; after cascade both lookups returned `null` at revision 476 |
| `cms.pages.seo` | mutation / headless | PASS-LIVE | SEO bindings and static params read back on the disposable detail route at revision 470; route deleted at 476 |

## cms-api (11)

| Operation | Kind / environment | Status | Evidence |
|---|---|---|---|
| `cms.api.mode.get` | read / headless | PASS-LIVE | Read local/API/local mode; final state restored to local at revisions 504–505 and 531 |
| `cms.api.mode.set` | mutation / headless | PASS-LIVE | Toggled local → API → local on the isolated branch and read back both modes at revisions 504–505 |
| `cms.api.collection.list` | read / headless | PASS-LIVE | Listed temporary loopback API config and confirmed empty after cleanup at revisions 506/508 |
| `cms.api.collection.get` | read / headless | PASS-LIVE | Schema accepted; absent collection returns expected not-found |
| `cms.api.collection.set` | mutation / headless | PASS-LIVE | Created temporary custom REST config twice using loopback URL; read-back verified; both configs removed at 506/508 |
| `cms.api.collection.delete` | mutation / headless | PASS-LIVE | Deleted both temporary API collection configs at revisions 506 and 508; final list is empty |
| `cms.api.detectItemsKey` | read / headless | PASS-LIVE | Inferred nested `data` and honored explicit top-level `items`; item count/sample matched |
| `cms.api.fetch` | service / service | PASS-LIVE | Fetched one JSON item from a temporary loopback HTTP fixture; redacted headers empty; endpoint/config removed |
| `cms.api.queryConfig.set` | mutation / headless | PASS-LIVE | Set and cleared query config on a temporary CMS list; source read-back confirmed serialization; probe route removed |
| `cms.api.searchField.add` | mutation / headless | PASS-LIVE | Added styled search field to a temporary CMS list at revisions 518 and 528; bundled generator fix verified; routes removed |
| `cms.api.searchField.setVariable` | mutation / headless | PASS-LIVE | Rebound input and parsed collection filter to queryFilter at revision 529; React useState import present; route removed |

## localization (15)

| Operation | Kind / environment | Status | Evidence |
|---|---|---|---|
| `locales.get` | read / headless | PASS-LIVE | Read localization config |
| `locales.add` | mutation / headless | PASS-LIVE | Added `de` at revision 537; generated locale config, message catalog, and route wrappers |
| `locales.remove` | mutation / headless | PASS-LIVE | Removed `de` at revision 553; config/routes were pruned and `messages/de.json` intentionally preserved |
| `locales.setDefault` | mutation / headless | PASS-LIVE | Switched default to `de`, then restored `en` at revisions 539–540 |
| `locales.update` | mutation / headless | PASS-LIVE | Updated locale label/direction/fallback at revisions 538/541; read-back confirmed |
| `locales.routes.sync` | mutation / headless | PASS-LIVE | Live sync accepted on the locale route fixture; no extra route changes were needed |
| `locales.switcher.add` | mutation / headless | PASS-LIVE | Added `LocaleSwitcher` at revision 549; generated import and instance read back |
| `translations.list` | read / headless | PASS-LIVE | Listed translations |
| `translations.set` | mutation / headless | PASS-LIVE | Seeded en/de messages and converted page text at revision 542; source and catalogs read back |
| `translations.attribute.set` | mutation / headless | PASS-LIVE | Set localized form placeholder at revision 546; generated attribute expression read back |
| `translations.nodeOverride.set` | mutation / headless | PASS-LIVE | Added a de-specific node override at revision 545 and read it back |
| `translations.cmsItem.set` | mutation / headless | PASS-LIVE | Set a CMS item translation at revision 548 and read back |
| `translations.style.set` | mutation / headless | PASS-LIVE | Set a locale-specific style override at revision 547 and read back |
| `translations.instanceProp.set` | mutation / headless | PASS-LIVE | Set locale-specific code-component prop at revision 551; `useLocale()` expression read back |
| `translations.delete` | mutation / headless | PASS-LIVE | Deleted the temporary de message key at revision 552 |

## forms (12)

| Operation | Kind / environment | Status | Evidence |
|---|---|---|---|
| `forms.create` | mutation / headless | PASS-LIVE | Created audit forms at revisions 158/167 and live form at revision 492; `operationResult.formId` returned without source scraping |
| `forms.destination.set` | mutation / headless | PASS-LIVE | Configured and read back email, webhook, redirect, and antispam destinations at revision 556 |
| `forms.destination.get` | read / headless | PASS-LIVE | Schema accepted; absent form config returns expected FILE_NOT_FOUND |
| `forms.delete` | mutation / headless | PASS-LIVE | Removed both audit forms after verification at revisions 161 and 168; read-back confirmed absence |
| `forms.honeypot.add` | mutation / headless | PASS-LIVE | Added off-canvas honeypot at revision 567; source read-back and Oracle check passed |
| `forms.field.add` | mutation / headless | PASS-LIVE | Added text/select fields at revisions 544/558; form source read-back passed |
| `forms.field.remove` | mutation / headless | PASS-LIVE | Removed temporary select at revision 566 |
| `forms.selectCaret.set` | mutation / headless | PASS-LIVE | Wrote icon/color marker with CSS at revision 562 and cleared both at 563; Oracle passed |
| `forms.submitButton.add` | mutation / headless | PASS-LIVE | Added FormSubmit/Spinner and instance at revisions 159 and 493; v4/v5 helper read-back passed Oracle, temporary route/master cleanup completed at 494–495 |
| `forms.field.update` | mutation / headless | PASS-LIVE | Updated text field label/name/placeholder/required at revision 557; source read-back passed |
| `forms.state.map` | mutation / headless | PASS-LIVE | Mapped loading/success/error states at revision 160; `forms.state.get` read back the mapping |
| `forms.state.get` | read / headless | PASS-LIVE | Valid submit-button mapping read back at revision 160 |

## code (17)

| Operation | Kind / environment | Status | Evidence |
|---|---|---|---|
| `codeComponents.create` | mutation / headless | PASS-LIVE | Fixed size annotations in meta example; created `McpAuditWidget` at revision 142 |
| `codeComponents.get` | read / headless | PASS-LIVE | Read back `McpAuditWidget` after live create |
| `codeComponents.list` | read / headless | PASS-LIVE | Listed code components |
| `codeFiles.list` | read / headless | PASS-LIVE | Listed project files |
| `codeFiles.read` | read / headless | PASS-LIVE | Read back audit page source after form creation and button wiring |
| `codeFiles.search` | read / headless | PASS-LIVE | Searched project files |
| `codeFiles.submit` | mutation / headless | PASS-LIVE | CAS-protected comment round-trip on server `app/layout.tsx` at revisions 218/219; exact source restored |
| `overrides.create` | mutation / headless | PASS-LIVE | Created `overrides/McpAuditOverride.tsx` at revision 143; validator no longer applies page rules |
| `overrides.list` | read / headless | PASS-LIVE | Listed newly created audit override at revision 143 |
| `overrides.set` | mutation / headless | PASS-LIVE | Attached `withAuditHover` to `McpAuditButton` at revision 570 and read back |
| `overrides.remove` | mutation / headless | PASS-LIVE | Removed test attachment at revision 571 and confirmed absent |
| `customCode.get` | read / headless | PASS-LIVE | Read custom code config |
| `customCode.set` | mutation / headless | PASS-LIVE | Set temporary headStart meta at rev 637; get read it back; restored null at rev 638 and verified |
| `redirects.list` | read / headless | PASS-LIVE | Listed redirects |
| `redirects.add` | mutation / headless | PASS-LIVE | Added `/legacy-mcp-audit` → `/mcp-audit` at revision 572; listed then removed at 573 |
| `redirects.remove` | mutation / headless | PASS-LIVE | Removed both exact temporary redirects at rev 641; redirects.list returned empty |
| `redirects.reorder` | mutation / headless | PASS-LIVE | Reversed two temporary redirect IDs at rev 640; redirects.list confirmed the new order |

## projects (3)

| Operation | Kind / environment | Status | Evidence |
|---|---|---|---|
| `projects.duplicate` | mutation / headless | PASS-LIVE | Independent stdio MCP duplicated the exact temporary empty seed; retained target healthy with 0 files |
| `projects.backup.export` | read / headless | PASS-LIVE | Exported audit-branch backup without restoring |
| `projects.backup.restore` | mutation / headless | PASS-LIVE | Exact compressed backup round-trip at revision 585; audit branch retained, main unchanged |

## history (2)

| Operation | Kind / environment | Status | Evidence |
|---|---|---|---|
| `history.undo` | mutation / headless | PASS-LIVE | Undid `tokens.set` at rev 648; tokens.get returned null, proving source restore |
| `history.redo` | mutation / headless | PASS-LIVE | Redid the exact token change at rev 649; tokens.get returned `#13579B`, then token removed at 650 |

## branches (6)

| Operation | Kind / environment | Status | Evidence |
|---|---|---|---|
| `branches.list` | read / headless | PASS-LIVE | main + audit branch returned |
| `branches.create` | mutation / headless | PASS-LIVE | Created disposable smoke branch from the audit branch at revision 582; deleted after switch test |
| `branches.switch` | mutation / headless | PASS-LIVE | Switched audit → disposable branch → audit at revisions 583–584; after live coverage, restored active pointer to `main` at revision 656 |
| `branches.review` | read / headless | PASS-LIVE | Reviewed audit branch against main |
| `branches.apply` | mutation / headless | PASS-LIVE | On task-owned blank duplicate, merged a branch-only token into main at rev 4; token read-back matched; backup restore at rev 5 returned to empty main and removed probe branch |
| `branches.delete` | mutation / headless | PASS-LIVE | Deleted disposable smoke branch at revision 584 and exact temporary coverage branch at revision 654; `main` remained unchanged |

## folders (3)

| Operation | Kind / environment | Status | Evidence |
|---|---|---|---|
| `folders.list` | read / headless | PASS-LIVE | Listed project folders |
| `folders.create` | mutation / headless | PASS-LIVE | Created a temporary Components folder at rev 644 on scratch branch |
| `folders.moveItem` | mutation / headless | PASS-LIVE | Moved synthetic metadata item into folder at rev 645 (count 1), back to root at 646 (count 0) |

## comments (3)

| Operation | Kind / environment | Status | Evidence |
|---|---|---|---|
| `comments.list` | read / headless | PASS-LIVE | Listed branch comments |
| `comments.create` | mutation / headless | PASS-LIVE | Created task-owned resolved verification note at revision 576 |
| `comments.resolve` | mutation / headless | PASS-LIVE | Resolved the verification note at revision 577; list confirmed `resolved: true` |

## guides (2)

| Operation | Kind / environment | Status | Evidence |
|---|---|---|---|
| `guides.get` | read / headless | PASS-LIVE | Read page guide definitions |
| `guides.set` | mutation / headless | PASS-LIVE | Set/read/cleared 3 guides at revisions 580–581 after Oracle fix; clean diagnostics, 25 files |

## plugins (5)

| Operation | Kind / environment | Status | Evidence |
|---|---|---|---|
| `plugins.list` | read / headless | PASS-LIVE | Read-back included `McpAuditPlugin`; plugin was not launched |
| `plugins.write` | mutation / headless | PASS-LIVE | Created `plugins/McpAuditPlugin.tsx` at revision 144; plugin-specific validator passed |
| `plugins.data.get` | read / headless | PASS-LIVE | Read plugin data |
| `plugins.data.set` | mutation / headless | PASS-LIVE | Stored structured probe value at rev 651; plugins.data.get read it back exactly on scratch branch |
| `plugins.secrets.request` | service / service | BLOCKED-SAFETY | Intentionally not invoked: would request/store credentials; outside authorized test scope |

## marketplace (3)

| Operation | Kind / environment | Status | Evidence |
|---|---|---|---|
| `marketplace.browse` | service / service | PASS-LIVE | Queried catalog for button; returned `HeroSection` without importing or publishing |
| `marketplace.import` | mutation / headless | PASS-LIVE | Imported the approved HeroSection listing at rev 652; source read-back confirmed the local proxy; operation does not fetch/execute remote code |
| `marketplace.publishListing` | service / service | BLOCKED-SAFETY | Intentionally not invoked: publishes externally to the marketplace |

## skills (2)

| Operation | Kind / environment | Status | Evidence |
|---|---|---|---|
| `skills.list` | read / headless | PASS-LIVE | Listed project skill files |
| `skills.save` | mutation / headless | PASS-LIVE | Saved temporary skill at revision 578, then `history.undo` removed it at 579; list is empty |

## export (2)

| Operation | Kind / environment | Status | Evidence |
|---|---|---|---|
| `export.formats` | read / headless | PASS-LIVE | Listed export formats |
| `export.generate` | read / headless | PASS-LIVE | Generated project export artifact on isolated branch |

## publish (4)

| Operation | Kind / environment | Status | Evidence |
|---|---|---|---|
| `publish.preflight` | read / headless | PASS-LIVE | Ran read-only preflight; no deployment invoked |
| `preview.build` | read / headless | PASS-LIVE | Live headless preview build succeeded on audit branch |
| `publish.deploy` | mutation / service | BLOCKED-SAFETY | Intentionally not invoked: deploys externally; user said they will publish manually |
| `publish.status` | read / headless | PASS-LIVE | Read deployment status |

## observation (6)

| Operation | Kind / environment | Status | Evidence |
|---|---|---|---|
| `observe.selection` | observation / headless | PASS-LIVE | Fresh standalone MCP read selected IDs and rendered bounds from Builder bridge |
| `observe.layout` | observation / headless | PASS-LIVE | Fresh standalone MCP returned ready layout, rects, and computed box/flex styles |
| `observe.visuals` | observation / headless | PASS-LIVE | Fresh standalone MCP returned ready rect and computed typography/color styles |
| `observe.composition` | observation / headless | PASS-LIVE | Returned source-tree composition for the 7-node audit page |
| `observe.audit` | observation / headless | PASS-LIVE | Ready at revision 614; no honeypot finding, four findings only on visible fixture controls/text |
| `observe.screenshot` | observation / headless | PASS-LIVE | Requested `mcp-audit` heading PNG: reported viewport dimensions 1200×37 match PNG IHDR at 10% canvas zoom |

## verify (1)

| Operation | Kind / environment | Status | Evidence |
|---|---|---|---|
| `verify.effect` | read / headless | PASS-LIVE | Ran effect verifier on audit-button |

## diagnostics (1)

| Operation | Kind / environment | Status | Evidence |
|---|---|---|---|
| `diagnostics.projectCheck` | read / headless | PASS-LIVE | Fresh independent stdio checks: revision 618 and post-build audit-branch check clean across 25 files; pre-cleanup scratch branch clean across 29 files; zero drift/blocking violations, broken imports, missing assets, or broken links |
