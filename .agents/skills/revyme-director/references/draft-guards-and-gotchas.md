# Draft Guards & Technical Gotchas Reference

This document compiles the complete set of anti-slop rules, visual tells, and engineering gotchas extracted from `ga14ctic/awwwards-skill` and `code-yeongyu/oh-my-opencode (frontend-ui-ux)`. 

All subagents and the Design Director must strictly enforce these standards.

---

## Part 1: The 12 AI-Slop Visual Tells (Draft Guard)

These are the immediate "tells" that make an AI-generated site look amateur, templated, and fake. They are **auto-rejected** at the first draft.

### 1. No Colored Stripes on One Side of a Box
- ❌ **Auto-reject**: `border-left: 4px solid <accent>`, `border-l-4 border-indigo-500`, a colored `::before`/`::after` bar, or an inset shadow stripe along one edge of a card or callout.
- ✅ **The Fix**: Give the card identity through a tonal surface (subtle opacity ramp like `oklch(0.18 0.01 260)`), a heading in the accent ink, or generous negative space. Borders must be neutral 1px hairlines (`var(--border-subtle)`).

### 2. No Thick Accent Outlines on Rounded Cards
- ❌ **Auto-reject**: `border: 2px solid var(--accent)` or `ring-2 ring-indigo-500` around a rounded card. It instantly reads as an AI template.
- ✅ **The Fix**: Encode state with surface tonal layering, a subtle check glyph, or 1px subtle borders.

### 3. No Decorative Badges Without Real State
- ❌ **Auto-reject**: Pill chips like "✨ AI-Powered", "Next-Gen", "Pro", or "New" stuck above static headings.
- ✅ **The Fix**: A badge or chip is only permitted if it represents dynamic system state (e.g. `Online`, `Draft`, count of items, active filter).

### 4. No Stat Tiles Without a Decision (Vanity Metrics)
- ❌ **Auto-reject**: Generic stat tiles ("99.9% Uptime", "10,000+ Happy Users", "24/7 Support") placed as visual filler.
- ✅ **The Fix**: A number only earns a tile if a user makes a concrete decision based on it. If there is no real data, remove the stat section entirely.

### 5. No Invented Social Proof
- ❌ **Auto-reject**: Fabricated customer testimonials, placeholder quotes from "John Doe, CTO", fake company logos, or fake star ratings.
- ✅ **The Fix**: Omit testimonials completely or provide an explicit slot for real client proof. Never invent fake people or reviews.

### 6. No Prop Decoration & Gimmicks
- ❌ **Auto-reject**: Tilted floating device mockups, random sparkle icons (`✨`), floating reassurance pills, or decorative coordinates (`LAT 45.23 / LON -12.4`).
- ✅ **The Fix**: Show real, readable interface previews. Every visual element must inform the user about the actual product.

### 7. No Repeated Formula
- ❌ **Auto-reject**: Applying the exact same treatment to every section (e.g. every heading having a serif line with an italic word, or every section having a subtitle).
- ✅ **The Fix**: A stylistic flourish (like an italic display word or gradient mask) is used **once** on the entire page (usually in the Hero). Everywhere else, keep typography clean and structured.

### 8. No Subtitle Under Every Heading
- ❌ **Auto-reject**: The default rhythm where every single `<h2>` has a 1-line `<p>` description under it.
- ✅ **The Fix**: A strong heading explains itself. Only add a subtitle where the heading alone would be genuinely ambiguous.

### 9. No Nested Cards (Card Inside a Card)
- ❌ **Auto-reject**: Placing a bordered/elevated card inside a larger bordered/elevated container.
- ✅ **The Fix**: Use whitespace and typography hierarchy to separate content inside a container, not another card.

### 10. No Promotional Fluff Copy
- ❌ **Auto-reject**: "Seamlessly supercharge your workflow", "Effortlessly integrate", "At a glance", "Smart, powerful, next-generation", "Game-changing".
- ✅ **The Fix**: Write plain, active interface facts from the user's perspective. State what the product actually does.

### 11. No Gray Text on Colored Surfaces
- ❌ **Auto-reject**: Setting muted gray (`#888888`) text on an accent or tinted background.
- ✅ **The Fix**: Text on colored backgrounds must be a tint of the background or high-contrast ink (`--ink`), never a washed-out neutral gray.

### 12. State-Stable Controls (Zero Layout Jitter)
- ❌ **Auto-reject**: Buttons or cards that change width or height when transitioning between default, hover, active, loading, or disabled states.
- ✅ **The Fix**: Reserve space for spinners, checkmarks, or arrow icons inside pre-allocated slots so padding and dimensions remain pixel-identical in all states.

---

## Part 2: The 10 Technical Gotchas & Performance Rules

These are known bugs that plague high-end WebGL, motion, and typography implementations. Check these before declaring done.

### 1. Italic Gradient + Character Split = Invisible Text
- **Symptom**: Splitting text with `background-clip: text; color: transparent;` into character `motion.span` tags causes text to completely disappear.
- **Cause**: Child spans inherit `color: transparent` but have no background image of their own.
- **The Fix**: Never character-split gradient text. Split by **words** or apply the gradient to an outer wrapper span that animates as a single unit.

### 2. Three.js Iridescent Material Looks Flat Without an EnvMap
- **Symptom**: `MeshPhysicalMaterial({ iridescence: 1, clearcoat: 1 })` looks dull, gray, and lifeless.
- **Cause**: Iridescence and clearcoat physically require reflections to render. Without an environment map, there is nothing to reflect.
- **The Fix**: Always bake a procedural gradient envMap via `PMREMGenerator` on a `CanvasTexture` inside the Code Component:
  ```js
  const envCanvas = document.createElement('canvas');
  envCanvas.width = 512; envCanvas.height = 256;
  const ctx = envCanvas.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 512, 256);
  g.addColorStop(0, '#0f172a');
  g.addColorStop(1, '#10b981');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 512, 256);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envMap = pmrem.fromEquirectangular(new THREE.CanvasTexture(envCanvas)).texture;
  mat.envMap = envMap;
  ```

### 3. Three.js Orbit Text — Back-Half Visible
- **Symptom**: Text mapped around a 3D cylinder sphere shows through from behind, breaking the Saturn-ring illusion.
- **The Fix**: Use `MeshBasicMaterial({ side: THREE.FrontSide, transparent: true, alphaTest: 0.1 })`. `FrontSide` automatically culls the back half. Set `renderOrder: 1` so the center orb draws first.

### 4. Velocity Marquee Judder on Mobile Touch Scroll
- **Symptom**: Velocity marquees jitter and stutter violently on iOS / Android touch scroll.
- **Cause**: Mobile browsers throttle `requestAnimationFrame` during momentum scroll, confusing `useVelocity`.
- **The Fix**: On mobile, increase spring `damping` from 50 to 80 and lower `stiffness` from 400 to 200, or disable the velocity multiplier entirely below 768px and run a constant-speed marquee.

### 5. WebGL / Heavy Motion Hurting LCP (LCP > 2.5s)
- **Symptom**: The site feels heavy and fails Core Web Vitals.
- **The Fix**: Render the Hero heading and primary CTA in pure HTML/Next.js first. Mount the WebGL Three.js canvas in the background *after* first paint (or defer with a subtle opacity fade-in).

### 6. Mobile GPU Battery Drain (High DPI Throttling)
- **Symptom**: High frame drops and thermal throttling on 3x Retina mobile devices.
- **The Fix**: Always cap WebGL pixel ratio:
  ```js
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  ```

### 7. Font Flash of Unstyled Text (FOUT)
- **Symptom**: The display font flashes in noticeably after page load, causing layout shifts.
- **The Fix**: Connect fonts via `fonts.transformNextFont`. It leverages `next/font/google` with automatic SSR font inlining, zero external network roundtrips, and CSS variable binding (`--font-display`).

### 8. React Rules of Hooks in Animation Helpers
- **Symptom**: `Invalid hook call` when reusing an animation helper function.
- **The Fix**: Never call `useMotionValue` or `useSpring` inside plain helper functions. Promote helpers to real components (e.g. `MagneticButton`, `TiltCard`).

### 9. The Motion Meaning Rule
- **Rule**: Every animation must answer the question: *"What does this motion explain to the user?"*
  - Stagger reveals $\to$ "These items are related; scan them in this order."
  - Scale on hover $\to$ "This element is interactive and ready to be pressed."
  - Page transition $\to$ "The page is navigating to a new context."
  - If an animation is purely decorative without meaning, **cut it**.

### 10. Touch Target Floor ($\ge 44 \times 44\text{px}$)
- **Rule**: On mobile (390px), every button, hamburger toggle, and link must have an interactive hit area of at least $44 \times 44\text{px}$, with at least 8px spacing between targets.
