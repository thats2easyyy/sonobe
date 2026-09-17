<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# JSON Array

Builds a JSON array from a list of values, such as tab titles or ids, to read by position or send as data.

| | |
|---|---|
| Type key | `jsonArray` |
| Category | [Data & Network](README.md#data--network) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | array builder, make array, list, create list, build json, items, collection |

## How it works
A JSON Array collects several values into one ordered list, the kind of data a server sends or expects.

- **Item 0**, **Item 1**, and so on are the values, in order. Item 0 becomes the first element. Change the number of items to add or remove ports.
- **Array** is the finished list. It updates on the same frame any item changes.
- Change the patch's type to fill the items with text, numbers, colors, points, JSON, and more. Colors become `"#RRGGBBAA"` text and points become `[x, y]` lists.

## Tips
- Read one element back with Value at Index, and count elements with Array Count.
- Choosing one of a few values by number? Option Picker does that without JSON.
- Set the type to JSON to mix kinds of values, or to nest arrays and objects built by other patches.

## Coming from Origami
Item ports have names and a shared type, so you don't need a Splitter in front of each one.

## Inputs

This patch has no fixed inputs.

### Repeating inputs

**Item 0, Item 1, …** (`item0`, `item1`, …) · `variant` · default `0`

The value stored at this position in the array, counted from 0.

A patch can have 1 to 32 of these, and a new patch starts with 2.

## Outputs

| Output | Type | Description |
|---|---|---|
| **Array**<br>`array` | `json` | The items as one JSON array, in port order: Item 0 is the first element. |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `number` (default), `boolean`, `text`, `color`, `point`, `point3d`, `point4d`, `size`, `anchor`, `index`, `json`, `image`, `video`, `sound`.

## Examples

### Cycle through three headlines

```text
layer headline text "Headline" @24,120 text←current.value
layer next_button rectangle "Next" @24,760 342x52
patch tap_next interaction layer=@next_button
patch step counter increase←tap_next.tap maximumCount=3
patch headlines jsonArray<text>[3] item0="Fresh picks for you" item1="Trending near you" item2="Saved for later"
patch current valueAtIndex<text> array←headlines.array index←step.count
```

### Preview a request body with a list of ids

Nest the array inside an object, then turn it into text to check what would be sent.

```text
layer preview text "Body Preview" @24,120 text←body_text.text
patch ids jsonArray<number>[3] item0=12 item1=40 item2=7
patch body jsonObject<json> key="ids" value←ids.array
patch body_text jsonToText json←body.object
```

## Common mistakes

- Value at Index shows the wrong item: positions count from 0, so the first item is Item 0. Subtract 1 from a count that starts at 1.
- A loop wired into one item gives many arrays instead of one: JSON Array evaluates once per loop index. Use Loop to Array to turn a whole loop into an array.
- Text items show up as numbers or 0: the patch is still set to Number. Change its type to Text before typing words.

## Pairs well with

- [Value at Index](valueAtIndex.md): Reads one element of a JSON array by its position, counted from 0, like the first search result.
- [Array Count](arrayCount.md): Counts how many elements a JSON array has, such as the number of search results or items in a cart.
- [Loop Over Array](loopOverArray.md): Turns a JSON array into a loop, one item per element, so layers repeat for each entry.
- [JSON Object](jsonObject.md): Builds a JSON object with one named value, like {"name": "Ada"}, for request bodies, headers, and nested data.
- [Array Join](arrayJoin.md): Joins several JSON arrays end to end into one array, such as pinned posts followed by the feed.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** JSON Array (`builtin.structure.array.builder`)
