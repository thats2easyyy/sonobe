<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Min

Outputs the smallest of its inputs, for capping a value from above or picking the shorter of two sizes.

| | |
|---|---|
| Type key | `min` |
| Category | [Math](README.md#math) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Search terms | minimum, smallest, lowest, cap, upper limit, math.min |

## How it works
Min compares all of its inputs and outputs the smallest one.

- Use it as a ceiling: Min of a value and 300 follows the value but never goes above 300.
- Vectors compare each component separately: Min of [10, 50] and [30, 20] is [10, 20].
- Change the input count to compare up to 32 values.

## Tips
- Need a floor and a ceiling at once? Use Clamp.
- Size a card to the smaller of its content height and the screen height.

## Coming from Origami
This is Origami's **Min** patch. Its unlabeled inputs are called Value 1, Value 2, and so on.

## Inputs

This patch has no fixed inputs.

### Repeating inputs

**Value 1, Value 2, …** (`value1`, `value2`, …) · `variant` · default `0`

A value to compare.

A patch can have 2 to 32 of these, and a new patch starts with 2.

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `variant` | The smallest input, compared component by component for vectors. |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `number` (default), `point`, `point3d`, `point4d`, `size`.

## Examples

### Count up, but stop at 99

```text
layer badge text "Badge" @16,120 text←capped.output
patch clock time
patch seconds round value←clock.time
patch capped min value1←seconds.roundedDown value2=99
```

## Common mistakes

- The value never drops below the number you typed: that's Max. Min caps from above, so Min of a value and 300 never goes over 300. Use Max for a floor, or Clamp for both.

## Pairs well with

- [Max](max.md): Outputs the largest of its inputs, for keeping a value from dropping below a limit or picking the taller of two sizes.
- [Clamp](clamp.md): Keeps a value between a minimum and a maximum, so scrolling, dragging, or progress can't go past its limits.
- [Layer Info](layerInfo.md): Reads a layer's size, position, scale, anchor, and parent as they were laid out on the previous frame.
- [Add](add.md): Adds numbers or vectors together, or joins pieces of text in order.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** Min (`builtin.math.min`)

| Sonobe port | Origami label |
|---|---|
| `value1` | Input 1 (unlabeled; the base value) |
| `value2` | Input 2 (unlabeled) |
| `output` | Output (unlabeled) |
