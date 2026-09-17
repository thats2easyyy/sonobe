<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Add

Adds numbers or vectors together, or joins pieces of text in order.

| | |
|---|---|
| Type key | `add` |
| Category | [Math](README.md#math) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Shortcut | <kbd>+</kbd> |
| Search terms | +, plus, sum, addition, join text, concatenate, combine, offset |

## How it works
Add combines all of its inputs into one result, working from top to bottom.

- **Value 1, Value 2, …** are the values to add. Change the input count to add up to 32 values.
- Points, sizes, and other vectors add each component separately: [10, 20] + [5, 5] is [15, 25].
- Set the type to **Text** to join text instead. "Hello, " + "Sam" is "Hello, Sam". Numbers wired into a text Add turn into text.
- **Output** is the sum, or the joined text.

## Tips
- Space out looped layers: Multiply a Loop's Index by the row height, then Add a top margin.
- Order only matters for text. For numbers, 2 + 3 and 3 + 2 are the same.
- Keep a running total with a feedback wire: Output → Delay One Frame → back into Value 1.

## Coming from Origami
This is Origami's **+** patch. Its unlabeled inputs are called Value 1, Value 2, and so on.

## Inputs

This patch has no fixed inputs.

### Repeating inputs

**Value 1, Value 2, …** (`value1`, `value2`, …) · `variant` · default `0`

A value to add, or a piece of text to join. Inputs combine from top to bottom.

A patch can have 2 to 32 of these, and a new patch starts with 2.

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `variant` | The sum of all values, or the joined text when the type is Text. |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `number` (default), `point`, `point3d`, `point4d`, `size`, `text`.

## Examples

### Stack looped cards down the screen

Each card sits 100 pt below the previous one, starting 120 pt from the top.

```text
layer card rectangle "Card" @16,120 358x88 cornerRadius=16 position←place.output
patch rows loop count=5
patch spread multiply<point> value1←rows.index value2=[0,100]
patch place add<point> value1←spread.output value2=[16,120]
```

### Show seconds out of a minute, like 12/60

With the type set to Text, the number from Round becomes text and the three pieces join in order.

```text
layer status text "Status" @16,120 text←label.output
patch clock time
patch seconds round value←clock.time
patch label add<text>[3] value1←seconds.roundedDown value2="/" value3="60"
```

## Common mistakes

- The label shows "12" instead of 3: the type is Text, so the numbers were joined. Set the type to Number to add them.
- Words run together ("HelloSam"): text joins with no separator. Put the space inside one of the values, such as "Hello, ".

## Pairs well with

- [Multiply](multiply.md): Multiplies values together, for scaling a number, spacing looped layers, or turning 0–1 progress into distance.
- [Subtract](subtract.md): Subtracts one or more values from a starting value, such as finding how far apart two positions are.
- [Loop](loop.md): Makes a loop of indices from 0 up to Count minus 1, so layers and patches repeat once per index.
- [Delay One Frame](delay1.md): Outputs whatever its input was on the previous frame, for feedback loops and frame-to-frame comparisons.
- [Format Number](formatNumber.md): Turns a number into display text with set decimals, separators, a percent or K/M style, and your own prefix and suffix.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** + (`builtin.math.add`)

| Sonobe port | Origami label |
|---|---|
| `value1` | Input 1 (unlabeled; the base value) |
| `value2` | Input 2 (unlabeled) |
| `output` | Output (unlabeled) |
