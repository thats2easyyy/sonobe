<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Less Than

Checks whether a value is less than another, such as a scroll pulled past the top or an item before the current one.

| | |
|---|---|
| Type key | `lessThan` |
| Category | [Logic](README.md#logic) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Shortcut | <kbd><</kbd> |
| Search terms | smaller than, fewer than, below, under, threshold, pull to refresh, < |

## How it works
Less Than turns on while Value 1 is smaller than Value 2. Use it to react when a value drops under a threshold: a list pulled down past the top, a countdown under 10, an item that comes before the current one.

- **Value 1** is the value you're checking. **Value 2** is the threshold.
- Add more values to check a chain: with three values, the output is on only when Value 1 < Value 2 < Value 3, which checks that Value 2 sits strictly between the other two.
- Equal values don't count as less. Use Less Than or Equal when the threshold itself should count.
- **Output** is on while the whole chain holds.

## Tips
- Negative thresholds are common for overscroll: a scroll position less than −80 means the list was pulled down 80 points.
- Compare a Loop's Index with the current item to style earlier items differently from later ones.

## Coming from Origami
Origami's ports are unnamed. Here they're Value 1, Value 2, and so on, in the same order and with the same chain rule.

## Inputs

This patch has no fixed inputs.

### Repeating inputs

**Value 1, Value 2, …** (`value1`, `value2`, …) · `variant` · default `0`

A value in the chain; each one must be less than the next.

A patch can have 2 to 32 of these, and a new patch starts with 2.

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `boolean` | On while each value is less than the next one. |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `number` (default), `index`, `boolean`.

## Examples

### Fill the story segments you've already watched

In a real story, wire Value 2 to your current-story index.

```text
layer segments_row group "Segments" @16,56 370x3 layout=row spacing=4
  layer segment rectangle "Segment" 89x3 cornerRadius=1.5 color←segment_color.output
patch segments loop count=4
patch watched lessThan<index>[2] value1←segments.index value2=2
patch segment_color transition<color> progress←watched.output start=#FFFFFF59 end=#FFFFFFFF
```

## Common mistakes

- Pull to refresh never triggers: the threshold is positive, but pulling down past the top gives a negative scroll position. Use a negative threshold such as −80.
- The first item is never highlighted: Less Than is strict, so index 0 isn't less than 0. Use Less Than or Equal, or raise the threshold by 1.

## Pairs well with

- [Greater Than](greaterThan.md): Checks whether a value is greater than another, such as a drag passing a threshold or a timer passing a time.
- [And](and.md): Turns on only while every one of its inputs is on.
- [Switch](switch.md): Remembers whether something is on or off and changes when it gets a pulse.
- [Loop](loop.md): Makes a loop of indices from 0 up to Count minus 1, so layers and patches repeat once per index.
- [In Range](inRange.md): Checks whether a number lies between a minimum and a maximum, and tells you if it's below or above instead.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** Less Than (`builtin.compare.lt`)

| Sonobe port | Origami label |
|---|---|
| `value1` | Input (port 0, base value) |
| `value2` | Input (port 1) |
