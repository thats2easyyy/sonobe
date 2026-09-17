<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Shape Union

Combines two or more shapes into one shape so they share a single fill, stroke, and shadow in one Shape layer.

| | |
|---|---|
| Type key | `shapeUnion` |
| Category | [Shapes](README.md#shapes) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | union, combine shapes, merge shapes, boolean union, compound shape, join shapes, group paths |

## How it works
Shape Union joins several shapes into one, like combining vector paths in a design tool. Wire shapes from other shape patches into **Shape 1**, **Shape 2**, and so on, and connect **Shape** to a Shape layer. Add inputs to combine more shapes.

- Where shapes overlap, their fills merge into one silhouette, and the Shape layer's shadow follows the combined outline.
- Unconnected and empty inputs are skipped.
- When the layer has a stroke, each shape keeps its own outline, so edges inside the overlap stay visible.
- A hole that's already inside one input, such as the middle of a ring from SVG Path Shape, stays a hole unless another shape covers it.

## Tips
- Build a chat bubble from a Rounded Rectangle Shape body and a Triangle Shape tail.
- Stroke End trims the combined path in input order: Shape 1 draws first, then Shape 2.
- Shape Union combines separate inputs. A loop wired into Shape 1 makes one union per loop item.

## Coming from Origami
Formerly called Union. Its unnamed inputs become Shape 1, Shape 2, and so on in the same order, and the output is Shape.

## Inputs

This patch has no fixed inputs.

### Repeating inputs

**Shape 1, Shape 2, …** (`shape1`, `shape2`, …) · `shape` · default none

A shape to combine with the others. Unconnected or empty shapes are skipped.

A patch can have 2 to 32 of these, and a new patch starts with 2.

## Outputs

| Output | Type | Description |
|---|---|---|
| **Shape**<br>`shape` | `shape` | All the input shapes combined into one. Connect it to a Shape layer's Shape property. |

## Examples

### Chat bubble with a tail

```text
layer bubble shape "Bubble" @40,300 240x112 shape←bubble_shape.shape color=#E9E9EBFF shadowOpacity=0.15 shadowRadius=8 shadowOffset=[0,2]
patch body roundedRectangleShape position=[120,48] size=[240,96] cornerRadius=20
patch tail triangleShape firstPoint=[28,90] secondPoint=[60,90] thirdPoint=[18,112]
patch bubble_shape shapeUnion[2] shape1←body.shape shape2←tail.shape
```

### Plus button that turns into a close button

```text
layer plus shape "Plus" @181,400 40x40 shape←plus_shape.shape color=#1C1C1EFF rotation←spin.output
patch bar_across roundedRectangleShape position=[20,20] size=[40,6] cornerRadius=3
patch bar_down roundedRectangleShape position=[20,20] size=[6,40] cornerRadius=3
patch plus_shape shapeUnion[2] shape1←bar_across.shape shape2←bar_down.shape
patch tap_plus interaction layer=@plus
patch open switch flip←tap_plus.tap
patch pop popAnimation number←open.on bounciness=6 speed=14
patch spin transition<number> progress←pop.output start=0 end=45
```

## Common mistakes

- Lines show where the shapes overlap: the Shape layer has a stroke, and each input keeps its own outline. Use the union for fills and shadows, or draw the outline as one path with SVG Path Shape.
- The Shape layer repeats into many copies: a loop is wired into one of the inputs, so the patch makes one union per item. Wire separate shape patches into separate inputs instead.

## Pairs well with

- [Rounded Rectangle Shape](roundedRectangleShape.md): Makes a rectangle shape with rounded corners, for cards, pills, and buttons you want to stroke, trim, morph, or combine.
- [Triangle Shape](triangleShape.md): Makes a triangle shape from three corner points, for play icons, arrows, and tooltip tails in a Shape layer.
- [Circle Shape](circleShape.md): Makes a circle shape from a center point and a radius, for dots, rings, and progress arcs in a Shape layer.
- [Oval Shape](ovalShape.md): Makes an oval shape from a center point and a size, for ellipses, blobs, and squash-and-stretch effects in a Shape layer.
- [SVG Path Shape](svgPathShape.md): Turns SVG path data, like an icon copied from a design tool, into a shape for a Shape layer, scaled to the size you want.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Union (`builtin.shape.union`)

| Sonobe port | Origami label |
|---|---|
| `shape1` | Input (port 0) |
| `shape2` | Input (port 1) |
| `shape` | Output |
