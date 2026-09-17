<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Grid Layout

Calculates a position and size for each item so repeated layers fill a grid of evenly sized columns.

| | |
|---|---|
| Type key | `gridLayout` |
| Category | [Loops](README.md#loops) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | grid, columns, tile layout, photo grid, list layout, collection view, arrange items, flow layout |

## How it works
Grid Layout arranges repeated layers in rows and columns. It splits Width into equal columns, fills each row left to right, and starts a new row when one is full.

- **Index** is the item's place in the grid, counted from 0. Wire a Loop's Index here.
- **Columns** is how many items fit in a row. Use 1 for a list.
- **Origin** is the top-left corner of the first item.
- **Width** is the grid's total width, gaps included.
- **Item Height** is how tall each item is.
- **Spacing** is the gap between items, across and down.
- **Position** and **Size** go to the repeated layer's Position and Size.

Positions are measured from the parent layer's top-left corner to each item's top-left corner.

## Tips
- For square tiles, set Item Height to the item width: (Width − Spacing × (Columns − 1)) ÷ Columns.
- The grid's height is rows × Item Height + (rows − 1) × Spacing, where rows is Loop Count ÷ Columns, rounded up.
- A Group with Layout set to Grid also arranges children. Grid Layout gives you numbers you can animate or reuse, like a selection indicator's position.

## Coming from Origami
Origami's Position input is Origin here, and Padding is Spacing. Origami measures from the screen's center; Sonobe measures from the parent's top-left.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Index**<br>`index` | `index` | `0` | The item's place in the grid, counted from 0 left to right and then top to bottom; wire a Loop's Index here. |
| **Columns**<br>`columns` | `number` | `3` | How many items fit in each row; 1 makes a single-column list. At least 1, step 1. |
| **Origin**<br>`origin` | `point` (distance) | `[0, 0]` | The top-left corner of the first item, in points from the parent layer's top-left. |
| **Width**<br>`width` | `number` (distance) | `316` | The grid's total width in points, including the gaps between columns. At least 0. |
| **Item Height**<br>`itemHeight` | `number` (distance) | `100` | The height of every item in points. At least 0. |
| **Spacing**<br>`spacing` | `number` (distance) | `8` | The gap between items in points, used both across and down; 0 makes items touch. At least 0. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Position**<br>`position` | `point` (distance) | The item's top-left corner in its parent's coordinates; wire it into the repeated layer's Position. |
| **Size**<br>`size` | `size` (distance) | The item's width and height in points; wire it into the repeated layer's Size. |

## Examples

### Photo grid with three columns

Nine tiles, 118 points wide, in three rows with 8-point gaps.

```text
layer photo rectangle "Photo" position←grid.position size←grid.size cornerRadius=8
patch photos loop count=9
patch grid gridLayout index←photos.index columns=3 origin=16,120 width=370 itemHeight=118 spacing=8
```

## Common mistakes

- All the items pile up in one spot: Index isn't wired to a loop, so every copy gets index 0. Wire a Loop's Index, or Loop Builder's Index, into Index.
- Items are shifted by half their size: the layer's Anchor isn't top-left, so Position places a different point. Set Anchor to 0,0, or add Anchor × Size to the position.
- The last column runs off the screen: Width is wider than the space you have. Set Width to the screen width minus both margins, for example 402 − 32 = 370.

## Pairs well with

- [Loop](loop.md): Makes a loop of indices from 0 up to Count minus 1, so layers and patches repeat once per index.
- [Loop Builder](loopBuilder.md): Collects several values of one type, like names, colors, or images, into a loop that repeats layers once per value.
- [Interaction](interaction.md): Detects presses and taps on a layer, or anywhere on the screen, and reports where the pointer is.
- [Loop Option Switch](loopOptionSwitch.md): Remembers which item in a loop pulsed most recently, like which tab or card was tapped.
- [Loop Count](loopCount.md): Counts how many items a loop has, for sizing containers, showing totals, or keeping an index in range.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Grid Layout (`origami.gridlayout`)
- **Also imports:** `origami.grid`

| Sonobe port | Origami label |
|---|---|
| `origin` | Position |
| `spacing` | Padding |
