<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Size

Combines a width and a height into one size for a layer's Size or any other size input.

| | |
|---|---|
| Type key | `size` |
| Category | [Utility](README.md#utility) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Search terms | make size, width and height, dimensions, pack size, combine width and height, wh, size builder, frame size |

## How it works
Size packs a width and a height into one value.

- **Width** is the horizontal size in points.
- **Height** is the vertical size in points.
- **Output** is `[Width, Height]`. Wire it into a layer's Size.

## Tips
- Animate one dimension: drive Width from a Transition and type a fixed Height.
- When a layer's width or height mode is Percent, the matching number is a percentage of the parent instead of points.
- Size doesn't stop negative numbers. Clamp values that come from math before they reach a layer.
- To take a size apart, use Size Unpack.

## Coming from Origami
In Origami this is the Point patch set to the Size type. Imported ones become Size patches.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Width**<br>`width` | `number` (distance) | `100` | Width in points, or percent of the parent when the layer's width mode is Percent; 0 means no width. At least 0. |
| **Height**<br>`height` | `number` (distance) | `100` | Height in points, or percent of the parent when the layer's height mode is Percent; 0 means no height. At least 0. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `size` | The size [Width, Height]. |

## Examples

### Widen a button while it's pressed

The anchor sits at the center, so the button grows evenly on both sides.

```text
layer button rectangle "Button" @201,437 anchor=[0.5,0.5] cornerRadius=28 size←button_size.output
patch press interaction layer=@button
patch press_spring popAnimation number←press.down
patch button_width transition<number> progress←press_spring.output start=160 end=220
patch button_size size width←button_width.output height=56
```

### Fill a progress bar over three seconds

```text
layer bar rectangle "Progress Bar" @16,437 cornerRadius=4 size←bar_size.output
patch launched whenPrototypeStarts
patch timer wait start←launched.started duration=3
patch bar_width multiply[2] value1←timer.progress value2=370
patch bar_size size width←bar_width.output height=8
```

## Common mistakes

- The layer vanishes as soon as you wire Size into it: one of the inputs is 0. Give Width and Height the layer's current size before animating one of them.
- A layer grows from its top-left corner instead of evenly: a new size keeps the layer's anchor point in place, and the anchor defaults to the top-left. Set the layer's Anchor to [0.5, 0.5] so it grows around its center.

## Pairs well with

- [Size Unpack](sizeUnpack.md): Splits a size into separate Width and Height numbers.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.
- [Pop Animation](popAnimation.md): Springs its output toward a target value whenever the target changes, with a feel set by Bounciness and Speed.
- [Wait](wait.md): Starts a timer on a pulse and turns Done on once the duration has passed, reporting progress along the way.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** Size

| Sonobe port | Origami label |
|---|---|
| `width` | W |
| `height` | H |
