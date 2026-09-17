<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Modulo

Outputs the remainder after dividing, for wrapping a count back to 0, finding grid columns, or alternating items.

| | |
|---|---|
| Type key | `modulo` |
| Category | [Math](README.md#math) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Shortcut | <kbd>%</kbd> |
| Search terms | mod, remainder, modulus, wrap around, %, cycle |

## How it works
Modulo divides **Value 1** by **Value 2** and keeps what's left over: 7 mod 3 is 1. As Value 1 counts up, the result climbs toward Value 2, then wraps back to 0 before reaching it, like a clock.

- Negative values wrap forward too: −1 mod 3 is 2, so a count going backwards still lands in range.
- Decimals work: 5.5 mod 2 is 1.5.
- Extra inputs apply again in order: (Value 1 mod Value 2) mod Value 3.
- Vectors wrap each component separately.
- Modulo by 0 outputs 0 and shows a warning in the console.

## Tips
- Grid column: Loop Index mod 3 gives 0, 1, 2, 0, 1, 2 …
- Every other row: Index mod 2 is 0 for even rows and 1 for odd rows.
- Keep an angle between 0 and 360: angle mod 360.

## Coming from Origami
This is Origami's **Mod** patch. For negative values Sonobe always wraps into the range between 0 and Value 2 (−1 mod 3 is 2). A code-style remainder, like JavaScript's `%`, gives −1; use Math Expression if you need that.

## Inputs

This patch has no fixed inputs.

### Repeating inputs

**Value 1, Value 2, …** (`value1`, `value2`, …) · `variant` · default `1`

Value 1 is the value to wrap; each later value is a divisor applied to the running result.

A patch can have 2 to 32 of these, and a new patch starts with 2.

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `variant` | The remainder, always between 0 and the divisor (0 included). |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `number` (default), `point`, `point3d`, `point4d`, `size`.

## Examples

### Stripe alternate rows

Index mod 2 is 0 or 1, which drives a color Transition directly.

```text
layer list group "List" @0,120 390x336
  layer row rectangle "Row" @0,0 390x56 position←stack.output color←shade.output
patch rows loop count=6
patch stack multiply<point> value1←rows.index value2=[0,56]
patch odd modulo value1←rows.index value2=2
patch shade transition<color> progress←odd.output start="#FFFFFFFF" end="#F2F2F7FF"
```

### Spin forever without huge numbers

```text
layer spinner rectangle "Spinner" @170,400 50x50 cornerRadius=8 rotation←angle.output
patch clock time
patch spin multiply value1←clock.time value2=90
patch angle modulo value1←spin.output value2=360
```

## Common mistakes

- The last page never shows: mod 4 gives 0, 1, 2, 3, never 4. Use the number of items as Value 2, not the last index.
- A result is almost Value 2 instead of 0: decimals aren't stored exactly, so 0.3 mod 0.1 comes out near 0.1. Work in whole numbers (3 mod 1) or Round first.

## Pairs well with

- [Loop](loop.md): Makes a loop of indices from 0 up to Count minus 1, so layers and patches repeat once per index.
- [Counter](counter.md): Keeps a whole-number count that pulses increase, decrease, or jump to a set number, with optional wrap-around.
- [Round](round.md): Rounds a number to the nearest whole number or decimal place, and also outputs it rounded down and rounded up.
- [Equals Exactly](equalsExactly.md): Checks whether two or more values are exactly the same: numbers, indexes, text, colors, points, options, or JSON.
- [Divide](divide.md): Divides a value by one or more values, outputting 0 with a warning instead of breaking when you divide by zero.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** Mod (`builtin.math.mod`)

| Sonobe port | Origami label |
|---|---|
| `value1` | Input 1 (unlabeled; the base value) |
| `value2` | Input 2 (unlabeled) |
| `output` | Output (unlabeled) |
