<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Array Index Of

Finds where an item sits in a JSON array and whether it's there at all, such as checking if a post is saved.

| | |
|---|---|
| Type key | `arrayIndexOf` |
| Category | [Data & Network](README.md#data--network) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | index of, find in array, contains, includes, position of, search list, is saved, membership |

## How it works
Array Index Of looks for **Item** in **Array**, starting from the first element.

- **Index** is the position of the first match, counted from 0. It's −1 when Item isn't in the array.
- **Contains** is true when Item is in the array.

Matching is exact. Text must match including capital letters and spaces, and the number 3 doesn't match the text "3". Objects match when they have the same keys and values in any order; arrays match element by element. Colors are compared as `"#RRGGBBAA"` text.

Change the patch's type to match the kind of value in the array.

## Tips
- Wire Contains into an Option Picker to show a filled or outlined icon.
- With a looped Item, each row learns whether it's selected.
- Pair it with Array Append to track saved or selected ids.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Array**<br>`array` | `json` | `[]` | The JSON array to search. |
| **Item**<br>`item` | `variant` | `0` | The value to look for; it must match an element exactly. Its type follows the patch's type. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Index**<br>`index` | `index` | The position of the first matching element, counted from 0, or −1 when there's no match. |
| **Contains**<br>`contains` | `boolean` | True when Item is in Array. |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `number` (default), `boolean`, `text`, `color`, `point`, `point3d`, `point4d`, `size`, `anchor`, `index`, `json`, `image`, `video`, `sound`.

## Examples

### Fill the heart once a post is saved

```text
layer heart rectangle "Heart" @171,400 48x48 cornerRadius=24 color←heart_color.output
patch tap_heart interaction layer=@heart
patch saved arrayAppend<text> item="post_81" append←tap_heart.tap
patch is_saved arrayIndexOf<text> array←saved.output item="post_81"
patch heart_color optionPicker<color>[2] option←is_saved.contains option0="#8E8E93FF" option1="#FF3B30FF"
```

### Show which step a screen belongs to

```text
layer step_label text "Step Number" @24,120 text←step_index.index
patch steps jsonArray<text>[3] item0="welcome" item1="permissions" item2="done"
patch step_index arrayIndexOf<text> array←steps.array item="permissions"
```

## Common mistakes

- Contains stays false even though the id is in the list: the list stores numbers and Item is text, or the other way around. Change the patch's type to match the data.
- The first row looks selected when nothing is: Index is −1, and index inputs such as Option Picker's Option clamp −1 to 0. Use Contains to decide whether there's a match.

## Pairs well with

- [Array Append](arrayAppend.md): Adds an item to the end of a JSON array each time it gets a pulse, remembering everything added so far.
- [Option Picker](optionPicker.md): Outputs one of several values chosen by an option number, like a different color or title for each tab.
- [Loop Over Array](loopOverArray.md): Turns a JSON array into a loop, one item per element, so layers repeat for each entry.
- [Value at Index](valueAtIndex.md): Reads one element of a JSON array by its position, counted from 0, like the first search result.
- [JSON Array](jsonArray.md): Builds a JSON array from a list of values, such as tab titles or ids, to read by position or send as data.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Index Of (`builtin.structure.array.indexof`)
