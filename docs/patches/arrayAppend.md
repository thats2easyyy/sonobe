<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Array Append

Adds an item to the end of a JSON array each time it gets a pulse, remembering everything added so far.

| | |
|---|---|
| Type key | `arrayAppend` |
| Category | [Data & Network](README.md#data--network) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | push, add to list, add item, insert at end, collect, accumulate, record, history |

## How it works
Array Append keeps a growing list. Each pulse (a signal that lasts one frame) on **Append** adds the current **Item** to the end.

- **Array** is the starting list. Leave it empty to start from nothing.
- **Item** is what gets added. Its value is captured at the moment of the pulse; changing it later doesn't change items already added.
- **Append** adds one item per pulse.
- **Reset** removes everything you appended and goes back to Array.
- **Output** is Array followed by every appended item.

When Array itself changes, such as new data arriving, the appended items are cleared and the list starts again from the new Array. Restarting the prototype also clears them.

Change the patch's type to append text, numbers, colors, points, JSON, and more.

## Tips
- Count the list with Array Count, or show it with Loop Over Array.
- To add a whole array at once, use Array Join.
- The list holds up to 10,000 appended items.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Array**<br>`array` | `json` | `[]` | The starting list; when it changes, previously appended items are cleared. |
| **Item**<br>`item` | `variant` | `0` | The value to add, captured on the frame Append fires. Its type follows the patch's type. |
| **Append**<br>`append` | `pulse` | — | Pulse to add Item to the end of the list. |
| **Reset**<br>`reset` | `pulse` | — | Pulse to remove every appended item and go back to Array. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `json` | Array followed by every item appended since the last reset, restart, or change to Array. |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `number` (default), `boolean`, `text`, `color`, `point`, `point3d`, `point4d`, `size`, `anchor`, `index`, `json`, `image`, `video`, `sound`.

## Examples

### Save each color you land on

```text
layer swatch rectangle "Swatch" @95,200 200x200 cornerRadius=24 color←swatch_color.value
layer count_label text "Saved Count" @24,440 text←saved_count.count
layer clear_button rectangle "Clear" @24,760 342x52
patch tap_swatch interaction layer=@swatch
patch tap_clear interaction layer=@clear_button
patch step counter increase←tap_swatch.tap maximumCount=3
patch palette jsonArray<color>[3] item0="#FF3B30FF" item1="#34C759FF" item2="#007AFFFF"
patch swatch_color valueAtIndex<color> array←palette.array index←step.count
patch saved arrayAppend<color> item←swatch_color.value append←tap_swatch.tap reset←tap_clear.tap
patch saved_count arrayCount array←saved.output
```

### Add a reply to a chat thread

Each tap on Send appends the same reply, and Loop Over Array makes one bubble per message.

```text
layer thread group "Thread" @0,100 390x600 layout=column spacing=8
  layer bubble text "Message" text←message_rows.items
layer send_button rectangle "Send" @24,760 342x52
patch tap_send interaction layer=@send_button
patch seed jsonArray<text>[2] item0="Still on for lunch?" item1="Yes! 12:30?"
patch thread_items arrayAppend<text> array←seed.array item="Sounds good!" append←tap_send.tap
patch message_rows loopOverArray array←thread_items.output
```

## Common mistakes

- Every tap adds the item twice or the list resets by itself: Array is wired to data that keeps changing, so the list restarts from it. Wire a stable starting list, or leave Array empty.
- The list only ever has one item: Append is wired to a state such as Down that stays on. A held state appends once; wire the Tap pulse so each tap counts.
- Items vanish when the prototype restarts: appended items live only while the prototype runs. Put permanent items in Array instead.

## Pairs well with

- [Array Count](arrayCount.md): Counts how many elements a JSON array has, such as the number of search results or items in a cart.
- [Loop Over Array](loopOverArray.md): Turns a JSON array into a loop, one item per element, so layers repeat for each entry.
- [Interaction](interaction.md): Detects presses and taps on a layer, or anywhere on the screen, and reports where the pointer is.
- [Array Index Of](arrayIndexOf.md): Finds where an item sits in a JSON array and whether it's there at all, such as checking if a post is saved.
- [Array Reverse](arrayReverse.md): Outputs a JSON array's elements in the opposite order, like showing the newest message first.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Array Append (`builtin.structure.array.append`)
