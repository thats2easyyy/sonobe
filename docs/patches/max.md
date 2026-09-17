<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Max

Outputs the largest of its inputs, for keeping a value from dropping below a limit or picking the taller of two sizes.

| | |
|---|---|
| Type key | `max` |
| Category | [Math](README.md#math) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Search terms | maximum, largest, highest, floor limit, lower limit, math.max |

## How it works
Max compares all of its inputs and outputs the largest one.

- Use it as a floor: Max of a value and 0 follows the value but never goes below 0.
- Vectors compare each component separately: Max of [10, 50] and [30, 20] is [30, 50].
- Change the input count to compare up to 32 values.

## Tips
- Need a floor and a ceiling at once? Use Clamp.
- Keep a divisor from reaching 0: Max of the divisor and 1.

## Coming from Origami
This is Origami's **Max** patch. Its unlabeled inputs are called Value 1, Value 2, and so on.

## Inputs

This patch has no fixed inputs.

### Repeating inputs

**Value 1, Value 2, …** (`value1`, `value2`, …) · `variant` · default `0`

A value to compare.

A patch can have 2 to 32 of these, and a new patch starts with 2.

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `variant` | The largest input, compared component by component for vectors. |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `number` (default), `point`, `point3d`, `point4d`, `size`.

## Examples

### Stop a sheet from being dragged too high

Point Max keeps x at 0 or more and y at 120 or more.

```text
layer sheet rectangle "Sheet" @0,400 390x600 cornerRadius=24 position←limit.output
patch pull drag layer=@sheet
patch limit max<point> value1←pull.position value2=[0,120]
```

## Common mistakes

- The value never goes above the number you typed: that's Min. Max sets a floor, so Max of a value and 0 never goes below 0. Use Min for a ceiling, or Clamp for both.

## Pairs well with

- [Min](min.md): Outputs the smallest of its inputs, for capping a value from above or picking the shorter of two sizes.
- [Clamp](clamp.md): Keeps a value between a minimum and a maximum, so scrolling, dragging, or progress can't go past its limits.
- [Drag](drag.md): Lets people drag a layer around and outputs where it should be, with optional bounds, axis lock, and momentum.
- [Subtract](subtract.md): Subtracts one or more values from a starting value, such as finding how far apart two positions are.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** Max (`builtin.math.max`)

| Sonobe port | Origami label |
|---|---|
| `value1` | Input 1 (unlabeled; the base value) |
| `value2` | Input 2 (unlabeled) |
| `output` | Output (unlabeled) |
