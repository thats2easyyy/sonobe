<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Loop Count

Counts how many items a loop has, for sizing containers, showing totals, or keeping an index in range.

| | |
|---|---|
| Type key | `loopCount` |
| Category | [Loops](README.md#loops) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Search terms | length, count, how many, number of items, array length, size of loop, len |

## How it works
Loop Count reports the length of whatever you connect, as a plain number.

- **Loop** is any loop, of any type.
- **Count** is how many items it holds. A single value that isn't a loop counts as 1, and an empty loop counts as 0.

## Tips
- Multiply Count by a row height to size a scrolling list's content so every row fits.
- Count what's left after Loop Filter to show how many items match a search or a selection.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Loop**<br>`loop` | `any` · whole loop | empty loop | The loop to count; any type works. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Count**<br>`count` | `number` | How many items the loop has: 1 for a single value, 0 for an empty loop. step 1. |

## Examples

### Caption a grid with its item count

```text
layer photos group "Photos" @16,120 370x400 layout=grid spacing=8
  layer photo rectangle "Photo" 118x118 cornerRadius=8 color←swatches.loop
layer caption text "Caption" @16,540 text←photo_count.count
patch swatches loopBuilder<color>[5] item0=#FF6B6BFF item1=#FFD93DFF item2=#6BCB77FF item3=#4D96FFFF item4=#C77DFFFF
patch photo_count loopCount loop←swatches.loop
```

## Common mistakes

- Count is 1 when you expected many: the cable carries a single value, not a loop. That happens after a patch that reduces a loop, like Loop Select with one index, Any, or Loop Sum. Count the loop before it's reduced.
- Stepping past the last item shows nothing: indices go up to Count − 1, not Count. Subtract 1 before using Count as a maximum index.

## Pairs well with

- [Loop Filter](loopFilter.md): Keeps, drops, or repeats each item of a loop, for filtered lists, selected items, or a value repeated a set number of times.
- [Loop Over Array](loopOverArray.md): Turns a JSON array into a loop, one item per element, so layers repeat for each entry.
- [Loop Builder](loopBuilder.md): Collects several values of one type, like names, colors, or images, into a loop that repeats layers once per value.
- [Clamp](clamp.md): Keeps a value between a minimum and a maximum, so scrolling, dragging, or progress can't go past its limits.
- [Counter](counter.md): Keeps a whole-number count that pulses increase, decrease, or jump to a set number, with optional wrap-around.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** Loop Count (`builtin.loop.count`)

| Sonobe port | Origami label |
|---|---|
| `count` | Output |
