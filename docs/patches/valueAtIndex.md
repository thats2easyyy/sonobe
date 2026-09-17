<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Value at Index

Reads one element of a JSON array by its position, counted from 0, like the first search result.

| | |
|---|---|
| Type key | `valueAtIndex` |
| Category | [Data & Network](README.md#data--network) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | object at index, get value from array, array item, nth item, element at, array lookup, get item, list item |

## How it works
Value at Index picks one element out of a JSON array, the way `list[2]` does in code.

- **Array** is the list to read from.
- **Index** is the element's position, counted from 0: 0 is the first element.
- **Value** is that element. Change the patch's type to read it as text, a number, a color, a point, an image, or JSON.
- **Found** is true when the position exists. When it doesn't (past the end, negative, or Array isn't an array), Value is empty: 0, empty text, a transparent color, or nothing.

The patch reads values best effort: the text "12" reads as the number 12, `"#FF3B30"` reads as a color, and `[x, y]` or `{"x": …, "y": …}` reads as a point.

## Tips
- To show every element, use Loop Over Array instead of one Value at Index per element.
- For nested data such as `results.0.title`, Value at Path does several steps at once.
- Wire Found into a layer's Enabled to hide a placeholder when there's nothing to show.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Array**<br>`array` | `json` | `[]` | The JSON array to read from. |
| **Index**<br>`index` | `number` | `0` | The element's position, counted from 0; negative or past-the-end positions output an empty Value. At least 0, step 1. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Value**<br>`value` | `variant` | The element at Index, read as the patch's type; empty when Found is false. |
| **Found**<br>`found` | `boolean` | True when Array is an array and Index is one of its positions. |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `json` (default), `number`, `boolean`, `text`, `color`, `point`, `point3d`, `point4d`, `size`, `anchor`, `index`, `image`, `video`, `sound`.

## Examples

### Show the title of the first search result

```text
layer title text "First Result" @24,120 text←title.value
patch launch whenPrototypeStarts
patch search networkRequest request←launch.started url="https://example.com/search?q=tacos"
patch results valueForKey object←search.result key="results"
patch first valueAtIndex array←results.value index=0
patch title valueForKey<text> object←first.value key="name"
```

### Step through a color palette

```text
layer swatch rectangle "Swatch" @95,300 200x200 cornerRadius=24 color←swatch_color.value
patch tap_swatch interaction layer=@swatch
patch step counter increase←tap_swatch.tap maximumCount=3
patch palette jsonArray<color>[3] item0="#FF3B30FF" item1="#34C759FF" item2="#007AFFFF"
patch swatch_color valueAtIndex<color> array←palette.array index←step.count
```

## Common mistakes

- It shows the second item instead of the first: positions count from 0. Use Index 0 for the first element.
- Value is 0 or empty even though the data is there: the element is an object, not a number or text. Set the type to JSON and read the field with Value for Key, or use Value at Path.
- Nothing shows when the prototype starts: the request hasn't finished, so Array is still empty. Use Found or the request's Loading to show a placeholder.

## Pairs well with

- [Value for Key](valueForKey.md): Reads one named field from a JSON object, such as a product's name or price.
- [Array Count](arrayCount.md): Counts how many elements a JSON array has, such as the number of search results or items in a cart.
- [Counter](counter.md): Keeps a whole-number count that pulses increase, decrease, or jump to a set number, with optional wrap-around.
- [Loop Over Array](loopOverArray.md): Turns a JSON array into a loop, one item per element, so layers repeat for each entry.
- [Network Request](networkRequest.md): Loads JSON, text, images, video, or sound from a URL when it gets a pulse, and reports loading and errors.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Value at Index (`builtin.structure.array.index`)

| Sonobe port | Origami label |
|---|---|
| `value` | Output |
