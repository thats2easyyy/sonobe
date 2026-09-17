<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Point 4D

Combines four numbers into one 4D point so you can animate, compare, or pass four values as one.

| | |
|---|---|
| Type key | `point4d` |
| Category | [Utility](README.md#utility) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | vec4, 4d vector, xyzw, pack xyzw, combine four numbers, make vector, four values |

## How it works
Point 4D packs four separate numbers into one value with four parts, called X, Y, Z, and W. Anything that takes a 4D point accepts it: a Transition or Pop Animation set to Point 4D, Add, Option Picker, or a layer's Padding and Corner Radii.

- **X**, **Y**, **Z**, and **W** become the first through fourth numbers.
- **Output** is the packed point, in X, Y, Z, W order.

## Tips
- Pack several properties into one 4D point, run a single animation, then split it with Point 4D Unpack. Every property moves on the same spring.
- Building padding or rounded corners? Edges and Corner Radii make the same kind of value, with ports named by side and corner.
- The output can drive a color: X, Y, Z, and W become red, green, blue, and alpha, each from 0 to 1. RGB Color is clearer for most colors.

## Coming from Origami
This is Origami's Vec4 patch. In Origami you change its type to Edges or Corner Radius; Sonobe has separate Edges and Corner Radii patches that output the same 4D value.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **X**<br>`x` | `number` | `0` | The first number; when the output drives a color, this is red from 0 to 1. |
| **Y**<br>`y` | `number` | `0` | The second number; when the output drives a color, this is green from 0 to 1. |
| **Z**<br>`z` | `number` | `0` | The third number; when the output drives a color, this is blue from 0 to 1. |
| **W**<br>`w` | `number` | `0` | The fourth number; when the output drives a color, this is alpha, where 0 is transparent and 1 is opaque. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `point4d` | The four numbers as one 4D point, in X, Y, Z, W order. |

## Examples

### Spring four properties together

Two Point 4D patches hold a resting look and a selected look: opacity, rotation, scale, and corner radius. One Pop Animation springs between them, and Point 4D Unpack sends each number to its property.

```text
layer card rectangle "Card" @76,300 250x160 color=#FFFFFFFF opacity←look.x rotation←look.y scale←look.z cornerRadius←look.w
patch tap_card interaction layer=@card
patch toggle switch flip←tap_card.tap
patch resting point4d x=0.6 y=0 z=0.94 w=32
patch selected point4d x=1 y=-3 z=1 w=16
patch pick ifElse<point4d> condition←toggle.on ifTrue←selected.output ifFalse←resting.output
patch spring popAnimation<point4d> number←pick.output
patch look point4dUnpack value←spring.output
```

## Common mistakes

- A layer's color turns invisible when Point 4D drives it: W is alpha and starts at 0, which is fully transparent. Set W to 1, or use RGB Color.
- Padding lands on the wrong sides: a 4D padding value runs top, right, bottom, left, and X, Y, Z, W don't show which is which. Use Edges, whose ports name each side.

## Pairs well with

- [Point 4D Unpack](point4dUnpack.md): Splits a 4D point into its X, Y, Z, and W numbers so each one can drive something different.
- [Pop Animation](popAnimation.md): Springs its output toward a target value whenever the target changes, with a feel set by Bounciness and Speed.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.
- [If / Else](ifElse.md): Outputs one of two values depending on whether a condition is on or off.
- [Option Picker](optionPicker.md): Outputs one of several values chosen by an option number, like a different color or title for each tab.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Vec4 (`builtin.vec4`)
