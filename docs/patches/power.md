<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Power

Raises a value to a power, for squaring numbers, doubling at each step, or bending 0–1 progress into a curve.

| | |
|---|---|
| Type key | `power` |
| Category | [Math](README.md#math) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Search terms | exponent, pow, raise to power, squared, cubed, ^ |

## How it works
Power multiplies **Value 1** by itself **Value 2** times: 2 to the power 3 is 2 × 2 × 2 = 8.

- **Value 1** is the base and **Value 2** is the exponent. Extra inputs raise the result again, in order: (2³)² = 64.
- Exponents can be decimals or negative: 9 to the power 0.5 is 3, and 2 to the power −1 is 0.5.
- Vectors raise each component separately.
- Combinations with no real answer, such as a negative base with a decimal exponent, output 0 and show a warning.

## Tips
- Ease 0–1 progress: progress to the power 2 starts slow; to the power 0.5 starts fast.
- Zoom in doubling steps: 2 to the power of a level gives 1, 2, 4, 8.

## Coming from Origami
This is Origami's **Power** patch. Extra exponent ports chain from left to right.

## Inputs

This patch has no fixed inputs.

### Repeating inputs

**Value 1, Value 2, …** (`value1`, `value2`, …) · `variant` · default `1`

Value 1 is the base; each later value is an exponent applied to the running result.

A patch can have 2 to 32 of these, and a new patch starts with 2.

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `variant` | The base raised to each exponent in turn. |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `number` (default), `point`, `point3d`, `point4d`, `size`.

## Examples

### Pulse a glow that eases in

Cubing the repeating 0–1 progress keeps the glow dim for most of each cycle, then brightens quickly.

```text
layer glow oval "Glow" @145,372 100x100 opacity←ease_in.output
patch wave repeatingAnimation
patch ease_in power value1←wave.progress value2=3
```

## Common mistakes

- −8 to the power 1/3 gives 0 instead of −2: a negative base with a fractional exponent has no real answer here. Take Absolute Value, raise it, then Multiply by −1.
- The curve bends the wrong way: exponents above 1 start slow and end fast. Use an exponent below 1, or the Curve patch, for a fast start.

## Pairs well with

- [Square Root](squareRoot.md): Outputs the square root of a value, for undoing a square, sizing even grids, and working out distances.
- [Multiply](multiply.md): Multiplies values together, for scaling a number, spacing looped layers, or turning 0–1 progress into distance.
- [Repeating Animation](repeatingAnimation.md): Runs a progress value from 0 to 1 over and over, either restarting each time or swinging back and forth.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** Power (`builtin.math.pow`)

| Sonobe port | Origami label |
|---|---|
| `value1` | Input 1 (unlabeled; the base) |
| `value2` | Input 2 (unlabeled; the exponent) |
| `output` | Output (unlabeled) |
