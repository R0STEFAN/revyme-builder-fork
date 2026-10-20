/**
 * Self-documenting knowledge base & reference manual for Revyme MCP tools.
 * Inspired by Webstudio's meta.index and mcp-guidance architecture.
 */

export interface McpHelpResult {
  title: string;
  summary: string;
  syntax?: string;
  arguments?: Record<string, string>;
  examples?: Array<{ description: string; call: Record<string, unknown> }>;
  rules?: string[];
  anti_patterns?: string[];
  related_tools?: string[];
  next_steps?: string;
  content?: string;
}

export function getMcpHelp({ toolName, topic }: { toolName?: string; topic?: string }): McpHelpResult {
  if (toolName) {
    switch (toolName) {
      case 'revyme_manage_presets':
        return {
          title: 'Tool Manual: revyme_manage_presets',
          summary: 'Manage design tokens in globals.css (colors, typography, spacing, radius, shadow, border). Supports creating semantic typography presets (H1–H6) and single tokens.',
          syntax: 'revyme_manage_presets({ action: "set_typography" | "set" | "list" | "remove", ... })',
          arguments: {
            action: '"set_typography" (create/update full text style family), "set" (create/update tokens), "list" (view existing), "remove" (delete token)',
            name: 'Preset slug for set_typography, e.g. "heading-1", "heading-2", "body", "mono"',
            tag: 'Semantic HTML tag for set_typography: "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "p" | "span" | "label" | "li". Defaults to "p".',
            values: 'Object with typography overrides: size (fluid clamp recommended), font, weight, line-height (unitless!), spacing, color, stroke-width (in em), stroke-color, size-md, size-sm',
            tokens: 'Array of tokens for action="set": [{ name: "radius-card", value: "16px", category: "radius" }]'
          },
          examples: [
            {
              description: 'Create an H1 Hero Typography Preset with fluid clamp scaling',
              call: {
                action: 'set_typography',
                name: 'heading-1',
                tag: 'h1',
                values: {
                  size: 'clamp(3rem, 8vw, 6.5rem)',
                  'line-height': '1.05',
                  weight: '700',
                  font: "'Inter', sans-serif",
                  spacing: '-0.04em',
                  color: '#000000'
                }
              }
            },
            {
              description: 'Create design tokens for radius, borders, and shadows',
              call: {
                action: 'set',
                tokens: [
                  { name: 'radius-card', value: '16px', category: 'radius' },
                  { name: 'radius-button', value: '8px', category: 'radius' },
                  { name: 'radius-pill', value: '9999px', category: 'radius' },
                  { name: 'shadow-card', value: '0 4px 20px rgba(0, 0, 0, 0.08)', category: 'shadow' },
                  { name: 'border-hairline', value: '1px solid rgba(0, 0, 0, 0.1)', category: 'border' },
                  { name: 'color-brand', value: '#6366f1', category: 'color' }
                ]
              }
            }
          ],
          rules: [
            'All tokens live in globals.css under :root. Using an unregistered var(--name) in JSX is rejected by Oracle (UNKNOWN_TOKEN).',
            'Typography line-height MUST be unitless (e.g. "1.1", "1.5"), never px or rem.',
            'Typography stroke-width MUST be in em (e.g. "0.015em") so it scales proportionally across viewports.',
            'Padding, margin, and border-radius in elements MUST use concrete px values in inline styles; do not put var() in padding.'
          ],
          anti_patterns: [
            'Creating typography presets only as "p" — always specify tag: "h1", "h2", etc. for proper semantic hierarchy.',
            'Hardcoding hex colors and arbitrary pixel fonts instead of design tokens.'
          ],
          related_tools: ['revyme_get_context', 'revyme_insert_fragment', 'revyme_set_responsive_styles']
        };

      case 'revyme_capture_screenshot':
        return {
          title: 'Tool Manual: revyme_capture_screenshot',
          summary: 'Capture a visual screenshot of the live canvas at a specific viewport and check for horizontal layout overflow.',
          syntax: 'revyme_capture_screenshot({ viewport: "mobile" | "tablet" | "desktop", format?: "png" | "jpeg" })',
          arguments: {
            viewport: '"mobile" (390px / 809px), "tablet" (810px / 1199px), "desktop" (1200px+). Defaults to active viewport.',
            format: '"png" (default, lossless) or "jpeg"',
            saveToFile: 'boolean (default true) — writes the captured PNG to local artifact directory and returns the absolute path'
          },
          examples: [
            {
              description: 'Capture mobile screenshot to verify phone layout and check for horizontal overflow',
              call: { viewport: 'mobile', format: 'png' }
            },
            {
              description: 'Capture desktop screenshot for aesthetic design audit',
              call: { viewport: 'desktop', format: 'png' }
            }
          ],
          rules: [
            'ALWAYS call revyme_capture_screenshot(viewport: "mobile") after modifying page layout or grids to ensure mobile safety.',
            'Check the returned layout.horizontalOverflow flag: if true, content exceeds the screen width!'
          ],
          related_tools: ['revyme_audit_design', 'revyme_set_responsive_styles']
        };

      case 'revyme_set_responsive_styles':
        return {
          title: 'Tool Manual: revyme_set_responsive_styles',
          summary: 'Apply responsive CSS style overrides for a specific breakpoint on an element by its data-id.',
          syntax: 'revyme_set_responsive_styles({ node_id: string, viewport: "mobile" | "tablet" | number, styles: Record<string, string> })',
          arguments: {
            node_id: 'data-id of target element (e.g. "projects-grid", "hero-container")',
            viewport: '"mobile" (maxWidth: 809), "tablet" (maxWidth: 1199), or a custom width in px (e.g. 390, 810)',
            styles: 'CSS properties in camelCase. Passing empty string "" removes an override.'
          },
          examples: [
            {
              description: 'Collapse a 2-column grid into a single column on mobile screens',
              call: {
                node_id: 'projects-grid',
                viewport: 'mobile',
                styles: {
                  gridTemplateColumns: '1fr',
                  gap: '32px'
                }
              }
            },
            {
              description: 'Adjust section padding for phone viewports',
              call: {
                node_id: 'hero-sec',
                viewport: 'mobile',
                styles: {
                  paddingTop: '90px',
                  paddingBottom: '60px'
                }
              }
            }
          ],
          rules: [
            'Overriding responsive styles generates clean @container / @media rules in the builder.',
            'Passing "" for a style property cleanly deletes the breakpoint override (empty string = remove convention).'
          ],
          related_tools: ['revyme_audit_design', 'revyme_capture_screenshot']
        };

      case 'revyme_insert_fragment':
        return {
          title: 'Tool Manual: revyme_insert_fragment',
          summary: 'Insert complete JSX component subtrees with auto-generated data-ids, Framer Motion animations, and design token references.',
          syntax: 'revyme_insert_fragment({ parent_id: string, fragment: string, insert_before_id?: string, hover?: Record<string, string> })',
          arguments: {
            parent_id: 'data-id of container element to insert into (e.g. "root", "hero-container")',
            fragment: 'JSX string representing the component hierarchy (using lowercase HTML tags or registered components)',
            insert_before_id: 'Optional data-id of sibling to insert before (inserts at end if omitted)',
            hover: 'Optional hover style patch for interactive micro-interactions'
          },
          examples: [
            {
              description: 'Insert responsive feature card with design tokens and spring hover',
              call: {
                parent_id: 'features-grid',
                fragment: '<div style={{ backgroundColor: "var(--color-surface)", borderRadius: "var(--radius-card)", padding: "32px", border: "var(--border-hairline)" }}><h3>Enterprise Security</h3><p>End-to-end cryptographic proofs.</p></div>',
                hover: { transform: 'translateY(-4px)' }
              }
            }
          ],
          related_tools: ['revyme_manage_presets', 'revyme_set_responsive_styles', 'revyme_audit_design']
        };

      case 'revyme_audit_design':
        return {
          title: 'Tool Manual: revyme_audit_design',
          summary: 'Executes hard visual and responsive linting rules against the rendered canvas across viewports.',
          syntax: 'revyme_audit_design({ viewport?: "desktop" | "tablet" | "mobile" })',
          rules: [
            'Sibling Overlap: flags sibling bounding boxes that collide by > 4px.',
            'Child Overflow: flags children spilling beyond their parent boundaries by > 8px.',
            'Section Overflow: flags sections or elements that exceed viewport width.',
            'WCAG Contrast: checks text luminance against background for minimum 4.5:1 ratio.',
            'Minimum Font Size: flags unreadable text under 12px.',
            'Text Truncation: detects cut-off text.'
          ],
          next_steps: 'Run after every layout or style change. Target 0 violations on both desktop and mobile.'
        };
    }
  }

  // Topic guides
  if (topic === 'responsive_grid' || topic === 'responsive') {
    return {
      title: 'Topic Guide: Responsive-First Grid Systems in Revyme',
      summary: 'How to build grids that never break on mobile devices.',
      content: `### 1. Intrinsic CSS Grids (Preferred)
Instead of hardcoding \`gridTemplateColumns: '1fr 1fr'\` or \`'1fr 1fr 1fr'\`, use intrinsic auto-fit:
\`\`\`tsx
style={{
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
  gap: '32px',
  width: '100%'
}}
\`\`\`
Why this works:
- On Desktop (1200px): Fits 2 to 4 columns automatically.
- On Tablet (810px): Fits 2 columns.
- On Mobile (390px): Because minmax is 280px, it smoothly collapses to 1 column without ANY media query!

### 2. Multi-Viewport Overrides via MCP
If you need explicit column counts per device, use revyme_set_responsive_styles:
\`\`\`json
{
  "node_id": "projects-grid",
  "viewport": "mobile",
  "styles": { "gridTemplateColumns": "1fr" }
}
\`\`\`

### 3. Verification Protocol
Always run:
1. revyme_capture_screenshot({ viewport: "mobile" })
2. revyme_audit_design({ viewport: "mobile" })`
    };
  }

  if (topic === 'typography') {
    return {
      title: 'Topic Guide: Typography Presets & Semantic Hierarchy',
      summary: 'How to configure and apply the complete H1–H6 typography system in Revyme.',
      content: `### Typography Preset Architecture
A typography preset in Revyme is a compound family of CSS variables grouped in globals.css.
When applied to a node:
1. The element is retagged to the preset's semantic tag (e.g. h1, h2, h3).
2. The styles are bound:
   - fontFamily: var(--typo-<name>-font)
   - fontSize: var(--typo-<name>-size)
   - fontWeight: var(--typo-<name>-weight)
   - lineHeight: var(--typo-<name>-line-height)
   - letterSpacing: var(--typo-<name>-spacing)
   - color: var(--typo-<name>-color)

### Recommended Preset Scale:
- **heading-1** (tag: "h1"): Hero title, \`clamp(3rem, 8vw, 6.5rem)\`, lineHeight: 1.05
- **heading-2** (tag: "h2"): Section header, \`clamp(2rem, 4.5vw, 3.5rem)\`, lineHeight: 1.15
- **heading-3** (tag: "h3"): Card title, \`clamp(1.25rem, 2.5vw, 1.75rem)\`, lineHeight: 1.3
- **body** (tag: "p"): Editorial copy, \`clamp(1rem, 1.4vw, 1.25rem)\`, lineHeight: 1.6
- **mono** (tag: "span"): Overlines / badges, \`clamp(11px, 1.2vw, 13px)\`, letterSpacing: '0.1em'`
    };
  }

  if (topic === 'tokens') {
    return {
      title: 'Topic Guide: The 7 Design Token Categories',
      summary: 'Complete reference of design tokens supported by Revyme globals.css.',
      content: `Revyme categorizes tokens by their prefix:
1. **color-***: \`--color-brand\`, \`--color-surface\`, \`--color-text\`, \`--color-text-muted\`
2. **typo-***: Managed via \`action: "set_typography"\`
3. **space-***: \`--space-section-y\`, \`--space-container-x\`, \`--space-gap\`
4. **radius-***: \`--radius-card\` (16px), \`--radius-button\` (8px), \`--radius-pill\` (9999px)
5. **shadow-***: \`--shadow-card\`, \`--shadow-elevated\`
6. **border-***: \`--border-hairline\` (\`1px solid rgba(0,0,0,0.1)\`), \`--border-focus\`
7. **margin-***: \`--margin-section-bottom\``
    };
  }

  // Default Overview
  return {
    title: 'Revyme Builder MCP Manual & Discovery Index',
    summary: 'Central reference for all Revyme MCP operations, self-documenting syntax, and safety rules.',
    content: `Available Tools & Categories:
1. **Visual & Verification**:
   - \`revyme_capture_screenshot\`: Capture PNG and check layout.horizontalOverflow
   - \`revyme_audit_design\`: Hard visual linting (overlaps, overflows, contrast)
2. **Design System & Tokens**:
   - \`revyme_manage_presets\`: Typography presets (H1-H6) and tokens (radius, shadow, border)
   - \`revyme_set_responsive_styles\`: Multi-viewport responsive overrides
3. **Structure & Content**:
   - \`revyme_insert_fragment\`: Declarative JSX with Framer Motion hover
   - \`revyme_submit_files\`: Whole-file Next.js code commits
   - \`revyme_manage_cms\`: CMS collections, repeaters, and dynamic fx expressions
4. **Documentation & Help**:
   - \`revyme_help\`: Call with { tool_name: "..." } or { topic: "typography" | "responsive_grid" | "tokens" }`
  };
}
