<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Absolute Value

Turns negative values into positive ones, for measuring how far something moved in either direction.

| | |
|---|---|
| Type key | `absoluteValue` |
| Category | [Math](README.md#math) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Search terms | abs, magnitude, make positive, remove sign, unsigned, distance from zero |

## How it works
Absolute Value removes the minus sign: −40 becomes 40, 500 stays 500, and 0 stays 0.

- **Value** is the value to make positive. Vectors make each component positive separately: [−30, 40] becomes [30, 40].
- **Output** is the positive result.

## Tips
- Detect a swipe in either direction: Absolute Value of the drag distance, then Greater Than 80.
- Fade a card as it moves away from center either way: Absolute Value → Remap → Opacity.

## Coming from Origami
This is Origami's **Absolute Value** patch.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Value**<br>`value` | `variant` | `0` | The value to make positive. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `variant` | Value without its minus sign. |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `number` (default), `point`, `point3d`, `point4d`, `size`.

## Examples

### Fade a card as you drag it either way

A Point wired into a number input reads its x. The card starts at x 16, so subtract that before taking the absolute value.

```text
layer card rectangle "Card" @16,200 358x480 cornerRadius=24 position←move.position opacity←fade.output
patch move drag layer=@card
patch offset subtract value1←move.position value2=16
patch away absoluteValue value←offset.output
patch fade remap value←away.output fromStart=0 fromEnd=200 toStart=1 toEnd=0.2 clampToRange=true
```

## Common mistakes

- A diagonal distance looks too small: Absolute Value works on each component separately, so [30, 40] stays [30, 40]. Use Length for the straight-line distance (50).

## Pairs well with

- [Subtract](subtract.md): Subtracts one or more values from a starting value, such as finding how far apart two positions are.
- [Greater Than](greaterThan.md): Checks whether a value is greater than another, such as a drag passing a threshold or a timer passing a time.
- [Gesture](gesture.md): Tracks a press on a layer with its drag offset and speed, for animations that follow the finger and fling on release.
- [Length](length.md): Measures how far a number, point, or vector is from zero, such as how far a drag has traveled in any direction.
- [Remap](remap.md): Converts a value from one range to another, like turning scroll distance 0–150 into a header height from 120 to 64.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** Absolute Value (`builtin.math.abs`)

| Sonobe port | Origami label |
|---|---|
| `value` | Input (unlabeled) |
| `output` | Output (unlabeled) |
