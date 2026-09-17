<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Array Sort

Sorts a JSON array from smallest to largest or the reverse, optionally by a field such as price or name.

| | |
|---|---|
| Type key | `arraySort` |
| Category | [Data & Network](README.md#data--network) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | sort list, order by, alphabetize, rank, leaderboard, ascending, descending, sort by field |

## How it works
Array Sort outputs **Array** in order.

- **Sort By** chooses **Ascending** (smallest first, A to Z) or **Descending** (largest first, Z to A).
- **Key** sorts objects by one of their fields, such as `price`. Leave it empty to sort the elements themselves. Elements without that field go last.
- Numbers sort by value. Text sorts alphabetically, ignoring capital letters first, so "apple" comes before "Banana".
- When elements tie, they keep their original order.
- Mixed kinds sort as: empty values, booleans, numbers, text, arrays, then objects.

**Output** is the sorted copy, updated on the same frame any input changes.

## Tips
- Top score: sort Descending by `score`, then Value at Index 0.
- Get Keys, then Array Sort, gives an object's keys in alphabetical order.
- Text such as "10" sorts as text, after "1" and before "2". Store numbers as numbers to sort them by value.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Array**<br>`array` | `json` | `[]` | The JSON array to sort. |
| **Sort By**<br>`sortBy` | `enum` | `ascending` | Which direction to sort. |
| **Key**<br>`key` | `text` | `""` | A field to sort objects by, such as price; empty sorts the elements themselves. |

**Sort By options**

- **Ascending** (`ascending`): Smallest first: 1, 2, 3 and A to Z.
- **Descending** (`descending`): Largest first: 3, 2, 1 and Z to A.

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `json` | A sorted copy of Array. |

## Examples

### Show the top scorer

```text
layer leader text "Leader" @24,120 text←leader_name.value
patch scores jsonFile asset="scores"
patch ranked arraySort array←scores.json sortBy=descending key="score"
patch top valueAtIndex array←ranked.output index=0
patch leader_name valueForKey<text> object←top.value key="name"
```

### List categories alphabetically

```text
layer list group "Categories" @0,100 390x600 layout=column spacing=8
  layer category_label text "Category" text←category_rows.items
patch catalog jsonFile asset="catalog"
patch category_names getKeys object←catalog.json
patch sorted_names arraySort array←category_names.keys
patch category_rows loopOverArray array←sorted_names.output
```

## Common mistakes

- Objects don't move: they're compared as ties when Key is empty. Set Key to the field to sort by, such as `name`.
- "10" sorts before "9": the numbers are stored as text, which sorts letter by letter. Store them as numbers in the data.
- Some items end up at the bottom no matter the direction: they don't have the Key field. Check the field name's spelling and capitals.

## Pairs well with

- [Array Reverse](arrayReverse.md): Outputs a JSON array's elements in the opposite order, like showing the newest message first.
- [Get Keys](getKeys.md): Lists the names of every entry in a JSON object as an array of text, so you can show or loop over them.
- [Value at Index](valueAtIndex.md): Reads one element of a JSON array by its position, counted from 0, like the first search result.
- [Loop Over Array](loopOverArray.md): Turns a JSON array into a loop, one item per element, so layers repeat for each entry.
- [JSON File](jsonFile.md): Loads a JSON file from your project, such as a product list or mock feed, so prototypes work without a server.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Array Sort (`builtin.structure.array.sort`)
