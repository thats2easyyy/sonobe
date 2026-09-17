<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Loop Filter

Keeps, drops, or repeats each item of a loop, for filtered lists, selected items, or a value repeated a set number of times.

| | |
|---|---|
| Type key | `loopFilter` |
| Category | [Loops](README.md#loops) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | filter, where, keep if, remove items, repeat items, subset, replicate, compress |

## How it works
Loop Filter builds a new loop from an old one. For each item, Include says how many times it appears in the result: 0 drops it, 1 keeps it, and 3 repeats it three times.

- **Loop** is the list to filter.
- **Include** is a loop of on/off values, where on keeps an item and off drops it, or a loop of counts. A single number applies to every item, so one item with Include 5 makes five copies.
- **Output** is the resulting loop, in the original order.
- **Index** is each result item's position: 0, 1, 2, ….

Counts round down, and negative counts drop the item.

## Tips
- Build a search filter: check each name against the query, then wire the results into Include.
- To keep items by position rather than by a condition, use Loop Select with the positions you want.
- Count the kept items with Loop Count, or pick one with Loop Select.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Loop**<br>`loop` | `variant` · whole loop | empty loop | The loop to filter or repeat. |
| **Include**<br>`include` | `number` · whole loop | `1` | How many times each item appears: on or 1 keeps it, off or 0 drops it, and 3 repeats it three times. At least 0, step 1. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `variant` · whole loop | The kept and repeated items, in their original order. |
| **Index**<br>`index` | `index` · whole loop | Each result item's position in Output: 0, 1, 2, …. |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `number` (default), `boolean`, `text`, `color`, `point`, `point3d`, `point4d`, `size`, `anchor`, `index`, `enum`, `json`, `image`, `video`, `sound`, `gradient`, `shape`, `layerEffect`, `layer`.

## Examples

### Show a four-star rating

One star color repeated four times makes four copies in a row layout.

```text
layer stars group "Stars" @16,120 240x44 layout=row spacing=8
  layer star rectangle "Star" 40x40 cornerRadius=8 color←filled.output
patch star_color loopBuilder<color>[1] item0=#FFC400FF
patch filled loopFilter<color> loop←star_color.loop include=4
```

### Collect tapped swatches into a tray

```text
layer swatch rectangle "Swatch" position←grid.position size←grid.size cornerRadius=12 color←swatches.loop opacity←dim.output
layer tray group "Tray" @16,500 370x60 layout=row spacing=8
  layer chip oval "Chip" 40x40 color←picked_colors.output
patch swatches loopBuilder<color>[4] item0=#FF6B6BFF item1=#FFD93DFF item2=#6BCB77FF item3=#4D96FFFF
patch grid gridLayout index←swatches.index columns=4 origin=16,120 width=370 itemHeight=88 spacing=8
patch tap_swatch interaction layer=@swatch
patch picked switch flip←tap_swatch.tap
patch dim transition<number> progress←picked.on start=0.5 end=1
patch picked_colors loopFilter<color> loop←swatches.loop include←picked.on
```

## Common mistakes

- The filtered list flashes and disappears after a tap: Include is wired to Tap, which is on for one frame. Store each item's choice in a Switch and wire its On into Include.
- Filtered copies land in the wrong places: the result has fewer items, so the original loop's indices no longer line up. Position the filtered copies with this patch's Index output, not the original Index.

## Pairs well with

- [Loop Builder](loopBuilder.md): Collects several values of one type, like names, colors, or images, into a loop that repeats layers once per value.
- [Loop Count](loopCount.md): Counts how many items a loop has, for sizing containers, showing totals, or keeping an index in range.
- [Loop Select](loopSelect.md): Picks items out of a loop by position, to show the tapped item's details or to reorder a list.
- [Loop Sum](loopSum.md): Adds up every item in a loop into one total, like a cart price, a count of checked items, or a content height.
- [Switch](switch.md): Remembers whether something is on or off and changes when it gets a pulse.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Loop Filter (`builtin.loop.select`)

| Sonobe port | Origami label |
|---|---|
| `loop` | Input |
| `output` | Loop |
