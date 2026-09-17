<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Or

Turns on while at least one of its inputs is on, which also merges several pulses into one cable.

| | |
|---|---|
| Type key | `or` |
| Category | [Logic](README.md#logic) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Shortcut | <kbd>Shift</kbd>+<kbd>O</kbd> |
| Search terms | any true, either, logical or, \|\|, merge pulses, combine taps, disjunction |

## How it works
Or answers "is any of these true right now?" Its output is on while at least one input is on, and off only when every input is off.

- **Value 1, Value 2, …** are on/off values (booleans). Numbers count as on when they're greater than 0. Add inputs to check more conditions.
- **Output** is on while any input is on.

## Tips
- An input accepts only one cable. To let several buttons trigger the same thing, wire each button's Tap into Or and wire Or into the action.
- Combine with And and Not to build rules like "Cancel or the backdrop was tapped, and Send wasn't".
- To check whether any item in a loop is on, use Any instead. Or compares separate inputs at each loop index.

## Coming from Origami
Origami's ports are unnamed. Here they're Value 1, Value 2, and so on, in the same order.

## Inputs

This patch has no fixed inputs.

### Repeating inputs

**Value 1, Value 2, …** (`value1`, `value2`, …) · `boolean` · default `false`

A condition or pulse to combine. Numbers count as on when greater than 0.

A patch can have 2 to 32 of these, and a new patch starts with 2.

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `boolean` | On while at least one input is on; off only when every input is off. |

## Examples

### Close a sheet from Cancel or the backdrop

```text
layer open_button rectangle "Open" @24,120 160x44 cornerRadius=22
layer backdrop colorFill "Backdrop" opacity←sheet_fade.output color=#00000066
layer sheet rectangle "Sheet" @0,520 402x354 cornerRadius=24 opacity←sheet_fade.output
layer cancel text "Cancel" "Cancel" @24,544 opacity←sheet_fade.output
patch tap_open interaction layer=@open_button
patch tap_cancel interaction layer=@cancel
patch tap_backdrop interaction layer=@backdrop
patch close or[2] value1←tap_cancel.tap value2←tap_backdrop.tap
patch sheet_open switch turnOn←tap_open.tap turnOff←close.output
patch sheet_fade popAnimation number←sheet_open.on
```

## Common mistakes

- Or stays on and nothing downstream reacts to a second tap: one of its inputs is a state that's still on (for example Down), so the output never falls back to off. Wire Tap pulses into Or when you want to merge taps.
- Tapping any looped card does nothing: Or checks separate inputs, not the items of a loop. Wire the loop of taps into Any to get one merged result.

## Pairs well with

- [And](and.md): Turns on only while every one of its inputs is on.
- [Not](not.md): Outputs the opposite of an on/off value: on becomes off and off becomes on.
- [Switch](switch.md): Remembers whether something is on or off and changes when it gets a pulse.
- [Interaction](interaction.md): Detects presses and taps on a layer, or anywhere on the screen, and reports where the pointer is.
- [Any](loopAny.md): Turns a loop of on/off values into one value that's on when at least one item is on, like any card being tapped.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** Or (`builtin.logic.or`)

| Sonobe port | Origami label |
|---|---|
| `value1` | Input (port 0) |
| `value2` | Input (port 1) |
