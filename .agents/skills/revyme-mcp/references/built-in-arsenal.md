# Revyme Built-In Arsenal & Component Catalog

Revyme ships with **over 80 production-ready, highly optimized components** across 9 major creative categories.
Agents MUST browse and install from this arsenal via `revyme_list_built_in_components` and `revyme_add_built_in_component` instead of reinventing them from scratch or writing static unstyled divs!

---

## 1. Animated Tickers, Marquees & Carousels

| Component Tag | Type | Description | Key Props |
|---|---|---|---|
| `Marquee` | Slot Container | Seamless continuous looping ticker track for logos, reviews, or project cards. | `speed` (default 60), `direction` ('left' \| 'right' \| 'up' \| 'down'), `gap` (32), `pauseOnHover` (true), `fadeEdges` (true), `fadeSize` (64) |
| `RibbonMarquee` | Creative | 3D skewed, perspective ribbon ticker spanning diagonally. | `speed`, `angle`, `gap` |
| `Marquee3D` | Creative | Isometric 3D depth-scrolling showcase grid. | `speed`, `perspective`, `columns` |
| `Carousel` | Slot Container | Responsive multi-item touch & drag slider with pagination. | `autoPlay`, `interval`, `showArrows`, `showDots` |
| `EmblaCarousel` | Slot Container | High-performance physics-driven gesture carousel with friction and snap. | `loop`, `dragFree`, `align` ('start' \| 'center') |
| `HorizontalScroll` | Sticky Container | Transforms vertical window scroll into buttery-smooth horizontal section tracking. | `speedMultiplier`, `padding` |

### How to use `Marquee` in MCP:
```json
{
  "tool": "revyme_add_built_in_component",
  "arguments": {
    "tag": "Marquee",
    "parent_id": "clients-section",
    "props": {
      "speed": 70,
      "direction": "left",
      "gap": 48,
      "pauseOnHover": true,
      "fadeEdges": true
    }
  }
}
```

---

## 2. Interactive Cursor Hotspots (pointer-events: none)

These components define specialized interactive mouse tracking regions. The element bounding box IS the cursor zone.

| Component Tag | Effect | Description |
|---|---|---|
| `BlobCursor` | Organic Fluid | Magnetic, smooth-lerp fluid droplet following cursor with gooey spring physics. |
| `DesignCursor` | Precision Tool | Figma/Pen-tool style crosshair cursor with real-time X/Y pixel coordinates badge. |
| `RibbonCursor` | Trailing Ribbon | Elegant silk-like trailing ribbon following mouse velocity. |
| `SplashCursor` | WebGL Fluid Sim | Real-time interactive GPU fluid simulation: emits colorful swirling smoke splashes on pointer move. |

---

## 3. Kinetic Typography & Text Effects

| Component Tag | Visual Pattern | Best For |
|---|---|---|
| `AnimatedCounter` | Numbers scroll into place on view | Stats, metrics, funding numbers, KPIs. |
| `MorphingText` | Smooth blur/dissolve text morphing | Hero headlines with multiple value propositions. |
| `WordRotate` | 3D vertical flipping word cycle | Rotating verbs or adjectives in headlines. |
| `SpinningText` | Continuous 360° circular badge text | Floating stamps, awards, "Scroll to Explore" badges. |
| `TextPressure` | Variable font weight/width reacts to cursor | High-impact interactive editorial titles. |
| `MagneticText` | Glyphs attract magnetically towards cursor | Premium interactive titles and links. |
| `TypingEffect` / `TypingText` | Terminal / typewriter character entrance | Code blocks, AI prompts, typewriter headers. |
| `GlitchText` | RGB chromatic aberration split | Cyberpunk, gaming, glitch transitions. |
| `GradientText` | Moving metallic or iridescent gradient mask | High-end SaaS typography and gold/chrome badges. |
| `VideoText` | Video playing masked inside bold typography | Video backgrounds clipped to brand names. |

---

## 4. Shaders & Dynamic Backgrounds (WebGL2 & Canvas 2D)

All shaders support zero-runtime fallbacks and responsive scaling.

| Component Tag | Shader Engine | Aesthetic & Mood |
|---|---|---|
| `AuroraBackground` | WebGL2 / GLSL | Ethereal northern lights, soft flowing gradients. Perfect for SaaS and AI headers. |
| `MeshGradient` | WebGL2 / Paper | Multi-point interactive bezier color mesh with subtle organic drift. |
| `LiquidMetal` | WebGL2 / Paper | Molten reflective mercury/chrome ripples reacting to time and cursor. |
| `LiquidChrome` | WebGL2 / Paper | High-contrast monochrome mirrored fluid for brutalist/fashion sites. |
| `CausticsLight` | WebGL2 / Paper | Prismatic underwater sunlight refraction and caustic rays. |
| `GrainGradient` | WebGL2 / Paper | Fine film-grain noise blended with vibrant blurred color gradients. |
| `GemSmoke` | WebGL2 / Paper | Volumetric jewel-toned fluid smoke clouds. |
| `Metaballs` | WebGL2 / Paper | Floating organic gooey spheres that fuse and separate dynamically. |
| `SmokeRing` | WebGL2 / Paper | Hypnotic radial smoke rings expanding from the center. |
| `NeonParticleField` | Canvas 2D | Floating glowing micro-particles, sparks and ambient fireflies. |
| `CyberGrid` | Canvas 2D | Retrowave 80s perspective grid with infinite forward motion. |
| `MatrixRain` | Canvas 2D | Japanese/ASCII digital rain cascading vertically. |
| `PlasmaShader` | Canvas 2D | Classic demoscene colorful cycling sine-wave plasma. |
| `WaveLines` | Canvas 2D | Topographical glowing vector isolines swaying like wind on water. |
| `WaveGradient` | Canvas 2D | Multi-wave sinusoidal gradient ribbons. |
| `ContourMap` | Canvas 2D | Architectural/topographic contour elevation map lines. |
| `Fireflies` | Canvas 2D | Warm glowing bio-luminescent particles drifting in deep dark fields. |
| `Bokeh` | Canvas 2D | Out-of-focus photography lens blurs and aperture circles. |
| `RainGlass` | WebGL2 | Condensation water droplets sliding down frosted window glass. |

---

## 5. Noise, Grain & Textures (Overlays)

| Component Tag | Description |
|---|---|
| `FilmGrain` | 35mm photographic film grain simulation (SVG/Canvas hybrid) for analog warmth. |
| `StaticTV` | Analog CRT television white noise static. |
| `PerlinNoise` | Procedural organic grain and topography noise. |
| `Scanlines` | Retro cathode-ray tube horizontal scanline raster. |
| `HalftoneScreen` | Pop-art / newspaper CMYK printing dot matrix raster. |
| `Pattern` | Declarative CSS geometric patterns: grid, dots, crosshatch, diagonal lines. |

---

## 6. Containers & Slot Lenses

| Component Tag | Description |
|---|---|
| `LensBox` | Optical glass refraction / magnifying lens that warps underlying canvas elements. |
| `MagnetBox` | 3D perspective card container that tilts and tracks cursor momentum with realistic spring dampening. |

---

## 7. 3D & Spatial Media

| Component Tag | Description | Props |
|---|---|---|
| `ModelViewer` | High-fidelity WebGL 3D GLTF / GLB renderer with orbit controls and shadows. | `src`, `autoRotate`, `cameraControls`, `shadowIntensity` |
| `SplineScene` | Interactive 3D scene authored in Spline with real-time mouse events. | `sceneUrl` |

---

## 8. Third-Party Embeds & Services

Ready-made responsive wrappers with fallback skeleton loaders:
- **Video & Media**: `YouTubeEmbed`, `VimeoEmbed`, `SpotifyEmbed`, `SoundCloudEmbed`.
- **Forms & Schedulers**: `CalendlyEmbed`, `TypeformEmbed`, `GoogleFormEmbed`.
- **Social**: `TwitterEmbed`, `InstagramEmbed`, `LinkedInEmbed`, `FacebookEmbed`, `PinterestEmbed`, `TikTokEmbed`.
- **Maps**: `GoogleMapsEmbed`.

---

## 9. Interactive UI & Components

- `Accordion`: Smooth animated collapsible FAQ accordion rows with Framer Motion layout animations.
- `CopyButton`: One-click copy-to-clipboard button with animated checkmark state.
- `ThemeToggle`: Animated dark/light theme switch toggle.
- `LocaleSwitcher`: Multi-language dropdown menu for internationalized websites.
