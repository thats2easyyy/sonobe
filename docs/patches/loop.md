<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Loop

Makes a loop of indices from 0 up to Count minus 1, so layers and patches repeat once per index.

| | |
|---|---|
| Type key | `loop` |
| Category | [Loops](README.md#loops) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Search terms | for loop, repeat, range, iterate, duplicate, copies, times, index loop, for each |

## How it works
A Loop counts out positions: a Count of 5 gives the loop 0, 1, 2, 3, 4. A loop is a list of values that travels on one cable, and everything it feeds runs once per item. Wire the index into a layer property, directly or through math, and that layer repeats, one copy per index.

- **Count** is how many indices you get. Decimals round down, and 0 or less makes an empty loop, so connected layers disappear.
- **Index** is the loop of positions, starting at 0.

## Tips
- Multiply Index by 15 and wire it into Rotation to fan the copies out.
- An Interaction on a repeated layer reports once per copy, so each copy can react to its own taps.
- For a different value per copy, like names or images, use Loop Builder, or look values up with Loop Select.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Count**<br>`count` | `number` | `3` | How many indices to make; decimals round down, and 0 or less makes an empty loop. Range 0 to 10000, step 1. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Index**<br>`index` | `index` · whole loop | The loop of positions 0, 1, 2, … up to Count − 1. |

## Examples

### Stack five rows in a list

Loop makes five indices, and a one-column Grid Layout turns them into row positions.

```text
layer row rectangle "Row" position←grid.position size←grid.size cornerRadius=12
patch rows loop count=5
patch grid gridLayout index←rows.index columns=1 origin=16,120 width=370 itemHeight=72 spacing=12
```

### Number each row from 1

Indices start at 0, so Add 1 before showing them as labels.

```text
layer label text "Label" position←grid.position text←plus_one.output
patch rows loop count=5
patch grid gridLayout index←rows.index columns=1 origin=32,144 width=338 itemHeight=72 spacing=12
patch plus_one add[2] value1←rows.index value2=1
```

## Common mistakes

- Only one copy of the layer shows up: every copy sits in the same spot. Put the layer in a Group with Layout turned on, or wire Grid Layout's Position and Size into it.
- Only the text inside a card repeats, stacked in one card, and a drag moves all of it: the loop reaches the card's children, not the card. Link the loop to the card's Repeat instead, and each card gets its own copy of everything inside.
- Labels read 0 to 4 when you expected 1 to 5: indices start at 0. Add 1 before showing an index as a number people read.

## Pairs well with

- [Grid Layout](gridLayout.md): Calculates a position and size for each item so repeated layers fill a grid of evenly sized columns.
- [Loop Builder](loopBuilder.md): Collects several values of one type, like names, colors, or images, into a loop that repeats layers once per value.
- [Loop Select](loopSelect.md): Picks items out of a loop by position, to show the tapped item's details or to reorder a list.
- [Interaction](interaction.md): Detects presses and taps on a layer, or anywhere on the screen, and reports where the pointer is.
- [Loop Count](loopCount.md): Counts how many items a loop has, for sizing containers, showing totals, or keeping an index in range.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** Loop (`builtin.loop`)
