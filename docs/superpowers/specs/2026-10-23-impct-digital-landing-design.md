# IMPCT.DIGITAL — landing page design

## Purpose

Create a Ukrainian-language landing page for **IMPCT.DIGITAL**, a studio that
builds websites and introduces practical AI systems into businesses. The page
must make the studio feel precise, technically capable, and editorial rather
than like a generic agency template.

## Scope and success criteria

- One responsive homepage at `/`, authored through Revyme MCP v2 against
  project `proj-1792770801304-tbg5o9`, branch `main`.
- All primary content is editable in the Revyme canvas; only the animated
  cursor is a deliberately encapsulated runtime code component.
- Desktop and mobile layouts have no horizontal overflow. The project grid is
  two columns on desktop and one column on mobile.
- The page contains meaningful Ukrainian copy, metadata, a navigation overlay,
  hero, marquee, studio statement, conceptual work grid, and footer.
- No invented client claims: portfolio entries are explicitly identified as
  concepts until real case studies are supplied.

## Art direction

IMPCT.DIGITAL uses a white field, almost no ornament, and typography as the
main visual instrument. The visual signature is a near-poster-scale hero with
compressed, tight Inter headings; movement is restricted to the initial text
reveal, the project marquee, and direct response to a visitor's pointer.

### Tokens

| Role | Value |
| --- | --- |
| Page background | `#FFFFFF` |
| Primary text | `#000000` |
| Supporting text | `#525252` |
| Muted metadata | `#737373` |
| Hairline rules | `rgba(0, 0, 0, 0.10)` |
| Footer background | `#0A0A0A` |
| Footer foreground | `#FFFFFF` |

The primary family is Inter (400 and 700). Headlines use weight 700,
`letter-spacing: -0.05em`, and `line-height: 0.9`; body copy uses weight 400,
`letter-spacing: -0.02em`, and `line-height: 1.5`. Metadata uses a 14px
monospace face, uppercase, and `letter-spacing: 0.1em`.

## Page composition

1. **Header.** Fixed, minimal, contrast-preserving navigation with the
   `IMPCT.DIGITAL` wordmark and plus-icon menu trigger. The opened state is a
   full-screen navigation overlay. The header stays visually distinct over
   both light and dark sections.
2. **Hero.** A centred, 80vh-minimum statement: “Сайти та ШІ-системи для
   бізнесу, який має рости.” Its lines reveal upward in sequence. A short
   supporting sentence explains the studio's web and AI implementation work.
3. **Project marquee.** A full-width, continuously moving row of vertical
   image cards with alternating asymmetric radii. It pauses on interaction;
   image treatment starts grayscale and becomes colour on hover.
4. **Studio statement.** A centred explanation of the studio's point of view:
   design, development, and AI automation are one business system rather than
   separate deliverables.
5. **Concept grid.** Four clearly marked concept case studies. Each has a 4:3
   image, hover overlay and arrow, plus a ruled metadata row with title,
   category, and year. The grid becomes one column at the mobile viewport.
6. **Footer.** Dark four-column layout: brand and short bio, socials, contact,
   and a final legal/credits line separated by a hairline rule.

## Interaction and runtime boundaries

- A dedicated `DifferenceCursor` code component owns requestAnimationFrame
  interpolation, the 32px inverted pointer and the 2.5x interactive scale.
  It is intentionally a code component because it needs browser event and
  animation-frame state; the rest of the page remains canvas-editable.
- The page suppresses the default cursor only for fine pointers. Keyboard
  focus remains visible and ordinary pointer behavior is preserved when the
  custom cursor is unavailable.
- Hover images scale to `1.05` while grayscale moves from 100% to 0%. Motion
  uses the requested `cubic-bezier(0.16, 1, 0.3, 1)` timing at 700ms.
- Users with `prefers-reduced-motion` receive static content and no continuous
  marquee or reveal movement.

## Revyme implementation shape

1. Establish semantic colour, type, spacing, radius, and border tokens and
   import Inter.
2. Construct the homepage using visual nodes and responsive overrides so the
   generated TSX remains editable in Builder.
3. Add the cursor as the sole code component; use a native marquee component
   and motion presets where their output remains editable.
4. Update page metadata in Ukrainian, then build and inspect the generated
   project in desktop and mobile modes.
5. Execute mutations as validated MCP v2 plans, record the committed revision,
   and verify the final project state after every atomic batch.

## Acceptance checks

- MCP v2 receives the intended `projectId` and `branchId`; commits do not
  overwrite a newer revision.
- Source passes Revyme validation and the project build succeeds.
- Header, hero, marquee, statement, grid, and footer all exist in the source
  and have stable canvas IDs.
- Mobile grid is one column, with no viewport overflow.
- The product does not claim fictional client work as real work.
