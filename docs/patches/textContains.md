<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Text Contains

Checks whether text includes a search term anywhere and where the first match starts, for search filters and keyword checks.

| | |
|---|---|
| Type key | `textContains` |
| Category | [Text](README.md#text) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | contains, includes, search, find text, filter, indexof, has text, keyword |

## How it works
Text Contains looks for **Find** anywhere inside **Text**.

- **Contains** is true when Find appears at least once.
- **Index** is where the first match begins, counted in characters from 0: in "Hello world", "world" begins at 6. It's −1 when there's no match.
- **Case Sensitive** is off by default, so "Maya" contains "ma". Turn it on when capitals matter.
- An empty Find always matches with Index 0, so a search filter shows every item until someone types.

## Tips
- Build a search filter: feed a loop of names into Text and the search text into Find, then keep the items where Contains is true with Loop Filter.
- To dim rows that don't match instead of hiding them, wire Contains into an Option Picker set to Number and use its output as Opacity.
- Index counts characters the same way as Substring, so you can cut text at a match.

## Coming from Origami
Origami only has Text Starts With and Text Ends With. Text Contains matches anywhere in the text.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Text**<br>`text` | `text` | `""` | The text to search in. |
| **Find**<br>`find` | `text` | `""` | The text to look for anywhere in Text. An empty Find always matches. |
| **Case Sensitive**<br>`caseSensitive` | `boolean` | `false` | When on, capital letters must match exactly; when off, case is ignored, so "Maya" contains "ma". |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Contains**<br>`contains` | `boolean` | True while Find appears somewhere in Text. |
| **Index**<br>`index` | `index` | Where the first match begins, counted in characters from 0, or −1 when there's no match. |

## Examples

### Dim contacts that don't match a search

Case Sensitive is off, so "mar" matches Omar and Marisol.

```text
layer contacts group "Contacts" @16,140 358x200 layout=column spacing=10
  layer contact_name text "Contact Name" text←names.parts opacity←match_opacity.output
patch names splitText text="Maya Chen,Omar Haddad,Marisol Ruiz,Theo Park"
patch match textContains text←names.parts find="mar"
patch match_opacity optionPicker<number>[2] option←match.contains option0=0.3 option1=1
```

## Common mistakes

- Every item matches before anyone types: an empty Find always matches. That's usually right for a search filter; otherwise, also require that the search text's Text Length is above 0.
- "cafe" doesn't find "café": accented letters are different letters. Search with the accent, or replace accented letters in both texts with Text Replace first.

## Pairs well with

- [Loop Filter](loopFilter.md): Keeps, drops, or repeats each item of a loop, for filtered lists, selected items, or a value repeated a set number of times.
- [Option Picker](optionPicker.md): Outputs one of several values chosen by an option number, like a different color or title for each tab.
- [Text Starts With](textStartsWith.md): Checks whether text begins with a given prefix, such as a slash command or https://.
- [Substring](substring.md): Keeps part of some text, a number of characters from a starting position, for initials, previews, and shortened titles.
- [Text Length](textLength.md): Counts the characters in text, counting each emoji or accented letter as one character.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

Sonobe-native: Origami has no matching patch.
