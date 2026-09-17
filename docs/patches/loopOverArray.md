<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Loop Over Array

Turns a JSON array into a loop, one item per element, so layers repeat for each entry.

| | |
|---|---|
| Type key | `loopOverArray` |
| Category | [Loops](README.md#loops) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | for each, iterate array, array to loop, json to loop, from array, map over array, repeat for each item |

## How it works
Loop Over Array turns a JSON array into a loop, with one item per element. Wire **Items** into a layer and that layer repeats once for each entry. It's the usual way to show data from a network request or a JSON file.

- **Array** is the JSON array to loop over.
- **Items** holds the elements in order. Each item is JSON: wire a plain value straight into a port, or pull fields out of an object with Value for Key.
- **Index** counts the items from 0: `[0, 1, 2, …]`.

An empty or missing array makes an empty loop, so looped layers show nothing until data arrives.

## Tips
- If the data is an object that contains the array, such as `{ "results": [...] }`, pick the array with Value for Key first.
- Nested arrays become items that are arrays. Pass each one into a looped component and use another Loop Over Array inside to build a loop of loops.
- Loop to Array does the reverse.

## Coming from Origami
Sonobe lists Items before Index.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Array**<br>`array` | `json` · whole loop | `[]` | The JSON array to loop over. Nothing, or an empty array, makes an empty loop. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Items**<br>`items` | `json` · whole loop | One item per array element, in order. Each item is JSON. |
| **Index**<br>`index` | `index` · whole loop | The position of each item, counted from 0: [0, 1, 2, …]. |

## Examples

### List names from a JSON array

```text
layer people group "People" @16,100 358x400 layout=column spacing=8
  layer name_label text "Name" text←names.items
patch names loopOverArray array=json["Ada","Grace","Linus"]
```

### Show a list loaded from the network

The endpoint returns an array of strings. For an array of objects, pull fields out of each item with Value for Key.

```text
layer tag_list group "Tags" @16,100 358x600 layout=column spacing=8
  layer tag_label text "Tag" text←tag_items.items
patch start whenPrototypeStarts
patch feed networkRequest url="https://example.com/api/tags.json" request←start.started
patch tag_items loopOverArray array←feed.result
```

## Common mistakes

- One row appears holding the whole response: the data is an object that contains the array. Use Value for Key to pick the array, such as "results", before Loop Over Array.
- Labels show braces and quotes: each item is an object. Pull out the field you want with Value for Key, then wire it into the Text layer.
- No rows at all: the request hasn't finished, or Array is text that only looks like JSON. Show a loading state from Network Request, or convert text with Text to JSON.

## Pairs well with

- [Network Request](networkRequest.md): Loads JSON, text, images, video, or sound from a URL when it gets a pulse, and reports loading and errors.
- [Value for Key](valueForKey.md): Reads one named field from a JSON object, such as a product's name or price.
- [JSON Array](jsonArray.md): Builds a JSON array from a list of values, such as tab titles or ids, to read by position or send as data.
- [JSON File](jsonFile.md): Loads a JSON file from your project, such as a product list or mock feed, so prototypes work without a server.
- [Loop to Array](loopToArray.md): Packs a whole loop into one JSON array you can send, store, or inspect.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Loop Over Array (`builtin.loop.fromarray`)
- **Also imports:** `builtin.loop.fromArray`
