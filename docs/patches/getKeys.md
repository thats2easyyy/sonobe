<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Get Keys

Lists the names of every entry in a JSON object as an array of text, so you can show or loop over them.

| | |
|---|---|
| Type key | `getKeys` |
| Category | [Data & Network](README.md#data--network) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | object keys, field names, list keys, property names, dictionary keys, key list, iterate object |

## How it works
Get Keys looks at a JSON object and outputs the names of its top-level entries.

- **Object** is the object to inspect.
- **Keys** is a JSON array of text, one per entry. Nested objects aren't searched.
- Keys come out in the order they appear in the object, except that keys made only of digits (such as "2024") come first, smallest to largest.
- Anything that isn't an object gives an empty array.

## Tips
- Loop over an object: Get Keys, then Loop Over Array, then Value for Key with the looped key and the same object.
- Need alphabetical order? Put Array Sort after it.
- Count the entries with Array Count.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Object**<br>`object` | `json` | `{}` | The JSON object whose entry names you want. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Keys**<br>`keys` | `json` | A JSON array of the object's top-level key names, as text. |

## Examples

### Make a tab label for each category

The data is an object such as {"Photos": [...], "Videos": [...]}; each key becomes a tab.

```text
layer tabs group "Tabs" @0,60 390x44 layout=row spacing=16
  layer tab_label text "Tab Label" text←tab_keys.items
patch media jsonFile asset="media_library"
patch categories getKeys object←media.json
patch tab_keys loopOverArray array←categories.keys
```

### Count the fields in a response

```text
layer field_count text "Field Count" @24,120 text←count_fields.count
patch launch whenPrototypeStarts
patch profile networkRequest request←launch.started url="https://example.com/profile.json"
patch fields getKeys object←profile.result
patch count_fields arrayCount array←fields.keys
```

## Common mistakes

- Keys is empty for your data: the value is an array, not an object. Read one item with Value at Index first, or use Array Count for the length.
- The order looks shuffled: keys made of digits come first, smallest to largest. Put Array Sort after Get Keys, or keep the order in an array instead of an object.

## Pairs well with

- [Loop Over Array](loopOverArray.md): Turns a JSON array into a loop, one item per element, so layers repeat for each entry.
- [Value for Key](valueForKey.md): Reads one named field from a JSON object, such as a product's name or price.
- [Array Sort](arraySort.md): Sorts a JSON array from smallest to largest or the reverse, optionally by a field such as price or name.
- [Array Count](arrayCount.md): Counts how many elements a JSON array has, such as the number of search results or items in a cart.
- [JSON File](jsonFile.md): Loads a JSON file from your project, such as a product list or mock feed, so prototypes work without a server.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Get Keys (`builtin.structure.array.keys`)

| Sonobe port | Origami label |
|---|---|
| `keys` | Output |
