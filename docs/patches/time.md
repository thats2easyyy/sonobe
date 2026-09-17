<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Time

Counts the seconds and frames since the prototype started.

| | |
|---|---|
| Type key | `time` |
| Category | [State & Time](README.md#state--time) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Search terms | clock, elapsed time, seconds, frame count, timebase, time since start, ticks |

## How it works
Time is the prototype's clock. It counts up from 0 when the prototype starts and goes back to 0 when you restart the prototype.

- **Enabled** freezes the outputs while off. When it's turned back on, the outputs jump to the current prototype time, because the clock itself never stops.
- **Time** is seconds since the prototype started, with fractions: 1.5 means a second and a half.
- **Frame** counts frames since the start, from 0. It's about Time × 60 on a 60 Hz display and Time × 120 on a 120 Hz display.

## Tips
- Drive endless motion from Time: wire it through Math Expression into Rotation for a spinner that turns at the same speed on every display.
- Wire Time into Progress for a timeline that runs from the moment the prototype starts.
- For a clock you can pause and reset, use Stopwatch. For a one-time countdown, use Wait. For the time of day, use Device Time.
- Turn Enabled off when nothing on screen needs the clock.

## Coming from Origami
Origami's Enable port is called Enabled here.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Enabled**<br>`enabled` | `boolean` | `true` | When on, the outputs follow the prototype clock. When off, they hold their last values. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Time**<br>`time` | `number` (duration) | Seconds since the prototype started, from 0, with fractions. |
| **Frame**<br>`frame` | `index` | Frames since the prototype started, from 0. About Time × 60 at 60 fps and Time × 120 at 120 fps. |

## Examples

### Spin a loading indicator forever

One full turn per second, at the same speed on every display.

```text
layer spinner rectangle "Spinner" @181,420 40x40 rotation←spin_angle.angle
patch clock time
patch spin_angle mathExpression expression="angle = t * 360" t←clock.time
```

### Fade in a title over the first 2 seconds

```text
layer intro_title text "Intro Title" @16,120 text="Welcome" opacity←fade_in.progress
patch clock time
patch fade_in progress value←clock.time start=0 end=2
```

## Common mistakes

- An animation driven by Time never stops or starts over: Time always counts up from prototype start. Use Stopwatch when you need pause and reset, or Wait's Progress for a one-time run.
- Motion runs at different speeds on different screens: it's driven by Frame, which counts twice as fast on 120 Hz displays. Use Time, which is in seconds.

## Pairs well with

- [Stopwatch](stopwatch.md): Measures elapsed seconds that you can start, pause, and reset with pulses.
- [Math Expression](mathExpression.md): Calculates numbers from a formula you type, creating an input for each variable and an output for each result.
- [Progress](progress.md): Converts a number from any range into progress, where Start gives 0 and End gives 1.
- [Sample and Hold](sampleAndHold.md): Captures a value when you tell it to and keeps it, like remembering where a drag started.
- [Format Date & Time](formatDateTime.md): Turns seconds into readable text: a clock time, a date, a media timestamp like 2:05, or your own % pattern.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** Time (`builtin.time`)

| Sonobe port | Origami label |
|---|---|
| `enabled` | Enable |
