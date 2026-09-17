<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Value at Path

Reads a value deep inside JSON with a dot path like results.0.title, including every match with * or a .. search.

| | |
|---|---|
| Type key | `valueAtPath` |
| Category | [Data & Network](README.md#data--network) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | json path, dot path, nested value, deep lookup, get nested, query json, pluck, wildcard |

## How it works
Value at Path walks through nested JSON one step at a time. **Path** is a list of steps separated by dots.

- A word such as `title` reads that key from an object.
- A whole number such as `0` reads that position from an array, counted from 0.
- `*` reads every child and gives back an array: `books.*.title` lists every book's title.
- Starting with `..` searches everything: `..title` finds every `title` key at any depth, in the order they appear.
- An empty Path gives back the whole Object.

**Value** is the result, read as the patch's type. **Found** is true when the path leads somewhere. When it doesn't, Value is empty: 0, empty text, a transparent color, or nothing.

## Tips
- Paths with `*` or `..` always give an array. Feed it into Loop Over Array to show one row per match.
- Keys that contain dots can't be written in a path; use Value for Key for those.
- Build a path from a loop index with Format Number or Add, such as `items.3.name`.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Object**<br>`object` | `json` | `{}` | The JSON object or array to read from. |
| **Path**<br>`path` | `text` | `""` | Steps separated by dots: keys, positions from 0, * for every child, or a leading .. to search everything. Empty returns the whole Object. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Value**<br>`value` | `variant` | What the path leads to, read as the patch's type; an array for * and .. paths, and empty when Found is false. |
| **Found**<br>`found` | `boolean` | True when every step of the path resolved. |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `json` (default), `number`, `boolean`, `text`, `color`, `point`, `point3d`, `point4d`, `size`, `anchor`, `index`, `image`, `video`, `sound`.

## Examples

### Show the artist of the first track

```text
layer artist text "Artist" @24,160 text←artist.value
patch launch whenPrototypeStarts
patch tracks networkRequest request←launch.started url="https://example.com/tracks.json"
patch artist valueAtPath<text> object←tracks.result path="results.0.artist.name"
```

### List every book title

The wildcard collects one title per book, and Loop Over Array makes a row for each.

```text
layer list group "Titles" @0,100 390x600 layout=column spacing=8
  layer book_title text "Book Title" text←title_items.items
patch library jsonFile asset="library"
patch titles valueAtPath object←library.json path="books.*.title"
patch title_items loopOverArray array←titles.value
```

## Common mistakes

- Value is empty for `results[0].title`: paths use dots only. Write `results.0.title`.
- Text shows brackets and quotes: a path with * or .. returns an array. Feed it into Loop Over Array, or use a position such as `books.0.title` for one value.
- Nothing is found even though the key looks right: spaces and capitals count, and a path like `user.` has an empty step. Remove stray spaces and trailing dots.

## Pairs well with

- [Network Request](networkRequest.md): Loads JSON, text, images, video, or sound from a URL when it gets a pulse, and reports loading and errors.
- [JSON File](jsonFile.md): Loads a JSON file from your project, such as a product list or mock feed, so prototypes work without a server.
- [Loop Over Array](loopOverArray.md): Turns a JSON array into a loop, one item per element, so layers repeat for each entry.
- [Value for Key](valueForKey.md): Reads one named field from a JSON object, such as a product's name or price.
- [Value at Index](valueAtIndex.md): Reads one element of a JSON array by its position, counted from 0, like the first search result.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Value at Path (`builtin.structure.path`)
