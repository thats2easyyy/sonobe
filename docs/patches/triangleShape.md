<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Triangle Shape

Makes a triangle shape from three corner points, for play icons, arrows, and tooltip tails in a Shape layer.

| | |
|---|---|
| Type key | `triangleShape` |
| Category | [Shapes](README.md#shapes) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | triangle, arrow, play icon, chevron, tooltip tail, polygon, three points |

## How it works
Triangle Shape joins three points with straight lines and closes the outline. Connect its **Shape** output to a Shape layer's Shape property to draw it.

- **First Point**, **Second Point**, and **Third Point** are the corners, in points from the Shape layer's top-left corner, with y going down.
- The outline runs from First to Second to Third and back to First. The order doesn't change the fill, but a trimmed stroke (Stroke End) starts at First Point and follows that order.
- The default points make an upward-pointing triangle that fills a 100 × 100 layer.

## Tips
- Animate one point with a Transition set to Point to flip an arrow or morph a play icon.
- Pair it with Rounded Rectangle Shape in Shape Union for a tooltip or chat bubble tail.
- When all three points fall on one line, the fill disappears, but a stroke still draws the line.

## Coming from Origami
Origami measures the points from the center of the parent group; here they start at the Shape layer's top-left corner.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **First Point**<br>`firstPoint` | `point` (distance) | `[50, 0]` | The first corner, in points from the Shape layer's top-left corner, y down. The outline starts here. |
| **Second Point**<br>`secondPoint` | `point` (distance) | `[100, 100]` | The second corner, in points from the Shape layer's top-left corner. |
| **Third Point**<br>`thirdPoint` | `point` (distance) | `[0, 100]` | The third corner, in points from the Shape layer's top-left corner. The outline closes from here back to First Point. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Shape**<br>`shape` | `shape` | The triangle as vector path data. Connect it to a Shape layer's Shape property. |

## Examples

### Dropdown arrow that flips when opened

Moving the tip across the base flips the arrow from pointing down to pointing up.

```text
layer menu_header rectangle "Menu Header" @16,100 370x64
layer arrow shape "Arrow" @340,120 24x24 shape←arrow_shape.shape color=#3C3C43FF hitTest=false
patch tap_header interaction layer=@menu_header
patch open switch flip←tap_header.tap
patch pop popAnimation number←open.on bounciness=0 speed=16
patch tip transition<point> progress←pop.output start=[12,17] end=[12,7]
patch arrow_shape triangleShape firstPoint=[5,12] secondPoint=[19,12] thirdPoint←tip.output
```

## Common mistakes

- The triangle is invisible: the three points are the same or fall on one straight line, so there's no area to fill. Move one point off that line.
- The triangle shows up far from where you expected: the points are measured from the Shape layer's top-left corner, not from the screen or the layer's center. Keep them within the layer's size.

## Pairs well with

- [Shape Union](shapeUnion.md): Combines two or more shapes into one shape so they share a single fill, stroke, and shadow in one Shape layer.
- [Rounded Rectangle Shape](roundedRectangleShape.md): Makes a rectangle shape with rounded corners, for cards, pills, and buttons you want to stroke, trim, morph, or combine.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.
- [Pop Animation](popAnimation.md): Springs its output toward a target value whenever the target changes, with a feel set by Bounciness and Speed.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Triangle (`builtin.shape.triangle`)
