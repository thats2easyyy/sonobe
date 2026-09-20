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
- **Out of Range** decides what an index past the end, or below 0, gives:
  - **Skip** (the default) leaves it out, so it adds nothing to Output.
  - **Clamp** takes the nearest end: the first item below 0, the last item past the end.
  - **Wrap** counts around: in a loop of 3, index 3 is item 0 and −1 is item 2.
  - **Use Fallback** gives Fallback instead.
- **Fallback** is what Use Fallback gives. Every mode except Skip also gives it for an index that isn't a number, or when Loop is empty.
- **Output** is the picked items. With any mode except Skip, it has exactly one item per index.
- **Output Index** is each picked item's position in Output: 0, 1, 2, ….

## Tips
- In a carousel, wire the current page number into Index to show that page's title.
- To read each copy's neighbor, like the card above, feed Index the loop's own Index plus 1 and set Out of Range to Use Fallback. The last copy gets Fallback instead of nothing, so everything downstream keeps running.
- An empty Output empties everything it feeds: a patch that gets an empty loop runs 0 times, and a layer bound to one draws no copies. When that isn't what you want, choose a mode other than Skip.
- To keep or drop items by a condition instead of by position, use Loop Filter.

## Coming from Origami
The inputs are called Input and Index Loop in Origami. With a single index, Origami's Index output repeats the selected index; here Output Index always counts positions in Output, so it's 0. Out of Range and Fallback are Sonobe additions.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Loop**<br>`loop` | `variant` · whole loop | empty loop | The loop to pick items from. |
| **Index**<br>`index` | `number` · whole loop | `0` | Which position to pick, counted from 0; a loop of indices picks several in that order. Out of Range decides what an index past the end gives. step 1. |
| **Out of Range**<br>`outOfRange` | `enum` | `skip` | What an index past the end, or below 0, gives: Skip leaves it out, Clamp takes the nearest end, Wrap counts around, and Use Fallback gives Fallback. |
| **Fallback**<br>`fallback` | `variant` | `0` | What an out-of-range index gives with Use Fallback. Every mode except Skip also gives it for an index that isn't a number, or when Loop is empty. |

**Out of Range options**

- **Skip** (`skip`): Leave it out, so Output can be shorter than Index, or empty.
- **Clamp** (`clamp`): Take the first item below 0 and the last item past the end.
- **Wrap** (`wrap`): Count around the loop: past the end starts again at the first item, and −1 is the last.
- **Use Fallback** (`fallback`): Give Fallback instead.

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `variant` · whole loop | The picked items, in the order of Index. With any mode except Skip, one item per index. |
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

### Dim a row while the row below it is open

Each row reads its neighbor's state at Index + 1. Use Fallback gives the last row false instead of nothing, so all four rows keep drawing.

```text
layer row rectangle "Row" position←grid.position size←grid.size cornerRadius=12 opacity←dim.output
patch rows loop count=4
patch grid gridLayout index←rows.index columns=1 origin=16,120 width=370 itemHeight=72 spacing=8
patch tap_row interaction layer=@row
patch open switch flip←tap_row.tap
patch below add[2] value1←rows.index value2=1
patch below_open loopSelect<boolean> loop←open.on index←below.output outOfRange=fallback fallback=false
patch dim transition<number> progress←below_open.output start=1 end=0.4
```

## Common mistakes

- Output is empty and connected layers vanish: the index is past the end (a loop of 3 has indices 0 to 2) or below 0. Set Out of Range to Clamp or Use Fallback, or keep the index between 0 and Loop Count − 1.
- A feedback loop through Loop Select never starts: on the first frame Delay One Frame passes one value, not a list, so every index past 0 is out of range and Output stays empty. Set Out of Range to Use Fallback, so each index gets a value from the start.
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
