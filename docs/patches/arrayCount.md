<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Array Count

Counts how many elements a JSON array has, such as the number of search results or items in a cart.

| | |
|---|---|
| Type key | `arrayCount` |
| Category | [Data & Network](README.md#data--network) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | array length, size of list, number of items, how many, item count, length, count items |

## How it works
Array Count outputs how many elements **Array** holds.

- Only the top level counts: an element that is itself an array counts as 1.
- Anything that isn't an array, including an object or empty data, counts as 0.
- **Count** updates on the same frame Array changes.

## Tips
- A count wired into a layer's Enabled turns the layer on only while the array has items.
- The last element's position is Count − 1, because positions count from 0.
- To count an object's entries, use Get Keys first. To count a loop, use Loop Count.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Array**<br>`array` | `json` | `[]` | The JSON array to count; anything that isn't an array counts as 0. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Count**<br>`count` | `number` | The number of top-level elements in Array, 0 or more. step 1. |

## Examples

### Show the results list only when there are results

A count above 0 reads as on, so the list turns on when results arrive.

```text
layer results_list group "Results" @0,120 390x640 enabled←result_count.count
layer count_label text "Result Count" @24,80 text←result_count.count
patch launch whenPrototypeStarts
patch search networkRequest request←launch.started url="https://example.com/search?q=tacos"
patch results valueForKey object←search.result key="results"
patch result_count arrayCount array←results.value
```

### Wrap a carousel after the last photo

```text
layer photo image "Photo" @0,120 390x390 image←current_photo.value
patch tap_photo interaction layer=@photo
patch album jsonFile asset="album"
patch photo_count arrayCount array←album.json
patch step counter increase←tap_photo.tap maximumCount←photo_count.count
patch current_photo valueAtIndex<image> array←album.json index←step.count
```

## Common mistakes

- Count is 0 for data that clearly has items: the data is an object that holds the array, such as {"results": [...]}. Read the array with Value for Key first.
- Value at Index with Count shows nothing: positions stop at Count − 1. Subtract 1 to reach the last element.

## Pairs well with

- [Array Append](arrayAppend.md): Adds an item to the end of a JSON array each time it gets a pulse, remembering everything added so far.
- [Value at Index](valueAtIndex.md): Reads one element of a JSON array by its position, counted from 0, like the first search result.
- [Counter](counter.md): Keeps a whole-number count that pulses increase, decrease, or jump to a set number, with optional wrap-around.
- [Loop Over Array](loopOverArray.md): Turns a JSON array into a loop, one item per element, so layers repeat for each entry.
- [Get Keys](getKeys.md): Lists the names of every entry in a JSON object as an array of text, so you can show or loop over them.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Array Count (`builtin.structure.count`)
