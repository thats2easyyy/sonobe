# Bottom Sheet

A sheet you can drag between three stops: half open, fully open (just below the location chip), and collapsed. It sticks to your finger while you drag. When you let go, it springs to the stop a fling at that speed would reach, and it starts moving at the speed your finger was going. Flick it and it travels; ease it and it settles back.

Level 2 · Guides: [05 Springs and feel](../../docs/guides/05-springs-and-feel.md), [06 Gestures](../../docs/guides/06-gestures.md)

## What you'll learn

- Following a finger exactly with Gesture, starting from wherever the sheet was grabbed.
- Handing the finger's velocity to Spring Animation, so letting go feels continuous instead of a stop and a start.
- Projecting a fling with Snap, so a short quick flick counts as much as a long slow drag.
- Using Delay One Frame on purpose to read where the sheet was.
- Scroll-linked effects: dimming the map straight from the sheet's position, with no extra animation.

## Build it step by step

1. **Layers.** A map made of shapes, then Scrim (a black Rectangle over the whole screen with Opacity 0 and Receives Touches off), then Sheet: a white Group, 402 × 874, Corner Radius 28, at `[0, 470]`. Inside the sheet go the Grabber, the title, a search field, and five place rows.
2. **Measure the finger.** Add a Gesture patch (`sheet_gesture`) on Sheet. Split its outputs with two Point Unpacks: `drag_distance` from Translation and `drag_speed` from Velocity. Add a Not (`sheet_idle`) on Down, and a Pulse (`finger`) on Down so you get a one-frame Turned Off when the finger lifts.
3. **Find the grab point.** Add a Delay One Frame (`sheet_y_last_frame`, number) and a Sample and Hold (`grab_y`) with Value from `sheet_y_last_frame.output` and Sample from `sheet_idle.output`. While no finger is down, Sample and Hold keeps copying the sheet's position. The moment a finger lands, it holds that value.
4. **Follow the finger.** Add an Add patch (`finger_y`): `grab_y.output` plus `drag_distance.y`. That's where the sheet should be under the finger.
5. **List the stops.** Add a Loop Builder (`stops`, number) with 470, 132 and 760. Item 0 is where the sheet starts, because the Counter in step 7 starts at 0.
6. **Project the fling.** Add a Snap (`fling_stop`) with Mode Points, Points from `stops.loop`, Value from `sheet_y_last_frame.output`, Velocity from `drag_speed.y`, and Deceleration Fast. Snap works out where the sheet would coast to at that speed, then picks the nearest stop.
7. **Remember the stop.** Add a Counter (`current_stop`) with Jump from `finger.turnedOff` and Jump to Number from `fling_stop.index`. On the frame the finger lifts, the count becomes the chosen stop. A Loop Select (`stop_y`) turns the count back into a y value.
8. **Animate.** Add an If / Else (`sheet_target`): Condition from `sheet_gesture.down`, If True from `finger_y.output`, If False from `stop_y.output`. Add a Spring Animation (`sheet_spring`) with Number from `sheet_target.output`, Gesture Active from `sheet_gesture.down`, Gesture Velocity from `drag_speed.y`, Tension 300 and Friction 30.
9. **Place the sheet.** Add a Point (`sheet_position`) with X 0 and Y from `sheet_spring.output`, into the Sheet's Position. Then connect `sheet_spring.output` into `sheet_y_last_frame.value` to close the loop.
10. **Dim the map.** Add a Progress (`sheet_openness`) from 760 to 132 with Clamp to Range on, and a Transition (`scrim_opacity`) from 0 to 0.4 into the Scrim's Opacity.

## The patch chain

The graph has four stages. Read it left to right.

```text
1 Measure   Drag Sheet (Gesture) ──▶ Drag Distance · Drag Speed · Not Dragging · Finger Down or Up

2 Follow    Sheet Y Last Frame ──▶ Sheet Y at Grab ──▶ Sheet Y Under Finger        grab point + distance

3 Decide    Sheet Y Last Frame ─┐
            Drag Speed ─────────┴▶ Nearest Stop After Fling ──index──▶ Current Stop ──▶ Stop Y

4 Animate   Finger or Stop ──▶ Sheet Spring ──▶ Sheet Position ──▶ Sheet · Position
            (finger y while     (starts at Drag Speed
             down, stop after)   when the finger lifts)
                                    └──▶ Sheet Y Last Frame   (read on the next frame)
```

| Patch | Type | Its one job |
|---|---|---|
| `sheet_gesture` | Gesture | Down, how far the finger moved since it landed, and its speed. It keeps Translation and Velocity on the release frame, which the handoff needs. |
| `sheet_y_last_frame` | Delay One Frame | The sheet's y from the previous frame. It's the one deliberate loop in the graph. |
| `grab_y` | Sample and Hold | Where the sheet was when the finger landed, so grabbing never makes it jump. |
| `finger_y` | Add | Grab point plus drag distance: where the sheet should be right now. |
| `fling_stop` | Snap | Projects the release along its velocity and picks the nearest of the three stops. |
| `current_stop` | Counter | Remembers which stop the sheet belongs at (0 half, 1 full, 2 collapsed). |
| `stop_y` | Loop Select | Turns the stop number into a y value. |
| `sheet_target` | If / Else | The finger's y while dragging, the stop's y otherwise. |
| `sheet_spring` | Spring Animation | Follows Number exactly while Gesture Active is on. When it turns off, the spring takes over, starting at Gesture Velocity. |
| `sheet_openness`, `scrim_opacity` | Progress, Transition | Turn the sheet's y into a 0…1 openness, then into the scrim's opacity. |

### What happens on the frame the finger lifts

1. Drag Sheet's Down turns off, but Translation and Velocity still hold the last values.
2. Finger Down or Up pulses Turned Off.
3. Nearest Stop After Fling projects from the sheet's last position at Drag Speed and picks a stop.
4. Current Stop jumps to that stop, so Stop Y changes on the same frame.
5. Finger or Stop switches to Stop Y.
6. Sheet Spring sees Gesture Active fall, takes Drag Speed as its starting velocity, and glides to the stop.

## Check it

`test.json` drags the grabber in a deterministic simulation and traces `@sheet.position`. A fast downward flick has to settle collapsed at 760. A slow drag up and a short quick flick up both settle fully open at 132. A gentle 78-point drag returns to 470. While the finger is held, the sheet moves by exactly the finger's distance.

```sh
npx vitest run examples/run.test.ts -t 08-bottom-sheet
```

## Variations

- **Two stops.** Give Loop Builder two items (470 and 132). Or replace the whole graph with a single Pop Switch patch (Gesture Swipe Y, Start 470, End 132), which bundles following, projection and a spring into one patch but only handles two states.
- **Softer landing.** Tension 180 and Friction 24 settle more slowly with a gentle overshoot.
- **Flings carry farther.** Set Snap's Deceleration to Normal. A quick flick up from collapsed can then reach full.
- **Resistance past the edges.** Put a Clamp (Min 60, Max 800) after `finger_y`, so the sheet can't be dragged off screen.
- **Scroll inside the sheet.** Add a Scroll patch on the place list, and turn its Enabled on only when `current_stop.count` equals 1 (use an Equals patch).
- **Square corners when full.** A Transition from 28 to 0 on `sheet_openness.progress`, into the Sheet's Corner Radius.

## Common mistakes

- **Using Drag's Velocity for the handoff.** Drag reports 0 on the release frame unless Momentum is on, and that's the one frame Spring Animation reads Gesture Velocity. Gesture keeps its velocity for that frame.
- **Using Pop Animation.** It can't take a starting velocity, so the sheet stops dead at release before springing away.
- **Closing the loop without Delay One Frame.** The graph still runs, but the engine then picks which cable reads last frame's value by patch id, and the sheet can jump on the first frame of a drag.
- **Snapping `finger_y` on release.** Sample and Hold starts copying again on the release frame while Gesture still reports the drag distance, so the distance counts twice. Snap the sheet's last position instead.
