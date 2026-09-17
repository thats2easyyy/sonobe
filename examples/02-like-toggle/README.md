# Like Toggle

A post with a heart. Tap the heart to like it; it pops, fills pink, and the count ticks up. Tap again to unlike. Double-tap the photo and it likes the post with a big heart flash, but a double tap never unlikes. Two ways in, one piece of memory.

Level 0–1 · Guides: [02 ISAT](../../docs/guides/02-isat.md), [03 States and pulses](../../docs/guides/03-states-and-pulses.md)

## What you'll learn

- Why Flip suits one button, and why Turn On suits a gesture that should only ever like.
- How one Switch can drive a scale, two colors and a text label at once.
- Doing arithmetic with a state: a boolean counts as 0 or 1, so the count is 128 plus the switch.
- Building a short "on for a moment" effect from a Switch and a Wait.
- Drawing an icon with a Shape layer and an SVG path.

## Build it step by step

1. **Layers.** A white Post group holds the author row, a Photo group (`post_photo`), a Heart Button group (`heart_button`, 48 × 48, so it's easy to hit) with a Shape layer inside (`heart_icon`), and a text layer for the count (`likes`). Over the photo sits a white Shape named Big Heart (`burst`) at Opacity 0 with Receives Touches off.
2. **Draw the hearts.** Add two SVG Path Shape patches with the same heart path and View Box `[0, 0, 24, 24]`: `heart_shape` at Size 24 × 24 into the heart's Shape, and `burst_shape` at 96 × 96 into the big heart's Shape.
3. **Two ways in.** Add an Interaction on Heart Button (`tap_heart`) and a Double Tap on Photo (`double_tap_photo`).
4. **One memory.** Add a Switch named Liked (`liked`). Connect `tap_heart.tap` to Flip and `double_tap_photo.doubleTap` to Turn On.
5. **Animate.** Add a Pop Animation (`like_spring`) fed by `liked.on`, with Bounciness 12 and Speed 14. High bounciness is what makes the heart pop.
6. **Map to looks.** Add three Transitions from `like_spring.output`: `heart_scale` (0.9 → 1) into the heart's Scale, `heart_fill` (color, transparent pink → pink) into Color, and `heart_outline` (color, ink → pink) into Stroke Color.
7. **The count.** Add an Add patch (`like_count`) with Value 1 set to 128 and `liked.on` into Value 2, then a Format Number (`like_label`) with Suffix " likes" into the count text.
8. **The big heart.** Add a Switch (`burst_visible`) with Turn On from `double_tap_photo.doubleTap`, and a Wait (`burst_timer`, 0.55 s) started by the same pulse, whose Finished turns the switch off. A Pop Animation (`burst_spring`), a Transition (`burst_scale`, 0.3 → 1) and a Progress (`burst_opacity`, 0 → 0.5, clamped) show and hide it.

## The patch chain

```text
Tap Heart ─────────tap──────────▶ Flip ────┐
                                           ├─ Liked ──on──▶ Like Spring ──┬─▶ Heart Scale    0.9 → 1          ─▶ Heart · Scale
Double-Tap Photo ──double tap───▶ Turn On ─┘  (Switch)     (Pop, 12, 14)  ├─▶ Heart Fill     clear → pink     ─▶ Heart · Color
                                                                          └─▶ Heart Outline  ink → pink       ─▶ Heart · Stroke Color

                                  Liked ──on──▶ Like Count (128 + on) ──▶ Like Label ("129 likes") ──▶ Like Count · Text

Double-Tap Photo ──▶ Big Heart Visible ──on──▶ Big Heart Spring ──▶ Big Heart Scale · Big Heart Opacity ──▶ Big Heart
        └─────────▶ Big Heart Timer (0.55 s) ──finished──▶ Big Heart Visible · Turn Off
```

| Patch | Type | Its one job |
|---|---|---|
| `tap_heart` | Interaction | Pulses when the heart button is tapped. |
| `double_tap_photo` | Double Tap | Pulses when two taps land on the photo within 0.3 seconds. A single tap does nothing here. |
| `liked` | Switch | The memory. Flip toggles it; Turn On only turns it on, so a double tap never unlikes. |
| `like_spring` | Pop Animation | 0 to 1 with a big overshoot, so the heart pops past full size and settles. |
| `heart_scale`, `heart_fill`, `heart_outline` | Transition | The same progress as a size, a fill color and an outline color. |
| `like_count` | Add | 128 + `liked.on`. A boolean wired into a number reads as 1 or 0. |
| `like_label` | Format Number | Turns 129 into "129 likes". |
| `burst_visible`, `burst_timer` | Switch, Wait | On at the double tap, off 0.55 seconds later. |
| `burst_spring`, `burst_scale`, `burst_opacity` | Pop Animation, Transition, Progress | Pop the big heart in and shrink it away. |

## Check it

`test.json` taps the heart, taps it twice, double-taps the photo, single-taps it, and double-taps a liked post. It checks the count text, the heart's scale overshoot, the fill's alpha, and that the big heart appears and disappears.

```sh
npx vitest run examples/run.test.ts -t 02-like-toggle
```

## Variations

- **Press feedback.** Feed `tap_heart.down` into another Pop Animation (Bounciness 0, Speed 20) and a Transition from 1 to 0.85, into the Heart Button's Scale. The heart dips under your finger before it pops.
- **Double tap toggles.** Wire `double_tap_photo.doubleTap` into Flip too. You'll need an Or, because an input takes one cable.
- **Softer.** Bounciness 4 gives a gentle, polished feel instead of a cartoon pop.
- **Different icon.** Change `pathData` on both shape patches. Any SVG path works; View Box says which part of it to show.
- **Save button.** Copy the chain for the bookmark icon, with its own Switch. Separate memories keep separate things independent.

## Common mistakes

- **Wiring the Double Tap into Flip "because it's simpler".** Then double-tapping an already liked photo unlikes it, which surprises people.
- **Driving the heart straight from the Switch.** The heart would snap between sizes. The Pop Animation in between is what makes it pop.
- **A heart button the size of the icon.** 24 points is hard to hit. The 48-point Heart Button group gives the finger room while the icon stays small.
- **Showing the big heart with Opacity alone.** Opacity overshoots past 1 with a bouncy spring. Here Progress clamps it to 0…1 while the scale keeps the bounce.
