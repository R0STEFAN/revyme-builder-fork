# Revyme CMS & Dynamic Expressions (fx) Guide

This guide details how to work with **Built-in CMS Collections**, **External API CMS Mode**, and **Dynamic Expression Formulas (`fx`)** using the Revyme Website Builder's MCP Server.

---

## 1. Built-in CMS Collections

Revyme provides a file-based, zero-database CMS stored directly in `cms/<collection>.json` and `cms/<collection>.schema.json` in `ProjectFS`.

### A. Managing Collections & Items
Use `revyme_manage_cms` with collection CRUD actions:

1. **Create Collection**:
   ```json
   {
     "action": "create_collection",
     "name": "Projects"
   }
   ```
   *Returns the collection slug (e.g. `"projects"`).*

2. **Add Fields**:
   ```json
   {
     "action": "add_field",
     "collection": "projects",
     "name": "Cover Image",
     "field": { "name": "Cover Image", "type": "image", "required": true }
   }
   ```
   *Supported field types: `text`, `textarea`, `richtext`, `number`, `boolean`, `date`, `image`, `file`, `url`, `link`, `color`, `enum`, `tags`, `slug`, `reference`, `multi-reference`.*

3. **Insert Items**:
   ```json
   {
     "action": "add_item",
     "collection": "projects",
     "item": {
       "title": "Brand Identity Redesign",
       "slug": "brand-identity-redesign",
       "cover-image": "/assets/brand-cover.jpg",
       "category": "Design",
       "year": 2026
     }
   }
   ```

4. **Scaffold Index and Detail Pages**:
   ```json
   {
     "action": "create_pages",
     "collection": "projects",
     "kind": "both"
   }
   ```
   *Creates `app/projects/page.tsx` + `app/projects/page.client.tsx` (Index repeater) and `app/projects/[slug]/page.tsx` + `app/projects/[slug]/page.client.tsx` (Item Detail).*

---

### B. Connecting / Binding Data to Canvas Elements

#### 1. Binding a List Repeater (`bind_list`)
When you have a container with a single template row element, call `bind_list` on the **template row** (NOT the container):
```json
{
  "action": "bind_list",
  "nodeId": "project-card-row",
  "collection": "projects"
}
```
**What Revyme Generates**:
Wraps the element in `{projects.map((item, idx) => ( <div data-id="project-card-row" key={idx} ...> ... </div> ))}` and injects `import projects from '@/cms/projects.json';`.

#### 2. Binding Fields on Row Elements (`bind_field`)
Target any node inside the `.map()` to bind its text, attributes, or CSS:
```json
// Bind heading text
{
  "action": "bind_field",
  "nodeId": "project-title-h3",
  "property": "text",
  "fieldId": "title"
}

// Bind image src
{
  "action": "bind_field",
  "nodeId": "project-cover-img",
  "property": "src",
  "fieldId": "cover-image"
}

// Bind link href
{
  "action": "bind_field",
  "nodeId": "project-card-link",
  "property": "href",
  "fieldId": "slug"
}
```
To unbind and restore a static fallback:
```json
{
  "action": "unbind_field",
  "nodeId": "project-title-h3",
  "property": "text",
  "staticValue": "Featured Work"
}
```

#### 3. Binding Design Component Props (`bind_prop`)
If your repeated row is a **Design Component** (e.g. `<ProjectCard data-id="card-inst" ... />`), bind its props:
```json
{
  "action": "bind_prop",
  "nodeId": "card-inst",
  "componentName": "ProjectCard",
  "prop": "title",
  "fieldId": "title"
}
```
**What Revyme Generates**:
`<ProjectCard data-id="card-inst" title={item.title} ... />`.

#### 4. Configuring Filters, Sorting, and Limits (`set_list_config`)
Configure query options on the list container:
```json
{
  "action": "set_list_config",
  "nodeId": "projects-grid-container",
  "filters": [
    { "field": "featured", "operator": "equals", "value": true }
  ],
  "sort": [
    { "field": "year", "direction": "desc" }
  ],
  "limit": 6
}
```
*Supported filter operators: `equals`, `not_equals`, `contains`, `not_contains`, `gt`, `gte`, `lt`, `lte`, `in`, `not_in`, `exists`, `between`.*

#### 5. Pagination (`set_pagination`)
Turn a collection list into a paginated list:
```json
{
  "action": "set_pagination",
  "nodeId": "projects-grid-container",
  "mode": "loadMore",
  "perPage": 6
}
```
*Modes: `"loadMore"` (reveals next page via button), `"infinite"` (reveals on scroll), or `"none"` (removes pagination).*

---

## 2. External API CMS Mode

Revyme supports Headless CMS backends: **Directus**, **Strapi**, **Baserow**, or any **Custom REST API**.
Configuration is persisted in `_meta/cms-api-config.json`.

### A. Checking and Switching Modes
```json
// Query current mode
{ "action": "get_mode" }

// Switch to external API CMS mode
{ "action": "set_mode", "mode": "api" }

// Switch to local JSON mode
{ "action": "set_mode", "mode": "local" }
```

### B. Configuring an External API Collection (`configure_api_collection`)
```json
{
  "action": "configure_api_collection",
  "slug": "directus_articles",
  "apiConfig": {
    "name": "Directus Articles",
    "provider": "directus",
    "url": "https://cms.mybrand.com/items/articles",
    "method": "GET",
    "headers": {
      "Authorization": "Bearer env:DIRECTUS_API_TOKEN"
    },
    "defaultParams": {
      "fields": "*.*",
      "sort": "-date_created"
    },
    "itemsKey": "data",
    "idField": "id",
    "slugField": "slug",
    "revalidateTtl": 60
  }
}
```
*Note: Environment variables in headers are referenced via `env:VARIABLE_NAME` and are automatically resolved during SSR/build without exposing secrets in client bundles.*

### C. Connecting List Query with Backend Parameters (`set_list_query`)
Set `data-query-config` on the list container to query the external API:
```json
{
  "action": "set_list_query",
  "nodeId": "articles-grid",
  "queryConfig": {
    "isApiMode": true,
    "params": [
      { "key": "filter[category][_eq]", "value": "params.category", "isExpression": true },
      { "key": "limit", "value": "12" }
    ]
  }
}
```
**What Revyme Generates**:
- In the client page: `data-query-config={JSON.stringify({ isApiMode: true, params: [...] })}`.
- In Next.js Server Wrapper (`page.tsx`): Revyme automatically orchestrates the server fetch for external queries using `orchestrateServerFetchForQueries`, passing `cmsDatasets` / `serverItems` into the client component for instant SSR rendering and SEO!

---

## 3. Dynamic Expressions & Formulas (`fx`)

Dynamic expressions allow elements to bind to JavaScript formulas, string interpolations, route parameters, and conditionals.

### A. Calling `revyme_bind_expression`
You can call the dedicated tool `revyme_bind_expression` or use `revyme_manage_cms` with `action: 'bind_expression'`:
```json
{
  "nodeId": "headline-text",
  "targetProperty": "text",
  "expression": "params.category + ' тату у Запоріжжі'"
}
```

### B. Supported Expression Formats

| Target Property | Purpose | Example Expression Formula | Generated Output in JSX |
|---|---|---|---|
| `text` | Dynamic headline / body | `item.name + " in " + item.city` | `<h3>{item.name + " in " + item.city}</h3>` |
| `text` | Route parameter title | `params.category + " Projects"` | `<h1>{params.category + " Projects"}</h1>` |
| `text` | Conditional fallback | `item.price ? '$' + item.price : 'Free'` | `<p>{item.price ? '$' + item.price : 'Free'}</p>` |
| `href` | Dynamic link routing | `"/gallery/" + item.category + "/" + item.slug` | `<a href={"/gallery/" + item.category + "/" + item.slug}>` |
| `href` | Template literal URL | `` `/${params.locale || 'en'}/items/${item.id}` `` | `<a href={`/${params.locale || 'en'}/items/${item.id}`}>` |
| `src` | External CDN image | `` `https://cms.domain.com/assets/${item.image}` `` | `<img src={`https://cms.domain.com/assets/${item.image}`} />` |
| `src` | Image fallback | `item.avatar || '/placeholder-avatar.png'` | `<img src={item.avatar || '/placeholder-avatar.png'} />` |

### C. Automatic `useParams` Injection
When your expression references `params.<paramName>` (e.g. `params.category`), the Revyme generator automatically:
1. Injects `import { useParams } from 'next/navigation';` at the top of the file.
2. Injects `const params = useParams();` inside the component body.
3. Binds `{params.category}` cleanly into the element!

### D. Critical Builder Fidelity & Oracle Rules

> [!IMPORTANT]
> **Rule 1: NEVER wrap expression formulas in `{}`.**
> Pass the raw JavaScript expression (e.g. `item.title + " - " + item.author`), NOT `"{item.title ...}"`. The tool automatically adds JSX braces `{}`.

> [!CAUTION]
> **Rule 2: NEVER write bare numbers or calculations directly as JSX text children.**
> In React / Next.js AST, `<p>{42}</p>` or `<p>{items.length}</p>` causes Oracle gate failure `RESOLVE_TEXT_EMPTY` because the editor's text tool treats non-string children as uneditable.
> **Correct**: `` `${items.length} items` `` or `String(items.length)` or `items.length + " items"`.

> [!TIP]
> **Rule 3: Optional Chaining & Nested Fields.**
> Use optional chaining for safe access: `item.author?.name || 'Anonymous'`. Revyme's parser recognizes optional chaining (`OptionalMemberExpression`) and maps it to the schema field cleanly.

> [!NOTE]
> **Rule 4: Module Scope Safety (Canvas Nodes).**
> If an element is located outside the component body (e.g. inside `const canvasNodes = ...`), live identifiers like `item` or `params` would crash module compilation. Revyme automatically uses dormant attributes (`data-dormant-text`, `data-dormant-href`, `data-dormant-src`) to ensure compilation stays rock-solid!
