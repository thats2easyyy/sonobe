<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Edges

Combines four side distances into one Edges value for padding and insets, in top, right, bottom, left order.

| | |
|---|---|
| Type key | `edges` |
| Category | [Utility](README.md#utility) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | padding, insets, edge insets, margins, safe area, top right bottom left, trbl, inset |

## How it works
Edges packs four distances, one for each side of a box, into a single value. The sides go clockwise from the top: **top, right, bottom, left**, the same order as CSS padding.

- **Top**, **Right**, **Bottom**, and **Left** are distances in points.
- **Output** is the packed value. Wire it into a group's Padding, a Transition set to Point 4D, or any other 4D input.

Padding is the space between a group's edges and its children. It applies only while the group's Layout is Row, Column, or Grid.

## Tips
- Animate one side at a time: drive Bottom from a Transition and type the other three in.
- For the same inset on every side, wire one number straight into Padding. It fills all four sides.
- To add your own spacing to a device's safe area, split the safe area with Edges Unpack, add to each side, and pack the result here.

## Coming from Origami
In Origami, Edges is the Vec4 patch with its type changed. Origami doesn't document its side order, so check each side after importing.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Top**<br>`top` | `number` (distance) | `0` | Distance from the top edge in points. |
| **Right**<br>`right` | `number` (distance) | `0` | Distance from the right edge in points. |
| **Bottom**<br>`bottom` | `number` (distance) | `0` | Distance from the bottom edge in points. |
| **Left**<br>`left` | `number` (distance) | `0` | Distance from the left edge in points. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `point4d` (distance) | The four distances as one Edges value, in top, right, bottom, left order. |

## Examples

### Give a card roomier padding when it opens

The card's Layout is Column, so Padding applies. The top and bottom insets grow with the spring while the sides stay at 20.

```text
layer card group "Card" @16,120 370x240 layout=column color=#FFFFFFFF cornerRadius=20 padding←inset.output
  layer title text "Title" "Weekend in Lisbon"
patch tap_card interaction layer=@card
patch toggle switch flip←tap_card.tap
patch pop popAnimation number←toggle.on
patch space transition<number> progress←pop.output start=16 end=40
patch inset edges top←space.output right=20 bottom←space.output left=20
```

## Common mistakes

- Changing Edges doesn't move anything: the group's Layout is None, so Padding is ignored. Set Layout to Row, Column, or Grid.
- Padding typed as four numbers lands on the wrong sides: the order is top, right, bottom, left, not top, left, bottom, right. Use Edges, whose ports name each side.

## Pairs well with

- [Edges Unpack](edgesUnpack.md): Splits an Edges value into separate top, right, bottom, and left distances.
- [Device Info](deviceInfo.md): Reports the screen size, safe area, orientation, dark mode, and input style of the device the prototype runs on.
- [Pop Animation](popAnimation.md): Springs its output toward a target value whenever the target changes, with a feel set by Bounciness and Speed.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.
- [Option Picker](optionPicker.md): Outputs one of several values chosen by an option number, like a different color or title for each tab.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Edges
