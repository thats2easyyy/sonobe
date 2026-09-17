<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Loop Append

Adds a value to the end of a loop each time it gets a pulse.

| | |
|---|---|
| Type key | `loopAppend` |
| Category | [Loops](README.md#loops) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | loop insert at end, append, push, add to end, add item, add to list |

## How it works
Loop Append adds **Value** to the end of a loop each time **Append** gets a pulse (a signal that lasts one frame). The loop grows by one item per pulse, and the patch remembers what it added.

- **Loop** is the starting list. Leave it unconnected to start empty.
- **Value** is copied on the pulse frame, so later changes don't affect items already added.
- **Reset** forgets every appended item and outputs Loop as it is.
- **Index** (output) counts the result's items from 0.

The patch stores its appended items, not a copy of the list. If Loop changes, the appended items stay at the end of the new loop.

## Tips
- Chats, carts, and lap lists: wire a button's Tap into Append.
- Show the newest item first by sending the result through Loop Reverse.
- Add undo or delete by wiring this patch's Output into Loop Remove Last or Loop Remove. Put the removing patch after the adding one.
- To send the list somewhere, pack it with Loop to Array.

## Coming from Origami
This is Origami's Loop Insert at End. Its pulse port, Insert at End, is keyed `append`, and the loop output is labeled Output. Reset is a Sonobe addition.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Loop**<br>`loop` | `variant` · whole loop | empty loop | The starting list. Leave it unconnected to start empty and build the list with pulses. |
| **Value**<br>`value` | `variant` | `0` | The value to add, copied on the frame Append fires. |
| **Append**<br>`append` | `pulse` | — | Pulse to add Value to the end. Every pulse adds one more item. |
| **Reset**<br>`reset` | `pulse` | — | Pulse to forget every appended item and output Loop as it is. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `variant` · whole loop | Loop followed by every appended value, oldest first. |
| **Index**<br>`index` | `index` · whole loop | The position of each result item, counted from 0: [0, 1, 2, …]. |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `number` (default), `boolean`, `text`, `color`, `point`, `point3d`, `point4d`, `size`, `anchor`, `index`, `enum`, `json`, `image`, `video`, `sound`, `gradient`, `shape`, `layerEffect`, `layer`.

## Examples

### Record lap times

```text
layer lap_button rectangle "Lap" @16,780 170x52
layer clear_button rectangle "Clear" @204,780 170x52
layer lap_list group "Laps" @16,100 358x640 layout=column spacing=8
  layer lap_row text "Lap Time" text←laps.output
patch clock time
patch tap_lap interaction layer=@lap_button
patch tap_clear interaction layer=@clear_button
patch laps loopAppend value←clock.time append←tap_lap.tap reset←tap_clear.tap
```

### Add dots and undo them

Loop Remove Last comes after Loop Append, so Undo can remove anything you added.

```text
layer add_button rectangle "Add" @16,780 170x52
layer undo_button rectangle "Undo" @204,780 170x52
layer dot_row group "Dots" @16,120 358x44 layout=row spacing=8
  layer dot oval "Dot" 32x32 color←shown.output
patch tap_add interaction layer=@add_button
patch tap_undo interaction layer=@undo_button
patch added loopAppend<color> value=#007AFFFF append←tap_add.tap
patch shown loopRemoveLast<color> loop←added.output removeLast←tap_undo.tap
```

## Common mistakes

- Items you just added can't be removed: the Loop Remove or Loop Remove Last patch comes before Loop Append, so it never sees them. Wire Loop Append's Output into the removing patch and show that patch's result.
- Every new item shows an old value: Value comes through a Delay or another patch that updates a frame later. Make sure Value is already right on the frame Append fires.
- Nothing gets added: Append is wired to a state that stays on, which fires only once. Wire a Tap or another pulse into Append.

## Pairs well with

- [Interaction](interaction.md): Detects presses and taps on a layer, or anywhere on the screen, and reports where the pointer is.
- [Loop Remove Last](loopRemoveLast.md): Removes a loop's last item each time it gets a pulse, like undoing the latest addition.
- [Loop Remove](loopRemove.md): Removes the item at a chosen position from a loop each time it gets a pulse.
- [Loop Reverse](loopReverse.md): Flips a loop so its last item comes first.
- [Loop to Array](loopToArray.md): Packs a whole loop into one JSON array you can send, store, or inspect.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Loop Insert at End (`builtin.loop.mutations.append`)

| Sonobe port | Origami label |
|---|---|
| `output` | Loop |
| `append` | Insert at End |
