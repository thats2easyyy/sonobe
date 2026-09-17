<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Edges Unpack

Splits an Edges value into separate top, right, bottom, and left distances.

| | |
|---|---|
| Type key | `edgesUnpack` |
| Category | [Utility](README.md#utility) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | split padding, unpack padding, safe area insets, separate edges, get top, inset values, vec4 unpack |

## How it works
Edges Unpack takes one Edges value, four side distances packed together, and gives you each side on its own port. It's the reverse of Edges.

- **Value** is the Edges value to split, such as a device's safe area or an animated inset.
- **Top**, **Right**, **Bottom**, and **Left** are the distances in points, read clockwise from the top.

## Tips
- Keep controls clear of the home indicator: split the device's safe area and add Bottom to a tab bar's height.
- Any 4D value splits the same way, such as a Transition or Option Picker set to Point 4D.
- One Edges value can set a group's Padding and, through this patch, line up a separate overlay with the same insets.

## Coming from Origami
In Origami, this is Vec4 Unpack with its type changed to Edges. The unnamed input is called Value.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Value**<br>`value` | `point4d` (distance) | `[0, 0, 0, 0]` | The Edges value to split: four distances in points, in top, right, bottom, left order. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Top**<br>`top` | `number` (distance) | The distance from the top edge, in points. |
| **Right**<br>`right` | `number` (distance) | The distance from the right edge, in points. |
| **Bottom**<br>`bottom` | `number` (distance) | The distance from the bottom edge, in points. |
| **Left**<br>`left` | `number` (distance) | The distance from the left edge, in points. |

## Examples

### Keep list gaps equal to the side padding

One Transition animates the list's padding between a compact preset and a roomy one. Edges Unpack reads the left inset from that same value and uses it as the gap between rows.

```text
layer list group "List" @0,120 402x600 layout=column padding←inset.output spacing←sides.left
  layer row_1 rectangle "Row 1" 340x64 cornerRadius=12
  layer row_2 rectangle "Row 2" 340x64 cornerRadius=12
patch tap_list interaction layer=@list
patch roomy switch flip←tap_list.tap
patch pop popAnimation number←roomy.on
patch inset transition<point4d> progress←pop.output start=12,16,12,16 end=24,32,24,32
patch sides edgesUnpack value←inset.output
```

## Common mistakes

- There's no way to wire a group's Padding into Value: patches can't read layer properties. Build the inset with an Edges patch, wire its output into Padding, and unpack that same output here.
- A Size or Point won't connect: Value needs four numbers. Pack the sides you need with Edges first.

## Pairs well with

- [Edges](edges.md): Combines four side distances into one Edges value for padding and insets, in top, right, bottom, left order.
- [Device Info](deviceInfo.md): Reports the screen size, safe area, orientation, dark mode, and input style of the device the prototype runs on.
- [Add](add.md): Adds numbers or vectors together, or joins pieces of text in order.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Edges Unpack
