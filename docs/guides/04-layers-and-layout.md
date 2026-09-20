# Layers and layout

Level 1 · Next: [05 Springs and feel](05-springs-and-feel.md)

## What you'll be able to do

- Place a layer exactly where you mean it, using position, anchor and pivot.
- Translate the center-origin coordinates found in Origami tutorials.
- Build rows, columns and grids that size themselves.
- Clip content, and make touch targets big enough to hit.

## The layer tree

Layers are stacked from back to front. Inside a group, the first child is drawn at the back and the last child is drawn on top. Groups can hold layers, and those layers can be groups too.

```
Main (402 × 874)
├─ Background     Color Fill              drawn first, at the back
├─ Feed           Group, column layout
│  ├─ Card 1      Rectangle
│  └─ Card 2      Rectangle
└─ Tab Bar        Group, row layout       drawn last, on top
```

Touches go the other way. When a finger lands, Sonobe checks layers from front to back, and the front-most layer under the finger gets the touch. The touch then bubbles up to that layer's parents, so both Card 1 and Feed hear about a tap on Card 1.

Z Position (in the Transform section) changes that order without moving the layer in the list. Among siblings, a higher Z Position draws in front and gets touches first, and equal values keep the list order. It only reorders layers inside the same group: a lifted card never draws over the Tab Bar unless its group does. Drive it from a patch to lift a card while you drag it.

The layer types you'll use most:

| Layer | Use it for |
|---|---|
| Group | Holding other layers, with optional fill, border, clipping and layout |
| Rectangle, Oval, Shape | Basic shapes and vector paths |
| Text | Words. It sizes itself to fit by default |
| Image, Video, Lottie | Media |
| Color Fill, Gradient | Backgrounds and tints. A Color Fill fills its parent |
| Hit Area | An invisible touch target |
| Text Field | Real typing |
| Clone | A live copy of another layer |
| Shader | A GPU effect written as a fragment shader |
| Component | An instance of a component you made (guide 08) |

## Position and anchor

There's one rule to learn:

> Position is where the layer's anchor point sits, measured from the parent's top-left corner, in points, with Y going down.

Anchor picks which point of the layer Position refers to. It ranges from `0, 0` at the top-left to `1, 1` at the bottom-right. The default is `0, 0`, the same as Figma.

```
 0,0 ──────── 0.5,0 ──────── 1,0
  │                           │
 0,0.5       0.5,0.5        1,0.5
  │                           │
 0,1 ──────── 0.5,1 ──────── 1,1
```

### Example: a card

Position `16, 120`, Size `358, 220`, Anchor `0, 0`. The card's left edge is at x 16 and its right edge at x 374, because 16 + 358 = 374. Its top is at y 120 and its bottom at y 340.

### Example: centering a button

Take a 100 × 100 button on a 402 × 874 screen.

- With Anchor `0, 0`, Position is `151, 387`. That's half the screen minus half the button: 201 − 50 across and 437 − 50 down.
- With Anchor `0.5, 0.5`, Position is `201, 437`, the center of the screen. Now you can resize the button and it stays centered.

### Example: pinned to the bottom right

Take a floating button 16 points in from the right edge and 16 points above the bottom safe area. On iPhone 17 Pro the bottom safe area is 34 points.

Set Anchor `1, 1`, so Position means "where the bottom-right corner goes". Position is `386, 824`: 402 − 16 across, and 874 − 34 − 16 down.

Choose the anchor for the corner you care about, and the numbers become the ones you'd say out loud.

## Pivot: what it spins around

Pivot is separate from anchor. It's the point that Scale and Rotation happen around. The default is `0.5, 0.5`, the center.

- A 358-point-wide card at Scale `1.08` with the default pivot grows about 28.6 points wider (358 × 0.08), roughly 14.3 on each side. It grows in place.
- The same card with Pivot `0, 0` grows to the right and down from its top-left corner, like a window opening.
- A pendulum with Pivot `0.5, 0` swings from the middle of its top edge.

> Anchor answers "where is it?" Pivot answers "what does it spin and grow around?"

## Coming from center origin

Origami Studio, and many older tutorials, measure from the center of the parent and default layers to a center anchor. Sonobe measures from the top-left and defaults to a top-left anchor. Importers convert between the two for you. To follow an old tutorial by hand, keep the anchor at the center and add half the parent's size:

```
sonobe x = origami x + parent width ÷ 2
sonobe y = origami y + parent height ÷ 2
```

A layer at `0, −200` in Origami, on a 402 × 874 screen, becomes Anchor `0.5, 0.5` and Position `201, 237` in Sonobe.

## Size modes

Width Mode and Height Mode decide how big a layer is inside its parent:

| Mode | Size comes from | Example |
|---|---|---|
| Fixed | The number you type | A 358-point card |
| Auto (hug contents) | Whatever is inside | A text layer, or a button that grows with its label |
| Grow (fill space) | The space left over in the parent's layout | A search field next to a Cancel button |
| Percent of parent | A share of the parent's size | An image at 100% width |

Text layers default to Auto, so the layer is always exactly as big as its words.

Positioning is the other layout setting on a child. A Relative child follows its parent's layout. An Absolute child ignores the layout and uses its own Position, which is what you want for a badge on a tab icon or a label over a photo.

Padding only pushes in the children that follow the layout. An Absolute child ignores it too: its Position counts from the parent's top-left corner, and Percent and Grow use the parent's whole size, as in CSS. So a photo set to 100% × 100% at 0, 0 covers its card edge to edge, even when the card has padding for its caption.

Layout runs after patches, so a patch that reads a measured size, like Layer Info or a text layer's Text Size, sees the new value on the next frame.

## Rows, columns and grids

Turn on Layout for a group and it arranges its children for you.

| Setting | Options |
|---|---|
| Layout | None, Row, Column, Grid |
| Spacing Mode | Fixed, Space Between, Space Evenly |
| Spacing | The gap in points. Grid uses it in both directions |
| Padding | Top, right, bottom, left |
| Alignment | Nine positions, like the anchor grid |
| Clip Contents | Hides children that stick out of the group |

Children are placed in layer order. Alignment moves the set of children as a whole, but it never reorders them.

### Example: a tab bar

```
Tab Bar · Row · Space Evenly · Padding 8, 16, 34, 16
┌────────────────────────────────────────────────┐
│      [Home]         [Search]        [Profile]  │
│                                                │  ← 34 points for the home indicator
└────────────────────────────────────────────────┘
```

### Example: a search row

```
Search Row · Row · Spacing 8 · Padding 8, 16, 8, 16
┌────────────────────────────────────────────────┐
│  [ Search field ····················· ] Cancel │
└────────────────────────────────────────────────┘
     Width Mode: Grow                     Width Mode: Auto
```

If Cancel measures 52 points, the field gets the rest: 402 − 16 − 16 − 8 − 52 = 310 points. Change the label to "Done" and the field adjusts by itself.

### Example: a photo grid

Say you want three columns on a 402-point screen, with 3-point gaps and 3 points of padding on each side. Each tile is 130 × 130, because:

```
3 + 130 + 3 + 130 + 3 + 130 + 3 = 402
```

Use Grid layout with Spacing `3` and Padding `0, 3, 0, 3`. Add more tiles and they wrap onto new rows. Guide 07 shows how to make nine tiles from a single layer with a loop.

## Clipping

Clip Contents on a group hides anything that sticks out past the group's bounds. You'll use it for:

- Scroll views, where the group is the window and the content inside moves.
- Cards with photos that shouldn't poke past the rounded corners.
- Reveal animations, where content slides in from outside the group.

Image layers have their own Corner Radius, so a rounded photo doesn't need a mask.

## Hit areas and touch targets

A layer receives touches only when all three of these are true:

1. Enabled is on.
2. Opacity is above 0.
3. Receives Touches is on.

That leads to some practical recipes:

- For an invisible tap target, use a Hit Area layer. A rectangle at opacity 0 ignores touches. A Hit Area is invisible in the prototype, and Sonobe draws it as a translucent overlay while you edit so you can see where it is.
- To make a small icon easier to hit, give it Hit Slop. A 24 × 24 icon with Hit Slop `10` has a 44 × 44 touch target (24 + 10 + 10).
- To let touches pass through a decoration, like a gradient over a photo, turn off its Receives Touches.
- To see what's tappable, turn on "show hit targets" in the Viewer.

## Try it

1. Place a 200 × 56 button, horizontally centered, with its bottom edge 100 points above the bottom safe area on iPhone 17 Pro. Use Anchor `0.5, 1`. The answer is Position `201, 740`.
2. Rotate a square 45 degrees around its top-left corner.
3. Build the search row. Change Cancel's text and watch the field resize.
4. Build the three-column photo grid with 3-point gaps.
5. Put an 18 × 18 close icon in the top-right corner of a card, and make it comfortable to tap.

## Common mistakes

- Mixing up anchor and pivot. If a layer jumps to a new spot when you only meant to change what it rotates around, you changed the anchor.
- Using opacity 0 for a tap target. Use a Hit Area or Hit Slop.
- Expecting layout to move an absolute child. Absolute means "ignore the layout".
- Typing arithmetic into a size to fill the leftover space. Use Grow, and the layout redoes the math every time something changes.
- Leaving a transparent group over the whole screen. It catches every touch meant for the layers behind it. Turn off its Receives Touches.
- Reading a measured size on the same frame you changed it. Layout results arrive one frame later.
