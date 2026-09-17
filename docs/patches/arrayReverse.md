<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Array Reverse

Outputs a JSON array's elements in the opposite order, like showing the newest message first.

| | |
|---|---|
| Type key | `arrayReverse` |
| Category | [Data & Network](README.md#data--network) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | reverse list, flip order, backwards, newest first, invert order, reverse array |

## How it works
Array Reverse gives back **Array** with its elements in reverse order: the last element becomes the first.

- Only the top level is reversed; arrays inside elements keep their own order.
- Anything that isn't an array gives an empty array.
- **Output** updates on the same frame Array changes.

## Tips
- Lists built with Array Append are oldest first. Reverse them to show the newest item on top.
- To reverse a loop instead of an array, use Loop Reverse.
- For largest-to-smallest order, Array Sort with Descending is more direct.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Array**<br>`array` | `json` | `[]` | The JSON array to reverse. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `json` | A copy of Array with its elements in reverse order. |

## Examples

### Newest message on top

```text
layer thread group "Thread" @0,100 390x600 layout=column spacing=8
  layer bubble text "Message" text←message_rows.items
layer send_button rectangle "Send" @24,760 342x52
patch tap_send interaction layer=@send_button
patch messages arrayAppend<text> item="On my way!" append←tap_send.tap
patch newest_first arrayReverse array←messages.output
patch message_rows loopOverArray array←newest_first.output
```

### Show the last step of a flow

```text
layer last_step text "Last Step" @24,120 text←last.value
patch steps jsonArray<text>[3] item0="Welcome" item1="Permissions" item2="All set"
patch reversed arrayReverse array←steps.array
patch last valueAtIndex<text> array←reversed.output index=0
```

## Common mistakes

- Nothing changes on screen: the list is a loop, not a JSON array. Use Loop Reverse, or reverse the array before Loop Over Array.
- Output is empty: Array holds an object that contains the list. Read the list with Value for Key first.

## Pairs well with

- [Array Append](arrayAppend.md): Adds an item to the end of a JSON array each time it gets a pulse, remembering everything added so far.
- [Array Sort](arraySort.md): Sorts a JSON array from smallest to largest or the reverse, optionally by a field such as price or name.
- [Loop Over Array](loopOverArray.md): Turns a JSON array into a loop, one item per element, so layers repeat for each entry.
- [Loop Reverse](loopReverse.md): Flips a loop so its last item comes first.
- [Value at Index](valueAtIndex.md): Reads one element of a JSON array by its position, counted from 0, like the first search result.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Array Reverse (`builtin.structure.array.reverse`)
