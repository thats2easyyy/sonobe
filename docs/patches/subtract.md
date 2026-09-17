<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Subtract

Subtracts one or more values from a starting value, such as finding how far apart two positions are.

| | |
|---|---|
| Type key | `subtract` |
| Category | [Math](README.md#math) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Shortcut | <kbd>-</kbd> |
| Search terms | −, minus, difference, subtraction, delta, take away |

## How it works
Subtract starts with **Value 1** and takes away every input below it: Value 1 − Value 2 − Value 3 …

- **Value 1** is the starting value. Every other input is subtracted from it, in order.
- Points, sizes, and other vectors subtract each component separately: [100, 80] − [20, 30] is [80, 50].
- **Output** is what's left.

## Tips
- Find how far something moved: current position − start position, with the type set to Point.
- Flip a direction: 0 − value turns 40 into −40.
- Center a layer: screen width − layer width, then Divide by 2.

## Coming from Origami
This is Origami's **−** patch. Its unlabeled inputs are called Value 1, Value 2, and so on.

## Inputs

This patch has no fixed inputs.

### Repeating inputs

**Value 1, Value 2, …** (`value1`, `value2`, …) · `variant` · default `0`

Value 1 is the starting value; each later value is subtracted from the running result.

A patch can have 2 to 32 of these, and a new patch starts with 2.

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `variant` | Value 1 minus every other value. |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `number` (default), `point`, `point3d`, `point4d`, `size`.

## Examples

### Count down from 10

```text
layer timer text "Timer" @16,120 text←whole.roundedUp
patch clock time
patch remaining subtract value1=10 value2←clock.time
patch whole round value←remaining.output
```

## Common mistakes

- The result has the wrong sign: inputs subtract from top to bottom, so Value 1 is the starting value. Swap the wires or reorder the ports.
- A Point result moves on both axes: a plain number wired into a Point subtract becomes [n, n]. Build [n, 0] with a Point patch when you only want one axis.

## Pairs well with

- [Add](add.md): Adds numbers or vectors together, or joins pieces of text in order.
- [Absolute Value](absoluteValue.md): Turns negative values into positive ones, for measuring how far something moved in either direction.
- [Drag](drag.md): Lets people drag a layer around and outputs where it should be, with optional bounds, axis lock, and momentum.
- [Layer Info](layerInfo.md): Reads a layer's size, position, scale, anchor, and parent as they were laid out on the previous frame.
- [Point](point.md): Combines an X and a Y number into one point for a layer's Position, Anchor, Pivot, or any other 2D input.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** − (`builtin.math.sub`)

| Sonobe port | Origami label |
|---|---|
| `value1` | Input 1 (unlabeled; the base value) |
| `value2` | Input 2 (unlabeled) |
| `output` | Output (unlabeled) |
