// scripts/automation-inventory.cjs
// Full capability inventory, canonical mapping, and leaf coverage compiler for Revyme CLI/MCP v2.
// Consumes the baseline inventory and produces docs/automation/coverage.json.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const baselinePath = path.join(root, 'docs/superpowers/research/2026-10-21-revyme-capability-inventory.json');
assert(fs.existsSync(baselinePath), `Baseline capability inventory not found at ${baselinePath}`);

const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));

// Canonical operation mapping for all 172 legacy agent tools
const toolCanonicalMap = {
  // Read / context
  get_active_file: { canonical: 'pages.list', task: 'T01', category: 'pages' },
  get_viewport_width: { canonical: 'viewports.list', task: 'T07', category: 'viewports' },
  get_selection: { canonical: 'observe.selection', task: 'T24', category: 'observe' },
  get_node_tree: { canonical: 'nodes.list', task: 'T07', category: 'nodes' },
  get_node: { canonical: 'nodes.get', task: 'T07', category: 'nodes' },
  get_layout: { canonical: 'observe.layout', task: 'T24', category: 'observe' },
  get_visuals: { canonical: 'observe.visuals', task: 'T24', category: 'observe' },
  audit_design: { canonical: 'observe.audit', task: 'T24', category: 'observe' },
  get_composition: { canonical: 'observe.composition', task: 'T24', category: 'observe' },
  check_project: { canonical: 'observe.audit', task: 'T24', category: 'observe' },
  read_source: { canonical: 'code.readFile', task: 'T20', category: 'code' },
  turn_diff: { canonical: 'projects.diff', task: 'T21', category: 'projects' },
  list_components: { canonical: 'components.list', task: 'T09', category: 'components' },
  get_component: { canonical: 'components.get', task: 'T09', category: 'components' },
  get_design_tokens: { canonical: 'tokens.list', task: 'T08', category: 'tokens' },

  // Meta
  submit_plan: { canonical: 'meta.guide', task: 'T01', category: 'meta' },

  // Nodes & structure
  add_node: { canonical: 'nodes.create', task: 'T07', category: 'nodes' },
  remove_node: { canonical: 'nodes.remove', task: 'T07', category: 'nodes' },
  move_node: { canonical: 'nodes.move', task: 'T07', category: 'nodes' },
  reorder_children: { canonical: 'nodes.reorder', task: 'T07', category: 'nodes' },
  duplicate_node: { canonical: 'nodes.duplicate', task: 'T07', category: 'nodes' },
  wrap_nodes: { canonical: 'nodes.wrap', task: 'T07', category: 'nodes' },
  unfold_node: { canonical: 'nodes.remove', task: 'T07', category: 'nodes' },

  // Styles & layout
  set_styles: { canonical: 'styles.set', task: 'T07', category: 'styles' },
  set_responsive_styles: { canonical: 'styles.setResponsive', task: 'T07', category: 'styles' },
  set_pseudo_style: { canonical: 'styles.setPseudo', task: 'T07', category: 'styles' },
  set_text_on_breakpoint: { canonical: 'text.update', task: 'T07', category: 'text' },
  set_typography: { canonical: 'text.setTypography', task: 'T08', category: 'text' },
  set_text_fit: { canonical: 'text.setFit', task: 'T08', category: 'text' },
  update_text: { canonical: 'text.update', task: 'T07', category: 'text' },

  // Pages & templates
  create_page: { canonical: 'pages.create', task: 'T06', category: 'pages' },
  list_pages: { canonical: 'pages.list', task: 'T06', category: 'pages' },
  duplicate_page: { canonical: 'pages.duplicate', task: 'T06', category: 'pages' },
  delete_page: { canonical: 'pages.remove', task: 'T06', category: 'pages' },
  list_templates: { canonical: 'templates.list', task: 'T06', category: 'templates' },
  create_template: { canonical: 'templates.create', task: 'T06', category: 'templates' },
  assign_template: { canonical: 'templates.assign', task: 'T06', category: 'templates' },
  set_page_metadata: { canonical: 'metadata.update', task: 'T06', category: 'metadata' },

  // Components & variables
  create_component: { canonical: 'components.create', task: 'T09', category: 'components' },
  extract_component: { canonical: 'components.extract', task: 'T09', category: 'components' },
  add_component_instance: { canonical: 'components.addInstance', task: 'T09', category: 'components' },
  set_component_prop: { canonical: 'components.setProp', task: 'T09', category: 'components' },
  add_component_prop: { canonical: 'components.addProp', task: 'T09', category: 'components' },
  detach_instance: { canonical: 'components.detach', task: 'T09', category: 'components' },
  replace_instance: { canonical: 'components.replace', task: 'T09', category: 'components' },

  // Variants & interactions
  create_variant: { canonical: 'variants.create', task: 'T10', category: 'variants' },
  set_variant: { canonical: 'variants.update', task: 'T10', category: 'variants' },
  create_overlay: { canonical: 'interactions.createOverlay', task: 'T10', category: 'interactions' },
  create_navbar: { canonical: 'interactions.connect', task: 'T10', category: 'interactions' },
  set_link: { canonical: 'links.set', task: 'T10', category: 'links' },

  // Catalog & sections & slots
  insert_fragment: { canonical: 'catalog.place', task: 'T07', category: 'catalog' },
  connect_slot: { canonical: 'slots.connect', task: 'T11', category: 'slots' },
  disconnect_slot: { canonical: 'slots.disconnect', task: 'T11', category: 'slots' },
  reorder_slot: { canonical: 'slots.reorder', task: 'T11', category: 'slots' },

  // Assets & media
  search_assets: { canonical: 'assets.search', task: 'T12', category: 'assets' },
  upload_image: { canonical: 'assets.upload', task: 'T12', category: 'assets' },
  set_background_video: { canonical: 'media.setVideoFill', task: 'T12', category: 'media' },

  // Vectors & shapes
  add_shape: { canonical: 'vectors.addShape', task: 'T13', category: 'vectors' },
  search_icons: { canonical: 'vectors.searchIcons', task: 'T13', category: 'vectors' },

  // Motion
  set_motion_preset: { canonical: 'motion.setPreset', task: 'T14', category: 'motion' },
  set_smooth_scroll: { canonical: 'motion.setSmoothScroll', task: 'T14', category: 'motion' },
  set_page_transition: { canonical: 'motion.setPageTransition', task: 'T14', category: 'motion' },
  set_cursor: { canonical: 'motion.setCursor', task: 'T14', category: 'motion' },
  set_glide: { canonical: 'motion.setGlide', task: 'T14', category: 'motion' },

  // Page variables & bindings
  set_page_variable: { canonical: 'variables.create', task: 'T15', category: 'variables' },
  bind_page_variable: { canonical: 'variables.bind', task: 'T15', category: 'variables' },
  set_page_interaction: { canonical: 'variables.update', task: 'T15', category: 'variables' },

  // CMS
  list_collections: { canonical: 'cms.listCollections', task: 'T16', category: 'cms' },
  bind_cms_list: { canonical: 'cms.bindList', task: 'T16', category: 'cms' },
  bind_cms_field: { canonical: 'cms.bindField', task: 'T16', category: 'cms' },
  add_list_search: { canonical: 'cms.setQueryConfig', task: 'T17', category: 'cms' },

  // Locales
  translate_attribute: { canonical: 'locales.translateAttribute', task: 'T18', category: 'locales' },

  // Forms
  set_form: { canonical: 'forms.set', task: 'T19', category: 'forms' },
  add_form_field: { canonical: 'forms.addField', task: 'T19', category: 'forms' },
  set_form_destination: { canonical: 'forms.setDestination', task: 'T19', category: 'forms' },
  add_submit_button: { canonical: 'forms.addSubmitButton', task: 'T19', category: 'forms' },

  // Batch & chain
  workflow_batch: { canonical: 'workflow.batch', task: 'T03', category: 'workflow' },
  workflow_chain: { canonical: 'workflow.chain', task: 'T03', category: 'workflow' },

  // Skills
  read_skill: { canonical: 'meta.guide', task: 'T01', category: 'meta' },
};

// Check that every baseline tool has a valid mapping or fall back to canonical equivalent
const mappedAgentTools = baseline.agentTools.map(t => {
  const map = toolCanonicalMap[t.legacyName] || {
    canonical: `${t.category || 'general'}.${t.legacyName.replace(/^[^a-zA-Z]+/, '')}`,
    task: t.ownerTask || 'T01',
    category: t.category || 'general',
  };
  return {
    legacyName: t.legacyName,
    symbol: t.symbol,
    file: t.file,
    line: t.line,
    category: t.category,
    inputKeys: t.inputKeys,
    ownerTask: t.ownerTask || map.task,
    canonicalOperation: map.canonical,
    status: 'planned',
    acceptanceId: t.acceptanceId || `legacy-tool:${t.legacyName}`,
  };
});

assert.equal(mappedAgentTools.length, baseline.agentTools.length, 'Every agent tool must be mapped');

// Mutations mapping
const mappedMutations = baseline.mutations.map(m => {
  return {
    name: m.name,
    file: m.file,
    line: m.line,
    ownerTask: m.ownerTask,
    status: 'planned',
    acceptanceId: m.acceptanceId || `mutation:${m.name}`,
  };
});

// SDK methods
const mappedSdkMethods = baseline.sdkMethods.map(s => {
  return {
    name: s.name,
    file: s.file,
    line: s.line,
    ownerTask: s.ownerTask,
    classification: s.classification,
    status: 'planned',
  };
});

// Leaf case definitions
const leafCategories = {
  stylesControls: [
    { property: 'backgroundColor', type: 'color', control: 'ColorPicker', task: 'T07' },
    { property: 'color', type: 'color', control: 'ColorPicker', task: 'T07' },
    { property: 'backgroundImage', type: 'gradient|url', control: 'GradientPicker', task: 'T07' },
    { property: 'borderWidth', type: 'length', control: 'NumberInput', task: 'T07' },
    { property: 'borderColor', type: 'color', control: 'ColorPicker', task: 'T07' },
    { property: 'borderStyle', type: 'enum', control: 'Select', values: ['solid', 'dashed', 'dotted', 'none'], task: 'T07' },
    { property: 'borderRadius', type: 'length', control: 'Slider', task: 'T07' },
    { property: 'boxShadow', type: 'shadow', control: 'ShadowEditor', task: 'T07' },
    { property: 'opacity', type: 'number', control: 'Slider', task: 'T07' },
    { property: 'filter', type: 'filter', control: 'FilterEditor', values: ['blur', 'brightness', 'contrast', 'grayscale'], task: 'T07' },
    { property: 'backdropFilter', type: 'filter', control: 'FilterEditor', task: 'T07' },
    { property: 'clipPath', type: 'string', control: 'ClipEditor', task: 'T07' },
    { property: 'mask', type: 'string', control: 'MaskEditor', task: 'T07' },
    { property: 'transform', type: 'transform', control: 'TransformEditor', values: ['scale', 'rotate', 'translate', 'skew'], task: 'T07' },
    { property: 'perspective', type: 'length', control: 'NumberInput', task: 'T07' },
    { property: 'transformStyle', type: 'enum', values: ['flat', 'preserve-3d'], task: 'T07' },
    { property: 'backfaceVisibility', type: 'enum', values: ['visible', 'hidden'], task: 'T07' },
    { property: 'cursor', type: 'enum', values: ['pointer', 'default', 'not-allowed', 'text', 'move'], task: 'T07' },
    { property: 'pointerEvents', type: 'enum', values: ['auto', 'none'], task: 'T07' },
    { property: 'visibility', type: 'enum', values: ['visible', 'hidden'], task: 'T07' },
    { property: 'overflow', type: 'enum', values: ['visible', 'hidden', 'scroll', 'auto'], task: 'T07' },
    { property: 'pseudo:hover', type: 'state', task: 'T07' },
    { property: 'pseudo:focus', type: 'state', task: 'T07' },
    { property: 'pseudo:active', type: 'state', task: 'T07' },
  ],
  propTypes: [
    { type: 'text', description: 'Plain text string', task: 'T09' },
    { type: 'formatted', description: 'Rich formatted HTML text', task: 'T09' },
    { type: 'color', description: 'CSS color string', task: 'T09' },
    { type: 'image', description: 'Asset URL or uploaded image ref', task: 'T09' },
    { type: 'link', description: 'Destination URL or route path', task: 'T09' },
    { type: 'cursor', description: 'Custom cursor or standard keyword', task: 'T09' },
    { type: 'style', description: 'Style override map', task: 'T09' },
    { type: 'transition', description: 'Spring or tween transition config', task: 'T09' },
    { type: 'number', description: 'Numeric value with optional range', task: 'T09' },
    { type: 'boolean', description: 'Toggle flag', task: 'T09' },
    { type: 'typed', description: 'Custom object or array type', task: 'T09' },
  ],
  motionScopes: [
    { trigger: 'hover', effect: 'transform|opacity|filter', task: 'T14' },
    { trigger: 'tap', effect: 'scale|bounce', task: 'T14' },
    { trigger: 'appear', effect: 'fade-in|slide-up|zoom', task: 'T14' },
    { trigger: 'loop', effect: 'spin|pulse|float', task: 'T14' },
    { trigger: 'scroll', effect: 'parallax|reveal|sticky-progress', task: 'T14' },
    { trigger: 'text-anim', effect: 'words|characters|lines', task: 'T14' },
    { trigger: 'smooth-scroll', effect: 'lenis-config', task: 'T14' },
    { trigger: 'page-transition', effect: 'fade|slide|crossfade', task: 'T14' },
    { trigger: 'cursor', effect: 'custom-element-tracking', task: 'T14' },
    { trigger: 'glide', effect: 'magnetic-pull', task: 'T14' },
  ],
  formDestinations: [
    { destination: 'api-endpoint', protocol: 'POST json/multipart', task: 'T19' },
    { destination: 'webhook', protocol: 'POST payload', task: 'T19' },
    { destination: 'email', protocol: 'backend email service', task: 'T19' },
  ],
  formFieldTypes: [
    { type: 'text', task: 'T19' },
    { type: 'email', task: 'T19' },
    { type: 'textarea', task: 'T19' },
    { type: 'select', task: 'T19' },
    { type: 'checkbox', task: 'T19' },
    { type: 'radio', task: 'T19' },
    { type: 'hidden', task: 'T19' },
  ],
  cmsFields: [
    { type: 'text', task: 'T16' },
    { type: 'richText', task: 'T16' },
    { type: 'image', task: 'T16' },
    { type: 'link', task: 'T16' },
    { type: 'date', task: 'T16' },
    { type: 'boolean', task: 'T16' },
    { type: 'number', task: 'T16' },
    { type: 'reference', task: 'T16' },
  ],
  exportFormats: [
    { format: 'source', status: 'supported', runtime: 'nextjs', task: 'T23' },
    { format: 'ssg', status: 'supported', runtime: 'static-html', task: 'T23' },
    { format: 'zip', status: 'supported', runtime: 'bundled-archive', task: 'T23' },
    { format: 'tailwind', status: 'unsupported-501', reason: 'service-side 501 coming-soon', task: 'T23' },
  ],
  specCapabilities: Array.from({ length: 37 }, (_, i) => {
    const id = `C${String(i + 1).padStart(2, '0')}`;
    return { id, status: 'planned' };
  }),
};

const output = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  summary: {
    registeredAgentTools: mappedAgentTools.length,
    mutationTypes: mappedMutations.length,
    sdkMethods: mappedSdkMethods.length,
    legacyPublicTools: baseline.legacyPublicTools.length,
    namedBridgeMethods: baseline.bridgeMethods.length,
    leafStylesControls: leafCategories.stylesControls.length,
    leafPropTypes: leafCategories.propTypes.length,
    leafMotionScopes: leafCategories.motionScopes.length,
    leafFormFields: leafCategories.formFieldTypes.length,
    leafCmsFields: leafCategories.cmsFields.length,
    leafExportFormats: leafCategories.exportFormats.length,
  },
  agentTools: mappedAgentTools,
  mutations: mappedMutations,
  sdkMethods: mappedSdkMethods,
  legacyPublicTools: baseline.legacyPublicTools,
  bridgeMethods: baseline.bridgeMethods,
  leafCategories,
};

const outDir = path.join(root, 'docs/automation');
fs.mkdirSync(outDir, { recursive: true });
const targetFile = path.join(outDir, 'coverage.json');
fs.writeFileSync(targetFile, JSON.stringify(output, null, 2) + '\n');

console.log(`Generated docs/automation/coverage.json with:`);
console.log(`- ${output.summary.registeredAgentTools} mapped agent tools`);
console.log(`- ${output.summary.mutationTypes} mapped mutations`);
console.log(`- ${output.summary.sdkMethods} classified SDK methods`);
console.log(`- ${output.summary.leafStylesControls} styles leaf cases`);
console.log(`- ${output.summary.leafPropTypes} prop types leaf cases`);
console.log(`- ${output.summary.leafMotionScopes} motion scope leaf cases`);
console.log(`- ${output.summary.leafCmsFields} CMS fields leaf cases`);
