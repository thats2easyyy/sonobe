<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Repeating Animation

Runs a progress value from 0 to 1 over and over, either restarting each time or swinging back and forth.

| | |
|---|---|
| Type key | `repeatingAnimation` |
| Category | [Animation](README.md#animation) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Search terms | repeating motion, loop animation, infinite animation, ping pong, yoyo, oscillate, spinner, pulse animation, breathing |

## How it works
Repeating Animation outputs a **Progress** value that keeps cycling while it's enabled, shaped by an easing curve. It's the engine behind spinners, loading pulses, and gently breathing buttons.

- **Enabled**: while on, the animation runs. Turning it off pauses it where it is; turning it back on continues.
- **Duration** is the time for one trip from 0 to 1, in seconds.
- **Curve** is the easing applied to each trip.
- **Mirrored**: when on, progress swings 0 → 1 → 0 smoothly, and the way back is the way there played in reverse. When off, it jumps back to 0 after reaching 1, which suits spinners.
- **Reset** is a pulse (a signal that lasts one frame) that returns the animation to the beginning.
- **Time Offset** (advanced) shifts where in the cycle this animation is, in seconds, so copies in a loop can run out of step.

## Tips
- Spinner: Linear curve, Mirrored off, into a Transition from 0 to 360 on Rotation.
- Breathing: Sinusoidal In & Out, Mirrored on, into a Transition from 1 to 1.05 on Scale.
- Wire a state like "loading" into Enabled, and the same event into Reset, so each run starts fresh.

## Coming from Origami
Enable is named Enabled. Time Offset is new. Origami's default curve and mirrored behavior are undocumented; the return leg here mirrors the forward leg.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Enabled**<br>`enabled` | `boolean` | `true` | While on, the animation runs. Off pauses it and holds the current progress. |
| **Duration**<br>`duration` | `number` (duration) | `1` | Seconds for one trip from 0 to 1. 0 stops the animation at the start. At least 0, step 0.05. |
| **Curve**<br>`curve` | `enum` | `quadraticInOut` | The easing applied to each trip. Use Linear for steady spinning. Options: Linear (`linear`), Quadratic In (`quadraticIn`), Quadratic Out (`quadraticOut`), Quadratic In & Out (`quadraticInOut`), Cubic In (`cubicIn`), Cubic Out (`cubicOut`), Cubic In & Out (`cubicInOut`), Exponential In (`exponentialIn`), Exponential Out (`exponentialOut`), Exponential In & Out (`exponentialInOut`), Sinusoidal In (`sinusoidalIn`), Sinusoidal Out (`sinusoidalOut`), Sinusoidal In & Out (`sinusoidalInOut`). |
| **Mirrored**<br>`mirrored` | `boolean` | `true` | When on, progress swings back and forth between 0 and 1. When off, it jumps back to 0 after reaching 1. |
| **Reset**<br>`reset` | `pulse` | — | Pulse to return the animation to the beginning. |
| **Time Offset**<br>`timeOffset` | `number` (duration) · advanced | `0` | Seconds added to where the animation is in its cycle, so looped copies can run out of step. 0 means no offset. step 0.05. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Progress**<br>`progress` | `number` (progress) | The repeating progress value, always between 0 and 1. |

## Examples

### Spin a loading indicator

```text
layer spinner shape "Spinner" @181,420 40x40 rotation←spin.output
patch turn repeatingAnimation duration=0.8 curve=linear mirrored=false
patch spin transition<number> progress←turn.progress start=0 end=360
```

### Make a button breathe while it waits

```text
layer button rectangle "Button" @111,700 180x56 scale←breathe.output
patch cycle repeatingAnimation duration=1.2 curve=sinusoidalInOut mirrored=true
patch breathe transition<number> progress←cycle.progress start=1 end=1.05
```

## Common mistakes

- The spinner stutters once per turn: Mirrored is on, or the Curve eases in and out, so it slows down and reverses. Turn Mirrored off and use Linear.
- The loader picks up halfway through when it reappears: turning Enabled off pauses instead of resetting. Send the same event into Reset so each run starts at 0.

## Pairs well with

- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.
- [Switch](switch.md): Remembers whether something is on or off and changes when it gets a pulse.
- [Wait](wait.md): Starts a timer on a pulse and turns Done on once the duration has passed, reporting progress along the way.
- [Loop](loop.md): Makes a loop of indices from 0 up to Count minus 1, so layers and patches repeat once per index.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** Repeating Animation (`builtin.repeatingmotion`)
- **Also imports:** `builtin.repeatingMotion`

| Sonobe port | Origami label |
|---|---|
| `enabled` | Enable |
