# Motion Choreography & Animation Principles in Revyme Builder

This guide establishes the rules, physical spring parameters, and choreography recipes for creating award-winning, fluid animations in the Revyme Website Builder via the MCP bridge.

---

## 1. Core Principles of Web Animation

1. **Physical Realism via Springs**:
   - Never use linear transitions for UI interactions.
   - Use `type: "spring"` with calibrated `stiffness` and `damping` for responsive tactile feedback.
   - High stiffness + high damping = responsive & controlled (no chaotic oscillations).
   - Low stiffness + low damping = soft, floaty, ambient.

2. **Subtlety over Exaggeration**:
   - Hover scales should be subtle: `1.02` to `1.04` (never `1.2+` which breaks layout perception).
   - Card elevations: `y: -4` to `y: -8` with shadow expansion.
   - Button tap: `scale: 0.96` to `0.98` for snappy tactile feel.

3. **Performance First**:
   - Only animate composite properties: `transform` (`x`, `y`, `scale`, `rotate`) and `opacity`.
   - Never animate `width`, `height`, `margin`, or `padding` directly (causes layout reflow).

4. **Staggered Orchestration**:
   - Multi-element entrances (cards, badges, list items) should always be staggered by `0.08s` to `0.15s` rather than appearing simultaneously.

---

## 2. Spring Physics Parameter Presets

When calling `set_motion` or `set_text_effect`, use these calibrated transition curves:

| Preset Name | `type` | `stiffness` | `damping` | `mass` | Use Case |
|---|---|---|---|---|---|
| **Snappy Tactile** | `"spring"` | `400` | `28` | `0.8` | Buttons, toggles, micro-interactions, tap |
| **Smooth Card** | `"spring"` | `300` | `24` | `1.0` | Cards on hover, modal popups, tooltips |
| **Gentle Entrance** | `"spring"` | `240` | `26` | `1.0` | Scroll appear of containers, hero badges |
| **Floaty Ambient** | `"spring"` | `120` | `14` | `1.2` | Floating background badges, continuous loops |
| **Cinematic Tween** | `"tween"` | — | — | — | `duration: 0.6`, `ease: "easeOut"` (soft fade-in) |

---

## 3. High-Impact Animation Recipes for MCP

### Recipe A: Staggered Section / Grid Entrance (`appear`)
Apply to cards in a grid (e.g. pricing cards, features, team members):

```json
{
  "tool": "batch",
  "input": {
    "actions": [
      {
        "tool": "set_motion",
        "input": {
          "node_id": "card-1",
          "effect": "appear",
          "from": { "opacity": 0, "y": 32, "scale": 0.96 },
          "once": true,
          "transition": { "type": "spring", "stiffness": 260, "damping": 24, "delay": 0 }
        }
      },
      {
        "tool": "set_motion",
        "input": {
          "node_id": "card-2",
          "effect": "appear",
          "from": { "opacity": 0, "y": 32, "scale": 0.96 },
          "once": true,
          "transition": { "type": "spring", "stiffness": 260, "damping": 24, "delay": 0.1 }
        }
      },
      {
        "tool": "set_motion",
        "input": {
          "node_id": "card-3",
          "effect": "appear",
          "from": { "opacity": 0, "y": 32, "scale": 0.96 },
          "once": true,
          "transition": { "type": "spring", "stiffness": 260, "damping": 24, "delay": 0.2 }
        }
      }
    ]
  }
}
```

### Recipe B: Premium Interactive Card (`hover` + `tap`)
Combine responsive hover elevation with a crisp click/tap compression:

```json
{
  "tool": "batch",
  "input": {
    "actions": [
      {
        "tool": "set_motion",
        "input": {
          "node_id": "pricing-card-featured",
          "effect": "hover",
          "targets": {
            "y": -8,
            "scale": 1.025,
            "boxShadow": "0 20px 30px -10px rgba(0, 0, 0, 0.25)"
          },
          "transition": { "type": "spring", "stiffness": 320, "damping": 22 }
        }
      },
      {
        "tool": "set_motion",
        "input": {
          "node_id": "pricing-card-featured",
          "effect": "tap",
          "targets": { "scale": 0.97 },
          "transition": { "type": "spring", "stiffness": 450, "damping": 28 }
        }
      }
    ]
  }
}
```

### Recipe C: Cinematic Masked Text Reveal (`set_text_effect`)
Reveals headings letter-by-letter or word-by-word sliding up from behind an invisible mask line:

```json
{
  "tool": "set_text_effect",
  "input": {
    "node_id": "hero-heading-1",
    "preset": "Slide Up",
    "split": "character",
    "stagger": 0.03,
    "mask": true,
    "trigger": "appear",
    "transition": {
      "type": "spring",
      "stiffness": 300,
      "damping": 28
    }
  }
}
```
*Tip for long paragraph text*: Use `split: "word"` with `stagger: 0.045` and `trigger: "layerInView"`.

### Recipe D: Asymmetric Dual-Scroll Parallax (`speed`)
Create depth between adjacent elements during page scrolling:
- One element advances ahead of the scroll (`speed > 100`).
- The other element lags gracefully behind (`speed < 100`).

```json
{
  "tool": "batch",
  "input": {
    "actions": [
      {
        "tool": "set_motion",
        "input": {
          "node_id": "feature-card-left",
          "effect": "speed",
          "speed": 125
        }
      },
      {
        "tool": "set_motion",
        "input": {
          "node_id": "feature-card-right",
          "effect": "speed",
          "speed": 75
        }
      }
    ]
  }
}
```

### Recipe E: Scroll-Scrubbed Zoom & Fade (`transform`)
Smoothly fades and scales an element as the user scrolls it through the viewport:

```json
{
  "tool": "set_motion",
  "input": {
    "node_id": "product-hero-mockup",
    "effect": "transform",
    "trigger": "layerInView",
    "from": { "opacity": 0.3, "scale": 0.88, "y": 60 },
    "to": { "opacity": 1, "scale": 1.0, "y": 0 }
  }
}
```

### Recipe F: Sticky Auto-Hiding Navbar (`animation`)
Hides navigation bar when scrolling down, slides it back down when scrolling up:

```json
{
  "tool": "set_motion",
  "input": {
    "node_id": "site-header",
    "effect": "animation",
    "direction": "down",
    "targets": { "y": -90, "opacity": 0 },
    "replay": true,
    "transition": { "duration": 0.3, "ease": "easeInOut" }
  }
}
```

### Recipe G: Floating Ambient Badge (`loop`)
Continuous subtle levitation for badges, icons, or floating decorative pills:

```json
{
  "tool": "set_motion",
  "input": {
    "node_id": "floating-pill-badge",
    "effect": "loop",
    "targets": { "y": -6 },
    "transition": {
      "duration": 2.5,
      "ease": "easeInOut",
      "repeatType": "mirror"
    }
  }
}
```

### Recipe H: Global Momentum Smooth Scroll (`set_smooth_scroll`)
Enables Lenis physics-based smooth momentum scrolling across the entire page:

```json
{
  "tool": "set_smooth_scroll",
  "input": {
    "enabled": true,
    "intensity": 14
  }
}
```

---

## 4. MCP Safety & Builder Integration Rules

1. **Always use Semantic Tools**:
   Do **not** hand-code arbitrary Framer Motion hooks (`useAnimate`, `useScroll`) into `.tsx` files. Use `set_motion` and `set_text_effect` so the animations:
   - Appear in the visual editor's canvas immediately.
   - Are visible and editable in the right sidebar's **Animation** panel.
   - Survive project saving, duplication, and re-generation cleanly.

2. **Always Batch Grouped Effects**:
   When animating a multi-element component or entire section, bundle calls inside the `batch` tool. This ensures single-transaction execution and a single visual update.

3. **Check Existing Motion**:
   Before modifying an element's effects, call `get_motion` to inspect existing effects, or `remove_motion` with `effect: "all"` to reset.
