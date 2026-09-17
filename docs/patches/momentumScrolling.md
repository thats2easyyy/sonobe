<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Momentum Scrolling

Adds flick momentum and rubber-band bounds to a value you track yourself, for custom scroll and drag physics.

| | |
|---|---|
| Type key | `momentumScrolling` |
| Category | [Interaction](README.md#interaction) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | momentum scrolling engine, momentum, inertia, flick physics, decay, rubber band, overscroll, sample value, coast |

## How it works
Momentum Scrolling is the physics behind Scroll, offered as a building block. While **Tracking** is on, **Output** follows **Value** exactly. When Tracking turns off, Output keeps moving at the speed Value was changing, slows down, and springs back if it ends up outside the boundaries.

- **Tracking** is usually a Down or Dragging output.
- **Value** is what you track, often a position built from the finger's movement.
- **Start Boundary** and **End Boundary** set the range Output settles into. Past them it rubber-bands back.
- **Scrolling Friction** (1 to 100) sets how soon a flick stops: 4 feels like iOS, 20 stops quickly.
- **Rubber Band Tension** and **Rubber Band Friction** (10 to 1000) shape the spring back: tension for speed, friction for smoothness.
- **Stick to Boundaries** stops Output at the boundaries instead of stretching past them.
- **Velocity** and **Moving** report the motion after release.

## Tips
- Scroll and Drag's Momentum already cover most prototypes. Reach for this patch when you need physics on something else, like a dial's rotation.
- Feed Output back into your Value math with Delay One Frame, so a new grab continues from where the flick stopped.

## Coming from Origami
Origami's docs list five inputs; current files have eight, which Sonobe matches (Sample Value is Tracking here). Output starts at Value instead of jumping to the End Boundary. Velocity and Moving are new.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Tracking**<br>`tracking` | `boolean` | `false` | When on, Output follows Value; when it turns off, Output coasts with momentum. |
| **Value**<br>`value` | `number` | `0` | The number Output follows while Tracking is on, such as a position in points. |
| **Start Boundary**<br>`startBoundary` | `number` | `0` | The low end of the range Output settles into; past it Output springs back. |
| **End Boundary**<br>`endBoundary` | `number` | `99999` | The high end of the range Output settles into; the default leaves it effectively open. |
| **Scrolling Friction**<br>`scrollingFriction` | `number` | `4` | How quickly a flick slows down, 1 to 100: 4 feels like iOS scrolling, 100 stops almost at once. Range 1 to 100, step 1. |
| **Rubber Band Tension**<br>`rubberBandTension` | `number` | `200` | How fast Output returns from past a boundary, 10 to 1000; higher is snappier. Range 10 to 1000, step 1. |
| **Rubber Band Friction**<br>`rubberBandFriction` | `number` | `28` | How smoothly Output returns from past a boundary, 10 to 1000; lower wobbles more. Range 10 to 1000, step 1. |
| **Stick to Boundaries**<br>`stickToBoundaries` | `boolean` · advanced | `false` | When on, Output stops at the boundaries instead of stretching past them and springing back. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `number` | The value with momentum added: Value while tracking, then coasting and settling. |
| **Velocity**<br>`velocity` | `number` (velocity) | How fast Output is changing, in units per second; 0 at rest. |
| **Moving**<br>`moving` | `boolean` | True while Output is coasting or springing back after release. |

## Examples

### Flick a dial so it keeps spinning

The feedback loop adds each frame's horizontal drag movement to the previous output, so the dial spins on after release.

```text
layer dial oval "Dial" @101,300 200x200 rotation←spin.output
patch grab drag layer=@dial axis=horizontal
patch previous_drag delay1 value←grab.position
patch step subtract<point> value1←grab.position value2←previous_drag.output
patch previous_spin delay1 value←spin.output
patch next_angle add value1←previous_spin.output value2←step.output
patch spin momentumScrolling tracking←grab.dragging value←next_angle.output startBoundary=-99999 endBoundary=99999 scrollingFriction=10
```

## Common mistakes

- Output jumps back when you grab again: Value restarted from the finger's position instead of where the flick stopped. Build Value from Output's previous frame (Delay One Frame) plus the finger's movement.
- Nothing coasts after release: Value didn't change during the frames before Tracking turned off, so the release velocity was 0. Track a value that follows the finger every frame.
- Changing Value does nothing: Value is only read while Tracking is on. Turn Tracking on for a frame to move Output.

## Pairs well with

- [Gesture](gesture.md): Tracks a press on a layer with its drag offset and speed, for animations that follow the finger and fling on release.
- [Delay One Frame](delay1.md): Outputs whatever its input was on the previous frame, for feedback loops and frame-to-frame comparisons.
- [Add](add.md): Adds numbers or vectors together, or joins pieces of text in order.
- [Scroll](scroll.md): Scrolls a content layer inside its parent with momentum, rubber banding, or paging, and outputs the scroll position and page.
- [Drag](drag.md): Lets people drag a layer around and outputs where it should be, with optional bounds, axis lock, and momentum.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Momentum Scrolling (`builtin.momemtumscrolling`)
- **Also imports:** `builtin.momentumScrolling`

| Sonobe port | Origami label |
|---|---|
| `tracking` | Sample Value |
| `stickToBoundaries` | Stick To Boundaries |
