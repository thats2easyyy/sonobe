<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Loop Select

Picks items out of a loop by position, to show the tapped item's details or to reorder a list.

| | |
|---|---|
| Type key | `loopSelect` |
| Category | [Loops](README.md#loops) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Search terms | item at index, get item, pick from loop, nth item, lookup, gather, reorder, array index, select reorder |

## How it works
Loop Select looks items up by their position in a loop. Give it one index to pull out one item, or a loop of indices to pick several, in any order, with repeats allowed.

- **Loop** is the list to pick from.
- **Index** is which position to take, counted from 0. A loop of indices like 2, 1, 0 returns those items in that order.
- **Output** is the picked items.
- **Output Index** is each picked item's position in Output: 0, 1, 2, ….

An index past the end, or below 0, is skipped and adds nothing to Output.

## Tips
- In a carousel, wire the current page number into Index to show that page's title.
- To keep or drop items by a condition instead of by position, use Loop Filter.

## Coming from Origami
The inputs are called Input and Index Loop in Origami. With a single index, Origami's Index output repeats the selected index; here Output Index always counts positions in Output, so it's 0.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Loop**<br>`loop` | `variant` · whole loop | empty loop | The loop to pick items from. |
| **Index**<br>`index` | `number` · whole loop | `0` | Which position to pick, counted from 0; a loop of indices picks several in that order, and out-of-range values are skipped. step 1. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `variant` · whole loop | The picked items, in the order of Index. |
| **Output Index**<br>`outputIndex` | `index` · whole loop | Each picked item's position in Output: 0, 1, 2, …. |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `number` (default), `boolean`, `text`, `color`, `point`, `point3d`, `point4d`, `size`, `anchor`, `index`, `enum`, `json`, `image`, `video`, `sound`, `gradient`, `shape`, `layerEffect`, `layer`.

## Examples

### Show the name of the tapped card

Loop Option Switch remembers which card was tapped, and Loop Select looks up its name.

```text
layer card rectangle "Card" position←grid.position size←grid.size cornerRadius=16
layer title text "Title" @16,480 text←chosen.output
patch names loopBuilder<text>[3] item0="Tokyo" item1="Lisbon" item2="Oaxaca"
patch grid gridLayout index←names.index columns=3 origin=16,120 width=370 itemHeight=120 spacing=8
patch tap_card interaction layer=@card
patch which loopOptionSwitch select←tap_card.tap
patch chosen loopSelect<text> loop←names.loop index←which.option
```

### Open a panel only when the second row is tapped

```text
layer row rectangle "Row" position←grid.position size←grid.size cornerRadius=12
layer panel rectangle "Panel" @0,474 402x400 cornerRadius=24 opacity←pop.output
patch rows loop count=3
patch grid gridLayout index←rows.index columns=1 origin=16,120 width=370 itemHeight=72 spacing=8
patch tap_row interaction layer=@row
patch second_tap loopSelect<boolean> loop←tap_row.tap index=1
patch open switch turnOn←second_tap.output
patch pop popAnimation number←open.on
```

## Common mistakes

- Output is empty and connected layers vanish: the index is past the end (a loop of 3 has indices 0 to 2) or below 0. Keep the index between 0 and Loop Count − 1, for example with Clamp.
- Only one item comes out when you wanted the list reordered: Index is a single number, so it picks one item. Wire a loop of indices, for example from a Loop Builder set to Number, to pick several.

## Pairs well with

- [Loop Option Switch](loopOptionSwitch.md): Remembers which item in a loop pulsed most recently, like which tab or card was tapped.
- [Loop Builder](loopBuilder.md): Collects several values of one type, like names, colors, or images, into a loop that repeats layers once per value.
- [Interaction](interaction.md): Detects presses and taps on a layer, or anywhere on the screen, and reports where the pointer is.
- [Counter](counter.md): Keeps a whole-number count that pulses increase, decrease, or jump to a set number, with optional wrap-around.
- [Loop Filter](loopFilter.md): Keeps, drops, or repeats each item of a loop, for filtered lists, selected items, or a value repeated a set number of times.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** Loop Select (`builtin.loop.selectreorder`)
- **Also imports:** `builtin.loop.selectReorder`

| Sonobe port | Origami label |
|---|---|
| `loop` | Input |
| `index` | Index Loop |
| `output` | Loop |
| `outputIndex` | Index |
