<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Text Starts With

Checks whether text begins with a given prefix, such as a slash command or https://.

| | |
|---|---|
| Type key | `textStartsWith` |
| Category | [Text](README.md#text) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | starts with, begins with, prefix, has prefix, startswith, text prefix |

## How it works
Text Starts With outputs **Starts With**: true when **Text** begins with **Prefix**, and false otherwise.

- It checks the very first characters, so a leading space counts: " hello" doesn't start with "hello".
- **Case Sensitive** is off by default, so "Hello" starts with "he". Turn it on when capitals matter.
- An empty Prefix always matches.

## Tips
- Wire Starts With into Option Picker's Option to choose between two colors or icons.
- For type-ahead search, feed a loop of names into Text and the search text into Prefix, then keep the matches with Loop Filter.
- Need a match anywhere in the text? Use Text Contains.

## Coming from Origami
Origami's version always matches capitals exactly and has no Case Sensitive port. Imported patches turn Case Sensitive on to keep that behavior.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Text**<br>`text` | `text` | `""` | The text to check. |
| **Prefix**<br>`prefix` | `text` | `""` | The text that might appear at the very start of Text. An empty Prefix always matches. |
| **Case Sensitive**<br>`caseSensitive` | `boolean` | `false` | When on, capital letters must match exactly; when off, case is ignored, so "Hello" starts with "he". |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Starts With**<br>`startsWith` | `boolean` | True while Text begins with Prefix. |

## Examples

### Color links in a list

Items that start with https:// turn blue.

```text
layer rows group "Rows" @16,120 358x200 layout=column spacing=12
  layer row_text text "Row" text←items.parts textColor←row_color.output
patch items splitText text="Order #1042|https://example.com/track|Call support" token="|"
patch is_link textStartsWith text←items.parts prefix="https://"
patch row_color optionPicker<color>[2] option←is_link.startsWith option0="#1C1C1EFF" option1="#0A84FFFF"
```

## Common mistakes

- A match is missed: the text starts with a space or line break, which counts. Remove it at the source, or use Text Contains when the position doesn't matter.
- Everything matches while the search is empty: an empty Prefix always matches. Use Text Length to check that the search text isn't empty when nothing should match.

## Pairs well with

- [Text Ends With](textEndsWith.md): Checks whether text ends with a given suffix, such as a file extension or a question mark.
- [Text Contains](textContains.md): Checks whether text includes a search term anywhere and where the first match starts, for search filters and keyword checks.
- [Loop Filter](loopFilter.md): Keeps, drops, or repeats each item of a loop, for filtered lists, selected items, or a value repeated a set number of times.
- [Option Picker](optionPicker.md): Outputs one of several values chosen by an option number, like a different color or title for each tab.
- [Change Case](changeCase.md): Changes text to uppercase, lowercase, capitalized words, or sentence case.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Text Starts With (`builtin.textprefix`)
- **Also imports:** `builtin.textPrefix`

| Sonobe port | Origami label |
|---|---|
| `startsWith` | Output |
