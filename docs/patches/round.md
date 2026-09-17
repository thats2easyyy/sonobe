<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Round

Rounds a number to the nearest whole number or decimal place, and also outputs it rounded down and rounded up.

| | |
|---|---|
| Type key | `round` |
| Category | [Math](README.md#math) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Search terms | floor, ceil, ceiling, round down, round up, nearest whole number, decimal places, integer |

## How it works
Round cleans up long decimals. You get three results at once:

- **Rounded** is the nearest value. Halfway values round away from zero: 2.5 → 3 and −2.5 → −3.
- **Rounded Down** always goes toward the lower number: 2.7 → 2 and −2.3 → −3.
- **Rounded Up** always goes toward the higher number: 2.1 → 3 and −2.7 → −2.
- **Places** is how many digits to keep after the decimal point: with 1, 3.14159 becomes 3.1. Negative places round to tens (−1) or hundreds (−2).
- Set the type to Point or another vector to round each component, such as snapping a position to whole points.

## Tips
- Round outputs a number, so trailing zeros disappear (9.90 shows as 9.9). Use Format Number for display text with fixed decimals.
- Use Rounded Down to turn a Random value between 0 and 3 into 0, 1, or 2.
- To round to steps like 8 or 50, use Snap.

## Coming from Origami
This is Origami's **Round** patch, including the Places input added in version 195. Halfway values round away from zero.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Value**<br>`value` | `variant` | `0` | The number to round. |
| **Places**<br>`places` | `number` | `0` | Digits to keep after the decimal point. 0 rounds to whole numbers; −1 rounds to tens. Range -15 to 15, step 1. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Rounded**<br>`rounded` | `variant` | Value rounded to the nearest step; halfway values round away from zero. |
| **Rounded Down**<br>`roundedDown` | `variant` | Value rounded toward the lower number (floor). |
| **Rounded Up**<br>`roundedUp` | `variant` | Value rounded toward the higher number (ceiling). |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `number` (default), `point`, `point3d`, `point4d`, `size`.

## Examples

### Show a slider as a whole percent

Interaction's position reads its x when wired into a number input.

```text
layer track rectangle "Track" @40,400 310x40 cornerRadius=20
layer percent text "Percent" @40,460 text←whole.rounded
patch press interaction layer=@track
patch amount remap value←press.position fromStart=40 fromEnd=350 toStart=0 toEnd=100 clampToRange=true
patch whole round value←amount.output
```

## Common mistakes

- A price shows 9.9 instead of 9.90: Round outputs a number, and numbers drop trailing zeros. Use Format Number to show a fixed number of decimals.
- A counter changes a step early: Rounded goes up at the halfway point. Use Rounded Down when a value should only change after passing each whole number.

## Pairs well with

- [Format Number](formatNumber.md): Turns a number into display text with set decimals, separators, a percent or K/M style, and your own prefix and suffix.
- [Divide](divide.md): Divides a value by one or more values, outputting 0 with a warning instead of breaking when you divide by zero.
- [Random](random.md): Picks a random number between Start and End, and picks a new one each time Randomize gets a pulse.
- [Snap](snap.md): Moves a value to the nearest step or point, and can use flick velocity to predict where it lands, for grids and carousels.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** Round (`builtin.math.round`)

| Sonobe port | Origami label |
|---|---|
| `value` | Input (unlabeled) |
