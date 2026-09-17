<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Subarray

Takes a run of elements from a JSON array, such as the first five results or one page of a feed.

| | |
|---|---|
| Type key | `subarray` |
| Category | [Data & Network](README.md#data--network) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | slice, take first, top n, range of items, page of results, limit, portion, sublist |

## How it works
Subarray copies part of **Array**.

- **Start** is the position of the first element to take, counted from 0.
- **Length** is how many elements to take.
- **Output** holds the elements from Start onward, up to Length of them.

It never fails: if fewer elements remain, you get what's there, and a Start past the end or a Length of 0 gives an empty array. Fractions round down.

## Tips
- Show the top results: Start 0, Length 5.
- Page through a feed: set Start to the page number times the page size, and Length to the page size.
- Array Count on the output tells you how many elements you actually got.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Array**<br>`array` | `json` | `[]` | The JSON array to take elements from. |
| **Start**<br>`start` | `index` | `0` | Position of the first element to take, counted from 0; past the end gives an empty array. At least 0, step 1. |
| **Length**<br>`length` | `number` | `3` | How many elements to take; 0 gives an empty array, and extra length stops at the end. At least 0, step 1. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `json` | Up to Length elements of Array, beginning at Start. |

## Examples

### Show only the top five results

```text
layer results group "Results" @0,100 390x600 layout=column spacing=12
  layer result_name text "Result Name" text←names.value
patch launch whenPrototypeStarts
patch search networkRequest request←launch.started url="https://example.com/search?q=parks"
patch all_results valueForKey object←search.result key="results"
patch top_five subarray array←all_results.value start=0 length=5
patch rows loopOverArray array←top_five.output
patch names valueForKey<text> object←rows.items key="name"
```

### Page through a feed five posts at a time

```text
layer feed group "Feed" @0,100 390x600 layout=column spacing=12
  layer post_title text "Post Title" text←titles.value
layer next_button rectangle "Next Page" @24,760 342x52
patch tap_next interaction layer=@next_button
patch page counter increase←tap_next.tap maximumCount=4
patch page_start mathExpression expression="start = page * 5" page←page.count
patch posts jsonFile asset="posts"
patch this_page subarray array←posts.json start←page_start.start length=5
patch rows loopOverArray array←this_page.output
patch titles valueForKey<text> object←rows.items key="title"
```

## Common mistakes

- The first result is missing: Start counts from 0. Use Start 0 to begin with the first element.
- The last page shows fewer items than expected and nothing breaks: Subarray stops at the end of the array. Use Array Count on the output to hide an empty Next button.

## Pairs well with

- [Loop Over Array](loopOverArray.md): Turns a JSON array into a loop, one item per element, so layers repeat for each entry.
- [Counter](counter.md): Keeps a whole-number count that pulses increase, decrease, or jump to a set number, with optional wrap-around.
- [Array Count](arrayCount.md): Counts how many elements a JSON array has, such as the number of search results or items in a cart.
- [Value for Key](valueForKey.md): Reads one named field from a JSON object, such as a product's name or price.
- [Array Join](arrayJoin.md): Joins several JSON arrays end to end into one array, such as pinned posts followed by the feed.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Subarray (`builtin.structure.subarray`)

| Sonobe port | Origami label |
|---|---|
| `start` | Location |
