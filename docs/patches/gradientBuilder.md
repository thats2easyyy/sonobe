<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Gradient Builder

Builds a linear, radial, or angular gradient from color stops, ready for a layer's Gradient property.

| | |
|---|---|
| Type key | `gradientBuilder` |
| Category | [Color](README.md#color) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | gradient, linear gradient, radial gradient, angular gradient, conic gradient, color stops, multi-color fill, shimmer, ombre |

## How it works
Gradient Builder blends several colors across a layer. Each stop pairs a **Color** with a **Stop**, its position from 0 at Start to 1 at End.

- **Type**: Linear blends along a line, Radial spreads out in a circle, and Angular sweeps around a center like a clock hand.
- **Start** and **End** are points in the layer, from [0, 0] top-left to [1, 1] bottom-right. Linear runs from Start to End. Radial and Angular center on Start; End marks the outer edge for Radial and the starting direction for Angular.
- **Ratio** stretches a radial gradient sideways: 2 makes it twice as wide as tall.
- **Stop 1…N** and **Color 1…N** are the stops. Add or remove stops on the patch (1 to 32); only their positions set the order.
- **Gradient** drives a Gradient layer, or a Rectangle's or Oval's Gradient, which replaces its Color.

## Tips
- Animate stop positions or colors, not the gradient itself, for shimmers and shifting moods.
- Positions below 0 or above 1 sit beyond Start or End, so a highlight can slide in from off the edge.
- To fade out, end on a color with alpha 0. The blend doesn't turn gray on the way.

## Coming from Origami
Each Origami stop is one port holding a color and a position; here it's a Stop port plus a Color port. The output is named Gradient, and Angular is new.

## Inputs

This patch adds ports based on how it's set up, so these tables list only the ports it always has.

| Input | Type | Default | Description |
|---|---|---|---|
| **Type**<br>`type` | `enum` | `linear` | The gradient's shape: along a line, out from a center, or around a center. |
| **Start**<br>`start` | `anchor` | `[0.5, 0]` | Where the gradient begins, as a point in the layer from [0, 0] top-left to [1, 1] bottom-right; the center for Radial and Angular. step 0.01. |
| **End**<br>`end` | `anchor` | `[0.5, 1]` | Where the gradient ends, in the same units as Start; the outer edge for Radial and the starting direction for Angular. step 0.01. |
| **Ratio**<br>`ratio` | `number` · advanced | `1` | How much wider than tall a Radial gradient is: 1 is a circle, 2 is twice as wide; Linear and Angular ignore it. At least 0.01, step 0.01. |

**Type options**

- **Linear** (`linear`): Blends along the line from Start to End.
- **Radial** (`radial`): Spreads out in a circle centered on Start, reaching the last stop at End.
- **Angular** (`angular`): Sweeps clockwise around Start, beginning in the direction of End.

## Outputs

| Output | Type | Description |
|---|---|---|
| **Gradient**<br>`gradient` | `gradient` | The finished gradient, for a Gradient layer or a shape layer's Gradient property. |

## Examples

### A sunset background with three stops

```text
layer background gradient "Background" @0,0 402x874 gradient←sunset.gradient
patch sunset gradientBuilder[3] stop1=0 color1=#FF5F6DFF stop2=0.55 color2=#FFC371FF stop3=1 color3=#47CACCFF
```

### Shimmer across a loading placeholder

Stop positions run from below 0 to above 1, so the highlight enters and leaves past the edges.

```text
layer placeholder rectangle "Placeholder" @16,160 370x96 cornerRadius=12 gradient←shimmer.gradient
patch clock repeatingAnimation duration=1.4 curve=linear
patch sweep mathExpression expression="lead = progress * 1.6 - 0.3; middle = progress * 1.6 - 0.15; tail = progress * 1.6" progress←clock.progress
patch shimmer gradientBuilder[3] start=[0,0.5] end=[1,0.5] stop1←sweep.lead color1=#E5E5EAFF stop2←sweep.middle color2=#F7F7F8FF stop3←sweep.tail color3=#E5E5EAFF
```

### A soft radial glow behind an icon

```text
layer glow gradient "Glow" @101,322 200x200 gradient←halo.gradient
layer icon oval "Icon" @171,392 60x60 color=#FFFFFFFF
patch halo gradientBuilder[2] type=radial start=[0.5,0.5] end=[1,0.5] stop1=0 color1=#5B5FEFFF stop2=1 color2=#5B5FEF00
```

## Common mistakes

- A radial gradient looks like a small dot: End is close to Start, and End marks the outer edge. For a glow that fills a square layer, set Start to [0.5, 0.5] and End to [1, 0.5].
- The layer shows one flat color: Start and End are the same point, so a Linear gradient has no direction. Move End away from Start.
- Two colors meet in a hard line instead of blending: their stops share the same position. Spread the Stop values apart.

## Pairs well with

- [Hex Color](hexColor.md): Turns a hex code such as #FF5F6D into a color you can wire into any color property.
- [HSL Color](hslColor.md): Builds a color from hue, saturation, lightness, and alpha between 0 and 1, for rainbows, tints, and shades.
- [Repeating Animation](repeatingAnimation.md): Runs a progress value from 0 to 1 over and over, either restarting each time or swinging back and forth.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.
- [Math Expression](mathExpression.md): Calculates numbers from a formula you type, creating an input for each variable and an output for each result.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Gradient Builder (`builtin.gradient.builder`)

| Sonobe port | Origami label |
|---|---|
| `gradient` | Color |
