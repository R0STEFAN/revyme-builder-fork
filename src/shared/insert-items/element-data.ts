// element-data.ts — Category and element data structures for the Insert overlay.
// Matches the old builder's InsertCategoryOverlay exactly.

import type { FieldDefinition } from '@/shared/types';
import { SECTION_BLUEPRINTS, sectionItemId, type SectionCategory } from '@/shared/sections-library';

export interface InsertItem {
  id: string;
  name: string;
  /** Key into the element-icons map */
  iconKey: string;
  /** Short English description of what the component/element is and does */
  description?: string;
  /** CMS field card — drives a type-aware mini "drawing" instead of iconKey. */
  cmsFieldType?: FieldDefinition['type'];
  /** CMS prev/next nav card — drives the pager "drawing". */
  cmsNav?: 'prev' | 'next';
  /** CMS collection card — drives the records-list "drawing". */
  cmsCollection?: boolean;
  /** Optional gradient colors for card background (Creative/Utility items) */
  gradientColors?: string[];
  /** When set, the integration card renders the brand's `SocialIcon` from
   *  `react-social-icons` instead of the bundled `iconKey` SVG. The lib
   *  ships icons for hundreds of networks at the correct brand colors
   *  (Google Maps' multi-color G, Spotify's wordmark green, TikTok's
   *  cyan/red split, etc.). Names match the lib's `network` prop. */
  socialNetwork?: string;
  /** Sections-library card — the drag builds its ToolbarItem from this
   *  blueprint's source (src/canvas/section-insert.ts blueprintToToolbarItem)
   *  instead of the static toolbar catalogue. */
  sectionBlueprintId?: string;
}

interface InsertSection {
  id: string;
  label: string;
  items: InsertItem[];
}

export interface InsertCategory {
  id: string;
  label: string;
  /** Key into the category-icons map */
  iconKey: string;
  /** Number of grid columns in the secondary panel */
  columns: 1 | 2 | 3;
  sections: InsertSection[];
  /** Optional empty-state message rendered in place of the section grids
   *  when the category is conditionally inert (e.g. CMS Fields when the
   *  user isn't on a detail page). The row stays in the sidebar so the
   *  affordance is discoverable; clicking it shows this message instead
   *  of an empty grid. */
  emptyStateMessage?: string;
}


// ─── Elements Category ─────────────────────────────────────────────────────

const BASIC_ITEMS: InsertItem[] = [
  { id: 'frame', name: 'Frame', iconKey: 'frame', description: 'Container box for grouping and layout (flexbox / grid).' },
  { id: 'column', name: 'Column', iconKey: 'column', description: 'Vertical flex container that stacks children in a column.' },
  { id: 'row', name: 'Row', iconKey: 'row', description: 'Horizontal flex container that aligns children in a row.' },
  { id: 'image', name: 'Image', iconKey: 'image', description: 'Responsive image element with aspect ratio and fit controls.' },
  { id: 'video', name: 'Video', iconKey: 'video', description: 'HTML5 video player with controls, autoplay, and looping.' },
  { id: 'audio', name: 'Audio', iconKey: 'audio', description: 'HTML5 audio player for sound tracks and clips.' },
  { id: 'button', name: 'Button', iconKey: 'button', description: 'Interactive clickable button with hover and active states.' },
];

const TYPOGRAPHY_ITEMS: InsertItem[] = [
  { id: 'heading', name: 'Heading', iconKey: 'heading', description: 'Semantic heading (H1–H6) for section and page titles.' },
  { id: 'paragraph', name: 'Paragraph', iconKey: 'paragraph', description: 'Standard body text block for paragraphs and multi-line copy.' },
  { id: 'span', name: 'Span', iconKey: 'span', description: 'Inline text snippet for styling portions of text.' },
  { id: 'text-link', name: 'Text Link', iconKey: 'textLink', description: 'Clickable hyperlink navigating to internal pages or URLs.' },
  { id: 'quote', name: 'Quote', iconKey: 'quote', description: 'Blockquote element for testimonials, excerpts, and citations.' },
];

const CARD_ITEMS: InsertItem[] = [
  { id: 'card-basic', name: 'Basic', iconKey: 'cardBasic', description: 'Vertical card with media header, title, and description.' },
  { id: 'card-horizontal', name: 'Horizontal', iconKey: 'cardHorizontal', description: 'Horizontal card with side image thumbnail and content.' },
  { id: 'card-profile', name: 'Profile', iconKey: 'cardProfile', description: 'User profile card with avatar, name, and role description.' },
  { id: 'card-pricing', name: 'Pricing', iconKey: 'cardPricing', description: 'Pricing tier card with plan name, price, and CTA button.' },
  { id: 'card-product', name: 'Product', iconKey: 'cardProduct', description: 'E-commerce product card with image, title, price, and button.' },
];

const LAYOUT_ITEMS: InsertItem[] = [
  { id: 'layout-2row', name: '2 Row', iconKey: 'layout2Row', description: 'Two-row vertical grid layout.' },
  { id: 'layout-3row', name: '3 Row', iconKey: 'layout3Row', description: 'Three-row vertical grid layout.' },
  { id: 'layout-2col', name: '2 Col', iconKey: 'layout2Col', description: 'Two-column responsive grid layout.' },
  { id: 'layout-3col', name: '3 Col', iconKey: 'layout3Col', description: 'Three-column responsive grid layout.' },
  { id: 'layout-grid', name: 'Grid', iconKey: 'layoutGrid', description: 'Multi-item responsive grid layout.' },
  { id: 'layout-sidebar', name: 'Sidebar', iconKey: 'layoutSidebar', description: 'Split layout with fixed sidebar and flexible main content.' },
  { id: 'layout-header', name: 'Header', iconKey: 'layoutHeader', description: 'Page header bar with brand slot and navigation links.' },
];

const SHAPE_ITEMS: InsertItem[] = [
  { id: 'shape-square', name: 'Square', iconKey: 'shapeSquare', description: 'Geometric square shape element.' },
  { id: 'shape-circle', name: 'Circle', iconKey: 'shapeCircle', description: 'Geometric circle shape element.' },
  { id: 'shape-triangle', name: 'Triangle', iconKey: 'shapeTriangle', description: 'Geometric triangle shape element.' },
  { id: 'shape-star', name: 'Star', iconKey: 'shapeStar', description: 'Five-pointed star vector shape.' },
  { id: 'shape-hexagon', name: 'Hexagon', iconKey: 'shapeHexagon', description: 'Six-sided hexagon polygon shape.' },
  { id: 'shape-pentagon', name: 'Pentagon', iconKey: 'shapePentagon', description: 'Five-sided pentagon polygon shape.' },
];

// ─── Creative Category ─────────────────────────────────────────────────────

// Effects are slot-based code components — they render connected canvas
// nodes as children. `cs-` prefix + entry in
// src/canvas/drag/toolbar-item-config.ts CODE_SNIPPET_TOOLBAR_ITEMS.
//
// Two flavors live here (no separate "Containers" subcategory anymore —
// the distinction wasn't useful at the user-facing level; both are
// "drop a wrapper, drop children inside, the wrapper does something
// visual with them"):
//   - Scrolling / animation containers (Marquee, Carousel, 3D Marquee, …).
//   - Interaction wrappers (LensBox, MagnetBox, PixelatedHover) — same
//     slot model, just driven by cursor instead of time.
const EFFECTS_ITEMS: InsertItem[] = [
  { id: 'cs-carousel', name: 'Carousel', iconKey: 'effectCarousel', gradientColors: ['#3B82F6', '#2563EB'], description: 'Slideshow of connected nodes with navigation arrows, dots, and autoplay.' },
  { id: 'cs-marquee', name: 'Marquee', iconKey: 'effectMarquee', gradientColors: ['#8B5CF6', '#7C3AED'], description: 'Continuous scrolling ticker loop of connected canvas nodes.' },
  { id: 'cs-ribbonMarquee', name: 'Path Marquee', iconKey: 'effectPathMarquee', gradientColors: ['#A855F7', '#7C3AED'], description: 'Connected nodes flowing and auto-rotating along a curved path.' },
  { id: 'cs-threeDMarquee', name: '3D Marquee', iconKey: 'effectThreeDMarquee', gradientColors: ['#06B6D4', '#0891B2'], description: 'Connected nodes in a tilted 3D grid with alternating scroll.' },
  { id: 'cs-imageTrail', name: 'Motion Trail', iconKey: 'effectMotionTrail', gradientColors: ['#3B82F6', '#2563EB'], description: 'Connected nodes stamped along cursor movement as a fading trail.' },
  { id: 'cs-horizontalScroll', name: 'Horizontal Scroll', iconKey: 'effectHorizontalScroll', gradientColors: ['#06B6D4', '#3B82F6', '#8B5CF6'], description: 'Horizontal drag-scrollable row of connected canvas nodes.' },
  { id: 'cs-lensBox', name: 'Lens Box', iconKey: 'effectLensBox', gradientColors: ['#667EEA', '#764BA2'], description: 'Container with an interactive magnifying lens that follows the cursor.' },
  { id: 'cs-magnetBox', name: 'Magnet Box', iconKey: 'effectMagnetBox', gradientColors: ['#F59E0B', '#D97706'], description: 'Container that pulls its contents toward the cursor with magnetic spring force.' },
  { id: 'cs-imageSequence', name: 'Image Sequence', iconKey: 'effectImageSequence', gradientColors: ['#06B6D4', '#3B82F6'], description: 'Scroll-driven frame-by-frame animation from an uploaded image sequence.' },
  { id: 'cs-modelViewer', name: '3D Model', iconKey: 'effectModelViewer', gradientColors: ['#6366F1', '#4F46E5'], description: 'Interactive Three.js 3D model viewer for .glb files with orbit camera.' },
  { id: 'cs-splineScene', name: 'Spline 3D', iconKey: 'effectSplineScene', gradientColors: ['#EC4899', '#8B5CF6'], description: 'Embed an interactive Spline 3D scene directly on your canvas.' },
];

const TEXT_EFFECTS_ITEMS: InsertItem[] = [
  { id: 'cs-morphingText',  name: 'Morphing Text',  iconKey: 'creativeMorphingText',   gradientColors: ['#F59E0B', '#D97706'], description: 'Smoothly morphs between words using an SVG blur filter.' },
  { id: 'cs-wordRotate',    name: 'Word Rotate',    iconKey: 'creativeWordRotate',     gradientColors: ['#8B5CF6', '#7C3AED'], description: 'Cycles through a list of words with smooth slide transitions.' },
  { id: 'cs-spinningText',  name: 'Spinning Text',  iconKey: 'creativeSpinningText',   gradientColors: ['#F59E0B', '#D97706'], description: 'Arranges characters in a rotating circle, speeding up on hover.' },
  { id: 'cs-typingText',    name: 'Typing Text',    iconKey: 'creativeTypingText',     gradientColors: ['#10B981', '#059669'], description: 'Types out words one character at a time with a blinking cursor.' },
  { id: 'cs-textPressure',  name: 'Text Pressure',  iconKey: 'creativeTextPressure',   gradientColors: ['#A855F7', '#9333EA'], description: 'Characters dynamically increase weight and width as cursor nears.' },
  { id: 'cs-hangingCurved', name: 'Hanging Curved', iconKey: 'creativeHangingCurved',  gradientColors: ['#10B981', '#059669'], description: 'Text follows a curved SVG path with continuous scrolling motion.' },
  { id: 'cs-magneticText',  name: 'Magnetic Text',  iconKey: 'creativeMagneticText',   gradientColors: ['#00FFEE', '#06B6D4'], description: 'Letterforms magnetically attract toward the mouse cursor on hover.' },
  { id: 'cs-rotatingText',  name: 'Rotating 3D',    iconKey: 'creativeRotatingText3D', gradientColors: ['#EC4899', '#DB2777'], description: '3D cylinder of words that rotates continuously or with page scroll.' },
  { id: 'cs-videoText',     name: 'Video Text',     iconKey: 'creativeVideoText',      gradientColors: ['#8B5CF6', '#7C3AED'], description: 'Plays a video or animated gradient clipped inside text shapes.' },
  { id: 'cs-counter',       name: 'Counter',        iconKey: 'creativeCounter',        gradientColors: ['#10B981', '#059669'], description: 'Smoothly animates a numeric count-up with prefix and suffix.' },
  { id: 'cs-glitchText',    name: 'Glitch Text',    iconKey: 'creativeGlitchText',     gradientColors: ['#FF003C', '#00E5FF'], description: 'Cyberpunk text effect with chromatic RGB-split glitch and scan bands.' },
  { id: 'cs-gradientText',  name: 'Gradient Text',  iconKey: 'creativeGradientText',   gradientColors: ['#A855F7', '#38BDF8'], description: 'Text filled with a travelling multi-colour animated gradient.' },
];

const CURSORS_ITEMS: InsertItem[] = [
  { id: 'cs-designCursor', name: 'Design Cursor', iconKey: 'effectDesignCursor', gradientColors: ['#3B82F6', '#2563EB'], description: 'Custom cursor with smooth spring-physics label follower.' },
  { id: 'cs-blobCursor',   name: 'Blob Cursor',   iconKey: 'effectBlobCursor',   gradientColors: ['#A855F7', '#5227FF'], description: 'Organic liquid blob cursor trailing mouse pointer movements.' },
  { id: 'cs-ribbonCursor', name: 'Ribbon Cursor', iconKey: 'effectRibbonCursor', gradientColors: ['#A855F7', '#5227FF'], description: 'Flowing tapered ribbon trailing the cursor across the canvas.' },
  { id: 'cs-splashCursor', name: 'Splash Cursor', iconKey: 'effectSplashCursor', gradientColors: ['#F59E0B', '#EC4899'], description: 'WebGL fluid simulation that paints colorful interactive splashes.' },
];

// ─── Integrations (Widgets) Category ──────────────────────────────────────

const WIDGET_FORM_ITEMS: InsertItem[] = [
  { id: 'custom-form', name: 'Custom Form', iconKey: 'customForm', gradientColors: ['#3b82f6', '#1d4ed8'], description: 'Customizable multi-field contact form with submission handler.' },
  { id: 'calendly', name: 'Calendly', iconKey: 'calendly', gradientColors: ['#006BFF', '#0052CC'], description: 'Embed a Calendly scheduling widget for booking meetings.' },
  { id: 'typeform', name: 'Typeform', iconKey: 'typeform', gradientColors: ['#262627', '#1A1A1A'], description: 'Embed a Typeform conversational form or survey by form ID.' },
  { id: 'google-forms', name: 'Google Forms', iconKey: 'googleForms', gradientColors: ['#7B4FFF', '#5C3FD6'], description: 'Embed a Google Form by ID for collecting user responses.' },
];

const EMBED_ITEMS: InsertItem[] = [
  { id: 'youtube', name: 'YouTube', iconKey: 'youtube', gradientColors: ['#FF0000', '#CC0000'], socialNetwork: 'youtube', description: 'Embed a YouTube video player with autoplay, mute, and loop controls.' },
  { id: 'vimeo', name: 'Vimeo', iconKey: 'vimeo', gradientColors: ['#1AB7EA', '#0D94C9'], socialNetwork: 'vimeo', description: 'Embed a Vimeo video player by video ID.' },
  { id: 'soundcloud', name: 'SoundCloud', iconKey: 'soundcloud', gradientColors: ['#FF8800', '#FF6600'], socialNetwork: 'soundcloud', description: 'Embed a SoundCloud audio track or playlist widget.' },
  { id: 'spotify', name: 'Spotify', iconKey: 'spotify', gradientColors: ['#1DB954', '#1AA34A'], socialNetwork: 'spotify', description: 'Embed a Spotify music track, album, or podcast player.' },
  { id: 'google-maps', name: 'Google Maps', iconKey: 'googleMaps', gradientColors: ['#4285F4', '#34A853'], socialNetwork: 'google', description: 'Embed an interactive Google Maps location view by query.' },
];

const SOCIAL_ITEMS: InsertItem[] = [
  { id: 'facebook', name: 'Facebook', iconKey: 'facebook', gradientColors: ['#1877F2', '#0D65D9'], socialNetwork: 'facebook', description: 'Official Facebook post, page, or video embed.' },
  { id: 'x', name: 'Twitter/X', iconKey: 'twitterX', gradientColors: ['#000000', '#1a1a1a'], socialNetwork: 'x', description: 'Official Twitter / X tweet embed card.' },
  { id: 'instagram', name: 'Instagram', iconKey: 'instagram', gradientColors: ['#E1306C', '#C13584', '#833AB4'], socialNetwork: 'instagram', description: 'Official Instagram photo or reel embed.' },
  { id: 'linkedin', name: 'LinkedIn', iconKey: 'linkedin', gradientColors: ['#0077B5', '#005885'], socialNetwork: 'linkedin', description: 'Official LinkedIn post embed card.' },
  { id: 'pinterest', name: 'Pinterest', iconKey: 'pinterest', gradientColors: ['#E60023', '#C8001A'], socialNetwork: 'pinterest', description: 'Official Pinterest pin embed widget.' },
  { id: 'tiktok', name: 'TikTok', iconKey: 'tiktok', gradientColors: ['#000000', '#1a1a1a'], socialNetwork: 'tiktok', description: 'Official TikTok short video embed.' },
];

// ─── Utility Category ────────────────────────────────────────────────────

const NOISE_ITEMS: InsertItem[] = [
  { id: 'cs-filmGrain', name: 'Film Grain', iconKey: 'noiseFilmGrain', gradientColors: ['#A78BFA', '#7C3AED'], description: 'Subtle animated analog film grain overlay for cinematic texture.' },
  { id: 'cs-staticNoise', name: 'Static TV', iconKey: 'noiseStatic', gradientColors: ['#A78BFA', '#7C3AED'], description: 'Retro TV static noise animation overlay.' },
  { id: 'cs-perlinNoise', name: 'Perlin', iconKey: 'noisePerlin', gradientColors: ['#A78BFA', '#7C3AED'], description: 'Smooth organic Perlin noise texture overlay.' },
  { id: 'cs-halftone', name: 'Halftone', iconKey: 'noiseHalftone', gradientColors: ['#A78BFA', '#7C3AED'], description: 'Classic halftone dot screen print effect.' },
  { id: 'cs-scanlines', name: 'Scanlines', iconKey: 'noiseScanlines', gradientColors: ['#A78BFA', '#7C3AED'], description: 'Vintage CRT monitor horizontal scanline overlay.' },
  { id: 'cs-chromaticNoise', name: 'Chromatic', iconKey: 'noiseChromatic', gradientColors: ['#A78BFA', '#7C3AED'], description: 'RGB chromatic aberration noise overlay.' },
];

const DIVIDER_ITEMS: InsertItem[] = [
  { id: 'cs-lineDivider', name: 'Line', iconKey: 'dividerLine', gradientColors: ['#EC4899', '#DB2777'], description: 'Clean horizontal rule divider line.' },
  { id: 'cs-waveDivider', name: 'Wave', iconKey: 'dividerWave', gradientColors: ['#EC4899', '#DB2777'], description: 'Organic wave-shaped section separator.' },
  { id: 'cs-angledDivider', name: 'Angled', iconKey: 'dividerAngled', gradientColors: ['#EC4899', '#DB2777'], description: 'Sharp diagonal angled section separator.' },
  { id: 'cs-curvedDivider', name: 'Curved', iconKey: 'dividerCurved', gradientColors: ['#EC4899', '#DB2777'], description: 'Smooth arched dome section separator.' },
  { id: 'cs-zigzagDivider', name: 'Zigzag', iconKey: 'dividerZigzag', gradientColors: ['#EC4899', '#DB2777'], description: 'Geometric zigzag sawtooth section separator.' },
  { id: 'cs-wavyLineDivider', name: 'Wavy Line', iconKey: 'dividerWavyLine', gradientColors: ['#EC4899', '#DB2777'], description: 'Dual serpentine sine-wave section separator.' },
  { id: 'cs-arrowDivider', name: 'Arrow', iconKey: 'dividerArrow', gradientColors: ['#EC4899', '#DB2777'], description: 'Downward chevron pointing section separator.' },
  { id: 'cs-stepsDivider', name: 'Steps', iconKey: 'dividerSteps', gradientColors: ['#EC4899', '#DB2777'], description: 'Stepped staircase section separator.' },
];

const INTERACTIVE_UTILITY_ITEMS: InsertItem[] = [
  { id: 'cs-themeToggle', name: 'Theme Toggle', iconKey: 'effectThemeToggle', gradientColors: ['#F59E0B', '#1F2937'], description: 'Sun/moon toggle button switching between light and dark modes.' },
  { id: 'cs-localeSwitcher', name: 'Locale Switcher', iconKey: 'effectLocaleSwitcher', gradientColors: ['#10B981', '#059669'], description: 'Dropdown selector for switching page languages in multi-language sites.' },
  { id: 'cs-copyButton', name: 'Copy Button', iconKey: 'effectCopyButton', gradientColors: ['#171A16', '#16A34A'], description: 'One-click copy-to-clipboard button with checkmark transition.' },
  { id: 'cs-accordion', name: 'Accordion', iconKey: 'effectAccordion', gradientColors: ['#1F1F1F', '#374151'], description: 'Expandable FAQ accordion with smooth spring animations.' },
  { id: 'cs-markdownArticle', name: 'Markdown Article', iconKey: 'articleMarkdown', gradientColors: ['#EAB308', '#CA8A04'], description: 'Formatted article renderer with typography controls from CMS Markdown or custom text.' },
];

// Patterns drop as a `<div>` with a CSS background pattern (or an SVG-data
// URL for shapes CSS can't describe ergonomically). No code component — the user can
// re-style backgroundColor / opacity / pattern color from the regular panel.
const PATTERN_ITEMS: InsertItem[] = [
  { id: 'cs-gridPattern', name: 'Grid', iconKey: 'patternGrid', gradientColors: ['#8B5CF6', '#7C3AED'], description: 'Clean geometric grid background pattern.' },
  { id: 'cs-dotPattern', name: 'Dots', iconKey: 'patternDots', gradientColors: ['#8B5CF6', '#7C3AED'], description: 'Dot matrix background pattern.' },
  { id: 'cs-crossPattern', name: 'Crosses', iconKey: 'patternCrosses', gradientColors: ['#8B5CF6', '#7C3AED'], description: 'Plus/cross grid background pattern.' },
  { id: 'cs-diagonalPattern', name: 'Diagonal', iconKey: 'patternDiagonal', gradientColors: ['#8B5CF6', '#7C3AED'], description: 'Diagonal striped line background pattern.' },
  { id: 'cs-gridMaskPattern', name: 'Grid + Mask', iconKey: 'patternGridMask', gradientColors: ['#8B5CF6', '#7C3AED'], description: 'Grid pattern with radial fade mask.' },
  { id: 'cs-honeycombPattern', name: 'Honeycomb', iconKey: 'patternHoneycomb', gradientColors: ['#8B5CF6', '#7C3AED'], description: 'Hexagonal honeycomb tile pattern.' },
  { id: 'cs-checkerboardPattern', name: 'Checkerboard', iconKey: 'patternCheckerboard', gradientColors: ['#8B5CF6', '#7C3AED'], description: 'Classic alternating checkerboard pattern.' },
];

// Backgrounds drop a code-component Code component instance. Each tile shows a
// gradient-style preview but the dropped element is a live animated
// canvas with full @controls (colors, speed, amplitude, …) editable in
// the Properties panel. Covers the 2D canvas shaders plus the 3D
// particle-field background.
const BACKGROUND_ITEMS: InsertItem[] = [
  { id: 'cs-shaderWaveLines',      name: 'Wave Lines',      iconKey: 'shaderWaveLines',      gradientColors: ['#0F0F1A', '#FFFFFF'], description: 'Animated stacked waveform lines on Canvas 2D.' },
  { id: 'cs-shaderWaveGradient',   name: 'Wave Gradient',   iconKey: 'shaderWaveGradient',   gradientColors: ['#FF3624', '#9EABFF'], description: 'Animated four-color flowing wave gradient.' },
  { id: 'cs-shaderMeshGradient',   name: 'Mesh Gradient',   iconKey: 'shaderMeshGradient',   gradientColors: ['#FF6B6B', '#4D96FF'], description: 'Fluid multi-point mesh gradient with organic swirl.' },
  { id: 'cs-shaderPlasma',         name: 'Plasma',          iconKey: 'shaderPlasma',         gradientColors: ['#FF006E', '#3A86FF'], description: 'Classic demoscene plasma with sine-driven color transitions.' },
  { id: 'cs-shaderLiquidMetal',    name: 'Liquid Metal',    iconKey: 'shaderLiquidMetal',    gradientColors: ['#1A1A2E', '#7B61FF'], description: 'Flowing liquid chrome surface with metallic specular highlights.' },
  { id: 'cs-shaderCaustics',       name: 'Caustics',        iconKey: 'shaderCaustics',       gradientColors: ['#001824', '#7DF9FF'], description: 'Underwater caustics light reflection animation.' },
  { id: 'cs-shaderAurora',         name: 'Aurora',          iconKey: 'shaderAurora',         gradientColors: ['#020617', '#A855F7'], description: 'Northern lights aurora borealis shader with customizable flow.' },
  { id: 'cs-shaderMatrixRain',     name: 'Matrix Rain',     iconKey: 'shaderMatrixRain',     gradientColors: ['#020617', '#22C55E'], description: 'Falling digital glyph rain in classic cyberpunk terminal style.' },
  { id: 'cs-shaderWaveDistortion', name: 'Wave Distortion', iconKey: 'shaderWaveDistortion', gradientColors: ['#0F172A', '#06B6D4'], description: 'WebGL fragment shader that warps a gradient with harmonic waves.' },
  { id: 'cs-neonParticleField',    name: 'Neon Particles',  iconKey: 'effectNeonParticles',  gradientColors: ['#22D3EE', '#A855F7'], description: 'Floating neon particles with glowing cursor-reactive connection lines.' },
  { id: 'cs-particleField',        name: 'Particle Field',   iconKey: 'effectParticleField',  gradientColors: ['#020617', '#38BDF8'], description: 'Mouse-reactive particle network with depth-projected dots and connection lines.' },
  { id: 'cs-bgSilk', name: 'Silk', iconKey: 'bgSilk', gradientColors: ['#0b0b14', '#f5c8e4'], description: 'Wide ribbons of light drifting like silk, rendered on the GPU.' },
  { id: 'cs-bgLightPillar', name: 'Light Pillar', iconKey: 'bgLightPillar', gradientColors: ['#07060f', '#7c3aed'], description: 'Vertical shaft of light wavering in the dark, with grain and vignette.' },
  { id: 'cs-bgIridescence', name: 'Iridescence', iconKey: 'bgIridescence', gradientColors: ['#08070d', '#22d3ee'], description: 'An oil-slick sheen of shifting colour, thin-film style.' },
  { id: 'cs-bgGodRays', name: 'God Rays', iconKey: 'bgGodRays', gradientColors: ['#0a0806', '#ffd9a0'], description: 'Shafts of light fanning out from a movable source through haze.' },
  { id: 'cs-bgGrainField', name: 'Grain Field', iconKey: 'bgGrainField', gradientColors: ['#1b1035', '#f5b942'], description: 'A soft colour field under heavy film grain.' },
  { id: 'cs-bgNebula', name: 'Nebula', iconKey: 'bgNebula', gradientColors: ['#04030a', '#d94fa0'], description: 'Clouds of interstellar gas and a drifting starfield.' },
  { id: 'cs-bgDotWave', name: 'Dot Wave', iconKey: 'bgDotWave', gradientColors: ['#05070f', '#67e8f9'], description: 'A lattice of dots swelling with a wave running out from the centre.' },
  { id: 'cs-bgContours', name: 'Contours', iconKey: 'bgContours', gradientColors: ['#050810', '#a855f7'], description: 'Topographic contour lines drifting over a dark ground.' },
  { id: 'cs-bgFluidGradient', name: 'Fluid Gradient', iconKey: 'bgFluidGradient', gradientColors: ['#1e1b4b', '#ec4899'], description: 'Four colours folded through a warped noise field, like ink in water.' },
  { id: 'cs-bgCyberGrid', name: 'Cyber Grid', iconKey: 'bgCyberGrid', gradientColors: ['#0a0418', '#ff2fb9'], description: 'Neon perspective grid running under a sliced sun on the horizon.' },
  { id: 'cs-bgRippleGrid', name: 'Ripple Grid', iconKey: 'bgRippleGrid', gradientColors: ['#04040c', '#22d3ee'], description: 'A grid floor running to the horizon with a ripple travelling across it.' },
  { id: 'cs-bgVoronoiCells', name: 'Voronoi Cells', iconKey: 'bgVoronoi', gradientColors: ['#0f172a', '#67e8f9'], description: 'A living mosaic of glowing cells, each drifting on its own clock.' },
  { id: 'cs-bgMetaballField', name: 'Metaball Field', iconKey: 'bgMetaballField', gradientColors: ['#06060f', '#7c3aed'], description: 'Soft blobs that merge and split as they pass each other.' },
  { id: 'cs-bgHalftoneScreen', name: 'Halftone Screen', iconKey: 'bgHalftoneScreen', gradientColors: ['#0c0a09', '#f43f5e'], description: 'A print-screen of dots whose size follows a drifting tone.' },
  { id: 'cs-bgScanlineCRT', name: 'CRT', iconKey: 'bgCrt', gradientColors: ['#05070a', '#a3e635'], description: 'A CRT picture: barrel bulge, rolling scanlines and channel smear.' },
  { id: 'cs-bgSmoke', name: 'Smoke', iconKey: 'bgSmoke', gradientColors: ['#08080b', '#e4e4e7'], description: 'Plumes of smoke rising and shearing as they climb.' },
  { id: 'cs-bgMarble', name: 'Marble', iconKey: 'bgMarble', gradientColors: ['#0b1020', '#e2c887'], description: 'Veined stone: a regular stripe with turbulence stirred into its phase.' },
  { id: 'cs-bgWarpTunnel', name: 'Warp Tunnel', iconKey: 'bgWarpTunnel', gradientColors: ['#03030a', '#22d3ee'], description: 'Flying down a textured tube toward a vanishing point.' },
  { id: 'cs-bgStarWarp', name: 'Star Warp', iconKey: 'bgStarWarp', gradientColors: ['#02030a', '#93c5fd'], description: 'Stars streaking outward at light speed.' },
  { id: 'cs-bgHexGrid', name: 'Hex Grid', iconKey: 'bgHexGrid', gradientColors: ['#04060e', '#a855f7'], description: 'A honeycomb of neon cells pulsing outward.' },
  { id: 'cs-bgLightning', name: 'Lightning', iconKey: 'bgLightning', gradientColors: ['#05040d', '#8b5cf6'], description: 'A bolt striking down through the dark, with a branch beside it.' },
  { id: 'cs-bgLiquidChrome', name: 'Liquid Chrome', iconKey: 'bgLiquidChrome', gradientColors: ['#0b0f1a', '#cbd5e1'], description: 'Polished metal rolling in slow waves.' },
  { id: 'cs-bgBokeh', name: 'Bokeh', iconKey: 'bgBokeh', gradientColors: ['#07060e', '#f9a8d4'], description: 'Luminous out-of-focus background circles floating in the dark.' },
  { id: 'cs-bgRainGlass', name: 'Rain Glass', iconKey: 'bgRainGlass', gradientColors: ['#050a10', '#67e8f9'], description: 'Raindrops running down a frosted pane.' },
  { id: 'cs-bgFireflies', name: 'Fireflies', iconKey: 'bgFireflies', gradientColors: ['#050806', '#fde68a'], description: 'Points of warm light drifting and blinking in the dark.' },
  { id: 'cs-bgVortex', name: 'Vortex', iconKey: 'bgVortex', gradientColors: ['#04030b', '#f472b6'], description: 'Spiral arms winding into a bright core.' },
  { id: 'cs-bgSunset', name: 'Sunset', iconKey: 'bgSunset', gradientColors: ['#1e1b4b', '#f97316'], description: 'A sun on the horizon with its reflection broken across the water.' },
  { id: 'cs-bgDunes', name: 'Dunes', iconKey: 'bgDunes', gradientColors: ['#7c2d12', '#fed7aa'], description: 'Wind-built sand ridges under a low sun.' },
  { id: 'cs-bgOilSlick', name: 'Oil Slick', iconKey: 'bgOilSlick', gradientColors: ['#05060a', '#a855f7'], description: 'A rainbow film pooling on near-black, like petrol on wet tarmac.' },
  { id: 'cs-bgWaveStack', name: 'Wave Stack', iconKey: 'bgWaveStack', gradientColors: ['#020617', '#a5f3fc'], description: 'Layered wave bands stacked back to front.' },
];

// Shaders — the Paper-grade WebGL2 shader pack (default-code-components with
// vendored paper-design/shaders GLSL). No gradientColors: these cards render
// full-bleed cover images from shader-thumb-map, like the sections library.
// Gem Smoke and Liquid Metal accept an uploaded image (logo → glass/chrome).
const SHADER_LIBRARY_ITEMS: InsertItem[] = [
  { id: 'cs-shaderGemSmoke',      name: 'Gem Smoke',      iconKey: 'shaderMeshGradient',  description: 'Glassy gem form wrapped in flowing smoke. Upload a logo or image to become refractive glass.' },
  { id: 'cs-shaderLiquidMetal',   name: 'Liquid Metal',   iconKey: 'shaderLiquidMetal',   description: 'Liquid chrome surface with banded reflections. Upload a logo or image to become flowing metal.' },
  { id: 'cs-shaderMeshGradient',  name: 'Mesh Gradient',  iconKey: 'shaderMeshGradient',  description: 'Flowing mesh of color spots moving on distinct paths, warped by organic distortion and swirl.' },
  { id: 'cs-shaderGrainGradient', name: 'Grain Gradient', iconKey: 'shaderMeshGradient',  description: 'Softly animated color fields through heavy film grain with seven geometric shape modes.' },
  { id: 'cs-shaderMetaballs',     name: 'Metaballs',      iconKey: 'shaderMeshGradient',  description: 'Gooey metaballs that merge and split as they drift, blending up to four colors.' },
  { id: 'cs-shaderSmokeRing',     name: 'Smoke Ring',     iconKey: 'shaderMeshGradient',  description: 'A billowing ring of layered smoke, drifting and churning around its own center.' },
];

// ─── Sections library items ────────────────────────────────────────────────

function sectionLibraryItems(category: SectionCategory): InsertItem[] {
  return SECTION_BLUEPRINTS.filter((b) => b.category === category).map((b) => ({
    id: sectionItemId(b.id),
    name: b.name,
    iconKey: 'sectionBlueprint',
    sectionBlueprintId: b.id,
  }));
}

// ─── Categories ────────────────────────────────────────────────────────────

export const CATEGORIES: InsertCategory[] = [
  {
    id: 'elements',
    label: 'Elements',
    iconKey: 'elements',
    columns: 3,
    sections: [
      { id: 'basic', label: 'Basic', items: BASIC_ITEMS },
      { id: 'typography', label: 'Typography', items: TYPOGRAPHY_ITEMS },
      // Cards + Layouts merged — both are pre-arranged structural
      // templates (a wrapper + child frames). Bare layout primitives
      // come FIRST so the user grabs the structural shape they need
      // (2 Row / 3 Col / Grid / Sidebar / Header) before scrolling
      // to the richer Card recipes (Basic / Horizontal / Pricing /
      // Product / etc.) at the bottom of the section.
      { id: 'layouts', label: 'Layouts', items: [...LAYOUT_ITEMS, ...CARD_ITEMS] },
      { id: 'shapes', label: 'Shapes', items: SHAPE_ITEMS },
    ],
  },
  // Sections — the source-level blueprint library (shared/sections-library).
  // Items are generated from the registry so a new blueprint shows up here
  // by being added to SECTION_BLUEPRINTS alone. Cards drag like every other
  // element (blueprintToToolbarItem builds the descriptor tree per drag).
  // TEMPORARILY hidden pre-push (2026-08-30) — uncomment to relaunch; the
  // library, insert path, thumbnails and tests all stay live underneath.
  // {
  //   id: 'sections',
  //   label: 'Sections',
  //   iconKey: 'sections',
  //   columns: 1,
  //   sections: [
  //     { id: 'headers', label: 'Headers', items: sectionLibraryItems('header') },
  //     { id: 'heroes', label: 'Heroes', items: sectionLibraryItems('hero') },
  //   ],
  // },
  // Creative is no longer a single Insert row — it's promoted to its own
  // top-level GROUP (sibling to Insert / CMS / Community Blocks). The five
  // ex-sections (Effects, Backgrounds, Text Effects, Containers, Cursors)
  // each become their own row + secondary panel via `CREATIVE_CATEGORIES`
  // below.
  {
    id: 'integrations',
    label: 'Integrations',
    iconKey: 'integrations',
    columns: 2,
    sections: [
      { id: 'forms', label: 'Forms', items: WIDGET_FORM_ITEMS },
      { id: 'embeds', label: 'Embeds', items: EMBED_ITEMS },
      { id: 'social', label: 'Social', items: SOCIAL_ITEMS },
    ],
  },
  {
    id: 'icons',
    label: 'Icons',
    iconKey: 'icons',
    columns: 3,
    sections: [],
  },
  {
    id: 'utility',
    label: 'Utility',
    iconKey: 'utility',
    columns: 2,
    sections: [
      // Interactive first (theme/locale — most-used), then visual-effect
      // groups in increasing-fidelity order: Noises (overlay grain/static),
      // Patterns (CSS tiles), Dividers (section breaks). Shaders moved to
      // the Creative category.
      { id: 'interactive', label: 'Interactive', items: INTERACTIVE_UTILITY_ITEMS },
      { id: 'noises', label: 'Noises', items: NOISE_ITEMS },
      { id: 'patterns', label: 'Patterns', items: PATTERN_ITEMS },
      { id: 'dividers', label: 'Dividers', items: DIVIDER_ITEMS },
    ],
  },
];

// ─── Creative ──────────────────────────────────────────────────────────────
//
// Each Creative subcategory is now a TOP-LEVEL row in its own sidebar
// group (between Insert and CMS), and each row opens its own secondary
// panel. Implementation-wise that means each one is a full `InsertCategory`
// with a single section — the secondary-panel renderer takes any
// InsertCategory shape, so we don't need a new code path. Item arrays
// are reused as-is from the per-section constants above (`EFFECTS_ITEMS`
// et al.), so the actual cards inside each panel are unchanged.

export const CREATIVE_CATEGORIES: InsertCategory[] = [
  // HIDDEN 2026-09-01 — shipped to production before it was ready. Commenting
  // out the CATEGORY is all that hides it: nothing else in the codebase refers
  // to `creative-shaders`, so the row simply stops rendering.
  //
  // Left in place for the restore: `SHADER_LIBRARY_ITEMS` (this file),
  // `creativeShaders` in category-icons.tsx, shader-thumb-map.ts and the
  // shader-thumbs/ images. `SHADER_LIBRARY_ITEMS` is now referenced only by
  // this comment - that is deliberate, not dead code to be swept.
  //
  // To restore: uncomment the block below. Nothing else to change.
  //
  // Shaders leads the group — the flagship pack (thumbnail cards, not
  // gradient tiles). Distinct from Backgrounds: these are the Paper-grade
  // WebGL2 components, two of which turn an uploaded image into glass/chrome.
  {
    id: 'creative-shaders',
    label: 'Shaders',
    iconKey: 'creativeShaders',
    columns: 2,
    sections: [{ id: 'shaders', label: 'Shaders', items: SHADER_LIBRARY_ITEMS }],
  },
  {
    id: 'creative-effects',
    label: 'Effects',
    iconKey: 'creativeEffects',
    columns: 2,
    sections: [{ id: 'effects', label: 'Effects', items: EFFECTS_ITEMS }],
  },
  {
    id: 'creative-backgrounds',
    label: 'Backgrounds',
    iconKey: 'creativeBackgrounds',
    columns: 2,
    sections: [{ id: 'backgrounds', label: 'Backgrounds', items: BACKGROUND_ITEMS }],
  },
  {
    id: 'creative-text-effects',
    label: 'Text Effects',
    iconKey: 'creativeTextEffectsCategory',
    columns: 2,
    sections: [{ id: 'textEffects', label: 'Text Effects', items: TEXT_EFFECTS_ITEMS }],
  },
  {
    id: 'creative-cursors',
    label: 'Cursors',
    iconKey: 'creativeCursors',
    columns: 2,
    sections: [{ id: 'cursors', label: 'Cursors', items: CURSORS_ITEMS }],
  },
];

