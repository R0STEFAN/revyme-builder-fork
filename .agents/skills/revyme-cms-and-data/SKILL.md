---
name: revyme-cms-and-data
description: "Author CMS collections, schemas, items, bound collection lists and detail pages (cms.*), external REST API collections (cms.api.*), forms with email/webhook destinations (forms.*), and multi-locale translations (locales.*, translations.*) via Revyme MCP v2."
---

# Revyme CMS, Forms & Localization

Use this skill for structured content collections, external API data fetching, interactive lead-capture/contact forms, and multi-language sites.

---

## 1. CMS Schemas & Items (`cms.schema.*`, `cms.field.*`, `cms.items.*`)
1. Inspect existing collections: `cms.schema.list`, `cms.schema.get`.
2. Create or update collections: `cms.schema.create`, `cms.schema.update`, `cms.schema.duplicate`.
3. Define fields (`text`, `richText`, `image`, `number`, `boolean`, `date`, `reference`, etc.): `cms.field.add`, `cms.field.update`, `cms.field.reorder`, `cms.field.remove`.
4. Seed and maintain entries: `cms.items.list`, `cms.items.get`, `cms.items.create`, `cms.items.update`, `cms.items.reorder`, `cms.items.remove`.

## 2. Collection Lists & Dynamic Pages (`cms.list.*`, `cms.pages.*`, `cms.field.bind`)
- Bind a canvas list container to a CMS collection: `cms.list.create`, `cms.list.configure`, `cms.list.paginate`.
- Bind child node text/images/links to CMS fields: `cms.field.bind`, `cms.field.unbind`.
- Generate CMS index (`/blog`) and detail (`/blog/[slug]`) pages with SEO bindings: `cms.pages.createIndex`, `cms.pages.createDetail`, `cms.pages.seo`, `cms.pages.find`.

## 3. External API Collections (`cms.api.*`)
- Switch or check API mode: `cms.api.mode.get`, `cms.api.mode.set`.
- Register and configure REST endpoints: `cms.api.collection.set`, `cms.api.collection.list`, `cms.api.detectItemsKey`, `cms.api.fetch`, `cms.api.queryConfig.set`.
- Wire live search inputs: `cms.api.searchField.add`, `cms.api.searchField.setVariable`.

## 4. Accessible Forms (`forms.*`)
- Build or modify forms: `forms.create`, `forms.field.add`, `forms.field.update`, `forms.field.remove`, `forms.submitButton.add`, `forms.honeypot.add`, `forms.selectCaret.set`.
- Configure relay destinations (`/api/form`): `forms.destination.set`, `forms.destination.get`.
- Map success/loading/error UI states: `forms.state.map`, `forms.state.get`.
- Note: Plain `<form>` elements inserted via `fragments.insert` also auto-wire `onSubmit`, `data-form`, and input `name` attributes on ingestion.

## 5. Multi-Locale Sites (`locales.*`, `translations.*`)
- Configure supported languages and URL routes: `locales.get`, `locales.add`, `locales.setDefault`, `locales.routes.sync`, `locales.switcher.add`.
- Populate per-locale copy, attributes, styles, and CMS items: `translations.set`, `translations.attribute.set`, `translations.style.set`, `translations.cmsItem.set`, `translations.instanceProp.set`.
