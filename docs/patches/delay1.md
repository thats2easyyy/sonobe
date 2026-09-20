<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Delay One Frame

Outputs whatever its input was on the previous frame, for feedback loops and frame-to-frame comparisons.

| | |
|---|---|
| Type key | `delay1` |
| Category | [State & Time](README.md#state--time) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Search terms | delay 1, previous frame, previous value, last value, feedback, one frame delay, register, z-1 |

## How it works
Delay One Frame outputs what its input was one frame ago. At 60 frames per second that's about 17 ms, too short to see, but it lets a patch look back in time.

- **Value** is the value to remember. Right-click the patch to change its type.
- **Output** is Value as it was on the previous frame. On the very first frame it equals Value, so comparisons don't jump at startup.

In a feedback loop, the first frame has no previous value, so Output is Value's default: one value, even when the loop carries a list. The same goes for any frame where the loop comes back empty.

Use it for:
- **Feedback loops**, where a result feeds back into its own calculation, such as adding a step to last frame's total. A patch can't drive its own input directly, so route the loop through Delay One Frame.
- **Frame-to-frame comparisons**, such as "is this bigger than it was a moment ago?"

## Tips
- Loops that step once per frame run twice as fast on a 120 Hz display. For motion that looks the same everywhere, drive it from Time or an animation patch.
- To measure how fast something changes, use Velocity. To react when it changes, use Pulse on Change.
- For a delay you can see, use Delay.
- A list that goes around a feedback loop starts as one value. If a Loop Select picks from it, set its Out of Range to Use Fallback, so the list can form.

## Coming from Origami
This is Origami's Delay 1. Origami outputs the port's default on the first frame; outside feedback loops, Sonobe outputs the first input value, so you don't need startup workarounds.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Value**<br>`value` | `variant` | `0` | The value to remember. Its type follows the patch's type, which is number by default. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `variant` | Value as it was on the previous frame. On the first frame it equals Value; in a feedback loop it's Value's default instead. |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `number` (default), `boolean`, `text`, `color`, `point`, `point3d`, `point4d`, `size`, `anchor`, `index`, `enum`, `json`, `image`, `video`, `sound`, `gradient`, `shape`, `layerEffect`, `layer`.

## Examples

### Spin a layer with a feedback loop

Each frame adds 3 degrees to last frame's angle. The loop steps per frame, so it spins faster at 120 fps.

```text
layer spinner rectangle "Spinner" @181,420 40x40 rotation←spin.output
patch spin add value1←last_angle.output value2=3
patch last_angle delay1 value←spin.output
```

### Trail a finger by one frame

The faint follower sits where the finger was a frame ago, so it lags visibly during fast drags.

```text
layer screen_area hitArea "Screen Area" @0,0 402x874
layer follower oval "Follower" @0,0 44x44 opacity=0.4 position←trail.output
layer finger_dot oval "Finger Dot" @0,0 44x44 position←touch.position
patch touch interaction layer=@screen_area
patch trail delay1<point> value←touch.position
```

## Common mistakes

- A spinner built from a feedback loop turns twice as fast on some screens: Delay One Frame steps once per frame, and 120 Hz displays run twice as many frames. Drive continuous motion from Time instead.
- A patch's output won't connect to its own input: direct self-loops aren't allowed. Route the value through Delay One Frame so the patch reads last frame's result.
- Nothing visibly waits: one frame is about 17 ms, far too short to see. Use Delay for delays measured in seconds.

## Pairs well with

- [Add](add.md): Adds numbers or vectors together, or joins pieces of text in order.
- [Velocity](velocity.md): Measures how fast a value is changing, in units per second, by comparing it with the previous frame.
- [Sample and Hold](sampleAndHold.md): Captures a value when you tell it to and keeps it, like remembering where a drag started.
- [Interaction](interaction.md): Detects presses and taps on a layer, or anywhere on the screen, and reports where the pointer is.
- [Delay](delay.md): Holds back changes to a value for a set number of seconds, optionally delaying only rises or only falls.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** Delay 1 (`builtin.delay1`)

| Sonobe port | Origami label |
|---|---|
| `value` | Input |
| `output` | Output |
