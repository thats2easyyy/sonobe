<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Rounded Rectangle Shape

Makes a rectangle shape with rounded corners, for cards, pills, and buttons you want to stroke, trim, morph, or combine.

| | |
|---|---|
| Type key | `roundedRectangleShape` |
| Category | [Shapes](README.md#shapes) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | rounded rectangle, round rect, rounded rect, pill, capsule, squircle, card shape, rectangle path |

## How it works
Rounded Rectangle Shape describes a rectangle with rounded corners as vector path data. Connect **Shape** to a Shape layer's Shape property to draw it.

- **Position** is where the rectangle's center sits, in points from the Shape layer's top-left corner, y down.
- **Size** is the width and height in points.
- **Corner Radius** rounds every corner. A radius of half the height or more makes fully round, pill-shaped ends.
- **Corner Radii** and **Corner Smoothing** (advanced) set each corner separately and add smooth, squircle-style corners. The outline matches a Rectangle layer with the same settings exactly.
- **Anchor** (advanced) changes which point Position refers to.

The outline starts on the top edge, where the top-right corner begins, and runs clockwise.

## Tips
- Use a Rectangle layer for plain cards. Reach for this patch when you need a border that draws itself (Stroke End), a union with other shapes, or a morph such as a square turning into a circle.
- Animate Corner Radius up to half the Size to turn a square into a circle.
- For a tooltip or chat bubble, combine it with Triangle Shape in Shape Union so the body and tail share one fill and shadow.

## Coming from Origami
Origami's port is named Radius, and its patch has no per-corner radii or smoothing. Origami measures shape coordinates from the center of the parent group; here they start at the Shape layer's top-left corner.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Position**<br>`position` | `point` (distance) | `[50, 50]` | Where the rectangle's center sits, in points from the Shape layer's top-left corner, y down. |
| **Size**<br>`size` | `size` (distance) | `[100, 100]` | Width and height in points. A 0 in either draws nothing. At least 0. |
| **Corner Radius**<br>`cornerRadius` | `number` (distance) | `16` | Rounds all four corners, in points. At half the shorter side or more, the ends are fully round, like a pill. At least 0. |
| **Corner Radii**<br>`cornerRadii` | `point4d` (distance) · advanced | `[0, 0, 0, 0]` | Separate radii for the top-left, top-right, bottom-right, and bottom-left corners, in points. While connected, or when any value is above 0, they replace Corner Radius. |
| **Corner Smoothing**<br>`cornerSmoothing` | `number` (progress) · advanced | `0` | Blends each corner into its edges for a squircle look: 0 draws circular corners, and 1 the smoothest. Matches a Rectangle layer's Corner Smoothing. Range 0 to 1, step 0.01. |
| **Anchor**<br>`anchor` | `anchor` · advanced | `[0.5, 0.5]` | Which point of the rectangle Position refers to: [0.5, 0.5] is the center, [0, 0] the top-left corner. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Shape**<br>`shape` | `shape` | The rounded rectangle as vector path data. Connect it to a Shape layer's Shape property. |

## Examples

### Tap to morph a square into a circle

```text
layer avatar_frame shape "Avatar Frame" @151,380 100x100 shape←frame.shape color=#5856D6FF
patch tap_frame interaction layer=@avatar_frame
patch round switch flip←tap_frame.tap
patch pop popAnimation number←round.on bounciness=4 speed=12
patch radius transition<number> progress←pop.output start=16 end=50
patch frame roundedRectangleShape position=[50,50] size=[100,100] cornerRadius←radius.output
```

### Pill button that traces its border while pressed

The outline is 2 pt smaller than the layer so the stroke stays inside it.

```text
layer pill shape "Pill Button" @121,420 160x48 shape←pill_shape.shape color=#00000000 strokeColor=#007AFFFF strokeWidth=2 strokeEnd←trace.output
patch pill_shape roundedRectangleShape position=[80,24] size=[158,46] cornerRadius=23
patch press interaction layer=@pill
patch trace classicAnimation number←press.down duration=0.4 curve=cubicOut
```

## Common mistakes

- Corner Radius has no effect: Corner Radii is connected, or one of its values is above 0, so it replaces Corner Radius. Disconnect Corner Radii and set it back to [0, 0, 0, 0].
- The rectangle sits half outside its layer: Position is the center, not the top-left corner. Set Position to half the Size, or set Anchor to [0, 0].
- Raising Corner Radius stops changing anything past a point: the radius is already capped at half the shorter side, which is fully round. Make Size larger if you want bigger curves.

## Pairs well with

- [Shape Union](shapeUnion.md): Combines two or more shapes into one shape so they share a single fill, stroke, and shadow in one Shape layer.
- [Triangle Shape](triangleShape.md): Makes a triangle shape from three corner points, for play icons, arrows, and tooltip tails in a Shape layer.
- [Pop Animation](popAnimation.md): Springs its output toward a target value whenever the target changes, with a feel set by Bounciness and Speed.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.
- [Classic Animation](classicAnimation.md): Animates toward a target value over a set duration with an easing curve whenever the target changes.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Rounded Rectangle (`builtin.shape.roundrect`)
- **Also imports:** `builtin.shape.roundRect`

| Sonobe port | Origami label |
|---|---|
| `cornerRadius` | Radius |
