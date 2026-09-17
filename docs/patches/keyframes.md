<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Keyframes

Maps a progress value through several keyframes, each a stop and a value, like a timeline driven by any number.

| | |
|---|---|
| Type key | `keyframes` |
| Category | [Animation](README.md#animation) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | driver, multi-stop transition, timeline, piecewise, usetransform, multi-stop progress, stops, interpolate, keyframe |

## How it works
Keyframes is a Transition with as many stops as you need. Each keyframe pairs a **Stop**, a position along Progress, with a **Value**. As Progress moves from one stop to the next, the output blends between their values.

- **Progress** can be anything that changes smoothly: a Repeating Animation, an animation of a switch, a scroll offset, or Time. Stops use the same units, so a header can fade between scroll offsets 0, 120, and 300.
- **Stop 1…N** and **Value 1…N** are the keyframes. Add or remove keyframes on the patch (2 to 32), and keep stops in increasing order.
- **Curve** eases every segment between neighboring keyframes.
- **Extrapolate**: off holds the first and last values beyond the ends; on continues the first and last segments.
- **Output** works on numbers, points, sizes, and colors.

## Tips
- Two keyframes at the same stop make an instant jump there; the later one wins.
- To hold a value for a while, give two neighboring keyframes the same value.
- Drive several Keyframes patches from one Progress to animate opacity, scale, and position on a shared timeline.

## Inputs

This patch adds ports based on how it's set up, so these tables list only the ports it always has.

| Input | Type | Default | Description |
|---|---|---|---|
| **Progress**<br>`progress` | `number` | `0` | Where you are along the keyframes, in the same units as the stops (0–1 by default, or points, seconds, and so on). step 0.01. |
| **Curve**<br>`curve` | `enum` | `linear` | The easing applied within every segment between neighboring keyframes. Options: Linear (`linear`), Quadratic In (`quadraticIn`), Quadratic Out (`quadraticOut`), Quadratic In & Out (`quadraticInOut`), Cubic In (`cubicIn`), Cubic Out (`cubicOut`), Cubic In & Out (`cubicInOut`), Exponential In (`exponentialIn`), Exponential Out (`exponentialOut`), Exponential In & Out (`exponentialInOut`), Sinusoidal In (`sinusoidalIn`), Sinusoidal Out (`sinusoidalOut`), Sinusoidal In & Out (`sinusoidalInOut`). |
| **Extrapolate**<br>`extrapolate` | `boolean` · advanced | `false` | When on, progress beyond the first or last stop continues that end segment instead of holding its value. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `variant` | The value blended from the keyframes around the current Progress. |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `number` (default), `point`, `point3d`, `point4d`, `size`, `anchor`, `color`.

## Examples

### Fade a badge in, hold it, and fade it out on a loop

```text
layer badge rectangle "Badge" @151,380 100x100 opacity←fade.output
patch clock repeatingAnimation duration=2 curve=linear
patch fade keyframes[4] progress←clock.progress curve=quadraticInOut stop1=0 value1=0 stop2=0.2 value2=1 stop3=0.8 value3=1 stop4=1 value4=0
```

### Pulse a heart through three sizes when liked

One linear animation drives a grow, squash, and settle sequence.

```text
layer heart oval "Heart" @171,400 60x60 scale←sizes.output
patch tap_heart interaction layer=@heart
patch liked switch flip←tap_heart.tap
patch anim classicAnimation number←liked.on duration=0.6 curve=linear
patch sizes keyframes[4] progress←anim.output curve=sinusoidalInOut stop1=0 value1=1 stop2=0.3 value2=1.35 stop3=0.6 value3=0.9 stop4=1 value4=1
```

## Common mistakes

- The output stays at the first value: Progress uses different units than the stops, for example a 0–1 animation against stops at 0, 120, and 300. Use the same units for both.
- A keyframe is skipped or jumps: its stop is lower than the one before it, so it's pushed up to that stop. Keep stops in increasing order.
- The output stops changing past the last keyframe: values hold beyond the first and last stops. Turn on Extrapolate to keep going.

## Pairs well with

- [Repeating Animation](repeatingAnimation.md): Runs a progress value from 0 to 1 over and over, either restarting each time or swinging back and forth.
- [Classic Animation](classicAnimation.md): Animates toward a target value over a set duration with an easing curve whenever the target changes.
- [Progress](progress.md): Converts a number from any range into progress, where Start gives 0 and End gives 1.
- [Scroll](scroll.md): Scrolls a content layer inside its parent with momentum, rubber banding, or paging, and outputs the scroll position and page.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

Sonobe-native: Origami has no matching patch.
