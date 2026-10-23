# Revyme Automation & MCP v2 - Recipes & Workflow Guide

This guide provides end-to-end recipes for automating website construction, data integration, interactive animation, and project lifecycle management using the **Revyme CLI** (`@revyme/cli`) and **Model Context Protocol (MCP) v2 Bridge**.

---

## Table of Contents

1. [Overview & Interfaces](#overview--interfaces)
2. [Recipe L01: Responsive Marketing Landing Page Assembly](#recipe-l01-responsive-marketing-landing-page-assembly)
3. [Recipe L02: Dynamic CMS & External Data Ingestion](#recipe-l02-dynamic-cms--external-data-ingestion)
4. [Recipe L03: Visual Effects, Framer Motion & Code Components](#recipe-l03-visual-effects-framer-motion--code-components)
5. [Recipe L04: Project Lifecycle, Branching, Merge & Recovery](#recipe-l04-project-lifecycle-branching-merge--recovery)
6. [Best Practices & Oracle Compliance](#best-practices--oracle-compliance)

---

## Overview & Interfaces

Revyme v2 exposes automation capabilities through two complementary surfaces:

1. **CLI Commands (`revyme`)**: Shell-executable commands suitable for CI/CD, scripting, and offline batch operations.
2. **MCP v2 Operations (`revyme_agent_tool`)**: Structured JSON-RPC operations exposed to AI agents via the MCP protocol.

Each recipe illustrates both CLI invocation and MCP payload semantics.

---

## Recipe L01: Responsive Marketing Landing Page Assembly

Assemble a production-grade, SEO-optimized, responsive marketing landing page from scratch with unified design tokens, typography, hero section, metrics grid, pricing table, contact form, and footer.

### Workflow Steps

```
[Tokens & Fonts] ──► [Page Scaffold] ──► [Hero & Features] ──► [Form & CTA] ──► [SEO & Viewports]
```

### 1. Configure Design Tokens & Typography

#### CLI Invocation
```bash
# Update brand color presets
revyme tokens set --primary "#4F46E5" --secondary "#06B6D4" --background "#0A0B0E" --text "#F3F4F6"

# Load Google Fonts (e.g. Inter + Plus Jakarta Sans)
revyme fonts add --family "Plus Jakarta Sans" --weights 400,600,700 --display swap
```

#### MCP Tool Payload (`revyme_agent_tool`)
```json
{
  "operation": "presets.theme.update",
  "params": {
    "colors": {
      "primary": "#4F46E5",
      "secondary": "#06B6D4",
      "background": "#0A0B0E",
      "surface": "#12131A",
      "text": "#F3F4F6"
    },
    "fonts": [
      {
        "family": "Plus Jakarta Sans",
        "weights": ["400", "600", "700"],
        "display": "swap"
      }
    ]
  }
}
```

### 2. Scaffold Marketing Page & Sections

#### CLI Invocation
```bash
# Create landing page route
revyme pages create --path "/launch" --title "Revyme Cloud Launch"

# Insert section blueprints
revyme sections insert --page "/launch" --blueprint "hero-split" --id "hero-sec"
revyme sections insert --page "/launch" --blueprint "stats-grid-4" --after "hero-sec" --id "stats-sec"
revyme sections insert --page "/launch" --blueprint "pricing-tiers-3" --after "stats-sec" --id "pricing-sec"
revyme sections insert --page "/launch" --blueprint "contact-form" --after "pricing-sec" --id "contact-sec"
```

#### MCP Tool Payload
```json
{
  "operation": "sections.insert",
  "params": {
    "targetFile": "pages/launch.tsx",
    "blueprint": "hero-split",
    "sectionId": "hero-sec",
    "slots": {
      "headline": "Build 10x Faster with Next.js Visual Engine",
      "subheading": "Real code document format. No proprietary lock-in. Full AST synchronization.",
      "ctaPrimary": {
        "text": "Start Free Trial",
        "href": "/signup"
      }
    }
  }
}
```

### 3. Add Contact Form with Validation & Honeypot

#### MCP Tool Payload
```json
{
  "operation": "forms.create",
  "params": {
    "targetFile": "pages/launch.tsx",
    "parentNodeId": "contact-sec",
    "endpoint": "https://api.revyme.dev/v1/leads",
    "method": "POST",
    "honeypot": true,
    "fields": [
      { "name": "fullName", "type": "text", "label": "Full Name", "required": true },
      { "name": "email", "type": "email", "label": "Work Email", "required": true },
      { "name": "companySize", "type": "select", "label": "Company Size", "options": ["1-10", "11-50", "50+"] },
      { "name": "notes", "type": "textarea", "label": "Project Details" }
    ]
  }
}
```

### 4. Configure Responsive Viewport Overrides & SEO

#### CLI Invocation
```bash
# Set mobile responsive overrides (padding and direction)
revyme styles set-responsive \
  --page "/launch" \
  --node "hero-container" \
  --breakpoint "mobile" \
  --styles '{"flexDirection":"column","paddingLeft":"16px","paddingRight":"16px"}'

# Configure SEO metadata
revyme pages set-metadata \
  --page "/launch" \
  --title "Revyme Cloud — Production React Builder" \
  --description "High-performance visual builder producing real Next.js source code." \
  --og-image "/assets/og-launch.png" \
  --canonical "https://revyme.dev/launch"
```

---

## Recipe L02: Dynamic CMS & External Data Ingestion

Create structured content schemas, populate collection records, bind dynamic data expressions to canvas nodes, and connect external headless API providers (Strapi, Directus, or Baserow) with multi-locale translation support.

### Workflow Steps

```
[CMS Schema] ──► [Collection Records] ──► [External API Provider] ──► [JSX Bindings] ──► [Locales/i18n]
```

### 1. Model Schema & Hydrate Collection Records

#### CLI Invocation
```bash
# Create CMS schema
revyme cms schema create --slug "blog-posts" --name "Blog Posts"

# Add fields
revyme cms fields add --schema "blog-posts" --name "title" --type "string" --required
revyme cms fields add --schema "blog-posts" --name "slug" --type "slug" --required
revyme cms fields add --schema "blog-posts" --name "publishedAt" --type "datetime"
revyme cms fields add --schema "blog-posts" --name "content" --type "markdown"

# Insert record
revyme cms items create --schema "blog-posts" --data '{
  "title": "Announcing Automation v2",
  "slug": "announcing-automation-v2",
  "publishedAt": "2026-10-23T00:00:00Z",
  "content": "Full AST round-tripping for AI agents and engineering teams."
}'
```

#### MCP Tool Payload
```json
{
  "operation": "cms.schema.create",
  "params": {
    "slug": "case-studies",
    "name": "Case Studies",
    "fields": [
      { "id": "clientName", "type": "string", "label": "Client Name", "required": true },
      { "id": "logoUrl", "type": "image", "label": "Client Logo" },
      { "id": "metricHighlight", "type": "string", "label": "Metric Highlight" },
      { "id": "summary", "type": "text", "label": "Summary" }
    ]
  }
}
```

### 2. Connect External Headless API Provider

#### MCP Tool Payload
```json
{
  "operation": "cms.external.connect",
  "params": {
    "provider": "strapi",
    "endpoint": "https://cms.revyme.dev/api",
    "collection": "articles",
    "authToken": "env:STRAPI_API_TOKEN",
    "pagination": { "mode": "cursor", "limit": 20 },
    "search": { "queryParam": "filters[title][$containsi]" }
  }
}
```

### 3. Bind Dynamic Expressions & State Variables

#### MCP Tool Payload
```json
{
  "operation": "variables.create",
  "params": {
    "targetFile": "pages/blog/[slug].tsx",
    "name": "readingProgress",
    "type": "number",
    "defaultValue": "0"
  }
}
```

```json
{
  "operation": "bindings.bindExpression",
  "params": {
    "targetFile": "pages/blog/[slug].tsx",
    "nodeId": "article-headline",
    "prop": "children",
    "expression": "post.title"
  }
}
```

### 4. Configure Multi-Locale i18n & RTL

#### CLI Invocation
```bash
# Add languages and set RTL for Arabic
revyme i18n add-locale --locale "es" --label "Español"
revyme i18n add-locale --locale "ar" --label "العربية" --dir "rtl"

# Import translation key-values
revyme i18n set-translations --locale "es" --file "locales/es.json"
```

---

## Recipe L03: Visual Effects, Framer Motion & Code Components

Build high-polish interactive visuals using Framer Motion physics, vector SVG sketch animations, custom TypeScript `@controls` code components, and site-wide smooth scrolling.

### Workflow Steps

```
[Motion Presets] ──► [Scroll Physics] ──► [Vector SVG Draw] ──► [Code Component] ──► [Audit]
```

### 1. Apply Framer Motion Presets & Scroll Triggers

#### CLI Invocation
```bash
# Apply fade-up entrance to hero card
revyme motion apply \
  --page "/index" \
  --node "feature-card-1" \
  --preset "fade-up" \
  --duration 0.6 \
  --delay 0.2 \
  --easing "easeOut"

# Apply scroll-linked scale effect
revyme motion apply \
  --page "/index" \
  --node "hero-media-preview" \
  --trigger "scroll" \
  --scroll-offset "0 1" \
  --transform-range '{"scale":[0.8, 1.0],"opacity":[0.3, 1.0]}'
```

#### MCP Tool Payload
```json
{
  "operation": "motion.preset.apply",
  "params": {
    "targetFile": "pages/index.tsx",
    "nodeId": "metric-badge",
    "preset": "spring-pop",
    "physics": {
      "type": "spring",
      "stiffness": 400,
      "damping": 25
    }
  }
}
```

### 2. Animate SVG Vector Path (Sketch Draw)

#### MCP Tool Payload
```json
{
  "operation": "vectors.sketch.animate",
  "params": {
    "targetFile": "pages/index.tsx",
    "nodeId": "hand-drawn-accent",
    "strokeDuration": 1.2,
    "strokeEasing": "easeInOut",
    "trigger": "inView"
  }
}
```

### 3. Create Code Component with `@controls`

Author custom React components with editable properties exposed to the visual inspector.

#### Source Code: `components/GlobeHero.tsx`
```tsx
import React from 'react';

/**
 * Interactive 3D WebGL Globe
 * @controls
 * @control autoRotate {boolean} - Enable continuous rotation
 * @control speed {number} [0.1, 5, 0.1] - Rotation speed multiplier
 * @control markerColor {color} - Accent color for active locations
 */
export interface GlobeHeroProps {
  autoRotate?: boolean;
  speed?: number;
  markerColor?: string;
}

export function GlobeHero({
  autoRotate = true,
  speed = 1.0,
  markerColor = '#4F46E5',
}: GlobeHeroProps) {
  return (
    <div data-id="globe-root" style={{ width: '100%', height: '500px', position: 'relative' }}>
      <canvas data-id="globe-canvas" style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
```

#### CLI Registration
```bash
revyme components code-create --path "components/GlobeHero.tsx"
```

### 4. Enable Smooth Scroll & Run Visual Audit

#### CLI Invocation
```bash
# Enable Lenis site-wide smooth scrolling
revyme effects set-smooth-scroll --enabled true --duration 1.2

# Audit design for WCAG contrast and layout integrity
revyme audit design --page "/index"
```

---

## Recipe L04: Project Lifecycle, Branching, Merge & Recovery

Safely branch projects for AI agent experimentation, compute AST diffs, perform automated 3-way AST merges, maintain snapshot checkpoints, and restore verified backups upon failure.

### Workflow Steps

```
[Backup Snapshot] ──► [Feature Branch] ──► [Mutate & Diff] ──► [AST Merge] ──► [Health Check]
```

### 1. Export Checksummed Project Backup

#### CLI Invocation
```bash
# Create full standalone backup archive
revyme projects backup export --out "backups/pre-redesign-2026.revyme"
```

#### MCP Tool Payload
```json
{
  "operation": "projects.backup.export",
  "params": {
    "destination": "backups/checkpoint-01.revyme",
    "includeAssets": true
  }
}
```

### 2. Create Feature Branch & Perform Safe Edits

#### CLI Invocation
```bash
# Create and switch to agent branch
revyme branches create "agent-redesign-v2" --checkout

# Perform modifications...
revyme styles set --page "/index" --node "hero-title" --styles '{"fontSize":"56px","letterSpacing":"-0.03em"}'
```

#### MCP Tool Payload
```json
{
  "operation": "branches.create",
  "params": {
    "branchId": "agent-redesign-v2",
    "fromBranch": "main"
  }
}
```

### 3. Review AST Diff & Apply 3-Way AST Merge

#### CLI Invocation
```bash
# Diff changes against main branch
revyme branches diff "main" "agent-redesign-v2"

# Perform conflict-free AST merge into main
revyme branches merge "agent-redesign-v2" --into "main" --strategy "ast-three-way"
```

#### MCP Tool Payload
```json
{
  "operation": "branches.merge.apply",
  "params": {
    "sourceBranch": "agent-redesign-v2",
    "targetBranch": "main",
    "conflictResolution": "prefer-incoming"
  }
}
```

### 4. Disaster Recovery & Rollback

If validation fails post-merge, instantly restore to the prior verified revision or backup.

#### CLI Invocation
```bash
# Roll back to previous snapshot
revyme history undo --steps 1

# Or restore full backup archive
revyme projects backup restore --archive "backups/checkpoint-01.revyme"
```

---

## Best Practices & Oracle Compliance

The **Revyme Oracle** (`src/code/oracle/check-file.ts`) enforces strict AST invariants before any file change is written to ProjectFS. To ensure 100% first-pass acceptance:

1. **Deterministic Node IDs**: Every JSX element must contain a unique `data-id="<unique-id>"`. Elements without `data-id` trigger `RESOLVE_UNIDENTIFIED_ELEMENT`.
2. **Page Root Dimensions**: Top-level page frames must specify `width: '100%'` and `height: 'auto'`. Avoid `minHeight: '100vh'` on artboard roots (`PAGE_ROOT_VIEWPORT_SIZE`).
3. **Explicit Flex Ordering**: Children in flex layouts must have explicit sequential `order: '0'`, `order: '1'` and non-shrinking `flex: '0 0 auto'` (`FLEX_CHILD_MISSING_ORDER`, `FLEX_CHILD_SHRINKS`).
4. **Clean Backgrounds**: For solid fills, use `backgroundColor: '#...'`, not shorthand `background: '#...'` (`BACKGROUND_SOLID_SHORTHAND`).
5. **Frame Text Styles**: Never place text properties (`color`, `textAlign`, `fontSize`) on structural frames (`<div>`, `<section>`, `<footer>`). Apply them directly to `<p>`, `<span>`, or `<h1>`-`<h6>` (`TEXT_STYLE_ON_FRAME`).
6. **Next.js Links**: Internal site links must use Next.js `<Link href="...">`, not standard `<a href="...">` (`PAGE_LINK_NOT_NEXTLINK`).
