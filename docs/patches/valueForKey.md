<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Value for Key

Reads one named field from a JSON object, such as a product's name or price.

| | |
|---|---|
| Type key | `valueForKey` |
| Category | [Data & Network](README.md#data--network) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | structure key, get field, object property, read key, dictionary lookup, get value, json field, attribute |

## How it works
Value for Key reads one entry of a JSON object by its name, the way `item.name` does in code.

- **Object** is the JSON object to read from, such as a network response or one item from Loop Over Array.
- **Key** is the entry's name. It must match exactly, including capital letters and spaces.
- **Value** is the entry's value. Change the patch's type to read it as text, a number, a boolean, a color, a point, an image, or JSON.
- **Found** is true when Object has that key. Otherwise Value is empty: 0, empty text, a transparent color, or nothing.

Reading is best effort: the text "4.5" reads as the number 4.5, and a URL reads as an image.

## Tips
- Keep the type at JSON when the value is another object or an array you want to keep reading.
- For several steps such as `user.address.city`, Value at Path is shorter than a chain of these.
- Not sure which keys exist? Get Keys lists them, and JSON to Text shows the whole object.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Object**<br>`object` | `json` | `{}` | The JSON object to read from. |
| **Key**<br>`key` | `text` | `""` | The name of the entry to read, matched exactly, including capital letters and spaces. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Value**<br>`value` | `variant` | The value stored under Key, read as the patch's type; empty when Found is false. |
| **Found**<br>`found` | `boolean` | True when Object is a JSON object that contains Key. |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `json` (default), `number`, `boolean`, `text`, `color`, `point`, `point3d`, `point4d`, `size`, `anchor`, `index`, `image`, `video`, `sound`.

## Examples

### List products from a JSON file

Loop Over Array turns the array into a loop, so each Value for Key reads one field per row.

```text
layer list group "List" @0,100 390x600 layout=column spacing=12
  layer row_title text "Product Name" text←names.value
  layer row_price text "Price" text←prices.value
patch products jsonFile asset="products"
patch rows loopOverArray array←products.json
patch names valueForKey<text> object←rows.items key="name"
patch prices valueForKey<text> object←rows.items key="price"
```

### Show the current temperature

```text
layer temperature text "Temperature" @24,120 text←temp.value
patch launch whenPrototypeStarts
patch weather networkRequest request←launch.started url="https://example.com/weather.json"
patch current valueForKey object←weather.result key="current"
patch temp valueForKey<text> object←current.value key="temperature"
```

## Common mistakes

- Value stays empty: the key doesn't match exactly. "Name" and "name" are different keys; check the data with JSON to Text.
- The value you need is one level deeper, so Value is an object instead of text: the field is nested. Chain another Value for Key, or use Value at Path with a path like `user.name`.
- A price shows as 0: the patch type is Text or JSON wired into a number property that can't read it, or the price is text like "$4". Set the type to Number and make sure the data holds a plain number.

## Pairs well with

- [Loop Over Array](loopOverArray.md): Turns a JSON array into a loop, one item per element, so layers repeat for each entry.
- [Network Request](networkRequest.md): Loads JSON, text, images, video, or sound from a URL when it gets a pulse, and reports loading and errors.
- [Value at Index](valueAtIndex.md): Reads one element of a JSON array by its position, counted from 0, like the first search result.
- [Value at Path](valueAtPath.md): Reads a value deep inside JSON with a dot path like results.0.title, including every match with * or a .. search.
- [Get Keys](getKeys.md): Lists the names of every entry in a JSON object as an array of text, so you can show or loop over them.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Value for Key (`builtin.structure.dictionary.key`)

| Sonobe port | Origami label |
|---|---|
| `value` | Output |
