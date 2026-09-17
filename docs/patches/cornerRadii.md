<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Corner Radii

Combines four corner radii into one value so a layer can round each corner by a different amount.

| | |
|---|---|
| Type key | `cornerRadii` |
| Category | [Utility](README.md#utility) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | corner radius, rounded corners, border radius, independent corners, per corner radius, top corners, round corners |

## How it works
Corner Radii packs a rounding amount for each corner into one value. The corners go clockwise from the top left: **top left, top right, bottom right, bottom left**, the same order as CSS border-radius.

- **Top Left**, **Top Right**, **Bottom Right**, and **Bottom Left** are radii in points. 0 is a sharp corner.
- **Output** goes into a layer's Corner Radii property. Rectangles, groups, images, videos, gradients, and shader layers have it.

Once Corner Radii is connected, it replaces the layer's single Corner Radius. Corner Smoothing still applies on top.

## Tips
- Round only the top of a bottom sheet: set Top Left and Top Right, and leave the bottom corners at 0.
- Animate one corner by driving its port from a Transition while the others stay typed in.
- A single number wired into Corner Radii rounds every corner the same, like Corner Radius.

## Coming from Origami
In Origami, this is the Vec4 patch with its type changed to Corner Radius. Origami doesn't document its corner order, so check each corner after importing.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Top Left**<br>`topLeft` | `number` (distance) | `0` | Rounding of the top-left corner in points; 0 is a sharp corner. At least 0. |
| **Top Right**<br>`topRight` | `number` (distance) | `0` | Rounding of the top-right corner in points; 0 is a sharp corner. At least 0. |
| **Bottom Right**<br>`bottomRight` | `number` (distance) | `0` | Rounding of the bottom-right corner in points; 0 is a sharp corner. At least 0. |
| **Bottom Left**<br>`bottomLeft` | `number` (distance) | `0` | Rounding of the bottom-left corner in points; 0 is a sharp corner. At least 0. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `point4d` (distance) | The four radii as one value, in top left, top right, bottom right, bottom left order. |

## Examples

### Give a chat bubble a tail corner

A sent message rounds three corners fully and keeps the bottom-right corner tight, pointing toward the sender.

```text
layer bubble rectangle "Bubble" @150,600 236x64 color=#3478F6FF cornerRadii←bubble_shape.output
patch bubble_shape cornerRadii topLeft=20 topRight=20 bottomRight=6 bottomLeft=20
```

### Square a card's bottom corners as it docks

When you tap, the card springs down onto the toolbar and its bottom corners turn square so it sits flush.

```text
layer toolbar rectangle "Toolbar" @0,791 402x83 color=#FFFFFFFF
layer card rectangle "Card" @16,420 370x220 color=#FFFFFFFF position←dock.output cornerRadii←corners.output
patch tap_card interaction layer=@card
patch toggle switch flip←tap_card.tap
patch pop popAnimation number←toggle.on
patch dock transition<point> progress←pop.output start=16,420 end=16,571
patch bottom transition<number> progress←pop.output start=24 end=0
patch corners cornerRadii topLeft=24 topRight=24 bottomRight←bottom.output bottomLeft←bottom.output
```

## Common mistakes

- Every corner goes sharp the moment you connect Corner Radii: it replaces the layer's Corner Radius, and all four corners start at 0. Type the radius you want into each corner.
- Nothing changes on an oval or text layer: those layers have no Corner Radii. Put the content in a group, turn on Clip Contents, and round the group instead.

## Pairs well with

- [Corner Radii Unpack](cornerRadiiUnpack.md): Splits a Corner Radii value into the radius of each corner: top left, top right, bottom right, and bottom left.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.
- [Pop Animation](popAnimation.md): Springs its output toward a target value whenever the target changes, with a feel set by Bounciness and Speed.
- [Switch](switch.md): Remembers whether something is on or off and changes when it gets a pulse.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Corner Radius
