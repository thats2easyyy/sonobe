<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Square Root

Outputs the square root of a value, for undoing a square, sizing even grids, and working out distances.

| | |
|---|---|
| Type key | `squareRoot` |
| Category | [Math](README.md#math) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Search terms | √, sqrt, root, radical, undo square |

## How it works
Square Root finds the number that, multiplied by itself, gives the input: the square root of 9 is 3.

- **Value** is the number to take the root of. Vectors take the root of each component separately.
- Negative values have no real square root, so they output 0 and show a warning.
- **Output** is the root.

## Tips
- For the distance between two points, subtract them and use Length; it adds the squares for you.
- Lay out N items in a square-ish grid: the square root of N, rounded up, is the column count.

## Coming from Origami
This is Origami's **√** patch.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Value**<br>`value` | `variant` | `0` | The value to take the square root of. Negative values output 0. At least 0. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `variant` | The square root of Value. |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `number` (default), `point`, `point3d`, `point4d`, `size`.

## Examples

### Pick a column count for 12 photos

```text
layer columns_label text "Columns" @16,120 text←columns.roundedUp
patch side squareRoot value=12
patch columns round value←side.output
```

## Common mistakes

- The output stays at 0: the value going in is negative, like a position left of the origin. Take Absolute Value first, or use Length for distances.

## Pairs well with

- [Power](power.md): Raises a value to a power, for squaring numbers, doubling at each step, or bending 0–1 progress into a curve.
- [Length](length.md): Measures how far a number, point, or vector is from zero, such as how far a drag has traveled in any direction.
- [Round](round.md): Rounds a number to the nearest whole number or decimal place, and also outputs it rounded down and rounded up.
- [Multiply](multiply.md): Multiplies values together, for scaling a number, spacing looped layers, or turning 0–1 progress into distance.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** √ (`builtin.math.sqrt`)

| Sonobe port | Origami label |
|---|---|
| `value` | Input (unlabeled) |
| `output` | Output (unlabeled) |
