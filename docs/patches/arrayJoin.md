<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Array Join

Joins several JSON arrays end to end into one array, such as pinned posts followed by the feed.

| | |
|---|---|
| Type key | `arrayJoin` |
| Category | [Data & Network](README.md#data--network) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | concatenate, concat, merge arrays, combine lists, append all, join lists, flatten two |

## How it works
Array Join puts arrays one after another to make a single array.

- **Array 1**, **Array 2**, and so on are joined in order: every element of Array 1, then every element of Array 2. Change the number of inputs to add more.
- Nothing is removed or reordered, and nested arrays stay nested.
- An input that holds a single value instead of an array, such as one object, is added as one element. Empty inputs add nothing.
- **Array** is the joined result, updated on the same frame any input changes.

## Tips
- Show pinned items first by putting them in Array 1.
- To add one item when someone taps, Array Append remembers each addition.
- The joined array holds up to 10,000 elements.

## Inputs

This patch has no fixed inputs.

### Repeating inputs

**Array 1, Array 2, …** (`array1`, `array2`, …) · `json` · default `[]`

An array whose elements come after those of the earlier inputs.

A patch can have 2 to 32 of these, and a new patch starts with 2.

## Outputs

| Output | Type | Description |
|---|---|---|
| **Array**<br>`array` | `json` | Every element of the inputs, in port order, as one JSON array. |

## Examples

### Pinned posts above the feed

```text
layer feed group "Feed" @0,100 390x700 layout=column spacing=12
  layer post_title text "Post Title" text←titles.value
patch launch whenPrototypeStarts
patch pinned jsonFile asset="pinned_posts"
patch latest networkRequest request←launch.started url="https://example.com/posts.json"
patch latest_posts valueForKey object←latest.result key="posts"
patch all_posts arrayJoin[2] array1←pinned.json array2←latest_posts.value
patch rows loopOverArray array←all_posts.array
patch titles valueForKey<text> object←rows.items key="title"
```

### Show favorites first, then suggestions

```text
layer total text "Total" @24,80 text←total_count.count
patch favorites jsonArray<text>[2] item0="Tacos" item1="Ramen"
patch suggestions jsonArray<text>[3] item0="Pho" item1="Dumplings" item2="Curry"
patch menu arrayJoin[2] array1←favorites.array array2←suggestions.array
patch total_count arrayCount array←menu.array
```

## Common mistakes

- The joined array has only two elements, each a whole list: the inputs are objects that contain arrays, such as {"items": [...]}. Read each array with Value for Key before joining.
- The items appear in the wrong order: inputs join from top to bottom. Swap the wires, or reorder the ports.

## Pairs well with

- [JSON Array](jsonArray.md): Builds a JSON array from a list of values, such as tab titles or ids, to read by position or send as data.
- [Array Append](arrayAppend.md): Adds an item to the end of a JSON array each time it gets a pulse, remembering everything added so far.
- [Loop Over Array](loopOverArray.md): Turns a JSON array into a loop, one item per element, so layers repeat for each entry.
- [Loop to Array](loopToArray.md): Packs a whole loop into one JSON array you can send, store, or inspect.
- [Network Request](networkRequest.md): Loads JSON, text, images, video, or sound from a URL when it gets a pulse, and reports loading and errors.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Array Join (`builtin.structure.array.join`)
