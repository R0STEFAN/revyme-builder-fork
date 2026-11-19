---
name: revyme-audit-and-seo
description: "Read-only canvas inspection (observe.*, diagnostics.projectCheck), SEO configuration (metadata.*, seo.*, redirects.*), and build/publish preflight (publish.preflight, preview.build, export.*) via Revyme MCP v2."
---

# Revyme Audit, Diagnostics & SEO

Use this skill to inspect the canvas geometry, capture visual screenshots, validate project health, optimize SEO/llms.txt/Schema.org metadata, or verify release readiness before publishing.

---

## 1. Visual & Layout Observation (`observe.*`)
- `observe.selection`: Get the node IDs currently selected by the user in the editor.
- `observe.layout`: Read computed bounding boxes, scroll geometry, and viewport dimensions.
- `observe.visuals` / `observe.composition`: Inspect computed colors, typography, and structural hierarchy.
- `observe.audit`: Detect visual overlaps, clipped containers, offscreen elements, and responsive overflow.
- `observe.screenshot`: Capture rendered PNG screenshots per viewport to verify visual parity.

## 2. Project & Effect Diagnostics (`diagnostics.*`, `verify.*`, `site.audit`)
- `diagnostics.projectCheck`: Run static Oracle & project integrity validation across TSX source files.
- `verify.effect`: Validate animation / split-text / runtime effect hooks.
- `assets.audit`: Check image/media assets for unused files or invalid references.
- `site.audit`: Holistic multi-page structural check.

## 3. Metadata, SEO & Redirects (`metadata.*`, `seo.*`, `redirects.*`)
- Page metadata (title, description, OpenGraph, favicon): `metadata.read`, `metadata.update`.
- Search engine & AI discovery controls: `seo.audit`, `seo.setRobots`, `seo.configureLlms`, `seo.setSchemaOrg`, `seo.syncSitemap`.
- URL redirects: `redirects.list`, `redirects.add`, `redirects.reorder`, `redirects.remove`.

## 4. Preflight, Preview, Publish & Export (`publish.*`, `preview.*`, `export.*`)
- Pre-deploy verification: `publish.preflight`.
- Trigger preview or deployment: `preview.build`, `publish.deploy`, `publish.status`.
- Export clean source bundles: `export.formats`, `export.generate`.
