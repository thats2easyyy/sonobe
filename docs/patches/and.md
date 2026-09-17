<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# And

Turns on only while every one of its inputs is on.

| | |
|---|---|
| Type key | `and` |
| Category | [Logic](README.md#logic) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Shortcut | <kbd>Shift</kbd>+<kbd>A</kbd> |
| Search terms | all true, both, logical and, &&, every, conjunction, gate |

## How it works
And answers "are all of these true right now?" Its output is on only while every input is on. If any input is off, the output is off.

- **Value 1, Value 2, …** are on/off values (booleans). Numbers count as on when they're greater than 0. Add or remove inputs to check more conditions.
- **Output** is on while all inputs are on.

## Tips
- Use And to gate a pulse, a signal that's on for one frame: wire a Tap into Value 1 and a state such as a Switch's On into Value 2. The output flashes on only when the tap happens while the state is on.
- Combine with Not for "this, but not that" conditions.
- To check whether every item in a loop is on, use All instead. And compares separate inputs at each loop index.

## Coming from Origami
Origami's ports are unnamed. Here they're Value 1, Value 2, and so on, in the same order.

## Inputs

This patch has no fixed inputs.

### Repeating inputs

**Value 1, Value 2, …** (`value1`, `value2`, …) · `boolean` · default `false`

A condition to check. Numbers count as on when greater than 0.

A patch can have 2 to 32 of these, and a new patch starts with 2.

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `boolean` | On while every input is on; off as soon as any input is off. |

## Examples

### Like a photo only while it's open

Tapping the photo opens it; the heart only toggles while the photo is open.

```text
layer photo rectangle "Photo" @0,160 402x402
layer heart oval "Heart" @24,580 36x36 color←heart_color.output
patch tap_photo interaction layer=@photo
patch expanded switch flip←tap_photo.tap
patch tap_heart interaction layer=@heart
patch can_like and[2] value1←tap_heart.tap value2←expanded.on
patch liked switch flip←can_like.output
patch heart_color transition<color> progress←liked.on start=#D9D9D9FF end=#FF3B5CFF
```

## Common mistakes

- The output never turns on when you tap: you wired two taps into And, and two taps almost never land on the same frame. Wire one tap and one state (Down, or a Switch's On) instead.
- A patch fed by And fires once and then ignores the next tap: its input still reads on because the state input is held on and the tap came on the very next frame. Put a Pulse patch (Turned On) after And, or gate with a state that turns off between taps.

## Pairs well with

- [Or](or.md): Turns on while at least one of its inputs is on, which also merges several pulses into one cable.
- [Not](not.md): Outputs the opposite of an on/off value: on becomes off and off becomes on.
- [Switch](switch.md): Remembers whether something is on or off and changes when it gets a pulse.
- [Interaction](interaction.md): Detects presses and taps on a layer, or anywhere on the screen, and reports where the pointer is.
- [Greater Than](greaterThan.md): Checks whether a value is greater than another, such as a drag passing a threshold or a timer passing a time.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** And (`builtin.logic.and`)

| Sonobe port | Origami label |
|---|---|
| `value1` | Input (port 0) |
| `value2` | Input (port 1) |
