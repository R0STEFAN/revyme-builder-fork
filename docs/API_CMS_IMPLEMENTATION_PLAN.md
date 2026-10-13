# Technical Implementation Plan: External API / Headless CMS Integration

> **Document:** Subagent Implementation Plan  
> **Target Project:** `revyme-builder-fork`  
> **Status:** Ready for Execution  
> **Language:** English (Agent-Optimized)  

---

## 1. System Overview & Invariants

### 1.1 Objective
Enable dual-mode CMS support in Revyme:
* **Mode A (Local JSON):** The existing zero-db flat-file system (`cms/*.json`).
* **Mode B (External API):** Remote Headless CMS integration (Directus, Baserow, Strapi, REST). Data is fetched at the Next.js server layer (`page.tsx`) during SSR or baked via Hybrid SSG (`generateStaticParams`). Local CMS record editing is bypassed, full datasets are loaded into the visual canvas for testing pagination/filtering, and queries are parameterized using `CollectionListTool` and `ExpressionEditorPopup` (`[fx]`).

### 1.2 Five Golden Rules for Implementing Agents
1. **Never mutate canvas DOM directly:** All visual updates must flow through ProjectFS `.tsx` mutations or `cmsCollections` sandbox bridge sync.
2. **Never break existing Local CMS workflows:** When `mode === 'local'`, all existing tests, AST generators, and tools must behave identically.
3. **Keep tokens on the server:** Secrets (`Authorization: Bearer ...`, `Token ...`) must never be written to `'use client'` components. Write to `.env.local` and reference via `process.env`.
4. **Preserve full datasets on the canvas:** Do not truncate canvas preview data to 5–10 items. Fetch the entire collection so `Renderer.ts` can compute `matchingCount`, test pagination (`<LoadMore>` / infinite scroll), and verify live filters.
5. **Enforce TypeScript and Vitest:** Every change must pass `npx vitest run` and `npx tsc --noEmit`.

---

## 2. Architecture Map & Touchpoints

```
[UI Chrome: Left Toolbar]
  ├── CmsPanel.tsx (API Mode switch & collection list)
  └── ApiResourceModal.tsx (Endpoint setup, auth headers, schema discovery)

[UI Chrome: Properties Panel]
  ├── CollectionListTool.tsx (Query parameters table)
  ├── ExpressionEditorPopup.tsx (Opened via [fx] for dynamic route params)
  └── ExpressionBoundPill.tsx (Visual badge for [fx] params.category)

[Core Engine & Stores]
  ├── src/code/project/cms-api-config.ts (Config schema & storage in _meta/)
  ├── src/code/stores/cms-store.ts (Jotai atoms for API collections)
  └── src/code/parsing/parser.ts (Parses data-query-config on collection containers)

[Canvas Sandbox Bridge]
  ├── src/canvas/hooks/useRendererSync.ts (Transfers full items to sandbox)
  ├── src/canvas-sandbox/stubs/cms-ops.ts (Receives full datasets)
  └── src/canvas/Renderer.ts (Calculates matchingCount & ghost elements)

[Code Generation & Export]
  ├── src/code/generation/cms-gen.ts (Emits URLSearchParams and server fetch)
  ├── src/code/project/cms-page-ops.ts (Emits page.tsx and page.client.tsx)
  ├── src/code/project/cms-seo.ts (Emits server-side generateMetadata & generateStaticParams)
  └── src/code/project/source-export.ts (Exports .env.example & scaffold)
```

---

## 3. Subagent Phase Breakdown

---

### Phase 1: Storage Layer & Configuration Schema
**Primary Goal:** Define the data structures for API collections, persistence in `_meta/`, and Jotai store integrations.

#### Tasks:
* [ ] **1.1. Create `src/code/project/cms-api-config.ts`:**
  * Define TypeScript interfaces:
    ```typescript
    export interface ApiCollectionConfig {
      slug: string;
      name: string;
      provider: 'directus' | 'baserow' | 'strapi' | 'custom_rest';
      url: string;
      method: 'GET' | 'POST';
      headers: Record<string, string>; // e.g. { Authorization: "Bearer env:DIRECTUS_TOKEN" }
      defaultParams?: Record<string, string>; // e.g. { fields: "*.*", user_field_names: "true" }
      cacheMaxAge?: number; // in seconds, default: 14400 (4 hours)
      itemsKey?: string; // e.g. "data" for Directus/Strapi, "results" for Baserow
    }

    export interface CmsProjectConfig {
      mode: 'local' | 'api';
      apiCollections: Record<string, ApiCollectionConfig>;
    }
    ```
  * Implement pure ProjectFS helper functions:
    * `loadCmsProjectConfig(): CmsProjectConfig` (reads `_meta/cms-api-config.json`).
    * `saveCmsProjectConfig(cfg: CmsProjectConfig): void` (writes `_meta/cms-api-config.json`).
    * `getApiCollection(slug: string): ApiCollectionConfig | null`.
    * `saveApiCollection(slug: string, config: ApiCollectionConfig): void`.
    * `removeApiCollection(slug: string): void`.
* [ ] **1.2. Update `src/code/stores/cms-store.ts`:**
  * Add `cmsModeAtom = atom<'local' | 'api'>((get) => ...)` derived from `projectVersionAtom`.
  * Add `apiCollectionsConfigAtom = atom<Map<string, ApiCollectionConfig>>((get) => ...)`.
  * Ensure `collectionSchemasAtom` and `collectionDataAtom` seamlessly include API collections when `cmsMode === 'api'`.
* [ ] **1.3. Proxy endpoint integration:**
  * Verify `server/api-plugin.ts` or local server has a working POST `/api/proxy` endpoint that forwards incoming requests with headers and handles CORS for browser test requests.

#### Verification & Tests:
* Unit test: `src/code/project/cms-api-config.test.ts` (CRUD operations on ProjectFS).

---

### Phase 2: Visual CMS Panel & Connection Modal (UI)
**Primary Goal:** Allow users to connect an external API endpoint, test requests via proxy, discover schema fields, store secret tokens in `.env.local`, and fetch full data for the canvas.

#### Tasks:
* [ ] **2.1. Create `src/editor/left-toolbar/panels/cms/ApiResourceModal.tsx`:**
  * Two-column dialog adhering to the project's design system (`Modal`, `ToolInput`, `ToolSelect`, `Button`):
    * **Left Pane (Request Configuration):**
      * Inputs for `Name` (slugified identifier), `Provider` select (Directus, Baserow, Strapi, Custom REST), `Method` (GET/POST), `URL`.
      * Smart URL parser: If a full URL with query parameters is pasted, automatically split into base URL and default search parameters.
      * **Headers Table:** Key-value editor with presets (`Bearer Token`, `Baserow Token`, `Basic Auth`).
      * Token storage: When a raw token is entered, prompt/automatically store it as an environment variable in `.env.local` (e.g. `DIRECTUS_TOKEN=...`), and store the header value as `Bearer env:DIRECTUS_TOKEN`.
      * `Cache Max Age (s)`: Number input (default: 14400).
    * **Right Pane (Preview & Diagnostics):**
      * Button **"Load Data / Test Connection"**.
      * Triggers `/api/proxy` request.
      * On response:
        * Displays formatted JSON response.
        * **Schema Inference:** Scans the returned items array, infers field types (`text`, `number`, `image`, `date`, `boolean`), and writes `cms/{slug}.schema.json`.
        * **Full Canvas Data Storage:** Writes the full fetched dataset into `cms/{slug}.json` so the visual canvas and `Renderer.ts` have complete real data for testing pagination (`matchingCount`), sorting, and filters.
      * Button **"Save API Collection"**: commits config to `_meta/cms-api-config.json`.
* [ ] **2.2. Update `src/editor/left-toolbar/panels/CmsPanel.tsx`:**
  * Add top toggle/selector: `CMS Mode: Local (JSON) | External API`.
  * In API mode:
    * Hide the internal record spreadsheet and item CRUD buttons.
    * Display informational banner: *"Content is managed in external CMS. Editing disabled."*
    * List registered API collections with **"Edit API Config"**, **"Refresh Data & Schema"**, and **"Delete Collection"**.
    * Add **"+ Add API Resource"** button that opens `ApiResourceModal`.

#### Verification & Tests:
* Component test: `ApiResourceModal.test.tsx` (mocking `/api/proxy` and validating schema inference).

---

### Phase 3: `CollectionListTool` Query Parameters & `ExpressionEditorPopup` Integration
**Primary Goal:** Replace local client-side `.filter()` with server-side query parameter construction in `CollectionListTool`, utilizing the existing `ExpressionEditorPopup` for `[fx]` bindings.

#### Tasks:
* [ ] **3.1. Extend AST Parser (`src/code/parsing/parser.ts`):**
  * In `CanvasNode.collectionList`, add:
    ```typescript
    queryConfig?: {
      isApiMode: boolean;
      params: Array<{ key: string; value: string; isExpression?: boolean }>;
    } | null;
    ```
  * In `parser.ts` around line 2780, check if the parent container JSX element carries a `data-query-config` attribute:
    ```typescript
    const queryAttr = getAttr(parentOpening.attributes, 'data-query-config');
    // Parse JSON array of query parameters if present
    ```
* [ ] **3.2. Update `CollectionListTool.tsx`:**
  * Detect if `source` collection is an API collection (`apiCollectionsConfigAtom.get(source) != null`).
  * If API collection:
    * Keep `Source` collection dropdown at the top.
    * Hide hardcoded `FilterControl`, `SortControl`, `Limit`, `Offset`, `PaginationControl`.
    * Render `QueryParametersControl`:
      * Dynamic table with rows: `[ Key Input ]` = `[ Value Input or ExpressionBoundPill ]` + `[ Delete Icon ]`.
      * Button `+ Add Query Parameter`.
      * Beside each Value input, render the standard `fx` button (identical to `LinkUrlControl.tsx` line 376).
      * Clicking `fx` opens `ExpressionEditorPopup.tsx`:
        * Pass `routeParams` detected from active page path (`params.category`, `params.place`, `params.slug`).
        * On apply: set `value` and mark `isExpression: true`.
        * In the tool row, render the purple `ExpressionBoundPill` displaying formula preview.
* [ ] **3.3. Update Codegen Mutation (`src/code/generation/cms-gen.ts`):**
  * Create mutation generator `updateCollectionQueryConfig(code, parentId, queryConfig)`.
  * Injects/updates `data-query-config={JSON.stringify(queryConfig)}` on the collection list container.

#### Verification & Tests:
* Unit test: `CollectionListTool.query-params.test.tsx`.
* Parser round-trip test: `parser.query-config.test.ts` (ensuring `data-query-config` survives round-trip).

---

### Phase 4: Canvas Sandbox Bridge & Real Live Preview
**Primary Goal:** Ensure the visual canvas iframe accurately renders full API data and dynamically updates when `previewRouteParams` are changed in the top toolbar.

#### Tasks:
* [ ] **4.1. Update `src/canvas/hooks/useRendererSync.ts`:**
  * When pushing `cmsCollections: { schemas, data }` to the sandbox iframe, ensure the full data from `cms/{slug}.json` is sent.
  * When an element has `collectionList.queryConfig` with dynamic expressions (`isExpression: true` referencing `params.*`):
    * Read current `activeRouteParams` from `activeRouteParamsAtom`.
    * Evaluate expressions against active route params (e.g. `params.category` -> `'japan'`).
    * If query params differ from base preview, trigger background fetch via `/api/proxy` to retrieve the filtered subset and update `cmsData` in memory for the canvas.
* [ ] **4.2. Verify `Renderer.ts`:**
  * Verify lines 2058–2105:
    * `matchingCount` correctly reflects the total items.
    * `<LoadMore>` button correctly toggles `data-pagination-hidden` based on real `matchingCount > (offset + perPage)`.

#### Verification & Tests:
* Integration test: `useRendererSync.test.ts` verifying sandbox payload transmission.

---

### Phase 5: Next.js Codegen & Server-Side Rendering (SSR / Hybrid SSG)
**Primary Goal:** In Next.js App Router, emit server-side data fetching in `page.tsx` (Server Component) with query parameters, dynamic metadata, and static params.

#### Tasks:
* [ ] **5.1. Update `cms-page-ops.ts` (Detail & Index Page Generators):**
  * For API collections, generate `app/[slug]/page.tsx` as an `async` Server Component:
    ```tsx
    import PageClient from './page.client';
    import { notFound } from 'next/navigation';

    export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
      const { slug } = await params;
      const res = await fetch(`${API_URL}?filter[slug][_eq]=${encodeURIComponent(slug)}&limit=1`, {
        headers: { Authorization: `Bearer ${process.env.DIRECTUS_TOKEN}` },
        next: { revalidate: 14400 },
      });
      if (!res.ok) return {};
      const json = await res.json();
      const item = json.data?.[0];
      if (!item) return {};
      return {
        title: item.seoTitle || item.name || item.title,
        description: item.seoDescription || item.description,
      };
    }

    export async function generateStaticParams() {
      const res = await fetch(`${API_URL}?fields=slug&limit=500`, {
        headers: { Authorization: `Bearer ${process.env.DIRECTUS_TOKEN}` },
      });
      const json = await res.json();
      return (json.data || []).filter((i: any) => i.slug).map((i: any) => ({ slug: String(i.slug) }));
    }

    export const dynamicParams = true;

    export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
      const { slug } = await params;
      const res = await fetch(`${API_URL}?filter[slug][_eq]=${encodeURIComponent(slug)}&limit=1`, {
        headers: { Authorization: `Bearer ${process.env.DIRECTUS_TOKEN}` },
        next: { revalidate: 14400 },
      });
      if (!res.ok) notFound();
      const json = await res.json();
      const item = json.data?.[0];
      if (!item) notFound();

      return <PageClient item={item} />;
    }
    ```
* [ ] **5.2. Update Repeater Pages (`app/.../page.tsx`):**
  * When a page contains a collection list with `queryConfig`:
    * Collect all configured parameters (static values and dynamic route params).
    * Emit `const query = new URLSearchParams(...)` in `page.tsx`.
    * Fetch from API endpoint on the server and pass `items` prop to `PageClient`.
* [ ] **5.3. Update `page.client.tsx`:**
  * For API collections:
    ```tsx
    export default function Page({ items: serverItems, item: serverItem }: PageProps) {
      const items = serverItems ?? previewItems;
      const item = serverItem ?? previewItems[0];
      ...
    }
    ```
* [ ] **5.4. Update `src/code/project/source-export.ts`:**
  * When exporting or building:
    * If `mode === 'api'`, emit `.env.example` documenting all required environment variables (`DIRECTUS_TOKEN`, etc.).
    * Ensure `_meta/` directory is excluded from output.

#### Verification & Tests:
* Codegen test: `cms-page-ops.api.test.ts`.
* Server wrapper test: `cms-seo.api.test.ts`.

---

### Phase 6: Oracle Rules, Gatekeeper & Integration Audit
**Primary Goal:** Verify code passes all AI/MCP Oracle rules and run the test suite.

#### Tasks:
* [ ] **6.1. Audit `src/code/oracle/gate.ts`:**
  * Ensure `CMS_IMPORT_MISSING` checks pass because `cms/{slug}.schema.json` and `cms/{slug}.json` are preserved.
* [ ] **6.2. Audit `src/code/oracle/check-file.ts`:**
  * Verify `IMPORT_ALLOWLIST` accepts all emitted imports.
* [ ] **6.3. Full Test Suite Execution:**
  * Run `npx vitest run`.
  * Run `npx tsc --noEmit`.

---

## 4. Definition of Done (DoD)

1. **Dual-Mode Operational:** User can toggle between Local and API mode without data corruption.
2. **Endpoint Configuration:** User can connect Directus / Baserow via modal, test connection, inspect schema, and save full collection data to `cms/{slug}.json`.
3. **Flexible Query Tool:** `CollectionListTool` displays custom query parameter rows with working `[fx]` buttons that trigger `ExpressionEditorPopup`.
4. **Canvas Realism:** The visual canvas renders the full dataset, accurately calculating `matchingCount` and showing/hiding `<LoadMore>` pagination.
5. **Next.js Production Ready:** Exported project builds with `next build`, performs server-side fetching with secret tokens in `page.tsx`, and supports Coolify webhook redeployments (Hybrid SSG).
