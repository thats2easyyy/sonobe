<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Sine

Turns an angle in degrees into a smooth wave from -1 to 1, for bobbing, breathing, and circular motion.

| | |
|---|---|
| Type key | `sine` |
| Category | [Math](README.md#math) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | sin, wave, oscillate, oscillator, trigonometry, trig, sine wave, circle y, lfo |

## How it works
Picture a point traveling around a circle with a radius of 1. Sine is the point's vertical distance from the center: 0 at 0°, 1 at 90°, 0 at 180°, and -1 at 270°. As the angle keeps growing, the output rises and falls in a smooth, repeating wave.

- **Angle** is in degrees. 360° is one full wave, and the wave keeps repeating for angles above 360° or below 0°.
- **Output** runs from -1 to 1.

## Tips
- Drive Angle from Time through a Transition with Start 0 and End 360 for one wave per second. A bigger End makes it faster.
- Transition keeps going past its ends, so it maps the output nicely. With Start 1 and End 1.1, an output of -1 to 1 becomes a scale from 0.9 to 1.1.
- For circular motion, pair it with Cosine: x = center + radius × Cosine and y = center + radius × Sine.

## Coming from Origami
Origami's docs don't state the unit. Sonobe uses degrees, like layer Rotation. The `sin()` function inside Math Expression uses radians.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Angle**<br>`angle` | `number` (angle) | `0` | The angle in degrees: 0 gives 0, 90 gives 1, 180 gives 0, and 270 gives -1, repeating every 360. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `number` | The sine of Angle, from -1 to 1. |

## Examples

### Make an orb breathe

Time × 120° per second gives one wave every 3 seconds, and Transition turns -1 to 1 into a scale from 0.92 to 1.08.

```text
layer orb oval "Orb" @151,380 100x100 scale←breathe.output
patch clock time
patch turn transition<number> progress←clock.time start=0 end=120
patch wave sine angle←turn.output
patch breathe transition<number> progress←wave.output start=1 end=1.08
```

### Ripple a wave across a row of dots

Each dot's angle is 45° ahead of its neighbor's, so the fade travels along the row; opacity moves between 0.3 and 1.

```text
layer row group "Row" @40,400 320x24 layout=row spacing=12
  layer dot oval "Dot" 24x24 opacity←glow.output
patch dots loop count=8
patch clock time
patch phase mathExpression expression="angle = t * 360 + i * 45" t←clock.time i←dots.index
patch wave sine angle←phase.angle
patch glow transition<number> progress←wave.output start=0.65 end=1
```

## Common mistakes

- The value barely changes: Angle is in degrees, so a Time value from 0 to 10 covers only 10° of a 360° wave. Scale it up first, for example with a Transition from 0 to 360.
- The motion jumps once per cycle: the angle resets before reaching a multiple of 360, for example a Repeating Animation mapped to 0–180. Map each cycle to 0–360, or drive the angle from Time.
- Values from a formula you copied from code look wrong: most code uses radians. Multiply radians by 57.2958 (180 ÷ π) to get degrees, or use `sin()` in Math Expression.

## Pairs well with

- [Cosine](cosine.md): Turns an angle in degrees into a smooth wave from -1 to 1 that starts at its peak, for swinging and circular motion.
- [Time](time.md): Counts the seconds and frames since the prototype started.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.
- [Loop](loop.md): Makes a loop of indices from 0 up to Count minus 1, so layers and patches repeat once per index.
- [Math Expression](mathExpression.md): Calculates numbers from a formula you type, creating an input for each variable and an output for each result.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Sine (`builtin.math.sin`)
