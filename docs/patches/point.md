<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Point

Combines an X and a Y number into one point for a layer's Position, Anchor, Pivot, or any other 2D input.

| | |
|---|---|
| Type key | `point` |
| Category | [Utility](README.md#utility) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Search terms | vec2, make point, pack point, xy, coordinate, combine x and y, position builder, anchor point, 2d point |

## How it works
Point packs two numbers into a single 2D value.

- **X** is the horizontal part. For a position it's the distance in points from the parent's left edge.
- **Y** is the vertical part. For a position it's the distance in points from the parent's top edge, and it grows downward.
- **Output** is `[X, Y]`. Wire it into Position, or into Anchor and Pivot, where 0 is the left or top edge and 1 is the right or bottom edge.

## Tips
- Animate one axis at a time: drive X from an animation and type a fixed Y.
- Animation patches can also animate a whole point: set a Pop Animation's type to point instead of animating X and Y separately.
- To take a point apart, use Point Unpack. For widths and heights, Size reads more clearly.

## Coming from Origami
Sonobe measures positions from the parent's top-left corner; Origami measures them from the center.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **X**<br>`x` | `number` | `0` | Horizontal part: points from the parent's left edge for a position, or 0 to 1 across the layer for an anchor or pivot. |
| **Y**<br>`y` | `number` | `0` | Vertical part: points from the parent's top edge for a position (grows downward), or 0 to 1 down the layer for an anchor or pivot. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `point` | The point [X, Y]. |

## Examples

### Slide a card sideways on tap

Only X animates; Y stays at 120.

```text
layer card rectangle "Card" 200x140 cornerRadius=20 position←card_position.output
patch tap_card interaction layer=@card
patch toggle switch flip←tap_card.tap
patch slide popAnimation number←toggle.on
patch card_x transition<number> progress←slide.output start=16 end=186
patch card_position point x←card_x.output y=120
```

### Lay out a row of dots with a loop

The loop's index spaces five dots 72 points apart.

```text
layer dot oval "Dot" 48x48 position←dot_position.output
patch dots loop count=5
patch dot_x mathExpression expression="x = 33 + index * 72" index←dots.index
patch dot_position point x←dot_x.x y=400
```

## Common mistakes

- The layer jumps to the top edge when you wire Point into Position: Y is still 0 while only X is animated. Type the layer's current Y into the input you aren't animating.
- A layer spins around its corner: a Point wired to Pivot is at [0, 0], the top-left corner. Set X and Y to 0.5 to pivot around the center.

## Pairs well with

- [Point Unpack](pointUnpack.md): Splits a 2D point, such as a touch position, into separate X and Y numbers.
- [Pop Animation](popAnimation.md): Springs its output toward a target value whenever the target changes, with a feel set by Bounciness and Speed.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.
- [Loop](loop.md): Makes a loop of indices from 0 up to Count minus 1, so layers and patches repeat once per index.
- [Drag](drag.md): Lets people drag a layer around and outputs where it should be, with optional bounds, axis lock, and momentum.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** Point (`builtin.point`)
