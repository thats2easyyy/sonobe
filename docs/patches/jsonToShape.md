<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# JSON to Shape

Builds a shape from a JSON list of drawing commands, for custom paths that come from data, scripts, or other patches.

| | |
|---|---|
| Type key | `jsonToShape` |
| Category | [Shapes](README.md#shapes) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | path from json, json path, custom path, draw path, path commands, shape from data, bezier from json |

## How it works
JSON to Shape draws a path from a list of commands, like giving directions to a pen. It's handy when the path comes from data, a JavaScript patch, or a network request.

**JSON** is an object with a `"path"` list. Each command has a `"type"`:
- `moveTo` lifts the pen and moves it to `"point"`, starting a new outline.
- `lineTo` draws a straight line to `"point"`.
- `curveTo` draws a curve to `"point"`, bending toward `"control1"` and `"control2"`.
- `closePath` draws a line back to where the outline started.

Points can be `{ "x": 10, "y": 20 }` or `[10, 20]`, in points from the Shape layer's top-left corner, y down.

**Coordinate Space** scales every point: x by its width and y by its height. Author a path from 0 to 1 and set Coordinate Space to the layer's size so the path resizes with the layer.

**Error** and **Error Message** report the first command that couldn't be read.

## Tips
- Animate the Shape layer's Stroke End from 0 to 1 to draw the path on.
- For straight polylines and charts, Line Shape is simpler. For art copied from a design tool, use SVG Path Shape.

## Coming from Origami
The JSON format matches Origami's. Origami's curveTo form, where `"curveTo"` is the end point and `"curveFrom"` and `"point"` are the control points, still works. `closePath` and `[x, y]` points are new, and Origami's text Error output is split into Error and Error Message.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **JSON**<br>`json` | `json` | `{"path":[{"type":"moveTo","point":{"x":50,"y":0}},{"type":"lineTo","point":{"x":100,"y":100}},{"type":"lineTo","point":{"x":0,"y":100}},{"type":"closePath"}]}` | The path to draw: an object with a "path" list of commands (moveTo, lineTo, curveTo, closePath), each with its points. |
| **Coordinate Space**<br>`coordinateSpace` | `size` | `[1, 1]` | Multiplies every x by the width and every y by the height. [1, 1] keeps coordinates in points; the layer's size suits coordinates from 0 to 1. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Shape**<br>`shape` | `shape` | The path as vector data. Connect it to a Shape layer's Shape property. |
| **Error**<br>`error` | `boolean` | True when the JSON couldn't be fully read. The shape still holds every command before the problem. |
| **Error Message**<br>`errorMessage` | `text` | Explains which command has a problem and why; empty when there's no problem. |

## Examples

### Checkmark that draws itself on tap

The path is written from 0 to 1 and scaled to the 64 pt layer with Coordinate Space.

```text
layer check shape "Check" @169,400 64x64 shape←check_shape.shape color=#00000000 strokeColor=#34C759FF strokeWidth=6 strokeEnd←draw.output
patch check_shape jsonToShape json={"path":[{"type":"moveTo","point":[0.2,0.55]},{"type":"lineTo","point":[0.42,0.75]},{"type":"lineTo","point":[0.8,0.3]}]} coordinateSpace=[64,64]
patch tap_check interaction layer=@check
patch checked switch flip←tap_check.tap
patch draw classicAnimation number←checked.on duration=0.35 curve=cubicOut
```

## Common mistakes

- Nothing draws and Error Message says the JSON couldn't be read: the text isn't valid JSON, often because of a missing comma or a key without quotes. Fix the JSON and watch Error Message clear.
- The path is tiny: the coordinates run from 0 to 1, but Coordinate Space is still [1, 1]. Set Coordinate Space to the size you want, such as the Shape layer's size.
- An outline's stroke leaves a notch where it should close: a lineTo back to the start doesn't join the corner. End the outline with closePath instead.

## Pairs well with

- [JavaScript](javascript.md): Runs a JavaScript file whose code declares its own inputs and outputs, for logic other patches can't express.
- [Network Request](networkRequest.md): Loads JSON, text, images, video, or sound from a URL when it gets a pulse, and reports loading and errors.
- [JSON File](jsonFile.md): Loads a JSON file from your project, such as a product list or mock feed, so prototypes work without a server.
- [Classic Animation](classicAnimation.md): Animates toward a target value over a set duration with an easing curve whenever the target changes.
- [Line Shape](lineShape.md): Makes a straight or smoothed line through two or more points, for dividers, connectors, progress tracks, and charts.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** JSON to Shape (`builtin.structure.shape`)

| Sonobe port | Origami label |
|---|---|
| `errorMessage` | Error |
