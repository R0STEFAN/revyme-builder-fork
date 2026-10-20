# Architectural Execution Plan: Editorial Studio Website

## 1. Overview & Aesthetic Direction
- **Brief Interpretation**: Ultra-refined, typography-first creative studio portfolio ("sd" - Studio Display / Studio Design). High-contrast editorial style inspired by Swiss modernist graphic design, Awwwards site of the year contenders, and typographic monographs.
- **Design Dials**:
  - `DESIGN_VARIANCE`: 8 (Asymmetrical editorial rhythm, varied card radii, non-standard layout breaks)
  - `MOTION_INTENSITY`: 7 (Kinetic letter reveal, infinite marquee, smooth grayscale-to-color hover, lerping difference cursor)
  - `VISUAL_DENSITY`: 3 (Airy, expansive whitespace, 80vh hero display, massive headline scale)
- **Palette**:
  - Background Primary: `#FFFFFF`
  - Text Primary: `#000000`
  - Text Secondary / Metadata: `#525252`
  - Accent / Borders: `rgba(0, 0, 0, 0.10)` (1px hairline)
  - Footer Background: `#0A0A0A`
  - Footer Text Primary: `#FFFFFF`
  - Footer Text Muted: `#737373`
  - Footer Hairline: `rgba(255, 255, 255, 0.10)`
- **Typography**:
  - Headlines: Inter Display, `fontWeight: 700`, `letterSpacing: -0.05em`, `lineHeight: 0.9`
  - Sub-headlines & Statement: Inter, `fontWeight: 400`, `letterSpacing: -0.02em`, `lineHeight: 1.4`
  - Metadata / Labels: Monospace (`ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`), `fontSize: 14px`, `textTransform: uppercase`, `letterSpacing: 0.1em`

---

## 2. Component Breakdown & Strategy

### A. Difference Cursor Component
- **Requirement**: 32px diameter circle, fixed position, `pointer-events: none`, `z-index: 9999`, `mix-blend-mode: difference`, `backgroundColor: #FFFFFF`. Interpolated movement (lerp) on mouse move, expands 2.5x (`scale(2.5)`) when hovering over interactive elements (`a`, `button`, project cards).
- **Implementation Mechanism**:
  - Revyme has built-in code components (`BlobCursor`, `DesignCursor`), but this specific cursor requires strict `mix-blend-mode: difference`, custom lerp smoothing, and global `cursor: none`.
  - Author a dedicated Code Component `components/DifferenceCursor.tsx` with `@controls` (or utilize Revyme built-in cursor component if matching).
  - Place on the page canvas via MCP.

### B. Fixed Navigation Header (`header-sec`)
- **Structure**:
  - Fixed at `top: 0, left: 0, width: 100%, zIndex: 100`
  - `mix-blend-mode: difference` so white text/elements invert seamlessly across white page sections and black images/cards.
  - Left: lowercase logo `"sd"`, `fontSize: 24px, fontWeight: 700, letterSpacing: -0.05em`, color `#FFFFFF`.
  - Center/Right: Subtle studio status pill ("AVAILABLE FOR Q1/Q2") in mono uppercase.
  - Right: Menu toggle button with clean `+` (plus) SVG/icon, hover scale effect.
  - Padding: `24px 32px` (desktop), `16px 20px` (mobile).

### C. Hero Section (`hero-sec`)
- **Structure**:
  - `minHeight: "85vh"`, `width: "100%"`, flex column, centered content.
  - Display headline: `fontSize: "clamp(3.5rem, 12vw, 11rem)"`, `fontWeight: 700`, `letterSpacing: "-0.05em"`, `lineHeight: 0.88`.
  - Text: `"STUDIO DISCIPLINE"`.
  - Sub-headline: `fontSize: "24px"`, `color: "#525252"`, `maxWidth: "680px"`, `marginTop: "32px"`, `lineHeight: 1.4`, `letterSpacing: "-0.02em"`.
  - Bottom metadata bar: Studio coordinates ("50.4501° N, 30.5234° E — KYIV / WORLDWIDE") in uppercase mono.

### D. Infinite Project Marquee (`marquee-sec`)
- **Structure**:
  - Full-width overflow-hidden section with 30s continuous horizontal scroll.
  - Revyme's built-in `Marquee` component (`tag: "Marquee"`, `props: { speed: 45, pauseOnHover: true, gap: 24 }`).
  - Items: Vertical Cards (`aspectRatio: "5/7"`, `width: "320px"`):
    - **Card 1 (Asymmetrical A)**: `borderTopLeftRadius: "100px"`, `overflow: "hidden"`
    - **Card 2 (Asymmetrical B)**: `borderTopRightRadius: "100px"`, `borderBottomLeftRadius: "40px"`, `overflow: "hidden"`
    - **Card 3 (Asymmetrical C)**: `borderRadius: "40px"`, `overflow: "hidden"`
    - **Card 4 (Asymmetrical D)**: `borderBottomRightRadius: "100px"`, `borderTopLeftRadius: "40px"`, `overflow: "hidden"`
  - Image behavior: Grayscale 100% by default, smooth 700ms transition to Grayscale 0% on card hover with 1.05x zoom.

### E. Editorial Statement Section (`statement-sec`)
- **Structure**:
  - Full-width centered section with generous padding (`140px 24px`).
  - Section label: `"01 / PHILOSOPHY"` in 14px mono.
  - Statement text: Large editorial typography (`fontSize: "clamp(2rem, 3.5vw, 3.5rem)"`, `lineHeight: 1.2`, `letterSpacing: "-0.03em"`):
    *"We eliminate visual noise until only structural truth remains. Form follows typography, motion articulates intent."*

### F. Project Grid Section (`projects-sec`)
- **Structure**:
  - Two-column CSS Grid on desktop (`gridTemplateColumns: "1fr 1fr"`, `gap: "48px 32px"`), single-column on mobile.
  - Section Header: `"02 / SELECTED WORK [2024—2026]"` in uppercase mono with project count.
  - Project Cards:
    - Container with 4:3 aspect ratio (`aspectRatio: "4/3"`), slight radius (`borderRadius: "6px"`), relative positioning, overflow hidden.
    - Image inside with default grayscale filter (`filter: "grayscale(100%)"`), transitioning to full color (`filter: "grayscale(0%)"`) and `transform: scale(1.05)` over 700ms `cubic-bezier(0.16, 1, 0.3, 1)`.
    - Hover overlay: `rgba(0,0,0,0.1)`.
    - Floating icon: Top-right arrow-up-right (`↗`), appearing with smooth opacity/transform on hover.
    - Bottom metadata row: Separated by `1px solid rgba(0,0,0,0.10)`. Left: Title (24px, 700). Right: Category + Year in 14px mono.

### G. High-Contrast Dark Footer (`footer-sec`)
- **Structure**:
  - `backgroundColor: "#0A0A0A"`, `color: "#FFFFFF"`, `paddingTop: "120px"`, `paddingBottom: "48px"`.
  - Four-column grid:
    - **Col 1-2**: Large brand mark `"sd"` or `"STUDIO DISCIPLINE"`, short studio bio, newsletter / inquiry prompt.
    - **Col 3**: Socials list (Twitter/X, ReadCV, Are.na, GitHub, Instagram).
    - **Col 4**: Contact details (Direct email, Office address, Timezone indicator).
  - Bottom bar: `borderTop: "1px solid rgba(255, 255, 255, 0.10)"`, `paddingTop: "32px"`, `marginTop: "80px"`, flex row with copyright & credits in 14px mono text.

---

## 3. MCP Tool Call Sequence
1. `revyme_manage_presets`: Seed required design tokens (`color-bg`, `color-text`, `color-muted`, `color-border-hairline`, `typo-studio-*`).
2. `revyme_agent_tool` (`set_styles` on `root`): Update page root to full height, flex column, clean background.
3. `revyme_submit_files`: Create `components/DifferenceCursor.tsx` Code Component with `@controls`.
4. `revyme_insert_fragment`: Insert Navigation Header (`header-sec`).
5. `revyme_insert_fragment`: Insert Hero Section (`hero-sec`).
6. `revyme_insert_fragment`: Insert Infinite Marquee Section (`marquee-sec`) with asymmetrical cards and built-in `Marquee`.
7. `revyme_insert_fragment`: Insert Philosophy Statement Section (`statement-sec`).
8. `revyme_insert_fragment`: Insert Project Grid Section (`projects-sec`).
9. `revyme_insert_fragment`: Insert Dark Footer Section (`footer-sec`).
10. `revyme_audit_design`: Run automated visual audit across Desktop, Tablet, and Mobile viewports.

---

## 4. MCP & Agent Developer Experience (DX) Observation Log
During each tool invocation, record:
- Response latency and payload clarity.
- Schema accuracy vs. runtime requirements.
- Error messages and self-healing requirements.
- Any friction points where MCP abstractions can be streamlined for autonomous coding agents.
