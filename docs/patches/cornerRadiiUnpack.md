<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Corner Radii Unpack

Splits a Corner Radii value into the radius of each corner: top left, top right, bottom right, and bottom left.

| | |
|---|---|
| Type key | `cornerRadiiUnpack` |
| Category | [Utility](README.md#utility) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | corner radius unpack, split corners, separate corners, border radius values, get corner radius, vec4 unpack |

## How it works
Corner Radii Unpack takes one Corner Radii value and gives you each corner's radius on its own port. It's the reverse of Corner Radii.

- **Value** is the set of radii to split, such as a Transition set to Point 4D that animates a card's corners.
- **Top Left**, **Top Right**, **Bottom Right**, and **Bottom Left** are radii in points, read clockwise from the top left.

## Tips
- Keep nested corners concentric: unpack the outer radii, subtract the gap between the shapes, and pack the result with Corner Radii for the inner layer.
- Wire one corner into Watch to see its value while you tune an animation.

## Coming from Origami
In Origami, this is Vec4 Unpack with its type changed to Corner Radius. The unnamed input is called Value.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Value**<br>`value` | `point4d` (distance) | `[0, 0, 0, 0]` | The corner radii to split: four radii in points, clockwise from the top left. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Top Left**<br>`topLeft` | `number` (distance) | The top-left corner's radius, in points. |
| **Top Right**<br>`topRight` | `number` (distance) | The top-right corner's radius, in points. |
| **Bottom Right**<br>`bottomRight` | `number` (distance) | The bottom-right corner's radius, in points. |
| **Bottom Left**<br>`bottomLeft` | `number` (distance) | The bottom-left corner's radius, in points. |

## Examples

### Keep a photo's corners parallel to its card

The card's corners animate from 16 to 32 on tap. The photo sits 8 points inside, so its top corners use the card's radius minus 8 to stay concentric.

```text
layer card group "Card" @16,200 370x260 color=#FFFFFFFF cornerRadii←card_corners.output
  layer photo rectangle "Photo" @8,8 354x160 color=#D9D9D9FF cornerRadii←photo_corners.output
patch tap_card interaction layer=@card
patch toggle switch flip←tap_card.tap
patch pop popAnimation number←toggle.on
patch card_corners transition<point4d> progress←pop.output start=16,16,16,16 end=32,32,32,32
patch outer cornerRadiiUnpack value←card_corners.output
patch inner_left subtract value1←outer.topLeft value2=8
patch inner_right subtract value1←outer.topRight value2=8
patch photo_corners cornerRadii topLeft←inner_left.output topRight←inner_right.output bottomRight=4 bottomLeft=4
```

## Common mistakes

- There's no way to wire a layer's Corner Radii into Value: patches can't read layer properties. Keep the radii in a patch such as Corner Radii or Transition, wire it into the layer, and unpack that same output here.
- Top Right shows what should be the bottom-left radius: the value was packed in another corner order, such as top left, top right, bottom left, bottom right. Pack corners with Corner Radii so the order is always clockwise from the top left.

## Pairs well with

- [Corner Radii](cornerRadii.md): Combines four corner radii into one value so a layer can round each corner by a different amount.
- [Subtract](subtract.md): Subtracts one or more values from a starting value, such as finding how far apart two positions are.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.
- [Watch](watch.md): Shows a value right on the patch and logs its changes to the console, so you can see what a cable carries.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Corner Radius Unpack
