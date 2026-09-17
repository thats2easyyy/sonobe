<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Multiply

Multiplies values together, for scaling a number, spacing looped layers, or turning 0–1 progress into distance.

| | |
|---|---|
| Type key | `multiply` |
| Category | [Math](README.md#math) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Shortcut | <kbd>*</kbd> |
| Search terms | ×, times, product, multiplication, scale value, * |

## How it works
Multiply starts with **Value 1** and multiplies it by every input below it: Value 1 × Value 2 × …

- Points, sizes, and other vectors multiply each component separately: [2, 3] × [10, 0] is [20, 0].
- A number wired into a vector Multiply scales every component by that number.
- **Output** is the product.

## Tips
- Turn 0–1 progress into points: progress × 300 moves something 300 pt.
- Reverse a direction with × −1.
- Space looped layers: Loop Index × 120 gives 0, 120, 240, …

## Coming from Origami
This is Origami's **×** patch. Its unlabeled inputs are called Value 1, Value 2, and so on.

## Inputs

This patch has no fixed inputs.

### Repeating inputs

**Value 1, Value 2, …** (`value1`, `value2`, …) · `variant` · default `1`

A value to multiply by. Inputs combine from top to bottom.

A patch can have 2 to 32 of these, and a new patch starts with 2.

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `variant` | The product of all values. |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `number` (default), `point`, `point3d`, `point4d`, `size`.

## Examples

### Slide to the next page on tap

Pop Animation runs 0 → 1; multiplying by [−390, 0] slides the pages one screen to the left.

```text
layer pages group "Pages" @0,0 780x844 position←slide.output
layer next_button rectangle "Next Button" @300,760 74x44 cornerRadius=22
patch tap_next interaction layer=@next_button
patch on_second switch flip←tap_next.tap
patch pop popAnimation number←on_second.on
patch slide multiply<point> value1←pop.output value2=[-390,0]
```

## Common mistakes

- The output is stuck at 0: one input is 0, and anything times 0 is 0. Set multipliers you aren't using to 1, or lower the input count.
- A slide goes the wrong way: positive values move right and down. Multiply by a negative number to move left or up.

## Pairs well with

- [Pop Animation](popAnimation.md): Springs its output toward a target value whenever the target changes, with a feel set by Bounciness and Speed.
- [Loop](loop.md): Makes a loop of indices from 0 up to Count minus 1, so layers and patches repeat once per index.
- [Add](add.md): Adds numbers or vectors together, or joins pieces of text in order.
- [Divide](divide.md): Divides a value by one or more values, outputting 0 with a warning instead of breaking when you divide by zero.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** × (`builtin.math.mul`)

| Sonobe port | Origami label |
|---|---|
| `value1` | Input 1 (unlabeled; the base value) |
| `value2` | Input 2 (unlabeled) |
| `output` | Output (unlabeled) |
