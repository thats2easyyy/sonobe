<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Divide

Divides a value by one or more values, outputting 0 with a warning instead of breaking when you divide by zero.

| | |
|---|---|
| Type key | `divide` |
| Category | [Math](README.md#math) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Shortcut | <kbd>/</kbd> |
| Search terms | ÷, division, quotient, ratio, per, / |

## How it works
Divide starts with **Value 1** and divides it by every input below it: Value 1 ÷ Value 2 ÷ …

- Points, sizes, and other vectors divide each component separately: [300, 90] ÷ [3, 2] is [100, 45].
- Dividing by 0 outputs 0 for that component and shows a warning in the console, so layers don't vanish or fly off screen.
- **Output** is the result.

## Tips
- Normalize: scroll distance ÷ scrollable height gives 0–1 progress.
- Center a layer: (screen width − layer width) ÷ 2.
- Find a grid row: Loop Index ÷ columns, then Round's Rounded Down.

## Coming from Origami
This is Origami's **÷** patch. Origami doesn't document what dividing by zero does; Sonobe outputs 0 and warns.

## Inputs

This patch has no fixed inputs.

### Repeating inputs

**Value 1, Value 2, …** (`value1`, `value2`, …) · `variant` · default `1`

Value 1 is the value to divide; each later value divides the running result.

A patch can have 2 to 32 of these, and a new patch starts with 2.

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `variant` | Value 1 divided by every other value. Components divided by 0 output 0. |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `number` (default), `point`, `point3d`, `point4d`, `size`.

## Examples

### Show a monthly price

```text
layer price text "Price" @16,200 text←label.output
patch monthly divide value1=119.88 value2=12
patch cents round value←monthly.output places=2
patch label add<text>[3] value1="$" value2←cents.rounded value3="/month"
```

## Common mistakes

- The layer suddenly snaps to 0: a divisor reached 0, such as a size before layout or a Counter at 0. Keep the divisor at least 1 with Max, or check it with Greater Than first.
- Scroll progress never reaches 1: dividing by the full content height ignores the part already on screen. Divide by content height minus screen height.

## Pairs well with

- [Multiply](multiply.md): Multiplies values together, for scaling a number, spacing looped layers, or turning 0–1 progress into distance.
- [Round](round.md): Rounds a number to the nearest whole number or decimal place, and also outputs it rounded down and rounded up.
- [Modulo](modulo.md): Outputs the remainder after dividing, for wrapping a count back to 0, finding grid columns, or alternating items.
- [Layer Info](layerInfo.md): Reads a layer's size, position, scale, anchor, and parent as they were laid out on the previous frame.
- [Progress](progress.md): Converts a number from any range into progress, where Start gives 0 and End gives 1.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** ÷ (`builtin.math.div`)

| Sonobe port | Origami label |
|---|---|
| `value1` | Input 1 (unlabeled; the base value) |
| `value2` | Input 2 (unlabeled) |
| `output` | Output (unlabeled) |
