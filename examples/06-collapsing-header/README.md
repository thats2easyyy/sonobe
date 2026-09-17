# Collapsing Header

A playlist page with a big header: cover art, a large title, and a play button. Scroll the tracks and the header shrinks into a compact bar. The title glides up and gets smaller, the cover art fades and shrinks, and the play button tucks into the corner. Scroll back to the top and it all comes back. Every change follows your finger exactly.

Level 2 · Guides: [04 Layers and layout](../../docs/guides/04-layers-and-layout.md), [06 Gestures](../../docs/guides/06-gestures.md)

## What you'll learn

- Turning a scroll position into a 0…1 progress with Progress and Clamp to Range.
- Driving many properties from one progress: size, scale, opacity, position and font size.
- Why scroll-linked effects skip the Animation step of ISAT.
- Layering a header over scrolling content without blocking touches.

## Build it step by step

1. **The tracks.** Add a Group named Tracks (`content`), 402 wide and tall enough for every track. It has no parent, so the screen is its window. Leave the top 300 points empty for the header, then add a summary line and 18 track rows.
2. **Scroll them.** Add a Scroll patch (`tracks_scroll`) on Tracks with Scroll Y Free, into the Tracks' Position.
3. **The header.** Add a Header group (`header`), 402 × 300, with Clip Contents and Receives Touches off. Inside it go the art gradient, the cover art (`cover`), a shade gradient, a back button, the title (`header_title`), the subtitle (`header_subtitle`), and a green play button (`play_button`).
4. **One progress.** Add a Progress (`collapse`) from `tracks_scroll.y`, with Start 0, End −190 and Clamp to Range on. Scrolling 190 points (300 − 110) takes it from 0 to 1.
5. **Everything reads it.** Add Transitions from `collapse.progress`:
   - `header_size` (size): 402 × 300 → 402 × 110, into the header's Size.
   - `cover_scale`: 1 → 0.6, into the cover's Scale.
   - `cover_fade`: 1 → 0, into the cover's and the subtitle's Opacity.
   - `title_position` (point): `[24, 228]` → `[64, 64]`, into the title's Position.
   - `title_size`: 34 → 20, into the title's Font Size.
   - `play_position` (point): `[322, 244]` → `[342, 58]`, and `play_scale`: 1 → 0.72, into the play button.
6. **Scroll.** The title reaches the bar at the same moment the header stops shrinking, because they share one progress.

## The patch chain

```text
Scroll Tracks ──position──▶ Tracks · Position
     │
     └──y──▶ Collapse Progress (0 → −190, clamped) ──progress──┬─▶ Header Size    402×300 → 402×110 ─▶ Header · Size
                                                               ├─▶ Cover Scale    1 → 0.6           ─▶ Cover Art · Scale
                                                               ├─▶ Cover Fade     1 → 0             ─▶ Cover Art · Opacity, Subtitle · Opacity
                                                               ├─▶ Title Position [24,228] → [64,64] ─▶ Title · Position
                                                               ├─▶ Title Size     34 → 20           ─▶ Title · Font Size
                                                               ├─▶ Play Position  [322,244] → [342,58] ─▶ Play Button · Position
                                                               └─▶ Play Scale     1 → 0.72          ─▶ Play Button · Scale
```

| Patch | Type | Its one job |
|---|---|---|
| `tracks_scroll` | Scroll | Scrolls the tracks and reports `y` (0 at the top, negative as you scroll down). |
| `collapse` | Progress | 0 at the top, 1 after 190 points, and stays at 1 beyond. |
| `header_size`, `cover_scale`, `cover_fade`, `title_position`, `title_size`, `play_position`, `play_scale` | Transition | Each turns the same progress into its own units. |
| `play_icon_shape` | SVG Path Shape | Draws the play triangle. |

There's no Pop Animation anywhere. The finger already moves `y` smoothly, and a spring would make the header lag behind the tracks and wobble when you stop.

## Check it

`test.json` holds a 95-point drag and checks the header is partway collapsed (between 205 and 225 points tall) while the finger is still down. It flicks up and checks the bar is 110 tall with a 20-point title and no cover. Then it scrolls back to the top and checks everything is restored.

```sh
npx vitest run examples/run.test.ts -t 06-collapsing-header
```

## Variations

- **Stretch when pulling down.** Replace `header_size` with a Math Expression `clamp(300 + y, 110, 460)` fed by `tracks_scroll.y`, into a Size patch (width 402). The header now grows past 300 when you pull down at the top.
- **Snap to open or closed.** When the finger lifts mid-collapse, jump the scroll to 0 or −190. Use a Pulse on `tracks_scroll.dragging`, and an If Else on `collapse.progress` above 0.5 into Jump Position Y.
- **Tint the bar.** A color Transition from clear to the art's deep purple into a bar background, so the compact bar is readable over the tracks.
- **Ease the fade.** Set a Curve on a Remap patch instead of Transition, for example Quadratic In, so the cover stays visible longer before fading.

## Common mistakes

- **Collapsing over the wrong distance.** If the Progress End doesn't match 300 − 110, the header either stops shrinking early or keeps going past the bar.
- **Forgetting Clamp to Range.** Past 190 points the progress keeps growing, the header shrinks below 110, and the title shoots off the top.
- **A header that catches touches.** With Receives Touches on, drags that start on the header don't reach the tracks, and the page feels stuck.
- **Animating with Pop Animation.** Springs make scroll-linked effects feel sloppy. Map the scroll straight through Progress and Transition.
