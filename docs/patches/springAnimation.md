<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Spring Animation

Animates toward a target with a physical spring defined by mass, tension, and friction, and can continue a thrown gesture's velocity.

| | |
|---|---|
| Type key | `springAnimation` |
| Category | [Animation](README.md#animation) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Search terms | physics spring, mass tension friction, stiffness damping, interruptible animation, throw, fling, gesture spring, interpolating spring |

## How it works
Spring Animation moves its output toward **Number** with a physically modeled spring. It's the same kind of spring as Pop Animation, but you set the physics directly, and it can pick up where your finger left off.

- **Number** is the target. When it changes, the output springs toward it and keeps its momentum.
- **Tension** is the spring's stiffness. Higher values pull harder and move faster.
- **Friction** is the damping. Low friction bounces; high friction settles slowly without bouncing.
- **Mass** is the weight being moved. Heavier springs are slower and swing more. Leave it at 1 unless you're matching code.
- **Gesture Active**: while it's on, the output follows Number exactly, so the layer sticks to the finger. When it turns off, the spring takes over.
- **Gesture Velocity** is the finger's speed in points per second. The spring uses it at the moment Gesture Active turns off, so a throw carries on naturally.

## Tips
- Wire a Gesture's Down into Gesture Active and its Velocity into Gesture Velocity for a sheet or card you can fling.
- Don't want to tune numbers? Wire a Spring Preset's Mass, Tension, and Friction outputs into this patch.
- Right-click to animate a point, size, color, or other value directly.

## Coming from Origami
Tension and Friction are raw stiffness and damping (the values SwiftUI and CSS spring libraries use), not Pop's Origami-scale tension and friction.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Number**<br>`number` | `variant` | `0` | The target value. The output springs toward it whenever it changes. |
| **Mass**<br>`mass` | `number` | `1` | The weight being moved. Heavier springs move slower and swing further; 1 is standard. At least 0.01, step 0.1. |
| **Tension**<br>`tension` | `number` | `130.51` | Spring stiffness. Higher values pull toward the target harder and faster; 0 means no pull at all. At least 0, step 1. |
| **Friction**<br>`friction` | `number` | `18.85` | Damping that slows the motion. 0 bounces forever; higher values settle with less bounce. At least 0, step 0.5. |
| **Gesture Active**<br>`gestureActive` | `boolean` | `false` | While on, the output follows Number exactly. When it turns off, the spring takes over using Gesture Velocity. |
| **Gesture Velocity**<br>`gestureVelocity` | `variant` (velocity) | `0` | The gesture's speed in points per second, sampled at the moment Gesture Active turns off. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `variant` | The current animated value, the same type as Number. |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `number` (default), `point`, `point3d`, `point4d`, `size`, `anchor`, `color`.

## Examples

### Fling a card and let it spring home

The card follows the finger while dragging, then springs back with the throw's momentum.

```text
layer card rectangle "Card" @16,500 358x220 position←fling.output
patch drag_card gesture layer=@card
patch follow add<point>[2] value1=[16,500] value2←drag_card.translation
patch where optionPicker<point>[2] option←drag_card.down option0=[16,500] option1←follow.output
patch fling springAnimation<point> number←where.output gestureActive←drag_card.down gestureVelocity←drag_card.velocity tension=200 friction=22
```

### Toggle a switch knob with a Snappy spring

```text
layer knob oval "Knob" @4,4 28x28 position←slide.output
patch tap_knob interaction layer=@knob
patch toggle switch flip←tap_knob.tap
patch feel springPreset preset=snappy
patch spring springAnimation number←toggle.on mass←feel.mass tension←feel.tension friction←feel.friction
patch slide transition<point> progress←spring.output start=[4,4] end=[24,4]
```

## Common mistakes

- The thrown layer stops dead when you let go: Gesture Velocity is 0 on the release frame, often because it comes from a Velocity patch on a position that stopped changing. Wire the Gesture patch's Velocity output instead.
- The layer lags behind your finger while dragging: Gesture Active isn't connected, so the spring animates toward the finger instead of tracking it. Wire the gesture's Down into Gesture Active.
- It barely moves or wobbles forever: Tension and Friction use raw physics units, so Pop Animation's small numbers (like 5 and 10) feel very different here. Start from the defaults or a Spring Preset.

## Pairs well with

- [Gesture](gesture.md): Tracks a press on a layer with its drag offset and speed, for animations that follow the finger and fling on release.
- [Spring Preset](springPreset.md): Picks a named spring feel, like Snappy or Bouncy, and outputs matching values for every kind of spring patch.
- [Switch](switch.md): Remembers whether something is on or off and changes when it gets a pulse.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.
- [Velocity](velocity.md): Measures how fast a value is changing, in units per second, by comparing it with the previous frame.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** Spring Animation (`builtin.springanimation`)
- **Also imports:** `builtin.springAnimation`
