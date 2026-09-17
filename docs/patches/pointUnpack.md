<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Point Unpack

Splits a 2D point, such as a touch position, into separate X and Y numbers.

| | |
|---|---|
| Type key | `pointUnpack` |
| Category | [Utility](README.md#utility) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Search terms | split point, get x, get y, unpack xy, coordinates, vec2 unpack, point to numbers, separate x and y, decompose point |

## How it works
Point Unpack takes one 2D value apart.

- **Value** is the point to split. Any two-number value works: a position, an anchor, a size, or a velocity.
- **X** is the first number: the horizontal part, or the width of a size.
- **Y** is the second number: the vertical part, or the height of a size.

## Tips
- Touch positions are in points from the top-left of the screen, and Y grows downward.
- Make a horizontal slider: unpack a touch position, keep X, and pack it back into a point with a fixed Y.
- For sizes, Size Unpack gives the same numbers labeled Width and Height.

## Coming from Origami
Same patch. Origami leaves the input unlabeled; Sonobe calls it Value.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Value**<br>`value` | `point` | `[0, 0]` | The 2D value to split: a position, anchor, size, or velocity. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **X**<br>`x` | `number` | The first number: the horizontal part, or the width of a size. |
| **Y**<br>`y` | `number` | The second number: the vertical part (grows downward), or the height of a size. |

## Examples

### Tilt a card with your finger's X

Dragging across the screen tilts the card from −12° to 12°.

```text
layer card rectangle "Card" @66,300 270x270 cornerRadius=24 rotation←tilt.output
patch touch interaction
patch touch_xy pointUnpack value←touch.position
patch finger_progress progress value←touch_xy.x start=0 end=402 clampToRange=true
patch tilt transition<number> progress←finger_progress.progress start=-12 end=12
```

### Keep a slider thumb on its track

The thumb follows your finger's X, stays within the track, and never leaves its line.

```text
layer track rectangle "Track" @16,420 370x8 cornerRadius=4 hitSlop=16
layer thumb oval "Thumb" 40x40 anchor=[0.5,0.5] position←thumb_position.output
patch touch_track interaction layer=@track
patch touch_xy pointUnpack value←touch_track.position
patch thumb_x clamp value←touch_xy.x min=16 max=386
patch thumb_position point x←thumb_x.output y=424
```

## Common mistakes

- An effect runs backward when you move your finger up: Y grows downward, so moving up makes Y smaller. Swap Start and End on the Progress or Transition that reads Y.
- A cable from a 3D point won't connect: Point Unpack takes two numbers and a 3D point has three. Use Point 3D Unpack.

## Pairs well with

- [Point](point.md): Combines an X and a Y number into one point for a layer's Position, Anchor, Pivot, or any other 2D input.
- [Interaction](interaction.md): Detects presses and taps on a layer, or anywhere on the screen, and reports where the pointer is.
- [Progress](progress.md): Converts a number from any range into progress, where Start gives 0 and End gives 1.
- [Clamp](clamp.md): Keeps a value between a minimum and a maximum, so scrolling, dragging, or progress can't go past its limits.
- [Math Expression](mathExpression.md): Calculates numbers from a formula you type, creating an input for each variable and an output for each result.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** Point Unpack (`builtin.getpoint`)
- **Also imports:** `builtin.getPoint`

| Sonobe port | Origami label |
|---|---|
| `value` | Input |
