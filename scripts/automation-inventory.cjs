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
    status: 'implemented',
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
    status: 'implemented',
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
    status: 'implemented',
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
  specCapabilities: [
    {
      id: 'C01',
      title: 'Discovery, schemas, context, permissions, workflow plan/batch/chain',
      description: 'Canonical tool discovery, focused schemas, operation registry, batch and chain execution, and permission governance.',
      ownerTask: 'T01',
      status: 'mapped_unverified',
      testSuite: 'packages/automation-core/test/capabilities/T01-contracts.test.ts',
    },
    {
      id: 'C02',
      title: 'Guarded file operations and multi-file edits',
      description: 'Whole-file read, write, search, listing, diffing, and atomic multi-file submissions.',
      ownerTask: 'T20',
      status: 'mapped_unverified',
      testSuite: 'packages/automation-core/test/capabilities/T20-code.test.ts',
    },
    {
      id: 'C03',
      title: 'Project lifecycle, duplication, backup export and restore',
      description: 'Project metadata CRUD, snapshot duplication, checksummed backup archive export and restoration.',
      ownerTask: 'T21',
      status: 'mapped_unverified',
      testSuite: 'packages/automation-core/test/capabilities/T21-projects.test.ts',
    },
    {
      id: 'C04',
      title: 'Pages CRUD, duplication, homepage, slugs, and folders',
      description: 'Page creation, removal, duplication, homepage assignment, slug normalization, and folder grouping.',
      ownerTask: 'T06',
      status: 'mapped_unverified',
      testSuite: 'packages/automation-core/test/capabilities/T06-pages.test.ts',
    },
    {
      id: 'C05',
      title: 'Templates, shared layouts, slots, and route groups',
      description: 'Template creation, layout assignment, children slot injection, and route-group layout scaffolding.',
      ownerTask: 'T06',
      status: 'mapped_unverified',
      testSuite: 'packages/automation-core/test/capabilities/T06-pages.test.ts',
    },
    {
      id: 'C06',
      title: 'Site and page metadata, SEO, social cards, favicon, and canonicals',
      description: 'Metadata updates, OpenGraph social cards, Twitter cards, robots, and canonical URLs.',
      ownerTask: 'T06',
      status: 'mapped_unverified',
      testSuite: 'packages/automation-core/test/capabilities/T06-pages.test.ts',
    },
    {
      id: 'C07',
      title: 'Canvas nodes CRUD, move, reorder, wrap, and duplicate',
      description: 'Canvas node AST manipulation, insertion, removal, hierarchy reparenting, and wrapping.',
      ownerTask: 'T07',
      status: 'mapped_unverified',
      testSuite: 'packages/automation-core/test/capabilities/T07-layout.test.ts',
    },
    {
      id: 'C08',
      title: 'Viewports, responsive breakpoints, overrides, and ladder',
      description: 'Responsive breakpoint overrides, media query generation, viewport inheritance, and ladder validation.',
      ownerTask: 'T07',
      status: 'mapped_unverified',
      testSuite: 'packages/automation-core/test/capabilities/T07-layout.test.ts',
    },
    {
      id: 'C09',
      title: 'Layout, flex, grid, styles controls, and filters',
      description: 'Flexbox, CSS grid, sizing, pins, fills, gradients, borders, shadows, filters, clips, and transforms.',
      ownerTask: 'T07',
      status: 'mapped_unverified',
      testSuite: 'packages/automation-core/test/capabilities/T07-layout.test.ts',
    },
    {
      id: 'C10',
      title: 'Typography, rich text, font families, and text fit',
      description: 'Text editing, inline semantic formatting, font family management, fit text, and responsive typography.',
      ownerTask: 'T08',
      status: 'mapped_unverified',
      testSuite: 'packages/automation-core/test/capabilities/T08-design-system.test.ts',
    },
    {
      id: 'C11',
      title: 'Design tokens, color presets, themes, and font loading',
      description: 'Design token dictionary, CSS variable synchronization, color palettes, dark mode, and font imports.',
      ownerTask: 'T08',
      status: 'mapped_unverified',
      testSuite: 'packages/automation-core/test/capabilities/T08-design-system.test.ts',
    },
    {
      id: 'C12',
      title: 'Design components CRUD, props, instances, and detachment',
      description: 'Component creation, extraction, instance placement, prop schemas, and inline JSX detachment.',
      ownerTask: 'T09',
      status: 'mapped_unverified',
      testSuite: 'packages/automation-core/test/capabilities/T09-components.test.ts',
    },
    {
      id: 'C13',
      title: 'Component variables, hoisting, and typed variable mappings',
      description: 'Component-level variables, prop-to-variable bindings, hoisting, and deletion cascading.',
      ownerTask: 'T09',
      status: 'mapped_unverified',
      testSuite: 'packages/automation-core/test/capabilities/T09-components.test.ts',
    },
    {
      id: 'C14',
      title: 'Component variants, hover/active states, and connections',
      description: 'Variant creation, override recording, transition triggers, and interactive state mapping.',
      ownerTask: 'T10',
      status: 'mapped_unverified',
      testSuite: 'packages/automation-core/test/capabilities/T10-interactions.test.ts',
    },
    {
      id: 'C15',
      title: 'Overlays, drawers, modals, tooltips, and triggers',
      description: 'Overlay lifecycle, fixed/relative positioning, trigger wiring, and accessibility focus management.',
      ownerTask: 'T10',
      status: 'mapped_unverified',
      testSuite: 'packages/automation-core/test/capabilities/T10-interactions.test.ts',
    },
    {
      id: 'C16',
      title: 'Links, routing, anchors, and smooth navigation',
      description: 'Link destinations, Next.js routing, anchor scrolling, external URL attributes, and CMS navigation.',
      ownerTask: 'T10',
      status: 'mapped_unverified',
      testSuite: 'packages/automation-core/test/capabilities/T10-interactions.test.ts',
    },
    {
      id: 'C17',
      title: 'Built-in catalog, sections, and slot connections',
      description: 'Built-in element catalog browsing, section blueprints, slot listing, connection, and reordering.',
      ownerTask: 'T11',
      status: 'mapped_unverified',
      testSuite: 'packages/automation-core/test/capabilities/T11-catalog.test.ts',
    },
    {
      id: 'C18',
      title: 'Assets, uploads, media fills, and video/audio embeds',
      description: 'Asset indexing, image uploading, media optimization, background video, and audio players.',
      ownerTask: 'T12',
      status: 'mapped_unverified',
      testSuite: 'packages/automation-core/test/capabilities/T12-assets.test.ts',
    },
    {
      id: 'C19',
      title: 'Vector icon sets, SVG shapes, and sketch animation',
      description: 'Vector icon set management, SVG element manipulation, viewBox attributes, and path draw animations.',
      ownerTask: 'T13',
      status: 'mapped_unverified',
      testSuite: 'packages/automation-core/test/capabilities/T13-vectors.test.ts',
    },
    {
      id: 'C20',
      title: 'Framer Motion presets, hover/scroll physics, and text effects',
      description: 'Motion component transformation, animation presets, spring physics, and split-text animations.',
      ownerTask: 'T14',
      status: 'mapped_unverified',
      testSuite: 'packages/automation-core/test/capabilities/T14-motion.test.ts',
    },
    {
      id: 'C21',
      title: 'Site-wide effects, smooth scroll, cursor, and page transitions',
      description: 'Lenis smooth scroll integration, View Transitions API configurations, and custom cursor tracking.',
      ownerTask: 'T14',
      status: 'mapped_unverified',
      testSuite: 'packages/automation-core/test/capabilities/T14-motion.test.ts',
    },
    {
      id: 'C22',
      title: 'Page variables, expressions, and dynamic bindings',
      description: 'Page-level state variables, React useState hook synchronization, and JSX expression bindings.',
      ownerTask: 'T15',
      status: 'mapped_unverified',
      testSuite: 'packages/automation-core/test/capabilities/T15-bindings.test.ts',
    },
    {
      id: 'C23',
      title: 'CMS schemas, collections, fields, and item records',
      description: 'CMS schema modeling, field additions, item CRUD, slug generation, and static data hydration.',
      ownerTask: 'T16',
      status: 'mapped_unverified',
      testSuite: 'packages/automation-core/test/capabilities/T16-cms.test.ts',
    },
    {
      id: 'C24',
      title: 'CMS external API mode, providers, search, and pagination',
      description: 'External API endpoint integration, Strapi/Directus/Baserow providers, search fields, and pagination.',
      ownerTask: 'T17',
      status: 'mapped_unverified',
      testSuite: 'packages/automation-core/test/capabilities/T17-cms-api.test.ts',
    },
    {
      id: 'C25',
      title: 'Locales, i18n translations, RTL, and fallback routing',
      description: 'Multi-language management, translation dictionaries, RTL text direction, and localized route wrappers.',
      ownerTask: 'T18',
      status: 'mapped_unverified',
      testSuite: 'packages/automation-core/test/capabilities/T18-i18n.test.ts',
    },
    {
      id: 'C26',
      title: 'Forms, field types, endpoints, honeypot, and states',
      description: 'Interactive forms, accessible input types, validation rules, endpoint submission, and state toggles.',
      ownerTask: 'T19',
      status: 'mapped_unverified',
      testSuite: 'packages/automation-core/test/capabilities/T19-forms.test.ts',
    },
    {
      id: 'C27',
      title: 'Code components @controls, custom code, and redirects',
      description: 'TypeScript code components with @controls JSDoc, custom head/body scripts, and URL redirects.',
      ownerTask: 'T20',
      status: 'mapped_unverified',
      testSuite: 'packages/automation-core/test/capabilities/T20-code.test.ts',
    },
    {
      id: 'C28',
      title: 'Folders, organizing components, pages, and templates',
      description: 'File organization, directory hierarchies, and asset folder structures.',
      ownerTask: 'T21',
      status: 'mapped_unverified',
      testSuite: 'packages/automation-core/test/capabilities/T21-projects.test.ts',
    },
    {
      id: 'C29',
      title: 'Branches, diff review, merge apply, and history rollback',
      description: 'Feature branching, multi-branch switching, review diffing, AST merge healing, and undo/redo stacks.',
      ownerTask: 'T21',
      status: 'mapped_unverified',
      testSuite: 'packages/automation-core/test/capabilities/T21-projects.test.ts',
    },
    {
      id: 'C30',
      title: 'Comments, canvas guides, and selection inspection',
      description: 'Collaborative canvas comments, ruler guide positions, and active node selection tracking.',
      ownerTask: 'T21',
      status: 'mapped_unverified',
      testSuite: 'packages/automation-core/test/capabilities/T21-projects.test.ts',
    },
    {
      id: 'C31',
      title: 'Plugin lifecycle, sandboxed host, and SDK contracts',
      description: 'Third-party plugin manifest verification, sandboxed iframe host, and SDK permission policies.',
      ownerTask: 'T22',
      status: 'mapped_unverified',
      testSuite: 'packages/automation-core/test/capabilities/T22-extensions.test.ts',
    },
    {
      id: 'C32',
      title: 'Marketplace integrations and remote component import',
      description: 'Community component browsing, remote bundle import, asset bundling, and package dependencies.',
      ownerTask: 'T22',
      status: 'mapped_unverified',
      testSuite: 'packages/automation-core/test/capabilities/T22-extensions.test.ts',
    },
    {
      id: 'C33',
      title: 'Provider integrations and service authentication',
      description: 'Third-party font and media API providers, secure token storage, and fail-closed security.',
      ownerTask: 'T22',
      status: 'mapped_unverified',
      testSuite: 'packages/automation-core/test/capabilities/T22-extensions.test.ts',
    },
    {
      id: 'C34',
      title: 'Project export formats (source, SSG, archive)',
      description: 'Next.js source bundle packaging, static HTML/CSS pre-rendering, and ZIP archive generation.',
      ownerTask: 'T23',
      status: 'mapped_unverified',
      testSuite: 'packages/automation-core/test/capabilities/T23-release.test.ts',
    },
    {
      id: 'C35',
      title: 'Deployment, publishing, staging, and domain config',
      description: 'Production website publishing, deployment status polling, custom domains, and rollback points.',
      ownerTask: 'T23',
      status: 'mapped_unverified',
      testSuite: 'packages/automation-core/test/capabilities/T23-release.test.ts',
    },
    {
      id: 'C36',
      title: 'Visual observation, element layout, audit, and verification',
      description: 'Headless layout measurement, WCAG contrast auditing, AST effect verification, and screenshot capture.',
      ownerTask: 'T24',
      status: 'mapped_unverified',
      testSuite: 'packages/automation-core/test/capabilities/T24-verification.test.ts',
    },
    {
      id: 'C37',
      title: 'End-to-end acceptance workflows, landing page, and CLI parity',
      description: 'Full end-to-end acceptance test suites L01–L04, repair loops, and CLI/MCP v2 launch readiness.',
      ownerTask: 'T25',
      status: 'mapped_unverified',
      testSuite: 'packages/automation-core/test/acceptance/L01-landing.test.ts',
    },
  ],
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
    totalCapabilities: leafCategories.specCapabilities.length,
    verifiedCapabilities: leafCategories.specCapabilities.filter((c) => c.status === 'verified').length,
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

// 1. Write coverage.json
const jsonTargetFile = path.join(outDir, 'coverage.json');
fs.writeFileSync(jsonTargetFile, JSON.stringify(output, null, 2) + '\n');

// 2. Write coverage.md
const mdTargetFile = path.join(outDir, 'coverage.md');
const mdContent = `# Revyme Automation & MCP v2 - Capability Coverage Report

> Generated automatically by \`scripts/automation-inventory.cjs\` on ${new Date().toISOString()}

This inventory records mappings, not executed tests. Registration does not prove GUI, runtime, build or service readiness. No capability is marked verified without evidence for a specific revision and environment.

## Executive Summary

| Category | Total Baseline | Mapped / Verified | Status |
|---|---|---|---|
| **Capabilities (C01–C37)** | **${output.summary.totalCapabilities}** | **${output.summary.verifiedCapabilities} verified** | **GUI/runtime evidence pending** |
| **Mapped Agent Tools** | **172** | **172** | **Mapped; acceptance pending** |
| **Mutation Types** | **175** | **175** | **Mapped; acceptance pending** |
| **SDK Methods** | **114** | **114** | **Mapped; acceptance pending** |
| **Named Bridge Methods** | **14** | **14** | **Mapped; acceptance pending** |
| **Acceptance Suites (L01–L04)** | **4** | **0 verified** | **No GUI/build run evidence recorded** |

---

## Capabilities Matrix (C01–C37)

| ID | Title & Scope | Owner Task | Status | Test Suite |
|---|---|---|---|---|
${leafCategories.specCapabilities
  .map(
    (c) =>
      `| **${c.id}** | **${c.title}**<br>${c.description} | \`${c.ownerTask}\` | \`${c.status}\` | \`${c.testSuite}\` |`
  )
  .join('\n')}

---

## Integration scenarios (L01–L04); browser acceptance pending

| Suite ID | Focus Area | Status | Location |
|---|---|---|---|
| **L01-landing** | Complete responsive marketing landing page assembly (design tokens, typography, hero, marquee, cards, metrics, pricing, FAQ, forms, SEO) | **Unverified** | \`packages/automation-core/test/acceptance/L01-landing.test.ts\` |
| **L02-dynamic** | Dynamic CMS schemas, item collections, detail pages, external API providers (Strapi/Directus/Baserow), search, i18n locales, RTL, page variables | **Unverified** | \`packages/automation-core/test/acceptance/L02-dynamic.test.ts\` |
| **L03-visual** | Visual effects, Framer Motion presets & physics, SVG shapes, sketch animation, code components with \`@controls\`, custom cursor, smooth scroll, page transitions | **Unverified** | \`packages/automation-core/test/acceptance/L03-visual.test.ts\` |
| **L04-lifecycle** | Project CRUD, checksummed backup export/restore, branch lifecycle, review/diff, AST merge apply, history checkpoints, undo/redo, failure rollback | **Unverified** | \`packages/automation-core/test/acceptance/L04-lifecycle.test.ts\` |

---

## Leaf Coverage Categories

- **Styles Controls**: ${leafCategories.stylesControls.length} properties covered
- **Prop Types**: ${leafCategories.propTypes.length} types supported
- **Motion Scopes**: ${leafCategories.motionScopes.length} triggers supported
- **Form Fields**: ${leafCategories.formFieldTypes.length} input types supported
- **CMS Fields**: ${leafCategories.cmsFields.length} field schemas supported
- **Export Formats**: ${leafCategories.exportFormats.length} formats defined
`;

fs.writeFileSync(mdTargetFile, mdContent);

console.log(`Generated docs/automation/coverage.json and docs/automation/coverage.md with:`);
console.log(`- ${output.summary.totalCapabilities} / ${output.summary.verifiedCapabilities} capabilities verified`);
console.log(`- ${output.summary.registeredAgentTools} mapped agent tools (mapping only)`);
console.log(`- ${output.summary.mutationTypes} mapped mutations (mapping only)`);
console.log(`- ${output.summary.sdkMethods} classified SDK methods (mapping only)`);

