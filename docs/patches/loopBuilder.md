<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Loop Builder

Collects several values of one type, like names, colors, or images, into a loop that repeats layers once per value.

| | |
|---|---|
| Type key | `loopBuilder` |
| Category | [Loops](README.md#loops) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Search terms | array, list, list of values, collection, items, values, data list, array literal |

## How it works
Loop Builder turns separate values into one loop, a list of values that travels on a single cable. Everything the loop feeds runs once per item, and a layer bound to it repeats once per item.

- **Item 0, Item 1, …** are the values, in order, counted from 0. Add or remove items to change the length.
- **Loop** is the list of values.
- **Index** is the matching positions: 0, 1, 2, ….

Every item shares one type, such as number, text, color, or image. Choose it from the patch's type menu.

## Tips
- Wire Index into Grid Layout to place the copies in rows and columns.
- Feed one layer from two Loop Builders, such as titles and colors, and each copy gets its matching pair.
- For data from JSON or the network, use Loop Over Array instead.

## Inputs

This patch has no fixed inputs.

### Repeating inputs

**Item 0, Item 1, …** (`item0`, `item1`, …) · `variant` · default `0`

One value in the loop; Item 0 comes first.

A patch can have 1 to 128 of these, and a new patch starts with 3.

## Outputs

| Output | Type | Description |
|---|---|---|
| **Loop**<br>`loop` | `variant` · whole loop | The loop of item values, in order. |
| **Index**<br>`index` | `index` · whole loop | The position of each item: 0, 1, 2, …. |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `number` (default), `boolean`, `text`, `color`, `point`, `point3d`, `point4d`, `size`, `anchor`, `index`, `enum`, `json`, `image`, `video`, `sound`, `gradient`, `shape`, `layerEffect`, `layer`.

## Examples

### List three names

A text layer bound to a loop of text repeats once per name inside a column layout.

```text
layer list group "List" @16,120 370x300 layout=column spacing=12
  layer name text "Name" text←names.loop
patch names loopBuilder<text>[3] item0="Ada" item1="Grace" item2="Katherine"
```

### Give each swatch its own color

```text
layer row group "Row" @16,200 370x100 layout=row spacing=10
  layer swatch rectangle "Swatch" 116x100 cornerRadius=16 color←colors.loop
patch colors loopBuilder<color>[3] item0=#FF6B6BFF item1=#FFD93DFF item2=#6BCB77FF
```

## Common mistakes

- Items don't match the positions you expect: the first input is Item 0, not Item 1. Count from 0 when you look items up with Loop Select or match them to Loop Option Switch.
- Only the text inside a card repeats, stacked in one card, and a drag moves all of it: the loop reaches the card's children, not the card. Link the loop to the card's Repeat instead, and each card gets its own copy of everything inside.
- Copies repeat values or show the wrong pairs: two loops of different lengths feed the same layer, and the shorter one wraps around. Give every loop that feeds one layer the same number of items.

## Pairs well with

- [Loop](loop.md): Makes a loop of indices from 0 up to Count minus 1, so layers and patches repeat once per index.
- [Loop Select](loopSelect.md): Picks items out of a loop by position, to show the tapped item's details or to reorder a list.
- [Grid Layout](gridLayout.md): Calculates a position and size for each item so repeated layers fill a grid of evenly sized columns.
- [Loop Filter](loopFilter.md): Keeps, drops, or repeats each item of a loop, for filtered lists, selected items, or a value repeated a set number of times.
- [Loop Count](loopCount.md): Counts how many items a loop has, for sizing containers, showing totals, or keeping an index in range.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** Loop Builder (`builtin.loop.builder`)
