<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Less Than or Equal

Checks whether a value is at most another value, so matching the threshold exactly also counts.

| | |
|---|---|
| Type key | `lessThanOrEqual` |
| Category | [Logic](README.md#logic) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Search terms | less or equal, smaller than or equal to, at most, no more than, maximum, <= |

## How it works
Less Than or Equal turns on while Value 1 is smaller than Value 2 or exactly equal to it. Use it when matching the threshold should count, such as lighting up every star up to the one you tapped.

- **Value 1** is the value you're checking. **Value 2** is the threshold.
- Add more values to check a chain: with three values, the output is on only when Value 1 ≤ Value 2 ≤ Value 3.
- **Output** is on while the whole chain holds.

## Tips
- Star ratings: compare a Loop's Index with the selected star's index to light up that star and every star before it.
- A three-value chain `0 ≤ value ≤ 1` checks that a progress value is inside 0–1. In Range does the same with named Min and Max.
- With nothing connected, both values are 0 and the output is on.

## Coming from Origami
Origami's ports are unnamed. Here they're Value 1, Value 2, and so on, in the same order and with the same chain rule.

## Inputs

This patch has no fixed inputs.

### Repeating inputs

**Value 1, Value 2, …** (`value1`, `value2`, …) · `variant` · default `0`

A value in the chain; each one must be less than or equal to the next.

A patch can have 2 to 32 of these, and a new patch starts with 2.

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `boolean` | On while each value is less than or equal to the next one. |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `number` (default), `index`, `boolean`.

## Examples

### Light up a star rating

Value 2 is the index of the selected star; 2 lights the first three stars.

```text
layer stars group "Stars" @100,400 200x32 layout=row spacing=10
  layer star oval "Star" 32x32 color←star_color.output
patch star_items loop count=5
patch lit lessThanOrEqual<index>[2] value1←star_items.index value2=2
patch star_color transition<color> progress←lit.output start=#D9D9D9FF end=#FFB800FF
```

## Common mistakes

- One star too many lights up: the rating counts from 1 but the Loop's Index counts from 0. Subtract 1 from the rating, or use Less Than.
- Something is already on when the prototype starts: both inputs default to 0, and 0 ≤ 0 is true. Set the threshold before wiring the output.

## Pairs well with

- [Greater Than or Equal](greaterThanOrEqual.md): Checks whether a value is at least another value, so reaching the threshold exactly also counts.
- [Loop](loop.md): Makes a loop of indices from 0 up to Count minus 1, so layers and patches repeat once per index.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.
- [In Range](inRange.md): Checks whether a number lies between a minimum and a maximum, and tells you if it's below or above instead.
- [And](and.md): Turns on only while every one of its inputs is on.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** Less Than or Equal (`builtin.compare.lteq`)

| Sonobe port | Origami label |
|---|---|
| `value1` | Input (port 0, base value) |
| `value2` | Input (port 1) |
