# Implementation Plan: Media Gallery Folder Management & Automated Video-to-Image-Sequence

## Overview
This document specifies the technical architecture and implementation roadmap for:
1. **Stage 1: Real Disk-Backed Folder Management in Media Gallery** — Full folder lifecycle (create, rename, delete, move, drag-and-drop, context menus) matching real directory paths on disk (`/api/uploads/subfolder/...`).
2. **Stage 2: Automated Video-to-Image-Sequence Pipeline** — Direct client-side frame extraction from existing gallery videos into dedicated sequence folders, automatically bound to Revyme's native `<ImageSequence />` component.

---

## Stage 1: Media Gallery Folder Management (Real Disk Structure)

### 1.1 Backend Storage & Routing Layer
Currently, `server/storage.ts` flattens all files to `data/uploads/` via `path.basename()`. We need multi-depth safe directory support.

#### Files to Touch:
- `server/storage.ts`
- `server/api-plugin.ts`
- `src/backend/local-backend.ts`
- `src/backend/revyme-backend.ts`

#### Key Specifications:
1. **Path Safety & Normalization**:
   - Create helper `resolveUploadPath(subPath: string, customRoot?: string): { fullPath: string; relPath: string }`.
   - Protect strictly against path traversal (`..`, null bytes, illegal characters). All resolved paths must remain strictly under `getDataDirs().uploadsDir`.
2. **API Endpoints**:
   - `GET /api/upload`:
     - Accept optional query param `?folder=<relative_folder_path>` (defaults to root `/`).
     - Return `{ uploads: UploadRecord[], folders: FolderRecord[], currentFolder: string }`.
     - `UploadRecord.url`: `/api/uploads/<folder_path>/<filename>` (e.g. `/api/uploads/hero-assets/banner.webp`).
     - `UploadRecord.key`: relative path identifier (e.g. `hero-assets/banner.webp`).
     - `FolderRecord`: `{ name: string, path: string, itemCount: number, createdAt: string }`.
   - `POST /api/upload/folder`:
     - Payload: `{ folderPath: string }`.
     - Creates directory recursively on disk under `data/uploads/`.
   - `PATCH /api/upload/rename`:
     - Payload: `{ type: 'file' | 'folder', oldPath: string, newPath: string }`.
     - Performs atomic `fs.renameSync` and updates thumbnail references / metadata entries.
   - `POST /api/upload/move`:
     - Payload: `{ items: string[], targetFolder: string }`.
     - Moves files/folders safely to `targetFolder`.
   - `DELETE /api/upload`:
     - Enhanced to detect directory deletion: recursively removes `data/uploads/<path>` along with cached thumbnails in `data/thumbnails/<path>`.
3. **Static File Serving (`/api/uploads/*`)**:
   - Update wildcard handler in `server/api-plugin.ts` to support nested paths:
     - Route: `GET /api/uploads/*` and `GET /api/uploads/thumb/*`.
     - Resolves nested paths cleanly with appropriate MIME types and caching headers.

---

### 1.2 Frontend: Media Gallery UI & Interactions
Enhance `MediaGalleryPanel.tsx` and related utilities.

#### Files to Touch:
- `src/editor/left-toolbar/panels/MediaGalleryPanel.tsx`
- `src/editor/left-toolbar/panels/media-gallery-utils.ts`
- `src/editor/controls/UploadControl.tsx`
- `src/editor/ui/ImageSearchModal.tsx`

#### UI Components & Behaviors:
1. **Top Bar & Navigation**:
   - **Breadcrumbs Bar**: `Root / subfolder / sub-subfolder` with direct click navigation.
   - **Up Action**: "⬅ Up" button to jump to parent directory.
   - **New Folder Button**: "+ Folder" button with inline name prompt or modal.
2. **Grid Layout**:
   - Render folders before files at the top of the grid.
   - Folder tile visuals: Folder glyph, folder name, item count badge.
   - Double-click on folder opens and navigates into that folder.
3. **Drag and Drop & Multi-select Toolbar Actions**:
   - Leverage existing multi-select (`Shift+Click` and marquee sweep from `media-gallery-utils.ts`).
   - Drag selected tiles over a folder tile: folder highlights with outline (drop target).
   - Drop commits `POST /api/upload/move`.
   - Drag items onto the Breadcrumb bar / "Up" target to move items out of a folder.
   - **Multi-select Action Bar**: When 1 or more items are selected, beside the existing "Delete (N)" button, render quick-action folder buttons:
     - 📁 **"New Folder from Selection"** (icon + modal/prompt): Creates a new folder on disk and moves all selected files into it immediately.
     - 📂 **"Move to Folder..."** (dropdown / popover): Quick dropdown listing all existing folders; choosing one triggers `POST /api/upload/move`.
     - ⬆️ **"Move to Parent / Level Up"** (icon button, visible when inside a subfolder): Moves selected files one level up in the hierarchy (`..`).
     - 🗑️ **"Delete (N)"** (existing red button): Bulk deletes selected items with confirmation modal.
4. **Context Menu**:
   - **Folder context menu**:
     - *Open*
     - *Rename*
     - *Delete Folder* (with confirmation dialog stating total items to be removed).
   - **File context menu**:
     - *Move to folder...* (quick picker)
     - *Download*
     - *Delete*

---

## Stage 2: Automated Video-to-Image-Sequence Pipeline

### 2.1 Component & Property Inspector Integration
Decouple raw video uploads from sequence extraction. Users upload regular videos to the gallery, and generate sequences on-demand when configuring an `<ImageSequence />` component.

#### Files to Touch:
- `src/editor/controls/UploadControl.tsx`
- `src/code/project/default-code-components/ImageSequence.ts`
- `src/editor/tools/ComponentPropsTool/CodeComponentControlField.tsx`
- `src/editor/tools/video-sequence-extractor.ts` *(new module)*

#### Interaction Flow:
1. **Property Inspector for ImageSequence**:
   - The `Frames` control displays a primary action: **"Select from Media Gallery"** (or drag a video directly).
2. **Sequence Modal / Picker**:
   - Opens media picker filtered to videos or existing sequence folders.
   - When a video is selected, presents the **"Generate Sequence"** conversion dialog:
     - Video preview & duration.
     - **Preset Selector**:
       - *Balanced* (~60 frames total, optimal for scroll performance & bandwidth).
       - *Smooth* (~120 frames total, for hero full-page scroll sections).
       - *Custom FPS / Frame Count*.
     - **Target Folder Name**: pre-filled with sanitized video name (e.g. `sequences/cyber-hero/`).
     - Button: **"Extract & Bind Sequence"**.

---

### 2.2 Client-Side Video Frame Extractor (`video-sequence-extractor.ts`)
Zero backend dependency, hardware-accelerated client-side extraction.

#### Technical Details:
1. Load selected video into an offscreen `HTMLVideoElement`.
2. Step through time intervals (`video.currentTime = index / fps`).
3. Render frames onto an `OffscreenCanvas` / 2D Canvas resized to optimal dimensions (max width 1280px / 1920px depending on preset).
4. Export frames as WebP blobs (`image/webp` quality `0.85`).
5. Progress indicator in UI: `Extracting frames: 34 / 60...`.

---

### 2.3 Storage & Clean JSX Binding
1. Send generated frames to the server targeting the created folder:
   - Folder: `/api/uploads/sequences/<video-name>/`
   - Files: `frame-001.webp`, `frame-002.webp`, ..., `frame-NNN.webp`
2. Update the JSX component properties cleanly:
   ```tsx
   <ImageSequence
     folder="/api/uploads/sequences/cyber-hero"
     totalFrames={60}
     fit="contain"
     scrollDriven={true}
   />
   ```
3. The component's existing logic in `ImageSequence.ts` natively resolves URLs matching:
   `${folder}/frame-${String(i + 1).padStart(3, '0')}.webp`.
4. Independent asset lifecycle:
   - The original MP4 can now be kept or deleted without affecting the generated sequence.
   - Deleting the sequence folder in Media Gallery cleanly removes all sequence frames in one click.

---

## Verification & Test Plan

1. **Unit & Integration Tests**:
   - `server/storage.test.ts`: test `resolveUploadPath`, nested folder creation, moving files across folders, recursive folder deletion.
   - `server/api-plugin.test.ts`: test API endpoints (`POST /api/upload/folder`, `POST /api/upload/move`, `GET /api/upload?folder=...`, `GET /api/uploads/sub/path/file.png`).
   - `src/editor/left-toolbar/panels/MediaGalleryPanel.test.tsx`: test breadcrumb navigation, folder rendering, drag-to-folder actions.
   - `src/code/project/default-code-components/lifecycle.test.tsx`: verify `<ImageSequence />` loads cleanly with folder paths.
2. **Quality Checks**:
   - `npx tsc --noEmit`
   - `npx vitest run`
   - Verify 60 FPS smooth scroll in canvas preview.
