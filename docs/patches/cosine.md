<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Cosine

Turns an angle in degrees into a smooth wave from -1 to 1 that starts at its peak, for swinging and circular motion.

| | |
|---|---|
| Type key | `cosine` |
| Category | [Math](README.md#math) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | cos, wave, oscillate, swing, trigonometry, trig, cosine wave, circle x |

## How it works
Picture a point traveling around a circle with a radius of 1. Cosine is the point's horizontal distance from the center: 1 at 0°, 0 at 90°, -1 at 180°, and 0 at 270°. It's the same wave as Sine, a quarter turn earlier, so it starts at its peak.

- **Angle** is in degrees. 360° is one full wave, and the wave keeps repeating for angles above 360° or below 0°.
- **Output** runs from -1 to 1.

## Tips
- Use Cosine when motion should start at its farthest point, like a pendulum let go from one side.
- For circular motion, x = center + radius × Cosine and y = center + radius × Sine. Y points down on screen, so growing angles move clockwise, the same direction as layer Rotation.
- To arrange loop items in a ring, give each one an angle of index × 360 ÷ count.

## Coming from Origami
Origami's docs don't state the unit. Sonobe uses degrees, like layer Rotation. The `cos()` function inside Math Expression uses radians.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Angle**<br>`angle` | `number` (angle) | `0` | The angle in degrees: 0 gives 1, 90 gives 0, 180 gives -1, and 270 gives 0, repeating every 360. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `number` | The cosine of Angle, from -1 to 1. |

## Examples

### Rock a bell back and forth

Time × 360° per second through Cosine swings the bell from 15° to -15° and back once per second, starting at its farthest point.

```text
layer bell rectangle "Bell" @171,400 48x48 cornerRadius=12 rotation←swing.output
patch clock time
patch turn transition<number> progress←clock.time start=0 end=360
patch rock cosine angle←turn.output
patch swing transition<number> progress←rock.output start=0 end=15
```

## Common mistakes

- The layer starts pushed to one side instead of at rest: Cosine is 1 at 0°, not 0. Use Sine when the motion should start from the middle.
- The value barely changes: Angle is in degrees, so a Time value from 0 to 10 covers only 10° of a 360° wave. Scale it up first, for example with a Transition from 0 to 360.
- Items in a ring leave a gap or overlap: the angle step was based on count - 1. Space items by index × 360 ÷ count, because 0° and 360° are the same spot.

## Pairs well with

- [Sine](sine.md): Turns an angle in degrees into a smooth wave from -1 to 1, for bobbing, breathing, and circular motion.
- [Arctangent](arctangent.md): Measures the direction of an X and Y offset as an angle in degrees, so a layer can point toward a finger or another layer.
- [Time](time.md): Counts the seconds and frames since the prototype started.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.
- [Loop](loop.md): Makes a loop of indices from 0 up to Count minus 1, so layers and patches repeat once per index.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Cosine (`builtin.math.cos`)
