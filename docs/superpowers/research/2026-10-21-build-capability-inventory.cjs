// Read-only source inventory. Writes only the adjacent research JSON artifact.
// Run from the repository root: node docs/superpowers/research/2026-10-21-build-capability-inventory.cjs
const ts = require('typescript');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = process.cwd();
const cache = new Map();
function load(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file);
  const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const m = { file, sf, vars: new Map(), imports: new Map(), forwards: new Map() };
  cache.set(file, m);
  for (const s of sf.statements) {
    if (ts.isVariableStatement(s)) for (const d of s.declarationList.declarations)
      if (ts.isIdentifier(d.name) && d.initializer) m.vars.set(d.name.text, d.initializer);
    if (ts.isImportDeclaration(s) && s.importClause?.namedBindings && ts.isNamedImports(s.importClause.namedBindings) && s.moduleSpecifier.text.startsWith('.'))
      for (const n of s.importClause.namedBindings.elements) m.imports.set(n.name.text, [path.resolve(path.dirname(file), s.moduleSpecifier.text) + '.ts', n.propertyName?.text ?? n.name.text]);
    if (ts.isExportDeclaration(s) && s.moduleSpecifier?.text.startsWith('.') && s.exportClause && ts.isNamedExports(s.exportClause))
      for (const n of s.exportClause.elements) m.forwards.set(n.name.text, [path.resolve(path.dirname(file), s.moduleSpecifier.text) + '.ts', n.propertyName?.text ?? n.name.text]);
  }
  return m;
}
function resolve(file, name, visited = new Set()) {
  const key = file + '#' + name;
  assert(!visited.has(key), `Unresolved cycle: ${key}`);
  const seen = new Set(visited).add(key), m = load(file);
  if (m.vars.has(name)) return evaluate(m, m.vars.get(name), name, seen);
  const target = m.imports.get(name) ?? m.forwards.get(name);
  assert(target, `Unresolved symbol: ${key}`);
  return resolve(...target, seen);
}
function evaluate(m, node, symbol, seen) {
  while (ts.isAsExpression(node) || ts.isParenthesizedExpression(node) || ts.isSatisfiesExpression(node)) node = node.expression;
  if (ts.isIdentifier(node)) return resolve(m.file, node.text, seen);
  if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap(n => evaluate(m, ts.isSpreadElement(n) ? n.expression : n, symbol, seen));
  assert(ts.isObjectLiteralExpression(node), `Unsupported registration: ${symbol}`);
  const get = key => node.properties.find(p => p.name?.getText(m.sf) === key);
  const name = get('name'), schema = get('inputSchema');
  assert(name && ts.isPropertyAssignment(name) && ts.isStringLiteralLike(name.initializer), `Nonliteral tool: ${symbol}`);
  return [{ legacyName: name.initializer.text, symbol, file: path.relative(root, m.file), line: m.sf.getLineAndCharacterOfPosition(node.getStart(m.sf)).line + 1,
    category: get('category')?.initializer?.text ?? 'unknown',
    inputKeys: schema && ts.isPropertyAssignment(schema) && ts.isObjectLiteralExpression(schema.initializer) ? schema.initializer.properties.map(p => p.name?.getText(m.sf)).filter(Boolean) : [] }];
}
const fileTasks = {
  'action-layer': 7, assets: 12, batch: 3, branches: 21, 'built-ins': 11, chain: 3, 'cms-more': 16, cms: 16,
  'components-more': 10, i18n: 18, icons: 13, images: 12, 'insert-fragment': 7, 'layout-more': 7, links: 10,
  'manage-component-variant': 10, meta: 3, 'motion-more': 14, 'motion-preset': 14, overrides: 20,
  'pages-more': 6, plugins: 22, 'project-skills': 22, screenshot: 24, 'semantic-property': 7,
  'semantic-structure': 7, 'set-page-interaction': 15, 'set-page-variable': 15, 'set-page': 6,
  skills: 1, slots: 11, tokens: 8, 'verify-effect': 24, viewports: 7, 'whole-file': 20,
};
const toolTasks = {};
function toolsAt(task, names) { for (const name of names.split(' ')) toolTasks[name] = task; }
toolsAt(14, 'set_motion_preset set_smooth_scroll set_page_transition set_cursor set_glide');
toolsAt(10, 'create_overlay set_variant create_variant create_navbar set_link');
toolsAt(9, 'create_component extract_component add_component_instance set_component_prop detach_instance add_component_prop');
toolsAt(16, 'bind_cms_list bind_cms_field list_collections');
toolsAt(19, 'set_form add_form_field set_form_destination add_submit_button');
toolsAt(6, 'create_page list_pages list_templates create_template assign_template');
toolsAt(7, 'get_viewport_width get_node_tree get_node set_text_on_breakpoint set_pseudo_style');
toolsAt(8, 'set_typography set_text_fit get_design_tokens');
toolsAt(18, 'translate_attribute'); toolsAt(12, 'set_background_video');
toolsAt(13, 'add_shape'); toolsAt(17, 'add_list_search');
toolsAt(24, 'get_selection get_layout get_visuals audit_design get_composition check_project');
toolsAt(1, 'get_active_file'); toolsAt(9, 'list_components get_component'); toolsAt(20, 'read_source'); toolsAt(21, 'turn_diff');
const tools = resolve(path.resolve('src/ai/agent/tools/index.ts'), 'ALL_TOOLS').map(t => {
  const task = toolTasks[t.legacyName] ?? fileTasks[path.basename(t.file, '.ts')];
  assert(task, `Unassigned tool: ${t.legacyName}`);
  return { ...t, ownerTask: `T${String(task).padStart(2, '0')}`, status: 'planned', acceptanceId: `legacy-tool:${t.legacyName}` };
});
assert.equal(new Set(tools.map(t => t.legacyName)).size, tools.length, 'Duplicate tools');
const mutationAssignments = new Map();
function mutationsAt(task, names) { for (const name of names.split(' ')) { assert(!mutationAssignments.has(name), `Duplicate mutation owner: ${name}`); mutationAssignments.set(name, task); } }
mutationsAt(7, 'updateStyles updateContainerStyle clearContainerStyles stripPositionalTileOverrides autoSizeInstanceDim ensureInstanceHugMarker addNode addCanvasNode reorder move removeNode renameNode updateText updateChildrenHTML stripInlineSpanStyle updateTextOverride removeTextOverride setResponsiveAttr setResponsiveAttrBase updateHtmlAttrs changeTag');
mutationsAt(10, 'updateVariantStyle setVariantVisibility setConditionalOrder setConditionalStyle updateVariantText setVariantAttr setChildEventFire removeChildEventFire createOverlay cloneCanvasOverlay updateOverlayPosition updateOverlayConfig updateOverlayTrigger removeOverlay addCloseOverlay removeCloseOverlay setCloseOverlayDelay setInstanceEventDelay bindInstanceEventCloseOverlay unbindInstanceEvent convertToMotionLink syncLinkHandler');
mutationsAt(18, 'updateLocaleStyle updateLocaleInstanceProp');
mutationsAt(9, 'updateInstancePropBase detachTextVariableForVariant bindTextVariableForVariant setFormattedTextBranch createVariable createConditionalVariable setVariantBorderVariable setVariantInlineVariable removeVariantStyleVariable setComponentPropDefault setComponentPropDescription createTypedVariable setComponentPropOptions setComponentPropType deleteComponentVariable renameComponentVariable setComponentPropLabel setComponentPropVariantOf setComponentPropNumberMeta removeVariable createTransitionVariable createTextVariable bindTextVariable removeTextVariable createLinkAttrVariable removeLinkAttrVariable hoistInstanceProp replaceComponentInstance');
mutationsAt(15, 'createTextPageVariable removeTextPageVariable addPageVariable updatePageVariable removePageVariable bindStylePageVariable unbindStylePageVariable bindResponsiveStyleVariable unbindResponsiveStyleVariable setResponsiveStyleBase bindResponsiveTextVariable unbindResponsiveTextVariable setResponsiveTextBase ensureTemplateVarParam addPageInteraction removePageInteraction bindTextExpression bindHrefExpression bindSrcExpression unbindTextExpression unbindHrefExpression unbindSrcExpression clearVarOrphan');
mutationsAt(19, 'setFormStateMapping updateSelectCaretRule');
mutationsAt(7, 'updateBorderOverlay removeBorderOverlay updateCssHover removeCssHover updatePseudoStyle removePseudo');
mutationsAt(11, 'connectSlot disconnectSlot reorderSlot');
mutationsAt(13, 'updateSvgAttrs addSvgChild removeSvgChild replaceSvgInner setSketchAnim removeSketchAnim injectSvgDataId');
mutationsAt(12, 'convertDivToImage setVideoFill removeVideoFill');
mutationsAt(14, 'updateKeyframes removeKeyframes setSmoothScroll updateMotionProp removeMotionProp removeMotionScopeBranch updateScrollAnim updateScrollDirection removeScrollDirection updateScrollSpeed removeScrollSpeed updateLoop removeLoop updateScrollVariant removeScrollVariant updateInstanceFx removeInstanceFx updateScrollFx removeScrollFx updateGlide removeGlide removeScrollSpeedScopeBranch removeScrollAnim addTextAnim updateTextAnim removeTextAnim');
mutationsAt(16, 'duplicateCollectionToCanvas createCollectionList bindField unbindField setVariantCmsText setVariantCmsStyle updateCollectionConfig setListResponsiveConfig setPagination removePagination bindToCmsCollection unbindFromCmsCollection changeCollectionSource unbindStyleFromMap bindPropToMap unbindPropFromMap clearCmsOrphan setCmsNavHref');
mutationsAt(17, 'updateCollectionQueryConfig addCollectionSearchField setSearchInputVariable');
mutationsAt(8, 'addPresetToken updatePresetToken removePresetToken setDarkTokenValue wrapFitText unwrapFitText');
mutationsAt(6, 'updateMetadata updateSiteConfig'); mutationsAt(20, 'setCodeOverrides writeFile deleteFile');
const mf = 'src/code/mutation/mutation-queue.ts', ms = load(mf).sf;
const alias = ms.statements.find(s => ts.isTypeAliasDeclaration(s) && s.name.text === 'Mutation');
const literalValues = n => ts.isLiteralTypeNode(n) && ts.isStringLiteral(n.literal) ? [n.literal.text] : ts.isUnionTypeNode(n) ? n.types.flatMap(literalValues) : [];
const mutations = alias.type.types.flatMap(n => {
  if (!ts.isTypeLiteralNode(n)) return [];
  const p = n.members.find(p => p.name?.getText(ms) === 'type');
  if (!p) return [];
  return literalValues(p.type).map(name => { const task = mutationAssignments.get(name); assert(task, `Unassigned mutation: ${name}`); return { name, file: mf, line: ms.getLineAndCharacterOfPosition(n.getStart(ms)).line + 1, ownerTask: `T${String(task).padStart(2, '0')}`, status: 'planned', acceptanceId: `mutation:${name}` }; });
});
const sdkTasks = { animations: 14, assets: 12, canvas: 7, cms: 16, 'code-files': 20, components: 9, 'custom-code': 20, fonts: 8, localization: 18, meta: 1, network: 22, pages: 6, permissions: 22, 'plugin-data': 22, presets: 8, redirects: 20, secrets: 22, sketches: 13, subscribe: 22, text: 7, ui: 22, variables: 15, vectors: 13 };
const sdk = [];
for (const filename of fs.readdirSync('src/plugins/sdk-impl').filter(n => n.endsWith('.ts') && !n.includes('.test.') && !n.startsWith('_'))) {
  const file = 'src/plugins/sdk-impl/' + filename, source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/^\s*['"]([a-zA-Z][\w.-]+)['"]\s*:\s*(?:async|\()/gm)) {
    const task = sdkTasks[path.basename(filename, '.ts')]; assert(task, file);
    sdk.push({ name: match[1], file, line: source.slice(0, match.index).split('\n').length, ownerTask: `T${String(task).padStart(2, '0')}`, classification: filename === 'sketches.ts' || match[1] === 'animations.listGsap' ? 'retired-sdk-compatibility' : filename === 'ui.ts' ? 'editor-ui-adapter' : 'product-capability', status: 'planned' });
  }
}
const publicOwners = { revyme_help:1, revyme_capture_screenshot:24, revyme_get_context:1, revyme_inspect_node:7, revyme_search_project:20, revyme_read_file:20, revyme_list_files:20, revyme_submit_files:20, revyme_manage_presets:8, revyme_manage_cms:16, revyme_bind_expression:15, revyme_set_responsive_styles:7, revyme_agent_manifest:1, revyme_agent_tool:3, revyme_open_editor:24 };
const legacyPublicTools = [];
const publicFile = 'server/mcp-bridge.ts', publicSource = load(publicFile).sf;
function visitPublic(node) {
  if (ts.isObjectLiteralExpression(node)) {
    const name = node.properties.find(p => p.name?.getText(publicSource) === 'name');
    if (node.properties.some(p => p.name?.getText(publicSource) === 'inputSchema') && name && ts.isPropertyAssignment(name) && ts.isStringLiteralLike(name.initializer)) {
      const legacyName = name.initializer.text;
      const task = publicOwners[legacyName] ?? Number(tools.find(t => t.legacyName === legacyName.replace(/^revyme_/, ''))?.ownerTask.slice(1));
      assert(task, `Unassigned public tool: ${legacyName}`);
      legacyPublicTools.push({ legacyName, file:publicFile, line:publicSource.getLineAndCharacterOfPosition(node.getStart(publicSource)).line+1, ownerTask:`T${String(task).padStart(2,'0')}`, status:'planned' });
    }
  }
  ts.forEachChild(node, visitPublic);
}
visitPublic(publicSource);
const bridgeOwners = { getContext:1, listFiles:20, searchProject:20, uploadImage:12, managePresets:8, manageTranslations:18, manageCms:16, modifyFile:20, readFile:20, publishListing:22, insertMarketplaceComponent:22, createIconSet:13, saveDebugTrace:24, submitFiles:20 };
const bridgeMethods = [];
const bridgeFile = 'src/ai/mcp/bridge-client.ts', bm = load(bridgeFile), handler = bm.vars.get('bridgeHandlers');
assert(handler && ts.isObjectLiteralExpression(handler), 'Bridge handler registry changed');
for (const method of handler.properties) {
  if (!ts.isMethodDeclaration(method)) continue;
  const name = method.name.getText(bm.sf), task = bridgeOwners[name]; assert(task, `Unassigned bridge method: ${name}`);
  const actions = new Set([...method.getText(bm.sf).matchAll(/action\s*===\s*['"]([^'"]+)['"]/g)].map(m => m[1]));
  function scanActions(node) {
    if (ts.isVariableDeclaration(node) && /_ACTIONS$/.test(node.name.getText(bm.sf)) && node.initializer)
      for (const match of node.initializer.getText(bm.sf).matchAll(/['"]([a-z][a-z_]+)['"]/g)) actions.add(match[1]);
    ts.forEachChild(node, scanActions);
  }
  scanActions(method);
  bridgeMethods.push({ name, file:bridgeFile, line:bm.sf.getLineAndCharacterOfPosition(method.getStart(bm.sf)).line+1, ownerTask:`T${String(task).padStart(2,'0')}`, actions:[...actions].sort(), status:'planned' });
}
const output = { schemaVersion: 1, date: '2026-10-21', method: 'Static AST resolution of ALL_TOOLS, Mutation union, public MCP and named bridge methods; lexical SDK/action inventory. Does not prove runtime correctness or complete UI discovery.', summary: { registeredAgentTools: tools.length, uniqueAgentTools: new Set(tools.map(t => t.legacyName)).size, mutationTypes: mutations.length, sdkMethods: sdk.length, legacyPublicTools:legacyPublicTools.length, namedBridgeMethods:bridgeMethods.length }, agentTools: tools, mutations, sdkMethods: sdk, legacyPublicTools, bridgeMethods };
const target = path.join(__dirname, '2026-10-21-revyme-capability-inventory.json');
fs.writeFileSync(target, JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify(output.summary));
console.log('All inventoried agent tools and mutation types have an owner task; all statuses remain planned.');
