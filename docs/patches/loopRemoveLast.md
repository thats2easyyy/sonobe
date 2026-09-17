<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Loop Remove Last

Removes a loop's last item each time it gets a pulse, like undoing the latest addition.

| | |
|---|---|
| Type key | `loopRemoveLast` |
| Category | [Loops](README.md#loops) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | pop, remove last, undo last, delete last, drop last, stack pop |

## How it works
Loop Remove Last takes the last item off a loop each time **Remove Last** gets a pulse (a signal that lasts one frame). It works like undo for a list you're adding to.

- **Loop** is the list to shorten.
- **Remove Last** removes one item from the end. On an empty list it does nothing.
- **Reset** brings back every removed item.
- **Index** (output) counts the result's items from 0.

The patch stores how many items it removed, not a copy of the list. If Loop changes, that many items come off the end of the new loop.

## Tips
- Undo: wire Loop Append's Output into Loop, and an Undo button's Tap into Remove Last.
- Keep a fixed length: insert a new item at the front with Loop Insert and pulse Remove Last on the same event.
- Removing from the front or the middle? Use Loop Remove with an Index.

## Coming from Origami
Sonobe labels the loop output Output. Reset is a Sonobe addition.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Loop**<br>`loop` | `variant` · whole loop | empty loop | The list to take items off the end of. |
| **Remove Last**<br>`removeLast` | `pulse` | — | Pulse to remove the last item. Does nothing when the list is empty. |
| **Reset**<br>`reset` | `pulse` | — | Pulse to bring back every removed item and output Loop as it is. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `variant` · whole loop | Loop without the items removed from its end. |
| **Index**<br>`index` | `index` · whole loop | The position of each result item, counted from 0: [0, 1, 2, …]. |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `number` (default), `boolean`, `text`, `color`, `point`, `point3d`, `point4d`, `size`, `anchor`, `index`, `enum`, `json`, `image`, `video`, `sound`, `gradient`, `shape`, `layerEffect`, `layer`.

## Examples

### Keep only the five latest readings

Each tick inserts a reading at the front and removes one from the end, so the meter always shows five bars.

```text
layer meter group "Meter" @16,300 358x120 layout=row spacing=4
  layer bar rectangle "Bar" 24x120 opacity←latest.output
patch tick repeatingPulse interval=0.5
patch reading random randomize←tick.tick start=0.2 end=1
patch history loopInsert loop=loop[0|0|0|0|0] value←reading.value index=0 insert←tick.tick
patch latest loopRemoveLast loop←history.output removeLast←tick.tick
```

## Common mistakes

- Undo can't remove items you just added: Loop Remove Last comes before Loop Append in the chain. Wire Loop Append's Output into this patch's Loop and show this patch's result.
- The list keeps growing even with Remove Last: it's driven by a state such as Greater Than, which fires once when it turns on and not again while it stays on. Pulse Remove Last on the same event that adds items.

## Pairs well with

- [Loop Append](loopAppend.md): Adds a value to the end of a loop each time it gets a pulse.
- [Loop Insert](loopInsert.md): Adds a value into a loop at a chosen position each time it gets a pulse.
- [Repeating Pulse](repeatingPulse.md): Sends a pulse over and over at a steady interval, like a metronome.
- [Interaction](interaction.md): Detects presses and taps on a layer, or anywhere on the screen, and reports where the pointer is.
- [Loop Count](loopCount.md): Counts how many items a loop has, for sizing containers, showing totals, or keeping an index in range.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Loop Remove Last (`builtin.loop.mutations.remove`)

| Sonobe port | Origami label |
|---|---|
| `output` | Loop |
