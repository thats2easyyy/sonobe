<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Oval Shape

Makes an oval shape from a center point and a size, for ellipses, blobs, and squash-and-stretch effects in a Shape layer.

| | |
|---|---|
| Type key | `ovalShape` |
| Category | [Shapes](README.md#shapes) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | oval, ellipse, circle, egg, blob, squash and stretch |

## How it works
Oval Shape describes an ellipse as vector path data. Connect its **Shape** output to a Shape layer's Shape property to see it; the layer supplies the fill and stroke.

- **Position** is where the oval's center sits, in points from the Shape layer's top-left corner, y down.
- **Size** is the oval's width and height in points. Equal values make a circle, and a 0 in either draws nothing.
- **Anchor** (advanced) changes which point of the oval's box Position refers to. [0, 0] makes Position the top-left corner, like a layer's position.

The outline starts at the top center and runs clockwise.

## Tips
- Animate Size with a Pop Animation set to Size for squash and stretch: wider and shorter on impact, then back.
- Combine several ovals with Shape Union to make clouds, eyes, or blobs that share one fill and shadow.
- Keep the oval inside the Shape layer's size so the whole oval receives touches.

## Coming from Origami
Origami measures shape coordinates from the center of the parent group; here they start at the Shape layer's top-left corner. Anchor is new.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Position**<br>`position` | `point` (distance) | `[50, 50]` | Where the oval's center sits, in points from the Shape layer's top-left corner, y down. |
| **Size**<br>`size` | `size` (distance) | `[100, 100]` | Width and height of the oval in points. A 0 in either draws nothing. At least 0. |
| **Anchor**<br>`anchor` | `anchor` · advanced | `[0.5, 0.5]` | Which point of the oval's box Position refers to: [0.5, 0.5] is the center, [0, 0] the top-left corner. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Shape**<br>`shape` | `shape` | The oval as vector path data. Connect it to a Shape layer's Shape property. |

## Examples

### Tap to blink an eye

```text
layer eye shape "Eye" @151,380 100x60 shape←eye_shape.shape color=#1C1C1EFF
patch tap_eye interaction layer=@eye
patch blink switch flip←tap_eye.tap
patch close popAnimation number←blink.on bounciness=0 speed=20
patch lid transition<size> progress←close.output start=[100,60] end=[100,4]
patch eye_shape ovalShape position=[50,30] size←lid.output
```

## Common mistakes

- The oval sits half outside its layer: Position is the oval's center, not its top-left corner. Set Position to half the Size, or set Anchor to [0, 0].
- The oval blinks out for a moment during a bouncy animation: the spring pushes Size past 0, and a width or height at or below 0 draws nothing. Animate toward a small positive size, or lower the bounciness.

## Pairs well with

- [Pop Animation](popAnimation.md): Springs its output toward a target value whenever the target changes, with a feel set by Bounciness and Speed.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.
- [Shape Union](shapeUnion.md): Combines two or more shapes into one shape so they share a single fill, stroke, and shadow in one Shape layer.
- [Circle Shape](circleShape.md): Makes a circle shape from a center point and a radius, for dots, rings, and progress arcs in a Shape layer.
- [Interaction](interaction.md): Detects presses and taps on a layer, or anywhere on the screen, and reports where the pointer is.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Oval (`builtin.shape.ellipse`)
