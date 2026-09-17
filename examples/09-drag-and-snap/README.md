# Drag and Snap

A video call with your own small self view in the corner. Drag it anywhere and it sticks to your finger. Let go and it glides to a corner, picked the way a thrown object would land: flick it toward the bottom left and it travels there, place it slowly near the bottom right and it settles there, nudge it and it goes home.

Level 2 · Guides: [05 Springs and feel](../../docs/guides/05-springs-and-feel.md), [06 Gestures](../../docs/guides/06-gestures.md)

## What you'll learn

- The same "follow, decide, animate" chain as the bottom sheet, working in 2D with point values.
- Snapping to a list of points, with the throw projected along its velocity.
- Why one Spring Animation on a point keeps x and y in step.
- Simple press feedback while dragging.

## Build it step by step

1. **Layers.** The remote video is a gradient with a few shapes. Controls sit at the bottom (`controls`, from y 764). The Self View group (`pip`) is 120 × 170 with Clip Contents, a thin white border and a shadow, at the top-right corner `[266, 76]`.
2. **Measure.** Add a Gesture (`pip_gesture`) on Self View, a Not (`pip_idle`) on its Down, and a Pulse (`finger`) on its Down.
3. **Follow from the grab point.** Add a Delay One Frame (`pip_last_frame`, point) and a Sample and Hold (`grab_position`, point) with Value from `pip_last_frame.output` and Sample from `pip_idle.output`. Add an Add (`finger_position`, point): `grab_position.output` plus `pip_gesture.translation`.
4. **The corners.** Add a Loop Builder (`corners`, point) with the top-left position for each corner. Item 0 is top right, where the self view starts: `[266, 76]`, `[16, 76]`, `[16, 578]`, `[266, 578]`.
5. **Pick a corner on release.** Add a Snap (`fling_corner`, point) with Mode Points, Points from `corners.loop`, Value from `pip_last_frame.output`, Velocity from `pip_gesture.velocity`, and Deceleration Normal. Add a Counter (`current_corner`) with Jump from `finger.turnedOff` and Jump to Number from `fling_corner.index`, then a Loop Select (`corner_position`, point).
6. **Animate.** Add an If Else (`pip_target`, point) that picks `finger_position.output` while `pip_gesture.down` is on, otherwise `corner_position.output`. Add a Spring Animation (`pip_spring`, point) with Number from the target, Gesture Active from Down, Gesture Velocity from `pip_gesture.velocity`, Tension 220 and Friction 22. Connect its output to the Self View's Position and back into `pip_last_frame.value`.
7. **Lift while held.** Add a Pop Animation (`pip_press`, Bounciness 0, Speed 20) on Down, and a Transition (`pip_lift`, 1 → 1.06) into Scale.

## The patch chain

```text
1 Measure   Drag Self View (Gesture) ──▶ translation · velocity · Not Dragging · Finger Down or Up

2 Follow    Position Last Frame ──▶ Position at Grab ──▶ Position Under Finger            (grab point + translation)

3 Decide    Position Last Frame ─┐
            velocity ────────────┴▶ Nearest Corner After Fling ──index──▶ Current Corner ──▶ Corner Position
            Corners (TR, TL, BL, BR) ──────────────▲                                           ▲

4 Animate   Finger or Corner ──▶ Self View Spring (point, starts at velocity) ──▶ Self View · Position
                                          └──▶ Position Last Frame   (read next frame)
            Down ──▶ Press Spring ──▶ Lift While Held ──▶ Self View · Scale
```

| Patch | Type | Its one job |
|---|---|---|
| `pip_gesture` | Gesture | Finger down, translation and velocity, which are kept on the release frame. |
| `pip_last_frame` | Delay One Frame | Where the self view was on the previous frame. |
| `grab_position`, `finger_position` | Sample and Hold, Add | Where the self view should be under the finger. |
| `corners` | Loop Builder | The four resting positions. |
| `fling_corner` | Snap | Projects where a throw at this velocity would land, and picks the nearest corner. |
| `current_corner`, `corner_position` | Counter, Loop Select | Remember the chosen corner, then look up its position. |
| `pip_target` | If Else | The finger's position while dragging, the corner after. |
| `pip_spring` | Spring Animation | Tracks the finger exactly, then springs to the corner starting at the finger's velocity. |
| `pip_press`, `pip_lift` | Pop Animation, Transition | A slight lift while held. |

Compare it with `examples/08-bottom-sheet`. It's the same graph with points instead of numbers, and Deceleration Normal instead of Fast, because a thrown window should travel across the screen.

## Check it

`test.json` flings the self view down and left and checks it lands at `[16, 578]`. A slow drag toward the bottom right lands at `[266, 578]`, and a small slow nudge returns to the top right. A held drag has to move by exactly the finger's distance at 1.06 scale.

```sh
npx vitest run examples/run.test.ts -t 09-drag-and-snap
```

## Variations

- **Only left or right.** Set the Loop Builder to two points at the same y, and keep the y the finger chose by snapping only x (a number Snap on the x part).
- **Tighter throws.** Deceleration Fast projects about a fifth as far, so you need to place the window closer to the corner.
- **Dismiss by throwing off screen.** Add a fifth point far off screen, and hide the self view when Current Corner reaches it.
- **Rubber band against the edges.** Clamp `finger_position.output` between `[0, 62]` and `[282, 594]` before the If Else.

## Common mistakes

- **Two separate number springs for x and y.** They settle at different moments, and a diagonal throw curves. One point spring keeps them together.
- **Drag patch velocity.** Drag reports 0 on the release frame unless Momentum is on. Gesture keeps velocity for that frame, which is when the spring reads it.
- **Corners as center points.** Position is the layer's anchor, which is the top-left corner here. Keep the corner values and the Anchor in agreement.
- **A Loop Builder whose first item isn't the starting corner.** The Counter starts at 0, so the view jumps to item 0 on the first frame.
