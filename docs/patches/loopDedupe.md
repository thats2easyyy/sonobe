<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Loop Dedupe

Removes repeated items from a loop, keeping the first of each.

| | |
|---|---|
| Type key | `loopDedupe` |
| Category | [Loops](README.md#loops) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | dedupe, unique, remove duplicates, deduplicate, distinct, no repeats, set |

## How it works
Loop Dedupe removes repeated items from a loop. The first time a value appears it stays; later copies are dropped. Order is otherwise unchanged, so `[b, a, b, c, a]` becomes `[b, a, c]`.

- **Loop** is the loop to clean up.
- **Output** holds each distinct value once.
- **Index** counts the result's items from 0: `[0, 1, 2]`.

Values compare exactly. Text is case-sensitive, numbers must match exactly, and colors match when they'd store as the same hex color. Change the patch's type to dedupe text, colors, points, JSON, and more.

## Tips
- Build a list of unique tags or categories from data: Loop Over Array, then Loop Dedupe set to Text.
- Numbers from math can differ by tiny amounts. Round them first if 0.3 and 0.30000000000000004 should count as the same.
- For case-insensitive matching, Change Case the text to lowercase before deduping.

## Coming from Origami
Sonobe labels the loop output Output. Origami doesn't document which copy survives or how values compare; Sonobe keeps the first and uses the same equality as Option Equals.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Loop**<br>`loop` | `variant` · whole loop | empty loop | The loop to remove repeated values from. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Output**<br>`output` | `variant` · whole loop | Each distinct value once, in the order it first appeared. |
| **Index**<br>`index` | `index` · whole loop | The position of each result item, counted from 0: [0, 1, 2, …]. |

## Types

Pick the patch's type to change what flows through ports marked `variant`: `number` (default), `boolean`, `text`, `color`, `point`, `point3d`, `point4d`, `size`, `anchor`, `index`, `enum`, `json`.

## Examples

### Show each tag once

```text
layer tag_row group "Tags" @16,120 358x36 layout=row spacing=8
  layer tag text "Tag" text←unique_tags.output
patch tags loopOverArray array=json["design","music","design","travel","music"]
patch unique_tags loopDedupe<text> loop←tags.items
```

## Common mistakes

- Numbers that look the same both stay: math results such as 0.1 + 0.2 aren't exactly 0.3. Round the values before deduping.
- "Apple" and "apple" both stay: text comparison is case-sensitive. Change Case both to lowercase first.
- Images or labels no longer match their items: the result is shorter than the original, but a loop built alongside it still has the old count. Dedupe first, then derive the related loops from the result.

## Pairs well with

- [Loop Over Array](loopOverArray.md): Turns a JSON array into a loop, one item per element, so layers repeat for each entry.
- [Loop Append](loopAppend.md): Adds a value to the end of a loop each time it gets a pulse.
- [Loop Count](loopCount.md): Counts how many items a loop has, for sizing containers, showing totals, or keeping an index in range.
- [Change Case](changeCase.md): Changes text to uppercase, lowercase, capitalized words, or sentence case.
- [Round](round.md): Rounds a number to the nearest whole number or decimal place, and also outputs it rounded down and rounded up.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Loop Dedupe (`builtin.loop.mutations.dedupe`)

| Sonobe port | Origami label |
|---|---|
| `output` | Loop |
