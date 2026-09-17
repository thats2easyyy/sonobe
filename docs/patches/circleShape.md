<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Circle Shape

Makes a circle shape from a center point and a radius, for dots, rings, and progress arcs in a Shape layer.

| | |
|---|---|
| Type key | `circleShape` |
| Category | [Shapes](README.md#shapes) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | circle, dot, ring, disc, progress ring, round shape, arc |

## How it works
Circle Shape describes a circle as vector path data. It doesn't draw anything by itself: connect its **Shape** output to a Shape layer's Shape property, and the layer adds the fill, stroke, and shadow.

- **Position** is where the circle's center sits, in points from the Shape layer's top-left corner, with y going down.
- **Radius** is the distance from the center to the edge, in points. 0 draws nothing, so animating Radius up from 0 grows a circle out of nothing.
- **Anchor** (advanced) changes which point Position refers to: [0.5, 0.5] is the center, and [0, 0] is the top-left of the circle's box.

The outline starts at the top (12 o'clock) and runs clockwise, so the Shape layer's **Stroke End** fills a progress ring the way people expect.

## Tips
- For a ring, set the Shape layer's Color to transparent, give it a Stroke Width, and drive Stroke End with a value from 0 to 1.
- The stroke straddles the outline. Subtract half the Stroke Width from Radius to keep a ring inside its layer.
- A plain filled dot works fine as an Oval layer. Reach for Circle Shape for rings, stroke trims, and combining shapes with Shape Union.

## Coming from Origami
Origami measures shape coordinates from the center of the parent group; here they start at the Shape layer's top-left corner. Anchor is new.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Position**<br>`position` | `point` (distance) | `[50, 50]` | Where the circle's center sits, in points from the Shape layer's top-left corner, y down. |
| **Radius**<br>`radius` | `number` (distance) | `50` | Distance from the center to the edge, in points. 0 or less draws nothing. At least 0. |
| **Anchor**<br>`anchor` | `anchor` · advanced | `[0.5, 0.5]` | Which point of the circle's box Position refers to: [0.5, 0.5] is the center, [0, 0] the top-left corner. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Shape**<br>`shape` | `shape` | The circle as vector path data. Connect it to a Shape layer's Shape property. |

## Examples

### Tap to fill a progress ring

Radius 46 leaves room for the 8 pt stroke, which straddles the outline.

```text
layer ring shape "Ring" @151,387 100x100 shape←ring_shape.shape color=#00000000 strokeColor=#34C759FF strokeWidth=8 strokeEnd←fill.output
patch ring_shape circleShape position=[50,50] radius=46
patch tap_ring interaction layer=@ring
patch filled switch flip←tap_ring.tap
patch fill classicAnimation number←filled.on duration=0.8 curve=cubicInOut
```

### Pulsing live indicator

```text
layer live_dot shape "Live Dot" @183,420 36x36 shape←dot.shape color=#FF3B30FF opacity←fade.output
patch beat repeatingAnimation duration=1 curve=quadraticInOut mirrored=true
patch grow transition<number> progress←beat.progress start=8 end=18
patch dot circleShape position=[18,18] radius←grow.output
patch fade transition<number> progress←beat.progress start=1 end=0.35
```

## Common mistakes

- The ring shows as a solid disc: the Shape layer fills the circle with its Color. Set Color to transparent and give the layer a Stroke Width and Stroke Color.
- Only a quarter of the circle shows, in the layer's corner: Position is still [0, 0], which puts the center on the layer's top-left corner. Set Position to half the layer's size, such as [50, 50] for a 100 × 100 layer.
- Stroke End does nothing: the Shape layer's Stroke Width is 0, which turns the stroke off. Raise it above 0.

## Pairs well with

- [Classic Animation](classicAnimation.md): Animates toward a target value over a set duration with an easing curve whenever the target changes.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.
- [Repeating Animation](repeatingAnimation.md): Runs a progress value from 0 to 1 over and over, either restarting each time or swinging back and forth.
- [Shape Union](shapeUnion.md): Combines two or more shapes into one shape so they share a single fill, stroke, and shadow in one Shape layer.
- [Loop](loop.md): Makes a loop of indices from 0 up to Count minus 1, so layers and patches repeat once per index.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Circle (`builtin.shape.circle`)
