<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Smooth Value

Smooths a changing number over time, so noisy or jumpy values glide toward their latest value.

| | |
|---|---|
| Type key | `smoothValue` |
| Category | [Animation](README.md#animation) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Search terms | smoothing, low pass filter, damping, ease toward, lerp toward, exponential smoothing, hysteresis, denoise, lazy follow |

## How it works
Smooth Value follows **Value**, but only moves part of the way there each frame, so sudden jumps turn into glides and jittery input steadies. It has no fixed duration: the farther the value is, the faster it catches up.

- **Value** is the number to smooth, like a sound level, a sensor reading, or a finger position.
- **Rising Hysteresis** (0–1) sets how much smoothing applies when Value goes up. 0 follows instantly; 0.9 is slow and silky; 1 never moves.
- **Falling Hysteresis** sets the smoothing when Value goes down. The default of -1 uses the rising amount, so smoothing is the same both ways.
- **Reset** is a pulse (a signal that lasts one frame) that jumps the output straight to Value.

## Tips
- Meters look natural with a fast rise and slow fall: Rising 0.2, Falling 0.9.
- For a cursor-follower effect, smooth a pointer position with Rising around 0.85.
- Need a target to animate with overshoot and settle? Use Pop Animation instead.

## Coming from Origami
The output is named Output instead of Progress. Smoothing is scaled by frame time, so it looks the same at 60 and 120 fps; at 60 fps it matches Origami's per-frame formula exactly.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Value**<br>`value` | `number` | `0` | The number to smooth. |
| **Rising Hysteresis**<br>`risingHysteresis` | `number` | `0.4` | How much to smooth while Value goes up, 0–1. 0 follows instantly; values near 1 glide slowly. Range 0 to 1, step 0.01. |
| **Falling Hysteresis**<br>`fallingHysteresis` | `number` | `-1` | How much to smooth while Value goes down, 0–1. -1 uses Rising Hysteresis for both directions. Range -1 to 1, step 0.01. |
| **Reset**<br>`reset` | `pulse` | — | Pulse to jump the output straight to Value. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `number` | The smoothed value, gliding toward Value. |

## Examples

### A slider thumb that glides after your finger

```text
layer track rectangle "Track" @16,420 370x8
layer thumb oval "Thumb" @16,404 40x40 position←spot.output
patch touch_track interaction layer=@track
patch lazy smoothValue value←touch_track.position risingHysteresis=0.85
patch spot point x←lazy.output y=404
```

## Common mistakes

- The output never reaches the value or barely moves: a hysteresis of 1 (or very close) freezes it. Try 0.8–0.95 for strong smoothing.
- Values still look jittery: a hysteresis near 0 passes the noise straight through. Raise Rising Hysteresis, and set Falling Hysteresis to -1 so falls are smoothed too.

## Pairs well with

- [Velocity](velocity.md): Measures how fast a value is changing, in units per second, by comparing it with the previous frame.
- [Interaction](interaction.md): Detects presses and taps on a layer, or anywhere on the screen, and reports where the pointer is.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.
- [Progress](progress.md): Converts a number from any range into progress, where Start gives 0 and End gives 1.
- [Device Motion](deviceMotion.md): Reads how a phone is tilted, moving, and rotating, for tilt effects, parallax, and shake gestures.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** Smooth Value (`builtin.smoothvalue`)
- **Also imports:** `builtin.smoothValue`

| Sonobe port | Origami label |
|---|---|
| `output` | Progress |
