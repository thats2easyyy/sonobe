<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Loop Remove

Removes the item at a chosen position from a loop each time it gets a pulse.

| | |
|---|---|
| Type key | `loopRemove` |
| Category | [Loops](README.md#loops) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | remove, delete, delete item, remove at index, splice, dismiss, drop item |

## How it works
Loop Remove takes out the item at position **Index** each time **Remove** gets a pulse (a signal that lasts one frame). The loop shrinks by one item per pulse, and the patch remembers what it removed.

- **Loop** is the list to remove from.
- **Index** is the position to remove, counted from 0. If there's no item there, the pulse does nothing.
- **Reset** brings back every removed item.
- **Output Index** counts the result's items from 0, so the positions close up after a removal.

The patch stores the positions it removed, not a copy of the list. If Loop changes, the same positions are removed from the new loop.

## Tips
- Tap a looped row to delete it: wire the looped taps into Loop Option Switch for Index, and into Any for Remove.
- Replace an item: remove it here, then insert the new value at the same Index with Loop Insert.
- When fresh data replaces the list, pulse Reset so old removals don't carry over.

## Coming from Origami
Sonobe labels the outputs Output and Output Index (keys `output` and `outputIndex`), because the input already uses Index. Reset is a Sonobe addition.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Loop**<br>`loop` | `variant` · whole loop | empty loop | The list to remove items from. |
| **Index**<br>`index` | `index` | `0` | The position to remove, counted from 0. A position past the end does nothing. At least 0, step 1. |
| **Remove**<br>`remove` | `pulse` | — | Pulse to remove the item at Index. Every pulse removes one more item. |
| **Reset**<br>`reset` | `pulse` | — | Pulse to bring back every removed item and output Loop as it is. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `variant` · whole loop | Loop without the removed items. |
| **Output Index**<br>`outputIndex` | `index` · whole loop | The position of each result item, counted from 0: [0, 1, 2, …]. |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `number` (default), `boolean`, `text`, `color`, `point`, `point3d`, `point4d`, `size`, `anchor`, `index`, `enum`, `json`, `image`, `video`, `sound`, `gradient`, `shape`, `layerEffect`, `layer`.

## Examples

### Dismiss the top notification

```text
layer stack group "Notifications" @16,80 358x400 layout=column spacing=8
  layer notification text "Notification" text←inbox.output
layer dismiss_button rectangle "Dismiss" @16,780 358x52
patch tap_dismiss interaction layer=@dismiss_button
patch inbox loopRemove<text> loop=loop["Payment"|"Reminder"|"Update"] index=0 remove←tap_dismiss.tap
```

### Tap a row to delete it

Loop Option Switch turns the looped taps into the tapped position, and Any turns them into one pulse. The rows below close up.

```text
layer inbox_list group "Inbox" @16,100 358x600 layout=column spacing=8
  layer row text "Message" text←messages.output
patch tap_row interaction layer=@row
patch tapped_row loopOptionSwitch select←tap_row.tap
patch any_tap loopAny loop←tap_row.tap
patch messages loopRemove<text> loop=loop["Lunch?"|"Invoice"|"Photos"|"Flight"] index←tapped_row.option remove←any_tap.output
```

## Common mistakes

- Tapping any row deletes the first one: looped Taps into Remove only listen to item 0, and Index stays 0. Wire the looped taps into Loop Option Switch for Index and into Any for Remove.
- Remove stops working after a few deletes: Index points past the end of the shorter list. Keep Index below Loop Count, or pick it from the rows that are still showing.
- The wrong items vanish when new data loads: removals are stored as positions and re-applied to the new loop. Pulse Reset when fresh data arrives, for example from Pulse on Change.

## Pairs well with

- [Loop Option Switch](loopOptionSwitch.md): Remembers which item in a loop pulsed most recently, like which tab or card was tapped.
- [Any](loopAny.md): Turns a loop of on/off values into one value that's on when at least one item is on, like any card being tapped.
- [Interaction](interaction.md): Detects presses and taps on a layer, or anywhere on the screen, and reports where the pointer is.
- [Loop Append](loopAppend.md): Adds a value to the end of a loop each time it gets a pulse.
- [Loop Insert](loopInsert.md): Adds a value into a loop at a chosen position each time it gets a pulse.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Loop Remove (`builtin.loop.mutations.delete`)

| Sonobe port | Origami label |
|---|---|
| `output` | Loop |
| `outputIndex` | Index |
