<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Curve

Reshapes a 0–1 progress value with an easing curve, so steady motion speeds up or slows down near the ends.

| | |
|---|---|
| Type key | `curve` |
| Category | [Animation](README.md#animation) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | easing, ease, ease in out, timing function, reshape progress, tween curve, penner easing, slow in slow out |

## How it works
Curve takes a steady **Progress** from 0 to 1 and bends it with an easing curve. The ends stay put (0 stays 0 and 1 stays 1), but in between the value moves faster or slower.

- **Progress** is usually linear: a Repeating Animation set to Linear, Progress from a scroll, or a Time-based ramp.
- **Curve** picks the shape. *In* starts slow, *Out* ends slow, *In & Out* does both. Sinusoidal is the softest, then Quadratic and Cubic, and Exponential is the strongest.
- **Output** is the eased progress. Feed it into Transition to turn it into a position, size, or color.

Outside 0–1 the output continues in a straight line in the direction the curve was heading at the nearest end, so overshoot isn't cut off.

## Tips
- Animating on a state change? Classic Animation already has a Curve input; use this patch when progress comes from somewhere else.
- Need an exact CSS or Figma curve? Use Cubic Bezier Curve.

## Coming from Origami
Origami doesn't document what happens outside 0–1 or which curve is the default. Sonobe extends the curve in straight lines and defaults to Quadratic In & Out.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Progress**<br>`progress` | `number` (progress) | `0` | A steady progress value, usually 0–1; values outside that continue in a straight line. step 0.01. |
| **Curve**<br>`curve` | `enum` | `quadraticInOut` | The easing shape: In starts slow, Out ends slow, In & Out does both, and Linear changes nothing. Options: Linear (`linear`), Quadratic In (`quadraticIn`), Quadratic Out (`quadraticOut`), Quadratic In & Out (`quadraticInOut`), Cubic In (`cubicIn`), Cubic Out (`cubicOut`), Cubic In & Out (`cubicInOut`), Exponential In (`exponentialIn`), Exponential Out (`exponentialOut`), Exponential In & Out (`exponentialInOut`), Sinusoidal In (`sinusoidalIn`), Sinusoidal Out (`sinusoidalOut`), Sinusoidal In & Out (`sinusoidalInOut`). |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `number` (progress) | The eased progress: 0 at 0 and 1 at 1, reshaped in between. |

## Examples

### Make a breathing dot slow down at each end

A linear back-and-forth timebase, eased so the dot lingers at its smallest and largest sizes.

```text
layer dot oval "Dot" @171,400 60x60 scale←grow.output
patch clock repeatingAnimation duration=1.2 curve=linear mirrored=true
patch ease curve progress←clock.progress curve=sinusoidalInOut
patch grow transition<number> progress←ease.output start=1 end=1.3
```

## Common mistakes

- Nothing seems to change: Curve is set to Linear, which leaves progress as it is. Pick an In, Out, or In & Out curve.
- The layer barely moves: Output is still a 0–1 progress wired straight into a position or size. Send it through Transition to map it to real values.

## Pairs well with

- [Repeating Animation](repeatingAnimation.md): Runs a progress value from 0 to 1 over and over, either restarting each time or swinging back and forth.
- [Progress](progress.md): Converts a number from any range into progress, where Start gives 0 and End gives 1.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.
- [Time](time.md): Counts the seconds and frames since the prototype started.
- [Remap](remap.md): Converts a value from one range to another, like turning scroll distance 0–150 into a header height from 120 to 64.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Curve (`builtin.curve`)

| Sonobe port | Origami label |
|---|---|
| `output` | Progress |
