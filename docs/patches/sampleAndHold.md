<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Sample and Hold

Captures a value when you tell it to and keeps it, like remembering where a drag started.

| | |
|---|---|
| Type key | `sampleAndHold` |
| Category | [State & Time](README.md#state--time) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Search terms | latch, track and hold, store value, remember value, capture value, freeze value, hold, memory |

## How it works
Sample and Hold remembers a value. While **Sample** is on, **Output** follows **Value**. When Sample turns off, Output keeps the last value until you sample again.

- Wire a pulse (a signal that lasts one frame), such as a Tap, into Sample to capture one moment.
- Wire a state, such as Down, into Sample to follow Value for as long as that state is on.
- **Reset** clears the stored value back to empty: 0 for numbers, empty text, a transparent color. Before anything is sampled, Output is empty too.
- If Reset and Sample happen in the same frame, the sample wins.

Change the patch's type to store text, colors, points, images, and more.

## Tips
- To let a drag continue from where a layer was, sample its position when the finger goes down and add the finger's movement.
- Pair it with Time to record when something happened.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Value**<br>`value` | `variant` | `0` | The value to capture. Its type follows the patch's type. |
| **Sample**<br>`sample` | `boolean` | `false` | While true, Output follows Value; when false, Output keeps the last sampled value. Wire a pulse to capture a single frame. |
| **Reset**<br>`reset` | `pulse` | — | Pulse to clear the stored value back to empty: 0, empty text, a transparent color, or nothing. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `variant` | The stored value: the last value captured while Sample was true. |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `number` (default), `boolean`, `text`, `color`, `point`, `point3d`, `point4d`, `size`, `anchor`, `index`, `enum`, `json`, `image`, `video`, `sound`, `gradient`, `shape`, `layerEffect`, `layer`.

## Examples

### Record the time of the last tap

```text
layer screen rectangle "Screen" @0,0 390x844
layer stamp text "Last Tap" @24,80 text←last_tap.output
patch clock time
patch tap_screen interaction layer=@screen
patch last_tap sampleAndHold value←clock.time sample←tap_screen.tap
```

### Drop a marker where you tap, and clear it

On the tap frame, Position still holds where the finger lifted, so the sample captures the landing point.

```text
layer canvas rectangle "Canvas" @0,0 390x780
layer clear_button rectangle "Clear" @16,790 120x44
layer marker oval "Marker" 24x24 anchor=[0.5,0.5] position←landed.output
patch touch interaction layer=@canvas
patch tap_clear interaction layer=@clear_button
patch landed sampleAndHold<point> value←touch.position sample←touch.tap reset←tap_clear.tap
```

## Common mistakes

- Output keeps following the input instead of holding it: Sample is wired to a state such as Down, which samples on every frame it's on. Wire a pulse such as Tap, or a Pulse's Turned On, to capture a single moment.
- Output is 0 until the first touch: nothing has been sampled yet. Wire When Prototype Starts into Sample to capture a starting value at launch.

## Pairs well with

- [Interaction](interaction.md): Detects presses and taps on a layer, or anywhere on the screen, and reports where the pointer is.
- [Pulse](pulse.md): Turns an on/off state into pulses: one the moment it turns on and another the moment it turns off.
- [Time](time.md): Counts the seconds and frames since the prototype started.
- [Gesture](gesture.md): Tracks a press on a layer with its drag offset and speed, for animations that follow the finger and fling on release.
- [Any](loopAny.md): Turns a loop of on/off values into one value that's on when at least one item is on, like any card being tapped.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** Sample and Hold (`builtin.sample`)
