<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Line Shape

Makes a straight or smoothed line through two or more points, for dividers, connectors, progress tracks, and charts.

| | |
|---|---|
| Type key | `lineShape` |
| Category | [Shapes](README.md#shapes) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | line, divider, connector, polyline, segment, line chart, path through points, stroke line |

## How it works
Line Shape draws a path through points for a Shape layer. A line has no area to fill, so the Shape layer shows it only when its **Stroke Width** is above 0.

- **Start Point** and **End Point** set a single straight line, in points from the Shape layer's top-left corner, y down.
- **Points** (advanced) takes a JSON list instead, like `[[0, 80], [60, 20], [120, 50]]`, for a line chart or a zigzag. Each point can be `[x, y]` or `{ "x": 10, "y": 20 }`.
- **Closed** (advanced) joins the last point back to the first, so a list of points becomes a polygon you can fill.
- **Smoothing** (advanced) curves the line through the points instead of making sharp corners.

The stroke starts at the first point, so animating the Shape layer's **Stroke End** from 0 to 1 draws the line on.

## Tips
- For a connector between two moving layers, wire each layer's position into Start Point and End Point.
- Set the Shape layer's Line Cap to Round for soft ends on dividers and progress tracks.
- To chart a loop of points, turn it into a list with Loop to Array and wire that into Points.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Start Point**<br>`startPoint` | `point` (distance) | `[0, 50]` | Where the line begins, in points from the Shape layer's top-left corner, y down. |
| **End Point**<br>`endPoint` | `point` (distance) | `[100, 50]` | Where the line ends, in points from the Shape layer's top-left corner. |
| **Points**<br>`points` | `json` · advanced | `[]` | A list of points to draw through in order, such as [[0, 80], [60, 20], [120, 50]]. With 2 or more valid points, it replaces Start Point and End Point. |
| **Closed**<br>`closed` | `boolean` · advanced | `false` | When on, joins the last point back to the first, making a closed outline you can fill. |
| **Smoothing**<br>`smoothing` | `number` (progress) · advanced | `0` | 0 draws straight segments between points; higher values curve the line smoothly through every point, up to 1. Range 0 to 1, step 0.01. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Shape**<br>`shape` | `shape` | The line as vector path data. Connect it to a Shape layer's Shape property and give the layer a Stroke Width. |

## Examples

### Slingshot band that follows your finger

The band layer covers the screen at @0,0, so its coordinates match the screen's. Receives Touches is off so the band never blocks taps.

```text
layer band shape "Band" @0,0 402x874 shape←band_line.shape color=#00000000 strokeColor=#FF9500FF strokeWidth=4 hitTest=false
layer stone oval "Stone" @181,600 40x40 position←pull.position
patch pull drag layer=@stone startPosition=[181,600]
patch stone_center add<point>[2] value1←pull.position value2=[20,20]
patch band_line lineShape startPoint=[201,480] endPoint←stone_center.output
```

### Line chart that draws itself on launch

```text
layer chart shape "Chart" @16,300 370x160 shape←trend.shape color=#00000000 strokeColor=#007AFFFF strokeWidth=3 strokeEnd←reveal.progress
patch trend lineShape points=[[0,130],[60,90],[120,110],[185,50],[245,70],[310,25],[370,40]] smoothing=0.6
patch launch whenPrototypeStarts
patch reveal wait start←launch.started duration=1.2
```

## Common mistakes

- The line doesn't show up: Shape layers start with Stroke Width 0, and a line has nothing to fill. Set Stroke Width to 2 or more and choose a Stroke Color.
- A chart line turns into a dark filled area: the Shape layer fills the region between the line and a straight edge from the last point back to the first. Set the Shape layer's Color to transparent.
- Points seems to be ignored: it has fewer than 2 valid points, so Start Point and End Point are used instead. Make each item [x, y] or an object with numeric x and y.

## Pairs well with

- [Drag](drag.md): Lets people drag a layer around and outputs where it should be, with optional bounds, axis lock, and momentum.
- [Wait](wait.md): Starts a timer on a pulse and turns Done on once the duration has passed, reporting progress along the way.
- [Loop to Array](loopToArray.md): Packs a whole loop into one JSON array you can send, store, or inspect.
- [Classic Animation](classicAnimation.md): Animates toward a target value over a set duration with an easing curve whenever the target changes.
- [Shape Union](shapeUnion.md): Combines two or more shapes into one shape so they share a single fill, stroke, and shadow in one Shape layer.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

Sonobe-native: Origami has no matching patch.
