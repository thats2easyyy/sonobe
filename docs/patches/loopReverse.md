<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Loop Reverse

Flips a loop so its last item comes first.

| | |
|---|---|
| Type key | `loopReverse` |
| Category | [Loops](README.md#loops) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | reverse, reverse order, backwards, flip order, newest first, invert order |

## How it works
Loop Reverse takes a whole loop (a list of values that makes patches and layers repeat once per item) and outputs the same items in the opposite order. The first item becomes the last.

- **Loop** is the loop to flip. A single value counts as a one-item loop.
- **Output** has the same number of items, so an Index loop from before still lines up with it.

Change the patch's type to reverse text, colors, images, points, and more.

## Tips
- Show the newest entry first: build the list with Loop Append, then reverse it for display.
- Reverse the loop that drives content, such as Text or Color, and let a Layout group place the rows.
- To reverse a JSON array instead of a loop, use Array Reverse.

## Coming from Origami
Origami's output port is unlabeled. Sonobe labels it Output.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Loop**<br>`loop` | `variant` · whole loop | empty loop | The loop to put in reverse order. A single value counts as a one-item loop. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `variant` · whole loop | The same items with the last one first. It always has as many items as Loop. |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `number` (default), `boolean`, `text`, `color`, `point`, `point3d`, `point4d`, `size`, `anchor`, `index`, `enum`, `json`, `image`, `video`, `sound`, `gradient`, `shape`, `layerEffect`, `layer`.

## Examples

### Show the newest lap first

Each tap appends the current time; the reversed loop puts the latest lap at the top.

```text
layer lap_button rectangle "Lap" @16,780 358x52
layer lap_list group "Laps" @16,100 358x640 layout=column spacing=8
  layer lap_row text "Lap Time" text←newest_first.output
patch clock time
patch tap_lap interaction layer=@lap_button
patch laps loopAppend value←clock.time append←tap_lap.tap
patch newest_first loopReverse loop←laps.output
```

## Common mistakes

- The order doesn't change: Loop is wired to a single value, which is a one-item loop. Wire a whole loop, such as Loop Builder's Loop or Loop Over Array's Items.
- Rows move but their content stays put: the reversed loop drives Position instead of the content. Reverse the loop that feeds Text or Color, and let a Layout group place the rows.

## Pairs well with

- [Loop Append](loopAppend.md): Adds a value to the end of a loop each time it gets a pulse.
- [Loop Builder](loopBuilder.md): Collects several values of one type, like names, colors, or images, into a loop that repeats layers once per value.
- [Loop Over Array](loopOverArray.md): Turns a JSON array into a loop, one item per element, so layers repeat for each entry.
- [Array Reverse](arrayReverse.md): Outputs a JSON array's elements in the opposite order, like showing the newest message first.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Loop Reverse (`builtin.loop.mutations.reverse`)
