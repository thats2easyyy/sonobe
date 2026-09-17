# Timed Sequence

A "Payment sent" confirmation that plays itself. The green circle pops in, the check draws itself, the amount fades up, the receipt slides in, and a Replay button appears. Tap Replay and it plays from the top.

Level 1–2 · Guides: [02 ISAT](../../docs/guides/02-isat.md), [05 Springs and feel](../../docs/guides/05-springs-and-feel.md)

## What you'll learn

- ISAT with no Interaction: When Prototype Starts is the trigger.
- Scheduling stages with Waits started from one pulse.
- Matching the animation to the job: springs for things that pop, Classic Animation for fades and drawing.
- Drawing a stroke over time with Stroke End on a Shape layer.
- Replaying with Restart Prototype.

## Build it step by step

1. **Layers.** A soft green gradient backdrop. A pale ring (`check_ring`) and a green circle (`check_circle`), both at Scale 0. A Shape (`checkmark`) with a white stroke of 8, Line Cap Round and Stroke End 0. The title (`title`) and amount (`amount`) at Opacity 0. A receipt card (`details`) off screen at y 900, and a dark Replay button (`replay_button`) at Opacity 0.
2. **Draw the check.** Add an SVG Path Shape (`check_shape`) with Path Data `M34 62L52 80L88 42`, View Box `[0, 0, 120, 120]` and Size 120 × 120, into the checkmark's Shape.
3. **Start.** Add When Prototype Starts (`started`). It pulses once, on the first frame.
4. **Schedule.** Add five Waits, all started by `started.started`: `circle_wait` (0.1 s), `check_wait` (0.45 s), `title_wait` (0.8 s), `details_wait` (1.15 s) and `button_wait` (1.5 s). Each one's Done turns on at its time and stays on.
5. **Stage 1.** Add a Pop Animation (`circle_spring`, Bounciness 8, Speed 12) on `circle_wait.done`, then Transitions for the circle's scale (`circle_scale`, 0 → 1) and the ring's (`ring_scale`, 0.5 → 1).
6. **Stage 2.** Add a Classic Animation (`check_draw`, 0.45 s, Cubic Out) on `check_wait.done`, into the checkmark's Stroke End.
7. **Stage 3.** Add a Classic Animation (`title_fade`, 0.4 s, Cubic Out) on `title_wait.done`, into both text layers' Opacity. Add two point Transitions (`title_rise`, `amount_rise`) that lift each text by 16 points.
8. **Stage 4.** Add a Pop Animation (`details_spring`, Bounciness 3) on `details_wait.done`, and a point Transition (`details_position`) from `[24, 900]` to `[24, 548]` into the receipt's Position.
9. **Stage 5.** Add a Classic Animation (`button_fade`, 0.3 s) on `button_wait.done`, into the Replay button's Opacity. Then add an Interaction (`tap_replay`) on the button and a Restart Prototype (`replay`) with Restart from `tap_replay.tap`.

## The patch chain

```text
                         ┌─▶ After 0.1 s  ──done──▶ Circle Spring ──▶ Circle Scale · Ring Scale     ──▶ Circle · Ring
                         ├─▶ After 0.45 s ──done──▶ Draw Check (Classic 0.45 s)                     ──▶ Checkmark · Stroke End
Prototype Starts ─pulse──┼─▶ After 0.8 s  ──done──▶ Text Fade (Classic 0.4 s) ──▶ Title Rise · Amount Rise ──▶ Title · Amount
                         ├─▶ After 1.15 s ──done──▶ Receipt Spring ──▶ Receipt Position             ──▶ Receipt · Position
                         └─▶ After 1.5 s  ──done──▶ Button Fade (Classic 0.3 s)                     ──▶ Replay Button · Opacity

Tap Replay ──tap──▶ Replay (Restart Prototype) ──▶ everything starts over, and Prototype Starts pulses again
```

| Patch | Type | Its one job |
|---|---|---|
| `started` | When Prototype Starts | One pulse on the first frame, and again after every restart. |
| `circle_wait` … `button_wait` | Wait | Done turns on a set time after the start pulse. Five timers from one pulse are easier to retime than a chain of five. |
| `circle_spring`, `circle_scale`, `ring_scale` | Pop Animation, Transition | Pop the circle in with a small bounce. |
| `check_draw` | Classic Animation | Draws the stroke from 0 to 1 over exactly 0.45 seconds. |
| `title_fade`, `title_rise`, `amount_rise` | Classic Animation, Transition | Fade the text in while lifting it 16 points. |
| `details_spring`, `details_position` | Pop Animation, Transition | Slide the receipt up with the gentlest bounce. |
| `button_fade` | Classic Animation | Fade in the Replay button. |
| `check_shape` | SVG Path Shape | The checkmark's path. |
| `tap_replay`, `replay` | Interaction, Restart Prototype | Start the whole prototype over. |

## Check it

`test.json` checks the timeline. Nothing is visible at 50 ms. By 0.4 s the circle has popped but the check hasn't started. The check is drawing at 0.6 s and done by 1 s, and the title is still hidden at 0.75 s. By two seconds everything is in place. Replay makes the circle and check disappear, then play through again.

```sh
npx vitest run examples/run.test.ts -t 12-timed-sequence
```

## Variations

- **Chained instead of scheduled.** Start each Wait from the previous one's Finished. Each duration then becomes "how long after the previous stage", so changing one stage shifts everything after it.
- **Loop it.** Add a Repeating Pulse (Interval 4) into Restart Prototype, for a kiosk-style demo.
- **Faster overall.** Multiply every Wait's Duration by 0.7. The sequence keeps its rhythm.
- **Error state.** Swap the green for red and the check for an ✕ path. The timing graph stays the same.
- **Replay without restarting.** If other parts of the prototype must keep their state, route the replay pulse into each Wait's Start instead, through an Or with the start pulse.

## Common mistakes

- **Wiring the Waits' Finished pulses into the animations.** Finished is true for one frame, so a spring would twitch and return. Use Done, which stays on.
- **Fading with Pop Animation.** Opacity overshoots past 1. Use Classic Animation for fades and strokes.
- **Stroke End on a filled shape.** Stroke End trims the stroke only. Give the Shape a clear fill and a Stroke Width.
- **Putting everything on one Wait with several Delays.** That works, but Delay starts from its input's first value, so a Done that's already on at the first frame skips its delay.
